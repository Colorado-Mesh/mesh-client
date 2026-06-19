; electron-builder NSIS include — post-extract guard for silent partial installs (WoA).
; customFinish is not invoked by electron-builder; customInstall runs after files land.

!macro customInstall
  IfFileExists "$INSTDIR\Mesh-client.exe" finish_ok 0
    SetErrorLevel 2
    MessageBox MB_ICONSTOP|MB_OK "Installation incomplete: Mesh-client.exe is missing from $INSTDIR.$\r$\nPlease report this at github.com/Colorado-Mesh/mesh-client/issues." /SD IDOK
    Abort
  finish_ok:
!macroend
