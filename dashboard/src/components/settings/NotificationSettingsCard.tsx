"use client";

import { useState } from "react";
import { sendTestNotification, type Settings } from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { SettingRow, SectionSaveButton } from "@/components/settings/shared";

interface NotificationSettings {
  enabled?: boolean;
  torrent_completed?: boolean;
  watchlist_match?: boolean;
}

const fromRaw = (r?: NotificationSettings) => ({
  enabled: r?.enabled ?? false,
  torrent_completed: r?.torrent_completed ?? false,
  watchlist_match: r?.watchlist_match ?? false,
});

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function NotificationSettingsCard({
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
  const raw = (settings as Record<string, unknown>).notifications as NotificationSettings | undefined;
  const seeded = fromRaw(raw);
  const [enabled, setEnabled] = useState(seeded.enabled);
  const [torrentCompleted, setTorrentCompleted] = useState(seeded.torrent_completed);
  const [watchlistMatch, setWatchlistMatch] = useState(seeded.watchlist_match);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  const current = {
    enabled,
    torrent_completed: torrentCompleted,
    watchlist_match: watchlistMatch,
  };

  // Resync on refetch — but only when this card is pristine (or the refetch
  // echoes its own save), so a sibling's save can't wipe in-progress edits.
  const [prevRaw, setPrevRaw] = useState(raw);
  if (prevRaw !== raw) {
    setPrevRaw(raw);
    if (eq(current, fromRaw(prevRaw)) || eq(current, seeded)) {
      setEnabled(seeded.enabled);
      setTorrentCompleted(seeded.torrent_completed);
      setWatchlistMatch(seeded.watchlist_match);
    }
  }

  const dirty = !eq(current, seeded);

  const handleSave = () => {
    // Spread the existing sub-object so fields this card doesn't edit survive the save.
    onSave({
      notifications: {
        ...raw,
        enabled,
        torrent_completed: torrentCompleted,
        watchlist_match: watchlistMatch,
      },
    } as Partial<Settings>);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestError(null);
    try {
      await sendTestNotification();
    } catch (err) {
      setTestError((err as Error).message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <svg className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
          </svg>
          Notifications
        </span>
      }
      description="Native macOS notifications from the Fonte daemon"
    >
      <div className="divide-y divide-border/50">
        <SettingRow label="Enabled" description="Notify even when the dashboard isn't open">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </SettingRow>

        <SettingRow label="Download complete" description="When a torrent finishes downloading">
          <Switch checked={torrentCompleted} onCheckedChange={setTorrentCompleted} disabled={!enabled} />
        </SettingRow>

        <SettingRow label="Watchlist match" description="When a watched title matches a release">
          <Switch checked={watchlistMatch} onCheckedChange={setWatchlistMatch} disabled={!enabled} />
        </SettingRow>

        <SettingRow
          label="Test"
          description="Send a test notification — first use asks for macOS permission (Script Editor)"
        >
          <div className="flex items-center gap-2">
            {testError && <span className="text-2xs text-destructive">{testError}</span>}
            <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
              {testing ? "Sending..." : "Send test notification"}
            </Button>
          </div>
        </SettingRow>

        <SectionSaveButton onClick={handleSave} saving={saving} saved={saved} disabled={!dirty} error={error} />
      </div>
    </Section>
  );
}
