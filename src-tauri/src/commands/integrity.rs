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

    let mut report = if project.legacy {
        check_legacy_files_integrity(&project, &state).await?
    } else {
        check_minecraft_integrity(&project).await?
    };

    if !project.legacy && project.online {
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

async fn check_legacy_files_integrity(
    project: &crate::state::dto::ProjectConfig,
    state: &tauri::State<'_, Mutex<GlobalState>>,
) -> anyhow::Result<IntegrityReport> {
    let (username, access_token) = {
        let guard = state.lock().await;
        let session = guard
            .session
            .as_ref()
            .ok_or(LauncherError::NoSession)?
            .clone();
        (session.username, session.access_token)
    };
    let profile = project
        .legacy_profile
        .clone()
        .ok_or_else(|| LauncherError::InvalidInput("У легаси-проекта нет профиля обновлений".to_string()))?;

    let base_url = crate::legacy::launch::legacy_base_url(project)?;
    let client = crate::legacy::requests::LegacyClient::new(&base_url)?;
    let paths = crate::legacy::update::LegacyPaths::new(&project.project_name)?;

    let plans = vec![
        crate::legacy::integrity::IntegrityDirPlan {
            dir_name: paths.jvm_dir_name(&profile),
            dir: paths.jvm_dir(&profile),
            matcher: None,
            step_id: "legacy.jvm",
            step_label: "Файлы JVM",
        },
        crate::legacy::integrity::IntegrityDirPlan {
            dir_name: profile.asset_dir.clone(),
            dir: paths.asset_dir(&profile),
            matcher: crate::legacy::update::asset_matcher(&profile),
            step_id: "legacy.assets",
            step_label: "Файлы ресурсов",
        },
        crate::legacy::integrity::IntegrityDirPlan {
            dir_name: profile.dir_name.clone(),
            dir: paths.client_dir(&profile),
            matcher: Some(crate::legacy::update::client_matcher(&profile)?),
            step_id: "legacy.client",
            step_label: "Файлы клиента",
        },
    ];

    crate::legacy::integrity::check_legacy_integrity(
        &client,
        crate::legacy::requests::LegacySession {
            username: &username,
            access_token: &access_token,
        },
        plans,
    )
    .await
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
