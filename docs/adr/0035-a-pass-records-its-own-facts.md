# 0035. A pass records its own facts

- **Status:** accepted
- **Date:** 2026-08-02

## Context and Problem Statement

A **pass** that ends in a **mid-block** leaves a human asking what happened.
What relay left on the host to answer with was one **leg record** per leg — a status, a review's **findings**, a **fixer**'s **verdicts** — plus, unread by relay and uncollected by anything, one sandcastle transcript per leg under `.sandcastle/logs/`.

What no file held was the pass's own verdict.
The **outcome**, the **gate verdict**, the **lander**'s result and the **finished ticket** list are all worked out by the harness as the legs run, and `runHarness` handed them to the **handover** as prompt arguments and then returned only the outcome to its caller.
So the durable trace of "this pass mid-blocked on ticket 44 and never reached its gate" was prose a model wrote, and a **pass** that crashed — which reaches no handover at all — left not even that.

The question this ADR settles is where a pass's own facts live, given that [ADR-0012](0012-a-legs-facts-stay-next-to-the-leg.md) put a leg's facts next to the leg.

## Decision Drivers

- The facts are the harness's, not any leg's. There is no leg to put them next to, so ADR-0012 does not answer this.
- A record read a week later must state facts rather than infer them, for the same reason the handover is told them rather than working them out ([`CONTEXT.md`](../../CONTEXT.md), **Handover**): a fact a reader has to derive is one they can get wrong.
- The transcripts do not keep. Sandcastle names a log file after the **pass branch** alone, so a second pass over one **work item** overwrites the first pass's transcripts — and that second pass is exactly what a human runs after clearing up a blocked one.
- A crashed pass is the pass whose evidence is thinnest and whose evidence matters most.
- Every one of these facts already exists in memory at the moment the pass ends. Recording them costs a `writeFile`.

## Considered Options

- **Option A** — One **pass record**, `pass.json`, written by the host beside the pass's leg records, on the clean path and on the crash path both; and an **archive** that renders it, the leg records, the diff and the transcripts as one file.
- **Option B** — Record the handover's `promptArgs` alongside its answer, since they already carry the outcome, the gate and the ticket lists.
- **Option C** — Derive the verdict when it is read: quote the handover's report and re-derive the rest from the findings and verdicts, the way the digest already derives its unaddressed-findings section.
- **Option D** — Make a thrown `RoleError` an **outcome**, so every ending reaches the handover and the handover's own record is the pass's record.

## Decision Outcome

Chosen option: **Option A**, because the pass's facts are data the pass has and nothing else on disk can supply.

- `runHarness` answers with `PassFacts` — the outcome, the gate verdict, the land result and the committed, finished and blocked ticket lists — instead of the outcome alone. Those are the same values it hands the handover, so the record and the report cannot disagree.
- `runPassOnItem` writes `pass.json` into the pass's record directory, then writes an **archive**, on both the clean path and the `catch`. Both writes are best-effort: a pass that ran must not end on the error code of the file it was writing about itself.
- `PassEnd` has two arms — `handed-over`, carrying every fact, and `crashed`, carrying the error. A crashed pass has no gate verdict to state, and `not-gated` there would be a claim about a gate nobody asked.
- The archive is written unasked at the end of every pass, because the transcripts it collects are overwritten by the next pass over that item. `relay archive <work item>` re-renders one on demand.

Option D was refused rather than deferred: it rewrites the harness's control flow and [ADR-0033](0033-a-protocol-slip-gets-one-retry.md)'s retry story to obtain a record a `writeFile` obtains.

### Consequences

- Good: a **blocked** pass leaves one file a human or a model can judge the whole flow from, and the flow's own verdict is in it as data.
- Good: the digest can date the first leg from the pass's own start rather than printing nothing against it.
- Good: a crashed pass now records something. Before this it recorded the leg that died and nothing about the pass that died with it.
- Bad: a record belonging to no leg sits in a directory of leg records, and reads at a glance like another one. The name, the glossary entries and this ADR are what keep the two apart; the digest skips the file by name so it never reports it as a record it cannot read.
- Bad: every pass now writes a file of roughly a hundred kilobytes that most operators will never open. Gitignored by the rule that already covers the record directory, and small beside what a pass leaves in `.sandcastle/`.
- Bad: `pass.json` is a shape read back by a later relay, so changing it means handling both. `readPassRecord` checks the shape and answers with nothing where it does not fit, which is why an archive of an older pass degrades to "no pass record" rather than failing.

### Confirmation

`tests/pass/pass.test.ts` asserts that a green pass records `handed-over` with its branches and that a crashing pass records `crashed` with the error, and that an archive lands beside the record either way.
`tests/archive/archive.test.ts` asserts the archive names the pass's facts, says so where there is no pass record, and never reports `pass.json` as an unparseable record.

## Pros and Cons of the Options

### Option B — record the handover's prompt arguments

- Good, because it is one line in `runRole` and covers every pass that reached its handover.
- Bad, because it records the facts as the prompt text a leg was given rather than as data, so every reader parses English to answer "did the gate run".
- Bad, because it records nothing for a crashed pass, which is the case that motivated this.

### Option C — derive the verdict when it is read

- Good, because it needs no change to the pass at all and works on records already on disk.
- Bad, because it makes the reader infer what the pass knew — the thing [`CONTEXT.md`](../../CONTEXT.md) forbids the handover from doing, for a reader with less context than the handover has.
- Bad, because a crashed pass reads as "no handover recorded", which is the absence of an answer rather than an answer.

### Option D — make a thrown role failure an outcome

- Good, because every ending would reach the handover, and the handover would publish the block on the tracker as it does any other.
- Bad, because it is a redesign of the harness's control flow to obtain a record, and the two questions are separable.
- Bad, because a leg that broke its output protocol cannot be relied on to have left the branch in a state the remaining legs can run over.

## More Information

- Provenance: the grilling of 2026-08-02 on collecting a run's evidence for later judgement.
- Related: [ADR-0012](0012-a-legs-facts-stay-next-to-the-leg.md) — why a leg's facts stay next to the leg, and why this record is not one of them.
- Related: [ADR-0003](0003-a-crashed-pass-leaves-the-work-for-a-human.md) — why the records live on the host rather than in the disposed worktree.
- Domain language: [`CONTEXT.md`](../../CONTEXT.md) — **Archive**, **Pass record**, **Leg record**.
