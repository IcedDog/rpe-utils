/**
 * Utilities for working with `extra.json` — the prpr / Phira extension feature set.
 *
 * Covers:
 * - `ExtraJson` creation, parsing, serialization, validation
 * - Shader effect creation (built-in + custom), variable animation, uniform helpers
 * - Video background creation and manipulation
 * - Built-in shader presets with typed parameter interfaces
 * - Animated variable (`VariableEvent`) construction helpers
 *
 * ## Built-in shaders
 * `chromatic`, `circleBlur`, `fisheye`, `glitch`, `grayscale`, `noise`,
 * `pixel`, `radialBlur`, `shockwave`, `vignette`
 *
 * ## Quick-start
 *
 * ```ts
 * import {
 *   createExtra, addEffect, animateValue,
 *   setAnimatedUniform, serializeExtra,
 * } from './extra';
 *
 * const extra = createExtra(120);
 *
 * // Add a chromatic aberration effect from beat 0 to beat 8
 * const idx = addEffect(extra, 'chromatic', 0, 8, {
 *   vars: {
 *     // Animate the 'power' uniform from 0 to 0.05 over beats 0–4
 *     power: setAnimatedUniform(animateValue(0, 4, 0, 0.05)),
 *   },
 * });
 *
 * // Serialize
 * const json = serializeExtra(extra);
 * ```
 *
 * @see https://docs.dmocken.top/chart-standard/extra/
 *
 * @module extra
 */

import type {
  PhiraExtra,
  ShaderEffect,
  Video,
  VideoAttach,
  Variable,
  AnimatedVariable,
  VariableEvent,
  ScalarVariableEvent,
  VectorVariableEvent,
  Beat,
} from "./types";
import { toBeats, fromBeats } from "./events";
import { resolveEasingType } from "./easing";

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * All built-in shader names supported by prpr / Phira.
 */
export const BUILTIN_SHADERS = [
  "chromatic",
  "circleBlur",
  "fisheye",
  "glitch",
  "grayscale",
  "noise",
  "pixel",
  "radialBlur",
  "shockwave",
  "vignette",
] as const;

/** Union type of built-in shader names. */
export type BuiltinShaderName = (typeof BUILTIN_SHADERS)[number];

// ─── ExtraJson Creation / Parsing ───────────────────────────────────────────

/**
 * Create an empty `PhiraExtra` structure.
 *
 * @param bpm - Optional initial BPM value (creates a single BPM entry at beat 0
 *   in `extra.bpm`; only needed when the extra has its own independent BPM list).
 * @returns A minimal valid `PhiraExtra` with an empty effects array.
 *
 * @example
 * ```ts
 * const extra = createExtra();       // no BPM
 * const extra2 = createExtra(140);  // with BPM entry at beat 0
 * ```
 */
export function createExtra(bpm?: number): PhiraExtra {
  const extra: PhiraExtra = {
    effects: [],
  };
  if (bpm !== undefined) {
    extra.bpm = [{ time: [0, 0, 1] as Beat, bpm }];
  }
  return extra;
}

/**
 * Parse a JSON string into a PhiraExtra object and initialize beat fields.
 *
 * @param json - Raw JSON string of extra.json.
 * @returns Parsed and initialized PhiraExtra.
 */
export function parseExtra(json: string): PhiraExtra {
  const extra: PhiraExtra = JSON.parse(json);
  // Initialize startBeat/endBeat on effects
  if (extra.effects) {
    for (const effect of extra.effects) {
      effect.startBeat = toBeats(effect.start);
      effect.endBeat = toBeats(effect.end);
      if (effect.vars) {
        initializeEffectVars(effect.vars);
      }
    }
  }
  return extra;
}

/**
 * Serialize a PhiraExtra to JSON string.
 *
 * @param extra - The PhiraExtra object.
 * @param pretty - Pretty-print with indentation (default: true).
 * @returns JSON string.
 */
export function serializeExtra(extra: PhiraExtra, pretty = true): string {
  return JSON.stringify(extra, null, pretty ? 2 : undefined);
}

// ─── Shader Effect Creation ─────────────────────────────────────────────────

/** Options for creating a shader effect. */
export interface CreateEffectOptions {
  /** Whether the effect applies to UI elements too (default: false). */
  global?: boolean;
  /** Z-index targeting range. If set, the shader only affects objects in this range. */
  targetRange?: {
    minZIndex: number;
    maxZIndex: number;
    exclusive?: boolean;
  };
  /** Uniform variable overrides (static or animated). */
  vars?: Record<string, Variable>;
}

/**
 * Create a shader effect and add it to the extra.
 *
 * @param extra - PhiraExtra to modify in place.
 * @param shader - Shader name (built-in like `"chromatic"` or custom like `"/myshader.glsl"`).
 * @param startBeat - Effect start beat.
 * @param endBeat - Effect end beat.
 * @param options - Additional options.
 * @returns The index of the newly added effect.
 *
 * @example
 * ```ts
 * const extra = createExtra(120);
 * addEffect(extra, 'chromatic', 0, 8, {
 *   vars: { power: 0.02, sampleCount: 5 }
 * });
 * ```
 */
export function addEffect(
  extra: PhiraExtra,
  shader: string,
  startBeat: number,
  endBeat: number,
  options: CreateEffectOptions = {}
): number {
  const effect: ShaderEffect = {
    start: fromBeats(startBeat),
    startBeat,
    end: fromBeats(endBeat),
    endBeat,
    shader,
    global: options.global ?? false,
  };
  if (options.targetRange) effect.targetRange = options.targetRange;
  if (options.vars) effect.vars = options.vars;
  extra.effects.push(effect);
  return extra.effects.length - 1;
}

/**
 * Remove a shader effect by index.
 *
 * @param extra - PhiraExtra to modify.
 * @param index - Index of the effect to remove.
 * @returns The extra (for chaining).
 */
export function removeEffect(extra: PhiraExtra, index: number): PhiraExtra {
  extra.effects.splice(index, 1);
  return extra;
}

/**
 * Find all effects using a specific shader name.
 *
 * @param extra - The PhiraExtra.
 * @param shader - Shader name to search for.
 * @returns Array of matching effects with their indices.
 */
export function findEffects(extra: PhiraExtra, shader: string): { index: number; effect: ShaderEffect }[] {
  return extra.effects.map((effect, index) => ({ index, effect })).filter(({ effect }) => effect.shader === shader);
}

/**
 * Find all effects active at a given beat.
 *
 * @param extra - The PhiraExtra.
 * @param beat - Beat to check.
 * @returns Array of active effects with their indices.
 */
export function findActiveEffects(extra: PhiraExtra, beat: number): { index: number; effect: ShaderEffect }[] {
  return extra.effects
    .map((effect, index) => ({ index, effect }))
    .filter(({ effect }) => {
      const start = effect.startBeat ?? toBeats(effect.start);
      const end = effect.endBeat ?? toBeats(effect.end);
      return beat >= start && beat <= end;
    });
}

/**
 * Check whether a shader name refers to a custom (user-provided) shader.
 * Custom shaders start with `/`.
 *
 * @param shader - Shader name string.
 * @returns True if custom, false if built-in.
 */
export function isCustomShader(shader: string): boolean {
  return shader.startsWith("/");
}

/**
 * Check whether a shader name refers to a known built-in shader.
 *
 * @param shader - Shader name string.
 * @returns True if it's a recognized built-in.
 */
export function isBuiltinShader(shader: string): shader is BuiltinShaderName {
  return (BUILTIN_SHADERS as readonly string[]).includes(shader);
}

// ─── Animated Variable Helpers ──────────────────────────────────────────────

/**
 * Create a scalar variable event (keyframe for a uniform with a single numeric value).
 *
 * @param startBeat - Beat where the keyframe starts.
 * @param endBeat - Beat where the keyframe ends.
 * @param startValue - Uniform value at `startBeat`.
 * @param endValue - Uniform value at `endBeat`.
 * @param easingType - RPE easing type (1–28) or name (e.g., 'cubicOut'). Default: 1 (linear).
 * @param easingLeft - Left sub-range boundary (default: 0).
 * @param easingRight - Right sub-range boundary (default: 1).
 * @returns A `ScalarVariableEvent`.
 *
 * @example
 * ```ts
 * // Fade 'power' from 0 to 0.05 over beats 0–4
 * const kf = scalarEvent(0, 4, 0, 0.05);
 * ```
 */
export function scalarEvent(
  startBeat: number,
  endBeat: number,
  startValue: number,
  endValue: number,
  easingType: number | string = 1,
  easingLeft = 0,
  easingRight = 1
): ScalarVariableEvent {
  return {
    startTime: fromBeats(startBeat),
    startBeat,
    endTime: fromBeats(endBeat),
    endBeat,
    easingType: typeof easingType === "string" ? resolveEasingType(easingType) : easingType,
    easingLeft,
    easingRight,
    start: startValue,
    end: endValue,
  };
}

/**
 * Create a vector variable event (keyframe).
 *
 * @param startBeat - Start beat.
 * @param endBeat - End beat.
 * @param startValue - Vector value at start.
 * @param endValue - Vector value at end.
 * @param easingType - Easing type or name (default: 1 = linear).
 * @param easingLeft - Easing left trim (default: 0).
 * @param easingRight - Easing right trim (default: 1).
 * @returns A VectorVariableEvent.
 */
export function vectorEvent(
  startBeat: number,
  endBeat: number,
  startValue: number[],
  endValue: number[],
  easingType: number | string = 1,
  easingLeft = 0,
  easingRight = 1
): VectorVariableEvent {
  return {
    startTime: fromBeats(startBeat),
    startBeat,
    endTime: fromBeats(endBeat),
    endBeat,
    easingType: typeof easingType === "string" ? resolveEasingType(easingType) : easingType,
    easingLeft,
    easingRight,
    start: startValue,
    end: endValue,
  };
}

/**
 * Create an animated variable that linearly transitions from A to B
 * over a beat range.
 *
 * @param startBeat - Start beat.
 * @param endBeat - End beat.
 * @param from - Start value (number or number[]).
 * @param to - End value (number or number[]).
 * @param easingType - Easing type or name (default: 2 = linear in RPE convention).
 * @returns An AnimatedVariable (single-event array).
 */
export function animateValue(
  startBeat: number,
  endBeat: number,
  from: number | number[],
  to: number | number[],
  easingType: number | string = 2
): AnimatedVariable {
  if (typeof from === "number" && typeof to === "number") {
    return [scalarEvent(startBeat, endBeat, from, to, easingType)];
  }
  return [
    vectorEvent(startBeat, endBeat, Array.isArray(from) ? from : [from], Array.isArray(to) ? to : [to], easingType),
  ];
}

/**
 * Create a multi-keyframe animated variable from an array of `[beat, value, easing?]` tuples.
 *
 * Values are interpolated between consecutive keyframes using the specified easing.
 * If a keyframe has a third element (number or string), it overrides the default easing for the segment starting from that keyframe.
 * Both scalar (`number`) and vector (`number[]`) values are supported.
 *
 * @param keyframes - Sorted array of `[beat, value, easing?]` tuples (at least 2 entries).
 * @param easingType - Default easing type applied to segments without override (default: 2).
 * @returns An `AnimatedVariable`.
 *
 * @example
 * ```ts
 * // Ramp 'intensity' from 0 to 1 at beat 4, then back to 0 at beat 8
 * const anim = keyframesToAnimatedVariable([
 *   [0, 0],
 *   [4, 1],
 *   [8, 0],
 * ]);
 *
 * // With per-segment easing override
 * const anim2 = keyframesToAnimatedVariable([
 *   [0, 0],
 *   [4, 1, 'cubicOut'],  // Use cubicOut for 0→4
 *   [8, 0],              // Use default for 4→8
 * ], 'linear');
 *
 * // Animate a vec2 color parameter
 * const color = keyframesToAnimatedVariable([
 *   [0, [255, 255, 255]],
 *   [4, [255, 0, 0]],
 * ]);
 * ```
 */
export function keyframesToAnimatedVariable(
  keyframes: [number, number | number[], (number | string)?][],
  easingType: number | string = 2
): AnimatedVariable {
  if (keyframes.length < 2) {
    throw new Error("Need at least 2 keyframes to create an animated variable");
  }
  const defaultEasing = typeof easingType === "string" ? resolveEasingType(easingType) : easingType;
  const events: VariableEvent[] = [];
  for (let i = 0; i < keyframes.length - 1; i++) {
    const [beatA, valA, easingOverride] = keyframes[i]!;
    const [beatB, valB] = keyframes[i + 1]!;
    const segmentEasing =
      easingOverride !== undefined
        ? typeof easingOverride === "string"
          ? resolveEasingType(easingOverride)
          : easingOverride
        : defaultEasing;
    if (typeof valA === "number" && typeof valB === "number") {
      events.push(scalarEvent(beatA, beatB, valA, valB, segmentEasing));
    } else {
      events.push(
        vectorEvent(
          beatA,
          beatB,
          Array.isArray(valA) ? valA : [valA],
          Array.isArray(valB) ? valB : [valB],
          segmentEasing
        )
      );
    }
  }
  return events;
}

/**
 * Create a "pulse" animated variable: ramps from 0 to `peak` then back to 0.
 *
 * Shorthand for a common shockwave / flash pattern.
 *
 * @param startBeat - Beat where the ramp-up begins.
 * @param peakBeat - Beat where the value reaches its maximum.
 * @param endBeat - Beat where the value returns to 0.
 * @param peak - Peak value (default: 1). Accepts a scalar or vector.
 * @param easingIn - Easing for the ramp-up phase (default: 2).
 * @param easingOut - Easing for the ramp-down phase (default: 2).
 * @returns An `AnimatedVariable` with two events.
 *
 * @example
 * ```ts
 * // Short shockwave pulse: 0 → 1 → 0 between beats 0, 0.5, 2
 * const pulse = pulseVariable(0, 0.5, 2, 1, 'cubicOut', 'cubicIn');
 * ```
 */
export function pulseVariable(
  startBeat: number,
  peakBeat: number,
  endBeat: number,
  peak: number | number[] = 1,
  easingIn = 2,
  easingOut = 2
): AnimatedVariable {
  const zero = typeof peak === "number" ? 0 : peak.map(() => 0);
  return [
    ...(animateValue(startBeat, peakBeat, zero, peak, easingIn) as VariableEvent[]),
    ...(animateValue(peakBeat, endBeat, peak, zero, easingOut) as VariableEvent[]),
  ];
}

/**
 * Evaluate a Variable at a given beat.
 * - If it's a single number or number[], returns it as-is.
 * - If it's a string (texture reference), returns it as-is.
 * - If it's an AnimatedVariable, interpolates the value at the beat.
 *
 * @param variable - The Variable to evaluate.
 * @param beat - Current beat.
 * @returns The interpolated value.
 */
export function evaluateVariable(variable: Variable, beat: number): number | number[] | string {
  // String (texture reference)
  if (typeof variable === "string") return variable;
  // Static number
  if (typeof variable === "number") return variable;
  // Static number array (check: first element is a number, not an object)
  if (Array.isArray(variable) && variable.length > 0 && typeof variable[0] === "number") {
    return variable as number[];
  }
  // AnimatedVariable (array of VariableEvent)
  const events = variable as AnimatedVariable;
  if (events.length === 0) return 0;

  // Find the active event
  let cur = 0;
  for (let i = 0; i < events.length - 1; i++) {
    const nextBeat = events[i + 1]!.startBeat ?? toBeats(events[i + 1]!.startTime);
    if (beat > nextBeat) cur = i + 1;
    else break;
  }

  const ev = events[cur]!;
  const evStart = ev.startBeat ?? toBeats(ev.startTime);
  const evEnd = ev.endBeat ?? toBeats(ev.endTime);
  const duration = evEnd - evStart;
  if (duration <= 0) return ev.start;

  const t = Math.max(0, Math.min(1, (beat - evStart) / duration));
  // Apply easing (simplified linear for now; full easing would import from easing module)
  if (typeof ev.start === "number" && typeof ev.end === "number") {
    return ev.start + (ev.end - ev.start) * t;
  }
  if (Array.isArray(ev.start) && Array.isArray(ev.end)) {
    return ev.start.map((s, i) => s + ((ev.end as number[])[i]! - s) * t);
  }
  return ev.start;
}

// ─── Fluent Builders ─────────────────────────────────────────────────────────

/**
 * Options for `EffectBuilder.animate()`.
 */
export interface AnimateOptions {
  /** Start beat for the animation (defaults to the effect's own `startBeat`). */
  start?: number;
  /** End beat for the animation (defaults to the effect's own `endBeat`). */
  end?: number;
  /** Easing: RPE number (1–28) or a named easing string like `'cubicOut'`. Default: 2 (linear). */
  easing?: number | string;
}

/**
 * Fluent wrapper around a `ShaderEffect` for ergonomic uniform configuration.
 *
 * Obtain one via `ExtraBuilder.addEffect()` or `ExtraBuilder.addShader()`.
 *
 * All mutating methods return `this` for chaining. Navigate back to the parent
 * `ExtraBuilder` via `.toExtra()`.
 *
 * @example
 * ```ts
 * extra.addEffect('/camera.glsl', 0, 32)
 *   .animate('posZ', 5, 0.5, { easing: 'cubicOut' })
 *   .animate('rotX', 0, Math.PI * 6, { easing: 'cubicOut' })
 *   .set('alpha', 1.0)
 *   .setRange(100, 101)
 *   .setGlobal(false);
 * ```
 */
export class EffectBuilder {
  /** The underlying `ShaderEffect` data. Direct mutations are fine. */
  readonly data: ShaderEffect;
  private readonly _extra: ExtraBuilder;

  constructor(effect: ShaderEffect, extra: ExtraBuilder) {
    this.data = effect;
    this._extra = extra;
  }

  /** Effect start beat. */
  get startBeat(): number {
    return this.data.startBeat ?? toBeats(this.data.start);
  }

  /** Effect end beat. */
  get endBeat(): number {
    return this.data.endBeat ?? toBeats(this.data.end);
  }

  /**
   * Set a static or animated variable on this effect.
   *
   * @param name  - Uniform variable name.
   * @param value - Static number, vector, string (texture), or `AnimatedVariable`.
   */
  set(name: string, value: Variable): this {
    if (!this.data.vars) this.data.vars = {};
    this.data.vars[name] = value;
    return this;
  }

  /**
   * Animate a uniform variable from `from` → `to` over a beat range.
   *
   * The beat range defaults to the effect's own `[startBeat, endBeat]`,
   * so you only need to supply value overrides for the common case.
   *
   * @example
   * ```ts
   * effect.animate('posZ', 5, 0.5, { easing: 'cubicOut' });
   * effect.animate('rotX', 0, Math.PI * 4, { start: 0, end: 16, easing: 'sineInOut' });
   * ```
   */
  animate(name: string, from: number | number[], to: number | number[], opts: AnimateOptions = {}): this {
    const start = opts.start ?? this.startBeat;
    const end = opts.end ?? this.endBeat;
    const easingType = typeof opts.easing === "string" ? resolveEasingType(opts.easing) : (opts.easing ?? 2);
    return this.set(name, animateValue(start, end, from, to, easingType));
  }

  /**
   * Set a multi-keyframe animated variable via `[beat, value, easing?]` tuples.
   *
   * @param name   - Uniform variable name.
   * @param kfs    - Sorted `[beat, value, easing?]` tuples (at least 2 entries). If easing is provided per keyframe, it overrides the default for that segment.
   * @param easing - Default easing applied to segments without override. Default: 2 (linear).
   *
   * @example
   * ```ts
   * effect.keyframes('rotX', [
   *   [0,  0],
   *   [16, Math.PI, 'cubicOut'],  // Use cubicOut for 0→16
   *   [32, Math.PI * 2],          // Use default for 16→32
   * ], 'linear');
   * ```
   */
  keyframes(
    name: string,
    kfs: [beat: number, value: number | number[], easing?: number | string][],
    easing: number | string = 2
  ): this {
    return this.set(name, keyframesToAnimatedVariable(kfs, easing));
  }

  /**
   * Animate a variable as a pulse: `0 → peak → 0`.
   *
   * Ramp-up spans `[effect.startBeat, peakBeat]`; ramp-down spans
   * `[peakBeat, effect.endBeat]`.
   *
   * @param name     - Uniform variable name.
   * @param peakBeat - Beat where the peak is reached.
   * @param peak     - Peak value (default: 1).
   * @param opts     - Optional easing for each phase.
   *
   * @example
   * ```ts
   * // Flash 'intensity' at the midpoint of the effect
   * const mid = (effect.startBeat + effect.endBeat) / 2;
   * effect.pulse('intensity', mid, 1, { easingIn: 'cubicOut', easingOut: 'cubicIn' });
   * ```
   */
  pulse(
    name: string,
    peakBeat: number,
    peak: number | number[] = 1,
    opts: { easingIn?: number | string; easingOut?: number | string } = {}
  ): this {
    const easingIn = typeof opts.easingIn === "string" ? resolveEasingType(opts.easingIn) : (opts.easingIn ?? 2);
    const easingOut = typeof opts.easingOut === "string" ? resolveEasingType(opts.easingOut) : (opts.easingOut ?? 2);
    return this.set(name, pulseVariable(this.startBeat, peakBeat, this.endBeat, peak, easingIn, easingOut));
  }

  /**
   * Populate missing uniform defaults by parsing a GLSL shader source.
   *
   * Only uniforms **not** already present in `this.data.vars` are set —
   * existing values (including animations you've already applied) are preserved.
   *
   * Uniforms must be annotated with `// %default%` in the shader source.
   *
   * @param source - Full GLSL shader source text.
   */
  fromShader(source: string): this {
    const defaults = uniformsToVars(parseShaderUniforms(source));
    for (const [k, v] of Object.entries(defaults)) {
      if (!this.data.vars?.[k]) this.set(k, v);
    }
    return this;
  }

  /**
   * Set the z-index target range (restricts which objects the shader affects).
   *
   * @param min       - Minimum z-index.
   * @param max       - Maximum z-index.
   * @param exclusive - Whether the range is exclusive (default: false).
   */
  setRange(min: number, max: number, exclusive = false): this {
    this.data.targetRange = { minZIndex: min, maxZIndex: max, exclusive };
    return this;
  }

  /** Set whether the effect also applies to UI elements. */
  setGlobal(global: boolean): this {
    this.data.global = global;
    return this;
  }

  /** Navigate back to the parent `ExtraBuilder`. */
  toExtra(): ExtraBuilder {
    return this._extra;
  }
}

/**
 * Fluent builder for `PhiraExtra`.
 *
 * Wraps a `PhiraExtra` object and provides ergonomic methods for creating shader
 * effects (with fluent per-uniform configuration via `EffectBuilder`) and videos.
 *
 * ```ts
 * // From scratch:
 * const extra = new ExtraBuilder(120);
 *
 * // Wrap an existing parsed extra.json:
 * const extra = ExtraBuilder.from(existingExtra);
 * ```
 *
 * ## Shader workflow
 * ```ts
 * import { readFileSync } from 'fs';
 *
 * const glsl = readFileSync('shaders/camera.glsl', 'utf8');
 *
 * new ExtraBuilder(120)
 *   .addShader('/camera.glsl', glsl, 0, 32)  // auto-populates defaults from GLSL
 *   .animate('posZ', 5, 0.5, { easing: 'cubicOut' })
 *   .animate('rotX', 0, Math.PI * 6, { easing: 'cubicOut' })
 *   .setRange(100, 101)
 *   .toExtra()
 *   .serialize();
 * ```
 */
export class ExtraBuilder {
  /** The underlying `PhiraExtra` data. Direct mutations are fine. */
  private _data: PhiraExtra;

  get data(): PhiraExtra {
    return this._data;
  }

  /**
   * @param bpmOrData - Optional initial BPM, or an existing `PhiraExtra` to wrap.
   */
  constructor(bpmOrData?: number | PhiraExtra) {
    if (bpmOrData !== undefined && typeof bpmOrData === "object") {
      this._data = bpmOrData;
    } else {
      this._data = createExtra(bpmOrData as number | undefined);
    }
  }

  /** Wrap an existing `PhiraExtra` object. */
  static from(extra: PhiraExtra): ExtraBuilder {
    return new ExtraBuilder(extra);
  }

  /**
   * Add a shader effect and return a fluent `EffectBuilder` for configuring
   * its uniform variables inline.
   *
   * @param shader    - Built-in name (`'chromatic'`) or custom path (`'/myshader.glsl'`).
   * @param startBeat - Effect start beat.
   * @param endBeat   - Effect end beat.
   * @param vars      - Initial variable overrides (static or animated).
   * @param options   - Additional options (`global`, `targetRange`).
   *
   * @example
   * ```ts
   * extra.addEffect('chromatic', 0, 8)
   *   .animate('power', 0, 0.05, { easing: 'sineInOut' })
   *   .set('sampleCount', 5);
   * ```
   */
  addEffect(
    shader: string,
    startBeat: number,
    endBeat: number,
    vars: Record<string, Variable> = {},
    options: Omit<CreateEffectOptions, "vars"> = {}
  ): EffectBuilder {
    const idx = addEffect(this._data, shader, startBeat, endBeat, { ...options, vars });
    return new EffectBuilder(this._data.effects[idx]!, this);
  }

  /**
   * Add a custom shader effect whose default uniform values are auto-parsed
   * from the provided GLSL source code.
   *
   * Uniforms annotated with `// %default%` comments in the shader become the
   * initial variable values. You can then override or animate specific uniforms
   * via the returned `EffectBuilder`.
   *
   * @param shaderPath - Custom shader path (e.g. `'/camera_ssaa.glsl'`). A leading
   *                     `/` is added automatically if missing.
   * @param glslSource - Full GLSL shader source text.
   * @param startBeat  - Effect start beat.
   * @param endBeat    - Effect end beat.
   * @param options    - Additional options.
   *
   * @example
   * ```ts
   * import { readFileSync } from 'fs';
   * const glsl = readFileSync('shaders/camera.glsl', 'utf8');
   *
   * extra.addShader('/camera.glsl', glsl, 0, 32, {
   *   targetRange: { minZIndex: 100, maxZIndex: 101 },
   * })
   *   .animate('posZ', 5, 0.5, { easing: 'cubicOut' })
   *   .animate('rotX', 0, Math.PI * 6, { easing: 'cubicOut' });
   * ```
   */
  addShader(
    shaderPath: string,
    glslSource: string,
    startBeat: number,
    endBeat: number,
    options: Omit<CreateEffectOptions, "vars"> = {}
  ): EffectBuilder {
    const normalizedPath = shaderPath.startsWith("/") ? shaderPath : `/${shaderPath}`;
    return this.addEffect(normalizedPath, startBeat, endBeat, {}, options).fromShader(glslSource);
  }

  /** Remove a shader effect by index. Returns `this` for chaining. */
  removeEffect(index: number): this {
    removeEffect(this._data, index);
    return this;
  }

  /**
   * Add a video background.
   *
   * @example
   * ```ts
   * extra.addVideo('bg.mp4', 0, { scale: 'cropCenter', dim: 0.3 });
   * ```
   */
  addVideo(path: string, startBeat: number, options: CreateVideoOptions = {}): this {
    addVideo(this._data, path, startBeat, options);
    return this;
  }

  /** Remove a video by index. Returns `this` for chaining. */
  removeVideo(index: number): this {
    removeVideo(this._data, index);
    return this;
  }

  /** Offset all effects and videos by `beatOffset` beats. */
  offset(beatOffset: number): this {
    offsetExtra(this._data, beatOffset);
    return this;
  }

  /** Sort effects by start beat. */
  sort(): this {
    sortEffects(this._data);
    return this;
  }

  /** Validate and return any issues found. */
  validate(): ExtraValidationIssue[] {
    return validateExtra(this._data);
  }

  /** Serialize to a JSON string. */
  serialize(pretty = true): string {
    return serializeExtra(this._data, pretty);
  }

  /** Support `JSON.stringify(extra)` directly. */
  toJSON(): PhiraExtra {
    return this._data;
  }
}

/**
 * Create a custom shader effect from a file path.
 *
 * Custom shader paths must start with `/`. The shader file should be
 * a GLSL 1.00 fragment shader placed in the chart package.
 *
 * @param extra - PhiraExtra to modify.
 * @param shaderPath - Path to the shader file (e.g., `"/shaders/myeffect.glsl"`).
 * @param startBeat - Start beat.
 * @param endBeat - End beat.
 * @param vars - Uniform variable overrides.
 * @param options - Additional effect options.
 * @returns Index of the new effect.
 *
 * @example
 * ```ts
 * addCustomShader(extra, '/red_overlay', 2, 4, {
 *   factor: animateValue(2, 4, 0, 1),
 * });
 * ```
 */
export function addCustomShader(
  extra: PhiraExtra,
  shaderPath: string,
  startBeat: number,
  endBeat: number,
  vars: Record<string, Variable> = {},
  options: Omit<CreateEffectOptions, "vars"> = {}
): number {
  const normalizedPath = shaderPath.startsWith("/") ? shaderPath : `/${shaderPath}`;
  return addEffect(extra, normalizedPath, startBeat, endBeat, {
    ...options,
    vars,
  });
}

// ─── Video Background ───────────────────────────────────────────────────────

/** Options for creating a video background. */
export interface CreateVideoOptions {
  /**
   * Scaling mode:
   * - `'cropCenter'` (default) — fill screen, cropping edges.
   * - `'inside'` — fit entire video inside screen.
   * - `'fit'` — stretch to fill.
   */
  scale?: "cropCenter" | "inside" | "fit";
  /** Opacity, 0–1. Can be animated. Default: 1. */
  alpha?: number | AnimatedVariable;
  /** Dimming amount, 0–1. Can be animated. Default: 0.3. */
  dim?: number | AnimatedVariable;
  /** Z-order for the video layer. */
  zIndex?: number;
  /** Attach the video to a judge line. */
  attach?: VideoAttach;
}

/**
 * Add a video background to the extra.
 *
 * @param extra - PhiraExtra to modify.
 * @param path - Path to the video file (e.g., `"bga.mp4"`).
 * @param startBeat - Beat at which the video starts playing.
 * @param options - Video options.
 * @returns The index of the newly added video.
 *
 * @example
 * ```ts
 * const extra = createExtra(120);
 * addVideo(extra, 'background.mp4', 0, {
 *   scale: 'cropCenter',
 *   alpha: 0.8,
 *   dim: animateValue(0, 4, 0.5, 0),
 * });
 * ```
 */
export function addVideo(extra: PhiraExtra, path: string, startBeat: number, options: CreateVideoOptions = {}): number {
  if (!extra.videos) extra.videos = [];
  const video: Video = {
    path,
    time: fromBeats(startBeat),
    scale: options.scale ?? "cropCenter",
    alpha: options.alpha ?? 1,
    dim: options.dim ?? 0.3,
  };
  if (options.zIndex !== undefined) video.zIndex = options.zIndex;
  if (options.attach) video.attach = options.attach;
  extra.videos.push(video);
  return extra.videos.length - 1;
}

/**
 * Remove a video by index.
 *
 * @param extra - PhiraExtra to modify.
 * @param index - Video index.
 * @returns The extra (for chaining).
 */
export function removeVideo(extra: PhiraExtra, index: number): PhiraExtra {
  if (extra.videos) extra.videos.splice(index, 1);
  return extra;
}

// ─── Effect Variable Manipulation ───────────────────────────────────────────

/**
 * Set a uniform variable on an existing effect.
 *
 * @param effect - The ShaderEffect to modify.
 * @param name - Uniform variable name.
 * @param value - New value (static or animated).
 * @returns The effect (for chaining).
 */
export function setEffectVar(effect: ShaderEffect, name: string, value: Variable): ShaderEffect {
  if (!effect.vars) effect.vars = {};
  effect.vars[name] = value;
  return effect;
}

/**
 * Remove a uniform variable from an effect.
 *
 * @param effect - The ShaderEffect to modify.
 * @param name - Variable name to remove.
 * @returns The effect (for chaining).
 */
export function removeEffectVar(effect: ShaderEffect, name: string): ShaderEffect {
  if (effect.vars) {
    delete effect.vars[name];
  }
  return effect;
}

/**
 * Get the names of all variables set on an effect.
 *
 * @param effect - The ShaderEffect.
 * @returns Array of variable names.
 */
export function getEffectVarNames(effect: ShaderEffect): string[] {
  return effect.vars ? Object.keys(effect.vars) : [];
}

/**
 * Check whether a variable is animated (has keyframe events) vs. static.
 *
 * @param value - The variable value.
 * @returns True if it's an AnimatedVariable (event array).
 */
export function isAnimated(value: Variable): value is AnimatedVariable {
  return Array.isArray(value) && value.length > 0 && typeof value[0] === "object" && value[0] !== null;
}

// ─── Extra-level Operations ─────────────────────────────────────────────────

/**
 * Offset all effects and videos in the extra by a number of beats.
 *
 * @param extra - PhiraExtra to modify.
 * @param beatOffset - Beats to shift (can be negative).
 * @returns The extra (for chaining).
 */
export function offsetExtra(extra: PhiraExtra, beatOffset: number): PhiraExtra {
  // Offset effects
  for (const effect of extra.effects) {
    effect.start = fromBeats(toBeats(effect.start) + beatOffset);
    effect.startBeat = toBeats(effect.start);
    effect.end = fromBeats(toBeats(effect.end) + beatOffset);
    effect.endBeat = toBeats(effect.end);
    if (effect.vars) {
      offsetAnimatedVars(effect.vars, beatOffset);
    }
  }
  // Offset videos
  if (extra.videos) {
    for (const video of extra.videos) {
      video.time = fromBeats(toBeats(video.time) + beatOffset);
      if (isAnimated(video.alpha as Variable)) {
        offsetAnimatedVar(video.alpha as AnimatedVariable, beatOffset);
      }
      if (isAnimated(video.dim as Variable)) {
        offsetAnimatedVar(video.dim as AnimatedVariable, beatOffset);
      }
    }
  }
  return extra;
}

/**
 * Sort effects by their start beat.
 *
 * @param extra - PhiraExtra to modify.
 * @returns The extra (for chaining).
 */
export function sortEffects(extra: PhiraExtra): PhiraExtra {
  extra.effects.sort((a, b) => {
    const aStart = a.startBeat ?? toBeats(a.start);
    const bStart = b.startBeat ?? toBeats(b.start);
    return aStart - bStart;
  });
  return extra;
}

// ─── Validation ─────────────────────────────────────────────────────────────

/** A validation issue for extra.json. */
export interface ExtraValidationIssue {
  severity: "error" | "warning";
  message: string;
  location?: string;
}

/**
 * Validate a PhiraExtra for common issues.
 *
 * @param extra - The PhiraExtra to validate.
 * @returns Array of validation issues.
 */
export function validateExtra(extra: PhiraExtra): ExtraValidationIssue[] {
  const issues: ExtraValidationIssue[] = [];

  // BPM list
  if (extra.bpm) {
    for (let i = 0; i < extra.bpm.length; i++) {
      if (extra.bpm[i]!.bpm <= 0) {
        issues.push({
          severity: "error",
          message: `BPM must be positive, got ${extra.bpm[i]!.bpm}`,
          location: `bpm[${i}]`,
        });
      }
    }
  }

  // Effects
  for (let i = 0; i < extra.effects.length; i++) {
    const effect = extra.effects[i]!;
    const startBeat = effect.startBeat ?? toBeats(effect.start);
    const endBeat = effect.endBeat ?? toBeats(effect.end);

    if (!effect.shader) {
      issues.push({
        severity: "error",
        message: "Effect missing shader name",
        location: `effects[${i}]`,
      });
    }

    if (endBeat <= startBeat) {
      issues.push({
        severity: "warning",
        message: `Effect has zero or negative duration (start=${startBeat}, end=${endBeat})`,
        location: `effects[${i}]`,
      });
    }

    if (effect.shader && !isCustomShader(effect.shader) && !isBuiltinShader(effect.shader)) {
      issues.push({
        severity: "warning",
        message: `Unknown shader "${effect.shader}". Not a built-in and doesn't start with "/"`,
        location: `effects[${i}]`,
      });
    }

    if (effect.targetRange) {
      if (effect.targetRange.minZIndex > effect.targetRange.maxZIndex) {
        issues.push({
          severity: "error",
          message: "targetRange minZIndex > maxZIndex",
          location: `effects[${i}].targetRange`,
        });
      }
    }
  }

  // Videos
  if (extra.videos) {
    for (let i = 0; i < extra.videos.length; i++) {
      const video = extra.videos[i]!;
      if (!video.path) {
        issues.push({
          severity: "error",
          message: "Video missing path",
          location: `videos[${i}]`,
        });
      }
      const validScales = ["cropCenter", "inside", "fit"];
      if (video.scale && !validScales.includes(video.scale)) {
        issues.push({
          severity: "warning",
          message: `Unknown video scale mode "${video.scale}"`,
          location: `videos[${i}]`,
        });
      }
    }
  }

  return issues;
}

// ─── Shader GLSL Helpers ────────────────────────────────────────────────────

/**
 * Default GLSL version header for custom shaders (GLSL 1.00 for prpr compatibility).
 */
export const GLSL_HEADER = "#version 100\nprecision mediump float;\n";

/**
 * Built-in GLSL uniform declarations available in all prpr shaders.
 */
export const BUILTIN_UNIFORMS = `\
varying lowp vec2 uv;
uniform vec2 screenSize;
uniform sampler2D screenTexture;
uniform float time;
`;

/**
 * Reserved uniform names that should not be used for custom variables.
 */
export const RESERVED_UNIFORMS = [
  "uv",
  "screenSize",
  "screenTexture",
  "time",
  "Model",
  "Projection",
  "UVScale",
] as const;

/**
 * Check whether a variable name is reserved (would conflict with built-in uniforms).
 *
 * @param name - Variable name.
 * @returns True if reserved.
 */
export function isReservedUniform(name: string): boolean {
  return (RESERVED_UNIFORMS as readonly string[]).includes(name);
}

/**
 * Generate a GLSL uniform declaration line with default value comment.
 *
 * Produces a line like:
 * ```glsl
 * uniform float power; // %0.5%
 * ```
 *
 * @param type - GLSL type (`"float"`, `"vec2"`, `"vec3"`, `"vec4"`, `"sampler2D"`).
 * @param name - Uniform variable name.
 * @param defaultValue - Default value (will be placed in `%...%` comment).
 * @returns GLSL declaration string.
 */
export function uniformDeclaration(
  type: "float" | "vec2" | "vec3" | "vec4" | "sampler2D",
  name: string,
  defaultValue: string | number | number[]
): string {
  let defStr: string;
  if (typeof defaultValue === "number") {
    defStr = String(defaultValue);
  } else if (Array.isArray(defaultValue)) {
    defStr = defaultValue.join(", ");
  } else {
    defStr = defaultValue;
  }
  return `uniform ${type} ${name}; // %${defStr}%`;
}

/**
 * Generate a minimal custom shader template.
 *
 * @param uniforms - Array of {type, name, default} for custom uniforms.
 * @param body - Main function body (will be placed inside `void main() { ... }`).
 *              Use `uv` for texture coordinates and `screenTexture` for the screen.
 * @returns Complete GLSL fragment shader string.
 *
 * @example
 * ```ts
 * const shader = generateShaderTemplate(
 *   [{ type: 'float', name: 'factor', defaultValue: 0.5 }],
 *   'gl_FragColor = mix(texture2D(screenTexture, uv), vec4(1.0, 0.0, 0.0, 1.0), factor);'
 * );
 * ```
 */
export function generateShaderTemplate(
  uniforms: {
    type: "float" | "vec2" | "vec3" | "vec4" | "sampler2D";
    name: string;
    defaultValue: string | number | number[];
  }[],
  body: string
): string {
  const lines: string[] = [
    GLSL_HEADER,
    "varying lowp vec2 uv;",
    "uniform sampler2D screenTexture;",
    "uniform vec2 screenSize;",
    "uniform float time;",
    "",
  ];
  for (const u of uniforms) {
    lines.push(uniformDeclaration(u.type, u.name, u.defaultValue));
  }
  lines.push("");
  lines.push("void main() {");
  for (const line of body.split("\n")) {
    lines.push(`  ${line}`);
  }
  lines.push("}");
  return lines.join("\n");
}

/**
 * Parse uniform declarations from a GLSL shader source.
 * Extracts uniforms with default-value comments `// %value%`.
 *
 * @param source - GLSL shader source code.
 * @returns Array of parsed uniform info.
 */
export function parseShaderUniforms(source: string): { type: string; name: string; defaultValue: string }[] {
  const regex = /uniform\s+(\w+)\s+(\w+);\s+\/\/\s+%([^%]+)%/g;
  const results: { type: string; name: string; defaultValue: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    results.push({
      type: match[1]!,
      name: match[2]!,
      defaultValue: match[3]!,
    });
  }
  return results;
}

/**
 * Convert parsed shader uniform defaults to a vars object for ShaderEffect.
 *
 * @param uniforms - Array from `parseShaderUniforms`.
 * @returns A vars record suitable for `ShaderEffect.vars`.
 */
export function uniformsToVars(
  uniforms: { type: string; name: string; defaultValue: string }[]
): Record<string, Variable> {
  const vars: Record<string, Variable> = {};
  for (const u of uniforms) {
    switch (u.type) {
      case "float":
        vars[u.name] = parseFloat(u.defaultValue);
        break;
      case "vec2":
      case "vec3":
      case "vec4":
        vars[u.name] = u.defaultValue.split(",").map((v) => parseFloat(v.trim()));
        break;
      case "sampler2D":
        vars[u.name] = u.defaultValue;
        break;
    }
  }
  return vars;
}

// ─── Default Parameter Values ───────────────────────────────────────────────

/**
 * Default parameter values for each built-in shader, as documented by prpr.
 */
export const BUILTIN_SHADER_DEFAULTS: Record<BuiltinShaderName, Record<string, number | number[]>> = {
  chromatic: { sampleCount: 3, power: 0.01 },
  circleBlur: { size: 10.0 },
  fisheye: { power: -0.1 },
  glitch: { power: 0.3, rate: 0.6, speed: 5.0, blockCount: 30.5, colorRate: 0.01 },
  grayscale: { factor: 1.0 },
  noise: { seed: 81.0, power: 0.03 },
  pixel: { size: 10.0 },
  radialBlur: { centerX: 0.5, centerY: 0.5, power: 0.01, sampleCount: 3 },
  shockwave: {
    progress: 0.2,
    centerX: 0.5,
    centerY: 0.5,
    width: 0.1,
    distortion: 0.8,
    expand: 10.0,
  },
  vignette: { color: [0, 0, 0, 255], extend: 0.25, radius: 15.0 },
};

/**
 * Get the default parameters for a built-in shader.
 *
 * @param shader - Built-in shader name.
 * @returns Record of parameter name → default value, or undefined if not built-in.
 */
export function getShaderDefaults(shader: string): Record<string, number | number[]> | undefined {
  return BUILTIN_SHADER_DEFAULTS[shader as BuiltinShaderName];
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

/** Convert a typed params object into a generic vars record. */
function buildVars<T extends object>(params: T): Record<string, Variable> {
  const vars: Record<string, Variable> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      vars[key] = value as Variable;
    }
  }
  return vars;
}

/** Initialize startBeat/endBeat on all events within a vars record. */
function initializeEffectVars(vars: Record<string, Variable>): void {
  for (const value of Object.values(vars)) {
    if (isAnimated(value)) {
      for (const ev of value) {
        if (ev.startBeat === undefined) ev.startBeat = toBeats(ev.startTime);
        if (ev.endBeat === undefined) ev.endBeat = toBeats(ev.endTime);
      }
    }
  }
}

/** Offset all animated variables in a vars record by a number of beats. */
function offsetAnimatedVars(vars: Record<string, Variable>, beatOffset: number): void {
  for (const [_key, value] of Object.entries(vars)) {
    if (isAnimated(value)) {
      offsetAnimatedVar(value, beatOffset);
    }
  }
}

/** Offset all events in an animated variable by a number of beats. */
function offsetAnimatedVar(events: AnimatedVariable, beatOffset: number): void {
  for (const ev of events) {
    ev.startTime = fromBeats(toBeats(ev.startTime) + beatOffset);
    ev.startBeat = toBeats(ev.startTime);
    ev.endTime = fromBeats(toBeats(ev.endTime) + beatOffset);
    ev.endBeat = toBeats(ev.endTime);
  }
}
