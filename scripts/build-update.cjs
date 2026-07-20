const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const tauriConf = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../src-tauri/tauri.conf.json"), "utf-8")
);
const version = tauriConf.version;
const productName = tauriConf.productName;

const platform = process.platform;
const archMapping = {
  x64: "x86_64",
  arm64: "aarch64",
  ia32: "x86",
  arm: "armv7l",
};
const arch = archMapping[process.arch] || process.arch;

let osName;
let binaryName;
let zipName;

if (platform === "win32") {
  osName = "windows";
  binaryName = `${productName}.exe`;
  zipName = `limacina-${version}-windows-${arch}.zip`;
} else if (platform === "darwin") {
  osName = "osx";
  binaryName = `${productName}.app`;
  zipName = `limacina-${version}-osx-${arch}.zip`;
} else {
  osName = "linux";
  binaryName = productName;
  zipName = `limacina-${version}-linux-${arch}.zip`;
}

const targetDir = path.join(__dirname, "../target/release");
const distDir = path.join(__dirname, "../dist");
const zipPath = path.join(distDir, zipName);

let sourcePath;
if (platform === "darwin") {
  sourcePath = path.join(targetDir, `bundle/macos/${binaryName}`);
} else {
  sourcePath = path.join(targetDir, binaryName);
}

if (!fs.existsSync(sourcePath)) {
  console.error(`Бинарник не найден: ${sourcePath}`);
  process.exit(1);
}

fs.mkdirSync(distDir, { recursive: true });

if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

console.log(`Сборка обновления v${version} (${osName}/${arch})...`);
console.log(`Источник: ${sourcePath}`);
console.log(`ZIP: ${zipPath}`);

try {
  if (platform === "win32") {
    const psScript = `Compress-Archive -Path "${sourcePath}" -DestinationPath "${zipPath}" -Force`;
    execSync(`powershell -NoProfile -Command "${psScript}"`, { stdio: "inherit" });
  } else {
    const zipDir = path.dirname(sourcePath);
    const zipBase = path.basename(sourcePath);
    execSync(`cd "${zipDir}" && zip -r "${zipPath}" "${zipBase}"`, { stdio: "inherit" });
  }
  console.log(`\nГотово: ${zipPath}`);
} catch (e) {
  console.error("Ошибка создания ZIP:", e.message);
  process.exit(1);
}
