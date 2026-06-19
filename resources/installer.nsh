; electron-builder NSIS include — post-install guard for silent partial installs (WoA).
; Surfaces missing Mesh-client.exe instead of reporting success with a broken tree.

!macro customFinish
  IfFileExists "$INSTDIR\Mesh-client.exe" finish_ok 0
    MessageBox MB_ICONSTOP|MB_OK "Installation incomplete: Mesh-client.exe is missing from $INSTDIR.$\r$\nPlease report this at github.com/Colorado-Mesh/mesh-client/issues."
    Abort
  finish_ok:
!macroend
