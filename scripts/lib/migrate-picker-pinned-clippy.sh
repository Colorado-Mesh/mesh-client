# shellcheck shell=bash
# Migrate pre-clippy is_picker_pinned_path bodies to per-OS cfg blocks (see overlay patches).
migrate_picker_pinned_to_clippy_form() {
  local target_file="$1"
  [[ -f "${target_file}" ]] || return 1
  grep -q 'fn is_picker_pinned_path' "${target_file}" || return 1
  grep -q 'clippy does not see needless_bool' "${target_file}" && return 0

  python3 - "${target_file}" << 'PY'
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
text = path.read_text()
pattern = re.compile(
    r"fn is_picker_pinned_path\(path: &Path\) -> bool \{.*?\n\}",
    re.DOTALL,
)
replacement = """fn is_picker_pinned_path(path: &Path) -> bool {
    // One cfg block per OS so clippy does not see needless_bool / needless_return
    // after the other platform branches are cfg-stripped.
    #[cfg(target_os = "linux")]
    {
        path.to_string_lossy().starts_with("/proc/self/fd/")
    }
    #[cfg(target_os = "macos")]
    {
        path.to_string_lossy().starts_with("/.vol/")
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        let _ = path;
        false
    }
}"""
updated, n = pattern.subn(replacement, text, count=1)
if n != 1:
    sys.exit("migrate: expected one is_picker_pinned_path block")
path.write_text(updated)
PY
}

picker_pinned_overlay_core_present() {
  local paths_file="$1"
  local marker_grep="${2:-}"
  [[ -f "${paths_file}" ]] || return 1
  grep -q 'fn is_picker_pinned_path' "${paths_file}" || return 1
  [[ -n "${marker_grep}" ]] && grep -q "${marker_grep}" "${paths_file}" || return 1
  return 0
}
