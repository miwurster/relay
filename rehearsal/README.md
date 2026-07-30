# The rehearsal rig

A **rehearsal** is one real pass, over a repo seeded to a fixed **scenario**, run to judge how the flow feels after you change a role's prompt, a role's model, or the harness's topology.

Change something, rehearse, read the digest.
Change it again, rehearse again, diff the two digests.

## What a rehearsal does not prove

It is not a test, and a clean digest is not a passing build.

- **There is no oracle.** Roles are non-deterministic, so nothing here decides whether the flow was correct. What a rehearsal yields is evidence for your judgement.
- **Two rehearsals are never identical.** The fixed genesis commit and the fixed scenario reduce the noise to the models' own variance, and that is the whole ambition ([ADR-0024](../docs/adr/0024-the-rehearsal-runs-against-a-real-throwaway-repo.md)).
- **One rehearsal is one sample.** A digest that got better is not a change that got better.
- **It is deliberately outside `npm run verify`.** A gate that spends Claude sessions and mutates a GitHub repo is not a gate.

## The repo it runs against

`miwurster/relay-rehearsal`, private, hardcoded in `rehearsal-repo.ts`.

Seeding it means destroying it: the seed force-pushes genesis over its history and deletes every issue it has.
The clone lives at `$TMPDIR/relay-rehearsal`, and the seed refuses to run unless that clone's `origin` is exactly the rehearsal repo.
There is no flag and no environment variable that lifts the refusal.

## Requirements

Node 20+, Docker, an authenticated `gh`, and the `mattpocock-skills@claude-plugins-official` plugin on your host — the same list a pass needs anywhere.

Credentials are read out of relay's own environment or `.relay/.env`, so a rehearsal needs no second copy of a secret on your disk:

- **`GH_TOKEN`** — a classic token with `repo` scope, or a fine-grained token with Administration, Contents and Issues write on the rehearsal repo. It has to create the repo when it is absent, push genesis, create labels, and **delete issues**, which GitHub allows only a repository admin to do.
- **A Claude credential** — `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`. The seed asks for it too, though it does not use it: a seed that succeeded only for the rehearsal to die on a missing token afterwards is the worse failure.

## Running one

```sh
npm run rehearse -- happy-path
```

From any state — repo absent, half-seeded, or left behind by a crashed pass — that builds relay, seeds the scenario, runs a pass in the clone with relay's output streaming to your terminal, and on exit prints the digest and files it under `rehearsal/runs/`, named by scenario and start time.

Those run files are gitignored, so a rehearsal leaves relay's own worktree clean.
Change a prompt, rehearse again, diff the two files.

The digest's heading carries the scenario, the work item, the start time and **relay's exit code**, so a landed rehearsal and a blocked one are still distinguishable in a file read a week later.

The command itself exits 0 whenever a rehearsal finished, whatever relay made of the work: a blocked pass is an ordinary outcome, not a failure of the rig.
A non-zero exit is the rig failing — a build that broke, a missing credential, a seed that was refused.

## Running one step at a time

The three steps stay separately invokable, which is how you drive relay with an ad-hoc flag, poke the clone mid-flight, and still get a digest afterwards.

### 1. Seed

```sh
npm run seed -- happy-path
```

From any state — repo absent, half-seeded, or left behind by a crashed pass — this leaves the clone on genesis with the scenario's tracker state waiting:

```
seed: miwurster/relay-rehearsal is absent — creating it private
seed: cloning miwurster/relay-rehearsal to /private/var/folders/…/T/relay-rehearsal
seed: the label vocabulary is on miwurster/relay-rehearsal, checked by relay's own init
seed: happy-path: /private/var/folders/…/T/relay-rehearsal is on main at genesis
seed: deleted 4 issue(s) from miwurster/relay-rehearsal
seed: work item #5, tickets #6, #7, #8
```

GitHub never reuses an issue number, so a fixed scenario means fixed *content*, not fixed numbers.
Take the work item number off that last line every time — nothing in the rig hardcodes one.

### 2. Run relay against the clone

Build relay first, so the pass runs the code you just changed:

```sh
npm run build
cd "$TMPDIR/relay-rehearsal"
node /path/to/relay/dist/main.js 5      # the work item the seed printed
```

Both credentials have to be in that shell's environment: the clone's genesis carries a `.relay/config.ts` but no `.relay/.env`.

The fixture declares `landing: "merge"`, so a green pass runs all eight roles — the lander included — and closes the tickets it landed.

### 3. Digest

The legs record on the host, under the clone's own `.relay/<work item>`:

```sh
cd /path/to/relay
npm run digest -- "$TMPDIR/relay-rehearsal/.relay/5"
```

The digest reports per-leg wall clock, per-leg status, findings by axis, the fixer's verdicts, every unaddressed finding, and a record it could not parse.
It is read out of the leg records relay already writes, so the rig adds no instrumentation to relay's own source.

## The scenarios

`happy-path` is the only one today: one work item — todos can have a due date — with three sub-issue tickets, two of which are natively blocked by the first, so how the planner orders work is observable rather than trivial.

The scenario is named as an argument from the first day, so an `under-specified`, a `no-sub-issues` or a `red-gate` scenario is a new entry in `scenarios.ts` rather than a redesign.
An unknown name is refused before the seed touches anything, and the refusal names the scenarios that exist.

## The fixture repo

`fixtures/todo-app/` is genesis: a small TypeScript todo core on plain npm, whose `verify` is a typecheck plus vitest and runs in a few seconds, so the gate leg and the lander's re-run are not what a rehearsal's wall clock measures.

It commits its own `AGENTS.md` declaring that command as the green gate, real code principles for the review's `standards` axis, a `CONTEXT.md` glossary for its `spec` axis, its tracker doc, and a `.relay/config.ts`.
The sandbox recipe is **not** committed there: the seed copies in the one relay ships, because a committed copy can stay green while the recipe users get breaks.
