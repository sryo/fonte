"use client";

import { useState, useEffect } from "react";
import { getSoul, saveSoul } from "@/lib/api";
import { Textarea } from "@/components/ui/textarea";
import { Section } from "@/components/ui/section";
import { SectionSaveButton } from "@/components/settings/shared";

export function AgentPersonalitySection() {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // A failed load must never leave an empty editor over a real file —
  // saving that would wipe SOUL.md.
  const fetchSoul = () =>
    getSoul()
      .then((data) => {
        setContent(data.content);
        setLoadError(null);
      })
      .catch((err) => setLoadError((err as Error).message))
      .finally(() => setLoading(false));

  useEffect(() => {
    void fetchSoul();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = () => {
    setLoading(true);
    void fetchSoul();
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await saveSoul(content);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <svg className="h-4 w-4 text-agent" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
          </svg>
          Agent Personality
        </span>
      }
      description={<>Define your agent&apos;s communication style. Saved to ~/.fonte/SOUL.md</>}
    >
      {loadError ? (
        <div className="space-y-3">
          <p className="text-sm text-destructive">Could not load SOUL.md: {loadError}</p>
          <button type="button" onClick={retry} className="text-xs text-muted-foreground underline hover:text-foreground">
            Retry
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="min-h-32 font-mono resize-y"
            placeholder={"# Soul\n\nYou are..."}
          />
          {saveError && <p className="text-xs text-destructive">{saveError}</p>}
          <SectionSaveButton
            onClick={handleSave}
            saving={saving}
            saved={saved}
            accentClass="bg-agent text-agent-foreground hover:bg-agent/90"
          />
        </div>
      )}
    </Section>
  );
}
