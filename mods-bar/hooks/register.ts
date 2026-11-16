// mods-bar: owns the one shared row above the prompt. Mods that carry bar.ts (copy-chat, tldr,
// lean-explore, memory-guard) draw their parts into this plugin's row; their own separate rows
// are hidden once this row is there.
import type { Register } from 'claude-code'

const JOINED = ['copy-chat', 'tldr', 'lean-explore']
// Joined on desktop only: in the terminal memory-guard keeps its own rows (nudge, catch-up).
const JOINED_ON_DESKTOP = ['memory-guard']

export const register: Register = on => {
  // Hooking the band makes this plugin a row owner; the joined mods fill the row.
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => next(e))

  on('ui.render', { component: 'AbovePromptList' }, ($, e, next) => {
    const rows = e.props.rows
    const bar = rows.find(r => r.plugin === 'mods-bar')
    if (!bar) return next(e)
    const hidden = e.surface === 'desktop' ? [...JOINED, ...JOINED_ON_DESKTOP] : JOINED
    return next({ ...e, props: { ...e.props, rows: rows.filter(r => !hidden.includes(r.plugin)) } })
  })
}
