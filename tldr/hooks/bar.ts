// The mods-bar row: one row above the prompt for the parts of every mod listed below.
// Shared file: the mods-bar mod and each mod that joins its row carry the same copy.
//
// The band above the prompt is one row per plugin. Each of these mods also draws its part in the
// row of the mods-bar mod (a hook on { component: 'AbovePrompt', plugin: 'mods-bar' }), where
// the hooks nest: each gets the row the hooks beneath it drew, from next(e). `joinBar` adds this
// mod's part to that row (or starts it), and lays the whole row out again, so the order is the same
// whichever mod runs last: the status images on the left, then a spacer, then the buttons. The row
// wraps only where the window is too narrow for it.

import type { RenderChildren } from 'claude-code'

type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown[]; press?: { plugin?: unknown } }
// The surface's Box (`$.ui.resolve(e).Box`): props in, a plain-data element out, children among the props.
type BoxMaker = (props: never) => unknown

/** The host mod, whose row this is. */
export const BAR = 'mods-bar'
const BAR_KEY = 'mods-bar-row'

// Left to right. Status first (each with its own buttons beside it), then the action buttons.
const STATUS = ['cache-keeper', 'reply-cost', 'smart-precompact-mod', 'lean-explore', 'memory-guard']
const ACTIONS = ['hebrew-tools', 'tldr', 'copy-chat', 'session-closer', 'second-opinion']
const ORDER = [...STATUS, ...ACTIONS]

// Whose an element is when the engine has not marked it: by its key or its image's alt.
const ALT_OWNER: Record<string, string> = {
  'Reply cost': 'reply-cost',
  'Smart PreCompact': 'smart-precompact-mod',
  Hebrew: 'hebrew-tools',
  'Session closer': 'session-closer',
}
const KEY_OWNER: Record<string, string> = {
  'cost-words': 'reply-cost',
  'cost-hide': 'reply-cost',
  compact: 'smart-precompact-mod',
  hide: 'smart-precompact-mod',
  dismiss: 'smart-precompact-mod',
  translate: 'hebrew-tools',
  original: 'hebrew-tools',
  hebrew: 'hebrew-tools',
  direction: 'hebrew-tools',
  'lean-explore': 'lean-explore',
  'cache-keeper': 'cache-keeper',
  'memory-guard': 'memory-guard',
  'tldr-on': 'tldr',
  'tldr-off': 'tldr',
  'copy-chat': 'copy-chat',
  'close-session': 'session-closer',
  'second-opinion': 'second-opinion',
}

const ownerOf = (node: unknown): string | null => {
  const n = node as Node | null
  if (n === null || typeof n !== 'object') return null
  if (typeof n.press?.plugin === 'string') return n.press.plugin
  const key = n.props?.key
  if (typeof key === 'string' && KEY_OWNER[key]) return KEY_OWNER[key]
  const alt = n.props?.alt
  if (n.type === 'Svg' && typeof alt === 'string' && ALT_OWNER[alt]) return ALT_OWNER[alt]
  return null
}

const isSpacer = (node: unknown) => {
  const n = node as Node | null
  return n !== null && typeof n === 'object' && n.type === 'Box' && n.props?.flexGrow !== undefined
}

const find = (node: unknown): Node | null => {
  if (node === null || typeof node !== 'object') return null
  const n = node as Node
  if (n.props?.key === BAR_KEY) return n
  for (const child of n.children ?? []) {
    const found = find(child)
    if (found) return found
  }
  return null
}

/** The tree with `target` replaced by `swap`, copied along the path. */
const replace = (node: unknown, target: Node, swap: Node): unknown => {
  if (node === target) return swap
  if (node === null || typeof node !== 'object') return node
  const n = node as Node
  if (!n.children) return node
  let changed = false
  const children = n.children.map(child => {
    const next = replace(child, target, swap)
    if (next !== child) changed = true
    return next
  })
  return changed ? { ...n, children } : node
}

/**
 * The drawing beneath with `items` (this mod's part, `owner` its plugin name) in the bar row,
 * laid out in ORDER; where no mod beneath has started the row, it starts here, above `beneath`.
 * A part this mod drew there before (a hook asked twice) is replaced, never doubled.
 */
export const joinBar = <T>(beneath: T, items: readonly unknown[], o: { Box: BoxMaker; owner: string }): T => {
  const box = (props: Record<string, unknown>) => o.Box(props as never)
  const spacer = box({ flexGrow: 1 })
  const row = find(beneath)
  const others = (row?.children ?? []).filter(child => !isSpacer(child) && ownerOf(child) !== o.owner)
  const placed = [...others.map(node => ({ node, owner: ownerOf(node) })), ...items.map(node => ({ node, owner: o.owner }))]
  const rank = (owner: string | null) => (owner !== null && ORDER.includes(owner) ? ORDER.indexOf(owner) : ORDER.length)
  const sorted = placed.map((p, i) => ({ ...p, i })).sort((a, b) => rank(a.owner) - rank(b.owner) || a.i - b.i)
  const status = sorted.filter(p => p.owner !== null && STATUS.includes(p.owner)).map(p => p.node)
  const actions = sorted.filter(p => !(p.owner !== null && STATUS.includes(p.owner))).map(p => p.node)
  const children = [...status, spacer, ...actions] as RenderChildren[]
  const props = { key: BAR_KEY, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 1 }
  if (row) return replace(beneath, row, { ...row, props: { ...row.props, ...props }, children: children as unknown[] }) as T
  return box({ flexDirection: 'column', children: beneath ? [box({ ...props, children }), beneath] : [box({ ...props, children })] }) as T
}
