use std::path::PathBuf;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::utils::download_file::write_atomic;
use crate::utils::env_info::{is_safe_relative_path, launcher_path};
use crate::utils::errors::LauncherError;
use crate::utils::tauri_err::CommandResult;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
pub struct InstallJournal {
    pub project: String,
    pub fingerprint: String,
    pub completed: Vec<String>,
}

fn journal_path(project: &str) -> Result<PathBuf> {
    if !is_safe_relative_path(project) {
        return Err(
            LauncherError::InvalidInput(format!("Некорректное имя проекта: {project}")).into(),
        );
    }
    Ok(launcher_path(Some("manifest"))?.join(format!("install_journal_{project}.json")))
}

async fn read_journal(project: &str) -> Result<Option<InstallJournal>> {
    let path = journal_path(project)?;
    match tokio::fs::read_to_string(&path).await {
        Ok(content) => match serde_json::from_str(&content) {
            Ok(journal) => Ok(Some(journal)),
            Err(_) => Ok(None),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => {
            Err(e).with_context(|| format!("Не удалось прочитать журнал установки {:?}", path))
        }
    }
}

async fn write_journal(project: &str, journal: &InstallJournal) -> Result<()> {
    let path = journal_path(project)?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let content = serde_json::to_string(journal)?;
    write_atomic(&path, content.as_bytes()).await?;
    Ok(())
}

fn completed_from_journal(
    journal: Option<InstallJournal>,
    project: &str,
    fingerprint: &str,
    plan: &[String],
) -> Vec<String> {
    let Some(journal) = journal else {
        return Vec::new();
    };
    if journal.project != project || journal.fingerprint != fingerprint {
        return Vec::new();
    }
    if journal.completed.is_empty() {
        return Vec::new();
    }
    if !journal
        .completed
        .iter()
        .all(|key| plan.iter().any(|step| step == key))
    {
        return Vec::new();
    }
    let mut completed: Vec<String> = Vec::new();
    for key in journal.completed {
        if !completed.contains(&key) {
            completed.push(key);
        }
    }
    completed
}

async fn record_step(project: &str, fingerprint: &str, key: &str) -> Result<()> {
    let fresh = InstallJournal {
        project: project.to_string(),
        fingerprint: fingerprint.to_string(),
        completed: Vec::new(),
    };
    let mut journal = match read_journal(project).await? {
        Some(existing) if existing.project == project && existing.fingerprint == fingerprint => {
            existing
        }
        _ => fresh,
    };
    if !journal.completed.iter().any(|step| step == key) {
        journal.completed.push(key.to_string());
    }
    write_journal(project, &journal).await
}

#[tauri::command]
pub async fn load_install_journal(
    project: String,
    fingerprint: String,
    plan: Vec<String>,
) -> CommandResult<Vec<String>> {
    if project.trim().is_empty() {
        return Err(LauncherError::ProjectNotSelected.into());
    }
    let journal = read_journal(&project).await.unwrap_or_default();
    Ok(completed_from_journal(
        journal,
        &project,
        &fingerprint,
        &plan,
    ))
}

#[tauri::command]
pub async fn record_install_step(
    project: String,
    fingerprint: String,
    key: String,
) -> CommandResult<()> {
    if project.trim().is_empty() {
        return Err(LauncherError::ProjectNotSelected.into());
    }
    record_step(&project, &fingerprint, &key).await?;
    Ok(())
}

#[tauri::command]
pub async fn clear_install_journal(project: String) -> CommandResult<()> {
    if project.trim().is_empty() {
        return Err(LauncherError::ProjectNotSelected.into());
    }
    clear_journal(&project).await?;
    Ok(())
}

async fn clear_journal(project: &str) -> Result<()> {
    let path = journal_path(project)?;
    match tokio::fs::remove_file(&path).await {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => {
            return Err(anyhow::Error::new(e)
                .context(format!("Не удалось удалить журнал установки {:?}", path)))
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::LauncherDirGuard;

    fn journal(project: &str, fingerprint: &str, completed: &[&str]) -> InstallJournal {
        InstallJournal {
            project: project.to_string(),
            fingerprint: fingerprint.to_string(),
            completed: completed.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn plan(steps: &[&str]) -> Vec<String> {
        steps.iter().map(|s| s.to_string()).collect()
    }

    #[tokio::test]
    async fn record_and_load_round_trip_resumes_completed_steps() {
        let _guard = LauncherDirGuard::acquire("install_journal").await;
        record_step("Cordelia", "fp1", "install.java")
            .await
            .unwrap();
        record_step("Cordelia", "fp1", "install.files")
            .await
            .unwrap();
        record_step("Cordelia", "fp1", "install.java")
            .await
            .unwrap();

        let journal = read_journal("Cordelia").await.unwrap().unwrap();
        assert_eq!(journal.completed, vec!["install.java", "install.files"]);

        let completed = completed_from_journal(
            read_journal("Cordelia").await.unwrap(),
            "Cordelia",
            "fp1",
            &plan(&[
                "install.java",
                "install.files",
                "install.mods",
                "install.minecraft",
            ]),
        );
        assert_eq!(completed, vec!["install.java", "install.files"]);
    }

    #[tokio::test]
    async fn fingerprint_mismatch_starts_from_scratch() {
        let _guard = LauncherDirGuard::acquire("install_journal_fp").await;
        record_step("Cordelia", "fp1", "install.java")
            .await
            .unwrap();

        let completed = completed_from_journal(
            read_journal("Cordelia").await.unwrap(),
            "Cordelia",
            "fp2",
            &plan(&["install.java"]),
        );
        assert!(completed.is_empty());
    }

    #[tokio::test]
    async fn completed_step_outside_plan_invalidates_journal() {
        let _guard = LauncherDirGuard::acquire("install_journal_plan").await;
        write_journal(
            "Cordelia",
            &journal("Cordelia", "fp1", &["install.java", "install.unknown"]),
        )
        .await
        .unwrap();

        let completed = completed_from_journal(
            read_journal("Cordelia").await.unwrap(),
            "Cordelia",
            "fp1",
            &plan(&["install.java", "install.files"]),
        );
        assert!(completed.is_empty());
    }

    #[tokio::test]
    async fn corrupted_journal_starts_from_scratch() {
        let _guard = LauncherDirGuard::acquire("install_journal_corrupt").await;
        let path = journal_path("Cordelia").unwrap();
        tokio::fs::create_dir_all(path.parent().unwrap())
            .await
            .unwrap();
        tokio::fs::write(&path, "{ not json").await.unwrap();

        assert!(read_journal("Cordelia").await.unwrap().is_none());
        assert!(completed_from_journal(
            read_journal("Cordelia").await.unwrap(),
            "Cordelia",
            "fp1",
            &plan(&["install.java"]),
        )
        .is_empty());
    }

    #[tokio::test]
    async fn record_after_fingerprint_change_replaces_journal() {
        let _guard = LauncherDirGuard::acquire("install_journal_switch").await;
        record_step("Cordelia", "fp1", "install.java")
            .await
            .unwrap();
        record_step("Cordelia", "fp2", "install.files")
            .await
            .unwrap();

        let stored = read_journal("Cordelia").await.unwrap().unwrap();
        assert_eq!(stored.fingerprint, "fp2");
        assert_eq!(stored.completed, vec!["install.files"]);
    }

    #[tokio::test]
    async fn clear_removes_journal_file() {
        let _guard = LauncherDirGuard::acquire("install_journal_clear").await;
        record_step("Cordelia", "fp1", "install.java")
            .await
            .unwrap();
        assert!(read_journal("Cordelia").await.unwrap().is_some());

        clear_journal("Cordelia").await.unwrap();

        assert!(read_journal("Cordelia").await.unwrap().is_none());
        clear_journal("Cordelia").await.unwrap();
    }

    #[test]
    fn journal_path_rejects_unsafe_project_names() {
        assert!(journal_path("../evil").is_err());
        assert!(journal_path("/abs").is_err());
        assert!(journal_path("Cordelia").is_ok());
    }
}
