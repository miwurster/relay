/**
 * The exit-code contract every relay pass honours.
 *
 * A single pass ends in exactly one of these states, and the process exit code
 * is how the caller (a human or an outer loop) tells them apart.
 */
export const ExitCode = {
  /** The pass reached a reviewable state, or there was nothing to do. */
  Success: 0,
  /** The pass was blocked mid-flight or bailed on an under-specified item. */
  Blocked: 1,
  /** Config / auth / infra / wrong-type error, or an unexpected crash. */
  Error: 2,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
