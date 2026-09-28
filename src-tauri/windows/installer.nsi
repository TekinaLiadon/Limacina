Unicode true
ManifestDPIAware true
ManifestDPIAwareness PerMonitorV2

!if "{{compression}}" == "none"
  SetCompress off
!else
  SetCompressor /SOLID "{{compression}}"
!endif

{{#if signed_plugins_path}}
!addplugindir "{{signed_plugins_path}}"
{{/if}}

!include MUI2.nsh
!include FileFunc.nsh
!include x64.nsh
!include WordFunc.nsh
!include "utils.nsh"
!include "FileAssociation.nsh"
!include "Win\COM.nsh"
!include "Win\Propkey.nsh"
!include "Win\RestartManager.nsh"
!include "StrFunc.nsh"
${StrCase}
${StrLoc}

{{#if installer_hooks}}
!include "{{installer_hooks}}"
{{/if}}

!define WEBVIEW2APPGUID "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

!define MANUFACTURER "{{manufacturer}}"
!define PRODUCTNAME "{{product_name}}"
!define VERSION "{{version}}"
!define VERSIONWITHBUILD "{{version_with_build}}"
!define HOMEPAGE "{{homepage}}"
!define INSTALLMODE "{{install_mode}}"
!define INSTALLERICON "{{installer_icon}}"
!define UNINSTALLERICON "{{uninstaller_icon}}"
!define MAINBINARYNAME "{{main_binary_name}}"
!define MAINBINARYSRCPATH "{{main_binary_path}}"
!define BUNDLEID "{{bundle_id}}"
!define COPYRIGHT "{{copyright}}"
!define OUTFILE "{{out_file}}"
!define ARCH "{{arch}}"
!define ADDITIONALPLUGINSPATH "{{additional_plugins_path}}"
!define ALLOWDOWNGRADES "{{allow_downgrades}}"
!define DISPLAYLANGUAGESELECTOR "{{display_language_selector}}"
!define INSTALLWEBVIEW2MODE "{{install_webview2_mode}}"
!define WEBVIEW2INSTALLERARGS "{{webview2_installer_args}}"
!define WEBVIEW2BOOTSTRAPPERPATH "{{webview2_bootstrapper_path}}"
!define WEBVIEW2INSTALLERPATH "{{webview2_installer_path}}"
!define MINIMUMWEBVIEW2VERSION "{{minimum_webview2_version}}"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}"
!define MANUKEY "Software\${MANUFACTURER}"
!define MANUPRODUCTKEY "${MANUKEY}\${PRODUCTNAME}"
!define UNINSTALLERSIGNCOMMAND "{{uninstaller_sign_cmd}}"
!define ESTIMATEDSIZE "{{estimated_size}}"
!define STARTMENUFOLDER "{{start_menu_folder}}"

!define COLOR_BG "0x0F0605"
!define COLOR_BG_INPUT "0x1D1311"
!define COLOR_SURFACE "0x2E1A14"
!define COLOR_TEXT "0xF8ECD8"
!define COLOR_MUTED "0xBAA79D"
!define COLOR_ACCENT "0xF33A66"
!define FONTFACE "Segoe UI"
!define /ifndef WM_SETFONT 0x0030
!define /ifndef WM_SETTEXT 0x000C
!define /ifndef PBM_SETBARCOLOR 0x0409
!define /ifndef PBM_SETBKCOLOR 0x2001
!define /ifndef SS_CENTER 0x00000001
!define /ifndef SS_CENTERIMAGE 0x00000200
!define /ifndef WS_EX_TRANSPARENT 0x00000020
!define /ifndef WS_TABSTOP 0x00010000
!define /ifndef WS_GROUP 0x00020000
!define /ifndef BST_CHECKED 0x0001
!define /ifndef DM_SETDEFID 0x0401

Var PassiveMode
Var UpdateMode
Var NoShortcutMode
Var WixMode
Var OldMainBinaryName
Var ReinstallPageCheck
Var DIALOG
Var DPI
Var FontsReady
Var FontHeading
Var FontBody
Var FontCaption
Var FontButton
Var FontHeader
Var HeaderFixed
Var BrandingFixed
Var DirField
Var RunAppCheckbox
Var DesktopShortcutCheckbox
Var NavOverlay1
Var NavOverlay2
Var NavOverlay3
Var NavPill1
Var NavPill2
Var NavPill3
Var NavX1
Var NavY1
Var NavH1
Var NavW
Var NavGap
Var NavCacheY
Var NavCacheH
Var NavCacheX1
Var NavCacheW1
Var NavCacheX2
Var NavCacheW2
Var FocusPill
Var Radio1
Var Radio2
Var StepDot1
Var StepDot2
Var StepDot3
Var KeepGameData
Var KeepDataCheckbox
Var DataStateLabel
Var ConfirmDataPath

!macro NavReadRect _hwnd
  System::Call '*(i 0, i 0, i 0, i 0) p.r1'
  System::Call 'user32::GetWindowRect(p `${_hwnd}`, p r1)'
  System::Call '*$1(i .r2, i .r3, i .r4, i .r5)'
  System::Call '*(i r4, i r5) p.r8'
  System::Call 'user32::ScreenToClient(p $HWNDPARENT, p r1)'
  System::Call 'user32::ScreenToClient(p $HWNDPARENT, p r8)'
  System::Call '*$1(i .r2, i .r3)'
  System::Call '*$8(i .r4, i .r5)'
  System::Free $1
  System::Free $8
  IntOp $6 $4 - $2
  IntOp $7 $5 - $3
!macroend

!macro LabelHeight _px
  IntOp $9 `${_px}` * $DPI
  IntOp $9 $9 / 96
  IntOp $9 $9 * 10
  IntOp $9 $9 / 14
  IntOp $9 $9 + 8
!macroend

!macro MakeNavOverlay _var _id _text _fg _bg _tab
  StrCpy `${_var}` 0
  StrCpy $NavPill${_id} 0
  !if `${_id}` == "1"
    ${If} $NavCacheY = 0
      GetDlgItem $0 $HWNDPARENT 1
      !insertmacro NavReadRect $0
      StrCpy $NavCacheX1 $2
      StrCpy $NavCacheW1 $6
      StrCpy $NavCacheY $3
      StrCpy $NavCacheH $7
      GetDlgItem $0 $HWNDPARENT 2
      !insertmacro NavReadRect $0
      StrCpy $NavCacheX2 $2
      StrCpy $NavCacheW2 $6
    ${EndIf}
    IntOp $NavW $NavCacheW1 + 40
    IntOp $9 $NavCacheX1 + $NavCacheW1
    IntOp $NavGap $NavCacheX2 - $9
    IntOp $2 $NavCacheX2 + $NavCacheW2
    IntOp $2 $2 - $NavW
    IntOp $NavX1 $2 - $NavGap
    IntOp $NavX1 $NavX1 - $NavW
    StrCpy $NavY1 $NavCacheY
    StrCpy $NavH1 $NavCacheH
  !endif
  !if `${_text}` != ""
    GetDlgItem $0 $HWNDPARENT `${_id}`
    ${If} $0 <> 0
      ShowWindow $0 0
      System::Call 'user32::SetWindowPos(p $0, p 0, i -32000, i -32000, i 0, i 0, i 0x15)'
      !if `${_id}` == "1"
        StrCpy $2 $NavX1
        StrCpy $3 $NavY1
        StrCpy $6 $NavW
        StrCpy $7 $NavH1
      !endif
      !if `${_id}` == "2"
        IntOp $2 $NavCacheX2 + $NavCacheW2
        IntOp $2 $2 - $NavW
        StrCpy $3 $NavCacheY
        StrCpy $6 $NavW
        StrCpy $7 $NavCacheH
      !endif
      !if `${_id}` == "3"
        IntOp $2 $NavX1 - $NavGap
        IntOp $2 $2 - $NavW
        StrCpy $3 $NavCacheY
        StrCpy $6 $NavW
        StrCpy $7 $NavCacheH
      !endif
      !if "${_tab}" == "1"
        System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w `${_text}`, i 0x50010301, i r2, i r3, i r6, i r7, p $HWNDPARENT, p `${_id}`, p 0, p 0) p.s'
      !else
        System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w `${_text}`, i 0x50000301, i r2, i r3, i r6, i r7, p $HWNDPARENT, p `${_id}`, p 0, p 0) p.s'
      !endif
      Pop `${_var}`
      SetCtlColors `${_var}` `${_fg}` `${_bg}`
      SendMessage `${_var}` ${WM_SETFONT} $FontButton 1
    ${EndIf}
  !endif
!macroend

!macro NavButtons _t1 _t2 _t3 _tab
  !insertmacro DestroyNavOverlaysCore
  !insertmacro MakeNavOverlay $NavOverlay1 1 `${_t1}` 0xFFFFFF ${COLOR_ACCENT} ${_tab}
  !insertmacro MakeNavOverlay $NavOverlay2 2 `${_t2}` ${COLOR_MUTED} ${COLOR_SURFACE} ${_tab}
  !insertmacro MakeNavOverlay $NavOverlay3 3 `${_t3}` ${COLOR_TEXT} ${COLOR_SURFACE} ${_tab}
!macroend

!macro DisableNavOverlaysExceptCancel
  ${If} $NavOverlay1 <> 0
    EnableWindow $NavOverlay1 0
  ${EndIf}
  ${If} $NavOverlay3 <> 0
    EnableWindow $NavOverlay3 0
  ${EndIf}
!macroend

!macro DestroyNavOverlaysCore
  ${If} $NavOverlay1 <> 0
    System::Call 'user32::DestroyWindow(p $NavOverlay1)'
    StrCpy $NavOverlay1 0
  ${EndIf}
  ${If} $NavOverlay2 <> 0
    System::Call 'user32::DestroyWindow(p $NavOverlay2)'
    StrCpy $NavOverlay2 0
  ${EndIf}
  ${If} $NavOverlay3 <> 0
    System::Call 'user32::DestroyWindow(p $NavOverlay3)'
    StrCpy $NavOverlay3 0
  ${EndIf}
  ${If} $NavPill1 <> 0
    System::Call 'user32::DestroyWindow(p $NavPill1)'
    StrCpy $NavPill1 0
  ${EndIf}
  ${If} $NavPill2 <> 0
    System::Call 'user32::DestroyWindow(p $NavPill2)'
    StrCpy $NavPill2 0
  ${EndIf}
  ${If} $NavPill3 <> 0
    System::Call 'user32::DestroyWindow(p $NavPill3)'
    StrCpy $NavPill3 0
  ${EndIf}
  ${If} $FocusPill <> 0
    System::Call 'user32::DestroyWindow(p $FocusPill)'
    StrCpy $FocusPill 0
  ${EndIf}
!macroend

Function DestroyNavOverlays
  !insertmacro DestroyNavOverlaysCore
FunctionEnd

Function un.DestroyNavOverlays
  !insertmacro DestroyNavOverlaysCore
FunctionEnd

!macro FocusRing _overlay _color
  !insertmacro NavReadRect `${_overlay}`
  IntOp $4 $DPI * 2
  IntOp $4 $4 / 96
  IntOp $2 $2 - $4
  IntOp $3 $3 - $4
  IntOp $6 $6 + $4
  IntOp $6 $6 + $4
  IntOp $7 $7 + $4
  IntOp $7 $7 + $4
  ${If} $FocusPill = 0
    System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "", i 0x40000000, i r2, i r3, i r6, i r7, p $HWNDPARENT, p 0, p 0, p 0) p.s'
    Pop $FocusPill
  ${EndIf}
  SetCtlColors $FocusPill "" `${_color}`
  System::Call 'user32::SetWindowPos(p $FocusPill, p `${_overlay}`, i r2, i r3, i r6, i r7, i 0x50)'
!macroend

!macro FocusPollCore
  System::Call 'user32::GetFocus() p.r0'
  ${If} $0 = 0
    Return
  ${EndIf}
  ${If} $0 = $NavOverlay1
    !insertmacro FocusRing $NavOverlay1 0xFFFFFF
    SendMessage $HWNDPARENT ${DM_SETDEFID} 1 0
  ${ElseIf} $0 = $NavOverlay2
    !insertmacro FocusRing $NavOverlay2 ${COLOR_ACCENT}
    SendMessage $HWNDPARENT ${DM_SETDEFID} 2 0
  ${ElseIf} $0 = $NavOverlay3
    !insertmacro FocusRing $NavOverlay3 ${COLOR_ACCENT}
    SendMessage $HWNDPARENT ${DM_SETDEFID} 3 0
  ${Else}
    ${If} $FocusPill <> 0
      ShowWindow $FocusPill 0
    ${EndIf}
    SendMessage $HWNDPARENT ${DM_SETDEFID} 1 0
  ${EndIf}
!macroend

Function FocusPoll
  !insertmacro FocusPollCore
FunctionEnd

Function un.FocusPoll
  !insertmacro FocusPollCore
FunctionEnd

!macro DestroyStepDotsCore
  ${If} $StepDot1 <> 0
    System::Call 'user32::DestroyWindow(p $StepDot1)'
    StrCpy $StepDot1 0
  ${EndIf}
  ${If} $StepDot2 <> 0
    System::Call 'user32::DestroyWindow(p $StepDot2)'
    StrCpy $StepDot2 0
  ${EndIf}
  ${If} $StepDot3 <> 0
    System::Call 'user32::DestroyWindow(p $StepDot3)'
    StrCpy $StepDot3 0
  ${EndIf}
!macroend

!macro CreateStepDot _var _num _fg _bg
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "${_num}", i 0x50000201, i r5, i r9, i r1, i r1, p $HWNDPARENT, p 0, p 0, p 0) p.s'
  Pop ${_var}
  SetCtlColors ${_var} ${_fg} ${_bg}
  SendMessage ${_var} ${WM_SETFONT} $FontCaption 1
!macroend

!macro ShowStepDots _active
  !insertmacro DestroyStepDotsCore
  !if "${_active}" != "0"
    GetDlgItem $0 $HWNDPARENT 1037
    ${If} $0 <> 0
      !insertmacro NavReadRect $0
      IntOp $1 $DPI * 12
      IntOp $1 $1 / 96
      IntOp $4 $DPI * 6
      IntOp $4 $4 / 96
      IntOp $8 $1 * 3
      IntOp $5 $4 * 2
      IntOp $8 $8 + $5
      IntOp $5 $2 + $6
      IntOp $5 $5 - $8
      IntOp $8 $7 / 2
      IntOp $9 $3 + $8
      IntOp $8 $1 / 2
      IntOp $9 $9 - $8
      IntOp $8 $1 + $4
      !if "${_active}" == "1"
        !insertmacro CreateStepDot $StepDot1 "1" 0xFFFFFF ${COLOR_ACCENT}
      !else
        !insertmacro CreateStepDot $StepDot1 "1" ${COLOR_MUTED} ${COLOR_BG}
      !endif
      IntOp $5 $5 + $8
      !if "${_active}" == "2"
        !insertmacro CreateStepDot $StepDot2 "2" 0xFFFFFF ${COLOR_ACCENT}
      !else
        !insertmacro CreateStepDot $StepDot2 "2" ${COLOR_MUTED} ${COLOR_BG}
      !endif
      IntOp $5 $5 + $8
      !if "${_active}" == "3"
        !insertmacro CreateStepDot $StepDot3 "3" 0xFFFFFF ${COLOR_ACCENT}
      !else
        !insertmacro CreateStepDot $StepDot3 "3" ${COLOR_MUTED} ${COLOR_BG}
      !endif
    ${EndIf}
  !endif
!macroend

Name "${PRODUCTNAME}"
BrandingText "${COPYRIGHT}"
OutFile "${OUTFILE}"

!define PLACEHOLDER_INSTALL_DIR "placeholder\${PRODUCTNAME}"
InstallDir "${PLACEHOLDER_INSTALL_DIR}"

VIProductVersion "${VERSIONWITHBUILD}"
VIAddVersionKey "ProductName" "${PRODUCTNAME}"
VIAddVersionKey "FileDescription" "${PRODUCTNAME}"
VIAddVersionKey "LegalCopyright" "${COPYRIGHT}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"

!addplugindir "${ADDITIONALPLUGINSPATH}"

!if "${UNINSTALLERSIGNCOMMAND}" != ""
  !uninstfinalize '${UNINSTALLERSIGNCOMMAND}'
!endif

!if "${INSTALLMODE}" == "perMachine"
  RequestExecutionLevel admin
!endif

!if "${INSTALLMODE}" == "currentUser"
  RequestExecutionLevel user
!endif

!if "${INSTALLMODE}" == "both"
  !define MULTIUSER_MUI
  !define MULTIUSER_INSTALLMODE_INSTDIR "${PRODUCTNAME}"
  !define MULTIUSER_INSTALLMODE_COMMANDLINE
  !if "${ARCH}" == "x64"
    !define MULTIUSER_USE_PROGRAMFILES64
  !else if "${ARCH}" == "arm64"
    !define MULTIUSER_USE_PROGRAMFILES64
  !endif
  !define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_KEY "${UNINSTKEY}"
  !define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_VALUENAME "CurrentUser"
  !define MULTIUSER_INSTALLMODEPAGE_SHOWUSERNAME
  !define MULTIUSER_INSTALLMODE_FUNCTION RestorePreviousInstallLocation
  !define MULTIUSER_EXECUTIONLEVEL Highest
  !include MultiUser.nsh
!endif

!if "${INSTALLERICON}" != ""
  !define MUI_ICON "${INSTALLERICON}"
!endif

!if "${UNINSTALLERICON}" != ""
  !define MUI_UNICON "${UNINSTALLERICON}"
!endif

!define MUI_LANGDLL_REGISTRY_ROOT "HKCU"
!define MUI_LANGDLL_REGISTRY_KEY "${MANUPRODUCTKEY}"
!define MUI_LANGDLL_REGISTRY_VALUENAME "Installer Language"

Page custom PageWelcome

!if "${INSTALLMODE}" == "both"
  !define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
  !insertmacro MULTIUSER_PAGE_INSTALLMODE
!endif

Page custom PageReinstall PageLeaveReinstall

Page custom PageDirectory PageDirectoryLeave

!define MUI_PAGE_CUSTOMFUNCTION_SHOW StyleInstFiles
!insertmacro MUI_PAGE_INSTFILES

Page custom PageFinish PageFinishLeave

!define MUI_PAGE_CUSTOMFUNCTION_SHOW un.StyleInstFiles
UninstPage custom un.PageConfirm
!insertmacro MUI_UNPAGE_INSTFILES

{{#each languages}}
!insertmacro MUI_LANGUAGE "{{this}}"
{{/each}}
!insertmacro MUI_RESERVEFILE_LANGDLL
{{#each language_files}}
  !include "{{this}}"
{{/each}}

Function .onInit
  ${GetOptions} $CMDLINE "/P" $PassiveMode
  ${IfNot} ${Errors}
    StrCpy $PassiveMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/NS" $NoShortcutMode
  ${IfNot} ${Errors}
    StrCpy $NoShortcutMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/UPDATE" $UpdateMode
  ${IfNot} ${Errors}
    StrCpy $UpdateMode 1
  ${EndIf}

  !if "${DISPLAYLANGUAGESELECTOR}" == "true"
    !insertmacro MUI_LANGDLL_DISPLAY
  !endif

  !insertmacro SetContext

  ${If} $INSTDIR == "${PLACEHOLDER_INSTALL_DIR}"
    !if "${INSTALLMODE}" == "perMachine"
      ${If} ${RunningX64}
        !if "${ARCH}" == "x64"
          StrCpy $INSTDIR "$PROGRAMFILES64\${PRODUCTNAME}"
        !else if "${ARCH}" == "arm64"
          StrCpy $INSTDIR "$PROGRAMFILES64\${PRODUCTNAME}"
        !else
          StrCpy $INSTDIR "$PROGRAMFILES\${PRODUCTNAME}"
        !endif
      ${Else}
        StrCpy $INSTDIR "$PROGRAMFILES\${PRODUCTNAME}"
      ${EndIf}
    !else if "${INSTALLMODE}" == "currentUser"
      StrCpy $INSTDIR "$LOCALAPPDATA\${PRODUCTNAME}"
    !endif

    Call RestorePreviousInstallLocation
  ${EndIf}

  !if "${INSTALLMODE}" == "both"
    !insertmacro MULTIUSER_INIT
  !endif
FunctionEnd

Function CreateWizardFonts
  IntOp $DPI $DPI + 0
  ${If} $DPI <= 0
    StrCpy $0 0
    System::Call 'user32::GetDpiForWindow(p $HWNDPARENT) i.r0'
    ${If} $0 > 0
      StrCpy $DPI $0
    ${EndIf}
  ${EndIf}
  ${If} $DPI <= 0
    StrCpy $DPI 96
  ${EndIf}
  ${If} $FontsReady != 1
    IntOp $0 22 * $DPI
    IntOp $0 $0 / 96
    IntOp $0 0 - $0
    System::Call 'gdi32::CreateFontW(i r0, i 0, i 0, i 0, i 600, i 0, i 0, i 0, i 0, i 0, i 0, i 5, i 0, w "${FONTFACE}") i.s'
    Pop $FontHeading
    IntOp $0 15 * $DPI
    IntOp $0 $0 / 96
    IntOp $0 0 - $0
    System::Call 'gdi32::CreateFontW(i r0, i 0, i 0, i 0, i 400, i 0, i 0, i 0, i 0, i 0, i 0, i 5, i 0, w "${FONTFACE}") i.s'
    Pop $FontBody
    IntOp $0 12 * $DPI
    IntOp $0 $0 / 96
    IntOp $0 0 - $0
    System::Call 'gdi32::CreateFontW(i r0, i 0, i 0, i 0, i 400, i 0, i 0, i 0, i 0, i 0, i 0, i 5, i 0, w "${FONTFACE}") i.s'
    Pop $FontCaption
    IntOp $0 15 * $DPI
    IntOp $0 $0 / 96
    IntOp $0 0 - $0
    System::Call 'gdi32::CreateFontW(i r0, i 0, i 0, i 0, i 600, i 0, i 0, i 0, i 0, i 0, i 0, i 5, i 0, w "${FONTFACE}") i.s'
    Pop $FontButton
    IntOp $0 16 * $DPI
    IntOp $0 $0 / 96
    IntOp $0 0 - $0
    System::Call 'gdi32::CreateFontW(i r0, i 0, i 0, i 0, i 600, i 0, i 0, i 0, i 0, i 0, i 0, i 5, i 0, w "${FONTFACE}") i.s'
    Pop $FontHeader
    StrCpy $FontsReady 1
  ${EndIf}
FunctionEnd

Function StyleWizard
  Call CreateWizardFonts
  SetCtlColors $HWNDPARENT "" ${COLOR_BG}
  ${If} $BrandingFixed = 0
    StrCpy $BrandingFixed 1
    GetDlgItem $0 $HWNDPARENT 1039
    ${If} $0 <> 0
      System::Call 'user32::DestroyWindow(p $0)'
    ${EndIf}
    GetDlgItem $0 $HWNDPARENT 1256
    ${If} $0 <> 0
      System::Call 'user32::DestroyWindow(p $0)'
    ${EndIf}
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1034
  SetCtlColors $0 "" ${COLOR_BG}
  GetDlgItem $0 $HWNDPARENT 1035
  SetCtlColors $0 "" ${COLOR_BG}
  GetDlgItem $0 $HWNDPARENT 1036
  SetCtlColors $0 "" ${COLOR_BG}
  GetDlgItem $0 $HWNDPARENT 1037
  SetCtlColors $0 ${COLOR_ACCENT} ${COLOR_BG}
  SendMessage $0 ${WM_SETFONT} $FontHeader 1
  ${If} $HeaderFixed = 0
    StrCpy $HeaderFixed 1
    !insertmacro NavReadRect $0
    IntOp $9 $7 / 4
    IntOp $3 $3 - $9
    IntOp $7 $7 * 3
    IntOp $7 $7 / 2
    System::Call 'user32::SetWindowPos(p $0, p 0, i $2, i $3, i $6, i $7, i 0x14)'
    System::Call 'user32::GetWindowLongW(p $0, i -16) i.r1'
    IntOp $1 $1 | 0x200
    System::Call 'user32::SetWindowLongW(p $0, i -16, i r1)'
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1038
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_BG}
  SendMessage $0 ${WM_SETFONT} $FontBody 1
  GetDlgItem $0 $HWNDPARENT 1028
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_BG}
  GetDlgItem $0 $HWNDPARENT 1
  SetCtlColors $0 0xFFFFFF ${COLOR_ACCENT}
  SendMessage $0 ${WM_SETFONT} $FontButton 1
  GetDlgItem $0 $HWNDPARENT 2
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_SURFACE}
  SendMessage $0 ${WM_SETFONT} $FontButton 1
  GetDlgItem $0 $HWNDPARENT 3
  SetCtlColors $0 ${COLOR_TEXT} ${COLOR_SURFACE}
  SendMessage $0 ${WM_SETFONT} $FontButton 1
FunctionEnd

Function un.CreateWizardFonts
  IntOp $DPI $DPI + 0
  ${If} $DPI <= 0
    StrCpy $0 0
    System::Call 'user32::GetDpiForWindow(p $HWNDPARENT) i.r0'
    ${If} $0 > 0
      StrCpy $DPI $0
    ${EndIf}
  ${EndIf}
  ${If} $DPI <= 0
    StrCpy $DPI 96
  ${EndIf}
  ${If} $FontsReady != 1
    IntOp $0 22 * $DPI
    IntOp $0 $0 / 96
    IntOp $0 0 - $0
    System::Call 'gdi32::CreateFontW(i r0, i 0, i 0, i 0, i 600, i 0, i 0, i 0, i 0, i 0, i 0, i 5, i 0, w "${FONTFACE}") i.s'
    Pop $FontHeading
    IntOp $0 15 * $DPI
    IntOp $0 $0 / 96
    IntOp $0 0 - $0
    System::Call 'gdi32::CreateFontW(i r0, i 0, i 0, i 0, i 400, i 0, i 0, i 0, i 0, i 0, i 0, i 5, i 0, w "${FONTFACE}") i.s'
    Pop $FontBody
    IntOp $0 12 * $DPI
    IntOp $0 $0 / 96
    IntOp $0 0 - $0
    System::Call 'gdi32::CreateFontW(i r0, i 0, i 0, i 0, i 400, i 0, i 0, i 0, i 0, i 0, i 0, i 5, i 0, w "${FONTFACE}") i.s'
    Pop $FontCaption
    IntOp $0 15 * $DPI
    IntOp $0 $0 / 96
    IntOp $0 0 - $0
    System::Call 'gdi32::CreateFontW(i r0, i 0, i 0, i 0, i 600, i 0, i 0, i 0, i 0, i 0, i 0, i 5, i 0, w "${FONTFACE}") i.s'
    Pop $FontButton
    IntOp $0 16 * $DPI
    IntOp $0 $0 / 96
    IntOp $0 0 - $0
    System::Call 'gdi32::CreateFontW(i r0, i 0, i 0, i 0, i 600, i 0, i 0, i 0, i 0, i 0, i 0, i 5, i 0, w "${FONTFACE}") i.s'
    Pop $FontHeader
    StrCpy $FontsReady 1
  ${EndIf}
FunctionEnd

Function un.StyleWizard
  Call un.CreateWizardFonts
  SetCtlColors $HWNDPARENT "" ${COLOR_BG}
  ${If} $BrandingFixed = 0
    StrCpy $BrandingFixed 1
    GetDlgItem $0 $HWNDPARENT 1039
    ${If} $0 <> 0
      System::Call 'user32::DestroyWindow(p $0)'
    ${EndIf}
    GetDlgItem $0 $HWNDPARENT 1256
    ${If} $0 <> 0
      System::Call 'user32::DestroyWindow(p $0)'
    ${EndIf}
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1034
  SetCtlColors $0 "" ${COLOR_BG}
  GetDlgItem $0 $HWNDPARENT 1035
  SetCtlColors $0 "" ${COLOR_BG}
  GetDlgItem $0 $HWNDPARENT 1036
  SetCtlColors $0 "" ${COLOR_BG}
  GetDlgItem $0 $HWNDPARENT 1037
  SetCtlColors $0 ${COLOR_ACCENT} ${COLOR_BG}
  SendMessage $0 ${WM_SETFONT} $FontHeader 1
  ${If} $HeaderFixed = 0
    StrCpy $HeaderFixed 1
    !insertmacro NavReadRect $0
    IntOp $9 $7 / 4
    IntOp $3 $3 - $9
    IntOp $7 $7 * 3
    IntOp $7 $7 / 2
    System::Call 'user32::SetWindowPos(p $0, p 0, i $2, i $3, i $6, i $7, i 0x14)'
    System::Call 'user32::GetWindowLongW(p $0, i -16) i.r1'
    IntOp $1 $1 | 0x200
    System::Call 'user32::SetWindowLongW(p $0, i -16, i r1)'
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1038
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_BG}
  SendMessage $0 ${WM_SETFONT} $FontBody 1
  GetDlgItem $0 $HWNDPARENT 1028
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_BG}
  GetDlgItem $0 $HWNDPARENT 1
  SetCtlColors $0 0xFFFFFF ${COLOR_ACCENT}
  SendMessage $0 ${WM_SETFONT} $FontButton 1
  GetDlgItem $0 $HWNDPARENT 2
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_SURFACE}
  SendMessage $0 ${WM_SETFONT} $FontButton 1
FunctionEnd

Function PageWelcome
  ${If} $PassiveMode = 1
    Abort
  ${EndIf}
  Call StyleWizard
  !insertmacro ShowStepDots 0
  !insertmacro MUI_HEADER_TEXT "Добро пожаловать" ""
  nsDialogs::Create 1018
  Pop $DIALOG
  SetCtlColors $DIALOG "" ${COLOR_BG}

  !insertmacro LabelHeight 22
  ${NSD_CreateLabel} 0 6u 100% $9u "${PRODUCTNAME}"
  Pop $0
  ${NSD_AddStyle} $0 ${SS_CENTER}
  SendMessage $0 ${WM_SETFONT} $FontHeading 1
  SetCtlColors $0 ${COLOR_TEXT} ${COLOR_BG}

  !insertmacro LabelHeight 15
  ${NSD_CreateLabel} 0 32u 10u $9u "1"
  Pop $0
  ${NSD_AddStyle} $0 0x201
  SendMessage $0 ${WM_SETFONT} $FontBody 1
  SetCtlColors $0 ${COLOR_ACCENT} ${COLOR_BG}
  ${NSD_CreateLabel} 14u 32u -14u $9u "Папка установки"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $FontBody 1
  SetCtlColors $0 ${COLOR_TEXT} ${COLOR_BG}

  ${NSD_CreateLabel} 0 51u 10u $9u "2"
  Pop $0
  ${NSD_AddStyle} $0 0x201
  SendMessage $0 ${WM_SETFONT} $FontBody 1
  SetCtlColors $0 ${COLOR_ACCENT} ${COLOR_BG}
  ${NSD_CreateLabel} 14u 51u -14u $9u "Установка"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $FontBody 1
  SetCtlColors $0 ${COLOR_TEXT} ${COLOR_BG}

  ${NSD_CreateLabel} 0 70u 10u $9u "3"
  Pop $0
  ${NSD_AddStyle} $0 0x201
  SendMessage $0 ${WM_SETFONT} $FontBody 1
  SetCtlColors $0 ${COLOR_ACCENT} ${COLOR_BG}
  ${NSD_CreateLabel} 14u 70u -14u $9u "Готово"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $FontBody 1
  SetCtlColors $0 ${COLOR_TEXT} ${COLOR_BG}

  !insertmacro LabelHeight 12
  ${NSD_CreateLabel} 0 -46u 100% $9u "Если WebView2 отсутствует, он будет скачан из интернета во время установки"
  Pop $0
  ${NSD_AddStyle} $0 ${SS_CENTER}
  SendMessage $0 ${WM_SETFONT} $FontCaption 1
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_BG}

  ${NSD_CreateLabel} 0 -26u 100% $9u "Версия ${VERSION}"
  Pop $0
  ${NSD_AddStyle} $0 ${SS_CENTER}
  SendMessage $0 ${WM_SETFONT} $FontCaption 1
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_BG}

  !insertmacro NavButtons "Далее" "Отмена" "" 1
  ${NSD_CreateTimer} FocusPoll 50
  nsDialogs::Show
  ${NSD_KillTimer} FocusPoll
  Call DestroyNavOverlays
FunctionEnd

Function PageReinstall
  StrCpy $ReinstallPageCheck 1
  StrCpy $0 0
  wix_loop:
    EnumRegKey $1 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall" $0
    StrCmp $1 "" wix_loop_done
    IntOp $0 $0 + 1
    ReadRegStr $R0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1" "DisplayName"
    ReadRegStr $R1 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1" "Publisher"
    StrCmp "$R0$R1" "${PRODUCTNAME}${MANUFACTURER}" 0 wix_loop
    ReadRegStr $R0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1" "UninstallString"
    ${StrCase} $R1 $R0 "L"
    ${StrLoc} $R0 $R1 "msiexec" ">"
    StrCmp $R0 0 0 wix_loop_done
    StrCpy $WixMode 1
    StrCpy $R6 "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1"
    Goto compare_version
  wix_loop_done:

  ReadRegStr $R0 SHCTX "${UNINSTKEY}" ""
  ReadRegStr $R1 SHCTX "${UNINSTKEY}" "UninstallString"
  ${IfThen} "$R0$R1" == "" ${|} Abort ${|}

  compare_version:
  StrCpy $R4 "$(older)"
  ${If} $WixMode = 1
    ReadRegStr $R0 HKLM "$R6" "DisplayVersion"
  ${Else}
    ReadRegStr $R0 SHCTX "${UNINSTKEY}" "DisplayVersion"
  ${EndIf}
  ${IfThen} $R0 == "" ${|} StrCpy $R4 "$(unknown)" ${|}

  nsis_tauri_utils::SemverCompare "${VERSION}" $R0
  Pop $R0
  ${If} $R0 = 0
    StrCpy $R1 "$(alreadyInstalledLong)"
    StrCpy $R2 "$(addOrReinstall)"
    StrCpy $R3 "$(uninstallApp)"
    !insertmacro MUI_HEADER_TEXT "$(alreadyInstalled)" "$(chooseMaintenanceOption)"
  ${ElseIf} $R0 = 1
    StrCpy $R1 "$(olderOrUnknownVersionInstalled)"
    StrCpy $R2 "$(uninstallBeforeInstalling)"
    StrCpy $R3 "$(dontUninstall)"
    !insertmacro MUI_HEADER_TEXT "$(alreadyInstalled)" "$(choowHowToInstall)"
  ${ElseIf} $R0 = -1
    StrCpy $R1 "$(newerVersionInstalled)"
    StrCpy $R2 "$(uninstallBeforeInstalling)"
    !if "${ALLOWDOWNGRADES}" == "true"
      StrCpy $R3 "$(dontUninstall)"
    !else
      StrCpy $R3 "$(dontUninstallDowngrade)"
    !endif
    !insertmacro MUI_HEADER_TEXT "$(alreadyInstalled)" "$(choowHowToInstall)"
  ${Else}
    Abort
  ${EndIf}

  ${If} $PassiveMode = 1
    Call PageLeaveReinstall
  ${Else}
    Call StyleWizard
    !insertmacro ShowStepDots 0
    nsDialogs::Create 1018
    Pop $R4
    ${IfThen} $(^RTL) = 1 ${|} nsDialogs::SetRTL $(^RTL) ${|}
    SetCtlColors $R4 "" ${COLOR_BG}

    !insertmacro LabelHeight 15
    IntOp $9 $9 * 3
    IntOp $9 $9 + 4
    ${NSD_CreateLabel} 0 6u 100% $9u $R1
    Pop $R1
    SendMessage $R1 ${WM_SETFONT} $FontBody 1
    SetCtlColors $R1 ${COLOR_MUTED} ${COLOR_BG}

    !insertmacro LabelHeight 15
    ${NSD_CreateRadioButton} 0 66u -14u $9u $R2
    Pop $Radio1
    ${NSD_AddStyle} $Radio1 ${WS_GROUP}
    System::Call 'uxtheme::SetWindowTheme(p $Radio1, w "", w "")'
    SendMessage $Radio1 ${WM_SETFONT} $FontBody 1
    SetCtlColors $Radio1 ${COLOR_TEXT} ${COLOR_BG}
    ${NSD_OnClick} $Radio1 PageReinstallSelect1

    !insertmacro LabelHeight 15
    ${NSD_CreateRadioButton} 0 86u -14u $9u $R3
    Pop $Radio2
    System::Call 'uxtheme::SetWindowTheme(p $Radio2, w "", w "")'
    SendMessage $Radio2 ${WM_SETFONT} $FontBody 1
    SetCtlColors $Radio2 ${COLOR_TEXT} ${COLOR_BG}
    ${NSD_OnClick} $Radio2 PageReinstallSelect2

    ${NSD_Check} $Radio1

    !if "${ALLOWDOWNGRADES}" == "false"
      ${If} $R0 = -1
        EnableWindow $Radio2 0
        SetCtlColors $Radio2 ${COLOR_MUTED} ${COLOR_BG}
        StrCpy $ReinstallPageCheck 1
      ${EndIf}
    !endif

    !insertmacro NavButtons "Далее" "Отмена" "Назад" 1
    ${NSD_CreateTimer} FocusPoll 50
    nsDialogs::Show
    ${NSD_KillTimer} FocusPoll
    Call DestroyNavOverlays
  ${EndIf}
FunctionEnd

Function PageReinstallSelect1
  StrCpy $ReinstallPageCheck 1
FunctionEnd

Function PageReinstallSelect2
  StrCpy $ReinstallPageCheck 2
FunctionEnd
Function PageLeaveReinstall
  StrCpy $R1 $ReinstallPageCheck

  ${If} $WixMode = 1
    Goto reinst_uninstall
  ${EndIf}

  ${If} $UpdateMode = 1
    Goto reinst_done
  ${EndIf}

  ${If} $R0 = 0
    ${If} $R1 = 1
      Goto reinst_done
    ${Else}
      Goto reinst_uninstall
    ${EndIf}
  ${ElseIf} $R0 = 1
    ${If} $R1 = 1
      Goto reinst_uninstall
    ${Else}
      Goto reinst_done
    ${EndIf}
  ${ElseIf} $R0 = -1
    ${If} $R1 = 1
      Goto reinst_uninstall
    ${Else}
      Goto reinst_done
    ${EndIf}
  ${EndIf}

  reinst_uninstall:
    HideWindow
    ClearErrors

    ${If} $WixMode = 1
      ReadRegStr $R1 HKLM "$R6" "UninstallString"
      ExecWait '$R1' $0
    ${Else}
      ReadRegStr $4 SHCTX "${MANUPRODUCTKEY}" ""
      ReadRegStr $R1 SHCTX "${UNINSTKEY}" "UninstallString"
      ${IfThen} $UpdateMode = 1 ${|} StrCpy $R1 "$R1 /UPDATE" ${|}
      ${IfThen} $PassiveMode = 1 ${|} StrCpy $R1 "$R1 /P" ${|}
      StrCpy $R1 "$R1 _?=$4"
      ExecWait '$R1' $0
    ${EndIf}

    BringToFront

    ${IfThen} ${Errors} ${|} StrCpy $0 2 ${|}

    ${If} $0 <> 0
    ${OrIf} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
      ${If} $WixMode = 1
      ${AndIf} $0 = 1602
        Abort
      ${EndIf}

      ${If} $0 = 1
        Abort
      ${EndIf}

      MessageBox MB_ICONEXCLAMATION "$(unableToUninstall)"
      Abort
    ${EndIf}
  reinst_done:
FunctionEnd

Function PageDirectory
  ${If} $PassiveMode = 1
    Abort
  ${EndIf}
  Call StyleWizard
  !insertmacro MUI_HEADER_TEXT "Папка установки" "Шаг 1 из 3"
  nsDialogs::Create 1018
  Pop $DIALOG
  SetCtlColors $DIALOG "" ${COLOR_BG}

  !insertmacro LabelHeight 22
  ${NSD_CreateLabel} 0 6u 100% $9u "Куда установить ${PRODUCTNAME}?"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $FontHeading 1
  SetCtlColors $0 ${COLOR_TEXT} ${COLOR_BG}

  !insertmacro LabelHeight 15
  ${NSD_CreateLabel} 0 32u 100% $9u "Файлы лаунчера будут установлены в выбранную папку."
  Pop $0
  SendMessage $0 ${WM_SETFONT} $FontBody 1
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_BG}

  ${NSD_CreateText} 0 46u 220u 15u "$INSTDIR"
  Pop $DirField
  System::Call 'user32::GetWindowLongW(p $DirField, i -20) i.r1'
  IntOp $1 $1 & 0xFFFFFDFF
  System::Call 'user32::SetWindowLongW(p $DirField, i -20, i r1)'
  System::Call 'user32::SetWindowPos(p $DirField, p 0, i 0, i 0, i 0, i 0, i 0x23)'
  SendMessage $DirField ${WM_SETFONT} $FontBody 1
  SetCtlColors $DirField ${COLOR_TEXT} ${COLOR_BG_INPUT}

  ${NSD_CreateLabel} 228u 45u 72u 17u "Обзор..."
  Pop $0
  ${NSD_AddStyle} $0 0x301
  SendMessage $0 ${WM_SETFONT} $FontButton 1
  SetCtlColors $0 0xFFFFFF ${COLOR_ACCENT}
  ${NSD_OnClick} $0 PageDirectoryBrowse

  !insertmacro LabelHeight 12
  IntOp $9 $9 * 2
  IntOp $9 $9 + 4
  ${NSD_CreateLabel} 0 74u 100% $9u "Лаунчер устанавливается без прав администратора. Игры и данные хранятся отдельно, в папке профиля пользователя."
  Pop $0
  SendMessage $0 ${WM_SETFONT} $FontCaption 1
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_BG}

  !insertmacro NavButtons "Установить" "Отмена" "Назад" 1
  !insertmacro ShowStepDots 1
  ${NSD_CreateTimer} FocusPoll 50
  nsDialogs::Show
  ${NSD_KillTimer} FocusPoll
  Call DestroyNavOverlays
FunctionEnd

Function PageDirectoryBrowse
  ${NSD_GetText} $DirField $1
  nsDialogs::SelectFolderDialog "Выбор папки установки" "$1"
  Pop $0
  ${If} $0 != "error"
    ${GetFileName} $0 $1
    ${If} $1 != "${PRODUCTNAME}"
      StrCpy $0 "$0\${PRODUCTNAME}"
    ${EndIf}
    ${NSD_SetText} $DirField $0
  ${EndIf}
FunctionEnd

Function PageDirectoryLeave
  ${NSD_GetText} $DirField $0
  ${If} $0 == ""
    Abort
  ${EndIf}
  ${GetFileName} $0 $1
  ${If} $1 != "${PRODUCTNAME}"
    StrCpy $0 "$0\${PRODUCTNAME}"
  ${EndIf}
  StrCpy $INSTDIR $0
FunctionEnd

Function StyleInstFiles
  Call StyleWizard
  !insertmacro MUI_HEADER_TEXT "Установка" "Шаг 2 из 3"
  FindWindow $1 "#32770" "" $HWNDPARENT
  SetCtlColors $1 "" ${COLOR_BG}
  GetDlgItem $0 $1 1006
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_BG}
  SendMessage $0 ${WM_SETFONT} $FontBody 1
  GetDlgItem $0 $1 1016
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_BG}
  SendMessage $0 ${WM_SETFONT} $FontBody 1
  System::Call 'user32::SendMessageW(p $0, i 0x1001, i 0, i ${COLOR_BG})'
  System::Call 'user32::SendMessageW(p $0, i 0x1002, i 0, i ${COLOR_BG})'
  System::Call 'user32::SendMessageW(p $0, i 0x1024, i 0, i ${COLOR_MUTED})'
  GetDlgItem $0 $1 1027
  SetCtlColors $0 ${COLOR_TEXT} ${COLOR_SURFACE}
  SendMessage $0 ${WM_SETFONT} $FontButton 1
  GetDlgItem $0 $1 1029
  System::Call 'uxtheme::SetWindowTheme(p $0, w "", w "")'
  SendMessage $0 ${PBM_SETBARCOLOR} 0 ${COLOR_ACCENT}
  SendMessage $0 ${PBM_SETBKCOLOR} 0 ${COLOR_BG_INPUT}
  !insertmacro NavButtons "Далее" "Отмена" "Назад" 0
  !insertmacro DisableNavOverlaysExceptCancel
  !insertmacro ShowStepDots 2
  SetAutoClose false
FunctionEnd

Function PageFinish
  ${If} $PassiveMode = 1
    Abort
  ${EndIf}
  Call StyleWizard
  !insertmacro MUI_HEADER_TEXT "Готово" "Шаг 3 из 3"
  nsDialogs::Create 1018
  Pop $DIALOG
  SetCtlColors $DIALOG "" ${COLOR_BG}

  !insertmacro LabelHeight 22
  ${NSD_CreateLabel} 0 10u 100% $9u "Установка завершена!"
  Pop $0
  ${NSD_AddStyle} $0 ${SS_CENTER}
  SendMessage $0 ${WM_SETFONT} $FontHeading 1
  SetCtlColors $0 ${COLOR_ACCENT} ${COLOR_BG}

  !insertmacro LabelHeight 15
  IntOp $9 $9 * 2
  IntOp $9 $9 + 4
  ${NSD_CreateLabel} 20u 44u -20u $9u "${PRODUCTNAME} ${VERSION} установлен в:$\n$INSTDIR"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $FontBody 1
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_BG}

  !insertmacro LabelHeight 15
  ${NSD_CreateCheckbox} 0 82u -14u $9u "Запустить ${PRODUCTNAME}"
  Pop $RunAppCheckbox
  System::Call 'uxtheme::SetWindowTheme(p $RunAppCheckbox, w "", w "")'
  SendMessage $RunAppCheckbox ${WM_SETFONT} $FontBody 1
  SetCtlColors $RunAppCheckbox ${COLOR_TEXT} ${COLOR_BG}
  ${NSD_Check} $RunAppCheckbox

  !insertmacro LabelHeight 15
  ${NSD_CreateCheckbox} 0 106u -14u $9u "Создать ярлык на рабочем столе"
  Pop $DesktopShortcutCheckbox
  System::Call 'uxtheme::SetWindowTheme(p $DesktopShortcutCheckbox, w "", w "")'
  SendMessage $DesktopShortcutCheckbox ${WM_SETFONT} $FontBody 1
  SetCtlColors $DesktopShortcutCheckbox ${COLOR_TEXT} ${COLOR_BG}
  ${NSD_Check} $DesktopShortcutCheckbox

  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:Готово"
  GetDlgItem $0 $HWNDPARENT 2
  ShowWindow $0 0
  GetDlgItem $0 $HWNDPARENT 3
  ShowWindow $0 0

  !insertmacro NavButtons "Готово" "" "" 1
  !insertmacro ShowStepDots 3
  ${NSD_CreateTimer} FocusPoll 50
  nsDialogs::Show
  ${NSD_KillTimer} FocusPoll
  Call DestroyNavOverlays
FunctionEnd

Function PageFinishLeave
  ${If} $PassiveMode = 1
  ${OrIf} $UpdateMode = 1
  ${OrIf} ${Silent}
    Return
  ${EndIf}
  ${NSD_GetState} $DesktopShortcutCheckbox $0
  ${If} $0 = ${BST_CHECKED}
    Call CreateOrUpdateDesktopShortcut
  ${EndIf}
  ${NSD_GetState} $RunAppCheckbox $0
  ${If} $0 = ${BST_CHECKED}
    Call RunMainBinary
  ${EndIf}
FunctionEnd

Function RunMainBinary
  nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe" ""
FunctionEnd

Function un.StyleInstFiles
  Call un.StyleWizard
  FindWindow $1 "#32770" "" $HWNDPARENT
  SetCtlColors $1 "" ${COLOR_BG}
  GetDlgItem $0 $1 1006
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_BG}
  SendMessage $0 ${WM_SETFONT} $FontBody 1
  GetDlgItem $0 $1 1016
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_BG}
  SendMessage $0 ${WM_SETFONT} $FontBody 1
  System::Call 'user32::SendMessageW(p $0, i 0x1001, i 0, i ${COLOR_BG})'
  System::Call 'user32::SendMessageW(p $0, i 0x1002, i 0, i ${COLOR_BG})'
  System::Call 'user32::SendMessageW(p $0, i 0x1024, i 0, i ${COLOR_MUTED})'
  GetDlgItem $0 $1 1027
  SetCtlColors $0 ${COLOR_TEXT} ${COLOR_SURFACE}
  SendMessage $0 ${WM_SETFONT} $FontButton 1
  GetDlgItem $0 $1 1029
  System::Call 'uxtheme::SetWindowTheme(p $0, w "", w "")'
  SendMessage $0 ${PBM_SETBARCOLOR} 0 ${COLOR_ACCENT}
  SendMessage $0 ${PBM_SETBKCOLOR} 0 ${COLOR_BG_INPUT}
  !insertmacro NavButtons "Далее" "Отмена" "Назад" 0
  !insertmacro DisableNavOverlaysExceptCancel
FunctionEnd

Function un.onInit
  !insertmacro SetContext

  !if "${INSTALLMODE}" == "both"
    !insertmacro MULTIUSER_UNINIT
  !endif

  !insertmacro MUI_UNGETLANGUAGE

  ${GetOptions} $CMDLINE "/P" $PassiveMode
  ${IfNot} ${Errors}
    StrCpy $PassiveMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/UPDATE" $UpdateMode
  ${IfNot} ${Errors}
    StrCpy $UpdateMode 1
  ${EndIf}

  StrCpy $KeepGameData 1
FunctionEnd

Function un.PageConfirmToggle
  ${NSD_GetState} $KeepDataCheckbox $0
  StrCpy $KeepGameData $0
  ${If} $KeepGameData = 1
    ${NSD_SetText} $DataStateLabel "Данные игр (будут сохранены): $ConfirmDataPath"
    SetCtlColors $DataStateLabel ${COLOR_MUTED} ${COLOR_BG}
  ${Else}
    ${NSD_SetText} $DataStateLabel "Данные игр (БУДУТ УДАЛЕНЫ): $ConfirmDataPath"
    SetCtlColors $DataStateLabel ${COLOR_ACCENT} ${COLOR_BG}
  ${EndIf}
FunctionEnd

Function un.PageConfirm
  ${If} $PassiveMode = 1
    Abort
  ${EndIf}
  ${If} $UpdateMode = 1
    Abort
  ${EndIf}
  Call un.StyleWizard
  !insertmacro MUI_HEADER_TEXT "" ""
  nsDialogs::Create 1018
  Pop $DIALOG
  SetCtlColors $DIALOG "" ${COLOR_BG}

  ReadRegStr $ConfirmDataPath SHCTX "${MANUPRODUCTKEY}" "DataPath"
  ${If} $ConfirmDataPath == ""
    StrCpy $ConfirmDataPath "$PROFILE\${PRODUCTNAME}"
  ${EndIf}

  !insertmacro LabelHeight 22
  ${NSD_CreateLabel} 0 6u 100% $9u "Удалить ${PRODUCTNAME}?"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $FontHeading 1
  SetCtlColors $0 ${COLOR_TEXT} ${COLOR_BG}

  !insertmacro LabelHeight 15
  ${NSD_CreateCheckbox} 0 34u -14u $9u "Сохранить данные игр (профили, миры)"
  Pop $KeepDataCheckbox
  System::Call 'uxtheme::SetWindowTheme(p $KeepDataCheckbox, w "", w "")'
  SendMessage $KeepDataCheckbox ${WM_SETFONT} $FontBody 1
  SetCtlColors $KeepDataCheckbox ${COLOR_TEXT} ${COLOR_BG}
  ${NSD_Check} $KeepDataCheckbox
  ${NSD_OnClick} $KeepDataCheckbox un.PageConfirmToggle

  !insertmacro LabelHeight 12
  ${NSD_CreateLabel} 0 56u 100% $9u "Данные игр (будут сохранены): $ConfirmDataPath"
  Pop $DataStateLabel
  SendMessage $DataStateLabel ${WM_SETFONT} $FontCaption 1
  SetCtlColors $DataStateLabel ${COLOR_MUTED} ${COLOR_BG}

  ${NSD_CreateLabel} 0 80u 100% $9u "Действие нельзя отменить. Будут удалены:"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $FontCaption 1
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_BG}

  ${NSD_CreateLabel} 0 100u 100% $9u "— файлы программы: $INSTDIR"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $FontCaption 1
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_BG}

  ${NSD_CreateLabel} 0 120u 100% $9u "— настройки и сессии лаунчера"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $FontCaption 1
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_BG}

  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:Удалить"

  !insertmacro NavButtons "Удалить" "Отмена" "" 1
  ${NSD_CreateTimer} un.FocusPoll 50
  nsDialogs::Show
  ${NSD_KillTimer} un.FocusPoll
  Call un.DestroyNavOverlays
FunctionEnd

Section EarlyChecks
  !if "${ALLOWDOWNGRADES}" == "false"
  ${If} ${Silent}
    ${If} $R0 = -1
      System::Call 'kernel32::AttachConsole(i -1)i.r0'
      ${If} $0 <> 0
        System::Call 'kernel32::GetStdHandle(i -11)i.r0'
        System::call 'kernel32::SetConsoleTextAttribute(i r0, i 0x0004)'
        FileWrite $0 "$(silentDowngrades)"
      ${EndIf}
      Abort
    ${EndIf}
  ${EndIf}
  !endif

SectionEnd

Section WebView2
  ${If} ${RunningX64}
    ReadRegStr $4 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${Else}
    ReadRegStr $4 HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${EndIf}
  ${If} $4 == ""
    ReadRegStr $4 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${EndIf}

  ${If} $4 == ""
    ${If} $UpdateMode <> 1
      !if "${INSTALLWEBVIEW2MODE}" == "downloadBootstrapper"
        Delete "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        DetailPrint "$(webview2Downloading)"
        NSISdl::download "https://go.microsoft.com/fwlink/p/?LinkId=2124703" "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        Pop $0
        ${If} $0 == "success"
          DetailPrint "$(webview2DownloadSuccess)"
        ${Else}
          DetailPrint "$(webview2DownloadError)"
          Abort "$(webview2AbortError)"
        ${EndIf}
        StrCpy $6 "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        Goto install_webview2
      !endif

      !if "${INSTALLWEBVIEW2MODE}" == "embedBootstrapper"
        Delete "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        File "/oname=$TEMP\MicrosoftEdgeWebview2Setup.exe" "${WEBVIEW2BOOTSTRAPPERPATH}"
        DetailPrint "$(installingWebview2)"
        StrCpy $6 "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        Goto install_webview2
      !endif

      !if "${INSTALLWEBVIEW2MODE}" == "offlineInstaller"
        Delete "$TEMP\MicrosoftEdgeWebView2RuntimeInstaller.exe"
        File "/oname=$TEMP\MicrosoftEdgeWebView2RuntimeInstaller.exe" "${WEBVIEW2INSTALLERPATH}"
        DetailPrint "$(installingWebview2)"
        StrCpy $6 "$TEMP\MicrosoftEdgeWebView2RuntimeInstaller.exe"
        Goto install_webview2
      !endif

      Goto webview2_done

      install_webview2:
        DetailPrint "$(installingWebview2)"
        ExecWait "$6 ${WEBVIEW2INSTALLERARGS} /install" $1
        ${If} $1 = 0
          DetailPrint "$(webview2InstallSuccess)"
        ${Else}
          DetailPrint "$(webview2InstallError)"
          Abort "$(webview2AbortError)"
        ${EndIf}
      webview2_done:
    ${EndIf}
  ${Else}
    !if "${MINIMUMWEBVIEW2VERSION}" != ""
      ${VersionCompare} "${MINIMUMWEBVIEW2VERSION}" "$4" $R0
      ${If} $R0 = 1
        update_webview:
          DetailPrint "$(installingWebview2)"
          ${If} ${RunningX64}
            ReadRegStr $R1 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate" "path"
          ${Else}
            ReadRegStr $R1 HKLM "SOFTWARE\Microsoft\EdgeUpdate" "path"
          ${EndIf}
          ${If} $R1 == ""
            ReadRegStr $R1 HKCU "SOFTWARE\Microsoft\EdgeUpdate" "path"
          ${EndIf}
          ${If} $R1 != ""
            ExecWait `"$R1" /install appguid=${WEBVIEW2APPGUID}&needsadmin=true` $1
            ${If} $1 = 0
              DetailPrint "$(webview2InstallSuccess)"
            ${Else}
              MessageBox MB_ICONEXCLAMATION|MB_ABORTRETRYIGNORE "$(webview2InstallError)" IDIGNORE ignore IDRETRY update_webview
              Quit
              ignore:
            ${EndIf}
          ${EndIf}
      ${EndIf}
    !endif
  ${EndIf}
SectionEnd

Section Install
  SetOutPath $INSTDIR

  !ifmacrodef NSIS_HOOK_PREINSTALL
    !insertmacro NSIS_HOOK_PREINSTALL
  !endif

  !insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"

  File "${MAINBINARYSRCPATH}"

  {{#each resources_dirs}}
    CreateDirectory "$INSTDIR\\{{this}}"
  {{/each}}
  {{#each resources}}
    File /a "/oname={{this.[1]}}" "{{no-escape @key}}"
  {{/each}}

  {{#each binaries}}
    File /a "/oname={{this}}" "{{no-escape @key}}"
  {{/each}}

  {{#each file_associations as |association| ~}}
    {{#each association.ext as |ext| ~}}
       !insertmacro APP_ASSOCIATE "{{ext}}" "{{or association.name ext}}" "{{association-description association.description ext}}" "$INSTDIR\${MAINBINARYNAME}.exe,0" "Open with ${PRODUCTNAME}" "$INSTDIR\${MAINBINARYNAME}.exe $\"%1$\""
    {{/each}}
  {{/each}}

  {{#each deep_link_protocols as |protocol| ~}}
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}" "URL Protocol" ""
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}" "" "URL:${BUNDLEID} protocol"
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  {{/each}}

  WriteUninstaller "$INSTDIR\uninstall.exe"

  WriteRegStr SHCTX "${MANUPRODUCTKEY}" "" $INSTDIR

  !if "${INSTALLMODE}" == "both"
    WriteRegStr SHCTX "${UNINSTKEY}" $MultiUser.InstallMode 1
  !endif

  ReadRegStr $OldMainBinaryName SHCTX "${UNINSTKEY}" "MainBinaryName"
  ${If} $OldMainBinaryName != ""
  ${AndIf} $OldMainBinaryName != "${MAINBINARYNAME}.exe"
    Delete "$INSTDIR\$OldMainBinaryName"
  ${EndIf}

  WriteRegStr SHCTX "${UNINSTKEY}" "MainBinaryName" "${MAINBINARYNAME}.exe"

  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayIcon" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\""
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr SHCTX "${UNINSTKEY}" "Publisher" "${MANUFACTURER}"
  WriteRegStr SHCTX "${UNINSTKEY}" "InstallLocation" "$\"$INSTDIR$\""
  WriteRegStr SHCTX "${UNINSTKEY}" "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
  WriteRegDWORD SHCTX "${UNINSTKEY}" "NoModify" "1"
  WriteRegDWORD SHCTX "${UNINSTKEY}" "NoRepair" "1"

  ${GetSize} "$INSTDIR" "/M=uninstall.exe /S=0K /G=0" $0 $1 $2
  IntOp $0 $0 + ${ESTIMATEDSIZE}
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD SHCTX "${UNINSTKEY}" "EstimatedSize" "$0"

  !if "${HOMEPAGE}" != ""
    WriteRegStr SHCTX "${UNINSTKEY}" "URLInfoAbout" "${HOMEPAGE}"
    WriteRegStr SHCTX "${UNINSTKEY}" "URLUpdateInfo" "${HOMEPAGE}"
    WriteRegStr SHCTX "${UNINSTKEY}" "HelpLink" "${HOMEPAGE}"
  !endif

  Call CreateOrUpdateStartMenuShortcut

  ${If} $PassiveMode = 1
  ${OrIf} ${Silent}
    Call CreateOrUpdateDesktopShortcut
  ${EndIf}

  !ifmacrodef NSIS_HOOK_POSTINSTALL
    !insertmacro NSIS_HOOK_POSTINSTALL
  !endif

  ${If} $PassiveMode = 1
    SetAutoClose true
  ${EndIf}
SectionEnd

Function .onInstSuccess
  ${If} $PassiveMode = 1
  ${OrIf} ${Silent}
    ${GetOptions} $CMDLINE "/R" $R0
    ${IfNot} ${Errors}
      ${GetOptions} $CMDLINE "/ARGS" $R0
      nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe" "$R0"
    ${EndIf}
  ${EndIf}
FunctionEnd

Section Uninstall

  !ifmacrodef NSIS_HOOK_PREUNINSTALL
    !insertmacro NSIS_HOOK_PREUNINSTALL
  !endif

  !insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"

  Delete "$INSTDIR\${MAINBINARYNAME}.exe"

  {{#each resources}}
    Delete "$INSTDIR\\{{this.[1]}}"
  {{/each}}

  {{#each binaries}}
    Delete "$INSTDIR\\{{this}}"
  {{/each}}

  {{#each file_associations as |association| ~}}
    {{#each association.ext as |ext| ~}}
      !insertmacro APP_UNASSOCIATE "{{ext}}" "{{or association.name ext}}"
    {{/each}}
  {{/each}}

  {{#each deep_link_protocols as |protocol| ~}}
    ReadRegStr $R7 SHCTX "Software\Classes\\{{protocol}}\shell\open\command" ""
    ${If} $R7 == "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
      DeleteRegKey SHCTX "Software\Classes\\{{protocol}}"
    ${EndIf}
  {{/each}}

  Delete "$INSTDIR\uninstall.exe"

  {{#each resources_ancestors}}
  RMDir /REBOOTOK "$INSTDIR\\{{this}}"
  {{/each}}
  RMDir /r "$INSTDIR"

  ${If} $UpdateMode <> 1
    !insertmacro DeleteAppUserModelId

    !insertmacro IsShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk"
      Delete "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    ${EndIf}
    !insertmacro IsShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$DESKTOP\${PRODUCTNAME}.lnk"
      Delete "$DESKTOP\${PRODUCTNAME}.lnk"
    ${EndIf}
  ${EndIf}

  !if "${INSTALLMODE}" == "both"
    DeleteRegKey SHCTX "${UNINSTKEY}"
  !else if "${INSTALLMODE}" == "perMachine"
    DeleteRegKey HKLM "${UNINSTKEY}"
  !else
    DeleteRegKey HKCU "${UNINSTKEY}"
  !endif

  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"
  ${EndIf}

  ${If} $UpdateMode <> 1
    SetShellVarContext current
    ReadRegStr $ConfirmDataPath SHCTX "${MANUPRODUCTKEY}" "DataPath"
    ${If} $ConfirmDataPath == ""
      StrCpy $ConfirmDataPath "$PROFILE\${PRODUCTNAME}"
    ${EndIf}
    ${If} $KeepGameData = 1
      DetailPrint "Данные игр сохранены: $ConfirmDataPath"
    ${Else}
      DetailPrint "Удаление данных игр: $ConfirmDataPath"
      RmDir /r "$ConfirmDataPath"
    ${EndIf}

    DeleteRegKey SHCTX "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty SHCTX "${MANUKEY}"

    DeleteRegValue HKCU "${MANUPRODUCTKEY}" "Installer Language"
    DeleteRegKey /ifempty HKCU "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty HKCU "${MANUKEY}"

    RmDir /r "$APPDATA\${PRODUCTNAME}"
    RmDir /r "$APPDATA\${BUNDLEID}"
    RmDir /r "$LOCALAPPDATA\${BUNDLEID}"
  ${EndIf}

  !ifmacrodef NSIS_HOOK_POSTUNINSTALL
    !insertmacro NSIS_HOOK_POSTUNINSTALL
  !endif

  ${If} $PassiveMode = 1
  ${OrIf} $UpdateMode = 1
    SetAutoClose true
  ${EndIf}
SectionEnd

Function RestorePreviousInstallLocation
  ReadRegStr $4 SHCTX "${MANUPRODUCTKEY}" ""
  StrCmp $4 "" +2 0
    StrCpy $INSTDIR $4
FunctionEnd

!if "${INSTALLMODE}" == "both"
Function SkipIfPassive
  ${IfThen} $PassiveMode = 1  ${|} Abort ${|}
FunctionEnd
!endif

Function CreateOrUpdateStartMenuShortcut
  StrCpy $R0 0

  !insertmacro IsShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\$OldMainBinaryName"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    StrCpy $R0 1
  ${EndIf}

  ${If} $R0 = 1
    Return
  ${EndIf}

  ${If} $WixMode = 0
    ${If} $UpdateMode = 1
    ${OrIf} $NoShortcutMode = 1
      Return
    ${EndIf}
  ${EndIf}

  CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
FunctionEnd

Function CreateOrUpdateDesktopShortcut
  !insertmacro IsShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\$OldMainBinaryName"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Return
  ${EndIf}

  ${If} $WixMode = 0
    ${If} $UpdateMode = 1
    ${OrIf} $NoShortcutMode = 1
      Return
    ${EndIf}
  ${EndIf}

  CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
FunctionEnd
