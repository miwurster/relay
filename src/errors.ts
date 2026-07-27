/**
 * A failure relay understands well enough to explain. Always maps to the error
 * exit code, and its message is meant to be read by a human rather than dumped
 * as a stack.
 */
export class RelayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * A misconfigured run: an unreadable or invalid `relay.config.ts` or
 * `issue-tracker.md`, or a secret relay cannot resolve.
 */
export class ConfigError extends RelayError {}

/**
 * GitHub itself would not answer: a `gh` that failed, or an unexpected response.
 */
export class GitHubError extends RelayError {}

/** A `git` invocation itself failed — not one of init's guard refusals, which are `ConfigError`. */
export class GitError extends RelayError {}

/**
 * The sandbox could not be prepared or opened: an image that will not build, a
 * docker daemon that will not answer, or a worktree relay cannot create.
 */
export class SandboxError extends RelayError {}

/**
 * A role ran but did not deliver a usable answer: no tagged block, or one that
 * does not fit the shape the harness reads.
 */
export class RoleError extends RelayError {}

/**
 * No pass can start: the work item relay was pointed at cannot be named, or
 * fails an eligibility gate.
 */
export class SelectionError extends RelayError {}
