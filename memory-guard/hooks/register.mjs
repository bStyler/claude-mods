// Memory Guard: spots sessions worth remembering and makes sure they get /memorize.
// - A session scores a point per distinct signal: a file written to an output folder,
//   a write through an MCP tool, a meeting transcript read, a decision in a prompt, a
//   git commit, an accepted plan, any extraSignals of your own. A long session adds one.
// - At the threshold, a session that never ran /memorize gets one nudge: a toast, a band
//   with "Memorize now" and "Not this session", and /memorize as the prompt suggestion.
// - A session that ends that way joins this project's queue. The next session here is
//   told about it and offers "Catch up"; the hint line shows "· N unmemorized".
// - Config: .claude/memory-guard.json in the project, ~/.claude/memory-guard.json for
//   defaults. "kb" points it at a wiki, "skill" hands /memorize to a skill of your own.
// - Commands: /memorize-queue [clear], /memory-guard on|off|status.
// - The mod sends no model requests of its own.

import { makeMasker } from './privacy.mjs'

const DEFAULTS = {
  enabled: true,
  threshold: 2,
  longSessionTurns: 10,
  kb: null,
  skill: '',
  outputDirs: ['docs', 'reports', 'deliverables', 'notes'],
  signals: { outputFile: true, mcpWrite: true, transcriptRead: true, decision: true, commit: true, planAccepted: true, longSession: true },
  extraSignals: [],
  ui: { band: true, hint: true, suggest: true },
}
const BUNDLED_SKILL = 'memory-guard:memorize'
const QUEUE_MAX = 20
const WRITERS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const MCP_WRITE = /(^|[_-])(create|update|add|send|post|publish|insert|append|move|delete|comment|write|edit|upsert|set|save)([_-]|$)/i
const TRANSCRIPT = /meeting|transcript|recording/i
const DECISION = /\b(let'?s go with|we('ve| have)? decided|decided to|from now on|going forward|always|never|remember (that|this)|that'?s wrong|don'?t ever)\b/i
const LABELS = {
  outputFile: 'an output file',
  mcpWrite: 'an MCP write',
  transcriptRead: 'a meeting transcript',
  decision: 'a decision',
  commit: 'a commit',
  planAccepted: 'an accepted plan',
}

let home = ''
let cwd = ''
let project = ''
let cfg = DEFAULTS
let extra = []
let off = false
let memDir = ''
let ready = false
let cur = null // this session's record, as last loaded or saved
let queueCount = 0
let startQueue = [] // the queue as this session found it, for the band
let bandHidden = false
let mask = (s) => s

const n = (p) => String(p ?? '').replace(/\\/g, '/')
const lower = (p) => n(p).toLowerCase()
const isAbs = (p) => /^([A-Za-z]:)?\//.test(n(p))
const resolve = (p) => (isAbs(p) ? n(p) : `${cwd}/${n(p).replace(/^\.\//, '')}`)
const watched = () => cfg.enabled !== false && !off
const skillName = () => String(cfg.skill || '').replace(/^\//, '') || BUNDLED_SKILL
const label = (id) => LABELS[id] || id

function merge(base, over) {
  if (!over || typeof over !== 'object') return base
  const out = { ...base, ...over }
  for (const k of ['signals', 'ui']) out[k] = { ...base[k], ...(over[k] || {}) }
  return out
}

function normalizeKb(kb) {
  if (!kb) return null
  if (typeof kb === 'string') return { path: kb }
  return kb.path ? kb : null
}

async function readJson($, path) {
  try {
    if (!(await $.fs.exists(path))) return null
    return JSON.parse(await $.fs.read(path))
  } catch {
    $.ui.log(`memory-guard: could not read ${path}, using defaults`, { to: 'debug' })
    return null
  }
}

async function readRecording($) {
  const flag = await readJson($, `${home || '.'}/.claude/mods-data/recording.json`)
  const on = !!(flag && flag.on)
  mask = on ? makeMasker({ strict: !!flag.strict }) : (s) => s
}

function compileExtra(list, $) {
  const out = []
  for (const sig of Array.isArray(list) ? list : []) {
    if (!sig || !sig.name) continue
    try {
      out.push({ name: String(sig.name), tool: sig.tool ? new RegExp(sig.tool) : null, bash: sig.bash ? new RegExp(sig.bash) : null })
    } catch {
      $.ui.log(`memory-guard: extraSignals "${sig.name}" has a bad pattern, skipped`)
    }
  }
  return out
}

async function ensure($) {
  const dir = n(await $.session.cwd()).replace(/\/+$/, '')
  if (ready && dir === cwd) return
  cwd = dir
  project = lower(dir)
  home = n((await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '')
  const user = await readJson($, `${home}/.claude/memory-guard.json`)
  const local = await readJson($, `${cwd}/.claude/memory-guard.json`)
  cfg = merge(merge(DEFAULTS, user), local)
  cfg.kb = normalizeKb(cfg.kb)
  extra = compileExtra(cfg.extraSignals, $)
  off = !!(await $.store.get(`off:${project}`))
  // Claude Code keeps auto-memory beside the transcripts: projects/<cwd with every
  // other character as "-">/memory. The transcript path, once seen, wins.
  if (!memDir) memDir = `${home}/.claude/projects/${cwd.replace(/[^A-Za-z0-9]/g, '-')}/memory`
  queueCount = (await readQueue($, project)).filter((q) => !cur || q.sessionId !== cur.id).length
  await readRecording($)
  ready = true
}

// ---------- the session record ----------

function score(s) {
  return s.signals.length + (cfg.signals.longSession && s.turns >= cfg.longSessionTurns ? 1 : 0)
}

async function load($) {
  const id = await $.session.id()
  if (cur && cur.id === id) return cur
  cur = ((await $.store.get(`session:${id}`)) ?? {
    id, signals: [], turns: 0, memorized: false, nudged: false, dismissed: false,
    topic: '', transcript: '', project, startedAt: new Date().toISOString(),
  })
  return cur
}

async function save($, s) {
  s.important = score(s) >= cfg.threshold
  cur = s
  await $.store.set(`session:${s.id}`, s)
}

async function readQueue($, key) {
  return ((await $.store.get(`queue:${key}`)) ?? [])
}

async function clearQueue($) {
  await $.store.set(`queue:${project}`, [])
  queueCount = 0
  startQueue = []
}

// ---------- what counts ----------

function signalsFor(tool, e) {
  const on = cfg.signals
  const hits = []
  if (on.outputFile && WRITERS.has(tool)) {
    const path = lower(e.file_path ?? e.notebook_path)
    const dirs = (cfg.outputDirs || []).map((d) => lower(d).replace(/^\.?\/|\/$/g, '')).filter(Boolean)
    if (dirs.some((d) => path.includes(`/${d}/`) || path.startsWith(`${d}/`))) hits.push('outputFile')
  }
  if (tool.startsWith('mcp__')) {
    const action = tool.slice(tool.lastIndexOf('__') + 2)
    if (on.mcpWrite && MCP_WRITE.test(action)) hits.push('mcpWrite')
    if (on.transcriptRead && TRANSCRIPT.test(action)) hits.push('transcriptRead')
  }
  if (on.commit && tool === 'Bash' && /\bgit\s+commit\b/.test(String(e.command ?? ''))) hits.push('commit')
  if (on.planAccepted && tool === 'ExitPlanMode') hits.push('planAccepted')
  for (const sig of extra) {
    if ((sig.tool && sig.tool.test(tool)) || (sig.bash && tool === 'Bash' && sig.bash.test(String(e.command ?? '')))) hits.push(sig.name)
  }
  return hits
}

function isMemorizeName(name) {
  const bare = String(name ?? '').replace(/^\//, '')
  return bare === skillName() || bare === BUNDLED_SKILL || bare === 'memorize'
}

function isMemoryPath(path) {
  const p = lower(path)
  if (!p) return false
  if (memDir && p.startsWith(lower(memDir) + '/')) return true
  if (p.endsWith('/memory.md')) return true
  return !!(cfg.kb && cfg.kb.log && p === lower(resolve(cfg.kb.log)))
}

// undefined: not a memorize; otherwise whether it covers the whole queue
function memorizeCall(tool, e) {
  if (tool === 'Skill' && isMemorizeName(e.skill)) return /^\s*queue\b/.test(String(e.args ?? ''))
  if (WRITERS.has(tool) && isMemoryPath(e.file_path)) return false
  if (tool === 'Bash') {
    const cmd = String(e.command ?? '')
    const target = cfg.kb && cfg.kb.log ? n(cfg.kb.log) : ''
    if (/>>|\btee\b/.test(cmd) && (/MEMORY\.md/.test(cmd) || (target && n(cmd).includes(target)))) return false
  }
  return undefined
}

async function markMemorized($, s, coversQueue) {
  s.memorized = true
  if (coversQueue) await clearQueue($)
  await save($, s)
  $.ui.invalidate('ui.render')
}

// ---------- commands ----------

async function queueText($) {
  const s = await load($)
  const queue = await readQueue($, project)
  const head = `This session: score ${score(s)} of ${cfg.threshold} (${s.signals.map(label).join(', ') || 'no signals'}), memorized: ${s.memorized ? 'yes' : 'no'}.`
  if (queue.length === 0) return `${head}\nQueue is empty.`
  return [head, 'Waiting for /memorize:', ...queue.map((q) => `- ${q.startedAt.slice(0, 10)} ${q.topic || 'untitled'} (${q.signals.map(label).join(', ')})`)].join('\n')
}

async function statusText($) {
  const s = await load($)
  return [
    `memory-guard is ${watched() ? 'on' : 'off'} in this project${cfg.enabled === false ? ' (disabled in config)' : ''}.`,
    `Files into: ${cfg.kb ? `the knowledge base in ${cfg.kb.path}/, plus auto-memory` : 'auto-memory'} (${memDir}).`,
    `/memorize runs: /${skillName()}.`,
    `Threshold ${cfg.threshold}; this session scores ${score(s)} (${s.signals.map(label).join(', ') || 'no signals'}, ${s.turns} turns).`,
    `Queue: ${queueCount} session(s).`,
  ].join('\n')
}

// ---------- drawing ----------

function drawBand($, el) {
  const { Box, Text, Button } = el
  const s = cur
  if (s && s.nudged && !s.memorized && !s.dismissed) {
    return Box({
      flexDirection: 'row', columnGap: 2, flexWrap: 'wrap',
      children: [
        Text({ children: [`memory-guard: this session has ${s.signals.map(label).join(', ') || 'a lot of work'}. Save what it learned?`] }),
        Button({ key: 'memorize', label: 'Memorize now', onPress: () => runSkill($, '') }),
        Button({ key: 'dismiss', label: 'Not this session', onPress: async () => {
          const r = await load($)
          r.dismissed = true
          await save($, r)
          $.ui.invalidate('ui.render')
        } }),
      ],
    })
  }
  if (!bandHidden && startQueue.length && queueCount > 0) {
    const rows = startQueue.slice(-3).map((q) => Text({ dimColor: true, wrap: 'truncate-end', children: [`  ${q.startedAt.slice(0, 10)} ${mask(q.topic || 'untitled')}`] }))
    return Box({
      flexDirection: 'column',
      children: [
        Text({ children: [`memory-guard: ${queueCount} earlier session(s) here ended without /memorize.`] }),
        ...rows,
        Box({
          flexDirection: 'row', columnGap: 2,
          children: [
            Button({ key: 'catchup', label: 'Catch up', onPress: () => runSkill($, 'queue') }),
            Button({ key: 'clear', label: 'Clear', onPress: async () => { await clearQueue($); $.ui.invalidate('ui.render') } }),
            Button({ key: 'hide', label: 'Hide', onPress: () => { bandHidden = true; $.ui.invalidate('ui.render') } }),
          ],
        }),
      ],
    })
  }
  return null
}

// The hooks on the path of a prompt, a tool call or a session start log a failure of the
// mod's own and let the event go on as if the mod were absent.
function logged($, where, err, value) {
  $.ui.log(`memory-guard: ${where}: ${err && err.message ? err.message : err}`, { to: 'debug' })
  return value
}

// The mod's own command.run skips its own hooks, so the press marks the session itself.
async function runSkill($, args) {
  await $.command.run({ command: skillName(), args })
  await onMemorizeCommand($, { args })
}

async function onMemorizeCommand($, e) {
  await ensure($)
  if (!watched()) return
  await markMemorized($, await load($), /^\s*queue\b/.test(String(e.args ?? '')))
}

// ---------- hooks ----------

export const register = (on) => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'memorize-queue', description: 'Memory Guard: show or clear the sessions waiting for /memorize', argumentHint: '[clear]' })
    await $.command.register({ name: 'memory-guard', description: 'Memory Guard: turn it on or off in this project, or show its status', argumentHint: 'on|off|status' })
    return result
  })

  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    return onSessionStart($, e, result).catch((err) => logged($, 'session start', err, result))
  })

  on('prompt.submit', async ($, e, next) => {
    await onPrompt($, e).catch((err) => logged($, 'prompt', err))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran?.deny !== undefined || ran?.isError === true) return ran
    await onTool($, e).catch((err) => logged($, 'tool call', err))
    return ran
  })

  // A skill run as a command, typed or pressed, may raise no prompt.submit or Skill call.
  on('command.run', async ($, e, next) => {
    if (isMemorizeName(e.command)) await onMemorizeCommand($, e).catch((err) => logged($, 'command', err))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) return next(e)
    await ensure($)
    if (!watched()) return next(e)
    const s = await load($)
    s.turns += 1
    if (!s.memorized && !s.nudged && !s.dismissed && score(s) >= cfg.threshold) {
      s.nudged = true
      const what = s.signals.map(label).join(', ') || 'a long session'
      $.ui.toast(`This session has ${what} - run /${skillName()} before you close.`)
      if (cfg.ui.suggest) void Promise.resolve($.prompt.suggest({ text: `/${skillName()}` })).catch(() => {})
      $.ui.invalidate('ui.render')
    }
    await save($, s)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    const k = `session:${e.sessionId}`
    const s = await $.store.get(k)
    if (s && s.important && !s.memorized && !s.dismissed && s.project) {
      const queue = (await readQueue($, s.project)).filter((q) => q.sessionId !== e.sessionId)
      queue.push({ sessionId: e.sessionId, startedAt: s.startedAt, topic: s.topic, signals: s.signals, transcript: s.transcript })
      await $.store.set(`queue:${s.project}`, queue.slice(-QUEUE_MAX))
    }
    await $.store.delete(k)
    return next(e)
  })

  on('command.run', { command: 'memorize-queue' }, async ($, e) => {
    await ensure($)
    if (String(e.args ?? '').trim() === 'clear') {
      await clearQueue($)
      $.ui.invalidate('ui.render')
      return { text: 'memory-guard: queue cleared.' }
    }
    return { text: await queueText($) }
  })

  on('command.run', { command: 'memory-guard' }, async ($, e) => {
    await ensure($)
    const arg = String(e.args ?? '').trim().toLowerCase()
    if (arg === 'off' || arg === 'on') {
      off = arg === 'off'
      await $.store.set(`off:${project}`, off)
      if (off) {
        const s = await load($)
        await $.store.delete(`session:${s.id}`)
        cur = null
      }
      $.ui.invalidate('ui.render')
      return { text: `memory-guard: ${off ? 'off' : 'on'} in this project.` }
    }
    return { text: await statusText($) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props && e.props.hasSurvey) return below
    await ensure($)
    if (!watched() || !cfg.ui.band) return below
    const el = $.ui.resolve(e)
    const mine = drawBand($, el)
    if (!mine) return below
    return el.Box({ flexDirection: 'column', children: below ? [mine, below] : [mine] })
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    await ensure($)
    if (!watched() || !cfg.ui.hint || queueCount === 0) return next(e)
    const tail = `· ${queueCount} unmemorized`
    const props = e.props || {}
    return next({ ...e, props: { ...props, tail: props.tail ? `${props.tail} ${tail}` : tail } })
  })
}

// Says once per project when a likely knowledge base sits here unconfigured.
async function kbHint($) {
  if (cfg.kb || (await $.store.get(`kbhint:${project}`))) return
  let found = ''
  if ((await $.fs.exists(`${cwd}/wiki/log.md`)) || (await $.fs.exists(`${cwd}/wiki/index.md`))) found = 'a wiki in wiki/'
  else if (await $.fs.exists(`${cwd}/.obsidian`)) found = 'an Obsidian vault here'
  if (!found) return
  await $.store.set(`kbhint:${project}`, true)
  $.ui.toast(`memory-guard: found ${found}. Set "kb" in .claude/memory-guard.json so /memorize files into it.`, { timeoutMs: 8000 })
}

async function onSessionStart($, e, result) {
  await ensure($)
  if (e.transcript_path) memDir = n(e.transcript_path).replace(/\/[^/]*$/, '') + '/memory'
  if (!watched()) return result

  const s = await load($)
  if (e.transcript_path && !s.transcript) {
    s.transcript = n(e.transcript_path)
    await save($, s)
  }
  await kbHint($)

  const queue = (await readQueue($, project)).filter((q) => q.sessionId !== s.id)
  queueCount = queue.length
  if (queue.length === 0) return result
  startQueue = queue
  $.ui.invalidate('ui.render')

  const lines = queue.map((q) =>
    `- ${q.startedAt.slice(0, 10)} "${q.topic || 'untitled'}" (${q.signals.map(label).join(', ')}) - ${q.transcript ? `transcript ${q.transcript}` : `session ${q.sessionId}`}`)
  const note = [
    `memory-guard: ${queue.length} earlier session(s) in this project ended without /memorize:`,
    ...lines,
    `Offer the user to run /${skillName()} queue, which files what those sessions learned from their transcripts. The queue clears when it runs.`,
  ].join('\n')
  $.ui.toast(`${queue.length} session(s) here not memorized - "Catch up" above the prompt, or ask Claude.`)
  return { ...result, additionalContext: [...(result?.additionalContext ?? []), note] }
}

async function onPrompt($, e) {
  await ensure($)
  if (!watched()) return
  const s = await load($)
  const text = String(e.text ?? '').trim()
  const typed = text.match(/^\/([\w:.-]+)\s*(.*)$/s)
  const command = e.command ? e.command.command : typed && typed[1]
  const args = e.command ? e.command.args : typed ? typed[2] : ''
  if (!s.topic && text && !command) s.topic = text.replace(/\s+/g, ' ').slice(0, 80)
  if (command && isMemorizeName(command)) return markMemorized($, s, /^\s*queue\b/.test(String(args ?? '')))
  if (!command && cfg.signals.decision && DECISION.test(text) && !s.signals.includes('decision')) s.signals.push('decision')
  await save($, s)
}

async function onTool($, e) {
  await ensure($)
  if (!watched()) return
  const tool = String(e.tool)
  const hits = signalsFor(tool, e)
  const memorized = memorizeCall(tool, e)
  if (hits.length === 0 && memorized === undefined) return

  const s = await load($)
  s.signals = [...new Set([...s.signals, ...hits])]
  if (memorized !== undefined) await markMemorized($, s, memorized)
  else await save($, s)
}
