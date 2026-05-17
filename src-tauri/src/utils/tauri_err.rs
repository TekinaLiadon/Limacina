use crate::log_err;

#[derive(Debug, serde::Serialize)]
pub struct CommandError(String);

impl From<anyhow::Error> for CommandError {
    fn from(error: anyhow::Error) -> Self {
        log_err!("{:#}", error);
        Self(format!("{:#}", error))
    }
}

pub type CommandResult<T> = Result<T, CommandError>;
