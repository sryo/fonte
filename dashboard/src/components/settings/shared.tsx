"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

// ── Setting Row ─────────────────────────────────────────────────────────

export function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <Label className="text-sm font-medium">{label}</Label>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ── Section Save Button ─────────────────────────────────────────────────

export function SectionSaveButton({
  onClick,
  saving,
  saved,
  accentClass = "bg-primary text-primary-foreground hover:bg-primary/90",
}: {
  onClick: () => void;
  saving: boolean;
  saved: boolean;
  accentClass?: string;
}) {
  return (
    <div className="flex items-center gap-3 pt-2 mt-2 border-t border-border/50">
      <Button onClick={onClick} disabled={saving} className={accentClass}>
        {saving && (
          <div className="h-3 w-3 animate-spin border-2 border-current border-t-transparent rounded-full" />
        )}
        Save
      </Button>
      {saved && (
        <span className="text-sm text-subtitle flex items-center gap-1">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          Saved
        </span>
      )}
    </div>
  );
}
