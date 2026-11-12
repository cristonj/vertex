// Vertex MCP server — a minimal Model Context Protocol implementation over stdio
// (JSON-RPC 2.0, newline-delimited, zero dependencies).
//
// Any MCP client (Claude Desktop, Claude Code, ...) can drive a Vertex game:
//   load -> step -> observe/view/screenshot -> edit -> reset
//
// Configure in claude_desktop_config.json:
//   { "mcpServers": { "vertex": { "command": "node", "args": ["/path/to/vertex/bin/vertex.js", "mcp"] } } }
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import readline from 'node:readline';
import { createFrom, loadSceneModule } from '../src/load.js';
import { toPNG } from '../src/node.js';

const TOOLS = [
  {
    name: 'load',
    description: 'Load a Vertex game into a new session. Either "path" (a cartridge .json, or a scene module exporting createGame) or "scene" (an inline scene or cartridge document; for plain scenes attach built-in systems by name via "use"). Returns { session, snapshot }.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to a cartridge (.json) or scene module (.js)' },
        scene: { type: 'object', description: 'Inline scene or cartridge document (SPEC.md §2)' },
        use: { type: 'array', items: { type: 'string' }, description: 'Built-in systems for inline scenes: motion, wrap, lifetime' },
        seed: { type: 'number' },
        fps: { type: 'number' },
      },
    },
  },
  {
    name: 'step',
    description: 'Advance a session N steps (fixed 1/fps s each). press/release hold actions across steps; tap presses and releases within the same step. Returns frame, events and state.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string' },
        steps: { type: 'number' },
        press: { type: 'array', items: { type: 'string' } },
        release: { type: 'array', items: { type: 'string' } },
        tap: { type: 'array', items: { type: 'string' } },
        pointer: { type: 'object', description: 'Move the world-space pointer before stepping: { x, y }. Press "pointer" to click.', properties: { x: { type: 'number' }, y: { type: 'number' } } },
      },
      required: ['session'],
    },
  },
  {
    name: 'observe',
    description: 'Read the world as compact JSON: every entity id, position, rotation, tags, plus game state. This is how you see without vision.',
    inputSchema: {
      type: 'object',
      properties: { session: { type: 'string' } },
      required: ['session'],
    },
  },
  {
    name: 'view',
    description: 'Render the current frame as a standalone SVG string (a few KB). Diff it, store it, or read it as your screenshot.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string' },
        hud: { type: 'boolean', description: 'Include the HUD text (default true)' },
      },
      required: ['session'],
    },
  },
  {
    name: 'screenshot',
    description: 'Rasterize the current frame to PNG (returned as base64 image content). Pure JS, no native deps.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string' },
        width: { type: 'number' },
        height: { type: 'number' },
      },
      required: ['session'],
    },
  },
  {
    name: 'edit',
    description: 'Edit the live world. ops: {op:"spawn", entity:{...}}, {op:"despawn", id|tag}, {op:"set", id|tag, fields:{x,y,vx,...}}, {op:"state", set:{key:value}}. The world is plain data — rewrite it while the game runs.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string' },
        ops: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              op: { type: 'string', enum: ['spawn', 'despawn', 'set', 'state'] },
              entity: { type: 'object' },
              id: { type: 'string' },
              tag: { type: 'string' },
              fields: { type: 'object' },
              set: { type: 'object' },
            },
            required: ['op'],
          },
        },
      },
      required: ['session', 'ops'],
    },
  },
  {
    name: 'reset',
    description: 'Rebuild the session from its original scene with a (new) seed. Deterministic: same seed, same game.',
    inputSchema: {
      type: 'object',
      properties: { session: { type: 'string' }, seed: { type: 'number' } },
      required: ['session'],
    },
  },
];

export function createServer() {
  const sessions = new Map();
  let nextId = 1;

  async function handle(msg) {
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return error((msg && msg.id) ?? null, -32600, 'Invalid Request');
    }
    if (msg.method.startsWith('notifications/')) return null; // e.g. notifications/initialized
    const id = msg.id;
    try {
      switch (msg.method) {
        case 'initialize':
          return result(id, {
            protocolVersion: typeof msg.params?.protocolVersion === 'string'
              ? msg.params.protocolVersion : '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'vertex', version: '1.1.0' },
          });
        case 'ping':
          return result(id, {});
        case 'tools/list':
          return result(id, { tools: TOOLS });
        case 'tools/call': {
          const { name, arguments: a = {} } = msg.params ?? {};
          try {
            return result(id, await callTool(sessions, () => `s${nextId++}`, name, a ?? {}));
          } catch (e) {
            return result(id, { content: [{ type: 'text', text: String(e.message ?? e) }], isError: true });
          }
        }
        default:
          return error(id, -32601, `Method not found: ${msg.method}`);
      }
    } catch (e) {
      return error(id, -32603, String(e.message ?? e));
    }
  }

  return { handle };
}

async function callTool(sessions, nextSessionId, name, a) {
  switch (name) {
    case 'load': {
      const opts = { seed: a.seed ?? 1 };
      if (a.fps) opts.fps = a.fps;
      let game, source;
      if (a.path) {
        const p = resolve(String(a.path));
        game = createFrom(await loadSceneModule(p), opts);
        source = { kind: 'path', path: p };
      } else if (a.scene) {
        const doc = typeof a.scene === 'string' ? JSON.parse(a.scene) : a.scene;
        game = createFrom({ scene: doc }, { ...opts, use: a.use ?? [] });
        source = { kind: 'scene', doc, use: a.use ?? [] };
      } else {
        throw new Error('provide "path" (scene module) or "scene" (inline document)');
      }
      const session = nextSessionId();
      sessions.set(session, { game, source, opts });
      return text(JSON.stringify({ session, snapshot: game.snapshot() }, null, 2));
    }

    case 'step': {
      const s = mustSession(sessions, a.session);
      const g = s.game;
      if (a.pointer) g.point(a.pointer.x ?? g.pointer.x, a.pointer.y ?? g.pointer.y);
      for (const x of a.press ?? []) g.press(x);
      for (const x of a.release ?? []) g.release(x);
      const taps = a.tap ?? [];
      for (const x of taps) g.press(x);
      const evs = g.step(Math.max(1, a.steps ?? 1));
      for (const x of taps) g.release(x);
      return text(`frame ${g.world.frame}\nevents: ${JSON.stringify(evs)}\nstate: ${JSON.stringify(g.world.state)}`);
    }

    case 'observe': {
      const s = mustSession(sessions, a.session);
      return text(JSON.stringify(s.game.snapshot(), null, 2));
    }

    case 'view': {
      const s = mustSession(sessions, a.session);
      return text(s.game.toSVG({ hud: a.hud !== false }));
    }

    case 'screenshot': {
      const s = mustSession(sessions, a.session);
      const png = toPNG(s.game.world, { width: a.width, height: a.height });
      return {
        content: [
          { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
          { type: 'text', text: `PNG, ${png.length} bytes` },
        ],
      };
    }

    case 'edit': {
      const s = mustSession(sessions, a.session);
      const w = s.game.world;
      const ops = a.ops ?? [];
      if (!ops.length) throw new Error('no ops given');
      for (const op of ops) {
        if (op.op === 'spawn') {
          w.spawn(op.entity ?? {});
        } else if (op.op === 'despawn') {
          if (op.id) w.despawn(op.id);
          else if (op.tag) for (const e of w.query(op.tag)) w.despawn(e);
          else throw new Error('despawn needs id or tag');
        } else if (op.op === 'set') {
          const targets = op.id ? [w.get(op.id)].filter(Boolean) : op.tag ? w.query(op.tag) : [];
          if (!targets.length) throw new Error(`set: no entity ${op.id ? `id=${op.id}` : `tag=${op.tag}`}`);
          const fields = op.fields ?? {};
          for (const t of targets) Object.assign(t, fields);
        } else if (op.op === 'state') {
          Object.assign(w.state, op.set ?? {});
        } else {
          throw new Error(`unknown edit op: ${op.op}`);
        }
      }
      return text(`applied ${ops.length} op(s)\nstate: ${JSON.stringify(w.state)}`);
    }

    case 'reset': {
      const s = mustSession(sessions, a.session);
      const seed = a.seed ?? s.opts.seed;
      const mod = s.source.kind === 'path'
        ? await loadSceneModule(s.source.path)
        : { scene: s.source.doc };
      s.game = createFrom(mod, { ...s.opts, seed, use: s.source.use });
      return text(JSON.stringify({ snapshot: s.game.snapshot() }, null, 2));
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function mustSession(sessions, id) {
  const s = sessions.get(id);
  if (!s) throw new Error(`unknown session: ${id} (call "load" first)`);
  return s;
}

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const result = (id, r) => ({ jsonrpc: '2.0', id, result: r });
const error = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

/** Serve MCP over stdio: newline-delimited JSON-RPC. Blocks until stdin closes. */
export function runMCPServer() {
  const server = createServer();
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const write = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    Promise.resolve(server.handle(msg)).then(
      (out) => { if (out) write(out); },
      (e) => write({ jsonrpc: '2.0', id: (msg && msg.id) ?? null, error: { code: -32603, message: String(e.message ?? e) } }),
    );
  });
  rl.on('close', () => process.exit(0));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runMCPServer();
