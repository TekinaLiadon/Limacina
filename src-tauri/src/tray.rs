use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use anyhow::{anyhow, Result};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime};

use crate::{log_err, log_info, utils::env_info::get_launcher_name};

const TRAY_ID: &str = "main";
const MENU_OPEN_ID: &str = "open";
const MENU_STATUS_ID: &str = "game-status";
const MENU_QUIT_ID: &str = "quit";
const ACCENT_ICON_BYTES: &[u8] = include_bytes!("../icons/tray-accent.png");

static MINIMIZE_TO_TRAY: AtomicBool = AtomicBool::new(false);
static GAME_RUNNING: AtomicBool = AtomicBool::new(false);
static GAME_USER: Mutex<String> = Mutex::new(String::new());

pub fn minimize_to_tray_enabled() -> bool {
    MINIMIZE_TO_TRAY.load(Ordering::Relaxed)
}

pub fn game_username() -> Option<String> {
    if !GAME_RUNNING.load(Ordering::Relaxed) {
        return None;
    }
    let username = GAME_USER
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .trim()
        .to_string();
    if username.is_empty() {
        None
    } else {
        Some(username)
    }
}

pub fn set_minimize_to_tray<R: Runtime>(app: &AppHandle<R>, enabled: bool) {
    MINIMIZE_TO_TRAY.store(enabled, Ordering::Relaxed);
    if game_username().is_none() {
        if let Some(tray) = app.tray_by_id(TRAY_ID) {
            if let Err(e) = tray.set_visible(enabled) {
                log_err!("Не удалось обновить видимость иконки в трее: {}", e);
            }
        }
    }
}

pub fn set_game_state<R: Runtime>(app: &AppHandle<R>, running: bool, username: &str) {
    GAME_RUNNING.store(running, Ordering::Relaxed);
    *GAME_USER.lock().unwrap_or_else(|e| e.into_inner()) = username.trim().to_string();

    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let visible = running || minimize_to_tray_enabled();
        if let Err(e) = tray.set_visible(visible) {
            log_err!("Не удалось обновить видимость иконки в трее: {}", e);
        }

        let tooltip = match game_username() {
            Some(user) => format!("{} — игра запущена ({})", get_launcher_name(), user),
            None => get_launcher_name(),
        };
        if let Err(e) = tray.set_tooltip(Some(tooltip)) {
            log_err!("Не удалось обновить тултип иконки в трее: {}", e);
        }

        let icon = if running {
            Image::from_bytes(ACCENT_ICON_BYTES).ok()
        } else {
            app.default_window_icon().cloned()
        };
        if let Err(e) = tray.set_icon(icon) {
            log_err!("Не удалось обновить иконку в трее: {}", e);
        }

        match build_menu(app) {
            Ok(menu) => {
                if let Err(e) = tray.set_menu(Some(menu)) {
                    log_err!("Не удалось обновить меню трея: {}", e);
                }
            }
            Err(e) => log_err!("Не удалось собрать меню трея: {}", e),
        }
    }

    if running {
        log_info!("Игра запущена ({}), состояние трея обновлено", username);
    } else {
        log_info!("Игра завершена, состояние трея обновлено");
    }
}

fn build_menu<R: Runtime>(app: &AppHandle<R>) -> Result<Menu<R>> {
    let open_item = MenuItem::with_id(app, MENU_OPEN_ID, "Открыть лаунчер", true, None::<&str>)?;
    match game_username() {
        Some(username) => {
            let status_item = MenuItem::with_id(
                app,
                MENU_STATUS_ID,
                format!("Игра запущена: {}", username),
                false,
                None::<&str>,
            )?;
            let quit_item = MenuItem::with_id(app, MENU_QUIT_ID, "Выход", true, None::<&str>)?;
            Ok(Menu::with_items(
                app,
                &[&open_item, &status_item, &quit_item],
            )?)
        }
        None => {
            let quit_item = MenuItem::with_id(app, MENU_QUIT_ID, "Выход", true, None::<&str>)?;
            Ok(Menu::with_items(app, &[&open_item, &quit_item])?)
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
    let menu = build_menu(app)?;

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
