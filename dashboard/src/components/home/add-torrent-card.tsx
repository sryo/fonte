"use client";

import { useRef, useState } from "react";
import { CaretDown, DownloadSimple, FilePlus, Plus, UploadSimple } from "@phosphor-icons/react";
import { addTorrent } from "@/lib/api";
import { EmptyRowCard } from "./empty-row-card";
import { CreateTorrentModal } from "./create-torrent-modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  // btoa argument limits — build the binary string in chunks
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Torrent-add entry point: as "card" it's the Active Downloads empty slot
 * (click to browse, drop target for .torrent files and magnet links); as
 * "action" it's the row-header "+ Add" button opening the same picker.
 */
export function AddTorrentCard({
  onAdded,
  variant = "card",
}: {
  onAdded: () => void;
  variant?: "card" | "action";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const run = async (add: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await add();
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addFiles = (files: File[]) => {
    const torrents = files.filter((f) => f.name.toLowerCase().endsWith(".torrent"));
    if (!torrents.length) {
      setError("Only .torrent files work here");
      return;
    }
    run(async () => {
      for (const file of torrents) {
        await addTorrent({ metainfo: await fileToBase64(file) });
      }
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) {
      addFiles(files);
      return;
    }
    const text = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    const magnet = text
      ?.split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("magnet:"));
    if (magnet) run(() => addTorrent({ magnetUri: magnet }).then(() => {}));
  };

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept=".torrent,application/x-bittorrent"
      multiple
      className="hidden"
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = "";
        if (files.length) addFiles(files);
      }}
    />
  );

  if (variant === "action") {
    return (
      <>
        {input}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-md px-2.5 py-1.5 hover:bg-muted">
              <Plus className="h-3.5 w-3.5" />
              {busy ? "Adding…" : "Add"}
              <CaretDown className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => { if (!busy) inputRef.current?.click(); }}>
              <FilePlus className="size-4" />
              Add .torrent file
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setShowCreate(true)}>
              <UploadSimple className="size-4" />
              Create torrent…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <CreateTorrentModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={onAdded} />
      </>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragActive(false);
      }}
      onDrop={handleDrop}
    >
      {input}
      <EmptyRowCard
        icon={DownloadSimple}
        label="Add a torrent"
        hint={busy ? "Adding…" : error ?? "Drop a .torrent file or click to browse"}
        hintClassName={error && !busy ? "text-destructive" : undefined}
        active={dragActive}
        onClick={() => { if (!busy) inputRef.current?.click(); }}
      />
    </div>
  );
}
