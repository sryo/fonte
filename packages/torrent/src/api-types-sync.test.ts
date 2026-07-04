import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// The dashboard has no workspace deps, so it carries a generated copy of the
// wire types. This check fails the build when the copy drifts from canonical.
describe('dashboard api-types copy', () => {
    it('matches packages/torrent/src/types.ts (run `npm run sync:types` to fix)', () => {
        const root = path.resolve(__dirname, '../../..');
        const canonical = readFileSync(path.join(root, 'packages/torrent/src/types.ts'), 'utf8');
        const copy = readFileSync(path.join(root, 'dashboard/src/lib/api-types.ts'), 'utf8');
        const withoutBanner = copy.split('\n').slice(2).join('\n');
        expect(withoutBanner).toBe(canonical);
    });
});
