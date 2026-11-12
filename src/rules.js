import { raycast as castRay, nearest as nearestTo, pointQuery } from './physics.js';
// Vertex Rules: game logic as data. A tiny, safe, deterministic expression language so a
// complete game — art, scene AND behavior — is one JSON document that any implementation
// can run (see SPEC.md §6). No eval, no host access: only the builtins below.
//
//   { "each": "ship", "when": "held('left')", "do": "self.rot -= 4 * dt" }
//   { "on": "hit", "tags": ["bullet", "rock"], "do": "despawn(a); despawn(b); state.score += 10" }
//   { "on": "start", "do": "spawn('rock', {x: rand(0, W), y: 40, tags: ['rock', 'wrap']})" }
//
// Grammar (precedence low -> high):
//   program  := stmt (';' stmt)*
//   stmt     := 'if' '(' expr ')' block ('else' (block | stmt))? | 'let' NAME '=' expr | assign | expr
//   block    := '{' program '}'
//   assign   := target ('=' | '+=' | '-=' | '*=' | '/=') expr        target := NAME | member
//   expr     := ternary;  ternary := or ('?' expr ':' expr)?
//   or := and ('||' and)*;  and := cmp ('&&' cmp)*;  cmp := sum (('=='|'!='|'<'|'<='|'>'|'>=') sum)?
//   sum := prod (('+'|'-') prod)*;  prod := unary (('*'|'/'|'%') unary)*;  unary := ('-'|'!') unary | postfix
//   postfix := primary ('.' NAME | '[' expr ']' | '(' args ')')*
//   primary := NUMBER | STRING | 'true' | 'false' | 'null' | NAME | '(' expr ')' | '[' list ']' | '{' fields '}'

const TOKEN = /\s*(?:(\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|([A-Za-z_$][\w$]*)|(\+=|-=|\*=|\/=|==|!=|<=|>=|&&|\|\||[-+*/%<>=!?:;.,()[\]{}]))/y;

export function tokenize(src) {
  const out = [];
  TOKEN.lastIndex = 0;
  let m;
  while (TOKEN.lastIndex < src.length) {
    const at = TOKEN.lastIndex;
    if (/^\s*$/.test(src.slice(at))) break;
    if (!(m = TOKEN.exec(src))) throw new SyntaxError(`rules: unexpected character at ${at}: "${src.slice(at, at + 12)}"`);
    if (m[1] !== undefined) out.push({ t: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) out.push({ t: 'str', v: m[2].slice(1, -1).replace(/\\(.)/g, '$1') });
    else if (m[3] !== undefined) out.push({ t: 'name', v: m[3] });
    else out.push({ t: 'op', v: m[4] });
  }
  return out;
}

const KEYWORDS = new Set(['if', 'else', 'let', 'true', 'false', 'null']);

export function parse(src) {
  const toks = tokenize(src);
  let i = 0;
  const peek = (v) => toks[i] && toks[i].t === 'op' && toks[i].v === v;
  const peekName = (v) => toks[i] && toks[i].t === 'name' && toks[i].v === v;
  const eat = (v) => { if (!peek(v)) throw new SyntaxError(`rules: expected "${v}" but found "${toks[i]?.v ?? 'end'}" in: ${src}`); i++; };
  const BIN = [['||'], ['&&'], ['==', '!=', '<', '<=', '>', '>='], ['+', '-'], ['*', '/', '%']];

  function program(end) {
    const body = [];
    while (i < toks.length && !(end && peek(end))) {
      if (peek(';')) { i++; continue; }
      body.push(stmt());
      if (i < toks.length && !(end && peek(end))) {
        if (peek(';')) i++;
        else if (body[body.length - 1].k !== 'if') eat(';');
      }
    }
    return { k: 'block', body };
  }
  function block() { eat('{'); const b = program('}'); eat('}'); return b; }
  function stmt() {
    if (peekName('if')) {
      i++; eat('('); const cond = expr(); eat(')');
      const then = peek('{') ? block() : { k: 'block', body: [stmt()] };
      let other = null;
      if (peekName('else')) { i++; other = peek('{') ? block() : { k: 'block', body: [stmt()] }; }
      return { k: 'if', cond, then, other };
    }
    if (peekName('let')) {
      i++; const name = toks[i++]; if (name?.t !== 'name') throw new SyntaxError('rules: let needs a name');
      eat('='); return { k: 'let', name: name.v, value: expr() };
    }
    const target = expr();
    const op = toks[i];
    if (op && op.t === 'op' && ['=', '+=', '-=', '*=', '/='].includes(op.v)) {
      if (target.k !== 'name' && target.k !== 'member') throw new SyntaxError(`rules: cannot assign to that in: ${src}`);
      i++;
      return { k: 'assign', op: op.v, target, value: expr() };
    }
    return { k: 'expr', e: target };
  }
  function expr() {
    const c = bin(0);
    if (peek('?')) { i++; const a = expr(); eat(':'); const b = expr(); return { k: 'cond', c, a, b }; }
    return c;
  }
  function bin(level) {
    if (level === BIN.length) return unary();
    let left = bin(level + 1);
    while (toks[i] && toks[i].t === 'op' && BIN[level].includes(toks[i].v)) {
      const op = toks[i++].v;
      left = { k: 'bin', op, a: left, b: bin(level + 1) };
      if (level === 2) break; // comparisons don't chain
    }
    return left;
  }
  function unary() {
    if (peek('-') || peek('!')) { const op = toks[i++].v; return { k: 'un', op, a: unary() }; }
    return postfix();
  }
  function postfix() {
    let e = primary();
    for (;;) {
      if (peek('.')) { i++; const n = toks[i++]; if (n?.t !== 'name') throw new SyntaxError('rules: expected a field name after "."'); e = { k: 'member', o: e, p: { k: 'lit', v: n.v } }; }
      else if (peek('[')) { i++; const p = expr(); eat(']'); e = { k: 'member', o: e, p }; }
      else if (peek('(')) {
        i++; const args = [];
        while (!peek(')')) { args.push(expr()); if (!peek(')')) eat(','); }
        eat(')');
        if (e.k !== 'name') throw new SyntaxError('rules: only builtin functions can be called');
        e = { k: 'call', f: e.v, args };
      } else return e;
    }
  }
  function primary() {
    const tk = toks[i++];
    if (!tk) throw new SyntaxError(`rules: unexpected end of: ${src}`);
    if (tk.t === 'num' || tk.t === 'str') return { k: 'lit', v: tk.v };
    if (tk.t === 'name') {
      if (tk.v === 'true') return { k: 'lit', v: true };
      if (tk.v === 'false') return { k: 'lit', v: false };
      if (tk.v === 'null') return { k: 'lit', v: null };
      if (KEYWORDS.has(tk.v)) throw new SyntaxError(`rules: unexpected "${tk.v}"`);
      return { k: 'name', v: tk.v };
    }
    if (tk.v === '(') { const e = expr(); eat(')'); return e; }
    if (tk.v === '[') { const items = []; while (!peek(']')) { items.push(expr()); if (!peek(']')) eat(','); } eat(']'); return { k: 'arr', items }; }
    if (tk.v === '{') {
      const fields = [];
      while (!peek('}')) {
        const key = toks[i++];
        if (!key || (key.t !== 'name' && key.t !== 'str')) throw new SyntaxError('rules: object keys must be names or strings');
        eat(':'); fields.push([key.v, expr()]);
        if (!peek('}')) eat(',');
      }
      eat('}');
      return { k: 'obj', fields };
    }
    throw new SyntaxError(`rules: unexpected "${tk.v}" in: ${src}`);
  }

  const prog = program(null);
  if (i < toks.length) throw new SyntaxError(`rules: unexpected "${toks[i].v}" in: ${src}`);
  return prog;
}

/** Parse an expression (for `when`). */
export function parseExpr(src) {
  const p = parse(src);
  if (p.body.length !== 1 || p.body[0].k !== 'expr') throw new SyntaxError(`rules: "when" must be a single expression: ${src}`);
  return p.body[0].e;
}

const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);

// ---- Closure compiler. Each AST node becomes a JS function once, at load time; evaluation
// is then plain function calls (no per-node dispatch). Semantics are identical to SPEC.md §6.
// Environment `env`: { vars (bindings, prototype-chained per execution), locals, fns }.

const hasOwn = Object.prototype.hasOwnProperty;

// Names declared with `let` anywhere in the program being compiled (set per compile).
let LETS = new Set();
function letsOf(node, out = new Set()) {
  if (!node || typeof node !== 'object') return out;
  if (node.k === 'let') out.add(node.name);
  for (const v of Object.values(node)) {
    if (Array.isArray(v)) v.forEach((x) => letsOf(x, out)); else if (v && typeof v === 'object') letsOf(v, out);
  }
  return out;
}
const withLets = (ast, fn) => { const prev = LETS; LETS = letsOf(ast); try { return fn(ast); } finally { LETS = prev; } };

function member(o, p) {
  if (FORBIDDEN.has(p)) throw new Error(`rules: forbidden field "${p}"`);
  if (o == null) return undefined;
  if (typeof o !== 'object' && typeof o !== 'string') return undefined;
  return hasOwn.call(o, p) || Array.isArray(o) ? o[p] : (p === 'length' ? o.length : undefined);
}

function compileExpr(node) {
  switch (node.k) {
    case 'lit': { const v = node.v; return () => v; }
    case 'name': {
      const n = node.v;
      if (!LETS.has(n)) { // never declared with let in this program: bindings only
        return (env) => {
          const v = env.vars[n];
          if (v !== undefined || n in env.vars) return v;
          throw new Error(`rules: unknown name "${n}"`);
        };
      }
      return (env) => {
        if (n in env.locals) return env.locals[n];
        if (n in env.vars) return env.vars[n];
        throw new Error(`rules: unknown name "${n}"`);
      };
    }
    case 'member': {
      const o = compileExpr(node.o);
      if (node.p.k === 'lit') { const p = node.p.v; return (env) => member(o(env), p); }
      const p = compileExpr(node.p);
      return (env) => member(o(env), p(env));
    }
    case 'call': {
      const name = node.f, args = node.args.map(compileExpr);
      const n = args.length;
      return (env) => {
        const f = env.fns[name];
        if (!f) throw new Error(`rules: unknown function "${name}"`);
        if (n === 0) return f();
        if (n === 1) return f(args[0](env));
        if (n === 2) return f(args[0](env), args[1](env));
        return f(...args.map((a) => a(env)));
      };
    }
    case 'un': {
      const a = compileExpr(node.a);
      return node.op === '-' ? (env) => -a(env) : (env) => !a(env);
    }
    case 'cond': { const c = compileExpr(node.c), a = compileExpr(node.a), b = compileExpr(node.b); return (env) => (c(env) ? a(env) : b(env)); }
    case 'arr': { const items = node.items.map(compileExpr); return (env) => items.map((x) => x(env)); }
    case 'obj': {
      const fields = node.fields.map(([k, v]) => {
        if (FORBIDDEN.has(k)) throw new SyntaxError(`rules: forbidden key "${k}"`);
        return [k, compileExpr(v)];
      });
      return (env) => { const o = {}; for (const [k, v] of fields) o[k] = v(env); return o; };
    }
    case 'bin': {
      const a = compileExpr(node.a), b = compileExpr(node.b);
      switch (node.op) {
        case '&&': return (env) => { const x = a(env); return x ? b(env) : x; };
        case '||': return (env) => { const x = a(env); return x ? x : b(env); };
        case '+': return (env) => a(env) + b(env);
        case '-': return (env) => a(env) - b(env);
        case '*': return (env) => a(env) * b(env);
        case '/': return (env) => a(env) / b(env);
        case '%': return (env) => a(env) % b(env);
        case '==': return (env) => a(env) === b(env);
        case '!=': return (env) => a(env) !== b(env);
        case '<': return (env) => a(env) < b(env);
        case '<=': return (env) => a(env) <= b(env);
        case '>': return (env) => a(env) > b(env);
        case '>=': return (env) => a(env) >= b(env);
      }
    }
  }
  throw new Error(`rules: bad node ${node.k}`);
}

function compileStmt(node) {
  switch (node.k) {
    case 'block': {
      const body = node.body.map(compileStmt);
      if (body.length === 1) return body[0];
      return (env) => { for (let i = 0; i < body.length; i++) body[i](env); };
    }
    case 'if': {
      const c = compileExpr(node.cond), t = compileStmt(node.then), o = node.other ? compileStmt(node.other) : null;
      return (env) => { if (c(env)) t(env); else if (o) o(env); };
    }
    case 'let': { const name = node.name, v = compileExpr(node.value); return (env) => { env.locals[name] = v(env); }; }
    case 'assign': {
      const v = compileExpr(node.value), op = node.op;
      const apply = (cur, x) => (op === '=' ? x : op === '+=' ? cur + x : op === '-=' ? cur - x : op === '*=' ? cur * x : cur / x);
      if (node.target.k === 'name') {
        const key = node.target.v;
        return (env) => {
          const x = v(env);
          if (!(key in env.locals)) throw new Error(`rules: unknown variable "${key}" (declare it with let)`);
          env.locals[key] = apply(env.locals[key], x);
        };
      }
      const o = compileExpr(node.target.o), p = compileExpr(node.target.p);
      return (env) => {
        const x = v(env), obj = o(env), key = p(env);
        if (obj == null || typeof obj !== 'object') throw new Error(`rules: cannot set "${key}" on ${obj}`);
        if (FORBIDDEN.has(key)) throw new Error(`rules: forbidden field "${key}"`);
        obj[key] = apply(obj[key], x);
      };
    }
    case 'expr': { const e = compileExpr(node.e); return (env) => { e(env); }; }
  }
  throw new Error(`rules: bad node ${node.k}`);
}

/** Builtins are built once per game and reused every step. */
const builtinCache = new WeakMap();

/** Builtin functions available to rules. Deterministic given the game's seeded RNG. */
function builtins(game) {
  const w = () => game.world;
  const ent = (x) => (typeof x === 'string' ? w().get(x) : x);
  return {
    held: (a) => game.input.has(a),
    pressed: (a) => game.pressed.has(a),
    random: () => game.random(),
    rand: (lo, hi) => lo + game.random() * (hi - lo),
    spawn: (shape, fields = {}) => w().spawn({ shape, ...fields }),
    despawn: (e) => { e = ent(e); if (e) w().despawn(e); },
    alive: (e) => { e = ent(e); return !!e && w().get(e.id) === e; },
    get: (id) => w().get(id) ?? null,
    all: (tag) => w().query(tag),
    first: (tag) => w().query(tag)[0] ?? null,
    count: (tag) => w().query(tag).length,
    has: (e, tag) => !!ent(e)?.tags.includes(tag),
    tag: (e, tag) => { e = ent(e); if (e && !e.tags.includes(tag)) e.tags.push(tag); },
    untag: (e, tag) => { e = ent(e); if (e) e.tags = e.tags.filter((t) => t !== tag); },
    emit: (type, payload = {}) => game.emit(type, payload),
    sound: (name) => game.sound(name),
    dist: (a, b) => { a = ent(a); b = ent(b); return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2); },
    abs: Math.abs, min: Math.min, max: Math.max, floor: Math.floor, ceil: Math.ceil,
    round: (v) => Math.floor(v + 0.5), sqrt: Math.sqrt, sign: Math.sign,
    sin: Math.sin, cos: Math.cos, atan2: Math.atan2,
    clamp: (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v),
    lerp: (a, b, t) => a + (b - a) * t,
    str: (v) => String(v),
    after: (seconds, type, payload = {}) => game.after(seconds, type, payload),
    goto: (name) => game.goto(name),
    nearest: (x, y, tag) => nearestTo(w(), x, y, tag),
    at: (x, y, tag) => pointQuery(w(), x, y, { tag: tag ?? null })[0] ?? null,
    raycast: (x, y, dx, dy, max, tag) => {
      const h = castRay(w(), x, y, dx, dy, { max: max ?? Infinity, tag: tag ?? null });
      return h ? { entity: h.entity, x: h.x, y: h.y, distance: h.distance } : null;
    },
    burst: (e, n) => { e = ent(e); if (e?.emitter) e.emitter.burst = (e.emitter.burst ?? 0) + n; },
    len: (v) => (v == null ? 0 : v.length),
  };
}

/**
 * Compile a rules array into one system. Rules run in order every step:
 *   { do, when?, each? }          — every step (per tagged entity with `each`, bound as `self`)
 *   { on: "start", do }           — once, on the first step
 *   { on: "<event>", do, tags? }  — for each event of that type emitted earlier this step;
 *                                   binds `event`, and for "hit" also `a` / `b` (entities)
 */
export function compileRules(rules) {
  const compiled = rules.map((r, idx) => {
    try {
      const prog = parse(Array.isArray(r.do) ? r.do.join(';') : r.do);
      return { ...r, _do: withLets(prog, compileStmt), _when: r.when ? withLets(parseExpr(r.when), compileExpr) : null };
    } catch (e) {
      throw new SyntaxError(`rules[${idx}]: ${e.message}`);
    }
  });
  return function rulesSystem(game, dt) {
    const w = game.world;
    let fns = builtinCache.get(game);
    if (!fns) builtinCache.set(game, (fns = builtins(game)));
    const vars = { dt, frame: w.frame, time: w.time, state: w.state, W: w.width, H: w.height, PI: Math.PI, pointer: game.pointer, camera: w.camera ?? null };
    const env = { vars, locals: null, fns };
    // per-execution bindings sit on a child of `vars` (no copying); locals are fresh each time
    const run = (r, scope) => {
      env.vars = scope;
      env.locals = {};
      if (r._when && !r._when(env)) return;
      r._do(env);
    };
    const exec = (r, extra) => {
      env.vars = extra ? { ...vars, ...extra } : vars;
      env.locals = {};
      if (r._when && !r._when(env)) return;
      r._do(env);
    };
    for (const r of compiled) {
      if (r.on === 'start') { if (w.frame === 0) exec(r, null); continue; }
      if (r.on) {
        for (const event of game.events.slice()) {
          if (event.type !== r.on) continue;
          if (r.on === 'contact' && r.tags) {
            // contact pairs are unordered: bind a/b so that a has tags[0] and b has tags[1]
            let a = w.get(event.a), b = w.get(event.b);
            if (!a || !b) continue;
            if (!(a.tags.includes(r.tags[0]) && b.tags.includes(r.tags[1]))) [a, b] = [b, a];
            if (!(a.tags.includes(r.tags[0]) && b.tags.includes(r.tags[1]))) continue;
            exec(r, { event, a, b });
          } else if (r.on === 'hit') {
            if (r.tags && (event.tags?.[0] !== r.tags[0] || event.tags?.[1] !== r.tags[1])) continue;
            const a = w.get(event.a), b = w.get(event.b);
            if (!a || !b) continue; // already removed by an earlier rule this step
            exec(r, { event, a, b });
          } else exec(r, { event });
        }
        continue;
      }
      if (r.each) {
        const scope = { ...vars, self: null }; // one flat scope per rule; `self` rebound per entity
        for (const self of w.query(r.each)) if (w.get(self.id) === self) { scope.self = self; run(r, scope); }
      }
      else exec(r, null);
    }
  };
}
