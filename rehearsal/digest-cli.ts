import { digestRecords } from "./digest.js";

/**
 * Digest one pass's record directory on its own.
 *
 * Its own entry point so that a pass driven by hand — seeded by the rig, then
 * relay run with an ad-hoc flag — can still be digested afterwards.
 */
const dir = process.argv[2];
if (!dir) {
  console.error("usage: npm run digest -- <record-directory>");
  process.exit(2);
}

console.log(await digestRecords(dir));
