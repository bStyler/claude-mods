# claude-mods

Four Claude Code mods, published as a plugin marketplace named `claude-super-mods`.

| Mod | What you get |
|---|---|
| **goal-meter** 1.2.1 | A progress bar for `/goal`, built from Claude's own task plan. One line by default. `/goals` opens the full task list. |
| **cache-keeper** 1.3.0 | A band above the prompt with the model, effort, context bar, plan limits (with the 5h reset) and cache state, so no status line is needed. Keeps a long chat's prompt cache warm (`/keepwarm 2`), asks before an expensive cold send, shows every local chat (`/board`), and hands a chat off (`/handoff`). Every compaction without its own instructions is told what to keep, and the band shows how much it saved. |
| **lean-explore** 1.4.0 | Replaces the built-in Explore subagent (the one that does codebase searches) with a lean one: Haiku, low effort, Read/Grep/Glob only, short answers with file:line. In tests it used about 3x fewer tokens and ran twice as fast, with the same answers. `/lean-explore on\|off\|status` toggles it. |
| **memory-guard** 0.1.0 | Spots sessions worth remembering (files written to output folders, MCP writes, meeting transcripts, decisions, commits, accepted plans, long chats) and nudges once to run `/memorize`. A session that ends without it is queued, and the next session in that project offers to catch up. Files into your wiki if you point it at one, else Claude Code's own auto-memory. Ships its own `/memorize` skill. |


## lean-explore

A plugin cannot replace a built-in agent with an agent of its own (plugin agents get a
`lean-explore:` prefix). So on the first session the mod writes `~/.claude/agents/Explore.md`
itself, marked with a comment line so it never touches an `Explore.md` you wrote.

- Desktop app: a chip above the prompt. Green `Explore: Haiku · 6 searches` counts this chat's Explore runs; hover it for a card with a Turn off button. Amber `Explore: built-in` means it is off, with a Turn on button. After a toggle it adds what the next session will use. It shares one row with the TL;DR button (the `mods-row` convention), chip on the left.
- Terminal: a footer label, `Explore: Haiku` or `Explore: built-in`, with the same next-session note.
- `/lean-explore status` shows whether it is on, off, or blocked by your own `Explore.md`.
- `/lean-explore off` renames it to `Explore.md.off`; the built-in Explore comes back.
- `/lean-explore on` brings it back.
- Agent files load when a session starts, so every change applies from the next session.
- Before uninstalling, run `/lean-explore off`, or delete `~/.claude/agents/Explore.md`.
  Uninstalling the mod does not remove the file.

When a search needs judgment (a review, a design call), ask for a general-purpose agent or
pass `model: "opus"`: Haiku finds things well but checks less of what it reads.

## memory-guard

Each session scores a point per kind of durable work: a file written to an output folder
(`docs`, `reports`, `deliverables`, `notes`), a write through any MCP tool, a meeting or
transcript read, a decision in your prompt ("let's go with", "from now on"), a `git commit`,
an accepted plan. Ten turns or more adds one. At 2 points it nudges once: a toast, a band
above the prompt with **Memorize now** and **Not this session**, and `/memorize` as the
prompt suggestion. A session that ends without `/memorize` goes on that project's queue.
The next session there shows **Catch up**, and the hint line says `· 3 unmemorized`.

With no setup it files into Claude Code's auto-memory (`~/.claude/projects/<project>/memory/`
and its `MEMORY.md`). To use a wiki, or your own `/memorize` skill, add
`.claude/memory-guard.json` to the project (or `~/.claude/memory-guard.json` for all of them).
Every field is optional:

```json
{
  "kb": { "path": "wiki", "index": "wiki/index.md", "log": "wiki/log.md", "rules": "wiki/CLAUDE.md" },
  "skill": "memorize",
  "threshold": 2,
  "longSessionTurns": 10,
  "outputDirs": ["docs", "reports", "deliverables", "notes"],
  "signals": { "decision": false },
  "extraSignals": [{ "name": "Tickets", "tool": "^mcp__.*linear.*__(create|update)" }, { "name": "Release", "bash": "npm publish" }],
  "ui": { "band": true, "hint": true, "suggest": true }
}
```

- `kb`: your knowledge base. The bundled skill reads its rules file and index, files pages
  there, and logs each one. A write to `kb.log` counts as memorized.
- `skill`: the skill the buttons run. Leave it out to use the bundled `memory-guard:memorize`.
- `extraSignals`: your own signals, by tool-name or Bash-command regex.

If it finds a `wiki/` folder or an Obsidian vault with no config, it says so once.
The band and hint line show in the terminal and the desktop app; elsewhere the toast and
`/memorize-queue` still work.

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
claude plugin install memory-guard@claude-super-mods
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

**memory-guard**

| Command | Does |
|---|---|
| `/memorize` | Save what this session learned (bundled skill: `memory-guard:memorize`). |
| `/memorize queue` | Catch up on the queued sessions from their transcripts. |
| `/memorize-queue` / `/memorize-queue clear` | Show this session's score and the queue, or clear it. |
| `/memory-guard off` / `on` / `status` | Stop or start watching this project; show where it files and what it counts. |

## Update

```
claude plugin marketplace update claude-super-mods
claude plugin update goal-meter@claude-super-mods
claude plugin update cache-keeper@claude-super-mods
claude plugin update lean-explore@claude-super-mods
claude plugin update memory-guard@claude-super-mods
```

Restart Claude Code afterwards. When changing code, raise `version` in the mod's
`.claude-plugin/plugin.json`, or `plugin update` will not pick it up.

## Uninstall

```
claude plugin uninstall goal-meter@claude-super-mods
claude plugin uninstall cache-keeper@claude-super-mods
claude plugin uninstall lean-explore@claude-super-mods
claude plugin uninstall memory-guard@claude-super-mods
claude plugin marketplace remove claude-super-mods
```

Saved state lives in `~/.claude/mods-data/` and can be deleted.
