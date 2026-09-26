export interface RawNotificationSettings {
  enabled?: boolean;
  torrent_completed?: boolean;
  watchlist_match?: boolean;
  automation_failed?: boolean;
}

export const notificationSettingsFromRaw = (r?: RawNotificationSettings) => ({
  enabled: r?.enabled ?? false,
  torrent_completed: r?.torrent_completed ?? false,
  watchlist_match: r?.watchlist_match ?? false,
  automation_failed: r?.automation_failed ?? true,
});
