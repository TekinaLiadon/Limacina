use std::collections::BTreeMap;
use std::path::Path;

use anyhow::{bail, Context, Result};
use regex::Regex;

use crate::legacy::protocol::HReader;

pub const FILE_ENTRY: u32 = 2;
pub const DIR_ENTRY: u32 = 1;
const MD5_DIGEST_LEN: usize = 16;

#[derive(Debug, Clone, PartialEq)]
pub struct HashedFile {
    pub size: u64,
    pub digest: Option<[u8; MD5_DIGEST_LEN]>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct HashedDir {
    pub entries: BTreeMap<String, HashedEntry>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum HashedEntry {
    File(HashedFile),
    Dir(HashedDir),
}

#[derive(Debug)]
pub struct HashedDiff {
    pub mismatch: HashedDir,
    pub extra_files: Vec<String>,
    pub extra_dirs: Vec<String>,
}

impl HashedDiff {
    pub fn total_size(&self) -> u64 {
        size_of_dir(&self.mismatch)
    }
}

impl HashedDir {
    pub fn read(reader: &mut HReader) -> Result<Self> {
        let count = reader.read_varint()? as usize;
        let mut entries = BTreeMap::new();
        for _ in 0..count {
            let name = reader.read_string(255)?;
            match reader.read_varint()? {
                FILE_ENTRY => {
                    let size = reader.read_varlong()?;
                    let digest = if reader.read_bool()? {
                        let bytes = reader.read_fixed(MD5_DIGEST_LEN)?;
                        let mut digest = [0u8; MD5_DIGEST_LEN];
                        digest.copy_from_slice(bytes);
                        Some(digest)
                    } else {
                        None
                    };
                    if entries
                        .insert(name.clone(), HashedEntry::File(HashedFile { size, digest }))
                        .is_some()
                    {
                        bail!("Дублирующаяся запись в дереве: '{name}'");
                    }
                }
                DIR_ENTRY => {
                    let dir = Self::read(reader)?;
                    if entries
                        .insert(name.clone(), HashedEntry::Dir(dir))
                        .is_some()
                    {
                        bail!("Дублирующаяся запись в дереве: '{name}'");
                    }
                }
                other => bail!("Неизвестный тип записи дерева: {other}"),
            }
        }
        Ok(Self { entries })
    }

    pub fn build_local(
        dir: &Path,
        matcher: Option<&FileNameMatcher>,
        compute_digest: bool,
    ) -> Result<Self> {
        let mut root = Self {
            entries: BTreeMap::new(),
        };
        build_dir_recursive(dir, dir, matcher, compute_digest, &mut root)?;
        Ok(root)
    }

    pub fn diff(&self, local: &HashedDir, matcher: Option<&FileNameMatcher>) -> HashedDiff {
        let mut diff = HashedDiff {
            mismatch: HashedDir {
                entries: BTreeMap::new(),
            },
            extra_files: Vec::new(),
            extra_dirs: Vec::new(),
        };
        let mut segments = Vec::new();
        diff.mismatch = diff_dir_recursive(self, local, matcher, true, &mut segments, &mut diff);
        diff_dir_recursive(local, self, matcher, false, &mut segments, &mut diff);
        diff
    }
}

fn size_of_dir(dir: &HashedDir) -> u64 {
    dir.entries
        .values()
        .map(|entry| match entry {
            HashedEntry::File(file) => file.size,
            HashedEntry::Dir(sub) => size_of_dir(sub),
        })
        .sum()
}

fn build_dir_recursive(
    root: &Path,
    current: &Path,
    matcher: Option<&FileNameMatcher>,
    compute_digest: bool,
    target: &mut HashedDir,
) -> Result<()> {
    let read_dir = std::fs::read_dir(current)
        .with_context(|| format!("Не удалось прочитать папку {}", current.display()))?;
    for item in read_dir {
        let entry = item.with_context(|| format!("Чтение записи в {}", current.display()))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let metadata = std::fs::symlink_metadata(&path)
            .with_context(|| format!("Не удалось прочитать атрибуты {}", path.display()))?;
        if metadata.is_symlink() {
            bail!("Символические ссылки запрещены: {}", path.display());
        }
        if metadata.is_dir() {
            let mut sub = HashedDir {
                entries: BTreeMap::new(),
            };
            build_dir_recursive(root, &path, matcher, compute_digest, &mut sub)?;
            target.entries.insert(name, HashedEntry::Dir(sub));
            continue;
        }
        let mut segments = relative_segments(root, &path)?;
        segments.pop();
        let should_digest = compute_digest
            && matcher
                .map(|matcher| matcher.should_update(&segments))
                .unwrap_or(true);
        let digest = if should_digest {
            Some(md5_of_file(&path)?)
        } else {
            None
        };
        target.entries.insert(
            name,
            HashedEntry::File(HashedFile {
                size: metadata.len(),
                digest,
            }),
        );
    }
    Ok(())
}

pub fn relative_segments(root: &Path, path: &Path) -> Result<Vec<String>> {
    let relative = path
        .strip_prefix(root)
        .with_context(|| format!("Путь {} вне корня {}", path.display(), root.display()))?;
    Ok(relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy().into_owned())
        .collect())
}

pub fn md5_of_file(path: &Path) -> Result<[u8; MD5_DIGEST_LEN]> {
    use md5::Digest;
    let mut hasher = md5::Md5::new();
    let mut file = std::fs::File::open(path)
        .with_context(|| format!("Не удалось открыть {}", path.display()))?;
    let mut buffer = vec![0u8; 256 * 1024];
    loop {
        let read = std::io::Read::read(&mut file, &mut buffer)
            .with_context(|| format!("Не удалось вычислить MD5 {}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().into())
}

fn same_file(server: &HashedFile, local: &HashedFile) -> bool {
    server.size == local.size
        && (server.digest.is_none() || local.digest.is_none() || server.digest == local.digest)
}

fn should_update_entry(matcher: Option<&FileNameMatcher>, segments: &[String]) -> bool {
    matcher
        .map(|matcher| matcher.should_update(segments))
        .unwrap_or(true)
}

fn diff_dir_recursive(
    side: &HashedDir,
    other: &HashedDir,
    matcher: Option<&FileNameMatcher>,
    download_side: bool,
    segments: &mut Vec<String>,
    diff: &mut HashedDiff,
) -> HashedDir {
    let mut result = HashedDir {
        entries: BTreeMap::new(),
    };
    for (name, entry) in &side.entries {
        segments.push(name.clone());
        let counterpart = other.entries.get(name);
        let path = segments.join("/");
        match (entry, counterpart) {
            (_, None)
            | (HashedEntry::File(_), Some(HashedEntry::Dir(_)))
            | (HashedEntry::Dir(_), Some(HashedEntry::File(_))) => {
                if download_side {
                    if should_update_entry(matcher, segments) || counterpart.is_none() {
                        result.entries.insert(name.clone(), entry.clone());
                    }
                } else if should_update_entry(matcher, segments) {
                    match entry {
                        HashedEntry::File(_) => diff.extra_files.push(path),
                        HashedEntry::Dir(_) => diff.extra_dirs.push(path),
                    }
                }
            }
            (HashedEntry::File(server_file), Some(HashedEntry::File(local_file))) => {
                if download_side
                    && should_update_entry(matcher, segments)
                    && !same_file(server_file, local_file)
                {
                    result.entries.insert(name.clone(), entry.clone());
                }
            }
            (HashedEntry::Dir(side_dir), Some(HashedEntry::Dir(other_dir))) => {
                let sub =
                    diff_dir_recursive(side_dir, other_dir, matcher, download_side, segments, diff);
                let include = if download_side {
                    !sub.entries.is_empty()
                } else {
                    should_update_entry(matcher, segments) && !sub.entries.is_empty()
                };
                if include {
                    result.entries.insert(name.clone(), HashedEntry::Dir(sub));
                }
            }
        }
        segments.pop();
    }
    result
}

#[derive(Debug, Clone)]
pub struct FileNameMatcher {
    update: Vec<Vec<Regex>>,
    verify: Vec<Vec<Regex>>,
    exclusions: Vec<Vec<Regex>>,
}

impl FileNameMatcher {
    pub fn new(update: &[String], verify: &[String], exclusions: &[String]) -> Result<Self> {
        Ok(Self {
            update: compile_patterns(update)?,
            verify: compile_patterns(verify)?,
            exclusions: compile_patterns(exclusions)?,
        })
    }

    pub fn verify_only(&self) -> Self {
        Self {
            update: Vec::new(),
            verify: self.verify.clone(),
            exclusions: self.exclusions.clone(),
        }
    }

    pub fn should_update(&self, segments: &[String]) -> bool {
        (matches_any(&self.update, segments) || matches_any(&self.verify, segments))
            && !matches_any(&self.exclusions, segments)
    }

    #[cfg(test)]
    pub fn should_verify(&self, segments: &[String]) -> bool {
        matches_any(&self.verify, segments) && !matches_any(&self.exclusions, segments)
    }
}

fn compile_patterns(patterns: &[String]) -> Result<Vec<Vec<Regex>>> {
    let mut compiled = Vec::with_capacity(patterns.len());
    for pattern in patterns {
        let mut segments = Vec::new();
        for segment in pattern.split('/') {
            let regex = Regex::new(&format!("^(?:{segment})$"))
                .with_context(|| format!("Некорректный шаблон обновления: '{segment}'"))?;
            segments.push(regex);
        }
        compiled.push(segments);
    }
    Ok(compiled)
}

fn matches_any(patterns: &[Vec<Regex>], segments: &[String]) -> bool {
    patterns.iter().any(|pattern| {
        pattern.len() <= segments.len()
            && pattern
                .iter()
                .zip(segments.iter())
                .all(|(regex, segment)| regex.is_match(segment))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_file(path: &Path, content: &[u8]) {
        std::fs::create_dir_all(path.parent().expect("родитель")).expect("создание папки");
        std::fs::write(path, content).expect("запись файла");
    }

    fn temp_root(label: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "limacina_legacy_hashed_{label}_{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("создание корня");
        root
    }

    #[test]
    fn server_tree_round_trips_nested_dirs_and_digests() {
        let mut file_bytes: Vec<u8> = vec![
            3,
            0x04,
            b'm',
            b'o',
            b'd',
            b's',
            DIR_ENTRY as u8,
            1,
            0x05,
            b'a',
            b'.',
            b'j',
            b'a',
            b'r',
            FILE_ENTRY as u8,
            10,
            1,
        ];
        file_bytes.extend_from_slice(&[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
        file_bytes.extend_from_slice(&[
            0x05,
            b's',
            b'a',
            b'v',
            b'e',
            b's',
            DIR_ENTRY as u8,
            0,
            0x0b,
            b's',
            b'e',
            b'r',
            b'v',
            b'e',
            b'r',
            b's',
            b'.',
            b'd',
            b'a',
            b't',
            FILE_ENTRY as u8,
            42,
            0,
        ]);
        let mut reader = HReader::new(&file_bytes);
        let tree = HashedDir::read(&mut reader).expect("дерево читается");

        assert_eq!(tree.entries.len(), 3);
        match tree.entries.get("mods") {
            Some(HashedEntry::Dir(dir)) => {
                let file = match dir.entries.get("a.jar") {
                    Some(HashedEntry::File(file)) => file,
                    other => panic!("ожидался файл, найдено {other:?}"),
                };
                assert_eq!(file.size, 10);
                assert_eq!(
                    file.digest,
                    Some([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
                );
            }
            other => panic!("ожидалась папка mods, найдено {other:?}"),
        }
        match tree.entries.get("servers.dat") {
            Some(HashedEntry::File(file)) => {
                assert_eq!(file.size, 42);
                assert_eq!(file.digest, None, "без дайджеста");
            }
            other => panic!("ожидался файл servers.dat, найдено {other:?}"),
        }
    }

    #[test]
    fn read_rejects_unknown_entry_type() {
        let bytes = vec![1, 0x01, b'x', 9];
        let mut reader = HReader::new(&bytes);
        let error = HashedDir::read(&mut reader).expect_err("тип 9 неизвестен");
        assert!(error.to_string().contains("Неизвестный тип"), "{error}");
    }

    #[test]
    fn build_local_hashes_only_matched_files_with_digest() {
        let root = temp_root("digest");
        write_file(&root.join("mods/one.jar"), b"0123456789");
        write_file(&root.join("saves/world/level.dat"), b"userdata");
        let matcher = FileNameMatcher::new(&[], &["mods".to_string()], &[]).expect("матчер");

        let tree = HashedDir::build_local(&root, Some(&matcher), true).expect("локальное дерево");

        let one = match tree.entries.get("mods") {
            Some(HashedEntry::Dir(dir)) => match dir.entries.get("one.jar") {
                Some(HashedEntry::File(file)) => file,
                other => panic!("ожидался файл one.jar, найдено {other:?}"),
            },
            other => panic!("ожидалась папка mods, найдено {other:?}"),
        };
        assert_eq!(one.size, 10);
        assert!(one.digest.is_some(), "matched-файл должен получить MD5");

        let level = match tree.entries.get("saves") {
            Some(HashedEntry::Dir(worlds)) => match worlds.entries.get("world") {
                Some(HashedEntry::Dir(world)) => match world.entries.get("level.dat") {
                    Some(HashedEntry::File(file)) => file,
                    other => panic!("ожидался файл level.dat, найдено {other:?}"),
                },
                other => panic!("ожидалась папка world, найдено {other:?}"),
            },
            other => panic!("ожидалась папка saves, найдено {other:?}"),
        };
        assert_eq!(level.size, 8);
        assert!(level.digest.is_none(), "пользовательские файлы без MD5");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn fast_check_skips_digests_entirely() {
        let root = temp_root("fastcheck");
        write_file(&root.join("mods/one.jar"), b"data");
        let tree = HashedDir::build_local(&root, None, false).expect("дерево");
        let one = match tree.entries.get("mods") {
            Some(HashedEntry::Dir(mods)) => match mods.entries.get("one.jar") {
                Some(HashedEntry::File(file)) => file,
                other => panic!("ожидался файл, найдено {other:?}"),
            },
            other => panic!("ожидалась папка mods, найдено {other:?}"),
        };
        assert!(one.digest.is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn diff_downloads_new_changed_and_deletes_missing_matched_files() {
        let server = HashedDir {
            entries: BTreeMap::from([
                (
                    "minecraft.jar".into(),
                    HashedEntry::File(HashedFile {
                        size: 5,
                        digest: None,
                    }),
                ),
                (
                    "mods".into(),
                    HashedEntry::Dir(HashedDir {
                        entries: BTreeMap::from([
                            (
                                "new.jar".into(),
                                HashedEntry::File(HashedFile {
                                    size: 1,
                                    digest: None,
                                }),
                            ),
                            (
                                "changed.jar".into(),
                                HashedEntry::File(HashedFile {
                                    size: 9,
                                    digest: None,
                                }),
                            ),
                        ]),
                    }),
                ),
                (
                    "config.json".into(),
                    HashedEntry::File(HashedFile {
                        size: 2,
                        digest: None,
                    }),
                ),
            ]),
        };
        let local = HashedDir {
            entries: BTreeMap::from([
                (
                    "config.json".into(),
                    HashedEntry::File(HashedFile {
                        size: 2,
                        digest: None,
                    }),
                ),
                (
                    "mods".into(),
                    HashedEntry::Dir(HashedDir {
                        entries: BTreeMap::from([
                            (
                                "changed.jar".into(),
                                HashedEntry::File(HashedFile {
                                    size: 3,
                                    digest: None,
                                }),
                            ),
                            (
                                "old.jar".into(),
                                HashedEntry::File(HashedFile {
                                    size: 4,
                                    digest: None,
                                }),
                            ),
                        ]),
                    }),
                ),
                (
                    "userfile.txt".into(),
                    HashedEntry::File(HashedFile {
                        size: 7,
                        digest: None,
                    }),
                ),
            ]),
        };
        let matcher = FileNameMatcher::new(
            &[],
            &["minecraft\\.jar".to_string(), "mods".to_string()],
            &[],
        )
        .expect("матчер");

        let diff = server.diff(&local, Some(&matcher));

        assert!(diff.mismatch.entries.contains_key("minecraft.jar"));
        let mods = match diff.mismatch.entries.get("mods") {
            Some(HashedEntry::Dir(dir)) => dir,
            other => panic!("ожидалась папка mods, найдено {other:?}"),
        };
        assert!(mods.entries.contains_key("new.jar"), "новый файл качается");
        assert!(
            mods.entries.contains_key("changed.jar"),
            "изменённый качается"
        );
        assert!(
            !diff.mismatch.entries.contains_key("config.json"),
            "файл вне матчера с другим размером не качается"
        );

        assert_eq!(
            diff.extra_files,
            vec!["mods/old.jar".to_string()],
            "лишний matched-файл помечается на удаление"
        );
        assert!(
            diff.extra_dirs.is_empty(),
            "папки без меток не удаляются: {:?}",
            diff.extra_dirs
        );
        assert_eq!(diff.total_size(), 5 + 1 + 9);
    }

    #[test]
    fn diff_deletes_whole_dir_missing_on_server() {
        let server = HashedDir {
            entries: BTreeMap::new(),
        };
        let local = HashedDir {
            entries: BTreeMap::from([(
                "mods".into(),
                HashedEntry::Dir(HashedDir {
                    entries: BTreeMap::from([(
                        "old.jar".into(),
                        HashedEntry::File(HashedFile {
                            size: 4,
                            digest: None,
                        }),
                    )]),
                }),
            )]),
        };
        let matcher = FileNameMatcher::new(&[], &["mods".to_string()], &[]).expect("матчер");

        let diff = server.diff(&local, Some(&matcher));

        assert_eq!(diff.extra_dirs, vec!["mods".to_string()]);
        assert!(diff.extra_files.is_empty());
    }

    #[test]
    fn matcher_matches_prefix_segments_with_regex() {
        let matcher = FileNameMatcher::new(
            &["servers\\.dat".to_string()],
            &[
                "libraries".to_string(),
                "minecraft\\.jar".to_string(),
                "openloader/.cache".to_string(),
            ],
            &["openloader/.cache".to_string()],
        )
        .expect("матчер");

        let segments =
            |path: &str| -> Vec<String> { path.split('/').map(str::to_string).collect() };

        assert!(matcher.should_update(&segments("servers.dat")));
        assert!(matcher.should_update(&segments("libraries/cpw/modlauncher.jar")));
        assert!(matcher.should_update(&segments("minecraft.jar")));
        assert!(!matcher.should_update(&segments("saves/world/level.dat")));
        assert!(!matcher.should_update(&segments("notlibraries/thing.jar")));
        assert!(matcher.should_verify(&segments("libraries/x.jar")));
        assert!(
            !matcher.should_verify(&segments("servers.dat")),
            "update-путь не входит в should_verify"
        );

        let excluded = FileNameMatcher::new(
            &["openloader".to_string()],
            &[],
            &["openloader/.cache".to_string()],
        )
        .expect("матчер с исключениями");
        assert!(excluded.should_update(&segments("openloader/config.json")));
        assert!(!excluded.should_update(&segments("openloader/.cache/blob.bin")));
    }

    #[test]
    fn matcher_rejects_invalid_regex() {
        let error = FileNameMatcher::new(&["[".to_string()], &[], &[])
            .expect_err("некорректный regex должен пасть");
        assert!(error.to_string().contains("Некорректный шаблон"), "{error}");
    }

    #[test]
    fn verify_only_drops_update_patterns() {
        let matcher = FileNameMatcher::new(&["mods".to_string()], &["libraries".to_string()], &[])
            .expect("матчер")
            .verify_only();
        let segments = vec!["mods".to_string(), "x.jar".to_string()];
        assert!(!matcher.should_update(&segments));
        assert!(!matcher.should_verify(&segments), "mods не в verify");

        let libraries = vec!["libraries".to_string(), "y.jar".to_string()];
        assert!(
            matcher.should_update(&libraries),
            "verify-пути остаются в should_update"
        );
        assert!(matcher.should_verify(&libraries));
    }

    #[cfg(unix)]
    #[test]
    fn build_local_rejects_symlinks() {
        let root = temp_root("symlink");
        write_file(&root.join("real.txt"), b"x");
        std::os::unix::fs::symlink(root.join("real.txt"), root.join("link.txt"))
            .expect("создание симлинка");
        let error =
            HashedDir::build_local(&root, None, false).expect_err("симлинк должен отклоняться");
        assert!(
            error.to_string().contains("Символические ссылки"),
            "{error}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }
}
