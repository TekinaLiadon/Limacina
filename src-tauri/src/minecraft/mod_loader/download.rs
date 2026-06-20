use futures::future;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
// Из jvm

use ::anyhow::Result;

use crate::log_info;
use crate::minecraft::structs::LibraryMod;
use crate::minecraft::mod_loader::utils::maven_to_path;
use crate::utils::env_info::launcher_patch;
use crate::utils::semaphore::{semaphore_core, SemaphoreInfo};

pub async fn download_libraries(project_name: &str, libraries: Vec<LibraryMod>) -> Result<()> {
    let mut semaphore_info = Vec::new();
    let libraries_path = launcher_patch(Some(project_name))?.join("libraries");
    let base_path = PathBuf::from(libraries_path);

    for lib in libraries {
        let local_path = maven_to_path(&lib.name)?;
        let result = SemaphoreInfo {
            url: lib.url,
            dest: local_path,
        };

        semaphore_info.push(result);
    }

    let download_futures = semaphore_core(base_path, semaphore_info);

    let results = future::join_all(download_futures).await;
    let errors: Vec<_> = results.into_iter().filter_map(Result::err).collect();

    if errors.is_empty() {
        log_info!("Все библиотеки  успешно скачаны!");
        Ok(())
    } else {
        anyhow::bail!("Не удалось скачать {} библиотек.", errors.len())
    }
}
