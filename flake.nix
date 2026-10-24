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
  };

  outputs = {
    self,
    nixpkgs,
    pnpm2nix,
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

    # Everything the Rust build reads: the crate tree and the src/shared
    # fixtures it include_str!s. Kept tight so app-only changes do not rebuild
    # the sidecar workspace.
    sidecarRepoSrc = nixpkgs.lib.fileset.toSource {
      root = ./.;
      fileset = nixpkgs.lib.fileset.unions [
        ./reticulum-sidecar
        ./src/shared
      ];
    };

    # Files the overlay apply step reads: scripts/apply-*.sh, their lib/
    # helpers, and the patch payloads.
    overlaySrc = nixpkgs.lib.fileset.toSource {
      root = ./.;
      fileset = nixpkgs.lib.fileset.unions [
        ./reticulum-sidecar/patches
        ./scripts/lib
        (nixpkgs.lib.fileset.fileFilter (file: nixpkgs.lib.hasPrefix "apply-" file.name) ./scripts)
      ];
    };

    # Reticulum stack sources — fetched at the reviewed revisions in
    # reticulum-sidecar/ratspeak-stack-pins.env, the single source of truth for
    # the stack (scripts/clone-ratspeak-stack.sh reads the same file). Pin bumps
    # need no flake.nix or flake.lock change; a missing pin fails evaluation.
    pinsEnv = builtins.readFile ./reticulum-sidecar/ratspeak-stack-pins.env;
    pinOf = name: let
      lines = builtins.filter builtins.isString (builtins.split "\n" pinsEnv);
      hits = builtins.filter (hit: hit != null) (
        map (line: builtins.match "${name}=([0-9a-f]{40})" line) lines
      );
    in
      if hits == []
      then throw "flake.nix: expected ${name}=<40-hex rev> in reticulum-sidecar/ratspeak-stack-pins.env — that file is the single source of truth for the Reticulum stack"
      else builtins.elemAt (builtins.head hits) 0;
    stackFetch = owner: repo: pinName:
      builtins.fetchTree {
        type = "github";
        inherit owner repo;
        rev = pinOf pinName;
      };
    rsstack = {
      rsReticulum = stackFetch "ratspeak" "rsReticulum" "RS_RETICULUM_PIN";
      rsLXMF = stackFetch "ratspeak" "rsLXMF" "RS_LXMF_PIN";
      rsNomad = stackFetch "Colorado-Mesh" "rsNomad" "RS_NOMAD_PIN";
      rsLXST = stackFetch "ratspeak" "rsLXST" "RS_LXST_PIN";
      "lrgp-rs" = stackFetch "ratspeak" "lrgp-rs" "RS_LRGP_PIN";
    };

    # We need a whole seperate build pipeline for building the reticulum sidecar
    # and thats what most of the ratspeak dependencies are for. The patched
    # stack is its own derivation so pin/overlay changes rebuild only this
    # cheap copy-and-patch step, and app changes rebuild neither it nor the
    # sidecar.
    patchedRsstack = pkgs:
      pkgs.stdenvNoCC.mkDerivation {
        name = "mesh-client-rsstack";
        src = overlaySrc;

        nativeBuildInputs = [
          pkgs.git
          pkgs.python3
        ];

        dontConfigure = true;
        dontBuild = true;

        unpackPhase = ''
          runHook preUnpack

          cp -r --no-preserve=mode "$src" source
          chmod -R u+w source
          cd source

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

          # Overlay apply order lives in scripts/lib/ratspeak-overlay-apply-list.sh
          # (shared with clone-ratspeak-stack / ensure-rsReticulum-patches).
          # rsLXST and lrgp-rs have no overlays.
          source scripts/lib/ratspeak-overlay-apply-list.sh
          for s in "''${RS_RETICULUM_APPLY_SCRIPTS[@]}" "''${RS_LXMF_APPLY_SCRIPTS[@]}" "''${RS_NOMAD_APPLY_SCRIPTS[@]}"; do
            bash "scripts/$s"
          done

          runHook postPatch
        '';

        installPhase = ''
          runHook preInstall
          mkdir -p $out
          cp -r .rsstack $out/
          runHook postInstall
        '';
      };

    # Assemble the sidecar workspace: crate tree + shared fixtures + the
    # patched stack.
    ratspeakStackSrc = pkgs:
      pkgs.runCommand "mesh-client-reticulum-sidecar-src" {} ''
        mkdir -p $out/src
        cp -r --no-preserve=mode ${sidecarRepoSrc}/reticulum-sidecar $out/
        cp -r --no-preserve=mode ${patchedRsstack pkgs}/.rsstack $out/
        cp -r --no-preserve=mode ${sidecarRepoSrc}/src/shared $out/src/
      '';

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
      electron = pkgs.electron_45;
      # package.json devDependencies.electron, e.g. "^44.9.3"
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
  in {
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
              # Sidecar build (reticulum-sidecar, needs rust-version 1.85+).
              rustc
              cargo
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
                # Sidecar build (reticulum-sidecar, needs rust-version 1.85+).
                rustc
                cargo
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
