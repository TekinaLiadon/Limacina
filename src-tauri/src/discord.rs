use std::env;
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::sync::{Arc, Mutex as StdMutex, OnceLock, RwLock as StdRwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};

use crate::log_err;

struct GameActivity {
    details: String,
    state: String,
    started_at: i64,
}

struct PresenceActivity {
    details: String,
    state: String,
    started_at: Option<i64>,
}

trait DiscordIpcTransport: Send {
    fn connect(&mut self) -> Result<(), String>;
    fn set_activity(&mut self, activity: PresenceActivity) -> Result<(), String>;
    fn close(&mut self);
}

struct RealClient {
    client: DiscordIpcClient,
}

impl RealClient {
    fn new(client_id: &str) -> Self {
        Self {
            client: DiscordIpcClient::new(client_id),
        }
    }
}

impl DiscordIpcTransport for RealClient {
    fn connect(&mut self) -> Result<(), String> {
        self.client.connect().map_err(|e| e.to_string())
    }

    fn set_activity(&mut self, presence: PresenceActivity) -> Result<(), String> {
        let mut builder = activity::Activity::new()
            .details(presence.details)
            .state(presence.state);
        if let Some(started_at) = presence.started_at {
            builder = builder.timestamps(activity::Timestamps::new().start(started_at));
        }
        self.client.set_activity(builder).map_err(|e| e.to_string())
    }

    fn close(&mut self) {
        let _ = self.client.close();
    }
}

type ClientFactory =
    Arc<dyn Fn(&str) -> Result<Box<dyn DiscordIpcTransport>, String> + Send + Sync>;

static CLIENT_FACTORY: OnceLock<StdRwLock<Option<ClientFactory>>> = OnceLock::new();

fn client_factory() -> Option<ClientFactory> {
    CLIENT_FACTORY
        .get_or_init(|| StdRwLock::new(None))
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

fn make_client(client_id: &str) -> Result<Box<dyn DiscordIpcTransport>, String> {
    match client_factory() {
        Some(factory) => factory(client_id),
        None => Ok(Box::new(RealClient::new(client_id))),
    }
}

#[cfg(test)]
fn override_client_factory_for_tests(factory: Option<ClientFactory>) {
    *CLIENT_FACTORY
        .get_or_init(|| StdRwLock::new(None))
        .write()
        .unwrap_or_else(|e| e.into_inner()) = factory;
}

struct DiscordState {
    enabled: bool,
    game: Option<GameActivity>,
    client: Option<Box<dyn DiscordIpcTransport>>,
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
        client.close();
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
        let mut client = match make_client(&client_id) {
            Ok(client) => client,
            Err(e) => {
                log_err!("Не удалось подключиться к Discord: {}", e);
                return;
            }
        };
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

    let presence = match &state.game {
        Some(game) => PresenceActivity {
            details: game.details.clone(),
            state: game.state.clone(),
            started_at: Some(game.started_at),
        },
        None => PresenceActivity {
            details: "В лаунчере".to_string(),
            state: env!("CARGO_PKG_NAME").to_string(),
            started_at: None,
        },
    };

    let result = match state.client.as_mut() {
        Some(client) => client.set_activity(presence),
        None => Ok(()),
    };
    if let Err(e) = result {
        log_err!("Не удалось обновить Discord-статус: {}", e);
        disconnect(state);
    }
}

pub fn init(enabled: bool) {
    let mut state = discord_state().lock().unwrap_or_else(|e| e.into_inner());
    state.enabled = enabled;
    apply(&mut state);
}

pub fn set_game_activity(
    enabled: bool,
    mc_version: &str,
    project_name: &str,
    exited: Option<Arc<AtomicBool>>,
) {
    let mut state = discord_state().lock().unwrap_or_else(|e| e.into_inner());
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
    let mut state = discord_state().lock().unwrap_or_else(|e| e.into_inner());
    state.game.take();
    apply(&mut state);
}

pub fn on_settings_saved(enabled: bool) {
    let mut state = discord_state().lock().unwrap_or_else(|e| e.into_inner());
    state.enabled = enabled;
    apply(&mut state);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;

    struct MockClient {
        log: Arc<StdMutex<Vec<String>>>,
        fail_set_activity: Arc<AtomicBool>,
    }

    impl DiscordIpcTransport for MockClient {
        fn connect(&mut self) -> Result<(), String> {
            self.log
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push("connect".to_string());
            Ok(())
        }

        fn set_activity(&mut self, presence: PresenceActivity) -> Result<(), String> {
            let entry = format!("set:{}|{}", presence.details, presence.state);
            self.log
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push(entry);
            if self.fail_set_activity.load(Ordering::Relaxed) {
                Err("ipc pipe broken".to_string())
            } else {
                Ok(())
            }
        }

        fn close(&mut self) {
            self.log
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push("close".to_string());
        }
    }

    static TEST_LOCK: StdMutex<()> = StdMutex::new(());

    fn mock_factory() -> (ClientFactory, Arc<StdMutex<Vec<String>>>, Arc<AtomicBool>) {
        let log = Arc::new(StdMutex::new(Vec::new()));
        let fail_set = Arc::new(AtomicBool::new(false));
        let factory_log = Arc::clone(&log);
        let factory_fail = Arc::clone(&fail_set);
        let factory: ClientFactory = Arc::new(move |_client_id| {
            Ok(Box::new(MockClient {
                log: Arc::clone(&factory_log),
                fail_set_activity: Arc::clone(&factory_fail),
            }))
        });
        (factory, log, fail_set)
    }

    fn calls(log: &Arc<StdMutex<Vec<String>>>) -> Vec<String> {
        log.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    fn reset(factory: Option<ClientFactory>) {
        env::set_var("DISCORD_CLIENT_ID", "test-client-id");
        override_client_factory_for_tests(factory);
        init(false);
        on_game_exit();
    }

    #[test]
    fn disabled_presence_records_game_and_restores_on_enable() {
        let _guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let (factory, log, _fail) = mock_factory();
        reset(Some(factory));

        set_game_activity(false, "1.20.1", "Avelmor", None);
        assert!(
            calls(&log).is_empty(),
            "выключенный presence не должен подключаться к IPC"
        );

        on_settings_saved(true);
        assert_eq!(
            calls(&log),
            vec![
                "connect".to_string(),
                "set:Minecraft 1.20.1|Avelmor".to_string()
            ],
            "включение во время игры должно восстановить активность игры"
        );

        override_client_factory_for_tests(None);
    }

    #[test]
    fn game_exit_returns_to_launcher_presence() {
        let _guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let (factory, log, _fail) = mock_factory();
        reset(Some(factory));

        init(true);
        set_game_activity(true, "1.21.1", "Proj", None);
        on_game_exit();

        assert_eq!(
            calls(&log),
            vec![
                "connect".to_string(),
                "set:В лаунчере|Limacina".to_string(),
                "set:Minecraft 1.21.1|Proj".to_string(),
                "set:В лаунчере|Limacina".to_string(),
            ]
        );

        override_client_factory_for_tests(None);
    }

    #[test]
    fn missing_client_id_keeps_presence_disconnected() {
        let _guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let (factory, log, _fail) = mock_factory();
        reset(Some(factory));

        env::remove_var("DISCORD_CLIENT_ID");
        init(true);
        assert!(
            calls(&log).is_empty(),
            "без client id подключение невозможно"
        );

        env::set_var("DISCORD_CLIENT_ID", "test-client-id");
        on_settings_saved(true);
        assert_eq!(
            calls(&log),
            vec!["connect".to_string(), "set:В лаунчере|Limacina".to_string()]
        );

        override_client_factory_for_tests(None);
    }

    #[test]
    fn set_activity_failure_disconnects_and_next_apply_reconnects() {
        let _guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let (factory, log, fail_set) = mock_factory();
        reset(Some(factory));

        fail_set.store(true, Ordering::Relaxed);
        init(true);
        assert_eq!(
            calls(&log),
            vec![
                "connect".to_string(),
                "set:В лаунчере|Limacina".to_string(),
                "close".to_string()
            ],
            "сбой set_activity должен закрывать клиент"
        );

        fail_set.store(false, Ordering::Relaxed);
        on_game_exit();
        assert_eq!(
            calls(&log)[3..],
            ["connect".to_string(), "set:В лаунчере|Limacina".to_string()],
            "после сбоя следующий переход должен переподключиться"
        );

        override_client_factory_for_tests(None);
    }

    #[test]
    fn exited_game_flag_skips_activity_recording() {
        let _guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let (factory, log, _fail) = mock_factory();
        reset(Some(factory));

        init(true);
        let exited = Arc::new(AtomicBool::new(true));
        set_game_activity(true, "1.21.1", "Proj", Some(Arc::clone(&exited)));

        assert_eq!(
            calls(&log),
            vec!["connect".to_string(), "set:В лаунчере|Limacina".to_string()],
            "завершённая игра не должна записывать активность"
        );

        override_client_factory_for_tests(None);
    }
}
