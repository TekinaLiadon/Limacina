use std::path::PathBuf;

use anyhow::Result;
use async_trait::async_trait;

use crate::minecraft::vanilla::download::{
    collect_asset_targets, collect_install_targets, collect_natives_to_extract, VanillaPhaseInfo,
    PHASE_ASSETS, PHASE_CLIENT, PHASE_LIBRARIES,
};
use crate::minecraft::vanilla::structs::{AssetIndexContent, VersionDetailsManifest};
use crate::utils::integrity::IntegrityTarget;

#[async_trait]
pub trait VanillaPhaseExecutor: Send {
    async fn fetch(
        &mut self,
        phase: &'static VanillaPhaseInfo,
        targets: Vec<IntegrityTarget>,
    ) -> Result<()>;

    async fn natives(
        &mut self,
        mc_version: &str,
        natives_rel: Vec<(PathBuf, Option<Vec<String>>)>,
    ) -> Result<()>;

    async fn asset_index(&mut self, target: IntegrityTarget) -> Result<AssetIndexContent>;
}

pub async fn run_vanilla_phases(
    exec: &mut dyn VanillaPhaseExecutor,
    manifest: &VersionDetailsManifest,
) -> Result<()> {
    let targets = collect_install_targets(manifest);
    exec.fetch(&PHASE_CLIENT, vec![targets.client]).await?;
    exec.fetch(&PHASE_LIBRARIES, targets.libraries).await?;
    exec.natives(&manifest.id, collect_natives_to_extract(manifest))
        .await?;
    let asset_index = exec.asset_index(targets.asset_index).await?;
    let asset_targets = collect_asset_targets(&asset_index)?;
    exec.fetch(&PHASE_ASSETS, asset_targets).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::run_vanilla_phases;
    use crate::minecraft::vanilla::download::VanillaPhaseInfo;
    use crate::minecraft::vanilla::structs::{AssetIndexContent, VersionDetailsManifest};
    use crate::utils::integrity::IntegrityTarget;
    use anyhow::Result;
    use async_trait::async_trait;
    use serde_json::json;
    use std::path::PathBuf;

    struct RecordingExecutor {
        index: Option<AssetIndexContent>,
        events: Vec<String>,
        asset_paths: Vec<PathBuf>,
    }

    #[async_trait]
    impl super::VanillaPhaseExecutor for RecordingExecutor {
        async fn fetch(
            &mut self,
            phase: &'static VanillaPhaseInfo,
            targets: Vec<IntegrityTarget>,
        ) -> Result<()> {
            self.events.push(format!("fetch:{}", phase.id));
            if phase.id == "mc.assets" {
                self.asset_paths = targets.into_iter().map(|t| t.rel_path).collect();
            }
            Ok(())
        }

        async fn natives(
            &mut self,
            mc_version: &str,
            natives_rel: Vec<(PathBuf, Option<Vec<String>>)>,
        ) -> Result<()> {
            self.events
                .push(format!("natives:{mc_version}:{}", natives_rel.len()));
            Ok(())
        }

        async fn asset_index(&mut self, _target: IntegrityTarget) -> Result<AssetIndexContent> {
            self.events.push("asset_index".to_string());
            self.index
                .take()
                .ok_or_else(|| anyhow::anyhow!("индекс ресурсов недоступен"))
        }
    }

    fn manifest() -> VersionDetailsManifest {
        serde_json::from_value(json!({
            "id": "1.18.2",
            "downloads": {
                "client": {
                    "sha1": "2e9a3e3107cca00d6bc9c97bf7d149cae163ef21",
                    "size": 1,
                    "url": "https://example.invalid/client.jar"
                }
            },
            "libraries": [],
            "assetIndex": {
                "id": "1.18",
                "sha1": "d31a2e85ae149dd1b1a7070b22cb8887892fda6c",
                "size": 1,
                "url": "https://example.invalid/1.18.json",
                "totalSize": 1
            },
            "assets": "1.18",
            "mainClass": "net.minecraft.client.main.Main"
        }))
        .unwrap()
    }

    fn asset_index() -> AssetIndexContent {
        serde_json::from_value(json!({
            "objects": {
                "a.png": { "hash": "abcdef1234567890abcdef1234567890abcdef12", "size": 1 },
                "b.png": { "hash": "1234567890abcdef1234567890abcdef12345678", "size": 1 }
            }
        }))
        .unwrap()
    }

    #[tokio::test]
    async fn phases_run_in_order_and_feed_asset_targets() {
        let mut exec = RecordingExecutor {
            index: Some(asset_index()),
            events: Vec::new(),
            asset_paths: Vec::new(),
        };

        run_vanilla_phases(&mut exec, &manifest())
            .await
            .expect("конвейер фаз");

        assert_eq!(
            exec.events,
            vec![
                "fetch:mc.jar".to_string(),
                "fetch:mc.libs".to_string(),
                "natives:1.18.2:0".to_string(),
                "asset_index".to_string(),
                "fetch:mc.assets".to_string(),
            ]
        );
        exec.asset_paths.sort();
        assert_eq!(
            exec.asset_paths,
            vec![
                PathBuf::from("assets/objects/12/1234567890abcdef1234567890abcdef12345678"),
                PathBuf::from("assets/objects/ab/abcdef1234567890abcdef1234567890abcdef12"),
            ]
        );
    }

    #[tokio::test]
    async fn asset_index_failure_aborts_before_assets() {
        let mut exec = RecordingExecutor {
            index: None,
            events: Vec::new(),
            asset_paths: Vec::new(),
        };

        let result = run_vanilla_phases(&mut exec, &manifest()).await;

        assert!(result.is_err(), "сбой индекса должен прервать конвейер");
        assert_eq!(
            exec.events,
            vec![
                "fetch:mc.jar".to_string(),
                "fetch:mc.libs".to_string(),
                "natives:1.18.2:0".to_string(),
                "asset_index".to_string(),
            ]
        );
    }
}
