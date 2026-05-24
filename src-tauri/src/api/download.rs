use crate::api::dto::ModLoaderFactory;
use crate::minecraft::dto::MinecraftLoader;
use crate::{minecraft::mod_loader::vanilla::Vanilla, utils::tauri_err::CommandResult};

#[tauri::command]
pub async fn download_minecraft(mc_version: String, loader: String) -> CommandResult<String> {
    match loader.as_str() {
        "vanilla" => {
            let manifest = Vanilla.versions().await?;
            Vanilla.setup(&mc_version, manifest).await?;
            Ok("Vanilla майнкрафт установлен успешно".to_string())
        }
        _ => {
            let loader = ModLoaderFactory::create(loader.as_str())?;
            let manifest = loader.versions(&mc_version).await?;
            loader.setup(&manifest[0]).await?;
            Ok("Fabric майнкрафт установлен успешно".to_string())
        }
    }
}
