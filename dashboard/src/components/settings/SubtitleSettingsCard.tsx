"use client";

import { type Settings } from "@/lib/api";
import { ChatCenteredText } from "@phosphor-icons/react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import {
  SettingRow,
  SecretInput,
  useAutoSaveSection,
  useDraft,
} from "@/components/settings/shared";
import {
  parseLanguageCodes,
  subtitleSettingsFromRaw,
  type RawSubtitleSettings,
} from "@/lib/subtitle-settings";

export function SubtitleSettingsCard({
  settings,
  onSaveField,
}: {
  settings: Settings;
  onSaveField: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const raw = (settings as Record<string, unknown>).subtitles as RawSubtitleSettings | undefined;
  const s = useAutoSaveSection(subtitleSettingsFromRaw(raw), onSaveField);
  const committedLanguages = s.value("target_languages").join(", ");
  const languages = useDraft(committedLanguages, (d) => {
    const next = parseLanguageCodes(d);
    if (next.join(", ") !== committedLanguages) s.commit("target_languages", next);
  });
  const tmdbApiKey = useDraft(s.value("tmdb_api_key"), (d) => s.commit("tmdb_api_key", d));
  const opensubtitlesApiKey = useDraft(s.value("opensubtitles_api_key"), (d) =>
    s.commit("opensubtitles_api_key", d)
  );

  const parsedLanguages = parseLanguageCodes(languages.value);

  return (
    <Section
      title={
        <span className="inline-flex items-center gap-2">
          <ChatCenteredText className="size-5 text-muted-foreground" weight="bold" />
          Subtitles
        </span>
      }
      description="Automatic subtitle fetching and translation"
    >
      <div className="divide-y divide-border/50">
        <SettingRow label="Enabled" description="Enable subtitle management" status={s.statusFor("enabled")}>
          <Switch checked={s.value("enabled")} onCheckedChange={(v) => s.commit("enabled", v)} />
        </SettingRow>

        <SettingRow
          label="Auto download"
          description="Fetch subtitles when torrents complete"
          status={s.statusFor("auto_download")}
        >
          <Switch
            checked={s.value("auto_download")}
            onCheckedChange={(v) => s.commit("auto_download", v)}
          />
        </SettingRow>

        <SettingRow
          label="Translate"
          description="Auto-translate subtitles to target languages"
          status={s.statusFor("translate")}
        >
          <Switch checked={s.value("translate")} onCheckedChange={(v) => s.commit("translate", v)} />
        </SettingRow>

        <SettingRow
          label="Target languages"
          description="Comma-separated language codes (e.g. es, fr, de)"
          status={s.statusFor("target_languages")}
        >
          <div className="flex flex-col items-end gap-1.5">
            <Input {...languages} className="w-60 text-sm" placeholder="es, fr, de" />
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
          status={s.statusFor("tmdb_api_key")}
          description={
            <>
              Used for metadata.{" "}
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
          <SecretInput {...tmdbApiKey} className="w-60" placeholder="Enter API key" />
        </SettingRow>

        <SettingRow
          label="OpenSubtitles API key"
          status={s.statusFor("opensubtitles_api_key")}
          description={
            <>
              Required for subtitle search.{" "}
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
          <SecretInput {...opensubtitlesApiKey} className="w-60" placeholder="Enter API key" />
        </SettingRow>
      </div>
    </Section>
  );
}
