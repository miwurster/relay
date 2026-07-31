# The rehearsal rig

A **rehearsal** is one real pass over a repo seeded to a fixed **scenario** and a chosen **landing**, run to judge how the flow feels after you change a role's prompt, a role's model, or the harness's topology.
Change something, rehearse, diff the digest against the last one.

## Run one

```sh
npm run rehearse -- happy-path merge
npm run rehearse -- bug-report pull-request
npm run rehearse -- single-spec merge
```

Builds relay, seeds the scenario, runs the pass in the clone with relay's output streaming live, then prints the digest and files it as `rehearsal/runs/<scenario>-<landing>-<start time>.txt`.
Works from any state, a crashed previous rehearsal included.

Both arguments are required and neither has a default, exactly as relay requires of a repo's own `landing`.
An unknown scenario or landing is refused before anything is built or destroyed.

Run files are gitignored, so a rehearsal leaves relay's own worktree clean.
The digest's heading carries the scenario, the landing, the work item and **relay's exit code**, so a landed run and a blocked one are still told apart in a file read a week later.
The landing is in the filename too: a `merge` run and a `pull-request` run differ in the legs they even have, so diffing the two says nothing.
The command exits 0 whenever a rehearsal finished — a blocked pass is an outcome, not a failure of the rig — and non-zero only when the rig itself broke.

## Which landing to rehearse

**`merge`** exercises every role there is: the **lander** rebases, the gate re-runs on the result, the base branch fast-forwards and the **handover** closes the issues.
Rehearse this when what you changed could affect how a pass lands.

**`pull-request`** stops at a pull request against `main` of the rehearsal repo, so you can read the diff, the commits and the closing references in GitHub's own review interface rather than in a digest.
Rehearse this when what you want to judge is the *work* — whether the implementer built the right thing and the reviewer caught the right things.
The digest carries the pull request's URL on the handover's line.

**The next seed deletes that pull request.** Read it before you rehearse again.

## Or step by step

The same three pieces, separately invokable: how you drive relay with an ad-hoc flag, or poke the clone mid-flight.

```sh
npm run seed -- happy-path pull-request   # prints e.g. "happy-path: work item #41, tickets #42, #43, #44"
npm run build
cd "$TMPDIR/relay-rehearsal" && node /path/to/relay/dist/main.js 41
cd /path/to/relay && npm run digest -- "$TMPDIR/relay-rehearsal/.relay/41"
```

The seed takes the landing because the landing is genesis's to declare: the seed writes the clone's `.relay/config.ts`, and the pass then reads it like any repo's own.

Take the work item number off the seed's last line every time.
GitHub never reuses an issue number, so a fixed scenario means fixed *content*, and nothing in the rig hardcodes a number.

Both credentials have to be in the shell that runs relay: `rehearse` injects them, a hand-run does not.
Export this repo's own once per shell, before the `main.js` line:

```sh
set -a && source /path/to/relay/.relay/.env && set +a
```

`set -a` exports everything the file assigns, so the pass inherits it; `set +a` keeps that from applying to whatever you type next.
The file is `KEY=value` with `#` comments and blank lines skipped, which is what `source` and relay's own loader both read.

Only the hand-run pass needs this.
`seed` and `digest` run from this repo and read `.relay/.env` themselves.

## Seed every scenario at once

```sh
npm run seed -- all merge
```

Puts every scenario's issues in the tracker in one go, one summary line each:

```
seed: happy-path: work item #41, tickets #42, #43, #44
seed: bug-report: work item #45, its own single ticket
seed: single-spec: work item #46, its own single ticket
```

For browsing the tracker the way a maintainer would, and for hand-running relay against whichever item you like — or against none, since every work item is created `ready-for-agent` and the **frontier** is oldest-first, so a pass with no work item named picks the first scenario in `scenarios.ts`.
That is the only way to watch relay choose for itself; every other route hands it a number.

One landing for the whole tracker, because genesis carries one `.relay/config.ts`.

`all` is a `seed` argument and deliberately not a `rehearse` one.
Passes run one after another over one clone, so under a `merge` landing the second is cut from a base branch already holding the first's work — only the first pass would run against genesis, and that is the property that makes two rehearsals comparable at all.
Rehearsing every scenario means running `rehearse` once per scenario, each with its own seed.

## Credentials

Read from your environment, falling back to **this** repo's `.relay/.env` — never the clone's, whose genesis carries a `.relay/config.ts` and no secret.
`rehearse` resolves them against this repo whatever directory you invoke it from and hands them to the pass, so nothing needs exporting by hand.

- **`GH_TOKEN`** — classic with `repo` scope, or fine-grained with Administration, Contents and Issues write on the rehearsal repo. It creates the repo when absent, pushes genesis, creates labels and **deletes issues**, which GitHub allows only a repository admin.
- **`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`** — demanded by the seed too, which does not use it: better refused up front than a seeded repo and a pass that dies on a missing token.

Plus Node 20+, Docker, an authenticated `gh`, and the `mattpocock-skills@claude-plugins-official` plugin — the list any pass needs.

## The repo it runs against

`miwurster/relay-rehearsal`, private, hardcoded in `rehearsal-repo.ts`, cloned to `$TMPDIR/relay-rehearsal`.

**Seeding destroys it**: genesis is force-pushed over its history, every issue is deleted, and every pass branch a previous run pushed is deleted — which closes any pull request still open against it.
The seed refuses unless the clone's `origin` is exactly that slug, and no flag or environment variable lifts the refusal.

Nothing needs cleaning up afterwards, and nothing survives either.
The next seed resets the clone, prunes the pass branches and worktrees a crash left behind, deletes the issues, and deletes the branches on the repo.

## What a rehearsal does not prove

It is not a test, and a clean digest is not a passing build.

- **No oracle.** Roles are non-deterministic, so a rehearsal is evidence for your judgement and nothing more.
- **Never identical twice.** The fixed genesis, the fixed scenario and the named landing reduce the noise to the models' own variance, and that is the whole ambition ([ADR-0024](../docs/adr/0024-the-rehearsal-runs-against-a-real-throwaway-repo.md)).
- **One sample.** A digest that got better is not a change that got better.
- **Outside `npm run verify` and CI, on purpose.** A gate that spends Claude sessions and mutates a GitHub repo is not a gate.

## The scenarios

Three, each a new entry in `scenarios.ts`. An unknown name is refused before the seed touches anything.

**`happy-path`** — one work item, *todos can have a due date*, with three sub-issue tickets, two of them blocked by the first, so the planner's ordering is observable.

**`bug-report`** — a diagnosed bug report over the defect genesis carries (below). No sub-issues, so the work item is its own single ticket.
Rehearse this to judge a job `happy-path` does not cover: a change to behaviour that already exists, pinned by a regression test.

**`single-spec`** — one small feature, *search todos by title text*. Also no sub-issues.
Its counterpart: the same size and shape as `bug-report`, over new behaviour rather than a defect, so the two together say whether the crew builds and fixes equally well at one ticket.

Both single-ticket scenarios exercise a path `happy-path` never reaches — relay's fallback where a work item with no sub-issues becomes the ticket, so the handover's tick and its close land on the same issue.

A scenario is a tracker state and nothing else — it says nothing about the landing, so both landings are rehearsable over every scenario without a second entry.

## Genesis, and the bug in it

`fixtures/todo-app/` is genesis: a small TypeScript todo core whose `verify` is a typecheck plus vitest in a few seconds, so the gate leg is not what a rehearsal's wall clock measures.
It commits an `AGENTS.md` declaring that gate, code principles for the review's `standards` axis, a `CONTEXT.md` for its `spec` axis, and its tracker doc.

**It contains a deliberate bug**, and nothing in the fixture says so — that is what this paragraph is for ([ADR-0030](../docs/adr/0030-genesis-carries-a-latent-defect.md)).
`TodoList` mints an id from how many todos it currently holds rather than from how many it has ever minted, so removing a todo and adding another overwrites a live todo: the list silently loses one and reports success.
It is what `bug-report` is a report of, and a scenario cannot patch genesis, so it lives here permanently.

The defect is **latent** — every test the fixture ships stays green, because each either adds without removing or removes without adding afterwards.
So `verify` exits zero and the green gate is green on every scenario until a pass writes the regression test.

Two consequences for anyone adding a scenario:

- **A work item that removes a todo inherits the collision.** Its implementer's own tests would go red for a reason its ticket never mentions, which reads in a digest as a role behaving badly. `single-spec` is read-only for this reason — the obvious feature for this fixture, clearing the completed todos, was rejected as a spec because it removes.
- **Do not fix it.** Fixing it in the fixture deletes `bug-report`.

Two files in `.relay/` are not committed there but written into genesis at seed time.
The sandbox recipe, because a committed copy can stay green while the recipe users get breaks — and it is gitignored, since a dirty worktree is refused by a `merge` landing.
`config.ts`, because the landing is the rehearsal's argument rather than the fixture's property — and it is *not* gitignored, so genesis commits it the way a repo running relay commits its own.
