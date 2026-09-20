'use strict';

const MAX_DISTINCT = 10000;
const MAX_EXAMPLES = 3;
const MAX_EXAMPLE_LEN = 40;
const DELIMITERS = [',', ';', '\t', '|'];

function detectDelimiter(line) {
  let best = ',';
  let bestCount = 0;
  for (const d of DELIMITERS) {
    let count = 0;
    let inQuotes = false;
    for (const c of line) {
      if (c === '"') inQuotes = !inQuotes;
      else if (c === d && !inQuotes) count++;
    }
    if (count > bestCount) { best = d; bestCount = count; }
  }
  return best;
}

function firstNewlineOutsideQuotes(text) {
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === '\n' && !inQuotes) return i;
  }
  return -1;
}

function classifyValue(value, delimiter) {
  const s = value.trim();
  if (/^(true|false|tak|nie|yes|no)$/i.test(s)) return 'boolean';
  if (/^[+-]?\d+$/.test(s)) return 'integer';
  if (/^[+-]?(\d+\.\d*|\.\d+|\d+)(e[+-]?\d+)?$/i.test(s) && /[.e]/i.test(s)) return 'number';
  if (delimiter !== ',' && /^[+-]?\d+,\d+$/.test(s)) return 'number';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'date';
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(s)) return 'datetime';
  return 'string';
}

function resolveType(kinds) {
  const keys = Object.keys(kinds);
  if (!keys.length) return 'empty';
  const only = (...allowed) => keys.every((k) => allowed.includes(k));
  if (only('integer')) return 'integer';
  if (only('integer', 'number')) return 'number';
  if (only('boolean')) return 'boolean';
  if (only('date')) return 'date';
  if (only('date', 'datetime')) return 'datetime';
  return 'string';
}

function makeColumn(header, index) {
  const name = String(header || '').replace(/^\uFEFF/, '').trim();
  return {
    name: name || 'column_' + (index + 1),
    nonEmpty: 0,
    empty: 0,
    kinds: {},
    distinct: new Set(),
    distinctOverflow: false,
    examples: [],
  };
}

class CsvDesigner {
  constructor(opts = {}) {
    this.delimiter = opts.delimiter || null;
    this.headBuffer = '';
    this.inQuotes = false;
    this.maybeClose = false;
    this.field = '';
    this.fieldHasData = false;
    this.record = [];
    this.columns = null;
    this.rowCount = 0;
    this.ended = false;
  }

  push(chunk) {
    if (!this.delimiter) {
      this.headBuffer += chunk;
      const nl = firstNewlineOutsideQuotes(this.headBuffer);
      if (nl < 0 && this.headBuffer.length < 4 * 1024 * 1024) return;
      this.delimiter = detectDelimiter(nl < 0 ? this.headBuffer : this.headBuffer.slice(0, nl));
      const buffered = this.headBuffer;
      this.headBuffer = '';
      this._parse(buffered);
      return;
    }
    this._parse(chunk);
  }

  end() {
    if (!this.delimiter && this.headBuffer) {
      this.delimiter = detectDelimiter(this.headBuffer);
      const buffered = this.headBuffer;
      this.headBuffer = '';
      this._parse(buffered);
    }
    if (this.maybeClose) { this.inQuotes = false; this.maybeClose = false; }
    if (this.fieldHasData || this.record.length) { this._endField(); this._endRecord(); }
    this.ended = true;
    return this;
  }

  _parse(text) {
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (this.maybeClose) {
        this.maybeClose = false;
        if (c === '"') { this.field += '"'; continue; }
        this.inQuotes = false;
      }
      if (this.inQuotes) {
        if (c === '"') { this.maybeClose = true; continue; }
        this.field += c;
        continue;
      }
      if (c === '"' && this.field === '') { this.inQuotes = true; this.fieldHasData = true; continue; }
      if (c === this.delimiter) { this._endField(); continue; }
      if (c === '\r') continue;
      if (c === '\n') { this._endField(); this._endRecord(); continue; }
      this.field += c;
      this.fieldHasData = true;
    }
  }

  _endField() {
    this.record.push(this.field);
    this.field = '';
    this.fieldHasData = false;
  }

  _endRecord() {
    const record = this.record;
    this.record = [];
    if (record.length === 1 && record[0] === '') return;
    if (!this.columns) {
      this.columns = record.map((h, idx) => makeColumn(h, idx));
      return;
    }
    this.rowCount++;
    for (let i = 0; i < record.length; i++) {
      if (!this.columns[i]) this.columns[i] = makeColumn('', i);
      this._observe(this.columns[i], record[i]);
    }
    for (let i = record.length; i < this.columns.length; i++) this.columns[i].empty++;
  }

  _observe(col, value) {
    if (value === '') { col.empty++; return; }
    col.nonEmpty++;
    const kind = classifyValue(value, this.delimiter);
    col.kinds[kind] = (col.kinds[kind] || 0) + 1;
    if (col.distinct.size < MAX_DISTINCT) col.distinct.add(value);
    else if (!col.distinct.has(value)) col.distinctOverflow = true;
    if (col.examples.length < MAX_EXAMPLES) {
      const short = value.length > MAX_EXAMPLE_LEN ? value.slice(0, MAX_EXAMPLE_LEN) + '…' : value;
      if (!col.examples.includes(short)) col.examples.push(short);
    }
  }

  model(opts = {}) {
    if (!this.ended) this.end();
    const columns = (this.columns || []).map((col) => ({
      name: col.name,
      type: null,
      typeKeys: [resolveType(col.kinds)],
      nullable: col.empty > 0,
      primaryKey: false,
      unique: !col.distinctOverflow && col.nonEmpty > 1 && col.distinct.size === col.nonEmpty,
      default: null,
      references: null,
      comment: null,
      autoIncrement: false,
      presence: this.rowCount ? col.nonEmpty / this.rowCount : null,
      examples: col.examples,
    }));
    return {
      sourceFormat: 'csv',
      delimiter: this.delimiter,
      tables: [{
        name: opts.name || 'data',
        kind: 'dataset',
        comment: null,
        rowCount: this.rowCount,
        columns,
        primaryKey: [],
        indexes: [],
      }],
      relations: [],
      notes: [],
      stats: { rows: this.rowCount },
    };
  }
}

function readCsvText(text, opts = {}) {
  const designer = new CsvDesigner(opts);
  designer.push(text);
  designer.end();
  return designer.model(opts);
}

module.exports = { CsvDesigner, readCsvText, detectDelimiter, classifyValue };
