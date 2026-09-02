import { getSettings, type Settings } from "./api";

// Settings back a few defaults that are read on open and change about never;
// one fetch per page session is plenty.
let pending: Promise<Settings> | null = null;

export function getCachedSettings(): Promise<Settings> {
  pending ??= getSettings().catch((err) => {
    pending = null;
    throw err;
  });
  return pending;
}
