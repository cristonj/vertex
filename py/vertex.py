#!/usr/bin/env python3
"""Vertex — second implementation of the Vertex format (SPEC.md), in pure Python 3.8+.

Runs Vertex cartridges (single-file games: scene + systems + rules) headless and produces
byte-identical SVG frames — and therefore identical digests — to the JavaScript reference,
for the same cartridge, seed and input log. That is the proof that Vertex is a format,
not one engine.

Supported (SPEC.md conformance level "core"): scenes, shapes (all path commands), entities,
inline geometry, layers, hud, camera without rotation, systems motion / wrap / lifetime /
collide, the full rules language, recordings, SVG output and the frame digest.

Usage:
  python py/vertex.py run  <cartridge.json> [--seed N] [--steps N] [--svg out.svg]
  python py/vertex.py play <recording.json> [--cartridge path]   # verifies the digest
"""

import json
import math
import re
import sys
from decimal import Decimal, ROUND_HALF_UP

# --------------------------------------------------------------------------- numbers

def js_str(x):
    """Format a value exactly like JavaScript's String(x)."""
    if x is True:
        return 'true'
    if x is False:
        return 'false'
    if x is None:
        return 'null'
    if isinstance(x, str):
        return x
    if isinstance(x, (list, tuple)):
        return ','.join('' if v is None else js_str(v) for v in x)
    if isinstance(x, dict):
        return '[object Object]'
    x = float(x)
    if x != x:
        return 'NaN'
    if x == math.inf:
        return 'Infinity'
    if x == -math.inf:
        return '-Infinity'
    if x == 0:
        return '0'
    if x.is_integer() and abs(x) < 1e21:
        return str(int(x))
    r = repr(x)  # shortest round-trip digits, like JS
    if 'e' in r or 'E' in r:
        mant, exp = r.split('e')
        exp = int(exp)
        digits = mant.replace('-', '').replace('.', '')
        neg = mant.startswith('-')
        point = (mant.replace('-', '').index('.') if '.' in mant else len(mant.replace('-', ''))) + exp
    else:
        neg = r.startswith('-')
        body = r.lstrip('-')
        ip, _, fp = body.partition('.')
        digits = (ip + fp).lstrip('0')
        lead = len(ip + fp) - len((ip + fp).lstrip('0'))
        point = len(ip) - lead
        digits = digits.rstrip('0') or '0'
    digits = digits.rstrip('0') or '0'
    n = point  # decimal point position relative to digit string
    k = len(digits)
    sign = '-' if neg else ''
    if k <= n <= 21:
        return sign + digits + '0' * (n - k)
    if 0 < n <= 21:
        return sign + digits[:n] + '.' + digits[n:]
    if -6 < n <= 0:
        return sign + '0.' + '0' * (-n) + digits
    e = n - 1
    es = ('+' if e >= 0 else '-') + str(abs(e))
    if k == 1:
        return sign + digits + 'e' + es
    return sign + digits[0] + '.' + digits[1:] + 'e' + es


def js_round(x):
    return math.floor(x + 0.5)


def r2(n):
    return js_round(n * 100) / 100


def to_fixed(x, d):
    """JS Number.prototype.toFixed: exact decimal expansion, ties away from zero."""
    q = Decimal(x).quantize(Decimal(1).scaleb(-d), rounding=ROUND_HALF_UP)
    return float(q)


def js_truthy(v):
    if v is None or v is False:
        return False
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return not (v == 0 or v != v)
    if isinstance(v, str):
        return v != ''
    return True


def num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else float(v)

# --------------------------------------------------------------------------- paths

PATH_TOKEN = re.compile(r'[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?')
ARITY = {'M': 2, 'L': 2, 'H': 1, 'V': 1, 'C': 6, 'S': 4, 'Q': 4, 'T': 2, 'A': 7, 'Z': 0}


def parse_path(d):
    toks = PATH_TOKEN.findall(d)
    out, i, cmd = [], 0, ''
    x = y = sx = sy = 0.0
    last = None
    while i < len(toks):
        if toks[i] in ARITY or toks[i].upper() in ARITY and not toks[i][0].isdigit() and toks[i][0] not in '-.':
            cmd = toks[i]
            i += 1
        up = cmd.upper()
        rel = cmd != up
        n = ARITY[up]
        if up == 'Z':
            out.append(['Z'])
            x, y, last = sx, sy, None
            continue
        a = [float(t) for t in toks[i:i + n]]
        if len(a) < n:
            break
        i += n
        ox, oy = (x, y) if rel else (0.0, 0.0)
        if up == 'M':
            x, y = a[0] + ox, a[1] + oy
            sx, sy = x, y
            out.append(['M', x, y])
            cmd = 'l' if rel else 'L'
            last = None
        elif up == 'L':
            x, y = a[0] + ox, a[1] + oy
            out.append(['L', x, y]); last = None
        elif up == 'H':
            x = a[0] + (x if rel else 0)
            out.append(['L', x, y]); last = None
        elif up == 'V':
            y = a[0] + (y if rel else 0)
            out.append(['L', x, y]); last = None
        elif up == 'C':
            c = [a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy, a[4] + ox, a[5] + oy]
            out.append(['C'] + c); last = ('C', c[2], c[3]); x, y = c[4], c[5]
        elif up == 'S':
            rx, ry = (2 * x - last[1], 2 * y - last[2]) if last and last[0] == 'C' else (x, y)
            c = [rx, ry, a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy]
            out.append(['C'] + c); last = ('C', c[2], c[3]); x, y = c[4], c[5]
        elif up == 'Q':
            c = [a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy]
            out.append(['Q'] + c); last = ('Q', c[0], c[1]); x, y = c[2], c[3]
        elif up == 'T':
            rx, ry = (2 * x - last[1], 2 * y - last[2]) if last and last[0] == 'Q' else (x, y)
            c = [rx, ry, a[0] + ox, a[1] + oy]
            out.append(['Q'] + c); last = ('Q', rx, ry); x, y = c[2], c[3]
        elif up == 'A':
            rrx0, rry0, rot, fa, fs, ea, eb = a
            ex, ey = ea + ox, eb + oy
            if not rrx0 or not rry0 or (ex == x and ey == y):
                out.append(['L', ex, ey])
            else:
                for p in sample_arc(x, y, rrx0, rry0, rot, fa, fs, ex, ey):
                    out.append(['L', p[0], p[1]])
            x, y, last = ex, ey, None
    return out


def sample_arc(x1, y1, rx, ry, rot_deg, fa, fs, x2, y2):
    # Mirrors src/path.js. Uses libm trig: arc geometry is "implementation-tolerant" (SPEC §8).
    phi = rot_deg * math.pi / 180
    cp, sp = math.cos(phi), math.sin(phi)
    dx, dy = (x1 - x2) / 2, (y1 - y2) / 2
    x1p = cp * dx + sp * dy
    y1p = -sp * dx + cp * dy
    rrx, rry = abs(rx), abs(ry)
    lam = (x1p * x1p) / (rrx * rrx) + (y1p * y1p) / (rry * rry)
    if lam > 1:
        s = math.sqrt(lam); rrx *= s; rry *= s
    numr = rrx * rrx * rry * rry - rrx * rrx * y1p * y1p - rry * rry * x1p * x1p
    den = rrx * rrx * y1p * y1p + rry * rry * x1p * x1p
    co = math.sqrt(max(0, numr / den)) if den else 0
    if fa == fs:
        co = -co
    cxp, cyp = co * rrx * y1p / rry, -co * rry * x1p / rrx
    cx = cp * cxp - sp * cyp + (x1 + x2) / 2
    cy = sp * cxp + cp * cyp + (y1 + y2) / 2

    def angle(ux, uy, vx, vy):
        dot = ux * vx + uy * vy
        ln = math.hypot(ux, uy) * math.hypot(vx, vy) or 1
        a = math.acos(max(-1, min(1, dot / ln)))
        return -a if ux * vy - uy * vx < 0 else a

    u1x, u1y = (x1p - cxp) / rrx, (y1p - cyp) / rry
    u2x, u2y = (-x1p - cxp) / rrx, (-y1p - cyp) / rry
    t1 = angle(1, 0, u1x, u1y)
    dt = angle(u1x, u1y, u2x, u2y)
    if not fs and dt > 0:
        dt -= 2 * math.pi
    if fs and dt < 0:
        dt += 2 * math.pi
    steps = max(4, math.ceil(abs(dt) / (math.pi / 12)))
    pts = []
    for i in range(1, steps + 1):
        t = t1 + (dt * i) / steps
        px, py = rrx * math.cos(t), rry * math.sin(t)
        pts.append((cp * px - sp * py + cx, sp * px + cp * py + cy))
    return pts


def flatten(cmds, steps=8):
    polys, cur, x, y = [], None, 0.0, 0.0
    for c in cmds:
        k = c[0]
        if k == 'M':
            cur = [(c[1], c[2])]; polys.append(cur); x, y = c[1], c[2]
        elif k == 'L':
            cur.append((c[1], c[2])); x, y = c[1], c[2]
        elif k == 'Q':
            for s in range(1, steps + 1):
                t = s / steps; u = 1 - t
                cur.append((u * u * x + 2 * u * t * c[1] + t * t * c[3], u * u * y + 2 * u * t * c[2] + t * t * c[4]))
            x, y = c[3], c[4]
        elif k == 'C':
            for s in range(1, steps + 1):
                t = s / steps; u = 1 - t
                cur.append((u * u * u * x + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t * t * t * c[5],
                            u * u * u * y + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6]))
            x, y = c[5], c[6]
        elif k == 'Z':
            if cur:
                x, y = cur[0]; cur.append((x, y))
    return polys


def bounds_radius(polys):
    r2_ = 0.0
    for p in polys:
        for x, y in p:
            d = x * x + y * y
            if d > r2_:
                r2_ = d
    return math.sqrt(r2_)

# --------------------------------------------------------------------------- world

ENTITY_DEFAULTS = (('x', 0), ('y', 0), ('rot', 0), ('scale', 1), ('vx', 0), ('vy', 0), ('vr', 0))


class Shape:
    def __init__(self, src):
        self.src = src
        self.parts = src.get('parts') or [src]
        polys = []
        for p in self.parts:
            polys += flatten(parse_path(p['d']))
        self.radius = bounds_radius(polys)
        self.pad = max([0.0] + [(p.get('width', 1)) / 2 for p in self.parts if p.get('stroke') and p.get('stroke') != 'none'])


class World:
    def __init__(self, doc):
        self.width = doc.get('width', 800)
        self.height = doc.get('height', 600)
        self.background = doc.get('background', '#000')
        self.camera = dict({'zoom': 1, 'rot': 0}, **doc['camera']) if doc.get('camera') else None
        self.shapes = {k: Shape(v) for k, v in (doc.get('shapes') or {}).items()}
        self.state = json.loads(json.dumps(doc.get('state') or {}))
        self.sounds = doc.get('sounds') or {}
        self.entities = []
        self.by_id = {}
        self.time = 0.0
        self.frame = 0
        self.next_id = 1
        self._inline = {}
        for e in doc.get('entities') or []:
            self.spawn(e)

    def spawn(self, e):
        ent = {}
        if 'id' in e and e['id'] is not None:
            ent['id'] = e['id']
        else:
            ent['id'] = 'e' + str(self.next_id); self.next_id += 1
        ent['shape'] = e.get('shape')
        for k, v in ENTITY_DEFAULTS:
            ent[k] = v
        for k, v in e.items():
            ent[k] = v
        ent['tags'] = list(e.get('tags') or [])
        ent['data'] = json.loads(json.dumps(e.get('data') or {}))
        self.entities.append(ent)
        self.by_id[ent['id']] = ent
        return ent

    def despawn(self, e):
        eid = e if isinstance(e, str) else e['id']
        known = self.by_id.get(eid)
        idx = -1
        if known is not None:
            for i in range(len(self.entities) - 1, -1, -1):
                if self.entities[i] is known:
                    idx = i; break
        else:
            for i, x in enumerate(self.entities):
                if x['id'] == eid:
                    idx = i; break
        if idx >= 0:
            del self.entities[idx]
        self.by_id.pop(eid, None)

    def get(self, eid):
        return self.by_id.get(eid)

    def query(self, tag):
        return [e for e in self.entities if tag in e['tags']]

    def geom(self, e):
        """(local radius, stroke pad) for an entity."""
        if e.get('d') is not None:
            g = self._inline.get(id(e))
            if not g or g[0] != e['d']:
                g = (e['d'], bounds_radius(flatten(parse_path(e['d']))), (e.get('width', 1)) / 2)
                self._inline[id(e)] = g
            return g[1], g[2]
        s = self.shapes.get(e.get('shape'))
        return (s.radius, s.pad) if s else (0.0, 0.0)

    def radius(self, e):
        return self.geom(e)[0] * e['scale']

# --------------------------------------------------------------------------- rules

RULE_TOKEN = re.compile(r"""\s*(?:(\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|([A-Za-z_$][\w$]*)|(\+=|-=|\*=|/=|==|!=|<=|>=|&&|\|\||[-+*/%<>=!?:;.,()\[\]{}]))""")
KEYWORDS = {'if', 'else', 'let', 'true', 'false', 'null'}
FORBIDDEN = {'__proto__', 'prototype', 'constructor'}


class RuleError(Exception):
    pass


def tokenize(src):
    out, pos = [], 0
    while pos < len(src):
        if not src[pos:].strip():
            break
        m = RULE_TOKEN.match(src, pos)
        if not m:
            raise RuleError('rules: unexpected character at %d' % pos)
        pos = m.end()
        if m.group(1) is not None:
            out.append(('num', float(m.group(1))))
        elif m.group(2) is not None:
            out.append(('str', re.sub(r'\\(.)', r'\1', m.group(2)[1:-1])))
        elif m.group(3) is not None:
            out.append(('name', m.group(3)))
        else:
            out.append(('op', m.group(4)))
    return out


BIN = [['||'], ['&&'], ['==', '!=', '<', '<=', '>', '>='], ['+', '-'], ['*', '/', '%']]


def parse_rules(src):
    toks = tokenize(src)
    i = [0]

    def at():
        return toks[i[0]] if i[0] < len(toks) else None

    def peek(v):
        t = at(); return t is not None and t[0] == 'op' and t[1] == v

    def peek_name(v):
        t = at(); return t is not None and t[0] == 'name' and t[1] == v

    def eat(v):
        if not peek(v):
            raise RuleError('rules: expected "%s" in: %s' % (v, src))
        i[0] += 1

    def program(end):
        body = []
        while i[0] < len(toks) and not (end and peek(end)):
            if peek(';'):
                i[0] += 1; continue
            body.append(stmt())
            if i[0] < len(toks) and not (end and peek(end)):
                if peek(';'):
                    i[0] += 1
                elif body[-1][0] != 'if':
                    eat(';')
        return ('block', body)

    def block():
        eat('{'); b = program('}'); eat('}'); return b

    def stmt():
        if peek_name('if'):
            i[0] += 1; eat('('); cond = expr(); eat(')')
            then = block() if peek('{') else ('block', [stmt()])
            other = None
            if peek_name('else'):
                i[0] += 1
                other = block() if peek('{') else ('block', [stmt()])
            return ('if', cond, then, other)
        if peek_name('let'):
            i[0] += 1; name = at(); i[0] += 1
            if not name or name[0] != 'name':
                raise RuleError('rules: let needs a name')
            eat('='); return ('let', name[1], expr())
        target = expr()
        t = at()
        if t and t[0] == 'op' and t[1] in ('=', '+=', '-=', '*=', '/='):
            if target[0] not in ('name', 'member'):
                raise RuleError('rules: cannot assign to that')
            i[0] += 1
            return ('assign', t[1], target, expr())
        return ('expr', target)

    def expr():
        c = binop(0)
        if peek('?'):
            i[0] += 1; a = expr(); eat(':'); b = expr(); return ('cond', c, a, b)
        return c

    def binop(level):
        if level == len(BIN):
            return unary()
        left = binop(level + 1)
        while at() and at()[0] == 'op' and at()[1] in BIN[level]:
            op = at()[1]; i[0] += 1
            left = ('bin', op, left, binop(level + 1))
            if level == 2:
                break
        return left

    def unary():
        if peek('-') or peek('!'):
            op = at()[1]; i[0] += 1; return ('un', op, unary())
        return postfix()

    def postfix():
        e = primary()
        while True:
            if peek('.'):
                i[0] += 1; n = at(); i[0] += 1
                if not n or n[0] != 'name':
                    raise RuleError('rules: expected a field name after "."')
                e = ('member', e, ('lit', n[1]))
            elif peek('['):
                i[0] += 1; p = expr(); eat(']'); e = ('member', e, p)
            elif peek('('):
                i[0] += 1; args = []
                while not peek(')'):
                    args.append(expr())
                    if not peek(')'):
                        eat(',')
                eat(')')
                if e[0] != 'name':
                    raise RuleError('rules: only builtin functions can be called')
                e = ('call', e[1], args)
            else:
                return e

    def primary():
        t = at(); i[0] += 1
        if t is None:
            raise RuleError('rules: unexpected end of: ' + src)
        if t[0] in ('num', 'str'):
            return ('lit', t[1])
        if t[0] == 'name':
            if t[1] == 'true': return ('lit', True)
            if t[1] == 'false': return ('lit', False)
            if t[1] == 'null': return ('lit', None)
            if t[1] in KEYWORDS:
                raise RuleError('rules: unexpected "%s"' % t[1])
            return ('name', t[1])
        if t[1] == '(':
            e = expr(); eat(')'); return e
        if t[1] == '[':
            items = []
            while not peek(']'):
                items.append(expr())
                if not peek(']'):
                    eat(',')
            eat(']'); return ('arr', items)
        if t[1] == '{':
            fields = []
            while not peek('}'):
                k = at(); i[0] += 1
                if not k or k[0] not in ('name', 'str'):
                    raise RuleError('rules: object keys must be names or strings')
                eat(':'); fields.append((k[1], expr()))
                if not peek('}'):
                    eat(',')
            eat('}'); return ('obj', fields)
        raise RuleError('rules: unexpected "%s" in: %s' % (t[1], src))

    prog = program(None)
    if i[0] < len(toks):
        raise RuleError('rules: unexpected token in: ' + src)
    return prog


def _key(k):
    if isinstance(k, float) and k.is_integer():
        return int(k)
    return k


def run_stmt(node, env):
    k = node[0]
    if k == 'block':
        for s in node[1]:
            run_stmt(s, env)
    elif k == 'if':
        if js_truthy(ev(node[1], env)):
            run_stmt(node[2], env)
        elif node[3]:
            run_stmt(node[3], env)
    elif k == 'let':
        env['locals'][node[1]] = ev(node[2], env)
    elif k == 'assign':
        _, op, target, value = node
        v = ev(value, env)
        if target[0] == 'name':
            obj, key = env['locals'], target[1]
            if key not in obj:
                raise RuleError('rules: unknown variable "%s" (declare it with let)' % key)
        else:
            obj, key = ev(target[1], env), _key(ev(target[2], env))
        if not isinstance(obj, (dict, list)):
            raise RuleError('rules: cannot set "%s"' % key)
        if key in FORBIDDEN:
            raise RuleError('rules: forbidden field "%s"' % key)
        cur = obj.get(key) if isinstance(obj, dict) else obj[key]
        if op == '=':
            res = v
        elif op == '+=':
            res = js_add(cur, v)
        elif op == '-=':
            res = cur - v
        elif op == '*=':
            res = cur * v
        else:
            res = js_div(cur, v)
        obj[key] = res
    elif k == 'expr':
        ev(node[1], env)


def js_add(a, b):
    if isinstance(a, str) or isinstance(b, str):
        return js_str(a) + js_str(b)
    return a + b


def js_div(a, b):
    if b == 0:
        if a == 0 or a != a:
            return math.nan
        return math.inf if (a > 0) == (math.copysign(1, b) > 0) else -math.inf
    return a / b


def js_eq(a, b):
    if isinstance(a, bool) or isinstance(b, bool):
        return a is b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a == b
    if isinstance(a, (dict, list)) or isinstance(b, (dict, list)):
        return a is b
    return type(a) == type(b) and a == b


def ev(node, env):
    k = node[0]
    if k == 'lit':
        return node[1]
    if k == 'name':
        n = node[1]
        if n in env['locals']:
            return env['locals'][n]
        if n in env['vars']:
            return env['vars'][n]
        raise RuleError('rules: unknown name "%s"' % n)
    if k == 'member':
        o, p = ev(node[1], env), _key(ev(node[2], env))
        if p in FORBIDDEN:
            raise RuleError('rules: forbidden field "%s"' % p)
        if isinstance(o, dict):
            return o.get(p)
        if isinstance(o, list):
            if p == 'length':
                return len(o)
            return o[p] if isinstance(p, int) and 0 <= p < len(o) else None
        if isinstance(o, str):
            return len(o) if p == 'length' else None
        return None
    if k == 'call':
        f = env['fns'].get(node[1])
        if f is None:
            raise RuleError('rules: unknown function "%s"' % node[1])
        return f(*[ev(a, env) for a in node[2]])
    if k == 'un':
        a = ev(node[2], env)
        return -a if node[1] == '-' else not js_truthy(a)
    if k == 'cond':
        return ev(node[2], env) if js_truthy(ev(node[1], env)) else ev(node[3], env)
    if k == 'arr':
        return [ev(x, env) for x in node[1]]
    if k == 'obj':
        o = {}
        for kk, vv in node[1]:
            if kk in FORBIDDEN:
                raise RuleError('rules: forbidden key "%s"' % kk)
            o[kk] = ev(vv, env)
        return o
    if k == 'bin':
        op = node[1]
        if op == '&&':
            a = ev(node[2], env); return ev(node[3], env) if js_truthy(a) else a
        if op == '||':
            a = ev(node[2], env); return a if js_truthy(a) else ev(node[3], env)
        a, b = ev(node[2], env), ev(node[3], env)
        if op == '+': return js_add(a, b)
        if op == '-': return a - b
        if op == '*': return a * b
        if op == '/': return js_div(a, b)
        if op == '%': return math.fmod(a, b) if b != 0 else math.nan
        if op == '==': return js_eq(a, b)
        if op == '!=': return not js_eq(a, b)
        if op == '<': return a < b
        if op == '<=': return a <= b
        if op == '>': return a > b
        if op == '>=': return a >= b
    raise RuleError('rules: bad node ' + str(k))


def js_min(*a):
    return math.inf if not a else min(a)


def js_max(*a):
    return -math.inf if not a else max(a)


def js_sign(v):
    return 0 if v == 0 else (1 if v > 0 else -1)


def builtins(game):
    w = lambda: game.world
    ent = lambda x: w().get(x) if isinstance(x, str) else x

    def spawn(shape, fields=None):
        f = dict(fields or {}); f2 = {'shape': shape}; f2.update(f)
        return w().spawn(f2)

    def despawn(e):
        e = ent(e)
        if e:
            w().despawn(e)

    def alive(e):
        e = ent(e)
        return bool(e) and w().get(e['id']) is e

    def tag(e, t):
        e = ent(e)
        if e and t not in e['tags']:
            e['tags'].append(t)

    def untag(e, t):
        e = ent(e)
        if e:
            e['tags'] = [x for x in e['tags'] if x != t]

    def dist(a, b):
        a, b = ent(a), ent(b)
        return math.sqrt((a['x'] - b['x']) ** 2 + (a['y'] - b['y']) ** 2)

    return {
        'held': lambda a: a in game.input,
        'pressed': lambda a: a in game.pressed,
        'random': game.random,
        'rand': lambda lo, hi: lo + game.random() * (hi - lo),
        'spawn': spawn, 'despawn': despawn, 'alive': alive,
        'get': lambda i: w().get(i),
        'all': lambda t: w().query(t),
        'first': lambda t: (w().query(t) or [None])[0],
        'count': lambda t: len(w().query(t)),
        'has': lambda e, t: bool(ent(e)) and t in ent(e)['tags'],
        'tag': tag, 'untag': untag,
        'emit': lambda t, p=None: game.emit(t, p or {}),
        'sound': lambda n: game.sound(n),
        'dist': dist,
        'abs': abs, 'min': js_min, 'max': js_max, 'floor': lambda v: float(math.floor(v)),
        'ceil': lambda v: float(math.ceil(v)), 'round': lambda v: float(js_round(v)), 'sqrt': math.sqrt,
        'sign': js_sign, 'sin': math.sin, 'cos': math.cos, 'atan2': math.atan2,
        'clamp': lambda v, lo, hi: lo if v < lo else hi if v > hi else v,
        'lerp': lambda a, b, t: a + (b - a) * t,
        'str': js_str,
        'len': lambda v: 0 if v is None else len(v),
    }


def compile_rules(rules):
    compiled = []
    for idx, r in enumerate(rules):
        src = ';'.join(r['do']) if isinstance(r['do'], list) else r['do']
        try:
            when = parse_rules(r['when']) if r.get('when') else None
            if when and (len(when[1]) != 1 or when[1][0][0] != 'expr'):
                raise RuleError('"when" must be a single expression')
            compiled.append((r, parse_rules(src), when[1][0][1] if when else None))
        except RuleError as e:
            raise RuleError('rules[%d]: %s' % (idx, e))

    def system(game, dt):
        w = game.world
        fns = builtins(game)
        base = {'dt': dt, 'frame': w.frame, 'time': w.time, 'state': w.state, 'W': w.width, 'H': w.height, 'PI': math.pi}

        def execute(r, prog, when, extra):
            env = {'vars': dict(base, **extra), 'locals': {}, 'fns': fns}
            if when is not None and not js_truthy(ev(when, env)):
                return
            run_stmt(prog, env)

        for r, prog, when in compiled:
            on = r.get('on')
            if on == 'start':
                if w.frame == 0:
                    execute(r, prog, when, {})
                continue
            if on:
                for event in list(game.events):
                    if event['type'] != on:
                        continue
                    if on == 'hit':
                        tags = r.get('tags')
                        et = event.get('tags') or [None, None]
                        if tags and (et[0] != tags[0] or et[1] != tags[1]):
                            continue
                        a, b = w.get(event.get('a')), w.get(event.get('b'))
                        if not a or not b:
                            continue
                        execute(r, prog, when, {'event': event, 'a': a, 'b': b})
                    else:
                        execute(r, prog, when, {'event': event})
                continue
            if r.get('each'):
                for s in w.query(r['each']):
                    if w.get(s['id']) is s:
                        execute(r, prog, when, {'self': s})
            else:
                execute(r, prog, when, {})
    return system

# --------------------------------------------------------------------------- systems

def sys_motion(game, dt):
    for e in game.world.entities:
        if e.get('drag'):
            k = math.pow(1 - e['drag'], dt)  # pow: implementation-tolerant (SPEC §8)
            e['vx'] *= k; e['vy'] *= k
        e['x'] += e['vx'] * dt; e['y'] += e['vy'] * dt; e['rot'] += e['vr'] * dt


def sys_wrap(game, dt):
    W, H = game.world.width, game.world.height
    for e in game.world.query('wrap'):
        if e['x'] < 0: e['x'] += W
        elif e['x'] >= W: e['x'] -= W
        if e['y'] < 0: e['y'] += H
        elif e['y'] >= H: e['y'] -= H


def sys_lifetime(game, dt):
    for e in list(game.world.entities):
        if 'ttl' not in e['data']:
            continue
        e['data']['ttl'] -= dt
        if e['data']['ttl'] <= 0:
            game.world.despawn(e)


def sys_collide(pairs):
    def system(game, dt):
        w = game.world
        for ta, tb in pairs:
            A, B = w.query(ta), w.query(tb)
            rad = {}
            for e in A + B:
                rad[id(e)] = w.radius(e)
            for a in A:
                for b in B:
                    if a is b:
                        continue
                    rr = rad[id(a)] + rad[id(b)]
                    dx, dy = a['x'] - b['x'], a['y'] - b['y']
                    if dx * dx + dy * dy < rr * rr:
                        game.emit('hit', {'a': a['id'], 'b': b['id'], 'tags': [ta, tb]})
    return system


SYSTEMS = {'motion': lambda _: sys_motion, 'wrap': lambda _: sys_wrap, 'lifetime': lambda _: sys_lifetime, 'collide': sys_collide}

# --------------------------------------------------------------------------- game

class Game:
    def __init__(self, doc, seed=1, fps=60):
        self.world = World(doc)
        self.dt = 1 / fps
        self.systems = []
        self.input, self.pressed, self.events = set(), set(), []
        self.seed = (int(seed) & 0xffffffff) or 1
        self.initial_seed = self.seed

    def random(self):
        x = self.seed
        x = (x ^ (x << 13)) & 0xffffffff
        x ^= x >> 17
        x = (x ^ (x << 5)) & 0xffffffff
        self.seed = x
        return x / 4294967296

    def emit(self, typ, payload=None):
        ev_ = {'type': typ, 'frame': self.world.frame}
        ev_.update(payload or {})
        self.events.append(ev_)

    def sound(self, name):
        self.emit('sound', {'name': name})

    def press(self, a):
        if a not in self.input:
            self.pressed.add(a)
        self.input.add(a)

    def release(self, a):
        self.input.discard(a)

    def step(self, n=1):
        out = []
        for _ in range(n):
            self.events = []
            for s in self.systems:
                s(self, self.dt)
            self.world.time += self.dt
            self.world.frame += 1
            self.pressed.clear()
            out += self.events
        return out

    def to_svg(self):
        return to_svg(self.world)


CARTRIDGE_KEYS = ('vertex', 'title', 'systems', 'rules', 'keys', 'description')


def load_cartridge(doc, seed=1, fps=60):
    scene = {k: v for k, v in doc.items() if k not in CARTRIDGE_KEYS}
    g = Game(scene, seed, fps)
    rules = compile_rules(doc['rules']) if doc.get('rules') else None
    placed = False
    for item in doc.get('systems') or ['rules', 'motion', 'wrap', 'lifetime']:
        name, arg = (item, None) if isinstance(item, str) else next(iter(item.items()))
        if name == 'rules':
            if placed:
                raise RuleError('cartridge: "rules" may appear only once in systems')
            if rules:
                g.systems.append(rules)
            placed = True
            continue
        if name not in SYSTEMS:
            raise NotImplementedError('system "%s" is not in the core conformance level' % name)
        g.systems.append(SYSTEMS[name](arg))
    if rules and not placed:
        g.systems.insert(0, rules)
    return g

# --------------------------------------------------------------------------- SVG + digest

FONT = json.loads(r'''{"0":[[[1,0],[3,0],[4,1],[4,5],[3,6],[1,6],[0,5],[0,1],[1,0]],[[0.5,5],[3.5,1]]],"1":[[[1,1],[2,0],[2,6]],[[1,6],[3,6]]],"2":[[[0,1],[1,0],[3,0],[4,1],[4,2],[0,6],[4,6]]],"3":[[[0,0],[4,0],[2,2.5],[3,2.5],[4,3.5],[4,5],[3,6],[1,6],[0,5]]],"4":[[[3,6],[3,0],[0,4],[4,4]]],"5":[[[4,0],[0,0],[0,3],[3,3],[4,4],[4,5],[3,6],[1,6],[0,5]]],"6":[[[4,0],[1,0],[0,1],[0,5],[1,6],[3,6],[4,5],[4,4],[3,3],[0,3]]],"7":[[[0,0],[4,0],[1,6]]],"8":[[[0,1],[1,0],[3,0],[4,1],[4,2],[3,3],[1,3],[0,2],[0,1]],[[1,3],[3,3],[4,4],[4,5],[3,6],[1,6],[0,5],[0,4],[1,3]]],"9":[[[0,6],[3,6],[4,5],[4,1],[3,0],[1,0],[0,1],[0,2],[1,3],[4,3]]],"A":[[[0,6],[2,0],[4,6]],[[1,4],[3,4]]],"B":[[[0,0],[0,6]],[[0,0],[3,0],[4,1],[4,2],[3,3],[0,3]],[[0,3],[3,3],[4,4],[4,5],[3,6],[0,6]]],"C":[[[4,1],[3,0],[1,0],[0,1],[0,5],[1,6],[3,6],[4,5]]],"D":[[[0,0],[0,6]],[[0,0],[3,0],[4,1],[4,5],[3,6],[0,6]]],"E":[[[4,0],[0,0],[0,6],[4,6]],[[0,3],[3,3]]],"F":[[[4,0],[0,0],[0,6]],[[0,3],[3,3]]],"G":[[[4,1],[3,0],[1,0],[0,1],[0,5],[1,6],[3,6],[4,5],[4,4],[2,4]]],"H":[[[0,0],[0,6]],[[4,0],[4,6]],[[0,3],[4,3]]],"I":[[[1,0],[3,0]],[[2,0],[2,6]],[[1,6],[3,6]]],"J":[[[3,0],[3,5],[2,6],[1,6],[0,5]]],"K":[[[0,0],[0,6]],[[4,0],[0,3.5],[4,6]]],"L":[[[0,0],[0,6],[4,6]]],"M":[[[0,6],[0,0],[2,3],[4,0],[4,6]]],"N":[[[0,6],[0,0],[4,6],[4,0]]],"O":[[[1,0],[3,0],[4,1],[4,5],[3,6],[1,6],[0,5],[0,1],[1,0]]],"P":[[[0,6],[0,0],[3,0],[4,1],[4,2],[3,3],[0,3]]],"Q":[[[1,0],[3,0],[4,1],[4,5],[3,6],[1,6],[0,5],[0,1],[1,0]],[[3,5],[4,6]]],"R":[[[0,6],[0,0],[3,0],[4,1],[4,2],[3,3],[0,3]],[[2,3],[4,6]]],"S":[[[4,1],[3,0],[1,0],[0,1],[0,2],[1,3],[3,3],[4,4],[4,5],[3,6],[1,6],[0,5]]],"T":[[[0,0],[4,0]],[[2,0],[2,6]]],"U":[[[0,0],[0,5],[1,6],[3,6],[4,5],[4,0]]],"V":[[[0,0],[2,6],[4,0]]],"W":[[[0,0],[1,6],[2,3],[3,6],[4,0]]],"X":[[[0,0],[4,6]],[[4,0],[0,6]]],"Y":[[[0,0],[2,3],[4,0]],[[2,3],[2,6]]],"Z":[[[0,0],[4,0],[0,6],[4,6]]],".":[[[2,6],[2,6.4]]],",":[[[2,6],[1.5,7]]],":":[[[2,2.5],[2,3]],[[2,5.6],[2,6.1]]],"!":[[[2,0],[2,4]],[[2,6],[2,6.4]]],"?":[[[0,1],[1,0],[3,0],[4,1],[4,2],[2,4],[2,5]],[[2,6],[2,6.4]]],"-":[[[1,3],[3,3]]],"+":[[[2,2],[2,4]],[[1,3],[3,3]]],"=":[[[1,2],[3,2]],[[1,4],[3,4]]],"/":[[[0,6],[4,0]]],"<":[[[4,1],[0,3],[4,5]]],">":[[[0,1],[4,3],[0,5]]],"(":[[[3,0],[1,2],[1,4],[3,6]]],")":[[[1,0],[3,2],[3,4],[1,6]]],"\"":[[[1,0],[1,1]],[[3,0],[3,1]]],"'":[[[2,0],[2,1]]],"*":[[[2,1],[2,4]],[[1,1.8],[3,3.2]],[[3,1.8],[1,3.2]]],"%":[[[0,6],[4,0]],[[0.6,1],[1,0.6]],[[3,5.4],[3.4,5]]]}''')


def text_width(s, size=16, spacing=2):
    return (len(s) * (4 + spacing) - spacing) * (size / 6)


def r1(n):
    return js_round(n * 10) / 10


def text_parts(s, size=16, spacing=2):
    sc = size / 6
    adv = (4 + spacing) * sc
    parts = []
    x0 = 0.0
    for ch in s.upper():
        glyph = FONT.get(ch)
        if glyph:
            for line in glyph:
                d = 'M' + js_str(r1(x0 + line[0][0] * sc)) + ' ' + js_str(r1((line[0][1] - 6) * sc))
                for pt in line[1:]:
                    d += 'L' + js_str(r1(x0 + pt[0] * sc)) + ' ' + js_str(r1((pt[1] - 6) * sc))
                parts.append(d)
        x0 += adv
    return parts


def esc(s):
    return re.sub(r'[<>&"]', lambda m: {'<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;'}[m.group(0)], js_str(s))


def grad_def(fill, gid):
    stops = ''.join('<stop offset="%s" stop-color="%s"/>' % (js_str(o), c) for o, c in sorted(fill['stops'], key=lambda s: s[0]))
    if fill.get('type') == 'radial':
        return '<radialGradient id="%s" gradientUnits="userSpaceOnUse" cx="%s" cy="%s" r="%s">%s</radialGradient>' % (
            gid, js_str(fill.get('cx')), js_str(fill.get('cy')), js_str(fill.get('r')), stops)
    return '<linearGradient id="%s" gradientUnits="userSpaceOnUse" x1="%s" y1="%s" x2="%s" y2="%s">%s</linearGradient>' % (
        gid, js_str(fill.get('x1')), js_str(fill.get('y1')), js_str(fill.get('x2')), js_str(fill.get('y2')), stops)


def part_attrs(p, key, defs):
    fill = p.get('fill')
    grad = isinstance(fill, dict)
    f = 'url(#g-%s)' % key if grad else (js_str(fill) if fill is not None else 'none')
    stroke = p.get('stroke')
    attrs = 'fill="%s" stroke="%s"' % (f, js_str(stroke) if stroke is not None else 'none')
    if p.get('width'):
        attrs += ' stroke-width="%s"' % js_str(p['width'])
    if stroke:
        attrs += ' stroke-linejoin="round" stroke-linecap="round"'
    if grad:
        d = grad_def(fill, 'g-' + key)
        if d not in defs:
            defs.append(d)
    if p.get('clip'):
        cid = 'c-' + key
        d = '<clipPath id="%s"><path d="%s"/></clipPath>' % (cid, p['clip'])
        if d not in defs:
            defs.append(d)
        attrs += ' clip-path="url(#%s)"' % cid
    return attrs


def view_matrix(world, e):
    cam = world.camera
    if not cam or e.get('fixed'):
        return None
    if cam.get('rot'):
        raise NotImplementedError('camera rotation is outside the core conformance level')
    p = e.get('parallax', 1)
    W2, H2 = world.width / 2, world.height / 2
    z = math.pow(cam.get('zoom', 1), p)
    cx, cy = W2 + (cam['x'] - W2) * p, H2 + (cam['y'] - H2) * p
    c, s = math.cos(-0.0) * z, math.sin(-0.0) * z
    return [c, s, -s, c, W2 - (c * cx - s * cy), H2 - (s * cx + c * cy)]


def entity_matrix(e):
    c, s = math.cos(e['rot']) * e['scale'], math.sin(e['rot']) * e['scale']
    return [c, s, -s, c, e['x'], e['y']]


def mul(m, n):
    return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
            m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
            m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]


def draw_list(world, cull=True, margin=2):
    ents = world.entities
    if any(e.get('layer') for e in ents):
        ents = [e for _, e in sorted(enumerate(ents), key=lambda p: (p[1].get('layer', 0), p[0]))]
    out = []
    for e in ents:
        if e.get('hidden'):
            continue
        v = view_matrix(world, e)
        m = (mul(v, entity_matrix(e)) if v else entity_matrix(e)) if world.camera else None
        if cull:
            cam, p = world.camera, e.get('parallax', 1)
            vz = 1 if not cam or e.get('fixed') else (cam.get('zoom', 1) if p == 1 else math.pow(cam.get('zoom', 1), p))
            rad0, pad = world.geom(e)
            rad = (rad0 + pad) * abs(e['scale']) * vz + margin + e.get('width', 0)
            x, y = (m[4], m[5]) if m else (e['x'], e['y'])
            if x + rad < 0 or y + rad < 0 or x - rad > world.width or y - rad > world.height:
                continue
        out.append((e, m))
    return out


def to_svg(world, hud=True, cull=True):
    defs_extra = []
    defs = ''
    for name, s in world.shapes.items():
        defs += '<g id="%s">' % name + ''.join(
            '<path d="%s" %s/>' % (esc(p['d']), part_attrs(p, '%s-%d' % (name, i), defs_extra)) for i, p in enumerate(s.parts)) + '</g>'
    uses = ''
    cam = world.camera is not None
    for e, m in draw_list(world, cull):
        if cam:
            t = 'matrix(%s)' % ' '.join(js_str(to_fixed(v, 4)) for v in m)
        else:
            t = 'translate(%s %s) rotate(%s) scale(%s)' % (js_str(r2(e['x'])), js_str(r2(e['y'])),
                                                           js_str(r2(e['rot'] * 180 / math.pi)), js_str(r2(e['scale'])))
        if e.get('d') is not None:
            p = {'d': e['d'], 'fill': e.get('fill'), 'stroke': e.get('stroke'), 'width': e.get('width')}
            uses += '<path data-id="%s" d="%s" %s transform="%s"/>' % (e['id'], esc(e['d']), part_attrs(p, 'e-' + js_str(e['id']), defs_extra), t)
        elif e.get('shape'):
            uses += '<use href="#%s" data-id="%s" transform="%s"/>' % (e['shape'], e['id'], t)
    hud_svg = ''
    if hud and js_truthy(world.state.get('hud')):
        hud_svg = ('<g transform="translate(12 24)" fill="none" stroke="#fff" stroke-width="1.5" '
                   'stroke-linecap="round" stroke-linejoin="round">' +
                   ''.join('<path d="%s"/>' % d for d in text_parts(js_str(world.state['hud']))) + '</g>')
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %s %s" width="%s" height="%s">' % (
        js_str(world.width), js_str(world.height), js_str(world.width), js_str(world.height)) +
        '<rect width="100%%" height="100%%" fill="%s"/><defs>%s%s</defs>%s%s</svg>' % (
            world.background, defs, ''.join(defs_extra), uses, hud_svg))


def hash64(s):
    """Two-lane FNV-1a over UTF-16 code units, exactly like src/replay.js."""
    units = s.encode('utf-16-le')
    h1 = 0x811c9dc5
    h2 = (0x01000193 ^ (len(units) // 2)) & 0xffffffff
    for i in range(0, len(units), 2):
        c = units[i] | (units[i + 1] << 8)
        h1 = ((h1 ^ c) * 16777619) & 0xffffffff
        h2 = (((h2 ^ c) * 2246822519) & 0xffffffff) ^ (h1 >> 13)
    return '%08x%08x' % (h1, h2)


def digest(game):
    return hash64(game.to_svg())


def apply_recording(game, rec):
    inputs = rec['inputs']
    i = 0
    for f in range(rec['steps']):
        while i < len(inputs) and inputs[i][0] == f:
            _, kind, action = inputs[i]; i += 1
            if kind == 'p':
                game.press(action)
            else:
                game.release(action)
        game.step(1)
    return game

# --------------------------------------------------------------------------- conformance

def conform(path):
    """Run the conformance suite: every checkpoint digest must match the reference."""
    import os
    with open(path, encoding='utf-8') as fh:
        suite = json.load(fh)
    root = os.path.dirname(os.path.dirname(os.path.abspath(path)))
    passed = failed = 0
    for case in suite['cases']:
        with open(os.path.join(root, case['cartridge']), encoding='utf-8') as fh:
            g = load_cartridge(json.load(fh), case['seed'], case.get('fps', 60))
        want = dict((f, d) for f, d in case['digests'])
        inputs, i = case['inputs'], 0
        last = max(want)
        for f in range(last):
            while i < len(inputs) and inputs[i][0] == f:
                _, k, act = inputs[i]; i += 1
                g.press(act) if k == 'p' else g.release(act)
            g.step(1)
            fr = g.world.frame
            if fr in want:
                got = digest(g)
                if got == want[fr]:
                    passed += 1
                else:
                    failed += 1
                    print('FAIL %s seed %d frame %d: %s != %s' % (case['cartridge'], case['seed'], fr, got, want[fr]))
    print('conformance (%s): %d passed, %d failed' % (suite.get('level', 'core'), passed, failed))
    return 0 if failed == 0 else 1

# --------------------------------------------------------------------------- CLI

def main(argv):
    import argparse, os
    ap = argparse.ArgumentParser(prog='vertex.py')
    sub = ap.add_subparsers(dest='cmd', required=True)
    r = sub.add_parser('run'); r.add_argument('cartridge'); r.add_argument('--seed', type=int, default=1)
    r.add_argument('--steps', type=int, default=600); r.add_argument('--fps', type=int, default=60); r.add_argument('--svg')
    p = sub.add_parser('play'); p.add_argument('recording'); p.add_argument('--cartridge'); p.add_argument('--svg')
    c = sub.add_parser('conform'); c.add_argument('cases', nargs='?', default='conformance/cases.json')
    a = ap.parse_args(argv)
    if a.cmd == 'conform':
        return conform(a.cases)
    if a.cmd == 'run':
        with open(a.cartridge, encoding='utf-8') as fh:
            g = load_cartridge(json.load(fh), a.seed, a.fps)
        g.step(a.steps)
        if a.svg:
            with open(a.svg, 'w', encoding='utf-8') as fh:
                fh.write(g.to_svg())
        print('frame %d | %s | digest %s' % (g.world.frame, js_str(g.world.state.get('hud', '')), digest(g)))
        return 0
    with open(a.recording, encoding='utf-8') as fh:
        rec = json.load(fh)
    path = a.cartridge or rec.get('scene')
    if not os.path.exists(path):
        path = os.path.join(os.path.dirname(a.recording), os.path.basename(path))
    with open(path, encoding='utf-8') as fh:
        g = load_cartridge(json.load(fh), rec['seed'], rec.get('fps', 60))
    apply_recording(g, rec)
    if a.svg:
        with open(a.svg, 'w', encoding='utf-8') as fh:
            fh.write(g.to_svg())
    d = digest(g)
    ok = d == rec['digest']
    print('frame %d | digest %s | replay %s' % (g.world.frame, d, 'exact' if ok else 'MISMATCH (expected %s)' % rec['digest']))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
