# Host dashboard

Three views share a monospace, hard-bordered Selenized Light shell. Green means healthy, yellow noteworthy, red failed, gray metadata/unavailable, and blue selected/actionable. Babel is always left of Waka.

- **1 Main:** compact host/deployment summaries, up to six project comparisons, recent commits/active Zellij directories, and at most three actionable attention items. RAM/disk/load appear only when abnormal.
- **2 Projects:** symmetric cross-host evidence, all/active/dirty/diverged/config filters, worktrees, upstream counts, and activity-based primary-workspace hints. Dotfiles and NixOS use the same layout under CONFIG. Select a project for the bottom file/activity inspector; Esc closes it.
- **3 Desktop:** Babel GPU/model overview and selected service dependency chain, listener/PID, restart/result fields, and collapsed journal output. `[run checks]` refreshes collection; it does not restart services.

Press 1–3 to switch views. Main targets a single desktop viewport; small screens scroll. No fabricated time-worked metrics are used.

## Run locally

```sh
nix develop
pnpm install
pnpm build
pnpm start
```

Open <http://127.0.0.1:7582>. For development, use `pnpm dev` instead. The server binds only to loopback.

## Configuration and host collection

Edit **`dashboard.config.json`** for both the frontend and backend. `hosts` lists the column order and displayed/SSH hostnames. The host with `"inference": true` shows llama-cpp and AMD VRAM. Rename hosts here when renaming a machine; names should match the machine's short OS hostname and resolve through Tailscale MagicDNS (or SSH configuration). Rebuild and restart after changing this file.

The collector detects the current OS hostname automatically. On waka, collection runs locally for waka and over SSH only for babel; on babel, collection runs locally for babel and over SSH only for waka. No SSH connection to yourself is needed. Set up key-based SSH and accept the **other** host's key interactively:

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

Additional settings:

- `diskPaths`: filesystems to report (defaults to `/` and aidan's home).
- `staleRepoDays`: highlight clean repos/worktrees whose last commit is older than this many days (30 by default). This measures commit inactivity, not editor activity.
- `llamaUrl`: local llama.cpp server address on each target (default `http://127.0.0.1:8080`). Read-only `/health` and `/v1/models` checks distinguish API-reported loaded models from model paths in process arguments; unavailable servers are labeled rather than guessed.
- `zellijCachePath`: cache root for exited sessions' saved layouts.
- `procPath`: `/proc`, configurable for collector fixtures.
- `services`: personally relevant Babel services with `name`, `unit`, optional `user`, `url` or `port`, and `backend: true` for the configured llama.cpp dependency. Current Babel addresses were verified as SillyTavern `3829` and llama.cpp router `23785`; the latter is loopback-only. Adjust these addresses/unit names to your installation. This probes the configured backend, not SillyTavern's internally selected provider.

Cross-host relationships use full HEAD hashes and up to 2,000 ancestor hashes per host, with unknown ancestry explicitly labeled. Seven-day activity includes up to 50 commits per repository per host; shared commits are deduplicated in Main. Divergence does not imply unpublished work without remote evidence. Upstream comparisons use locally cached refs and never fetch.

Each `hosts` entry can override these common settings, e.g. `{"name":"waka","inference":true,"llamaUrl":"http://127.0.0.1:8081"}`. AI/GPU monitoring is enabled on both hosts. Set `inference` to false to hide it for either host. Mark the NixOS repository with `"nixos": true` to display its current flake Git revision in host health.

## Reported details

Host health includes uptime, 1/5/15-minute load averages and CPU count, RAM usage using Linux `MemAvailable`, disk usage and available space, and failed **system and user** systemd units. RAM/disk usage warns at 85%; load warns when the one-minute average exceeds the CPU count. NixOS shows the latest system-profile generation and its update age separately from the running system's version. The flake HEAD is the local NixOS repository revision; a deployed configuration revision is shown only when the system records it under `/run/current-system/configuration-revision`.

Repositories include the last commit hash/subject/age and staged, unstaged, and untracked counts. Open the bottom inspector to see filenames and Git status codes. Linked worktrees carry their own branches, changes, divergence, and commits. Stale/prunable registrations are displayed without modifying or pruning them.

Zellij directories come from each live session's dumped layout; exited sessions use saved layouts and are labeled accordingly. Multiple pane directories are retained. Long paths abbreviate earlier components fish-style while preserving the final directory; hover for the full home-relative path. Unavailable directories are explicit.

AMD GPU readings include VRAM, utilization, and edge temperature when exposed by sysfs. Process VRAM comes from readable AMD DRM fdinfo counters, including ROCm clients, deduplicated by client ID within each process. Other users' inaccessible counters are reported as incomplete; these numbers are not a replacement for total GPU VRAM. The dashboard neither installs ROCm tools nor starts/loads models. Summary rows count dirty repositories/worktrees and failed units and identify ahead/behind repositories, including NixOS.

Git checks read each target's repositories: branch, dirty files, merge conflicts, ahead/behind relative to the **last fetched** upstream. They do not fetch or modify repositories. No upstream is a warning. Merge conflicts and failed checks are red; dirty or diverged repositories are yellow. Zellij lists all sessions, including exited sessions. AMD VRAM is reported per GPU in GiB, with a warning at 90% usage.

The server starts a collection immediately and repeats on a two-second cadence while a browser is connected, streaming JSON via server-sent events. Slow checks never overlap within a connection; SSH checks time out after eight seconds. A disconnected browser displays a stale-data alert and reconnects automatically.

## Desktop entry

### Nix package

Build and launch the package without installing it:

```sh
nix build path:.
./result/bin/host-dashboard
```

The package includes the production server, Node, collection tools, fonts, and a
`Host Dashboard` desktop entry for Fuzzel. It supports `x86_64-linux` and
`aarch64-linux`. LibreWolf must be installed and available on your desktop PATH;
it is not a build or package dependency. If missing, the launcher prints a friendly
error with the URL to open manually.
The launcher binds to `127.0.0.1:7582`, reuses a running server, and opens LibreWolf.
Logs live at `$XDG_CACHE_HOME/host-dashboard/server.log`, defaulting to
`~/.cache/host-dashboard/server.log`. Desktop-launched servers exit one second after
the last dashboard tab disconnects. Refreshing or reconnecting cancels shutdown.
The server allows 60 seconds for the first tab to connect after launch.
Configuration is bundled from `dashboard.config.json`; rebuild to change it.

To verify the package without opening a browser (port 7582 must be unused):

```sh
nix develop --command node test/package-smoke.mjs "$(nix build path:. --no-link --print-out-paths)"
```

This checks cold launch, repeated launch, LibreWolf invocation using a test stub,
the friendly missing-browser error,
the desktop entry, static assets, fonts, and live host collection. It stops its
test server afterward, and verifies tab disconnect shutdown, multiple tabs,
reconnection, and relaunch. `host-dashboard --no-browser` starts a persistent server
without opening LibreWolf for manual diagnostics. An existing persistent server
remains persistent if subsequently opened through the desktop launcher.

### Checkout-based installation

After building, run inside the Nix development shell:

```sh
node scripts/launch.mjs --install
```

This installs `Host Dashboard` in your application menu. It starts a background localhost production server if needed, waits for it, and opens LibreWolf. Logs live at `~/.cache/host-dashboard/server.log` (or `$XDG_CACHE_HOME/host-dashboard/server.log`). The entry records the current Node executable and checkout path; reinstall it if either moves. LibreWolf must be available on the desktop PATH. The server exits one second after the last dashboard tab disconnects.

## Checks

```sh
pnpm test
pnpm build
```
