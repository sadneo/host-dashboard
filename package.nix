{ lib, stdenvNoCC, nodejs_24, pnpm, fetchPnpmDeps, pnpmConfigHook, makeWrapper,
  makeDesktopItem, git, openssh, zellij, systemd, coreutils }:
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "host-dashboard";
  version = "0.1.0";
  src = lib.cleanSourceWith {
    src = ./.;
    filter = path: type:
      lib.cleanSourceFilter path type &&
      !builtins.elem (builtins.baseNameOf path) [ "node_modules" ".next" ".direnv" "result" ];
  };
  nativeBuildInputs = [ nodejs_24 pnpm pnpmConfigHook makeWrapper ];
  nativeCheckInputs = [ git ];
  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    inherit pnpm;
    fetcherVersion = 4;
    hash = "sha256-cVnoXf4SKEBV8jCkqo8EdMPTHEToxuXVGQ3ek7zElUU=";
  };
  NEXT_TELEMETRY_DISABLED = "1";
  buildPhase = ''
    runHook preBuild
    pnpm build
    runHook postBuild
  '';
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    pnpm test
    runHook postCheck
  '';
  installPhase = ''
    runHook preInstall
    mkdir -p $out/share/host-dashboard $out/bin
    cp -r .next/standalone/. $out/share/host-dashboard/
    cp -r public $out/share/host-dashboard/
    cp -r .next/static $out/share/host-dashboard/.next/
    cp -r scripts $out/share/host-dashboard/
    cp dashboard.config.json $out/share/host-dashboard/
    makeWrapper ${nodejs_24}/bin/node $out/bin/host-dashboard \
      --add-flags "$out/share/host-dashboard/scripts/launch.mjs" \
      --set DASHBOARD_COLLECTOR "$out/share/host-dashboard/scripts/collect-status.mjs" \
      --prefix PATH : ${lib.makeBinPath [ git openssh zellij systemd coreutils ]}
    cp -r ${makeDesktopItem {
      name = "host-dashboard";
      desktopName = "Host Dashboard";
      comment = "Live host status";
      exec = "host-dashboard";
      icon = "utilities-terminal";
      terminal = false;
      categories = [ "System" "Monitor" ];
    }}/share/applications $out/share/
    runHook postInstall
  '';
  meta = {
    description = "Local host dashboard with a LibreWolf desktop launcher";
    mainProgram = "host-dashboard";
    platforms = lib.platforms.linux;
  };
})
