use crate::minecraft::dto::ModLoader;
use crate::{minecraft::mod_loader::vanilla::Vanilla, utils::tauri_err::CommandResult};

#[tauri::command]
pub async fn download_minecraft(mc_version: String) -> CommandResult<String> {
    let manifest = Vanilla.versions().await?;
    Vanilla.setup(&mc_version, manifest).await?;
    Ok("Vanilla майнкрафт установлен успешно".to_string())
}
