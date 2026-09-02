export function normalizeErrorKind(detail: string | null | undefined): string {
    const text = (detail ?? '').trim().toLowerCase();
    if (!text) return 'unknown';
    const normalized = text
        .replace(/\([^)]*\)/g, ' ')
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ' ')
        .replace(/0x[0-9a-f]+/g, ' ')
        .replace(/\d+/g, ' ')
        .replace(/[^a-z ]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return normalized.split(' ').filter(Boolean).slice(0, 6).join(' ') || 'unknown';
}

/** Notify on the 1st, 2nd, 4th, 8th... occurrence of the same failure. */
export function shouldNotifyFailure(occurrence: number): boolean {
    return occurrence <= 1 || (occurrence & (occurrence - 1)) === 0;
}

/** Counts repeats of one failure kind per subject, so a stuck source nags less over time. */
export class FailureCounter {
    private occurrences = new Map<string, number>();

    record(subject: string, detail: string): { occurrence: number; notify: boolean } {
        const key = `${subject}:${normalizeErrorKind(detail)}`;
        const occurrence = (this.occurrences.get(key) ?? 0) + 1;
        this.occurrences.set(key, occurrence);
        return { occurrence, notify: shouldNotifyFailure(occurrence) };
    }

    clear(subject: string): void {
        for (const key of this.occurrences.keys()) {
            if (key.startsWith(`${subject}:`)) this.occurrences.delete(key);
        }
    }
}
