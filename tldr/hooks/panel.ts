// One row above the prompt that mods can share (TL;DR, and Smart PreCompact's own row beneath it).
// Shared file: every mod that draws this row carries the same copy.
//
// Hooks on the row above the prompt nest: each one gets the drawing of the hooks beneath it from
// next(e), as plain data ({ type, props, children }), and returns the whole drawing. Which mod is
// outer depends on the order the skills folder lists them, so this works in any order:
// - on the desktop, Smart PreCompact's row (key 'spc-band' or 'spc-receipt') takes the buttons when
//   it has room, and a shared row an inner mod drew before it is folded into it;
// - otherwise the shared row (key 'mods-row') takes them, at its end, along with any of the
//   collection's buttons an inner mod had put in Smart PreCompact's row, so they never split;
// - with no row to join, `seat` hands back what the mod's own shared row must also hold.

import type { RenderChildren } from 'claude-code'

type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }

export const ROW_KEY = 'mods-row'
const HOST_KEYS = ['spc-band', 'spc-receipt']

// CSS pixels per band column on the desktop, and a native button's width: about 7.2px a character,
// 12px of padding and the one-column gap before it (measured in the Code tab, 6.10.26).
export const COLUMN_PX = 7.9
export const buttonPx = (label: string) => label.length * 7.2 + 12 + COLUMN_PX

// The hairline between this collection's buttons and Smart PreCompact's own; told apart by its empty alt.
export const DIVIDER = '<svg xmlns="http://www.w3.org/2000/svg" width="9" height="16" viewBox="0 0 9 16"><rect x="4" y="1" width="1" height="14" rx=".5" fill="rgba(60,55,45,.18)"/></svg>'
export const DIVIDER_PX = 9 + COLUMN_PX

const keyOf = (node: unknown) => {
  const key = (node as Node | null)?.props?.key
  return typeof key === 'string' ? key : null
}
const isButton = (node: unknown) => (node as Node | null)?.type === 'Button'
const isSvg = (node: unknown) => (node as Node | null)?.type === 'Svg'
const isDivider = (node: unknown) => isSvg(node) && (node as Node).props?.alt === ''

/** The first node, depth first, that `pick` chooses. */
const find = (node: unknown, pick: (n: Node) => boolean): Node | null => {
  if (node === null || typeof node !== 'object') return null
  const n = node as Node
  if (pick(n)) return n
  for (const child of n.children ?? []) {
    const found = find(child, pick)
    if (found) return found
  }
  return null
}

/** The tree with `target` replaced by `swap(target)` (or dropped when it returns null), copied along the path. */
const replace = (node: unknown, target: Node, swap: (n: Node) => unknown): unknown => {
  if (node === target) return swap(target)
  if (node === null || typeof node !== 'object') return node
  const n = node as Node
  if (!n.children) return node
  let changed = false
  const children: unknown[] = []
  for (const child of n.children) {
    const next = replace(child, target, swap)
    if (next !== child) changed = true
    if (next !== null) children.push(next)
  }
  return changed ? { ...n, children } : node
}

/** What a row's images and buttons take on the desktop, in CSS pixels. */
export const rowPx = (nodes: readonly unknown[]) =>
  nodes.reduce<number>((sum, child) => {
    const c = child as Node | null
    if (isSvg(c) && typeof c?.props?.width === 'number') return sum + c.props.width + COLUMN_PX
    if (isButton(c) && typeof c?.props?.label === 'string') return sum + buttonPx(c.props.label)
    return sum
  }, 0)

export type SeatOptions = {
  /** What `items` take on the desktop, in CSS pixels. */
  px: number
  /** The band's width in columns (e.props.bodyColumns). */
  columns: number
  /** Smart PreCompact's row is joined on the desktop only: a terminal row has no room to spare. */
  isDesktop: boolean
  /** The hairline, drawn by the caller's own Svg; null where there is none. */
  divider: unknown
}

/**
 * Seated: `tree`, the drawing beneath with `items` in the shared row or in Smart PreCompact's.
 * Not seated: the mod draws the shared row (key ROW_KEY) above `beneath`, holding `carry` (buttons
 * of the collection taken out of Smart PreCompact's row) before its own items.
 */
export type Seat<T> = { tree: T } | { beneath: T; carry: RenderChildren[] }

/** The collection's images and buttons in Smart PreCompact's row: after its spacer, up to the hairline. */
const guestsOf = (kids: readonly unknown[]) => {
  const divider = kids.findIndex(isDivider)
  if (divider === -1) return { from: -1, to: -1 }
  const spacer = kids.findIndex(c => (c as Node | null)?.type === 'Box' && (c as Node).props?.flexGrow !== undefined)
  return { from: spacer !== -1 && spacer < divider ? spacer + 1 : 0, to: divider }
}

export const seat = <T>(beneath: T, items: readonly unknown[], o: SeatOptions): Seat<T> => {
  const row = find(beneath, n => keyOf(n) === ROW_KEY)
  const host = o.isDesktop ? find(beneath, n => HOST_KEYS.includes(keyOf(n) ?? '')) : null
  let tree: unknown = beneath
  let carry: unknown[] = []
  if (host) {
    const kids = host.children ?? []
    // A shared row an inner mod drew under Smart PreCompact's comes along: its images and buttons.
    const moving = row ? (row.children ?? []).filter(c => isButton(c) || isSvg(c)) : []
    const hasDivider = kids.some(isDivider)
    const need = o.px + rowPx(moving) + (hasDivider || o.divider === null ? 0 : DIVIDER_PX)
    const columns = Number.isFinite(o.columns) && o.columns > 0 ? o.columns : 100
    if (rowPx(kids) + need <= columns * COLUMN_PX - 16) {
      const without = row ? replace(beneath, row, () => null) : beneath
      // After the buttons already seated there, before Smart PreCompact's own.
      const divider = kids.findIndex(isDivider)
      const firstButton = kids.findIndex(isButton)
      const at = divider !== -1 ? divider : firstButton !== -1 ? firstButton : kids.length
      const group = [...moving, ...items, ...(hasDivider || o.divider === null ? [] : [o.divider])]
      return { tree: replace(without, host, h => ({ ...h, children: [...kids.slice(0, at), ...group, ...kids.slice(at)] })) as T }
    }
    // No room for all of them: the ones already there come out, with the hairline, to the shared row.
    const { from, to } = guestsOf(kids)
    if (from !== -1) {
      carry = kids.slice(from, to)
      tree = replace(beneath, host, h => ({ ...h, children: [...kids.slice(0, from), ...kids.slice(to + 1)] }))
    }
  }
  if (row) return { tree: replace(tree, row, r => ({ ...r, children: [...(r.children ?? []), ...carry, ...items] })) as T }
  return { beneath: tree as T, carry: carry as RenderChildren[] }
}
