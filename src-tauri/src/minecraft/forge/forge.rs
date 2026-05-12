use serde::Deserialize;
use std::collections::HashMap;

use crate::{
    minecraft::forge::{
        download::{get_promotions, get_version},
        installer::{cleanup_temp_files, create_installer, start_installer},
    },
    utils::tauri_err::CommandResult,
};

#[derive(Debug, Deserialize)]
pub struct ForgePromotions {
    pub promos: HashMap<String, String>,
}

#[tauri::command]
pub async fn get_forge(mc_version: String) -> CommandResult<String> {
    let promotions: ForgePromotions = get_promotions().await?;
    let forge_full_version = get_version(&mc_version, promotions).await?;
    create_installer(&forge_full_version).await?;
    start_installer().await?;
    cleanup_temp_files().await?;

    println!("✓ Forge установлен успешно!");
    Ok(format!(
        "✓ Forge {} успешно установлен!",
        &forge_full_version
    ))
}
