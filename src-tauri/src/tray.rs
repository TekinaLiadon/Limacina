use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use anyhow::{anyhow, Context, Result};
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
static GAME_USERS: Mutex<Vec<String>> = Mutex::new(Vec::new());

pub fn minimize_to_tray_enabled() -> bool {
    MINIMIZE_TO_TRAY.load(Ordering::Relaxed)
}

pub fn is_available<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.tray_by_id(TRAY_ID).is_some()
}

pub fn game_usernames() -> Vec<String> {
    GAME_USERS.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

fn store_add_game(username: &str) {
    let username = username.trim();
    if username.is_empty() {
        return;
    }
    let mut users = GAME_USERS.lock().unwrap_or_else(|e| e.into_inner());
    if !users.iter().any(|user| user == username) {
        users.push(username.to_string());
    }
}

fn store_remove_game(username: &str) {
    let username = username.trim();
    GAME_USERS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .retain(|user| user != username);
}

fn game_tooltip(usernames: &[String]) -> String {
    match usernames {
        [] => get_launcher_name(),
        [single] => format!("{} — игра запущена ({})", get_launcher_name(), single),
        many => format!(
            "{} — игры запущены ({}): {}",
            get_launcher_name(),
            many.len(),
            many.join(", ")
        ),
    }
}

fn menu_status_label(usernames: &[String]) -> Option<String> {
    match usernames {
        [] => None,
        [single] => Some(format!("Игра запущена: {single}")),
        many => Some(format!(
            "Игры запущены ({}): {}",
            many.len(),
            many.join(", ")
        )),
    }
}

pub fn set_minimize_to_tray<R: Runtime>(app: &AppHandle<R>, enabled: bool) {
    MINIMIZE_TO_TRAY.store(enabled, Ordering::Relaxed);
    if game_usernames().is_empty() {
        let dispatch = app.clone();
        if let Err(e) = app.run_on_main_thread(move || {
            if let Some(tray) = dispatch.tray_by_id(TRAY_ID) {
                if let Err(e) = tray.set_visible(enabled) {
                    log_err!("Не удалось обновить видимость иконки в трее: {}", e);
                }
            }
        }) {
            log_err!("Не удалось обновить трей в главном потоке: {}", e);
        }
    }
}

pub fn add_game_session<R: Runtime>(app: &AppHandle<R>, username: &str) {
    store_add_game(username);

    let dispatch = app.clone();
    if let Err(e) = app.run_on_main_thread(move || {
        apply_game_state_to_tray(&dispatch);
    }) {
        log_err!("Не удалось обновить трей в главном потоке: {}", e);
    }

    log_info!("Игра запущена ({username}), состояние трея обновлено");
}

pub fn remove_game_session<R: Runtime>(app: &AppHandle<R>, username: &str) {
    store_remove_game(username);

    let dispatch = app.clone();
    if let Err(e) = app.run_on_main_thread(move || {
        apply_game_state_to_tray(&dispatch);
    }) {
        log_err!("Не удалось обновить трей в главном потоке: {}", e);
    }

    log_info!("Игра завершена ({username}), состояние трея обновлено");
}

fn apply_game_state_to_tray<R: Runtime>(app: &AppHandle<R>) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let usernames = game_usernames();
        let running = !usernames.is_empty();
        let visible = running || minimize_to_tray_enabled();
        if let Err(e) = tray.set_visible(visible) {
            log_err!("Не удалось обновить видимость иконки в трее: {}", e);
        }

        if let Err(e) = tray.set_tooltip(Some(game_tooltip(&usernames))) {
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
}

fn build_menu<R: Runtime>(app: &AppHandle<R>) -> Result<Menu<R>> {
    let open_item = MenuItem::with_id(app, MENU_OPEN_ID, "Открыть лаунчер", true, None::<&str>)?;
    match menu_status_label(&game_usernames()) {
        Some(status) => {
            let status_item = MenuItem::with_id(app, MENU_STATUS_ID, status, false, None::<&str>)?;
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
    let menu = build_menu(app).context("Не удалось построить меню трея")?;

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
        .build(app)
        .context("Не удалось создать иконку трея")?;

    tray.set_visible(minimize_to_tray_enabled())
        .context("Не удалось изменить видимость иконки трея")?;

    log_info!("Иконка трея инициализирована");
    Ok(())
}

#[cfg(test)]
mod game_state_tests {
    use super::{
        game_tooltip, game_usernames, menu_status_label, store_add_game, store_remove_game,
    };

    static TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn reset_users() {
        super::GAME_USERS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
    }

    #[test]
    fn sessions_add_remove_and_dedupe() {
        let _guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        reset_users();

        assert!(game_usernames().is_empty());

        store_add_game("  Steve  ");
        store_add_game("Steve");
        assert_eq!(
            game_usernames(),
            vec!["Steve".to_string()],
            "повторный ник не дублируется, пробелы срезаются"
        );

        store_add_game("Alex");
        assert_eq!(
            game_usernames(),
            vec!["Steve".to_string(), "Alex".to_string()]
        );

        store_remove_game("Steve");
        assert_eq!(
            game_usernames(),
            vec!["Alex".to_string()],
            "выход одной игры не трогает другую"
        );

        store_remove_game("Alex");
        assert!(game_usernames().is_empty());

        store_add_game("   ");
        assert!(
            game_usernames().is_empty(),
            "пустой ник не считается запущенной игрой"
        );
    }

    #[test]
    fn labels_reflect_single_and_multiple_sessions() {
        assert_eq!(game_tooltip(&[]), "Limacina");
        assert_eq!(menu_status_label(&[]), None);

        let single = vec!["Steve".to_string()];
        assert_eq!(game_tooltip(&single), "Limacina — игра запущена (Steve)");
        assert_eq!(
            menu_status_label(&single),
            Some("Игра запущена: Steve".to_string())
        );

        let many = vec!["Steve".to_string(), "Alex".to_string()];
        assert_eq!(
            game_tooltip(&many),
            "Limacina — игры запущены (2): Steve, Alex"
        );
        assert_eq!(
            menu_status_label(&many),
            Some("Игры запущены (2): Steve, Alex".to_string())
        );
    }
}
