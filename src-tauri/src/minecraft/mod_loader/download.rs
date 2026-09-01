use futures::future;
use anyhow::Result;

use crate::log_err;
use crate::log_info;
use crate::minecraft::structs::LibraryMod;
use crate::minecraft::mod_loader::utils::maven_to_path;
use crate::utils::download_file::{download_file, verify_sha1};
use crate::utils::env_info::launcher_patch;
use crate::utils::semaphore::{semaphore_core, SemaphoreInfo};
use crate::utils::step_events::StepHandle;

pub async fn download_libraries(
    project_name: &str,
    libraries: Vec<LibraryMod>,
    step: &StepHandle,
) -> Result<usize> {
    let mut semaphore_info = Vec::new();
    let libraries_path = launcher_patch(Some(project_name))?.join("libraries");
    let base_path = libraries_path;

    for lib in &libraries {
        let local_path = maven_to_path(&lib.name)?;
        let full_path = base_path.join(&local_path);

        let up_to_date = if full_path.exists() {
            match verify_sha1(&full_path, &lib.hash).await {
                Ok(()) => true,
                Err(e) => {
                    log_err!("Библиотека не прошла проверку хеша: {}", e);
                    false
                }
            }
        } else {
            false
        };

        if up_to_date {
            continue;
        }

        let result = SemaphoreInfo {
            url: lib.url.clone(),
            dest: local_path,
        };

        semaphore_info.push(result);
    }

    let total_to_download = semaphore_info.len();
    step.set_total(total_to_download as u64);

    if total_to_download == 0 {
        log_info!("Все библиотеки уже скачаны");
        return Ok(0);
    }

    let step_counter = step.clone();
    let download_futures = semaphore_core(base_path.clone(), semaphore_info, |url, dest| async move {
        download_file(&url, &dest).await
    }, Some(move |_: &str| step_counter.inc()));

    let results = future::join_all(download_futures).await;
    let mut network_errors = 0;
    let mut hash_errors = 0;

    for res in &results {
        if let Err(e) = res {
            network_errors += 1;
            log_err!("Ошибка скачивания библиотеки: {:?}", e);
        }
    }

    let libraries_ref = &libraries;
    for lib in libraries_ref.iter() {
        if lib.hash.is_empty() {
            continue;
        }
        let path = base_path.join(maven_to_path(&lib.name)?);
        if path.exists() {
            if let Err(e) = verify_sha1(&path, &lib.hash).await {
                log_err!("Библиотека не прошла проверку хеша: {}", e);
                hash_errors += 1;
            }
        }
    }

    if network_errors == 0 && hash_errors == 0 {
        log_info!("Все библиотеки успешно скачаны!");
        Ok(total_to_download)
    } else {
        anyhow::bail!(
            "Не удалось скачать {} библиотек (ошибок сети: {}, несовпавших хешей: {})",
            network_errors + hash_errors,
            network_errors,
            hash_errors
        )
    }
}
