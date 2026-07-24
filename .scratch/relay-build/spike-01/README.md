# PROTOTYPE — spike 01 (THROWAWAY)

Throwaway spike answering: does qc-catalog's Testcontainers tier run green inside a
sandcastle `docker()` sandbox with `/var/run/docker.sock` bind-mounted? **Not
production code.** The validated decisions live in `FINDINGS.md`.

## Run

```
./run.sh
```

One command: builds a UID/GID-aligned JDK21+docker-CLI image, detects the docker
socket GID as seen inside a container, then runs `spike.ts` (via sandcastle's tsx).

Env overrides: `SANDCASTLE` (default `~/work/sandbox/sandcastle`), `QC_CATALOG`
(default `~/work/kipu/qc-catalog`), `IMAGE_NAME` (default `relay-spike01:local`).

## Files

- `Dockerfile.spike` — minimal sandbox image (JDK21 + docker CLI + git).
- `spike.ts` — creates the sandbox, mounts the socket, runs migration-tests, prints state.
- `run.sh` — one-command entrypoint.
- `FINDINGS.md` — the verdict and takeaways. **This is the deliverable.**
- `spike.log` — last run's full output.

## Verdict

Risk cleared — see `FINDINGS.md`. Socket + Testcontainers + Liquibase-on-Postgres
green in-sandbox. Remaining test reds are qc-catalog env prereqs (git submodule,
GCP ADC), not the socket risk.
