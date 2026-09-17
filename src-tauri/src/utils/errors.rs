use anyhow::{anyhow, Result};

#[derive(Debug, thiserror::Error)]
pub enum LauncherError {
    #[error("Проект не выбран")]
    ProjectNotSelected,
    #[error("Введите название профиля")]
    ProjectNameEmpty,
    #[error("Название профиля не должно быть длиннее 64 символов")]
    ProjectNameTooLong,
    #[error("Название профиля не должно содержать символы / \\ : * ? \" < > | и точку")]
    ProjectNameInvalidChars,
    #[error("Название «config» зарезервировано")]
    ProjectNameReserved,
    #[error("Профиль «{0}» уже существует")]
    ProjectExists(String),
    #[error("Проект «{0}» прописан в сборке лаунчера и не может быть удалён")]
    ProjectProtected(String),
    #[error("Одиночный профиль: {0}")]
    OfflineProfile(String),
    #[error("Нет активной сессии. Войдите в аккаунт.")]
    NoSession,
    #[error("Нет сохранённых учётных данных для «{0}» — войдите с паролем")]
    NoSavedCredentials(String),
    #[error("Не указан адрес сервера")]
    ServerUrlMissing,
    #[error("Офлайн-сборка: сервер обновлений не настроен")]
    UpdateServerMissing,
    #[error("Версия v{0} отсутствует на сервере")]
    UpdateVersionMissing(String),
    #[error("Лоадер не выбран")]
    LoaderNotSelected,
    #[error("Хеш файла не совпал с ожидаемым: {0}")]
    HashMismatch(String),
    #[error("Некорректное имя файла мода: {0}")]
    InvalidModFilename(String),
    #[error("Конфиг профиля повреждён, загружены настройки по умолчанию")]
    ConfigCorrupt,
    #[error("Ошибка файловой системы: {0}")]
    DiskIo(String),
    #[error("Не удалось обработать манифест: {0}")]
    ManifestParse(String),
    #[error("Java: {0}")]
    Java(String),
    #[error("Сервер авторизации: {0}")]
    AuthServer(String),
    #[error("Сервер лаунчера: {0}")]
    LauncherServer(String),
    #[error("Ошибка загрузки файлов игры: {0}")]
    GameDownload(String),
    #[error("Установка лоадера не удалась: {0}")]
    LoaderSetup(String),
    #[error("Не удалось запустить игру: {0}")]
    GameProcess(String),
    #[error("Ошибка обновления: {0}")]
    Update(String),
    #[error("Modrinth: {0}")]
    Modrinth(String),
    #[error("Хранилище учётных данных: {0}")]
    CredentialsStorage(String),
    #[error("Настройки игры: {0}")]
    GameOptions(String),
    #[error("Модель игрока: {0}")]
    PlayerModel(String),
    #[error("Офлайн-режим: {0}")]
    Offline(String),
    #[error("Введите ник")]
    UsernameEmpty,
    #[error("Пароль должен быть не короче 6 символов")]
    PasswordTooShort,
    #[error("Новый пароль совпадает с текущим")]
    PasswordUnchanged,
    #[error("{0}")]
    InvalidInput(String),
    #[error("Сессия принадлежит проекту «{0}», а запускается «{1}». Перезайдите в аккаунт.")]
    SessionMismatch(String, String),
    #[error("Не удалось скачать файл: {0}")]
    Download(String),
    #[error("{0}")]
    Http(String),
    #[error("{message}")]
    HttpStatus { status: u16, message: String },
}

impl LauncherError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::ProjectNotSelected => "project_not_selected",
            Self::ProjectNameEmpty
            | Self::ProjectNameTooLong
            | Self::ProjectNameInvalidChars
            | Self::ProjectNameReserved => "invalid_project_name",
            Self::ProjectExists(_) => "project_exists",
            Self::ProjectProtected(_) => "project_protected",
            Self::OfflineProfile(_) => "offline_profile",
            Self::NoSession => "auth_no_session",
            Self::NoSavedCredentials(_) => "auth_no_saved_credentials",
            Self::ServerUrlMissing => "server_url_missing",
            Self::UpdateServerMissing => "update_server_missing",
            Self::UpdateVersionMissing(_) => "update_version_missing",
            Self::LoaderNotSelected => "loader_not_selected",
            Self::HashMismatch(_) => "hash_mismatch",
            Self::InvalidModFilename(_) => "invalid_mod_filename",
            Self::ConfigCorrupt => "config_corrupt",
            Self::DiskIo(_) => "disk_io",
            Self::ManifestParse(_) => "manifest_parse",
            Self::Java(_) => "java",
            Self::AuthServer(_) => "auth_server",
            Self::LauncherServer(_) => "launcher_server",
            Self::GameDownload(_) => "game_download",
            Self::LoaderSetup(_) => "loader_setup",
            Self::GameProcess(_) => "game_process",
            Self::Update(_) => "update",
            Self::Modrinth(_) => "modrinth",
            Self::CredentialsStorage(_) => "auth_storage",
            Self::GameOptions(_) => "game_options",
            Self::PlayerModel(_) => "player_model",
            Self::Offline(_) => "offline",
            Self::UsernameEmpty => "invalid_username",
            Self::PasswordTooShort | Self::PasswordUnchanged => "invalid_password",
            Self::InvalidInput(_) => "invalid_input",
            Self::SessionMismatch(_, _) => "auth_session_mismatch",
            Self::Download(_) => "download",
            Self::Http(_) => "http",
            Self::HttpStatus { .. } => "http_status",
        }
    }

    fn is_generic(&self) -> bool {
        matches!(
            self,
            Self::Download(_) | Self::Http(_) | Self::HttpStatus { .. }
        )
    }

    pub fn classify<T>(result: Result<T>, wrap: impl FnOnce(String) -> Self) -> Result<T> {
        result.map_err(|e| {
            let typed = e
                .chain()
                .find_map(|cause| cause.downcast_ref::<LauncherError>());
            match typed {
                Some(typed) if !typed.is_generic() => e,
                _ => anyhow!(wrap(format!("{:#}", e))),
            }
        })
    }
}

pub const INTERNAL_ERROR_CODE: &str = "internal";

#[cfg(test)]
mod tests {
    use super::{LauncherError, INTERNAL_ERROR_CODE};
    use anyhow::anyhow;
    use anyhow::Context as _;
    use std::collections::HashSet;

    fn code_groups() -> Vec<(LauncherError, &'static str)> {
        vec![
            (LauncherError::ProjectNotSelected, "project_not_selected"),
            (LauncherError::ProjectNameEmpty, "invalid_project_name"),
            (
                LauncherError::ProjectExists("x".to_string()),
                "project_exists",
            ),
            (
                LauncherError::ProjectProtected("x".to_string()),
                "project_protected",
            ),
            (
                LauncherError::OfflineProfile("x".to_string()),
                "offline_profile",
            ),
            (LauncherError::NoSession, "auth_no_session"),
            (
                LauncherError::NoSavedCredentials("x".to_string()),
                "auth_no_saved_credentials",
            ),
            (LauncherError::ServerUrlMissing, "server_url_missing"),
            (LauncherError::UpdateServerMissing, "update_server_missing"),
            (
                LauncherError::UpdateVersionMissing("0".to_string()),
                "update_version_missing",
            ),
            (LauncherError::LoaderNotSelected, "loader_not_selected"),
            (
                LauncherError::HashMismatch("x".to_string()),
                "hash_mismatch",
            ),
            (
                LauncherError::InvalidModFilename("x".to_string()),
                "invalid_mod_filename",
            ),
            (LauncherError::ConfigCorrupt, "config_corrupt"),
            (LauncherError::DiskIo("x".to_string()), "disk_io"),
            (
                LauncherError::ManifestParse("x".to_string()),
                "manifest_parse",
            ),
            (LauncherError::Java("x".to_string()), "java"),
            (LauncherError::AuthServer("x".to_string()), "auth_server"),
            (
                LauncherError::LauncherServer("x".to_string()),
                "launcher_server",
            ),
            (
                LauncherError::GameDownload("x".to_string()),
                "game_download",
            ),
            (LauncherError::LoaderSetup("x".to_string()), "loader_setup"),
            (LauncherError::GameProcess("x".to_string()), "game_process"),
            (LauncherError::Update("x".to_string()), "update"),
            (LauncherError::Modrinth("x".to_string()), "modrinth"),
            (
                LauncherError::CredentialsStorage("x".to_string()),
                "auth_storage",
            ),
            (LauncherError::GameOptions("x".to_string()), "game_options"),
            (LauncherError::PlayerModel("x".to_string()), "player_model"),
            (LauncherError::Offline("x".to_string()), "offline"),
            (LauncherError::UsernameEmpty, "invalid_username"),
            (LauncherError::PasswordTooShort, "invalid_password"),
            (
                LauncherError::SessionMismatch("a".to_string(), "b".to_string()),
                "auth_session_mismatch",
            ),
            (LauncherError::Download("x".to_string()), "download"),
            (LauncherError::Http("x".to_string()), "http"),
            (
                LauncherError::HttpStatus {
                    status: 404,
                    message: "x".to_string(),
                },
                "http_status",
            ),
        ]
    }

    #[test]
    fn codes_are_unique_across_catalog() {
        let codes = code_groups();
        let unique: HashSet<&str> = codes.iter().map(|(_, code)| *code).collect();
        assert_eq!(unique.len(), codes.len());
    }

    #[test]
    fn codes_are_stable_per_variant_group() {
        for (variant, expected) in code_groups() {
            assert_eq!(variant.code(), expected);
        }
        for variant in [
            LauncherError::ProjectNameEmpty,
            LauncherError::ProjectNameTooLong,
            LauncherError::ProjectNameInvalidChars,
            LauncherError::ProjectNameReserved,
        ] {
            assert_eq!(variant.code(), "invalid_project_name");
        }
        assert_eq!(LauncherError::PasswordUnchanged.code(), "invalid_password");
    }

    #[test]
    fn codes_differ_from_internal() {
        for (variant, _) in code_groups() {
            assert_ne!(variant.code(), INTERNAL_ERROR_CODE);
        }
    }

    #[test]
    fn classify_keeps_existing_typed_error() {
        let original = anyhow!(LauncherError::NoSession);
        let wrapped = LauncherError::classify(
            Err::<(), _>(original).context("Не удалось запустить игру"),
            LauncherError::GameProcess,
        )
        .unwrap_err();
        let typed = wrapped
            .chain()
            .find_map(|cause| cause.downcast_ref::<LauncherError>());
        assert!(matches!(typed, Some(LauncherError::NoSession)));
    }

    #[test]
    fn classify_wraps_untyped_error() {
        let wrapped = LauncherError::classify(
            Err::<(), _>(anyhow!("файл не найден")).context("Чтение конфига"),
            LauncherError::DiskIo,
        )
        .unwrap_err();
        let typed = wrapped
            .chain()
            .find_map(|cause| cause.downcast_ref::<LauncherError>());
        assert!(matches!(typed, Some(LauncherError::DiskIo(_))));
        assert_eq!(
            LauncherError::classify(
                Err::<(), _>(anyhow!("файл не найден")),
                LauncherError::DiskIo
            )
            .unwrap_err()
            .to_string(),
            "Ошибка файловой системы: файл не найден"
        );
    }

    #[test]
    fn classify_overrides_generic_error() {
        let wrapped = LauncherError::classify(
            Err::<(), _>(anyhow!(LauncherError::Download(
                "поток оборвался".to_string()
            ))),
            LauncherError::Java,
        )
        .unwrap_err();
        let typed = wrapped
            .chain()
            .find_map(|cause| cause.downcast_ref::<LauncherError>());
        assert!(
            matches!(typed, Some(LauncherError::Java(_))),
            "обобщённая ошибка скачивания должна переопределяться доменной обёрткой"
        );
        assert_eq!(
            wrapped.to_string(),
            "Java: Не удалось скачать файл: поток оборвался"
        );

        let auth_wrapped = LauncherError::classify(
            Err::<(), _>(anyhow!(LauncherError::Http(
                "Неверный логин или пароль".to_string()
            ))),
            LauncherError::AuthServer,
        )
        .unwrap_err();
        assert_eq!(
            auth_wrapped.to_string(),
            "Сервер авторизации: Неверный логин или пароль"
        );
    }

    #[test]
    fn display_is_russian_user_facing_message() {
        assert_eq!(
            LauncherError::ProjectNotSelected.to_string(),
            "Проект не выбран"
        );
        assert_eq!(
            LauncherError::OfflineProfile("регистрация недоступна".to_string()).to_string(),
            "Одиночный профиль: регистрация недоступна"
        );
    }
}
