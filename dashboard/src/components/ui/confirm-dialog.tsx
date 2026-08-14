"use client";

import { useState, type ReactNode } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { useIsMac, modKeyLabel } from "@/hooks/use-platform";

// Shared confirmation modal — the in-app replacement for native confirm().
// onConfirm may be async; the dialog shows a busy state and closes on success.
// If onConfirm throws, the dialog stays open so the caller's error surfaces
// elsewhere (toast/inline) without losing the user's place.
//
// Keyboard: non-destructive dialogs open with Confirm focused and submit on
// Enter. Destructive ones open with Cancel focused, so plain Enter is safe —
// confirming takes mod+Enter (or Tab+Enter / click). Escape always cancels
// (unless busy).
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  busyLabel,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busyLabel?: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const mod = modKeyLabel(useIsMac());

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch {
      // Leave the dialog open; the caller reports the failure.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={title}
      description={typeof message === "string" ? message : undefined}
      onSubmit={destructive ? undefined : confirm}
    >
      {/* Portals bubble through the React tree, so stop clicks from reaching a
          card's onClick (edit/navigate) when the dialog is rendered inside one. */}
      <div
        className="space-y-4"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={
          destructive
            ? (e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !busy) {
                  e.preventDefault();
                  confirm();
                }
              }
            : undefined
        }
      >
        {typeof message !== "string" && (
          <div className="text-sm text-muted-foreground">{message}</div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={busy}
            data-autofocus={destructive ? "" : undefined}
            className="text-muted-foreground"
          >
            {cancelLabel}
            <Kbd className="hidden sm:inline-flex">Esc</Kbd>
          </Button>
          <Button
            type={destructive ? "button" : "submit"}
            variant={destructive ? "destructive" : "default"}
            className="flex-1"
            disabled={busy}
            data-autofocus={destructive ? undefined : ""}
            onClick={destructive ? confirm : undefined}
          >
            {busy ? busyLabel || "Working…" : confirmLabel}
            {!busy && (
              <Kbd className="hidden sm:inline-flex bg-current/15 text-inherit">
                {destructive ? `${mod}↵` : "↵"}
              </Kbd>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
