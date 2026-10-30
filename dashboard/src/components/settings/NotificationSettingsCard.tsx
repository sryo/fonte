"use client";

import { useEffect, useState } from "react";
import { getAllowedChat, getWhatsAppStatus, sendTestNotification, type Settings } from "@/lib/api";
import { Bell } from "@phosphor-icons/react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { Segmented } from "@/components/ui/segmented";
import { FieldStatus, SettingRow, useAutoSaveSection } from "@/components/settings/shared";
import { parseWhatsAppStatus } from "@/lib/whatsapp-flow";
import { usePolling } from "@/lib/hooks";
import {
  NOTIFICATION_DESTINATIONS,
  destinationNote,
  notificationSettingsFromRaw,
  notificationSettingsPatch,
  testDestination,
  type NotificationEvent,
  type RawNotificationSettings,
} from "@/lib/notification-settings";

const EVENTS: { key: NotificationEvent; label: string; description: string }[] = [
  { key: "torrent_completed", label: "Download complete", description: "When a torrent finishes downloading" },
  { key: "watchlist_match", label: "Watchlist match", description: "When a watched title matches a release" },
  { key: "automation_failed", label: "Automation failed", description: "When an automation run fails" },
];

async function loadWhatsAppReadiness() {
  const [status, allowed] = await Promise.all([getWhatsAppStatus(), getAllowedChat()]);
  return { linked: parseWhatsAppStatus(status).linked, allowedChat: allowed.allowed_chat ?? null };
}

export function NotificationSettingsCard({
  settings,
  onSaveField,
}: {
  settings: Settings;
  onSaveField: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const raw = (settings as Record<string, unknown>).notifications as RawNotificationSettings | undefined;
  const s = useAutoSaveSection(notificationSettingsFromRaw(raw), (patch) =>
    onSaveField(notificationSettingsPatch(patch))
  );
  const { data: whatsapp, refresh: refreshWhatsApp } = usePolling(loadWhatsAppReadiness, 0);
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
      await sendTestNotification(testDestination(s.value));
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
      description="Mac and WhatsApp notifications from the Fonte daemon"
    >
      <div className="divide-y divide-border/50">
        <SettingRow
          label="Enabled"
          description="Notify even when the dashboard isn't open"
          status={s.statusFor("enabled")}
        >
          <Switch checked={s.value("enabled")} onCheckedChange={(v) => s.commit("enabled", v)} />
        </SettingRow>

        {EVENTS.map(({ key, label, description }) => {
          const destKey = `${key}_destination` as const;
          const on = s.value("enabled") && s.value(key);
          const dest = s.value(destKey);
          const note = on && whatsapp ? destinationNote(dest, whatsapp) : null;
          const destStatus = s.statusFor(destKey);
          return (
            <SettingRow
              key={key}
              label={label}
              description={
                <>
                  {description}
                  {note && <span className="block text-warning">{note}</span>}
                </>
              }
              status={destStatus.state === "idle" ? s.statusFor(key) : destStatus}
            >
              <div className="flex items-center gap-3">
                {on && (
                  <Segmented
                    value={dest}
                    onChange={(v) => {
                      s.commit(destKey, v);
                      void refreshWhatsApp();
                    }}
                    options={NOTIFICATION_DESTINATIONS}
                    className="w-52"
                  />
                )}
                <Switch
                  aria-label={label}
                  checked={s.value(key)}
                  onCheckedChange={(v) => s.commit(key, v)}
                  disabled={!s.value("enabled")}
                />
              </div>
            </SettingRow>
          );
        })}

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
