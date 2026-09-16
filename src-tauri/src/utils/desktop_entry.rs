use anyhow::{anyhow, Context, Result};
use std::path::{Path, PathBuf};

pub fn sync_desktop_entry(app: &tauri::AppHandle) -> Result<()> {
    let Some(appimage) = std::env::var_os("APPIMAGE") else {
        return Ok(());
    };
    let appimage = PathBuf::from(appimage)
        .canonicalize()
        .context("Не удалось определить путь до AppImage")?;
    let appdir = std::env::var_os("APPDIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            appimage
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| PathBuf::from("."))
        });

    let identifier = app.config().identifier.clone();
    let name = app
        .config()
        .product_name
        .clone()
        .unwrap_or_else(|| identifier.clone());
    let comment = app
        .config()
        .bundle
        .short_description
        .clone()
        .unwrap_or_default();
    let exec = format_exec_line(&appimage);

    let data_home = xdg_data_home()?;
    sync_icon(&appdir, &data_home, &identifier)?;
    let entry = render_desktop_entry(&name, &comment, &exec, &identifier);

    let applications_dir = data_home.join("applications");
    std::fs::create_dir_all(&applications_dir)
        .with_context(|| format!("Не удалось создать каталог {}", applications_dir.display()))?;
    let entry_path = applications_dir.join(format!("{identifier}.desktop"));
    let unchanged = entry_path.is_file()
        && std::fs::read_to_string(&entry_path)
            .map(|content| content.contains(&exec))
            .unwrap_or(false);
    if !unchanged {
        std::fs::write(&entry_path, entry)
            .with_context(|| format!("Не удалось записать {}", entry_path.display()))?;
    }
    Ok(())
}

fn format_exec_line(appimage: &Path) -> String {
    let escaped = appimage
        .to_string_lossy()
        .replace('\\', "\\\\")
        .replace('"', "\\\"");
    format!("\"{escaped}\"")
}

fn render_desktop_entry(name: &str, comment: &str, exec: &str, icon_id: &str) -> String {
    format!(
        "[Desktop Entry]\nType=Application\nName={name}\nComment={comment}\nExec={exec}\nIcon={icon_id}\nTerminal=false\nCategories=Game;\n"
    )
}

fn xdg_data_home() -> Result<PathBuf> {
    if let Some(data_home) = std::env::var_os("XDG_DATA_HOME") {
        if !data_home.is_empty() {
            return Ok(PathBuf::from(data_home));
        }
    }
    std::env::home_dir()
        .filter(|home| !home.as_os_str().is_empty())
        .map(|home| home.join(".local").join("share"))
        .ok_or_else(|| anyhow!("Не удалось определить домашний каталог"))
}

fn sync_icon(appdir: &Path, data_home: &Path, identifier: &str) -> Result<()> {
    let icons_root = appdir.join("usr").join("share").join("icons");
    let Some(source) = find_largest_png(&icons_root) else {
        return Ok(());
    };
    let (width, height) = png_dimensions(&source).unwrap_or((256, 256));
    let icon_dir = data_home
        .join("icons")
        .join("hicolor")
        .join(format!("{width}x{height}"))
        .join("apps");
    std::fs::create_dir_all(&icon_dir)
        .with_context(|| format!("Не удалось создать каталог {}", icon_dir.display()))?;
    let target = icon_dir.join(format!("{identifier}.png"));
    std::fs::copy(&source, &target)
        .with_context(|| format!("Не удалось скопировать иконку из {}", source.display()))?;
    Ok(())
}

fn find_largest_png(root: &Path) -> Option<PathBuf> {
    let mut best: Option<(u64, PathBuf)> = None;
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("png"))
            {
                let area = png_dimensions(&path)
                    .map(|(width, height)| u64::from(width) * u64::from(height))
                    .unwrap_or(0);
                let replace = match &best {
                    None => true,
                    Some((best_area, _)) => area > *best_area,
                };
                if replace {
                    best = Some((area, path));
                }
            }
        }
    }
    best.map(|(_, path)| path)
}

fn png_dimensions(path: &Path) -> Option<(u32, u32)> {
    use std::io::Read;
    let mut file = std::fs::File::open(path).ok()?;
    let mut header = [0u8; 24];
    file.read_exact(&mut header).ok()?;
    if &header[0..8] != b"\x89PNG\r\n\x1a\n" || &header[12..16] != b"IHDR" {
        return None;
    }
    let width = u32::from_be_bytes(header[16..20].try_into().ok()?);
    let height = u32::from_be_bytes(header[20..24].try_into().ok()?);
    Some((width, height))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_fake_png(path: &Path, width: u32, height: u32) {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"\x89PNG\r\n\x1a\n");
        bytes.extend_from_slice(&13u32.to_be_bytes());
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        std::fs::write(path, bytes).unwrap();
    }

    #[test]
    fn desktop_entry_renders_required_fields() {
        let entry = render_desktop_entry(
            "Limacina",
            "Лаунчер",
            "\"/opt/Limacina.AppImage\"",
            "com.tekina.limacina",
        );
        assert!(entry.starts_with("[Desktop Entry]\n"));
        assert!(entry.contains("Name=Limacina\n"));
        assert!(entry.contains("Comment=Лаунчер\n"));
        assert!(entry.contains("Exec=\"/opt/Limacina.AppImage\"\n"));
        assert!(entry.contains("Icon=com.tekina.limacina\n"));
        assert!(entry.contains("Categories=Game;\n"));
    }

    #[test]
    fn exec_line_escapes_quotes() {
        assert_eq!(
            format_exec_line(Path::new("/a\"b\\c")),
            "\"/a\\\"b\\\\c\""
        );
    }

    #[test]
    fn png_dimensions_reads_ihdr() {
        let dir = std::env::temp_dir().join("limacina-desktop-entry-dimensions");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("2x3.png");
        write_fake_png(&path, 2, 3);
        assert_eq!(png_dimensions(&path), Some((2, 3)));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn largest_png_wins() {
        let dir = std::env::temp_dir().join("limacina-desktop-entry-icons");
        let sub = dir.join("128x128");
        std::fs::create_dir_all(&sub).unwrap();
        write_fake_png(&dir.join("small.png"), 16, 16);
        write_fake_png(&sub.join("big.png"), 256, 256);
        assert_eq!(find_largest_png(&dir), Some(sub.join("big.png")));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn largest_png_absent_without_directory() {
        assert_eq!(
            find_largest_png(&std::env::temp_dir().join("limacina-desktop-entry-missing")),
            None
        );
    }
}
