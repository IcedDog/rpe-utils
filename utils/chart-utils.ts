/**
 * Main entry point for RPE chart utilities.
 *
 * Re-exports everything from the sub-modules and provides chart-level
 * operations: creation, validation, statistics, BPM manipulation,
 * line creation, note factories, shader helpers, and import/export.
 *
 * ## Module map
 *
 * | Module | What it provides |
 * |---|---|
 * | `chart-utils` (this file) | Chart/line/note CRUD, BPM, transforms, stats, validation, serialization |
 * | `events` | Beat↔time conversion, event creation &amp; evaluation, batch ops |
 * | `math` | Vec2, Mat3, scalar math, random, noise, arrays |
 * | `easing` | 28 RPE easing functions, cubic bezier, derivative/integral |
 * | `position` | Line state, note position, scene coordinate helpers |
 * | `iterators` | Fluent `NoteIterator` / `LineIterator` / `EventIterator` |
 * | `prototype` | `ChartBuilder` / `LineBuilder` / `NoteBuilder` — fluent chart editing; `wrap()` / `createChart()` factories |
 * | `extra` | `ExtraBuilder` / `EffectBuilder` — fluent `extra.json` editing; shader parsing; animated uniforms |
 * | `types` | All TypeScript interfaces for RPE data structures |
 *
 * ## Common workflows
 *
 * ### Fluent chart API (recommended)
 * ```ts
 * import { wrap, createChart, ExtraBuilder } from './chart-utils';
 *
 * // ── Build from scratch ─────────────────────────────────────────────────
 * const chart = createChart(140, 'My Chart');
 * chart.addLine({ name: 'Main' })
 *   .moveX(0, 4, -675, 675, 'cubicOut')
 *   .addNote(2)
 *   .addNote(4, { type: 2, endBeat: 6 });
 *
 * // ── Load an existing chart ─────────────────────────────────────────────
 * const raw = JSON.parse(fs.readFileSync('chart.json', 'utf8'));
 * const chart = wrap(raw);   // attaches fluent methods to the existing data
 * chart.getLine(0).moveX(8, 12, 0, 200);
 *
 * // ── Serialize ─────────────────────────────────────────────────────────
 * const json = chart.serialize();
 *
 * // ── Extra / shader effects ─────────────────────────────────────────────
 * import { readFileSync } from 'fs';
 * const glsl = readFileSync('shaders/glow.glsl', 'utf8');
 *
 * const extra = new ExtraBuilder(140);
 * extra.addShader('/glow.glsl', glsl, 0, 32)      // auto-loads defaults
 *   .animate('intensity', 0, 1, { easing: 'cubicOut' })
 *   .setRange(100, 101);
 * fs.writeFileSync('extra.json', extra.serialize());
 * ```
 *
 * ### Low-level free-function API (still fully available)
 * ```ts
 * import { createEmptyChart, addLine, addNote, addMoveXEvent, serializeChart } from './chart-utils';
 *
 * const chart = createEmptyChart(140, 'My Chart');
 * const li = addLine(chart, { name: 'Main' });
 * addMoveXEvent(chart, li, 0, 0, 4, -675, 675, 8);
 * addNote(chart, li, 2, { type: 1 });
 * const json = serializeChart(chart);
 * ```
 *
 * @module chart-utils
 */

// ─── Re-exports ──────────────────────────────────────────────────────────────

export * from "./math";
export * from "./easing";
export * from "./events";
export * from "./position";
export * from "./iterators";
export * from "./extra";
export * from "./prototype";
export type {
  RpeJson,
  JudgeLine,
  Note,
  Event,
  SpeedEvent,
  ColorEvent,
  GifEvent,
  TextEvent,
  EventLayer,
  Extended,
  Bpm,
  RpeMeta,
  AlphaControl,
  PosControl,
  SizeControl,
  SkewControl,
  YControl,
  Beat,
  PhiraExtra,
  ShaderEffect,
  Video,
  VideoAttach,
  Variable,
  AnimatedVariable,
  VariableEvent,
  ScalarVariableEvent,
  VectorVariableEvent,
  BaseVariableEvent,
} from "./types";

import type {
  RpeJson,
  JudgeLine,
  Note,
  Event,
  ColorEvent,
  TextEvent,
  GifEvent,
  EventLayer,
  Extended,
  RpeMeta,
  Beat,
} from "./types";

import {
  toBeats,
  fromBeats,
  initBpmList,
  getTimeSec,
  processEvents,
  processControlNodes,
} from "./events";
import { deepClone } from "./math";

// ─── Chart Creation ──────────────────────────────────────────────────────────

/**
 * Create a minimal empty RPE chart with sensible defaults.
 *
 * The chart has:
 * - One BPM entry at beat 0
 * - An empty `judgeLineList`
 * - A single `'default'` group
 * - Zero `chartTime`
 *
 * @param bpm - Initial BPM (default: 120).
 * @param name - Chart name shown in the game (default: 'Untitled').
 * @param options - Additional metadata fields to override (`RpeMeta`).
 * @returns A valid, empty `RpeJson` ready to populate.
 *
 * @example
 * ```ts
 * const chart = createEmptyChart(140, 'Song Name', {
 *   charter:  'Me',
 *   composer: 'Artist',
 *   level:    'SP Lv.15',
 *   song:     'song.ogg',
 *   background: 'bg.png',
 * });
 * ```
 */
export function createEmptyChart(
  bpm = 120,
  name = "Untitled",
  options: Partial<RpeMeta> = {}
): RpeJson {
  const meta: RpeMeta = {
    RPEVersion: 150,
    background: "",
    charter: "Unknown",
    composer: "Unknown",
    id: "",
    level: "SP Lv.?",
    name,
    offset: 0,
    song: "",
    ...options,
  };

  const chart: RpeJson = {
    BPMList: [
      {
        bpm,
        startTime: [0, 0, 1] as Beat,
        startBeat: 0,
        startTimeSec: 0,
      },
    ],
    META: meta,
    chartTime: 0,
    judgeLineGroup: ["default"],
    judgeLineList: [],
    multiLineString: "",
    multiScale: 1,
  };

  return chart;
}

// ─── Line Creation / Management ─────────────────────────────────────────────

/** Options for creating a new judge line. */
export interface CreateLineOptions {
  /** Line name (default: auto-generated). */
  name?: string;
  /** Texture key (default: 'line.png'). */
  texture?: string;
  /** Group index (default: 0). */
  group?: number;
  /** Parent line index (default: -1 = no parent). */
  father?: number;
  /** Inherit parent rotation (default: false). */
  rotateWithFather?: boolean;
  /** BPM factor (default: 1). */
  bpmfactor?: number;
  /** Z-order for rendering (default: 0). */
  zOrder?: number;
  /** Extended events container. */
  extended?: Extended;
  /** Attach UI */
  attachUI?: "pause" | "combonumber" | "combo" | "score" | "bar" | "name" | "level" | null;
  /** Whether the texture is GIF */
  isGif?: boolean;
  /** Whether the line is a masked line */
  isCover?: number;
}

/**
 * Extract creation options from an existing line, optionally merging extra overrides.
 *
 * Useful for duplicating a line's settings without copying its events or notes.
 *
 * @param line - The source line.
 * @param options - Additional overrides to apply on top of the extracted values.
 * @returns A complete `CreateLineOptions` object.
 *
 * @example
 * ```ts
 * const opts = getLineOptions(chart.judgeLineList[0], { name: 'Clone' });
 * addLine(chart, opts);
 * ```
 */
export function getLineOptions(
  line: JudgeLine,
  options: Partial<CreateLineOptions> = {}
): CreateLineOptions {
  return {
    name: line.Name,
    texture: line.Texture,
    group: line.Group,
    father: line.father,
    rotateWithFather: line.rotateWithFather,
    bpmfactor: line.bpmfactor,
    zOrder: line.zOrder,
    extended: line.extended,
    attachUI: line.attachUI,
    isGif: line.isGif,
    isCover: line.isCover,
    ...options,
  };
}

/**
 * Create a new judge line with sensible defaults and append it to the chart's
 * `judgeLineList`.
 *
 * The new line has:
 * - One default event layer (alpha=255, moveX/Y=0, rotation=0, speed=10)
 * - Default control node arrays (identity transforms)
 * - An empty `notes` array
 *
 * @param chart - The RPE chart (modified in place).
 * @param options - Line creation options.
 * @returns The index of the newly added line.
 *
 * @example
 * ```ts
 * const li = addLine(chart, { name: 'FX', texture: 'line.png', zOrder: 10 });
 * addMoveXEvent(chart, li, 0, 0, 4, -675, 675);
 * ```
 */
export function addLine(
  chart: RpeJson,
  options: CreateLineOptions = {},
  createDefualtEvents = true
): number {
  const index = chart.judgeLineList.length;
  const line: JudgeLine = {
    Name: options.name ?? `Untitled`,
    Texture: options.texture ?? "line.png",
    Group: options.group ?? 0,
    father: options.father ?? -1,
    rotateWithFather: options.rotateWithFather ?? false,
    bpmfactor: options.bpmfactor ?? 1,
    zOrder: options.zOrder ?? 0,
    isCover: options.isCover ?? 1,
    isGif: options.isGif ?? false,
    attachUI: options.attachUI ?? null,
    anchor: [0.5, 0.5],
    numOfNotes: 0,
    notes: [],
    eventLayers: createDefualtEvents ? [createDefaultEventLayer()] : [],
    alphaControl: createDefualtEvents
      ? [
          { alpha: 1, easing: 1, x: 0 },
          { alpha: 1, easing: 1, x: 9999999 },
        ]
      : [],
    posControl: createDefualtEvents
      ? [
          { easing: 1, pos: 1, x: 0 },
          { easing: 1, pos: 1, x: 9999999 },
        ]
      : [],
    sizeControl: createDefualtEvents
      ? [
          { easing: 1, size: 1, x: 0 },
          { easing: 1, size: 1, x: 9999999 },
        ]
      : [],
    skewControl: createDefualtEvents
      ? [
          { easing: 1, skew: 0, x: 0 },
          { easing: 1, skew: 0, x: 9999999 },
        ]
      : [],
    yControl: createDefualtEvents
      ? [
          { easing: 1, x: 0, y: 1 },
          { easing: 1, x: 9999999, y: 1 },
        ]
      : [],
    extended: options.extended ?? {},
  };

  chart.judgeLineList.push(line);
  return index;
}

/**
 * Remove a line from the chart by index.
 *
 * All `father` references in sibling lines are updated:
 * - References to the removed line are reset to `-1` (no parent).
 * - References to lines after the removed line are decremented by 1.
 *
 * @param chart - The RPE chart (modified in place).
 * @param lineIndex - Index of the line to remove.
 * @returns The chart (for chaining).
 *
 * @example
 * ```ts
 * removeLine(chart, 2); // removes line at index 2
 * ```
 */
export function removeLine(chart: RpeJson, lineIndex: number): RpeJson {
  chart.judgeLineList.splice(lineIndex, 1);
  // Update father references
  for (const line of chart.judgeLineList) {
    if (line.father === lineIndex) {
      line.father = -1;
    } else if (line.father > lineIndex) {
      line.father--;
    }
  }
  return chart;
}

/**
 * Duplicate a line (deep copy) and append it to the chart.
 *
 * The copy's `Name` is set to `<original.Name>_copy`. Its `father` and
 * `zOrder` are inherited unchanged.
 *
 * @param chart - The RPE chart (modified in place).
 * @param lineIndex - Index of the line to duplicate.
 * @param includeNotes - Copy notes as well (default: `true`).
 *   Pass `false` to copy only the line's animation events.
 * @returns The index of the new line.
 *
 * @example
 * ```ts
 * const newIdx = duplicateLine(chart, 0, false); // copy events only
 * chart.judgeLineList[newIdx]!.Name = 'Mirror';
 * ```
 */
export function duplicateLine(chart: RpeJson, lineIndex: number, includeNotes = true): number {
  const original = chart.judgeLineList[lineIndex];
  if (!original) throw new Error(`Line index ${lineIndex} out of range`);
  const copy: JudgeLine = deepClone(original);
  copy.Name = `${original.Name}_copy`;
  if (!includeNotes) {
    copy.notes = [];
    copy.numOfNotes = 0;
  }
  chart.judgeLineList.push(copy);
  return chart.judgeLineList.length - 1;
}

// ─── Note Creation ──────────────────────────────────────────────────────────

/** Options for creating a note. */
export interface CreateNoteOptions {
  /** Note type: 1=Tap, 2=Hold, 3=Flick, 4=Drag. */
  type?: 1 | 2 | 3 | 4;
  /** X position in chart units (default: 0). */
  positionX?: number;
  /** Above (1) or below (2) the line (default: 1 = above). */
  above?: 1 | 2;
  /** Speed multiplier (default: 1). */
  speed?: number;
  /** Visual size multiplier (default: 1). */
  size?: number;
  /** Opacity 0-255 (default: 255). */
  alpha?: number;
  /** Y offset (default: 0). */
  yOffset?: number;
  /** Whether the note is fake / non-scoring (default: false). */
  isFake?: boolean;
  /** Visible time before beat (default: 999999). */
  visibleTime?: number;
  /** Custom hitsound key. */
  hitsound?: string;
  /** End beat for hold notes. Only used when type=2. */
  endBeat?: number;
  /** Tint color [r, g, b]. */
  tint?: [number, number, number] | null;
  /** Hit effect tint [r, g, b]. */
  tintHitEffects?: [number, number, number] | null;
}

/**
 * Extract creation options from an existing note, optionally merging with overrides.
 * Useful for cloning or templating notes.
 *
 * @param note - The source note.
 * @param options - Additional overrides to apply.
 * @returns A complete `CreateNoteOptions` object.
 */
export function getNoteOptions(
  note: Note,
  options: Partial<CreateNoteOptions> = {}
): CreateNoteOptions {
  return {
    type: note.type as 1 | 2 | 3 | 4,
    positionX: note.positionX,
    above: note.above as 1 | 2,
    speed: note.speed,
    size: note.size,
    alpha: note.alpha,
    yOffset: note.yOffset,
    isFake: note.isFake === 1,
    visibleTime: note.visibleTime,
    hitsound: note.hitsound,
    endBeat: note.endBeat,
    tint: note.tint,
    tintHitEffects: note.tintHitEffects,
    ...options,
  };
}

/**
 * Create a note and add it to a line.
 *
 * Automatically converts the beat to a `[measure, num, den]` tuple and
 * increments `line.numOfNotes`. For hold notes (`type: 2`), pass `endBeat`
 * in `options`; it defaults to `beat + 1`.
 *
 * @param chart - The RPE chart (modified in place).
 * @param lineIndex - Index of the target line.
 * @param beat - Start beat (fractional number, e.g. 2.5 = beat 2 and a half).
 * @param options - Note creation options.
 * @returns The index of the new note within `line.notes`.
 *
 * @example
 * ```ts
 * addNote(chart, 0, 2);                               // tap at beat 2
 * addNote(chart, 0, 4, { type: 3 });                  // flick at beat 4
 * addNote(chart, 0, 6, { type: 2, endBeat: 8 });      // hold beats 6–8
 * addNote(chart, 0, 8, { positionX: -200, above: 2 }); // below the line, offset left
 * ```
 */
export function addNote(
  chart: RpeJson,
  lineIndex: number,
  beat: number,
  options: CreateNoteOptions = {}
): number {
  const line = chart.judgeLineList[lineIndex];
  if (!line) throw new Error(`Line index ${lineIndex} out of range`);
  if (!line.notes) line.notes = [];

  const startTime = fromBeats(beat);
  const type = options.type ?? 1;
  const endBeat = type === 2 ? (options.endBeat ?? beat + 1) : beat;
  const endTime = fromBeats(endBeat);

  const note: Note = {
    above: options.above ?? 1,
    alpha: options.alpha ?? 255,
    endTime,
    endBeat,
    isFake: options.isFake ? 1 : 0,
    positionX: options.positionX ?? 0,
    size: options.size ?? 1,
    speed: options.speed ?? 1,
    startTime,
    startBeat: beat,
    type,
    visibleTime: options.visibleTime ?? 999999,
    yOffset: options.yOffset ?? 0,
    judgeArea: 1,
  };

  if (options.hitsound) note.hitsound = options.hitsound;
  if (options.tint) note.tint = options.tint;
  if (options.tintHitEffects) note.tintHitEffects = options.tintHitEffects;

  line.notes.push(note);
  line.numOfNotes++;
  return line.notes.length - 1;
}

/**
 * Add multiple notes at once to a line.
 *
 * Each entry in `beats` can be either:
 * - A plain beat number (uses `sharedOptions` for all fields)
 * - A `[beat, options]` tuple (per-note options override `sharedOptions`)
 *
 * @param chart - The RPE chart (modified in place).
 * @param lineIndex - Target line index.
 * @param beats - Array of beats or `[beat, options]` tuples.
 * @param sharedOptions - Options applied to all notes (overridden by per-note options).
 * @returns Array of note indices in insertion order.
 *
 * @example
 * ```ts
 * // Add 4 taps at beats 1, 2, 3, 4
 * addNotes(chart, 0, [1, 2, 3, 4], { type: 1 });
 *
 * // Mix of taps and a flick
 * addNotes(chart, 0, [
 *   [1, { type: 1, positionX: -200 }],
 *   [2, { type: 1, positionX:  200 }],
 *   [3, { type: 3 }],
 * ]);
 * ```
 */
export function addNotes(
  chart: RpeJson,
  lineIndex: number,
  beats: (number | [number, CreateNoteOptions])[],
  sharedOptions: CreateNoteOptions = {}
): number[] {
  return beats.map((entry) => {
    const [beat, opts] = typeof entry === "number" ? [entry, {}] : entry;
    return addNote(chart, lineIndex, beat, { ...sharedOptions, ...opts });
  });
}

// ─── Note Removal ───────────────────────────────────────────────────────────

/**
 * Remove a note from a line by index.
 *
 * `line.numOfNotes` is decremented automatically.
 *
 * @param chart - The RPE chart (modified in place).
 * @param lineIndex - Index of the target line.
 * @param noteIndex - Index within `line.notes` to remove.
 * @returns The removed `Note`, or `undefined` if the index is out of range.
 *
 * @example
 * ```ts
 * const removed = removeNote(chart, 0, 3); // remove 4th note on line 0
 * ```
 */
export function removeNote(chart: RpeJson, lineIndex: number, noteIndex: number): Note | undefined {
  const line = chart.judgeLineList[lineIndex];
  if (!line) throw new Error(`Line index ${lineIndex} out of range`);
  if (!line.notes || noteIndex < 0 || noteIndex >= line.notes.length) return undefined;
  const [removed] = line.notes.splice(noteIndex, 1);
  line.numOfNotes = Math.max(0, line.numOfNotes - 1);
  return removed;
}

/**
 * Remove all notes from a line that satisfy a predicate.
 *
 * `line.numOfNotes` is updated to the surviving count.
 *
 * @param chart - The RPE chart (modified in place).
 * @param lineIndex - Index of the target line.
 * @param predicate - Return `true` for each note that should be removed.
 * @returns Array of removed notes (in original order).
 *
 * @example
 * ```ts
 * // Remove all fake notes from line 0
 * removeNotes(chart, 0, note => note.isFake === 1);
 *
 * // Remove all flick notes
 * removeNotes(chart, 0, note => note.type === 3);
 * ```
 */
export function removeNotes(
  chart: RpeJson,
  lineIndex: number,
  predicate: (note: Note, index: number) => boolean
): Note[] {
  const line = chart.judgeLineList[lineIndex];
  if (!line) throw new Error(`Line index ${lineIndex} out of range`);
  if (!line.notes) return [];
  const removed: Note[] = [];
  line.notes = line.notes.filter((note, i) => {
    if (predicate(note, i)) {
      removed.push(note);
      return false;
    }
    return true;
  });
  line.numOfNotes = line.notes.length;
  return removed;
}

/**
 * Remove all notes from a line, returning them.
 *
 * Resets `line.numOfNotes` to 0.
 *
 * @param chart - The RPE chart (modified in place).
 * @param lineIndex - Index of the target line.
 * @returns Array of all removed notes (in original order).
 *
 * @example
 * ```ts
 * const saved = clearNotes(chart, 2); // wipe all notes on line 2
 * ```
 */
export function clearNotes(chart: RpeJson, lineIndex: number): Note[] {
  const line = chart.judgeLineList[lineIndex];
  if (!line) throw new Error(`Line index ${lineIndex} out of range`);
  const removed = line.notes ?? [];
  line.notes = [];
  line.numOfNotes = 0;
  return removed;
}

// ─── Event Removal ──────────────────────────────────────────────────────────

/** Identifies which event array within an EventLayer to target. */
export type EventChannel = "moveX" | "moveY" | "rotate" | "alpha" | "speed";

/**
 * Remove an event from a line's event layer by channel and index.
 *
 * @param chart - The RPE chart (modified in place).
 * @param lineIndex - Index of the target line.
 * @param layerIndex - Event layer index.
 * @param channel - Which channel: `'moveX'`, `'moveY'`, `'rotate'`, `'alpha'`, or `'speed'`.
 * @param eventIndex - Index of the event to remove.
 * @returns The removed event, or `undefined` if index is out of range.
 */
export function removeEvent(
  chart: RpeJson,
  lineIndex: number,
  layerIndex: number,
  channel: EventChannel,
  eventIndex: number
): Event | undefined {
  const line = chart.judgeLineList[lineIndex];
  if (!line) throw new Error(`Line index ${lineIndex} out of range`);
  const layer = line.eventLayers[layerIndex];
  if (!layer) throw new Error(`Layer index ${layerIndex} out of range`);
  const channelMap: Record<EventChannel, string> = {
    moveX: "moveXEvents",
    moveY: "moveYEvents",
    rotate: "rotateEvents",
    alpha: "alphaEvents",
    speed: "speedEvents",
  };
  const arr = (layer as Record<string, unknown>)[channelMap[channel]] as Event[] | null | undefined;
  if (!arr || eventIndex < 0 || eventIndex >= arr.length) return undefined;
  const [removed] = arr.splice(eventIndex, 1);
  return removed;
}

/**
 * Remove all events from a specific channel in a line's event layer
 * that match a predicate.
 *
 * @param chart - The RPE chart (modified in place).
 * @param lineIndex - Index of the target line.
 * @param layerIndex - Event layer index.
 * @param channel - Which channel.
 * @param predicate - Returns `true` for events to remove.
 * @returns Array of removed events.
 */
export function removeEvents(
  chart: RpeJson,
  lineIndex: number,
  layerIndex: number,
  channel: EventChannel,
  predicate: (event: Event, index: number) => boolean
): Event[] {
  const line = chart.judgeLineList[lineIndex];
  if (!line) throw new Error(`Line index ${lineIndex} out of range`);
  const layer = line.eventLayers[layerIndex];
  if (!layer) throw new Error(`Layer index ${layerIndex} out of range`);
  const key = `${channel}Events` as keyof EventLayer;
  const arr = layer[key] as Event[] | null | undefined;
  if (!arr) return [];
  const removed: Event[] = [];
  (layer as Record<string, unknown>)[key] = arr.filter((ev, i) => {
    if (predicate(ev, i)) {
      removed.push(ev);
      return false;
    }
    return true;
  });
  return removed;
}

/**
 * Remove an entire event layer from a line.
 *
 * @param chart - The RPE chart (modified in place).
 * @param lineIndex - Index of the target line.
 * @param layerIndex - Event layer index to remove.
 * @returns The removed EventLayer, or `undefined`.
 */
export function removeEventLayer(
  chart: RpeJson,
  lineIndex: number,
  layerIndex: number
): EventLayer | null | undefined {
  const line = chart.judgeLineList[lineIndex];
  if (!line) throw new Error(`Line index ${lineIndex} out of range`);
  if (layerIndex < 0 || layerIndex >= line.eventLayers.length) return undefined;
  const [removed] = line.eventLayers.splice(layerIndex, 1);
  return removed;
}

/**
 * Remove an extended event (incline, scaleX, scaleY, color, text, gif) by type and index.
 *
 * @param chart - The RPE chart (modified in place).
 * @param lineIndex - Index of the target line.
 * @param type - Extended event type.
 * @param eventIndex - Index of the event to remove.
 * @returns The removed event, or `undefined`.
 */
export function removeExtendedEvent(
  chart: RpeJson,
  lineIndex: number,
  type: "incline" | "scaleX" | "scaleY" | "color" | "text" | "gif",
  eventIndex: number
): unknown | undefined {
  const line = chart.judgeLineList[lineIndex];
  if (!line) throw new Error(`Line index ${lineIndex} out of range`);
  if (!line.extended) return undefined;
  const key = `${type}Events` as keyof typeof line.extended;
  const arr = line.extended[key] as unknown[] | undefined;
  if (!arr || eventIndex < 0 || eventIndex >= arr.length) return undefined;
  const [removed] = arr.splice(eventIndex, 1);
  return removed;
}

// ─── BPM Manipulation ───────────────────────────────────────────────────────

/**
 * Add a BPM change to the chart's BPM list.
 *
 * Inserts a new BPM entry at `beat`, then re-sorts and re-initializes the
 * entire list so all `startTimeSec` values are correct.
 *
 * @param chart - The RPE chart (modified in place).
 * @param beat - Beat at which the new BPM takes effect.
 * @param bpm - New BPM value (must be > 0).
 * @returns The chart (for chaining).
 *
 * @example
 * ```ts
 * // Speed up to 160 BPM starting at beat 16
 * addBpmChange(chart, 16, 160);
 * ```
 */
export function addBpmChange(chart: RpeJson, beat: number, bpm: number): RpeJson {
  chart.BPMList.push({
    bpm,
    startTime: fromBeats(beat),
    startBeat: beat,
    startTimeSec: 0, // Will be recomputed by initBpmList
  });
  // Sort and recompute
  chart.BPMList.sort((a, b) => toBeats(a.startTime) - toBeats(b.startTime));
  initBpmList(chart.BPMList);
  return chart;
}

/**
 * Remove a BPM change at the given index.
 *
 * The first entry (index 0, beat 0) cannot be removed — use `setBpm()` to
 * replace the base BPM instead.
 *
 * @param chart - The RPE chart (modified in place).
 * @param index - Index of the BPM entry to remove (must be > 0).
 * @returns The removed BPM entry `{ bpm, startBeat }`, or `undefined` if
 *   `index === 0` or out of range.
 *
 * @example
 * ```ts
 * // Remove the second BPM change (index 1)
 * removeBpmChange(chart, 1);
 * ```
 */
export function removeBpmChange(
  chart: RpeJson,
  index: number
): { bpm: number; startBeat: number } | undefined {
  if (index <= 0 || index >= chart.BPMList.length) return undefined;
  const [removed] = chart.BPMList.splice(index, 1);
  initBpmList(chart.BPMList);
  return removed;
}

/**
 * Set the chart to a single constant BPM by replacing the BPM list.
 *
 * Removes all existing BPM changes and sets a single entry at beat 0.
 * Use `addBpmChange()` afterwards if you need multiple tempo regions.
 *
 * @param chart - The RPE chart (modified in place).
 * @param bpm - BPM value (must be > 0).
 * @returns The chart (for chaining).
 *
 * @example
 * ```ts
 * setBpm(chart, 140); // constant 140 BPM for the whole chart
 * ```
 */
export function setBpm(chart: RpeJson, bpm: number): RpeJson {
  chart.BPMList = [
    {
      bpm,
      startTime: [0, 0, 1] as Beat,
      startBeat: 0,
      startTimeSec: 0,
    },
  ];
  return chart;
}

// ─── Event Layer Helpers ────────────────────────────────────────────────────

/**
 * Create a default event layer with constant initial values.
 *
 * - `alphaEvents`: constant 255 (fully opaque)
 * - `moveXEvents` / `moveYEvents` / `rotateEvents`: constant 0
 * - `speedEvents`: constant 10
 *
 * @returns A fully initialized `EventLayer`.
 */
export function createDefaultEventLayer(): EventLayer {
  const defaultEvent = (): Event => ({
    bezier: 0,
    bezierPoints: [0, 0, 1, 1],
    easingLeft: 0,
    easingRight: 1,
    easingType: 1,
    end: 0,
    endTime: [1, 0, 1] as Beat,
    endBeat: 1,
    linkgroup: 0,
    start: 0,
    startTime: [0, 0, 1] as Beat,
    startBeat: 0,
  });

  return {
    alphaEvents: [{ ...defaultEvent(), start: 255, end: 255 }],
    moveXEvents: [defaultEvent()],
    moveYEvents: [defaultEvent()],
    rotateEvents: [defaultEvent()],
    speedEvents: [{ ...defaultEvent(), start: 10, end: 10 }],
  };
}

/**
 * Add a new empty event layer to a line.
 *
 * All channels in the new layer are initialized to empty arrays (`[]`).
 * Events added to this layer are composed additively on top of layer 0
 * (in most RPE engine versions).
 *
 * @param chart - The RPE chart (modified in place).
 * @param lineIndex - Index of the target line.
 * @returns The index of the newly added event layer.
 *
 * @example
 * ```ts
 * const layer = addEventLayer(chart, 0);
 * addMoveXEvent(chart, 0, layer, 2, 4, 0, 100); // animate on top layer
 * ```
 */
export function addEventLayer(chart: RpeJson, lineIndex: number): number {
  const line = chart.judgeLineList[lineIndex];
  if (!line) throw new Error(`Line index ${lineIndex} out of range`);
  const layer: EventLayer = {
    alphaEvents: [],
    moveXEvents: [],
    moveYEvents: [],
    rotateEvents: [],
    speedEvents: [],
  };
  line.eventLayers.push(layer);
  return line.eventLayers.length - 1;
}

// ─── Shader / Extended Event Helpers ────────────────────────────────────────

/**
 * Add an incline (shear / perspective tilt) event to a line's extended events.
 *
 * The incline value tilts the line's note highway in 3-D perspective. A value
 * of 0 is flat; positive values tilt the far end upward.
 *
 * @param chart - The RPE chart (modified in place).
 * @param lineIndex - Target line.
 * @param startBeat - Start beat.
 * @param endBeat - End beat.
 * @param startValue - Incline angle at `startBeat` (degrees).
 * @param endValue - Incline angle at `endBeat` (degrees).
 * @param easingType - Easing type (default: 1 = linear).
 *
 * @example
 * ```ts
 * // Tilt from 0° to 30° over beats 0–4
 * addInclineEvent(chart, 0, 0, 4, 0, 30);
 * ```
 */
export function addInclineEvent(
  chart: RpeJson,
  lineIndex: number,
  startBeat: number,
  endBeat: number,
  startValue: number,
  endValue: number,
  easingType = 1
): void {
  const line = chart.judgeLineList[lineIndex];
  if (!line) throw new Error(`Line index ${lineIndex} out of range`);
  if (!line.extended) line.extended = {};
  if (!line.extended.inclineEvents) line.extended.inclineEvents = [];

  const event: Event = {
    bezier: 0,
    bezierPoints: [0, 0, 1, 1],
    easingLeft: 0,
    easingRight: 1,
    easingType,
    end: endValue,
    endTime: fromBeats(endBeat),
    endBeat,
    linkgroup: 0,
    start: startValue,
    startTime: fromBeats(startBeat),
    startBeat,
  };
  line.extended.inclineEvents.push(event);
}

/**
 * Add a horizontal scale event to a line's extended events.
 *
 * `scaleX` controls the line's horizontal stretch factor (1 = normal).
 *
 * @param chart - The RPE chart (modified in place).
 * @param lineIndex - Target line.
 * @param startBeat - Start beat.
 * @param endBeat - End beat.
 * @param startValue - Scale X at `startBeat` (1 = no change, 2 = double-wide).
 * @param endValue - Scale X at `endBeat`.
 * @param easingType - Easing type (default: 1 = linear).
 *
 * @example
 * ```ts
 * // Widen the line from normal to 3× in 2 beats
 * addScaleXEvent(chart, 0, 0, 2, 1, 3);
 * ```
 */
export function addScaleXEvent(
  chart: RpeJson,
  lineIndex: number,
  startBeat: number,
  endBeat: number,
  startValue: number,
  endValue: number,
  easingType = 1
): void {
  const line = chart.judgeLineList[lineIndex];
  if (!line) throw new Error(`Line index ${lineIndex} out of range`);
  if (!line.extended) line.extended = {};
  if (!line.extended.scaleXEvents) line.extended.scaleXEvents = [];

  line.extended.scaleXEvents.push({
    bezier: 0,
    bezierPoints: [0, 0, 1, 1],
    easingLeft: 0,
    easingRight: 1,
    easingType,
    end: endValue,
    endTime: fromBeats(endBeat),
    endBeat,
    linkgroup: 0,
    start: startValue,
    startTime: fromBeats(startBeat),
    startBeat,
  });
}

/**
 * Add a vertical scale event to a line's extended events.
 *
 * `scaleY` controls the line's vertical stretch factor (1 = normal).
 *
 * @param chart - The RPE chart (modified in place).
 * @param lineIndex - Target line.
 * @param startBeat - Start beat.
 * @param endBeat - End beat.
 * @param startValue - Scale Y at `startBeat` (1 = no change).
 * @param endValue - Scale Y at `endBeat`.
 * @param easingType - Easing type (default: 1 = linear).
 *
 * @example
 * ```ts
 * // Pulse vertical scale: 1 → 2 → 1 across 2 beats
 * addScaleYEvent(chart, 0, 0, 1, 1, 2);
 * addScaleYEvent(chart, 0, 1, 2, 2, 1);
 * ```
 */
export function addScaleYEvent(
  chart: RpeJson,
  lineIndex: number,
  startBeat: number,
  endBeat: number,
  startValue: number,
  endValue: number,
  easingType = 1
): void {
  const line = chart.judgeLineList[lineIndex];
  if (!line) throw new Error(`Line index ${lineIndex} out of range`);
  if (!line.extended) line.extended = {};
  if (!line.extended.scaleYEvents) line.extended.scaleYEvents = [];

  line.extended.scaleYEvents.push({
    bezier: 0,
    bezierPoints: [0, 0, 1, 1],
    easingLeft: 0,
    easingRight: 1,
    easingType,
    end: endValue,
    endTime: fromBeats(endBeat),
    endBeat,
    linkgroup: 0,
    start: startValue,
    startTime: fromBeats(startBeat),
    startBeat,
  });
}

/**
 * Add a color event to a line's extended events.
 *
 * @param chart - The RPE chart (modified in place).
 * @param lineIndex - Target line.
 * @param startBeat - Start beat.
 * @param endBeat - End beat.
 * @param startColor - Start RGB [r, g, b].
 * @param endColor - End RGB [r, g, b].
 * @param easingType - Easing type (default: 1).
 */
export function addColorEvent(
  chart: RpeJson,
  lineIndex: number,
  startBeat: number,
  endBeat: number,
  startColor: [number, number, number],
  endColor: [number, number, number],
  easingType = 1
): void {
  const line = chart.judgeLineList[lineIndex];
  if (!line) throw new Error(`Line index ${lineIndex} out of range`);
  if (!line.extended) line.extended = {};
  if (!line.extended.colorEvents) line.extended.colorEvents = [];

  const event: ColorEvent = {
    bezier: 0,
    bezierPoints: [0, 0, 1, 1],
    easingLeft: 0,
    easingRight: 1,
    easingType,
    end: endColor,
    endTime: fromBeats(endBeat),
    endBeat,
    linkgroup: 0,
    start: startColor,
    startTime: fromBeats(startBeat),
    startBeat,
  };
  line.extended.colorEvents.push(event);
}

/**
 * Add a text-display event to a line's extended events.
 *
 * The text is rendered on the line at the given beat range. Transitions
 * between different strings are instantaneous (easing is effectively ignored
 * for string interpolation).
 *
 * @param chart - The RPE chart (modified in place).
 * @param lineIndex - Target line.
 * @param startBeat - Beat at which this text becomes active.
 * @param endBeat - Beat at which this text is removed.
 * @param startText - Text string at `startBeat`.
 * @param endText - Text string at `endBeat` (can equal `startText` for a constant value).
 * @param easingType - Easing type (default: 1 = linear; mostly unused for strings).
 *
 * @example
 * ```ts
 * // Show "READY" on a line for beats 0–2
 * addTextEvent(chart, 0, 0, 2, 'READY', 'READY');
 * ```
 */
export function addTextEvent(
  chart: RpeJson,
  lineIndex: number,
  startBeat: number,
  endBeat: number,
  startText: string,
  endText: string,
  easingType = 1
): void {
  const line = chart.judgeLineList[lineIndex];
  if (!line) throw new Error(`Line index ${lineIndex} out of range`);
  if (!line.extended) line.extended = {};
  if (!line.extended.textEvents) line.extended.textEvents = [];

  const event: TextEvent = {
    bezier: 0,
    bezierPoints: [0, 0, 1, 1],
    easingLeft: 0,
    easingRight: 1,
    easingType,
    end: endText,
    endTime: fromBeats(endBeat),
    endBeat,
    linkgroup: 0,
    start: startText,
    startTime: fromBeats(startBeat),
    startBeat,
  };
  line.extended.textEvents.push(event);
}

/**
 * Add a GIF frame-animation event to a line's extended events.
 *
 * Used when the line's texture is an animated GIF; the event controls the
 * current frame index over time.
 *
 * @param chart - The RPE chart (modified in place).
 * @param lineIndex - Target line.
 * @param startBeat - Start beat.
 * @param endBeat - End beat.
 * @param startFrame - Frame index at `startBeat`.
 * @param endFrame - Frame index at `endBeat`.
 * @param easingType - Easing type (default: 1 = linear / step through frames).
 *
 * @example
 * ```ts
 * // Cycle frames 0–15 over 2 beats
 * addGifEvent(chart, 2, 0, 2, 0, 15);
 * ```
 */
export function addGifEvent(
  chart: RpeJson,
  lineIndex: number,
  startBeat: number,
  endBeat: number,
  startFrame: number,
  endFrame: number,
  easingType = 1
): void {
  const line = chart.judgeLineList[lineIndex];
  if (!line) throw new Error(`Line index ${lineIndex} out of range`);
  if (!line.extended) line.extended = {};
  if (!line.extended.gifEvents) line.extended.gifEvents = [];

  const event: GifEvent = {
    easingType,
    end: endFrame,
    endTime: fromBeats(endBeat),
    endBeat,
    linkgroup: 0,
    start: startFrame,
    startTime: fromBeats(startBeat),
    startBeat,
  };
  line.extended.gifEvents.push(event);
}

// ─── Quick Event Helpers (for moveX/Y/rotate/alpha/speed) ───────────────────

/**
 * Add a moveX event to a specific event layer of a line.
 *
 * If the target layer index does not exist, intermediate layers are created
 * automatically.
 *
 * @param chart - Chart (modified in place).
 * @param lineIndex - Line index.
 * @param layerIndex - Event layer index (0 = first layer).
 * @param startBeat - Fractional beat where the event starts.
 * @param endBeat - Fractional beat where the event ends.
 * @param startVal - Line X at `startBeat` (chart space, ±675 is half-screen).
 * @param endVal - Line X at `endBeat`.
 * @param easingType - RPE easing type 1–28 (default: 1 = linear).
 *
 * @example
 * ```ts
 * // Slide from left edge to center with CubicOut over beats 0–4
 * addMoveXEvent(chart, 0, 0, 0, 4, -675, 0, 8);
 * ```
 */
export function addMoveXEvent(
  chart: RpeJson,
  lineIndex: number,
  layerIndex: number,
  startBeat: number,
  endBeat: number,
  startVal: number,
  endVal: number,
  easingType = 1
): void {
  const layer = getOrCreateLayer(chart, lineIndex, layerIndex);
  if (!layer.moveXEvents) layer.moveXEvents = [];
  layer.moveXEvents.push(makeEvent(startBeat, endBeat, startVal, endVal, easingType));
}

/**
 * Add a moveY event to a specific event layer of a line.
 *
 * @param chart - Chart (modified in place).
 * @param lineIndex - Line index.
 * @param layerIndex - Event layer index (0 = first layer).
 * @param startBeat - Fractional beat where the event starts.
 * @param endBeat - Fractional beat where the event ends.
 * @param startVal - Line Y at `startBeat` (chart space, ±450 is half-screen height).
 * @param endVal - Line Y at `endBeat`.
 * @param easingType - RPE easing type 1–28 (default: 1 = linear).
 *
 * @example
 * ```ts
 * // Drop the line from top to center
 * addMoveYEvent(chart, 0, 0, 0, 4, 450, 0, 4);
 * ```
 */
export function addMoveYEvent(
  chart: RpeJson,
  lineIndex: number,
  layerIndex: number,
  startBeat: number,
  endBeat: number,
  startVal: number,
  endVal: number,
  easingType = 1
): void {
  const layer = getOrCreateLayer(chart, lineIndex, layerIndex);
  if (!layer.moveYEvents) layer.moveYEvents = [];
  layer.moveYEvents.push(makeEvent(startBeat, endBeat, startVal, endVal, easingType));
}

/**
 * Add a rotation event to a specific event layer of a line.
 *
 * Rotation values are in **degrees** (clockwise positive in RPE).
 *
 * @param chart - Chart (modified in place).
 * @param lineIndex - Line index.
 * @param layerIndex - Event layer index (0 = first layer).
 * @param startBeat - Fractional beat where the event starts.
 * @param endBeat - Fractional beat where the event ends.
 * @param startVal - Rotation in degrees at `startBeat`.
 * @param endVal - Rotation in degrees at `endBeat`.
 * @param easingType - RPE easing type 1–28 (default: 1 = linear).
 *
 * @example
 * ```ts
 * // Spin 360° over 8 beats
 * addRotateEvent(chart, 0, 0, 0, 8, 0, 360);
 * // Snap to 90° at beat 4 (instant)
 * addRotateEvent(chart, 0, 0, 4, 4, 90, 90);
 * ```
 */
export function addRotateEvent(
  chart: RpeJson,
  lineIndex: number,
  layerIndex: number,
  startBeat: number,
  endBeat: number,
  startVal: number,
  endVal: number,
  easingType = 1
): void {
  const layer = getOrCreateLayer(chart, lineIndex, layerIndex);
  if (!layer.rotateEvents) layer.rotateEvents = [];
  layer.rotateEvents.push(makeEvent(startBeat, endBeat, startVal, endVal, easingType));
}

/**
 * Add an alpha (opacity) event to a specific event layer of a line.
 *
 * Alpha values range from 0 (fully transparent) to 255 (fully opaque).
 *
 * @param chart - Chart (modified in place).
 * @param lineIndex - Line index.
 * @param layerIndex - Event layer index (0 = first layer).
 * @param startBeat - Fractional beat where the event starts.
 * @param endBeat - Fractional beat where the event ends.
 * @param startVal - Opacity at `startBeat` (0–255).
 * @param endVal - Opacity at `endBeat` (0–255).
 * @param easingType - RPE easing type 1–28 (default: 1 = linear).
 *
 * @example
 * ```ts
 * // Fade in over 2 beats
 * addAlphaEvent(chart, 0, 0, 0, 2, 0, 255);
 * // Flash at beat 4 (instant on, immediate off)
 * addAlphaEvent(chart, 0, 0, 4, 6, 255, 255);
 * addAlphaEvent(chart, 0, 0, 6, 6, 0, 0);
 * ```
 */
export function addAlphaEvent(
  chart: RpeJson,
  lineIndex: number,
  layerIndex: number,
  startBeat: number,
  endBeat: number,
  startVal: number,
  endVal: number,
  easingType = 1
): void {
  const layer = getOrCreateLayer(chart, lineIndex, layerIndex);
  if (!layer.alphaEvents) layer.alphaEvents = [];
  layer.alphaEvents.push(makeEvent(startBeat, endBeat, startVal, endVal, easingType));
}

/**
 * Add a speed (note scroll speed) event to a specific event layer of a line.
 *
 * Speed controls how fast notes approach the line. The default is 10.
 * Speed events only accept a constant `easingType` of 1 (linear — they step,
 * not interpolate, in most RPE engine versions).
 *
 * @param chart - Chart (modified in place).
 * @param lineIndex - Line index.
 * @param layerIndex - Event layer index (0 = first layer).
 * @param startBeat - Fractional beat where the speed takes effect.
 * @param endBeat - Fractional beat where this segment ends.
 * @param startVal - Speed at `startBeat`.
 * @param endVal - Speed at `endBeat`.
 * @param easingType - Easing type (default: 1 = linear).
 *
 * @example
 * ```ts
 * // Constant speed 10 for the whole chart
 * addSpeedEvent(chart, 0, 0, 0, 999, 10, 10);
 *
 * // Slow section: speed 5 for beats 8–16
 * addSpeedEvent(chart, 0, 0, 8, 16, 5, 5);
 * ```
 */
export function addSpeedEvent(
  chart: RpeJson,
  lineIndex: number,
  layerIndex: number,
  startBeat: number,
  endBeat: number,
  startVal: number,
  endVal: number,
  easingType = 1
): void {
  const layer = getOrCreateLayer(chart, lineIndex, layerIndex);
  if (!layer.speedEvents) layer.speedEvents = [];
  layer.speedEvents.push({
    easingLeft: 0,
    easingRight: 1,
    easingType,
    end: endVal,
    endTime: fromBeats(endBeat),
    endBeat,
    linkgroup: 0,
    start: startVal,
    startTime: fromBeats(startBeat),
    startBeat,
  });
}

// ─── Chart Pre-processing ────────────────────────────────────────────────────

/**
 * Pre-process a chart in-place: initialize BPM timings, synchronize event
 * beat fields, ensure control node arrays are populated, and validate basic
 * numeric fields.
 *
 * **Call this after loading a chart with `parseChart()` before using any
 * position or iterator functions.** It is safe to call multiple times.
 *
 * Operations performed:
 * 1. Validates `META.RPEVersion`.
 * 2. Calls `initBpmList` to compute `startTimeSec` for every BPM entry.
 * 3. For each line: sets default control nodes, fixes `NaN` fields.
 * 4. For each event layer: normalises bezier params, sorts and syncs beats.
 * 5. For each extended event: sorts and syncs beats.
 * 6. For each note: syncs `startBeat` / `endBeat` from their time tuples.
 *
 * @param chart - The RPE chart to process (mutated in place).
 * @returns The same chart reference.
 *
 * @example
 * ```ts
 * const chart = parseChart(jsonString);
 * preprocess(chart);
 * // Now safe to call getLineState(), getChartStats(), etc.
 * ```
 */
export function preprocess(chart: RpeJson): RpeJson {
  const parseEvents = (events: Event[]) => {
    for (const event of events) {
      if (isNaN(event.easingLeft)) event.easingLeft = 0;
      if (isNaN(event.easingRight)) event.easingRight = 1;
      if (isNaN(event.bezier)) event.bezier = 0;
      if (!Array.isArray(event.bezierPoints) || event.bezierPoints.length !== 4) {
        event.bezierPoints = [0, 0, 1, 1];
      }
    }
    return events;
  };

  if (isNaN(chart.META.RPEVersion)) {
    throw new Error(`Not a valid RPE version: ${chart.META.RPEVersion}`);
  }

  // Initialize BPM list
  initBpmList(chart.BPMList);

  for (let li = 0; li < chart.judgeLineList.length; li++) {
    const line = chart.judgeLineList[li]!;
    if (isNaN(line.bpmfactor)) line.bpmfactor = 1;
    if (isNaN(line.father)) line.father = -1;
    if (isNaN(line.zOrder)) line.zOrder = 0;

    // Ensure default control nodes
    if (!line.alphaControl || line.alphaControl.length < 1) {
      line.alphaControl = [
        { x: 0, alpha: 255, easing: 1 },
        { x: 9999999, alpha: 255, easing: 1 },
      ];
    }
    if (!line.posControl || line.posControl.length < 1) {
      line.posControl = [
        { x: 0, pos: 1, easing: 1 },
        { x: 9999999, pos: 1, easing: 1 },
      ];
    }
    if (!line.sizeControl || line.sizeControl.length < 1) {
      line.sizeControl = [
        { x: 0, size: 1, easing: 1 },
        { x: 9999999, size: 1, easing: 1 },
      ];
    }
    if (!line.skewControl || line.skewControl.length < 1) {
      line.skewControl = [
        { x: 0, skew: 0, easing: 1 },
        { x: 9999999, skew: 0, easing: 1 },
      ];
    }
    if (!line.yControl || line.yControl.length < 1) {
      line.yControl = [
        { x: 0, y: 1, easing: 1 },
        { x: 9999999, y: 1, easing: 1 },
      ];
    }

    // Process layer events
    line.eventLayers.forEach((layer, i) => {
      if (!layer) return;
      if (layer.alphaEvents) {
        parseEvents(layer.alphaEvents);
        processEvents(layer.alphaEvents);
      }
      if (layer.moveXEvents) {
        parseEvents(layer.moveXEvents);
        processEvents(layer.moveXEvents);
      }
      if (layer.moveYEvents) {
        parseEvents(layer.moveYEvents);
        processEvents(layer.moveYEvents);
      }
      if (layer.rotateEvents) {
        parseEvents(layer.rotateEvents);
        processEvents(layer.rotateEvents);
      }
      if (layer.speedEvents) {
        processEvents(layer.speedEvents as any);
      }
    });

    // Process extended events
    if (line.extended) {
      processEvents(line.extended.colorEvents);
      processEvents(line.extended.gifEvents as any);
      processEvents(line.extended.inclineEvents);
      processEvents(line.extended.scaleXEvents);
      processEvents(line.extended.scaleYEvents);
      processEvents(line.extended.textEvents as any);
    }

    // Process control nodes
    processControlNodes(line.alphaControl);
    processControlNodes(line.posControl);
    processControlNodes(line.sizeControl);
    processControlNodes(line.skewControl);
    processControlNodes(line.yControl);

    line.notes?.forEach((note) => {
      note.startBeat = toBeats(note.startTime);
      note.endBeat = toBeats(note.endTime);
    });
  }

  return chart;
}

// ─── Chart Statistics ───────────────────────────────────────────────────────

/** Summary statistics for a chart. */
export interface ChartStats {
  /** Total number of judge lines. */
  lineCount: number;
  /** Total number of notes. */
  totalNotes: number;
  /** Notes by type: { 1: tap, 2: hold, 3: flick, 4: drag }. */
  notesByType: Record<number, number>;
  /** Number of fake notes. */
  fakeNotes: number;
  /** Total BPM changes. */
  bpmChanges: number;
  /** Duration in beats (max note end beat). */
  durationBeats: number;
  /** Duration in seconds (using BPM list). */
  durationSeconds: number;
  /** Average notes per second. */
  notesPerSecond: number;
  /** Peak note density (notes in any 1-second window). */
  peakDensity: number;
}

/**
 * Compute summary statistics for a chart.
 *
 * Iterates all lines and notes once to collect counts, timings, and densities.
 * Calls `initBpmList` internally so you don't need to pre-process the chart.
 *
 * @param chart - The RPE chart.
 * @returns A {@link ChartStats} object.
 *
 * @example
 * ```ts
 * const stats = getChartStats(chart);
 * console.log(`${stats.totalNotes} notes, ${stats.notesPerSecond.toFixed(2)} NPS`);
 * console.log(`Peak density: ${stats.peakDensity} notes/s`);
 * ```
 */
export function getChartStats(chart: RpeJson): ChartStats {
  initBpmList(chart.BPMList);

  let totalNotes = 0;
  let fakeNotes = 0;
  const notesByType: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let maxBeat = 0;
  const noteTimes: number[] = [];

  for (const line of chart.judgeLineList) {
    if (!line.notes) continue;
    for (const note of line.notes) {
      totalNotes++;
      notesByType[note.type] = (notesByType[note.type] ?? 0) + 1;
      if (note.isFake) fakeNotes++;
      const b = toBeats(note.startTime);
      maxBeat = Math.max(maxBeat, b);
      if (note.endTime) {
        maxBeat = Math.max(maxBeat, toBeats(note.endTime));
      }
      if (!note.isFake) {
        noteTimes.push(getTimeSec(chart.BPMList, b));
      }
    }
  }

  const durationSeconds = getTimeSec(chart.BPMList, maxBeat);
  noteTimes.sort((a, b) => a - b);

  // Peak density: sliding 1-second window
  let peakDensity = 0;
  if (noteTimes.length > 0) {
    let windowStart = 0;
    for (let i = 0; i < noteTimes.length; i++) {
      while (noteTimes[i]! - noteTimes[windowStart]! > 1) windowStart++;
      peakDensity = Math.max(peakDensity, i - windowStart + 1);
    }
  }

  return {
    lineCount: chart.judgeLineList.length,
    totalNotes,
    notesByType,
    fakeNotes,
    bpmChanges: chart.BPMList.length,
    durationBeats: maxBeat,
    durationSeconds,
    notesPerSecond: durationSeconds > 0 ? (totalNotes - fakeNotes) / durationSeconds : 0,
    peakDensity,
  };
}

// ─── Chart Validation ───────────────────────────────────────────────────────

/** A validation issue found in the chart. */
export interface ValidationIssue {
  /** Severity: 'error' or 'warning'. */
  severity: "error" | "warning";
  /** Human-readable description. */
  message: string;
  /** Location context (e.g., "Line 3, Note 7"). */
  location?: string;
}

/**
 * Validate an RPE chart for common structural issues.
 *
 * Checks performed:
 * - BPM list is non-empty and all BPM values are positive.
 * - `father` references are in range and not self-referential.
 * - No circular parent chains.
 * - Lines have at least one event layer.
 * - Notes have valid `type` (1–4), `above` (1 or 2), and non-zero hold length.
 *
 * @param chart - The RPE chart.
 * @returns Array of {@link ValidationIssue} objects (empty = no issues).
 *
 * @example
 * ```ts
 * const issues = validateChart(chart);
 * const errors = issues.filter(i => i.severity === 'error');
 * if (errors.length > 0) {
 *   console.error('Chart has errors:', errors);
 * }
 * ```
 */
export function validateChart(chart: RpeJson): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // BPM list
  if (!chart.BPMList || chart.BPMList.length === 0) {
    issues.push({ severity: "error", message: "BPMList is empty" });
  } else {
    for (let i = 0; i < chart.BPMList.length; i++) {
      if (chart.BPMList[i]!.bpm <= 0) {
        issues.push({
          severity: "error",
          message: "BPM value must be positive",
          location: `BPMList[${i}]`,
        });
      }
    }
  }

  // Lines
  for (let li = 0; li < chart.judgeLineList.length; li++) {
    const line = chart.judgeLineList[li]!;

    // Father reference
    if (line.father >= chart.judgeLineList.length) {
      issues.push({
        severity: "error",
        message: `Father index ${line.father} out of range`,
        location: `Line ${li}`,
      });
    }
    if (line.father === li) {
      issues.push({
        severity: "error",
        message: "Line is its own parent (circular reference)",
        location: `Line ${li}`,
      });
    }

    // Event layers
    if (!line.eventLayers || line.eventLayers.length === 0) {
      issues.push({
        severity: "warning",
        message: "No event layers",
        location: `Line ${li}`,
      });
    }

    // Notes
    if (line.notes) {
      for (let ni = 0; ni < line.notes.length; ni++) {
        const note = line.notes[ni]!;
        if (note.type < 1 || note.type > 4) {
          issues.push({
            severity: "error",
            message: `Invalid note type: ${note.type}`,
            location: `Line ${li}, Note ${ni}`,
          });
        }
        if (note.type === 2) {
          const startB = toBeats(note.startTime);
          const endB = toBeats(note.endTime);
          if (endB <= startB) {
            issues.push({
              severity: "warning",
              message: `Hold note has zero or negative length (start=${startB}, end=${endB})`,
              location: `Line ${li}, Note ${ni}`,
            });
          }
        }
        if (note.above !== 1 && note.above !== 2) {
          issues.push({
            severity: "warning",
            message: `Note 'above' should be 1 or 2, got ${note.above}`,
            location: `Line ${li}, Note ${ni}`,
          });
        }
      }
    }
  }

  // Circular parent chains
  for (let li = 0; li < chart.judgeLineList.length; li++) {
    const visited = new Set<number>();
    let current = li;
    while (current >= 0 && current < chart.judgeLineList.length) {
      if (visited.has(current)) {
        issues.push({
          severity: "error",
          message: "Circular parent chain detected",
          location: `Line ${li}`,
        });
        break;
      }
      visited.add(current);
      current = chart.judgeLineList[current]!.father;
    }
  }

  return issues;
}

// ─── Chart Serialization ────────────────────────────────────────────────────

/**
 * Serialize a chart to a JSON string suitable for `chart.json`.
 *
 * @param chart - The RPE chart to serialize.
 * @param pretty - `true` = 2-space indented JSON (default); `false` = compact.
 * @returns JSON string.
 *
 * @example
 * ```ts
 * // Write to disk
 * import { writeFileSync } from 'fs';
 * writeFileSync('chart.json', serializeChart(chart));
 *
 * // Compact form for storage
 * const compact = serializeChart(chart, false);
 * ```
 */
export function serializeChart(chart: RpeJson, pretty = true): string {
  return JSON.stringify(chart, null, pretty ? 2 : undefined);
}

/**
 * Parse a JSON string into an `RpeJson` chart and initialize the chart.
 *
 * Equivalent to `JSON.parse(json)` followed by `preprocess(chart)`.
 *
 * @param json - JSON string (as read from `chart.json`).
 * @returns Parsed and BPM-initialized chart.
 *
 * @example
 * ```ts
 * import { readFileSync } from 'fs';
 * const chart = parseChart(readFileSync('chart.json', 'utf8'));
 * ```
 */
export function parseChart(json: string): RpeJson {
  const chart: RpeJson = JSON.parse(json);
  preprocess(chart);
  return chart;
}

// ─── Chart Transforms ───────────────────────────────────────────────────────

/**
 * Offset the entire chart by a number of beats.
 *
 * Shifts **all** note start/end times and **all** events (standard and
 * extended) in every layer of every line by `beatOffset`. This is useful
 * for inserting an intro or adjusting chart sync.
 *
 * @param chart - The RPE chart (modified in place).
 * @param beatOffset - Beats to shift (positive = push later, negative = pull earlier).
 * @returns The chart (for chaining).
 *
 * @example
 * ```ts
 * // Add 4 beats of silence at the start
 * offsetChart(chart, 4);
 *
 * // Trim 2 beats from the beginning (dangerous if notes exist before beat 2!)
 * offsetChart(chart, -2);
 * ```
 */
export function offsetChart(chart: RpeJson, beatOffset: number): RpeJson {
  for (const line of chart.judgeLineList) {
    // Offset notes
    if (line.notes) {
      for (const note of line.notes) {
        note.startTime = fromBeats(toBeats(note.startTime) + beatOffset);
        note.startBeat = toBeats(note.startTime);
        note.endTime = fromBeats(toBeats(note.endTime) + beatOffset);
        note.endBeat = toBeats(note.endTime);
      }
    }
    // Offset events in all layers
    for (const layer of line.eventLayers) {
      if (!layer) continue;
      const eventArrays = [
        layer.alphaEvents,
        layer.moveXEvents,
        layer.moveYEvents,
        layer.rotateEvents,
      ];
      for (const arr of eventArrays) {
        if (!arr) continue;
        for (const ev of arr) {
          ev.startTime = fromBeats(toBeats(ev.startTime) + beatOffset);
          ev.startBeat = toBeats(ev.startTime);
          ev.endTime = fromBeats(toBeats(ev.endTime) + beatOffset);
          ev.endBeat = toBeats(ev.endTime);
        }
      }
      if (layer.speedEvents) {
        for (const ev of layer.speedEvents) {
          ev.startTime = fromBeats(toBeats(ev.startTime) + beatOffset);
          ev.startBeat = toBeats(ev.startTime);
          ev.endTime = fromBeats(toBeats(ev.endTime) + beatOffset);
          ev.endBeat = toBeats(ev.endTime);
        }
      }
    }
    // Offset extended events
    if (line.extended) {
      const extArrays = [
        line.extended.inclineEvents,
        line.extended.scaleXEvents,
        line.extended.scaleYEvents,
      ] as (Event[] | undefined)[];
      for (const arr of extArrays) {
        if (!arr) continue;
        for (const ev of arr) {
          ev.startTime = fromBeats(toBeats(ev.startTime) + beatOffset);
          ev.startBeat = toBeats(ev.startTime);
          ev.endTime = fromBeats(toBeats(ev.endTime) + beatOffset);
          ev.endBeat = toBeats(ev.endTime);
        }
      }
      if (line.extended.colorEvents) {
        for (const ev of line.extended.colorEvents) {
          ev.startTime = fromBeats(toBeats(ev.startTime) + beatOffset);
          ev.startBeat = toBeats(ev.startTime);
          ev.endTime = fromBeats(toBeats(ev.endTime) + beatOffset);
          ev.endBeat = toBeats(ev.endTime);
        }
      }
      if (line.extended.textEvents) {
        for (const ev of line.extended.textEvents) {
          ev.startTime = fromBeats(toBeats(ev.startTime) + beatOffset);
          ev.startBeat = toBeats(ev.startTime);
          ev.endTime = fromBeats(toBeats(ev.endTime) + beatOffset);
          ev.endBeat = toBeats(ev.endTime);
        }
      }
      if (line.extended.gifEvents) {
        for (const ev of line.extended.gifEvents) {
          ev.startTime = fromBeats(toBeats(ev.startTime) + beatOffset);
          ev.startBeat = toBeats(ev.startTime);
          ev.endTime = fromBeats(toBeats(ev.endTime) + beatOffset);
          ev.endBeat = toBeats(ev.endTime);
        }
      }
    }
  }
  return chart;
}

/**
 * Mirror the entire chart horizontally.
 *
 * Negates every note's `positionX`, every `moveXEvents` start/end value,
 * and every `rotateEvents` start/end value across all lines.
 *
 * @param chart - The RPE chart (modified in place).
 * @returns The chart (for chaining).
 *
 * @example
 * ```ts
 * mirrorChart(chart); // flip the whole chart left↔right
 * ```
 */
export function mirrorChart(chart: RpeJson): RpeJson {
  for (const line of chart.judgeLineList) {
    // Mirror note positions
    if (line.notes) {
      for (const note of line.notes) {
        note.positionX = -note.positionX;
      }
    }
    // Mirror moveX events
    for (const layer of line.eventLayers) {
      if (!layer?.moveXEvents) continue;
      for (const ev of layer.moveXEvents) {
        ev.start = -ev.start;
        ev.end = -ev.end;
      }
    }
    // Mirror rotate events
    for (const layer of line.eventLayers) {
      if (!layer?.rotateEvents) continue;
      for (const ev of layer.rotateEvents) {
        ev.start = -ev.start;
        ev.end = -ev.end;
      }
    }
  }
  return chart;
}

/**
 * Merge another chart's lines (and their notes/events) into this chart.
 *
 * Lines from `source` are deep-cloned and appended to `target.judgeLineList`.
 * `father` references inside the merged lines are offset by the original length
 * of `target.judgeLineList` so they continue pointing to the correct parents.
 *
 * The source chart's metadata and BPM list are **not** merged.
 *
 * @param target - The target chart (modified in place).
 * @param source - The source chart to merge from (not modified).
 * @returns The target chart (for chaining).
 *
 * @example
 * ```ts
 * // Combine a background chart into the main chart
 * mergeCharts(mainChart, bgChart);
 * ```
 */
export function mergeCharts(target: RpeJson, source: RpeJson): RpeJson {
  const offset = target.judgeLineList.length;
  for (const line of source.judgeLineList) {
    const copy: JudgeLine = deepClone(line);
    if (copy.father >= 0) {
      copy.father += offset;
    }
    target.judgeLineList.push(copy);
  }
  return target;
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

/** Get or create an event layer at the given index. */
function getOrCreateLayer(chart: RpeJson, lineIndex: number, layerIndex: number): EventLayer {
  const line = chart.judgeLineList[lineIndex];
  if (!line) throw new Error(`Line index ${lineIndex} out of range`);
  while (line.eventLayers.length <= layerIndex) {
    line.eventLayers.push({});
  }
  return line.eventLayers[layerIndex]!;
}

/** Create a standard Event with given parameters. */
function makeEvent(
  startBeat: number,
  endBeat: number,
  startVal: number,
  endVal: number,
  easingType: number
): Event {
  return {
    bezier: 0,
    bezierPoints: [0, 0, 1, 1],
    easingLeft: 0,
    easingRight: 1,
    easingType,
    end: endVal,
    endTime: fromBeats(endBeat) as Beat,
    endBeat,
    linkgroup: 0,
    start: startVal,
    startTime: fromBeats(startBeat) as Beat,
    startBeat,
  };
}
