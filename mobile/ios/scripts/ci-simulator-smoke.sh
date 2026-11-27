#!/usr/bin/env bash
# iOS Simulator build + boot smoke test for the Capacitor app (mobile/ios), used by
# .github/workflows/mobile-ios.yaml. macOS only (Xcode command line tools); bash 3.2 compatible.
#
#   mobile/ios/scripts/ci-simulator-smoke.sh build
#       xcodebuild the App scheme (Debug, iOS Simulator, no code signing) into $DERIVED_DATA.
#   mobile/ios/scripts/ci-simulator-smoke.sh run <kind>...      kind: duo | iphone | ipad
#       For each kind: create a fresh simulator (duo = iPhone Duo on the newest runtime that has
#       it, else the newest iPhone; iphone / ipad = newest on the newest runtime), install, launch
#       with `--mesh-smoke`, wait for
#       the app's DEBUG smoke probe (mobile/ios/App/App/MeshSmokeProbe.swift) to write
#       Documents/mesh-smoke.json, take screenshots, collect logs and crash reports.
#       Fails when the app crashes, never leaves the boot screen, or SQLite is not on OPFS.
#
#   mobile/ios/scripts/ci-simulator-smoke.sh select <kind>
#       Prints "<runtime id>|<runtime version>|<device type id>|<device name>" (used by tests).
#
# Run prerequisites: the mobile web bundle and `cap sync ios` (the workflow does both).
# Output: $OUT_DIR (screenshots, xcodebuild.log, per-device logs and mesh-smoke.json).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

OUT_DIR="${MESH_SMOKE_OUT:-build/ios-smoke}"
DERIVED_DATA="${MESH_SMOKE_DERIVED_DATA:-build/ios-derived}"
case "$OUT_DIR" in /*) ;; *) OUT_DIR="$ROOT/$OUT_DIR" ;; esac
case "$DERIVED_DATA" in /*) ;; *) DERIVED_DATA="$ROOT/$DERIVED_DATA" ;; esac
BUNDLE_ID="org.coloradomesh.meshclient"
APP_PATH="$DERIVED_DATA/Build/Products/Debug-iphonesimulator/App.app"
# The app gives up after APP_TIMEOUT s (a cold first boot of a new simulator can take minutes);
# the host waits a little longer for the result file.
APP_TIMEOUT="${MESH_SMOKE_TIMEOUT_S:-300}"
HOST_TIMEOUT=$((APP_TIMEOUT + 90))
REQUIRE_OPFS="${MESH_SMOKE_REQUIRE_OPFS:-1}"

log() { printf '%s\n' "$*"; }
gh_error() { printf '::error::%s\n' "$*"; }
gh_warning() { printf '::warning::%s\n' "$*"; }

summary() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n' "$*" >> "$GITHUB_STEP_SUMMARY"; fi
}

# version_ge A B: true when version A >= B (numeric, dot separated).
version_ge() {
  node -e '
    const [a, b] = process.argv.slice(1).map((v) => v.split(".").map(Number));
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = (a[i] || 0) - (b[i] || 0);
      if (d) process.exit(d > 0 ? 0 : 1);
    }
    process.exit(0);
  ' "$1" "$2"
}

cmd_build() {
  mkdir -p "$OUT_DIR"
  local sdk_version sdk_flags="" app_version status
  sdk_version="$(xcrun --sdk iphonesimulator --show-sdk-version)"
  # UIView.reservedRegions (iPhone Duo fold) exists from the iOS 27.1 SDK on.
  if ! version_ge "$sdk_version" 27.1; then sdk_flags="-DMESH_NO_RESERVED_REGIONS"; fi
  app_version="$(node -p 'require("./package.json").version')"
  log "Xcode: $(xcodebuild -version | tr '\n' ' ')"
  log "iOS Simulator SDK $sdk_version; MESH_SDK_SWIFT_FLAGS='$sdk_flags'; MARKETING_VERSION=$app_version"
  set +e
  xcodebuild \
    -project mobile/ios/App/App.xcodeproj \
    -scheme App \
    -configuration Debug \
    -sdk iphonesimulator \
    -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath "$DERIVED_DATA" \
    ARCHS=arm64 \
    ONLY_ACTIVE_ARCH=NO \
    CODE_SIGNING_ALLOWED=NO \
    "MARKETING_VERSION=$app_version" \
    "MESH_SDK_SWIFT_FLAGS=$sdk_flags" \
    build > "$OUT_DIR/xcodebuild.log" 2>&1
  status=$?
  set -e
  log "── Errors, and warnings in mobile/ios/App sources ─────────────────────────────"
  grep -E 'error: |/mobile/ios/App/App/.*warning: ' "$OUT_DIR/xcodebuild.log" | sort -u | head -400 || true
  if [ "$status" -ne 0 ]; then
    log "── xcodebuild.log (tail) ──────────────────────────────────────────────────────"
    tail -n 120 "$OUT_DIR/xcodebuild.log"
    gh_error "xcodebuild failed (exit $status); full log in the ios-simulator artifact (xcodebuild.log)"
    exit "$status"
  fi
  if [ ! -d "$APP_PATH" ]; then
    gh_error "build succeeded but $APP_PATH is missing"
    exit 1
  fi
  log "Built $APP_PATH"
}

# select_device KIND: prints "<runtime id>|<runtime version>|<device type id>|<device name>".
#   duo:    iPhone Duo on the newest iOS runtime that has it, else the newest iPhone (prefixed
#           with "fallback|" so the caller can warn).
#   iphone: newest "… Pro" iPhone (else newest iPhone) on the newest iOS runtime.
#   ipad:   newest iPad Pro (else newest iPad) on the newest iOS runtime.
# Exits 1 when nothing matches.
select_device() {
  xcrun simctl list runtimes --json | node -e '
    const kind = process.argv[1];
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const cmp = (a, b) => {
        const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
        for (let i = 0; i < Math.max(x.length, y.length); i++) {
          const d = (x[i] || 0) - (y[i] || 0);
          if (d) return d;
        }
        return 0;
      };
      const runtimes = JSON.parse(s).runtimes
        .filter((r) => r.isAvailable !== false && (r.platform === "iOS" || /^iOS\b/.test(r.name)))
        .sort((a, b) => cmp(b.version, a.version));
      const family = (t, f) => t.productFamily === f || (!t.productFamily && t.name.startsWith(f));
      const types = (r) => r.supportedDeviceTypes || [];
      const phone = (r) => {
        const phones = types(r).filter((t) => family(t, "iPhone") && !/Duo/i.test(t.name));
        return phones.filter((t) => / Pro$/.test(t.name)).pop() || phones.pop();
      };
      const pad = (r) => {
        const pads = types(r).filter((t) => family(t, "iPad"));
        return pads.filter((t) => /^iPad Pro/.test(t.name)).pop() || pads.pop();
      };
      const out = (prefix, r, t) => {
        console.log(`${prefix}${r.identifier}|${r.version}|${t.identifier}|${t.name}`);
        process.exit(0);
      };
      if (!runtimes.length) process.exit(1);
      if (kind === "duo") {
        for (const r of runtimes) {
          const duo = types(r).filter((t) => /iPhone Duo/i.test(t.name)).pop();
          if (duo) out("", r, duo);
        }
        const fallback = phone(runtimes[0]);
        if (fallback) out("fallback|", runtimes[0], fallback);
      } else if (kind === "iphone" || kind === "ipad") {
        const t = kind === "iphone" ? phone(runtimes[0]) : pad(runtimes[0]);
        if (t) out("", runtimes[0], t);
      }
      process.exit(1);
    });
  ' "$1"
}

# Reads a field from the smoke result JSON (dot path), "" when missing.
result_field() {
  node -e '
    const fs = require("fs");
    const [file, path] = process.argv.slice(1);
    try {
      let v = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const k of path.split(".")) v = v == null ? undefined : v[k];
      if (v !== undefined && v !== null) console.log(typeof v === "object" ? JSON.stringify(v) : String(v));
    } catch {}
  ' "$1" "$2"
}

screenshot() {
  local udid="$1" file="$2"
  xcrun simctl io "$udid" screenshot --type=png "$file" > /dev/null 2>&1 || gh_warning "screenshot $file failed"
}

FAILURES=0

# run_device KIND
run_device() {
  local kind="$1"
  local pick runtime runtime_version devtype devname udid dir pid container result started now
  local crashed=0 stream_pid=""
  if ! pick="$(select_device "$kind")"; then
    gh_error "no iOS simulator runtime / device type for '$kind'"
    FAILURES=$((FAILURES + 1))
    return
  fi
  case "$pick" in
    fallback\|*)
      pick="${pick#fallback|}"
      gh_warning "no installed iOS runtime has an iPhone Duo simulator; using the newest iPhone instead"
      ;;
  esac
  runtime="$(printf '%s' "$pick" | cut -d'|' -f1)"
  runtime_version="$(printf '%s' "$pick" | cut -d'|' -f2)"
  devtype="$(printf '%s' "$pick" | cut -d'|' -f3)"
  devname="$(printf '%s' "$pick" | cut -d'|' -f4)"
  dir="$OUT_DIR/$kind"
  mkdir -p "$dir"
  log "::group::$kind: $devname (iOS $runtime_version)"

  udid="$(xcrun simctl create "mesh-smoke-$kind" "$devtype" "$runtime")"
  log "Created $udid"
  xcrun simctl boot "$udid"
  xcrun simctl bootstatus "$udid" -b > /dev/null
  xcrun simctl status_bar "$udid" override --time 9:41 > /dev/null 2>&1 || true
  xcrun simctl install "$udid" "$APP_PATH"
  # Skip the location prompt so it does not cover the screenshots.
  xcrun simctl privacy "$udid" grant location "$BUNDLE_ID" > /dev/null 2>&1 || true
  container="$(xcrun simctl get_app_container "$udid" "$BUNDLE_ID" data)"
  result="$container/Documents/mesh-smoke.json"
  rm -f "$result"

  xcrun simctl spawn "$udid" log stream --level debug --style compact \
    --predicate 'subsystem == "org.coloradomesh.meshclient" OR process == "App"' \
    > "$dir/device-log-stream.txt" 2>&1 &
  stream_pid=$!

  started=$(date +%s)
  touch "$dir/.launched"
  export SIMCTL_CHILD_MESH_SMOKE_TIMEOUT_S="$APP_TIMEOUT"
  local launch_output
  launch_output="$(xcrun simctl launch --terminate-running-process \
    --stdout="$dir/app-stdout.log" --stderr="$dir/app-stderr.log" \
    "$udid" "$BUNDLE_ID" --mesh-smoke)"
  pid="${launch_output##*: }"
  log "Launched: $launch_output"

  local shot_early=0
  while :; do
    now=$(date +%s)
    if [ -f "$result" ]; then break; fi
    if ! kill -0 "$pid" 2> /dev/null; then
      crashed=1
      break
    fi
    if [ "$shot_early" -eq 0 ] && [ $((now - started)) -ge 20 ]; then
      screenshot "$udid" "$dir/screenshot-20s.png"
      shot_early=1
    fi
    if [ $((now - started)) -ge "$HOST_TIMEOUT" ]; then break; fi
    sleep 3
  done

  local status="" sqlite="" evidence="" key_backend="" elapsed="" problem=""
  if [ -f "$result" ]; then
    cp "$result" "$dir/mesh-smoke.json"
    # Let the UI settle, then make sure the app is still alive after mounting.
    sleep 4
    screenshot "$udid" "$dir/screenshot-booted.png"
    if ! kill -0 "$pid" 2> /dev/null; then crashed=1; fi
    status="$(result_field "$dir/mesh-smoke.json" status)"
    sqlite="$(result_field "$dir/mesh-smoke.json" sqlite)"
    evidence="$(result_field "$dir/mesh-smoke.json" sqliteEvidence)"
    key_backend="$(result_field "$dir/mesh-smoke.json" secureKeyBackend)"
    elapsed="$(result_field "$dir/mesh-smoke.json" elapsedMs)"
    log "Smoke result: status=$status sqlite=$sqlite ($evidence) secureKey=$key_backend elapsedMs=$elapsed"
    log "Folds: $(result_field "$dir/mesh-smoke.json" folds)"
    log "Viewport: $(result_field "$dir/mesh-smoke.json" state.viewport) mobile=$(result_field "$dir/mesh-smoke.json" state.mobile)"
  else
    screenshot "$udid" "$dir/screenshot-final.png"
  fi
  if grep -q 'main loaded (sqlite=' "$dir/app-stdout.log" 2> /dev/null; then
    log "Host log: $(grep -o 'main loaded (sqlite=[^)]*)' "$dir/app-stdout.log" | head -1)"
  fi

  if [ "$crashed" -eq 1 ]; then
    problem="app process $pid exited (crash or fatal error); see crash reports and app-stderr.log"
  elif [ ! -f "$dir/mesh-smoke.json" ]; then
    problem="no smoke result after ${HOST_TIMEOUT}s"
  elif [ "$status" != "booted" ]; then
    problem="app did not get past the boot screen (status=$status: $(result_field "$dir/mesh-smoke.json" state.bootError))"
  elif [ "$REQUIRE_OPFS" = "1" ] && [ "$sqlite" != "opfs-sahpool" ]; then
    problem="SQLite is not on OPFS (sqlite=$sqlite, evidence=$evidence): installOpfsSAHPoolVfs failed in WKWebView"
  fi

  # Logs and crash reports.
  xcrun simctl terminate "$udid" "$BUNDLE_ID" > /dev/null 2>&1 || true
  if [ -n "$stream_pid" ]; then kill "$stream_pid" > /dev/null 2>&1 || true; fi
  xcrun simctl spawn "$udid" log show --last 20m --style compact \
    --predicate 'subsystem == "org.coloradomesh.meshclient" OR process == "App"' \
    > "$dir/device-log.txt" 2>&1 || true
  find "$HOME/Library/Logs/DiagnosticReports" -newer "$dir/.launched" \( -name 'App*' -o -name '*.ips' \) \
    -exec cp {} "$dir/" \; 2> /dev/null || true
  rm -f "$dir/.launched"
  xcrun simctl shutdown "$udid" > /dev/null 2>&1 || true
  xcrun simctl delete "$udid" > /dev/null 2>&1 || true
  log "::endgroup::"

  if [ -n "$problem" ]; then
    gh_error "$kind ($devname, iOS $runtime_version): $problem"
    FAILURES=$((FAILURES + 1))
    if [ -f "$dir/mesh-smoke.json" ]; then
      log "Console lines captured by the probe:"
      result_field "$dir/mesh-smoke.json" console | node -e '
        let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
          try { for (const l of JSON.parse(s)) console.log("  " + l); } catch {}
        });'
    fi
    log "app-stderr.log (tail):"
    tail -n 60 "$dir/app-stderr.log" 2> /dev/null || true
    summary "| $kind | $devname | iOS $runtime_version | FAIL: $problem |"
  else
    summary "| $kind | $devname | iOS $runtime_version | booted in ${elapsed} ms, sqlite=$sqlite ($evidence), key=$key_backend |"
  fi
}

cmd_run() {
  if [ "$#" -eq 0 ]; then
    gh_error "usage: $0 run <duo|iphone|ipad>..."
    exit 2
  fi
  if [ ! -d "$APP_PATH" ]; then
    gh_error "$APP_PATH not found; run '$0 build' first"
    exit 1
  fi
  mkdir -p "$OUT_DIR"
  local kind
  summary "### iOS simulator smoke ($(xcodebuild -version | head -1))"
  summary ""
  summary "| Kind | Device | Runtime | Result |"
  summary "| --- | --- | --- | --- |"
  for kind in "$@"; do
    run_device "$kind"
  done
  if [ "$FAILURES" -gt 0 ]; then
    gh_error "$FAILURES simulator check(s) failed; screenshots and logs are in the ios-simulator artifact"
    exit 1
  fi
  log "All simulator checks passed."
}

case "${1:-}" in
  build) cmd_build ;;
  select) select_device "${2:-}" ;;
  run)
    shift
    cmd_run "$@"
    ;;
  *)
    printf 'usage: %s build | run <duo|iphone|ipad>... | select <kind>\n' "$0" >&2
    exit 2
    ;;
esac
