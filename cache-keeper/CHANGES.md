# cache-keeper (fork changes)

Based on Nate Herk's `cache-keeper` 1.0.0. To rebase onto a new upstream version:
diff upstream 1.0.0 against the new one, then reapply the list below to the new code.

## 1.3.0 - 2026-10-21

Three ideas taken from JayGPTPro's Smart PreCompact (github.com/JayGPTPro/smart-precompact):

- Keep-list: every compaction of the main chat without instructions of its own
  (the automatic one, a bare `/compact`, and "Compact first, then send") is told
  to keep failed approaches, decisions with reasons, the user's own words, what is
  half done, and exact strings. Subagent compactions and other plugins' are left alone.
- Desktop fallback: when the direct compaction is refused (the desktop app runs
  the session headless), "Compact first, then send" runs `/compact` as if typed.
  If that does not compact either, the message goes back to the prompt box, unsent.
- Receipt: after a compaction the band shows `✓ Compacted 512k → 41k · 471k lighter`
  for 10 minutes or until OK (`o`), in the terminal and on the desktop.

Not taken: a model call to write custom instructions before compacting. It reads
the whole chat, so on a cold cache it pays the very rewrite this mod warns about.

## 1.2.2 - 2026-10-21

- Author is now bStyler; Nate Herk stays credited in the description and LICENSE.

## 1.2.1 - 2026-10-21

- Desktop alert band gets top padding so it no longer sits tight under
  Token Optimizer's card.

## 1.2.0 - 2026-10-21

- Desktop gets an alert-only band. Token Optimizer's desktop card already shows
  model, context, cache timer and plan limits, so the band draws nothing until
  there is something to act on: a big cache cooling (with Keep warm) or cold
  (with the rewrite cost), keep-warm running (with Stop), or a handoff in flight.
  One Text per line, so the app cannot wrap it piece by piece.
- The terminal band is unchanged.
- The footer label is skipped on desktop, since the alert band says the same.
- Tests for the desktop band: nothing while warm, one line when big and cold.

## 1.1.1 - 2026-10-14

- Fixed "Compact first, then send" on the cold-cache question. It used to call
  `$.session.compact()` inside the `prompt.submit` hook. The engine refuses to
  compact while a prompt is being submitted, the error was swallowed, and the
  message went out uncompacted. Now the prompt is held (dropped), compaction runs
  50 ms later once the session is idle (two retries a second apart), and the same
  text and attachments are resubmitted. If compaction fails or a hook vetoes it,
  the message goes back in the prompt box with a toast saying why.
- Test: "compact first holds the prompt, compacts, then sends it" (fails on 1.1.0).

## 1.1.0 - 2026-10-09

The band above the prompt replaces the custom status line
(`~/.claude/statusline-command.sh`), so it now carries that line's figures and the
`statusLine` setting can go. One row:

`Opus 5.5 [xhigh] │ ● cache warm 60m │ ctx ███░░░░░░░ 31% 312k/1M │ rewrite ≈ $2.48 │ 5h 64% (resets 11:10am) · week 58% │ session $9.27`

- Model name and reasoning effort at the start of the band. The effort is read
  from the main loop's last request (`turn.step`'s `effort`), so it appears after
  the first reply and follows `/effort` and `/model` changes.
- Context as the status line drew it: a 10-cell bar, percent, and used/window.
  On a narrow terminal the bar drops and the numbers stay.
- The 5h limit shows when it resets. `/cache` and the footer label show it too.
- ctx now comes only from the status line's own figures (`session.measure` and
  `$.session.usage()`, which are `context_window.total_input_tokens`). It used to
  be overwritten by the plugin's own per-request sum, so the band and the status
  line could disagree by a few thousand tokens.
- The band redraws on every `session.measure`, so it is as fresh as the status
  line was. It used to wait for the 30-second tick or the end of the turn.
- The band shows from session start (model only) instead of waiting for the first
  request. `session $0` is hidden until there is a cost.
- Tests for the band: model, context bar, 5h reset, the narrow fallback, effort.
