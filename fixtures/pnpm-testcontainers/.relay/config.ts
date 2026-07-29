/**
 * The sandbox probe's fixture repo. `pull-request` landing because a probe
 * never lands anything: it is the one mode where the lander does nothing at
 * all, so nothing here arms a code path the probe has no business touching.
 */
export default {
  landing: "pull-request",
};
