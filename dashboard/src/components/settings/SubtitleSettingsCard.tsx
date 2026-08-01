"use client";

import { useState } from "react";
import { type Settings } from "@/lib/api";
import { ChatCenteredText } from "@phosphor-icons/react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import { SettingRow, SectionSaveButton, SecretInput } from "@/components/settings/shared";

interface SubtitleSettings {
  enabled?: boolean;
  auto_download?: boolean;
  translate?: boolean;
  target_languages?: string[];
  tmdb_api_key?: string;
  opensubtitles_api_key?: string;
}

const fromRaw = (r?: SubtitleSettings) => ({
  enabled: r?.enabled ?? false,
  auto_download: r?.auto_download ?? false,
  translate: r?.translate ?? false,
  target_languages: (r?.target_languages ?? []).join(", "),
  tmdb_api_key: r?.tmdb_api_key ?? "",
  opensubtitles_api_key: r?.opensubtitles_api_key ?? "",
});

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function SubtitleSettingsCard({
  settings,
  onSave,
  saving,
  saved,
  error,
}: {
  settings: Settings;
  onSave: (updates: Partial<Settings>) => void;
  saving: boolean;
  saved: boolean;
  error?: string | null;
}) {
  const raw = (settings as Record<string, unknown>).subtitles as SubtitleSettings | undefined;
  const seeded = fromRaw(raw);
  const [enabled, setEnabled] = useState(seeded.enabled);
  const [autoDownload, setAutoDownload] = useState(seeded.auto_download);
  const [translate, setTranslate] = useState(seeded.translate);
  const [targetLanguages, setTargetLanguages] = useState(seeded.target_languages);
  const [tmdbApiKey, setTmdbApiKey] = useState(seeded.tmdb_api_key);
  const [opensubtitlesApiKey, setOpensubtitlesApiKey] = useState(seeded.opensubtitles_api_key);

  const current = {
    enabled,
    auto_download: autoDownload,
    translate,
    target_languages: targetLanguages,
    tmdb_api_key: tmdbApiKey,
    opensubtitles_api_key: opensubtitlesApiKey,
  };

  // Resync on refetch — but only when this card is pristine (or the refetch
  // echoes its own save), so a sibling's save can't wipe in-progress edits.
  const [prevRaw, setPrevRaw] = useState(raw);
  if (prevRaw !== raw) {
    setPrevRaw(raw);
    if (eq(current, fromRaw(prevRaw)) || eq(current, seeded)) {
      setEnabled(seeded.enabled);
      setAutoDownload(seeded.auto_download);
      setTranslate(seeded.translate);
      setTargetLanguages(seeded.target_languages);
      setTmdbApiKey(seeded.tmdb_api_key);
      setOpensubtitlesApiKey(seeded.opensubtitles_api_key);
    }
  }

  const dirty = !eq(current, seeded);

  const parsedLanguages = targetLanguages
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);

  const handleSave = () => {
    const languages = targetLanguages
      .split(",")
      .map((l) => l.trim())
      .filter(Boolean);
    // Spread the existing sub-object so fields this card doesn't edit
    // (e.g. opensubtitles_api_key) survive the save.
    onSave({
      subtitles: {
        ...raw,
        enabled,
        auto_download: autoDownload,
        translate,
        target_languages: languages,
        tmdb_api_key: tmdbApiKey,
        opensubtitles_api_key: opensubtitlesApiKey,
      },
    } as Partial<Settings>);
  };

  return (
    <Section
      title={
        <span className="inline-flex items-center gap-2">
          <ChatCenteredText className="h-4 w-4 text-subtitle" weight="bold" />
          Subtitles
        </span>
      }
      description="Automatic subtitle fetching and translation"
    >
      <div className="divide-y divide-border/50">
        <SettingRow label="Enabled" description="Enable subtitle management">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </SettingRow>

        <SettingRow label="Auto download" description="Fetch subtitles when torrents complete">
          <Switch checked={autoDownload} onCheckedChange={setAutoDownload} />
        </SettingRow>

        <SettingRow label="Translate" description="Auto-translate subtitles to target languages">
          <Switch checked={translate} onCheckedChange={setTranslate} />
        </SettingRow>

        <SettingRow label="Target languages" description="Comma-separated language codes (e.g. es, fr, de)">
          <div className="flex flex-col items-end gap-1.5">
            <Input
              value={targetLanguages}
              onChange={(e) => setTargetLanguages(e.target.value)}
              className="w-60 text-sm"
              placeholder="es, fr, de"
            />
            {parsedLanguages.length > 0 && (
              <div className="flex flex-wrap justify-end gap-1">
                {parsedLanguages.map((code) => (
                  <span
                    key={code}
                    className="rounded bg-muted px-1.5 py-0.5 font-mono text-2xs text-muted-foreground"
                  >
                    {code}
                  </span>
                ))}
              </div>
            )}
          </div>
        </SettingRow>

        <SettingRow
          label="TMDB API key"
          description={
            <>
              Used for metadata ·{" "}
              <a
                href="https://www.themoviedb.org/settings/api"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Get a key ↗
              </a>
            </>
          }
        >
          <SecretInput
            value={tmdbApiKey}
            onChange={(e) => setTmdbApiKey(e.target.value)}
            className="w-60"
            placeholder="Enter API key"
          />
        </SettingRow>

        <SettingRow
          label="OpenSubtitles API key"
          description={
            <>
              Required for subtitle search ·{" "}
              <a
                href="https://www.opensubtitles.com/consumers"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Get a key ↗
              </a>
            </>
          }
        >
          <SecretInput
            value={opensubtitlesApiKey}
            onChange={(e) => setOpensubtitlesApiKey(e.target.value)}
            className="w-60"
            placeholder="Enter API key"
          />
        </SettingRow>

        <SectionSaveButton
          onClick={handleSave}
          saving={saving}
          saved={saved}
          disabled={!dirty}
          error={error}
          accentClass="bg-subtitle text-subtitle-foreground hover:bg-subtitle/90"
        />
      </div>
    </Section>
  );
}
