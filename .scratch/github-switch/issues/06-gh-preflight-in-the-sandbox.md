# 06 — `gh` preflight inside the sandbox

**What to build:** a **sandbox** image without `gh` fails the **pass** in seconds instead of forty minutes in.

The image is built from the *target repo's* Dockerfile, so `gh` is installed by a file relay does not own.
Every tracker-facing **leg** needs it, and the **handover** needs it most — which is the last leg, after all the expensive work.
So relay checks for it before the first leg runs.

**Blocked by:** 02.

**Status:** ready-for-agent

- [ ] A sandbox whose `gh` check fails stops the pass before the first leg, with an error naming the image and telling the operator to install `gh` in their Dockerfile.
- [ ] A sandbox with `gh` present runs on unchanged.
- [ ] The check is covered through the existing sandbox-run seam, with no live container needed.
- [ ] `npm run verify` exits zero.
