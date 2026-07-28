# 0017. The lander rebases and the host only fast-forwards

- **Status:** accepted
- **Date:** 2026-07-28

## Context and Problem Statement

Merge **landing** ([ADR-0015](0015-a-repo-declares-how-a-pass-lands.md)) has to get a **pass branch** onto the **base branch** ([ADR-0016](0016-the-base-branch-is-the-hosts-checkout.md)), and the base branch is checked out in the host's own worktree.

That worktree is not mounted into the **sandbox** — only the pass's worktree and the host `.git` are ([ADR-0010](0010-the-sandbox-shares-the-hosts-worktree-and-git-directory.md)) — and git refuses to check a branch out in a second worktree while another holds it.
So no **leg** can stand on the base branch and merge the pass branch into it.
sandcastle's own answer is the shape available: its merge agent works on its own branch in its own worktree, and `merge-to-head` moves the host's current branch onto that result afterwards.

The **green gate**'s verdict is the other half of the problem.
It was taken on the pass branch, which no longer describes what will land the moment the base branch has moved.

## Decision Drivers

- The host's base branch is the operator's, and relay moving it wrongly is the most expensive mistake merge landing can make.
- relay merges exactly one branch, cut from the base branch minutes earlier, so conflicts are the rare case — not sandcastle's fan-out of N parallel branches into each other.
- A rebase rewrites SHAs, and both handover's per-ticket SHAs and the reviewer's ticket scope name commits by SHA.
- Unreviewed commits landing straight on the base branch is the failure merge landing has no human to catch.

## Considered Options

- **Option A** — a **lander** leg rebases onto the base branch in the sandbox, re-runs the green gate, and the host does a fast-forward only.
- **Option B** — the lander merges the base branch in rather than rebasing onto it.
- **Option C** — the harness does the whole merge host-side, handing a conflicted host worktree to a leg.

## Decision Outcome

Chosen option: **Option A**.

The **lander** is the pass's eighth **role**, and exists only under merge landing.
It runs in the sandbox, on the pass branch, and does four things: rebase onto the base branch, re-run the green gate, and — on success — let the harness fast-forward the host's base branch and push it.
Its model default is `claude-opus-4-8`: rebase conflict resolution is the hardest judgement in a pass, harder than the fixer's first attempt at a red gate.

Four sub-decisions carry the weight.

**Rebase when clean; one merge when not.**
A clean rebase leaves linear history and no sandbox-authored merge commit on the base branch.
A conflict means `git rebase --abort` and then `git merge <base branch>` instead, so a conflict is resolved once rather than once per commit.
Rebasing through conflicts commit by commit was rejected: it asks an agent to author a sane intermediate commit at every stop, while the green gate only ever runs on the tip, so broken intermediate commits would land unnoticed.

**The host-side move is always a fast-forward.**
Because the lander merges the base branch *into* the pass branch — by rebase or by merge — the base branch is an ancestor of the result, and the host's step is `git merge --ff-only`.
It therefore cannot conflict, and a lander that went wrong ends with relay refusing the fast-forward rather than clobbering the operator's branch.
Merge landing also requires a clean host worktree at pass start and refuses a dirty one with exit 2: stashing around the merge would make relay responsible for restoring uncommitted work it did not create.

**A red gate after the rebase ends the pass.**
Outcome `mid-block`, exit 1: nothing fast-forwarded, nothing pushed, nothing closed, pass branch pushed for a human.
Red after a clean rebase means the base branch and this work conflict in behaviour rather than in text, which is a human's call.
Handing it to the fixer was rejected because those fixes would land on the base branch having passed no reviewer leg, and because the reviewer's per-ticket scope no longer resolves once a rebase has rewritten the SHAs.

**The pass branch is no longer immutable.**
"relay never reuses, resets or deletes a branch" now carries one exception, the lander's rebase of its own pass branch, and every SHA a leg recorded before the lander ran is stale.
Handover therefore reads its per-ticket SHAs after the lander, never before.

### Consequences

- Good: the operator's base branch can only ever move forward, whatever the lander did.
- Good: what lands is what the green gate verified, because the gate re-runs on the rebased tip.
- Good: history on the base branch stays linear in the common case.
- Bad: an eighth role, with its own prompt, model key and tagged block, and a **crew** whose size now depends on `landing`.
- Bad: the pass branch's SHAs are rewritten, so **leg records** written earlier can name commits that no longer exist.
- Bad: the green gate runs twice on a successful merge-landing pass, which is the slowest thing a pass does.

### Confirmation

A pass whose base branch moved with no textual overlap lands as a linear fast-forward with no merge commit.
A pass whose rebase conflicts lands as one merge commit, gated, or ends `mid-block` if the gate is red.
A dirty host worktree fails the pass at start under merge landing, and warns in `doctor`.

## More Information

- Provenance: grilling of 2026-07-28.
- Related: [ADR-0015](0015-a-repo-declares-how-a-pass-lands.md) — the landing this role serves.
- Related: [ADR-0016](0016-the-base-branch-is-the-hosts-checkout.md) — the branch it rebases onto.
- Related: [ADR-0010](0010-the-sandbox-shares-the-hosts-worktree-and-git-directory.md) — why no leg can stand on the base branch.
- Related: [ADR-0006](0006-static-analysis-is-part-of-green.md) — what the re-run gate covers.
- Domain language: [`CONTEXT.md`](../../CONTEXT.md)
