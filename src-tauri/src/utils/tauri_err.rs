use crate::log_err;
use crate::utils::errors::{LauncherError, INTERNAL_ERROR_CODE};

#[derive(Debug, serde::Serialize)]
pub struct CommandError {
    pub code: String,
    pub message: String,
}

impl CommandError {
    fn typed(error: &LauncherError) -> Self {
        Self {
            code: error.code().to_string(),
            message: error.to_string(),
        }
    }

    fn internal(message: String) -> Self {
        Self {
            code: INTERNAL_ERROR_CODE.to_string(),
            message,
        }
    }
}

impl From<anyhow::Error> for CommandError {
    fn from(error: anyhow::Error) -> Self {
        log_err!("{:#}", error);
        let typed = error
            .chain()
            .find_map(|cause| cause.downcast_ref::<LauncherError>());
        match typed {
            Some(typed) => Self::typed(typed),
            None => Self::internal(format!("{:#}", error)),
        }
    }
}

impl From<LauncherError> for CommandError {
    fn from(error: LauncherError) -> Self {
        Self::typed(&error)
    }
}

pub type CommandResult<T> = Result<T, CommandError>;
