// Lean Explore: replaces Claude Code's built-in Explore subagent with a lean one on Haiku.
// A plugin's own agents are namespaced (lean-explore:Explore) and cannot replace a built-in,
// so the mod writes ~/.claude/agents/Explore.md itself. "off" parks it as Explore.md.off.
// Agent files load at session start: every change applies from the next session.

// OWNER is the stable part of the marker; files from 1.0 and 1.1 end in "/explore-haiku off parks it."
const OWNER = '# Written by the lean-explore mod.'
const MARK = `${OWNER} /lean-explore off parks it.`

export const AGENT = `---
name: Explore
${MARK}
description: Read-only codebase search on Haiku. Use to find files, read code and docs, and answer "where is X / what does Y do" questions when you only need the conclusion, not the file dumps. Say how thorough to be ("quick", "medium", "very thorough").
model: haiku
effort: low
tools: Read, Grep, Glob
---

You are a read-only search agent. Find what the caller asked for and report it briefly.

How to work:
- Start with Glob and Grep to locate candidates. Read only the parts of files you need (use offset and limit on big files).
- Match the thoroughness the caller asked for. "Quick" means one or two searches. "Very thorough" means check other folders and naming variants too.
- Never edit, write, or run anything. You have no tools for it, so do not try.

What to return:
- The files that matter, with line numbers (path:line), and the lines that matter, quoted short.
- A direct answer to the question asked. No preamble, no restating the task.
- Under 300 words unless the caller asks for more.
- Say what you did not cover (a folder you skipped, a copy you did not check).
- If the answer needs judgment (a design choice, a review, a recommendation), say so and stop. The main model decides.
`

const BACKSLASH = String.fromCharCode(92)
const slash = p => String(p ?? '').split(BACKSLASH).join('/')

async function paths($) {
  const home = slash((await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '').replace(/\/+$/, '')
  const dir = `${home}/.claude/agents`
  return { dir, live: `${dir}/Explore.md`, parked: `${dir}/Explore.md.off` }
}

async function isOurs($, path) {
  try { return (await $.fs.read(path)).includes(OWNER) } catch { return false }
}

// on: our file is active · off: parked · custom: someone else's Explore.md, left alone · missing
async function state($, p) {
  if (await $.fs.exists(p.live)) return (await isOurs($, p.live)) ? 'on' : 'custom'
  return (await $.fs.exists(p.parked)) ? 'off' : 'missing'
}

async function windows($) {
  return (await $.env.get('OS')) === 'Windows_NT'
}

async function move($, from, to) {
  const argv = (await windows($))
    ? ['cmd', '/c', 'move', '/Y', from.split('/').join(BACKSLASH), to.split('/').join(BACKSLASH)]
    : ['mv', '-f', from, to]
  return $.process.run(argv, { timeoutMs: 10000 })
}

async function writeAgent($, p) {
  try {
    await $.fs.write(p.live, AGENT)
  } catch {
    const argv = (await windows($)) ? ['cmd', '/c', 'mkdir', p.dir.split('/').join(BACKSLASH)] : ['mkdir', '-p', p.dir]
    await $.process.run(argv, { timeoutMs: 10000 })
    await $.fs.write(p.live, AGENT)
  }
}

const NEXT = 'Start a new session for it to apply.'

// `loaded` is what this session started with (agent files load at start); `current` is
// the file on disk now, which a toggle or the first install changes. `searches` counts
// this session's Explore runs.
const view = { loaded: undefined, current: undefined, searches: 0 }
const kind = s => (s === 'on' ? 'Haiku' : 'built-in')
const pending = () => kind(view.current) !== kind(view.loaded)

export function footerLabel() {
  if (!view.loaded) return ''
  const label = `Explore: ${kind(view.loaded)}`
  return pending() ? `${label} (${kind(view.current)} next session)` : label
}

function track($, p) {
  return state($, p).then(s => { view.current = s; $.ui.invalidate('ui.render') })
}

// Shared by /lean-explore and the desktop chip's buttons. Returns what to tell the person.
async function turn($, want) {
  const p = await paths($)
  const now = await state($, p)
  if (now === 'custom') return `${p.live} was not written by this mod, so it was left alone. Rename or remove it first.`
  if (now === want) return `Lean Explore agent is already ${want}.`
  if (want === 'off') {
    if (now === 'missing') return 'Lean Explore agent is not installed, so there is nothing to turn off.'
    const r = await move($, p.live, p.parked)
    if (r.exitCode !== 0) return `Could not park the agent: ${String(r.stderr || r.stdout).trim()}`
    await track($, p)
    return `Lean Explore agent is now off; the built-in Explore is back. ${NEXT}`
  }
  if (now === 'off') {
    const r = await move($, p.parked, p.live)
    if (r.exitCode !== 0) return `Could not restore the agent: ${String(r.stderr || r.stdout).trim()}`
  } else {
    await writeAgent($, p)
  }
  await track($, p)
  return `Lean Explore agent is now on. ${NEXT}`
}

// The desktop chip, one row in the band above the prompt. Green with a search count while
// the lean agent runs; amber with a "Turn on" button while the built-in one does. Hovering
// shows a card; the app reveals it, no hook runs.
function desktopChip($, e, below) {
  if (!view.loaded) return below
  const { Box, Text, Button } = $.ui.resolve(e)
  const lean = view.loaded === 'on'
  const n = view.searches
  const words = [`Explore: ${kind(view.loaded)}`]
  if (lean && n) words.push(`${n} search${n === 1 ? '' : 'es'}`)
  if (pending()) words.push(`${kind(view.current)} next session`)
  const chip = Text({ children: [Text({ color: lean ? 'success' : 'warning', children: ['●'] }), ` ${words.join(' · ')}`] })

  const card = [Text({ bold: true, children: [lean ? 'Lean Explore on Haiku' : 'Built-in Explore agent'] })]
  if (lean) card.push(Text({ children: ['Searches use about 3x fewer tokens than the built-in agent (an estimate from tests).'] }))
  else if (view.loaded === 'custom') card.push(Text({ children: ['Your own ~/.claude/agents/Explore.md is in use, so lean-explore stays out of the way.'] }))
  else card.push(Text({ children: ['Searches run on the full built-in agent. The lean one uses about 3x fewer tokens.'] }))
  if (pending()) card.push(Text({ dimColor: true, children: ['A change is waiting: start a new session to apply it.'] }))

  const act = (label, want) => Button({ key: `lean-explore-${want}`, label, plain: true, onPress: async () => { $.ui.toast(await turn($, want), { timeoutMs: 8000 }) } })
  const buttons = []
  if (lean && !pending()) buttons.push(act('Turn off', 'off'))
  if (buttons.length) card.push(Box({ flexDirection: 'row', columnGap: 2, children: buttons }))

  // The card opens inside the band, under the chip: a card floated outside it would be
  // clipped to the band's one row.
  const hoverCard = Box({ display: 'none', hover: { display: 'flex' }, flexDirection: 'column', rowGap: 1, padding: 'sm', borderStyle: 'round', children: card })
  const row = [chip]
  // The amber state needs action, so its button sits on the chip itself.
  if (!lean && !pending() && view.loaded !== 'custom') row.push(act('Turn on', 'on'))
  // marginTop: the same gap the other rows in the band keep from Token Optimizer's card
  const mine = Box({ key: 'lean-explore', flexDirection: 'column', marginTop: 'md', children: [Box({ flexDirection: 'row', columnGap: 2, children: row }), hoverCard] })
  return Box({ flexDirection: 'column', children: below ? [mine, below] : [mine] })
}

export const register = on => {
  // First run installs the agent; a newer mod version refreshes our own file. Never touches a custom one.
  on('session.start', async ($, e, next) => {
    const out = await next(e)
    try {
      await $.command.register({ name: 'lean-explore', description: 'Lean Haiku Explore agent: /lean-explore on|off|status', immediate: true })
    } catch { /* name taken */ }
    try {
      const p = await paths($)
      const now = await state($, p)
      view.loaded = now
      view.current = now
      view.searches = 0
      if (now === 'missing') {
        await writeAgent($, p)
        $.ui.toast(`lean-explore: installed the Haiku Explore agent. ${NEXT} /lean-explore off undoes it.`, { timeoutMs: 10000 })
      } else if (now === 'on' && (await $.fs.read(p.live)) !== AGENT) {
        await writeAgent($, p)
      }
      await track($, p)
    } catch { /* never block a session start */ }
    return out
  })

  // Count Explore runs for the chip. Nothing about the spawn changes.
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (e.subagentType === 'Explore' && r && r.deny === undefined) { view.searches += 1; $.ui.invalidate('ui.render') }
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.surface !== 'desktop' || (e.props && e.props.hasSurvey)) return below
    return desktopChip($, e, below)
  })

  // The terminal gets a short footer label; on desktop the chip says it.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (e.surface === 'desktop') return next(e)
    const label = footerLabel()
    if (!label) return next(e)
    const modes = Array.isArray(e.props && e.props.modes) ? e.props.modes : []
    return next({ ...e, props: { ...e.props, modes: [...modes, label] } })
  })

  on('command.run', { command: 'lean-explore' }, async ($, e) => {
    const want = String(e.args ?? '').trim().toLowerCase()
    if (want === 'on' || want === 'off') return { text: await turn($, want) }
    const now = await state($, await paths($))
    const said = { on: 'on', off: 'off (parked as Explore.md.off)', missing: 'not installed', custom: 'off - a custom Explore.md not written by this mod is in use' }[now]
    return { text: `Lean Explore agent: ${said}. Type /lean-explore on or /lean-explore off. Changes apply from the next session.` }
  })
}
