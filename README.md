# Continuation Pipeline

**Secure phone to workstation access to Claude Code. Drive the coding agent
running on your own machine, with all of its local repos, tools, and files,
from your phone, over a private WireGuard network with no open ports.**

One opinionated setup wires your phone to the Claude Code session on your
desktop, so a build that starts at your keyboard can be continued from the bus.
Hence the name: your work continues, you just change screens.

---

## Why this exists

Claude Code lives on a workstation: your repos, your `delegate` worker, your
Obsidian vault, your WSL, all the local context that makes it useful. The cloud
and web versions are great but they do not touch *that* machine. This pipeline
closes the gap: it gives your phone a secure, private line into the Claude Code
running at home, without exposing anything to the public internet.

It is deliberately built in two layers over one secure backbone, so you can use
the fast, robust path today and the polished path as it lands.

```
        Tailscale tailnet  (WireGuard, private, zero open ports)   <- shared backbone
                 |
     +-----------+-----------+
     |                       |
  Terminal path           App path
  (SSH + tmux)            (mobile bridge)
  full control            nice mobile UI
  shipping now            in progress
```

| Layer | What it is | What it is for | Status |
|-------|-----------|----------------|--------|
| **Backbone** | A [Tailscale](https://tailscale.com) tailnet joining phone and workstation on a private WireGuard mesh. | The secure transport everything rides on. No port forwarding, no firewall holes, no public exposure. | **Shipping** |
| **Terminal path** | OpenSSH on the workstation plus a persistent `tmux` session running `claude` inside WSL. | Full control from the phone: any repo, any shell command, attach and detach a long running session, and the only path that reaches the write capable WSL vault. | **Shipping** |
| **App path** | A self hosted bridge that drives Claude Code through the Claude Agent SDK, served to a mobile PWA with tool approval buttons and push notifications. | Everyday steering without living in a terminal: readable chat, one tap approvals, notify me when the agent needs me. | **In progress** (see [Roadmap](#roadmap)) |

**The mental model:**

```
Tailscale  ->  the private road between the two devices   (install once, both ends)
SSH + tmux ->  the raw, complete cockpit                  (power use, works today)
The bridge ->  the comfortable passenger seat             (everyday use, being built)
```

---

## Status

This repo ships the **backbone** and the **terminal path** today. They are
enough to drive this workstation's Claude Code from your phone right now. The
**app path** (the custom mobile bridge) is the next milestone and has its own
design under [`docs/`](docs/); nothing in the quick start below depends on it.

---

## Prerequisites

- A **workstation** you want to reach (these docs target **Windows 11 + WSL2**;
  the ideas port to macOS and Linux, where the terminal path is even simpler
  because `tmux` runs natively).
- **WSL2 with a distro** (Ubuntu here). The persistent `tmux` session lives
  inside WSL, because native Windows has no `tmux`, and WSL is also where a
  write capable Obsidian vault is reachable.
- **Claude Code installed inside WSL** (`claude` on the WSL `PATH`).
- A **phone** with a Tailscale app and any SSH client
  ([Termius](https://termius.com), [Blink](https://blink.sh), or Tailscale SSH).
- A **Tailscale account** (free for personal use; sign in with Google or GitHub).

---

## Quick start

Three short steps: lay the private road, open the door on the workstation, walk
in from the phone.

### 1. Backbone: join both devices to a tailnet

**On the workstation (PowerShell):**

```powershell
winget install --id tailscale.tailscale -e
tailscale up
```

Sign in when the browser opens. Note the machine's tailnet name (something like
`your-pc.tailnet-name.ts.net`) or its `100.x.y.z` address from `tailscale ip`.

**On the phone:** install Tailscale from the App Store or Play Store and sign in
with the **same account**. Both devices are now on the same private network and
can reach each other directly. Nothing is exposed to the public internet.

### 2. Terminal path: enable SSH on the workstation

Run the setup script from an **elevated** PowerShell (it installs the OpenSSH
server, starts it, sets it to start at boot, and adds your phone's public key):

```powershell
.\setup.ps1
```

What it does, and why each piece (read it before running, it changes system
services):

- Installs the **OpenSSH Server** Windows capability and starts the `sshd`
  service with `Automatic` start, so the door is there after a reboot.
- **Key only auth**: it disables password login and installs the public key you
  provide, so a leaked or guessed password is not a way in. (Admin accounts on
  Windows use `C:\ProgramData\ssh\administrators_authorized_keys` with locked
  down ACLs, a well known gotcha the script handles for you.)
- Leaves the firewall rule the OpenSSH installer creates in place; because the
  only route to this box is the tailnet, you do **not** forward any router port.

Then prepare the persistent session inside WSL:

```powershell
wsl -d Ubuntu -- bash -lc 'bash /mnt/c/Users/<you>/dev/Projects/Continuation\ Pipeline/scripts/wsl-setup.sh'
```

That installs `tmux` and drops a `cc` helper into your shell (see below).

### 3. Connect from the phone

SSH into the workstation over the tailnet, then start or reattach the session:

```bash
ssh <you>@your-pc.tailnet-name.ts.net
cc            # attach the persistent Claude Code session, or create it
```

`cc` is a one line helper installed in WSL:

```bash
cc() { tmux new -A -s continuation 'claude'; }
```

`tmux new -A` **a**ttaches if the session exists and creates it otherwise, so the
same command works the first time and every time. Because the `tmux` server keeps
running inside WSL, you can drop the connection on the subway and reattach with
the exact same screen when you surface. Detach with `Ctrl-b d`; the agent keeps
working.

macOS and Linux users skip WSL entirely: `tmux` is native, so `cc` is just
`tmux new -A -s continuation 'claude'` in your shell profile.

---

## Security model

The design goal is a private line, not a public service. Three layers, each
independently sufficient to keep strangers out:

1. **The tailnet is the perimeter.** The workstation's SSH port is reachable
   only from devices you have authorized onto your Tailscale account. There is no
   public IP and no forwarded port, so internet wide scanners never see it. Tighten
   further with [Tailscale ACLs](https://tailscale.com/kb/1018/acls) to allow only
   your phone to reach port 22.
2. **Key only SSH.** Password authentication is disabled by `setup.ps1`; only a
   device holding your private key can complete a login, and the key never leaves
   the phone.
3. **WireGuard transport.** Everything between phone and workstation is encrypted
   end to end by Tailscale's WireGuard, including over hostile cafe Wi-Fi.

Losing the phone is recoverable: revoke that device in the Tailscale admin
console and remove its key from `authorized_keys`, and it can no longer reach the
box, without rotating anything else.

---

## Gotchas worth knowing

These are the sharp edges that cost time, documented so they do not cost yours.

- **`tmux` does not run on native Windows.** There is no PowerShell `tmux` and no
  native `screen`. Persistence has to live inside WSL (or you SSH straight into
  WSL). This pipeline lands you in WSL for exactly this reason; it is not an
  accident of taste.
- **Windows OpenSSH treats admin accounts specially.** For a user in the
  Administrators group, keys must go in
  `C:\ProgramData\ssh\administrators_authorized_keys`, not the per user
  `~/.ssh/authorized_keys`, and that file needs ACLs restricted to
  `Administrators` and `SYSTEM` or `sshd` silently ignores it. `setup.ps1` writes
  it to the right place with the right ACLs.
- **WSL2 has its own NAT'd network.** SSHing to the Windows *host* and then
  running `wsl` (what this setup does) needs no extra networking. SSHing
  *directly* into WSL over the tailnet is possible but requires running Tailscale
  inside WSL or a `netsh` port proxy; that is the advanced path, noted in
  [`docs/`](docs/), not the default.
- **Keep WSL from idling out.** WSL2 can shut a distro down when nothing is
  attached. A running `tmux` server with `claude` in it counts as activity and
  keeps it up, but if you want belt and suspenders, set
  `[wsl2] vmIdleTimeout` generously in `.wslconfig`.
- **The vault stays on the WSL path.** Write capable Obsidian vault edits need
  WSL (see the Knowledge Pipeline). That is a feature of the terminal path, not
  the app path; reach the vault by SSHing into the `tmux` session.

---

## Roadmap

The **app path** is the next milestone and the reason this is a pipeline rather
than a gist. It is a self hosted mobile bridge, built custom, not glued from an
existing wrapper:

- **Server (on the workstation):** a small TypeScript service that drives Claude
  Code through the [Claude Agent SDK](https://docs.claude.com/en/docs/claude-code/sdk)
  in headless streaming mode, spawning sessions in whatever repo you pick so they
  keep full local file access. It streams assistant messages, tool calls, and
  approval prompts over a websocket.
- **Client:** an installable mobile **PWA**: a session list, a repo picker, a
  readable chat view, one tap tool approval buttons, and **Web Push** so your
  phone buzzes when the agent needs a decision or finishes a job.
- **Exposure:** bound only to the Tailscale interface, behind a bearer token and
  Tailscale's own HTTPS (`tailscale cert` / `tailscale serve`). Same perimeter as
  the terminal path, nothing public.

The design and its trade-offs live in [`docs/`](docs/) as they firm up. The
terminal path above stands on its own in the meantime.

---

## Related pipelines

Part of a small family of "wire a capability cleanly into Claude Code" setups:

- [**Knowledge Pipeline**](https://github.com/aayushpokhrel1/knowledge-pipeline):
  Obsidian + Graphify + claude-obsidian, a local first knowledge stack.
- [**Delegation Pipeline**](https://github.com/aayushpokhrel1/delegation-pipeline):
  offload token heavy grunt work to free or cheap models.

Continuation Pipeline is the third: it moves *where you can drive the agent from*,
not *what the agent can do*.

---

## License

This project is licensed under the MIT License, see [LICENSE](LICENSE) for details.

**Copyright © 2026 Aayush Pokhrel**
