/**
 * Paddle duel: two paddles, one ball, the court in its own units.
 *
 * Pure and frame-based: a state, the two paddles' targets and a step in seconds go in; the next
 * state and what it scored come out. Nothing here knows about pixels, React or the network, which is
 * what lets the same arithmetic run on the host of a match (which sends the state) and on the guest
 * (which sends only its paddle's position), and what lets the whole thing be checked without a
 * browser.
 *
 * The court is 1000 x 600 in its own units and the screen is a percentage of it, so the same match is
 * the same match on a phone held upright and on a desktop.
 */

export const COURT_WIDTH = 1000;
export const COURT_HEIGHT = 600;

export const PADDLE_HEIGHT = 120;
export const PADDLE_WIDTH = 18;
/** How far the paddle's face sits from the wall it defends. */
export const PADDLE_INSET = 34;

export const BALL_RADIUS = 13;
export const BALL_START_SPEED = 430;
export const BALL_SPEED_UP = 1.045;
export const BALL_MAX_SPEED = 820;
/** A paddle's own speed, in court units per second. */
export const PADDLE_SPEED = 620;

/** First to this many points takes the match. */
export const DUEL_TARGET = 7;

export type DuelSide = 'left' | 'right';

export type DuelState = {
  ballX: number;
  ballY: number;
  /** Court units per second. */
  vx: number;
  vy: number;
  /** The paddle's centre. */
  leftY: number;
  rightY: number;
  leftScore: number;
  rightScore: number;
  /** Which side the next serve travels toward: the side that just conceded. */
  serveTo: DuelSide;
};

export type DuelInput = {
  /** Where the paddle wants its centre, or null to hold still. */
  left: number | null;
  right: number | null;
};

export function duelStart(): DuelState {
  return {
    ...serve(0, 0, 'left'),
    leftY: COURT_HEIGHT / 2,
    rightY: COURT_HEIGHT / 2,
  };
}

/**
 * The ball, at the middle, travelling toward one side.
 *
 * The angle keeps away from the walls - a nearly vertical serve is a rally nobody can reach - and
 * the serve goes to whoever just conceded the point.
 */
function serve(
  leftScore: number,
  rightScore: number,
  to: DuelSide,
): Pick<DuelState, 'ballX' | 'ballY' | 'vx' | 'vy' | 'leftScore' | 'rightScore' | 'serveTo'> {
  const angle = (Math.random() * 0.5 - 0.25) * Math.PI;
  const direction = to === 'left' ? -1 : 1;

  return {
    ballX: COURT_WIDTH / 2,
    ballY: COURT_HEIGHT / 2,
    vx: Math.cos(angle) * BALL_START_SPEED * direction,
    vy: Math.sin(angle) * BALL_START_SPEED,
    leftScore,
    rightScore,
    serveTo: to,
  };
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Move one paddle toward a target at its own speed, and keep it on the court. */
function glide(from: number, target: number | null, dt: number): number {
  const low = PADDLE_HEIGHT / 2;
  const high = COURT_HEIGHT - PADDLE_HEIGHT / 2;
  if (target === null) return clamp(from, low, high);

  const step = PADDLE_SPEED * dt;
  const wanted = clamp(target, low, high);
  const distance = wanted - from;

  return Math.abs(distance) <= step ? wanted : from + Math.sign(distance) * step;
}

export type DuelStep = {
  state: DuelState;
  /** Which side scored on this step, if either: the hub says it out loud. */
  scored: DuelSide | null;
  /** True when the ball came off a paddle or a wall this step. */
  bounced: boolean;
};

/**
 * One step of the match.
 *
 * The ball is stepped first and the paddles after it, so a paddle moved onto the ball this frame
 * still saves it. The return depends on *where* on the paddle the ball arrived - the further from
 * the centre, the steeper it goes - which is what makes the game worth playing with two paddles, and
 * every return is a little faster than the last up to a cap.
 */
export function duelStep(state: DuelState, input: DuelInput, dt: number): DuelStep {
  const leftY = glide(state.leftY, input.left, dt);
  const rightY = glide(state.rightY, input.right, dt);

  let ballX = state.ballX + state.vx * dt;
  let ballY = state.ballY + state.vy * dt;
  let vx = state.vx;
  let vy = state.vy;
  let bounced = false;

  // The walls.
  if (ballY < BALL_RADIUS) {
    ballY = BALL_RADIUS;
    vy = Math.abs(vy);
    bounced = true;
  } else if (ballY > COURT_HEIGHT - BALL_RADIUS) {
    ballY = COURT_HEIGHT - BALL_RADIUS;
    vy = -Math.abs(vy);
    bounced = true;
  }

  // The faces the ball can come off: the left paddle's own right edge, and its mirror.
  const leftFace = PADDLE_INSET + PADDLE_WIDTH;
  const rightFace = COURT_WIDTH - PADDLE_INSET - PADDLE_WIDTH;
  const covers = (paddleY: number, at: number) => Math.abs(at - paddleY) <= PADDLE_HEIGHT / 2 + BALL_RADIUS * 0.5;

  const returnOff = (paddleY: number) =>
    clamp(((ballY - paddleY) / (PADDLE_HEIGHT / 2)) * Math.abs(vx) * 0.75, -BALL_MAX_SPEED * 0.9, BALL_MAX_SPEED * 0.9);

  const faster = () => {
    const speed = Math.hypot(vx, vy);
    if (speed === 0) return;

    const wanted = Math.min(BALL_MAX_SPEED, speed * BALL_SPEED_UP) / speed;
    vx *= wanted;
    vy *= wanted;
  };

  const crossingLeft = state.ballX - BALL_RADIUS > leftFace && ballX - BALL_RADIUS <= leftFace;
  const crossingRight = state.ballX + BALL_RADIUS < rightFace && ballX + BALL_RADIUS >= rightFace;

  if (vx < 0 && crossingLeft && covers(leftY, ballY)) {
    ballX = leftFace + BALL_RADIUS;
    // The return goes back the way it came: without this the ball carries on through the paddle.
    vx = Math.abs(vx);
    vy = returnOff(leftY);
    faster();
    bounced = true;
  } else if (vx > 0 && crossingRight && covers(rightY, ballY)) {
    ballX = rightFace - BALL_RADIUS;
    vx = -Math.abs(vx);
    vy = returnOff(rightY);
    faster();
    bounced = true;
  }

  // Past the wall it is a point, and the ball goes back to the middle for the side that conceded.
  if (ballX < -BALL_RADIUS * 2) {
    return { state: { ...serve(state.leftScore, state.rightScore + 1, 'left'), leftY, rightY }, scored: 'right', bounced: false };
  }

  if (ballX > COURT_WIDTH + BALL_RADIUS * 2) {
    return { state: { ...serve(state.leftScore + 1, state.rightScore, 'right'), leftY, rightY }, scored: 'left', bounced: false };
  }

  return { state: { ...state, ballX, ballY, vx, vy, leftY, rightY }, scored: null, bounced };
}

export function duelOver(state: DuelState): boolean {
  return state.leftScore >= DUEL_TARGET || state.rightScore >= DUEL_TARGET;
}

export function duelWinner(state: DuelState): DuelSide | null {
  if (state.leftScore >= DUEL_TARGET) return 'left';
  if (state.rightScore >= DUEL_TARGET) return 'right';

  return null;
}

/**
 * The solo opponent's paddle: the ball's height, missed a little on purpose.
 *
 * `skill` is how close it may get before it starts chasing: a low skill wanders around the middle, a
 * high one sits under the ball. It aims at where the ball *is* rather than where it is going, so a
 * steep return beats it, and it drifts back to the middle while the ball travels the other way.
 */
export function duelAiTarget(state: DuelState, side: DuelSide, skill = 0.55): number {
  const moving = side === 'left' ? state.vx < 0 : state.vx > 0;
  const line = moving ? state.ballY : COURT_HEIGHT / 2;
  const slack = (1 - clamp(skill, 0, 1)) * COURT_HEIGHT * 0.45;
  const wobble = Math.sin(state.ballY / 40 + state.leftScore + state.rightScore) * slack;

  return clamp(line + wobble, PADDLE_HEIGHT / 2, COURT_HEIGHT - PADDLE_HEIGHT / 2);
}

/** Which paddle a player drives: the account that sent the invitation takes the left one. */
export function duelSides(host: boolean): { mine: DuelSide; theirs: DuelSide } {
  return host ? { mine: 'left', theirs: 'right' } : { mine: 'right', theirs: 'left' };
}

/** One line of state for the hub's status bar. */
export function duelStatus(state: DuelState): string {
  const winner = duelWinner(state);
  if (winner !== null) {
    return `${winner === 'left' ? 'LEFT' : 'RIGHT'} PADDLE TAKES IT ${state.leftScore}-${state.rightScore}`;
  }

  return `${state.leftScore} - ${state.rightScore} :: FIRST TO ${DUEL_TARGET}`;
}
