use std::env;
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};

use crate::log_err;

struct GameActivity {
    details: String,
    state: String,
    started_at: i64,
}

struct DiscordState {
    enabled: bool,
    game: Option<GameActivity>,
    client: Option<DiscordIpcClient>,
}

static DISCORD_STATE: OnceLock<StdMutex<DiscordState>> = OnceLock::new();

fn discord_state() -> &'static StdMutex<DiscordState> {
    DISCORD_STATE.get_or_init(|| {
        StdMutex::new(DiscordState {
            enabled: true,
            game: None,
            client: None,
        })
    })
}

fn client_id() -> Option<String> {
    env::var("DISCORD_CLIENT_ID")
        .ok()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

fn disconnect(state: &mut DiscordState) {
    if let Some(mut client) = state.client.take() {
        let _ = client.close();
    }
}

fn apply(state: &mut DiscordState) {
    if !state.enabled {
        disconnect(state);
        return;
    }

    let Some(client_id) = client_id() else {
        disconnect(state);
        return;
    };

    if state.client.is_none() {
        let mut client = DiscordIpcClient::new(&client_id);
        match client.connect() {
            Ok(()) => {
                state.client = Some(client);
            }
            Err(e) => {
                log_err!("Не удалось подключиться к Discord: {}", e);
                return;
            }
        }
    }

    let activity = match &state.game {
        Some(game) => activity::Activity::new()
            .details(game.details.clone())
            .state(game.state.clone())
            .timestamps(activity::Timestamps::new().start(game.started_at)),
        None => activity::Activity::new()
            .details("В лаунчере")
            .state(env!("CARGO_PKG_NAME")),
    };

    let result = match state.client.as_mut() {
        Some(client) => client.set_activity(activity).map_err(|e| e.to_string()),
        None => Ok(()),
    };
    if let Err(e) = result {
        log_err!("Не удалось обновить Discord-статус: {}", e);
        disconnect(state);
    }
}

pub fn init(enabled: bool) {
    let mut state = discord_state()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    state.enabled = enabled;
    apply(&mut state);
}

pub fn set_game_activity(
    enabled: bool,
    mc_version: &str,
    project_name: &str,
    exited: Option<Arc<AtomicBool>>,
) {
    let mut state = discord_state()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if exited
        .as_ref()
        .is_some_and(|flag| flag.load(AtomicOrdering::Relaxed))
    {
        return;
    }
    state.enabled = enabled;
    state.game = Some(GameActivity {
        details: format!("Minecraft {}", mc_version),
        state: project_name.to_string(),
        started_at: now_unix(),
    });
    apply(&mut state);
}

pub fn on_game_exit() {
    let mut state = discord_state()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    state.game.take();
    apply(&mut state);
}

pub fn on_settings_saved(enabled: bool) {
    let mut state = discord_state()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    state.enabled = enabled;
    apply(&mut state);
}
