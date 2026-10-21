import { expect, mock, test } from 'claude-code/testing'

const HOME = 'C:/Users/Test'
const CWD = 'C:/proj'
const TRANSCRIPTS = `${HOME}/.claude/projects/C--proj`

const files = new Map<string, string>()
const store = new Map<string, unknown>()

function world(on: any, ids = { current: 's1', cwd: CWD }, toasts: string[] = [], runs: string[] = []) {
  files.clear()
  store.clear()
  const n = (p: string) => String(p).replace(/\\/g, '/')
  mock.env(on, { USERPROFILE: HOME })
  on('store.get', (_$: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_$: any, e: any) => { store.set(e.key, e.value); return { value: undefined } })
  on('store.delete', (_$: any, e: any) => { store.delete(e.key); return { value: undefined } })
  on('session.id', () => ({ value: ids.current }))
  on('session.cwd', () => ({ value: ids.cwd }))
  on('session.start', (_$: any, e: any) => e)
  on('session.end', (_$: any, e: any) => ({ sessionId: e.sessionId }))
  on('classic.SessionStart', () => ({}))
  on('command.register', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_$: any, e: any) => e)
  on('command.run', (_$: any, e: any) => { runs.push(`/${e.command} ${e.args}`.trim()); return { text: '' } })
  on('prompt.suggest', () => ({ isShown: true }))
  on('ui.toast', (_$: any, e: any) => { toasts.push(e.text); return { value: undefined } })
  on('ui.log', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('fs.read', (_$: any, e: any) => ({ value: files.get(n(e.path)) ?? '' }))
  on('fs.exists', (_$: any, e: any) => ({ value: files.has(n(e.path)) }))
  on('tool.call', () => ({ result: 'ok' }))
  on('ui.render', (_$: any, e: any) => { if (e.component === 'PromptHint') hint.tail = e.props.tail; return $resolveBox(_$, e) })
}
const hint: { tail?: string } = {}
const $resolveBox = ($: any, e: any) => $.ui.resolve(e).Box({ children: [] })

let seq = 0
const call = ($: any, tool: string, input: any = {}) => $.tool.call({ tool, tool_use_id: `t${++seq}`, ...input })
const turn = ($: any) => $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: `u${++seq}`, reason: 'end_turn' })
const end = ($: any, id = 's1') => $.session.end({ reason: 'prompt_input_exit', sessionId: id, resume: {} })
const say = ($: any, text: string) => $.prompt.submit({ text })
async function queueText($: any) {
  const r: any = await $.command.run({ command: 'memorize-queue', args: '', origin: { kind: 'user' }, presentation: {} })
  return String(r.text)
}

test('an output file and an MCP write make a session important; it is queued at the end', async ($: any, on: any) => {
  world(on)
  await call($, 'Write', { file_path: 'C:\\proj\\docs\\plan.md', content: 'x' })
  await call($, 'mcp__tracker__create_issue', { title: 'x' })
  await end($)
  const out = await queueText($)
  expect(out).toContain('Waiting for /memorize:')
  expect(out).toContain('an output file, an MCP write')
})

test('reads and light sessions are not queued', async ($: any, on: any) => {
  world(on)
  await call($, 'Read', { file_path: 'C:/proj/src/a.ts' })
  await call($, 'mcp__tracker__get_issue', { id: '1' })
  await call($, 'Write', { file_path: 'C:/proj/src/a.ts', content: 'x' })
  await end($)
  expect(await queueText($)).toContain('Queue is empty.')
})

test('a transcript read, a decision, a commit and an accepted plan each count', async ($: any, on: any) => {
  world(on)
  await call($, 'mcp__meetings__get_meeting_transcript', { id: 'm' })
  await say($, "Let's go with the second option")
  await call($, 'Bash', { command: 'git commit -m "x"' })
  await call($, 'ExitPlanMode', {})
  const out = await queueText($)
  expect(out).toContain('score 4 of 2')
  expect(out).toContain('a meeting transcript, a decision, a commit, an accepted plan')
})

test('a long session adds a point', async ($: any, on: any) => {
  world(on)
  await call($, 'Bash', { command: 'git commit -m "x"' })
  for (let i = 0; i < 10; i++) await turn($)
  await end($)
  expect(await queueText($)).toContain('a commit')
})

const memorizeWays: Array<[string, ($: any) => Promise<unknown>]> = [
  ['typing /memorize', ($: any) => say($, '/memorize')],
  ['the bundled skill', ($: any) => call($, 'Skill', { skill: 'memory-guard:memorize' })],
  ['an auto-memory write', ($: any) => call($, 'Write', { file_path: `${TRANSCRIPTS}/memory/fact.md`, content: 'x' })],
]
for (const [name, memorize] of memorizeWays) {
  test(`${name} keeps a session off the queue`, async ($: any, on: any) => {
    world(on)
    await call($, 'mcp__tracker__create_issue', {})
    await call($, 'Bash', { command: 'git commit -m x' })
    await memorize($)
    await end($)
    expect(await queueText($)).toContain('Queue is empty.')
  })
}

test('/memorize-queue typed as a prompt does not count as memorizing', async ($: any, on: any) => {
  world(on)
  await call($, 'mcp__tracker__create_issue', {})
  await call($, 'Bash', { command: 'git commit -m x' })
  await say($, '/memorize-queue')
  expect(await queueText($)).toContain('memorized: no')
})

test('nudges once with a toast, a suggestion and the band', async ($: any, on: any) => {
  const toasts: string[] = []
  world(on, { current: 's1', cwd: CWD }, toasts)
  await turn($)
  await call($, 'mcp__tracker__create_issue', {})
  await call($, 'Bash', { command: 'git commit -m x' })
  await turn($)
  await turn($)
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('an MCP write, a commit')
  expect(toasts[0]).toContain('/memory-guard:memorize')
  const ui = await $.ui.mount(BAND('desktop'))
  expect(await ui.find({ key: 'memorize' })).toBeDefined()
  await ui.press({ key: 'dismiss' })
  await ui.unmount()
  await end($)
  expect(await queueText($)).toContain('Queue is empty.')
})

test('"Memorize now" submits the configured skill', async ($: any, on: any) => {
  const runs: string[] = []
  world(on, { current: 's1', cwd: CWD }, [], runs)
  files.set(`${CWD}/.claude/memory-guard.json`, JSON.stringify({ skill: 'memorize' }))
  await call($, 'mcp__tracker__create_issue', {})
  await call($, 'Bash', { command: 'git commit -m x' })
  await turn($)
  const ui = await $.ui.mount(BAND('terminal'))
  await ui.press({ key: 'memorize' })
  await ui.unmount()
  expect(runs).toContain('/memorize')
  await end($)
  expect(await queueText($)).toContain('Queue is empty.')
})

test('the queue is per project and handed to the next session there', async ($: any, on: any) => {
  const ids = { current: 'old', cwd: CWD }
  world(on, ids)
  await call($, 'mcp__tracker__create_issue', {})
  await call($, 'Bash', { command: 'git commit -m x' })
  await end($, 'old')

  ids.current = 'other'
  ids.cwd = 'C:/elsewhere'
  const elsewhere: any = await $.classic.SessionStart({ source: 'startup' })
  expect(elsewhere.additionalContext ?? []).toHaveLength(0)

  ids.current = 'new'
  ids.cwd = CWD
  const r: any = await $.classic.SessionStart({ source: 'startup', transcript_path: `${TRANSCRIPTS}/new.jsonl` })
  expect((r.additionalContext ?? []).join('\n')).toContain('1 earlier session(s) in this project ended without /memorize')
})

test('a plain /memorize leaves the queue; /memorize queue clears it', async ($: any, on: any) => {
  const ids = { current: 'old', cwd: CWD }
  world(on, ids)
  await call($, 'mcp__tracker__create_issue', {})
  await call($, 'Bash', { command: 'git commit -m x' })
  await end($, 'old')
  ids.current = 'new'
  await $.classic.SessionStart({ source: 'startup' })
  await say($, '/memorize')
  expect(await queueText($)).toContain('Waiting for /memorize:')
  await say($, '/memorize queue')
  expect(await queueText($)).toContain('Queue is empty.')
})

test('config: project overrides user, extraSignals count, kb log write marks memorized', async ($: any, on: any) => {
  world(on)
  files.set(`${HOME}/.claude/memory-guard.json`, JSON.stringify({ threshold: 5 }))
  files.set(`${CWD}/.claude/memory-guard.json`, JSON.stringify({
    threshold: 1,
    kb: { path: 'wiki', log: 'wiki/log.md' },
    extraSignals: [{ name: 'Chat', bash: 'send-chat' }, { name: 'bad', tool: '(' }],
  }))
  await call($, 'Bash', { command: 'py send-chat.py hello' })
  let out = await queueText($)
  expect(out).toContain('score 1 of 1 (Chat)')
  await call($, 'Edit', { file_path: 'C:\\proj\\wiki\\log.md', old_string: 'a', new_string: 'b' })
  out = await queueText($)
  expect(out).toContain('memorized: yes')
})

test('/memory-guard off stops watching this project', async ($: any, on: any) => {
  world(on)
  await $.command.run({ command: 'memory-guard', args: 'off', origin: { kind: 'user' }, presentation: {} })
  await call($, 'mcp__tracker__create_issue', {})
  await call($, 'Bash', { command: 'git commit -m x' })
  await end($)
  const r: any = await $.command.run({ command: 'memory-guard', args: 'status', origin: { kind: 'user' }, presentation: {} })
  expect(String(r.text)).toContain('memory-guard is off')
  expect(store.get('queue:c:/proj') ?? []).toHaveLength(0)
})

test('points out an unconfigured wiki once', async ($: any, on: any) => {
  const toasts: string[] = []
  const ids = { current: 's1', cwd: CWD }
  world(on, ids, toasts)
  files.set(`${CWD}/wiki/log.md`, '# log')
  await $.classic.SessionStart({ source: 'startup' })
  ids.current = 's2'
  await $.classic.SessionStart({ source: 'startup' })
  expect(toasts.filter(t => t.includes('found a wiki in wiki/'))).toHaveLength(1)
})

test('the hint line counts unmemorized sessions', async ($: any, on: any) => {
  const ids = { current: 'old', cwd: CWD }
  world(on, ids)
  await call($, 'mcp__tracker__create_issue', {})
  await call($, 'Bash', { command: 'git commit -m x' })
  await end($, 'old')
  ids.current = 'new'
  await $.classic.SessionStart({ source: 'startup' })
  await $.ui.render({ plugin: 'memory-guard', surface: 'terminal', component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '? for shortcuts' } })
  expect(hint.tail).toBe('· 1 unmemorized')
})

const BAND = (surface: string) => ({
  plugin: 'memory-guard', surface, component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
})

test('"Catch up" runs the skill in queue mode and clears the queue', async ($: any, on: any) => {
  const runs: string[] = []
  const ids = { current: 'old', cwd: CWD }
  world(on, ids, [], runs)
  await call($, 'mcp__tracker__create_issue', {})
  await call($, 'Bash', { command: 'git commit -m x' })
  await end($, 'old')
  ids.current = 'new'
  await $.classic.SessionStart({ source: 'startup' })
  const ui = await $.ui.mount(BAND('desktop'))
  await ui.press({ key: 'catchup' })
  await ui.unmount()
  expect(runs).toContain('/memory-guard:memorize queue')
  expect(await queueText($)).toContain('Queue is empty.')
})
