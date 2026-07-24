# 11 — Fixer role

**What to build:** Replace the fixer stub with the real role. It consumes the harness's array-merged findings from the concurrent reviewers, dedups them, applies fixes, and commits. It runs after per-ticket reviews and after the whole-branch review, and is the loop body the quality-gate drives.

**Blocked by:** 10

**Status:** ready-for-agent

- [ ] Consumes merged findings files; dedups overlapping findings
- [ ] Applies fixes and commits
- [ ] Reusable as the per-ticket fixer, the whole-branch fixer, and the gate-loop fixer
- [ ] Per-role model map applied (fixer: sonnet, escalating to opus)
