"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
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
  { value: "tv", label: "TV Show" },
  { value: "music", label: "Music" },
  { value: "game", label: "Game" },
  { value: "book", label: "Book" },
  { value: "app", label: "App" },
  { value: "other", label: "Other" },
];

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
      quality: form.quality,
      seasonPattern: form.seasonPattern.trim() || null,
      posterUrl: form.posterUrl.trim() || null,
    });
  };

  return (
    <Modal open onClose={onClose} title="Edit Watchlist Entry">
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
            <Label>Media type</Label>
            <Select
              value={form.mediaType}
              onValueChange={(v) => patch({ mediaType: v as MediaType })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEDIA_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-24 space-y-1.5">
            <Label htmlFor="edit-year">Year</Label>
            <Input
              id="edit-year"
              type="number"
              value={form.year}
              onChange={(e) => patch({ year: e.target.value })}
              placeholder="Year"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-quality">Quality</Label>
          <Input
            id="edit-quality"
            value={form.quality}
            onChange={(e) => patch({ quality: e.target.value })}
            placeholder="Quality (e.g. 1080p)"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-season">Season pattern</Label>
          <Input
            id="edit-season"
            value={form.seasonPattern}
            onChange={(e) => patch({ seasonPattern: e.target.value })}
            placeholder="e.g. S01 — optional"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-poster">Poster URL</Label>
          <Input
            id="edit-poster"
            value={form.posterUrl}
            onChange={(e) => patch({ posterUrl: e.target.value })}
            placeholder="Optional"
          />
        </div>
        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            onClick={handleSave}
            disabled={saving || !form.title.trim()}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
