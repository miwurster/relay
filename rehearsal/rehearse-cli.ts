import { reasonOf } from "../src/errors.js";
import { rehearse } from "./rehearse.js";

/**
 * One rehearsal, from any state to a digest on screen.
 *
 * Exits 0 whenever a rehearsal finished, whatever relay itself made of the work:
 * a blocked pass is an ordinary outcome, and its exit code is in the digest. A
 * non-zero exit here is the rig failing, not the flow.
 */
const scenario = process.argv[2];
if (!scenario) {
  console.error("usage: npm run rehearse -- <scenario>");
  process.exit(2);
}

try {
  await rehearse(scenario);
} catch (error) {
  console.error(`rehearse: ${reasonOf(error)}`);
  process.exit(2);
}
