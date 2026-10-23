// Lean Explore: replaces Claude Code's built-in Explore subagent with a lean one on Haiku.
// A plugin's own agents are namespaced (lean-explore:Explore) and cannot replace a built-in,
// so the mod writes ~/.claude/agents/Explore.md itself. "off" parks it as Explore.md.off.
// Agent files load at session start: every change applies from the next session.

// OWNER is the stable part of the marker; files from 1.0 and 1.1 end in "/explore-haiku off parks it."
import { KEY, emptyLedger, fromScan, addRun, summarize } from './stats.mjs'

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

// All-time numbers per model, kept in $.store. The first load fills it from the subagent
// transcripts already on disk (backfill.py); after that every finished Explore run adds one.
let ledger = emptyLedger()
const live = new Map() // agentId -> the run in progress

const tok = n => {
  const v = Number(n) || 0
  if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(v >= 1e5 ? 0 : 1) + 'k'
  return String(Math.round(v))
}

async function scan($) {
  const r = await $.process.run(['python3', '-I', `${$.plugin.root}/hooks/backfill.py`], { timeoutMs: 60000 })
  if (r.exitCode !== 0) throw new Error(String(r.stderr || r.stdout).trim())
  ledger = fromScan(JSON.parse(String(r.stdout).trim().split('\n').pop()))
  await $.store.set(KEY, ledger)
}

let refresher

async function loadLedger($) {
  try {
    const saved = await $.store.get(KEY)
    if (saved && saved.v === 1) ledger = saved
    if (!ledger.scanned) await scan($)
  } catch { /* the chip just shows no totals */ }
}

function statsText() {
  const s = summarize(ledger)
  if (!s.runs) return s.otherRuns ? `No Haiku Explore runs yet (${s.otherRuns} ran on the built-in agent).` : 'No Explore runs recorded yet.'
  const lines = [
    `Lean Explore, all time: ${s.runs} Haiku search${s.runs === 1 ? '' : 'es'}, ${s.reads} file reads/searches.`,
    `Delegated to Haiku: ${tok(s.delegated)} tokens (${tok(s.fresh)} billed fresh, ${tok(s.cached)} served from cache), ${tok(s.avgPerRun)} per search.`,
    `Kept out of your main chat: about ${tok(s.keptOutOfChat)} tokens of file text the agent read; only ~${tok(s.reportTokens)} of reports came back.`,
  ]
  if (s.otherRuns) lines.push(`${s.otherRuns} earlier search${s.otherRuns === 1 ? '' : 'es'} ran on the built-in agent and are not counted above.`)
  return lines.join('\n')
}
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
  // Lean on purpose: the dot, the model, one number. The card says what the number is.
  const sum = summarize(ledger)
  const words = [kind(view.loaded)]
  if (lean && sum.delegated) words.push(tok(sum.delegated))
  if (pending()) words.push(`${kind(view.current)} next session`)
  const chip = Text({ children: [Text({ color: lean ? 'success' : 'warning', children: ['●'] }), ` ${words.join(' · ')}`] })

  const card = [Text({ bold: true, children: [lean ? 'Explore on Haiku' : 'Built-in Explore agent'] })]
  if (lean && sum.runs) {
    card.push(Text({ children: [`All time: ${sum.runs} searches, ${sum.reads} reads${view.searches ? ` (${view.searches} this chat)` : ''}`] }))
    card.push(Text({ children: [`${tok(sum.delegated)} tokens delegated to Haiku (${tok(sum.fresh)} fresh, ${tok(sum.cached)} cached)`] }))
    card.push(Text({ children: [`~${tok(sum.keptOutOfChat)} tokens of file text kept out of your chat`] }))
  } else if (lean) card.push(Text({ children: ['No searches recorded yet.'] }))
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
  const mine = Box({ key: 'lean-explore', flexDirection: 'column', children: [Box({ flexDirection: 'row', columnGap: 2, children: row }), hoverCard] })

  // Share the row other mods use (TL;DR's `mods-row`): the chip goes first, their buttons
  // stay at the right end. With none beneath, draw that row so an outer mod can join it.
  const shared = findKeyed(below, SHARED_ROW)
  if (shared) return swapNode(below, shared, { ...shared, children: [mine, ...(shared.children ?? [])] })
  // marginTop: the same gap the other rows in the band keep from Token Optimizer's card
  const own = Box({ key: SHARED_ROW, flexDirection: 'row', alignItems: 'flex-start', columnGap: 2, marginTop: 'md', children: [mine, Box({ flexGrow: 1 })] })
  return Box({ flexDirection: 'column', children: below ? [own, below] : [own] })
}

// Drawings beneath come from next(e) as plain { type, props, children } nodes.
const SHARED_ROW = 'mods-row'

function findKeyed(node, key) {
  if (!node || typeof node !== 'object') return null
  if (node.props && node.props.key === key) return node
  for (const child of node.children ?? []) {
    const hit = findKeyed(child, key)
    if (hit) return hit
  }
  return null
}

function swapNode(node, target, next) {
  if (node === target) return next
  if (!node || typeof node !== 'object' || !node.children) return node
  let changed = false
  const children = node.children.map(child => {
    const out = swapNode(child, target, next)
    if (out !== child) changed = true
    return out
  })
  return changed ? { ...node, children } : node
}

export const register = on => {
  // First run installs the agent; a newer mod version refreshes our own file. Never touches a custom one.
  on('session.start', async ($, e, next) => {
    const out = await next(e)
    try {
      await $.command.register({ name: 'lean-explore', description: 'Lean Haiku Explore agent: /lean-explore on|off|stats|rescan', immediate: true })
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
      await loadLedger($)
      $.ui.invalidate('ui.render')
      // Pick up runs finished by sessions open at the same time.
      refresher?.cancel()
      refresher = $.clock.every(30000, async () => {
        try {
          const stored = await $.store.get(KEY)
          if (stored && stored.v === 1 && JSON.stringify(stored) !== JSON.stringify(ledger)) { ledger = stored; $.ui.invalidate('ui.render') }
        } catch { /* try again next period */ }
      })
    } catch { /* never block a session start */ }
    return out
  })

  // Count Explore runs for the chip. Nothing about the spawn changes.
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (e.subagentType === 'Explore' && r && r.deny === undefined) {
      view.searches += 1
      if (r.agentId) live.set(r.agentId, { model: r.model, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, readChars: 0, reportChars: 0, tools: {} })
      $.ui.invalidate('ui.render')
    }
    return r
  })

  // What each Explore run costs, step by step: the API's own usage figures.
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    const run = e.agentId && live.get(e.agentId)
    if (run && r && r.usage) {
      run.model = r.usage.model || run.model
      run.input += r.usage.input_tokens; run.cacheRead += r.usage.cache_read_input_tokens
      run.cacheWrite += r.usage.cache_creation_input_tokens; run.output += r.usage.output_tokens
    }
    return r
  })

  // What it read: one count per tool call, and the size of the text it got back.
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    const run = e.agentId && live.get(e.agentId)
    if (run && r && r.deny === undefined) {
      run.tools[e.tool] = (run.tools[e.tool] ?? 0) + 1
      run.readChars += typeof r.text === 'string' ? r.text.length : 0
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const run = e.agentId && live.get(e.agentId)
    if (run) {
      live.delete(e.agentId)
      run.reportChars = String(e.answer ?? '').length
      try {
        // Other sessions write the same key: add this run to what is stored now, not to the
        // copy loaded at session start, so parallel sessions do not overwrite each other.
        const stored = await $.store.get(KEY)
        if (stored && stored.v === 1) ledger = stored
        addRun(ledger, run)
        await $.store.set(KEY, ledger)
        $.ui.invalidate('ui.render')
      } catch { /* keep going */ }
    }
    return next(e)
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
    if (want === 'stats') return { text: statsText() }
    if (want === 'rescan') {
      try { await scan($) } catch (err) { return { text: `Could not rescan the transcripts: ${err.message}` } }
      return { text: `Rescanned every past Explore run.\n${statsText()}` }
    }
    const now = await state($, await paths($))
    const said = { on: 'on', off: 'off (parked as Explore.md.off)', missing: 'not installed', custom: 'off - a custom Explore.md not written by this mod is in use' }[now]
    return { text: `Lean Explore agent: ${said}. Type /lean-explore on or /lean-explore off. Changes apply from the next session. /lean-explore stats shows what it has saved.` }
  })
}
