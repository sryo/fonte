"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Segmented } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type MediaType, type WatchlistRecord } from "@/lib/api";

const MEDIA_TYPES: { value: MediaType; label: string }[] = [
  { value: "movie", label: "Movie" },
  { value: "tv", label: "TV" },
  { value: "music", label: "Music" },
  { value: "other", label: "Other" },
];

// Legacy kinds stay editable on entries that already carry them.
const LEGACY_LABELS: Partial<Record<MediaType, string>> = { game: "Game", book: "Book", app: "App" };

export interface EditEntryData {
  title: string;
  mediaType: MediaType;
  year: number | null;
  quality: string;
  seasonPattern: string | null;
  posterUrl: string | null;
}

/**
 * Mount fresh each time the modal opens — the form seeds from `entry` once,
 * at mount, so the 10s background refresh never clobbers in-progress edits.
 */
export function EditEntryModal({
  entry,
  saving,
  onClose,
  onSave,
}: {
  entry: WatchlistRecord;
  saving: boolean;
  onClose: () => void;
  onSave: (data: EditEntryData) => void | Promise<void>;
}) {
  const [form, setForm] = useState(() => ({
    title: entry.title,
    mediaType: entry.mediaType,
    year: entry.year ? String(entry.year) : "",
    quality: entry.quality,
    seasonPattern: entry.seasonPattern || "",
    posterUrl: entry.posterUrl || "",
  }));

  const patch = (fields: Partial<typeof form>) => setForm((f) => ({ ...f, ...fields }));

  const handleSave = () => {
    if (!form.title.trim()) return;
    onSave({
      title: form.title.trim(),
      mediaType: form.mediaType,
      year: form.year ? parseInt(form.year) : null,
      quality: form.mediaType === "other" ? "" : form.quality,
      seasonPattern: form.mediaType === "tv" ? form.seasonPattern.trim() || null : null,
      posterUrl: form.posterUrl.trim() || null,
    });
  };

  return (
    <Modal open onClose={onClose} title="Edit watchlist entry" onSubmit={handleSave}>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="edit-title">Title</Label>
          <Input
            id="edit-title"
            value={form.title}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder="Title"
          />
        </div>
        <div className="flex gap-2">
          <div className="flex-1 space-y-1.5">
            <Label>Kind</Label>
            <Segmented
              value={form.mediaType}
              onChange={(v) => patch({ mediaType: v })}
              options={
                LEGACY_LABELS[entry.mediaType]
                  ? [...MEDIA_TYPES, { value: entry.mediaType, label: LEGACY_LABELS[entry.mediaType]! }]
                  : MEDIA_TYPES
              }
            />
          </div>
          <div className="w-24 space-y-1.5">
            <Label htmlFor="edit-year">{form.mediaType === "tv" ? "First aired" : "Year"}</Label>
            <Input
              id="edit-year"
              type="number"
              value={form.year}
              onChange={(e) => patch({ year: e.target.value })}
              placeholder={form.mediaType === "tv" ? "Optional" : "Year"}
              title={form.mediaType === "tv" ? "Only used to find the right poster" : undefined}
            />
          </div>
        </div>
        {form.mediaType !== "other" && (
          <div className="space-y-1.5">
            <Label htmlFor="edit-quality">Quality</Label>
            <Input
              id="edit-quality"
              value={form.quality}
              onChange={(e) => patch({ quality: e.target.value })}
              placeholder={
                form.mediaType === "music"
                  ? "e.g. FLAC, 320. Empty for any"
                  : form.mediaType === "movie" || form.mediaType === "tv"
                    ? "e.g. 1080p"
                    : "e.g. EPUB. Empty for any"
              }
            />
          </div>
        )}
        {form.mediaType === "tv" && (
          <div className="space-y-1.5">
            <Label htmlFor="edit-season">Season</Label>
            <Input
              id="edit-season"
              value={form.seasonPattern}
              onChange={(e) => patch({ seasonPattern: e.target.value })}
              placeholder="S14, S14E02 — optional"
            />
            <p className="text-2xs text-muted-foreground">
              Empty keeps grabbing new episodes; a season fulfills once.
            </p>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="edit-poster">Poster URL</Label>
          <Input
            id="edit-poster"
            value={form.posterUrl}
            onChange={(e) => patch({ posterUrl: e.target.value })}
            placeholder="Optional"
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" className="text-muted-foreground" onClick={onClose}>
            Cancel
            <Kbd className="hidden sm:inline-flex">Esc</Kbd>
          </Button>
          <Button
            type="submit"
            className="flex-1"
            disabled={saving || !form.title.trim()}
          >
            {saving ? "Saving…" : "Save"}
            {!saving && <Kbd className="hidden sm:inline-flex bg-current/15 text-inherit">↵</Kbd>}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
