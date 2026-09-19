const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const CONF_PATH = path.join(__dirname, "..", "src-tauri", "tauri.conf.json");

function defaultKeyPath(homedir) {
  return path.join(homedir, ".tauri", "limacina.key");
}

function resolveSigningKeyPath(env, homedir) {
  const fromEnv =
    typeof env.TAURI_SIGNING_PRIVATE_KEY === "string"
      ? env.TAURI_SIGNING_PRIVATE_KEY.trim()
      : "";
  if (fromEnv) return { keyPath: fromEnv, fromEnv: true };
  return { keyPath: defaultKeyPath(homedir), fromEnv: false };
}

function signingEnv(env, keyPath) {
  return {
    ...env,
    TAURI_SIGNING_PRIVATE_KEY: keyPath,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD:
      env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "",
  };
}

function minisignKeyLine(content) {
  const text = String(content).trim();
  if (!text) return null;
  if (!text.includes("\n")) {
    const decoded = Buffer.from(text, "base64").toString("utf8");
    if (/\n/.test(decoded) && /^[\x20-\x7e\r\n]+$/.test(decoded)) {
      return decoded.trim().split("\n").pop();
    }
  }
  return text.split("\n").pop();
}

function confPubkeyText(pubkey) {
  const text = String(pubkey).trim();
  if (text.includes("\n")) return text;
  return Buffer.from(text, "base64").toString("utf8");
}

function pubkeyMatches(confPubkey, pubFileContent) {
  return (
    minisignKeyLine(confPubkeyText(confPubkey)) ===
    minisignKeyLine(pubFileContent)
  );
}

function readConfPubkey() {
  try {
    const conf = JSON.parse(fs.readFileSync(CONF_PATH, "utf8"));
    return conf?.plugins?.updater?.pubkey ?? null;
  } catch (e) {
    console.error(
      `Не удалось прочитать plugins.updater.pubkey из ${CONF_PATH}: ${e.message}`,
    );
    return null;
  }
}

function verifyPubkey(key) {
  const confPubkey = readConfPubkey();
  if (!confPubkey) {
    console.error("Проверка pubkey пропущена: в tauri.conf.json нет ключа");
    return;
  }
  if (!fs.existsSync(key.keyPath)) {
    console.error(
      "Проверка pubkey пропущена: TAURI_SIGNING_PRIVATE_KEY задана содержимым ключа",
    );
    return;
  }
  const pubPath = `${key.keyPath}.pub`;
  if (!fs.existsSync(pubPath)) {
    console.error(`Не найден публичный ключ ${pubPath}`);
    process.exit(1);
  }
  const pubContent = fs.readFileSync(pubPath, "utf8");
  if (!pubkeyMatches(confPubkey, pubContent)) {
    console.error(
      `Публичный ключ ${pubPath} не совпадает с plugins.updater.pubkey в src-tauri/tauri.conf.json`,
    );
    console.error(
      "Артефакт, подписанный этим ключом, лаунчеры не примут. Переложите верную пару в ~/.tauri или замените pubkey в конфиге (RELEASE.md)",
    );
    process.exit(1);
  }
  console.log(`Публичный ключ совпадает с tauri.conf.json: ${pubPath}`);
}

function main() {
  const key = resolveSigningKeyPath(process.env, os.homedir());
  if (!key.fromEnv && !fs.existsSync(key.keyPath)) {
    console.error(`Не найден ключ подписи обновлений: ${key.keyPath}`);
    console.error(
      "Сгенерируйте пару (bunx tauri signer generate) и положите limacina.key в ~/.tauri — см. RELEASE.md",
    );
    process.exit(1);
  }
  verifyPubkey(key);
  console.log(
    key.fromEnv
      ? "Ключ подписи: из переменной окружения TAURI_SIGNING_PRIVATE_KEY"
      : `Ключ подписи: ${key.keyPath}`,
  );

  if (process.argv.includes("--check")) {
    console.log(
      process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD
        ? "Пароль ключа: из окружения"
        : "Пароль ключа: пустая строка",
    );
    console.log("Окружение сборки готово (bunx tauri build)");
    return;
  }

  const child = spawn("bunx", ["tauri", "build"], {
    stdio: "inherit",
    env: signingEnv(process.env, key.keyPath),
    shell: process.platform === "win32",
  });
  child.on("error", (e) => {
    console.error(`Не удалось запустить bunx tauri build: ${e.message}`);
    process.exit(1);
  });
  child.on("exit", (code) => process.exit(code ?? 1));
}

module.exports = {
  defaultKeyPath,
  minisignKeyLine,
  pubkeyMatches,
  resolveSigningKeyPath,
  signingEnv,
};

if (require.main === module) main();
