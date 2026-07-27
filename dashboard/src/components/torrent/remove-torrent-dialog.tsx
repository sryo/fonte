"use client";

import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { usePersistedState } from "@/hooks/use-persisted-state";

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

  // The title carries the name and the question in one line — no separate
  // "Remove X?" body sentence repeating the verb.
  const title = torrentName ? `Remove “${torrentName}”?` : "Remove this torrent?";

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={deleteFiles}
            onChange={(e) => setDeleteFiles(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-primary"
          />
          <span className="text-sm">
            Also move files to Trash
            <span className="block text-2xs text-muted-foreground">
              The downloaded data and fetched subtitles go to the Trash.
            </span>
          </span>
        </label>
        <div className="flex gap-2 pt-1">
          <Button
            variant="destructive"
            className="flex-1"
            onClick={() => {
              onConfirm(deleteFiles);
              onClose();
            }}
          >
            {deleteFiles ? "Remove and move to Trash" : "Remove"}
          </Button>
          <Button variant="ghost" onClick={onClose} className="text-muted-foreground">
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
