'use strict';

const { DIALECTS } = require('./dialects');

function toEditable(model, opts = {}) {
  let nextId = 1;
  const id = (prefix) => prefix + nextId++;
  const dialect = opts.dialect || model.dialect || (model.sourceFormat === 'json' ? 'mongo' : 'postgres');
  const types = DIALECTS[dialect].defaultTypes;
  const tables = model.tables.map((t) => ({
    id: id('t'),
    name: t.name,
    comment: t.comment || '',
    columns: t.columns.map((c) => ({
      id: id('c'),
      name: c.name,
      type: c.type || types[(c.typeKeys || ['string'])[0]] || types.string,
      nullable: c.nullable !== false,
      primaryKey: Boolean(c.primaryKey),
      default: c.default || '',
      comment: c.comment || '',
      autoIncrement: Boolean(c.autoIncrement),
    })),
    indexes: (t.indexes || []).map((ix) => ({
      id: id('i'),
      name: ix.name || '',
      columns: ix.columns.slice(),
      unique: Boolean(ix.unique),
    })),
  }));
  const relations = (model.relations || []).map((r) => ({
    id: id('r'),
    name: r.name || '',
    fromTable: r.fromTable,
    fromColumns: r.fromColumns.slice(),
    toTable: r.toTable,
    toColumns: (r.toColumns || []).slice(),
  }));
  return { dialect, schema: { tables, relations } };
}

const norm = (v) => (v == null ? '' : String(v).trim());
const named = (x) => norm(x.name) !== '';

function diffColumns(baseTable, curTable, changes) {
  const baseCols = new Map(baseTable.columns.map((c) => [c.id, c]));
  const curIds = new Set(curTable.columns.map((c) => c.id));
  for (const col of curTable.columns) {
    if (!named(col)) continue;
    const b = baseCols.get(col.id);
    if (!b) {
      changes.push({ kind: 'addColumn', table: curTable.name, column: col });
      continue;
    }
    if (b.name !== col.name) {
      changes.push({ kind: 'renameColumn', table: curTable.name, from: b.name, to: col.name });
    }
    const changed = {
      type: norm(b.type) !== norm(col.type),
      nullable: Boolean(b.nullable) !== Boolean(col.nullable),
      default: norm(b.default) !== norm(col.default),
      comment: norm(b.comment) !== norm(col.comment),
    };
    if (changed.type || changed.nullable || changed.default || changed.comment) {
      changes.push({ kind: 'modifyColumn', table: curTable.name, column: col, baseline: b, changed });
    }
  }
  for (const b of baseTable.columns) {
    if (!curIds.has(b.id)) changes.push({ kind: 'dropColumn', table: curTable.name, column: b.name });
  }
  const basePkIds = baseTable.columns.filter((c) => c.primaryKey).map((c) => c.id).join('|');
  const curPkIds = curTable.columns.filter((c) => c.primaryKey).map((c) => c.id).join('|');
  if (basePkIds !== curPkIds) {
    const curPk = curTable.columns.filter((c) => c.primaryKey && named(c)).map((c) => c.name);
    changes.push({ kind: 'setPrimaryKey', table: curTable.name, columns: curPk, had: basePkIds !== '' });
  }
}

function diffIndexes(baseTable, curTable, changes) {
  const key = (ix) => [ix.name, ix.columns.join(','), ix.unique ? 'u' : ''].join('|');
  const baseIx = new Map(baseTable.indexes.map((ix) => [ix.id, ix]));
  const curIds = new Set(curTable.indexes.map((ix) => ix.id));
  for (const ix of curTable.indexes) {
    if (!ix.columns.length || ix.columns.every((c) => !norm(c))) continue;
    const b = baseIx.get(ix.id);
    if (!b) {
      changes.push({ kind: 'addIndex', table: curTable.name, index: ix });
    } else if (key(b) !== key(ix)) {
      changes.push({ kind: 'dropIndex', table: curTable.name, index: b });
      changes.push({ kind: 'addIndex', table: curTable.name, index: ix });
    }
  }
  for (const b of baseTable.indexes) {
    if (!curIds.has(b.id)) changes.push({ kind: 'dropIndex', table: curTable.name, index: b });
  }
}

function diffRelations(baseline, current, changes) {
  const key = (r) => [r.name, r.fromTable, r.fromColumns.join(','), r.toTable, r.toColumns.join(',')].join('|');
  const baseRel = new Map(baseline.relations.map((r) => [r.id, r]));
  const curIds = new Set(current.relations.map((r) => r.id));
  for (const rel of current.relations) {
    if (!norm(rel.fromTable) || !norm(rel.toTable) || !rel.fromColumns.some(norm)) continue;
    const b = baseRel.get(rel.id);
    if (!b) {
      changes.push({ kind: 'addRelation', relation: rel });
    } else if (key(b) !== key(rel)) {
      changes.push({ kind: 'dropRelation', relation: b });
      changes.push({ kind: 'addRelation', relation: rel });
    }
  }
  for (const b of baseline.relations) {
    if (!curIds.has(b.id)) changes.push({ kind: 'dropRelation', relation: b });
  }
}

function diffSchemas(baseline, current) {
  const changes = [];
  const baseTables = new Map(baseline.tables.map((t) => [t.id, t]));
  const curIds = new Set(current.tables.map((t) => t.id));
  for (const table of current.tables) {
    if (!named(table)) continue;
    const b = baseTables.get(table.id);
    if (!b) {
      changes.push({ kind: 'createTable', table });
      continue;
    }
    if (b.name !== table.name) changes.push({ kind: 'renameTable', from: b.name, to: table.name });
    if (norm(b.comment) !== norm(table.comment)) {
      changes.push({ kind: 'setTableComment', table: table.name, comment: table.comment });
    }
    diffColumns(b, table, changes);
    diffIndexes(b, table, changes);
  }
  for (const b of baseline.tables) {
    if (!curIds.has(b.id)) changes.push({ kind: 'dropTable', name: b.name });
  }
  diffRelations(baseline, current, changes);
  return changes;
}

module.exports = { toEditable, diffSchemas };
