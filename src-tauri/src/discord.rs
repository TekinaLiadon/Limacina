use std::env;
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::sync::{Arc, Mutex as StdMutex, OnceLock, RwLock as StdRwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use tokio::sync::Mutex as AsyncMutex;
use tokio::time::timeout;

use crate::log_err;

const IPC_TIMEOUT: Duration = Duration::from_secs(5);

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

#[cfg(test)]
static IPC_TIMEOUT_OVERRIDE: OnceLock<Duration> = OnceLock::new();

fn ipc_timeout() -> Duration {
    #[cfg(test)]
    {
        if let Some(overridden) = IPC_TIMEOUT_OVERRIDE.get() {
            return *overridden;
        }
    }
    IPC_TIMEOUT
}

#[cfg(test)]
fn set_ipc_timeout_for_tests(timeout: Duration) {
    let _ = IPC_TIMEOUT_OVERRIDE.set(timeout);
}

struct DiscordState {
    enabled: bool,
    game: Option<GameActivity>,
    client: Option<Box<dyn DiscordIpcTransport>>,
}

static DISCORD_STATE: OnceLock<StdMutex<DiscordState>> = OnceLock::new();
static APPLY_LOCK: OnceLock<AsyncMutex<()>> = OnceLock::new();

fn discord_state() -> &'static StdMutex<DiscordState> {
    DISCORD_STATE.get_or_init(|| {
        StdMutex::new(DiscordState {
            enabled: true,
            game: None,
            client: None,
        })
    })
}

fn apply_lock() -> &'static AsyncMutex<()> {
    APPLY_LOCK.get_or_init(|| AsyncMutex::new(()))
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

fn presence_of(state: &DiscordState) -> PresenceActivity {
    match &state.game {
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
    }
}

enum PendingIpc {
    Close(Option<Box<dyn DiscordIpcTransport>>),
    Activity {
        client_id: String,
        presence: PresenceActivity,
        client: Option<Box<dyn DiscordIpcTransport>>,
    },
}

fn take_pending_ipc(state: &mut DiscordState) -> PendingIpc {
    if !state.enabled {
        return PendingIpc::Close(state.client.take());
    }
    match client_id() {
        Some(client_id) => PendingIpc::Activity {
            client_id,
            presence: presence_of(state),
            client: state.client.take(),
        },
        None => PendingIpc::Close(state.client.take()),
    }
}

async fn apply() {
    let _serialization = apply_lock().lock().await;
    let pending = {
        let mut state = discord_state().lock().unwrap_or_else(|e| e.into_inner());
        take_pending_ipc(&mut state)
    };

    match pending {
        PendingIpc::Close(client) => {
            if let Some(mut client) = client {
                let _ = timeout(
                    ipc_timeout(),
                    tokio::task::spawn_blocking(move || client.close()),
                )
                .await;
            }
        }
        PendingIpc::Activity {
            client_id,
            presence,
            client,
        } => {
            let already_connected = client.is_some();
            let task = tokio::task::spawn_blocking(
                move || -> Result<Box<dyn DiscordIpcTransport>, String> {
                    let mut client = match client {
                        Some(client) => client,
                        None => match make_client(&client_id) {
                            Ok(client) => client,
                            Err(e) => {
                                return Err(format!("Не удалось подключиться к Discord: {}", e))
                            }
                        },
                    };
                    if !already_connected {
                        if let Err(e) = client.connect() {
                            return Err(format!("Не удалось подключиться к Discord: {}", e));
                        }
                    }
                    match client.set_activity(presence) {
                        Ok(()) => Ok(client),
                        Err(e) => {
                            client.close();
                            Err(format!("Не удалось обновить Discord-статус: {}", e))
                        }
                    }
                },
            );
            match timeout(ipc_timeout(), task).await {
                Err(_) => log_err!(
                    "Discord IPC не ответил за {:?}, статус не обновлён",
                    ipc_timeout()
                ),
                Ok(joined) => match joined {
                    Err(e) => log_err!("Поток Discord IPC прерван: {}", e),
                    Ok(Err(message)) => log_err!("{}", message),
                    Ok(Ok(client)) => {
                        discord_state()
                            .lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .client = Some(client);
                    }
                },
            }
        }
    }
}

pub async fn init(enabled: bool) {
    {
        let mut state = discord_state().lock().unwrap_or_else(|e| e.into_inner());
        state.enabled = enabled;
    }
    apply().await;
}

pub async fn set_game_activity(
    mc_version: &str,
    project_name: &str,
    exited: Option<Arc<AtomicBool>>,
) {
    {
        let mut state = discord_state().lock().unwrap_or_else(|e| e.into_inner());
        if exited
            .as_ref()
            .is_some_and(|flag| flag.load(AtomicOrdering::Relaxed))
        {
            return;
        }
        state.game = Some(GameActivity {
            details: format!("Minecraft {}", mc_version),
            state: project_name.to_string(),
            started_at: now_unix(),
        });
    }
    apply().await;
}

pub async fn on_game_exit() {
    {
        let mut state = discord_state().lock().unwrap_or_else(|e| e.into_inner());
        state.game.take();
    }
    apply().await;
}

pub async fn on_settings_saved(enabled: bool) {
    {
        let mut state = discord_state().lock().unwrap_or_else(|e| e.into_inner());
        state.enabled = enabled;
    }
    apply().await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct MockClient {
        log: Arc<StdMutex<Vec<String>>>,
        fail_set_activity: Arc<AtomicBool>,
        hang_set_activity_once: Arc<AtomicBool>,
        hang_millis: Arc<AtomicU64>,
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
            if self.hang_set_activity_once.swap(false, Ordering::SeqCst) {
                let millis = self.hang_millis.load(Ordering::SeqCst);
                std::thread::sleep(Duration::from_millis(millis));
            }
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

    static TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    struct MockHandles {
        log: Arc<StdMutex<Vec<String>>>,
        fail_set: Arc<AtomicBool>,
        hang_once: Arc<AtomicBool>,
        hang_millis: Arc<AtomicU64>,
    }

    fn mock_factory() -> (ClientFactory, MockHandles) {
        let log = Arc::new(StdMutex::new(Vec::new()));
        let fail_set = Arc::new(AtomicBool::new(false));
        let hang_once = Arc::new(AtomicBool::new(false));
        let hang_millis = Arc::new(AtomicU64::new(0));
        let handles = MockHandles {
            log: Arc::clone(&log),
            fail_set: Arc::clone(&fail_set),
            hang_once: Arc::clone(&hang_once),
            hang_millis: Arc::clone(&hang_millis),
        };
        let factory: ClientFactory = Arc::new(move |_client_id| {
            Ok(Box::new(MockClient {
                log: Arc::clone(&log),
                fail_set_activity: Arc::clone(&fail_set),
                hang_set_activity_once: Arc::clone(&hang_once),
                hang_millis: Arc::clone(&hang_millis),
            }))
        });
        (factory, handles)
    }

    fn calls(log: &Arc<StdMutex<Vec<String>>>) -> Vec<String> {
        log.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    async fn reset(factory: Option<ClientFactory>) {
        env::set_var("DISCORD_CLIENT_ID", "test-client-id");
        override_client_factory_for_tests(factory);
        init(false).await;
        on_game_exit().await;
    }

    #[tokio::test]
    async fn disabled_presence_records_game_and_restores_on_enable() {
        let _guard = TEST_LOCK.lock().await;
        let (factory, handles) = mock_factory();
        reset(Some(factory)).await;

        set_game_activity("1.20.1", "Avelmor", None).await;
        assert!(
            calls(&handles.log).is_empty(),
            "выключенный presence не должен подключаться к IPC"
        );

        on_settings_saved(true).await;
        assert_eq!(
            calls(&handles.log),
            vec![
                "connect".to_string(),
                "set:Minecraft 1.20.1|Avelmor".to_string()
            ],
            "включение во время игры должно восстановить активность игры"
        );

        override_client_factory_for_tests(None);
    }

    #[tokio::test]
    async fn game_exit_returns_to_launcher_presence() {
        let _guard = TEST_LOCK.lock().await;
        let (factory, handles) = mock_factory();
        reset(Some(factory)).await;

        init(true).await;
        set_game_activity("1.21.1", "Proj", None).await;
        on_game_exit().await;

        assert_eq!(
            calls(&handles.log),
            vec![
                "connect".to_string(),
                "set:В лаунчере|Limacina".to_string(),
                "set:Minecraft 1.21.1|Proj".to_string(),
                "set:В лаунчере|Limacina".to_string(),
            ]
        );

        override_client_factory_for_tests(None);
    }

    #[tokio::test]
    async fn missing_client_id_keeps_presence_disconnected() {
        let _guard = TEST_LOCK.lock().await;
        let (factory, handles) = mock_factory();
        reset(Some(factory)).await;

        env::remove_var("DISCORD_CLIENT_ID");
        init(true).await;
        assert!(
            calls(&handles.log).is_empty(),
            "без client id подключение невозможно"
        );

        env::set_var("DISCORD_CLIENT_ID", "test-client-id");
        on_settings_saved(true).await;
        assert_eq!(
            calls(&handles.log),
            vec!["connect".to_string(), "set:В лаунчере|Limacina".to_string()]
        );

        override_client_factory_for_tests(None);
    }

    #[tokio::test]
    async fn set_activity_failure_disconnects_and_next_apply_reconnects() {
        let _guard = TEST_LOCK.lock().await;
        let (factory, handles) = mock_factory();
        reset(Some(factory)).await;

        handles.fail_set.store(true, Ordering::Relaxed);
        init(true).await;
        assert_eq!(
            calls(&handles.log),
            vec![
                "connect".to_string(),
                "set:В лаунчере|Limacina".to_string(),
                "close".to_string()
            ],
            "сбой set_activity должен закрывать клиент"
        );

        handles.fail_set.store(false, Ordering::Relaxed);
        on_game_exit().await;
        assert_eq!(
            calls(&handles.log)[3..],
            ["connect".to_string(), "set:В лаунчере|Limacina".to_string()],
            "после сбоя следующий переход должен переподключиться"
        );

        override_client_factory_for_tests(None);
    }

    #[tokio::test]
    async fn exited_game_flag_skips_activity_recording() {
        let _guard = TEST_LOCK.lock().await;
        let (factory, handles) = mock_factory();
        reset(Some(factory)).await;

        init(true).await;
        let exited = Arc::new(AtomicBool::new(true));
        set_game_activity("1.21.1", "Proj", Some(Arc::clone(&exited))).await;

        assert_eq!(
            calls(&handles.log),
            vec!["connect".to_string(), "set:В лаунчере|Limacina".to_string()],
            "завершённая игра не должна записывать активность"
        );

        override_client_factory_for_tests(None);
    }

    #[tokio::test]
    async fn settings_change_between_launch_and_game_window_wins_over_stale_flag() {
        let _guard = TEST_LOCK.lock().await;

        let (factory, handles) = mock_factory();
        reset(Some(factory)).await;
        init(true).await;
        on_settings_saved(false).await;
        set_game_activity("1.21.1", "Proj", None).await;

        assert_eq!(
            calls(&handles.log),
            vec![
                "connect".to_string(),
                "set:В лаунчере|Limacina".to_string(),
                "close".to_string()
            ],
            "открытие окна игры не должно переподключать presence по устаревшему значению из контекста запуска"
        );

        override_client_factory_for_tests(None);

        let (factory, handles) = mock_factory();
        reset(Some(factory)).await;
        init(false).await;
        on_settings_saved(true).await;
        set_game_activity("1.21.1", "Proj", None).await;

        assert_eq!(
            calls(&handles.log),
            vec![
                "connect".to_string(),
                "set:В лаунчере|Limacina".to_string(),
                "set:Minecraft 1.21.1|Proj".to_string()
            ],
            "включение presence во время загрузки игры должно пережить открытие окна"
        );

        override_client_factory_for_tests(None);
    }

    #[tokio::test]
    async fn slow_ipc_times_out_client_is_not_restored_and_next_apply_recovers() {
        let _guard = TEST_LOCK.lock().await;
        let (factory, handles) = mock_factory();
        reset(Some(factory)).await;
        set_ipc_timeout_for_tests(Duration::from_millis(50));

        handles.hang_millis.store(250, Ordering::SeqCst);
        handles.hang_once.store(true, Ordering::SeqCst);
        init(true).await;

        assert!(
            discord_state()
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .client
                .is_none(),
            "зависший IPC не должен возвращать клиент в состояние"
        );

        tokio::time::sleep(Duration::from_millis(350)).await;
        on_game_exit().await;

        assert_eq!(
            calls(&handles.log),
            vec![
                "connect".to_string(),
                "set:В лаунчере|Limacina".to_string(),
                "connect".to_string(),
                "set:В лаунчере|Limacina".to_string(),
            ],
            "после таймаута следующий переход должен создать новый клиент"
        );

        override_client_factory_for_tests(None);
    }
}
