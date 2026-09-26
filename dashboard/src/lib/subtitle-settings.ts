export interface RawSubtitleSettings {
  enabled?: boolean;
  auto_download?: boolean;
  translate?: boolean;
  target_languages?: string[];
  tmdb_api_key?: string;
  opensubtitles_api_key?: string;
}

export const subtitleSettingsFromRaw = (r?: RawSubtitleSettings) => ({
  enabled: r?.enabled ?? false,
  auto_download: r?.auto_download ?? false,
  translate: r?.translate ?? true,
  target_languages: r?.target_languages ?? ["en"],
  tmdb_api_key: r?.tmdb_api_key ?? "",
  opensubtitles_api_key: r?.opensubtitles_api_key ?? "",
});

export const parseLanguageCodes = (text: string) => [
  ...new Set(
    text
      .split(/[\s,]+/)
      .map((l) => l.toLowerCase())
      .filter(Boolean)
  ),
];
