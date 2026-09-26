"use client";

import { useEffect, useState } from "react";
import { sendTestNotification, type Settings } from "@/lib/api";
import { Bell } from "@phosphor-icons/react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { FieldStatus, SettingRow, useAutoSaveSection } from "@/components/settings/shared";
import {
  notificationSettingsFromRaw,
  type RawNotificationSettings,
} from "@/lib/notification-settings";

export function NotificationSettingsCard({
  settings,
  onSaveField,
}: {
  settings: Settings;
  onSaveField: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const raw = (settings as Record<string, unknown>).notifications as RawNotificationSettings | undefined;
  const s = useAutoSaveSection(notificationSettingsFromRaw(raw), onSaveField);
  const [testing, setTesting] = useState(false);
  const [testSent, setTestSent] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    if (!testSent) return;
    const t = setTimeout(() => setTestSent(false), 2000);
    return () => clearTimeout(t);
  }, [testSent]);

  const handleTest = async () => {
    setTesting(true);
    setTestSent(false);
    setTestError(null);
    try {
      await sendTestNotification();
      setTestSent(true);
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
          <Bell className="size-5 text-muted-foreground" weight="bold" />
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
          label="Automation failed"
          description="When an automation run fails"
          status={s.statusFor("automation_failed")}
        >
          <Switch
            checked={s.value("automation_failed")}
            onCheckedChange={(v) => s.commit("automation_failed", v)}
            disabled={!s.value("enabled")}
          />
        </SettingRow>

        <SettingRow
          label="Test"
          description="Send a test notification. First use asks for macOS permission (Script Editor)"
        >
          <div className="flex items-center gap-2">
            {testError && <FieldStatus status={{ state: "error", message: testError }} />}
            {testSent && <span className="text-xs text-done animate-overlay-in">Sent</span>}
            <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
              {testing ? "Sending…" : "Send test notification"}
            </Button>
          </div>
        </SettingRow>
      </div>
    </Section>
  );
}
