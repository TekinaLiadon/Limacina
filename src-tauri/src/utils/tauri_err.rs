
#[derive(Debug, serde::Serialize)]
pub struct CommandError(String);

impl From<anyhow::Error> for CommandError {
    fn from(error: anyhow::Error) -> Self {
        Self(format!("{:#}", error))
    }
}

pub type CommandResult<T> = Result<T, CommandError>;