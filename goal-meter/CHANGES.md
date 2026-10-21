# goal-meter (HelloChakra fork)

Forked from Nate Herk's `goal-meter` 1.0.0 (`~/.claude/nateherk-mods/goal-meter`).
Never enable this and `goal-meter@nateherk-mods` together: same name, same tool.

To rebase onto a new upstream version: diff upstream 1.0.0 against the new one,
then reapply the list below to the new code.

## 1.2.0 - 2026-10-21

- Desktop always draws the compact one-line band. The full band's bar and task
  rows are sized in text cells and don't line up in the app's proportional font.
  `/goals full` still applies in the terminal; `/goals` opens the full task list
  on either surface.
- The footer label is skipped on desktop, since the band line says the same.
- Test: full view stays full in the terminal and is one line on desktop.

## 1.1.0 - 2026-10-07

- Compact one-line band is the default. `/goals full` brings back the full band,
  `/goals compact` returns to one line. The choice is saved for every chat.
- `/goals hide` is saved (it used to reset on the next goal or reload) and hides
  the footer label too. `/goals show` restores the last view.
- `/goals clear` removes this chat's goal whether it is running or finished
  (`dismissedAt`). It used to do nothing once a goal was met. A cleared goal does
  not reopen when the goal loop carries on.
- A finished goal stays on screen 2 minutes, not 10.
- The `/goals` pane no longer shows an old "not met yet" check once the goal is
  met or stopped.
- The "+N more" hint points to `/goals`, not the `g` hotkey, which only fires
  after the band is focused (Ctrl+X Tab).
- Tests for clear (running and finished) and the saved view.
