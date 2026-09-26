// Runs via root `npm test`; imports stay relative (nothing maps "@/" outside Next).
import { describe, it, expect } from "vitest";
import { parseLanguageCodes, subtitleSettingsFromRaw } from "./subtitle-settings";

describe("subtitleSettingsFromRaw", () => {
  it("shows the defaults the daemon actually uses when keys are unset", () => {
    expect(subtitleSettingsFromRaw(undefined)).toEqual({
      enabled: false,
      auto_download: false,
      translate: true,
      target_languages: ["en"],
      tmdb_api_key: "",
      opensubtitles_api_key: "",
    });
  });

  it("keeps saved values, including an explicit empty language list", () => {
    expect(
      subtitleSettingsFromRaw({ enabled: true, translate: false, target_languages: [] })
    ).toMatchObject({ enabled: true, translate: false, target_languages: [] });
  });
});

describe("parseLanguageCodes", () => {
  it("splits on commas and whitespace, lowercases, and drops blanks and repeats", () => {
    expect(parseLanguageCodes("ES, fr,, es , pt-BR de")).toEqual(["es", "fr", "pt-br", "de"]);
  });

  it("returns an empty list for blank input", () => {
    expect(parseLanguageCodes("  ,  ")).toEqual([]);
  });
});
