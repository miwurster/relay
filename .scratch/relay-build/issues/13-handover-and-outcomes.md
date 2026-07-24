# 13 — Handover + outcomes

**What to build:** Replace the handover stub with the real endpoint and wire the full outcome matrix, producing a real end-to-end pass. Success: push the branch and open a GitLab MR via kipu-mr, transition the item to In Review (never Done), add a resolution comment and a human-readable report, exit 0 (nothing-to-do folds into exit 0). Mid-block (including gate non-green after 2, and needs-input): Draft MR + `agent-blocked` label/comment, exit 1. Early bail (under-spec from the planner): no MR + `agent-blocked` label/comment, exit 1. glab / kipu-mr derive GitLab coordinates from the git remote.

**Blocked by:** 08, 12

**Status:** ready-for-agent

- [ ] Success: kipu-mr push + MR, In Review, resolution comment + report, exit 0
- [ ] Nothing-to-do folds into exit 0
- [ ] Mid-block: Draft MR + `agent-blocked` label/comment, exit 1
- [ ] Early under-spec bail: no MR + `agent-blocked` label/comment, exit 1
- [ ] GitLab coordinates derived from the remote, not configured
- [ ] Real end-to-end pass runs against a real work item
