use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::{anyhow, Result};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime};

use crate::{log_err, log_info, utils::env_info::get_launcher_name};

const TRAY_ID: &str = "main";
const MENU_OPEN_ID: &str = "open";
const MENU_QUIT_ID: &str = "quit";

static MINIMIZE_TO_TRAY: AtomicBool = AtomicBool::new(false);

pub fn minimize_to_tray_enabled() -> bool {
    MINIMIZE_TO_TRAY.load(Ordering::Relaxed)
}

pub fn set_minimize_to_tray<R: Runtime>(app: &AppHandle<R>, enabled: bool) {
    MINIMIZE_TO_TRAY.store(enabled, Ordering::Relaxed);
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if let Err(e) = tray.set_visible(enabled) {
            log_err!("Не удалось обновить видимость иконки в трее: {}", e);
        }
    }
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn init<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let open_item = MenuItem::with_id(app, MENU_OPEN_ID, "Открыть", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, MENU_QUIT_ID, "Выйти", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| anyhow!("Иконка окна не найдена"))?;

    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip(get_launcher_name())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            MENU_OPEN_ID => show_main_window(app),
            MENU_QUIT_ID => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    tray.set_visible(minimize_to_tray_enabled())?;

    log_info!("Иконка трея инициализирована");
    Ok(())
}
