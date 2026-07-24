# Spike 01 — Testcontainers-green + docker socket in a sandcastle `docker()` sandbox

**Question (spec's #1 load-bearing risk):** does qc-catalog's Testcontainers tier
run green inside a sandcastle `docker()` sandbox with `/var/run/docker.sock`
bind-mounted (docker-outside-of-Docker, sibling containers)?

**Verdict: RISK CLEARED.** The socket + Testcontainers + docker-outside-of-Docker
path works end to end in a sandcastle `docker()` sandbox. The migration tier's real
database work — Liquibase changesets against a Testcontainers Postgres — ran green
inside the sandbox. The only remaining test failures are unrelated environment
prerequisites of qc-catalog (a git submodule and GCP credentials), not the socket
risk this spike targets.

Environment: macOS + Docker Desktop 29.6.2, host UID/GID `502:20`, sandcastle
`@ai-hero/sandcastle` v0.12.0 (local build), target `qc-catalog` `migration-tests`.

## What was proven green

1. **Non-root socket access.** Sandcastle runs the container as `--user 502:20`.
   The Docker Desktop socket appears inside the container as `root:root 0660`, so
   the agent user cannot reach it by default. Passing `groups: [0]` (`--group-add 0`,
   the socket's in-container GID, detected at runtime) fixes it:
   `id` → `uid=502(agent) gid=20 groups=20,0(root)`, and
   `docker version` returns server `29.6.2`.
2. **Sibling containers start.** `docker run hello-world` from inside the sandbox
   succeeds; Testcontainers then started `ryuk`, `postgres:17`, `vault`, `redis`.
3. **DOOD networking.** Sibling ports publish on the host daemon, not on the
   sandbox container's localhost. Setting `TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal`
   makes Testcontainers dial the host: Postgres came up at
   `jdbc:postgresql://host.docker.internal:64934/catalog` and HikariCP connected.
4. **Real migration work green.** Liquibase ran every changeset
   (`v0001.sql` … ) against that Postgres — "Update has been successful" throughout.
5. **UID/GID alignment is clean.** Bind-mounted worktree files show `502:20`
   (agent), matching the host. No ownership breakage, no runtime chown needed.
   The image bakes `USER 502` (host UID) via build args, satisfying sandcastle's
   `checkImageUid` preflight.

## What is NOT the socket risk (qc-catalog env prerequisites)

These blocked a 100%-green suite but are orthogonal to the load-bearing question:

- **Git submodule.** Sandcastle builds in a fresh git worktree, which does not
  populate submodules. qc-catalog keeps a generated resource
  (`openapi-service/openapi-service.yaml`) in a submodule; without it every Spring
  context failed to load (2759 errors, first run). Fixed with a host worktree hook:
  `onWorktreeReady: [{ command: "git submodule update --init --recursive" }]`.
- **GCP Application Default Credentials.** After the submodule fix, all 73
  remaining `migration-tests` errors share one root: `serviceExecutionMetricsProvider`
  needs GCP ADC ("Your default credentials were not found"). This is a secret the
  target repo's full Application context requires, not a socket/Testcontainers
  problem. A fully green suite needs ADC mounted (`GOOGLE_APPLICATION_CREDENTIALS`
  or `~/.config/gcloud`) — relay's config/secrets concern (ticket 04), not this spike.

## Takeaways for real relay (tickets 06 / 04 / 14)

- **06 (sandbox + mounts):** mount `/var/run/docker.sock`; pass `groups: [<socket
  gid detected in-container>]`; set `TESTCONTAINERS_HOST_OVERRIDE` (macOS Docker
  Desktop: `host.docker.internal`; Linux daemon differs — verify per host);
  keep UID/GID-aligned image (`USER $host_uid`, `checkImageUid`-clean).
- **06:** the worktree must `git submodule update --init --recursive` before the
  build. Bake this into worktree setup for any submodule-using target repo.
- **04 (secrets):** the target repo's own test env may need secrets (here GCP ADC).
  The green gate must be able to inject them, or scope the gate to the tiers that
  don't require them.
- **14 (doctor):** the docker-socket check is validated — daemon reachable as the
  non-root sandbox user is the right assertion.

## No pivot needed

Green was reachable for the socket/Testcontainers path, so no fallback (dedicated
CI runner for the gate) is required. The gate can run Testcontainers in-sandbox.

## Reproduce

`./run.sh` (one command: builds the image, detects the socket GID, runs `spike.ts`).
Full log in `spike.log`. Throwaway — see README.md.
