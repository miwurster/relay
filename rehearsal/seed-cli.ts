import { reasonOf } from "../src/errors.js";
import { seedRehearsalRepo } from "./seed.js";

/**
 * Seed the rehearsal repo on its own.
 *
 * Its own entry point so that a rehearsal can be driven by hand — seed, then
 * relay run with an ad-hoc flag, then digest what happened.
 */
const scenario = process.argv[2];
if (!scenario) {
  console.error("usage: npm run seed -- <scenario>");
  process.exit(2);
}

try {
  await seedRehearsalRepo(scenario);
} catch (error) {
  console.error(`seed: ${reasonOf(error)}`);
  process.exit(2);
}
