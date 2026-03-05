/**
 * Prototype-style chainable wrappers around RPE chart objects.
 *
 * Instead of calling free functions like:
 * ```ts
 * addMoveXEvent(chart, 0, 0, 0, 4, -100, 100);
 * addNote(chart, 0, 2, { type: 1 });
 * ```
 *
 * You can use the wrapper classes for a fluent, self-documenting API:
 * ```ts
 * const line = new LineBuilder(chart, 0);
 * line.moveX(0, 4, -100, 100).rotate(0, 4, 0, 90).addNote(2);
 * ```
 *
 * All wrappers are thin value-objects — they hold a reference to the
 * underlying chart (and target line / note) and delegate to the
 * chart-utils functions. Nothing is copied; changes are made in place.
 *
 * ## Entry points
 * - `ChartBuilder.from(chart)` — wrap an existing chart
 * - `ChartBuilder.empty(bpm?, name?)` — create and wrap a new chart
 * - `new LineBuilder(chart, lineIndex)` — wrap a specific line
 * - `new NoteBuilder(chart, lineIndex, noteIndex)` — wrap a specific note
 *
 * ## Full example
 *
 * ```ts
 * import { ChartBuilder } from './prototype';
 *
 * const chart = ChartBuilder.empty(140, 'Example')
 *   .setCharter('Me')
 *   .setComposer('Artist');
 *
 * // Add two judge lines
 * const main = chart.line({ name: 'Main' });
 * const bg   = chart.line({ name: 'BG', texture: 'bg.png' });
 *
 * // Animate the main line: slide X 0→675 over beats 0Ⅎ4
 * main.moveX(0, 4, 0, 675, 'cubicOut');
 *
 * // Add a tap note at beat 2 and a hold from beat 4–6
 * main.addNote(2, { type: 1 })
 *     .addNote(4, { type: 2, endBeat: 6 });
 *
 * // BPM change at beat 32
 * chart.bpm(32, 160);
 *
 * // Get stats and serialize
 * const stats  = chart.stats();
 * const issues = chart.validate();
 * const json   = chart.serialize();
 * ```
 *
 * @module prototype
 */

import type { RpeJson, JudgeLine, Note, Beat, EventLayer, Extended } from "./types";

import {
  createEmptyChart,
  addLine,
  removeLine,
  duplicateLine,
  addNote,
  addNotes,
  removeNote,
  removeNotes,
  clearNotes,
  addBpmChange,
  removeBpmChange,
  setBpm,
  addEventLayer,
  removeEventLayer,
  addMoveXEvent,
  addMoveYEvent,
  addRotateEvent,
  addAlphaEvent,
  addSpeedEvent,
  addInclineEvent,
  addScaleXEvent,
  addScaleYEvent,
  addColorEvent,
  addTextEvent,
  addGifEvent,
  getChartStats,
  validateChart,
  serializeChart,
  offsetChart,
  mirrorChart,
  mergeCharts,
  createDefaultEventLayer,
  type CreateLineOptions,
  type CreateNoteOptions,
  type ChartStats,
  type ValidationIssue,
} from "./chart-utils";

import { toBeats, fromBeats, initBpmList, getTimeSec } from "./events";
import { noteIterator, lineIterator, eventIterator, NoteIterator, LineIterator, EventIterator } from "./iterators";
import { create } from "domain";

// ─── ChartBuilder ─────────────────────────────────────────────────────────────

/**
 * Fluent wrapper around an `RpeJson` object.
 *
 * All mutating methods return `this` for chaining. Use `.data` to access the
 * underlying raw chart at any time.
 *
 * ### Factory methods
 * - `ChartBuilder.empty(bpm?, name?)` — create a new chart
 * - `ChartBuilder.from(chart)` — wrap an existing `RpeJson`
 *
 * ### Methods summary
 * | Category | Methods |
 * |---|---|
 * | Lines | `.line()`, `.lines()`, `.getLine()`, `.removeLine()`, `.duplicateLine()` |
 * | BPM | `.bpm()`, `.setBpm()`, `.removeBpm()` |
 * | Transforms | `.offset()`, `.mirror()`, `.merge()` |
 * | Metadata | `.setName()`, `.setCharter()`, `.setComposer()`, `.setLevel()`, `.setOffset()`, `.setBackground()`, `.setSong()` |
 * | Iterators | `.notes()`, `.lineIterator()`, `.events()` |
 * | Stats | `.stats()`, `.validate()`, `.serialize()` |
 *
 * @example
 * ```ts
 * const chart = ChartBuilder.empty(120, 'My Chart')
 *   .setCharter('Me')
 *   .bpm(16, 140)      // tempo change at beat 16
 *   .offset(8);        // shift everything 8 beats forward
 *
 * const line = chart.line({ name: 'Main' });
 * line.moveX(0, 4, 0, 675, 'cubicOut').addNote(2);
 *
 * const json = chart.data; // access raw RpeJson
 * ```
 */
export class ChartBuilder {
  /** The underlying chart data. Direct mutations are fine. */
  readonly data: RpeJson;

  constructor(data: RpeJson) {
    this.data = data;
    initBpmList(this.data.BPMList);
  }

  // ── Factory helpers ────────────────────────────────────────────────────────

  /** Wrap an existing chart object. */
  static from(chart: RpeJson): ChartBuilder {
    return new ChartBuilder(chart);
  }

  /**
   * Create a new empty chart and wrap it.
   * @param bpm  - Initial BPM (default: 120).
   * @param name - Chart name (default: 'Untitled').
   */
  static empty(bpm = 120, name = "Untitled"): ChartBuilder {
    return new ChartBuilder(createEmptyChart(bpm, name));
  }

  // ── Lines ──────────────────────────────────────────────────────────────────

  /**
   * Add a new line and return its `LineBuilder`.
   * The `ChartBuilder` is accessible via `lineBuilder.chart`.
   */
  line(options: CreateLineOptions = {}, createDefaultEvents = true): LineBuilder {
    const index = addLine(this.data, options, createDefaultEvents);
    return new LineBuilder(this.data, index);
  }

  /**
   * Get a `LineBuilder` for an existing line at `index`.
   */
  getLine(index: number): LineBuilder {
    if (!this.data.judgeLineList[index]) {
      throw new RangeError(`Line index ${index} is out of range`);
    }
    return new LineBuilder(this.data, index);
  }

  /**
   * Add multiple lines at once, returning an array of `LineBuilder`s.
   */
  lines(
    count: number,
    options: CreateLineOptions | ((i: number) => CreateLineOptions) = {},
    createDefaultEvents = true
  ): LineBuilder[] {
    return Array.from({ length: count }, (_, i) =>
      this.line(typeof options === "function" ? options(i) : options, createDefaultEvents)
    );
  }

  /**
   * Remove a line by index. Updates parent references automatically.
   */
  removeLine(index: number): this {
    removeLine(this.data, index);
    return this;
  }

  /**
   * Remove a BPM change at the given index (cannot remove index 0).
   */
  removeBpm(index: number): this {
    removeBpmChange(this.data, index);
    return this;
  }

  /**
   * Duplicate a line by index and return the new `LineBuilder`.
   */
  duplicateLine(index: number, includeNotes = true): LineBuilder {
    const newIndex = duplicateLine(this.data, index, includeNotes);
    return new LineBuilder(this.data, newIndex);
  }

  // ── BPM ───────────────────────────────────────────────────────────────────

  /**
   * Set the chart to a single constant BPM, replacing all existing BPM entries.
   */
  setBpm(bpm: number): this {
    setBpm(this.data, bpm);
    return this;
  }

  /**
   * Add a BPM change at `beat`.
   */
  bpm(beat: number, bpm: number): this {
    addBpmChange(this.data, beat, bpm);
    return this;
  }

  // ── Transforms ────────────────────────────────────────────────────────────

  /**
   * Offset the entire chart by `beatOffset` beats.
   */
  offset(beatOffset: number): this {
    offsetChart(this.data, beatOffset);
    return this;
  }

  /**
   * Mirror the entire chart horizontally.
   */
  mirror(): this {
    mirrorChart(this.data);
    return this;
  }

  /**
   * Merge all lines from `source` into this chart.
   */
  merge(source: RpeJson | ChartBuilder): this {
    mergeCharts(this.data, source instanceof ChartBuilder ? source.data : source);
    return this;
  }

  // ── Iterators ─────────────────────────────────────────────────────────────

  /** Create a `NoteIterator` pre-scoped to this chart's notes. */
  notes(): NoteIterator {
    return noteIterator();
  }

  /** Create a `LineIterator` pre-scoped to this chart. */
  lineIterator(): LineIterator {
    return lineIterator();
  }

  /** Create an `EventIterator` pre-scoped to this chart. */
  events(): EventIterator {
    return eventIterator();
  }

  // ── Metadata ──────────────────────────────────────────────────────────────

  /** Set the chart name. */
  setName(name: string): this {
    this.data.META.name = name;
    return this;
  }

  /** Set the chart offset (in milliseconds). */
  setOffset(offsetMs: number): this {
    this.data.META.offset = offsetMs;
    return this;
  }

  /** Set the level string (e.g. `'SP Lv.15'`). */
  setLevel(level: string): this {
    this.data.META.level = level;
    return this;
  }

  /** Set the charter (chart author) name. */
  setCharter(charter: string): this {
    this.data.META.charter = charter;
    return this;
  }

  /** Set the composer name. */
  setComposer(composer: string): this {
    this.data.META.composer = composer;
    return this;
  }

  /** Set the background image path. */
  setBackground(background: string): this {
    this.data.META.background = background;
    return this;
  }

  /** Set the song audio file path. */
  setSong(song: string): this {
    this.data.META.song = song;
    return this;
  }

  // ── Statistics / Validation ───────────────────────────────────────────────

  /** Compute summary statistics for the chart. */
  stats(): ChartStats {
    return getChartStats(this.data);
  }

  /** Validate the chart and return any issues found. */
  validate(): ValidationIssue[] {
    return validateChart(this.data);
  }

  // ── Serialization ─────────────────────────────────────────────────────────

  /** Serialize the chart to a JSON string. */
  serialize(pretty = true): string {
    return serializeChart(this.data, pretty);
  }

  /** Number of lines in the chart. */
  get lineCount(): number {
    return this.data.judgeLineList.length;
  }

  /** Get the judge line object at `index` directly. */
  rawLine(index: number): JudgeLine {
    const line = this.data.judgeLineList[index];
    if (!line) throw new RangeError(`Line index ${index} is out of range`);
    return line;
  }

  // ── Alias methods (match free-function naming) ─────────────────────────────

  /**
   * Add a new line and return its `LineBuilder`.
   * Alias for `.line()`.
   */
  addLine(options: CreateLineOptions = {}, createDefaultEvents = true): LineBuilder {
    return this.line(options, createDefaultEvents);
  }

  /**
   * Add a BPM change at `beat`.
   * Alias for `.bpm(beat, bpm)`.
   */
  addBpmChange(beat: number, bpm: number): this {
    return this.bpm(beat, bpm);
  }
}

// ─── LineBuilder ─────────────────────────────────────────────────────────────

/**
 * Fluent wrapper around a single `JudgeLine`.
 *
 * Exposes methods for adding notes, events (by channel), and event layers.
 * All mutating methods return `this` for chaining unless prefixed with `get` /
 * `new`, which return more specific builders.
 *
 * ### Event methods
 * `.moveX()`, `.moveY()`, `.rotate()`, `.alpha()`, `.speed()`,
 * `.incline()`, `.scaleX()`, `.scaleY()`, `.colorEvent()`, `.textEvent()`, `.gifEvent()`
 *
 * ### Note methods
 * `.addNote()`, `.addNotes()`, `.removeNote()`, `.clearNotes()`
 *
 * ### Misc
 * `.setName()`, `.setParent()`, `.setZOrder()`, `.addLayer()`,
 * `.notes()` (NoteIterator), `.events()` (EventIterator)
 *
 * @example
 * ```ts
 * const lb = new LineBuilder(chart, 0);
 *
 * // Animate the line and add notes
 * lb.moveX(0, 4, 0, 675, 'cubicOut')
 *   .rotate(0, 4, 0, 90, 'sineInOut')
 *   .alpha(0, 1, 0, 255)
 *   .addNote(2, { type: 1 })
 *   .addNote(3, { type: 3 });
 *
 * // Color transition: white → red over beats 4–8
 * lb.colorEvent(4, 8, [255, 255, 255], [255, 0, 0]);
 *
 * // Attach a text overlay
 * lb.textEvent(0, 4, 'Hello', 'World');
 * ```
 */
export class LineBuilder {
  /** Reference to the parent chart. */
  readonly chart: RpeJson;
  /** Index of this line in `chart.judgeLineList`. */
  readonly index: number;

  constructor(chart: RpeJson, lineIndex: number) {
    if (!chart.judgeLineList[lineIndex]) {
      throw new RangeError(`Line index ${lineIndex} is out of range`);
    }
    this.chart = chart;
    this.index = lineIndex;
  }

  /** The raw `JudgeLine` data. */
  get data(): JudgeLine {
    return this.chart.judgeLineList[this.index]!;
  }

  // ── Identity / Metadata ───────────────────────────────────────────────────

  /** Set this line's name. */
  setName(name: string): this {
    this.data.Name = name;
    return this;
  }

  /** Set this line's texture. */
  setTexture(texture: string): this {
    this.data.Texture = texture;
    return this;
  }

  /** Set this line's group index. */
  setGroup(group: number): this {
    this.data.Group = group;
    return this;
  }

  /** Set the Z-order for rendering. */
  setZOrder(z: number): this {
    this.data.zOrder = z;
    return this;
  }

  /** Set whether this line is a cover. */
  setCover(cover: 0 | 1): this {
    this.data.isCover = cover;
    return this;
  }

  /** Set BPM factor. */
  setBpmFactor(factor: number): this {
    this.data.bpmfactor = factor;
    return this;
  }

  /** Set the parent line index (-1 for no parent). */
  setParent(parentIndex: number): this {
    this.data.father = parentIndex;
    return this;
  }

  /** Set rotateWithFather. */
  setRotateWithFather(value: boolean): this {
    this.data.rotateWithFather = value;
    return this;
  }

  /** Set anchor. */
  setAnchor(x: number, y: number): this {
    this.data.anchor = [x, y];
    return this;
  }

  // ── Notes ─────────────────────────────────────────────────────────────────

  /**
   * Add a note at `beat`.
   *
   * @param beat    - Start beat.
   * @param options - Note creation options.
   */
  addNote(beat: number, options: CreateNoteOptions = {}): this {
    const noteIndex = addNote(this.chart, this.index, beat, options);
    return this;
  }

  /**
   * Add multiple notes at once.
   *
   * @param beats         - Array of beats or `[beat, options]` tuples.
   * @param sharedOptions - Options applied to all notes.
   * @returns `this` for chaining.
   */
  addNotes(beats: (number | [number, CreateNoteOptions])[], sharedOptions: CreateNoteOptions = {}): this {
    addNotes(this.chart, this.index, beats, sharedOptions);
    return this;
  }

  /**
   * Get a `NoteBuilder` wrapping the note at `noteIndex`.
   */
  getNote(noteIndex: number): NoteBuilder {
    return new NoteBuilder(this.chart, this.index, noteIndex);
  }

  /**
   * Remove a note at `noteIndex` from this line.
   * @returns The removed `Note`, or `undefined`.
   */
  removeNote(noteIndex: number): Note | undefined {
    return removeNote(this.chart, this.index, noteIndex);
  }

  /**
   * Remove all notes matching a predicate.
   * @returns Array of removed notes.
   */
  removeNotes(predicate: (note: Note, index: number) => boolean): Note[] {
    return removeNotes(this.chart, this.index, predicate);
  }

  /**
   * Remove all notes from this line.
   * @returns Array of removed notes.
   */
  clearNotes(): Note[] {
    return clearNotes(this.chart, this.index);
  }

  /** Iterate all notes on this line via a `NoteIterator`. */
  noteIterator(): NoteIterator {
    return noteIterator().onLineIndices(this.index);
  }

  // ── Event Layers ──────────────────────────────────────────────────────────

  /**
   * Add a new empty event layer and return its `EventLayerBuilder`.
   */
  addLayer(): EventLayerBuilder {
    const layerIndex = addEventLayer(this.chart, this.index);
    return new EventLayerBuilder(this.chart, this.index, layerIndex);
  }

  /**
   * Get an `EventLayerBuilder` for an existing event layer.
   */
  getLayer(layerIndex = 0): EventLayerBuilder {
    return new EventLayerBuilder(this.chart, this.index, layerIndex);
  }

  /**
   * Remove an event layer by index.
   * @returns The removed EventLayer, or `undefined`.
   */
  removeLayer(layerIndex: number): EventLayer | null | undefined {
    return removeEventLayer(this.chart, this.index, layerIndex);
  }

  // ── Convenience: Layer-0 events ───────────────────────────────────────────

  /**
   * Add a moveX event on layer 0.
   *
   * @param startBeat - Start beat.
   * @param endBeat   - End beat.
   * @param from      - Start X value.
   * @param to        - End X value.
   * @param easing    - Easing type (default: 1 = linear).
   * @param index     - Layer index (default: 0).
   */
  moveX(startBeat: number, endBeat: number, from: number, to: number, easing = 1, index = 0): this {
    addMoveXEvent(this.chart, this.index, index, startBeat, endBeat, from, to, easing);
    return this;
  }

  /**
   * Add a moveY event on layer 0.
   */
  moveY(startBeat: number, endBeat: number, from: number, to: number, easing = 1, index = 0): this {
    addMoveYEvent(this.chart, this.index, index, startBeat, endBeat, from, to, easing);
    return this;
  }

  /**
   * Add a rotate event on layer 0.
   */
  rotate(startBeat: number, endBeat: number, from: number, to: number, easing = 1, index = 0): this {
    addRotateEvent(this.chart, this.index, index, startBeat, endBeat, from, to, easing);
    return this;
  }

  /**
   * Add an alpha event on layer 0.
   */
  alpha(startBeat: number, endBeat: number, from: number, to: number, easing = 1, index = 0): this {
    addAlphaEvent(this.chart, this.index, index, startBeat, endBeat, from, to, easing);
    return this;
  }

  /**
   * Add a speed event on layer 0.
   */
  speed(startBeat: number, endBeat: number, from: number, to: number, easing = 1, index = 0): this {
    addSpeedEvent(this.chart, this.index, index, startBeat, endBeat, from, to, easing);
    return this;
  }

  // ── Extended Events ───────────────────────────────────────────────────────

  /** Add an incline event. */
  incline(startBeat: number, endBeat: number, from: number, to: number, easing = 1): this {
    addInclineEvent(this.chart, this.index, startBeat, endBeat, from, to, easing);
    return this;
  }

  /** Add a scaleX event. */
  scaleX(startBeat: number, endBeat: number, from: number, to: number, easing = 1): this {
    addScaleXEvent(this.chart, this.index, startBeat, endBeat, from, to, easing);
    return this;
  }

  /** Add a scaleY event. */
  scaleY(startBeat: number, endBeat: number, from: number, to: number, easing = 1): this {
    addScaleYEvent(this.chart, this.index, startBeat, endBeat, from, to, easing);
    return this;
  }

  /**
   * Add a color event.
   * @param startColor - `[r, g, b]` at start.
   * @param endColor   - `[r, g, b]` at end.
   */
  color(
    startBeat: number,
    endBeat: number,
    startColor: [number, number, number],
    endColor: [number, number, number],
    easing = 1
  ): this {
    addColorEvent(this.chart, this.index, startBeat, endBeat, startColor, endColor, easing);
    return this;
  }

  /** Add a text event. */
  text(startBeat: number, endBeat: number, startText: string, endText: string, easing = 1): this {
    addTextEvent(this.chart, this.index, startBeat, endBeat, startText, endText, easing);
    return this;
  }

  /** Add a GIF frame event. */
  gif(startBeat: number, endBeat: number, startFrame: number, endFrame: number, easing = 1): this {
    addGifEvent(this.chart, this.index, startBeat, endBeat, startFrame, endFrame, easing);
    return this;
  }

  // ── Snapshot / Chain Back ─────────────────────────────────────────────────

  /**
   * Return a `ChartBuilder` wrapping the same chart (for switching back to
   * chart-level operations).
   */
  toChart(): ChartBuilder {
    return new ChartBuilder(this.chart);
  }

  /** Number of notes on this line. */
  get noteCount(): number {
    return this.data.notes?.length ?? 0;
  }
}

// ─── EventLayerBuilder ────────────────────────────────────────────────────────

/**
 * Fluent wrapper around a single `EventLayer` within a line.
 *
 * @example
 * ```ts
 * new LineBuilder(chart, 0)
 *   .addLayer()   // EventLayerBuilder for layer 1
 *   .moveX(0, 8, 0, 50)
 *   .rotate(0, 8, 0, 360, 4);
 * ```
 */
export class EventLayerBuilder {
  readonly chart: RpeJson;
  readonly lineIndex: number;
  readonly layerIndex: number;

  constructor(chart: RpeJson, lineIndex: number, layerIndex: number) {
    this.chart = chart;
    this.lineIndex = lineIndex;
    this.layerIndex = layerIndex;
  }

  /** The raw `JudgeLine` for this layer's line. */
  get line(): JudgeLine {
    return this.chart.judgeLineList[this.lineIndex]!;
  }

  /** The raw `EventLayer` object. */
  get data(): EventLayer {
    const layer = this.line.eventLayers[this.layerIndex];
    if (!layer) throw new RangeError(`Layer ${this.layerIndex} does not exist`);
    return layer;
  }

  // ── Events ────────────────────────────────────────────────────────────────

  /** Add a moveX event on this layer. */
  moveX(startBeat: number, endBeat: number, from: number, to: number, easing = 1): this {
    addMoveXEvent(this.chart, this.lineIndex, this.layerIndex, startBeat, endBeat, from, to, easing);
    return this;
  }

  /** Add a moveY event on this layer. */
  moveY(startBeat: number, endBeat: number, from: number, to: number, easing = 1): this {
    addMoveYEvent(this.chart, this.lineIndex, this.layerIndex, startBeat, endBeat, from, to, easing);
    return this;
  }

  /** Add a rotate event on this layer. */
  rotate(startBeat: number, endBeat: number, from: number, to: number, easing = 1): this {
    addRotateEvent(this.chart, this.lineIndex, this.layerIndex, startBeat, endBeat, from, to, easing);
    return this;
  }

  /** Add an alpha event on this layer. */
  alpha(startBeat: number, endBeat: number, from: number, to: number, easing = 1): this {
    addAlphaEvent(this.chart, this.lineIndex, this.layerIndex, startBeat, endBeat, from, to, easing);
    return this;
  }

  /** Add a speed event on this layer. */
  speed(startBeat: number, endBeat: number, from: number, to: number, easing = 1): this {
    addSpeedEvent(this.chart, this.lineIndex, this.layerIndex, startBeat, endBeat, from, to, easing);
    return this;
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  /** Return the `LineBuilder` for this layer's line. */
  toLine(): LineBuilder {
    return new LineBuilder(this.chart, this.lineIndex);
  }

  /** Return the `ChartBuilder`. */
  toChart(): ChartBuilder {
    return new ChartBuilder(this.chart);
  }
}

// ─── NoteBuilder ─────────────────────────────────────────────────────────────

/**
 * Fluent wrapper around a single `Note`.
 *
 * Provides property setters that return `this` for chaining and a
 * `.toLine()` method to navigate back to the containing line.
 *
 * @example
 * ```ts
 * new NoteBuilder(chart, 0, 0)
 *   .setX(50)
 *   .setSpeed(1.5)
 *   .setTint([255, 128, 0])
 *   .setAlpha(200);
 * ```
 */
export class NoteBuilder {
  readonly chart: RpeJson;
  readonly lineIndex: number;
  readonly noteIndex: number;

  constructor(chart: RpeJson, lineIndex: number, noteIndex: number) {
    const line = chart.judgeLineList[lineIndex];
    if (!line) throw new RangeError(`Line index ${lineIndex} is out of range`);
    if (!line.notes || !line.notes[noteIndex]) {
      throw new RangeError(`Note index ${noteIndex} is out of range on line ${lineIndex}`);
    }
    this.chart = chart;
    this.lineIndex = lineIndex;
    this.noteIndex = noteIndex;
  }

  /** The raw `Note` object. Mutations are applied to the chart directly. */
  get data(): Note {
    return this.chart.judgeLineList[this.lineIndex]!.notes![this.noteIndex]!;
  }

  // ── Setters ───────────────────────────────────────────────────────────────

  /** Set note type (1=Tap, 2=Hold, 3=Flick, 4=Drag). */
  setType(type: 1 | 2 | 3 | 4): this {
    this.data.type = type;
    return this;
  }

  /** Set the X position. */
  setX(x: number): this {
    this.data.positionX = x;
    return this;
  }

  /**
   * Translate the X position by `dx`.
   */
  moveX(dx: number): this {
    this.data.positionX += dx;
    return this;
  }

  /** Mirror the X position. */
  mirrorX(): this {
    this.data.positionX = -this.data.positionX;
    return this;
  }

  /** Set which side of the line the note is on (1 = above, 2 = below). */
  setSide(side: 1 | 2): this {
    this.data.above = side;
    return this;
  }

  /** Flip the note to the other side. */
  flipSide(): this {
    this.data.above = this.data.above === 1 ? 2 : 1;
    return this;
  }

  /** Set the note speed multiplier. */
  setSpeed(speed: number): this {
    this.data.speed = speed;
    return this;
  }

  /** Scale the note speed by a factor. */
  scaleSpeed(factor: number): this {
    this.data.speed *= factor;
    return this;
  }

  /** Set the visual size multiplier. */
  setSize(size: number): this {
    this.data.size = size;
    return this;
  }

  /** Scale the note size by a factor. */
  scaleSize(factor: number): this {
    this.data.size *= factor;
    return this;
  }

  /** Set the opacity (0–255). */
  setAlpha(alpha: number): this {
    this.data.alpha = alpha;
    return this;
  }

  /** Set whether the note is fake (non-scoring). */
  setFake(fake: boolean): this {
    this.data.isFake = fake ? 1 : 0;
    return this;
  }

  /** Set the Y offset. */
  setYOffset(y: number): this {
    this.data.yOffset = y;
    return this;
  }

  /** Set the judge area multiplier. */
  setJudgeArea(size: number): this {
    this.data.judgeArea = size;
    return this;
  }

  /** Set the visible time (beats before hit that the note appears). */
  setVisibleTime(time: number): this {
    this.data.visibleTime = time;
    return this;
  }

  /** Set a custom hitsound. */
  setHitsound(hitsound: string): this {
    this.data.hitsound = hitsound;
    return this;
  }

  /** Set the tint color `[r, g, b]` or `null` to clear. */
  setTint(color: [number, number, number] | null): this {
    this.data.tint = color;
    return this;
  }

  /** Set the hit-effects tint color `[r, g, b]` or `null` to clear. */
  setTintHitEffects(color: [number, number, number] | null): this {
    this.data.tintHitEffects = color;
    return this;
  }

  /**
   * Move the note's start beat by `beatOffset`.
   * For hold notes, the end beat is also shifted by the same amount.
   */
  offsetBeat(beatOffset: number): this {
    const newStart = toBeats(this.data.startTime) + beatOffset;
    this.data.startTime = fromBeats(newStart);
    this.data.startBeat = newStart;
    if (this.data.type === 2) {
      const newEnd = toBeats(this.data.endTime) + beatOffset;
      this.data.endTime = fromBeats(newEnd);
      this.data.endBeat = newEnd;
    }
    return this;
  }

  /**
   * Set the hold duration in beats (only meaningful for type-2 hold notes).
   * The end beat is calculated as `startBeat + duration`.
   */
  setHoldDuration(durationBeats: number): this {
    const endBeat = this.data.startBeat + durationBeats;
    this.data.endTime = fromBeats(endBeat);
    this.data.endBeat = endBeat;
    return this;
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  /**
   * Remove this note from its line.
   * After calling this, the builder is invalidated — do not call further methods.
   * @returns The removed `Note` data.
   */
  remove(): Note | undefined {
    return removeNote(this.chart, this.lineIndex, this.noteIndex);
  }

  /** Navigate back to the containing `LineBuilder`. */
  toLine(): LineBuilder {
    return new LineBuilder(this.chart, this.lineIndex);
  }

  /** Navigate back to a `ChartBuilder`. */
  toChart(): ChartBuilder {
    return new ChartBuilder(this.chart);
  }
}

// ─── Re-export iterators for convenience ────────────────────────────────────────────────

export { noteIterator, lineIterator, eventIterator, NoteIterator, LineIterator, EventIterator };

// ─── Convenience factories ───────────────────────────────────────────────────────────

/**
 * Wrap an existing `RpeJson` object as a `ChartBuilder` for fluent editing.
 *
 * This is the entry point when you load a chart from a file:
 * ```ts
 * const raw = JSON.parse(readFileSync('chart.json', 'utf8'));
 * const chart = wrap(raw);
 * chart.addLine({ name: 'FX' }).moveX(0, 4, -675, 675);
 * ```
 */
export function wrap(chart: RpeJson): ChartBuilder {
  return ChartBuilder.from(chart);
}

/**
 * Create a new empty chart as a `ChartBuilder`.
 *
 * Shorthand for `ChartBuilder.empty(bpm, name)`.
 *
 * ```ts
 * const chart = createChart(140, 'My Song');
 * chart.addLine({ name: 'Main' }).addNote(2);
 * ```
 */
export function createChart(bpm = 120, name = "Untitled"): ChartBuilder {
  return ChartBuilder.empty(bpm, name);
}
