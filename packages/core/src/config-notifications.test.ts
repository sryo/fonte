import { describe, expect, it } from 'vitest';
import { validateSettings } from './config';

describe('notification destinations in settings', () => {
    it('validate without warnings', () => {
        const { warnings } = validateSettings({
            notifications: {
                enabled: true,
                destinations: { torrent_completed: 'whatsapp', watchlist_match: 'both', automation_failed: 'mac' },
            },
        });
        expect(warnings).toEqual([]);
    });
});
