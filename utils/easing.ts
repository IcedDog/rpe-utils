/**
 * Complete set of RPE easing functions (28 types) with helpers for evaluation,
 * derivatives, integrals, and bezier curves. Compatible with RPE easingType 1–28.
 *
 * ## Easing type reference
 *
 * | # | Name | Direction |
 * |---|---|---|
 * | 1 | Linear | — |
 * | 2 | SineOut | ease out |
 * | 3 | SineIn | ease in |
 * | 4 | QuadOut | ease out |
 * | 5 | QuadIn | ease in |
 * | 6 | SineInOut | ease in-out |
 * | 7 | QuadInOut | ease in-out |
 * | 8 | CubicOut | ease out |
 * | 9 | CubicIn | ease in |
 * | 10 | QuartOut | ease out |
 * | 11 | QuartIn | ease in |
 * | 12 | CubicInOut | ease in-out |
 * | 13 | QuartInOut | ease in-out |
 * | 14 | QuintOut | ease out |
 * | 15 | QuintIn | ease in |
 * | 16 | ExpoOut | ease out |
 * | 17 | ExpoIn | ease in |
 * | 18 | CircOut | ease out |
 * | 19 | CircIn | ease in |
 * | 20 | BackOut | ease out (overshoot) |
 * | 21 | BackIn | ease in (overshoot) |
 * | 22 | CircInOut | ease in-out |
 * | 23 | BackInOut | ease in-out (overshoot) |
 * | 24 | ElasticOut | ease out (elastic) |
 * | 25 | ElasticIn | ease in (elastic) |
 * | 26 | ElasticInOut | ease in-out (elastic) |
 * | 27 | BounceOut | ease out (bounce) |
 * | 28 | BounceIn | ease in (bounce) |
 *
 * ## Usage examples
 *
 * ```ts
 * import { easing, EASING_NAMES, resolveEasingType } from './easing';
 *
 * // Evaluate CubicOut at 50% progress
 * const v = easing(8, 0.5); // ~0.875
 *
 * // Look up by name
 * const t = resolveEasingType('backOut'); // 20
 *
 * // Use a sub-range [0.2, 0.8] of SineInOut
 * const v2 = easing(6, 0.5, 0.2, 0.8);
 *
 * // Custom cubic-bezier (like CSS)
 * const v3 = easing(1, 0.5, 0, 1, undefined, [0.4, 0.0, 0.2, 1.0]);
 *
 * // Resolve an easing name to a number before storing in an event
 * const easingType = resolveEasingType('elasticOut'); // 24
 * ```
 *
 * @module easing
 */

import { clamp } from "./math";

// ─── Core Easing Functions (index 0–27, type = index + 1) ───────────────────

/**
 * All 28 RPE easing functions indexed from 0 (index 0 → easingType 1).
 *
 * Each function maps a progress value `x ∈ [0, 1]` to an output in approximately
 * `[0, 1]`. Some curves (Back, Elastic) temporarily exceed this range.
 *
 * You usually don't call these directly — use {@link easing} which handles
 * sub-ranges and bezier overrides.
 *
 * @example
 * ```ts
 * const f = EASINGS[7]; // CubicOut (easingType 8)
 * f!(0.5); // ~0.875
 * ```
 */
export const EASINGS: ((x: number) => number)[] = [
  /* 1  Linear       */ (x) => x,
  /* 2  SineOut      */ (x) => Math.sin((x * Math.PI) / 2),
  /* 3  SineIn       */ (x) => 1 - Math.cos((x * Math.PI) / 2),
  /* 4  QuadOut      */ (x) => 1 - (1 - x) * (1 - x),
  /* 5  QuadIn       */ (x) => x * x,
  /* 6  SineInOut    */ (x) => -(Math.cos(Math.PI * x) - 1) / 2,
  /* 7  QuadInOut    */ (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),
  /* 8  CubicOut     */ (x) => 1 - Math.pow(1 - x, 3),
  /* 9  CubicIn      */ (x) => x * x * x,
  /* 10 QuartOut     */ (x) => 1 - Math.pow(1 - x, 4),
  /* 11 QuartIn      */ (x) => x * x * x * x,
  /* 12 CubicInOut   */ (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  /* 13 QuartInOut   */ (x) => (x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2),
  /* 14 QuintOut     */ (x) => 1 - Math.pow(1 - x, 5),
  /* 15 QuintIn      */ (x) => x * x * x * x * x,
  /* 16 ExpoOut      */ (x) => (x === 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  /* 17 ExpoIn       */ (x) => (x === 0 ? 0 : Math.pow(2, 10 * x - 10)),
  /* 18 CircOut      */ (x) => Math.sqrt(1 - Math.pow(x - 1, 2)),
  /* 19 CircIn       */ (x) => 1 - Math.sqrt(1 - Math.pow(x, 2)),
  /* 20 BackOut      */ (x) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2),
  /* 21 BackIn       */ (x) => 2.70158 * x * x * x - 1.70158 * x * x,
  /* 22 CircInOut    */ (x) =>
    x < 0.5 ? (1 - Math.sqrt(1 - Math.pow(2 * x, 2))) / 2 : (Math.sqrt(1 - Math.pow(-2 * x + 2, 2)) + 1) / 2,
  /* 23 BackInOut    */ (x) =>
    x < 0.5
      ? (Math.pow(2 * x, 2) * ((2.59491 + 1) * 2 * x - 2.59491)) / 2
      : (Math.pow(2 * x - 2, 2) * ((2.59491 + 1) * (x * 2 - 2) + 2.59491) + 2) / 2,
  /* 24 ElasticOut   */ (x) =>
    x === 0 ? 0 : x === 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
  /* 25 ElasticIn    */ (x) =>
    x === 0 ? 0 : x === 1 ? 1 : -Math.pow(2, 10 * x - 10) * Math.sin((x * 10 - 10.75) * ((2 * Math.PI) / 3)),
  /* 26 BounceOut    */ (x) =>
    x < 1 / 2.75
      ? 7.5625 * x * x
      : x < 2 / 2.75
        ? 7.5625 * (x -= 1.5 / 2.75) * x + 0.75
        : x < 2.5 / 2.75
          ? 7.5625 * (x -= 2.25 / 2.75) * x + 0.9375
          : 7.5625 * (x -= 2.625 / 2.75) * x + 0.984375,
  /* 27 BounceIn     */ (x) => 1 - EASINGS[25]!(1 - x),
  /* 28 BounceInOut  */ (x) => (x < 0.5 ? (1 - EASINGS[25]!(1 - 2 * x)) / 2 : (1 + EASINGS[25]!(2 * x - 1)) / 2),
];

// ─── Parameter Sanitization ──────────────────────────────────────────────────

/**
 * Sanitize easing parameters to valid ranges.
 * @param type - Easing type (1–28).
 * @param x - Progress [0, 1].
 * @param easingLeft - Left boundary of the easing sub-range.
 * @param easingRight - Right boundary of the easing sub-range.
 */
export function sanitizeEasingParams(
  type: number,
  x: number,
  easingLeft: number,
  easingRight: number
): { type: number; x: number; easingLeft: number; easingRight: number } {
  return {
    type: type > 0 && type <= EASINGS.length ? type : 1,
    x: !x ? 0 : clamp(x, 0, 1),
    easingLeft: !easingLeft || easingLeft >= easingRight ? 0 : clamp(easingLeft, 0, 1),
    easingRight: !easingRight || easingLeft >= easingRight ? 1 : clamp(easingRight, 0, 1),
  };
}

// ─── Evaluation ──────────────────────────────────────────────────────────────

/**
 * Evaluate easing value at progress x, with optional sub-range [easingLeft, easingRight].
 * This maps x ∈ [0,1] through the easing curve restricted to the sub-range.
 */
export function calculateEasingValue(func: (x: number) => number, x: number, easingLeft = 0, easingRight = 1): number {
  const progress = func(easingLeft + (easingRight - easingLeft) * x);
  const progressStart = func(easingLeft);
  const progressEnd = func(easingRight);
  const denom = progressEnd - progressStart;
  if (Math.abs(denom) < 1e-15) return x; // degenerate case
  return (progress - progressStart) / denom;
}

/**
 * Evaluate an RPE easing at progress `x`.
 *
 * Handles sub-range clamping (`easingLeft`/`easingRight`) and optional
 * cubic-bezier override. This is the main function you call to get an eased
 * progress value from an RPE event.
 *
 * @param type - RPE easing type (1–28). Invalid types default to linear (1).
 * @param x - Raw progress ∈ [0, 1].
 * @param easingLeft - Left sub-range boundary (default 0). Use with `easingRight`
 *   to restrict the easing to a portion of the curve.
 * @param easingRight - Right sub-range boundary (default 1).
 * @param bezierPoints - If provided (4 numbers `[x1, y1, x2, y2]`), uses a
 *   CSS-style cubic bezier instead of the `type` curve.
 * @returns The eased progress value, usually ∈ [0, 1].
 *
 * @example
 * ```ts
 * easing(8, 0.5);              // CubicOut at 50% → ~0.875
 * easing(1, 0.5, 0.25, 0.75); // Linear, sub-range [0.25, 0.75]
 * easing(1, 0.5, 0, 1, [0.4, 0, 0.2, 1]); // Custom bezier
 * ```
 */
export function easing(type: number, x: number, easingLeft = 0, easingRight = 1, bezierPoints?: number[]): number {
  const useBezier = bezierPoints && bezierPoints.length >= 4;
  const bezierFunc = useBezier
    ? cubicBezier(...(bezierPoints.slice(0, 4) as [number, number, number, number]))
    : undefined;
  const p = sanitizeEasingParams(type, x, easingLeft, easingRight);
  const func = bezierFunc ?? EASINGS[p.type - 1]!;
  return calculateEasingValue(func, p.x, p.easingLeft, p.easingRight);
}

// ─── Derivative ──────────────────────────────────────────────────────────────

/**
 * Numerical derivative of an easing function at x.
 */
function calculateDerivativeValue(
  func: (x: number) => number,
  x: number,
  easingLeft = 0,
  easingRight = 1,
  epsilon = 1e-12
): number {
  const leftX = Math.max(1e-16, x - epsilon);
  const rightX = Math.min(1 - 1e-16, x + epsilon);
  const leftY = calculateEasingValue(func, leftX, easingLeft, easingRight);
  const rightY = calculateEasingValue(func, rightX, easingLeft, easingRight);
  return (rightY - leftY) / (rightX - leftX);
}

/** Precomputed derivative values at x=0 and x=1 for each easing. */
const EASING_DERIVATIVE_ENDS: [number, number][] = EASINGS.map((func) => [
  calculateDerivativeValue(func, 0),
  calculateDerivativeValue(func, 1),
]);

/**
 * Derivative of an RPE easing at x.
 * @param type - Easing type (1–28).
 * @param x - Progress ∈ [0, 1].
 * @param easingLeft - Left sub-range boundary.
 * @param easingRight - Right sub-range boundary.
 */
export function easingDerivative(type: number, x: number, easingLeft = 0, easingRight = 1): number {
  const p = sanitizeEasingParams(type, x, easingLeft, easingRight);
  return (p.x === 0 || p.x === 1) && p.easingLeft === 0 && p.easingRight === 1
    ? EASING_DERIVATIVE_ENDS[p.type - 1]![p.x]!
    : calculateDerivativeValue(EASINGS[p.type - 1]!, p.x, p.easingLeft, p.easingRight);
}

// ─── Integral (for speed events) ─────────────────────────────────────────────

/** Analytical integrals of all 28 easing functions. */
const EASING_INTEGRALS: ((x: number) => number)[] = [
  (x) => (x * x) / 2,
  (x) => (2 / Math.PI) * (1 - Math.cos((x * Math.PI) / 2)),
  (x) => x - (2 / Math.PI) * Math.sin((x * Math.PI) / 2),
  (x) => x * x - (x * x * x) / 3,
  (x) => (x * x * x) / 3,
  (x) => x / 2 - Math.sin(Math.PI * x) / (2 * Math.PI),
  (x) => (x < 0.5 ? (2 / 3) * Math.pow(x, 3) : 2 * x * x - (2 / 3) * Math.pow(x, 3) - x + 1 / 6),
  (x) => (3 / 2) * x * x - x * x * x + Math.pow(x, 4) / 4,
  (x) => Math.pow(x, 4) / 4,
  (x) => 2 * x * x - 2 * Math.pow(x, 3) + Math.pow(x, 4) - Math.pow(x, 5) / 5,
  (x) => Math.pow(x, 5) / 5,
  (x) => (x < 0.5 ? Math.pow(x, 4) : -3 * x + 6 * x * x - 4 * Math.pow(x, 3) + Math.pow(x, 4) + 0.5),
  (x) =>
    x < 0.5
      ? (8 / 5) * Math.pow(x, 5)
      : -7 * x + 16 * x * x - 16 * Math.pow(x, 3) + 8 * Math.pow(x, 4) - (8 / 5) * Math.pow(x, 5) + 11 / 10,
  (x) => (5 / 2) * x * x - (10 / 3) * Math.pow(x, 3) + (5 / 2) * Math.pow(x, 4) - Math.pow(x, 5) + Math.pow(x, 6) / 6,
  (x) => Math.pow(x, 6) / 6,
  (x) => x - (1 - Math.pow(2, -10 * x)) / (10 * Math.LN2),
  (x) => (Math.pow(2, 10 * x - 10) - Math.pow(2, -10)) / (10 * Math.LN2),
  (x) => 0.5 * ((x - 1) * Math.sqrt(Math.max(0, 1 - Math.pow(x - 1, 2))) + Math.asin(x - 1)) + Math.PI / 4,
  (x) => x - 0.5 * (x * Math.sqrt(Math.max(0, 1 - x * x)) + Math.asin(Math.max(-1, Math.min(1, x)))),
  // 20 BackOut
  (x) => {
    const a = 2.70158;
    const b = 1.70158;
    return (
      (1 - a + b) * x + ((3 * a - 2 * b) / 2) * x * x + ((-3 * a + b) / 3) * Math.pow(x, 3) + (a / 4) * Math.pow(x, 4)
    );
  },
  (x) => (2.70158 / 4) * Math.pow(x, 4) - (1.70158 / 3) * Math.pow(x, 3),
  // 22 CircInOut
  (x) =>
    x < 0.5
      ? 0.5 * x - 0.25 * x * Math.sqrt(Math.max(0, 1 - 4 * x * x)) - 0.125 * Math.asin(Math.max(-1, Math.min(1, 2 * x)))
      : 0.5 * x -
        0.25 * (1 - x) * Math.sqrt(Math.max(0, 1 - 4 * (1 - x) * (1 - x))) -
        0.125 * Math.asin(Math.max(-1, Math.min(1, 2 * (1 - x)))),
  // 23 BackInOut
  (x) => {
    const s = 2.59491;
    x = clamp(x, 0, 1);
    if (x <= 0.5) return (s + 1) * Math.pow(x, 4) - (2 * s * Math.pow(x, 3)) / 3;
    const Ihalf = (s + 1) * Math.pow(0.5, 4) - (2 * s * Math.pow(0.5, 3)) / 3;
    const F = (t: number) =>
      (s + 1) * Math.pow(t, 4) - ((10 * s + 12) / 3) * Math.pow(t, 3) + ((8 * s + 12) / 2) * t * t - (2 * s + 3) * t;
    return Ihalf + (F(x) - F(0.5));
  },
  // 24 ElasticOut
  (x) => {
    x = clamp(x, 0, 1);
    const K = 10 * Math.LN2;
    const A = ((2 * Math.PI) / 3) * 10;
    const B = -0.75 * ((2 * Math.PI) / 3);
    const H = (t: number) =>
      (Math.exp(-K * t) * (-K * Math.sin(A * t + B) - A * Math.cos(A * t + B))) / (A * A + K * K);
    return x + (H(x) - H(0));
  },
  // 25 ElasticIn
  (x) => {
    x = clamp(x, 0, 1);
    const K = 10 * Math.LN2;
    const A = ((2 * Math.PI) / 3) * 10;
    const B = -10.75 * ((2 * Math.PI) / 3);
    const C = Math.pow(2, -10);
    const G = (t: number) =>
      (-C * Math.exp(K * t) * (K * Math.sin(A * t + B) - A * Math.cos(A * t + B))) / (A * A + K * K);
    return G(x) - G(0);
  },
  // 26 BounceOut
  (x) => {
    x = clamp(x, 0, 1);
    const A = 7.5625;
    const b1 = 1 / 2.75;
    const b2 = 2 / 2.75;
    const b3 = 2.5 / 2.75;
    const c1 = 1.5 / 2.75;
    const c2 = 2.25 / 2.75;
    const c3 = 2.625 / 2.75;
    const I_b1 = (A * Math.pow(b1, 3)) / 3;
    const I_b2 = I_b1 + (A / 3) * (Math.pow(b2 - c1, 3) - Math.pow(b1 - c1, 3)) + 0.75 * (b2 - b1);
    const I_b3 = I_b2 + (A / 3) * (Math.pow(b3 - c2, 3) - Math.pow(b2 - c2, 3)) + 0.9375 * (b3 - b2);
    if (x < b1) return (A * Math.pow(x, 3)) / 3;
    if (x < b2) return I_b1 + (A / 3) * (Math.pow(x - c1, 3) - Math.pow(b1 - c1, 3)) + 0.75 * (x - b1);
    if (x < b3) return I_b2 + (A / 3) * (Math.pow(x - c2, 3) - Math.pow(b2 - c2, 3)) + 0.9375 * (x - b2);
    return I_b3 + (A / 3) * (Math.pow(x - c3, 3) - Math.pow(b3 - c3, 3)) + 0.984375 * (x - b3);
  },
  // 27 BounceIn
  (x) => {
    x = clamp(x, 0, 1);
    const bounceOutIntegral = EASING_INTEGRALS[25]!;
    const I1 = bounceOutIntegral(1);
    return x - (I1 - bounceOutIntegral(1 - x));
  },
  // 28 BounceInOut
  (x) => {
    x = clamp(x, 0, 1);
    const bounceOutIntegral = EASING_INTEGRALS[25]!;
    const I1 = bounceOutIntegral(1);
    if (x <= 0.5) {
      return x / 2 + (I1 - bounceOutIntegral(1 - 2 * x)) / 4;
    }
    return x / 2 + (I1 + bounceOutIntegral(2 * x - 1)) / 4;
  },
];

/**
 * Calculate the normalized integral of an easing curve from 0 to x.
 * Used for speed event height calculations.
 * @param type - Easing type (1–28).
 * @param x - Progress ∈ [0, 1].
 * @param easingLeft - Left sub-range boundary.
 * @param easingRight - Right sub-range boundary.
 */
export function calculateEasingIntegral(type: number, x: number, easingLeft = 0, easingRight = 1): number {
  const p = sanitizeEasingParams(type, x, easingLeft, easingRight);
  const l = p.easingLeft;
  const r = p.easingRight;
  const scaledX = l + (r - l) * p.x;
  const easingFunc = EASINGS[p.type - 1]!;
  const integralFunc = EASING_INTEGRALS[p.type - 1]!;
  const denom = easingFunc(r) - easingFunc(l);
  if (!Number.isFinite(denom) || Math.abs(denom) < 1e-15) return (p.x * p.x) / 2;
  return (integralFunc(scaledX) - integralFunc(l) - easingFunc(l) * (scaledX - l)) / ((r - l) * denom);
}

// ─── Cubic Bezier ────────────────────────────────────────────────────────────

/**
 * Create a cubic bezier easing function from two control points.
 * Equivalent to CSS `cubic-bezier(x1, y1, x2, y2)`.
 *
 * The start point is always (0, 0) and the end point is always (1, 1);
 * only the two inner control points are specified.
 *
 * @param x1 - X of the first control point (should be in [0, 1]).
 * @param y1 - Y of the first control point.
 * @param x2 - X of the second control point (should be in [0, 1]).
 * @param y2 - Y of the second control point.
 * @returns A function mapping progress `x ∈ [0, 1]` → eased value.
 *
 * @example
 * ```ts
 * // Equivalent to CSS ease-in-out
 * const ease = cubicBezier(0.42, 0, 0.58, 1);
 * ease(0.5); // ~0.5 (symmetric curve)
 *
 * // Material Design standard curve
 * const standard = cubicBezier(0.4, 0.0, 0.2, 1.0);
 * ```
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  // Newton's method to find the t parameter for a given x
  const sampleCurveX = (t: number) => ((1 - 3 * x2 + 3 * x1) * t + (3 * x2 - 6 * x1)) * t * (t + 3 * x1 * t);
  const sampleCurveY = (t: number) => ((1 - 3 * y2 + 3 * y1) * t + (3 * y2 - 6 * y1)) * t * (t + 3 * y1 * t);

  // More accurate bezier implementation
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const bezierX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const bezierY = (t: number) => ((ay * t + by) * t + cy) * t;
  const bezierDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  const findT = (x: number) => {
    let t = x;
    // Newton-Raphson
    for (let i = 0; i < 8; i++) {
      const residual = bezierX(t) - x;
      if (Math.abs(residual) < 1e-7) return t;
      const d = bezierDX(t);
      if (Math.abs(d) < 1e-7) break;
      t -= residual / d;
    }
    // Bisection fallback
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 20; i++) {
      const val = bezierX(t) - x;
      if (Math.abs(val) < 1e-7) return t;
      if (val > 0) hi = t;
      else lo = t;
      t = (lo + hi) / 2;
    }
    return t;
  };

  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return bezierY(findT(x));
  };
}

// ─── Human-friendly Easing Names ─────────────────────────────────────────────

/**
 * Numeric enum of all 28 RPE easing types.
 *
 * Use as a type-safe alternative to raw numbers when creating events:
 * ```ts
 * createEvent(0, 4, -675, 675, EasingType.CubicOut);
 * ```
 */
export enum EasingType {
  Linear = 1,
  SineOut = 2,
  SineIn = 3,
  QuadOut = 4,
  QuadIn = 5,
  SineInOut = 6,
  QuadInOut = 7,
  CubicOut = 8,
  CubicIn = 9,
  QuartOut = 10,
  QuartIn = 11,
  CubicInOut = 12,
  QuartInOut = 13,
  QuintOut = 14,
  QuintIn = 15,
  ExpoOut = 16,
  ExpoIn = 17,
  CircOut = 18,
  CircIn = 19,
  BackOut = 20,
  BackIn = 21,
  CircInOut = 22,
  BackInOut = 23,
  ElasticOut = 24,
  ElasticIn = 25,
  BounceOut = 26,
  BounceIn = 27,
  BounceInOut = 28,
}

/** Map of human-readable easing names to RPE easing type numbers. */
export const EASING_NAMES = {
  linear: 1,
  sineOut: 2,
  sineIn: 3,
  quadOut: 4,
  quadIn: 5,
  sineInOut: 6,
  quadInOut: 7,
  cubicOut: 8,
  cubicIn: 9,
  quartOut: 10,
  quartIn: 11,
  cubicInOut: 12,
  quartInOut: 13,
  quintOut: 14,
  quintIn: 15,
  expoOut: 16,
  expoIn: 17,
  circOut: 18,
  circIn: 19,
  backOut: 20,
  backIn: 21,
  circInOut: 22,
  backInOut: 23,
  elasticOut: 24,
  elasticIn: 25,
  bounceOut: 26,
  bounceIn: 27,
  bounceInOut: 28,
} as const;

/**
 * String literal union of all recognized RPE easing name strings.
 *
 * @example
 * ```ts
 * const e: EasingName = 'cubicOut'; // OK
 * const e2: EasingName = 'invalid'; // type error
 * ```
 */
export type EasingName = keyof typeof EASING_NAMES;

/**
 * Resolve an easing identifier (number, {@link EasingType}, or {@link EasingName}) to
 * its RPE type number (1–28).
 *
 * Returns `1` (linear) for any unrecognised input.
 *
 * @param easingId - An RPE type number (1–28), `EasingType` enum value, or `EasingName` string.
 * @returns The RPE easing type number.
 *
 * @example
 * ```ts
 * resolveEasingType(EasingType.CubicOut);  // 8
 * resolveEasingType('cubicOut');           // 8
 * resolveEasingType(8);                    // 8
 * resolveEasingType('invalid');            // 1  (falls back to linear)
 * resolveEasingType(0);                    // 1  (out of range)
 * ```
 */
export function resolveEasingType(easingId: number | EasingName): number {
  if (typeof easingId === "number") {
    return easingId >= 1 && easingId <= 28 ? easingId : 1;
  }
  return EASING_NAMES[easingId] ?? 1;
}
