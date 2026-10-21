import { expect, mock, test } from 'claude-code/testing'

const HOME = 'C:/Users/Test'
const CWD = 'C:/proj'

const files = new Map<string, string>()
const store = new Map<string, unknown>()

function world(on: any) {
  files.clear()
  store.clear()
  const n = (p: string) => String(p).replace(/\\/g, '/')
  mock.clock(on, { now: 10_000_000 })
  on('store.get', (_$: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_$: any, e: any) => { store.set(e.key, e.value); return { value: undefined } })
  on('turn.complete', () => ({ text: '' }))
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
  on('prompt.submit', (_$: any, e: any) => e)
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  on('fs.write', (_$: any, e: any) => { files.set(n(e.path), e.text); return { value: undefined } })
  on('fs.read', (_$: any, e: any) => ({ value: files.get(n(e.path)) ?? '' }))
  on('fs.exists', (_$: any, e: any) => ({ value: files.has(n(e.path)) }))
  on('fs.list', () => ({ value: [] }))
  on('tool.call', () => ({ result: 'ok' }))
}
const start = ($: any) => $.session.start({ cwd: CWD, source: 'startup' })

test('loads and /goals answers with a status', async ($: any, on: any) => {
  world(on)
  await start($)
  const r: any = await $.command.run({ command: 'goals', args: '' })
  expect(r).toBeDefined()
})

test('/goal asks Claude for a sized plan, and strict mode blocks edits until the plan exists', async ($: any, on: any) => {
  world(on)
  await start($)
  await $.command.run({ command: 'goals', args: 'strict on' })
  const r: any = await $.command.run({ command: 'goal', args: 'the CEO summary is drafted' })
  expect(JSON.stringify(r?.context ?? [])).toMatch(/plan/i)
  let reason: string | undefined
  try { reason = (await $.tool.call({ tool: 'Write', tool_use_id: 't', file_path: 'C:/proj/x.md', content: 'x' })).deny } catch (err: any) { reason = String(err?.message ?? err) }
  expect(String(reason)).toMatch(/plan/i)
})

const plan = ($: any) => $.tool.call({ tool: 'mcp__goal-meter__tasks', tool_use_id: 'p', action: 'plan', tasks: [{ title: 'one', size: 'S' }] })
const saved = async (_$: any) => JSON.parse(files.get(`${HOME}/.claude/mods-data/goal-meter/me.json`) ?? '{}')
const view = () => (store.get('settings') as any)?.view

test('/goals clear removes a running goal', async ($: any, on: any) => {
  world(on)
  await start($)
  await $.command.run({ command: 'goal', args: 'ship it' })
  await plan($)
  await $.command.run({ command: 'goals', args: 'clear' })
  const g = await saved($)
  expect(g.status).toBe('stopped')
  expect(g.dismissedAt).toBeDefined()
})

test('/goals clear also removes a goal that is already finished', async ($: any, on: any) => {
  world(on)
  await start($)
  await $.command.run({ command: 'goal', args: 'ship it' })
  await plan($)
  await $.tool.call({ tool: 'mcp__goal-meter__tasks', tool_use_id: 'd', action: 'done', id: 1 })
  await $.turn.complete({ reason: 'answer', answer: 'done', isAborted: false })
  expect((await saved($)).status).toBe('met')
  await $.command.run({ command: 'goals', args: 'clear' })
  expect((await saved($)).dismissedAt).toBeDefined()
})

test('the view setting is saved, and hide survives a new goal', async ($: any, on: any) => {
  world(on)
  await start($)
  await $.command.run({ command: 'goals', args: 'full' })
  expect(view()).toBe('full')
  await $.command.run({ command: 'goals', args: 'hide' })
  await $.command.run({ command: 'goal', args: 'another goal' })
  expect(view()).toBe('hidden')
  await $.command.run({ command: 'goals', args: 'show' })
  expect(view()).toBe('full')
})

// Desktop draws proportional text: the full band's bar and task rows don't line up
const BAND = (surface: string) => ({
  plugin: 'goal-meter', surface, component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
})

test('full view stays full in the terminal but is one line on desktop', async ($: any, on: any) => {
  world(on)
  on('ui.render', ($: any, e: any) => $.ui.resolve(e).Box({ children: [] }))
  await start($)
  await $.command.run({ command: 'goals', args: 'full' })
  await $.command.run({ command: 'goal', args: 'ship it' })
  await plan($)
  const term = await $.ui.mount(BAND('terminal'))
  expect(await term.find({ type: 'Text', text: /█|░/ })).toBeDefined()
  await term.unmount()
  const desk = await $.ui.mount(BAND('desktop'))
  expect(await desk.find({ type: 'Text', text: /◎ Goal: ship it/ })).toBeDefined()
  expect(await desk.find({ type: 'Text', text: /█|░/ })).toBeUndefined()
  await desk.unmount()
})
