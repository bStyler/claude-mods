// TL;DR: when a reply is long, a small model picks the few paragraphs worth reading and they are
// drawn on a yellow background; a notification says the reply in one sentence, and a button above
// the prompt turns it on and off. Only the drawing changes: the transcript, and what Claude reads,
// stay as written.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, MatchedHook, Register, RenderChildren, SessionMessage } from 'claude-code'

import type { Brief } from '../types'
import { BAR, joinBar } from './bar'
import { DIVIDER, ROW_KEY, buttonPx, seat } from './panel'

const isOn = atom({ plugin: 'tldr', key: 'isOn' } as const, true)
const isBusy = atom({ plugin: 'tldr', key: 'isBusy' } as const, false)
const again = atom({ plugin: 'tldr', key: 'again' } as const, false)
const brief = atom({ plugin: 'tldr', key: 'brief' } as const, null)
const lastRead = atom({ plugin: 'tldr', key: 'lastRead' } as const, null)
const MARKED = { plugin: 'tldr', key: 'marked' } as const

// The small model: one short call per long reply, so it costs little of the person's usage.
const MODEL = 'haiku'
// A reply counts as long from this many characters of prose (about 150 words).
const LONG_CHARS = 900
// At most this many paragraphs, and this share of the reply, are highlighted.
const MAX_MARKS = 3
const MAX_SHARE = 0.3
// See-through yellow: reads as a highlighter on a light page and on a dark one.
const HIGHLIGHT = 'rgba(255, 213, 0, 0.28)'
// How much of the person's last message the model sees, to tell its language.
const SAMPLE_CHARS = 400

const SYSTEM = [
  'You help a busy person read long replies from their AI coding assistant. They skim, and miss the important part.',
  'You get one reply split into numbered paragraphs, and a sample of the last message the person wrote. Pick the paragraphs they must read, at most 3:',
  '1. the direct answer or result, 2. anything waiting on their decision or action, 3. anything that failed, is risky or was not verified.',
  'Pick fewer when fewer matter. Never pick a code block, a lone heading, or background explanation.',
  'Also write "tldr": the whole reply in one plain everyday sentence of at most 15 words, in the language the person wrote their sample in (not the language of the reply).',
  'If something waits on the person, the tldr starts with the words for "Waiting on you:" in that language.',
  'Never use an em dash or an en dash.',
  'Answer with JSON only, nothing before or after: {"tldr": "...", "marks": [2, 5]}',
].join('\n')

const MARKS_ALL = /[‎‏]/g
const FENCE = /^\s*(```|~~~)/
const REMINDERS = /<system-reminder>[\s\S]*?<\/system-reminder>/g

/** One id for a paragraph, the same before and after another mod adds direction marks to it. */
const keyOf = (text: string) => {
  const flat = text.replace(MARKS_ALL, '').replace(/\s+/g, ' ').trim()
  let hash = 5381
  for (let i = 0; i < flat.length; i += 1) hash = (Math.imul(hash, 33) + flat.charCodeAt(i)) | 0
  return `${flat.length.toString(36)}-${(hash >>> 0).toString(36)}`
}

/** The markdown cut at blank lines. A code block stays whole, blank lines and all, and closes only with
 * its own kind of fence; an indented paragraph stays with the list item it continues. */
export const paragraphs = (markdown: string) => {
  const parts: string[] = []
  let current: string[] = []
  let fence: string | null = null
  const end = () => {
    if (current.some(line => line.trim() !== '')) {
      const text = current.join('\n')
      const last = parts[parts.length - 1]
      if (/^\s{2,}\S/.test(text) && last !== undefined && !FENCE.test(last)) parts[parts.length - 1] = `${last}\n\n${text}`
      else parts.push(text)
    }
    current = []
  }
  for (const line of markdown.split('\n')) {
    const opened = FENCE.exec(line)?.[1]
    if (opened !== undefined && (fence === null || fence === opened)) fence = fence === null ? opened : null
    if (fence === null && opened === undefined && line.trim() === '') {
      end()
      continue
    }
    current.push(line)
  }
  end()
  return parts
}

/** The text without code, links and paths: what counts as prose. */
const prose = (text: string) =>
  text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(MARKS_ALL, '')

/** A paragraph worth highlighting: not code, not a lone heading, not a rule. */
const isMarkable = (part: string) => !FENCE.test(part) && !/^\s*#{1,6}\s[^\n]*$/.test(part) && !/^\s*([-*_]\s*){3,}$/.test(part)

/** What the person typed, for a prompt row; null for tool results, reminders and notifications. */
const typed = (row: SessionMessage) => {
  if (row.role !== 'user' || (row.toolResults?.length ?? 0) > 0) return null
  const text = row.text.replace(/^(\s*<system-reminder>[\s\S]*?<\/system-reminder>)+/, '').trim()
  return text !== '' && !/^<(?!pasted_content)/.test(text) && !text.startsWith('Caveat:') && !text.startsWith('[Request interrupted') ? text : null
}

/** The text blocks of the last reply (every assistant row after the last thing the person sent, a slash
 * command included), and the last message they typed, for its language. */
const lastReply = (rows: readonly SessionMessage[]) => {
  const blocks: string[] = []
  let asked: string | null = null
  let i = rows.length - 1
  for (; i >= 0; i -= 1) {
    const row = rows[i]
    if (row === undefined) continue
    if (row.role === 'user') {
      // A tool result, or a bare reminder, sits inside the reply; anything else ends it.
      if ((row.toolResults?.length ?? 0) > 0 || row.text.replace(REMINDERS, '').trim() === '') continue
      asked = typed(row)
      i -= 1
      break
    }
    const text = row.text.trim()
    if (text !== '') blocks.unshift(text)
  }
  // A command ended the reply: the language comes from the last message typed before it.
  for (; asked === null && i >= 0; i -= 1) {
    const row = rows[i]
    if (row !== undefined) asked = typed(row)
  }
  return { blocks, asked: asked ?? '' }
}

/** The person's words alone, for telling their language: no pasted text, reminders or code. */
const sampleOf = (asked: string) =>
  prose(asked.replace(/<pasted_content[\s\S]*?<\/pasted_content>/g, ' ').replace(REMINDERS, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SAMPLE_CHARS)

/** No em or en dashes in the sentence; the model can still slip one in. */
const withoutDashes = (text: string) => text.replace(/(\d)[ \t]*[–—][ \t]*(\d)/g, '$1-$2').replace(/[ \t]*[–—][ \t]*/g, ', ')

/** The model's JSON, or null when it sent something else. The shortest object first: a brace in words
 * after the JSON would otherwise swallow it. */
export const parseAnswer = (text: string): { tldr: string; marks: number[] } | null => {
  for (const pattern of [/\{[\s\S]*?\}/, /\{[\s\S]*\}/]) {
    const json = pattern.exec(text)?.[0]
    if (!json) return null
    try {
      const value = JSON.parse(json) as { tldr?: unknown; marks?: unknown }
      const tldr = typeof value.tldr === 'string' ? withoutDashes(value.tldr.trim()) : ''
      const marks = Array.isArray(value.marks) ? value.marks.filter((n): n is number => Number.isInteger(n)) : []
      return { tldr, marks }
    } catch {
      continue
    }
  }
  return null
}

/** The marks kept: markable, in range, at most MAX_MARKS, and together at most MAX_SHARE of the reply (the first one always). */
export const keepMarks = (parts: readonly string[], marks: readonly number[]) => {
  const total = parts.reduce((sum, part) => sum + prose(part).length, 0)
  const kept: number[] = []
  let used = 0
  for (const n of marks) {
    const part = parts[n - 1]
    if (part === undefined || !isMarkable(part) || kept.includes(n)) continue
    const size = prose(part).length
    if (kept.length >= MAX_MARKS || (kept.length > 0 && used + size > total * MAX_SHARE)) continue
    kept.push(n)
    used += size
  }
  return kept
}

/** Reads the last reply once: a long one goes to the model, and every paragraph of the reply gets its
 * flag set, picked or not, so a line repeated from an earlier reply is yellow only where it was picked. */
const readReply = async ($: EngineInterface) => {
  const reply = lastReply(await $.session.messages())
  const parts = reply.blocks.flatMap(paragraphs)
  const size = parts.reduce((sum, part) => sum + prose(part).length, 0)
  const replyId = keyOf(parts.join('\n\n'))
  if ((await read($, lastRead)) === replyId) return
  if (size < LONG_CHARS) {
    for (const part of parts) await update($, atom({ ...MARKED, id: keyOf(part) }, false), () => false)
    await update($, lastRead, () => replyId)
    await update($, brief, () => null)
    return
  }
  const sample = sampleOf(reply.asked)
  const numbered = parts.map((part, i) => `[${i + 1}]\n${part.replace(MARKS_ALL, '')}`).join('\n\n')
  const prompt = `The person's last message (for its language only):\n<<<${sample || '(none)'}>>>\n\nThe reply:\n\n${numbered}`
  const answered = await $.model.complete({ model: MODEL, system: SYSTEM, prompt, maxTokens: 400, effort: 'low', timeoutMs: 60_000 })
  const answer = answered.isAnswered ? parseAnswer(answered.text) : null
  if (answer === null) return
  const kept = keepMarks(parts, answer.marks)
  for (const [i, part] of parts.entries()) await update($, atom({ ...MARKED, id: keyOf(part) }, false), () => kept.includes(i + 1))
  await update($, lastRead, () => replyId)
  const next: Brief = { tldr: answer.tldr, marked: kept.length }
  await update($, brief, () => next)
  // Turned off while the model read: the marks wait for the button, and no sentence shows.
  // The notification shows under the mod's name, "tldr": the sentence alone says the rest.
  if (answer.tldr !== '' && (await read($, isOn))) $.ui.toast(answer.tldr, { timeoutMs: 15_000 })
}

/** One read at a time. A trigger that lands during a read asks for one more read after it, so a
 * reply that arrived meanwhile is not skipped. */
const mark = async ($: EngineInterface) => {
  if (!(await read($, isOn))) return
  let mine = false
  await update($, isBusy, held => {
    mine = !held
    return true
  })
  if (!mine) {
    await update($, again, () => true)
    return
  }
  try {
    do {
      await update($, again, () => false)
      await readReply($)
    } while (await read($, again))
  } finally {
    await update($, isBusy, () => false)
  }
}

const toggle = async ($: EngineInterface) => {
  const on = !(await read($, isOn))
  await update($, isOn, () => on)
  await $.store.set('isOn', on).catch(() => undefined)
  // Turned on with a long reply already on screen: mark it now, not only from the next reply on.
  if (on) await mark($).catch(() => undefined)
}

/** The words a drawing carries: its strings and its text props. The app's own drawing of a reply is a
 * reference (`{ type: 'engine', ref }`) and carries none. */
const wordsOf = (tree: unknown, out: string[] = []): string[] => {
  if (typeof tree === 'string') out.push(tree)
  else if (Array.isArray(tree)) tree.forEach(t => wordsOf(t, out))
  else if (tree !== null && typeof tree === 'object') {
    const node = tree as { props?: { text?: unknown }; children?: unknown }
    if (typeof node.props?.text === 'string') out.push(node.props.text)
    wordsOf(node.children, out)
  }
  return out
}

/** A node with this key anywhere in the drawing. */
const hasKey = (tree: unknown, key: string): boolean => {
  if (Array.isArray(tree)) return tree.some(t => hasKey(t, key))
  if (tree === null || typeof tree !== 'object') return false
  const node = tree as { props?: { key?: unknown }; children?: unknown }
  return node.props?.key === key || hasKey(node.children, key)
}

/** A drawing that still holds a paragraph's words: its first line, direction marks aside. A drawing with
 * no words at all is the app's own, drawn from the text this hook passed down, so it holds them; unless a
 * mod beneath drew the reply in other words (a translation) and said so with a node keyed `translated`. */
const holds = (tree: unknown, part: string) => {
  if (hasKey(tree, 'translated')) return false
  const line = (part.replace(MARKS_ALL, '').split('\n').find(l => l.trim() !== '') ?? '').trim().slice(0, 40)
  if (line === '') return true
  const words = wordsOf(tree).join('\n').replace(MARKS_ALL, '')
  return words === '' || words.includes(line)
}

const bandRow: MatchedHook<'ui.render', { component: 'AbovePrompt' }> = async ($, e, next) => {
  if (e.props.hasSurvey) return next(e)
  const beneath = await next(e)
  const isActive = await read($, isOn)
  const ui = $.ui.resolve(e)
  const { Box, Button } = ui
  const isDesktop = e.surface === 'desktop' && 'Svg' in ui
  // The same label while the model reads, so the button keeps its width and its seat.
  const label = isActive ? '↩ No TL;DR' : 'TL;DR'
  const button = (
    <Button key={isActive ? 'tldr-off' : 'tldr-on'} label={label} hotkey={isDesktop ? undefined : 'y'} onPress={() => toggle($)} />
  )

  if (e.plugin === BAR) return joinBar(beneath, [button], { Box, owner: 'tldr' })

  // The shared row, or Smart PreCompact's; with neither, this mod draws the shared row.
  const divider = isDesktop && 'Svg' in ui ? <ui.Svg source={DIVIDER} alt="" width={9} height={16} /> : null
  const placed = seat(beneath, [button], { px: buttonPx(label), columns: e.props.bodyColumns, isDesktop, divider })
  if ('tree' in placed) return placed.tree
  return (
    <Box flexDirection="column">
      <Box key={ROW_KEY} flexDirection="row" flexWrap="wrap" alignItems="center" gap={1}>
        <Box flexGrow={1} />
        {placed.carry}
        {button}
      </Box>
      {placed.beneath}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await update($, isBusy, () => false)
    await update($, again, () => false)
    if ((await $.store.get('isOn').catch(() => undefined)) === false) await update($, isOn, () => false)
    // A reload lands at the end of a turn, where the reply would have been read: read it now.
    $.clock.after(0, () => void mark($).catch(() => undefined))
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    // The reply is already on screen; reading it here, not in a timer, so a reload cannot drop it.
    if (e.agentId === undefined && e.reason === 'answer') await mark($).catch(() => undefined)
    return done
  })

  // A /clear or a /resume in place swaps the conversation without a session.start: what was read
  // belongs to the old one.
  on('session.end', async ($, e, next) => {
    const done = await next(e)
    if (e.reason === 'clear' || e.reason === 'resume') {
      await update($, lastRead, () => null)
      await update($, brief, () => null)
    }
    return done
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    // The terminal keeps its own drawing: a see-through color is a web thing.
    if (e.surface === 'terminal' || e.props.isSummary || !(await read($, isOn))) return next(e)
    const parts = paragraphs(e.props.text)
    const flags: boolean[] = []
    for (const part of parts) flags.push(await read($, atom({ ...MARKED, id: keyOf(part) }, false)))
    if (!flags.some(Boolean)) return next(e)

    // The drawing beneath first: a mod there (a translation, say) may draw the reply in other
    // words, and then that drawing wins and nothing is highlighted.
    const whole = await next(e)
    const firstMarked = parts[flags.indexOf(true)] ?? ''
    if (!holds(whole, firstMarked)) return whole

    const { Box, Markdown } = $.ui.resolve(e)
    // Unmarked paragraphs in a row stay one group, so a list keeps its numbering.
    const groups: { text: string; isMarked: boolean }[] = []
    parts.forEach((part, i) => {
      const last = groups[groups.length - 1]
      const isMarked = flags[i] === true
      if (!isMarked && last && !last.isMarked) last.text += `\n\n${part}`
      else groups.push({ text: part, isMarked })
    })
    // Every group goes through the hooks beneath, so a mod there (a text direction, say) still shapes
    // it. The app draws only the first reference to its own drawing in one tree (the rest of a reply
    // vanished, 22.10.2026): the first group keeps that reference, with the bullet that opens a reply.
    // A later group is asked for as markdown (`asMarkdown`): a mod beneath that has a say draws it that
    // way itself, and one that comes back as the app's reference is drawn as markdown here.
    const drawn: RenderChildren[] = []
    for (const [i, group] of groups.entries()) {
      const props = i === 0 ? { ...e.props, text: group.text } : { ...e.props, text: group.text, isFirstOfReply: false, asMarkdown: true }
      const beneath = await next({ ...e, props })
      const piece = i === 0 || wordsOf(beneath).length > 0 ? beneath : <Markdown key={`t${i}`} text={group.text} />
      drawn.push(
        group.isMarked ? (
          <Box key={`m${i}`} backgroundColor={HIGHLIGHT} paddingX={1}>
            {piece}
          </Box>
        ) : (
          piece
        ),
      )
    }
    return (
      <Box flexDirection="column" gap={1}>
        {drawn}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, bandRow)
  on('ui.render', { component: 'AbovePrompt', plugin: 'mods-bar' }, bandRow)
}
