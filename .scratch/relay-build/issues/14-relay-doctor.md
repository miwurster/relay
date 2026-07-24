# 14 — `relay doctor` full preflight

**What to build:** Replace the doctor stub with the real full opt-in preflight. It validates config (parse + zod), secrets presence, image resolvability (prebuilt ref or buildable dockerfile), and — because the final gate needs a live daemon — a docker-socket check. Unlike a real run's cheap fail-fast, doctor runs the deep checks eagerly and reports each. It exits 2 on any failure.

**Blocked by:** 04, 06

**Status:** ready-for-agent

- [ ] Validates config parse + zod
- [ ] Checks required secrets are present
- [ ] Checks image resolvable (prebuilt ref or buildable dockerfile)
- [ ] Docker-socket check
- [ ] Reports each check; exit 2 on any failure
