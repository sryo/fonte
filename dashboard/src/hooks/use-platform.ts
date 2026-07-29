import { useSyncExternalStore } from "react"

const subscribe = () => () => {}
const getSnapshot = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
const getServerSnapshot = () => null

/** null on the server and during hydration, so both renders agree. */
export function useIsMac(): boolean | null {
  return useSyncExternalStore<boolean | null>(subscribe, getSnapshot, getServerSnapshot)
}

/** Defaults to "⌘" while the platform is unknown (pre-hydration / SSR). */
export function modKeyLabel(isMac: boolean | null): string {
  return isMac === false ? "Ctrl" : "⌘"
}
