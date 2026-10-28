; NSIS installer hooks (bundle.windows.nsis.installerHooks).
;
; Tauri registers the .torrent association with the app's .exe as its icon and has no
; option for a separate document icon. This runs after the association is written and
; points the file class (named after fileAssociations[].name) at torrent.ico, which is
; installed next to the .exe via bundle.resources. The uninstaller removes the whole
; class key, so no matching uninstall hook is needed.

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\BitTorrent File\DefaultIcon" "" "$INSTDIR\torrent.ico"
  ; SHCNE_ASSOCCHANGED: tell Explorer to refresh file icons now.
  System::Call "shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)"
!macroend
