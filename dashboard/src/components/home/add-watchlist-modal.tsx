"use client";

import { useState } from "react";
import { addWatchlistEntry } from "@/lib/api";

export function AddWatchlistModal({ open, onClose, onAdded }: {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [wlForm, setWlForm] = useState({ title: "", mediaType: "movie" as "movie" | "tv" | "music" | "game" | "book" | "app" | "other", year: "", quality: "1080p" });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-lg border p-6 w-full max-w-sm space-y-4 animate-card-enter" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold">Add to Watchlist</h3>
        <input
          placeholder="Title"
          value={wlForm.title}
          onChange={(e) => setWlForm({ ...wlForm, title: e.target.value })}
          className="w-full px-3 py-2 text-sm rounded-lg border bg-background"
          autoFocus
        />
        <div className="grid grid-cols-2 gap-3">
          <select
            value={wlForm.mediaType}
            onChange={(e) => setWlForm({ ...wlForm, mediaType: e.target.value as "movie" | "tv" | "music" | "game" | "book" | "app" | "other" })}
            className="px-3 py-2 text-sm rounded-lg border bg-background"
          >
            <option value="movie">Movie</option>
            <option value="tv">TV Show</option>
            <option value="music">Music</option>
            <option value="game">Game</option>
            <option value="book">Book</option>
            <option value="app">App</option>
            <option value="other">Other</option>
          </select>
          <input
            placeholder="Year"
            type="number"
            value={wlForm.year}
            onChange={(e) => setWlForm({ ...wlForm, year: e.target.value })}
            className="px-3 py-2 text-sm rounded-lg border bg-background"
          />
        </div>
        <select
          value={wlForm.quality}
          onChange={(e) => setWlForm({ ...wlForm, quality: e.target.value })}
          className="w-full px-3 py-2 text-sm rounded-lg border bg-background"
        >
          <option value="720p">720p</option>
          <option value="1080p">1080p</option>
          <option value="4K">4K</option>
        </select>
        <div className="flex gap-2 pt-1">
          <button
            onClick={async () => {
              if (!wlForm.title.trim()) return;
              await addWatchlistEntry({
                title: wlForm.title.trim(),
                mediaType: wlForm.mediaType,
                year: wlForm.year ? parseInt(wlForm.year) : undefined,
                quality: wlForm.quality,
              });
              setWlForm({ title: "", mediaType: "movie", year: "", quality: "1080p" });
              onClose();
              onAdded();
            }}
            disabled={!wlForm.title.trim()}
            className="flex-1 px-4 py-2 text-sm bg-watchlist text-watchlist-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            Add
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
