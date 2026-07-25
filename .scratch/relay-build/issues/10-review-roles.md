# 10 — Review roles (four lenses)

**What to build:** Replace the review stubs with the real roles: per-ticket fast code review ∥ fast spec review (opus), and once-per-branch in-depth code review ∥ spec review (fable). All run concurrently, read-only. The spec-review roles fetch their intent (ticket brief / spec + ticket list) from the tracker per `issue-tracker.md` by key — the tracker is the single source of truth, no planner-written file handoff. kipu-code-review needs no fetch. Findings are written to findings files (via the run-with-extraction pattern) for the harness to merge.

**Blocked by:** 09

**Status:** resolved

- [x] Per-ticket fast code ∥ spec review and whole-branch in-depth code ∥ spec review, concurrent read-only
- [x] Spec-review fetches brief/spec from the tracker by key; code-review needs no fetch
- [x] Each spec-review `sandbox.run` has the Atlassian MCP wired
- [x] Findings extracted to files in the output dir for harness merge
- [x] Per-role model map applied (fast: opus, in-depth: fable)

## Answer

`src/reviewer.ts` (all four lenses), `src/resources/code-review.md` and `src/resources/spec-review.md` (their prompts), `src/findings-file.ts` (the pass's output dir and its findings files), `src/crew.ts` + `src/harness.ts` (the scope a lens is given), `src/implementer.ts` (the ticket base the per-ticket lenses diff from).

**Four lenses, two prompts, one role.**
`createReviewer` is one function: the lens picks the prompt, the model (`config.models[lens]`) and the one argument that prompt alone takes — `DEPTH` (`fast` / `full`, the depths `kipu-code-review` documents) for the code lenses, `TRACKER_DOC` for the spec lenses.
The scope picks everything else, so nothing about a lens knows that three others exist: concurrency stays the harness's `Promise.all`, exactly as ticket 07 built it.

**Findings are lines, and relay stamps the rest.**
A lens emits `<relay-findings>` — a JSON array of one-line findings — read back by ticket 08's `readTaggedOutput`, since `sandbox.run` still has no `Output.object` (ticket 08).
`source` and `ticket` are the harness's own facts, so a reviewer is never asked to repeat them.
An empty array is the clean review, which is why the array is the whole answer rather than an object with a verdict beside it.

**Read-only is asserted, not just asked for.**
The prompts forbid every write, and a lens that commits anyway is a `RoleError` — the mirror of ticket 09's empty-commit refusal, since a reviewer's commit would reach the human as nobody's work.

**The per-ticket diff is a sha, not a guess.**
A lens told to work out "the commits that were this ticket's" would guess, so `ReviewScope`'s ticket arm carries `base`: the implementer reads `git rev-parse HEAD` before its run and reports it with its `done`, and the harness hands it to the lenses.
Both prompts then reduce to one line — `git diff {{BASE}}...HEAD` — with `BASE` the ticket's base sha or, at branch scope, the pass's base branch.

**Intent comes from the tracker, and only the spec lenses fetch it.**
Per grilling 13, each spec lens reads `docs/agents/issue-tracker.md` and then the intent for its key — the ticket's brief at ticket scope, the work item plus its ticket list at branch scope, which is the key the branch arm of `ReviewScope` now carries.
The Atlassian MCP is already every role's session flag (`roleAgent`, ticket 08), so wiring it cost nothing; `kipu-code-review` is told it needs no fetch and measures the diff against the repo's own standards.

**Findings files are host-side, one per lens.**
`passOutputDir` is `<repo>/.relay/<KEY>` on the host, not in the worktree: the worktree dies with the sandbox, and the files exist to be inspectable after the pass.
One file per lens because a scope's lenses run concurrently; merging what they return stays the harness's blind concatenation, and dedup stays the fixer's (ticket 11).

**Tested with no docker, model or network.**
A fake sandbox returns each run's stdout and commits: both scopes, the lens/ticket stamping, the clean review, the missing and unusable block, the read-only refusal, the per-lens model, depth and prompt args, the run names, and the findings files' contents on disk.
