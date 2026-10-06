# Host dashboard

Next.js + Tailwind, styled like a TUI with the Selenized Light palette. `babel` is on the left, `waka` on the right. Red alerts appear in the bordered summary; aligned green/yellow/red bullets show individual check results.

## Run locally

```sh
nix develop
pnpm install
pnpm build
pnpm start
```

Open <http://127.0.0.1:3000>. For development, use `pnpm dev` instead. The server binds only to loopback.

## Connect the hosts

`babel` and `waka` must resolve through Tailscale MagicDNS (or your SSH configuration). Set up key-based SSH and accept each host's key interactively first:

```sh
ssh babel true
ssh waka true
```

The SSH account needs `node` (20+), `git`, and `zellij` on its **non-interactive SSH PATH**. On babel, `systemctl` and `nvidia-smi` provide llama-cpp and NVIDIA VRAM status. Missing tools or repositories are shown as alerts/warnings, never as successful checks. The development flake is for this local app; install collector tools on each host separately.

The server sends `scripts/collect-status.mjs` to each host over SSH stdin and executes it with Node. No remote script installation is needed. Check it manually:

```sh
ssh -T babel 'node --input-type=module' < scripts/collect-status.mjs
ssh -T waka 'node --input-type=module' < scripts/collect-status.mjs
```

On **each host**, copy `host-config.example.json` to `~/.config/dashboard.json` and adjust repository paths and the systemd service name. Without configuration, the collector discovers immediate Git repository directories in `~/Projects` and checks `~/dot` and `~/nixos`. For an explicit project list, set `"projects": ["~/Projects/dashboard", "~/other/repo"]`. Set `"llamaUserService": true` for a user service. If babel's OS hostname differs from its Tailscale name, set `"babel": true` in its config.

Git checks are local: branch, dirty files, merge conflicts, ahead/behind relative to the **last fetched** upstream. They do not fetch or modify repositories. No upstream is a warning. Merge conflicts and failed checks are red; dirty or diverged repositories are yellow. Zellij lists all sessions, including exited sessions. VRAM is reported per GPU in GiB, with a warning at 90% usage.

The server starts a collection immediately and repeats on a two-second cadence while a browser is connected, streaming JSON via server-sent events. Slow checks never overlap within a connection; SSH checks time out after eight seconds. A disconnected browser displays a stale-data alert and reconnects automatically.

## Desktop entry

After building, run inside the Nix development shell:

```sh
node scripts/launch.mjs --install
```

This installs `Host Dashboard` in your application menu. It starts a background localhost production server if needed, waits for it, and opens Firefox. Logs live at `~/.cache/host-dashboard/server.log` (or `$XDG_CACHE_HOME/host-dashboard/server.log`). The entry records the current Node executable and checkout path; reinstall it if either moves. Firefox must be available on the desktop PATH. The server stays running after closing the browser.

## Checks

```sh
pnpm test
pnpm build
```
