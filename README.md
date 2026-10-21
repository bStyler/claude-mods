# claude-mods

Three Claude Code mods, published as a plugin marketplace named `claude-super-mods`.

| Mod | What you get |
|---|---|
| **goal-meter** 1.2.1 | A progress bar for `/goal`, built from Claude's own task plan. One line by default. `/goals` opens the full task list. |
| **cache-keeper** 1.3.0 | A band above the prompt with the model, effort, context bar, plan limits (with the 5h reset) and cache state, so no status line is needed. Keeps a long chat's prompt cache warm (`/keepwarm 2`), asks before an expensive cold send, shows every local chat (`/board`), and hands a chat off (`/handoff`). Every compaction without its own instructions is told what to keep, and the band shows how much it saved. |
| **lean-explore** 1.1.0 | Replaces the built-in Explore subagent (the one that does codebase searches) with a lean one: Haiku, low effort, Read/Grep/Glob only, short answers with file:line. In tests it used about 3x fewer tokens and ran twice as fast, with the same answers. `/explore-haiku on\|off\|status` toggles it. |


## lean-explore

A plugin cannot replace a built-in agent with an agent of its own (plugin agents get a
`lean-explore:` prefix). So on the first session the mod writes `~/.claude/agents/Explore.md`
itself, marked with a comment line so it never touches an `Explore.md` you wrote.

- The footer shows `Explore: Haiku` or `Explore: built-in` (terminal and desktop app). After a toggle it adds what the next session will use, for example `Explore: Haiku (built-in next session)`.
- `/explore-haiku status` shows whether it is on, off, or blocked by your own `Explore.md`.
- `/explore-haiku off` renames it to `Explore.md.off`; the built-in Explore comes back.
- `/explore-haiku on` brings it back.
- Agent files load when a session starts, so every change applies from the next session.
- Before uninstalling, run `/explore-haiku off`, or delete `~/.claude/agents/Explore.md`.
  Uninstalling the mod does not remove the file.

When a search needs judgment (a review, a design call), ask for a general-purpose agent or
pass `model: "opus"`: Haiku finds things well but checks less of what it reads.

## Credit

goal-meter and cache-keeper are built on Nate Herk's [claude-code-mods](https://github.com/nateherkai/claude-code-mods)
(MIT). goal-meter is a fork of his goal-meter 1.0.0, and cache-keeper is based on his
cache-keeper 1.0.0. Each mod's `CHANGES.md` lists what differs from upstream. cache-keeper 1.3.0 also borrows three ideas from JayGPTPro's [Smart PreCompact](https://github.com/JayGPTPro/smart-precompact). MIT, see `LICENSE`.

## Install

Needs a Claude Code build with mods (function-hook plugins). Works on Windows, macOS and Linux.

```
claude plugin marketplace add bStyler/claude-mods
claude plugin install goal-meter@claude-super-mods
claude plugin install cache-keeper@claude-super-mods
claude plugin install lean-explore@claude-super-mods
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
claude plugin marketplace update claude-super-mods
claude plugin update goal-meter@claude-super-mods
claude plugin update cache-keeper@claude-super-mods
claude plugin update lean-explore@claude-super-mods
```

Restart Claude Code afterwards. When changing code, raise `version` in the mod's
`.claude-plugin/plugin.json`, or `plugin update` will not pick it up.

## Uninstall

```
claude plugin uninstall goal-meter@claude-super-mods
claude plugin uninstall cache-keeper@claude-super-mods
claude plugin uninstall lean-explore@claude-super-mods
claude plugin marketplace remove claude-super-mods
```

Saved state lives in `~/.claude/mods-data/` and can be deleted.
