import { expect, mock, test } from 'claude-code/testing'

const HOME = 'C:/Users/Test'
const CWD = 'C:/proj'

function world(on: any, answer = 'Cancel') {
  const files = new Map<string, string>()
  const n = (p: string) => String(p).replace(/\\/g, '/')
  const sent: any[] = []
  const compacted: any[] = []
  const clock = mock.clock(on, { now: 10_000_000 })
  mock.store(on)
  mock.env(on, { USERPROFILE: HOME })
  on('session.id', () => ({ value: 'me' }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.surface', () => ({ value: 'terminal' }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('session.start', (_$: any, e: any) => e)
  on('session.append', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('command.run', () => ({ text: '' }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.open', () => ({ value: undefined }))
  on('prompt.submit', (_$: any, e: any) => { sent.push(e); return e })
  on('session.compact', (_$: any, e: any) => { compacted.push(e); return { messages: [{ role: 'user', text: 'summary', toolUses: [] }] } })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  on('fs.write', (_$: any, e: any) => { files.set(n(e.path), e.text); return { value: undefined } })
  on('fs.read', (_$: any, e: any) => ({ value: files.get(n(e.path)) ?? '' }))
  on('fs.exists', (_$: any, e: any) => ({ value: files.has(n(e.path)) }))
  on('fs.list', () => ({ value: [] }))
  on('tool.call', (_$: any, e: any) => {
    if (e.tool !== 'AskUserQuestion') return { result: 'ok' }
    const q = e.questions[0].question
    return { result: { questions: e.questions, answers: { [q]: answer } } }
  })
  return { clock, sent, compacted }
}
const start = ($: any) => $.session.start({ cwd: CWD, source: 'startup' })

test('loads and /cache reports context, model and cache window', async ($: any, on: any) => {
  world(on)
  await start($)
  const r: any = await $.command.run({ command: 'cache', args: '' })
  expect(String(r?.text)).toContain('Cache Keeper')
})

test('/cache big 100k changes the cold-send threshold', async ($: any, on: any) => {
  world(on)
  await start($)
  const r: any = await $.command.run({ command: 'cache', args: 'big 100k' })
  expect(String(r?.text)).toMatch(/100k/)
})

// The band took over the status line: model, effort, context bar, 5h reset
const BAND = (bodyColumns: number) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 10 }, view: {} },
})
const RESET = new Date(2026, 9, 9, 11, 10).toISOString()
const measure = ($: any, tokens: number) =>
  $.session.measure({
    context: { tokens, window: 1_000_000, percent: Math.round(tokens / 10_000) },
    rateLimits: [{ kind: 'five_hour', percentUsed: 64, resetsAt: RESET }, { kind: 'seven_day', percentUsed: 58 }],
    cost: { usd: 9.27 },
    changed: ['context', 'rateLimits', 'cost'],
  })
const textOf = async (ui: any, text: RegExp) => String((await ui.find({ type: 'Text', text }))?.text ?? '')

test('band carries the status line: model, context bar from session.measure, 5h reset', async ($: any, on: any) => {
  world(on)
  on('session.measure', (_$: any, e: any) => e)
  on('ui.render', ($: any, e: any) => $.ui.resolve(e).Box({ children: [] })) // the engine's own band, empty
  await start($)
  await measure($, 312_000)
  const ui = await $.ui.mount({ plugin: 'cache-keeper', surface: 'terminal', ...BAND(200) })
  expect(await textOf(ui, /Opus/)).toBe('Opus 5.5')
  const ctx = await textOf(ui, /ctx/)
  expect(ctx).toContain('███░░░░░░░')
  expect(ctx).toContain('31% 312k/1M')
  expect(await textOf(ui, /5h/)).toContain('5h 64% (resets 11:10am) · week 58%')
  expect(await textOf(ui, /session/)).toContain('$9.27')
  await ui.unmount()
})

test('a narrow band drops the bar but keeps the numbers', async ($: any, on: any) => {
  world(on)
  on('session.measure', (_$: any, e: any) => e)
  on('ui.render', ($: any, e: any) => $.ui.resolve(e).Box({ children: [] })) // the engine's own band, empty
  await start($)
  await measure($, 312_000)
  const ui = await $.ui.mount({ plugin: 'cache-keeper', surface: 'terminal', ...BAND(80) })
  const ctx = await textOf(ui, /ctx/)
  expect(ctx).not.toContain('█')
  expect(ctx).toContain('31% 312k/1M')
  await ui.unmount()
})

test('band shows the effort the main loop asked for', async ($: any, on: any) => {
  world(on)
  on('session.measure', (_$: any, e: any) => e)
  on('ui.render', ($: any, e: any) => $.ui.resolve(e).Box({ children: [] }))
  on('turn.step', async function* (_$: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  await start($)
  const step = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'xhigh', messageCount: 1 })
  for await (const _ of step);
  await step.result
  const ui = await $.ui.mount({ plugin: 'cache-keeper', surface: 'terminal', ...BAND(200) })
  expect(await textOf(ui, /Opus/)).toBe('Opus 5.5 [xhigh]')
  await ui.unmount()
})

// Desktop: Token Optimizer's card shows the figures, so the band only alerts
const stepHook = (on: any) =>
  on('turn.step', async function* (_$: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn',
      usage: { input_tokens: 5, cache_read_input_tokens: 300_000, cache_creation_input_tokens: 0, output_tokens: 10 } }
  })
const warmUp = async ($: any) => {
  const step = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 })
  for await (const _ of step);
  await step.result
}

test('desktop band draws nothing while the cache is warm', async ($: any, on: any) => {
  const w = world(on)
  on('session.measure', (_$: any, e: any) => e)
  on('ui.render', ($: any, e: any) => $.ui.resolve(e).Box({ children: [] }))
  stepHook(on)
  await start($)
  await measure($, 312_000)
  await warmUp($)
  await w.clock.advance(60_000)
  const ui = await $.ui.mount({ plugin: 'cache-keeper', surface: 'desktop', ...BAND(200) })
  expect(await textOf(ui, /Opus|ctx|session|Cache/)).toBe('')
  await ui.unmount()
})

test('desktop band warns in one line when a big cache is cold', async ($: any, on: any) => {
  const w = world(on)
  on('session.measure', (_$: any, e: any) => e)
  on('ui.render', ($: any, e: any) => $.ui.resolve(e).Box({ children: [] }))
  stepHook(on)
  await start($)
  await measure($, 312_000)
  await warmUp($)
  await w.clock.advance(61 * 60_000)
  const ui = await $.ui.mount({ plugin: 'cache-keeper', surface: 'desktop', ...BAND(200) })
  expect(await textOf(ui, /Cache cold/)).toMatch(/next send rewrites it ≈ \$/)
  expect(await textOf(ui, /Opus|ctx/)).toBe('')
  await ui.unmount()
})

// "Compact first, then send" used to compact inside prompt.submit, which the engine
// refuses mid-submit; the error was swallowed and the message went out uncompacted.
test('compact first holds the prompt, compacts, then sends it', async ($: any, on: any) => {
  const w = world(on, 'Compact first, then send')
  on('session.measure', (_$: any, e: any) => e)
  on('turn.step', async function* (_$: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn',
      usage: { input_tokens: 5, cache_read_input_tokens: 300_000, cache_creation_input_tokens: 0, output_tokens: 10 } }
  })
  await start($)
  await measure($, 312_000)
  const step = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'xhigh', messageCount: 1 })
  for await (const _ of step);
  await step.result
  await w.clock.advance(61 * 60_000)
  const r: any = await $.prompt.submit({ text: 'hello there', origin: { kind: 'composer' } })
  expect(String(r?.drop)).toContain('compacting')
  expect(w.compacted.length).toBe(0)
  expect(w.sent.length).toBe(0)
  await w.clock.advance(100)
  expect(w.compacted.length).toBe(1)
  expect(w.sent.length).toBe(1)
  expect(w.sent[0].text).toBe('hello there')
})
