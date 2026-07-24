# 01 — Spike: Testcontainers-green + docker socket in a sandcastle `docker()` sandbox

**What to build:** A throwaway spike proving that qc-catalog's Testcontainers integration tier runs green inside a sandcastle `docker()` sandbox with `/var/run/docker.sock` bind-mounted (docker-outside-of-Docker, sibling containers). This is the spec's #1 load-bearing risk — the prior spike ran unit-only, so socket + Testcontainers-green in-sandbox is unproven. If it fails, produce a documented pivot for how the final gate reaches integration tests.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] A sandcastle `docker()` sandbox mounts `/var/run/docker.sock` and can start a sibling container from inside
- [ ] qc-catalog's integration/migration test tiers run to a real green result inside the sandbox
- [ ] UID/GID alignment does not break socket access or file ownership
- [ ] Findings written up; if green is unreachable, a concrete pivot is documented
