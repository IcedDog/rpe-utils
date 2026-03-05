/**
 * Position computation utilities for RPE charts.
 *
 * Replicates the coordinate system used by the player at a fixed
 * scene size of 1350×900. Provides functions to compute:
 * - Line positions (from event layers + parent chains)
 * - Note positions relative to their line (local coordinates)
 * - Note positions relative to the scene (world coordinates)
 *
 * ## Coordinate system
 *
 * | Concept | Value |
 * |---|---|
 * | Scene width | 1350 units ({@link WIDTH}) |
 * | Scene height | 900 units ({@link HEIGHT}) |
 * | Origin | Top-left corner |
 * | Chart X=0 | Horizontal center |
 * | Chart Y=0 | Vertical center |
 * | Positive Y | Up (in math space); down in screen pixels |
 *
 * Use {@link p} / {@link o} / {@link d} / {@link w} / {@link h} to convert between
 * chart space and scene pixels (mirroring the game's `Game.p/o/d/w/h` helpers).
 *
 * ## Usage
 *
 * ```ts
 * import { getLineState, getNotePosition, preprocess } from './chart-utils';
 *
 * preprocess(chart);
 *
 * // Where is line 0 at beat 8?
 * const state = getLineState(chart, 0, 8);
 * console.log(state.sceneX, state.sceneY, state.rotationRad);
 *
 * // Where is note 3 on line 0 at beat 8?
 * const pos = getNotePosition(chart, 0, 3, 8);
 * if (pos) console.log(pos.sceneX, pos.sceneY);
 *
 * // Find the note closest to clicked pixel (700, 450)
 * const closest = findClosestNote(chart, { x: 700, y: 450 }, 8, 0, 50);
 * ```
 *
 * @module position
 */

import type {
  RpeJson,
  JudgeLine,
  Note,
  Bpm,
  AlphaControl,
  PosControl,
  SizeControl,
  SkewControl,
  YControl,
} from "./types";
import type { Vec2 } from "./math";
import { degToRad } from "./math";
import {
  toBeats,
  getTimeSec,
  evaluateAllEventLayers,
  evaluateExtendedEvents,
  evaluateControl,
  computeHeight,
  initBpmList,
} from "./events";

// ─── Scene Constants ─────────────────────────────────────────────────────────

/** Reference scene width in chart coordinate units (1350). */
export const WIDTH = 1350;

/** Reference scene height in chart coordinate units (900). */
export const HEIGHT = 900;

// ─── Coordinate Conversion (matching Game.ts methods) ────────────────────────

/**
 * Convert a chart X position to scene pixels.
 * Equivalent to `Game.p(position)` — at the reference resolution this is identity.
 * @param position - X coordinate in chart space (±675 is half-screen).
 * @example `p(675)` → 675 (right edge)
 */
export function p(position: number): number {
  return (position / WIDTH) * WIDTH; // With WIDTH === canvas width, this is identity
}

/**
 * Convert a chart Y offset to scene pixels.
 * Equivalent to `Game.o(offset)` — at the reference resolution this is identity.
 * @param offset - Y offset in chart space (±450 is half-screen).
 * @example `o(450)` → 450 (bottom half)
 */
export function o(offset: number): number {
  return (offset / HEIGHT) * HEIGHT; // Identity at reference resolution
}

/**
 * Convert a height/distance value (from speed integrals) to scene pixels.
 * Equivalent to `Game.d(distance)`. The formula is `distance * HEIGHT * 2 / 15`.
 * @param distance - Accumulated height value from {@link computeHeight}.
 */
export function d(distance: number): number {
  return (distance * HEIGHT * 2) / 15;
}

/**
 * Convert a chart X value to absolute scene X (centered).
 * Equivalent to `Game.w(width)`.
 * @param width - Chart X value.
 */
export function w(width: number): number {
  return (width / WIDTH) * WIDTH + WIDTH / 2;
}

/**
 * Convert a chart Y value to absolute scene Y (centered, Y-flipped).
 * Equivalent to `Game.h(height)`.
 * @param height - Chart Y value.
 */
export function h(height: number): number {
  return (-height / HEIGHT) * HEIGHT + HEIGHT / 2;
}

// ─── Line State ──────────────────────────────────────────────────────────────

/** The full computed state of a judge line at a specific time. */
export interface LineState {
  /** Raw chart-space X (sum of event layers). */
  rawX: number;
  /** Raw chart-space Y (sum of event layers). */
  rawY: number;
  /** Raw rotation in degrees (sum of event layers). */
  rawRotation: number;
  /** Raw alpha (0–255). */
  rawAlpha: number;
  /** Accumulated scroll height from speed events. */
  height: number;
  /** Scene-space X (pixels). */
  sceneX: number;
  /** Scene-space Y (pixels). */
  sceneY: number;
  /** Rotation in radians (screen space). */
  rotationRad: number;
  /** Opacity in [0, 1]. */
  opacity: number;
  /** Extended: incline in degrees, if any. */
  incline: number | undefined;
  /** Extended: scaleX, if any. */
  scaleX: number | undefined;
  /** Extended: scaleY, if any. */
  scaleY: number | undefined;
  /** Extended: color [r, g, b], if any. */
  color: number[] | undefined;
  /** Extended: text, if any. */
  text: string | undefined;
}

/**
 * Compute the full state of a judge line at a given beat.
 *
 * Evaluates all event layers (summing their contributions), computes the
 * accumulated scroll height from speed events, evaluates extended events
 * (incline, scale, color, text), applies chart-flipping, resolves parent
 * chains recursively, and converts everything to scene-space coordinates.
 *
 * You must call `preprocess(chart)` or `initBpmList(chart.BPMList)` before
 * using this function.
 *
 * @param chart - The parsed RPE chart.
 * @param lineIndex - Index of the line in `judgeLineList`.
 * @param beat - Current beat.
 * @param chartFlipping - Bit flags: 0 = none, 1 = horizontal, 2 = vertical, 3 = both.
 * @returns The full computed {@link LineState}.
 *
 * @example
 * ```ts
 * const state = getLineState(chart, 0, 4);
 * // state.sceneX / state.sceneY — absolute pixel position
 * // state.rotationRad           — current rotation in radians
 * // state.opacity               — [0, 1] alpha
 * // state.color                 — [r, g, b] or undefined
 * ```
 */
export function getLineState(
  chart: RpeJson,
  lineIndex: number,
  beat: number,
  chartFlipping = 0
): LineState {
  const line = chart.judgeLineList[lineIndex]!;
  const bpmList = chart.BPMList;
  const bpmfactor = line.bpmfactor || 1;
  const adjustedBeat = beat / bpmfactor;

  // Evaluate event layers
  const {
    alpha,
    x: rawX,
    y: rawY,
    rotation: rawRotation,
  } = evaluateAllEventLayers(line.eventLayers, adjustedBeat, bpmList);

  // Compute height from speed events
  const integrateEasings = line.integrateSpeedEasings ?? chart.META.RPEVersion >= 170;
  const height = computeHeight(line.eventLayers, adjustedBeat, bpmList, integrateEasings);

  // Evaluate extended events
  const extended = evaluateExtendedEvents(line.extended, adjustedBeat, bpmList);

  // Apply chart flipping modifiers
  let xModifier: 1 | -1 = 1;
  let yModifier: 1 | -1 = 1;
  let rotationModifier: 1 | -1 = 1;
  let rotationOffset: 0 | 180 = 0;

  if (chartFlipping & 1) {
    xModifier = -1;
    rotationModifier = -1;
  }
  if (chartFlipping & 2) {
    yModifier = -1;
    rotationModifier = (-1 * xModifier) as 1 | -1;
    rotationOffset = 180;
  }

  // Convert to scene coordinates
  let sceneX = p(xModifier * rawX);
  let sceneY = o(-yModifier * rawY);

  // Handle parent chain
  const rotateWithParent = line.rotateWithFather ?? false;
  const finalRotDeg = rotationModifier * rawRotation + rotationOffset;
  let finalRotRad = degToRad(finalRotDeg);

  if (line.father >= 0 && line.father < chart.judgeLineList.length) {
    const parentState = getLineState(chart, line.father, beat, chartFlipping);
    const parentX = parentState.sceneX - WIDTH / 2;
    const parentY = parentState.sceneY - HEIGHT / 2;
    const cosP = Math.cos(parentState.rotationRad);
    const sinP = Math.sin(parentState.rotationRad);
    const newX = parentX + sceneX * cosP - sceneY * sinP;
    const newY = parentY + sceneY * cosP + sceneX * sinP;
    sceneX = newX;
    sceneY = newY;
    if (rotateWithParent) {
      finalRotRad += parentState.rotationRad;
    }
  }

  sceneX += WIDTH / 2;
  sceneY += HEIGHT / 2;

  return {
    rawX,
    rawY,
    rawRotation,
    rawAlpha: alpha,
    height,
    sceneX,
    sceneY,
    rotationRad: finalRotRad,
    opacity: alpha / 255,
    incline: extended.incline,
    scaleX: extended.scaleX,
    scaleY: extended.scaleY,
    color: extended.color,
    text: extended.text,
  };
}

// ─── Note Position ───────────────────────────────────────────────────────────

/** The computed position of a note. */
export interface NotePosition {
  /** X position relative to the line (in scene pixels). */
  localX: number;
  /** Y position relative to the line (in scene pixels). */
  localY: number;
  /** Absolute X position in scene space. */
  sceneX: number;
  /** Absolute Y position in scene space. */
  sceneY: number;
  /** The raw distance from the line (in scene pixels). */
  dist: number;
  /** The chart-space distance (used for control evaluation). */
  chartDist: number;
}

/**
 * Compute the position of a specific note relative to its line at a given beat.
 *
 * Replicates the RPE player's note position logic including:
 * - Speed integral for the approach distance
 * - `posControl` and `yControl` node evaluation
 * - Incline offset
 * - Chart-flipping and `above` flag
 * - Parent line chain resolution (via `getLineState`)
 *
 * Returns both local coordinates (before line rotation) and absolute scene
 * coordinates (after rotation and translation).
 *
 * @param chart - The parsed RPE chart.
 * @param lineIndex - Index of the line in `judgeLineList`.
 * @param noteIndex - Index of the note in the line's `notes` array.
 * @param beat - Current beat (the "camera" time).
 * @param chartFlipping - Chart flipping flags (0–3).
 * @returns The {@link NotePosition}, or `null` if indices are invalid.
 *
 * @example
 * ```ts
 * const pos = getNotePosition(chart, 0, 2, 4.0);
 * if (pos) {
 *   console.log(`Note is at (${pos.sceneX.toFixed(1)}, ${pos.sceneY.toFixed(1)}) in scene space`);
 *   console.log(`Distance from line: ${pos.dist.toFixed(1)}px`);
 * }
 * ```
 */
export function getNotePosition(
  chart: RpeJson,
  lineIndex: number,
  noteIndex: number,
  beat: number,
  chartFlipping = 0
): NotePosition | null {
  const line = chart.judgeLineList[lineIndex];
  if (!line?.notes) return null;
  const note = line.notes[noteIndex];
  if (!note) return null;

  const bpmList = chart.BPMList;
  const bpmfactor = line.bpmfactor || 1;
  const lineState = getLineState(chart, lineIndex, beat, chartFlipping);

  // Compute target height for the note
  const adjustedBeat = beat / bpmfactor;
  const integrateEasings = line.integrateSpeedEasings ?? chart.META.RPEVersion >= 170;
  const targetHeight = computeHeight(
    line.eventLayers,
    toBeats(note.startTime),
    bpmList,
    integrateEasings
  );

  // yOffset is pre-multiplied by speed in the game: note.yOffset *= note.speed
  const yOffset = note.yOffset * note.speed;

  // Distance from the line
  const dist = d((targetHeight - lineState.height) * note.speed) + o(yOffset);
  const chartDist = (dist / HEIGHT) * 900;

  // X modifier for chart flipping
  let xModifier: 1 | -1 = 1;
  if (chartFlipping === 1 || chartFlipping === 2) {
    xModifier = -1;
  }

  // Y modifier based on note.above
  const yModifier: 1 | -1 = note.above === 1 ? -1 : 1;

  // Compute local X using control values
  const posControlVal = evaluateControl(line.posControl, chartDist, "pos");
  const incline = lineState.incline ?? 0;
  const inclineTerm =
    Math.tan(((xModifier * note.positionX) / 675) * -incline * (Math.PI / 180)) * chartDist;

  const localX = p(xModifier * note.positionX * posControlVal + inclineTerm);

  // Compute local Y using control values
  const yControlVal = evaluateControl(line.yControl, chartDist, "y");
  const localY = yModifier * dist * yControlVal;

  // Transform to scene coordinates
  const cosR = Math.cos(lineState.rotationRad);
  const sinR = Math.sin(lineState.rotationRad);
  const sceneX = lineState.sceneX + localX * cosR - localY * sinR;
  const sceneY = lineState.sceneY + localX * sinR + localY * cosR;

  return { localX, localY, sceneX, sceneY, dist, chartDist };
}

/**
 * Compute the judgment position of a note (position ON the judgment line).
 * This is where hit effects appear. Uses only the yOffset, not the full distance.
 *
 * @param chart - The parsed RPE chart.
 * @param lineIndex - Index of the line.
 * @param noteIndex - Index of the note.
 * @param beat - Current beat.
 * @param chartFlipping - Chart flipping flags.
 * @returns The judgment position in scene coordinates, or null if invalid.
 */
export function getNoteJudgmentPosition(
  chart: RpeJson,
  lineIndex: number,
  noteIndex: number,
  beat: number,
  chartFlipping = 0
): Vec2 | null {
  const line = chart.judgeLineList[lineIndex];
  if (!line?.notes) return null;
  const note = line.notes[noteIndex];
  if (!note) return null;

  const lineState = getLineState(chart, lineIndex, beat, chartFlipping);

  let xModifier: 1 | -1 = 1;
  if (chartFlipping === 1 || chartFlipping === 2) {
    xModifier = -1;
  }
  const yModifier: 1 | -1 = note.above === 1 ? -1 : 1;

  // For judgment position, use positionX for X and yOffset for Y
  const localX = p(xModifier * note.positionX);
  const localY = yModifier * o(note.yOffset * note.speed);

  const cosR = Math.cos(lineState.rotationRad);
  const sinR = Math.sin(lineState.rotationRad);

  return {
    x: lineState.sceneX + localX * cosR - localY * sinR,
    y: lineState.sceneY + localX * sinR + localY * cosR,
  };
}

/**
 * Get the positions of ALL notes on a given line at a specific beat.
 *
 * @param chart - The parsed RPE chart.
 * @param lineIndex - Index of the line.
 * @param beat - Current beat.
 * @param chartFlipping - Chart flipping flags.
 * @returns Array of note positions (indices match the notes array).
 */
export function getAllNotePositions(
  chart: RpeJson,
  lineIndex: number,
  beat: number,
  chartFlipping = 0
): NotePosition[] {
  const line = chart.judgeLineList[lineIndex];
  if (!line?.notes) return [];
  return line.notes.map((_, i) => getNotePosition(chart, lineIndex, i, beat, chartFlipping)!);
}

/**
 * Get the positions of ALL notes across ALL lines at a specific beat.
 *
 * @param chart - The parsed RPE chart.
 * @param beat - Current beat.
 * @param chartFlipping - Chart flipping flags.
 * @returns Array of {lineIndex, noteIndex, position}.
 */
export function getAllNotePositionsInChart(
  chart: RpeJson,
  beat: number,
  chartFlipping = 0
): { lineIndex: number; noteIndex: number; position: NotePosition }[] {
  const results: { lineIndex: number; noteIndex: number; position: NotePosition }[] = [];
  for (let li = 0; li < chart.judgeLineList.length; li++) {
    const line = chart.judgeLineList[li]!;
    if (!line.notes) continue;
    for (let ni = 0; ni < line.notes.length; ni++) {
      const pos = getNotePosition(chart, li, ni, beat, chartFlipping);
      if (pos) results.push({ lineIndex: li, noteIndex: ni, position: pos });
    }
  }
  return results;
}

/**
 * Find the note closest to a given scene position at a specific beat.
 *
 * Useful for implementing click-to-select in a chart editor.
 *
 * @param chart - The parsed RPE chart.
 * @param target - Target position in scene pixels.
 * @param beat - Current beat.
 * @param chartFlipping - Chart flipping flags (0–3).
 * @param maxDistance - Only consider notes within this pixel radius (default: `Infinity`).
 * @returns The closest note's info, or `null` if none found within `maxDistance`.
 *
 * @example
 * ```ts
 * // On mouse click at (mouseX, mouseY):
 * const hit = findClosestNote(chart, { x: mouseX, y: mouseY }, currentBeat, 0, 30);
 * if (hit) {
 *   console.log(`Clicked line ${hit.lineIndex}, note ${hit.noteIndex}`);
 * }
 * ```
 */
export function findClosestNote(
  chart: RpeJson,
  target: Vec2,
  beat: number,
  chartFlipping = 0,
  maxDistance = Infinity
): { lineIndex: number; noteIndex: number; position: NotePosition; distance: number } | null {
  let best: {
    lineIndex: number;
    noteIndex: number;
    position: NotePosition;
    distance: number;
  } | null = null;

  for (let li = 0; li < chart.judgeLineList.length; li++) {
    const line = chart.judgeLineList[li]!;
    if (!line.notes) continue;
    for (let ni = 0; ni < line.notes.length; ni++) {
      const pos = getNotePosition(chart, li, ni, beat, chartFlipping);
      if (!pos) continue;
      const dx = pos.sceneX - target.x;
      const dy = pos.sceneY - target.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < maxDistance && (!best || dist < best.distance)) {
        best = { lineIndex: li, noteIndex: ni, position: pos, distance: dist };
      }
    }
  }
  return best;
}
