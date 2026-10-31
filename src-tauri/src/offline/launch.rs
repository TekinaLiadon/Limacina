use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use crate::log_err;
use crate::state::dto::ProjectConfig;

use super::server::SkinServer;
use super::start_offline_skin_server;

pub struct AuthlibLaunch {
    server_url: Option<String>,
    skin_server: Option<SkinServer>,
}

impl AuthlibLaunch {
    pub async fn resolve(project_config: &ProjectConfig, username: &str, uuid: &str) -> Self {
        if project_config.online {
            return Self {
                server_url: project_config.resolved_server_url(),
                skin_server: None,
            };
        }
        let skin_server =
            match start_offline_skin_server(&project_config.project_name, username, uuid).await {
                Ok(server) => server,
                Err(e) => {
                    log_err!(
                        "[start] Офлайн-скин недоступен, запуск без скина ({}): {}",
                        project_config.project_name,
                        e
                    );
                    None
                }
            };
        let server_url = skin_server.as_ref().map(|server| server.url().to_string());
        Self {
            server_url,
            skin_server,
        }
    }

    pub fn server_url(&self) -> Option<&str> {
        self.server_url.as_deref()
    }

    pub fn stop_on_game_exit(mut self, exited: Arc<AtomicBool>) {
        let Some(server) = self.skin_server.take() else {
            return;
        };
        tauri::async_runtime::spawn_blocking(move || {
            loop {
                if exited.load(Ordering::Relaxed) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(500));
            }
            server.stop();
        });
    }
}

impl Drop for AuthlibLaunch {
    fn drop(&mut self) {
        if let Some(server) = self.skin_server.take() {
            server.stop();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{AuthlibLaunch, ProjectConfig, SkinServer};
    use std::net::TcpStream;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    fn shim_launch() -> (AuthlibLaunch, String) {
        let skin_server = SkinServer::start(
            None,
            "069a79f444e94726a5befca90e38abaf".to_string(),
            "Steve".to_string(),
        )
        .expect("шим должен стартовать");
        let url = skin_server.url().to_string();
        (
            AuthlibLaunch {
                server_url: Some(url.clone()),
                skin_server: Some(skin_server),
            },
            url,
        )
    }

    fn port_serves(url: &str) -> bool {
        let port = url.rsplit(':').next().unwrap().parse().unwrap();
        TcpStream::connect(("127.0.0.1", port)).is_ok()
    }

    fn wait_port_closed(url: &str) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if !port_serves(url) {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        panic!("шим не остановился за отведённое время: {}", url);
    }

    #[tokio::test]
    async fn resolve_online_uses_resolved_server_url() {
        let config = ProjectConfig {
            server_url: Some("https://mc.example.com".to_string()),
            ..Default::default()
        };

        let authlib =
            AuthlibLaunch::resolve(&config, "Steve", "069a79f444e94726a5befca90e38abaf").await;

        assert_eq!(authlib.server_url(), Some("https://mc.example.com"));
    }

    #[tokio::test]
    async fn resolve_offline_falls_back_without_shim_when_preparation_fails() {
        let config = ProjectConfig {
            online: false,
            project_name: String::new(),
            ..Default::default()
        };

        let authlib =
            AuthlibLaunch::resolve(&config, "Steve", "069a79f444e94726a5befca90e38abaf").await;

        assert_eq!(
            authlib.server_url(),
            None,
            "при отказе подготовки шима запуск не должен получать URL агента"
        );
    }

    #[test]
    fn shim_launch_exposes_shim_url() {
        let (authlib, url) = shim_launch();

        assert_eq!(authlib.server_url(), Some(url.as_str()));
    }

    #[test]
    fn drop_stops_skin_shim() {
        let (authlib, url) = shim_launch();
        assert!(
            port_serves(&url),
            "шим должен принимать соединения до остановки"
        );

        drop(authlib);

        wait_port_closed(&url);
    }

    #[test]
    fn stop_on_game_exit_stops_shim_after_flag() {
        let (authlib, url) = shim_launch();
        let exited = Arc::new(AtomicBool::new(false));
        assert!(port_serves(&url));

        authlib.stop_on_game_exit(Arc::clone(&exited));
        assert!(port_serves(&url), "шим должен работать, пока игра не вышла");

        exited.store(true, Ordering::Relaxed);
        wait_port_closed(&url);
    }

    #[test]
    fn stop_on_game_exit_without_shim_is_noop() {
        let authlib = AuthlibLaunch {
            server_url: Some("https://mc.example.com".to_string()),
            skin_server: None,
        };

        authlib.stop_on_game_exit(Arc::new(AtomicBool::new(false)));
    }
}
