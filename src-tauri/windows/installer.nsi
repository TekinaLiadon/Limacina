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

; Требуемое место для подсказки на шаге папки: КБ → МБ с округлением вверх.
!define /math LIMA_SIZE_TMP "{{estimated_size}}" + 1023
!define /math LIMA_SIZE_MB "${LIMA_SIZE_TMP}" / 1024

; ── Палитра прототипа (SetCtlColors принимает 0xRRGGBB) ─────────────
!define COLOR_BG "0x05060F"          ; #05060f фон окна
!define COLOR_SIDEBAR "0x0B0E1C"     ; #0b0e1c фон сайдбара
!define COLOR_LINE "0x1B1F2B"        ; rgba(186,215,247,.12) на фоне
!define COLOR_TEXT "0xD8ECF8"        ; #d8ecf8 заголовки
!define COLOR_BODY "0xC7D3EA"        ; #c7d3ea основной текст
!define COLOR_MUTED "0x9DA7BA"       ; #9da7ba вторичный текст
!define COLOR_ACCENT "0x663AF3"      ; #663af3 акцент
!define COLOR_ACCENT_DIM "0x231954"  ; rgba(102,58,243,.26) на сайдбаре
!define COLOR_INPUT "0x10121D"       ; rgba(186,214,247,.06) поля и кнопки
!define COLOR_PANEL "0x0A0C16"       ; rgba(186,214,247,.03) панель лога
!define COLOR_SIDECIRCLE "0x202635"  ; rgba(186,215,247,.12) на сайдбаре
; Для сообщений Windows (PBM_*) нужен COLORREF 0x00BBGGRR
!define COLORREF_ACCENT "0xF33A66"   ; COLORREF #663af3
!define COLORREF_INPUT "0x1D1210"    ; COLORREF #10121d
!define COLORREF_LINE "0x2B1F1B"     ; COLORREF #1b1f2b

; ── Константы Win32 ─────────────────────────────────────────────────
!define /ifndef WM_SETFONT 0x0030
!define /ifndef PBM_SETBARCOLOR 0x0409
!define /ifndef PBM_SETBKCOLOR 0x2001
!define /ifndef PBM_SETRANGE32 0x0406
!define /ifndef SS_CENTER 0x00000001
!define /ifndef SS_CENTERIMAGE 0x00000200
!define /ifndef SS_NOTIFY 0x00000100
!define /ifndef WS_TABSTOP 0x00010000
!define /ifndef SS_ICON 0x00000003
!define /ifndef WS_GROUP 0x00020000
!define /ifndef BST_CHECKED 0x0001
!define /ifndef DM_SETDEFID 0x0401
!define /ifndef STM_SETIMAGE 0x0172

!define STYLE_LABEL "0x50000000"          ; WS_CHILD|WS_VISIBLE
!define STYLE_ROW "0x50000200"            ; + SS_CENTERIMAGE — центр строки
!define STYLE_CENTER "0x50000301"         ; + SS_CENTER|SS_CENTERIMAGE|SS_NOTIFY
!define STYLE_ICON "0x50000003"           ; + SS_ICON
!define STYLE_BITMAP "0x50000008"         ; + SS_BITMAP

; Комбинации SWP-флагов (NSIS не умеет OR в параметрах).
!define /ifndef SWP_NOZORDER 0x0004
!define SWP_ZSIZE 0x14      ; NOZORDER|NOACTIVATE — менять размер/позицию
!define SWP_HIDE 0x15       ; NOSIZE|NOZORDER|NOACTIVATE — спрятать кнопку
!define SWP_REZ 0x13        ; NOSIZE|NOMOVE|NOACTIVATE — только Z-порядок
!define SWP_FRAME 0x23      ; NOSIZE|NOMOVE|FRAMECHANGED
!define SWP_SHOW 0x0040     ; SHOWWINDOW — двигать, красить и показать

; ── Шрифты (TTF рядом с шаблоном, собираются `bun run build:installer-fonts`)
; Путь выводится из абсолютного ${INSTALLERICON}: …\src-tauri\icons\icon.ico
; → …\src-tauri\windows\fonts\. Если файлов нет, makensis предупредит, а
; установщик молча откатится на системный Segoe UI.
!if "${INSTALLERICON}" != ""
  !searchparse /noerrors "${INSTALLERICON}" "icons" LIMA_ICONS_TAIL
  !searchreplace LIMA_FONTS_DIR "${INSTALLERICON}" "icons${LIMA_ICONS_TAIL}" "windows\fonts\"
!else
  !define LIMA_FONTS_DIR ""
!endif

Var PassiveMode
Var UpdateMode
Var NoShortcutMode
Var WixMode
Var OldMainBinaryName
Var ReinstallPageCheck
Var DIALOG
Var Inner
Var DPI
Var ShellReady
Var FontsOk
Var FaceBody
Var FaceMed
Var FaceDisp
Var FontH1
Var FontSub
Var FontText
Var FontBtn
Var FontSide
Var FontNum
Var FontCap
Var FontLogo
Var WinW
Var WinH
Var SideW
Var ContentX
Var ContentW
Var ContentW2
Var PadT
Var PadL
Var PadR
Var H1H
Var SubY
Var SubH
Var SubH2
Var BodyTop
Var FooterBtnY
Var FooterLineY
Var BtnH
Var BtnGap
Var BtnMinW
Var FooterX
Var NavOverlay1
Var NavOverlay2
Var NavOverlay3
Var FocusPill
Var FooterLine
Var Radio1
Var Radio2
Var DirField
Var ShortcutCheckbox
Var ShortcutWanted
Var RunAppCheckbox
Var UserDataCheckbox
Var DeleteUserData
Var DataStateLabel
Var ConfirmDataPath
Var InstOverlay
Var InstProgress
Var InstStatus
Var BtnText
Var BtnId
Var BtnTab
Var BtnPrim
Var BtnEn
Var BtnW

!macro ScaleTo _var _px
  IntOp ${_var} ${_px} * $DPI
  IntOp ${_var} ${_var} / 96
!macroend

!macro CreateWizardFont _var _px _face _weight
  IntOp $0 $DPI * ${_px}
  IntOp $0 $0 / 96
  IntOp $0 0 - $0
  System::Call 'gdi32::CreateFontW(i r0, i 0, i 0, i 0, i ${_weight}, i 0, i 0, i 0, i 0, i 0, i 0, i 5, i 0, w "${_face}") i.s'
  Pop ${_var}
!macroend

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

; ── Универсальное создание STATIC ────────────────────────────────────
; _nsd=1 — контрол nsDialogs внутри $DIALOG (умирает со страницей);
; _nsd=0 — Win32-контрол внутри $Inner; _nsd=2 — Win32-контрол внутри
; внешнего окна $HWNDPARENT (надёжно рендерится на страницах файлов).
; Хендл — на стеке.
!macro WStatic _nsd _style _x _y _w _h _text
  !if "${_nsd}" == "1"
    !if "${_style}" == "${STYLE_ICON}"
      ${NSD_CreateIcon} ${_x} ${_y} ${_w} ${_h} `${_text}`
    !else if "${_style}" == "${STYLE_BITMAP}"
      ${NSD_CreateBitmap} ${_x} ${_y} ${_w} ${_h} `${_text}`
    !else
      ${NSD_CreateLabel} ${_x} ${_y} ${_w} ${_h} `${_text}`
      Pop $0
      ${NSD_AddStyle} $0 ${_style}
      Push $0
    !endif
  !else
    !if "${_nsd}" == "0"
      StrCpy $R7 $Inner
    !else
      StrCpy $R7 $HWNDPARENT
    !endif
    System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w `${_text}`, i ${_style}, i ${_x}, i ${_y}, i ${_w}, i ${_h}, p $R7, p 0, p 0, p 0) p.s'
  !endif
!macroend

; Заголовок страницы: H1 + подзаголовок в контентной области.
!macro PageHeading _nsd _title _sub _subh
  !insertmacro WStatic ${_nsd} ${STYLE_LABEL} $ContentX $PadT $ContentW $H1H "${_title}"
  Pop $0
  SetCtlColors $0 ${COLOR_TEXT} ${COLOR_BG}
  SendMessage $0 ${WM_SETFONT} $FontH1 1
  !insertmacro WStatic ${_nsd} ${STYLE_LABEL} $ContentX $SubY $ContentW ${_subh} "${_sub}"
  Pop $0
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_BG}
  SendMessage $0 ${WM_SETFONT} $FontSub 1
!macroend

; ── Сайдбар с шагами ────────────────────────────────────────────────
!macro SidebarItem _nsd _num _text _active
  ${If} "${_text}" != ""
    !insertmacro ScaleTo $1 14
    !insertmacro ScaleTo $2 28
    !insertmacro ScaleTo $3 44
    !insertmacro ScaleTo $4 40
    !insertmacro ScaleTo $5 22
    !insertmacro ScaleTo $6 12
    !if "${_num}" == "2"
      IntOp $2 $2 + $3
    !endif
    !if "${_num}" == "3"
      IntOp $2 $2 + $3
      IntOp $2 $2 + $3
    !endif
    !if "${_num}" == "4"
      IntOp $2 $2 + $3
      IntOp $2 $2 + $3
      IntOp $2 $2 + $3
    !endif
    IntOp $7 $SideW - $1
    IntOp $7 $7 - $1
    ${If} "${_active}" == "${_num}"
      !insertmacro WStatic ${_nsd} ${STYLE_LABEL} $1 $2 $7 $4 ""
      Pop $0
      SetCtlColors $0 "" ${COLOR_ACCENT_DIM}
    ${EndIf}
    IntOp $7 $4 - $5
    IntOp $7 $7 / 2
    IntOp $7 $7 + $2
    !insertmacro WStatic ${_nsd} ${STYLE_CENTER} $1 $7 $5 $5 "${_num}"
    Pop $0
    ${If} "${_active}" == "${_num}"
      SetCtlColors $0 0xFFFFFF ${COLOR_ACCENT}
    ${Else}
      SetCtlColors $0 ${COLOR_MUTED} ${COLOR_SIDECIRCLE}
    ${EndIf}
    SendMessage $0 ${WM_SETFONT} $FontNum 1
    IntOp $7 $1 + $6
    IntOp $7 $7 + $5
    IntOp $7 $7 + $6
    IntOp $8 $SideW - $7
    !insertmacro ScaleTo $9 6
    IntOp $8 $8 - $9
    !insertmacro WStatic ${_nsd} ${STYLE_ROW} $7 $2 $8 $4 "${_text}"
    Pop $0
    ${If} "${_active}" == "${_num}"
      SetCtlColors $0 ${COLOR_TEXT} ${COLOR_ACCENT_DIM}
    ${Else}
      SetCtlColors $0 ${COLOR_MUTED} ${COLOR_SIDEBAR}
    ${EndIf}
    SendMessage $0 ${WM_SETFONT} $FontSide 1
  ${EndIf}
!macroend

; Сайдбар: у установщика 4 шага, у деинсталлятора 3 (четвёртый пустой).
!macro DrawSidebar _nsd _t1 _t2 _t3 _t4 _active
  !insertmacro WStatic ${_nsd} ${STYLE_LABEL} 0 0 $SideW $WinH ""
  Pop $0
  SetCtlColors $0 "" ${COLOR_SIDEBAR}
  !insertmacro ScaleTo $1 1
  !insertmacro WStatic ${_nsd} ${STYLE_LABEL} $SideW 0 $1 $WinH ""
  Pop $0
  SetCtlColors $0 "" ${COLOR_LINE}
  !insertmacro SidebarItem ${_nsd} 1 `${_t1}` `${_active}`
  !insertmacro SidebarItem ${_nsd} 2 `${_t2}` `${_active}`
  !insertmacro SidebarItem ${_nsd} 3 `${_t3}` `${_active}`
  !insertmacro SidebarItem ${_nsd} 4 `${_t4}` `${_active}`
  ; логотип: иконка мастера + имя + автор
  !insertmacro ScaleTo $1 22
  !insertmacro ScaleTo $2 32
  !insertmacro ScaleTo $5 12
  StrCpy $3 $WinH
  !insertmacro ScaleTo $4 24
  IntOp $3 $3 - $2
  IntOp $3 $3 - $4
  ; текстовый блок логотипа: имя 26 + автор 16 = 42; иконка 32 центрируется по нему
  IntOp $9 $3 + 5
  ; иконка приложения: logo.bmp из $PLUGINSDIR, растянутая до контрола.
  ; Для страниц nsDialogs контрол живёт в $DIALOG, для страницы файлов — в $Inner.
  ${If} "${_nsd}" == "1"
    ${NSD_CreateBitmap} $1 $9 $2 $2 ""
    Pop $0
  ${Else}
    ; Родитель — $R7, выставленный WStatic: на страницах файлов это
    ; $HWNDPARENT (внутренний диалог $Inner к этому моменту мёртв).
    System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "", i ${STYLE_BITMAP}, i $1, i $9, i $2, i $2, p $R7, p 0, p 0, p 0) p.s'
    Pop $0
  ${EndIf}
  ${NSD_SetStretchedImage} $0 "$PLUGINSDIR\logo.bmp" $4
  System::Call 'user32::SetWindowPos(p $0, p 0, i 0, i 0, i 0, i 0, i ${SWP_REZ})'
  System::Call 'user32::ShowWindow(p $0, i 4)'   ; SW_SHOWNOACTIVATE
  System::Call 'user32::InvalidateRect(p $0, i 0, i 1)'
  IntOp $6 $1 + $2
  IntOp $6 $6 + $5
  IntOp $7 $SideW - $6
  !insertmacro ScaleTo $8 6
  IntOp $7 $7 - $8
  !insertmacro WStatic ${_nsd} ${STYLE_LABEL} $6 $3 $7 26 "${PRODUCTNAME}"
  Pop $0
  SetCtlColors $0 ${COLOR_TEXT} ${COLOR_SIDEBAR}
  SendMessage $0 ${WM_SETFONT} $FontLogo 1
  IntOp $3 $3 + 26
  !insertmacro WStatic ${_nsd} ${STYLE_LABEL} $6 $3 $7 16 "Автор: Tekina"
  Pop $0
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_SIDEBAR}
  SendMessage $0 ${WM_SETFONT} $FontCap 1
!macroend

; ── Кнопки футера ────────────────────────────────────────────────────
; Ширина текста в px@DPI с горизонтальными полями (результат на стеке).
Function BtnWidth
  System::Call 'user32::GetDC(p $HWNDPARENT) p.R1'
  System::Call 'gdi32::SelectObject(p $R1, p $FontBtn) p.R2'
  System::Call 'kernel32::lstrlenW(w "$BtnText") i.R3'
  System::Call '*(i 0, i 0) p.R4'
  System::Call 'gdi32::GetTextExtentPoint32W(p $R1, w "$BtnText", i $R3, p $R4)'
  System::Call '*$R4(i .R3, i .R4)'
  System::Free $R4
  System::Call 'gdi32::SelectObject(p $R1, p $R2)'
  System::Call 'user32::ReleaseDC(p $HWNDPARENT, p $R1)'
  IntOp $R3 $R3 * $DPI
  IntOp $R3 $R3 / 96
  IntOp $R3 $R3 + $BtnGap
  IntOp $R3 $R3 + $BtnGap
  ${If} $R3 < $BtnMinW
    StrCpy $R3 $BtnMinW
  ${EndIf}
  StrCpy $BtnW $R3
FunctionEnd

; Одна пилюля вместо спрятанной настоящей кнопки (id 1/2/3).
; Стек: текст, id, primary(0/1), enabled(0/1) — сверху enabled.
Function AddFooterBtn
  Call BtnWidth
  IntOp $FooterX $FooterX - $BtnW
  StrCpy $0 ${STYLE_CENTER}
  ${If} $BtnTab = 1
    IntOp $0 $0 | ${WS_TABSTOP}
  ${EndIf}
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "$BtnText", i $0, i $FooterX, i $FooterBtnY, i $BtnW, i $BtnH, p $HWNDPARENT, p $BtnId, p 0, p 0) p.s'
  Pop $0
  ${If} $BtnPrim = 1
    ${If} $BtnEn = 1
      SetCtlColors $0 0xFFFFFF ${COLOR_ACCENT}
    ${Else}
      SetCtlColors $0 ${COLOR_MUTED} ${COLOR_ACCENT}
    ${EndIf}
  ${Else}
    ${If} $BtnEn = 1
      SetCtlColors $0 ${COLOR_BODY} ${COLOR_INPUT}
    ${Else}
      SetCtlColors $0 ${COLOR_MUTED} ${COLOR_INPUT}
    ${EndIf}
  ${EndIf}
  ${If} $BtnEn = 0
    EnableWindow $0 0
  ${EndIf}
  SendMessage $0 ${WM_SETFONT} $FontBtn 1
  ${If} $BtnId = 1
    StrCpy $NavOverlay1 $0
  ${ElseIf} $BtnId = 2
    StrCpy $NavOverlay2 $0
  ${ElseIf} $BtnId = 3
    StrCpy $NavOverlay3 $0
  ${EndIf}
  IntOp $FooterX $FooterX - $BtnGap
FunctionEnd

; ── Дубли для деинсталлятора: он не видит функции инсталлятора ──────
Function un.BtnWidth
  System::Call 'user32::GetDC(p $HWNDPARENT) p.R1'
  System::Call 'gdi32::SelectObject(p $R1, p $FontBtn) p.R2'
  System::Call 'kernel32::lstrlenW(w "$BtnText") i.R3'
  System::Call '*(i 0, i 0) p.R4'
  System::Call 'gdi32::GetTextExtentPoint32W(p $R1, w "$BtnText", i $R3, p $R4)'
  System::Call '*$R4(i .R3, i .R4)'
  System::Free $R4
  System::Call 'gdi32::SelectObject(p $R1, p $R2)'
  System::Call 'user32::ReleaseDC(p $HWNDPARENT, p $R1)'
  IntOp $R3 $R3 * $DPI
  IntOp $R3 $R3 / 96
  IntOp $R3 $R3 + $BtnGap
  IntOp $R3 $R3 + $BtnGap
  ${If} $R3 < $BtnMinW
    StrCpy $R3 $BtnMinW
  ${EndIf}
  StrCpy $BtnW $R3
FunctionEnd

Function un.AddFooterBtn
  Call un.BtnWidth
  IntOp $FooterX $FooterX - $BtnW
  StrCpy $0 ${STYLE_CENTER}
  ${If} $BtnTab = 1
    IntOp $0 $0 | ${WS_TABSTOP}
  ${EndIf}
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "$BtnText", i $0, i $FooterX, i $FooterBtnY, i $BtnW, i $BtnH, p $HWNDPARENT, p $BtnId, p 0, p 0) p.s'
  Pop $0
  ${If} $BtnPrim = 1
    ${If} $BtnEn = 1
      SetCtlColors $0 0xFFFFFF ${COLOR_ACCENT}
    ${Else}
      SetCtlColors $0 ${COLOR_MUTED} ${COLOR_ACCENT}
    ${EndIf}
  ${Else}
    ${If} $BtnEn = 1
      SetCtlColors $0 ${COLOR_BODY} ${COLOR_INPUT}
    ${Else}
      SetCtlColors $0 ${COLOR_MUTED} ${COLOR_INPUT}
    ${EndIf}
  ${EndIf}
  ${If} $BtnEn = 0
    EnableWindow $0 0
  ${EndIf}
  SendMessage $0 ${WM_SETFONT} $FontBtn 1
  ${If} $BtnId = 1
    StrCpy $NavOverlay1 $0
  ${ElseIf} $BtnId = 2
    StrCpy $NavOverlay2 $0
  ${ElseIf} $BtnId = 3
    StrCpy $NavOverlay3 $0
  ${EndIf}
  IntOp $FooterX $FooterX - $BtnGap
FunctionEnd

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
  ${If} $FooterLine <> 0
    System::Call 'user32::DestroyWindow(p $FooterLine)'
    StrCpy $FooterLine 0
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

; Спрятать настоящие кнопки мастера — вместо них пилюли.
; Табстопы снимаются, иначе Tab по кромке уходит в невидимые кнопки.
!macro HideRealNavBtns
  GetDlgItem $0 $HWNDPARENT 1
  System::Call 'user32::SetWindowPos(p $0, p 0, i -32000, i -32000, i 0, i 0, i ${SWP_HIDE})'
  System::Call 'user32::GetWindowLongW(p $0, i -16) i.r1'
  IntOp $1 $1 & 0xFFFEFFFF
  System::Call 'user32::SetWindowLongW(p $0, i -16, i r1)'
  GetDlgItem $0 $HWNDPARENT 2
  System::Call 'user32::SetWindowPos(p $0, p 0, i -32000, i -32000, i 0, i 0, i ${SWP_HIDE})'
  System::Call 'user32::GetWindowLongW(p $0, i -16) i.r1'
  IntOp $1 $1 & 0xFFFEFFFF
  System::Call 'user32::SetWindowLongW(p $0, i -16, i r1)'
  GetDlgItem $0 $HWNDPARENT 3
  System::Call 'user32::SetWindowPos(p $0, p 0, i -32000, i -32000, i 0, i 0, i ${SWP_HIDE})'
  System::Call 'user32::GetWindowLongW(p $0, i -16) i.r1'
  IntOp $1 $1 & 0xFFFEFFFF
  System::Call 'user32::SetWindowLongW(p $0, i -16, i r1)'
!macroend

; Линия-разделитель футера. Перед вызовом задать $FooterX.
!macro FooterLine
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "", i ${STYLE_LABEL}, i $SideW, i $FooterLineY, i $ContentW2, i 1, p $HWNDPARENT, p 0, p 0, p 0) p.s'
  Pop $0
  SetCtlColors $0 "" ${COLOR_LINE}
  StrCpy $FooterLine $0
!macroend

; ── Кольцо фокуса и опрос ────────────────────────────────────────────
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
  System::Call 'user32::GetWindow(p `${_overlay}`, i 2) p.r8'
  ${If} $8 = 0
    StrCpy $8 1
  ${EndIf}
  System::Call 'user32::SetWindowPos(p $FocusPill, p $8, i r2, i r3, i r6, i r7, i 0x50)'
  System::Call 'user32::RedrawWindow(p $FocusPill, i 0, i 0, i 0x185)'
!macroend

!macro RaisePillsCore
  ${If} $FooterLine <> 0
    System::Call 'user32::SetWindowPos(p $FooterLine, p 0, i 0, i 0, i 0, i 0, i ${SWP_REZ})'
  ${EndIf}
  ${If} $NavOverlay3 <> 0
    System::Call 'user32::SetWindowPos(p $NavOverlay3, p 0, i 0, i 0, i 0, i 0, i ${SWP_REZ})'
  ${EndIf}
  ${If} $NavOverlay2 <> 0
    System::Call 'user32::SetWindowPos(p $NavOverlay2, p 0, i 0, i 0, i 0, i 0, i ${SWP_REZ})'
  ${EndIf}
  ${If} $NavOverlay1 <> 0
    System::Call 'user32::SetWindowPos(p $NavOverlay1, p 0, i 0, i 0, i 0, i 0, i ${SWP_REZ})'
  ${EndIf}
!macroend

!macro FocusPollCore
  !insertmacro RaisePillsCore
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

; Пилюли создаются до nsDialogs::Show, а плагин при показе страницы
; поднимает свой диалог на вершину z-порядка — он глотает клики.
; Одноразовый таймер возвращает кнопкам верхнюю позицию уже внутри
; цикла сообщений страницы и самоуничтожается.
Function RaisePills
  !insertmacro RaisePillsCore
  ${NSD_KillTimer} RaisePills
FunctionEnd

Function un.RaisePills
  !insertmacro RaisePillsCore
  ${NSD_KillTimer} un.RaisePills
FunctionEnd

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
UninstPage custom un.PageDone

{{#each languages}}
!insertmacro MUI_LANGUAGE "{{this}}"
{{/each}}
!insertmacro MUI_RESERVEFILE_LANGDLL
{{#each language_files}}
  !include "{{this}}"
{{/each}}

; ── Шрифты: TTF из репозитория → $TEMP → GDI (FR_PRIVATE) ───────────
Function InitWizardFonts
  StrCpy $FontsOk 1
  InitPluginsDir
  !if "${LIMA_FONTS_DIR}" != ""
    File /nonfatal "/oname=$PLUGINSDIR\logo.bmp" "${LIMA_FONTS_DIR}logo.bmp"
    File /nonfatal "/oname=$PLUGINSDIR\manrope-400.ttf" "${LIMA_FONTS_DIR}manrope-400.ttf"
    File /nonfatal "/oname=$PLUGINSDIR\manrope-500.ttf" "${LIMA_FONTS_DIR}manrope-500.ttf"
    File /nonfatal "/oname=$PLUGINSDIR\onest-500.ttf" "${LIMA_FONTS_DIR}onest-500.ttf"
    System::Call 'gdi32::AddFontResourceExW(w "$PLUGINSDIR\manrope-400.ttf", i 0x10, i 0) i.r0'
    ${If} $0 = 0
      StrCpy $FontsOk 0
    ${EndIf}
    System::Call 'gdi32::AddFontResourceExW(w "$PLUGINSDIR\manrope-500.ttf", i 0x10, i 0) i.r0'
    ${If} $0 = 0
      StrCpy $FontsOk 0
    ${EndIf}
    System::Call 'gdi32::AddFontResourceExW(w "$PLUGINSDIR\onest-500.ttf", i 0x10, i 0) i.r0'
    ${If} $0 = 0
      StrCpy $FontsOk 0
    ${EndIf}
  !else
    StrCpy $FontsOk 0
  !endif
  ${If} $FontsOk = 1
    StrCpy $FaceBody "Manrope"
    StrCpy $FaceMed "Manrope Medium"
    StrCpy $FaceDisp "Onest Medium"
  ${Else}
    StrCpy $FaceBody "Segoe UI"
    StrCpy $FaceMed "Segoe UI Semibold"
    StrCpy $FaceDisp "Segoe UI Semibold"
  ${EndIf}
FunctionEnd

; ── Оболочка: DPI, метрики, шрифты, ресайз окна. Один раз на процесс.
Function ShellApply
  ${If} $ShellReady = 1
    Return
  ${EndIf}
  StrCpy $ShellReady 1

  System::Call 'user32::GetDpiForWindow(p $HWNDPARENT) i.r0'
  ${If} $0 <= 0
    StrCpy $DPI 96
  ${Else}
    StrCpy $DPI $0
  ${EndIf}

  !insertmacro ScaleTo $WinW 640
  !insertmacro ScaleTo $WinH 440
  !insertmacro ScaleTo $SideW 184
  !insertmacro ScaleTo $PadT 32
  !insertmacro ScaleTo $PadL 36
  !insertmacro ScaleTo $PadR 32
  !insertmacro ScaleTo $H1H 34
  !insertmacro ScaleTo $SubY 74
  !insertmacro ScaleTo $SubH 16
  !insertmacro ScaleTo $SubH2 36
  !insertmacro ScaleTo $BodyTop 112
  !insertmacro ScaleTo $FooterBtnY 376
  !insertmacro ScaleTo $FooterLineY 360
  !insertmacro ScaleTo $BtnH 44
  !insertmacro ScaleTo $BtnGap 10
  !insertmacro ScaleTo $BtnMinW 96
  IntOp $ContentX $SideW + $PadL
  IntOp $ContentW $WinW - $ContentX
  IntOp $ContentW $ContentW - $PadR
  IntOp $ContentW2 $WinW - $SideW

  !insertmacro CreateWizardFont $FontH1 26 $FaceDisp 600
  !insertmacro CreateWizardFont $FontSub 12 $FaceBody 400
  !insertmacro CreateWizardFont $FontText 14 $FaceBody 400
  !insertmacro CreateWizardFont $FontBtn 14 $FaceMed 500
  !insertmacro CreateWizardFont $FontSide 13 $FaceBody 400
  !insertmacro CreateWizardFont $FontNum 11 $FaceMed 500
  !insertmacro CreateWizardFont $FontCap 11 $FaceBody 400
  !insertmacro CreateWizardFont $FontLogo 17 $FaceDisp 500

  SetCtlColors $HWNDPARENT "" ${COLOR_BG}

  ; Штатные заголовок, линии и брендинг не нужны — свой shell.
  ${For} $1 1034 1039
    GetDlgItem $0 $HWNDPARENT $1
    ${If} $0 <> 0
      System::Call 'user32::DestroyWindow(p $0)'
    ${EndIf}
  ${Next}
  GetDlgItem $0 $HWNDPARENT 1256
  ${If} $0 <> 0
    System::Call 'user32::DestroyWindow(p $0)'
  ${EndIf}

  ; Ресайз окна до клиента 640×440 с сохранением центра. Рамку считаем
  ; по стилям окна: GetClientRect у мастера в этот момент отдаёт нули.
  System::Call '*(i 0, i 0, i $WinW, i $WinH) p.r1'
  System::Call 'user32::GetWindowLongW(p $HWNDPARENT, i -16) i.r2'
  System::Call 'user32::GetWindowLongW(p $HWNDPARENT, i -20) i.r3'
  System::Call 'user32::AdjustWindowRectEx(p r1, i r2, i 0, i r3)'
  System::Call '*$1(i .r4, i .r5, i .r6, i .r7)'
  System::Free $1
  IntOp $8 $6 - $4      ; внешняя ширина
  IntOp $9 $7 - $5      ; внешняя высота
  System::Call '*(i 0, i 0, i 0, i 0) p.r1'
  System::Call 'user32::GetWindowRect(p $HWNDPARENT, p r1)'
  System::Call '*$1(i .r2, i .r3, i .r4, i .r5)'
  System::Free $1
  IntOp $6 $4 - $2      ; текущая внешняя ширина
  IntOp $7 $5 - $3      ; текущая внешняя высота
  IntOp $0 $6 - $8
  IntOp $0 $0 / 2
  IntOp $2 $2 + $0      ; newL
  IntOp $0 $7 - $9
  IntOp $0 $0 / 2
  IntOp $3 $3 + $0      ; newT
  System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i $2, i $3, i $8, i $9, i ${SWP_NOZORDER})'

  FindWindow $Inner "#32770" "" $HWNDPARENT
  System::Call 'user32::SetWindowPos(p $Inner, p 0, i 0, i 0, i $WinW, i $WinH, i ${SWP_ZSIZE})'
  SetCtlColors $Inner "" ${COLOR_BG}

  !insertmacro HideRealNavBtns
FunctionEnd

Function un.ShellApply
  ${If} $ShellReady = 1
    Return
  ${EndIf}
  StrCpy $ShellReady 1

  System::Call 'user32::GetDpiForWindow(p $HWNDPARENT) i.r0'
  ${If} $0 <= 0
    StrCpy $DPI 96
  ${Else}
    StrCpy $DPI $0
  ${EndIf}

  !insertmacro ScaleTo $WinW 640
  !insertmacro ScaleTo $WinH 440
  !insertmacro ScaleTo $SideW 184
  !insertmacro ScaleTo $PadT 32
  !insertmacro ScaleTo $PadL 36
  !insertmacro ScaleTo $PadR 32
  !insertmacro ScaleTo $H1H 34
  !insertmacro ScaleTo $SubY 74
  !insertmacro ScaleTo $SubH 16
  !insertmacro ScaleTo $SubH2 36
  !insertmacro ScaleTo $BodyTop 112
  !insertmacro ScaleTo $FooterBtnY 376
  !insertmacro ScaleTo $FooterLineY 360
  !insertmacro ScaleTo $BtnH 44
  !insertmacro ScaleTo $BtnGap 10
  !insertmacro ScaleTo $BtnMinW 96
  IntOp $ContentX $SideW + $PadL
  IntOp $ContentW $WinW - $ContentX
  IntOp $ContentW $ContentW - $PadR
  IntOp $ContentW2 $WinW - $SideW

  !insertmacro CreateWizardFont $FontH1 26 $FaceDisp 600
  !insertmacro CreateWizardFont $FontSub 12 $FaceBody 400
  !insertmacro CreateWizardFont $FontText 14 $FaceBody 400
  !insertmacro CreateWizardFont $FontBtn 14 $FaceMed 500
  !insertmacro CreateWizardFont $FontSide 13 $FaceBody 400
  !insertmacro CreateWizardFont $FontNum 11 $FaceMed 500
  !insertmacro CreateWizardFont $FontCap 11 $FaceBody 400
  !insertmacro CreateWizardFont $FontLogo 17 $FaceDisp 500

  SetCtlColors $HWNDPARENT "" ${COLOR_BG}

  StrCpy $1 1034
  ${For} $1 1034 1039
    GetDlgItem $0 $HWNDPARENT $1
    ${If} $0 <> 0
      System::Call 'user32::DestroyWindow(p $0)'
    ${EndIf}
  ${Next}
  GetDlgItem $0 $HWNDPARENT 1256
  ${If} $0 <> 0
    System::Call 'user32::DestroyWindow(p $0)'
  ${EndIf}

  System::Call '*(i 0, i 0, i $WinW, i $WinH) p.r1'
  System::Call 'user32::GetWindowLongW(p $HWNDPARENT, i -16) i.r2'
  System::Call 'user32::GetWindowLongW(p $HWNDPARENT, i -20) i.r3'
  System::Call 'user32::AdjustWindowRectEx(p r1, i r2, i 0, i r3)'
  System::Call '*$1(i .r4, i .r5, i .r6, i .r7)'
  System::Free $1
  IntOp $8 $6 - $4
  IntOp $9 $7 - $5
  System::Call '*(i 0, i 0, i 0, i 0) p.r1'
  System::Call 'user32::GetWindowRect(p $HWNDPARENT, p r1)'
  System::Call '*$1(i .r2, i .r3, i .r4, i .r5)'
  System::Free $1
  IntOp $6 $4 - $2
  IntOp $7 $5 - $3
  IntOp $0 $6 - $8
  IntOp $0 $0 / 2
  IntOp $2 $2 + $0
  IntOp $0 $7 - $9
  IntOp $0 $0 / 2
  IntOp $3 $3 + $0
  System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i $2, i $3, i $8, i $9, i ${SWP_NOZORDER})'

  FindWindow $Inner "#32770" "" $HWNDPARENT
  System::Call 'user32::SetWindowPos(p $Inner, p 0, i 0, i 0, i $WinW, i $WinH, i ${SWP_ZSIZE})'
  SetCtlColors $Inner "" ${COLOR_BG}

  !insertmacro HideRealNavBtns
FunctionEnd

; ── Шаг 1: приветствие ──────────────────────────────────────────────
Function PageWelcome
  ${If} $PassiveMode = 1
    Abort
  ${EndIf}
  Call ShellApply
  !insertmacro HideRealNavBtns
  Call DestroyNavOverlays
  nsDialogs::Create 1018
  Pop $DIALOG
  System::Call 'user32::SetWindowPos(p $DIALOG, p 0, i 0, i 0, i $WinW, i $WinH, i ${SWP_ZSIZE})'
  SetCtlColors $DIALOG "" ${COLOR_BG}

  !insertmacro DrawSidebar 1 "Приветствие" "Папка установки" "Установка" "Завершение" 1
  !insertmacro PageHeading 1 "Установка ${PRODUCTNAME}" "Версия ${VERSION}" $SubH

  !insertmacro ScaleTo $1 22
  ${NSD_CreateLabel} $ContentX $BodyTop $ContentW $1 "Мастер установит ${PRODUCTNAME} на этот компьютер."
  Pop $0
  SetCtlColors $0 ${COLOR_BODY} ${COLOR_BG}
  SendMessage $0 ${WM_SETFONT} $FontText 1
  IntOp $2 $BodyTop + $1
  IntOp $2 $2 + $1
  ${NSD_CreateLabel} $ContentX $2 $ContentW $1 "Перед продолжением рекомендуем закрыть другие приложения."
  Pop $0
  SetCtlColors $0 ${COLOR_BODY} ${COLOR_BG}
  SendMessage $0 ${WM_SETFONT} $FontText 1

  IntOp $FooterX $WinW - $PadR
  !insertmacro FooterLine
  StrCpy $BtnText "Далее"
StrCpy $BtnId 1
StrCpy $BtnPrim 1
StrCpy $BtnEn 1
StrCpy $BtnTab 1
Call AddFooterBtn
  StrCpy $BtnText "Отмена"
StrCpy $BtnId 2
StrCpy $BtnPrim 0
StrCpy $BtnEn 1
StrCpy $BtnTab 1
Call AddFooterBtn

  ${NSD_CreateTimer} RaisePills 30
  ${NSD_CreateTimer} FocusPoll 50
  nsDialogs::Show
  ${NSD_KillTimer} FocusPoll
  Call DestroyNavOverlays
FunctionEnd

; ── Выбор режима при уже установленной копии ────────────────────────
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
  ${If} $WixMode = 1
    ReadRegStr $R0 HKLM "$R6" "DisplayVersion"
  ${Else}
    ReadRegStr $R0 SHCTX "${UNINSTKEY}" "DisplayVersion"
  ${EndIf}
  ${IfThen} $R0 == "" ${|} StrCpy $R4 "unknown" ${|}

  nsis_tauri_utils::SemverCompare "${VERSION}" $R0
  Pop $R0
  ${If} $R0 = 0
    StrCpy $R1 "$(alreadyInstalledLong)"
    StrCpy $R2 "$(addOrReinstall)"
    StrCpy $R3 "$(uninstallApp)"
  ${ElseIf} $R0 = 1
    StrCpy $R1 "$(olderOrUnknownVersionInstalled)"
    StrCpy $R2 "$(uninstallBeforeInstalling)"
    StrCpy $R3 "$(dontUninstall)"
  ${ElseIf} $R0 = -1
    StrCpy $R1 "$(newerVersionInstalled)"
    StrCpy $R2 "$(uninstallBeforeInstalling)"
    !if "${ALLOWDOWNGRADES}" == "true"
      StrCpy $R3 "$(dontUninstall)"
    !else
      StrCpy $R3 "$(dontUninstallDowngrade)"
    !endif
  ${Else}
    Abort
  ${EndIf}

  ${If} $PassiveMode = 1
    Call PageLeaveReinstall
  ${Else}
    Call ShellApply
    !insertmacro HideRealNavBtns
    Call DestroyNavOverlays
    nsDialogs::Create 1018
    Pop $DIALOG
    System::Call 'user32::SetWindowPos(p $DIALOG, p 0, i 0, i 0, i $WinW, i $WinH, i ${SWP_ZSIZE})'
    SetCtlColors $DIALOG "" ${COLOR_BG}
    ${IfThen} $(^RTL) = 1 ${|} nsDialogs::SetRTL $(^RTL) ${|}

    !insertmacro DrawSidebar 1 "Приветствие" "Папка установки" "Установка" "Завершение" 0
    !insertmacro PageHeading 1 "$(alreadyInstalled)" "$R1" $SubH2

    !insertmacro ScaleTo $1 44
    !insertmacro ScaleTo $2 10
    ${NSD_CreateRadioButton} $ContentX $BodyTop $ContentW $1 $R2
    Pop $Radio1
    ${NSD_AddStyle} $Radio1 ${WS_GROUP}
    System::Call 'uxtheme::SetWindowTheme(p $Radio1, w "", w "")'
    SendMessage $Radio1 ${WM_SETFONT} $FontText 1
    SetCtlColors $Radio1 ${COLOR_BODY} ${COLOR_BG}
    ${NSD_OnClick} $Radio1 PageReinstallSelect1

    IntOp $3 $BodyTop + $1
    IntOp $3 $3 + $2
    ${NSD_CreateRadioButton} $ContentX $3 $ContentW $1 $R3
    Pop $Radio2
    System::Call 'uxtheme::SetWindowTheme(p $Radio2, w "", w "")'
    SendMessage $Radio2 ${WM_SETFONT} $FontText 1
    SetCtlColors $Radio2 ${COLOR_BODY} ${COLOR_BG}
    ${NSD_OnClick} $Radio2 PageReinstallSelect2

    ${NSD_Check} $Radio1

    !if "${ALLOWDOWNGRADES}" == "false"
      ${If} $R0 = -1
        EnableWindow $Radio2 0
        SetCtlColors $Radio2 ${COLOR_MUTED} ${COLOR_BG}
        StrCpy $ReinstallPageCheck 1
      ${EndIf}
    !endif

    IntOp $FooterX $WinW - $PadR
    !insertmacro FooterLine
    StrCpy $BtnText "Далее"
StrCpy $BtnId 1
StrCpy $BtnPrim 1
StrCpy $BtnEn 1
StrCpy $BtnTab 1
Call AddFooterBtn
    StrCpy $BtnText "Отмена"
StrCpy $BtnId 2
StrCpy $BtnPrim 0
StrCpy $BtnEn 1
StrCpy $BtnTab 1
Call AddFooterBtn
    StrCpy $BtnText "Назад"
StrCpy $BtnId 3
StrCpy $BtnPrim 0
StrCpy $BtnEn 1
StrCpy $BtnTab 1
Call AddFooterBtn

    ${NSD_CreateTimer} RaisePills 30
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

; ── Шаг 2: папка установки ──────────────────────────────────────────
Function PageDirectory
  ${If} $PassiveMode = 1
    Abort
  ${EndIf}
  Call ShellApply
  !insertmacro HideRealNavBtns
  Call DestroyNavOverlays
  nsDialogs::Create 1018
  Pop $DIALOG
  System::Call 'user32::SetWindowPos(p $DIALOG, p 0, i 0, i 0, i $WinW, i $WinH, i ${SWP_ZSIZE})'
  SetCtlColors $DIALOG "" ${COLOR_BG}

  !insertmacro DrawSidebar 1 "Приветствие" "Папка установки" "Установка" "Завершение" 2
  !insertmacro PageHeading 1 "Папка установки" "Выберите, куда установить ${PRODUCTNAME}" $SubH

  !insertmacro ScaleTo $1 44
  !insertmacro ScaleTo $2 10
  StrCpy $BtnText "Обзор…"
Call BtnWidth
StrCpy $3 $BtnW
  IntOp $4 $ContentW - $3
  IntOp $4 $4 - $2
  ${NSD_CreateText} $ContentX $BodyTop $4 $1 "$INSTDIR"
  Pop $DirField
  System::Call 'user32::GetWindowLongW(p $DirField, i -20) i.r5'
  IntOp $5 $5 & 0xFFFFFDFF
  System::Call 'user32::SetWindowLongW(p $DirField, i -20, i r5)'
  System::Call 'user32::SetWindowPos(p $DirField, p 0, i 0, i 0, i 0, i 0, i ${SWP_FRAME})'
  SendMessage $DirField ${WM_SETFONT} $FontText 1
  SetCtlColors $DirField ${COLOR_TEXT} ${COLOR_INPUT}

  IntOp $4 $ContentX + $4
  IntOp $4 $4 + $2
  IntOp $5 $BodyTop - 1
  ${NSD_CreateLabel} $4 $5 $3 $1 "Обзор…"
  Pop $0
  ${NSD_AddStyle} $0 ${STYLE_CENTER}
  SetCtlColors $0 ${COLOR_BODY} ${COLOR_INPUT}
  SendMessage $0 ${WM_SETFONT} $FontBtn 1
  ${NSD_OnClick} $0 PageDirectoryBrowse

  !insertmacro ScaleTo $1 16
  IntOp $2 $BodyTop + 44
  IntOp $2 $2 + 14
  ${NSD_CreateLabel} $ContentX $2 $ContentW $1 "Требуется места: ${LIMA_SIZE_MB} МБ"
  Pop $0
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_BG}
  SendMessage $0 ${WM_SETFONT} $FontSub 1

  !insertmacro ScaleTo $1 44
  IntOp $2 $2 + 16
  IntOp $2 $2 + 14
  ${NSD_CreateCheckbox} $ContentX $2 $ContentW $1 "Создать ярлык на рабочем столе"
  Pop $ShortcutCheckbox
  System::Call 'uxtheme::SetWindowTheme(p $ShortcutCheckbox, w "", w "")'
  SendMessage $ShortcutCheckbox ${WM_SETFONT} $FontText 1
  SetCtlColors $ShortcutCheckbox ${COLOR_BODY} ${COLOR_BG}
  ${NSD_Check} $ShortcutCheckbox

  IntOp $FooterX $WinW - $PadR
  !insertmacro FooterLine
  StrCpy $BtnText "Отмена"
StrCpy $BtnId 2
StrCpy $BtnPrim 0
StrCpy $BtnEn 1
StrCpy $BtnTab 1
Call AddFooterBtn
  StrCpy $BtnText "Установить"
StrCpy $BtnId 1
StrCpy $BtnPrim 1
StrCpy $BtnEn 1
StrCpy $BtnTab 1
Call AddFooterBtn
  StrCpy $BtnText "Назад"
StrCpy $BtnId 3
StrCpy $BtnPrim 0
StrCpy $BtnEn 1
StrCpy $BtnTab 1
Call AddFooterBtn

  ${NSD_CreateTimer} RaisePills 30
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
  StrCpy $ShortcutWanted 0
  ${NSD_GetState} $ShortcutCheckbox $0
  ${If} $0 = ${BST_CHECKED}
    StrCpy $ShortcutWanted 1
  ${EndIf}
FunctionEnd

; ── Шаг 3: установка ────────────────────────────────────────────────
; Страница файлов (native instfiles) рисуется оверлеем: все контролы —
; дети внешнего окна $HWNDPARENT (внутренний диалог $Inner при переходе
; на страницу файлов умирает, и контролы в нём не создаются — чёрный
; экран). Нативные контролы остаются под непрозрачным оверлеем.
  ; $InstOverlay — держатель, убирается при переходе на следующую страницу.

; Нативные контролы страницы файлов рисуют без WS_CLIPSIBLINGS и пробивают
; оверлей (белая панель деталей + зелёный прогресс поверх скина). Прячем
; нативную страницу и уводим её за экран: скрытие гасит перерисовку, а
; вынос за клиент делает невидимыми и контролы, если их кто-то покажет.
!macro HideNativeInstFiles
  FindWindow $0 "#32770" "" $HWNDPARENT
  ${If} $0 <> 0
    System::Call 'user32::SetWindowPos(p $0, p 0, i -32000, i -32000, i 0, i 0, i ${SWP_HIDE})'
    ShowWindow $0 0
  ${EndIf}
  ; Контролы instfiles: статус (1006), прогресс (1004), лог (1016).
  ${For} $1 1004 1006
    GetDlgItem $0 $HWNDPARENT $1
    ${If} $0 <> 0
      System::Call 'user32::SetWindowPos(p $0, p 0, i -32000, i -32000, i 0, i 0, i ${SWP_HIDE})'
      ShowWindow $0 0
    ${EndIf}
  ${Next}
!macroend

; Скин, созданный в show-колбэке, без прокачки очереди сообщений не
; отрисуется до первого обновления нативных контролов внутри секции
; (~пара секунд пустого экрана). Красим всё принудительно и сразу.
!macro RepaintShell
  System::Call 'user32::RedrawWindow(p $HWNDPARENT, i 0, i 0, i 0x185)'
!macroend
!macro ShowInstFilesOverlay _t1 _t2 _t3 _t4 _active _title _sub
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "", i ${STYLE_LABEL}, i 0, i 0, i $WinW, i $WinH, p $HWNDPARENT, p 777, p 0, p 0) p.s'
  Pop $InstOverlay
  SetCtlColors $InstOverlay "" ${COLOR_BG}
  !insertmacro DrawSidebar 3 "${_t1}" "${_t2}" "${_t3}" "${_t4}" "${_active}"
  !insertmacro PageHeading 3 "${_title}" "${_sub}" $SubH
!macroend

; Живой прогресс: нативную полосу (1004) и строку статуса (1006) забираем
; из спрятанной страницы в скин — SetParent на внешнее окно. NSIS продолжает
; обновлять их по хендлам, а выглядят они уже нашими цветами. Полоса
; вставляется сразу над оверлеем (p $InstOverlay), статус — строкой ниже.
; ВАЖНО: бар не переводить в marquee — классический контрол марки не рисует.
!macro AdoptNativeProgress _x _y _w _bh _sy _sh
  FindWindow $0 "#32770" "" $HWNDPARENT
  ${If} $0 <> 0
    GetDlgItem $InstProgress $0 1004
    GetDlgItem $InstStatus $0 1006
  ${EndIf}
  ${If} $InstProgress <> 0
    ; Тематический бар игнорирует PBM_SET*COLOR — снимаем тему (как с чекбоксами).
    ; Диапазон здесь НЕ трогаем: у установщика его задаёт NSIS (проценты
    ; извлечения), у деинсталлятора диапазон выставляет TickProgress.
    System::Call 'uxtheme::SetWindowTheme(p $InstProgress, w "", w "")'
    SendMessage $InstProgress ${PBM_SETBKCOLOR} 0 ${COLORREF_LINE}
    SendMessage $InstProgress ${PBM_SETBARCOLOR} 0 ${COLORREF_ACCENT}
    System::Call 'user32::SetParent(p $InstProgress, p $HWNDPARENT)'
    System::Call 'user32::SetWindowPos(p $InstProgress, p $InstOverlay, i ${_x}, i ${_y}, i ${_w}, i ${_bh}, i ${SWP_SHOW})'
  ${EndIf}
  ${If} $InstStatus <> 0
    System::Call 'user32::GetWindowLongW(p $InstStatus, i -16) i.r1'
    IntOp $1 $1 & 0xFF7FFEFF      ; ~WS_BORDER, ~WS_TABSTOP
    System::Call 'user32::SetWindowLongW(p $InstStatus, i -16, i r1)'
    System::Call 'user32::GetWindowLongW(p $InstStatus, i -20) i.r1'
    IntOp $1 $1 & 0xFFFFFDFF      ; ~WS_EX_CLIENTEDGE
    System::Call 'user32::SetWindowLongW(p $InstStatus, i -20, i r1)'
    System::Call 'user32::SetParent(p $InstStatus, p $HWNDPARENT)'
    SetCtlColors $InstStatus ${COLOR_MUTED} ${COLOR_BG}
    SendMessage $InstStatus ${WM_SETFONT} $FontSub 1
    System::Call 'user32::SetWindowPos(p $InstStatus, p $InstOverlay, i ${_x}, i ${_sy}, i ${_w}, i ${_sh}, i ${SWP_SHOW} | i 0x20)'
  ${EndIf}
!macroend

; Тик фазового прогресса деинсталляции: NSIS в uninstall-баре позицию не
; двигает (он у него в marquee), поэтому секция сама двигает наш бар в
; процентах между основными шагами удаления.
!macro TickProgress _pct
  ${If} $InstProgress <> 0
    SendMessage $InstProgress ${PBM_SETRANGE32} 0 100
    SendMessage $InstProgress ${PBM_SETPOS} ${_pct} 0
  ${EndIf}
!macroend
Function StyleInstFiles
  Call ShellApply
  !insertmacro HideRealNavBtns
  Call DestroyNavOverlays
  !insertmacro HideNativeInstFiles
  !insertmacro ShowInstFilesOverlay "Приветствие" "Папка установки" "Установка" "Завершение" 3 "Установка" "Пожалуйста, подождите"

  IntOp $FooterX $WinW - $PadR
  !insertmacro FooterLine
  StrCpy $BtnText "Отмена"
  StrCpy $BtnId 2
  StrCpy $BtnPrim 0
  StrCpy $BtnEn 1
  StrCpy $BtnTab 0
  Call AddFooterBtn
  StrCpy $BtnText "Далее"
  StrCpy $BtnId 1
  StrCpy $BtnPrim 1
  StrCpy $BtnEn 0
  StrCpy $BtnTab 0
  Call AddFooterBtn
  StrCpy $BtnText "Назад"
  StrCpy $BtnId 3
  StrCpy $BtnPrim 0
  StrCpy $BtnEn 0
  StrCpy $BtnTab 0
  Call AddFooterBtn

  !insertmacro ScaleTo $2 10
  !insertmacro ScaleTo $3 24
  !insertmacro ScaleTo $4 16
  IntOp $5 $BodyTop + $3
  !insertmacro AdoptNativeProgress $ContentX $BodyTop $ContentW $2 $5 $4

  !insertmacro RepaintShell
  ; По завершении установки мастер сам переходит на шаг «Завершение».
  SetAutoClose true
FunctionEnd

; ── Оверлей страницы файлов: подложка + сайдбар + заголовок ─────────

Function DestroyInstFilesOverlay
  ${If} $InstProgress <> 0
    System::Call 'user32::DestroyWindow(p $InstProgress)'
    StrCpy $InstProgress 0
  ${EndIf}
  ${If} $InstStatus <> 0
    System::Call 'user32::DestroyWindow(p $InstStatus)'
    StrCpy $InstStatus 0
  ${EndIf}
  ${If} $InstOverlay <> 0
    System::Call 'user32::DestroyWindow(p $InstOverlay)'
    StrCpy $InstOverlay 0
  ${EndIf}
FunctionEnd
Function un.DestroyInstFilesOverlay
  ${If} $InstProgress <> 0
    System::Call 'user32::DestroyWindow(p $InstProgress)'
    StrCpy $InstProgress 0
  ${EndIf}
  ${If} $InstStatus <> 0
    System::Call 'user32::DestroyWindow(p $InstStatus)'
    StrCpy $InstStatus 0
  ${EndIf}
  ${If} $InstOverlay <> 0
    System::Call 'user32::DestroyWindow(p $InstOverlay)'
    StrCpy $InstOverlay 0
  ${EndIf}
FunctionEnd
; ── Шаг 4: завершение ───────────────────────────────────────────────
Function PageFinish
  ${If} $PassiveMode = 1
    Abort
  ${EndIf}
  Call DestroyInstFilesOverlay
  Call ShellApply
  !insertmacro HideRealNavBtns
  Call DestroyNavOverlays
  nsDialogs::Create 1018
  Pop $DIALOG
  System::Call 'user32::SetWindowPos(p $DIALOG, p 0, i 0, i 0, i $WinW, i $WinH, i ${SWP_ZSIZE})'
  SetCtlColors $DIALOG "" ${COLOR_BG}

  !insertmacro DrawSidebar 1 "Приветствие" "Папка установки" "Установка" "Завершение" 4
  !insertmacro PageHeading 1 "Установка завершена" "${PRODUCTNAME} готова к работе" $SubH

  !insertmacro ScaleTo $1 22
  ${NSD_CreateLabel} $ContentX $BodyTop $ContentW $1 "Приложение установлено на ваш компьютер."
  Pop $0
  SetCtlColors $0 ${COLOR_BODY} ${COLOR_BG}
  SendMessage $0 ${WM_SETFONT} $FontText 1

  !insertmacro ScaleTo $1 44
  !insertmacro ScaleTo $2 14
  IntOp $3 $BodyTop + 22
  IntOp $3 $3 + $2
  ${NSD_CreateCheckbox} $ContentX $3 $ContentW $1 "Запустить ${PRODUCTNAME}"
  Pop $RunAppCheckbox
  System::Call 'uxtheme::SetWindowTheme(p $RunAppCheckbox, w "", w "")'
  SendMessage $RunAppCheckbox ${WM_SETFONT} $FontText 1
  SetCtlColors $RunAppCheckbox ${COLOR_BODY} ${COLOR_BG}
  ${NSD_Check} $RunAppCheckbox

  IntOp $FooterX $WinW - $PadR
  !insertmacro FooterLine
  StrCpy $BtnText "Готово"
StrCpy $BtnId 1
StrCpy $BtnPrim 1
StrCpy $BtnEn 1
StrCpy $BtnTab 1
Call AddFooterBtn

  ${NSD_CreateTimer} RaisePills 30
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
  ${If} $ShortcutWanted = 1
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

  StrCpy $DeleteUserData 0
  Call un.InitWizardFonts
FunctionEnd

Function un.InitWizardFonts
  StrCpy $FontsOk 1
  InitPluginsDir
  !if "${LIMA_FONTS_DIR}" != ""
    File /nonfatal "/oname=$PLUGINSDIR\logo.bmp" "${LIMA_FONTS_DIR}logo.bmp"
    File /nonfatal "/oname=$PLUGINSDIR\manrope-400.ttf" "${LIMA_FONTS_DIR}manrope-400.ttf"
    File /nonfatal "/oname=$PLUGINSDIR\manrope-500.ttf" "${LIMA_FONTS_DIR}manrope-500.ttf"
    File /nonfatal "/oname=$PLUGINSDIR\onest-500.ttf" "${LIMA_FONTS_DIR}onest-500.ttf"
    System::Call 'gdi32::AddFontResourceExW(w "$PLUGINSDIR\manrope-400.ttf", i 0x10, i 0) i.r0'
    ${If} $0 = 0
      StrCpy $FontsOk 0
    ${EndIf}
    System::Call 'gdi32::AddFontResourceExW(w "$PLUGINSDIR\manrope-500.ttf", i 0x10, i 0) i.r0'
    ${If} $0 = 0
      StrCpy $FontsOk 0
    ${EndIf}
    System::Call 'gdi32::AddFontResourceExW(w "$PLUGINSDIR\onest-500.ttf", i 0x10, i 0) i.r0'
    ${If} $0 = 0
      StrCpy $FontsOk 0
    ${EndIf}
  !else
    StrCpy $FontsOk 0
  !endif
  ${If} $FontsOk = 1
    StrCpy $FaceBody "Manrope"
    StrCpy $FaceMed "Manrope Medium"
    StrCpy $FaceDisp "Onest Medium"
  ${Else}
    StrCpy $FaceBody "Segoe UI"
    StrCpy $FaceMed "Segoe UI Semibold"
    StrCpy $FaceDisp "Segoe UI Semibold"
  ${EndIf}
FunctionEnd

Function un.PageConfirmToggle
  ${NSD_GetState} $UserDataCheckbox $0
  StrCpy $DeleteUserData $0
  ${If} $DeleteUserData = 1
    ${NSD_SetText} $DataStateLabel "Настройки и данные игр (БУДУТ УДАЛЕНЫ): $ConfirmDataPath"
    SetCtlColors $DataStateLabel ${COLOR_ACCENT} ${COLOR_BG}
  ${Else}
    ${NSD_SetText} $DataStateLabel "Настройки и данные игр (будут сохранены): $ConfirmDataPath"
    SetCtlColors $DataStateLabel ${COLOR_MUTED} ${COLOR_BG}
  ${EndIf}
FunctionEnd

Function un.PageConfirm
  ${If} $PassiveMode = 1
    Abort
  ${EndIf}
  ${If} $UpdateMode = 1
    Abort
  ${EndIf}
  Call un.ShellApply
  !insertmacro HideRealNavBtns
  Call un.DestroyNavOverlays
  nsDialogs::Create 1018
  Pop $DIALOG
  System::Call 'user32::SetWindowPos(p $DIALOG, p 0, i 0, i 0, i $WinW, i $WinH, i ${SWP_ZSIZE})'
  SetCtlColors $DIALOG "" ${COLOR_BG}

  ReadRegStr $ConfirmDataPath SHCTX "${MANUPRODUCTKEY}" "DataPath"
  ${If} $ConfirmDataPath == ""
    StrCpy $ConfirmDataPath "$PROFILE\${PRODUCTNAME}"
  ${EndIf}

  !insertmacro DrawSidebar 1 "Подтверждение" "Удаление" "Завершение" "" 1
  !insertmacro PageHeading 1 "Удаление ${PRODUCTNAME}" "Приложение будет удалено с этого компьютера" $SubH

  !insertmacro ScaleTo $1 18
  ${NSD_CreateLabel} $ContentX $BodyTop $ContentW $1 "Папка, из которой будет удалён ${PRODUCTNAME}:"
  Pop $0
  SetCtlColors $0 ${COLOR_BODY} ${COLOR_BG}
  SendMessage $0 ${WM_SETFONT} $FontText 1

  !insertmacro ScaleTo $1 44
  !insertmacro ScaleTo $2 10
  IntOp $3 $BodyTop + 18
  IntOp $3 $3 + $2
  ${NSD_CreateLabel} $ContentX $3 $ContentW $1 "$INSTDIR"
  Pop $0
  ${NSD_AddStyle} $0 ${SS_CENTERIMAGE}
  SetCtlColors $0 ${COLOR_TEXT} ${COLOR_INPUT}
  SendMessage $0 ${WM_SETFONT} $FontText 1

  !insertmacro ScaleTo $2 14
  IntOp $3 $3 + 44
  IntOp $3 $3 + $2
  ${NSD_CreateCheckbox} $ContentX $3 $ContentW $1 "Удалить настройки и данные пользователя"
  Pop $UserDataCheckbox
  System::Call 'uxtheme::SetWindowTheme(p $UserDataCheckbox, w "", w "")'
  SendMessage $UserDataCheckbox ${WM_SETFONT} $FontText 1
  SetCtlColors $UserDataCheckbox ${COLOR_BODY} ${COLOR_BG}
  ${NSD_OnClick} $UserDataCheckbox un.PageConfirmToggle

  !insertmacro ScaleTo $1 16
  !insertmacro ScaleTo $2 10
  IntOp $3 $3 + 44
  IntOp $3 $3 + $2
  ${NSD_CreateLabel} $ContentX $3 $ContentW $1 "Настройки и данные игр (будут сохранены): $ConfirmDataPath"
  Pop $DataStateLabel
  SetCtlColors $DataStateLabel ${COLOR_MUTED} ${COLOR_BG}
  SendMessage $DataStateLabel ${WM_SETFONT} $FontCap 1

  IntOp $FooterX $WinW - $PadR
  !insertmacro FooterLine
  StrCpy $BtnText "Удалить"
StrCpy $BtnId 1
StrCpy $BtnPrim 1
StrCpy $BtnEn 1
StrCpy $BtnTab 1
Call un.AddFooterBtn
  StrCpy $BtnText "Отмена"
StrCpy $BtnId 2
StrCpy $BtnPrim 0
StrCpy $BtnEn 1
StrCpy $BtnTab 1
Call un.AddFooterBtn

  ${NSD_CreateTimer} un.RaisePills 30
  ${NSD_CreateTimer} un.FocusPoll 50
  nsDialogs::Show
  ${NSD_KillTimer} un.FocusPoll
  Call un.DestroyNavOverlays
FunctionEnd

Function un.StyleInstFiles
  Call un.ShellApply
  !insertmacro HideRealNavBtns
  Call un.DestroyNavOverlays
  !insertmacro HideNativeInstFiles
  !insertmacro ShowInstFilesOverlay "Подтверждение" "Удаление" "Завершение" "" 2 "Удаление" "Пожалуйста, подождите"

  IntOp $FooterX $WinW - $PadR
  !insertmacro FooterLine
  StrCpy $BtnText "Отмена"
  StrCpy $BtnId 2
  StrCpy $BtnPrim 0
  StrCpy $BtnEn 1
  StrCpy $BtnTab 0
  Call un.AddFooterBtn
  SendMessage $HWNDPARENT ${DM_SETDEFID} 2 0

  !insertmacro ScaleTo $2 10
  !insertmacro ScaleTo $3 24
  !insertmacro ScaleTo $4 16
  IntOp $5 $BodyTop + $3
  !insertmacro AdoptNativeProgress $ContentX $BodyTop $ContentW $2 $5 $4

  !insertmacro RepaintShell
  ; После удаления деинсталлятор сам переходит на экран «Завершение».
  SetAutoClose true
FunctionEnd

Function un.PageDone
  ${If} $PassiveMode = 1
    Abort
  ${EndIf}
  Call un.DestroyInstFilesOverlay
  ${If} $UpdateMode = 1
    Abort
  ${EndIf}
  Call un.ShellApply
  !insertmacro HideRealNavBtns
  Call un.DestroyNavOverlays
  nsDialogs::Create 1018
  Pop $DIALOG
  System::Call 'user32::SetWindowPos(p $DIALOG, p 0, i 0, i 0, i $WinW, i $WinH, i ${SWP_ZSIZE})'
  SetCtlColors $DIALOG "" ${COLOR_BG}

  !insertmacro DrawSidebar 1 "Подтверждение" "Удаление" "Завершение" "" 3
  !insertmacro PageHeading 1 "Удаление завершено" "${PRODUCTNAME} удалена с вашего компьютера" $SubH

  !insertmacro ScaleTo $1 22
  ${NSD_CreateLabel} $ContentX $BodyTop $ContentW $1 "Спасибо, что пользовались ${PRODUCTNAME}."
  Pop $0
  SetCtlColors $0 ${COLOR_BODY} ${COLOR_BG}
  SendMessage $0 ${WM_SETFONT} $FontText 1

  IntOp $FooterX $WinW - $PadR
  !insertmacro FooterLine
  StrCpy $BtnText "Закрыть"
StrCpy $BtnId 1
StrCpy $BtnPrim 1
StrCpy $BtnEn 1
StrCpy $BtnTab 1
Call un.AddFooterBtn

  ${NSD_CreateTimer} un.RaisePills 30
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

  Call InitWizardFonts

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
  !insertmacro TickProgress 5

  Delete "$INSTDIR\${MAINBINARYNAME}.exe"
  !insertmacro TickProgress 10

  {{#each resources}}
    Delete "$INSTDIR\\{{this.[1]}}"
  {{/each}}
  !insertmacro TickProgress 25

  {{#each binaries}}
    Delete "$INSTDIR\\{{this}}"
  {{/each}}
  !insertmacro TickProgress 35

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
  !insertmacro TickProgress 40

  Delete "$INSTDIR\uninstall.exe"
  !insertmacro TickProgress 50

  {{#each resources_ancestors}}
  RMDir /REBOOTOK "$INSTDIR\\{{this}}"
  {{/each}}
  RMDir /r "$INSTDIR"
  !insertmacro TickProgress 65

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
  !insertmacro TickProgress 75

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
  !insertmacro TickProgress 85

  ${If} $UpdateMode <> 1
    SetShellVarContext current
    ReadRegStr $ConfirmDataPath SHCTX "${MANUPRODUCTKEY}" "DataPath"
    ${If} $ConfirmDataPath == ""
      StrCpy $ConfirmDataPath "$PROFILE\${PRODUCTNAME}"
    ${EndIf}
    ${If} $DeleteUserData = 1
      DetailPrint "Удаление настроек и данных игр: $ConfirmDataPath"
      RmDir /r "$ConfirmDataPath"
    ${Else}
      DetailPrint "Настройки и данные игр сохранены: $ConfirmDataPath"
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
  !insertmacro TickProgress 95

  !ifmacrodef NSIS_HOOK_POSTUNINSTALL
    !insertmacro NSIS_HOOK_POSTUNINSTALL
  !endif
  !insertmacro TickProgress 100

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
