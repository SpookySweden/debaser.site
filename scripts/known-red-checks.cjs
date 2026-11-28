/*
 * The checks that are red ON PURPOSE (docs/STATE.md, "Known red checks").
 *
 * A full run whose only failures are these does not make `npm run checks:changed` say FULL RUN DUE. Nothing else
 * changes: they still run, still print FAIL and still count against the run. Adding one is Luke's call, never a
 * session's own: give its file name, the date and the reason. Take it out again once it passes.
 */
module.exports = [
  {
    check: 'check-hidden-accounts.cjs',
    since: '2026-11-06',
    why: 'Luke chose to leave the house account locked for now; until it exists this check fails on it.',
  },
];
