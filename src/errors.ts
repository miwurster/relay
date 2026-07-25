/**
 * A misconfigured run: an unreadable or invalid `relay.config.ts`, or a secret
 * relay cannot resolve. Always maps to the error exit code, and its message is
 * meant to be read by a human rather than dumped as a stack.
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}
