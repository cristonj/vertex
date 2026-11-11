// Zero-dependency scene validation with agent-friendly messages.
// The formal spec is schema/scene.schema.json; this mirrors it so the engine can
// reject a bad scene at construction time with a precise, fixable error.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string';

const ENTITY_NUMS = ['x', 'y', 'rot', 'scale', 'vx', 'vy', 'vr', 'drag'];

export function checkScene(doc) {
  const errors = [];
  const err = (path, message) => errors.push({ path, message });
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    errors.push({ path: '', message: 'scene must be a JSON object' });
    return errors;
  }
  if (doc.width !== undefined && !isNum(doc.width)) err('width', 'must be a number');
  if (doc.height !== undefined && !isNum(doc.height)) err('height', 'must be a number');
  if (doc.background !== undefined && !isStr(doc.background)) err('background', 'must be a CSS color string');

  const names = new Set();
  if (doc.shapes !== undefined) {
    if (typeof doc.shapes !== 'object' || doc.shapes === null || Array.isArray(doc.shapes)) {
      err('shapes', 'must be an object mapping name -> shape');
    } else {
      for (const [name, s] of Object.entries(doc.shapes)) {
        names.add(name);
        checkShape(s, `shapes.${name}`, err);
      }
    }
  }

  if (doc.entities !== undefined) {
    if (!Array.isArray(doc.entities)) err('entities', 'must be an array');
    else doc.entities.forEach((e, i) => checkEntity(e, `entities[${i}]`, names, err));
  }
  return errors;
}

function checkShape(s, path, err) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) { err(path, 'shape must be an object'); return; }
  if (s.parts !== undefined) {
    if (!Array.isArray(s.parts)) { err(`${path}.parts`, 'must be an array'); return; }
    if (!s.parts.length) err(`${path}.parts`, 'must not be empty');
    s.parts.forEach((p, i) => checkShape(p, `${path}.parts[${i}]`, err));
    if (s.d !== undefined) err(`${path}.d`, 'a shape with parts should not also have d');
  } else if (!isStr(s.d) || !s.d.trim()) {
    err(`${path}.d`, 'must be a non-empty SVG path string (or provide parts)');
  }
  for (const k of ['fill', 'stroke']) if (s[k] !== undefined && !isStr(s[k])) err(`${path}.${k}`, 'must be a CSS color string');
  if (s.width !== undefined && !isNum(s.width)) err(`${path}.width`, 'must be a number');
}

function checkEntity(e, path, names, err) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) { err(path, 'entity must be an object'); return; }
  if (e.id !== undefined && !isStr(e.id)) err(`${path}.id`, 'must be a string');
  if (e.shape !== undefined) {
    if (!isStr(e.shape)) err(`${path}.shape`, 'must be a string');
    else if (names.size && !names.has(e.shape)) err(`${path}.shape`, `unknown shape "${e.shape}"`);
  }
  for (const k of ENTITY_NUMS) if (e[k] !== undefined && !isNum(e[k])) err(`${path}.${k}`, 'must be a number');
  if (e.tags !== undefined && !(Array.isArray(e.tags) && e.tags.every(isStr))) err(`${path}.tags`, 'must be an array of strings');
  if (e.data !== undefined && (typeof e.data !== 'object' || e.data === null || Array.isArray(e.data))) err(`${path}.data`, 'must be an object');
}

/** Validate, throwing an error an agent can read and fix directly. */
export function assertValidScene(doc) {
  const errors = checkScene(doc);
  if (errors.length) {
    throw new Error('Invalid scene:\n' + errors.map((e) => `  at ${e.path || '<root>'}: ${e.message}`).join('\n'));
  }
  return true;
}
