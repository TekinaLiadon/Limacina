use anyhow::{bail, Result};
use tokio::sync::Mutex;

use crate::auth;
use crate::commands::auth::{remember_login, store_session};
use crate::state::dto::{GlobalState, ProjectConfig, SessionTokens};
use crate::utils::errors::LauncherError;

pub(crate) async fn login(
    state: &Mutex<GlobalState>,
    project_name: &str,
    username: &str,
    remember_me: bool,
) -> Result<()> {
    if username.is_empty() {
        bail!(LauncherError::UsernameEmpty);
    }
    let data = auth::offline(username);
    store_session(state, &data, username, project_name).await;
    remember_login(state, project_name, username, remember_me).await
}

pub(crate) async fn refresh(
    state: &Mutex<GlobalState>,
    project_name: &str,
    username: &str,
) -> Result<()> {
    let data = auth::offline(username);
    store_session(state, &data, username, project_name).await;
    Ok(())
}

pub(crate) fn reject_offline_session(session: &SessionTokens, reason: &str) -> Result<()> {
    if session.access_token == auth::OFFLINE_ACCESS_TOKEN {
        bail!(LauncherError::OfflineProfile(reason.to_string()));
    }
    Ok(())
}

pub(crate) fn reject_offline_project(project: &ProjectConfig, reason: &str) -> Result<()> {
    if !project.online {
        bail!(LauncherError::OfflineProfile(reason.to_string()));
    }
    Ok(())
}

#[cfg(test)]
mod auth_offline_tests {
    use super::{login, refresh, reject_offline_project, reject_offline_session};
    use crate::auth::{generate_offline_uuid, OFFLINE_ACCESS_TOKEN};
    use crate::state::dto::{GlobalState, ProjectConfig, SessionTokens};
    use crate::test_support::{
        offline_global_state, seed_offline_project, ConfigFileGuard, LauncherDirGuard,
    };
    use crate::utils::errors::LauncherError;
    use tokio::sync::Mutex;

    fn offline_state(project_name: &str) -> Mutex<GlobalState> {
        offline_global_state(project_name)
    }

    async fn session_token(state: &Mutex<GlobalState>) -> SessionTokens {
        state
            .lock()
            .await
            .session
            .clone()
            .expect("сессия должна быть сохранена")
    }

    #[tokio::test]
    async fn login_stores_offline_session_and_remembered_login() {
        let dir = LauncherDirGuard::acquire("auth_offline_unit_login").await;
        let _config_guard = ConfigFileGuard::acquire(dir.root(), "config.json");
        seed_offline_project("OffProj").await;
        let state = offline_state("OffProj");

        login(&state, "OffProj", "Steve", true)
            .await
            .expect("офлайн-логин");

        let session = session_token(&state).await;
        assert_eq!(session.access_token, OFFLINE_ACCESS_TOKEN);
        assert_eq!(session.uuid, generate_offline_uuid("Steve"));
        assert_eq!(session.username, "Steve");
        assert_eq!(
            state
                .lock()
                .await
                .launcher_config
                .as_ref()
                .expect("конфиг лаунчера")
                .get_logins("OffProj"),
            vec!["Steve".to_string()]
        );
    }

    #[tokio::test]
    async fn login_rejects_blank_username_without_session() {
        let dir = LauncherDirGuard::acquire("auth_offline_unit_blank").await;
        let _config_guard = ConfigFileGuard::acquire(dir.root(), "config.json");
        seed_offline_project("OffProj").await;
        let state = offline_state("OffProj");

        let error = login(&state, "OffProj", "", true)
            .await
            .expect_err("пустой ник должен отклоняться");

        assert!(
            matches!(
                error.downcast_ref::<LauncherError>(),
                Some(LauncherError::UsernameEmpty)
            ),
            "ожидается UsernameEmpty: {error}"
        );
        assert!(state.lock().await.session.is_none());
    }

    #[tokio::test]
    async fn refresh_stores_offline_session_without_saved_logins() {
        let dir = LauncherDirGuard::acquire("auth_offline_unit_refresh").await;
        let _config_guard = ConfigFileGuard::acquire(dir.root(), "config.json");
        seed_offline_project("OffProj").await;
        let state = offline_state("OffProj");

        refresh(&state, "OffProj", "Steve")
            .await
            .expect("офлайн-refresh");

        let session = session_token(&state).await;
        assert_eq!(session.access_token, OFFLINE_ACCESS_TOKEN);
        assert_eq!(session.uuid, generate_offline_uuid("Steve"));
        assert!(state
            .lock()
            .await
            .launcher_config
            .as_ref()
            .expect("конфиг лаунчера")
            .get_logins("OffProj")
            .is_empty());
    }

    #[test]
    fn reject_offline_session_recognizes_only_sentinel_token() {
        let mut session = SessionTokens {
            access_token: "real-token".to_string(),
            uuid: "uuid-1".to_string(),
            username: "Steve".to_string(),
            project_name: "TestProj".to_string(),
        };
        reject_offline_session(&session, "операция недоступна")
            .expect("серверная сессия не должна отклоняться");

        session.access_token = OFFLINE_ACCESS_TOKEN.to_string();
        let error = reject_offline_session(&session, "смена пароля недоступна")
            .expect_err("офлайн-сессия должна отклоняться");
        assert!(matches!(
            error.downcast_ref::<LauncherError>(),
            Some(LauncherError::OfflineProfile(reason)) if reason.contains("смена пароля")
        ));
    }

    #[test]
    fn reject_offline_project_separates_online_projects() {
        let mut project = ProjectConfig {
            project_name: "TestProj".to_string(),
            ..ProjectConfig::default()
        };
        reject_offline_project(&project, "регистрация недоступна")
            .expect("серверный проект не должен отклоняться");

        project.online = false;
        let error = reject_offline_project(&project, "регистрация недоступна")
            .expect_err("офлайн-проект должен отклоняться");
        assert!(matches!(
            error.downcast_ref::<LauncherError>(),
            Some(LauncherError::OfflineProfile(reason)) if reason.contains("регистрация")
        ));
    }
}
