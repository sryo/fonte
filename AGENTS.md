# Developing Fonte

Guide for agents working on this codebase. The runtime agent's built-in system prompt is a different file, `packages/core/prompts/agent.md`; it is not read during development and this file is not sent to the runtime agent.

## Package map

npm workspace `packages/*` plus a Next.js `dashboard/` with its own `node_modules` (not a workspace, no workspace dependencies). `npm run build` is `tsc --build` over the five packages; each compiles `src` to `dist`, and `@fonte/*` imports resolve to `dist` through the workspace symlinks.

| Package | What lives there |
| --- | --- |
| `packages/core` | Settings and paths (`config.ts`, `FONTE_HOME`), the SQLite queue in `fonte.db` (`queues.ts`: messages, responses, per-agent chat history), agent workspaces and system prompt building (`agent.ts`, runtime prompt in `prompts/agent.md`), provider CLI invocation (`invoke.ts`, `adapters/` for claude, codex, gemini, opencode), `@agent` routing (`router.ts`), memory, plugins, logging and the in-process event bus (`emitEvent`/`onEvent`), notifications (`notify.ts`). |
| `packages/torrent` | Everything media: Transmission RPC and `TorrentManager`, search across each configured source (`search-aggregator.ts`), TMDB, subtitles, posters, the watchlist (`watchlist-db.ts`, `watchlist-runner.ts`), automations (`automation-*.ts`), the WhatsApp service, and `torrents.db`. `src/types.ts` holds the canonical API wire types. |
| `packages/server` | Hono HTTP API (`startApiServer`). One file per area in `src/routes/`, mounted in `src/index.ts`. SSE at `/api/events` rebroadcasts every `emitEvent`. Binds `127.0.0.1:${FONTE_API_PORT:-3777}`. |
| `packages/main` | The daemon entry point: queue processor (claims messages, invokes agents, writes responses), starts the API server, `TorrentManager`, watchlist runner and automation engine. The port bind doubles as the single-instance lock. |
| `packages/cli` | `bin/fonte.mjs` dispatches subcommands to `packages/cli/dist/<area>.js`; sources in `src/`. Talks to the daemon over the HTTP API. `doctor` runs health checks. |
| `dashboard` | Next.js UI. API clients in `src/lib/api/<area>.ts` (base URL from `NEXT_PUBLIC_API_URL`, then localStorage `fonte_api_base`, then `http://localhost:3777`). `src/lib/api-types.ts` is a generated copy of the wire types. |

## Glossary

- **Agent**: an entry in `settings.agents` (`AgentConfig`: name, provider, model, `working_directory`). A turn spawns the provider's CLI in that directory. Each agent directory has its own user-editable `AGENTS.md` (empty by default) appended to the system prompt, plus `memory/` and a `reset_flag` that makes the next run start a fresh conversation.
- **Team**: `settings.teams`, a named set of agents with a leader; teammates are listed in each member's system prompt.
- **System prompt**: `buildSystemPrompt()` in `core/src/agent.ts` = `prompts/agent.md` (teammate and memory markers filled in) + `~/.fonte/SOUL.md` + the inline API and automations section + registered sections (live automations) + the agent's own `AGENTS.md` + `prompt_file` or `system_prompt`.
- **Message / channel**: a row in the `messages` table. `channel` says where it came from: `web` (dashboard), `api` (default for `POST /api/message`), `whatsapp`, `automation`.
- **Lane**: `user` (default) or `background`. Each agent claims user-lane messages first; automations enqueue on `background`, and the daemon pauses and re-queues a background run when a person has been waiting too long.
- **Rate-limit pause**: when a run hits a provider rate or usage limit, the message goes back to pending with `not_before` set to a minute after the reset the provider reported (or a 15-minute backoff, doubling to 2 hours, when it reported none), and `provider_pauses` holds every agent on that provider until then. The chat and the originating channel get one "Paused until HH:MM" note. A message held for over 12 hours in total is dead-lettered. Auth and billing failures are dead-lettered straight away.
- **Response channel**: an agent's reply is written to the `responses` table under the channel the message came from. A channel consumer delivers and acks it (the WhatsApp service polls `whatsapp`); `POST /api/responses` lets anything enqueue a reply on a channel. Acked responses are pruned after a day.
- **Automation**: a saved prompt plus a trigger (`event`, `cron`, `once`, or a `group` of those), stored in `torrents.db`. The engine enqueues an `[automation]` message on the `automation` channel, `background` lane. A reply of exactly `[quiet]` is dropped.
- **Watchlist**: entries the daemon keeps searching for. The runner checks enabled entries on an interval (default 30 minutes), records results, auto-adds matches, backs off failing entries, and learns from thumbs up/down feedback.
- **Event**: `emitEvent(type, data)` on the core bus, e.g. `torrent:completed`, `watchlist:results`. Consumed by SSE, notifications, and automation event triggers.
- **Plugin**: a module in `~/.fonte/plugins/` with incoming/outgoing message hooks.

## Ways to hurt the live install

The user's real Fonte runs from the main checkout, not from worktrees:

- The daemon is the launchd job `com.fonte.daemon`, running `packages/main/dist/index.js` of the main checkout on port 3777 with its data in `~/.fonte` (`settings.json`, `fonte.db`, `torrents.db`, logs, WhatsApp session). The dashboard is `com.fonte.dashboard` on port 3000.
- `fonte start|stop|restart` go through `launchctl` whenever the LaunchAgent plist exists, so they act on the live daemon no matter which checkout you run them from.
- The dashboard's `npm run build` has a `postbuild` that copies config files and rsyncs `public/` into `~/.fonte/dashboard-app`. Don't run it from a worktree.
- `FONTE_HOME` is read once, at import of `core/src/config.ts`. Anything that imports `@fonte/core` without it set writes to `~/.fonte`.
- The torrent backend is the user's Transmission at `127.0.0.1:9091`. A second daemon talks to the same one, so torrents it adds, pauses or removes are real.

For a manual run: `FONTE_HOME=$(mktemp -d) FONTE_API_PORT=3790 node packages/main/dist/index.js`, and point a dashboard dev server at it with `NEXT_PUBLIC_API_URL=http://localhost:3790 npm run dev -- -p 3100` from `dashboard/`. Tests never touch `~/.fonte`; the vitest global setup points `FONTE_HOME` at a temp dir and `core/src/test-home.test.ts` guards it.

## Adding a capability: hit every surface

A feature exists for the user only when every surface knows about it:

1. **Server route** in `packages/server/src/routes/<area>.ts` (new files are mounted in `src/index.ts`).
2. **CLI**: subcommand in `packages/cli/src/<area>.ts` and its dispatch case in `packages/cli/bin/fonte.mjs`.
3. **Dashboard**: client in `dashboard/src/lib/api/<area>.ts`, UI in `dashboard/src/components/<area>/`. New events also need a label in `dashboard/src/lib/event-presentation.ts`.
4. **Wire types**: edit `packages/torrent/src/types.ts`, then `npm run sync:types`. `api-types-sync.test.ts` fails when the dashboard copy drifts.
5. **Runtime prompt**: document the endpoint in `packages/core/prompts/agent.md`, and in the inline API and automations section of `buildSystemPrompt()` if it belongs there. `core/src/agent-prompt.test.ts` holds a byte budget for the built prompt; raise it deliberately if the addition is worth it.
6. **Watchlist runner**: if the capability changes how releases are searched, ranked, or added, make sure `watchlist-runner.ts` goes through the same path.
7. **Automations**: a new event that rules can trigger on goes in `AUTOMATION_EVENT_NAMES` and `AUTOMATION_EVENT_LABELS` (`automation-trigger.ts`), `describeEvent` (`automation-prompt.ts`), the event list in `dashboard/src/lib/api/automations.ts`, and the trigger list in `buildSystemPrompt()`.
8. **Settings**: a new setting goes in `Settings` (`core/src/types.ts`) and `SETTINGS_SHAPE` (`core/src/config.ts`), which warns on bad values when reading and rejects them on write.

## Verifying

- `npm run check` runs `tsc --build`, `tsc --noEmit -p dashboard` and the whole vitest suite.
- Focused: `npx vitest run <path>`, `npx tsc --build packages/<pkg>`, `npx tsc --noEmit -p dashboard`.
- Tests in other packages import `@fonte/core` (and `@fonte/torrent`) from `dist`. After changing core, run `npm run build` (or `npx tsc --build packages/core`) before running server or torrent tests.

## Test rules

- Test first: a failing test, then the code.
- Temp dirs for everything on disk (`fs.mkdtempSync(path.join(os.tmpdir(), ...))`), removed afterwards. Never the real `FONTE_HOME`.
- Inject fakes instead of reaching the network or real services. `packages/testing/` has HTTP fakes for Transmission RPC, torznab sources and TMDB, plus a fake provider CLI; tests import them by relative path (see its README).
- Module state that reads env at import (`FONTE_HOME`, DB paths) needs `vi.stubEnv` plus `vi.resetModules()` and a dynamic import.

## Commit rules

- No Claude or Anthropic attribution anywhere: no `Co-Authored-By` trailer, no generation footer, no `noreply@anthropic.com`. The `commit-msg` hook in `.githooks/` rejects them; `npm install` activates it through the `prepare` script.

## UI and code style

- Sentence case for buttons, titles and labels; proper nouns keep their capitals.
- Plain periods between clauses in UI copy, never em dashes.
- No global toasts. Feedback happens at the element acted on or its originating surface.
- Shortcut hints sit inline on the element (kbd badge, tooltip), never in a central shortcuts list. Conventional keys get no hint.
- Settings fields auto-save on change or blur with row-level feedback; explicit Save only for SOUL.md and raw JSON.
- No comments by default. Keep one only if a future edit would go wrong without it, and never reference tasks or fixes.
- Packages use 4-space indent and single quotes; the dashboard uses 2-space indent.
- Never name torrent sites or indexers in docs or prompts; say "each configured source".
