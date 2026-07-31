# AGENTS.md

## Verifying

`npm run verify` — typechecks, then runs the tests.
It is the green gate for this repo, so a change is not done until it exits zero.

## Code Principles

These apply to every change in this repo.

- **Names say what a thing is** — no abbreviations, no `data`, no `tmp`, no single letters outside a one-line lambda.
- **One function, one job** — a function that validates and stores and formats is three functions.
- **Invalid input throws a named error** from `src/errors.ts`, rather than returning `null` or `undefined` to mean "that did not work".
- **A todo handed to a caller never changes** — state is replaced, not mutated, so code holding a `Todo` is holding what it was given.
- **No `any`, and no non-null assertion (`!`)** — if a type will not narrow, the type is wrong.
- **Every behaviour has a test** in `tests/` that fails without it.
- **One sentence per line in Markdown**, never soft-wrapped across lines.

## Agent skills

### Issue tracker

Issues live as GitHub issues for this repo (`miwurster/relay`). Use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
