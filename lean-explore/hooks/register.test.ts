import { expect, mock, test } from 'claude-code/testing'
import { AGENT } from './register.mjs'

const LIVE = 'C:/Users/me/.claude/agents/Explore.md'
const PARKED = `${LIVE}.off`
// the engine hands paths over with backslashes
const n = (p: string) => String(p).split('\\').join('/')

function world(on: any, files: Map<string, string>, os = 'Windows_NT') {
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
  on('ui.render', ($: any, e: any) => { const { Box, Text } = $.ui.resolve(e); return Box({ children: (e.props.modes ?? []).map((m: string) => Text({ children: m })) }) })
  return seen
}

const start = ($: any) => $.session.start({ cwd: 'C:\\work', source: 'startup' })
const run = async ($: any, args: string) => String((await $.command.run({ command: 'explore-haiku', args })).text)

test('first session installs the agent and says so', async ($: any, on: any) => {
  const files = new Map<string, string>()
  const seen = world(on, files)
  await start($)
  expect(files.get(LIVE)).toBe(AGENT)
  expect(seen.toasts.join()).toContain('installed')
})

test('a session refreshes our own outdated file but never a custom one', async ($: any, on: any) => {
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

test('footer says Haiku on the terminal and the desktop app when the agent loaded', async ($: any, on: any) => {
  const files = new Map([[LIVE, AGENT]])
  world(on, files)
  await start($)
  for (const surface of ['terminal', 'desktop']) {
    const r = await footer($, surface)
    expect(r).toContain('Explore: Haiku')
    expect(r).toContain('auto')
  }
})

test('footer says built-in for a custom file, and flags a toggle waiting for the next session', async ($: any, on: any) => {
  const files = new Map([[LIVE, '---\nname: Explore\nmodel: sonnet\n---\nmine']])
  world(on, files)
  await start($)
  expect(await footer($, 'desktop')).toContain('Explore: built-in')
  files.clear(); files.set(LIVE, AGENT)
  await start($)
  await run($, 'off')
  expect(await footer($, 'terminal')).toContain('Explore: Haiku (built-in next session)')
})

test('first install session is still on the built-in agent', async ($: any, on: any) => {
  world(on, new Map())
  await start($)
  expect(await footer($, 'desktop')).toContain('Explore: built-in (Haiku next session)')
})
