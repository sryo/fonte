import { describe, it, expect, vi, afterEach } from 'vitest';
import { searchBt4g } from './bt4g-client';

function rssWith(items: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?><rss><channel>${items}</channel></rss>`;
}

function mockFetch(xml: string) {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => xml })));
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('searchBt4g RSS parsing', () => {
    it('decodes XML entities in the <link> magnet so tracker params survive', async () => {
        mockFetch(rssWith(`<item>
            <title>Show S06 1080p</title>
            <link>magnet:?xt=urn:btih:6f959ce43907a9e4268f0dfb6ee26c62cf7458c0&amp;dn=Show+S06&amp;tr=udp%3A%2F%2Ft.example%3A1337</link>
            <description><![CDATA[Show S06 1080p<br>5.16 GB<br>video<br>6f959ce43907a9e4268f0dfb6ee26c62cf7458c0]]></description>
            <pubDate>Wed, 22 Jul 2026 00:00:00 GMT</pubDate>
        </item>`));

        const [r] = await searchBt4g('show');
        expect(r.magnetUri).toContain('&dn=Show+S06');
        expect(r.magnetUri).toContain('&tr=udp%3A%2F%2Ft.example%3A1337');
        expect(r.magnetUri).not.toContain('&amp;');
    });

    it('decodes entities in titles', async () => {
        mockFetch(rssWith(`<item>
            <title>Tom &amp; Jerry &#40;2021&#41;</title>
            <link>magnet:?xt=urn:btih:6f959ce43907a9e4268f0dfb6ee26c62cf7458c0</link>
            <description><![CDATA[x<br>1 GB<br>movie<br>abc]]></description>
        </item>`));

        const [r] = await searchBt4g('tom');
        expect(r.title).toBe('Tom & Jerry (2021)');
    });

    it('does not double-decode literal &amp;lt;', async () => {
        mockFetch(rssWith(`<item>
            <title>Weird &amp;lt;Name</title>
            <link>magnet:?xt=urn:btih:6f959ce43907a9e4268f0dfb6ee26c62cf7458c0</link>
            <description><![CDATA[x<br>1 GB<br>movie<br>abc]]></description>
        </item>`));

        const [r] = await searchBt4g('weird');
        expect(r.title).toBe('Weird &lt;Name');
    });
});
