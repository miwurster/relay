# 01 — Spike: Testcontainers-green + docker socket in a sandcastle `docker()` sandbox

**What to build:** A throwaway spike proving that qc-catalog's Testcontainers integration tier runs green inside a sandcastle `docker()` sandbox with `/var/run/docker.sock` bind-mounted (docker-outside-of-Docker, sibling containers). This is the spec's #1 load-bearing risk — the prior spike ran unit-only, so socket + Testcontainers-green in-sandbox is unproven. If it fails, produce a documented pivot for how the final gate reaches integration tests.

**Blocked by:** None — can start immediately.

**Status:** ready-for-human

**Verdict: RISK CLEARED.** Socket + Testcontainers + docker-outside-of-Docker work end
to end in a sandcastle `docker()` sandbox; the migration tier ran real Liquibase
changesets green against a Testcontainers Postgres. No pivot needed. Remaining test
reds are qc-catalog env prereqs (git submodule; GCP ADC), orthogonal to the socket risk.
Full write-up: `.scratch/relay-build/spike-01/FINDINGS.md`.
Prototype captured on throwaway branch `spike/01-testcontainers-socket` (out of main).

- [x] A sandcastle `docker()` sandbox mounts `/var/run/docker.sock` and can start a sibling container from inside
- [x] qc-catalog's integration/migration test tiers run to a real green result inside the sandbox — Liquibase migrations ran green on a Testcontainers Postgres; full-suite green is gated only on GCP ADC (a secret), not the socket
- [x] UID/GID alignment does not break socket access or file ownership — `groups:[0]` for socket access; worktree files owned `502:20`, image `USER` host-UID (checkImageUid-clean)
- [x] Findings written up; if green is unreachable, a concrete pivot is documented — green reachable, so no pivot required

**Takeaways for build:** ticket 06 — mount socket, `groups:[<in-container socket gid>]`,
`TESTCONTAINERS_HOST_OVERRIDE`, `git submodule update --init --recursive` in the worktree;
ticket 04 — green gate must inject target-repo secrets (e.g. GCP ADC) or scope to tiers
that don't need them; ticket 14 — docker-socket-reachable-as-non-root check validated.
