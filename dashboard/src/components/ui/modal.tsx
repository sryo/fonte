"use client";

import { type ReactNode } from "react";
import { Dialog } from "radix-ui";
import { cn } from "@/lib/utils";

export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
  description,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  /** Body copy under the title, wired to aria-describedby. */
  description?: string;
  /** Wraps children in a form so Enter submits from any input. Every
      non-submit button inside must then carry type="button". */
  onSubmit?: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          onOpenAutoFocus={(e) => {
            // React's autoFocus prop never survives Radix's first-tabbable
            // default, so initial focus is steered with [data-autofocus].
            // currentTarget is the live content node — refs can go stale
            // across StrictMode's double-fired mount effects.
            const target = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>("[data-autofocus]");
            if (target) {
              e.preventDefault();
              target.focus();
            }
          }}
          {...(description ? {} : { "aria-describedby": undefined })}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-card p-4 shadow-card animate-card-enter",
            wide ? "max-w-2xl" : "max-w-md"
          )}
        >
          <Dialog.Title className="mb-3 text-sm font-semibold">{title}</Dialog.Title>
          {description && (
            <Dialog.Description className="mb-4 text-sm text-muted-foreground">
              {description}
            </Dialog.Description>
          )}
          {onSubmit ? (
            <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>{children}</form>
          ) : (
            children
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
