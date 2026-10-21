// Lean Explore: replaces Claude Code's built-in Explore subagent with a lean one on Haiku.
// A plugin's own agents are namespaced (lean-explore:Explore) and cannot replace a built-in,
// so the mod writes ~/.claude/agents/Explore.md itself. "off" parks it as Explore.md.off.
// Agent files load at session start: every change applies from the next session.

const MARK = '# Written by the lean-explore mod. /explore-haiku off parks it.'

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
  try { return (await $.fs.read(path)).includes(MARK) } catch { return false }
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

// Footer label. `loaded` is what this session started with (agent files load at start);
// `current` is the file on disk now, which a toggle or the first install changes.
const footer = { loaded: undefined, current: undefined }
const kind = s => (s === 'on' ? 'Haiku' : 'built-in')

export function footerLabel() {
  if (!footer.loaded) return ''
  const label = `Explore: ${kind(footer.loaded)}`
  return kind(footer.current) === kind(footer.loaded) ? label : `${label} (${kind(footer.current)} next session)`
}

function track($, p) {
  return state($, p).then(s => { footer.current = s; $.ui.invalidate('ui.render') })
}

export const register = on => {
  // First run installs the agent; a newer mod version refreshes our own file. Never touches a custom one.
  on('session.start', async ($, e, next) => {
    const out = await next(e)
    try {
      await $.command.register({ name: 'explore-haiku', description: 'Lean Haiku Explore agent: /explore-haiku on|off|status', immediate: true })
    } catch { /* name taken */ }
    try {
      const p = await paths($)
      const now = await state($, p)
      footer.loaded = now
      footer.current = now
      if (now === 'missing') {
        await writeAgent($, p)
        $.ui.toast(`lean-explore: installed the Haiku Explore agent. ${NEXT} /explore-haiku off undoes it.`, { timeoutMs: 10000 })
      } else if (now === 'on' && (await $.fs.read(p.live)) !== AGENT) {
        await writeAgent($, p)
      }
      await track($, p)
    } catch { /* never block a session start */ }
    return out
  })

  // Same short label on the terminal and the desktop app.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const label = footerLabel()
    if (!label) return next(e)
    const modes = Array.isArray(e.props && e.props.modes) ? e.props.modes : []
    return next({ ...e, props: { ...e.props, modes: [...modes, label] } })
  })

  on('command.run', { command: 'explore-haiku' }, async ($, e) => {
    const want = String(e.args ?? '').trim().toLowerCase()
    const p = await paths($)
    const now = await state($, p)
    if (want !== 'on' && want !== 'off') {
      const said = { on: 'on', off: 'off (parked as Explore.md.off)', missing: 'not installed', custom: 'off - a custom Explore.md not written by this mod is in use' }[now]
      return { text: `Lean Explore agent: ${said}. Type /explore-haiku on or /explore-haiku off. Changes apply from the next session.` }
    }
    if (now === 'custom') return { text: `${p.live} was not written by this mod, so it was left alone. Rename or remove it first.` }
    if (now === want) return { text: `Lean Explore agent is already ${want}.` }
    if (want === 'off') {
      if (now === 'missing') return { text: 'Lean Explore agent is not installed, so there is nothing to turn off.' }
      const r = await move($, p.live, p.parked)
      if (r.exitCode !== 0) return { text: `Could not park the agent: ${String(r.stderr || r.stdout).trim()}` }
      await track($, p)
      return { text: `Lean Explore agent is now off; the built-in Explore is back. ${NEXT}` }
    }
    if (now === 'off') {
      const r = await move($, p.parked, p.live)
      if (r.exitCode !== 0) return { text: `Could not restore the agent: ${String(r.stderr || r.stdout).trim()}` }
    } else {
      await writeAgent($, p)
    }
    await track($, p)
    return { text: `Lean Explore agent is now on. ${NEXT}` }
  })
}
