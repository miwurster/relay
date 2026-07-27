import { ConfigError } from "../errors.js";

/**
 * The values, proven present — or one `ConfigError` naming every one that is
 * missing, so an operator fixes their whole setup in a single pass.
 *
 * A value is required precisely because it appears in `values`, so the message
 * can never drift from the check that produced it.
 */
export function requireAll<T extends Record<string, unknown>>(
  values: T,
  labels: { [K in keyof T]: string },
  problem: (missing: string[]) => string,
): { [K in keyof T]: NonNullable<T[K]> } {
  const keys = Object.keys(values) as (keyof T & string)[];
  const missing = keys.filter((key) => !values[key]).map((key) => labels[key]);
  if (missing.length > 0) {
    throw new ConfigError(problem(missing));
  }
  return values as { [K in keyof T]: NonNullable<T[K]> };
}
