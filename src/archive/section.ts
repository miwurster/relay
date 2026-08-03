/**
 * One titled section of an archive, or of the digest inside it.
 *
 * An empty one says `none` rather than vanishing: an archive is read long after
 * its pass and diffed against other passes, so a section that disappeared when
 * it had nothing to report would read as a change to the flow rather than as the
 * absence it is.
 */
export function section(title: string, blocks: readonly string[]): string {
  return [`${title}:`, ...(blocks.length > 0 ? blocks : ["  none"]), ""].join("\n");
}
