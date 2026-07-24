# 06 — Sandbox image + creation + runtime mounts

**What to build:** The Docker sandbox relay runs the pass in. Image is provided **prebuilt-ref-wins**: an optional `image` ref in `relay.config.ts` is used when present; otherwise relay builds from a configurable `dockerfile` path (default `docker/relay.Dockerfile`, never repo-root). The image bakes JDK 21 + Maven, Node, native claude, glab, and the docker CLI, with UID/GID aligned. At runtime relay mounts skills (into `~/.claude/skills/<name>`), the Atlassian MCP config (remote HTTP, carrying the SA bearer), and `/var/run/docker.sock`. The sandbox opens on a fresh branch + worktree.

**Blocked by:** 01, 04

**Status:** ready-for-agent

- [ ] Prebuilt `image` ref used when set; else build from `dockerfile` path (default `docker/relay.Dockerfile`, never repo-root)
- [ ] Image bakes JDK21+Maven, Node, claude, glab, docker CLI; UID/GID aligned
- [ ] Runtime mounts: skills, Atlassian MCP config (SA bearer), docker socket
- [ ] Sandbox opens on a fresh branch + worktree
