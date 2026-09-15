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
        }
    }
}

pub const INTERNAL_ERROR_CODE: &str = "internal";

#[cfg(test)]
mod tests {
    use super::{LauncherError, INTERNAL_ERROR_CODE};

    #[test]
    fn codes_are_stable_per_variant_group() {
        assert_eq!(
            LauncherError::ProjectNotSelected.code(),
            "project_not_selected"
        );
        for variant in [
            LauncherError::ProjectNameEmpty,
            LauncherError::ProjectNameTooLong,
            LauncherError::ProjectNameInvalidChars,
            LauncherError::ProjectNameReserved,
        ] {
            assert_eq!(variant.code(), "invalid_project_name");
        }
        assert_eq!(
            LauncherError::ProjectExists("Test".to_string()).code(),
            "project_exists"
        );
        assert_eq!(LauncherError::ConfigCorrupt.code(), "config_corrupt");
        assert_eq!(LauncherError::NoSession.code(), "auth_no_session");
        assert_ne!(INTERNAL_ERROR_CODE, LauncherError::NoSession.code());
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
