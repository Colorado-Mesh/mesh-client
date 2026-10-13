# flake.nix — build & run mesh-client on NixOS / macOS (aarch64).
#
# Usage:
#   nix run .#mesh-client        # build and launch the app
#   nix build .#mesh-client      # build to ./result
#   nix build .#reticulum-sidecar
#   nix develop && pnpm dev      # INTERACTIVE FHS shell: `pnpm install && pnpm dev`
{
  description = "mesh-client — Meshtastic / MeshCore / Reticulum Electron desktop client";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    pnpm2nix = {
      url = "github:FliegendeWurst/pnpm2nix-nzbr";
      flake = false;
    };

    # Reviewed Reticulum sidecar stack pins — revs must match
    # reticulum-sidecar/ratspeak-stack-pins.env (flake.lock stores the hashes).
    rsReticulum = {
      url = "github:ratspeak/rsReticulum/0f8731bb5b13e7f60e2d4bb38022480210009690";
      flake = false;
    };
    rsLXMF = {
      url = "github:ratspeak/rsLXMF/8bad5e2f1fdaa08592d153c2cc64af65366100f1";
      flake = false;
    };
    rsNomad = {
      url = "github:Colorado-Mesh/rsNomad/05ad8ece94e78e0281c17644e0a70d28218eba22";
      flake = false;
    };
    rsLXST = {
      url = "github:ratspeak/rsLXST/8acab49832ab7538c8672db2b365bd5764bf3944";
      flake = false;
    };
    lrgpRs = {
      url = "github:ratspeak/lrgp-rs/88c8665e1e7e1ad710e53e8da6425f3dbe4f5856";
      flake = false;
    };
  };

  outputs = {
    self,
    nixpkgs,
    pnpm2nix,
    rsReticulum,
    rsLXMF,
    rsNomad,
    rsLXST,
    lrgpRs,
  }: let
    systems = [
      "x86_64-linux"
      "aarch64-linux"
      "aarch64-darwin"
    ];
    forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system nixpkgs.legacyPackages.${system});

    packageJson = builtins.fromJSON (builtins.readFile ./package.json);
    version = packageJson.version;

    buildSrc = nixpkgs.lib.cleanSourceWith {
      src = ./.;
      filter = path: type: let
        name = nixpkgs.lib.baseNameOf path;
      in
        name != "flake.nix" && name != "flake.lock";
    };

    pinsEnv = builtins.readFile ./reticulum-sidecar/ratspeak-stack-pins.env;
    pinOf = name: let
      lines = builtins.filter builtins.isString (builtins.split "\n" pinsEnv);
      hits = builtins.filter (hit: hit != null) (
        map (line: builtins.match "${name}=([0-9a-f]{40})" line) lines
      );
    in
      if hits == []
      then throw "flake.nix: pin ${name} missing from reticulum-sidecar/ratspeak-stack-pins.env"
      else builtins.elemAt (builtins.head hits) 0;
    stackSrc = name: pinName: input:
      if (input.rev or null) == pinOf pinName
      then input
      else throw "flake.nix input ${name} rev ${input.rev or "?"} does not match ${pinName} in reticulum-sidecar/ratspeak-stack-pins.env — update the input URL, then run `nix flake lock`";
    rsstack = {
      rsReticulum = stackSrc "rsReticulum" "RS_RETICULUM_PIN" rsReticulum;
      rsLXMF = stackSrc "rsLXMF" "RS_LXMF_PIN" rsLXMF;
      rsNomad = stackSrc "rsNomad" "RS_NOMAD_PIN" rsNomad;
      rsLXST = stackSrc "rsLXST" "RS_LXST_PIN" rsLXST;
      "lrgp-rs" = stackSrc "lrgpRs" "RS_LRGP_PIN" lrgpRs;
    };
    pinsGuard = builtins.deepSeq rsstack true;

    # Overlay apply order — keep in sync with
    # scripts/lib/ratspeak-overlay-apply-list.sh (patch basenames without
    # .patch). rsLXST and lrgp-rs have no overlays.
    overlayOrder = {
      rsReticulum = [
        "rsReticulum-reply-file-query-metadata"
        "rsReticulum-packet-tap"
        "rsReticulum-auto-beacon-utun"
        "rsReticulum-link-client-proof-budget"
        "rsReticulum-ble-rnode-pairing-transition-debounce"
        "rsReticulum-ble-rnode-bond-desync"
        "rsReticulum-discovery-announce-egress"
        "rsReticulum-path-medium-slots"
        "rsReticulum-inbound-raw-saturation-log"
        "rsReticulum-interface-tx-queue-stats"
        "rsReticulum-announce-rebroadcast-exclude-rf"
        "rsReticulum-ble-rnode-flow-control-ready-timeout"
        "rsReticulum-ble-rnode-host-rssi-cache"
        "rsReticulum-response-resource-window-fast"
        "rsReticulum-rncp-picker-pinned-jail"
        "rsReticulum-rncp-inbound-admission"
      ];
      rsLXMF = [
        "rsLXMF-file-attachments-list"
        "rsLXMF-propagation-sync-peering"
        "rsLXMF-propagation-node-policy-setters"
        "rsLXMF-propagation-node-deferred-messagestore-load"
        "rsLXMF-link-delivery-has-pending-to"
        "rsLXMF-propagation-client-abort-transfer"
        "rsLXMF-propagation-client-lrproof-diagnostics"
        "rsLXMF-propagation-client-request-resource"
      ];
      rsNomad = ["rsNomad-picker-pinned-roots"];
    };

    # We need a whole seperate build pipeline for building the reticulum sidecar
    # and thats what most of the ratspeak dependencies are for.
    ratspeakStackSrc = pkgs: let
      lib = pkgs.lib;
      applyScripts = map (n: "scripts/apply-${n}.sh") (
        overlayOrder.rsReticulum ++ overlayOrder.rsLXMF ++ overlayOrder.rsNomad
      );
    in
      pkgs.stdenvNoCC.mkDerivation {
        name = "mesh-client-reticulum-sidecar-src";
        src = buildSrc;

        nativeBuildInputs = [
          pkgs.git
          pkgs.python3
        ];

        dontConfigure = true;
        dontBuild = true;

        unpackPhase = ''
          runHook preUnpack

          unpackFile "$src"
          cd "$(stripHash "$src")"
          chmod -R u+w .

          mkdir -p .rsstack
          cp -r --no-preserve=mode ${rsstack.rsReticulum} .rsstack/rsReticulum
          cp -r --no-preserve=mode ${rsstack.rsLXMF} .rsstack/rsLXMF
          cp -r --no-preserve=mode ${rsstack.rsNomad} .rsstack/rsNomad
          cp -r --no-preserve=mode ${rsstack.rsLXST} .rsstack/rsLXST
          cp -r --no-preserve=mode ${rsstack."lrgp-rs"} .rsstack/lrgp-rs

          runHook postUnpack
        '';

        patchPhase = ''
          runHook prePatch

          # Some apply-*.sh resolve REPO_ROOT via `git rev-parse
          # --show-toplevel` from the scripts dir; others require .git in each
          # dependency checkout. Provide both.
          git init -q
          for repo in rsReticulum rsLXMF rsNomad rsLXST lrgp-rs; do
            (cd ".rsstack/$repo"
              git init -q
              git add -A
              git -c user.email=nix@localhost -c user.name=nix commit -qm 'upstream snapshot')
          done

          ${lib.concatMapStringsSep "\n" (s: "bash ${s}") applyScripts}

          runHook postPatch
        '';

        installPhase = ''
          runHook preInstall
          mkdir -p $out/src
          cp -r reticulum-sidecar $out/
          cp -r .rsstack $out/
          # interface_catalog.rs / rf_profiles.rs include_str! these from
          # ../src/shared and ../../../src/shared relative to the crate.
          cp -r src/shared $out/src/
          runHook postInstall
        '';
      };

    mkReticulumSidecar = pkgs:
      pkgs.rustPlatform.buildRustPackage (finalAttrs: {
        pname = "mesh-client-reticulum";
        inherit version;
        src = ratspeakStackSrc pkgs;

        cargoRoot = "reticulum-sidecar";
        buildAndTestSubdir = "reticulum-sidecar";
        cargoLock.lockFile = ./reticulum-sidecar/Cargo.lock;
        buildFeatures = [
          "rns-stack"
          "rns-ble"
          "rns-rnode-tcp"
        ];

        doCheck = false;

        nativeBuildInputs =
          [
            pkgs.pkg-config
          ]
          ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [
            pkgs.autoPatchelfHook
          ];

        # btleplug → BlueZ over dbus (Linux) / CoreBluetooth (macOS, no deps);
        # libusb for serial backends. udev + autoPatchelf are Linux-only.
        buildInputs =
          [
            pkgs.libusb1
          ]
          ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [
            pkgs.dbus
            pkgs.udev
            pkgs.stdenv.cc.cc.lib # libgcc_s for autoPatchelf
          ];

        meta = {
          description = "Headless Reticulum/LXMF daemon for mesh-client (BLE/GATT + RNS stack)";
          homepage = "https://github.com/Colorado-Mesh/mesh-client";
          license = pkgs.lib.licenses.agpl3Plus;
          platforms = systems;
          mainProgram = "mesh-client-reticulum";
        };
      });

    mkMeshClient = pkgs: reticulumSidecar: let
      lib = pkgs.lib;
      electron = pkgs.electron_44;
      # package.json devDependencies.electron, e.g. "^44.1.1"
      electronPin = lib.removePrefix "^" packageJson.devDependencies.electron;
      electronPinMajor = lib.head (lib.splitString "." electronPin);
      mkPnpmPackage = (pkgs.callPackage "${pnpm2nix}/derivation.nix" {}).mkPnpmPackage;
    in
      assert lib.assertMsg (
        lib.versions.major electron.version == electronPinMajor
      ) "nixpkgs electron ${electron.version} major must match package.json electron pin ${packageJson.devDependencies.electron}";
        mkPnpmPackage {
          pname = "mesh-client";
          inherit version;
          src = buildSrc;

          # Explicit paths (not ${src}/…) so the lockfile IFD caches across
          # unrelated source changes, per pnpm2nix-nzbr's README.
          packageJSON = ./package.json;
          pnpmLockYaml = ./pnpm-lock.yaml;
          pnpmWorkspaceYaml = ./pnpm-workspace.yaml;

          nodejs = pkgs.nodejs_22;
          pnpm = pkgs.pnpm_12;
          script = "build";

          # helps prevent unecessary rebuilds
          PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN = "false";

          postConfigure = "patchShebangs node_modules/{*,.*}";

          extraNativeBuildInputs = [
            pkgs.makeWrapper
            pkgs.copyDesktopItems
          ];

          desktopItems = [
            (pkgs.makeDesktopItem {
              name = "mesh-client";
              desktopName = "Mesh Client";
              comment = packageJson.description;
              exec = "mesh-client %U";
              icon = "mesh-client";
              # Matches electron-builder.yml linux.desktop.entry.StartupWMClass.
              startupWMClass = "com.mesh-client.app";
              categories = [
                "Utility"
                "Network"
              ];
              terminal = false;
            })
          ];

          installPhase = ''
            runHook preInstall

            # Ship only the production dependency closure (main-process
            # externals + transitives; renderer is fully bundled). pnpm prune
            # can't run offline, so walk package.json dependencies from the
            # hoisted node_modules and copy just that closure.
            node <<'PROD_EOF' > prod-modules.txt
            const fs = require('fs');
            const path = require('path');
            const seen = new Set();
            const roots = Object.keys(
              JSON.parse(fs.readFileSync('package.json', 'utf8')).dependencies || {},
            );
            function walk(name) {
              if (seen.has(name)) return;
              seen.add(name);
              const pj = path.join('node_modules', name, 'package.json');
              if (!fs.existsSync(pj)) return;
              const deps = JSON.parse(fs.readFileSync(pj, 'utf8')).dependencies || {};
              Object.keys(deps).forEach(walk);
            }
            roots.forEach(walk);
            process.stdout.write([...seen].sort().join('\n') + '\n');
            process.stderr.write('production closure: ' + seen.size + ' packages\n');
            PROD_EOF
            mkdir -p node_modules-prod
            while IFS= read -r mod; do
              [ -e "node_modules/$mod" ] || continue
              mkdir -p "node_modules-prod/$(dirname "$mod")"
              cp -a "node_modules/$mod" "node_modules-prod/$mod"
            done < prod-modules.txt
            rm -rf node_modules
            mv node_modules-prod node_modules

            mkdir -p $out/lib/mesh-client
            cp -a package.json dist dist-electron node_modules resources $out/lib/mesh-client/
            chmod -R u+w $out/lib/mesh-client

            # Unpackaged sidecar lookup: <appRoot>/resources/reticulum-sidecar/
            # (src/main/reticulum-sidecar-path.ts).
            ln -sfn ${reticulumSidecar}/bin/mesh-client-reticulum \
              $out/lib/mesh-client/resources/reticulum-sidecar/mesh-client-reticulum

            for size in 16x16 32x32 64x64 128x128 256x256; do
              install -Dm644 resources/icons/linux/$size.png \
                $out/share/icons/hicolor/$size/apps/mesh-client.png
            done

            makeWrapper ${lib.getExe electron} $out/bin/mesh-client \
              --set-default ELECTRON_IS_DEV 0 \
              --add-flags "$out/lib/mesh-client" \
              --add-flags "--disable-setuid-sandbox" \
              --add-flags "\''${NIXOS_OZONE_WL:+''${WAYLAND_DISPLAY:+--ozone-platform-hint=auto --enable-features=WaylandWindowDecorations --enable-wayland-ime=true}}"

            runHook postInstall
          '';

          meta = {
            description = packageJson.description;
            homepage = "https://github.com/Colorado-Mesh/mesh-client";
            license = lib.licenses.gpl3Plus;
            mainProgram = "mesh-client";
            platforms = systems;
          };
        };
    # Force the pin drift guard before any output is used.
  in
    builtins.seq pinsGuard {
      packages = forAllSystems (
        _system: pkgs: rec {
          "reticulum-sidecar" = mkReticulumSidecar pkgs;
          "mesh-client" = mkMeshClient pkgs reticulum-sidecar;
          default = mesh-client;
        }
      );

      apps = forAllSystems (
        system: _pkgs: {
          "mesh-client" = {
            type = "app";
            program = "${self.packages.${system}.mesh-client}/bin/mesh-client";
          };
          default = self.apps.${system}.mesh-client;
        }
      );

      devShells = forAllSystems (_system: pkgs: {
        default =
          if pkgs.stdenv.hostPlatform.isDarwin
          then
            # macOS: the downloaded Electron binary runs natively — no FHS
            # chroot needed, so a plain mkShell with the toolchain suffices.
            pkgs.mkShell {
              name = "mesh-client-dev-shell";
              packages = with pkgs; [
                nodejs_22
                pnpm_12
                git
                python3
                pkg-config
              ];
            }
          else
            (pkgs.buildFHSEnv {
              name = "mesh-client-dev-shell";
              # Lets the repo scripts download and run the official Electron
              # binary (`pnpm install && pnpm dev`) inside the FHS chroot.
              targetPkgs = p:
                with p; [
                  nodejs_22
                  pnpm_12
                  git
                  python3
                  pkg-config
                  alsa-lib
                  atk
                  at-spi2-atk
                  cairo
                  cups
                  dbus
                  expat
                  glib
                  gtk3
                  libdrm
                  libgbm
                  libglvnd
                  libnotify
                  libxkbcommon
                  mesa
                  nspr
                  nss
                  pango
                  udev
                  libx11
                  libxcomposite
                  libxdamage
                  libxext
                  libxfixes
                  libxrandr
                  libxcb
                ];
              runScript = "bash";
            }).env;
      });
    };
}
