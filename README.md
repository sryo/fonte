# Fonte

A torrent client run by agents.

You tell it what you want — a movie, a season, an album. The agents handle the rest: searching trackers, ranking releases, queueing downloads, retrying failures, fetching subtitles, and organizing the library. Talk to them through WhatsApp, the web dashboard, the CLI, or the REST API.

## What the agents do

- **Search** — Jackett indexers and bt4g/DHT in parallel; dedupe by info hash; rank by seeders and quality
- **Watch** — track shows and movies that aren't out yet; pick them up the moment a good release lands
- **Retry** — switch to a fresh release when a download stalls or fails
- **Subtitle** — auto-fetch via Subdl; translate via the configured model
- **Organize** — rename, move, and route finished files into your library layout
- **Notify** — completion updates through whichever surface you're using

## Surfaces

- **WhatsApp** — chat with the agent in your conversation; it replies inline
- **Web dashboard** — Next.js UI at `localhost:3000` for browsing, control, and live status
- **CLI** — `fonte torrent add`, `fonte watchlist`, etc., for shell and scripts
- **REST API** — `localhost:3777` with Server-Sent Events for live updates

## Quick start

```bash
npm install
npm run build
fonte start
```

Add a torrent:

```bash
fonte torrent add <magnet-link>
fonte torrent add /path/to/file.torrent
```

Open the web UI:

```bash
fonte office
```
