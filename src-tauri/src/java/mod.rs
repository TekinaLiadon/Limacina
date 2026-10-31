pub mod alternative_java;

use anyhow::{Context, Result};
use std::{
    cmp::Ordering,
    path::{Path, PathBuf},
};
use walkdir::WalkDir;

use crate::utils::errors::LauncherError;
use crate::{
    log_err, log_info,
    minecraft::manifest::get_manifest_version,
    minecraft::vanilla::manifest::load_vanilla_index,
    state::dto::ProjectConfig,
    step_try,
    utils::{
        blocking, compare_versions,
        download_file::download_file,
        env_info::{get_arch, get_current_os, launcher_path},
        step_events::StepHandle,
    },
};
use tokio::{
    fs::{self},
    task,
};

pub async fn install_java(config: &ProjectConfig) -> Result<(PathBuf, String)> {
    let java_version = resolve_java_version(&config.mc_version).await;
    let java_dir = launcher_path(None)?.join("java").join(&java_version);

    let check_step = StepHandle::start("java.check", "Проверка Java");
    let check_dir = java_dir.join("eclipse");
    let installed = blocking(
        "Не удалось проверить установленную Java",
        move || find_java_executable(&check_dir),
    )
    .await
    .and_then(|inner| inner)
    .ok();
    if let Some(executable_path) = installed {
        log_info!(
            "[java] Java {} уже установлена: {:?}",
            java_version,
            executable_path
        );
        check_step.finish(true);
        return Ok((executable_path, java_version));
    }
    check_step.finish(false);

    let download_step = StepHandle::start("java.download", "Скачивание Java");
    let archive_path = step_try!(
        download_step,
        download_archive(&java_dir, &java_version).await
    );
    download_step.finish(false);

    let extract_step = StepHandle::start("java.extract", "Распаковка Java");
    let executable_path = step_try!(
        extract_step,
        install_java_archive(&java_dir, &archive_path, "eclipse").await
    );
    extract_step.finish(false);

    Ok((executable_path, java_version))
}

pub(crate) fn parse_java_major(version: &str) -> Result<u32> {
    let major = version.split('.').next().unwrap_or(version);
    major.trim().parse::<u32>().map_err(|e| {
        LauncherError::Java(format!(
            "Не удалось определить мажорную версию Java: {version}: {e:#}"
        ))
        .into()
    })
}

fn adoptium_os(os: &str) -> &str {
    match os {
        "osx" => "mac",
        other => other,
    }
}

async fn download_archive(java_dir: &Path, java_version: &str) -> Result<PathBuf> {
    let os = adoptium_os(get_current_os());
    let arch = match get_arch()? {
        "x86_64" => "x64",
        other => other,
    };
    let url = format!(
        "https://api.adoptium.net/v3/binary/latest/{}/ga/{}/{}/jre/hotspot/normal/eclipse",
        java_version, os, arch
    );

    let extension = if cfg!(target_os = "windows") {
        "zip"
    } else {
        "tar.gz"
    };
    let archive_path = java_dir.join(format!("archive.{}", extension));

    remove_stale_archive(&archive_path).await?;
    download_file(&url, &archive_path).await?;
    Ok(archive_path)
}

pub(crate) async fn remove_stale_archive(archive_path: &Path) -> Result<()> {
    match fs::remove_file(archive_path).await {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e)
            .with_context(|| format!("Не удалось удалить прежний архив Java {archive_path:?}")),
    }
}

pub(crate) fn get_java_version(mc_version: &str) -> String {
    let base_version = mc_version.split('-').next().unwrap_or(mc_version);

    if compare_versions(base_version, "26.1") != Ordering::Less {
        "25".to_string()
    } else if compare_versions(base_version, "1.20.5") != Ordering::Less {
        "21".to_string()
    } else if compare_versions(base_version, "1.16.5") == Ordering::Greater {
        "17".to_string()
    } else {
        "8".to_string()
    }
}

async fn manifest_java_major(mc_version: &str) -> Option<u32> {
    let versions = load_vanilla_index().await.ok()?;
    let manifest = get_manifest_version(mc_version, versions).await.ok()?;
    manifest.java_version.map(|j| j.major_version)
}

pub(crate) async fn resolve_java_version(mc_version: &str) -> String {
    match manifest_java_major(mc_version).await {
        Some(major) => {
            log_info!(
                "[java] Для Minecraft {} по манифесту требуется Java {}",
                mc_version,
                major
            );
            major.to_string()
        }
        None => {
            let fallback = get_java_version(mc_version);
            log_info!(
                "[java] Требуемая версия Java недоступна из манифеста, для Minecraft {} выбрана Java {}",
                mc_version,
                fallback
            );
            fallback
        }
    }
}

pub(crate) async fn install_java_archive(
    java_parent: &Path,
    archive_path: &Path,
    vendor: &str,
) -> Result<PathBuf> {
    let result = install_java_archive_inner(java_parent, archive_path, vendor).await;
    if result.is_err() {
        remove_archive_best_effort(archive_path).await;
    }
    result
}

async fn install_java_archive_inner(
    java_parent: &Path,
    archive_path: &Path,
    vendor: &str,
) -> Result<PathBuf> {
    let staging_dir = java_parent.join(format!("staging_{vendor}"));
    cleanup_staging_dir(&staging_dir).await?;
    fs::create_dir_all(&staging_dir).await.with_context(|| {
        format!("Не удалось создать временную папку распаковки Java {staging_dir:?}")
    })?;

    let staging_extract = staging_dir.clone();
    let archive_extract = archive_path.to_path_buf();
    task::spawn_blocking(move || extract_archive(&archive_extract, &staging_extract))
        .await
        .context("Не удалось распаковать архив Java")??;

    let staging_for_root = staging_dir.clone();
    let source_root = task::spawn_blocking(move || staging_root(&staging_for_root))
        .await
        .context("Не удалось определить корневой каталог Java")??;

    let vendor_path = java_parent.join(vendor);
    if vendor_path.exists() {
        fs::remove_dir_all(&vendor_path).await.with_context(|| {
            format!("Не удалось удалить предыдущую установку Java {vendor_path:?}")
        })?;
    }

    fs::rename(&source_root, &vendor_path)
        .await
        .with_context(|| {
            format!("Не удалось переместить Java из {source_root:?} в {vendor_path:?}")
        })?;

    if staging_dir.exists() {
        remove_dir_best_effort(&staging_dir).await;
    }
    remove_archive_best_effort(archive_path).await;

    let find_dir = vendor_path.clone();
    let executable_path = task::spawn_blocking(move || find_java_executable(&find_dir))
        .await
        .context("Не удалось найти исполняемый файл Java")??;
    Ok(executable_path)
}

async fn cleanup_staging_dir(staging_dir: &Path) -> Result<()> {
    let cleanup = fs::remove_dir_all(staging_dir).await;
    match cleanup {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e).with_context(|| {
            format!("Не удалось удалить временную папку распаковки Java {staging_dir:?}")
        }),
    }
}

fn staging_root(staging_dir: &Path) -> Result<PathBuf> {
    let entries = std::fs::read_dir(staging_dir).with_context(|| {
        format!("Не удалось прочитать временную папку распаковки Java {staging_dir:?}")
    })?;
    let mut candidates = Vec::new();
    for entry in entries {
        let entry = entry.with_context(|| {
            format!("Не удалось прочитать временную папку распаковки Java {staging_dir:?}")
        })?;
        let path = entry.path();
        if path.is_dir() {
            candidates.push(path);
        }
    }
    candidates.sort();
    candidates.push(staging_dir.to_path_buf());

    candidates
        .iter()
        .find(|path| find_java_executable(path).is_ok())
        .cloned()
        .ok_or_else(|| {
            LauncherError::Java(format!(
                "В распакованном архиве Java не найден исполняемый файл bin/java в {staging_dir:?}"
            ))
            .into()
        })
}

async fn remove_archive_best_effort(archive_path: &Path) {
    if let Err(e) = fs::remove_file(archive_path).await {
        log_err!(
            "[java] Не удалось удалить архив Java {:?}: {e:#}",
            archive_path
        );
    }
}

async fn remove_dir_best_effort(dir: &Path) {
    if let Err(e) = fs::remove_dir_all(dir).await {
        log_err!("[java] Не удалось удалить временную папку {:?}: {e:#}", dir);
    }
}

pub fn cleanup_stale_java_staging(root: &Path) -> u64 {
    let mut removed = 0u64;
    let Ok(version_dirs) = std::fs::read_dir(root.join("java")) else {
        return removed;
    };
    for version_dir in version_dirs.filter_map(|entry| entry.ok()) {
        if !version_dir.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(version_dir.path()) else {
            continue;
        };
        for entry in entries.filter_map(|entry| entry.ok()) {
            let is_staging = entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.starts_with("staging_"))
                && entry.file_type().is_ok_and(|t| t.is_dir());
            if is_staging && std::fs::remove_dir_all(entry.path()).is_ok() {
                removed += 1;
            }
        }
    }
    removed
}

pub(crate) fn extract_archive(archive_path: &Path, target_dir: &Path) -> Result<()> {
    extract_archive_with_limit(
        archive_path,
        target_dir,
        crate::utils::zip::MAX_EXTRACT_TOTAL_BYTES,
    )
}

pub(crate) fn extract_archive_with_limit(
    archive_path: &Path,
    target_dir: &Path,
    max_total_bytes: u64,
) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        crate::utils::zip::extract_zip_with_limit(archive_path, target_dir, max_total_bytes)?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        use flate2::read::GzDecoder;
        use std::fs::File;
        use tar::Archive;

        let file = File::open(archive_path).map_err(|e| {
            LauncherError::Java(format!("Не удалось открыть архив {archive_path:?}: {e:#}"))
        })?;
        let tar = GzDecoder::new(file);
        let mut archive = Archive::new(tar);

        let mut total_bytes: u64 = 0;
        let entries = archive.entries().map_err(|e| {
            LauncherError::Java(format!(
                "Не удалось прочитать записи архива {archive_path:?}: {e:#}"
            ))
        })?;
        for entry in entries {
            let mut entry = entry.map_err(|e| {
                LauncherError::Java(format!(
                    "Не удалось прочитать запись архива {archive_path:?}: {e:#}"
                ))
            })?;
            let entry_size = entry.header().size().map_err(|e| {
                LauncherError::Java(format!(
                    "Не удалось прочитать размер записи архива {archive_path:?}: {e:#}"
                ))
            })?;
            total_bytes += entry_size;
            if total_bytes > max_total_bytes {
                return Err(LauncherError::Java(format!(
                    "Суммарный размер записей архива превышает лимит {max_total_bytes} байт"
                ))
                .into());
            }
            entry.unpack_in(target_dir).map_err(|e| {
                LauncherError::Java(format!(
                    "Не удалось распаковать запись архива {archive_path:?} в {target_dir:?}: {e:#}"
                ))
            })?;
        }
    }

    Ok(())
}

pub(crate) fn find_java_executable(base_dir: &Path) -> Result<PathBuf> {
    let target_name = if cfg!(target_os = "windows") {
        "java.exe"
    } else {
        "java"
    };

    for entry in WalkDir::new(base_dir)
        .sort_by_file_name()
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_file() && entry.file_name() == target_name {
            if let Some(parent) = entry.path().parent() {
                if parent.file_name().and_then(|n| n.to_str()) == Some("bin") {
                    return Ok(entry.into_path());
                }
            }
        }
    }
    Err(LauncherError::Java(format!(
        "Не удалось найти исполняемый файл Java (bin/java) в {base_dir:?}"
    ))
    .into())
}

#[cfg(test)]
mod tests {
    use super::{adoptium_os, get_java_version};
    use crate::minecraft::vanilla::structs::VersionDetailsManifest;

    #[cfg(not(target_os = "windows"))]
    fn write_test_tar_gz(archive_path: &std::path::Path, root: &str, entries: &[(&str, &[u8])]) {
        use flate2::write::GzEncoder;
        use flate2::Compression;
        use std::io::Write;
        use tar::{Builder, Header};

        let entry_name = |name: &str| {
            if root.is_empty() {
                name.to_string()
            } else {
                format!("{root}/{name}")
            }
        };

        let buffer = std::io::Cursor::new(Vec::new());
        let mut builder = Builder::new(buffer);

        let mut dir_header = Header::new_gnu();
        dir_header.set_size(0);
        dir_header.set_entry_type(tar::EntryType::Directory);
        dir_header.set_mode(0o755);
        dir_header.set_cksum();
        builder
            .append_data(&mut dir_header, entry_name("bin"), std::io::empty())
            .expect("добавление директории в tar");

        for (name, data) in entries {
            let mut header = Header::new_gnu();
            header.set_size(data.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder
                .append_data(&mut header, entry_name(name), *data)
                .expect("добавление записи в tar");
        }
        let tar_bytes = builder.into_inner().expect("сборка tar").into_inner();
        let mut gz = GzEncoder::new(Vec::new(), Compression::default());
        gz.write_all(&tar_bytes).expect("сжатие tar");
        let bytes = gz.finish().expect("завершение gz");
        std::fs::write(archive_path, bytes).expect("запись архива");
    }

    #[cfg(not(target_os = "windows"))]
    mod install_staging {
        use super::super::{
            find_java_executable, install_java_archive, remove_archive_best_effort,
        };
        use super::write_test_tar_gz;
        use crate::test_support::TempDir;

        #[tokio::test]
        async fn extracts_into_staging_then_moves_to_vendor_dir() {
            let dir = TempDir::new("java_stage_ok");
            let java_parent = dir.0.join("21");
            std::fs::create_dir_all(&java_parent).expect("создание папки версии Java");
            let archive_path = java_parent.join("archive.tar.gz");
            write_test_tar_gz(
                &archive_path,
                "jdk-21-test",
                &[("bin/java", &b"elf"[..]), ("release", &b"JAVA_HOME"[..])],
            );

            let exe = install_java_archive(&java_parent, &archive_path, "eclipse")
                .await
                .expect("установка Java через staging");

            assert_eq!(exe, java_parent.join("eclipse").join("bin").join("java"));
            assert_eq!(
                std::fs::read(java_parent.join("eclipse").join("release")).expect("чтение release"),
                b"JAVA_HOME"
            );
            assert!(
                !java_parent.join("staging_eclipse").exists(),
                "staging удаляется после установки"
            );
            assert!(!archive_path.exists(), "архив удаляется после установки");
        }

        #[tokio::test]
        async fn interrupted_staging_is_redone_and_never_treated_as_installed() {
            let dir = TempDir::new("java_stage_break");
            let java_parent = dir.0.join("21");
            let partial = java_parent
                .join("staging_eclipse")
                .join("jdk-21-partial")
                .join("bin");
            std::fs::create_dir_all(&partial).expect("создание частичной распаковки");
            std::fs::write(partial.join("java"), b"broken").expect("запись частичного файла");
            let foreign = java_parent.join("zulu").join("bin");
            std::fs::create_dir_all(&foreign).expect("создание чужой поставки");
            std::fs::write(foreign.join("java"), b"zulu").expect("запись java zulu");

            assert!(
                find_java_executable(&java_parent.join("eclipse")).is_err(),
                "частичная распаковка и чужие поставки не считаются установленной Java"
            );

            let archive_path = java_parent.join("archive.tar.gz");
            write_test_tar_gz(
                &archive_path,
                "jdk-21-test",
                &[("bin/java", &b"elf"[..]), ("release", &b"JAVA_HOME"[..])],
            );
            let exe = install_java_archive(&java_parent, &archive_path, "eclipse")
                .await
                .expect("повторная установка после обрыва");

            assert_eq!(exe, java_parent.join("eclipse").join("bin").join("java"));
            assert!(
                !java_parent.join("staging_eclipse").exists(),
                "staging пересоздаётся с нуля"
            );
            assert!(
                java_parent.join("zulu").join("bin").join("java").exists(),
                "чужая поставка не трогается"
            );
        }

        #[tokio::test]
        async fn distributions_of_same_major_version_resolve_to_own_trees() {
            let dir = TempDir::new("java_stage_dist");
            let java_parent = dir.0.join("17");
            for vendor in ["zulu", "temurin"] {
                let bin = java_parent.join(vendor).join("bin");
                std::fs::create_dir_all(&bin).expect("создание поставки");
                std::fs::write(bin.join("java"), b"exe").expect("запись java");
            }

            let zulu = find_java_executable(&java_parent.join("zulu")).expect("поиск zulu");
            let temurin =
                find_java_executable(&java_parent.join("temurin")).expect("поиск temurin");

            assert_eq!(zulu, java_parent.join("zulu").join("bin").join("java"));
            assert_eq!(
                temurin,
                java_parent.join("temurin").join("bin").join("java")
            );
        }

        #[tokio::test]
        async fn reinstall_replaces_existing_vendor_tree() {
            let dir = TempDir::new("java_stage_replace");
            let java_parent = dir.0.join("21");
            let broken = java_parent.join("eclipse");
            std::fs::create_dir_all(&broken).expect("создание битой установки");
            std::fs::write(broken.join("junk"), b"old").expect("запись мусора");

            let archive_path = java_parent.join("archive.tar.gz");
            write_test_tar_gz(
                &archive_path,
                "jdk-21-test",
                &[("bin/java", &b"elf"[..]), ("release", &b"JAVA_HOME"[..])],
            );
            let exe = install_java_archive(&java_parent, &archive_path, "eclipse")
                .await
                .expect("переустановка поверх битой Java");

            assert_eq!(exe, java_parent.join("eclipse").join("bin").join("java"));
            assert!(
                !broken.join("junk").exists(),
                "старое дерево не должно оставаться"
            );
        }

        #[tokio::test]
        async fn corrupt_archive_is_removed_so_retry_downloads_again() {
            let dir = TempDir::new("java_stage_corrupt");
            let java_parent = dir.0.join("21");
            std::fs::create_dir_all(&java_parent).expect("создание папки версии Java");
            let archive_path = java_parent.join("archive.tar.gz");
            write_test_tar_gz(
                &archive_path,
                "jdk-21-test",
                &[("bin/java", &b"elf"[..]), ("release", &b"JAVA_HOME"[..])],
            );
            let mut bytes = std::fs::read(&archive_path).expect("чтение архива");
            bytes.truncate(20);
            std::fs::write(&archive_path, &bytes).expect("запись обрезанного архива");

            let result = install_java_archive(&java_parent, &archive_path, "eclipse").await;

            assert!(result.is_err(), "обрезанный архив должен ломать установку");
            assert!(
                !archive_path.exists(),
                "битый архив удаляется, чтобы повторная попытка скачала его заново"
            );

            write_test_tar_gz(
                &archive_path,
                "jdk-21-test",
                &[("bin/java", &b"elf"[..]), ("release", &b"JAVA_HOME"[..])],
            );
            let exe = install_java_archive(&java_parent, &archive_path, "eclipse")
                .await
                .expect("повторная установка после перекачки");
            assert_eq!(exe, java_parent.join("eclipse").join("bin").join("java"));
        }

        #[tokio::test]
        async fn jdk_root_is_chosen_by_java_executable_not_alphabetical_order() {
            let dir = TempDir::new("java_stage_multiroot");
            let java_parent = dir.0.join("21");
            std::fs::create_dir_all(&java_parent).expect("создание папки версии Java");
            let archive_path = java_parent.join("archive.tar.gz");
            write_test_tar_gz(
                &archive_path,
                "",
                &[
                    ("aaa/bin/tool", b"tool"),
                    ("aaa/release", b"OLD"),
                    ("zzz/bin/java", b"elf"),
                    ("zzz/release", b"JAVA_HOME"),
                ],
            );

            let exe = install_java_archive(&java_parent, &archive_path, "eclipse")
                .await
                .expect("корень с bin/java должен выбираться независимо от имени");

            assert_eq!(exe, java_parent.join("eclipse").join("bin").join("java"));
            assert_eq!(
                std::fs::read(java_parent.join("eclipse").join("release")).expect("чтение release"),
                b"JAVA_HOME",
                "переносится каталог с bin/java, а не первый по алфавиту"
            );
        }

        #[tokio::test]
        async fn archive_without_java_fails_without_touching_existing_install() {
            let dir = TempDir::new("java_stage_nojava");
            let java_parent = dir.0.join("21");
            let installed = java_parent.join("eclipse").join("bin");
            std::fs::create_dir_all(&installed).expect("создание рабочей установки");
            std::fs::write(installed.join("java"), b"working").expect("запись java");

            let archive_path = java_parent.join("archive.tar.gz");
            write_test_tar_gz(
                &archive_path,
                "",
                &[("jdk/bin/readme", b"no java"), ("jdk/release", b"JDK")],
            );

            let result = install_java_archive(&java_parent, &archive_path, "eclipse").await;

            assert!(result.is_err(), "архив без bin/java не должен ставиться");
            assert_eq!(
                std::fs::read(installed.join("java")).expect("чтение рабочей Java"),
                b"working",
                "предыдущая установка не должна удаляться до проверки распаковки"
            );
            assert!(
                !archive_path.exists(),
                "неудачная установка не оставляет архив для повторного использования"
            );
        }

        #[tokio::test]
        async fn archive_removal_failure_does_not_fail_install() {
            let dir = TempDir::new("java_stage_rmfail");
            let archive_dir = dir.0.join("archive.tar.gz");
            std::fs::create_dir(&archive_dir).expect("каталог вместо файла архива");

            remove_archive_best_effort(&archive_dir).await;

            assert!(
                archive_dir.exists(),
                "best-effort удаление не должно паниковать или удалять каталог"
            );
        }
    }

    #[cfg(target_os = "windows")]
    mod install_staging {
        use super::super::install_java_archive;
        use crate::test_support::{write_test_zip, TempDir};

        #[tokio::test]
        async fn extracts_into_staging_then_moves_to_vendor_dir() {
            let dir = TempDir::new("java_stage_ok_win");
            let java_parent = dir.0.join("21");
            std::fs::create_dir_all(&java_parent).expect("создание папки версии Java");
            let archive_path = java_parent.join("archive.zip");
            write_test_zip(
                &archive_path,
                &[
                    ("jdk-21-test/bin/java", b"exe"),
                    ("jdk-21-test/release", b"JAVA_HOME"),
                ],
            );

            let exe = install_java_archive(&java_parent, &archive_path, "eclipse")
                .await
                .expect("установка Java через staging");

            assert_eq!(exe, java_parent.join("eclipse").join("bin").join("java"));
            assert!(
                !java_parent.join("staging_eclipse").exists(),
                "staging удаляется после установки"
            );
            assert!(!archive_path.exists(), "архив удаляется после установки");
        }
    }

    #[cfg(not(target_os = "windows"))]
    mod archive_limits {
        use super::super::extract_archive_with_limit;
        use super::write_test_tar_gz;
        use crate::test_support::TempDir;

        #[test]
        fn tar_extract_writes_entries_within_limit() {
            let dir = TempDir::new("ok");
            let archive_path = dir.0.join("archive.tar.gz");
            write_test_tar_gz(
                &archive_path,
                "",
                &[("bin/java", &b"elf"[..]), ("release", &b"JAVA_HOME"[..])],
            );
            let target = dir.0.join("out");
            std::fs::create_dir_all(&target).expect("создание целевой папки");

            extract_archive_with_limit(&archive_path, &target, 1 << 20)
                .expect("распаковка в лимите");

            assert_eq!(
                std::fs::read(target.join("bin").join("java")).expect("чтение java"),
                b"elf"
            );
            assert_eq!(
                std::fs::read(target.join("release")).expect("чтение release"),
                b"JAVA_HOME"
            );
        }

        #[test]
        fn tar_extract_stops_when_total_size_exceeds_limit() {
            let dir = TempDir::new("limit");
            let archive_path = dir.0.join("archive.tar.gz");
            write_test_tar_gz(
                &archive_path,
                "",
                &[("bin/java", &b"elf"[..]), ("release", &b"JAVA_HOME"[..])],
            );
            let target = dir.0.join("out");
            std::fs::create_dir_all(&target).expect("создание целевой папки");

            let result = extract_archive_with_limit(&archive_path, &target, 4);
            assert!(result.is_err(), "превышение лимита должно давать ошибку");
            assert!(
                !target.join("release").exists(),
                "записи сверх лимита не должны распаковываться"
            );
        }
    }

    #[test]
    fn adoptium_os_maps_internal_names_to_api_values() {
        assert_eq!(adoptium_os("osx"), "mac");
        assert_eq!(adoptium_os("windows"), "windows");
        assert_eq!(adoptium_os("linux"), "linux");
    }

    #[test]
    fn java_version_table_covers_known_minecraft_eras() {
        assert_eq!(get_java_version("1.8.9"), "8");
        assert_eq!(get_java_version("1.12.2"), "8");
        assert_eq!(get_java_version("1.16.5"), "8");
        assert_eq!(get_java_version("1.17"), "17");
        assert_eq!(get_java_version("1.18.2"), "17");
        assert_eq!(get_java_version("1.20.4"), "17");
        assert_eq!(get_java_version("1.20.5"), "21");
        assert_eq!(get_java_version("1.21.1"), "21");
        assert_eq!(get_java_version("1.21.8"), "21");
        assert_eq!(get_java_version("26.1"), "25");
        assert_eq!(get_java_version("26.2"), "25");
    }

    #[test]
    fn manifest_java_version_is_parsed() {
        let manifest: VersionDetailsManifest = serde_json::from_str(
            r#"{
                "id": "26.2",
                "downloads": {"client": {"sha1": "", "size": 0, "url": ""}},
                "libraries": [],
                "assetIndex": {"id": "x", "sha1": "", "size": 0, "url": "", "totalSize": 0},
                "assets": "x",
                "mainClass": "net.minecraft.client.main.Main",
                "javaVersion": {"component": "java-runtime-epsilon", "majorVersion": 25}
            }"#,
        )
        .unwrap();

        let java_version = manifest.java_version.unwrap();
        assert_eq!(java_version.major_version, 25);
        assert_eq!(java_version.component, "java-runtime-epsilon");
    }

    #[test]
    fn manifest_without_java_version_defaults_to_none() {
        let manifest: VersionDetailsManifest = serde_json::from_str(
            r#"{
                "id": "1.0",
                "downloads": {"client": {"sha1": "", "size": 0, "url": ""}},
                "libraries": [],
                "assetIndex": {"id": "x", "sha1": "", "size": 0, "url": "", "totalSize": 0},
                "assets": "x",
                "mainClass": "net.minecraft.client.main.Main"
            }"#,
        )
        .unwrap();

        assert!(manifest.java_version.is_none());
    }
}
