# 09 — Implementer role (TDD)

**What to build:** Replace the implementer stub with a fresh implementer subagent per ticket, running under TDD. Its prompt is a custom prompt derived from the lean `implement` method minus its review line (review is a separate role). The `tdd` skill is mounted. The implementer self-commits its ticket via kipu-commit — there is no separate commit role.

**Blocked by:** 07, 02

**Status:** ready-for-agent

- [ ] Fresh implementer subagent per ticket, cold session
- [ ] Custom prompt = `implement` method minus the review line
- [ ] `tdd` skill mounted and used (test-first)
- [ ] Self-commits the ticket via kipu-commit; no separate commit role
