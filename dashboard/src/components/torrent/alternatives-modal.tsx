"use client";

import { type AlternativeResult } from "@/lib/api";
import { Modal } from "@/components/ui/modal";
import { LoadingState, EmptyState } from "@/components/ui/feedback";
import { ReleaseList } from "@/components/shared/release-list";

/** Swap-in picker for healthier releases of the same title. */
export function AlternativesModal({
  open,
  onClose,
  searching,
  error,
  results,
  onSwap,
}: {
  open: boolean;
  onClose: () => void;
  searching: boolean;
  error: string | null;
  results: AlternativeResult[];
  onSwap: (magnetUri: string) => Promise<void>;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Find alternatives" wide>
      {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
      {searching ? (
        <LoadingState label="Searching indexers…" />
      ) : (
        <ReleaseList
          results={results}
          actionLabel="Swap in"
          keyOf={(r) => r.magnetUri}
          onAction={(r) => onSwap(r.magnetUri)}
          emptyState={<EmptyState title="No alternatives found." />}
        />
      )}
    </Modal>
  );
}
