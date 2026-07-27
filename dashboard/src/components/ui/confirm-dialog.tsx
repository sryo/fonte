"use client";

import { useState, type ReactNode } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

// Shared confirmation modal — the in-app replacement for native confirm().
// onConfirm may be async; the dialog shows a busy state and closes on success.
// If onConfirm throws, the dialog stays open so the caller's error surfaces
// elsewhere (toast/inline) without losing the user's place.
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
    <Modal open={open} onClose={busy ? () => {} : onClose} title={title}>
      {/* Portals bubble through the React tree, so stop clicks from reaching a
          card's onClick (edit/navigate) when the dialog is rendered inside one. */}
      <div className="space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="text-sm text-muted-foreground">{message}</div>
        <div className="flex gap-2 pt-1">
          <Button
            variant={destructive ? "destructive" : "default"}
            className="flex-1"
            disabled={busy}
            onClick={confirm}
          >
            {busy ? busyLabel || "Working…" : confirmLabel}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={busy} className="text-muted-foreground">
            {cancelLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
