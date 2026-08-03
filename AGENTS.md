# AGENTS.md

## Coding standards

How code is written here: @CODING_STANDARDS.md

Those rules are normative and apply to **every** change — trivial or complex.

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

## Agent skills

### Issue tracker

Issues live as GitHub issues for this repo (`miwurster/relay`). Use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

---

@README.md
