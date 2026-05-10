use anyhow::Result;
use reqwest::Client;

use crate::{
    minecraft::forge::forge::ForgePromotions
};

pub async fn get_promotions() -> Result<ForgePromotions, String> {
    let client = Client::builder()
        .user_agent("Mozilla/5.0 (compatible; MinecraftLauncher/1.0)")
        .build()
        .map_err(|e| format!("Не удалось создать HTTP клиент: {}", e))?;
    let promotions_url =
        "https://files.minecraftforge.net/maven/net/minecraftforge/forge/promotions_slim.json";

    println!("🔍 Получение списка версий Forge...");
    let promos_str = client
        .get(promotions_url)
        .send()
        .await
        .map_err(|e| format!("Не удалось получить список версий Forge: {}", e))?
        .error_for_status()
        .map_err(|e| format!("HTTP-ошибка: {}", e))?
        .text()
        .await
        .map_err(|e| format!("Не удалось прочитать ответ: {}", e))?;

    Ok(serde_json::from_str(&promos_str)
        .map_err(|e| format!("Не удалось распарсить список версий: {}", e))?)
}

pub async fn get_version(
    mc_version: &String,
    promotions: ForgePromotions,
) -> Result<String, String> {
    let forge_version = promotions
        .promos
        .get(&format!("{}-recommended", mc_version))
        .or_else(|| promotions.promos.get(&format!("{}-latest", mc_version)))
        .ok_or_else(|| {
            let available: Vec<_> = promotions
                .promos
                .keys()
                .filter(|k| k.ends_with("-recommended") || k.ends_with("-latest"))
                .filter_map(|k| k.split('-').next())
                .collect::<std::collections::HashSet<_>>()
                .into_iter()
                .collect();
            format!(
                "Нет версий Forge для MC {}. Доступные: {:?}",
                mc_version, available
            )
        })?;

    println!(
        "✓ Найдена версия Forge: {} для MC {}",
        forge_version, mc_version
    );
    Ok(format!("{}-{}", mc_version, forge_version))
}
