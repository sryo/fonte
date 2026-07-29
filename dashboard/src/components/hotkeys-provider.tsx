"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";

export interface Hotkey {
  id: string;
  /** "mod+k" (mod = ⌘ or Ctrl), a bare key, or a two-key sequence like "g h". */
  keys: string;
  description: string;
  /** Fire even while an input, textarea, or contenteditable has focus. */
  allowInInput?: boolean;
  handler: (e: KeyboardEvent) => void;
}

type HotkeyRef = { current: Hotkey };

const HotkeysContext = createContext<{
  register: (ref: HotkeyRef) => () => void;
} | null>(null);

const SEQUENCE_TIMEOUT_MS = 800;

function isEditableTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    !!el.closest?.('[contenteditable="true"]')
  );
}

function isInsideDialog(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return !!el?.closest?.('[role="dialog"]');
}

function matchesCombo(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split("+");
  const key = parts[parts.length - 1];
  const wantMod = parts.includes("mod");
  if (wantMod !== (e.metaKey || e.ctrlKey)) return false;
  if (!wantMod && e.altKey) return false;
  return e.key.toLowerCase() === key;
}

export function HotkeysProvider({ children }: { children: ReactNode }) {
  const registryRef = useRef<Map<string, HotkeyRef>>(new Map());
  const pendingPrefix = useRef<{ key: string; at: number } | null>(null);

  const register = useCallback((ref: HotkeyRef) => {
    const registry = registryRef.current;
    const id = ref.current.id;
    registry.set(id, ref);
    return () => {
      registry.delete(id);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Radix dialogs preventDefault the Escape they consume — never double-handle.
      if (e.defaultPrevented) return;
      const guarded = isEditableTarget(e);
      // Modal contexts keep their own keyboard story; even allowInInput keys stay out.
      const inDialog = isInsideDialog(e);

      const pending = pendingPrefix.current;
      pendingPrefix.current = null;
      if (pending && Date.now() - pending.at < SEQUENCE_TIMEOUT_MS && !guarded && !inDialog) {
        for (const ref of registryRef.current.values()) {
          const seq = ref.current.keys.split(" ");
          if (seq.length === 2 && seq[0] === pending.key && matchesCombo(e, seq[1])) {
            e.preventDefault();
            ref.current.handler(e);
            return;
          }
        }
      }

      if (inDialog) return;

      for (const ref of registryRef.current.values()) {
        const hk = ref.current;
        const seq = hk.keys.split(" ");
        if (seq.length === 2) {
          // A bare prefix key arms the sequence; nothing fires yet.
          if (!guarded && !e.metaKey && !e.ctrlKey && !e.altKey && matchesCombo(e, seq[0])) {
            pendingPrefix.current = { key: seq[0], at: Date.now() };
          }
          continue;
        }
        if (guarded && !hk.allowInInput) continue;
        if (matchesCombo(e, hk.keys)) {
          e.preventDefault();
          hk.handler(e);
          return;
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <HotkeysContext.Provider value={{ register }}>
      {children}
    </HotkeysContext.Provider>
  );
}

export function useHotkey(hotkey: Hotkey): void {
  const ctx = useContext(HotkeysContext);
  if (!ctx) throw new Error("useHotkey requires a HotkeysProvider ancestor");
  const ref = useRef(hotkey);
  useEffect(() => {
    ref.current = hotkey;
  });
  const { register } = ctx;
  useEffect(() => register(ref), [register]);
}
