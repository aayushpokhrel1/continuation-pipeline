# Handover

Current state only. The map of what is written down where is in
[`CLAUDE.md`](CLAUDE.md); read that first, then use this to pick up work.

## Where things stand

Backbone (Tailscale), terminal path (SSH + tmux `cc`), and the app path (Stages 1-3) are all
shipped and committed. Nothing is half-built.

- `bridge` verify is green: **56 tests passing, 0 failing, `tsc --noEmit` clean** (run through
  WSL, see CLAUDE.md).
- Both paths have been driven from a real iPhone through Stage 2.
- Last doc-affecting code commit: `7948414` (tmux scrollback replay on terminal attach).

## Pending real-device checks

Code is done for all of these; they can only be confirmed on the phone.

- iOS Web Push after Home-Screen install, and the Slice B loop of background -> push -> resume
  with the approval still waiting.
- Cross-repo overview attach, and the live terminal against a real `cc` `continuation` session.
  The terminal render and plumbing are browser-verified with simulated output only.

## This machine

`bridge/config.json` (gitignored) holds the bearer token and VAPID keys, with
`projectsDir` set to `/mnt/c/Users/aayus/dev/Projects`. Setup, run, and auto-start are in
[`bridge/README.md`](bridge/README.md).

## Next, if anything

Not started, and nothing depends on them: attaching more than one terminal at once, and starting
a session from the phone.
