import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError } from "../src/errors.js";

const REHEARSAL_OWNER = "miwurster";

/** The repo's name, which is also the clone's basename. */
const REHEARSAL_NAME = "relay-rehearsal";

/**
 * The one repo the rehearsal owns, and the only one the seed may destroy.
 *
 * Hardcoded rather than configured ([ADR-0024](../docs/adr/0024-the-rehearsal-runs-against-a-real-throwaway-repo.md)):
 * the seed deletes whatever is in its target, so a setting pointing it
 * elsewhere is the mistake the guard below exists to prevent.
 */
export const REHEARSAL_REPO = `${REHEARSAL_OWNER}/${REHEARSAL_NAME}`;

/**
 * Where the rig keeps its clone. The basename is the repo's name on purpose:
 * `sandboxImageName` tags the sandbox image after it, so a path that varied
 * between runs would mint a new tag every run and pay an image build for it.
 *
 * Resolved through `realpathSync` for the reason `tests/sandbox-probe.probe.ts`
 * states: a symlinked temp directory leaves git inside the sandbox finding no
 * repository at all.
 */
export const CLONE_DIR = join(realpathSync(tmpdir()), REHEARSAL_NAME);

/** The branch genesis is pushed to, and the one a pass is cut from. */
export const BASE_BRANCH = "main";

/**
 * A github.com remote in either spelling, `.git` suffix optional, with the
 * `owner/repo` it names.
 */
const GITHUB_ORIGIN = /^(?:https:\/\/github\.com\/|git@github\.com:)(.+?)(?:\.git)?$/;

/**
 * Refuse unless `origin` is exactly the rehearsal repo.
 *
 * A pure function over the resolved origin string, so the one unrecoverable
 * action in the rig is covered by a unit test rather than first exercised by
 * being aimed at the wrong repo. There is deliberately no flag, argument or
 * environment variable that lifts the refusal: an override is the thing that
 * would let a mistake through.
 */
export function guardRehearsalOrigin(origin: string | undefined): void {
  if (origin && GITHUB_ORIGIN.exec(origin)?.[1] === REHEARSAL_REPO) return;

  throw new ConfigError(
    `The seed destroys everything in the repo it is aimed at, so it runs only against ` +
      `${REHEARSAL_REPO}. This clone's origin is ${origin || "not set at all"}. ` +
      "There is no flag and no environment variable that lifts this refusal — re-point the " +
      "clone's origin, or delete the clone and let the seed make it again.",
  );
}
