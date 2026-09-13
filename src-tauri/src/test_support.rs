use std::path::{Path, PathBuf};

use sha1::{Digest, Sha1};

pub fn sha1_hex(data: &[u8]) -> String {
    let mut hasher = Sha1::new();
    hasher.update(data);
    crate::utils::hex::digest_hex(hasher.finalize())
}

pub static LAUNCHER_DIR_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub struct LauncherDirGuard {
    _permit: tokio::sync::MutexGuard<'static, ()>,
    root: PathBuf,
}

impl LauncherDirGuard {
    pub async fn acquire(label: &str) -> Self {
        let permit = LAUNCHER_DIR_LOCK.lock().await;
        let root =
            std::env::temp_dir().join(format!("limacina_it_{}_{}", label, std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("создание тестовой директории лаунчера");
        crate::state::launcher_config::LauncherConfig::override_resolved_launcher_path_for_tests(
            &root,
        );
        Self {
            _permit: permit,
            root,
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn project_dir(&self, project: &str) -> PathBuf {
        self.root.join("project").join(project)
    }
}

impl Drop for LauncherDirGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}
