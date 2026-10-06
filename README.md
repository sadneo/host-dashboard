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

## Configuration and host collection

Edit **`dashboard.config.json`** for both the frontend and backend. `hosts` lists the column order and displayed/SSH hostnames. The host with `"inference": true` shows llama-cpp and AMD VRAM. Rename hosts here when renaming a machine; names should match the machine's short OS hostname and resolve through Tailscale MagicDNS (or SSH configuration). Rebuild and restart after changing this file.

Both scripts detect the current OS hostname automatically. On waka, collection runs locally for waka and over SSH only for babel; on babel, collection runs locally for babel and over SSH only for waka. No SSH connection to yourself is needed. Set up key-based SSH and accept the **other** host's key interactively:

```sh
ssh babel true # when running on waka
ssh waka true  # when running on babel
```

The remote SSH account needs `node` (22+), `git`, and `zellij` on its **non-interactive SSH PATH**. Local collection uses the dashboard's Node executable and inherited PATH. `systemctl` provides llama-cpp status; AMD VRAM is read directly from the kernel's `mem_info_vram_used` and `mem_info_vram_total` files under `/sys/class/drm/card*/device`, filtering AMD's vendor ID `0x1002`. No GPU utility package is needed. Missing tools or repositories are shown as alerts/warnings.

The server sends `scripts/collect-status.mjs` **and the shared configuration** over stdin to local Node or remote SSH/Node. No remote script or config installation is needed. Check local collection or both hosts manually:

```sh
node scripts/collect-status.mjs
node --input-type=module -e 'import { snapshot } from "./lib/status.mjs"; console.log(JSON.stringify(await snapshot(), null, 2))'
```

The shared `projects` and `configRepos` lists configure names and paths for both computers. Defaults are `~aidan/Projects/comfy-room`, `~aidan/Projects/pebble`, `~aidan/Projects/discordfs`, `~aidan/.dotfiles`, and `/etc/nixos`. Use repository roots or their `.git` paths. `~/` means the executing account's home; `~aidan/` resolves aidan's home from `/etc/passwd` on the target machine.

For separate Git directories, set `workTree` alongside `path`. Dotfiles defaults to `"path": "~aidan/.dotfiles", "workTree": "~aidan"`, so Git checks the home-directory worktree with the correct Git directory.

`llamaService` changes the systemd unit name; `llamaUserService` selects a user service. `gpuSysfsPath` normally stays `/sys/class/drm`. An unknown OS hostname or malformed configuration produces an explicit collection error. The old per-host `~/.config/dashboard.json` is no longer used.

Git checks read each target's repositories: branch, dirty files, merge conflicts, ahead/behind relative to the **last fetched** upstream. They do not fetch or modify repositories. No upstream is a warning. Merge conflicts and failed checks are red; dirty or diverged repositories are yellow. Zellij lists all sessions, including exited sessions. AMD VRAM is reported per GPU in GiB, with a warning at 90% usage.

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
