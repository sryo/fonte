"use client";

import { useState } from "react";
import { Check, Copy } from "@phosphor-icons/react";
import { createTorrent } from "@/lib/api";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { IconSwap } from "@/components/ui/icon-swap";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/feedback";

/**
 * Seed local content: point at a file/folder on the daemon machine, get a
 * .torrent built and handed to Transmission, and walk away with the magnet.
 */
export function CreateTorrentModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [path, setPath] = useState("");
  const [tracker, setTracker] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magnetUri, setMagnetUri] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const reset = () => {
    setPath("");
    setTracker("");
    setError(null);
    setMagnetUri(null);
    setWarning(null);
    setCopied(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (!path.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const trackers = tracker.trim() ? [tracker.trim()] : [];
      const res = await createTorrent({ path: path.trim(), trackers });
      setMagnetUri(res.magnetUri);
      setWarning(res.warning ?? null);
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copyMagnet = async () => {
    if (!magnetUri) return;
    await navigator.clipboard.writeText(magnetUri);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal open={open} onClose={close} title={magnetUri ? "Seeding" : "Create Torrent"} onSubmit={submit}>
      {magnetUri ? (
        <div className="space-y-3">
          <p className={warning ? "text-sm text-warning" : "text-sm text-muted-foreground"}>
            {warning ?? "Transmission verified the data and is seeding it. Share this magnet link:"}
          </p>
          <div className="rounded-md bg-muted p-3 font-mono text-2xs break-all">{magnetUri}</div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={close} className="text-muted-foreground">
              Done
              <Kbd className="hidden sm:inline-flex">Esc</Kbd>
            </Button>
            <Button type="button" data-autofocus="" className="flex-1" onClick={copyMagnet}>
              <IconSwap
                active={copied ? "check" : "copy"}
                icons={{ copy: <Copy className="size-3.5" />, check: <Check className="size-3.5" /> }}
              />
              {copied ? "Copied" : "Copy magnet"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="create-torrent-path">File or folder on this machine</Label>
            <Input
              id="create-torrent-path"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="~/Downloads/fonte/…"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="create-torrent-tracker">
              Tracker URL <span className="font-normal text-muted-foreground">(optional — DHT works without one)</span>
            </Label>
            <Input
              id="create-torrent-tracker"
              value={tracker}
              onChange={(e) => setTracker(e.target.value)}
              placeholder="udp://…"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={close} disabled={busy} className="text-muted-foreground">
              Cancel
              <Kbd className="hidden sm:inline-flex">Esc</Kbd>
            </Button>
            <Button type="submit" className="flex-1" disabled={!path.trim() || busy}>
              {busy && <Spinner size="xs" />}
              {busy ? "Creating…" : "Create & Seed"}
              {!busy && <Kbd className="hidden sm:inline-flex bg-current/15 text-inherit">↵</Kbd>}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
