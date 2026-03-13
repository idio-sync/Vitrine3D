; Vitrine3D NSIS Installer Hooks
; Offers optional file type associations during installation.
; .ddim is always registered via Tauri's bundle.fileAssociations.

!include "LogicLib.nsh"

; --- Helper: register a single file extension ---
!macro _RegisterExt EXT
    WriteRegStr SHCTX "Software\Classes\${EXT}" "" "Vitrine3D.File"
!macroend

; --- Helper: unregister a single file extension ---
!macro _UnregisterExt EXT
    ReadRegStr $0 SHCTX "Software\Classes\${EXT}" ""
    ${If} $0 == "Vitrine3D.File"
        DeleteRegKey SHCTX "Software\Classes\${EXT}"
    ${EndIf}
!macroend

; =============================================================================
; NSIS HOOKS
; =============================================================================

!macro NSIS_HOOK_POSTINSTALL
    ; Set up the shared file class that all extensions point to.
    WriteRegStr SHCTX "Software\Classes\Vitrine3D.File" "" "Vitrine3D File"
    WriteRegStr SHCTX "Software\Classes\Vitrine3D.File\DefaultIcon" "" "$INSTDIR\Vitrine3D.exe,0"
    WriteRegStr SHCTX "Software\Classes\Vitrine3D.File\shell\open\command" "" '"$INSTDIR\Vitrine3D.exe" "%1"'

    ; --- glTF / GLB (interchange formats) ---
    MessageBox MB_YESNO|MB_ICONQUESTION \
        "Associate glTF/GLB files with Vitrine3D?$\n$\n  .glb  .gltf$\n$\nYou can change this later in Windows Settings." \
        IDNO skip_gltf
        !insertmacro _RegisterExt ".glb"
        !insertmacro _RegisterExt ".gltf"
    skip_gltf:

    ; --- OBJ / STL (common CAD/print formats) ---
    MessageBox MB_YESNO|MB_ICONQUESTION \
        "Associate OBJ and STL files with Vitrine3D?$\n$\n  .obj  .stl$\n$\nYou can change this later in Windows Settings." \
        IDNO skip_objstl
        !insertmacro _RegisterExt ".obj"
        !insertmacro _RegisterExt ".stl"
    skip_objstl:

    ; --- Gaussian Splats (splat-specific formats) ---
    MessageBox MB_YESNO|MB_ICONQUESTION \
        "Associate Gaussian splat files with Vitrine3D?$\n$\n  .splat  .ksplat  .spz  .sog$\n$\nYou can change this later in Windows Settings." \
        IDNO skip_splats
        !insertmacro _RegisterExt ".splat"
        !insertmacro _RegisterExt ".ksplat"
        !insertmacro _RegisterExt ".spz"
        !insertmacro _RegisterExt ".sog"
    skip_splats:

    ; --- PLY (polygon mesh — also used for splats, but widely shared) ---
    MessageBox MB_YESNO|MB_ICONQUESTION \
        "Associate PLY files with Vitrine3D?$\n$\n  .ply$\n$\nNote: PLY is used by many applications. Only say Yes if you$\nprimarily use PLY for 3D scans or Gaussian splats.$\n$\nYou can change this later in Windows Settings." \
        IDNO skip_ply
        !insertmacro _RegisterExt ".ply"
    skip_ply:

    ; --- Point Clouds ---
    MessageBox MB_YESNO|MB_ICONQUESTION \
        "Associate point cloud files with Vitrine3D?$\n$\n  .e57$\n$\nYou can change this later in Windows Settings." \
        IDNO skip_pointclouds
        !insertmacro _RegisterExt ".e57"
    skip_pointclouds:

    ; Notify Windows shell that file associations have changed
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
    ; Remove all file associations we may have registered.
    !insertmacro _UnregisterExt ".glb"
    !insertmacro _UnregisterExt ".gltf"
    !insertmacro _UnregisterExt ".obj"
    !insertmacro _UnregisterExt ".stl"
    !insertmacro _UnregisterExt ".ply"
    !insertmacro _UnregisterExt ".splat"
    !insertmacro _UnregisterExt ".ksplat"
    !insertmacro _UnregisterExt ".spz"
    !insertmacro _UnregisterExt ".sog"
    !insertmacro _UnregisterExt ".e57"
    ; Clean up shared class key
    DeleteRegKey SHCTX "Software\Classes\Vitrine3D.File"

    ; Notify Windows shell
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'
!macroend
