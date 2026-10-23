# lean-explore (HelloChakra changes)

Based on bStyler's `lean-explore` 1.4.0 (claude-super-mods).

## 1.6.0 - 2026-10-23

- Adds a short "Searching the codebase" section to the system prompt (`prompt.compose`) while the lean
  agent is on: delegate open-ended searches to Explore, read directly when the path is known. It ships
  with the mod, so no CLAUDE.md edit is needed on any machine.

## 1.5.2 - 2026-10-23

- Parallel sessions: a finished run is added to the stored ledger (re-read just before the save), not to
  the copy loaded at session start, so sessions no longer overwrite each other's counts. Each session
  re-reads the stored ledger every 30 s, so the chip follows runs finished in other windows.

## 1.5.1 - 2026-10-23

- Chip above the prompt is just `● Haiku · 25.7M` (dot, model, tokens delegated). Searches, reads and
  the fresh/cached split are in the hover card.

## 1.5.0 - 2026-10-23

- Replaced the "about 3x fewer tokens (an estimate from tests)" claim with measured numbers.
  A ledger in `$.store` keeps, per model: runs, uncached/cache-read/cache-write/output tokens,
  tool calls (reads, greps, globs), tool-result size and report size.
- First load fills the ledger from the Explore subagent transcripts already on disk
  (`hooks/backfill.py`, read-only); after that every finished Explore run adds one row
  from `turn.step` usage, `tool.call` results and `turn.complete`.
- Chip: "N tokens delegated" next to the session's search count. Hover card: all-time searches,
  reads, tokens on Haiku (fresh vs cached) and file text kept out of the chat.
- `/lean-explore stats` and `/lean-explore rescan` (rebuilds the ledger from disk).
- "Kept out of chat" = tool-result text the agent read minus the report it returned, at 4 chars
  per token: an estimate. Everything else is the API's own usage figures.
