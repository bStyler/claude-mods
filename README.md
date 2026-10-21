# claude-mods

Two Claude Code mods, published as a plugin marketplace named `eliran-mods`.

| Mod | What you get |
|---|---|
| **goal-meter** 1.2.0 | A progress bar for `/goal`, built from Claude's own task plan. One line by default. `/goals` opens the full task list. |
| **cache-keeper** 1.2.1 | A band above the prompt with the model, effort, context bar, plan limits (with the 5h reset) and cache state, so no status line is needed. Keeps a long chat's prompt cache warm (`/keepwarm 2`), asks before an expensive cold send, shows every local chat (`/board`), and hands a chat off (`/handoff`). |

## Credit

Both mods are built on Nate Herk's [claude-code-mods](https://github.com/nateherkai/claude-code-mods)
(MIT). goal-meter is a fork of his goal-meter 1.0.0, and cache-keeper is based on his
cache-keeper 1.0.0. Each mod's `CHANGES.md` lists what differs from upstream. MIT, see `LICENSE`.

## Install

Needs a Claude Code build with mods (function-hook plugins). Works on Windows, macOS and Linux.

```
claude plugin marketplace add bStyler/claude-mods
claude plugin install goal-meter@eliran-mods
claude plugin install cache-keeper@eliran-mods
```

Then quit Claude Code and start it again. `/reload-plugins` and `/clear` do not load mod code.
Check: type `/goals`. It should open the goal meter pane.

If Nate Herk's `nateherk-mods` is installed on that machine, turn off its copies first
(same names, same tools):

```
claude plugin disable goal-meter@nateherk-mods
claude plugin disable cache-keeper@nateherk-mods
```

cache-keeper's band replaces a custom status line. If you had one, remove the
`statusLine` block from `~/.claude/settings.json` so the same figures don't show twice.

## Commands

**goal-meter**

| Command | Does |
|---|---|
| `/goal <what done looks like>` | Starts a goal. Claude plans it as sized tasks and the bar tracks them. |
| `/goals` | Full task list, plus other chats' goals from the last 12 hours. |
| `/goals compact` / `/goals full` | One-line bar (default) or the full bar. Saved for every chat. |
| `/goals hide` / `/goals show` | Hide the bar and footer label in every chat, or bring them back. |
| `/goals clear` | Remove this chat's goal, running or finished. |
| `/goals strict on` | No file edits in a `/goal` until Claude has written the plan. Useful for coding. |

The `g` key on the bar only works after Ctrl+X Tab focuses the bar. From the prompt, type `/goals`.

**cache-keeper**

| Command | Does |
|---|---|
| `/keepwarm 2` / `/keepwarm off` | Keep this chat's cache warm for N hours (max 24). |
| `/cache big 100k` | Size at which it asks before a cold send (default 150k). |
| `/cache guard off` | Turn the cold-send question off. |
| `/cache ttl 5` / `60` / `auto` | Cache window, if it guesses wrong. |
| `/board` | Every local chat on one board. |
| `/handoff` | Write a handoff and continue in a fresh chat. |

## Update

```
claude plugin marketplace update eliran-mods
claude plugin update goal-meter@eliran-mods
claude plugin update cache-keeper@eliran-mods
```

Restart Claude Code afterwards. When changing code, raise `version` in the mod's
`.claude-plugin/plugin.json`, or `plugin update` will not pick it up.

## Uninstall

```
claude plugin uninstall goal-meter@eliran-mods
claude plugin uninstall cache-keeper@eliran-mods
claude plugin marketplace remove eliran-mods
```

Saved state lives in `~/.claude/mods-data/` and can be deleted.
