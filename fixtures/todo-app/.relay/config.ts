/**
 * The rehearsal's fixture repo. `merge` landing, because a rehearsal is meant
 * to exercise every leg: under `pull-request` the lander opens a PR and stops,
 * where under `merge` it rebases, re-runs the gate, fast-forwards and closes —
 * the leg a rehearsal has the most to say about.
 */
export default {
  landing: "merge",
};
