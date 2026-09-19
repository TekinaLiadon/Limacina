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
Var DirField
Var RunAppCheckbox
Var DesktopShortcutCheckbox

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
    StrCpy $FontsReady 1
  ${EndIf}
FunctionEnd

Function StyleWizard
  Call CreateWizardFonts
  SetCtlColors $HWNDPARENT "" ${COLOR_BG}
  GetDlgItem $0 $HWNDPARENT 1034
  SetCtlColors $0 "" ${COLOR_BG}
  GetDlgItem $0 $HWNDPARENT 1035
  SetCtlColors $0 "" ${COLOR_BG}
  GetDlgItem $0 $HWNDPARENT 1036
  SetCtlColors $0 "" ${COLOR_BG}
  GetDlgItem $0 $HWNDPARENT 1037
  SetCtlColors $0 ${COLOR_TEXT} ${COLOR_BG}
  SendMessage $0 ${WM_SETFONT} $FontHeading 1
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
    StrCpy $FontsReady 1
  ${EndIf}
FunctionEnd

Function un.StyleWizard
  Call un.CreateWizardFonts
  SetCtlColors $HWNDPARENT "" ${COLOR_BG}
  GetDlgItem $0 $HWNDPARENT 1034
  SetCtlColors $0 "" ${COLOR_BG}
  GetDlgItem $0 $HWNDPARENT 1035
  SetCtlColors $0 "" ${COLOR_BG}
  GetDlgItem $0 $HWNDPARENT 1036
  SetCtlColors $0 "" ${COLOR_BG}
  GetDlgItem $0 $HWNDPARENT 1037
  SetCtlColors $0 ${COLOR_TEXT} ${COLOR_BG}
  SendMessage $0 ${WM_SETFONT} $FontHeading 1
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
  !insertmacro MUI_HEADER_TEXT "" ""
  nsDialogs::Create 1018
  Pop $DIALOG
  SetCtlColors $DIALOG "" ${COLOR_BG}

  ${NSD_CreateLabel} 0 22u 100% 26u "${PRODUCTNAME}"
  Pop $0
  ${NSD_AddStyle} $0 ${SS_CENTER}
  SendMessage $0 ${WM_SETFONT} $FontHeading 1
  SetCtlColors $0 ${COLOR_ACCENT} ${COLOR_BG}

  ${NSD_CreateLabel} 110u 54u 80u 4u ""
  Pop $0
  SetCtlColors $0 "" ${COLOR_ACCENT}

  ${NSD_CreateLabel} 0 70u 100% 16u "Добро пожаловать!"
  Pop $0
  ${NSD_AddStyle} $0 ${SS_CENTER}
  SendMessage $0 ${WM_SETFONT} $FontHeading 1
  SetCtlColors $0 ${COLOR_TEXT} ${COLOR_BG}

  ${NSD_CreateLabel} 20u 96u -20u 28u "Майнкрафт-лаунчер: установка игры, модов и Java в один клик.$\nНажмите «Далее», чтобы выбрать папку установки."
  Pop $0
  ${NSD_AddStyle} $0 ${SS_CENTER}
  SendMessage $0 ${WM_SETFONT} $FontBody 1
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_BG}

  ${NSD_CreateLabel} 0 -22u 100% 10u "Версия ${VERSION}"
  Pop $0
  ${NSD_AddStyle} $0 ${SS_CENTER}
  SendMessage $0 ${WM_SETFONT} $FontCaption 1
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_BG}

  nsDialogs::Show
FunctionEnd

Function PageReinstall
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
    nsDialogs::Create 1018
    Pop $R4
    ${IfThen} $(^RTL) = 1 ${|} nsDialogs::SetRTL $(^RTL) ${|}
    SetCtlColors $R4 "" ${COLOR_BG}

    ${NSD_CreateLabel} 0 0 100% 24u $R1
    Pop $R1
    SendMessage $R1 ${WM_SETFONT} $FontBody 1
    SetCtlColors $R1 ${COLOR_MUTED} ${COLOR_BG}

    ${NSD_CreateRadioButton} 30u 50u -30u 8u $R2
    Pop $R2
    SendMessage $R2 ${WM_SETFONT} $FontBody 1
    SetCtlColors $R2 ${COLOR_TEXT} ${COLOR_BG}
    ${NSD_OnClick} $R2 PageReinstallUpdateSelection

    ${NSD_CreateRadioButton} 30u 70u -30u 8u $R3
    Pop $R3
    SendMessage $R3 ${WM_SETFONT} $FontBody 1
    SetCtlColors $R3 ${COLOR_TEXT} ${COLOR_BG}
    !if "${ALLOWDOWNGRADES}" == "false"
      ${IfThen} $R0 = -1 ${|} EnableWindow $R3 0 ${|}
    !endif
    ${NSD_OnClick} $R3 PageReinstallUpdateSelection

    ${If} $ReinstallPageCheck <> 2
      SendMessage $R2 ${BM_SETCHECK} ${BST_CHECKED} 0
    ${Else}
      SendMessage $R3 ${BM_SETCHECK} ${BST_CHECKED} 0
    ${EndIf}

    ${NSD_SetFocus} $R2
    nsDialogs::Show
  ${EndIf}
FunctionEnd

Function PageReinstallUpdateSelection
  ${NSD_GetState} $R2 $R1
  ${If} $R1 == ${BST_CHECKED}
    StrCpy $ReinstallPageCheck 1
  ${Else}
    StrCpy $ReinstallPageCheck 2
  ${EndIf}
FunctionEnd

Function PageLeaveReinstall
  ${NSD_GetState} $R2 $R1

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
  !insertmacro MUI_HEADER_TEXT "Папка установки" "Выберите, куда установить ${PRODUCTNAME}"
  nsDialogs::Create 1018
  Pop $DIALOG
  SetCtlColors $DIALOG "" ${COLOR_BG}

  ${NSD_CreateLabel} 0 6u 100% 14u "Куда установить ${PRODUCTNAME}?"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $FontHeading 1
  SetCtlColors $0 ${COLOR_TEXT} ${COLOR_BG}

  ${NSD_CreateLabel} 0 26u 100% 10u "Файлы лаунчера будут установлены в выбранную папку."
  Pop $0
  SendMessage $0 ${WM_SETFONT} $FontBody 1
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_BG}

  ${NSD_CreateText} 0 46u 220u 15u "$INSTDIR"
  Pop $DirField
  SendMessage $DirField ${WM_SETFONT} $FontBody 1
  SetCtlColors $DirField ${COLOR_TEXT} ${COLOR_BG_INPUT}

  ${NSD_CreateButton} 228u 45u 72u 17u "Обзор..."
  Pop $0
  SendMessage $0 ${WM_SETFONT} $FontButton 1
  SetCtlColors $0 ${COLOR_TEXT} ${COLOR_SURFACE}
  ${NSD_OnClick} $0 PageDirectoryBrowse

  ${NSD_CreateLabel} 0 72u 100% 20u "Лаунчер устанавливается без прав администратора. Игры и данные хранятся отдельно, в папке профиля пользователя."
  Pop $0
  SendMessage $0 ${WM_SETFONT} $FontCaption 1
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_BG}

  nsDialogs::Show
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
  FindWindow $1 "#32770" "" $HWNDPARENT
  SetCtlColors $1 "" ${COLOR_BG}
  GetDlgItem $0 $1 1016
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_BG}
  SendMessage $0 ${WM_SETFONT} $FontBody 1
  GetDlgItem $0 $1 1027
  SetCtlColors $0 ${COLOR_TEXT} ${COLOR_SURFACE}
  SendMessage $0 ${WM_SETFONT} $FontButton 1
  GetDlgItem $0 $1 1029
  SendMessage $0 ${PBM_SETBARCOLOR} 0 ${COLOR_ACCENT}
  SendMessage $0 ${PBM_SETBKCOLOR} 0 ${COLOR_BG_INPUT}
  SetAutoClose false
FunctionEnd

Function PageFinish
  ${If} $PassiveMode = 1
    Abort
  ${EndIf}
  Call StyleWizard
  !insertmacro MUI_HEADER_TEXT "Установка завершена" ""
  nsDialogs::Create 1018
  Pop $DIALOG
  SetCtlColors $DIALOG "" ${COLOR_BG}

  ${NSD_CreateLabel} 0 10u 100% 18u "Установка завершена!"
  Pop $0
  ${NSD_AddStyle} $0 ${SS_CENTER}
  SendMessage $0 ${WM_SETFONT} $FontHeading 1
  SetCtlColors $0 ${COLOR_ACCENT} ${COLOR_BG}

  ${NSD_CreateLabel} 20u 42u -20u 22u "${PRODUCTNAME} ${VERSION} установлен в:$\n$INSTDIR"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $FontBody 1
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_BG}

  ${NSD_CreateCheckbox} 20u 78u -20u 12u "Запустить ${PRODUCTNAME}"
  Pop $RunAppCheckbox
  SendMessage $RunAppCheckbox ${WM_SETFONT} $FontBody 1
  SetCtlColors $RunAppCheckbox ${COLOR_TEXT} ${COLOR_BG}
  SendMessage $RunAppCheckbox ${BM_SETCHECK} ${BST_CHECKED} 0

  ${NSD_CreateCheckbox} 20u 100u -20u 12u "Создать ярлык на рабочем столе"
  Pop $DesktopShortcutCheckbox
  SendMessage $DesktopShortcutCheckbox ${WM_SETFONT} $FontBody 1
  SetCtlColors $DesktopShortcutCheckbox ${COLOR_TEXT} ${COLOR_BG}
  SendMessage $DesktopShortcutCheckbox ${BM_SETCHECK} ${BST_CHECKED} 0

  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:Готово"
  GetDlgItem $0 $HWNDPARENT 3
  ShowWindow $0 0

  nsDialogs::Show
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
  ${NSD_GetState} $RunAppCheckbox $1
  ${If} $1 = ${BST_CHECKED}
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
  GetDlgItem $0 $1 1016
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_BG}
  SendMessage $0 ${WM_SETFONT} $FontBody 1
  GetDlgItem $0 $1 1027
  SetCtlColors $0 ${COLOR_TEXT} ${COLOR_SURFACE}
  SendMessage $0 ${WM_SETFONT} $FontButton 1
  GetDlgItem $0 $1 1029
  SendMessage $0 ${PBM_SETBARCOLOR} 0 ${COLOR_ACCENT}
  SendMessage $0 ${PBM_SETBKCOLOR} 0 ${COLOR_BG_INPUT}
FunctionEnd

Function un.PageConfirm
  ${If} $PassiveMode = 1
    Abort
  ${EndIf}
  ${If} $UpdateMode = 1
    Abort
  ${EndIf}
  Call un.StyleWizard
  !insertmacro MUI_HEADER_TEXT "Удаление ${PRODUCTNAME}" ""
  nsDialogs::Create 1018
  Pop $DIALOG
  SetCtlColors $DIALOG "" ${COLOR_BG}

  ReadRegStr $0 SHCTX "${MANUPRODUCTKEY}" "DataPath"
  StrCpy $1 "$PROFILE\${PRODUCTNAME}"
  ${If} $0 != ""
    StrCpy $1 $0
  ${EndIf}

  ${NSD_CreateLabel} 0 8u 100% 16u "Удалить ${PRODUCTNAME}?"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $FontHeading 1
  SetCtlColors $0 ${COLOR_TEXT} ${COLOR_BG}

  ${NSD_CreateLabel} 0 34u 100% 80u "Будут удалены:$\n$\n— файлы программы: $INSTDIR$\n— папка данных: $1 (конфиги, сессии и все установленные файлы игр)$\n$\nДействие нельзя отменить."
  Pop $0
  SendMessage $0 ${WM_SETFONT} $FontBody 1
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_BG}

  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:Удалить"

  nsDialogs::Show
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
    DeleteRegKey SHCTX "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty SHCTX "${MANUKEY}"

    DeleteRegValue HKCU "${MANUPRODUCTKEY}" "Installer Language"
    DeleteRegKey /ifempty HKCU "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty HKCU "${MANUKEY}"

    SetShellVarContext current
    ReadRegStr $0 SHCTX "${MANUPRODUCTKEY}" "DataPath"
    StrCpy $1 "${PRODUCTNAME}"
    ${If} $0 != ""
      RmDir /r "$0"
      ${GetFileName} $0 $1
    ${EndIf}
    RmDir /r "$PROFILE\$1"
    RmDir /r "$APPDATA\$1"
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
