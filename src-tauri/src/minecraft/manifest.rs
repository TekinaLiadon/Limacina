use ::anyhow::Result;
use serde::de::DeserializeOwned;

use crate::utils::{download_file::download_json, env_info::launcher_patch};

pub async fn get_manifest_index<T: DeserializeOwned>(
    mod_loader: &str,
    url: &str,
    json_name: &str,
) -> Result<T> {
    let json_path = launcher_patch(None)?
        .join("manifest")
        .join(format!("{}_{}.json", mod_loader, json_name));
    let manifest: T = download_json(Some(url), json_path.as_path()).await?;
    Ok(manifest)
}
