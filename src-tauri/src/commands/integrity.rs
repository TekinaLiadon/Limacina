use tokio::sync::Mutex;

use crate::launcher_server::downloader::{
    download_launcher_server_file, fetch_file_list, fetch_mods_list, require_api_client, ApiContext,
};
use crate::log_info;
use crate::minecraft::check_targets::check_minecraft_integrity;
use crate::state::dto::GlobalState;
use crate::utils::env_info::{is_safe_relative_path, launcher_path};
use crate::utils::errors::LauncherError;
use crate::utils::integrity::{
    check_integrity, HashKind, IntegrityReport, IntegrityTarget, TargetDownload,
};
use crate::utils::tauri_err::CommandResult;

#[tauri::command]
pub async fn check_files_integrity(
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<IntegrityReport> {
    let project = {
        let guard = state.lock().await;
        guard.project_config.clone()
    };

    let mut report = check_minecraft_integrity(&project).await?;

    if project.online {
        let server_report = check_server_integrity(&project, &state).await?;
        report.merge(server_report);
    } else {
        log_info!(
            "[integrity] Одиночный профиль {} — файлы сервера и моды не проверяются",
            project.project_name
        );
    }

    Ok(report)
}

async fn check_server_integrity(
    project: &crate::state::dto::ProjectConfig,
    state: &tauri::State<'_, Mutex<GlobalState>>,
) -> anyhow::Result<IntegrityReport> {
    let ApiContext { client, server_url } = require_api_client(state.inner()).await?;
    let base_path = launcher_path(Some(&project.project_name))?;

    let file_list = fetch_file_list(&client, &server_url, &project.project_name).await?;
    let files_report = check_integrity(
        &base_path,
        collect_launcher_server_targets(&file_list)?,
        "files.check",
        "Файлы сервера",
        download_launcher_server_file(client.clone(), server_url.clone()),
    )
    .await?;

    let mods_list = fetch_mods_list(&client, &server_url, &project.project_name).await?;
    let mods_report = check_integrity(
        &base_path,
        collect_launcher_server_targets(&mods_list)?,
        "mods.check",
        "Моды",
        download_launcher_server_file(client, server_url),
    )
    .await?;

    let mut report = files_report;
    report.merge(mods_report);
    Ok(report)
}

fn collect_launcher_server_targets(
    file_list: &std::collections::HashMap<String, String>,
) -> anyhow::Result<Vec<IntegrityTarget>> {
    let mut targets = Vec::new();
    for (key, hash) in file_list {
        if !is_safe_relative_path(key) {
            anyhow::bail!(LauncherError::InvalidModFilename(key.clone()));
        }
        targets.push(IntegrityTarget {
            rel_path: std::path::PathBuf::from(key),
            hash: hash.clone(),
            hash_kind: HashKind::Sha1,
            download: TargetDownload::LauncherServer { key: key.clone() },
        });
    }
    Ok(targets)
}

#[cfg(test)]
mod collect_targets_tests {
    use super::collect_launcher_server_targets;
    use crate::utils::errors::LauncherError;
    use crate::utils::integrity::{HashKind, TargetDownload};
    use std::collections::HashMap;

    #[test]
    fn targets_are_built_from_safe_keys() {
        let list: HashMap<String, String> = HashMap::from([
            ("config/file.json".to_string(), "hash-1".to_string()),
            ("mods/simple.jar".to_string(), "hash-2".to_string()),
        ]);

        let targets = collect_launcher_server_targets(&list).expect("безопасные ключи");

        assert_eq!(targets.len(), 2);
        for target in &targets {
            let key = target.rel_path.to_string_lossy().into_owned();
            assert_eq!(
                list.get(&key).map(String::as_str),
                Some(target.hash.as_str()),
                "хеш ключа {key:?} должен сохраниться"
            );
            assert!(matches!(target.hash_kind, HashKind::Sha1));
            assert!(matches!(
                &target.download,
                TargetDownload::LauncherServer { key: download_key }
                    if *download_key == key
            ));
        }
    }

    #[test]
    fn traversal_keys_are_rejected() {
        for key in ["../evil.txt", "/abs/path", "a/../../b", "C:/windows/evil"] {
            let list: HashMap<String, String> =
                HashMap::from([(key.to_string(), "hash".to_string())]);

            let error = match collect_launcher_server_targets(&list) {
                Ok(_) => panic!("traversal-ключ {key:?} должен отклоняться"),
                Err(error) => error,
            };
            assert!(
                matches!(
                    error.downcast_ref::<LauncherError>(),
                    Some(LauncherError::InvalidModFilename(_))
                ),
                "ключ {key:?} должен давать InvalidModFilename: {error}"
            );
        }
    }
}
