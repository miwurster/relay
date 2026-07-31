import { type Landing, LANDINGS } from "../src/config.js";
import { ConfigError } from "../src/errors.js";

/**
 * The landing by that name, or a refusal naming the ones that exist.
 *
 * Validated against relay's own `LANDINGS` rather than a list of its own, so the
 * rig cannot come to accept a landing relay does not, or refuse one it does.
 *
 * Its own module beside `scenarios.ts`, the rig's other argument lookup, so
 * resolving one costs nothing but this file — the seeder it feeds is where the
 * destruction lives. There is no default, because relay has none either: a
 * landing nobody chose is a base branch nobody agreed to move
 * ([ADR-0015](../docs/adr/0015-a-repo-declares-how-a-pass-lands.md)).
 */
export function resolveLanding(name: string): Landing {
  const landing = LANDINGS.find((candidate) => candidate === name);
  if (!landing) {
    throw new ConfigError(
      `There is no \`${name}\` landing. The landings that exist are: ${LANDINGS.join(", ")}.`,
    );
  }
  return landing;
}
