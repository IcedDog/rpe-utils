/**
 * Core type definitions for RPE chart structures.
 *
 * All chart data is stored and serialized as `RpeJson`. The primary
 * sub-structures are:
 *
 * - {@link RpeJson} — the root chart object
 * - {@link JudgeLine} — an animated line that spawns notes
 * - {@link Note} — a tap, hold, flick, or drag note
 * - {@link Event} / {@link SpeedEvent} — keyframe animation entries
 * - {@link EventLayer} — one layer of animation channels per line
 * - {@link Bpm} — a BPM change entry
 * - {@link RpeMeta} — song/chart metadata
 *
 * Beat format
 * -----------
 * All time positions use the `Beat` tuple `[measure, numerator, denominator]`,
 * which represents the rational number `measure + numerator/denominator`.
 * For example, beat 2.5 is `[2, 1, 2]`.
 *
 * @module types
 */

/**
 * A beat position encoded as a rational number `[measure, numerator, denominator]`.
 *
 * The actual beat value is `measure + numerator / denominator`.
 *
 * @example
 * ```ts
 * // Beat 0
 * const zero: Beat = [0, 0, 1];
 * // Beat 2.5 (2 + 1/2)
 * const twoAndHalf: Beat = [2, 1, 2];
 * // Beat 4.75 (4 + 3/4)
 * const fourAndThreeQuarters: Beat = [4, 3, 4];
 * ```
 */
export type Beat = [number, number, number];

/**
 * The root structure of an RPE chart file (`chart.json`).
 *
 * @example
 * ```ts
 * const chart: RpeJson = JSON.parse(fs.readFileSync('chart.json', 'utf8'));
 * ```
 */
export interface RpeJson {
  /** BPM change list, sorted by beat. Must have at least one entry at beat 0. */
  BPMList: Bpm[];
  /** Song and chart metadata (name, level, audio file, etc.). */
  META: RpeMeta;
  /** Total chart duration in seconds (informational, not used by the engine). */
  chartTime: number;
  /** Named groups for lines (e.g. `['default']`). Lines reference these by index. */
  judgeLineGroup: string[];
  /** All judge lines in this chart. Order matters for rendering (lower index = drawn first). */
  judgeLineList: JudgeLine[];
  /** Unused / internal string field. Typically empty. */
  multiLineString: string;
  /** Unused / internal scale field. Typically 1. */
  multiScale: number;
}

/**
 * A judge line — the primary animated object in an RPE chart.
 *
 * Each line:
 * - Has a stack of {@link EventLayer}s that compose position/rotation/alpha.
 * - Optionally has a `father` line that it inherits transforms from.
 * - Spawns {@link Note}s that travel toward it.
 * - Supports extended events (incline, scaleX, scaleY, color, text, GIF).
 * - Can be textured with an image or animated GIF.
 */
export interface JudgeLine {
  /**
   * Attaches a built-in HUD element to this line's position.
   * When set, the HUD element follows the line's transform.
   */
  attachUI?: "pause" | "combonumber" | "combo" | "score" | "bar" | "name" | "level" | null;
  /** Group index (indexes into `RpeJson.judgeLineGroup`). */
  Group: number;
  /** Display name of the line (used in editors). */
  Name: string;
  /** Texture asset key (e.g. `'line.png'`, `'particle.png'`). */
  Texture: string;
  /** Per-time-position alpha control nodes (for global fade control). */
  alphaControl: AlphaControl[];
  /** Normalized anchor point `[x, y]` for rotation and scaling (default: `[0.5, 0.5]`). */
  anchor?: number[];
  /** BPM multiplier applied to this line's event timing (default: 1). */
  bpmfactor: number;
  /** Ordered stack of event layers. Each layer adds additively to the final transform. */
  eventLayers: (EventLayer | null)[];
  /** Extended events (incline, scaleX/Y, color, text, GIF frame). */
  extended?: Extended;
  /**
   * Parent line index for hierarchical transform inheritance.
   * `-1` means no parent (root line).
   */
  father: number;
  /** If `true`, this line also inherits the parent's rotation. */
  rotateWithFather?: boolean;
  /** Whether speed event easings are integrated when computing note positions. */
  integrateSpeedEasings?: boolean;
  /**
   * Cover mode: `1` = line texture acts as an opaque cover over notes behind it;
   * `0` = transparent.
   */
  isCover: number;
  /** If `true`, the texture is treated as an animated GIF (uses `gifEvents` for frames). */
  isGif?: boolean;
  /** All notes on this line. */
  notes?: Note[];
  /** Cached total note count (kept in sync by `addNote`/`removeNote`). */
  numOfNotes: number;
  /** Per-time-position position-scale control nodes. */
  posControl: PosControl[];
  /** Scaling mode applied to notes: `0` = off, `1` = x-only, `2` = x+y. */
  scaleOnNotes?: 0 | 1 | 2;
  /**
   * Controls what the line renders when it has an `attachUI`:
   * `0` = always show, `1` = show only when visible, `2` = hide.
   */
  appearanceOnAttach?: 0 | 1 | 2;
  /** Per-time-position size control nodes. */
  sizeControl: SizeControl[];
  /** Per-time-position skew control nodes. */
  skewControl: SkewControl[];
  /** Per-time-position Y scale control nodes. */
  yControl: YControl[];
  /** Z-index override (alias for `zOrder`; prefer `zOrder`). */
  zIndex?: number;
  /** Rendering z-order (higher = drawn on top). */
  zOrder: number;
}

/** Y-position scale control node for a judge line. */
export interface YControl {
  /** RPE easing type (1–28) used to interpolate to the next node. */
  easing: number;
  /** Normalized time (0–1 across the chart duration) where this node applies. */
  x: number;
  /** Y scale factor at this time position (1 = normal). */
  y: number;
}

/** Horizontal-skew control node for a judge line. */
export interface SkewControl {
  /** RPE easing type (1–28). */
  easing: number;
  /** Skew angle applied at this normalized time. */
  skew: number;
  /** Normalized time (0–1). */
  x: number;
}

/** Global size (scale) control node for a judge line. */
export interface SizeControl {
  /** RPE easing type (1–28). */
  easing: number;
  /** Size multiplier at this normalized time (1 = normal). */
  size: number;
  /** Normalized time (0–1). */
  x: number;
}

/** Position scaling control node for a judge line. */
export interface PosControl {
  /** RPE easing type (1–28). */
  easing: number;
  /** Position scale factor at this normalized time (1 = normal). */
  pos: number;
  /** Normalized time (0–1). */
  x: number;
}

/**
 * A single note in the chart.
 *
 * Note types:
 * - `1` = Tap
 * - `2` = Hold
 * - `3` = Flick
 * - `4` = Drag
 */
export interface Note {
  /**
   * Side relative to the line:
   * - `1` = above the line
   * - `2` = below the line
   */
  above: number;
  /** Opacity of the note sprite (0–255, default: 255). */
  alpha: number;
  /** End beat as a `Beat` tuple. For non-hold notes, equals `startTime`. */
  endTime: [number, number, number];
  /** End beat as a plain number (pre-computed from `endTime`). */
  endBeat: number;
  /** Whether this note is fake (non-scoring): `0` = real, `1` = fake. */
  isFake: number;
  /** Horizontal position on the line in chart units (0 = center, ±675 = edges). */
  positionX: number;
  /** Visual size multiplier (1 = normal). */
  size: number;
  /** Note scroll speed multiplier (1 = line default). */
  speed: number;
  /** Start beat as a `Beat` tuple. */
  startTime: [number, number, number];
  /** Start beat as a plain number (pre-computed from `startTime`). */
  startBeat: number;
  /** Note type: `1` Tap, `2` Hold, `3` Flick, `4` Drag. */
  type: number;
  /** Seconds before the note's beat that it first becomes visible (default: 999999 = always). */
  visibleTime: number;
  /** Vertical offset added to the note's spawn position. */
  yOffset: number;
  /** Custom hitsound asset key (omitted = default hitsound). */
  hitsound?: string;
  /** Z-index override for rendering order. */
  zIndex?: number;
  /** Z-index for the hit effect sprites. */
  zIndexHitEffects?: number;
  /** Note tint color `[r, g, b]` (0–255 per channel). `null` = default. */
  tint?: [number, number, number] | null;
  /** Hit effect tint color `[r, g, b]`. `null` = default. */
  tintHitEffects?: [number, number, number] | null;
  /** Judgment hit-box size multiplier (1 = normal). */
  judgeArea: number;
}

/** Container for a line's extended event arrays (incline, scale, color, text, GIF). */
export interface Extended {
  /** Frame-index animation events (only used when `isGif: true`). */
  gifEvents?: GifEvent[];
  /** Perspective-incline events (degrees). */
  inclineEvents?: Event[];
  /** Horizontal scale events. */
  scaleXEvents?: Event[];
  /** Vertical scale events. */
  scaleYEvents?: Event[];
  /** Line tint color events (RGB, each channel 0–255). */
  colorEvents?: ColorEvent[];
  /** On-screen text display events. */
  textEvents?: TextEvent[];
}

/** An event that animates a string value (used for on-screen text). */
export interface TextEvent {
  /** Whether to use cubic bezier easing: `0` = off, `1` = on. */
  bezier: number;
  /** Cubic bezier control points `[p1x, p1y, p2x, p2y]` (only used when `bezier=1`). */
  bezierPoints: number[];
  /** Sub-range start for partial easing (0–1, default: 0). */
  easingLeft: number;
  /** Sub-range end for partial easing (0–1, default: 1). */
  easingRight: number;
  /** RPE easing type (1–28). */
  easingType: number;
  /** Text value at `endTime`. */
  end: string;
  /** Event end beat as a `Beat` tuple. */
  endTime: [number, number, number];
  /** End beat as a plain number. */
  endBeat: number;
  /** Link group ID for chained events (0 = none). */
  linkgroup: number;
  /** Text value at `startTime`. */
  start: string;
  /** Event start beat as a `Beat` tuple. */
  startTime: [number, number, number];
  /** Start beat as a plain number. */
  startBeat: number;
}

/** An event that animates an RGB color (used for line tinting). */
export interface ColorEvent {
  /** Whether to use cubic bezier easing: `0` = off, `1` = on. */
  bezier: number;
  /** Cubic bezier control points `[p1x, p1y, p2x, p2y]`. */
  bezierPoints: number[];
  /** Sub-range start for partial easing (0–1). */
  easingLeft: number;
  /** Sub-range end for partial easing (0–1). */
  easingRight: number;
  /** RPE easing type (1–28). */
  easingType: number;
  /** Color at `endTime` as `[r, g, b]` (0–255 each). */
  end: [number, number, number];
  /** Event end beat as a `Beat` tuple. */
  endTime: [number, number, number];
  /** End beat as a plain number. */
  endBeat: number;
  /** Link group ID (0 = none). */
  linkgroup: number;
  /** Color at `startTime` as `[r, g, b]`. */
  start: [number, number, number];
  /** Event start beat as a `Beat` tuple. */
  startTime: [number, number, number];
  /** Start beat as a plain number. */
  startBeat: number;
}

/** An event that animates a GIF frame index. */
export interface GifEvent {
  /** RPE easing type (1–28). */
  easingType: number;
  /** Frame index at `endTime`. */
  end: number;
  /** Event end beat as a `Beat` tuple. */
  endTime: [number, number, number];
  /** End beat as a plain number. */
  endBeat: number;
  /** Link group ID (0 = none). */
  linkgroup: number;
  /** Frame index at `startTime`. */
  start: number;
  /** Event start beat as a `Beat` tuple. */
  startTime: [number, number, number];
  /** Start beat as a plain number. */
  startBeat: number;
}

/**
 * One layer of animation channels for a judge line.
 *
 * Multiple layers are composed additively. Layer 0 is the base; later layers
 * add to the computed values.
 */
export interface EventLayer {
  /** Alpha events (0–255). */
  alphaEvents?: Event[] | null;
  /** Horizontal position events (chart units, center = 0). */
  moveXEvents?: Event[] | null;
  /** Vertical position events (chart units, center = 0). */
  moveYEvents?: Event[] | null;
  /** Rotation events (degrees, clockwise positive). */
  rotateEvents?: Event[] | null;
  /** Note scroll speed events. */
  speedEvents?: SpeedEvent[] | null;
}

/**
 * A speed event (note scroll speed over a beat range).
 *
 * Speed events do not support bezier easing and stepped interpolation is used
 * by most engine versions.
 */
export interface SpeedEvent {
  /** Sub-range start for partial easing (0–1). */
  easingLeft: number;
  /** Sub-range end for partial easing (0–1). */
  easingRight: number;
  /** RPE easing type (1–28). */
  easingType: number;
  /** Speed at `endTime`. */
  end: number;
  /** Event end beat as a `Beat` tuple. */
  endTime: [number, number, number];
  /** End beat as a plain number. */
  endBeat: number;
  /** Link group ID (0 = none). */
  linkgroup: number;
  /** Speed at `startTime`. */
  start: number;
  /** Event start beat as a `Beat` tuple. */
  startTime: [number, number, number];
  /** Start beat as a plain number. */
  startBeat: number;
}

/**
 * A standard animation event for moveX, moveY, rotate, alpha, and extended channels.
 */
export interface Event {
  /** Whether to use cubic bezier easing: `0` = off, `1` = on. */
  bezier: number;
  /** Cubic bezier control points `[p1x, p1y, p2x, p2y]` (only when `bezier=1`). */
  bezierPoints: number[];
  /** Sub-range start within the easing curve (0–1). Shrinks the visible easing window. */
  easingLeft: number;
  /** Sub-range end within the easing curve (0–1). */
  easingRight: number;
  /** RPE easing type (1–28, see `easing.ts` for mapping). */
  easingType: number;
  /** Animated value at `endTime`. */
  end: number;
  /** Event end beat as a `Beat` tuple. */
  endTime: [number, number, number];
  /** End beat as a plain number (pre-computed). */
  endBeat: number;
  /** Link group ID: events sharing a non-zero ID are linked/chained. `0` = no group. */
  linkgroup: number;
  /** Animated value at `startTime`. */
  start: number;
  /** Event start beat as a `Beat` tuple. */
  startTime: [number, number, number];
  /** Start beat as a plain number (pre-computed). */
  startBeat: number;
}

/** Alpha (opacity) control node applied globally across the chart's time axis. */
export interface AlphaControl {
  /** Alpha multiplier (0–1, where 1 = fully opaque). */
  alpha: number;
  /** RPE easing type (1–28) to interpolate to the next node. */
  easing: number;
  /** Normalized time (0–1 across the chart duration) where this node applies. */
  x: number;
}

/**
 * Chart metadata block (the `META` field in `chart.json`).
 */
export interface RpeMeta {
  /** RPE editor version that created this chart (e.g., `110`). */
  RPEVersion: number;
  /** Background image asset key (filename). */
  background: string;
  /** Charter / mapper name(s). */
  charter: string;
  /** Song composer / artist name. */
  composer: string;
  /** Song duration in seconds (informational). */
  duration?: number;
  /** Unique chart identifier string. */
  id: string;
  /** Illustration / jacket image asset key. */
  illustration?: string;
  /** Difficulty label (e.g., `'SP Lv.15'`, `'IN 16'`). */
  level: string;
  /** Song / chart display name. */
  name: string;
  /** Global audio offset in milliseconds (positive = audio plays earlier). */
  offset: number;
  /** Audio filename (e.g., `'song.ogg'`). */
  song: string;
}

/**
 * A BPM entry in the chart's `BPMList`.
 *
 * Entries are sorted by `startBeat`. The first entry must be at beat 0.
 * `startTimeSec` is computed by `initBpmList` and not stored in `chart.json`.
 */
export interface Bpm {
  /** Beats per minute at this entry. */
  bpm: number;
  /** Start beat as a `Beat` tuple `[measure, num, den]`. */
  startTime: [number, number, number];
  /** Start beat as a plain number (pre-computed). */
  startBeat: number;
  /** Start time in seconds (computed by `initBpmList`, not serialized). */
  startTimeSec: number;
}

// ─── Extra / Shader / Video Types ───────────────────────────────────────────

/**
 * Root structure of extra.json — prpr / Phira extension features.
 * Contains shader effects and video backgrounds.
 */
export interface PhiraExtra {
  bpm?: {
    time: [number, number, number];
    bpm: number;
  }[];
  videos?: Video[];
  effects: ShaderEffect[];
}

/**
 * A video background entry in extra.json.
 *
 * - `path` — file path to the video asset (required).
 * - `time` — start beat in RPE beat format.
 * - `scale` — scaling mode: `cropCenter` (fill), `inside` (fit), `fit` (stretch).
 * - `alpha` — opacity (animated variable or constant, 0–1).
 * - `dim` — dimming amount (animated variable or constant, 0–1).
 */
export interface Video {
  path: string;
  time: [number, number, number];
  startTimeSec?: number;
  endTimeSec?: number;
  scale: "cropCenter" | "inside" | "fit";
  alpha: AnimatedVariable | number;
  dim: AnimatedVariable | number;
  zIndex?: number;
  attach?: VideoAttach;
}

/** Video attachment to a judge line (follows line position/rotation). */
export interface VideoAttach {
  line: number;
  positionXFactor?: number;
  positionYFactor?: number;
  rotationFactor?: number;
  alphaFactor?: number;
  tintFactor?: number;
  scaleXMode?: 0 | 1 | 2;
  scaleYMode?: 0 | 1 | 2;
}

/**
 * A shader effect entry in extra.json.
 *
 * - `start` / `end` — beat range in RPE format.
 * - `shader` — name of the shader (built-in like `"chromatic"`, or custom path like `"/myshader"`).
 * - `global` — if true, also affects UI elements.
 * - `targetRange` — optional z-index range specifying which objects the shader applies to.
 * - `vars` — uniform variable overrides (static values or animated).
 */
export interface ShaderEffect {
  start: [number, number, number];
  startBeat?: number;
  end: [number, number, number];
  endBeat?: number;
  shader: string;
  global?: boolean;
  targetRange?: {
    minZIndex: number;
    maxZIndex: number;
    exclusive?: boolean;
  };
  vars?: Record<string, Variable>;
}

/**
 * A shader uniform variable: can be a static number, a static vector,
 * a texture reference (string path), or an animated variable (event array).
 */
export type Variable = AnimatedVariable | number | number[] | string;

/**
 * An animated variable is an array of VariableEvents that describe
 * how the value changes over time (same format as RPE events).
 */
export type AnimatedVariable = VariableEvent[];

/**
 * A single keyframe event for an animated shader variable.
 * `start`/`end` can be scalar (number) or vector (number[]).
 */
export type VariableEvent = ScalarVariableEvent | VectorVariableEvent;

export interface BaseVariableEvent {
  startTime: [number, number, number];
  startBeat?: number;
  endTime: [number, number, number];
  endBeat?: number;
  easingType: number;
  easingLeft?: number;
  easingRight?: number;
}

export interface ScalarVariableEvent extends BaseVariableEvent {
  start: number;
  end: number;
}

export interface VectorVariableEvent extends BaseVariableEvent {
  start: number[];
  end: number[];
}
