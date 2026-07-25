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
 * Jira itself would not answer: bad credentials, or an unexpected response.
 */
export class JiraError extends RelayError {}

/**
 * No pass can start: the work item relay was pointed at fails an eligibility
 * gate, or is of a type relay never runs.
 */
export class SelectionError extends RelayError {}
