import { reasonOf } from "../src/errors.js";
import { seedRehearsalRepo } from "./seed.js";

/**
 * Seed the rehearsal repo on its own.
 *
 * Its own entry point so that a rehearsal can be driven by hand — seed, then
 * relay run with an ad-hoc flag, then digest what happened.
 */
const [scenario, landing] = process.argv.slice(2);
if (!scenario || !landing) {
  console.error("usage: npm run seed -- <scenario> <landing>");
  process.exit(2);
}

try {
  await seedRehearsalRepo({ scenario, landing });
} catch (error) {
  console.error(`seed: ${reasonOf(error)}`);
  process.exit(2);
}
