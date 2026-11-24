# Handover

Current state only. The map of what is written down where is in
[`CLAUDE.md`](CLAUDE.md); read that first, then use this to pick up work.

## Where things stand

Backbone (Tailscale), terminal path (SSH + tmux `cc`), and the app path (Stages 1-3) are all
shipped and committed. Nothing is half-built.

- `bridge` verify is green: **56 tests passing, 0 failing, `tsc --noEmit` clean** (run through
  WSL, see CLAUDE.md), and the same `npm run verify` runs in GitHub Actions CI on every push.
- Last doc-affecting code commit: `7948414` (tmux scrollback replay on terminal attach).

## Pending real-device checks

Code is done; they can only be confirmed on the phone. The list is the "Not yet
device-checked" column of the README's Status section, its one home: move a row across there
when a check passes on the iPhone.

## This machine

`bridge/config.json` (gitignored) holds the bearer token and VAPID keys, with
`projectsDir` set to `/mnt/c/Users/aayus/dev/Projects`. Setup, run, and auto-start are in
[`bridge/README.md`](bridge/README.md).

## Next, if anything

Not started, and nothing depends on them: attaching more than one terminal at once, and starting
a session from the phone.
