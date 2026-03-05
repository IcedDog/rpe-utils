/**
 * Math utilities for chart manipulation: vectors, matrices, interpolation,
 * random/noise, rotation, and array helpers.
 *
 * ## Quick reference
 *
 * | Category | Key exports |
 * |---|---|
 * | Vec2 | `vec2`, `vec2Add`, `vec2Sub`, `vec2Scale`, `vec2Lerp`, `vec2Rotate`, `vec2Normalize` |
 * | Mat3 | `mat3Identity`, `mat3TRS`, `mat3Mul`, `mat3TransformVec2` |
 * | Scalar | `clamp`, `lerp`, `inverseLerp`, `remap`, `smoothstep`, `degToRad`, `radToDeg` |
 * | Angles | `wrapAngle`, `angleDifference`, `lerpAngle` |
 * | Random | `randomRange`, `randomInt`, `randomPick`, `shuffle`, `createSeededRandom` |
 * | Noise | `valueNoise1D`, `valueNoise2D`, `fbm2D` |
 * | Arrays | `linspace`, `arange`, `sum`, `average`, `minMax`, `groupBy`, `binarySearchRight` |
 * | Misc | `deepClone`, `approxEqual`, `fract`, `mod`, `sign` |
 *
 * @example
 * ```ts
 * import { vec2, vec2Add, vec2Normalize, lerp, clamp } from './math';
 *
 * // Normalize a direction vector and advance along it
 * const dir = vec2Normalize(vec2(3, 4));   // { x: 0.6, y: 0.8 }
 * const pos = vec2Add(vec2(0, 0), dir);    // { x: 0.6, y: 0.8 }
 *
 * // Smooth fade from 0 → 255 alpha
 * const alpha = Math.round(lerp(0, 255, clamp(t, 0, 1)));
 * ```
 *
 * @module math
 */

// ─── Vec2 ────────────────────────────────────────────────────────────────────

/**
 * Simple 2D vector.
 * @example
 * ```ts
 * const v: Vec2 = { x: 1, y: -2 };
 * ```
 */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Create a Vec2 from x and y components.
 * @example
 * ```ts
 * const origin = vec2(0, 0);
 * const point  = vec2(675, 450); // center of a 1350×900 scene
 * ```
 */
export function vec2(x: number, y: number): Vec2 {
  return { x, y };
}

/** Zero vector (0, 0). */
export const VEC2_ZERO: Vec2 = { x: 0, y: 0 };

/** Unit vector (1, 1). */
export const VEC2_ONE: Vec2 = { x: 1, y: 1 };

/** Unit vector pointing right (1, 0). */
export const VEC2_RIGHT: Vec2 = { x: 1, y: 0 };

/** Unit vector pointing up (0, -1) in screen space. */
export const VEC2_UP: Vec2 = { x: 0, y: -1 };

/** Add two vectors. */
export function vec2Add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

/** Subtract b from a. */
export function vec2Sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

/** Multiply vector by a scalar. */
export function vec2Scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

/** Negate a vector. */
export function vec2Negate(v: Vec2): Vec2 {
  return { x: -v.x, y: -v.y };
}

/** Dot product of two vectors. */
export function vec2Dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/** 2D cross product (scalar). */
export function vec2Cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

/** Euclidean length of a vector. */
export function vec2Length(v: Vec2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

/** Squared length of a vector (avoids sqrt). */
export function vec2LengthSq(v: Vec2): number {
  return v.x * v.x + v.y * v.y;
}

/** Distance between two points. */
export function vec2Distance(a: Vec2, b: Vec2): number {
  return vec2Length(vec2Sub(b, a));
}

/**
 * Normalize a vector to unit length (magnitude = 1).
 * Returns the zero vector if the input magnitude is effectively zero.
 * @example
 * ```ts
 * vec2Normalize(vec2(3, 4)); // { x: 0.6, y: 0.8 }
 * vec2Normalize(vec2(0, 0)); // { x: 0, y: 0 }
 * ```
 */
export function vec2Normalize(v: Vec2): Vec2 {
  const len = vec2Length(v);
  if (len < 1e-15) return VEC2_ZERO;
  return { x: v.x / len, y: v.y / len };
}

/**
 * Linearly interpolate between two vectors.
 * @param t - Progress in [0, 1]; 0 returns `a`, 1 returns `b`.
 * @example
 * ```ts
 * const mid = vec2Lerp(vec2(0, 0), vec2(100, 200), 0.5); // { x: 50, y: 100 }
 * ```
 */
export function vec2Lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Rotate a vector by an angle in radians (counter-clockwise in standard math coords).
 * @example
 * ```ts
 * import { degToRad } from './math';
 * const rotated = vec2Rotate(vec2(1, 0), degToRad(90)); // ≈ { x: 0, y: 1 }
 * ```
 */
export function vec2Rotate(v: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** Get the angle of a vector in radians (atan2). */
export function vec2Angle(v: Vec2): number {
  return Math.atan2(v.y, v.x);
}

/** Create a unit vector from an angle in radians. */
export function vec2FromAngle(angle: number): Vec2 {
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

/** Component-wise min of two vectors. */
export function vec2Min(a: Vec2, b: Vec2): Vec2 {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) };
}

/** Component-wise max of two vectors. */
export function vec2Max(a: Vec2, b: Vec2): Vec2 {
  return { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) };
}

/** Reflect vector v off a surface with the given normal. */
export function vec2Reflect(v: Vec2, normal: Vec2): Vec2 {
  const d = 2 * vec2Dot(v, normal);
  return { x: v.x - d * normal.x, y: v.y - d * normal.y };
}

/** Project vector a onto vector b. */
export function vec2Project(a: Vec2, b: Vec2): Vec2 {
  const denom = vec2LengthSq(b);
  if (denom < 1e-15) return VEC2_ZERO;
  const scalar = vec2Dot(a, b) / denom;
  return vec2Scale(b, scalar);
}

// ─── 3x3 Matrix (for 2D affine transforms) ──────────────────────────────────

/**
 * A 3x3 matrix represented as a flat `Float64Array` of 9 elements in **row-major** order.
 * Used for 2D affine transformations. Access element at row `r`, column `c` via `m[r*3+c]`.
 *
 * @example
 * ```ts
 * // Translate a point by (100, 50), then rotate 45°
 * import { mat3TRS, mat3TransformVec2, degToRad, vec2 } from './math';
 * const m = mat3TRS(100, 50, degToRad(45), 1, 1);
 * const p = mat3TransformVec2(m, vec2(10, 0));
 * ```
 */
export type Mat3 = Float64Array;

/** Create an identity 3x3 matrix. */
export function mat3Identity(): Mat3 {
  const m = new Float64Array(9);
  m[0] = 1;
  m[4] = 1;
  m[8] = 1;
  return m;
}

/** Create a 2D translation matrix. */
export function mat3Translate(tx: number, ty: number): Mat3 {
  const m = mat3Identity();
  m[2] = tx;
  m[5] = ty;
  return m;
}

/** Create a 2D rotation matrix (radians). */
export function mat3Rotate(angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const m = mat3Identity();
  m[0] = c;
  m[1] = -s;
  m[3] = s;
  m[4] = c;
  return m;
}

/** Create a 2D scaling matrix. */
export function mat3Scale(sx: number, sy: number): Mat3 {
  const m = mat3Identity();
  m[0] = sx;
  m[4] = sy;
  return m;
}

/** Multiply two 3x3 matrices (a * b). */
export function mat3Mul(a: Mat3, b: Mat3): Mat3 {
  const r = new Float64Array(9);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      r[row * 3 + col] = a[row * 3]! * b[col]! + a[row * 3 + 1]! * b[3 + col]! + a[row * 3 + 2]! * b[6 + col]!;
    }
  }
  return r;
}

/** Transform a Vec2 by a 3x3 affine matrix (treats as homogeneous [x, y, 1]). */
export function mat3TransformVec2(m: Mat3, v: Vec2): Vec2 {
  return {
    x: m[0]! * v.x! + m[1]! * v.y! + m[2]!,
    y: m[3]! * v.x! + m[4]! * v.y! + m[5]!,
  };
}

/**
 * Build a 2D affine transform matrix from translation, rotation, and scale (TRS order).
 * Equivalent to `T * R * S`.
 * @param tx - Translation X.
 * @param ty - Translation Y.
 * @param angle - Rotation in radians.
 * @param sx - Scale X.
 * @param sy - Scale Y.
 * @example
 * ```ts
 * const m = mat3TRS(675, 450, Math.PI / 4, 2, 2); // translate to center, rotate 45°, scale 2×
 * ```
 */
export function mat3TRS(tx: number, ty: number, angle: number, sx: number, sy: number): Mat3 {
  return mat3Mul(mat3Translate(tx, ty), mat3Mul(mat3Rotate(angle), mat3Scale(sx, sy)));
}

// ─── Scalar Math ─────────────────────────────────────────────────────────────

/**
 * Clamp a number to [min, max] (inclusive on both ends).
 * @example
 * ```ts
 * clamp(1.5, 0, 1); // 1
 * clamp(-3,  0, 1); // 0
 * clamp(0.4, 0, 1); // 0.4
 * ```
 */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Linear interpolation between `a` and `b` by `t`.
 * `t = 0` returns `a`; `t = 1` returns `b`. Values outside [0, 1] extrapolate.
 * @example
 * ```ts
 * lerp(0, 255, 0.5); // 127.5
 * lerp(100, 200, 0);  // 100
 * ```
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Inverse lerp: given a value between a and b, returns the t ∈ [0, 1]. */
export function inverseLerp(a: number, b: number, value: number): number {
  if (Math.abs(b - a) < 1e-15) return 0;
  return (value - a) / (b - a);
}

/**
 * Remap a value from the range [inMin, inMax] to [outMin, outMax].
 * @example
 * ```ts
 * remap(0.5, 0, 1, -675, 675); // 0  (center of the chart X range)
 * remap(128, 0, 255, 0, 1);     // ≈ 0.502
 * ```
 */
export function remap(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return lerp(outMin, outMax, inverseLerp(inMin, inMax, value));
}

/** Smooth step (Hermite interpolation) from edge0 to edge1. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Smoother step (Ken Perlin's improved version). */
export function smootherstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Convert degrees to radians.
 * @example `degToRad(180) === Math.PI`
 */
export function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Convert radians to degrees.
 * @example `radToDeg(Math.PI) === 180`
 */
export function radToDeg(radians: number): number {
  return (radians * 180) / Math.PI;
}

/** Wrap an angle to [-π, π]. */
export function wrapAngle(radians: number): number {
  let a = ((radians + Math.PI) % (2 * Math.PI)) - Math.PI;
  if (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Shortest angular difference between two angles in radians. */
export function angleDifference(from: number, to: number): number {
  return wrapAngle(to - from);
}

/** Linearly interpolate between two angles (handles wraparound). */
export function lerpAngle(from: number, to: number, t: number): number {
  return from + angleDifference(from, to) * t;
}

/** Fractional part of a number (always non-negative). */
export function fract(x: number): number {
  return x - Math.floor(x);
}

/** Modulo that always returns a non-negative result. */
export function mod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

/** Returns the sign of a number (-1, 0, or 1). */
export function sign(x: number): number {
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}

/** Check approximate equality within epsilon. */
export function approxEqual(a: number, b: number, epsilon = 1e-9): boolean {
  return Math.abs(a - b) <= epsilon;
}

// ─── Random ──────────────────────────────────────────────────────────────────

/** Generate a random float in [min, max). */
export function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Generate a random integer in [min, max] (inclusive). */
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Pick a random element from an array. Returns undefined for empty arrays. */
export function randomPick<T>(array: T[]): T | undefined {
  if (array.length === 0) return undefined;
  return array[Math.floor(Math.random() * array.length)];
}

/** Shuffle an array in-place using Fisher-Yates algorithm. Returns the same array. */
export function shuffle<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j]!, array[i]!];
  }
  return array;
}

/**
 * Create a seeded pseudo-random number generator (xoshiro128** variant).
 * The returned function produces independent floats in [0, 1) on each call.
 * Useful when you need reproducible randomness (e.g., deterministic patterns).
 * @param seed - Any integer seed.
 * @returns A stateful RNG function.
 * @example
 * ```ts
 * const rng = createSeededRandom(42);
 * const a = rng(); // always the same value for seed 42
 * const b = rng(); // next value in the sequence
 * ```
 */
export function createSeededRandom(seed: number): () => number {
  let s0 = seed | 0;
  let s1 = (seed * 1664525 + 1013904223) | 0;
  let s2 = (s1 * 1664525 + 1013904223) | 0;
  let s3 = (s2 * 1664525 + 1013904223) | 0;

  return () => {
    const result = Math.imul(s1 * 5, 7) >>> 0;
    const t = s1 << 9;
    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = (s3 << 11) | (s3 >>> 21);
    return (result >>> 0) / 4294967296;
  };
}

// ─── Noise ───────────────────────────────────────────────────────────────────

/**
 * 1D value noise.
 * @param x - Input coordinate.
 * @returns A smooth noise value in [0, 1].
 */
export function valueNoise1D(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f); // smoothstep
  return lerp(hash1D(i), hash1D(i + 1), u);
}

/**
 * 2D value noise.
 * @param x - X coordinate.
 * @param y - Y coordinate.
 * @returns A smooth noise value in [0, 1].
 */
export function valueNoise2D(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2D(ix, iy);
  const b = hash2D(ix + 1, iy);
  const c = hash2D(ix, iy + 1);
  const d = hash2D(ix + 1, iy + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}

/**
 * Multi-octave fractal Brownian motion (fBm) using 2D value noise.
 *
 * Combines several octaves of noise at progressively higher frequencies and
 * lower amplitudes to produce a natural-looking signal.
 *
 * @param x - X coordinate.
 * @param y - Y coordinate.
 * @param octaves - Number of noise octaves (default 4). More = finer detail.
 * @param lacunarity - Frequency multiplier per octave (default 2). Controls
 *   how quickly frequency increases.
 * @param gain - Amplitude multiplier per octave (default 0.5). Controls how
 *   quickly higher-frequency octaves fade out.
 * @returns Composite noise value in approximately [0, 1].
 * @example
 * ```ts
 * // Slowly evolving value suitable for animating line opacity over time
 * const opacity = fbm2D(beat * 0.1, lineIndex * 0.3) * 255;
 * ```
 */
export function fbm2D(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let amplitude = 1;
  let frequency = 1;
  let value = 0;
  let maxAmplitude = 0;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * valueNoise2D(x * frequency, y * frequency);
    maxAmplitude += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return value / maxAmplitude;
}

/** Integer hash for 1D noise. */
function hash1D(n: number): number {
  n = Math.imul((n >> 13) ^ n, 1274126177);
  n = Math.imul(n ^ (n >> 16), 1274126177);
  return ((n ^ (n >> 16)) >>> 0) / 4294967296;
}

/** Integer hash for 2D noise. */
function hash2D(x: number, y: number): number {
  return hash1D(x + Math.imul(y, 374761393));
}

// ─── Array Utilities ─────────────────────────────────────────────────────────

/**
 * Generate `n` evenly-spaced numbers from `start` to `end` (inclusive on both ends).
 * @example
 * ```ts
 * linspace(0, 1, 5);   // [0, 0.25, 0.5, 0.75, 1]
 * linspace(-675, 675, 3); // [-675, 0, 675]
 * ```
 */
export function linspace(start: number, end: number, n: number): number[] {
  if (n <= 1) return [start];
  const step = (end - start) / (n - 1);
  return Array.from({ length: n }, (_, i) => start + step * i);
}

/**
 * Generate a range of numbers `[start, start+step, ...]` stopping before `end`.
 * Similar to Python's `range()` / NumPy's `arange()`.
 * @example
 * ```ts
 * arange(0, 4);      // [0, 1, 2, 3]
 * arange(0, 1, 0.25); // [0, 0.25, 0.5, 0.75]
 * arange(4, 0, -1);  // [4, 3, 2, 1]
 * ```
 */
export function arange(start: number, end: number, step = 1): number[] {
  const result: number[] = [];
  for (let v = start; step > 0 ? v < end : v > end; v += step) {
    result.push(v);
  }
  return result;
}

/** Sum all numbers in an array. */
export function sum(arr: number[]): number {
  let s = 0;
  for (const v of arr) s += v;
  return s;
}

/** Average of all numbers in an array. Returns 0 for empty arrays. */
export function average(arr: number[]): number {
  if (arr.length === 0) return 0;
  return sum(arr) / arr.length;
}

/** Find min and max of an array simultaneously. */
export function minMax(arr: number[]): { min: number; max: number } {
  if (arr.length === 0) return { min: Infinity, max: -Infinity };
  let min = arr[0]!;
  let max = arr[0]!;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i]! < min) min = arr[i]!;
    if (arr[i]! > max) max = arr[i]!;
  }
  return { min, max };
}

/**
 * Binary search for the rightmost element where predicate is true.
 * Array must be sorted such that predicate is true for a prefix and false after.
 * Returns -1 if predicate is false for all elements.
 */
export function binarySearchRight<T>(arr: T[], predicate: (item: T) => boolean): number {
  let lo = 0;
  let hi = arr.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (predicate(arr[mid]!)) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

/**
 * Group array elements by a key function.
 * @returns A `Map` from key to array of elements that share that key.
 * @example
 * ```ts
 * const notes = line.notes ?? [];
 * const byType = groupBy(notes, n => n.type);
 * // byType.get(1) → all tap notes
 * // byType.get(2) → all hold notes
 * ```
 */
export function groupBy<T, K>(arr: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of arr) {
    const key = keyFn(item);
    const group = map.get(key);
    if (group) group.push(item);
    else map.set(key, [item]);
  }
  return map;
}

/**
 * Create a deep clone of any JSON-serializable object via `JSON.parse(JSON.stringify(…))`.
 * Safe for plain chart data objects. Does not preserve class instances, `undefined`,
 * `Infinity`, `NaN`, or circular references.
 * @example
 * ```ts
 * const copy = deepClone(chart.judgeLineList[0]);
 * copy.Name = 'Clone'; // original is unchanged
 * ```
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
