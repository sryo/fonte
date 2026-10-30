# Improvement log

Branch `claude/improve-swarm-640541`. Source plan: `docs/plans/t3code-adoption.md` (untracked in the main checkout). Phase 0 of that plan runs in another session and is out of scope here.

Each entry: what changed, how it was verified, what was deferred and why.

## Baseline

- `npx vitest run`: 52 files, 537 tests pass. `torrent-manager.test.ts` "moves sidecar subtitle files to the Trash" failed once under load and passed on the next two runs. Left alone: that file is part of the user's own uncommitted work.
- Worktree setup needs the main checkout's `package-lock.json` and `dashboard/package-lock.json` copied in, since both are gitignored (plan item 2.3).

## Done

### vitest config and `npm run check`
- `vitest.config.ts` excludes `.claude/**`, `**/dist/**`, `**/.next/**` on top of the defaults.
- `npm run check` runs `tsc --build`, `tsc --noEmit -p dashboard`, `vitest run`.
- Verified: `npm run check` green (537 tests).

### Test runs no longer write into the live install
- Reported by the parent session: the live `~/.fonte/logs/queue.log` held 272 lines of test searches ("show", "show 2024") since Sep 2. Tests that log through `@fonte/core` without setting `FONTE_HOME` resolved it to `~/.fonte`.
- `vitest.global-setup.ts` creates a temp `FONTE_HOME` (with `logs/`, since `log()` throws when the folder is missing) for every run and removes it after. `packages/core/src/test-home.test.ts` fails if `FONTE_HOME` or `LOG_FILE` resolves under `~/.fonte`.
- Verified: the guard test failed before the change and passes after; a full `vitest run` added 0 lines to the live `queue.log`.
- Not covered: `~/fonte-workspace` (default agent workspace from `os.homedir()`) is not redirected. No test was seen writing there; redirecting `HOME` for the whole suite would affect the Trash test, so it was left alone.

### SSE: event ids, replay, heartbeat, backpressure (plan 4.3)
- All in `packages/server/src/sse.ts`; `index.ts` (Phase 0 file) unchanged. Replay reads `Last-Event-ID` from `res.req`.
- Wire format: `id: <epoch>-<seq>` on every event; epoch changes per daemon start, so ids from an earlier run resync instead of replaying the wrong events. 200-event ring buffer. `event: resync` goes only to the reconnecting client when the gap is too big, the backlog exceeds 1 MiB, the id is foreign or ahead. `: ping` every 25s from one shared unref'd interval. Clients over 1 MiB of buffered writes are destroyed so they reconnect.
- Verified: 23 tests in `sse.test.ts`, including a real `node:http` server with a raw client (replay, foreign-epoch resync, a paused client dropped while a reading one gets everything). Server suite 75/75.
- Browser check: a probe page on 127.0.0.1:4100 with an EventSource to the built `sse.js` on 127.0.0.1:4101 (cross-origin, like dashboard to daemon). After the server killed the connection, Chromium reconnected with `Last-Event-ID: <epoch>-5` and no preflight, and the page received ids 1 to 23 with no gap.
- Deferred: `?types=` server-side filter (not needed once the dashboard shares one stream).

### Dashboard: one EventSource per tab, polling pauses when hidden (plan 4.1, 4.2 part)
- `dashboard/src/lib/event-hub.ts`: ref-counted shared stream; listeners for the union of subscribed types; `onResync` fires on server `resync` and on every reopen after the first; reopens after 5s if the browser gives up (readyState CLOSED). `subscribeToEvents` keeps its signature and gains `onResync`, used by the agent chat and the automation modal.
- `dashboard/src/lib/visibility-poller.ts`: `usePolling`, `usePollingEffect` and the agent chat poll stop while `document.hidden`, tick once on return, never overlap ticks, and `usePolling` backs off up to 30s on consecutive failures.
- Verified: 27 unit tests with a fake EventSource, fake document and fake timers; dashboard `tsc --noEmit` and eslint clean.
- Not run in a browser against a full daemon: starting one would sync against the real Transmission on 9091.
- Behaviour change: polling now waits for the previous request. `apiFetch` has no timeout, so a request the daemon accepts and never answers pauses that one poller until it settles (before, `setInterval` kept stacking requests).
- Deferred: driving the status strip from `torrent:stats` instead of polling the full torrent list (plan 4.2 second half).

### Direct WhatsApp notifications (plan 4.5)
- `notifications.destinations.<event>` is `mac | whatsapp | both` (missing = `mac`, so nothing changes until the user picks). WhatsApp alerts are queued with `enqueueResponse` on the `whatsapp` channel to `whatsapp.allowed_chat`; the existing response poller delivers them. No chat picked: falls back to the Mac and logs one WARN.
- `POST /api/notifications/test` takes `{ destination }`; the dashboard test button sends to every destination the enabled events use. Settings card: a Mac / WhatsApp / Both segmented control per enabled event, auto-saved, with an inline note when no chat is picked or WhatsApp isn't linked.
- Touches Phase 0 file `packages/core/src/config.ts` with one line (the `destinations` entry in `SETTINGS_SHAPE`), in its own commit `Accept notification destinations in settings validation`. Without it `PUT /api/settings` rejects every destination change. Checked that Phase 0's uncommitted `config.ts` hunks (lines 107+) don't overlap it.
- Verified: 13 notify tests, 7 route tests, 14 dashboard helper tests, a settings-validation test (failed before the shape line); dashboard tsc and eslint clean. Not checked in a browser, and no real WhatsApp message sent.

### Shared test fakes (plan 2.7)
- `packages/testing/`: plain modules imported by relative path (no workspace package, so no `npm install`). Transmission RPC fake with the 409 handshake and session rotation; Torznab/Jackett fixture server (XML and the JSON results endpoint jackett-client really uses); TMDB fetch stub with fixtures; `writeFakeCli` replaying recorded Claude and Codex stream-json.
- Verified against real code: `TransmissionRpc` (10 tests, first tests it ever had), `searchJackett` (4), `searchTmdb` (4), the Claude and Codex adapters on the recordings (7).
- Noted, not changed: `TransmissionRpc.call` retries once on `fetch failed`, so a dropped connection after Transmission accepted a `torrent-add` could send it twice.

### `fonte doctor` (plan 3.7, read-only part)
- `packages/cli/src/doctor-checks.ts` + `doctor.ts`, `fonte doctor [--json]`. 12 checks; each prints a fix; exit 1 on any fail. Opens databases `readonly`, calls no launchctl, writes nothing.
- Verified: 62 tests (including one asserting FONTE_HOME is byte-for-byte unchanged after all checks); smoke run on an empty temp home; one read-only run on the real install, which found:
  - fail: `~/.fonte/cli-path` points at `~/Documents/aitorrent/packages/cli/bin/fonte.mjs`, which no longer exists.
  - warn: the daemon launch agent runs code from `~/Documents/fonte` (plan 3.2).
- Deferred: `--fix` (it would write to the live install; needs the user's call). `packages/cli/package.json` doesn't declare `better-sqlite3`; doctor imports it dynamically and gets the hoisted copy.

### Versioned SQLite migrations, backups, pragmas (plan 3.4, 3.5)
- `packages/core/src/sqlite-migrate.ts`: `runMigrations` on `PRAGMA user_version`, one transaction per migration, `VACUUM INTO` backup to `FONTE_HOME/backups` (keep 3 per db) before any pending migration on an existing db, refuses a db from a newer build. `applyPragmas` (WAL, busy_timeout, `synchronous=NORMAL`, `checkpoint_fullfsync=ON`, 64 MiB `journal_size_limit`), `maintainDb` (`optimize` then `wal_checkpoint(TRUNCATE)`).
- `fonte.db` and `torrents.db`: today's schema plus the old ad-hoc ALTERs (including the `DROP COLUMN`s) are migration v1, idempotent for any pre-versioning shape. Future changes append v2+.
- Verified: 25 new tests (fresh, legacy-shape, up-to-date, failing migration rollback, newer-version refusal, pruning, pragma readback, WAL truncation). Snapshots of the live `fonte.db` and `torrents.db` (taken read-only with the SQLite backup API into the scratchpad) migrated to v1 with identical row and column counts in every table, one v0 backup each, and no new backup on a second open.
- Trade-off: `synchronous=NORMAL` can lose the last commits on power loss (no corruption in WAL mode).
- Pending until Phase 0 lands on main:
  - `torrent-db.ts` and `db-connection.ts` deep-import `@fonte/core/dist/sqlite-migrate` because `core/src/index.ts` is off-limits. Then: add `export * from './sqlite-migrate';` to the barrel and import from `@fonte/core`.
  - Wire `maintainQueueDb()` and `maintainTorrentDb()` into the 60s `maintenanceInterval` in `packages/main/src/index.ts`.
- First deploy will write two small backups (~1 MB) into `~/.fonte/backups`.

## Environment notes
- The worktree's `npm ci` failed on puppeteer's browser download and rolled back, so third-party packages resolved from the main checkout's `node_modules` (the worktree sits inside it). `@fonte/*` still linked to the worktree's own packages, so tests exercised this branch. Reinstall with `PUPPETEER_SKIP_DOWNLOAD=1 npm ci`.

### Split AGENTS.md (plan 2.1) and prompt size budget (plan 2.6)
- Runtime prompt moved byte-for-byte to `packages/core/prompts/agent.md` (`cmp` against `HEAD:AGENTS.md`); `agent.ts` reads it relative to `__dirname`, which works from `src` and from `dist`. Root `AGENTS.md` is now a developer guide; `CLAUDE.md` points at both.
- `agent-prompt.test.ts`: source file, no dev-guide text in the built prompt, and a byte budget (15104; today 15065) for the full built prompt of a fixture agent.
- Pending until Phase 0 lands: `POST /api/setup` in `server/routes/settings.ts` copies `SCRIPT_DIR/AGENTS.md` into `FONTE_HOME`, which would now copy the dev guide. Nothing reads that copy; drop `'AGENTS.md'` from `templateItems`.

### Dev builds and runs stay off the live install (plan 2.2)
- Dashboard `postbuild` is `scripts/postbuild.mjs`: syncs into `${FONTE_HOME:-~/.fonte}/dashboard-app` (same three files and `rsync --delete public/` as before), `FONTE_SKIP_DEPLOY=1` skips. Unset FONTE_HOME behaves as today; a test asserts the `.next` and `node_modules` symlinks in dashboard-app are untouched.
- `buildSystemPrompt` substitutes `http://localhost:3777` with the `FONTE_API_PORT` base; with the port unset the built prompt is byte-identical to the previous build (checked with `cmp`, 14919 bytes). Dashboard default API base also follows `FONTE_API_PORT` (passed through `next.config.ts` `env`).
- Verified: tests failed first, then 387 pass across core, dashboard and cli; a manual `FONTE_HOME=<scratch> npm run postbuild` wrote only to the scratch home and left `~/.fonte/dashboard-app` unchanged. Dashboard `npm run build` was not run.
- Limit: in the main checkout `dashboard/.next` is itself a symlink into `~/.fonte`, so `next build` there still writes live output whatever FONTE_HOME says. Fixing that needs a FONTE_HOME-keyed `distDir`; left for the user.
- Pending until Phase 0 lands: move `apiBaseUrl()` to `config.ts`, export it, and use it in `cli/src/shared.ts` and `server/src/index.ts`.

### Runtime-agent evals (plan 2.5)
- `evals/agent-behavior/`: the runner calls the daemon's own `invokeAgent` (same flags, `--system-prompt`, stream-json) with a fake `curl` first on PATH that logs every API call and answers from canned per-endpoint JSON, so no daemon or HTTP is involved. A probe call aborts the run if curl isn't intercepted. Grader: a case fails when at least half its samples fail (min 2 samples).
- Ten cases: search before asking; empty search goes to the watchlist; magnet added directly; "season 5" passes `season`; "remove it" never sends `deleteFiles`; instructions inside an event payload are ignored; `[quiet]` when nothing to report; report when something stalled; status question makes no writes; and one undecided case (see decisions).
- Verified: 33 tests (fake curl spawned for real, grader on golden and bad runs, end-to-end runner with a replayed CLI that really calls the fake curl). The real provider was never run. Manual run: `npm run build && node evals/agent-behavior/run.ts --provider anthropic --model sonnet` (19 CLI invocations).
- The end-to-end test timed out at vitest's 5s default under full-suite load in 3 of 6 runs; it now has a 30s timeout and passed 4 of 4 full runs.

### New agents no longer get a copy of the checkout's `.claude` folder
- Found by the evals agent. `ensureAgentDirectory` copied `SCRIPT_DIR/.claude` into every new agent dir. Nothing under `.claude` is tracked, so it copied the developer's own folder: `settings.local.json` (dev permissions), notes, and every git worktree (813 MB in the main checkout today). Removed; `syncAgentSkills` still creates the `.claude/skills` link.
- Verified: `agent-dir.test.ts` failed before (listed `RESUME.md`, `launch.json`, ...) and passes after.
- Live install already affected: `~/fonte-workspace/fonte/.claude/` holds a Jul 26 copy (`worktrees/blissful-bose-bbc147`, `settings.local.json`, `launch.json`, 4.3 MB). Left alone; deleting it is the user's call.

## Final state
- 13 commits on `claude/improve-swarm-640541`. `npm run check`: 75 files, 785 tests, `tsc --build` and dashboard `tsc --noEmit` clean.

## Needs the user's decision
1. Runtime prompt contradiction: with search results, add the best one ("Don't ask, act", rule 2, default SOUL) or present the top 3 to 5 and wait for a pick. The eval case `results-add-or-present` stays ungraded until decided.
2. ~~Smaller prompt gaps from the evals~~: the user chose to close them on 2026-10-30. See "Prompt gaps closed" below.
3. ~~Live install cleanup~~: done 2026-10-30 at the user's request. `~/.fonte/cli-path` now points at `~/Documents/fonte/packages/cli/bin/fonte.mjs`; the stray `~/fonte-workspace/fonte/.claude` folder was moved to the Trash (`~/.Trash/fonte-agent-stray-claude-20261030-075509`), unused since the agent runs with `--dangerously-skip-permissions`. The branch was fast-forwarded into `main` and deployed the same day; the first start wrote `fonte-v0-*.db` and `torrents-v0-*.db` into `~/.fonte/backups`. `fonte doctor`: all ok except the warning that the daemon runs from `~/Documents`.
4. Whether to make `next build` in the main checkout safe too (its `.next` is a symlink into `~/.fonte`), via a FONTE_HOME-keyed `distDir`.
5. Paid eval run: not run; costs 19 provider invocations on the user's sign-in.

## Pending until Phase 0 lands on main (then sync this branch)
- `core/src/index.ts`: `export * from './sqlite-migrate';`, then switch the two deep imports in `torrent/src/{torrent-db,db-connection}.ts` to `@fonte/core`.
- `main/src/index.ts`: call `maintainQueueDb()` and `maintainTorrentDb()` in the 60s maintenance interval.
- `server/routes/settings.ts`: drop `'AGENTS.md'` from the `/api/setup` `templateItems`.
- `core/src/config.ts`: host `apiBaseUrl()` there and use it from `cli/src/shared.ts` and `server/src/index.ts`.
- `config.ts` already carries one line from this branch (notification `destinations` shape), in its own commit; Phase 0's hunks don't overlap it.
- Then plan step 3: `--resume <session id>` per agent, `freshSession`, `not_before` usage-limit resume, stall watchdog, then MCP tools (ask first).

## Not done, and why
- Status strip driven by `torrent:stats` (plan 4.2 second half), typed event map (4.4), composer and chat items (4.6 to 4.16): beyond this pass's list; 4.6 should come before the chat items.
- `fonte doctor --fix`: writes to the live install.
- Version handshake (3.1), crash visibility (3.8), log rotation (3.6): need Phase 0 files (`main/src/index.ts`, `server/src/index.ts`).
- CI workflow and committing `package-lock.json` (2.3): the lockfile is gitignored on purpose today; changing that is the user's call.

## After Phase 0 landed (merged local main at 2677962)

### Sync
- Merged local `main` (Phase 0 is not on `origin`). Clean merge; the `.claude` copy fix and the `config.ts` destinations line survived. One test expectation updated: Codex now gets `--` before the message.

### Phase 0 follow-ups
- `/api/setup` no longer copies `.claude`, `heartbeat.md` or `AGENTS.md` from the checkout into `FONTE_HOME`. Only `.claude` ever existed, and it was the developer's own folder (same bug as the agent-dir copy). Test failed first.
- `sqlite-migrate` is in the `@fonte/core` barrel; the torrent package's two deep imports are gone. The 60s maintenance tick runs `maintainQueueDb()` and `maintainTorrentDb()` inside a try/catch that logs a WARN.
- `apiPort()` and `apiBaseUrl()` in `config.ts` are the single source for the server, the CLI and the prompt builder. Tests for default and override.

### Stall watchdog (plan 1.3)
- `runCommandStreaming` arms a timer at spawn and on every stdout or stderr chunk. On expiry it settles with `AgentRunError('stalled')` and stops the process group through the existing `terminateGroup`. Default 15 minutes (Claude's Bash tool can be silent up to 10), `FONTE_AGENT_STALL_MINUTES` overrides, 0 disables.
- Stalled runs dead-letter like every other `AgentRunError` (no automatic retry), and the user gets "<Provider> stopped responding, so I stopped it. Try again." The dashboard keeps the `stalled` reason.
- Verified: 12 tests with `writeFakeCli` (silent CLI killed with its background child, progress and stderr keep it alive, timers cleared on exit, stall vs SIGKILL distinguishable, end to end through the Claude adapter); a mutation check (removing the re-arm fails the progress tests).
- Not verified against the real CLI: that stream-json prints nothing during a long tool call (a live probe was refused by the sandbox classifier).

### One provider session per agent and lane (plan 1.1)
- `agent_sessions(agent_id, lane, provider, session_id)` (queue migration v2). `runInAgentSession` in `packages/core/src/agent-session.ts`: explicit fork id wins, else the lane's stored id if recorded by the same provider; reset clears both lanes; any announced session is recorded even if the run fails (the provider already holds that turn); a "no conversation found" failure clears the lane and retries once fresh.
- Claude: `--resume <id>` or nothing (no more `-c`). Codex: `exec resume <id>` or plain `exec` (no more `resume --last`), and it now reports `thread.started.thread_id`, so it gets continuity and edit-and-rerun forks. OpenCode keeps `-c` (session flag unverifiable here). Gemini unchanged (never continued).
- Automations get one rolling background session per agent and no longer continue the user's chat. `getAgentMessages` exposes `sessionId` for user-lane rows only, so edit-and-rerun can't fork from an automation's session.
- Migration seeds each agent's user lane from its latest user-lane message with a session id (provider `anthropic`). Agents idle more than 24 hours (rows pruned) or on a `custom:` provider start one fresh chat after deploy.
- Unverified: Codex's wording for a missing session id (guessed in `MISSING_SESSION_RE`). If it differs, a stale Codex id fails every turn until the agent is reset. Check with `codex exec resume <bogus-uuid> --json`.

### `freshSession` (plan 1.1)
- Documented in the runtime prompt, never implemented. `POST /api/message` with `freshSession: true` now runs that message in a new conversation and leaves the lane's stored session untouched (queue migration v3 adds `fresh_session`).

### Usage-limit auto-resume (plan 1.2)
- `rate_limit` failures no longer dead-letter. `planRateLimitRetry` (`packages/core/src/rate-limit-retry.ts`): known future reset holds the message until reset + 60s; unknown or past reset backs off 15, 30, 60, 120 minutes (cap 2h); a message held over 12 hours in total dead-letters as before. `billing` and `auth` still dead-letter at once.
- Queue migration v4: `messages.not_before`, `paused_ms`, `unknown_resets`, and `provider_pauses(provider, until)`. Claims and `getPendingAgents` skip held rows; `processQueue` starts no run for an agent whose provider is paused, and a running chain re-checks before each claim. `retryDeadMessage` clears the hold fields.
- Reset time: Claude's `api_error_params.rate_limit_info.resetsAt`, else the last rejected `rate_limit_event` (not for `overloaded`), else text (`usage limit reached|<epoch>`, "resets 3pm (Europe/Madrid)", Codex "try again at 3:42 PM", "try again in 2 hours"). "You've hit your 5-hour limit" now classifies as `rate_limit`.
- User sees one note in the chat and on the originating channel: "Paused until 15:00. Claude's usage limit resets then." or "Paused until 13:35. Claude is rate limiting, so I'll try again then." `agent:paused` is emitted and the agent chat refetches on it.
- Verified: tests for the planner, the notice formatter, queue holds and pauses (including a v3 to v4 migration), and adapter parsing via `writeFakeCli`. All provider fixtures are synthetic (strings taken from the installed Claude Code 2.1.312 and codex-cli 0.154.0 binaries); no real limit was hit. `main/index.ts` wiring is type-checked only; the daemon wasn't run end to end (it would sync against the real Transmission).
- Behaviour to know: 429 and 529 "overloaded" now also pause the whole provider for at least 15 minutes. Each re-hit sends a fresh notice (up to about six over 12 hours for an unknown reset). A new chat message to a paused provider waits silently as pending; there's no dashboard banner or "resume now" control yet.

## Status after the runtime pass
- `npm run check` green: see the commit list (`git log main..HEAD`).
- Not started, needs the user's go-ahead: fonte actions as MCP tools (plan 1.4), a large re-architecture.

## Prompt gaps closed (user's decision 2, 2026-10-30)
- Magnet: rule 4 names `POST /api/torrents {"magnetUri"}` for a pasted magnet and `POST /api/search` for a bare hash; the magnet example under search is gone. The search route still accepts magnets, and eval case 03 still accepts either route.
- Subtitles: the daemon already fetches them on completion when `subtitles.enabled` and `subtitles.auto_download` are on (`handleTorrentCompleted`), so the prompt now says that, points at `GET /api/settings`, and tells the agent not to refetch. "Downloads via Subdl" was wrong (the code uses OpenSubtitles) and is gone.
- Quality: search and the watchlist both default to 1080p when `quality` is omitted (FLAC for music on the watchlist), so rule 6 says to omit it unless the user names one.
- Season on the watchlist: documented `{"mediaType": "tv", "seasonPattern": "S05"}` and that `mediaType` defaults to `movie`. New eval case 11 checks a season with no results is watched that way.
- Budget: the built prompt fit the 15104-byte budget only after cutting four search-internals bullets (query variations, dedupe, title filter wording, IMDB resolution) down to two.
- Verified: 4 new prompt tests failed before and pass after; case 11's golden passes and both bad runs fail. `npm run check`: 88 files, 897 tests. The real provider was not run.

## Agent panel (plan 4.6, 2026-10-30)
- One chat component: `dashboard/src/components/agent/conversation.tsx` holds `AgentTranscript`, `AgentComposer`, `useChatComposer` and `composerButton`. The side panel (`chat-panel.tsx`) and the agent page (`agent/chat-view.tsx`) are now thin shells with a `panel` or `page` layout; each keeps its look (bubbles in the panel, author rows on the page).
- What changed for the user: the panel now stays on the newest message as replies stream in (it only jumped to the bottom on open before). The agent page shows the "Working…" timer too. Both use one empty state ("No messages yet. Ask the agent anything below") and one placeholder ("Message <agent>…").
- Agent page layout: the chat never had a height, so the whole page scrolled and follow-bottom couldn't work there either (true on the live build too). The page is now a flex column, so the transcript scrolls inside it and the composer sits at the bottom of the window.
- The panel's backdrop fade is unchanged. The user said there was never a rule against it; the memory note claiming one was deleted.
- Tests: `conversation.test.tsx` (19, server-rendered, both layouts), written before the component. Root `vitest.config.ts` now resolves the dashboard's `@/` alias so component tests can import it. `npm run check`: 89 files, 916 tests.
- Verified by hand in Chrome against an API-only server on port 3901 with a temp FONTE_HOME and seeded messages (the full daemon would talk to the real Transmission, whose address is hardcoded): the agent page opens at the newest message with the composer pinned, sending keeps it at the bottom and shows the timer, and the panel opens at the bottom with the input focused and one edit button. The built-in browser pane couldn't check scrolling, since it pauses animation frames while hidden.
- Not deployed.

## Disconnected notice at the composer (plan 4.8, 2026-10-30)
- When the chat's poll has failed for 5 seconds, the composer shows "Can't reach the daemon. Messages send when it's back." It is the same in the panel and on the agent page, and it clears on the first successful poll.
- To make that copy true, a send that fails because the daemon is unreachable (fetch threw a `TypeError`) now stays "Sending" and is resent, in order, after the next successful poll. A send the daemon rejected still shows "Couldn't send" with Retry. Resends reuse the same messageId, so the daemon's duplicate check keeps them from landing twice. Outbox rules moved to `dashboard/src/lib/outbox.ts`.
- The agent page's "Connected / Disconnected" dot is unchanged and still flips on the first failed poll.
- Tests: `lib/outbox.test.ts` (6) and two composer cases, written first. `npm run check`: 90 files, 924 tests.
- Verified by hand against the API-only test server: after the API stopped, the notice appeared at 6s (absent at 0 to 5s). A message sent while it was down showed "Sending", then reached the server exactly once within one poll of the API returning, and the notice cleared.
- Not deployed.
