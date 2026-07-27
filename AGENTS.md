# AGENTS.md

## Code Principles

These apply to **every** change — trivial or complex.

- We prefer simple, clean, maintainable solutions over clever or complex ones.
- Readability and maintainability are primary concerns.
- Self-documented names and code.
- Small functions.
- Follow single responsibility principle in classes and functions.

## Karpathy rules

These apply to **complex** tasks — new features, multi-file changes, anything non-trivial.
For trivial tasks, use judgment.

### Think before coding

Don't assume. Don't hide confusion. Surface tradeoffs.

- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### Simplicity first

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

### Surgical changes

Touch only what you must. Clean up only your own mess.

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- Remove imports/variables/functions that YOUR changes made unused; leave pre-existing dead code unless asked.
- Every changed line should trace directly to the request.

### Goal-driven execution

Define success criteria. Loop until verified.

- Turn tasks into verifiable goals: "Fix the bug" becomes "Write a test that reproduces it, then make it pass".
- For multi-step work, state a brief plan with a verify check per step.
- Strong success criteria let you loop independently; weak ones ("make it work") need constant clarification.

## Verifying

`npm run verify` — typecheck, ESLint, Prettier, tests.
It is the green gate for this repo, so a change is not done until it exits zero.
`npm run format` and `npm run lint:code:fix` fix what is mechanically fixable.

Never silence a lint rule to get to green.
If a rule is genuinely wrong for this repo, turn it off in `eslint.config.ts` with a comment saying why.
Inline suppression is a last resort and takes exactly one form, never file-wide and never bare:

```ts
// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- <reason>
```

## Markdown style

One sentence per line.
Do not soft-wrap sentences across multiple lines.

## Agent skills

### Issue tracker

Issues live as GitHub issues for this repo (`miwurster/relay`). Use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Serena MCP

Prefer Serena's semantic tools (symbol lookup, references, navigation, targeted edits) over raw file reads / grep when Serena is available.
See `docs/agents/serena.md`.

---

@README.md
