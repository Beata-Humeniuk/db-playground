'use strict';

const { forLanguage } = require('./nls');

const ARRAY_SAMPLE = 20;
const MAX_EXAMPLES = 3;
const MAX_EXAMPLE_LEN = 40;
const MAX_SCANNED_DOCS = 100000;

function extendedType(value) {
  const keys = Object.keys(value);
  if (!keys.length || keys.length > 2) return null;
  const k = keys[0];
  if (k === '$oid') return { type: 'objectId', example: String(value.$oid) };
  if (k === '$date') {
    const v = value.$date;
    return { type: 'datetime', example: typeof v === 'object' && v ? String(v.$numberLong) : String(v) };
  }
  if (k === '$numberLong' || k === '$numberInt') return { type: 'integer', example: String(value[k]) };
  if (k === '$numberDouble' || k === '$numberDecimal') return { type: 'number', example: String(value[k]) };
  if (k === '$uuid') return { type: 'uuid', example: String(value.$uuid) };
  if (k === '$binary') return { type: 'binary', example: null };
  if (k === '$timestamp') return { type: 'timestamp', example: null };
  if (k === '$regularExpression') return { type: 'regex', example: null };
  return null;
}

function truncate(s) {
  return s.length > MAX_EXAMPLE_LEN ? s.slice(0, MAX_EXAMPLE_LEN) + '…' : s;
}

class JsonDesigner {
  constructor() {
    this.fields = new Map();
    this.docCount = 0;
    this.scannedCount = 0;
    this.notes = [];
  }

  pushDoc(doc) {
    this.docCount++;
    if (this.scannedCount >= MAX_SCANNED_DOCS) return;
    this.scannedCount++;
    const seen = new Set();
    if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
      for (const key of Object.keys(doc)) this._record(key, doc[key], seen);
    } else {
      this._record('(value)', doc, seen);
    }
  }

  _field(path) {
    let f = this.fields.get(path);
    if (!f) {
      f = { docs: 0, types: new Map(), examples: [] };
      this.fields.set(path, f);
    }
    return f;
  }

  _record(path, value, seen) {
    let type;
    let example = null;
    let recurse = null;
    if (value === null || value === undefined) {
      type = 'null';
    } else if (Array.isArray(value)) {
      type = 'array';
      recurse = 'array';
    } else if (typeof value === 'object') {
      const ext = extendedType(value);
      if (ext) { type = ext.type; example = ext.example; }
      else { type = 'object'; recurse = 'object'; }
    } else if (typeof value === 'number') {
      type = Number.isInteger(value) ? 'integer' : 'number';
      example = String(value);
    } else if (typeof value === 'boolean') {
      type = 'boolean';
      example = String(value);
    } else {
      type = 'string';
      example = truncate(String(value));
    }

    const field = this._field(path);
    if (!seen.has(path)) { field.docs++; seen.add(path); }
    field.types.set(type, (field.types.get(type) || 0) + 1);
    if (example != null && field.examples.length < MAX_EXAMPLES && !field.examples.includes(example)) {
      field.examples.push(example);
    }

    if (recurse === 'object') {
      for (const key of Object.keys(value)) this._record(path + '.' + key, value[key], seen);
    } else if (recurse === 'array') {
      for (const el of value.slice(0, ARRAY_SAMPLE)) this._record(path + '[]', el, seen);
    }
  }

  model(opts = {}) {
    if (this.scannedCount < this.docCount) {
      this.notes.push(
        'Scanned the first ' + this.scannedCount.toLocaleString('en-US') +
        ' of ' + this.docCount.toLocaleString('en-US') + ' documents.'
      );
    }
    const columns = [];
    for (const [path, field] of this.fields) {
      const types = [...field.types.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([t]) => t)
        .filter((t, _, arr) => t !== 'null' || arr.length === 1);
      const hasNull = field.types.has('null');
      columns.push({
        name: path,
        type: null,
        typeKeys: types.length ? types : ['null'],
        nullable: hasNull || field.docs < this.scannedCount,
        primaryKey: path === '_id',
        unique: false,
        default: null,
        references: null,
        comment: null,
        autoIncrement: false,
        presence: this.scannedCount ? field.docs / this.scannedCount : null,
        examples: field.examples,
      });
    }
    return {
      sourceFormat: 'json',
      inputShape: opts.inputShape || null,
      tables: [{
        name: opts.name || 'kolekcja',
        kind: 'collection',
        comment: null,
        rowCount: this.docCount,
        columns,
        primaryKey: columns.some((c) => c.name === '_id') ? ['_id'] : [],
        indexes: [],
      }],
      relations: [],
      notes: this.notes,
      stats: { documents: this.docCount, scanned: this.scannedCount },
    };
  }
}

class NdjsonScanner {
  constructor() {
    this.designer = new JsonDesigner();
    this.buffer = '';
    this.badLines = 0;
    this.first = true;
  }

  push(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop();
    for (const line of lines) this._line(line);
  }

  _line(line) {
    let l = line.trim();
    if (this.first) {
      l = l.replace(/^\uFEFF/, '');
      if (l) this.first = false;
    }
    if (!l) return;
    try {
      this.designer.pushDoc(JSON.parse(l));
    } catch (err) {
      this.badLines++;
    }
  }

  end(opts = {}) {
    this._line(this.buffer);
    this.buffer = '';
    if (!this.designer.docCount) return null;
    if (this.badLines) {
      this.designer.notes.push('Skipped ' + this.badLines + ' lines that could not be parsed as JSON.');
    }
    return this.designer.model({ ...opts, inputShape: 'ndjson' });
  }
}

function readJsonText(text, opts = {}) {
  const nls = forLanguage(opts.language);
  const designer = new JsonDesigner();
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  let inputShape = 'document';
  if (!trimmed) throw new Error(nls.t('error.jsonEmptyFile'));
  if (trimmed[0] === '[') {
    const docs = JSON.parse(trimmed);
    if (!Array.isArray(docs)) throw new Error(nls.t('error.jsonNotArray'));
    inputShape = 'array';
    for (const doc of docs) designer.pushDoc(doc);
  } else {
    let single = null;
    let singleOk = false;
    try {
      single = JSON.parse(trimmed);
      singleOk = true;
    } catch (err) {
      singleOk = false;
    }
    if (singleOk) {
      designer.pushDoc(single);
    } else {
      inputShape = 'ndjson';
      let badLines = 0;
      for (const line of trimmed.split(/\r?\n/)) {
        const l = line.trim();
        if (!l) continue;
        try {
          designer.pushDoc(JSON.parse(l));
        } catch (err) {
          badLines++;
        }
      }
      if (!designer.docCount) throw new Error(nls.t('error.jsonUnparsable'));
      if (badLines) designer.notes.push('Skipped ' + badLines + ' lines that could not be parsed as JSON.');
    }
  }
  return designer.model({ ...opts, inputShape });
}

module.exports = { JsonDesigner, NdjsonScanner, readJsonText };
