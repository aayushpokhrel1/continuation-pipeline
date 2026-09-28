# Working in this repo

Continuation Pipeline.

## Where things are written down

| File | What it holds |
| --- | --- |
| `README.md` | What the project is, the two paths, prerequisites, terminal-path quick start, security model, Windows/WSL gotchas, roadmap |
| `bridge/README.md` | The app path end to end: prerequisites, setup, Web Push, run, `tailscale serve`, auto-start, phone use, terminal continuation, test/typecheck, file layout, gotchas |
| `docs/app-path-design.md` | Why the app path is built this way: shape, confirmed decisions, session-sourcing approaches, verified Agent SDK facts, approval modes, per-stage scope |
| `docs/superpowers/specs/` | One design spec per slice, written before building it |
| `docs/superpowers/plans/` | The implementation plan for a slice, where one was written out |
| `HANDOVER.md` | Current state only (see below) |

`HANDOVER.md` here is **tracked**, unlike most of these projects, so it is part of the repo history. Keep it short anyway.

The two READMEs are the source of truth for anything a reader needs in order to run or trust the
thing. The design docs explain why it is shaped that way and are not updated to narrate progress
beyond marking a stage shipped.

## The handover

`HANDOVER.md` holds **current state only**: where things stand, what is half-done, what is next.

**Before adding a line to it, ask: will this still be true in a month?** If yes it belongs in one
of the permanent docs above, or in the vault. This rule exists because the same file on a sibling
project reached 1,365 lines by accumulating everything and began contradicting itself, which
caused real wrong work: a session acted on a superseded line and re-proposed something the same
file recorded as already tried and rejected.

## When Aayush says "update"

"Update the docs", "update everything", or just "update" means **all of it, in this turn**:

1. **The knowledge vault** - `C:\Users\aayus\Documents\Knowledge-Vault\Projects\Continuation-Pipeline\`
   (the path is per-machine). Add what this session learned that is worth keeping: a decision and
   its WHY, a non-obvious gotcha or fix, a research finding, a cross-project learning. This is the
   part that gets forgotten, and it is the part that compounds.
2. **Every doc in this repo**, not only the one already open.
3. **The handover**, but only its current-state numbers.

**Vault writes go through WSL, and note content must never appear on the command line.** The Bash
tool re-quotes the wrapper, so backticks and apostrophes inside a note get executed or break the
command. Write the note to a file first, then pass only literal paths:

```
wsl -d Ubuntu -- bash -lc 'cat /mnt/c/<tmp>/note.md >> /mnt/c/Users/aayus/Documents/Knowledge-Vault/Projects/Continuation-Pipeline/index.md'
```

**Updating docs means making them TRUE, not just appending what shipped.** Correct or strike a
stale claim where it sits rather than adding a newer entry underneath it, because the next reader
may hit the old one first. Cross-check every number (versions, counts, commit) against reality
instead of trusting what the file says.

## How work gets built here

Per the global CLAUDE.md, implementation is delegated to the pipeline (`deepseek` for a module
or a real refactor, `free` for boilerplate) with `--verify` and a review of the diff. Design, SDK
research, and security judgement stay in-session.

Each slice gets a spec in `docs/superpowers/specs/` **before** it is built.

Verify before claiming anything works. It has to run inside WSL, because `node_modules/.bin/*`
are POSIX symlinks and `tsc`/`tsx` are "not recognized" on the Windows side:

```bash
wsl -d Ubuntu -- bash -lc 'source ~/.nvm/nvm.sh && cd "/mnt/c/Users/aayus/dev/Projects/Continuation Pipeline/bridge" && npm run verify'
```

That is `tsc --noEmit` plus the `node:test` suite. `delegate --verify` runs through Windows cmd
and cannot run it, so verify and commit by hand after a delegate run.

## Where knowledge goes

A lesson has exactly one home, chosen by how far it reaches:

- **A rule about specific code goes in a comment AT that code.** The most reliable form there is:
  you cannot edit the function without reading the warning above it. A note filed elsewhere is the
  least reliable, because nobody goes back to read it.
- **A lesson that generalises goes in the vault**, phrased so it is useful on a different
  project, with this one as the example.
- **A dated narrative of what you did today goes in `git log`.** It is already there, in detail.

Keep any one lesson in a single place. Two copies drift, and the drift is what causes wrong work
later.
