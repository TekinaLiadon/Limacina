use anyhow::{Context, Result};
use reqwest::Client;

use crate::minecraft::forge::forge::ForgePromotions;

pub async fn get_promotions() -> Result<ForgePromotions> {
    let client = Client::builder()
        .user_agent("Mozilla/5.0 (compatible; MinecraftLauncher/1.0)")
        .build()
        .context("Не удалось создать HTTP клиент")?;
    let promotions_url =
        "https://files.minecraftforge.net/maven/net/minecraftforge/forge/promotions_slim.json";

    println!("🔍 Получение списка версий Forge...");
    let promos_str = client
        .get(promotions_url)
        .send()
        .await
        .context("Не удалось получить список версий Forge: ")?
        .error_for_status()
        .context("HTTP-ошибка: ")?
        .text()
        .await
        .context("Не удалось прочитать ответ: ")?;

    Ok(serde_json::from_str(&promos_str).context("Не удалось распарсить список версий: ")?)
}

pub async fn get_version(mc_version: &String, promotions: ForgePromotions) -> Result<String> {
    let forge_version = promotions
        .promos
        .get(&format!("{}-recommended", mc_version))
        .or_else(|| promotions.promos.get(&format!("{}-latest", mc_version)))
        .context("Нет версий Forge для MC")?;

    println!(
        "✓ Найдена версия Forge: {} для MC {}",
        forge_version, mc_version
    );
    Ok(format!("{}-{}", mc_version, forge_version))
}
