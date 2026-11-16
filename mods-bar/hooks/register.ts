// mods-bar: owns the one shared row above the prompt. Mods that carry bar.ts (copy-chat, tldr)
// draw their buttons into this plugin's row; their own separate rows are hidden once this row is there.
import type { Register } from 'claude-code'

const JOINED = ['copy-chat', 'tldr', 'lean-explore']

export const register: Register = on => {
  // Hooking the band makes this plugin a row owner; the joined mods fill the row.
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => next(e))

  on('ui.render', { component: 'AbovePromptList' }, ($, e, next) => {
    const rows = e.props.rows
    const bar = rows.find(r => r.plugin === 'mods-bar')
    if (!bar) return next(e)
    return next({ ...e, props: { ...e.props, rows: rows.filter(r => !JOINED.includes(r.plugin)) } })
  })
}
