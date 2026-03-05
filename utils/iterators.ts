/**
 * Fluent iterator system for RPE charts.
 *
 * Provides `NoteIterator`, `LineIterator`, and `EventIterator` — chainable
 * builder objects that let you filter and transform chart objects without
 * writing manual for-loops.
 *
 * Also exports predicate helpers (`between`, `before`, `after`,
 * `approximately`, `any`, `all`) and common note-mod utilities.
 *
 * ## Quick-start examples
 *
 * ```ts
 * import { noteIterator, lineIterator, eventIterator, NoteType } from './iterators';
 *
 * // 1. Flip all Tap notes' X positions in beats 0–16
 * noteIterator()
 *   .between(0, 16)
 *   .onlyTaps()
 *   .mirrorX()
 *   .run(chart);
 *
 * // 2. Hide all fake notes throughout the chart
 * noteIterator()
 *   .filterFake(true)
 *   .process(n => { n.alpha = 0; })
 *   .run(chart);
 *
 * // 3. Double the speed of all notes on line 3
 * noteIterator()
 *   .onLineIndices(3)
 *   .scaleSpeed(2)
 *   .run(chart);
 *
 * // 4. Find lines named 'BG' and set their zOrder to -1
 * lineIterator()
 *   .named('BG')
 *   .process(line => { line.zOrder = -1; })
 *   .run(chart);
 *
 * // 5. Negate all moveX event values in beat layer 0 across the whole chart
 * eventIterator()
 *   .channel('moveX')
 *   .process(ev => { ev.start = -ev.start; ev.end = -ev.end; })
 *   .run(chart);
 *
 * // 6. Combine predicates with any() / all()
 * import { between, any, NoteType } from './iterators';
 * noteIterator()
 *   .addCondition(any(between(0, 8), between(16, 24)))
 *   .onlyType(NoteType.Hold, NoteType.Flick)
 *   .scaleSize(1.2)
 *   .run(chart);
 * ```
 *
 * @module iterators
 */

import type { RpeJson, JudgeLine, Note, Event, SpeedEvent, EventLayer } from "./types";
import { toBeats, fromBeats, getTimeSec, initBpmList } from "./events";

// ─── Predicate Types ─────────────────────────────────────────────────────────

/** A predicate function on a Note. */
export type NotePredicate = (
  note: Note,
  line: JudgeLine,
  chart: RpeJson,
  noteIndex: number,
  lineIndex: number
) => boolean;

/** A process function on a Note. */
export type NoteProcess = (note: Note, line: JudgeLine, chart: RpeJson, noteIndex: number, lineIndex: number) => void;

/** A predicate function on a JudgeLine. */
export type LinePredicate = (line: JudgeLine, index: number, chart: RpeJson) => boolean;

/** A process function on a JudgeLine. */
export type LineProcess = (line: JudgeLine, index: number, chart: RpeJson) => void;

/** A predicate function on a plain Event. */
export type EventPredicate = (
  event: Event,
  type: EventChannelType,
  layerIndex: number,
  line: JudgeLine,
  chart: RpeJson
) => boolean;

/** A process function on a plain Event. */
export type EventProcess = (
  event: Event,
  type: EventChannelType,
  layerIndex: number,
  line: JudgeLine,
  chart: RpeJson
) => void;

/** Identifies which event channel an event belongs to. */
export type EventChannelType = "moveX" | "moveY" | "rotate" | "alpha" | "speed" | "incline" | "scaleX" | "scaleY";

// ─── Predicate Combinators ───────────────────────────────────────────────────

/**
 * Returns a predicate that passes when the note's start beat is `>= start`
 * and `< end`.
 *
 * @param start - Inclusive lower beat bound.
 * @param end   - Exclusive upper beat bound.
 *
 * @example
 * ```ts
 * // Only process notes in the first verse (beats 0–32)
 * noteIterator().addCondition(between(0, 32));
 * // Or use the shorthand method:
 * noteIterator().between(0, 32);
 * ```
 */
export function between(start: number, end: number): NotePredicate {
  return (note) => {
    const b = toBeats(note.startTime);
    return b >= start && b < end;
  };
}

/**
 * Returns a predicate that passes when the note's start beat is strictly
 * less than `beat`.
 */
export function before(beat: number): NotePredicate {
  return (note) => toBeats(note.startTime) < beat;
}

/**
 * Returns a predicate that passes when the note's start beat is strictly
 * greater than `beat`.
 */
export function after(beat: number): NotePredicate {
  return (note) => toBeats(note.startTime) > beat;
}

/**
 * Returns a predicate that passes when the note's start beat is within
 * `epsilon` beats of `beat` (default ε = 0.01).
 *
 * Useful for selecting notes at a specific musical position without
 * needing exact beat-tuple equality.
 *
 * @example
 * ```ts
 * // Select notes that land on beat 4 (±0.01)
 * noteIterator().approximately(4).setSpeed(2).run(chart);
 * ```
 */
export function approximately(beat: number, epsilon = 0.01): NotePredicate {
  return (note) => Math.abs(toBeats(note.startTime) - beat) <= epsilon;
}

/**
 * Returns a predicate that passes when **at least one** of the supplied
 * predicates returns `true` (logical OR).
 *
 * @example
 * ```ts
 * import { between, any } from './iterators';
 * // Affect notes in beat range 0–8 OR 16–24
 * noteIterator().addCondition(any(between(0, 8), between(16, 24)));
 * ```
 */
export function any(...predicates: NotePredicate[]): NotePredicate {
  return (note, line, chart, noteIndex, lineIndex) =>
    predicates.some((p) => p(note, line, chart, noteIndex, lineIndex));
}

/**
 * Returns a predicate that passes only when **all** supplied predicates
 * return `true` (logical AND).
 *
 * @example
 * ```ts
 * import { between, all } from './iterators';
 * // Only real notes between beats 8 and 16
 * noteIterator().addCondition(all(between(8, 16), (n) => n.isFake === 0));
 * ```
 */
export function all(...predicates: NotePredicate[]): NotePredicate {
  return (note, line, chart, noteIndex, lineIndex) =>
    predicates.every((p) => p(note, line, chart, noteIndex, lineIndex));
}

// ─── Note Type Constants ─────────────────────────────────────────────────────

/** RPE note type codes.
 * @example
 * ```ts
 * noteIterator().onlyType(NoteType.Hold, NoteType.Drag);
 * ```
 */
export const NoteType = {
  Tap: 1,
  Hold: 2,
  Flick: 3,
  Drag: 4,
} as const;

export type NoteTypeValue = (typeof NoteType)[keyof typeof NoteType];

// ─── NoteIterator ────────────────────────────────────────────────────────────

/**
 * Fluent iterator that filters and transforms notes in an RPE chart.
 *
 * Conditions (filters) are AND-ed together. All registered process
 * functions are run on every note that passes all conditions.
 *
 * Call `.run(chart)` to execute. Call `.collect(chart)` to get an array
 * of matching notes without mutating them.
 *
 * ### Filter methods
 * `.between()`, `.before()`, `.after()`, `.approximately()`, `.onlyType()`,
 * `.onlyTaps()`, `.onlyHolds()`, `.onlyFlicks()`, `.onlyDrags()`,
 * `.realOnly()`, `.filterFake()`, `.betweenX()`, `.onLines()`, `.onLineIndices()`,
 * `.onLineNamed()`, `.onSide()`, `.withSpeed()`
 *
 * ### Mutation methods
 * `.setSpeed()`, `.scaleSpeed()`, `.setX()`, `.moveX()`, `.mirrorX()`,
 * `.setAlpha()`, `.setSize()`, `.scaleSize()`, `.setYOffset()`, `.setFake()`,
 * `.setVisibleTime()`, `.setTint()`
 *
 * @example
 * ```ts
 * // Speed up the tail of the chart
 * noteIterator()
 *   .after(64)
 *   .realOnly()
 *   .scaleSpeed(1.5)
 *   .run(chart);
 *
 * // Collect all holds for inspection
 * const holds = noteIterator().onlyHolds().collect(chart);
 * ```
 */
export class NoteIterator {
  private _conditions: NotePredicate[] = [];
  private _processes: NoteProcess[] = [];
  private _typeFilter: NoteTypeValue[] | null = null;
  private _lineFilter: ((line: JudgeLine, index: number) => boolean) | null = null;
  private _includeFake = true;

  // ── Condition API ──────────────────────────────────────────────────────────

  /** Add an arbitrary predicate condition. */
  addCondition(predicate: NotePredicate): this {
    this._conditions.push(predicate);
    return this;
  }

  /**
   * Only process notes whose start beat is in [`start`, `end`).
   */
  between(start: number, end: number): this {
    return this.addCondition(between(start, end));
  }

  /**
   * Only process notes whose start beat is strictly before `beat`.
   */
  before(beat: number): this {
    return this.addCondition(before(beat));
  }

  /**
   * Only process notes whose start beat is strictly after `beat`.
   */
  after(beat: number): this {
    return this.addCondition(after(beat));
  }

  /**
   * Only process notes at approximately `beat` (within `epsilon`).
   */
  approximately(beat: number, epsilon = 0.01): this {
    return this.addCondition(approximately(beat, epsilon));
  }

  /**
   * Only process notes of the given type(s).
   * @param types - One or more NoteType values (1=Tap, 2=Hold, 3=Flick, 4=Drag).
   */
  onlyType(...types: NoteTypeValue[]): this {
    this._typeFilter = types;
    return this;
  }

  /** Shorthand: only Tap notes. */
  onlyTaps(): this {
    return this.onlyType(NoteType.Tap);
  }

  /** Shorthand: only Hold notes. */
  onlyHolds(): this {
    return this.onlyType(NoteType.Hold);
  }

  /** Shorthand: only Flick notes. */
  onlyFlicks(): this {
    return this.onlyType(NoteType.Flick);
  }

  /** Shorthand: only Drag notes. */
  onlyDrags(): this {
    return this.onlyType(NoteType.Drag);
  }

  /**
   * Control whether fake notes are included (default: true).
   */
  filterFake(includeFake: boolean): this {
    this._includeFake = includeFake;
    return this;
  }

  /** Exclude fake notes from processing. */
  realOnly(): this {
    return this.filterFake(false);
  }

  /**
   * Only process notes whose positionX is in [`minX`, `maxX`].
   */
  betweenX(minX: number, maxX: number): this {
    return this.addCondition((note) => note.positionX >= minX && note.positionX <= maxX);
  }

  /**
   * Only process notes on lines matching a predicate.
   */
  onLines(predicate: (line: JudgeLine, index: number) => boolean): this {
    this._lineFilter = predicate;
    return this;
  }

  /**
   * Only process notes on the given line indices.
   */
  onLineIndices(...indices: number[]): this {
    const set = new Set(indices);
    return this.onLines((_line, i) => set.has(i));
  }

  /**
   * Only process notes on lines whose name matches `nameOrPattern`.
   * Accepts a string (exact match) or a RegExp.
   */
  onLineNamed(nameOrPattern: string | RegExp): this {
    return this.onLines((line) =>
      typeof nameOrPattern === "string" ? line.Name === nameOrPattern : nameOrPattern.test(line.Name)
    );
  }

  /**
   * Only process notes whose `above` value equals `side` (1 = above, 2 = below).
   */
  onSide(side: 1 | 2): this {
    return this.addCondition((note) => note.above === side);
  }

  /**
   * Only process notes whose speed satisfies the predicate.
   */
  withSpeed(predicate: (speed: number) => boolean): this {
    return this.addCondition((note) => predicate(note.speed));
  }

  // ── Process API ────────────────────────────────────────────────────────────

  /** Add a custom process callback. */
  addProcess(process: NoteProcess): this {
    this._processes.push(process);
    return this;
  }

  /** Shorthand alias for `addProcess`. */
  process(fn: NoteProcess): this {
    return this.addProcess(fn);
  }

  /** Set the `speed` of all matched notes. */
  setSpeed(speed: number): this {
    return this.process((note) => {
      note.speed = speed;
    });
  }

  /** Scale the `speed` of all matched notes by a factor. */
  scaleSpeed(factor: number): this {
    return this.process((note) => {
      note.speed *= factor;
    });
  }

  /** Set the `positionX` of all matched notes. */
  setX(x: number): this {
    return this.process((note) => {
      note.positionX = x;
    });
  }

  /** Translate notes along X by `dx`. */
  moveX(dx: number): this {
    return this.process((note) => {
      note.positionX += dx;
    });
  }

  /** Mirror notes horizontally (flip positionX sign). */
  mirrorX(): this {
    return this.process((note) => {
      note.positionX = -note.positionX;
    });
  }

  /** Set the `alpha` of all matched notes (0–255). */
  setAlpha(alpha: number): this {
    return this.process((note) => {
      note.alpha = alpha;
    });
  }

  /** Set the `size` of all matched notes. */
  setSize(size: number): this {
    return this.process((note) => {
      note.size = size;
    });
  }

  /** Scale the `size` of all matched notes by a factor. */
  scaleSize(factor: number): this {
    return this.process((note) => {
      note.size *= factor;
    });
  }

  /** Set the `yOffset` of all matched notes. */
  setYOffset(y: number): this {
    return this.process((note) => {
      note.yOffset = y;
    });
  }

  /** Set the `isFake` flag on all matched notes. */
  setFake(fake: boolean): this {
    return this.process((note) => {
      note.isFake = fake ? 1 : 0;
    });
  }

  /** Set the visible time for all matched notes. */
  setVisibleTime(time: number): this {
    return this.process((note) => {
      note.visibleTime = time;
    });
  }

  /** Set a tint color `[r, g, b]` on all matched notes. */
  setTint(color: [number, number, number] | null): this {
    return this.process((note) => {
      note.tint = color;
    });
  }

  /** Set a hit effect tint `[r, g, b]` on all matched notes. */
  setTintHitEffects(color: [number, number, number] | null): this {
    return this.process((note) => {
      note.tintHitEffects = color;
    });
  }

  /** Assign a hitsound to all matched notes. */
  setHitsound(hitsound: string): this {
    return this.process((note) => {
      note.hitsound = hitsound;
    });
  }

  /** Set `judgeArea` on all matched notes. */
  setJudgeArea(size: number): this {
    return this.process((note) => {
      note.judgeArea = size;
    });
  }

  /** Set the `above` side (1 = above, 2 = below) on all matched notes. */
  setSide(side: 1 | 2): this {
    return this.process((note) => {
      note.above = side;
    });
  }

  /**
   * Offset the start (and optionally end) beat of all matched notes by
   * `beatOffset`.
   */
  offsetBeat(beatOffset: number): this {
    return this.process((note) => {
      const newStart = toBeats(note.startTime) + beatOffset;
      note.startTime = fromBeats(newStart);
      note.startBeat = newStart;
      // Only shift end for holds (type 2)
      if (note.type === 2) {
        const newEnd = toBeats(note.endTime) + beatOffset;
        note.endTime = fromBeats(newEnd);
        note.endBeat = newEnd;
      }
    });
  }

  /**
   * Apply a user-supplied callback to each note's index within its line.
   * Useful for stagger, sequential effects, etc.
   *
   * The callback receives `(note, line, chart, noteIndex, lineIndex, globalIndex)`.
   */
  processIndexed(
    fn: (note: Note, line: JudgeLine, chart: RpeJson, noteIndex: number, lineIndex: number, globalIndex: number) => void
  ): this {
    let globalIndex = 0;
    return this.process((note, line, chart, ni, li) => {
      fn(note, line, chart, ni, li, globalIndex++);
    });
  }

  // ── Execution ──────────────────────────────────────────────────────────────

  /**
   * Run the iterator over all notes in the provided chart.
   * @returns The number of notes that were processed.
   */
  run(chart: RpeJson): number {
    let count = 0;
    chart.judgeLineList.forEach((line, lineIndex) => {
      if (this._lineFilter && !this._lineFilter(line, lineIndex)) return;
      if (!line.notes) return;
      line.notes.forEach((note, noteIndex) => {
        if (!this._includeFake && note.isFake) return;
        if (this._typeFilter && !this._typeFilter.includes(note.type as NoteTypeValue)) return;
        if (!this._conditions.every((c) => c(note, line, chart, noteIndex, lineIndex))) return;
        for (const p of this._processes) p(note, line, chart, noteIndex, lineIndex);
        count++;
      });
    });
    return count;
  }

  /**
   * Run the iterator over a provided array of notes (without chart context).
   * `line` and `chart` context will be `null` casts — prefer `run` when
   * a chart is available.
   *
   * @returns The number of notes that were processed.
   */
  processNotes(notes: Note[]): number {
    let count = 0;
    const fakeLine = {} as JudgeLine;
    const fakeChart = {} as RpeJson;
    notes.forEach((note, noteIndex) => {
      if (!this._includeFake && note.isFake) return;
      if (this._typeFilter && !this._typeFilter.includes(note.type as NoteTypeValue)) return;
      if (!this._conditions.every((c) => c(note, fakeLine, fakeChart, noteIndex, -1))) return;
      for (const p of this._processes) p(note, fakeLine, fakeChart, noteIndex, -1);
      count++;
    });
    return count;
  }

  /**
   * Collect all notes that pass the current conditions.
   * No process functions are called.
   */
  collect(chart: RpeJson): Note[] {
    const results: Note[] = [];
    chart.judgeLineList.forEach((line, lineIndex) => {
      if (this._lineFilter && !this._lineFilter(line, lineIndex)) return;
      if (!line.notes) return;
      line.notes.forEach((note, noteIndex) => {
        if (!this._includeFake && note.isFake) return;
        if (this._typeFilter && !this._typeFilter.includes(note.type as NoteTypeValue)) return;
        if (!this._conditions.every((c) => c(note, line, chart, noteIndex, lineIndex))) return;
        results.push(note);
      });
    });
    return results;
  }

  /**
   * Count matching notes without running any processes.
   */
  count(chart: RpeJson): number {
    return this.collect(chart).length;
  }

  /**
   * Delete all notes that match the current conditions from the chart.
   * Process functions are NOT called — only conditions are evaluated.
   *
   * @returns The number of notes deleted.
   */
  delete(chart: RpeJson): number {
    let count = 0;
    chart.judgeLineList.forEach((line, lineIndex) => {
      if (this._lineFilter && !this._lineFilter(line, lineIndex)) return;
      if (!line.notes) return;
      const originalLen = line.notes.length;
      line.notes = line.notes.filter((note, noteIndex) => {
        if (!this._includeFake && note.isFake) return true;
        if (this._typeFilter && !this._typeFilter.includes(note.type as NoteTypeValue)) return true;
        if (!this._conditions.every((c) => c(note, line, chart, noteIndex, lineIndex))) return true;
        // Note matched all conditions — remove it
        return false;
      });
      const removed = originalLen - line.notes.length;
      line.numOfNotes = Math.max(0, line.numOfNotes - removed);
      count += removed;
    });
    return count;
  }
}

/**
 * Create a new `NoteIterator`.
 *
 * @example
 * ```ts
 * noteIterator().between(0, 16).setSpeed(1.5).run(chart);
 * ```
 */
export function noteIterator(): NoteIterator {
  return new NoteIterator();
}

// ─── LineIterator ─────────────────────────────────────────────────────────────

/**
 * Fluent iterator that filters and transforms judge lines in an RPE chart.
 *
 * @example
 * ```ts
 * lineIterator()
 *   .named(/^BG/)
 *   .process(line => { line.zOrder = -10; })
 *   .run(chart);
 * ```
 */
export class LineIterator {
  private _conditions: LinePredicate[] = [];
  private _processes: LineProcess[] = [];

  // ── Condition API ──────────────────────────────────────────────────────────

  /** Add an arbitrary predicate. */
  addCondition(predicate: LinePredicate): this {
    this._conditions.push(predicate);
    return this;
  }

  /** Match lines by exact name or RegExp. */
  named(nameOrPattern: string | RegExp): this {
    return this.addCondition((line) =>
      typeof nameOrPattern === "string" ? line.Name === nameOrPattern : nameOrPattern.test(line.Name)
    );
  }

  /** Match lines in the given group index. */
  inGroup(group: number): this {
    return this.addCondition((line) => line.Group === group);
  }

  /** Match lines using a specific texture. */
  withTexture(texture: string): this {
    return this.addCondition((line) => line.Texture === texture);
  }

  /** Match lines at the given indices. */
  atIndices(...indices: number[]): this {
    const set = new Set(indices);
    return this.addCondition((_line, i) => set.has(i));
  }

  /** Match lines whose parent (father) is `parentIndex`. */
  withParent(parentIndex: number): this {
    return this.addCondition((line) => line.father === parentIndex);
  }

  /** Match lines with no parent (`father === -1`). */
  withNoParent(): this {
    return this.addCondition((line) => line.father === -1);
  }

  /** Match lines that have at least one note. */
  withNotes(): this {
    return this.addCondition((line) => (line.notes?.length ?? 0) > 0);
  }

  // ── Process API ────────────────────────────────────────────────────────────

  /** Add a custom process callback. */
  addProcess(process: LineProcess): this {
    this._processes.push(process);
    return this;
  }

  /** Shorthand alias for `addProcess`. */
  process(fn: LineProcess): this {
    return this.addProcess(fn);
  }

  /** Set the group of matched lines. */
  setGroup(group: number): this {
    return this.process((line) => {
      line.Group = group;
    });
  }

  /** Set the texture of matched lines. */
  setTexture(texture: string): this {
    return this.process((line) => {
      line.Texture = texture;
    });
  }

  /** Set the zOrder of matched lines. */
  setZOrder(zOrder: number): this {
    return this.process((line) => {
      line.zOrder = zOrder;
    });
  }

  /** Set the bpmfactor of matched lines. */
  setBpmFactor(factor: number): this {
    return this.process((line) => {
      line.bpmfactor = factor;
    });
  }

  /** Set isCover on matched lines. */
  setCover(isCover: 0 | 1): this {
    return this.process((line) => {
      line.isCover = isCover;
    });
  }

  /** Re-parent matched lines to `newParent` (-1 = root). */
  reparent(newParent: number): this {
    return this.process((line) => {
      line.father = newParent;
    });
  }

  // ── Execution ──────────────────────────────────────────────────────────────

  /**
   * Run the iterator over all lines in the chart.
   * @returns The number of lines processed.
   */
  run(chart: RpeJson): number {
    let count = 0;
    chart.judgeLineList.forEach((line, index) => {
      if (!this._conditions.every((c) => c(line, index, chart))) return;
      for (const p of this._processes) p(line, index, chart);
      count++;
    });
    return count;
  }

  /**
   * Collect all matching lines.
   */
  collect(chart: RpeJson): JudgeLine[] {
    return chart.judgeLineList.filter((line, index) => this._conditions.every((c) => c(line, index, chart)));
  }

  /**
   * Count matching lines without running processes.
   */
  count(chart: RpeJson): number {
    return this.collect(chart).length;
  }
}

/**
 * Create a new `LineIterator`.
 *
 * @example
 * ```ts
 * lineIterator().named('BG').setZOrder(-1).run(chart);
 * ```
 */
export function lineIterator(): LineIterator {
  return new LineIterator();
}

// ─── EventIterator ────────────────────────────────────────────────────────────

/**
 * Specifies which event channels to include when iterating events.
 * `'all'` covers everything; `'layer'` covers only layered events;
 * `'extended'` covers incline, scaleX, scaleY.
 */
export type EventChannelFilter = "all" | "layer" | "extended" | EventChannelType | EventChannelType[];

/**
 * Fluent iterator that filters and transforms events across all lines.
 *
 * @example
 * ```ts
 * eventIterator()
 *   .onChannels('moveX', 'moveY')
 *   .between(0, 32)
 *   .process(ev => { ev.start *= -1; ev.end *= -1; })
 *   .run(chart);
 * ```
 */
export class EventIterator {
  private _conditions: EventPredicate[] = [];
  private _processes: EventProcess[] = [];
  private _channels: EventChannelFilter = "all";
  private _lineFilter: LinePredicate | null = null;

  // ── Condition API ──────────────────────────────────────────────────────────

  /** Add a custom predicate. */
  addCondition(predicate: EventPredicate): this {
    this._conditions.push(predicate);
    return this;
  }

  /** Limit to events that start at or after `beat`. */
  after(beat: number): this {
    return this.addCondition((ev) => toBeats(ev.startTime) >= beat);
  }

  /** Limit to events that start before `beat`. */
  before(beat: number): this {
    return this.addCondition((ev) => toBeats(ev.startTime) < beat);
  }

  /**
   * Limit to events whose start beat is in [`start`, `end`).
   */
  between(start: number, end: number): this {
    return this.addCondition((ev) => {
      const b = toBeats(ev.startTime);
      return b >= start && b < end;
    });
  }

  /**
   * Limit to events on lines matching the given predicate.
   */
  onLines(predicate: LinePredicate): this {
    this._lineFilter = predicate;
    return this;
  }

  /**
   * Limit to events on lines at the given indices.
   */
  onLineIndices(...indices: number[]): this {
    const set = new Set(indices);
    return this.onLines((_line, i) => set.has(i));
  }

  /**
   * Limit to specific event channels.
   *
   * @example `.onChannels('moveX', 'moveY')`
   * @example `.onChannels('extended')`
   */
  onChannels(...channels: EventChannelType[]): this;
  onChannels(filter: EventChannelFilter): this;
  onChannels(...args: (EventChannelType | EventChannelFilter)[]): this {
    if (args.length === 1 && typeof args[0] === "string" && !isChannelType(args[0] as string)) {
      this._channels = args[0] as EventChannelFilter;
    } else {
      this._channels = args as EventChannelType[];
    }
    return this;
  }

  // ── Process API ────────────────────────────────────────────────────────────

  /** Add a custom process callback. */
  addProcess(process: EventProcess): this {
    this._processes.push(process);
    return this;
  }

  /** Shorthand for `addProcess`. */
  process(fn: EventProcess): this {
    return this.addProcess(fn);
  }

  /** Multiply start and end values by `factor`. */
  scaleValues(factor: number): this {
    return this.process((ev) => {
      ev.start *= factor;
      ev.end *= factor;
    });
  }

  /** Negate both start and end values (mirror). */
  negateValues(): this {
    return this.scaleValues(-1);
  }

  /** Add `offset` to both start and end values. */
  offsetValues(offset: number): this {
    return this.process((ev) => {
      ev.start += offset;
      ev.end += offset;
    });
  }

  /** Shift event start and end beats by `beatOffset`. */
  offsetBeats(beatOffset: number): this {
    return this.process((ev) => {
      const newStart = toBeats(ev.startTime) + beatOffset;
      const newEnd = toBeats(ev.endTime) + beatOffset;
      ev.startTime = fromBeats(newStart);
      ev.startBeat = newStart;
      ev.endTime = fromBeats(newEnd);
      ev.endBeat = newEnd;
    });
  }

  /** Set the easing type on all matched events. */
  setEasing(easingType: number): this {
    return this.process((ev) => {
      ev.easingType = easingType;
    });
  }

  // ── Execution ──────────────────────────────────────────────────────────────

  /**
   * Run the iterator over all events in the chart.
   * @returns The number of events processed.
   */
  run(chart: RpeJson): number {
    let count = 0;
    chart.judgeLineList.forEach((line, lineIndex) => {
      if (this._lineFilter && !this._lineFilter(line, lineIndex, chart)) return;

      const channelSet = resolveChannels(this._channels);

      // Layer-based channels
      if (
        channelSet.has("moveX") ||
        channelSet.has("moveY") ||
        channelSet.has("rotate") ||
        channelSet.has("alpha") ||
        channelSet.has("speed")
      ) {
        line.eventLayers.forEach((layer, layerIndex) => {
          if (!layer) return;
          count += this._runOnLayerChannel(layer, "moveX", layer.moveXEvents, layerIndex, line, chart, channelSet);
          count += this._runOnLayerChannel(layer, "moveY", layer.moveYEvents, layerIndex, line, chart, channelSet);
          count += this._runOnLayerChannel(layer, "rotate", layer.rotateEvents, layerIndex, line, chart, channelSet);
          count += this._runOnLayerChannel(layer, "alpha", layer.alphaEvents, layerIndex, line, chart, channelSet);
          count += this._runOnLayerChannel(
            layer,
            "speed",
            layer.speedEvents as unknown as Event[] | null | undefined,
            layerIndex,
            line,
            chart,
            channelSet
          );
        });
      }

      // Extended channels
      if (line.extended) {
        if (channelSet.has("incline") && line.extended.inclineEvents) {
          count += this._runOnEvents(line.extended.inclineEvents, "incline", 0, line, chart);
        }
        if (channelSet.has("scaleX") && line.extended.scaleXEvents) {
          count += this._runOnEvents(line.extended.scaleXEvents, "scaleX", 0, line, chart);
        }
        if (channelSet.has("scaleY") && line.extended.scaleYEvents) {
          count += this._runOnEvents(line.extended.scaleYEvents, "scaleY", 0, line, chart);
        }
      }
    });
    return count;
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private _runOnLayerChannel(
    _layer: EventLayer,
    type: EventChannelType,
    events: Event[] | null | undefined,
    layerIndex: number,
    line: JudgeLine,
    chart: RpeJson,
    channelSet: Set<EventChannelType>
  ): number {
    if (!channelSet.has(type) || !events) return 0;
    return this._runOnEvents(events, type, layerIndex, line, chart);
  }

  private _runOnEvents(
    events: Event[],
    type: EventChannelType,
    layerIndex: number,
    line: JudgeLine,
    chart: RpeJson
  ): number {
    let count = 0;
    for (const ev of events) {
      if (!this._conditions.every((c) => c(ev, type, layerIndex, line, chart))) continue;
      for (const p of this._processes) p(ev, type, layerIndex, line, chart);
      count++;
    }
    return count;
  }
}

/**
 * Create a new `EventIterator`.
 *
 * @example
 * ```ts
 * eventIterator().onChannels('rotate').negateValues().run(chart);
 * ```
 */
export function eventIterator(): EventIterator {
  return new EventIterator();
}

// ─── Predicate Helpers for Time-Based Note Filtering ─────────────────────────

/**
 * Create a time-based predicate using seconds instead of beats.
 *
 * @param minSec - Minimum time in seconds (inclusive).
 * @param maxSec - Maximum time in seconds (exclusive).
 * @returns A `NotePredicate` that filters by chart time.
 */
export function betweenTime(chart: RpeJson, minSec: number, maxSec: number): NotePredicate {
  initBpmList(chart.BPMList);
  return (note) => {
    const t = getTimeSec(chart.BPMList, toBeats(note.startTime));
    return t >= minSec && t < maxSec;
  };
}

// ─── Bulk Convenience Functions ───────────────────────────────────────────────

/**
 * Iterate all notes in a chart and run a callback on each.
 * This is the simplest way to do a one-off transformation without building an iterator.
 *
 * @param chart - The RPE chart.
 * @param fn - Callback for each note.
 * @param includeFake - Whether to include fake notes (default: true).
 */
export function forEachNote(
  chart: RpeJson,
  fn: (note: Note, line: JudgeLine, lineIndex: number) => void,
  includeFake = true
): void {
  chart.judgeLineList.forEach((line, lineIndex) => {
    if (!line.notes) return;
    for (const note of line.notes) {
      if (!includeFake && note.isFake) continue;
      fn(note, line, lineIndex);
    }
  });
}

/**
 * Iterate all judge lines in a chart and run a callback on each.
 *
 * @param chart - The RPE chart.
 * @param fn - Callback for each line.
 */
export function forEachLine(chart: RpeJson, fn: (line: JudgeLine, index: number) => void): void {
  chart.judgeLineList.forEach((line, index) => fn(line, index));
}

/**
 * Iterate all events in all event layers of all lines, running a callback
 * on each `Event`.
 *
 * @param chart - The RPE chart.
 * @param fn - Callback receiving the event, its channel type, layer index, and line.
 * @param channels - Which channels to visit (default: all layer channels).
 */
export function forEachEvent(
  chart: RpeJson,
  fn: (ev: Event, type: EventChannelType, layerIndex: number, line: JudgeLine) => void,
  channels: EventChannelFilter = "all"
): void {
  const channelSet = resolveChannels(channels);
  chart.judgeLineList.forEach((line) => {
    line.eventLayers.forEach((layer, layerIndex) => {
      if (!layer) return;
      if (channelSet.has("moveX") && layer.moveXEvents)
        layer.moveXEvents.forEach((ev) => fn(ev, "moveX", layerIndex, line));
      if (channelSet.has("moveY") && layer.moveYEvents)
        layer.moveYEvents.forEach((ev) => fn(ev, "moveY", layerIndex, line));
      if (channelSet.has("rotate") && layer.rotateEvents)
        layer.rotateEvents.forEach((ev) => fn(ev, "rotate", layerIndex, line));
      if (channelSet.has("alpha") && layer.alphaEvents)
        layer.alphaEvents.forEach((ev) => fn(ev, "alpha", layerIndex, line));
      if (channelSet.has("speed") && layer.speedEvents)
        (layer.speedEvents as unknown as Event[]).forEach((ev) => fn(ev, "speed", layerIndex, line));
    });
    if (line.extended) {
      if (channelSet.has("incline") && line.extended.inclineEvents)
        line.extended.inclineEvents.forEach((ev) => fn(ev, "incline", 0, line));
      if (channelSet.has("scaleX") && line.extended.scaleXEvents)
        line.extended.scaleXEvents.forEach((ev) => fn(ev, "scaleX", 0, line));
      if (channelSet.has("scaleY") && line.extended.scaleYEvents)
        line.extended.scaleYEvents.forEach((ev) => fn(ev, "scaleY", 0, line));
    }
  });
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

const ALL_CHANNEL_TYPES: EventChannelType[] = [
  "moveX",
  "moveY",
  "rotate",
  "alpha",
  "speed",
  "incline",
  "scaleX",
  "scaleY",
];

const LAYER_CHANNEL_TYPES: EventChannelType[] = ["moveX", "moveY", "rotate", "alpha", "speed"];
const EXTENDED_CHANNEL_TYPES: EventChannelType[] = ["incline", "scaleX", "scaleY"];

function isChannelType(s: string): s is EventChannelType {
  return (ALL_CHANNEL_TYPES as string[]).includes(s);
}

function resolveChannels(filter: EventChannelFilter): Set<EventChannelType> {
  if (filter === "all") return new Set(ALL_CHANNEL_TYPES);
  if (filter === "layer") return new Set(LAYER_CHANNEL_TYPES);
  if (filter === "extended") return new Set(EXTENDED_CHANNEL_TYPES);
  if (typeof filter === "string") return new Set([filter as EventChannelType]);
  return new Set(filter as EventChannelType[]);
}
