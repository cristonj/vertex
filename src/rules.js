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

function truthy(v) { return !!v; }

function run(node, env) {
  switch (node.k) {
    case 'block': for (const s of node.body) run(s, env); return;
    case 'if': if (truthy(ev(node.cond, env))) run(node.then, env); else if (node.other) run(node.other, env); return;
    case 'let': env.locals[node.name] = ev(node.value, env); return;
    case 'assign': {
      const v = ev(node.value, env);
      let obj, key;
      if (node.target.k === 'name') { obj = env.locals; key = node.target.v; if (!(key in obj)) throw new Error(`rules: unknown variable "${key}" (declare it with let)`); }
      else { obj = ev(node.target.o, env); key = ev(node.target.p, env); }
      if (obj == null || typeof obj !== 'object') throw new Error(`rules: cannot set "${key}" on ${obj}`);
      if (FORBIDDEN.has(key)) throw new Error(`rules: forbidden field "${key}"`);
      const cur = obj[key];
      obj[key] = node.op === '=' ? v : node.op === '+=' ? cur + v : node.op === '-=' ? cur - v : node.op === '*=' ? cur * v : cur / v;
      return;
    }
    case 'expr': ev(node.e, env); return;
  }
}

function ev(node, env) {
  switch (node.k) {
    case 'lit': return node.v;
    case 'name': {
      if (node.v in env.locals) return env.locals[node.v];
      if (node.v in env.vars) return env.vars[node.v];
      throw new Error(`rules: unknown name "${node.v}"`);
    }
    case 'member': {
      const o = ev(node.o, env), p = ev(node.p, env);
      if (FORBIDDEN.has(p)) throw new Error(`rules: forbidden field "${p}"`);
      if (o == null) return undefined;
      if (typeof o !== 'object' && typeof o !== 'string') return undefined;
      return Object.prototype.hasOwnProperty.call(o, p) || Array.isArray(o) ? o[p] : (p === 'length' ? o.length : undefined);
    }
    case 'call': {
      const f = env.fns[node.f];
      if (!f) throw new Error(`rules: unknown function "${node.f}"`);
      return f(...node.args.map((a) => ev(a, env)));
    }
    case 'un': { const a = ev(node.a, env); return node.op === '-' ? -a : !truthy(a); }
    case 'cond': return truthy(ev(node.c, env)) ? ev(node.a, env) : ev(node.b, env);
    case 'arr': return node.items.map((x) => ev(x, env));
    case 'obj': { const o = {}; for (const [k, v] of node.fields) { if (FORBIDDEN.has(k)) throw new Error(`rules: forbidden key "${k}"`); o[k] = ev(v, env); } return o; }
    case 'bin': {
      if (node.op === '&&') { const a = ev(node.a, env); return truthy(a) ? ev(node.b, env) : a; }
      if (node.op === '||') { const a = ev(node.a, env); return truthy(a) ? a : ev(node.b, env); }
      const a = ev(node.a, env), b = ev(node.b, env);
      switch (node.op) {
        case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return a / b;
        case '%': return a % b;
        case '==': return a === b; case '!=': return a !== b;
        case '<': return a < b; case '<=': return a <= b; case '>': return a > b; case '>=': return a >= b;
      }
    }
  }
  throw new Error(`rules: bad node ${node.k}`);
}

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
      return { ...r, _do: parse(Array.isArray(r.do) ? r.do.join(';') : r.do), _when: r.when ? parseExpr(r.when) : null };
    } catch (e) {
      throw new SyntaxError(`rules[${idx}]: ${e.message}`);
    }
  });
  return function rulesSystem(game, dt) {
    const w = game.world;
    const fns = builtins(game);
    const vars = { dt, frame: w.frame, time: w.time, state: w.state, W: w.width, H: w.height, PI: Math.PI, pointer: game.pointer, camera: w.camera ?? null };
    const exec = (r, extra) => {
      const env = { vars: { ...vars, ...extra }, locals: {}, fns };
      if (r._when && !truthy(ev(r._when, env))) return;
      run(r._do, env);
    };
    for (const r of compiled) {
      if (r.on === 'start') { if (w.frame === 0) exec(r, {}); continue; }
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
      if (r.each) { for (const self of w.query(r.each)) if (w.get(self.id) === self) exec(r, { self }); }
      else exec(r, {});
    }
  };
}
