'use strict';

const INTERESTING = /^(create\s+(table|(unique\s+)?index)|alter\s+table|comment\s+on|copy)\b/i;
const DECIDE_AFTER = 32;
const DOLLAR_TAG = /^\$[A-Za-z_]\w*\$|^\$\$/;
const SPECIAL = /['"`;$/-]/g;

const TYPE_STOP_WORDS = new Set([
  'not', 'null', 'default', 'primary', 'unique', 'references', 'constraint',
  'check', 'collate', 'comment', 'auto_increment', 'generated', 'identity',
  'on', 'key', 'stored', 'virtual', 'as',
]);

function emptyModel() {
  return {
    sourceFormat: 'sql',
    tables: [],
    tableIndex: new Map(),
    relations: [],
    notes: [],
    stats: { schemaStatements: 0, skippedStatements: 0 },
    dialectVotes: { mysql: 0, postgres: 0 },
    dialect: null,
  };
}

function getTable(model, name) {
  let table = model.tableIndex.get(name);
  if (!table) {
    table = {
      name,
      kind: 'table',
      comment: null,
      rowCount: null,
      columns: [],
      primaryKey: [],
      indexes: [],
    };
    model.tableIndex.set(name, table);
    model.tables.push(table);
  }
  return table;
}

function getColumn(table, name) {
  let col = table.columns.find((c) => c.name === name);
  if (!col) {
    col = {
      name,
      type: '',
      nullable: true,
      primaryKey: false,
      unique: false,
      default: null,
      references: null,
      comment: null,
      autoIncrement: false,
    };
    table.columns.push(col);
  }
  return col;
}

function tokenize(sql) {
  const tokens = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"' || c === '`') {
      let v = '';
      i++;
      while (i < n) {
        if (sql[i] === c) {
          if (sql[i + 1] === c) { v += c; i += 2; continue; }
          i++;
          break;
        }
        v += sql[i++];
      }
      tokens.push({ t: 'id', v });
      continue;
    }
    if (c === '[') {
      let v = '';
      i++;
      while (i < n && sql[i] !== ']') v += sql[i++];
      i++;
      tokens.push({ t: 'id', v });
      continue;
    }
    if (c === "'") {
      let v = '';
      i++;
      while (i < n) {
        if (sql[i] === '\\' && i + 1 < n) { v += sql[i + 1]; i += 2; continue; }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { v += "'"; i += 2; continue; }
          i++;
          break;
        }
        v += sql[i++];
      }
      tokens.push({ t: 'str', v });
      continue;
    }
    if (c === '$') {
      const m = DOLLAR_TAG.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        tokens.push({ t: 'str', v: end < 0 ? sql.slice(i + tag.length) : sql.slice(i + tag.length, end) });
        i = end < 0 ? n : end + tag.length;
        continue;
      }
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[\w$]/.test(sql[j])) j++;
      const raw = sql.slice(i, j);
      tokens.push({ t: 'word', v: raw.toLowerCase(), raw });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < n && /[\d.]/.test(sql[j])) j++;
      tokens.push({ t: 'num', v: sql.slice(i, j) });
      i = j;
      continue;
    }
    tokens.push({ t: 'punct', v: c });
    i++;
  }
  return tokens;
}

const isWord = (tk, w) => Boolean(tk) && tk.t === 'word' && tk.v === w;
const identName = (tk) => (tk.t === 'id' ? tk.v : tk.raw || tk.v);

function readQualifiedName(tokens, i) {
  const parts = [];
  while (i < tokens.length && (tokens[i].t === 'id' || tokens[i].t === 'word')) {
    parts.push(identName(tokens[i]));
    i++;
    if (tokens[i] && tokens[i].t === 'punct' && tokens[i].v === '.') { i++; continue; }
    break;
  }
  return { parts, next: i };
}

function tableKey(parts) {
  const p = parts.filter(Boolean);
  if (p.length <= 1) return p[0] || '';
  const schema = p[p.length - 2].toLowerCase();
  if (schema === 'public' || schema === 'dbo') return p[p.length - 1];
  return p[p.length - 2] + '.' + p[p.length - 1];
}

function splitParenItems(tokens, i) {
  const items = [];
  let cur = [];
  let depth = 0;
  for (; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.t === 'punct' && tk.v === '(') {
      depth++;
      if (depth === 1) continue;
    } else if (tk.t === 'punct' && tk.v === ')') {
      depth--;
      if (depth === 0) { i++; break; }
    } else if (tk.t === 'punct' && tk.v === ',' && depth === 1) {
      items.push(cur);
      cur = [];
      continue;
    }
    if (depth >= 1) cur.push(tk);
  }
  if (cur.length) items.push(cur);
  return { items, next: i };
}

function columnNamesFromGroup(tokens, i) {
  const { items, next } = splitParenItems(tokens, i);
  const names = [];
  for (const item of items) {
    const tk = item.find((x) => x.t === 'id' || x.t === 'word');
    if (tk) names.push(identName(tk));
  }
  return { names, next };
}

function renderTokens(tokens) {
  let out = '';
  let prev = null;
  for (const tk of tokens) {
    const piece = tk.t === 'str' ? "'" + tk.v + "'" : tk.t === 'id' ? tk.v : tk.raw || tk.v;
    const noSpaceBefore = tk.t === 'punct' && '()],.:'.includes(tk.v);
    const noSpaceAfterPrev = prev && prev.t === 'punct' && '([.:'.includes(prev.v);
    if (out && !noSpaceBefore && !noSpaceAfterPrev) out += ' ';
    out += piece;
    prev = tk;
  }
  return out;
}

function captureExpr(tokens, i) {
  const collected = [];
  let depth = 0;
  for (; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.t === 'punct' && tk.v === '(') depth++;
    if (tk.t === 'punct' && tk.v === ')') {
      if (depth === 0) break;
      depth--;
    }
    if (depth === 0 && tk.t === 'word' && TYPE_STOP_WORDS.has(tk.v) && collected.length) break;
    collected.push(tk);
    if (depth === 0 && collected.length === 1 && tk.t === 'word' && tk.v === 'null') { i++; break; }
  }
  return { text: renderTokens(collected), next: i };
}

function parseColumn(item, table, model) {
  const col = getColumn(table, identName(item[0]));
  let i = 1;
  const typeTokens = [];
  let depth = 0;
  for (; i < item.length; i++) {
    const tk = item[i];
    if (tk.t === 'punct' && tk.v === '(') depth++;
    if (tk.t === 'punct' && tk.v === ')') depth--;
    if (depth === 0 && tk.t === 'word' && TYPE_STOP_WORDS.has(tk.v)) break;
    typeTokens.push(tk);
  }
  col.type = renderTokens(typeTokens)
    .replace(/\s*\(\s*/g, '(')
    .replace(/\s*\)\s*/g, ')')
    .replace(/\s*,\s*/g, ',')
    .replace(/\s+character set \S+$/i, '');
  if (/^(big|small)?serial\b/i.test(col.type)) col.autoIncrement = true;

  while (i < item.length) {
    const tk = item[i];
    if (!tk || tk.t !== 'word') { i++; continue; }
    if (tk.v === 'not' && isWord(item[i + 1], 'null')) { col.nullable = false; i += 2; continue; }
    if (tk.v === 'null') { i++; continue; }
    if (tk.v === 'default') {
      const expr = captureExpr(item, i + 1);
      col.default = expr.text || null;
      i = expr.next;
      continue;
    }
    if (tk.v === 'primary') { col.primaryKey = true; i += isWord(item[i + 1], 'key') ? 2 : 1; continue; }
    if (tk.v === 'unique') { col.unique = true; i++; continue; }
    if (tk.v === 'auto_increment') { col.autoIncrement = true; model.dialectVotes.mysql++; i++; continue; }
    if (tk.v === 'generated' || tk.v === 'identity') { col.autoIncrement = true; i++; continue; }
    if (tk.v === 'comment' && item[i + 1] && item[i + 1].t === 'str') { col.comment = item[i + 1].v; i += 2; continue; }
    if (tk.v === 'references') {
      const ref = readQualifiedName(item, i + 1);
      let refColumn = null;
      let j = ref.next;
      if (item[j] && item[j].t === 'punct' && item[j].v === '(') {
        const g = columnNamesFromGroup(item, j);
        refColumn = g.names[0] || null;
        j = g.next;
      }
      col.references = { table: tableKey(ref.parts), column: refColumn };
      model.relations.push({
        fromTable: table.name,
        fromColumns: [col.name],
        toTable: col.references.table,
        toColumns: refColumn ? [refColumn] : [],
        name: null,
      });
      i = j;
      continue;
    }
    i++;
  }
  if (col.primaryKey && !table.primaryKey.includes(col.name)) table.primaryKey.push(col.name);
}

function parseConstraintItem(item, table, model) {
  let i = 0;
  let name = null;
  if (isWord(item[i], 'constraint')) { name = identName(item[i + 1]); i += 2; }
  const kw = item[i] && item[i].t === 'word' ? item[i].v : '';
  if (kw === 'primary') {
    i += isWord(item[i + 1], 'key') ? 2 : 1;
    if (item[i] && item[i].v === '(') table.primaryKey = columnNamesFromGroup(item, i).names;
    return;
  }
  if (kw === 'unique') {
    i++;
    if (isWord(item[i], 'key') || isWord(item[i], 'index')) i++;
    if (item[i] && (item[i].t === 'id' || item[i].t === 'word')) { name = identName(item[i]); i++; }
    if (item[i] && item[i].v === '(') {
      table.indexes.push({ name, columns: columnNamesFromGroup(item, i).names, unique: true });
    }
    return;
  }
  if (kw === 'foreign') {
    i += isWord(item[i + 1], 'key') ? 2 : 1;
    if (!(item[i] && item[i].v === '(')) return;
    const from = columnNamesFromGroup(item, i);
    i = from.next;
    if (!isWord(item[i], 'references')) return;
    const ref = readQualifiedName(item, i + 1);
    i = ref.next;
    let toColumns = [];
    if (item[i] && item[i].v === '(') toColumns = columnNamesFromGroup(item, i).names;
    model.relations.push({
      fromTable: table.name,
      fromColumns: from.names,
      toTable: tableKey(ref.parts),
      toColumns,
      name,
    });
    return;
  }
  if (kw === 'key' || kw === 'index' || kw === 'fulltext' || kw === 'spatial') {
    i++;
    if (isWord(item[i], 'key') || isWord(item[i], 'index')) i++;
    if (item[i] && (item[i].t === 'id' || item[i].t === 'word')) { name = identName(item[i]); i++; }
    if (item[i] && item[i].v === '(') {
      table.indexes.push({ name, columns: columnNamesFromGroup(item, i).names, unique: false });
    }
    model.dialectVotes.mysql++;
  }
}

const CONSTRAINT_STARTERS = new Set([
  'constraint', 'primary', 'unique', 'foreign', 'key', 'index',
  'fulltext', 'spatial', 'check', 'exclude', 'like', 'period',
]);

function parseCreateTable(tokens, model) {
  let i = 1;
  while (i < tokens.length && !isWord(tokens[i], 'table')) i++;
  i++;
  if (isWord(tokens[i], 'if')) i += 3;
  const q = readQualifiedName(tokens, i);
  i = q.next;
  if (!q.parts.length) return;
  const table = getTable(model, tableKey(q.parts));
  if (!(tokens[i] && tokens[i].t === 'punct' && tokens[i].v === '(')) return;
  const { items, next } = splitParenItems(tokens, i);
  for (const item of items) {
    if (!item.length) continue;
    const first = item[0];
    if (first.t === 'word' && CONSTRAINT_STARTERS.has(first.v)) parseConstraintItem(item, table, model);
    else parseColumn(item, table, model);
  }
  for (let j = next; j < tokens.length; j++) {
    if (isWord(tokens[j], 'engine')) model.dialectVotes.mysql++;
    if (isWord(tokens[j], 'comment')) {
      const k = tokens[j + 1] && tokens[j + 1].v === '=' ? j + 2 : j + 1;
      if (tokens[k] && tokens[k].t === 'str') table.comment = tokens[k].v;
    }
  }
}

function splitTopLevelCommas(tokens, i) {
  const groups = [];
  let cur = [];
  let depth = 0;
  for (; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.t === 'punct' && tk.v === '(') depth++;
    if (tk.t === 'punct' && tk.v === ')') depth--;
    if (tk.t === 'punct' && tk.v === ',' && depth === 0) { groups.push(cur); cur = []; continue; }
    cur.push(tk);
  }
  if (cur.length) groups.push(cur);
  return groups;
}

function parseAlterTable(tokens, model) {
  let i = 1;
  while (i < tokens.length && !isWord(tokens[i], 'table')) i++;
  i++;
  if (isWord(tokens[i], 'only')) i++;
  if (isWord(tokens[i], 'if')) i += 2;
  const q = readQualifiedName(tokens, i);
  i = q.next;
  if (!q.parts.length) return;
  const table = getTable(model, tableKey(q.parts));
  for (const action of splitTopLevelCommas(tokens, i)) {
    let j = 0;
    if (isWord(action[j], 'add')) {
      let rest = action.slice(1);
      if (isWord(rest[0], 'column')) rest = rest.slice(1);
      const first = rest[0];
      if (!first) continue;
      if (first.t === 'word' && CONSTRAINT_STARTERS.has(first.v)) parseConstraintItem(rest, table, model);
      else parseColumn(rest, table, model);
      continue;
    }
    if (isWord(action[j], 'alter')) {
      j++;
      if (isWord(action[j], 'column')) j++;
      if (!action[j]) continue;
      const col = getColumn(table, identName(action[j]));
      j++;
      if (isWord(action[j], 'set') && isWord(action[j + 1], 'default')) {
        col.default = captureExpr(action, j + 2).text || null;
      } else if (isWord(action[j], 'set') && isWord(action[j + 1], 'not') && isWord(action[j + 2], 'null')) {
        col.nullable = false;
      } else if (isWord(action[j], 'drop') && isWord(action[j + 1], 'not') && isWord(action[j + 2], 'null')) {
        col.nullable = true;
      }
    }
  }
}

function parseCreateIndex(tokens, model) {
  let i = 1;
  const unique = isWord(tokens[i], 'unique');
  while (i < tokens.length && !isWord(tokens[i], 'index')) i++;
  i++;
  if (isWord(tokens[i], 'concurrently')) i++;
  if (isWord(tokens[i], 'if')) i += 3;
  let name = null;
  if (tokens[i] && !isWord(tokens[i], 'on') && (tokens[i].t === 'id' || tokens[i].t === 'word')) {
    name = identName(tokens[i]);
    i++;
  }
  if (!isWord(tokens[i], 'on')) return;
  i++;
  if (isWord(tokens[i], 'only')) i++;
  const q = readQualifiedName(tokens, i);
  i = q.next;
  if (!q.parts.length) return;
  const table = getTable(model, tableKey(q.parts));
  if (isWord(tokens[i], 'using')) i += 2;
  if (tokens[i] && tokens[i].t === 'punct' && tokens[i].v === '(') {
    table.indexes.push({ name, columns: columnNamesFromGroup(tokens, i).names, unique });
  }
}

function parseCommentOn(tokens, model) {
  const kind = tokens[2] && tokens[2].v;
  if (kind !== 'table' && kind !== 'column') return;
  const q = readQualifiedName(tokens, 3);
  let i = q.next;
  if (!isWord(tokens[i], 'is')) return;
  i++;
  const text = tokens[i] && tokens[i].t === 'str' ? tokens[i].v : null;
  if (text == null) return;
  if (kind === 'table') {
    getTable(model, tableKey(q.parts)).comment = text;
  } else {
    const colName = q.parts[q.parts.length - 1];
    const table = getTable(model, tableKey(q.parts.slice(0, -1)));
    getColumn(table, colName).comment = text;
  }
}

class SqlScanner {
  constructor() {
    this.model = emptyModel();
    this.state = 'code';
    this.dollarTag = '';
    this.copyData = false;
    this.copyTable = null;
    this.buffer = '';
    this.keep = true;
    this.decided = false;
    this.carry = '';
  }

  push(chunk) {
    const text = this.carry + chunk;
    const lines = text.split(/\r?\n/);
    this.carry = lines.pop();
    for (const line of lines) this._scanLine(line);
  }

  end() {
    if (this.carry) { this._scanLine(this.carry); this.carry = ''; }
    this._endStatement();
    return this._finalize();
  }

  _append(s) {
    this.buffer += s;
    if (!this.decided) {
      const head = this.buffer.replace(/^[\s]+/, '');
      if (head.length >= DECIDE_AFTER) {
        this.decided = true;
        if (!INTERESTING.test(head)) { this.keep = false; this.buffer = ''; }
      }
    }
  }

  _scanLine(line) {
    if (this.copyData) {
      const t = line.trimEnd();
      if (t === '\\.') { this.copyData = false; this.copyTable = null; return; }
      if (this.copyTable && t !== '') this.copyTable.rowCount = (this.copyTable.rowCount || 0) + 1;
      return;
    }
    let i = 0;
    const n = line.length;
    while (i < n) {
      const st = this.state;
      if (st === 'block') {
        const close = line.indexOf('*/', i);
        if (close < 0) return;
        this.state = 'code';
        i = close + 2;
        continue;
      }
      if (st === 'sq' || st === 'dq' || st === 'bt') {
        const q = st === 'sq' ? "'" : st === 'dq' ? '"' : '`';
        let j = i;
        let closed = false;
        while (j < n) {
          const ch = line[j];
          if (ch === '\\' && st === 'sq') { j += 2; continue; }
          if (ch === q) {
            if (line[j + 1] === q) { j += 2; continue; }
            closed = true;
            break;
          }
          j++;
        }
        const upTo = Math.min(closed ? j + 1 : n, n);
        if (this.keep) this._append(line.slice(i, upTo));
        if (!closed) return;
        this.state = 'code';
        i = upTo;
        continue;
      }
      if (st === 'dollar') {
        const idx = line.indexOf(this.dollarTag, i);
        if (idx < 0) {
          if (this.keep) this._append(line.slice(i));
          return;
        }
        if (this.keep) this._append(line.slice(i, idx + this.dollarTag.length));
        this.state = 'code';
        i = idx + this.dollarTag.length;
        continue;
      }
      const c = line[i];
      if (c === '-' && line[i + 1] === '-') break;
      if (c === '/' && line[i + 1] === '*') { this.state = 'block'; i += 2; continue; }
      if (c === "'" || c === '"' || c === '`') {
        this.state = c === "'" ? 'sq' : c === '"' ? 'dq' : 'bt';
        if (c === '`') this.model.dialectVotes.mysql++;
        if (this.keep) this._append(c);
        i++;
        continue;
      }
      if (c === '$') {
        const m = DOLLAR_TAG.exec(line.slice(i));
        if (m) {
          this.state = 'dollar';
          this.dollarTag = m[0];
          this.model.dialectVotes.postgres++;
          if (this.keep) this._append(m[0]);
          i += m[0].length;
          continue;
        }
      }
      if (c === ';') { this._endStatement(); i++; continue; }
      SPECIAL.lastIndex = i;
      const sm = SPECIAL.exec(line);
      const stop = sm ? sm.index : n;
      if (stop > i) {
        if (this.keep) this._append(line.slice(i, stop));
        i = stop;
        continue;
      }
      if (this.keep) this._append(c);
      i++;
    }
    if (this.keep && this.state !== 'block') this._append('\n');
  }

  _endStatement() {
    const stmt = this.buffer.trim();
    const kept = this.keep;
    this.buffer = '';
    this.keep = true;
    this.decided = false;
    this.state = 'code';
    if (!kept) { this.model.stats.skippedStatements++; return; }
    if (!stmt) return;
    if (!INTERESTING.test(stmt)) { this.model.stats.skippedStatements++; return; }
    try {
      this._dispatch(stmt);
      this.model.stats.schemaStatements++;
    } catch (err) {
      this.model.notes.push('Skipped a statement that could not be processed: ' + stmt.slice(0, 80).replace(/\s+/g, ' ') + '…');
    }
  }

  _dispatch(stmt) {
    if (/^copy\b/i.test(stmt)) {
      if (/\bfrom\s+stdin\b/i.test(stmt)) {
        const tokens = tokenize(stmt);
        const q = readQualifiedName(tokens, 1);
        if (q.parts.length) {
          const table = getTable(this.model, tableKey(q.parts));
          if (table.rowCount == null) table.rowCount = 0;
          this.copyTable = table;
          this.copyData = true;
          this.model.dialectVotes.postgres++;
        }
      }
      return;
    }
    const tokens = tokenize(stmt);
    if (/^create\s+table\b/i.test(stmt)) return parseCreateTable(tokens, this.model);
    if (/^create\s+(unique\s+)?index\b/i.test(stmt)) return parseCreateIndex(tokens, this.model);
    if (/^alter\s+table\b/i.test(stmt)) return parseAlterTable(tokens, this.model);
    if (/^comment\s+on\b/i.test(stmt)) return parseCommentOn(tokens, this.model);
  }

  _finalize() {
    const model = this.model;
    for (const table of model.tables) {
      for (const name of table.primaryKey) {
        const col = table.columns.find((c) => c.name === name);
        if (col) { col.primaryKey = true; col.nullable = false; }
      }
      for (const index of table.indexes) {
        if (index.unique && index.columns.length === 1) {
          const col = table.columns.find((c) => c.name === index.columns[0]);
          if (col) col.unique = true;
        }
      }
    }
    for (const rel of model.relations) {
      const table = model.tableIndex.get(rel.fromTable);
      if (!table) continue;
      rel.fromColumns.forEach((name, idx) => {
        const col = table.columns.find((c) => c.name === name);
        if (col && !col.references) {
          col.references = { table: rel.toTable, column: rel.toColumns[idx] || null };
        }
      });
    }
    const { mysql, postgres } = model.dialectVotes;
    model.dialect = mysql > postgres ? 'mysql' : postgres > mysql ? 'postgres' : null;
    return model;
  }
}

function parseSqlText(text) {
  const scanner = new SqlScanner();
  scanner.push(text);
  return scanner.end();
}

module.exports = { SqlScanner, parseSqlText, tokenize };
