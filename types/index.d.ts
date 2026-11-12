// Type declarations for vertex-engine. The format itself is specified in SPEC.md and
// schema/scene.schema.json; these types mirror it for editors and agents.

// ---------------------------------------------------------------- documents

export type Color = string;
export interface Gradient {
  type: 'linear' | 'radial';
  x1?: number; y1?: number; x2?: number; y2?: number;
  cx?: number; cy?: number; r?: number;
  stops: Array<[offset: number, color: Color]>;
}
export interface ShapePart { d: string; fill?: Color | Gradient; stroke?: Color; width?: number; clip?: string }
export type Shape = ShapePart | { parts: ShapePart[] };

export interface Body {
  static?: boolean; sensor?: boolean; collider?: 'box' | 'circle';
  restitution?: number; friction?: number; mass?: number; gravity?: number;
  /** Set by the physics system each step. */
  readonly ground?: boolean;
  /** Set by the physics system: -1 / 1 while touching a side. */
  readonly wall?: -1 | 0 | 1;
}

export interface Emitter {
  shape?: string; d?: string; text?: string; fill?: Color; stroke?: Color; width?: number;
  rate?: number; burst?: number; life?: number | [number, number]; speed?: number | [number, number];
  angle?: number | [number, number]; scale?: number | [number, number]; spin?: number | [number, number];
  relative?: boolean; inherit?: boolean; shrink?: boolean; gravity?: number; drag?: number;
  tags?: string[]; max?: number; layer?: number;
}

export interface EntityDoc {
  id?: string; shape?: string | null; d?: string; text?: string | number; size?: number; align?: 'left' | 'center' | 'right';
  fill?: Color; stroke?: Color; width?: number;
  x?: number; y?: number; rot?: number; scale?: number; vx?: number; vy?: number; vr?: number; drag?: number;
  layer?: number; parallax?: number; fixed?: boolean; hidden?: boolean;
  body?: Body; emitter?: Emitter;
  tags?: string[]; data?: Record<string, unknown>;
}
export interface Entity extends EntityDoc {
  id: string; x: number; y: number; rot: number; scale: number; vx: number; vy: number; vr: number;
  tags: string[]; data: Record<string, any>;
}

export interface Camera { x: number; y: number; zoom?: number; rot?: number }
export interface Sound {
  wave?: 'square' | 'saw' | 'sine' | 'triangle' | 'noise'; freq?: number; slide?: number;
  attack?: number; sustain?: number; decay?: number; volume?: number;
  vibrato?: number; vibratoRate?: number; duty?: number; lowpass?: number; seed?: number;
}
export interface SceneDoc {
  width?: number; height?: number; background?: Color; camera?: Camera;
  shapes?: Record<string, Shape>; entities?: EntityDoc[]; state?: Record<string, any>;
  sounds?: Record<string, Sound>;
  physics?: { gravity?: [number, number]; iterations?: number; slop?: number };
  scenes?: Record<string, { entities?: EntityDoc[]; state?: Record<string, any>; camera?: Camera }>;
  timers?: Array<{ at: number; type: string; [k: string]: unknown }>;
}

export type Rule =
  | { do: string | string[]; when?: string; each?: string }
  | { on: 'start'; do: string | string[]; when?: string }
  | { on: 'hit' | 'contact'; tags?: [string, string]; do: string | string[]; when?: string }
  | { on: string; do: string | string[]; when?: string };

export type SystemRef =
  | 'rules' | 'motion' | 'wrap' | 'lifetime' | 'physics' | 'particles' | 'morph' | 'keyframes'
  | { collide: Array<[string, string]> } | { collideOutline: Array<[string, string]> }
  | { follow: string | { id: string; lerp?: number } };

export interface Cartridge extends SceneDoc {
  vertex?: 1; title?: string; description?: string;
  systems?: SystemRef[]; rules?: Rule[]; keys?: Record<string, string>;
}

export type Input = [frame: number, kind: 'p' | 'r', action: string] | [frame: number, kind: 'm', x: number, y: number];
export interface Recording { vertex: 1; scene?: string; seed: number; fps: number; steps: number; digest: string; inputs: Input[] }

export interface GameEvent { type: string; frame: number; [k: string]: any }

// ---------------------------------------------------------------- runtime

export class World {
  constructor(doc?: SceneDoc);
  width: number; height: number; background: Color; camera?: Required<Camera>;
  shapes: Record<string, { src: Shape; parts: Array<ShapePart & { polys: number[][][] }>; polys: number[][][]; bounds: Bounds; pad: number }>;
  entities: Entity[]; state: Record<string, any>; sounds: Record<string, Sound>;
  physics?: SceneDoc['physics']; scenes?: SceneDoc['scenes']; timers: NonNullable<SceneDoc['timers']>;
  time: number; frame: number;
  restore(doc: SceneDoc): this;
  defineShape(name: string, shape: Shape): void;
  spawn(e: EntityDoc): Entity;
  despawn(e: Entity | string): void;
  get(id: string): Entity | undefined;
  query(tag: string): Entity[];
  radius(e: Entity): number;
  toJSON(): SceneDoc;
}

export type System = (game: Game, dt: number) => void;

export interface SaveState { world: SceneDoc; frame: number; time: number; nextId: number; seed: number; input: string[]; pressed: string[]; pointer: { x: number; y: number } }

export class Game {
  constructor(doc: SceneDoc | World, opts?: { fps?: number; seed?: number });
  world: World; dt: number; systems: System[];
  input: Set<string>; pressed: Set<string>; events: GameEvent[];
  pointer: { x: number; y: number };
  muted?: boolean;
  cartridge?: { title: string; keys: Record<string, string> };
  random(): number;
  use(system: System): this;
  emit(type: string, payload?: Record<string, unknown>): void;
  sound(name: string, payload?: Record<string, unknown>): void;
  after(seconds: number, type: string, payload?: Record<string, unknown>): void;
  goto(scene: string): void;
  press(action: string): void;
  release(action: string): void;
  point(x: number, y: number): void;
  step(n?: number): GameEvent[];
  saveState(): SaveState;
  loadState(s: SaveState): this;
  snapshot(): { frame: number; time: number; state: Record<string, any>; entities: Array<Pick<Entity, 'id' | 'shape' | 'tags' | 'x' | 'y' | 'rot'>> };
  toSVG(opts?: { hud?: boolean; cull?: boolean }): string;
  toPNG(opts?: { width?: number; height?: number }): Uint8Array;
  run(renderer?: Renderer): () => void;
}

export interface Renderer { draw(world: World): void; stats?: { entities: number; draws: number } }
export class CanvasRenderer implements Renderer { constructor(canvas: HTMLCanvasElement); draw(world: World): void }
export class WebGLRenderer implements Renderer { constructor(canvas: HTMLCanvasElement); draw(world: World): void; stats: { entities: number; draws: number } }
export function autoRenderer(canvas: HTMLCanvasElement): Promise<Renderer>;

export function toSVG(world: World, opts?: { hud?: boolean; cull?: boolean }): string;
export function toPNG(world: World, opts?: { width?: number; height?: number }): Uint8Array;
export function encodePNG(rgb: Uint8Array, width: number, height: number): Uint8Array;
export function parseColor(css: string): [number, number, number] | null;
export function setDeflate(fn: (raw: Uint8Array) => Uint8Array): void;

// geometry
export type PathCommand = [string, ...number[]];
export interface Bounds { minX: number; minY: number; maxX: number; maxY: number; radius: number }
export function parsePath(d: string): PathCommand[];
export function flatten(cmds: PathCommand[], steps?: number): number[][][];
export function bounds(polys: number[][][]): Bounds;
export function inlineD(e: EntityDoc): string | null;
export function textPath(str: string, size?: number, opts?: { spacing?: number; align?: 'left' | 'center' | 'right' }): { parts: Array<{ d: string }>; width: number; scale: number };
export function textShape(str: string, size?: number, style?: Partial<ShapePart> & { align?: 'left' | 'center' | 'right' }): { parts: ShapePart[] };
export function textWidth(str: string, size?: number, opts?: { spacing?: number }): number;
export namespace procedural {
  function polygonShape(n?: number, r?: number, rot?: number): { d: string };
  function starShape(n?: number, inner?: number, outer?: number, rot?: number): { d: string };
  function ringShape(inner?: number, outer?: number, n?: number): { d: string };
  function blobShape(seed?: number, opts?: { n?: number; r?: number; wobble?: number }): { d: string };
  function arrowShape(len?: number, w?: number): { d: string };
  function smoothClosed(pts: Array<[number, number]>): string;
}
export namespace animate {
  function morph(dA: string, dB: string, t: number, steps?: number): string;
  const morphAnim: System;
  const keyframes: System;
}

// systems & collision
export namespace systems {
  const motion: System; const wrap: System; const lifetime: System;
  function collide(pairs: Array<[string, string]>): System;
}
export function collideOutline(pairs: Array<[string, string]>): System;
export function outlinesOverlap(world: World, a: Entity, b: Entity): boolean;
export function pointInPoly(p: [number, number], poly: number[][]): boolean;
export const physics: System;
export const particles: System;
export function contact(a: object, b: object): { nx: number; ny: number; depth: number } | null;
export function raycast(world: World, x: number, y: number, dx: number, dy: number, opts?: { max?: number; tag?: string | null; ignore?: Entity | string | null }): { entity: Entity; x: number; y: number; distance: number } | null;
export function pointQuery(world: World, x: number, y: number, opts?: { tag?: string | null }): Entity[];
export function nearest(world: World, x: number, y: number, tag: string): Entity | null;
export class SpatialHash { constructor(cell?: number); insert(item: unknown, x: number, y: number, r: number): void; query(x: number, y: number, r: number): Set<unknown>; clear(): void }
export function follow(id: string, lerp?: number): System;
export function screenToWorld(world: World, x: number, y: number): [number, number];

// rules & cartridges
export function compileRules(rules: Rule[]): System;
export function parseRules(src: string): object;
export function loadCartridge(doc: Cartridge, opts?: { seed?: number; fps?: number }): Game;
export function isCartridge(doc: unknown): doc is Cartridge;
export function encodeCartridge(doc: Cartridge): Promise<string>;
export function decodeCartridge(code: string): Promise<Cartridge>;
export function checkScene(doc: unknown): Array<{ path: string; message: string }>;
export function assertValidScene(doc: unknown): void;

// time
export class Recorder { constructor(game: Game); inputs: Input[]; toJSON(extra?: Partial<Recording>): Recording }
export function applyRecording(game: Game, rec: Recording): Game;
export function applyInput(game: Game, input: Input): void;
export function verifyReplay(game: Game, rec: Recording): true;
export function digest(game: Game): string;
export function hash64(str: string): string;
export class Timeline {
  constructor(factory: (opts: { seed: number; fps: number }) => Game, opts?: { seed?: number; fps?: number; every?: number; checkpoints?: boolean; keep?: number });
  game: Game; readonly frame: number; head: number; inputs: Input[]; opts: { seed: number; fps: number };
  press(action: string): void; release(action: string): void; point(x: number, y: number): void;
  step(n?: number): GameEvent[]; seek(frame: number): this; rewind(frames?: number): this;
  branch(frame?: number): Timeline; toRecording(extra?: Partial<Recording>): Recording;
}
export function divergence(factory: (opts: { seed: number; fps: number }) => Game, a: Recording, b: Recording): number | null;
export interface Transport { send(msg: unknown): void; onMessage(fn: (msg: any) => void): void }
export class Lockstep {
  constructor(game: Game, opts: { id: string; peers: string[]; transport: Transport; delay?: number });
  game: Game; press(action: string): void; release(action: string): void;
  commit(): void; ready(): boolean; advance(max?: number): GameEvent[]; tick(): GameEvent[];
}
export function memoryTransport(): { connect(): Transport; flush(): void };
export function broadcastTransport(name?: string): Transport;
export function held(game: Game, player: string, action: string): boolean;

// input
type Controllable = { press(a: string): void; release(a: string): void; point?(x: number, y: number): void };
export function bindKeys(target: Controllable, map: Record<string, string>, el?: EventTarget): () => void;
export function bindPointer(target: Controllable, canvas: HTMLCanvasElement, getWorld: () => World, opts?: { action?: string }): () => void;
export function bindGamepad(target: Controllable, opts?: { buttons?: Record<number, string>; axes?: Record<number, [string, string]>; deadzone?: number; rename?: Record<string, string> }): () => void;
export function touchControls(target: Controllable, actions: string[], parent?: HTMLElement): () => void;
export function isTouchDevice(): boolean;

// audio
export const SAMPLE_RATE: number;
export function synth(params?: Sound, sampleRate?: number): Float32Array;
export function sequence(score: string, opts?: { bpm?: number; steps?: number; voice?: Sound; sampleRate?: number }): Float32Array;
export function noteFreq(name: string): number;
export function toWAV(samples: Float32Array, sampleRate?: number): Uint8Array;
export function attachAudio(game: Game, opts?: { volume?: number }): () => void;
