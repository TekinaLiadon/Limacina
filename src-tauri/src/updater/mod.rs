pub mod updater;
pub mod version;

pub use updater::{apply_update, cleanup_old_binaries, download_update};
pub use version::{check_for_update, UpdateInfo};
