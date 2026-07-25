# 11 — Fixer role

**What to build:** Replace the fixer stub with the real role. It consumes the harness's array-merged findings from the concurrent reviewers, dedups them, applies fixes, and commits. It runs after per-ticket reviews and after the whole-branch review, and is the loop body the quality-gate drives.

**Blocked by:** 10

**Status:** resolved

- [x] Consumes merged findings files; dedups overlapping findings
- [x] Applies fixes and commits
- [x] Reusable as the per-ticket fixer, the whole-branch fixer, and the gate-loop fixer
- [x] Per-role model map applied (fixer: sonnet, escalating to opus)

## Answer

`src/fixer.ts` (the role), `src/resources/fixer.md` (its prompt), `src/crew.ts` (`FixTarget`, and the crew wiring), `src/harness.ts` (which target each fixer leg is given), `src/config.ts` (the model it escalates to).

**One role, three legs, and the target is the only difference.**
A fixer leg is always the same job — a merged list of findings over the branch as it stands — so the per-ticket, whole-branch and gate-loop fixers are one function.
`FixTarget` carries what the three do not share: the run's name (`fixer-PSD-8`, `fixer-branch`, `fixer-gate-2`), the scope the fixer is told it is fixing, and the model.
`describeLeg` resolves all three in one place, so a fourth target would be one case rather than three cascades.

**Findings reach the fixer as the harness's array, not as the files.**
The reviewers' findings files are host-side (`<repo>/.relay/<KEY>`, ticket 10) and the fixer runs in the sandbox's worktree, which cannot see them — so the merged array is inlined into the prompt verbatim, and the files stay what ticket 10 made them: the pass's inspectable record.
This is the AC's "merged findings files" honoured by content rather than by path, and it is the only reading that works across the sandbox boundary.

**Dedup is the fixer's judgement, not a hash of the strings.**
Two lenses phrase one problem two ways, so collapsing them means reading the code they point at — which is why the prompt owns dedup and the role does no string matching (ticket 07's reasoning, unchanged).
The stub's exact-match dedup stays a stub's approximation of it.

**Escalation happens where a model has been shown to fail.**
The map's "fixer: sonnet, escalating to opus" needs a trigger, and the gate loop is the pass's one leg that runs twice over the same problem: a second gate fix means the first one did not take, so it runs on `models.fixerEscalated` (opus by default, overridable like every other entry).
The ticket and branch legs run once, so there is nothing there to escalate from.

**A fixer that will not change anything says so instead of crashing.**
`fixed` with no commit is a `RoleError`, the mirror of ticket 09's implementer — but a leg that judges its findings wrong or already handled would then crash the pass out of its handover, so `nothing-to-fix` is the second arm.
It is one arm beyond what the ticket asked for, and it is here because the gate loop must be allowed to reach its cap and hand over, rather than die on a fixer with nothing honest to commit.

**Tested with no docker, model or network.**
A fake sandbox returns the run's stdout and commits: both result arms, the empty-commit refusal, a missing and an unusable block, the three run names and scopes, the merged findings reaching the prompt, the model per leg and the gate escalation, plus the harness handing each leg its target and the crew wiring one fixer run per scope.
