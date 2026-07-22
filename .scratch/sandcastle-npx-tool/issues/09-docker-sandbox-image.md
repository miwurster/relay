# Docker sandbox image strategy

Type: grilling
Status: open
Blocked by: 01, 06

## Question

How does the tool provide the local Docker sandbox image for the pilot repo?

The image must run the Java/Maven build + the in-sandbox claude-code agent, carry `glab`, and expose whatever ticket 01 decides skills need. The qc-catalog spike's CI-parity image (maven:3-eclipse-temurin-21 + glab + native claude + UID/GID alignment) is a **reference** for the required deps, not a base to copy.

Decide:

- Ship a Dockerfile template in the package and `build-image` at first run, require the target repo to supply one, or reuse the team devcontainer image?
- How skill/plugin/MCP assets land in the image or get mounted (from ticket 01).
- Docker-outside-of-Docker / socket mount only if integration tests need it at the gate (pilot gate is unit-tier — likely not).

Depends on ticket 01 (skill delivery) and ticket 06 (per-repo config + gate command).
