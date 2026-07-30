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

### Where those credentials come from

`.relay/.env` here means **this repo's** — relay's own, the same file relay's dogfooding reads — never the clone's.
The clone's genesis carries a `.relay/config.ts` and deliberately no `.relay/.env`, so there is no second copy of a secret to keep in step.

A real environment variable wins over the file, which is only the fallback ([ADR-0014](../docs/adr/0014-credentials-live-in-the-target-repo-gitignored.md)):
export `GH_TOKEN` in one shell and that shell's token is used, whatever `.relay/.env` says.

`npm run rehearse` resolves them against this repo's root whatever directory you invoke it from, and hands them to the pass as the child process's own environment.
So the pass in the clone runs on the credentials relay itself would use, and nothing has to be exported by hand.

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

### What it does, in order

1. **Resolves the scenario**, before anything else, so a mistyped name costs neither a build nor a destroyed repo.
2. **Resolves the credentials** against this repo's root, for the reason above.
3. **Builds relay** with `npm run build`, so the pass runs the change you are rehearsing rather than whatever was in `dist/` from last time. A build that fails ends the rehearsal there.
4. **Seeds the scenario**, by calling the same seed `npm run seed` calls — bootstrap, reset to genesis, prune what a crashed pass left, delete every issue, create the work item and its tickets.
5. **Runs the pass**, as `node dist/main.js <work item>` in the clone, on inherited stdio.
6. **Digests**, by calling the same reader `npm run digest` calls against the clone's `.relay/<work item>`, then prints it and files it.

### The full run

```
$ npm run rehearse -- happy-path

rehearse: building relay
… tsup's own output …
seed: cloning miwurster/relay-rehearsal to /private/var/folders/…/T/relay-rehearsal
seed: pruned the pass branch agent/37
seed: the label vocabulary is on miwurster/relay-rehearsal, checked by relay's own init
seed: happy-path: /private/var/folders/…/T/relay-rehearsal is on main at genesis
seed: deleted 4 issue(s) from miwurster/relay-rehearsal
seed: work item #41, tickets #42, #43, #44
rehearse: running relay over #41 in /private/var/folders/…/T/relay-rehearsal
… relay's own output, live: the eight legs of the pass, as they run …

rehearsal: happy-path
repo: miwurster/relay-rehearsal (main)
work item: #41
started: 2026-07-30T13:02:11.418Z
relay exit code: 0

relay pass digest — /private/var/folders/…/T/relay-rehearsal/.relay/41
8 leg(s) recorded.

Legs (durations approximate, from record mtimes):
  …
Findings by axis:
  …
Fixer verdicts:
  …
Unaddressed findings:
  …
Unparseable records:
  none

rehearse: digest filed in /path/to/relay/rehearsal/runs/happy-path-2026-07-30T13-02-11.txt
```

The seed's `cloning` and `pruned` lines appear only when there is something to clone or prune, and its first line is `miwurster/relay-rehearsal is absent — creating it private` on the very first run.
Everything from `rehearsal: happy-path` down is what lands in the run file, byte for byte, which is what makes two run files diffable.

### What a rehearsal leaves behind

- **A run file** under `rehearsal/runs/`, gitignored, one per rehearsal.
- **The clone** at `$TMPDIR/relay-rehearsal`, on whatever state the pass left. Nothing needs cleaning up: the next seed resets it, prunes the pass branches and removes the worktrees, which is why a crashed rehearsal does not block the next one.
- **The rehearsal repo**, with the pass's branch, comments and closed issues on it. Left readable on purpose; the next seed deletes the issues and force-pushes genesis over the history.
- **The sandbox image**, cached under a tag minted from the clone's basename, so the second rehearsal of an afternoon pays no image build.

relay's own worktree is left clean, and nothing in relay's own source is touched by any of this.

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
