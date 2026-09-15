use std::path::PathBuf;

use crate::utils::errors::LauncherError;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tokio::fs;
use tokio::sync::Mutex;

use crate::log_info;
use crate::state::config::load_config_or_default;
use crate::state::dto::GlobalState;
use crate::utils::env_info::launcher_path;
use crate::utils::tauri_err::CommandResult;

pub const SETTINGS_DIR_NAME: &str = "settings";
pub const GLOBAL_OPTIONS_FILE: &str = "game_options.json";
pub const OPTIONS_FILE: &str = "options.txt";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct GameOptions {
    pub fov: f64,
    pub gamma: f64,
    pub render_distance: u32,
    pub simulation_distance: u32,
    pub max_fps: u32,
    pub enable_vsync: bool,
    pub graphics_mode: u32,
    pub mipmap_levels: u32,
    pub particles: u32,
    pub entity_shadows: bool,
    pub ao: bool,
    pub render_clouds: String,
    pub fullscreen: bool,
    pub gui_scale: u32,
    pub sound_master: f64,
    pub sound_music: f64,
    pub sound_record: f64,
    pub sound_weather: f64,
    pub sound_block: f64,
    pub sound_hostile: f64,
    pub sound_neutral: f64,
    pub sound_player: f64,
    pub sound_ambient: f64,
    pub sound_voice: f64,
    pub chat_scale: f64,
    pub chat_width: f64,
    pub chat_opacity: f64,
    pub chat_line_spacing: f64,
    pub chat_delay: f64,
    pub text_background_opacity: f64,
    pub chat_visibility: String,
    pub chat_colors: bool,
    pub chat_links: bool,
    pub chat_links_prompt: bool,
    pub resource_packs: Vec<String>,
}

impl Default for GameOptions {
    fn default() -> Self {
        Self {
            fov: 70.0,
            gamma: 0.5,
            render_distance: 12,
            simulation_distance: 12,
            max_fps: 120,
            enable_vsync: true,
            graphics_mode: 1,
            mipmap_levels: 4,
            particles: 0,
            entity_shadows: true,
            ao: true,
            render_clouds: "true".to_string(),
            fullscreen: false,
            gui_scale: 0,
            sound_master: 1.0,
            sound_music: 1.0,
            sound_record: 1.0,
            sound_weather: 1.0,
            sound_block: 1.0,
            sound_hostile: 1.0,
            sound_neutral: 1.0,
            sound_player: 1.0,
            sound_ambient: 1.0,
            sound_voice: 1.0,
            chat_scale: 1.0,
            chat_width: 1.0,
            chat_opacity: 1.0,
            chat_line_spacing: 0.0,
            chat_delay: 0.0,
            text_background_opacity: 0.5,
            chat_visibility: "full".to_string(),
            chat_colors: true,
            chat_links: true,
            chat_links_prompt: true,
            resource_packs: Vec::new(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameOptionsData {
    pub options: GameOptions,
    pub file_exists: bool,
    pub available_resource_packs: Vec<String>,
    pub has_global: bool,
}

fn options_file_path(project_name: &str) -> Result<PathBuf> {
    Ok(launcher_path(Some(project_name))?.join(OPTIONS_FILE))
}

fn global_options_file_path() -> Result<PathBuf> {
    Ok(launcher_path(None)?
        .join(SETTINGS_DIR_NAME)
        .join(GLOBAL_OPTIONS_FILE))
}

fn format_bool(value: bool) -> String {
    if value { "true" } else { "false" }.to_string()
}

fn parse_bool(raw: &str, fallback: bool) -> bool {
    match raw {
        "true" => true,
        "false" => false,
        _ => fallback,
    }
}

fn parse_f64(raw: &str, fallback: f64) -> f64 {
    raw.trim()
        .parse::<f64>()
        .ok()
        .filter(|v| v.is_finite())
        .unwrap_or(fallback)
}

fn parse_u32(raw: &str, fallback: u32) -> u32 {
    raw.trim().parse::<u32>().unwrap_or(fallback)
}

fn owned_values(options: &GameOptions) -> Vec<(&'static str, String)> {
    let mut packs = vec!["vanilla".to_string()];
    packs.extend(
        options
            .resource_packs
            .iter()
            .filter(|p| p.as_str() != "vanilla")
            .cloned(),
    );
    let resource_packs = serde_json::to_string(&packs).unwrap_or_else(|_| "[\"vanilla\"]".into());
    vec![
        ("fov", options.fov.to_string()),
        ("gamma", options.gamma.to_string()),
        ("renderDistance", options.render_distance.to_string()),
        (
            "simulationDistance",
            options.simulation_distance.to_string(),
        ),
        ("maxFps", options.max_fps.to_string()),
        ("enableVsync", format_bool(options.enable_vsync)),
        ("graphicsMode", options.graphics_mode.to_string()),
        ("mipmapLevels", options.mipmap_levels.to_string()),
        ("particles", options.particles.to_string()),
        ("entityShadows", format_bool(options.entity_shadows)),
        ("ao", format_bool(options.ao)),
        ("renderClouds", options.render_clouds.clone()),
        ("fullscreen", format_bool(options.fullscreen)),
        ("guiScale", options.gui_scale.to_string()),
        ("soundCategory_master", options.sound_master.to_string()),
        ("soundCategory_music", options.sound_music.to_string()),
        ("soundCategory_record", options.sound_record.to_string()),
        ("soundCategory_weather", options.sound_weather.to_string()),
        ("soundCategory_block", options.sound_block.to_string()),
        ("soundCategory_hostile", options.sound_hostile.to_string()),
        ("soundCategory_neutral", options.sound_neutral.to_string()),
        ("soundCategory_player", options.sound_player.to_string()),
        ("soundCategory_ambient", options.sound_ambient.to_string()),
        ("soundCategory_voice", options.sound_voice.to_string()),
        ("chatScale", options.chat_scale.to_string()),
        ("chatWidth", options.chat_width.to_string()),
        ("chatOpacity", options.chat_opacity.to_string()),
        ("chatLineSpacing", options.chat_line_spacing.to_string()),
        ("chatDelay", options.chat_delay.to_string()),
        (
            "textBackgroundOpacity",
            options.text_background_opacity.to_string(),
        ),
        ("chatVisibility", options.chat_visibility.clone()),
        ("chatColors", format_bool(options.chat_colors)),
        ("chatLinks", format_bool(options.chat_links)),
        ("chatLinksPrompt", format_bool(options.chat_links_prompt)),
        ("resourcePacks", resource_packs),
    ]
}

fn apply_owned_values(lines: &mut Vec<(String, String)>, values: &[(&'static str, String)]) {
    for (key, value) in values {
        if let Some(entry) = lines.iter_mut().find(|(k, _)| k == key) {
            entry.1 = value.clone();
        } else {
            lines.push(((*key).to_string(), value.clone()));
        }
    }
}

fn serialize_lines(lines: &[(String, String)]) -> String {
    let mut out = String::new();
    for (key, value) in lines {
        out.push_str(key);
        out.push(':');
        out.push_str(value);
        out.push('\n');
    }
    out
}

fn parse_lines(content: &str) -> Vec<(String, String)> {
    content
        .lines()
        .filter_map(|line| {
            let (key, value) = line.split_once(':')?;
            Some((key.trim().to_string(), value.to_string()))
        })
        .collect()
}

fn owned_map(lines: &[(String, String)]) -> std::collections::HashMap<&str, &str> {
    lines
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect()
}

pub fn parse_options(content: &str) -> GameOptions {
    let defaults = GameOptions::default();
    let lines = parse_lines(content);
    let map = owned_map(&lines);

    let get = |key: &str| -> Option<&str> { map.get(key).copied() };

    let mut options = GameOptions {
        fov: get("fov").map_or(defaults.fov, |v| parse_f64(v, defaults.fov)),
        gamma: get("gamma").map_or(defaults.gamma, |v| parse_f64(v, defaults.gamma)),
        render_distance: get("renderDistance").map_or(defaults.render_distance, |v| {
            parse_u32(v, defaults.render_distance)
        }),
        simulation_distance: get("simulationDistance").map_or(defaults.simulation_distance, |v| {
            parse_u32(v, defaults.simulation_distance)
        }),
        max_fps: get("maxFps").map_or(defaults.max_fps, |v| parse_u32(v, defaults.max_fps)),
        enable_vsync: get("enableVsync").map_or(defaults.enable_vsync, |v| {
            parse_bool(v, defaults.enable_vsync)
        }),
        graphics_mode: get("graphicsMode").map_or(defaults.graphics_mode, |v| {
            parse_u32(v, defaults.graphics_mode)
        }),
        mipmap_levels: get("mipmapLevels").map_or(defaults.mipmap_levels, |v| {
            parse_u32(v, defaults.mipmap_levels)
        }),
        particles: get("particles")
            .map_or(defaults.particles, |v| parse_u32(v, defaults.particles)),
        entity_shadows: get("entityShadows").map_or(defaults.entity_shadows, |v| {
            parse_bool(v, defaults.entity_shadows)
        }),
        ao: get("ao").map_or(defaults.ao, |v| parse_bool(v, defaults.ao)),
        render_clouds: get("renderClouds").map_or(defaults.render_clouds.clone(), str::to_string),
        fullscreen: get("fullscreen")
            .map_or(defaults.fullscreen, |v| parse_bool(v, defaults.fullscreen)),
        gui_scale: get("guiScale").map_or(defaults.gui_scale, |v| parse_u32(v, defaults.gui_scale)),
        sound_master: get("soundCategory_master").map_or(defaults.sound_master, |v| {
            parse_f64(v, defaults.sound_master)
        }),
        sound_music: get("soundCategory_music")
            .map_or(defaults.sound_music, |v| parse_f64(v, defaults.sound_music)),
        sound_record: get("soundCategory_record").map_or(defaults.sound_record, |v| {
            parse_f64(v, defaults.sound_record)
        }),
        sound_weather: get("soundCategory_weather").map_or(defaults.sound_weather, |v| {
            parse_f64(v, defaults.sound_weather)
        }),
        sound_block: get("soundCategory_block")
            .map_or(defaults.sound_block, |v| parse_f64(v, defaults.sound_block)),
        sound_hostile: get("soundCategory_hostile").map_or(defaults.sound_hostile, |v| {
            parse_f64(v, defaults.sound_hostile)
        }),
        sound_neutral: get("soundCategory_neutral").map_or(defaults.sound_neutral, |v| {
            parse_f64(v, defaults.sound_neutral)
        }),
        sound_player: get("soundCategory_player").map_or(defaults.sound_player, |v| {
            parse_f64(v, defaults.sound_player)
        }),
        sound_ambient: get("soundCategory_ambient").map_or(defaults.sound_ambient, |v| {
            parse_f64(v, defaults.sound_ambient)
        }),
        sound_voice: get("soundCategory_voice")
            .map_or(defaults.sound_voice, |v| parse_f64(v, defaults.sound_voice)),
        chat_scale: get("chatScale")
            .map_or(defaults.chat_scale, |v| parse_f64(v, defaults.chat_scale)),
        chat_width: get("chatWidth")
            .map_or(defaults.chat_width, |v| parse_f64(v, defaults.chat_width)),
        chat_opacity: get("chatOpacity").map_or(defaults.chat_opacity, |v| {
            parse_f64(v, defaults.chat_opacity)
        }),
        chat_line_spacing: get("chatLineSpacing").map_or(defaults.chat_line_spacing, |v| {
            parse_f64(v, defaults.chat_line_spacing)
        }),
        chat_delay: get("chatDelay")
            .map_or(defaults.chat_delay, |v| parse_f64(v, defaults.chat_delay)),
        text_background_opacity: get("textBackgroundOpacity")
            .map_or(defaults.text_background_opacity, |v| {
                parse_f64(v, defaults.text_background_opacity)
            }),
        chat_visibility: get("chatVisibility")
            .map_or(defaults.chat_visibility.clone(), str::to_string),
        chat_colors: get("chatColors").map_or(defaults.chat_colors, |v| {
            parse_bool(v, defaults.chat_colors)
        }),
        chat_links: get("chatLinks")
            .map_or(defaults.chat_links, |v| parse_bool(v, defaults.chat_links)),
        chat_links_prompt: get("chatLinksPrompt").map_or(defaults.chat_links_prompt, |v| {
            parse_bool(v, defaults.chat_links_prompt)
        }),
        resource_packs: get("resourcePacks").map_or(defaults.resource_packs.clone(), |v| {
            serde_json::from_str::<Vec<String>>(v).unwrap_or(defaults.resource_packs.clone())
        }),
    };

    options.resource_packs.retain(|p| p != "vanilla");
    options
}

pub fn merge_options(content: Option<&str>, options: &GameOptions, mc_version: &str) -> String {
    let mut lines = content.map(parse_lines).unwrap_or_default();
    let mut values = owned_values(options);

    if content.is_none() {
        values.push(("version", mc_version.to_string()));
    }

    apply_owned_values(&mut lines, &values);
    serialize_lines(&lines)
}

async fn read_options_content(path: &PathBuf) -> Result<Option<String>> {
    match fs::read_to_string(path).await {
        Ok(content) => Ok(Some(content)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e).with_context(|| format!("Не удалось прочитать {:?}", path)),
    }
}

async fn list_resource_packs(project_name: &str) -> Result<Vec<String>> {
    let dir = launcher_path(Some(project_name))?.join("resourcepacks");
    let mut packs = Vec::new();
    let mut entries = match fs::read_dir(&dir).await {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(packs),
        Err(e) => {
            return LauncherError::classify(
                Err(e).with_context(|| format!("Не удалось прочитать {:?}", dir)),
                LauncherError::DiskIo,
            );
        }
    };
    while let Some(entry) = LauncherError::classify(
        entries
            .next_entry()
            .await
            .context("Не удалось прочитать запись в папке ресурсных пакетов"),
        LauncherError::DiskIo,
    )? {
        let path = entry.path();
        if path.is_file() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                packs.push(name.to_string());
            }
        }
    }
    packs.sort();
    Ok(packs)
}

async fn global_options_content() -> Result<Option<String>> {
    let path = global_options_file_path()?;
    read_options_content(&path).await
}

async fn resolve_mc_version(
    state: &tauri::State<'_, Mutex<GlobalState>>,
    project_name: &str,
) -> String {
    {
        let guard = state.lock().await;
        if guard.project_config.project_name == project_name
            && !guard.project_config.mc_version.is_empty()
        {
            return guard.project_config.mc_version.clone();
        }
    }
    load_config_or_default(project_name)
        .await
        .map(|c| c.mc_version)
        .unwrap_or_default()
}

#[tauri::command]
pub async fn get_game_options(project_name: String) -> CommandResult<GameOptionsData> {
    Ok(get_game_options_inner(&project_name).await?)
}

async fn get_game_options_inner(project_name: &str) -> Result<GameOptionsData> {
    let path = options_file_path(project_name)?;
    let content = read_options_content(&path).await?;
    let file_exists = content.is_some();
    let options = content.as_deref().map(parse_options).unwrap_or_default();
    let available_resource_packs = list_resource_packs(project_name).await?;
    let has_global = global_options_content().await?.is_some();

    Ok(GameOptionsData {
        options,
        file_exists,
        available_resource_packs,
        has_global,
    })
}

#[tauri::command]
pub async fn save_game_options(
    state: tauri::State<'_, Mutex<GlobalState>>,
    project_name: String,
    options: GameOptions,
) -> CommandResult<()> {
    save_game_options_inner(&state, &project_name, &options).await?;
    Ok(())
}

async fn save_game_options_inner(
    state: &tauri::State<'_, Mutex<GlobalState>>,
    project_name: &str,
    options: &GameOptions,
) -> Result<()> {
    if project_name.trim().is_empty() {
        anyhow::bail!(LauncherError::ProjectNotSelected);
    }
    let path = options_file_path(project_name)?;
    let content = read_options_content(&path).await?;
    let mc_version = resolve_mc_version(state, project_name).await;
    let merged = merge_options(content.as_deref(), options, &mc_version);

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .await
            .with_context(|| format!("Не удалось создать папку {:?}", parent))?;
    }
    fs::write(&path, merged)
        .await
        .with_context(|| format!("Не удалось записать {:?}", path))?;

    log_info!(
        "[game-options] Настройки игры проекта {} сохранены",
        project_name
    );
    Ok(())
}

#[tauri::command]
pub async fn save_global_game_options(options: GameOptions) -> CommandResult<()> {
    save_global_game_options_inner(&options).await?;
    Ok(())
}

async fn save_global_game_options_inner(options: &GameOptions) -> Result<()> {
    let result = async {
        let path = global_options_file_path()?;
        let dir = path
            .parent()
            .ok_or_else(|| anyhow::anyhow!("Не определена папка настроек лаунчера"))?;
        fs::create_dir_all(dir)
            .await
            .with_context(|| format!("Не удалось создать папку {:?}", dir))?;
        let content =
            serde_json::to_string_pretty(options).context("Не удалось сериализовать настройки")?;
        fs::write(&path, content)
            .await
            .with_context(|| format!("Не удалось записать {:?}", path))?;

        log_info!("[game-options] Общие настройки игры сохранены");
        Ok(())
    }
    .await;

    LauncherError::classify(result, LauncherError::GameOptions)
}

#[tauri::command]
pub async fn import_global_game_options() -> CommandResult<Option<GameOptions>> {
    Ok(import_global_game_options_inner().await?)
}

async fn import_global_game_options_inner() -> Result<Option<GameOptions>> {
    let content = global_options_content().await?;
    match content {
        Some(content) => {
            let options = LauncherError::classify(
                serde_json::from_str::<GameOptions>(&content)
                    .context("Повреждён файл общих настроек игры"),
                LauncherError::GameOptions,
            )?;
            Ok(Some(options))
        }
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::{merge_options, parse_options};

    #[test]
    fn merge_replaces_owned_keys_and_keeps_others() {
        let existing = "version:3955\nfov:90.0\nmouseSensitivity:0.5\nlang:ru_ru\n";
        let options = super::GameOptions {
            fov: 110.0,
            gamma: 1.0,
            ..super::GameOptions::default()
        };

        let merged = merge_options(Some(existing), &options, "1.20.1");

        assert!(merged.contains("fov:110"));
        assert!(merged.contains("gamma:1"));
        assert!(merged.contains("mouseSensitivity:0.5"));
        assert!(merged.contains("lang:ru_ru"));
        let version_line = merged
            .lines()
            .find(|l| l.starts_with("version:"))
            .expect("version сохранён");
        assert_eq!(version_line, "version:3955");
        assert_eq!(
            merged.lines().next().expect("порядок сохранён"),
            "version:3955"
        );
    }

    #[test]
    fn merge_into_missing_file_writes_version() {
        let options = super::GameOptions::default();
        let merged = merge_options(None, &options, "1.20.1");

        assert!(merged.contains("version:1.20.1"));
        assert!(merged.contains("fov:70"));
        assert!(merged.contains("enableVsync:true"));
    }

    #[test]
    fn merge_appends_missing_owned_keys() {
        let existing = "version:3955\nmouseSensitivity:0.5\n";
        let options = super::GameOptions::default();

        let merged = merge_options(Some(existing), &options, "1.20.1");

        assert!(merged.contains("mouseSensitivity:0.5"));
        assert!(merged.contains("renderDistance:12"));
        assert!(!merged.contains("version:1.20.1"));
    }

    #[test]
    fn parse_reads_owned_keys_and_defaults_rest() {
        let content = "version:3955\nfov:90.0\ngamma:1.0\nrenderDistance:8\nsoundCategory_master:0.25\nchatVisibility:system\nresourcePacks:[\"vanilla\",\"file/Test.zip\"]\n";
        let options = parse_options(content);

        assert_eq!(options.fov, 90.0);
        assert_eq!(options.gamma, 1.0);
        assert_eq!(options.render_distance, 8);
        assert_eq!(options.sound_master, 0.25);
        assert_eq!(options.chat_visibility, "system");
        assert_eq!(options.resource_packs, vec!["file/Test.zip".to_string()]);
        assert_eq!(options.max_fps, 120);
        assert!(options.enable_vsync);
    }

    #[test]
    fn parse_survives_corrupt_values() {
        let content = "fov:broken\ngamma:NaN\nrenderDistance:-5\nresourcePacks:not-json\n";
        let options = parse_options(content);

        assert_eq!(options.fov, 70.0);
        assert_eq!(options.gamma, 0.5);
        assert_eq!(options.render_distance, 12);
        assert!(options.resource_packs.is_empty());
    }

    #[test]
    fn merge_parse_roundtrip() {
        let options = super::GameOptions {
            fov: 80.0,
            gamma: 0.8,
            particles: 2,
            chat_colors: false,
            resource_packs: vec!["file/Pack.zip".to_string()],
            ..super::GameOptions::default()
        };
        let merged = merge_options(None, &options, "1.20.1");
        let parsed = parse_options(&merged);

        assert_eq!(parsed.fov, 80.0);
        assert_eq!(parsed.gamma, 0.8);
        assert_eq!(parsed.particles, 2);
        assert!(!parsed.chat_colors);
        assert_eq!(parsed.resource_packs, vec!["file/Pack.zip".to_string()]);
    }
}
