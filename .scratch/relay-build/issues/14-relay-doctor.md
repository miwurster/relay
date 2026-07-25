# 14 — `relay doctor` full preflight

**What to build:** Replace the doctor stub with the real full opt-in preflight. It validates config (parse + zod), secrets presence, image resolvability (prebuilt ref or buildable dockerfile), and — because the final gate needs a live daemon — a docker-socket check. Unlike a real run's cheap fail-fast, doctor runs the deep checks eagerly and reports each. It exits 2 on any failure.

**Blocked by:** 04, 06

**Status:** resolved

- [x] Validates config parse + zod (`loadConfig`, the same loader a run uses)
- [x] Checks required secrets are present (`loadSecrets`, all missing ones reported at once)
- [x] Checks image resolvable: a prebuilt ref is proven present on the host or pullable from its registry (`verifyPrebuiltImage`), else the repo's dockerfile is really built
- [x] Docker-socket check: `dockerDaemonVersionInSandbox` runs `docker version` inside the image **as the image's own non-root user**, with the detected socket gid `--group-add`ed — a real round trip, not a path-exists test
- [x] Reports each check; exit 2 on any failure

## Answer

`src/doctor.ts` (the check list and its report), `src/sandbox-image.ts` (the two new docker probes).

**Checks run in dependency order, and a failure does not stop the run.** `runDoctorChecks` reports `config`, `secrets`, `sandbox image` and `docker daemon`, so a missing secret and an unreachable daemon are found in one go. A check whose prerequisite failed is `skipped` rather than failed — an image cannot be resolved without a config that parsed — and only `failed` checks drive the exit code.

**A prebuilt ref is verified, not trusted.** `resolveSandboxImage` returns a configured `image` as is, which is right for a run (docker pulls it when the sandbox starts) but would let doctor report a nonexistent ref as fine. Doctor looks it up with `docker image inspect`, falling back to `docker manifest inspect` so an unpulled ref is checked against its registry without pulling it.

**Doctor builds.** With no `image` configured, the only honest proof of "buildable dockerfile" is a build, so doctor builds and tags the repo's sandbox image. A preflight that mutates the host's image cache is heavier than the checklist implies; it is the deliberate reading of the bullet.

**Not in scope, deliberately.** `glab` authentication and `issue-tracker.md` presence appear in the older ticket 06 write-up but not in this checklist, so they are not checked here.
