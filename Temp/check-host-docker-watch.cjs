/**
 * keep-running.cjs's Docker watch (SPEC-self-hosting.md; added after Docker stopped unnoticed on 2026-11-18).
 *
 * Drives `decideDocker` - the watch's whole decision, with no clock or network - through a minute-by-minute story and
 * holds: nothing happens while Docker is still starting after sign-in; one or two misses are not an outage; the third
 * in a row acts once; the quiet period after an attempt doubles and stops at 30 minutes; an answer resets the count.
 * Loading the module must not start the program (no guard port, no services, no watch).
 */
const assert = require('node:assert/strict');
const { decideDocker, DOCKER } = require('../scripts/host/keep-running.cjs');

const MIN = 60 * 1000;
const start = 1_000_000_000;
let state = { misses: 0, attempts: 0, quietUntil: start + DOCKER.startupMs };

// Feed one answer per minute from `from`, return the minutes (relative to start) at which it acted.
function story(answers, from) {
  const acted = [];
  answers.forEach((answered, i) => {
    const now = from + i * MIN;
    const next = decideDocker(state, answered, now);
    state = next.state;
    if (next.act === 'recover') acted.push((now - start) / MIN);
  });
  return acted;
}

assert.equal(DOCKER.missesBeforeActing, 3, 'three misses in a row before acting');
assert.ok(DOCKER.startupMs >= 10 * MIN, 'Docker gets at least ten minutes after sign-in');

// Down for the whole start-up: nothing until the start-up window ends, then the third miss after it acts.
// minutes 0-9 are start-up; 10, 11, 12 are the three misses
assert.deepEqual(story(Array(10).fill(false), start), [], 'silent for the whole start-up window');
assert.deepEqual(story(Array(3).fill(false), start + 10 * MIN), [12], 'then acts on the third miss after it');
assert.equal(state.attempts, 1);

// Still down for three more hours: each attempt waits its quiet period, then misses at its end and the two minutes after
// (the third of those acts), so the gaps are quiet + 2: 5, 10, 20, then 30 for good.
const acts = [12, ...story(Array(180).fill(false), start + 13 * MIN)];
const gaps = acts.slice(1).map((t, i) => t - acts[i]);
assert.deepEqual(gaps.slice(0, 6), [7, 12, 22, 32, 32, 32], 'attempts back off 5, 10, 20, 30, 30 minutes');
assert.ok(gaps.every((g) => g <= 32), 'never waits longer than 30 minutes between attempts');

// An answer clears the count and the attempts: the next outage is treated as new.
state = { misses: 2, attempts: 4, quietUntil: 0 };
assert.deepEqual(story([true], start), []);
assert.deepEqual(state, { misses: 0, attempts: 0, quietUntil: 0 });
assert.deepEqual(story([false, false, true, false, false], start), [], 'a blip that comes back is not an outage');
assert.deepEqual(story([false], start + 5 * MIN), [5], 'the third miss in a row since the answer acts');

console.log('host docker watch checks passed (start-up grace, three misses, back-off 5/10/20/30, reset on answer)');
