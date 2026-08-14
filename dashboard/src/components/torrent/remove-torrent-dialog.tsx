"use client";

import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Kbd } from "@/components/ui/kbd";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useIsMac, modKeyLabel } from "@/hooks/use-platform";

export function RemoveTorrentDialog({
  open,
  torrentName,
  onClose,
  onConfirm,
}: {
  open: boolean;
  torrentName?: string;
  onClose: () => void;
  onConfirm: (deleteFiles: boolean) => void;
}) {
  const [deleteFiles, setDeleteFiles] = usePersistedState<boolean>(
    "fonte.remove-delete-files",
    false,
    (v): v is boolean => typeof v === "boolean",
  );
  const mod = modKeyLabel(useIsMac());

  const confirm = () => {
    onConfirm(deleteFiles);
    onClose();
  };

  // The title carries the name and the question in one line — no separate
  // "Remove X?" body sentence repeating the verb.
  const title = torrentName ? `Remove “${torrentName}”?` : "Remove this torrent?";

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div
        className="space-y-4"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            confirm();
          }
        }}
      >
        <label className="flex items-start gap-2 cursor-pointer">
          <Checkbox
            checked={deleteFiles}
            onChange={(e) => setDeleteFiles(e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-sm">
            Also move files to Trash
            <span className="block text-2xs text-muted-foreground">
              The downloaded data and fetched subtitles go to the Trash.
            </span>
          </span>
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            data-autofocus=""
            className="text-muted-foreground"
          >
            Cancel
            <Kbd className="hidden sm:inline-flex">Esc</Kbd>
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="flex-1"
            onClick={confirm}
          >
            {deleteFiles ? "Remove and move to Trash" : "Remove"}
            <Kbd className="hidden sm:inline-flex bg-current/15 text-inherit">
              {mod}↵
            </Kbd>
          </Button>
        </div>
      </div>
    </Modal>
  );
}
