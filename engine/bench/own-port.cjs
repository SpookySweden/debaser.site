/**
 * What every check in this folder shares about WHERE it may run (SPEC-screens.md).
 *
 * An engine is live on this PC all the time, on port 8478, serving the real website. A check must never talk to
 * it, stop it or take its port. So each check has a port of its own (8610 and up), refuses port 8478 outright, and
 * refuses to start when anything at all is already answering on its port (it would not be the engine it started).
 *
 * And the owner plays League of Legends on this PC: while a match runs, no check starts anything.
 */
'use strict';

const net = require('node:net');
const { execFileSync } = require('node:child_process');

/** The live engine's port. Never used by a check. */
const LIVE_PORT = 8478;

/** Each check's own default port. */
const PORTS = { webrtc: 8610, settings: 8611, control: 8612, still: 8613, sound: 8614, pointer: 8615 };

/** Whether anything on this PC accepts a connection on that port. Nothing is sent to it. */
function answering(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: Number(port) });
    const done = (yes) => { socket.destroy(); resolve(yes); };
    socket.setTimeout(700);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/** Why a check may not run on this port, or '' when it may. */
async function portProblem(port) {
  const number = Number(port);
  if (!Number.isInteger(number) || number < 1 || number > 65535) return `"${port}" is not a port number.`;
  if (number === LIVE_PORT) return `Port ${LIVE_PORT} belongs to the engine that is live on this PC. A check never uses it: leave --port out, or give another.`;
  if (await answering(number)) return `Something is already answering on port ${number}, and it is not an engine this check started. Nothing was started. Stop that program, or give another port with --port.`;
  return '';
}

/** The owner plays League on this PC. While a match runs, nothing is started. */
function leagueRunning() {
  try {
    return /League of Legends\.exe/i.test(execFileSync('tasklist', { encoding: 'utf8', windowsHide: true }));
  } catch (error) {
    return false;
  }
}

/** Any League program at all (the client between matches, too). The one real controller test wants none. */
function anyLeagueProgram() {
  try {
    // One line a program, its file name first, in quotes.
    const found = execFileSync('tasklist', ['/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).map((line) => (/^"([^"]*)"/.exec(line) || [])[1] || '').filter((name) => /^(League|Riot)/i.test(name));
    return [...new Set(found)];
  } catch (error) {
    return [];
  }
}

module.exports = { LIVE_PORT, PORTS, portProblem, leagueRunning, anyLeagueProgram };
