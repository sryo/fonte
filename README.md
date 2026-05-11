# AITorrent

AI-powered torrent download manager with a REST API, CLI, and Next.js web UI.

## Features

- Magnet link and .torrent file support
- WebTorrent engine for browser-compatible downloading
- REST API for programmatic torrent management
- Full-featured CLI for adding, removing, and monitoring torrents
- Next.js web dashboard (AITorrent Dashboard) for real-time status and control
- AI agent integration for intelligent download management
- SQLite-backed persistent queue and state
- Parallel torrent processing with per-torrent status tracking

## Quick Start

### Prerequisites

- Node.js v18+
- macOS, Linux, or Windows (WSL2)

### Install and Run

```bash
npm install
npm run build
aitorrent start
```

### Add a Torrent

```bash
aitorrent torrent add <magnet-link>
aitorrent torrent add /path/to/file.torrent
```

### Open the Web UI

```bash
aitorrent office
```

The web dashboard starts on `http://localhost:3000` and connects to the API at `http://localhost:3777`.

### Docker

```bash
docker compose up -d
```

Set your API key via environment variable or `.env` file:

```bash
ANTHROPIC_API_KEY=sk-ant-... docker compose up -d
```

Data is persisted in an `aitorrent-data` Docker volume.

## CLI Commands

| Command                          | Description                          |
| -------------------------------- | ------------------------------------ |
| `aitorrent start`               | Start the AITorrent daemon           |
| `aitorrent stop`                | Stop all processes                   |
| `aitorrent restart`             | Restart the daemon                   |
| `aitorrent status`              | Show daemon and torrent status       |
| `aitorrent torrent add <src>`   | Add a torrent (magnet or .torrent)   |
| `aitorrent torrent list`        | List all torrents and their status   |
| `aitorrent torrent remove <id>` | Remove a torrent                     |
| `aitorrent torrent pause <id>`  | Pause a torrent                      |
| `aitorrent torrent resume <id>` | Resume a paused torrent              |
| `aitorrent agent list`          | List configured AI agents            |
| `aitorrent agent add`           | Add a new AI agent (interactive)     |
| `aitorrent logs [type]`         | View logs (queue, heartbeat, all)    |
| `aitorrent office`              | Start the web UI on port 3000        |
| `aitorrent update`              | Update to the latest version         |

## API Endpoints

| Method | Endpoint                    | Description                  |
| ------ | --------------------------- | ---------------------------- |
| GET    | `/api/torrents`             | List all torrents            |
| POST   | `/api/torrents`             | Add a torrent                |
| GET    | `/api/torrents/:id`         | Get torrent details          |
| DELETE | `/api/torrents/:id`         | Remove a torrent             |
| POST   | `/api/torrents/:id/pause`   | Pause a torrent              |
| POST   | `/api/torrents/:id/resume`  | Resume a torrent             |
| GET    | `/api/agents`               | List agents                  |
| GET    | `/api/status`               | Daemon and system status     |
| GET    | `/api/events`               | SSE stream for live updates  |

## Architecture

```
aitorrent/
├── packages/
│   ├── core/          # Shared types, config, queue, agent invocation
│   ├── torrent/       # WebTorrent engine wrapper and torrent management
│   ├── server/        # REST API server (Express + SSE)
│   ├── main/          # Daemon entry point and process orchestration
│   └── cli/           # CLI commands (commander-based)
├── dashboard/        # Next.js web dashboard
├── .aitorrent/        # Runtime data (created on first run)
│   ├── settings.json  #   Configuration
│   ├── aitorrent.db   #   SQLite database
│   ├── logs/          #   Log files
│   └── files/         #   Downloaded and uploaded files
└── scripts/           # Installation and helper scripts
```

### Package Responsibilities

- **packages/core** -- Configuration loading, SQLite queue, shared TypeScript types, and agent invocation utilities.
- **packages/torrent** -- Wraps the WebTorrent library. Handles magnet/torrent parsing, download lifecycle, seeding, and progress tracking.
- **packages/server** -- Express-based HTTP server exposing REST endpoints and Server-Sent Events for real-time UI updates.
- **packages/main** -- Daemon bootstrap. Starts the queue processor, torrent engine, API server, and heartbeat monitor.
- **packages/cli** -- User-facing CLI built with Commander. Parses commands and communicates with the daemon via the REST API.
- **dashboard** -- Next.js 14 application providing a browser-based dashboard for torrent management, agent configuration, and live status monitoring.

## Configuration

Settings are stored in `.aitorrent/settings.json` and can be edited directly or through the web UI.

```json
{
  "workspace": {
    "path": "~/aitorrent-workspace",
    "name": "aitorrent-workspace"
  },
  "torrent": {
    "download_path": "~/aitorrent-workspace/downloads",
    "max_connections": 100,
    "upload_limit": 0,
    "download_limit": 0
  },
  "agents": {
    "aitorrent": {
      "name": "AITorrent Agent",
      "provider": "anthropic",
      "model": "opus",
      "working_directory": "~/aitorrent-workspace/aitorrent"
    }
  },
  "models": {
    "provider": "anthropic"
  }
}
```

## License

MIT
