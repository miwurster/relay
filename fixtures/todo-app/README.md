# todo-app

A tiny in-memory todo core: add a todo, read one, rename it, complete it, reopen it, remove it, list them all or by filter.
No UI, no HTTP layer, no persistence — just the domain and its tests.

This is the fixture repo a **rehearsal** seeds.
Nothing here is relay's source: it is a target repo, small enough to read in a minute, standing in for the repos relay actually runs passes on.
It is committed inside relay so that a change to the fixture is reviewable in the same pull request as the change it exists to judge.

It carries the agent-facing docs a target repo is expected to carry, and it carries them truthfully:

- `AGENTS.md` declares `npm run verify` as the green gate, which is the command that really is its gate, and states code principles the review's `standards` axis can measure this repo's own code against.
- `CONTEXT.md` is the glossary for the domain above.
- `docs/agents/issue-tracker.md` is the tracker doc every relay pass requires.
- `.relay/config.ts` declares `merge` landing.

## Running it by hand

From this directory, outside any sandbox:

```sh
npm ci
npm run verify
```

`npm ci` rather than `npm install`, because the committed lockfile is what makes an install reproducible and `install` is allowed to rewrite it.

`verify` typechecks and runs the tests, and finishes in a few seconds on a warm install.
That matters: a rehearsal runs the gate twice — once as the gate leg, once as the **lander**'s re-run under `merge` landing — and a slow gate would be what a rehearsal's wall clock measures instead of the flow.

## What is committed and what is not

- **Committed**: the source and its tests, `package.json`, `package-lock.json` (so an install inside a sandbox is reproducible rather than resolving fresh), `tsconfig.json`, `vitest.config.ts`, the four docs above.
- **Not committed**: `.relay/Dockerfile`.
  The seed copies it in from relay's shipped `src/resources/sandbox-recipes/node.Dockerfile` at seed time, because a rehearsal that proved a *committed copy* of the recipe would prove nothing about the recipe users get — the copy can rot green while the shipped one breaks.
  It is gitignored as well as absent, because a `merge` landing refuses a dirty worktree and the copied-in recipe would be untracked.
- **Not committed**: `.relay/.env`.
  A pass reads its credentials from the environment it is run in, and a rehearsal's clone is not somewhere a secret belongs.
- **No `packageManager` field** in `package.json`.
  Plain npm, and a pin would send Corepack fetching a package manager inside the sandbox.
