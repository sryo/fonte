export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatSeconds(totalSeconds: number): string {
  if (totalSeconds < 60) return `${Math.round(totalSeconds)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m ${Math.round(totalSeconds % 60)}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function formatEta(remainingBytes: number, speed: number): string {
  if (speed <= 0 || remainingBytes <= 0) return "";
  return formatSeconds(Math.round(remainingBytes / speed));
}

export function formatDuration(ms: number): string {
  return formatSeconds(Math.floor(ms / 1000));
}

export function formatRatio(uploaded: number, downloaded: number): string {
  if (downloaded === 0) return uploaded > 0 ? "\u221e" : "0.00";
  return (uploaded / downloaded).toFixed(2);
}

import { formatDistanceToNow } from "date-fns";

export function formatRelativeTime(ts: number): string {
  return formatDistanceToNow(ts, { addSuffix: true });
}

// Compact variant for tight card meta lines.
export function formatShortRelativeTime(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** m:ss ticker for live elapsed time. */
export function formatClock(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function clockOf(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** "Just now", "12 min ago", "Today at 3:10 PM", "Yesterday at…", "Last Tuesday at…", then "Aug 14 at…". */
export function formatRunTime(ts: number, now: number = Date.now()): string {
  const diff = now - ts;
  if (diff >= 0 && diff < 60_000) return "Just now";
  if (diff >= 0 && diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 0 && -diff < 3_600_000) return `In ${Math.max(1, Math.ceil(-diff / 60_000))} min`;
  const d = new Date(ts);
  const today = new Date(now);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(d) - startOfDay(today)) / 86_400_000);
  if (dayDiff === 0) return `Today at ${clockOf(d)}`;
  if (dayDiff === -1) return `Yesterday at ${clockOf(d)}`;
  if (dayDiff === 1) return `Tomorrow at ${clockOf(d)}`;
  if (dayDiff < -1 && dayDiff > -7) return `Last ${WEEKDAY_NAMES[d.getDay()]} at ${clockOf(d)}`;
  if (dayDiff > 1 && dayDiff < 7) return `${WEEKDAY_NAMES[d.getDay()]} at ${clockOf(d)}`;
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
  return `${date} at ${clockOf(d)}`;
}
