export type NotificationDestination = "mac" | "whatsapp" | "both";
export type NotificationEvent = "torrent_completed" | "watchlist_match" | "automation_failed";

export const NOTIFICATION_DESTINATIONS: { value: NotificationDestination; label: string }[] = [
  { value: "mac", label: "Mac" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "both", label: "Both" },
];

export interface RawNotificationSettings {
  enabled?: boolean;
  torrent_completed?: boolean;
  watchlist_match?: boolean;
  automation_failed?: boolean;
  destinations?: Partial<Record<NotificationEvent, string>>;
}

const destination = (v: string | undefined): NotificationDestination =>
  v === "whatsapp" || v === "both" ? v : "mac";

export const notificationSettingsFromRaw = (r?: RawNotificationSettings) => ({
  enabled: r?.enabled ?? false,
  torrent_completed: r?.torrent_completed ?? false,
  watchlist_match: r?.watchlist_match ?? false,
  automation_failed: r?.automation_failed ?? true,
  torrent_completed_destination: destination(r?.destinations?.torrent_completed),
  watchlist_match_destination: destination(r?.destinations?.watchlist_match),
  automation_failed_destination: destination(r?.destinations?.automation_failed),
});

export type NotificationForm = ReturnType<typeof notificationSettingsFromRaw>;

const DESTINATION_SUFFIX = "_destination";

/** Map a form patch onto the settings shape: `<event>_destination` keys
    nest under `destinations`, toggles pass through. */
export function notificationSettingsPatch(patch: Partial<NotificationForm>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const destinations: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key.endsWith(DESTINATION_SUFFIX)) destinations[key.slice(0, -DESTINATION_SUFFIX.length)] = value;
    else out[key] = value;
  }
  if (Object.keys(destinations).length) out.destinations = destinations;
  return out;
}

export function destinationNote(
  dest: NotificationDestination,
  whatsapp: { linked: boolean; allowedChat: string | null }
): string | null {
  if (dest === "mac") return null;
  if (!whatsapp.allowedChat) return "No WhatsApp chat picked. Sending to the Mac for now.";
  if (!whatsapp.linked) return "WhatsApp isn't linked. Messages wait until it is.";
  return null;
}

const EVENTS: NotificationEvent[] = ["torrent_completed", "watchlist_match", "automation_failed"];

/** Where the test button sends: every destination an enabled event uses. */
export function testDestination(
  value: <K extends keyof NotificationForm>(key: K) => NotificationForm[K]
): NotificationDestination {
  let mac = false;
  let whatsapp = false;
  for (const event of EVENTS) {
    if (!value(event)) continue;
    const dest = value(`${event}_destination`);
    if (dest !== "whatsapp") mac = true;
    if (dest !== "mac") whatsapp = true;
  }
  if (whatsapp) return mac ? "both" : "whatsapp";
  return "mac";
}
