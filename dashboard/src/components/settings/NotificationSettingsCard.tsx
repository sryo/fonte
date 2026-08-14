"use client";

import { useState } from "react";
import { sendTestNotification, type Settings } from "@/lib/api";
import { Bell } from "@phosphor-icons/react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { SettingRow, useAutoSaveSection } from "@/components/settings/shared";

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

export function NotificationSettingsCard({
  settings,
  onSaveField,
}: {
  settings: Settings;
  onSaveField: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const raw = (settings as Record<string, unknown>).notifications as NotificationSettings | undefined;
  const s = useAutoSaveSection(fromRaw(raw), onSaveField);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

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
        <span className="inline-flex items-center gap-2">
          <Bell className="h-4 w-4 text-primary" weight="bold" />
          Notifications
        </span>
      }
      description="Native macOS notifications from the Fonte daemon"
    >
      <div className="divide-y divide-border/50">
        <SettingRow
          label="Enabled"
          description="Notify even when the dashboard isn't open"
          status={s.statusFor("enabled")}
        >
          <Switch checked={s.value("enabled")} onCheckedChange={(v) => s.commit("enabled", v)} />
        </SettingRow>

        <SettingRow
          label="Download complete"
          description="When a torrent finishes downloading"
          status={s.statusFor("torrent_completed")}
        >
          <Switch
            checked={s.value("torrent_completed")}
            onCheckedChange={(v) => s.commit("torrent_completed", v)}
            disabled={!s.value("enabled")}
          />
        </SettingRow>

        <SettingRow
          label="Watchlist match"
          description="When a watched title matches a release"
          status={s.statusFor("watchlist_match")}
        >
          <Switch
            checked={s.value("watchlist_match")}
            onCheckedChange={(v) => s.commit("watchlist_match", v)}
            disabled={!s.value("enabled")}
          />
        </SettingRow>

        <SettingRow
          label="Test"
          description="Send a test notification. First use asks for macOS permission (Script Editor)"
        >
          <div className="flex items-center gap-2">
            {testError && <span className="text-2xs text-destructive">{testError}</span>}
            <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
              {testing ? "Sending..." : "Send test notification"}
            </Button>
          </div>
        </SettingRow>
      </div>
    </Section>
  );
}
