"use client";

import { useState, useEffect } from "react";
import { getSoul, saveSoul } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Section } from "@/components/ui/section";
import { Spinner } from "@/components/ui/feedback";

// ── Agent Personality Section ───────────────────────────────────────────

export function AgentPersonalitySection() {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSoul()
      .then((data) => {
        setContent(data.content);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    await saveSoul(content);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
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
      <div className="space-y-3">
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="min-h-32 font-mono resize-y"
          placeholder={"# Soul\n\nYou are..."}
        />
        <div className="flex items-center gap-3 pt-2 border-t border-border/50">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-agent text-agent-foreground hover:bg-agent/90"
          >
            {saving && <Spinner size="xs" />}
            {saved ? "Saved" : saving ? "Saving..." : "Save Personality"}
          </Button>
          {saved && (
            <span className="text-sm text-done flex items-center gap-1">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              Saved
            </span>
          )}
        </div>
      </div>
    </Section>
  );
}
