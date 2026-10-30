# Runtime agent behaviour evals

Checks how the runtime agent (a provider CLI run with Fonte's system prompt and unrestricted Bash) behaves on a fixed set of requests, by looking at the API calls it makes and its final answer. No daemon, no Transmission, no network: a fake `curl` first on PATH answers every request with canned JSON and logs it.

The vitest suite here (`npx vitest run evals`) never runs a real provider and costs nothing. Running the evals themselves is manual and spends provider usage.

## Running

```bash
npm run build                                   # the runner loads @fonte/core and @fonte/torrent from dist
node evals/agent-behavior/run.ts --provider anthropic --model sonnet
```

Node 23.6 or later runs the `.ts` files directly. Options:

| Flag | Default | |
| --- | --- | --- |
| `--provider` | `anthropic` | `anthropic`, `openai`, `gemini` or `opencode`, the same adapters the daemon uses |
| `--model` | the provider's default agent model | passed through `resolveModel`, so aliases like `sonnet` work |
| `--samples` | `2` | runs per case, at least 2 |
| `--case` | every decided case | comma-separated ids, repeatable; naming an undecided case runs it |
| `--include-undecided` | off | also run the undecided cases |
| `--timeout` | `300` | seconds per run |
| `--verbose` | off | core logs, plus each failed or undecided sample's commands and answer |
| `--keep` | off | keep the temp work dir (calls logs, canned responses, workspaces) |

The exit code is 1 when a decided case fails, 2 when the run could not start.

The runner doesn't read `~/.fonte/settings.json`, so a token saved with `fonte provider anthropic --oauth-token` isn't used. The CLI's own sign-in is, or export `CLAUDE_CODE_OAUTH_TOKEN` (or the provider's API key variable) for the run.

### Cost

A run is one probe plus `cases x samples` CLI invocations, each a full agent turn with its own tool calls. The defaults (9 decided cases, 2 samples) make **19 invocations**, or 21 with `--include-undecided`. Each run takes about 15 to 60 seconds, and runs go one at a time.

## How a run works

1. One throwaway `FONTE_HOME` per process, created before `@fonte/core` is imported. The runner refuses to go on if core was loaded with any other home. `torrents.db` lives there too, so the system prompt's automations section comes from the real `renderAutomationsSection`.
2. A probe asks the agent to `curl` `/api/status`. If that call doesn't reach the fake curl, the run stops before any case. A leaked probe would only be a read-only GET.
3. For each case and sample: a fresh dir with the fake `curl` (and a `wget` that refuses), its calls log, the canned responses, and a workspace. The runner prefixes PATH and points `CLAUDE_ENV_FILE` at a script that prefixes it again, since Claude Code sources that before every Bash command, after the user's shell snapshot. Then it calls the daemon's own `invokeAgent` (same flags, `--system-prompt` from `buildSystemPrompt`, stream-json, fresh conversation). Automation cases build their message with the real `buildWakePrompt` and seed the rule in `torrents.db`.
4. The grader checks the calls log and the final answer. A decided case fails when at least half its samples fail. A sample that errors or times out counts as failed.

## Cases

`cases/*.json`, one per behaviour. Fields:

- `message`, or `automation` (`rule`, `fired`: `event | schedule | manual`, `events`, `firedAt`) for a rule firing.
- `responses`: canned answers, first match wins, then the defaults in `cases.ts` (status, empty torrent and watchlist lists, and so on). Anything unmatched gets the daemon's own `404 {"ok": false, "error": "Not found"}` and is logged with `matched: false`. Hosts other than localhost fail like an unresolvable host.
- `expectation`: `pass`, or `undecided` when the prompt contradicts itself. An undecided case has a `note` and `observe` entries whose tallies are reported, and it never fails.
- `assert`: `called` (with `min`/`max`, and `match` may be a list of alternatives), `notCalled`, `before`, `onlyCalls`, `text`, `mentions`, `quiet`. Each can carry a `why`, which leads its failure message.
- `golden` and `bad`: hand-written runs that must pass and must fail. The vitest suite grades them, so a case's assertions are known to be satisfiable and not vacuous.

Matchers: a string `path` is a route pattern (`/api/torrents/:id`, trailing `*`). Values match loosely (`5` matches `"5"`), objects match as subsets, and `{"$regex": "...", "$flags": "i"}`, `{"$exists": bool}`, `{"$in": [...]}` and `{"$not": ...}` test a value. `$regex` on an object tests its JSON.
