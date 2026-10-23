import { expect, mock, test } from 'claude-code/testing'
import { AGENT } from './register.mjs'

const LIVE = 'C:/Users/me/.claude/agents/Explore.md'
const PARKED = `${LIVE}.off`
// the engine hands paths over with backslashes
const n = (p: string) => String(p).split('\\').join('/')

function world(on: any, files: Map<string, string>, os = 'Windows_NT', tldrBeneath = false) {
  const seen = { argv: [] as string[][], toasts: [] as string[] }
  mock.store(on)
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'USERPROFILE' ? 'C:\\Users\\me' : e.name === 'OS' ? os : undefined }))
  on('fs.exists', (_$: any, e: any) => ({ value: files.has(n(e.path)) }))
  on('fs.read', (_$: any, e: any) => ({ value: files.get(n(e.path)) ?? '' }))
  on('fs.write', (_$: any, e: any) => { files.set(n(e.path), e.text); return { value: undefined } })
  on('process.run', (_$: any, e: any) => {
    const argv = [...e.argv]
    seen.argv.push(argv)
    const [from, to] = argv.slice(-2).map(n)
    if (argv.includes('move') || argv[0] === 'mv') { files.set(to, files.get(from) ?? ''); files.delete(from) }
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('session.start', (_$: any, e: any) => e)
  on('command.register', () => ({ value: undefined }))
  on('command.run', () => ({ text: '' }))
  on('ui.toast', (_$: any, e: any) => { seen.toasts.push(JSON.stringify(e)); return { value: undefined } })
  on('ui.invalidate', () => ({ value: undefined }))
  // the engine's own footer: one Text per label
  on('ui.render', ($: any, e: any) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    // TL;DR drawn beneath: its shared row, a spacer and its button
    if (tldrBeneath && e.component === 'AbovePrompt') return Box({ children: [Box({ key: 'mods-row', flexDirection: 'row', children: [Box({ flexGrow: 1 }), Button({ key: 'tldr-off', label: 'No TL;DR', onPress: () => {} })] })] })
    return Box({ children: (e.props.modes ?? []).map((m: string) => Text({ children: m })) })
  })
  on("agent.spawn", (_$: any, e: any) => ({ model: e.model ?? e.parentModel, agentId: `a-${e.subagentType}` }))
  return seen
}

const start = ($: any) => $.session.start({ cwd: 'C:\\work', source: 'startup' })
const run = async ($: any, args: string) => String((await $.command.run({ command: 'lean-explore', args })).text)

test('first session installs the agent and says so', async ($: any, on: any) => {
  const files = new Map<string, string>()
  const seen = world(on, files)
  await start($)
  expect(files.get(LIVE)).toBe(AGENT)
  expect(seen.toasts.join()).toContain('installed')
})

test('a session refreshes our own outdated file, 1.1 marker included, but never a custom one', async ($: any, on: any) => {
  const ours = new Map([[LIVE, '---\nname: Explore\n# Written by the lean-explore mod. /explore-haiku off parks it.\nmodel: haiku\n---\nold']])
  world(on, ours)
  await start($)
  expect(ours.get(LIVE)).toBe(AGENT)
})

test('a custom Explore.md is left alone, by the session start and by the toggle', async ($: any, on: any) => {
  const files = new Map([[LIVE, '---\nname: Explore\nmodel: sonnet\n---\nmine']])
  world(on, files)
  await start($)
  expect(files.get(LIVE)).toContain('mine')
  expect(await run($, 'status')).toContain('custom')
  expect(await run($, 'off')).toContain('left alone')
  expect(files.has(PARKED)).toBe(false)
})

test('off parks the file, a session does not reinstall it, on brings it back', async ($: any, on: any) => {
  const files = new Map([[LIVE, AGENT]])
  const seen = world(on, files)
  expect(await run($, '')).toContain('Lean Explore agent: on')
  expect(await run($, 'off')).toContain('now off')
  expect(seen.argv[0].slice(0, 4)).toEqual(['cmd', '/c', 'move', '/Y'])
  expect(files.has(LIVE)).toBe(false)
  await start($)
  expect(files.has(LIVE)).toBe(false)
  expect(await run($, 'off')).toContain('already off')
  expect(await run($, 'on')).toContain('now on')
  expect(files.get(LIVE)).toBe(AGENT)
})

test('macOS and Linux use mv', async ($: any, on: any) => {
  const files = new Map([[LIVE, AGENT]])
  const seen = world(on, files, '')
  await run($, 'off')
  expect(seen.argv[0][0]).toBe('mv')
  expect(files.has(PARKED)).toBe(true)
})

const footer = async ($: any, surface: string) => {
  const ui = await $.ui.mount({ plugin: 'lean-explore', surface, component: 'SessionMode', props: { modes: ['auto'] } })
  const texts = [String((await ui.find({ type: 'Text', text: /Explore/ }))?.text ?? ''), String((await ui.find({ type: 'Text', text: /auto/ }))?.text ?? '')]
  await ui.unmount()
  return texts.join(' | ')
}
const BAND = { component: 'AbovePrompt' as const, props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} } }
const band = ($: any, surface: string) => $.ui.mount({ plugin: 'lean-explore', surface, ...BAND })
const textOf = async (ui: any, text: RegExp) => String((await ui.find({ type: 'Text', text }))?.text ?? '')
const explore = ($: any, subagentType = 'Explore') => $.agent.spawn({ tool_use_id: 't', prompt: 'find x', description: 'search', subagentType, provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5' })

test('terminal footer: Haiku when loaded, built-in for a custom file, a pending toggle, and a first install', async ($: any, on: any) => {
  const files = new Map([[LIVE, AGENT]])
  world(on, files)
  await start($)
  expect(await footer($, 'terminal')).toBe('Explore: Haiku | auto')
  await run($, 'off')
  expect(await footer($, 'terminal')).toContain('Explore: Haiku (built-in next session)')
  files.clear(); files.set(LIVE, '---\nname: Explore\nmodel: sonnet\n---\nmine')
  await start($)
  expect(await footer($, 'terminal')).toContain('Explore: built-in')
  files.clear()
  await start($)
  expect(await footer($, 'terminal')).toContain('Explore: built-in (Haiku next session)')
})

test('desktop: the footer is left to the app, the chip says it instead', async ($: any, on: any) => {
  world(on, new Map([[LIVE, AGENT]]))
  await start($)
  expect(await footer($, 'desktop')).toBe(' | auto')
})

test('desktop chip: green, counts Explore runs only, hover card offers Turn off', async ($: any, on: any) => {
  const files = new Map([[LIVE, AGENT]])
  world(on, files)
  await start($)
  await explore($); await explore($); await explore($, 'general-purpose')
  const ui = await band($, 'desktop')
  expect(await textOf(ui, /Explore: Haiku/)).toContain('Explore: Haiku · 2 searches')
  expect(await textOf(ui, /3x fewer/)).toContain('estimate')
  await ui.press({ key: 'lean-explore-off' })
  expect(files.has(PARKED)).toBe(true)
  await ui.unmount()
  const after = await band($, 'desktop')
  expect(await textOf(after, /Explore:/)).toContain('built-in next session')
  await after.unmount()
})

test('desktop chip: amber when off, with Turn on on the chip itself', async ($: any, on: any) => {
  const files = new Map([[PARKED, AGENT]])
  world(on, files)
  await start($)
  const ui = await band($, 'desktop')
  expect(await textOf(ui, /Explore:/)).toContain('Explore: built-in')
  await ui.press({ key: 'lean-explore-on' })
  expect(files.get(LIVE)).toBe(AGENT)
  await ui.unmount()
})

test('desktop chip: a custom file gets no buttons; the terminal band gets no chip', async ($: any, on: any) => {
  world(on, new Map([[LIVE, '---\nname: Explore\nmodel: sonnet\n---\nmine']]))
  await start($)
  const ui = await band($, 'desktop')
  expect(await textOf(ui, /own/)).toContain('Explore.md is in use')
  expect(await ui.find({ type: 'Button' })).toBeFalsy()
  await ui.unmount()
  const term = await band($, 'terminal')
  expect(await textOf(term, /Explore/)).toBe('')
  await term.unmount()
})

test('desktop chip joins the shared row TL;DR drew beneath, before its button', async ($: any, on: any) => {
  world(on, new Map([[LIVE, AGENT]]), 'Windows_NT', true)
  await start($)
  const ui = await band($, 'desktop')
  const row = await ui.find({ key: 'mods-row' })
  expect(String(row?.text ?? '')).toContain('Explore: Haiku')
  expect(await ui.find({ key: 'tldr-off' })).toBeTruthy()
  await ui.unmount()
})

test('desktop chip draws the shared row itself when no other mod has, so an outer mod can join it', async ($: any, on: any) => {
  world(on, new Map([[LIVE, AGENT]]))
  await start($)
  const ui = await band($, 'desktop')
  expect(String((await ui.find({ key: 'mods-row' }))?.text ?? '')).toContain('Explore: Haiku')
  await ui.unmount()
})

import { addRun, emptyLedger, fromScan, summarize } from './stats.mjs'

test('ledger: Haiku runs are delegated tokens, other models are only counted', () => {
  const l = emptyLedger()
  addRun(l, { model: 'claude-haiku-4-5', input: 10, cacheRead: 900, cacheWrite: 50, output: 40, readChars: 8000, reportChars: 400, tools: { Read: 3, Grep: 2, Bash: 1 } })
  addRun(l, { model: 'claude-haiku-4-5', input: 0, cacheRead: 100, cacheWrite: 0, output: 10, readChars: 0, reportChars: 0, tools: { Glob: 1 } })
  addRun(l, { model: 'claude-sonnet-5', input: 5, cacheRead: 5, cacheWrite: 5, output: 5, readChars: 100, reportChars: 10, tools: { Read: 9 } })
  const s = summarize(l)
  expect(s.runs).toBe(2)
  expect(s.otherRuns).toBe(1)
  expect(s.delegated).toBe(1110)
  expect(s.fresh).toBe(110)
  expect(s.cached).toBe(1000)
  expect(s.reads).toBe(6)
  expect(s.keptOutOfChat).toBe(1900)
})

test('ledger: a scan replaces what was there', () => {
  const l = fromScan({ byModel: { 'claude-haiku-4-5': { runs: 4, input: 1, cacheRead: 2, cacheWrite: 3, output: 4, readChars: 40, reportChars: 0, tools: { Read: 2 } } } })
  expect(l.scanned).toBe(true)
  expect(summarize(l).delegated).toBe(10)
})
