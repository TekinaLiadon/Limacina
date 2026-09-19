import { describe, expect, it } from "bun:test";
import {
  defaultKeyPath,
  minisignKeyLine,
  pubkeyMatches,
  resolveSigningKeyPath,
  signingEnv,
} from "./build-dist.cjs";

const KEY_LINE = "RWSBdATuUdvd4wLpTTfZV+8vW59Y/KHXxa9DEE7YTIjt/XpdFjF8l/HX";
const OTHER_KEY_LINE = "RWSBdG90aGVyS2V5TGluZVZhbHVlRm9yVGVzdDEyMzQ1Njc4OTA";
const COMMENT = "untrusted comment: minisign public key: E3DDDB51EE047481";
const PLAIN_PUB = `${COMMENT}\n${KEY_LINE}\n`;
const WRAPPED_PUB = Buffer.from(PLAIN_PUB).toString("base64");

describe("defaultKeyPath", () => {
  it("указывает на ~/.tauri/limacina.key", () => {
    expect(defaultKeyPath("/home/u")).toBe("/home/u/.tauri/limacina.key");
  });
});

describe("resolveSigningKeyPath", () => {
  it("берёт путь из переменной окружения", () => {
    const result = resolveSigningKeyPath(
      { TAURI_SIGNING_PRIVATE_KEY: "  /tmp/k.key  " },
      "/home/u",
    );
    expect(result.keyPath).toBe("/tmp/k.key");
    expect(result.fromEnv).toBe(true);
  });

  it("без переменной окружения берёт ключ из ~/.tauri", () => {
    const result = resolveSigningKeyPath({}, "/home/u");
    expect(result.keyPath).toBe("/home/u/.tauri/limacina.key");
    expect(result.fromEnv).toBe(false);
  });

  it("пустая переменная окружения считается отсутствующей", () => {
    const result = resolveSigningKeyPath(
      { TAURI_SIGNING_PRIVATE_KEY: "   " },
      "/home/u",
    );
    expect(result.fromEnv).toBe(false);
  });
});

describe("signingEnv", () => {
  it("подставляет ключ и пустой пароль", () => {
    const env = signingEnv({ PATH: "/bin" }, "/home/u/.tauri/limacina.key");
    expect(env.TAURI_SIGNING_PRIVATE_KEY).toBe("/home/u/.tauri/limacina.key");
    expect(env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD).toBe("");
    expect(env.PATH).toBe("/bin");
  });

  it("сохраняет пароль из окружения", () => {
    const env = signingEnv(
      { TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "secret" },
      "/k",
    );
    expect(env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD).toBe("secret");
  });
});

describe("minisignKeyLine", () => {
  it("читает стандартный двухстрочный файл", () => {
    expect(minisignKeyLine(PLAIN_PUB)).toBe(KEY_LINE);
  });

  it("читает base64-обёртку всего файла", () => {
    expect(minisignKeyLine(WRAPPED_PUB)).toBe(KEY_LINE);
  });

  it("оставляет одиночную строку ключа как есть", () => {
    expect(minisignKeyLine(KEY_LINE)).toBe(KEY_LINE);
  });

  it("пустое содержимое не даёт ключа", () => {
    expect(minisignKeyLine("  \n  ")).toBeNull();
  });
});

describe("pubkeyMatches", () => {
  it("сверяет blob из tauri.conf.json со стандартным файлом", () => {
    expect(pubkeyMatches(WRAPPED_PUB, PLAIN_PUB)).toBe(true);
  });

  it("сверяет blob из tauri.conf.json с base64-обёрткой файла", () => {
    expect(pubkeyMatches(WRAPPED_PUB, `${WRAPPED_PUB}\n`)).toBe(true);
  });

  it("сверяет многострочный pubkey из конфига с файлом", () => {
    expect(pubkeyMatches(PLAIN_PUB, PLAIN_PUB)).toBe(true);
  });

  it("разные ключи не совпадают", () => {
    const otherPub = `${COMMENT}\n${OTHER_KEY_LINE}\n`;
    const otherWrapped = Buffer.from(otherPub).toString("base64");
    expect(pubkeyMatches(WRAPPED_PUB, otherPub)).toBe(false);
    expect(pubkeyMatches(WRAPPED_PUB, otherWrapped)).toBe(false);
  });

  it("мусор в файле не совпадает с ключом", () => {
    expect(pubkeyMatches(WRAPPED_PUB, "hello")).toBe(false);
    expect(pubkeyMatches(WRAPPED_PUB, "")).toBe(false);
  });
});
