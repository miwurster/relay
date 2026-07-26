# 0006. Static analysis is part of green

- **Status:** accepted
- **Date:** 2026-07-26

## Context and Problem Statement

relay carried no linter.
`npm run lint` aliased `tsc --noEmit`, purely to satisfy the fixed `npm run lint` step of the shared `compile-typescript` CI component.

That matters more here than in a repo written by humans.
relay's own code is written mostly by **cold sessions** — each **leg** starts with no memory of the last, so nothing but a gate keeps the code converging on one shape.
And the bugs a **leg** is most likely to leave behind are the ones types do not catch: a floating promise in a `Promise`-heavy harness, an `it.only` left in a test file that makes the suite pass by running one test.

## Decision Drivers

- The bug classes that actually threaten this codebase are promise misuse and silently narrowed tests, not style.
- The **green gate** decides whether a branch is handed over; whatever is not in it does not gate a **pass**.
- The shared CI component calls exactly `npm run lint`, `npm run test`, `npm run build` — anything unreachable from those three is ungated.
- Configuration a **leg** has to reason about is configuration that will drift.

## Considered Options

- **Option A** — ESLint + typescript-eslint `strictTypeChecked` + Prettier, gated by a `verify` script that is also the **green gate**.
- **Option B** — Biome for both linting and formatting.
- **Option C** — Lint in CI only, leave the **green gate** as tests alone.

## Decision Outcome

Chosen option: **Option A**.

Two things are decided here, and the second is the load-bearing one.

**The toolchain.** typescript-eslint's type-aware rules run on the real TypeScript compiler, which is what `no-floating-promises` and `no-misused-promises` need to be trustworthy across `sandbox`, `pass`, `harness`, and `run-role`.
`strictTypeChecked` rather than `recommendedTypeChecked`, to match the posture already in `tsconfig.json` (`strict`, `noUncheckedIndexedAccess`) — half-strict types with half-strict lint is incoherent.
Prettier owns all formatting and the linter carries zero stylistic rules, so the two can never disagree; `eslint-config-prettier` is last in the config to enforce that mechanically.
`@vitest/eslint-plugin` on `tests/**` for `no-focused-tests` and `expect-expect`.

**What "green" means.** `npm run verify` — typecheck, lint, format check, tests — is this repo's **green gate** command.
A **pass** that leaves a floating promise now goes red and the fixer **leg** must resolve it before the **handover**, rather than the human finding it at review.

Type-aware linting needs every linted file inside a tsconfig, so the build config and the check config are now separate files: `tsconfig.json` emits from `src`, `tsconfig.lint.json` checks `src`, `tests`, and the root config files with `noEmit`.
This closed a standing gap — `tests/**` had never been typechecked, and four type errors were hiding there.

Where a strict rule fought the shape of the repo, the rule is turned off in `eslint.config.ts` with a written reason rather than suppressed inline: `require-await` off for test doubles and the stub crew, `unbound-method` off for tests.
Inline suppression is allowed only as `eslint-disable-next-line <rule> -- <reason>`, and `reportUnusedDisableDirectives` is an error.

### Consequences

- Good: promise misuse and focused tests fail the **green gate** instead of reaching a human.
- Good: `npm run lint` stops lying about what it does, and one command names what "green" means for this repo.
- Good: `tests/**` is typechecked for the first time.
- Bad: type-aware linting runs a second TypeScript program, so `verify` is meaningfully slower than `vitest run` was.
- Bad: three dev dependencies and two config files where there were none.
- Bad: rules turned off in config are invisible at the call site — a reader of `src/stub-crew.ts` cannot see that `require-await` does not apply there.

### Confirmation

`npm run verify` exits zero on a clean tree.
Relay's operator config for this repo sets `greenGate: "npm run verify"`.

## Pros and Cons of the Options

### Option B — Biome

- Good, because it is one dependency, one config file, and near-instant.
- Good, because it formats and lints without two tools to keep from fighting.
- Bad, because its type-aware rules run on Biome's own inference engine and `noFloatingPromises` is still a nursery rule — the exact rule this repo most needs is the one least proven.

### Option C — lint in CI only

- Good, because it costs the **pass** nothing.
- Bad, because a **pass** would hand over lint-red work as if it were reviewable, which defeats what the **handover** is for.

## More Information

- Provenance: grilling of 2026-07-26.
- Related: [ADR-0003](0003-a-crashed-pass-leaves-the-work-for-a-human.md)
- Domain language: [`CONTEXT.md`](../../CONTEXT.md)
