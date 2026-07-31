import { reasonOf } from "../src/errors.js";
import { rehearse } from "./rehearse.js";

/**
 * One rehearsal, from any state to a digest on screen.
 *
 * Exits 0 whenever a rehearsal finished, whatever relay itself made of the work:
 * a blocked pass is an ordinary outcome, and its exit code is in the digest. A
 * non-zero exit here is the rig failing, not the flow.
 */
const [scenario, landing] = process.argv.slice(2);
if (!scenario || !landing) {
  console.error("usage: npm run rehearse -- <scenario> <landing>");
  process.exit(2);
}

try {
  await rehearse({ scenario, landing });
} catch (error) {
  console.error(`rehearse: ${reasonOf(error)}`);
  process.exit(2);
}
