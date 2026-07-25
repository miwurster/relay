# 09 — Implementer role (TDD)

**What to build:** Replace the implementer stub with a fresh implementer subagent per ticket, running under TDD. Its prompt is a custom prompt derived from the lean `implement` method minus its review line (review is a separate role). The `tdd` skill is mounted. The implementer self-commits its ticket via kipu-commit — there is no separate commit role.

**Blocked by:** 07, 02

**Status:** resolved

- [x] Fresh implementer subagent per ticket, cold session
- [x] Custom prompt = `implement` method minus the review line
- [x] `tdd` skill mounted and used (test-first)
- [x] Self-commits the ticket via kipu-commit; no separate commit role

## Answer

`src/implementer.ts` (the role), `src/resources/implementer.md` (its prompt), `src/crew.ts` (`createCrew` — planner and implementer real now).

**The role is one `sandbox.run` per ticket, and that is what makes it fresh.**
The harness already calls `implement` once per ticket, so a per-ticket cold session costs nothing but naming the run `implementer-<KEY>`: the roles share only files and git, and the previous ticket's work is on the branch.
Ticket 08's seam is reused whole — `roleAgent` for the model, mounted plugin skills and the tracker MCP, `readTaggedOutput` for the answer — so this role added no infrastructure.

**The prompt is the lean `implement` method, minus one line.**
All four of its lines survive verbatim in intent (implement the ticket, `tdd` at pre-agreed seams, typecheck and focused tests regularly with the full suite once at the end, commit to the current branch); only "use /code-review to review the work" is dropped, because two review lenses run over the ticket right after this leg.
The deltas relay adds are boundaries, not method: the brief comes from the tracker doc, the tracker is read-only here (the planner owns the one write), and never push, merge or branch.

**Skills fire by their plugin-qualified names.**
Spike 02 settled that a plugin skill invoked by name needs `kipu-all:` on the front, so the prompt says `kipu-all:tdd` and `kipu-all:kipu-commit`; mounting is already `roleAgent`'s `--plugin-dir`.

**The commit is the implementer's leg, and it is verified, not trusted.**
Only the agent that wrote the change knows what its commit says, so a separate commit role would rediscover it from the diff — hence no such role.
Because the commit is what hands the ticket to the reviewers, `done` with an empty `SandboxRunResult.commits` is a `RoleError` rather than a silent pass over an uncommitted tree.
A `needs-input` leg is allowed to end with no commit of its own.

**needs-input is reported, never waited on.**
The prompt tells the implementer to stop and name what is missing rather than invent it; the harness turns that into the mid-block handover, as ticket 07 built it.

**Tested with no docker, model or network.**
A fake sandbox returns the run's stdout and commits: both result arms, the empty-commit refusal, a missing and an unusable block, the model and prompt args, and the crew wiring giving each ticket its own run.
