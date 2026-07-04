import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// The three activity domains, each with a registered --torrent/--watchlist/
// --automation color token. Shared so the progress ring and bar can't drift.
export type DomainColor = "torrent" | "watchlist" | "automation";
