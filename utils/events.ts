/**
 * Event creation, evaluation, and batch manipulation utilities.
 *
 * Covers RPE events (moveX, moveY, rotate, alpha, speed), color events,
 * text events, gif events, and extended properties.
 *
 * ## Key concepts
 *
 * - **Beat tuple** `[measure, numerator, denominator]` — see {@link toBeats} / {@link fromBeats}.
 * - **Event evaluation** — use {@link getEventValue} to sample an event at a beat,
 *   or {@link evaluateAllEventLayers} for a full line state.
 * - **Speed height** — use {@link computeHeight} to get the accumulated scroll position
 *   from speed events (replicates `Line.handleSpeed`).
 * - **Batch ops** — {@link offsetEvents}, {@link scaleEventTimes}, {@link scaleEventValues},
 *   {@link keyframesToEvents}, {@link copyEvents}.
 *
 * ## Examples
 *
 * ```ts
 * import { toBeats, fromBeats, getTimeSec, createEvent, keyframesToEvents } from './events';
 *
 * // Convert a beat tuple to a fractional beat
 * toBeats([2, 1, 4]); // 2.25
 *
 * // Convert back
 * fromBeats(2.25); // [2, 1, 4]
 *
 * // Create an event that moves a line from X=-675 to X=675 over beats 0Ⅎ4
 * const ev = createEvent(0, 4, -675, 675, 'cubicOut');
 *
 * // Build keyframe animation: X moves 0→100→0 over beats 0Ⅎ2→4
 * const evs = keyframesToEvents([[0, 0], [2, 100], [4, 0]], 'sineInOut');
 * ```
 *
 * @module events
 */

import type {
  Bpm,
  Event,
  SpeedEvent,
  ColorEvent,
  TextEvent,
  GifEvent,
  EventLayer,
  Extended,
  AlphaControl,
  PosControl,
  SizeControl,
  SkewControl,
  YControl,
  VariableEvent,
  EventOptions,
  SpeedEventOptions,
} from "./types";
import { clamp, lerp } from "./math";
import {
  easing,
  easingDerivative,
  calculateEasingIntegral,
  calculateEasingValue,
  EASINGS,
  sanitizeEasingParams,
  resolveEasingType,
  type EasingName,
} from "./easing";

// ─── Beat / Time Conversion ──────────────────────────────────────────────────

/**
 * Convert a `[measure, numerator, denominator]` beat tuple to a fractional beat number.
 *
 * The tuple format is `[whole_measure, fractional_numerator, fractional_denominator]`,
 * where the beat value equals `measure + numerator / denominator`.
 *
 * @param time - Beat tuple `[m, n, d]`, an array, or a plain number (returned as-is).
 * @returns Fractional beat number.
 *
 * @example
 * ```ts
 * toBeats([2, 1, 4]);  // 2.25  (beat 2 and 1/4)
 * toBeats([0, 0, 1]);  // 0
 * toBeats(4.5);        // 4.5   (pass-through)
 * toBeats([3, 0, 1]);  // 3
 * ```
 */
export function toBeats(time: [number, number, number] | number[] | number): number {
  if (typeof time === "number") return time;
  if (!time || !Array.isArray(time)) return 0;
  const t0 = time[0] ?? 0;
  const t1 = time[1] ?? 0;
  const t2 = time[2] ?? 1;
  if (t1 === 0 || t2 === 0) return t0;
  return t0 + t1 / t2;
}

/**
 * Convert a fractional beat number back to a `[measure, numerator, denominator]` tuple.
 *
 * Finds the best rational approximation with denominator ≤ `maxDenominator`
 * using the Stern-Brocot tree approach.
 *
 * @param beat - Fractional beat number.
 * @param maxDenominator - Maximum denominator for simplification (default 192,
 *   which covers all common time signatures up to 192nd notes).
 * @returns Beat tuple `[measure, numerator, denominator]`.
 *
 * @example
 * ```ts
 * fromBeats(2.25);   // [2, 1, 4]
 * fromBeats(0);      // [0, 0, 1]
 * fromBeats(1.333);  // [1, 1, 3]  (1 + 1/3)
 * fromBeats(4.5);    // [4, 1, 2]
 * ```
 */
export function fromBeats(beat: number, maxDenominator = 192): [number, number, number] {
  if (beat === null || beat === undefined || isNaN(beat) || !isFinite(beat)) {
    return [0, 0, 1];
  }
  const measure = Math.floor(beat);
  const frac = beat - measure;
  if (Math.abs(frac) < 1e-9) return [measure, 0, 1];
  // Find best rational approximation
  const { num, den } = bestRational(frac, maxDenominator);
  return [measure, num, den];
}

/**
 * Convert a beat number to time in seconds using the BPM list.
 *
 * Finds the latest BPM change that starts at or before `beat`, then
 * interpolates linearly from that change's reference time.
 *
 * @param bpmList - Sorted array of BPM entries (must have been initialized with {@link initBpmList}).
 * @param beat - Beat number.
 * @returns Time in seconds.
 *
 * @example
 * ```ts
 * // At 120 BPM, beat 4 takes exactly 2 seconds
 * const bpmList = [{ bpm: 120, startBeat: 0, startTimeSec: 0, startTime: [0,0,1] }];
 * getTimeSec(bpmList, 4); // 2.0
 * ```
 */
export function getTimeSec(bpmList: Bpm[], beat: number): number {
  let bpm = bpmList[0]!;
  for (let i = bpmList.length - 1; i >= 0; i--) {
    if (bpmList[i]!.startBeat <= beat) {
      bpm = bpmList[i]!;
      break;
    }
  }
  return bpm.startTimeSec + ((beat - bpm.startBeat) / bpm.bpm) * 60;
}

/**
 * Convert seconds to a beat number using the BPM list.
 * @param bpmList - Sorted array of BPM entries.
 * @param timeSec - Time in seconds.
 * @returns Beat number.
 */
export function getBeat(bpmList: Bpm[], timeSec: number): number {
  let bpm = bpmList[0]!;
  for (let i = bpmList.length - 1; i >= 0; i--) {
    if (bpmList[i]!.startTimeSec <= timeSec) {
      bpm = bpmList[i]!;
      break;
    }
  }
  return bpm.startBeat + ((timeSec - bpm.startTimeSec) / 60) * bpm.bpm;
}

/**
 * Initialize the BPM list by computing `startTimeSec` for each entry.
 *
 * **Must be called** before using {@link getTimeSec} or {@link getBeat}.
 * Also called automatically by {@link preprocess} and {@link parseChart}.
 *
 * @param bpmList - The chart's BPM list (mutated in place).
 *
 * @example
 * ```ts
 * initBpmList(chart.BPMList);
 * const t = getTimeSec(chart.BPMList, 8); // seconds at beat 8
 * ```
 */
export function initBpmList(bpmList: Bpm[]): void {
  let lastBpm = 0;
  let lastBeat = 0;
  let lastTimeSec = 0;
  bpmList.forEach((bpm, i) => {
    bpm.startBeat = toBeats(bpm.startTime);
    // Normalize plain-number startTime to a Beat tuple
    if (!Array.isArray(bpm.startTime)) {
      bpm.startTime = fromBeats(bpm.startBeat);
    }
    bpm.startTimeSec = i === 0 ? lastTimeSec : lastTimeSec + ((bpm.startBeat - lastBeat) / lastBpm) * 60;
    lastBpm = bpm.bpm;
    lastBeat = bpm.startBeat;
    lastTimeSec = bpm.startTimeSec;
  });
}

// ─── Event Value Evaluation ──────────────────────────────────────────────────

/**
 * Interpolate between two values (number, `number[]`, or string) by progress.
 *
 * Handles all RPE value types:
 * - **Numbers**: standard linear interpolation.
 * - **number arrays** (e.g. RGB color): per-component interpolation.
 * - **Strings with `%P%` markers**: interpolates the embedded number.
 * - **Text reveal strings**: reveals/hides characters progressively when one
 *   string is a prefix of the other.
 * - **Other strings**: returns `start` until `progress >= 1`, then `end`.
 *
 * @param start - Start value.
 * @param end - End value.
 * @param progress - Progress ∈ [0, 1].
 * @returns Interpolated value; type matches the input types.
 *
 * @example
 * ```ts
 * calculateValue(0, 255, 0.5);              // 127.5
 * calculateValue([255, 0, 0], [0, 0, 255], 0.5); // [127.5, 0, 127.5]
 * calculateValue('%P%0', '%P%100', 0.3);    // '30'
 * calculateValue('Hello', 'Hello World', 0.5); // 'Hello Wor'
 * ```
 */
export function calculateValue(
  start: number | number[] | string,
  end: number | number[] | string,
  progress: number
): number | number[] | string | undefined {
  if (Array.isArray(start) && Array.isArray(end)) {
    return start.map((v, i) => v + ((end[i] ?? v) - v) * progress);
  }
  if (typeof start === "number" && typeof end === "number") {
    return start + (end - start) * progress;
  }
  if (typeof start === "string" && typeof end === "string") {
    // Numeric interpolation inside strings with %P% markers
    if (start.includes("%P%") && end.includes("%P%")) {
      const sn = parseFloat(start.replace("%P%", ""));
      const en = parseFloat(end.replace("%P%", ""));
      if (!isNaN(sn) && !isNaN(en)) {
        if (Number.isInteger(sn) && Number.isInteger(en)) {
          return Math.floor(sn + (en - sn) * progress).toString();
        }
        return (sn + (en - sn) * progress).toFixed(3);
      }
    }
    // Prefix-based text reveal
    if (start.startsWith(end)) {
      return end + start.substring(end.length, Math.floor((start.length - end.length) * (1 - progress)) + end.length);
    }
    if (end.startsWith(start)) {
      return start + end.substring(start.length, Math.floor((end.length - start.length) * progress) + start.length);
    }
    return progress >= 1 ? end : start;
  }
  return undefined;
}

/**
 * Get the value of an event at a specific beat.
 * @param event - The event to evaluate.
 * @param beat - Current beat.
 * @param bpmList - BPM list for time conversion.
 * @returns The interpolated value (number, number[], or string).
 */
export function getEventValue(
  event: Event | SpeedEvent | ColorEvent | TextEvent | GifEvent,
  beat: number,
  bpmList: Bpm[]
): number | number[] | string | undefined {
  const startSec = getTimeSec(bpmList, event.startBeat);
  const progressedSec = getTimeSec(bpmList, beat) - startSec;
  const lengthSec = getTimeSec(bpmList, event.endBeat) - startSec;
  const x = lengthSec > 0 ? progressedSec / lengthSec : 0;
  return getEventValueAtProgress(event, x);
}

/**
 * Get the value of an event at a raw progress ∈ [0, 1].
 * @param event - The event.
 * @param x - Raw progress (unclamped is OK, easing handles it).
 */
export function getEventValueAtProgress(
  event: Event | SpeedEvent | ColorEvent | TextEvent | GifEvent,
  x: number
): number | number[] | string | undefined {
  const easingType = "easingType" in event ? event.easingType : 0;
  const bezierPoints = "bezier" in event && (event as Event).bezier === 1 ? (event as Event).bezierPoints : undefined;
  const easingLeft = "easingLeft" in event ? (event as Event).easingLeft : 0;
  const easingRight = "easingRight" in event ? (event as Event).easingRight : 1;

  const progress = easing(easingType, x, easingLeft, easingRight, bezierPoints);
  if (progress === 0) return event.start;
  if (progress === 1) return event.end;
  return calculateValue(event.start as number | number[] | string, event.end as number | number[] | string, progress);
}

// ─── Speed Event Height Integral ─────────────────────────────────────────────

/**
 * Compute the height integral of a speed event from its startBeat up to a given beat.
 * Used for computing note scroll positions.
 * @param event - Speed event.
 * @param bpmList - BPM list.
 * @param integrateEasings - Whether to use full easing integrals (RPE ≥ 170).
 * @param beat - Beat to integrate up to (defaults to event.endBeat).
 * @returns Height accumulated over the event.
 */
export function getSpeedIntegral(event: SpeedEvent, bpmList: Bpm[], integrateEasings: boolean, beat?: number): number {
  if (beat === undefined || beat >= event.endBeat) beat = event.endBeat;
  const startSec = getTimeSec(bpmList, event.startBeat);
  const progressedSec = getTimeSec(bpmList, beat) - startSec;
  const lengthSec = getTimeSec(bpmList, event.endBeat) - startSec;
  const x = lengthSec > 0 ? progressedSec / lengthSec : 0;

  if (!("easingType" in event) || event.easingType <= 1) {
    const currentVal = getEventValueAtProgress(event, x) as number;
    return ((event.start + currentVal) * progressedSec) / 2;
  }

  const easingLeft = event.easingLeft ?? 0;
  const easingRight = event.easingRight ?? 1;

  if (!integrateEasings) {
    const df0 = easingDerivative(event.easingType, 0, easingLeft, easingRight);
    const df1 = easingDerivative(event.easingType, 1, easingLeft, easingRight);
    const k = (event.end - event.start) / (df1 - df0);
    const b = event.start - k * df0;
    const p = sanitizeEasingParams(event.easingType, x, easingLeft, easingRight);
    const integralVal = k * calculateEasingValue(EASINGS[p.type - 1]!, p.x, p.easingLeft, p.easingRight) + b * p.x;
    return (integralVal * lengthSec) / (event.endBeat - event.startBeat);
  } else {
    const integral = calculateEasingIntegral(event.easingType, x, easingLeft, easingRight);
    return event.start * progressedSec + (event.end - event.start) * integral * lengthSec;
  }
}

/**
 * Compute the total accumulated height of all speed events in all event layers
 * up to a given beat, replicating the Line.handleSpeed logic.
 * @param eventLayers - The line's event layers.
 * @param beat - The beat to compute height at.
 * @param bpmList - BPM list.
 * @param integrateEasings - Whether to use full easing integrals.
 * @returns Total height.
 */
export function computeHeight(
  eventLayers: (EventLayer | null)[],
  beat: number,
  bpmList: Bpm[],
  integrateEasings: boolean,
  factor: number = 1
): number {
  let totalHeight = 0;
  for (const layer of eventLayers) {
    if (!layer?.speedEvents || layer.speedEvents.length === 0) continue;
    const events = layer.speedEvents;

    // Find the current event index
    let cur = 0;
    let lastHeight = 0;

    while (cur < events.length - 1 && beat > events[cur + 1]!.startBeat) {
      lastHeight +=
        getSpeedIntegral(events[cur]!, bpmList, integrateEasings) +
        events[cur]!.end *
          (getTimeSec(bpmList, events[cur + 1]!.startBeat) - getTimeSec(bpmList, events[cur]!.endBeat));
      cur++;
    }
    let height = lastHeight;
    if (beat <= events[cur]!.endBeat) {
      height += getSpeedIntegral(events[cur]!, bpmList, integrateEasings, beat);
    } else {
      height +=
        getSpeedIntegral(events[cur]!, bpmList, integrateEasings) +
        events[cur]!.end * (getTimeSec(bpmList, beat) - getTimeSec(bpmList, events[cur]!.endBeat));
    }

    totalHeight += height;
  }
  return totalHeight;
}

// ─── Event Layer Evaluation ──────────────────────────────────────────────────

/**
 * Evaluate all event channels in a single event layer at a given beat.
 * @param layer - The event layer (or null).
 * @param beat - Current beat.
 * @param bpmList - BPM list.
 * @returns Object with alpha, x, y, rotation values (undefined if no events).
 */
export function evaluateEventLayer(
  layer: EventLayer | null,
  beat: number,
  bpmList: Bpm[]
): {
  alpha: number | undefined;
  x: number | undefined;
  y: number | undefined;
  rotation: number | undefined;
} {
  if (!layer) return { alpha: undefined, x: undefined, y: undefined, rotation: undefined };
  return {
    alpha: evaluateEventChannel(layer.alphaEvents, beat, bpmList) as number | undefined,
    x: evaluateEventChannel(layer.moveXEvents, beat, bpmList) as number | undefined,
    y: evaluateEventChannel(layer.moveYEvents, beat, bpmList) as number | undefined,
    rotation: evaluateEventChannel(layer.rotateEvents, beat, bpmList) as number | undefined,
  };
}

/**
 * Evaluate a single event channel (e.g. alphaEvents) at a given beat.
 * Finds the active event and returns its value.
 * @param events - Array of events (or null/undefined).
 * @param beat - Current beat.
 * @param bpmList - BPM list.
 * @param fillInBetween - If false, returns undefined when beat is between events.
 * @returns The event value, or undefined if no events.
 */
export function evaluateEventChannel(
  events: (Event | ColorEvent | GifEvent | TextEvent)[] | null | undefined,
  beat: number,
  bpmList: Bpm[],
  fillInBetween = true
): number | number[] | string | undefined {
  if (!events || events.length === 0) return undefined;

  // Find the current event
  let cur = 0;
  while (cur < events.length - 1 && beat > events[cur + 1]!.startBeat) {
    cur++;
  }

  if (!fillInBetween && (beat <= events[cur]!.startBeat || beat > events[cur]!.endBeat)) {
    return undefined;
  }

  return getEventValue(events[cur]!, beat, bpmList);
}

/**
 * Evaluate all event layers for a line, summing the results (as the game does).
 * @param eventLayers - Array of event layers.
 * @param beat - Current beat (already divided by bpmfactor if needed).
 * @param bpmList - BPM list.
 * @returns Combined alpha, x, y, rotation values.
 */
export function evaluateAllEventLayers(
  eventLayers: (EventLayer | null)[],
  beat: number,
  bpmList: Bpm[]
): { alpha: number; x: number; y: number; rotation: number } {
  let alpha = 0,
    x = 0,
    y = 0,
    rotation = 0;
  for (const layer of eventLayers) {
    const result = evaluateEventLayer(layer, beat, bpmList);
    alpha += result.alpha ?? 0;
    x += result.x ?? 0;
    y += result.y ?? 0;
    rotation += result.rotation ?? 0;
  }
  return { alpha, x, y, rotation };
}

/**
 * Evaluate extended event channels (color, gif, incline, scaleX, scaleY, text)
 * at a given beat.
 * @param extended - The extended event data (or undefined).
 * @param beat - Current beat (divided by bpmfactor).
 * @param bpmList - BPM list.
 */
export function evaluateExtendedEvents(
  extended: Extended | undefined,
  beat: number,
  bpmList: Bpm[]
): {
  color: number[] | undefined;
  gif: number | undefined;
  incline: number | undefined;
  scaleX: number | undefined;
  scaleY: number | undefined;
  text: string | undefined;
} {
  if (!extended) {
    return {
      color: undefined,
      gif: undefined,
      incline: undefined,
      scaleX: undefined,
      scaleY: undefined,
      text: undefined,
    };
  }
  return {
    color: evaluateEventChannel(extended.colorEvents, beat, bpmList) as number[] | undefined,
    gif: evaluateEventChannel(extended.gifEvents, beat, bpmList, false) as number | undefined,
    incline: evaluateEventChannel(extended.inclineEvents, beat, bpmList) as number | undefined,
    scaleX: evaluateEventChannel(extended.scaleXEvents, beat, bpmList) as number | undefined,
    scaleY: evaluateEventChannel(extended.scaleYEvents, beat, bpmList) as number | undefined,
    text: evaluateEventChannel(extended.textEvents, beat, bpmList) as string | undefined,
  };
}

// ─── Control Node Evaluation ─────────────────────────────────────────────────

/** All control node types with their value property names. */
export const ControlTypes = {
  ALPHA: { index: 0, key: "alpha" as const },
  POS: { index: 1, key: "pos" as const },
  SIZE: { index: 2, key: "size" as const },
  SKEW: { index: 3, key: "skew" as const },
  Y: { index: 4, key: "y" as const },
} as const;

type Control = AlphaControl | PosControl | SizeControl | SkewControl | YControl;
type ControlArray = Control[];

/**
 * Evaluate a control node array at a given chart distance x.
 * Control nodes are sorted by descending x and interpolated with their easing.
 * @param control - The control array (sorted descending by x).
 * @param x - Chart distance from the line.
 * @param valueKey - The property name to read from control nodes (e.g. 'alpha', 'pos').
 * @returns The interpolated control value.
 */
export function evaluateControl(
  control: ControlArray,
  x: number,
  valueKey: "alpha" | "pos" | "size" | "skew" | "y"
): number {
  if (control.length === 0) return valueKey === "skew" ? 0 : 1;

  // Controls are sorted by descending x. Find the bracket containing x.
  let currentIdx = 0;
  // Find first control where control[i].x >= x (descending order)
  while (currentIdx < control.length - 1 && (control[currentIdx] as Control)["x"]! < x) {
    currentIdx++;
  }
  // Walk backwards if needed
  while (currentIdx > 0 && (control[currentIdx] as Control)["x"]! >= x) {
    currentIdx--;
  }
  // Ensure valid
  if ((control[currentIdx] as Control)["x"]! < x && currentIdx < control.length - 1) {
    currentIdx++;
  }

  const current = control[currentIdx] as Control;
  const nextIdx = currentIdx + 1 < control.length ? currentIdx + 1 : currentIdx;
  const next = control[nextIdx] as Control;

  if (nextIdx === currentIdx || current["x"] === next["x"]) {
    return current[valueKey as keyof Control] ?? (valueKey === "skew" ? 0 : 1);
  }

  const progress = easing(current["easing"] ?? 1, (x - current["x"]!) / (next["x"]! - current["x"]!));
  return lerp(current[valueKey as keyof Control] ?? 0, next[valueKey as keyof Control] ?? 0, progress);
}

// ─── Event Creation Helpers ──────────────────────────────────────────────────

/**
 * Create a standard RPE event with all required fields.
 *
 * Accepts both fractional beat numbers and beat tuples for `startBeat`/`endBeat`.
 * The `easingType` can be a number (1–28) or a name string (see {@link resolveEasingType}).
 *
 * @param start - Start value.
 * @param end - End value.
 * @param startBeat - Start beat as `[measure, num, den]` tuple or fractional number.
 * @param endBeat - End beat as `[measure, num, den]` tuple or fractional number.
 * @param easingType - Easing type or name (default: 1 = linear).
 * @param options - Optional fields: `bezier`, `bezierPoints`, `easingLeft`, `easingRight`, `linkgroup`.
 * @returns A fully initialized `Event` object.
 *
 * @example
 * ```ts
 * // Line moves from x=0 to x=675 over beats 0–4 with CubicOut easing
 * const ev = createEvent(0, 4, 0, 675, 'cubicOut');
 *
 * // Use a beat tuple for musical precision (beat 1, 3/8)
 * const ev2 = createEvent([1, 3, 8], [2, 0, 1], 0, 255);
 *
 * // Custom bezier
 * const ev3 = createEvent(0, 4, 0, 1, 1, {
 *   bezier: 1,
 *   bezierPoints: [0.4, 0, 0.2, 1],
 * });
 * ```
 */
export function createEvent(
  startBeat: [number, number, number] | number,
  endBeat: [number, number, number] | number,
  start: number,
  end: number,
  easingType: number | EasingName = 1,
  options: EventOptions = {}
): Event {
  const st = typeof startBeat === "number" ? fromBeats(startBeat) : startBeat;
  const et = typeof endBeat === "number" ? fromBeats(endBeat) : endBeat;
  return {
    bezier: options.bezier ?? 0,
    bezierPoints: options.bezierPoints ?? [0, 0, 1, 1],
    easingLeft: options.easingLeft ?? 0,
    easingRight: options.easingRight ?? 1,
    easingType: resolveEasingType(easingType),
    start,
    end,
    startTime: st,
    startBeat: toBeats(st),
    endTime: et,
    endBeat: toBeats(et),
    linkgroup: options.linkgroup ?? 0,
  };
}

/**
 * Create a speed event.
 * @param startBeat - Start beat.
 * @param endBeat - End beat.
 * @param start - Start speed.
 * @param end - End speed.
 * @param easingType - Easing type. Default: linear.
 */
export function createSpeedEvent(
  startBeat: [number, number, number] | number,
  endBeat: [number, number, number] | number,
  start: number,
  end: number,
  easingType: number | EasingName = 1,
  options: SpeedEventOptions = {}
): SpeedEvent {
  const st = typeof startBeat === "number" ? fromBeats(startBeat) : startBeat;
  const et = typeof endBeat === "number" ? fromBeats(endBeat) : endBeat;
  return {
    easingLeft: options.easingLeft ?? 0,
    easingRight: options.easingRight ?? 1,
    easingType: resolveEasingType(easingType),
    start,
    end,
    startTime: st,
    startBeat: toBeats(st),
    endTime: et,
    endBeat: toBeats(et),
    linkgroup: options.linkgroup ?? 0,
  };
}

/**
 * Create a color event.
 * @param startBeat - Start beat.
 * @param endBeat - End beat.
 * @param start - Start color [r, g, b].
 * @param end - End color [r, g, b].
 * @param easingType - Easing type. Default: linear.
 */
export function createColorEvent(
  startBeat: [number, number, number] | number,
  endBeat: [number, number, number] | number,
  start: [number, number, number],
  end: [number, number, number],
  easingType: number | EasingName = 1,
  options: EventOptions = {}
): ColorEvent {
  const st = typeof startBeat === "number" ? fromBeats(startBeat) : startBeat;
  const et = typeof endBeat === "number" ? fromBeats(endBeat) : endBeat;
  return {
    bezier: options.bezier ?? 0,
    bezierPoints: options.bezierPoints ?? [0, 0, 1, 1],
    easingLeft: options.easingLeft ?? 0,
    easingRight: options.easingRight ?? 1,
    easingType: resolveEasingType(easingType),
    start,
    end,
    startTime: st,
    startBeat: toBeats(st),
    endTime: et,
    endBeat: toBeats(et),
    linkgroup: options.linkgroup ?? 0,
  };
}

/**
 * Create a text event.
 * @param startBeat - Start beat.
 * @param endBeat - End beat.
 * @param start - Start text.
 * @param end - End text.
 * @param easingType - Easing type. Default: linear.
 */
export function createTextEvent(
  startBeat: [number, number, number] | number,
  endBeat: [number, number, number] | number,
  start: string,
  end: string,
  easingType: number | EasingName = 1,
  options: EventOptions = {}
): TextEvent {
  const st = typeof startBeat === "number" ? fromBeats(startBeat) : startBeat;
  const et = typeof endBeat === "number" ? fromBeats(endBeat) : endBeat;
  return {
    bezier: options.bezier ?? 0,
    bezierPoints: options.bezierPoints ?? [0, 0, 1, 1],
    easingLeft: options.easingLeft ?? 0,
    easingRight: options.easingRight ?? 1,
    easingType: resolveEasingType(easingType),
    start,
    end,
    startTime: st,
    startBeat: toBeats(st),
    endTime: et,
    endBeat: toBeats(et),
    linkgroup: options.linkgroup ?? 0,
  };
}

/**
 * Create an empty event layer.
 */
export function createEventLayer(): EventLayer {
  return {
    alphaEvents: [],
    moveXEvents: [],
    moveYEvents: [],
    rotateEvents: [],
    speedEvents: [],
  };
}

// ─── Batch Event Operations ──────────────────────────────────────────────────

/**
 * Sort events by startBeat and compute startBeat/endBeat from time tuples.
 *
 * @param events - Array of events to process (mutated in place).
 */
export function processEvents(
  events: (Event | SpeedEvent | ColorEvent | GifEvent | TextEvent)[] | null | undefined
): void {
  events?.forEach((event) => {
    // prevent stupidity
    if (!Array.isArray(event.startTime)) {
      if (event.startTime !== event.startBeat) event.startBeat = event.startTime;
      event.startTime = fromBeats(event.startBeat);
    }
    if (!Array.isArray(event.endTime)) {
      if (event.endTime !== event.endBeat) event.endBeat = event.endTime;
      event.endTime = fromBeats(event.endBeat);
    }
    event.startBeat = toBeats(event.startTime);
    event.endBeat = toBeats(event.endTime);
    if (event.endBeat < event.startBeat) event.endBeat = event.startBeat;
  });
  events?.sort((a, b) => a.startBeat - b.startBeat);
}

/**
 * Sort control nodes by descending x (as the game expects).
 * @param control - Control array to sort (mutated in place).
 */
export function processControlNodes(control: ControlArray): void {
  control.sort((a, b) => (b as { x: number }).x - (a as { x: number }).x);
}

/**
 * Offset all events in a channel by a beat delta (mutates in place).
 *
 * @param events - Array of events to shift.
 * @param beatDelta - Number of beats to add (positive = later, negative = earlier).
 *
 * @example
 * ```ts
 * // Shift the second verse events forward by 32 beats
 * offsetEvents(layer.moveXEvents ?? [], 32);
 * ```
 */
export function offsetEvents(
  events: (Event | SpeedEvent | ColorEvent | GifEvent | TextEvent)[],
  beatDelta: number
): void {
  for (const event of events) {
    event.startBeat += beatDelta;
    event.endBeat += beatDelta;
    event.startTime = fromBeats(event.startBeat);
    event.endTime = fromBeats(event.endBeat);
  }
}

/**
 * Scale all event times around a pivot beat (mutates in place).
 *
 * Each event's `startBeat` and `endBeat` are rescaled relative to `pivot`.
 * A factor of 2 doubles the duration; 0.5 halves it.
 *
 * @param events - Array of events to rescale.
 * @param pivot - The beat around which to scale.
 * @param factor - Scale factor (> 1 stretches, < 1 compresses).
 *
 * @example
 * ```ts
 * // Slow down a phrase to half speed, anchored at beat 0
 * scaleEventTimes(layer.rotateEvents ?? [], 0, 2);
 *
 * // Double tempo from beat 8 onwards, pivoting at beat 8
 * scaleEventTimes(layer.moveYEvents ?? [], 8, 0.5);
 * ```
 */
export function scaleEventTimes(
  events: (Event | SpeedEvent | ColorEvent | GifEvent | TextEvent)[],
  pivot: number,
  factor: number
): void {
  for (const event of events) {
    event.startBeat = pivot + (event.startBeat - pivot) * factor;
    event.endBeat = pivot + (event.endBeat - pivot) * factor;
    event.startTime = fromBeats(event.startBeat);
    event.endTime = fromBeats(event.endBeat);
  }
}

/**
 * Scale all event values by a multiplier.
 * Only works for numeric events (Event, SpeedEvent).
 * @param events - Array of numeric events (mutated in place).
 * @param multiplier - Value to multiply start/end by.
 */
export function scaleEventValues(events: (Event | SpeedEvent)[], multiplier: number): void {
  for (const event of events) {
    event.start *= multiplier;
    event.end *= multiplier;
  }
}

/**
 * Offset all event values by an addend.
 * Only works for numeric events (Event, SpeedEvent).
 * @param events - Array of numeric events (mutated in place).
 * @param addend - Value to add to start/end.
 */
export function offsetEventValues(events: (Event | SpeedEvent)[], addend: number): void {
  for (const event of events) {
    event.start += addend;
    event.end += addend;
  }
}

/**
 * Mirror event values around a center value (mutates in place).
 *
 * For `moveX` events, use `center = 0` to flip horizontal motion.
 * For `moveY` / rotation events, also use `center = 0`.
 *
 * @param events - Array of numeric events to mirror.
 * @param center - The pivot value to mirror around (default 0).
 *
 * @example
 * ```ts
 * // Flip all horizontal movement
 * mirrorEventValues(layer.moveXEvents ?? []);
 *
 * // Mirror rotation around 45°
 * mirrorEventValues(layer.rotateEvents ?? [], 45);
 * ```
 */
export function mirrorEventValues(events: (Event | SpeedEvent)[], center = 0): void {
  for (const event of events) {
    event.start = 2 * center - event.start;
    event.end = 2 * center - event.end;
  }
}

/**
 * Generate a sequence of events that form a linear keyframe animation.
 *
 * Each consecutive pair of keyframes produces one `Event` with the specified
 * easing applied between them. Use this for compact multi-segment animations.
 *
 * @param keyframes - Array of `[beat, value]` pairs sorted by beat.
 * @param easingType - Easing applied between every pair of keyframes (default: linear).
 * @returns Array of `Event` objects ready to push into an event channel.
 *
 * @example
 * ```ts
 * // X oscillates 0 → 675 → 0 over 4 beats
 * const evs = keyframesToEvents([[0, 0], [2, 675], [4, 0]], 'sineInOut');
 * layer.moveXEvents = evs;
 *
 * // Create a 3-step alpha fade: in, hold, out
 * const alpha = keyframesToEvents([[0, 0], [1, 255], [3, 255], [4, 0]]);
 * ```
 */
export function keyframesToEvents(keyframes: [number, number][], easingType: number | EasingName = 1): Event[] {
  const events: Event[] = [];
  for (let i = 0; i < keyframes.length - 1; i++) {
    events.push(
      createEvent(keyframes[i]![0], keyframes[i + 1]![0], keyframes[i]![1], keyframes[i + 1]![1], easingType)
    );
  }
  return events;
}

/**
 * Duplicate events from one beat range into another beat range.
 *
 * Only events whose `startBeat` and `endBeat` both fall within
 * `[sourceStart, sourceEnd]` are copied. The copies are shifted so that
 * `sourceStart` maps to `targetStart`.
 *
 * @param events - Source events (not mutated).
 * @param sourceStart - Start beat of the source range (inclusive).
 * @param sourceEnd - End beat of the source range (inclusive).
 * @param targetStart - Start beat of the target range.
 * @returns New array of cloned and relocated events.
 *
 * @example
 * ```ts
 * // Copy beats 0-8 to start at beat 16
 * const copies = copyEvents(layer.moveXEvents ?? [], 0, 8, 16);
 * layer.moveXEvents = [...(layer.moveXEvents ?? []), ...copies];
 * ```
 */
export function copyEvents(events: Event[], sourceStart: number, sourceEnd: number, targetStart: number): Event[] {
  const offset = targetStart - sourceStart;
  return events
    .filter((e) => e.startBeat >= sourceStart && e.endBeat <= sourceEnd)
    .map((e) => ({
      ...e,
      startBeat: e.startBeat + offset,
      endBeat: e.endBeat + offset,
      startTime: fromBeats(e.startBeat + offset),
      endTime: fromBeats(e.endBeat + offset),
    }));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Find the best rational approximation p/q of x with q ≤ maxDenominator.
 * Uses the Stern-Brocot tree / continued fraction approach.
 */
function bestRational(x: number, maxDenominator: number): { num: number; den: number } {
  let bestNum = Math.round(x);
  let bestDen = 1;
  let bestErr = Math.abs(x - bestNum);

  for (let den = 2; den <= maxDenominator; den++) {
    const num = Math.round(x * den);
    const err = Math.abs(x - num / den);
    if (err < bestErr) {
      bestErr = err;
      bestNum = num;
      bestDen = den;
      if (err < 1e-12) break;
    }
  }

  // Simplify via GCD
  const g = gcd(Math.abs(bestNum), bestDen);
  return { num: bestNum / g, den: bestDen / g };
}

/** Greatest common divisor (Euclidean algorithm). */
function gcd(a: number, b: number): number {
  while (b > 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

/**
 * RGB array to hex number.
 * @param rgb - [r, g, b] array.
 * @returns Hex number (e.g. 0xFF0000 for red).
 */
export function rgbToHex(rgb: number[] | undefined | null): number | undefined {
  return rgb ? (rgb[0]! << 16) | (rgb[1]! << 8) | rgb[2]! : undefined;
}
