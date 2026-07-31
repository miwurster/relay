# 0030. Genesis carries a latent defect

- **Status:** accepted
- **Date:** 2026-07-31

## Context and Problem Statement

The **rehearsal**'s scenarios were all feature work: a **work item** describing behaviour the fixture does not have yet.
A repo running relay files bugs too, and a bug is a different job — the change is to behaviour that already exists, and it is pinned by a regression test rather than by acceptance criteria alone.
Nothing in the rig said whether the **crew** handles that job as well as it handles a feature.

A `bug-report` **scenario** needs a bug the **pass** can actually reproduce.
That is what makes it awkward: a **scenario** is a tracker state, and **genesis** is one fixed commit shared by every scenario.
A bug report over green code is not a rehearsal of anything — the pass finds nothing, and either bails or invents a fix, and the digest says nothing about how the crew handles bugs.

The question this ADR settles is where the bug lives.

## Decision Drivers

- `rehearsal/README.md` and `CONTEXT.md`'s **Scenario** entry both say a scenario is a tracker state and nothing else. Two rehearsals are comparable because **genesis** does not move.
- **Genesis** must stay green. Its `verify` runs as the **green gate** on every scenario, and a red gate before any work starts would block every pass over the fixture, not just the bug one.
- `fixtures/todo-app/` is presented as an exemplary small repo. Whatever is done here, a future reader of it must not be misled about why.
- A bug worth rehearsing must be more than one hop from its symptom, or the diagnosis is done by reading the function and there is nothing to judge.
- `AGENTS.md`: no configurability that was not asked for. A per-scenario genesis is machinery in the seed for one scenario's sake.

## Considered Options

- **Option A** — A latent defect lives permanently in **genesis**, and the `bug-report` **scenario** names it.
- **Option B** — A **scenario** may carry a genesis overlay: files patched into the tree at seed time, so only `bug-report`'s genesis is defective.
- **Option C** — The bug report describes a defect that is not in the code.

## Decision Outcome

Chosen option: **Option A**.

- `fixtures/todo-app` mints a **todo**'s id from how many todos its list currently holds, rather than from how many it has ever minted. Remove a todo and add another, and the new one takes an id a live todo is already using and overwrites it — the list loses a todo and reports success.
- The defect is **latent**: every test the fixture ships stays green, because each of them either adds without removing or removes without adding afterwards. So genesis is green and the **green gate** is green on every scenario, `bug-report` included, until the regression test is written.
- Nothing in the fixture marks the defect as deliberate. A comment saying "deliberate, leave it" would sit in the same tree as a **work item** saying "fix this", and the implementer would have to guess which the repo means — noise that reads in a digest as a **role** behaving badly rather than as the fixture disagreeing with itself.
- Where it is written down is `rehearsal/README.md`, on relay's side of the boundary, which no **leg** ever reads.
- The `bug-report` work item carries the diagnosis — symptom, minimal reproduction, root cause, the seam for the regression test — rather than the symptom alone. A symptom-only report is under-specified, and the planner is built to refuse an under-specified work item, so it would rehearse that refusal instead of the work.
- What therefore distinguishes `bug-report` from `single-spec` is not how much the item says but what it asks for: a change to existing behaviour, pinned by a regression test, against behaviour that is new.
- Every scenario whose work item removes a **todo** now risks tripping the defect. `single-spec` is read-only for exactly this reason, and the natural feature for this fixture — clearing the completed todos — was rejected as a spec because it removes.

Option B was refused rather than deferred.
An overlay makes a **scenario** a tracker state *and* a diff against genesis, which is the one property this rig leans on to make two rehearsals comparable — and it buys a clean fixture for a rig whose fixture nobody ships.

### Consequences

- Good: the bug is reachable from the fixture's public API, so a **pass** can build its own failing test at the seam that already exists, and there is a real distance between the symptom (a todo vanished) and the cause (an id collision on a map write).
- Good: no machinery in the seed. A scenario stays a work item and its tickets.
- Good: the fixture is honest about something real — a repo with a green gate and a latent data-loss bug is the ordinary case, not a contrived one.
- Bad: `fixtures/todo-app` is no longer exemplary code, and nothing in it says so. A reader who never opens `rehearsal/README.md` meets a data-loss defect in a fixture the repo presents as small and clean.
- Bad: the defect is shared. A **role** on any scenario may notice and fix it, which contaminates that rehearsal's digest — most likely a `happy-path` implementer, whose tickets touch adding and listing. Mitigated only by where the defect sits: `remove` is the one method no other scenario's work item mentions.
- Bad: no scenario may remove a todo without inheriting the collision, so the space of future scenarios is narrower than it was.
- Bad: once `bug-report` exists, the defect cannot be fixed in the fixture without deleting the scenario. Genesis is no longer free to be tidied.
- Reversible only by taking both together: the defect and the scenario that names it.

### Confirmation

`rehearsal/README.md` names the defect, says it is deliberate, and says which scenarios must not remove a **todo**.

That the defect is latent is confirmed by `npm run verify` in `fixtures/todo-app` exiting zero with it in place — the fixture's own gate, run as any **pass** would run it.

That it is real is confirmed by rehearsing it: `npm run rehearse -- bug-report merge`.
There is no oracle, as with every rehearsal ([ADR-0024](0024-the-rehearsal-runs-against-a-real-throwaway-repo.md)) — what the digest shows is whether the crew reproduced the loss and pinned it, which is a human's to judge.

## More Information

- Provenance: the grilling of 2026-07-31 on a single-ticket scenario.
- Related: [ADR-0024](0024-the-rehearsal-runs-against-a-real-throwaway-repo.md) — why genesis is fixed, and why a scenario is a tracker state.
- Domain language: [`CONTEXT.md`](../../CONTEXT.md)
