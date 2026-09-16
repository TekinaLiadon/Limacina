const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const RFC_3339 =
  /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/;

function argValue(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1 || index + 1 >= argv.length) return null;
  return argv[index + 1];
}

function normalizePubDate(value) {
  const trimmed = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}T00:00:00Z`;
  return trimmed;
}

function isValidPubDate(value) {
  if (!RFC_3339.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

function matchesVersion(fileName, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\D)${escaped}(\\D|$)`).test(fileName);
}

function findArtifact(dir, extension, version) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((name) => name.endsWith(extension));
  const matched = files.filter((name) => matchesVersion(name, version)).sort();
  if (matched.length === 0) {
    console.error(`В каталоге ${dir} нет артефактов версии ${version}`);
    if (files.length > 0) {
      console.error(`Доступные файлы: ${files.sort().join(", ")}`);
    }
    console.error(
      "Пересоберите лаунчер: bunx tauri build (с TAURI_SIGNING_PRIVATE_KEY)",
    );
    process.exit(1);
  }
  return { dir, file: matched[0] };
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function buildLatest({ version, pubDate, base, artifacts }) {
  const platforms = {};
  const checksums = [];
  for (const key of Object.keys(artifacts)) {
    const artifact = artifacts[key];
    const sourcePath = path.join(artifact.dir, artifact.file);
    const signaturePath = `${sourcePath}.sig`;
    if (!fs.existsSync(signaturePath)) {
      console.error(`Подпись не найдена: ${signaturePath}`);
      process.exit(1);
    }
    const entry = {
      url: `${base}/${artifact.file}`,
      signature: fs.readFileSync(signaturePath, "utf8").trim(),
    };
    if (key === "windows") {
      platforms["windows-x86_64-nsis"] = entry;
      platforms["windows-x86_64"] = entry;
    } else {
      platforms["linux-x86_64"] = entry;
    }
    checksums.push(`${sha256(sourcePath)}  ${artifact.file}`);
    fs.copyFileSync(sourcePath, path.join(artifact.outDir, artifact.file));
    fs.copyFileSync(signaturePath, path.join(artifact.outDir, `${artifact.file}.sig`));
  }
  return { latest: { version, pub_date: pubDate, platforms }, checksums };
}

function main() {
  const argv = process.argv.slice(2);

  const urlBase = argValue(argv, "--url-base");
  if (!urlBase) {
    console.error(
      "Укажите базовый URL публикаций: --url-base https://…/downloads/limacina",
    );
    process.exit(1);
  }

  const outDir = path.resolve(
    argValue(argv, "--out") || path.join(__dirname, "../dist/release"),
  );
  const pubDateRaw = argValue(argv, "--pub-date") || new Date().toISOString();
  const platformArg = argValue(argv, "--platform") || "auto";

  const tauriConf = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../src-tauri/tauri.conf.json"), "utf-8"),
  );
  const { version } = tauriConf;

  const pubDate = normalizePubDate(pubDateRaw);
  if (!isValidPubDate(pubDate)) {
    console.error(`--pub-date должен быть в формате RFC 3339, получено: ${pubDateRaw}`);
    process.exit(1);
  }

  const bundleDir = path.join(__dirname, "../target/release/bundle");
  const available = {
    windows: findArtifact(path.join(bundleDir, "nsis"), "-setup.exe", version),
    linux: findArtifact(path.join(bundleDir, "appimage"), ".AppImage", version),
  };

  let wanted;
  if (platformArg === "auto") {
    wanted = Object.keys(available).filter((key) => available[key] !== null);
  } else {
    wanted = platformArg
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const missing = wanted.filter((key) => available[key] === null);
    if (missing.length > 0) {
      console.error(`Артефакты не найдены: ${missing.join(", ")}`);
      console.error("Соберите лаунчер: bunx tauri build (с TAURI_SIGNING_PRIVATE_KEY)");
      process.exit(1);
    }
  }

  if (wanted.length === 0) {
    console.error("Артефакты не найдены в target/release/bundle (nsis/appimage)");
    process.exit(1);
  }

  const base = urlBase.replace(/\/+$/, "");
  fs.mkdirSync(outDir, { recursive: true });
  const artifacts = {};
  for (const key of wanted) {
    artifacts[key] = { ...available[key], outDir };
  }

  const { latest, checksums } = buildLatest({ version, pubDate, base, artifacts });

  fs.writeFileSync(
    path.join(outDir, "latest.json"),
    `${JSON.stringify(latest, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(outDir, "SHA256SUMS.txt"),
    `${checksums.join("\n")}\n`,
  );

  console.log(`Версия: ${version}`);
  console.log(`Платформы: ${Object.keys(latest.platforms).join(", ")}`);
  console.log(`Готово: ${outDir} (latest.json, SHA256SUMS.txt, артефакты + .sig)`);
}

module.exports = { argValue, normalizePubDate, isValidPubDate, matchesVersion, main };

if (require.main === module) {
  main();
}
