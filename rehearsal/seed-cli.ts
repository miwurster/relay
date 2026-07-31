import { reasonOf } from "../src/errors.js";
import { resolveLanding } from "./landing.js";
import { resolveScenario } from "./scenarios.js";
import { seedRehearsalRepo } from "./seed.js";

/**
 * Seed the rehearsal repo on its own.
 *
 * Its own entry point so that a rehearsal can be driven by hand — seed, then
 * relay run with an ad-hoc flag, then digest what happened.
 *
 * Both arguments are resolved here, before the seeder is called at all: its next
 * act is to delete every issue in the rehearsal repo, so a mistyped name must
 * never reach it.
 */
const [scenario, landing] = process.argv.slice(2);
if (!scenario || !landing) {
  console.error("usage: npm run seed -- <scenario> <landing>");
  process.exit(2);
}

try {
  await seedRehearsalRepo({
    scenario: resolveScenario(scenario),
    landing: resolveLanding(landing),
  });
} catch (error) {
  console.error(`seed: ${reasonOf(error)}`);
  process.exit(2);
}
