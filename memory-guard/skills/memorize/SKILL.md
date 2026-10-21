---
name: memorize
description: "Save the durable takeaways of this session (decisions, rules, gotchas, hard-won facts) into memory: Claude Code's auto-memory, plus the project's knowledge base if memory-guard is pointed at one. Use on /memorize, 'memorize this', 'remember all of this', 'save this to memory', at the end of a session that produced decisions or rules, or with 'queue' to catch up on earlier sessions memory-guard queued. Not for a chat-only recap or a handoff note."
---

# /memorize - save what this session learned

Turn what this session learned into durable knowledge, in the right place, with nothing invented.

`/memorize queue` does the same for the earlier sessions memory-guard queued (see Queue mode).

## Where things go

Read `.claude/memory-guard.json` in the project first, if it exists. Its `kb` field names a knowledge base (a wiki, an Obsidian vault, a docs folder). Then route each takeaway:

| Takeaway | Goes to |
|---|---|
| A one-line rule, ID, preference, or gotcha Claude would get wrong before it thought to look it up | **Auto-memory**: one file in the project's memory folder, plus a one-line pointer in its `MEMORY.md` |
| A full account: a decision and why, what was rejected, numbers with their source, a timeline | **The knowledge base**, if `kb` is set: a new or updated page. With no knowledge base, keep it short and put it in auto-memory |
| A standing change to how Claude should behave in this project | **`CLAUDE.md`**: propose the exact lines and wait for a yes. Never write it silently |

The auto-memory folder is the one Claude Code already uses for this project (`~/.claude/projects/<project>/memory/`). Run `/memory-guard status` if you are not sure of the path. If auto-memory is turned off, use the knowledge base, or propose a `## Learned` section in `CLAUDE.md`.

Memory is for reflexes, the knowledge base is the library. `MEMORY.md` loads into every session, so keep it to lines that change what Claude does before it would think to look something up.

## Gotchas

- **Read before writing.** Open `MEMORY.md` and the memory files the session touched. With a knowledge base, read its rules file (`kb.rules`, if set) and index (`kb.index`) first, then the pages this session touched. Most takeaways update something that exists.
- **Only what outlives the session.** Decisions and why, open disagreements, numbers that set a target, rules of thumb, failure modes, where to find things. Not task lists, status updates, or a step-by-step of what was done.
- **Corrections count.** If the session proved a memory or page wrong, fix it there and say what changed. Never leave both versions standing.
- **A number needs its source and scope**, or it does not get filed.
- **Never invent a link or a fact.** Every claim traces to this session or a cited source.
- **Secrets never get filed.** No keys, tokens, or passwords. Say where they live instead.
- **Ask before deleting** any memory or page.

## Workflow

### 1. Gather

List the durable takeaways: decisions and their reasons, rejected options, rules set, failure modes found, facts verified with a source, and anything the user corrected. Ask: what would a fresh session need so it does not repeat this work?

Drop anything task-level, already recorded in the code or git history, or true only today.

### 2. Route

Put each takeaway in one place, using the table above. Never copy one layer into another.

### 3. Show the plan

Before writing, list each file to create or update, with one line on what goes in it. Wait for approval if anything is a judgement call: a new folder, a clash with something already filed, a `CLAUDE.md` change. Otherwise go ahead.

### 4. Write

- **Auto-memory:** one fact per file, with frontmatter:

  ```markdown
  ---
  name: short-kebab-case-slug
  description: one line, used to decide relevance later
  metadata:
    type: user | feedback | project | reference
  ---

  The fact. For feedback and project facts, add **Why:** and **How to apply:** lines.
  ```

  Then add `- [Title](file.md) - hook` to `MEMORY.md`. Update an existing file instead of making a near-duplicate. Turn relative dates into absolute ones.
- **Knowledge base:** follow its rules file exactly if there is one. Add new pages to the index. If `kb.log` is set, append one dated entry per page filed. Synthesize; do not paste the session in.
- **Size check:** count the lines in `MEMORY.md`. Past about 150, list candidates to prune: lines that repeat `CLAUDE.md` or the knowledge base, and stale projects. Past 200, Claude Code cuts the index off at load, so say so plainly. Delete nothing without a yes.

### 5. Report

Tell the user what was filed: one line per file created or updated, with its path, and anything you deliberately left out.

## Queue mode (`/memorize queue`)

memory-guard lists the queued sessions at session start, each with its transcript path (or its session id; the transcript is `<session id>.jsonl` in the folder above the memory folder).

1. Read each queued transcript. They can be long: skim the user's prompts and the final answers first, then dig where decisions were made.
2. Run steps 1 to 5 across all of them together, so one takeaway found twice is filed once.
3. Report per session what was filed, and which sessions held nothing worth keeping.

The queue clears when this runs.

## Before you return - verify

- [ ] Every new memory file has valid frontmatter and a pointer line in `MEMORY.md`.
- [ ] No new memory duplicates an existing one (search `MEMORY.md` first).
- [ ] Every link points at a file that exists.
- [ ] Every new knowledge-base page is in its index, with a log entry if `kb.log` is set.
- [ ] Every claim traces to the session or a cited source. No invented numbers, dates, or names.
- [ ] No keys, tokens, or passwords were written anywhere.

Then say in a line or two what you checked, and name anything you could not verify.
