# Fonte

See [AGENTS.md](./AGENTS.md), the developer guide for working on this codebase: package map, glossary, how not to hurt the live install, the surfaces a new capability must reach, and how to verify. Fonte's runtime agent gets a different file as its built-in system prompt, [packages/core/prompts/agent.md](./packages/core/prompts/agent.md), which holds the API surface and CLI reference the agent uses.

## No Claude/Anthropic attribution in commits

This repo's `commit-msg` hook (in `.githooks/`) rejects any commit message containing a `Co-Authored-By` trailer that references the assistant or the vendor, or a generation footer crediting them. `npm install` activates the hook via the `prepare` script. The same rule also lives in `~/.claude/CLAUDE.md` as a global directive.
