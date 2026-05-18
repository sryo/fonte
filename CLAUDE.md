# Fonte

See [AGENTS.md](./AGENTS.md) for the API surface, CLI reference, and agent runtime instructions. That's the canonical reference for both Fonte's runtime agent (it's injected as system prompt) and Claude Code working on this codebase.

## No Claude/Anthropic attribution in commits

This repo's `commit-msg` hook (in `.githooks/`) rejects any commit message containing a `Co-Authored-By` trailer that references the assistant or the vendor, or a generation footer crediting them. `npm install` activates the hook via the `prepare` script. The same rule also lives in `~/.claude/CLAUDE.md` as a global directive.
