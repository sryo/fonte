"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addWatchlistEntry,
  suggestWatchlistTitles,
  type MediaType,
  type WatchlistSuggestion,
} from "@/lib/api";
import { getCachedSettings } from "@/lib/settings-cache";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Segmented } from "@/components/ui/segmented";
import { QUALITY_SUGGESTIONS } from "@/lib/release-groups";
import {
  MEDIA_TYPES,
  VIDEO_DEFAULT_QUALITY,
  defaultQuality,
  isVideoKind,
  kindHasQuality,
  kindUsesYear,
} from "@/lib/media-kinds";

/** Mounted only while open, so the draft resets with the component. */
export function AddWatchlistModal({ onClose, onAdded }: {
  onClose: () => void;
  onAdded: () => void;
}) {
  const [form, setForm] = useState({
    title: "",
    mediaType: "movie" as MediaType,
    year: "",
    seasonPattern: "",
  });
  // null until the user picks one, so the shown value follows the kind.
  const [quality, setQuality] = useState<string | null>(null);
  const [videoDefault, setVideoDefault] = useState(VIDEO_DEFAULT_QUALITY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titleHits, setTitleHits] = useState<WatchlistSuggestion[]>([]);
  const [looking, setLooking] = useState(false);
  // A picked suggestion fills the title, which would otherwise look like typing
  // and fire another lookup for the name we just accepted. Remembering the name
  // rather than setting a skip-once flag keeps it correct when the accepted
  // title is what the user had already typed, which fires no change at all.
  const [accepted, setAccepted] = useState<string | null>(null);

  const patch = (fields: Partial<typeof form>) => setForm((f) => ({ ...f, ...fields }));

  const isTv = form.mediaType === "tv";
  const shownQuality = quality ?? defaultQuality(form.mediaType, videoDefault);
  const query = form.title.trim();
  // An accepted title is excluded so picking a suggestion doesn't look up the
  // name it just filled in, which also empties the list without a state reset.
  const lookingUp =
    isVideoKind(form.mediaType) && query.length >= 2 && query !== accepted;

  useEffect(() => {
    getCachedSettings()
      .then((s) => setVideoDefault(s.watchlist?.preferred_quality || VIDEO_DEFAULT_QUALITY))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!lookingUp) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLooking(true);
      suggestWatchlistTitles(query, controller.signal)
        .then(setTitleHits)
        .catch(() => {})
        .finally(() => setLooking(false));
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, lookingUp]);

  const titleOptions = useMemo(
    () =>
      lookingUp
        ? titleHits.map((s) => ({
            value: s.title,
            hint: [s.year, s.mediaType === "tv" ? "TV" : null].filter(Boolean).join(" · ") || undefined,
            data: s,
          }))
        : [],
    [titleHits, lookingUp],
  );

  const handleAdd = async () => {
    if (!form.title.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await addWatchlistEntry({
        title: form.title.trim(),
        mediaType: form.mediaType,
        year: kindUsesYear(form.mediaType) && form.year ? parseInt(form.year, 10) : undefined,
        quality: kindHasQuality(form.mediaType) ? shownQuality.trim() : "",
        seasonPattern: isTv ? form.seasonPattern.trim() || undefined : undefined,
      });
      onClose();
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Add to watchlist" onSubmit={handleAdd}>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="add-title">Title</Label>
          <Combobox
            id="add-title"
            data-autofocus
            placeholder="Title"
            value={form.title}
            onValueChange={(v) => patch({ title: v })}
            options={titleOptions}
            onSelect={({ data: hit }) => {
              if (!hit) return;
              setAccepted(hit.title);
              patch({
                title: hit.title,
                mediaType: hit.mediaType,
                year: hit.year ? String(hit.year) : form.year,
              });
            }}
            filter={false}
            loading={looking && lookingUp}
          />
        </div>

        <div className="flex gap-2">
          <div className="flex-1 space-y-1.5">
            <Label>Kind</Label>
            <Segmented
              value={form.mediaType}
              onChange={(v) => patch({ mediaType: v })}
              options={MEDIA_TYPES}
            />
          </div>
          {kindUsesYear(form.mediaType) && (
            <div className="w-28 space-y-1.5">
              <Label htmlFor="add-year">{isTv ? "First aired" : "Year"}</Label>
              <Input
                id="add-year"
                type="number"
                min={1900}
                max={2100}
                placeholder={isTv ? "Optional" : "Year"}
                value={form.year}
                onChange={(e) => patch({ year: e.target.value })}
              />
            </div>
          )}
        </div>
        {isTv && (
          <p className="text-2xs text-muted-foreground">The year only helps find the right poster.</p>
        )}

        {isTv && (
          <div className="space-y-1.5">
            <Label htmlFor="add-season">Season</Label>
            <Input
              id="add-season"
              placeholder="S14 or S14E02, optional"
              value={form.seasonPattern}
              onChange={(e) => patch({ seasonPattern: e.target.value })}
            />
            <p className="text-2xs text-muted-foreground">
              Empty keeps grabbing new episodes; a season fulfills once.
            </p>
          </div>
        )}

        {kindHasQuality(form.mediaType) && (
          <div className="space-y-1.5">
            <Label htmlFor="add-quality">Quality</Label>
            <Combobox
              id="add-quality"
              placeholder="Any"
              value={shownQuality}
              onValueChange={setQuality}
              options={QUALITY_SUGGESTIONS[form.mediaType] ?? []}
            />
            <p className="text-2xs text-muted-foreground">Empty matches any quality.</p>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose} className="text-muted-foreground">
            Cancel
            <Kbd className="hidden sm:inline-flex">Esc</Kbd>
          </Button>
          <Button
            type="submit"
            disabled={!form.title.trim() || submitting}
            className="flex-1 bg-watchlist text-watchlist-foreground hover:bg-watchlist/90"
          >
            {submitting ? "Adding…" : "Add"}
            {!submitting && <Kbd className="hidden sm:inline-flex bg-current/15 text-inherit">↵</Kbd>}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
