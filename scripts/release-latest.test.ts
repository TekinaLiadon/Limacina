import { describe, expect, it } from "bun:test";
import {
  isValidPubDate,
  matchesVersion,
  normalizePubDate,
} from "./release-latest.cjs";

describe("matchesVersion", () => {
  it("принимает артефакт точной версии", () => {
    expect(matchesVersion("Limacina_0.5.0_x64-setup.exe", "0.5.0")).toBe(true);
    expect(matchesVersion("Limacina_0.5.0_amd64.AppImage", "0.5.0")).toBe(true);
  });

  it("отвергает артефакт прошлой версии", () => {
    expect(matchesVersion("Limacina_0.4.0_x64-setup.exe", "0.5.0")).toBe(false);
  });

  it("не путает 0.5.0 и 0.50.0", () => {
    expect(matchesVersion("Limacina_0.50.0_x64-setup.exe", "0.5.0")).toBe(false);
    expect(matchesVersion("Limacina_0.5.0_x64-setup.exe", "0.50.0")).toBe(false);
  });
});

describe("normalizePubDate", () => {
  it("дополняет дату временем по RFC 3339", () => {
    expect(normalizePubDate("2026-09-16")).toBe("2026-09-16T00:00:00Z");
  });

  it("оставляет полный timestamp как есть", () => {
    expect(normalizePubDate("2026-09-16T12:30:00+03:00")).toBe(
      "2026-09-16T12:30:00+03:00",
    );
  });
});

describe("isValidPubDate", () => {
  it("принимает корректные значения", () => {
    expect(isValidPubDate("2026-09-16T00:00:00Z")).toBe(true);
    expect(isValidPubDate("2026-09-16T12:30:00+03:00")).toBe(true);
  });

  it("отвергает мусор", () => {
    expect(isValidPubDate("yesterday")).toBe(false);
    expect(isValidPubDate("16.09.2026")).toBe(false);
    expect(isValidPubDate("")).toBe(false);
  });
});
