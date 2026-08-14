; electron-builder NSIS include — post-extract guard for silent partial installs (WoA).
; customFinish is not invoked by electron-builder; customInstall runs after files land.
; schema-upgrade-notice.nsh is always present: a no-op stub in git, overwritten by
; scripts/write-schema-upgrade-notice.mjs when this build bumps CURRENT_SCHEMA_VERSION.
; Keep the include even when the stub is empty — a missing file is NSIS warning 7000
; and electron-builder treats warnings as errors.

!include "${BUILD_RESOURCES_DIR}\schema-upgrade-notice.nsh"

!macro customInstall
  IfFileExists "$INSTDIR\Mesh-client.exe" finish_ok 0
    SetErrorLevel 2
    MessageBox MB_ICONSTOP|MB_OK "Installation incomplete: Mesh-client.exe is missing from $INSTDIR.$\r$\nPlease report this at github.com/Colorado-Mesh/mesh-client/issues." /SD IDOK
    Abort
  finish_ok:
  !ifdef MESH_CLIENT_SCHEMA_UPGRADE_NOTICE
    MessageBox MB_ICONEXCLAMATION|MB_OK "${MESH_CLIENT_SCHEMA_UPGRADE_NOTICE}" /SD IDOK
  !endif
!macroend
