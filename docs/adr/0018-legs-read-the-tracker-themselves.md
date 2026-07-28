# 0018. Legs read the tracker themselves

- **Status:** accepted
- **Date:** 2026-07-28

## Context and Problem Statement

A **leg** whose job starts at the tracker — the **planner** on the **work item**, the **implementer** on its ticket, the **spec review** lenses on the intent a change is measured against — needs the issue's own text, and relay decides how that text reaches it.

relay hands sandcastle a prompt file and the arguments its `{{KEY}}` placeholders take.
Nothing stops those arguments carrying the issue body itself: relay already talks to GitHub host-side through `GitHubClient`, and sandcastle additionally expands a shell block inside the sandbox before the agent sees the prompt, so a prompt could carry `` !`gh issue view 42` `` and be handed the answer pre-rendered.

Both would work, and both are cheaper per leg than sending an agent to read a doc and then the tracker.
Without this record the next reader proposes one of them again.

## Decision Drivers

- Every leg is a cold session with `gh` and the repo's own `docs/agents/issue-tracker.md` already in the sandbox ([ADR-0007](0007-one-forge-one-tracker-no-abstraction.md), [ADR-0008](0008-the-native-github-graph-is-the-tracker-model.md)).
- A pre-rendered body is a snapshot: it is as old as the moment relay fetched it, and it is flat text where the leg needs the graph around it — sub-issues, labels, comments, links.
- What relay renders into a prompt, relay owns the shape of.
- The repo's tracker doc is what the repo's contributors read, and relay hardcoding a second version of it is the drift ADR-0009 was written against.
- A leg that reads is a leg that can follow what it finds; a leg that is handed text can only take it.

## Considered Options

- **Option A** — legs read the tracker themselves, told only which issue and where the tracker doc is.
- **Option B** — relay fetches the issue host-side through `GitHubClient` and passes the body as a prompt argument.
- **Option C** — the prompt carries a `gh` shell block, and sandcastle expands it in the sandbox before the agent runs.

## Decision Outcome

Chosen option: **Option A**.

A prompt names the issue (`{{WORK_ITEM}}`, `{{TICKET}}`) and the path to the repo's tracker doc (`{{TRACKER_DOC}}`), and tells the leg to read that doc first and reach the tracker itself.
No prompt contains tracker content, and no prompt contains a shell block.
`GitHubClient` stays what it is: how the *host* picks the work item and holds the pass's own labels — never a prompt's data source.

**Option B** was rejected because it makes relay the tracker's renderer.
Every field a leg turns out to need — a sub-issue's state, a label, a comment thread, a linked issue — becomes a `GitHubClient` change, a schema change and a prompt change, and the leg still cannot follow anything relay did not anticipate.
It also duplicates, in TypeScript, the conventions the repo's own tracker doc already states.

**Option C** was rejected for the same reason plus one of its own: it moves the fetch into a prompt, where it is invisible to types, tests and errors alike.
A failed expansion is a prompt that silently reads wrong, the command is pinned in a resource file rather than in the doc the repo maintains, and sandcastle strips the marker on the way through, so relay would be asserting on rendered text it never composed.
That relay declines a feature sandcastle offers is deliberate, and this is the record of it.

The cost is accepted: a leg spends turns reading before it works, and a leg that ignores its instruction to read has no fallback body waiting for it.

### Consequences

- Good: what a leg acts on is the tracker as it is when the leg runs, not as it was when the pass started.
- Good: a leg can follow the graph — sub-issues, labels, comments — without relay having anticipated the field.
- Good: the tracker's conventions live in one place, the repo's own doc, and relay states none of them.
- Good: no prompt carries tracker content, so a leg's brief cannot go stale between the fetch and the run.
- Bad: every tracker-reading leg pays turns on reading, and pays them again per leg.
- Bad: a leg is trusted to read; a prompt cannot make it, and relay cannot check that it did.

### Confirmation

No prompt resource contains tracker content or a `` !` `` shell block.
What a prompt argument may carry is the pass's own facts — the branch, the gate's output, the commits behind the ticket — never the tracker's.
Each role's prompt placeholders equal the arguments its role passes, asserted per role in the suite.
`GitHubClient` is used by the host's work-item selection and labelling only, never by a role.

## More Information

- Provenance: issue #12.
- Related: [ADR-0007](0007-one-forge-one-tracker-no-abstraction.md) — one forge, one tracker, no adapter.
- Related: [ADR-0008](0008-the-native-github-graph-is-the-tracker-model.md) — the graph a leg reads.
- Related: [ADR-0009](0009-the-repos-docs-declare-the-green-gate.md) — the same argument for the gate.
- Domain language: [`CONTEXT.md`](../../CONTEXT.md)
