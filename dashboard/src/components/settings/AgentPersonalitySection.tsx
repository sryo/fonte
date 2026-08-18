"use client";

import { useState, useEffect } from "react";
import { getSoul, saveSoul } from "@/lib/api";
import { Sparkle } from "@phosphor-icons/react";
import { Textarea } from "@/components/ui/textarea";
import { Section } from "@/components/ui/section";
import { SaveFooter } from "@/components/settings/shared";

export function AgentPersonalitySection() {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // A failed load must not render an empty editor over a real SOUL.md.
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
        <span className="inline-flex items-center gap-2">
          <Sparkle className="h-4 w-4 text-agent" weight="bold" />
          Agent personality
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
          <SaveFooter
            onClick={handleSave}
            saving={saving}
            saved={saved}
            error={saveError}
            accentClass="bg-agent text-agent-foreground hover:bg-agent/90"
          />
        </div>
      )}
    </Section>
  );
}
