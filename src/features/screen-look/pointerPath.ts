// How Nyra's pointer moves, so it feels like a hand and not a jump: along a gentle arc, speeding up and slowing down

export type Point = [number, number];

// How much the path bows out, as a share of its length, and at most this many pixels
const BEND = 0.14;
const MAX_BEND = 90;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

// The arc's bend point: off the straight line, always toward the top, as a wrist turns
export function bendOf([fx, fy]: Point, [tx, ty]: Point): Point {
  const [dx, dy] = [tx - fx, ty - fy];
  const length = Math.hypot(dx, dy);
  if (length === 0) return [fx, fy];
  let [nx, ny] = [-dy / length, dx / length];
  if (ny > 0) [nx, ny] = [-nx, -ny];
  const bend = Math.min(length * BEND, MAX_BEND);
  return [(fx + tx) / 2 + nx * bend, (fy + ty) / 2 + ny * bend];
}

// Where the pointer is at time t, from 0 to 1, and which way it leans as it goes, in degrees
export function along(from: Point, to: Point, t: number): { at: Point; lean: number } {
  const bend = bendOf(from, to);
  const e = easeInOut(Math.min(Math.max(t, 0), 1));
  const u = 1 - e;
  const at: Point = [
    u * u * from[0] + 2 * u * e * bend[0] + e * e * to[0],
    u * u * from[1] + 2 * u * e * bend[1] + e * e * to[1],
  ];
  // Leaning into the way it goes, most in the middle, upright when it arrives
  const width = Math.abs(to[0] - from[0]);
  const lean = width === 0 ? 0 : Math.sign(to[0] - from[0]) * Math.min(width / 40, 9) * Math.sin(Math.PI * e);
  return { at, lean };
}
