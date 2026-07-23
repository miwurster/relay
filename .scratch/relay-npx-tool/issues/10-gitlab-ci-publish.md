# GitLab CI build + publish pipeline

Type: task
Status: open
Blocked by: 08

## Question

What is the `.gitlab-ci.yml` that builds and publishes `@quantum-hub/relay` to the NPM registry using kipu shared components?

Reference: `qhub-api/.gitlab-ci.yml` already uses `gitlab.com/kipu-all/commons/pipeline-components/{compile-typescript,publish-npm,semantic-release}` (that repo has separate `python/` + `typescript/` dirs; this tool is a single TS package).

Decide / produce:

- The stages + `include` components for a single-package TS repo (compile-typescript, semantic-release, publish-npm, oss-compliance).
- `project-dir` layout, `.releaserc.json`, and how the `@quantum-hub` scope + registry auth are configured for publish.
- Any tag/runner inputs (the reference pins `kubernetes` / `cluster`).

Depends on ticket 08 (package layout).
