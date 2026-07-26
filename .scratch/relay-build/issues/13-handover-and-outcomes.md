# 13 — Handover + outcomes

**What to build:** Replace the handover stub with the real endpoint and wire the full outcome matrix, producing a real end-to-end pass. Success: push the branch and open a GitLab MR via kipu-mr, transition the item to In Review (never Done), add a resolution comment and a human-readable report, exit 0 (nothing-to-do folds into exit 0). Mid-block (including gate non-green after 2, and needs-input): Draft MR + `agent-blocked` label/comment, exit 1. Early bail (under-spec from the planner): no MR + `agent-blocked` label/comment, exit 1. glab / kipu-mr derive GitLab coordinates from the git remote.

**Blocked by:** 08, 12

**Status:** ready-for-human

- [x] Success: kipu-mr push + MR, In Review, resolution comment + report, exit 0
- [x] Nothing-to-do folds into exit 0
- [x] Mid-block: Draft MR + `agent-blocked` label/comment, exit 1
- [x] Early under-spec bail: no MR + `agent-blocked` label/comment, exit 1
- [x] GitLab coordinates derived from the remote, not configured
- [ ] Real end-to-end pass runs against a real work item

## Answer

`src/handover.ts` (the role), `src/resources/handover.md` (its prompt), `src/crew.ts` (the wiring, and the last stub gone), `src/pass.ts` (the branch the crew is built with).

**The outcome matrix was already wired; the endpoint was not.**
`runHarness` has ended every path at `crew.handover(outcome)` since ticket 07, and `exitCodeFor` has mapped `success` to 0 and both blocked outcomes to 1; nothing-to-do returns 0 from `runPass` before a sandbox is ever opened.
So this ticket is the one leg that was still a stub — and with it, `createCrew` no longer names a stub at all.

**One role for all three outcomes.**
Publishing a green branch, a blocked branch and a refusal are the same job with a different verdict, so `describeLeg` resolves the outcome once — the cause the tracker comment carries, and whether the outcome gets a merge request — exactly as the fixer resolves its three legs.
The prompt holds the three sections; relay holds the leg to the one rule it can check from outside.

**Only the merge request is relay's to enforce.**
Draft state, the `agent-blocked` label, In Review, the comment: all of it is tracker and GitLab work the leg does over MCP and `glab`, and relay would have to re-read both to verify it.
What relay does check is the merge request URL the leg reports: required for a success, refused for an early bail — an empty branch is noise — and optional for a mid-block, because a pass that blocked on its very first ticket has no commits either and would open that same empty merge request.

**The report is printed before the leg is judged.**
By the time relay sees the answer, the leg has already pushed, transitioned and commented; a `RoleError` thrown before the report would leave the human with a crash note and no record of what was actually done to their tracker.

**No GitLab coordinates anywhere in relay.**
`kipu-mr` and `glab` derive the project and host from the worktree's own remote, and `GITLAB_TOKEN` is already in the sandbox's environment — so the config surface stays as it was.

**Tested with no docker, model, tracker or network.**
A fake sandbox answers the handover run: the leg's name and model, the outcome/cause/item/branch/tracker-doc it is told, a blocked outcome's own reason as the cause, the report reaching the operator (including when the leg is then refused), an early bail handed over without a merge request, a mid-block on an empty branch allowed one, and four refusals — a success with no merge request, an early bail with one, a leg that committed, and a leg that reported nothing.

**Left for a human:** the last AC. A real end-to-end pass needs a real Jira work item, a GitLab remote and a docker daemon, so it is the operator's run, not the suite's.
