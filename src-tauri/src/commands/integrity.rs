use anyhow::Context;
use tokio::sync::Mutex;

use crate::launcher_server::downloader::{
    build_auth_client, download_launcher_server_file, fetch_file_list, fetch_mods_list,
};
use crate::log_info;
use crate::minecraft::integrity::check_minecraft_integrity;
use crate::state::dto::GlobalState;
use crate::utils::env_info::{is_safe_relative_path, launcher_patch};
use crate::utils::integrity::{check_integrity, HashKind, IntegrityReport, IntegrityTarget, TargetDownload};
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
    let (token, server_url) = {
        let guard = state.lock().await;
        let token = guard
            .session
            .as_ref()
            .context("Необходима авторизация для проверки файлов")?
            .access_token
            .clone();
        (token, guard.project_config.resolved_server_url())
    };

    let client = build_auth_client(&token)?;
    let base_path = launcher_patch(Some(&project.project_name))?;

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
            anyhow::bail!("Сервер передал недопустимый путь файла: {}", key);
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
