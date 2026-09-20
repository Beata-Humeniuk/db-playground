'use strict';

const norm = (v) => (v == null ? '' : String(v).trim());
const named = (x) => norm(x.name) !== '';

function editableToJson(schema, meta) {
  const out = {
    schemaVersion: 1,
    source: norm(meta && meta.source),
    dialect: norm(meta && meta.dialect),
    tables: (schema.tables || []).filter(named).map((t) => {
      const table = { name: t.name.trim() };
      if (norm(t.comment)) table.comment = t.comment.trim();
      table.columns = (t.columns || []).filter(named).map((c) => {
        const col = { name: c.name.trim(), type: norm(c.type), nullable: c.nullable !== false };
        if (c.primaryKey) col.primaryKey = true;
        if (c.autoIncrement) col.autoIncrement = true;
        if (norm(c.default)) col.default = c.default.trim();
        if (norm(c.comment)) col.comment = c.comment.trim();
        return col;
      });
      const indexes = (t.indexes || [])
        .filter((ix) => (ix.columns || []).some(norm))
        .map((ix) => {
          const index = { columns: ix.columns.filter(norm) };
          if (norm(ix.name)) index.name = ix.name.trim();
          if (ix.unique) index.unique = true;
          return index;
        });
      if (indexes.length) table.indexes = indexes;
      return table;
    }),
    relations: (schema.relations || [])
      .filter((r) => norm(r.fromTable) && norm(r.toTable) && (r.fromColumns || []).some(norm))
      .map((r) => {
        const rel = {
          fromTable: r.fromTable.trim(),
          fromColumns: r.fromColumns.filter(norm),
          toTable: r.toTable.trim(),
          toColumns: (r.toColumns || []).filter(norm)
        };
        if (norm(r.name)) rel.name = r.name.trim();
        return rel;
      })
  };
  return out;
}

function parseSchemaJson(text) {
  let data;
  try {
    data = JSON.parse(String(text || ''));
  } catch (e) {
    return null;
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.tables)) return null;
  return data;
}

const lower = (s) => String(s || '').trim().toLowerCase();

function tableByName(json, name) {
  return (json.tables || []).find((t) => lower(t.name) === lower(name)) || null;
}

function renameCandidates(oldJson, newJson, renames) {
  const out = { tables: [], columns: [] };
  const tableRename = {};
  for (const r of (renames && renames.tables) || []) tableRename[lower(r.from)] = r.to;
  const oldNames = new Set((oldJson.tables || []).map((t) => lower(t.name)));
  const newNames = new Set((newJson.tables || []).map((t) => lower(t.name)));
  const removedTables = (oldJson.tables || []).filter((t) => !newNames.has(lower(t.name)));
  const addedTables = (newJson.tables || []).filter((t) => !oldNames.has(lower(t.name)));

  const colKey = (c) => lower(c.name) + '|' + lower(c.type);
  for (const gone of removedTables) {
    const goneCols = new Set((gone.columns || []).map(colKey));
    for (const came of addedTables) {
      const cameCols = (came.columns || []).map(colKey);
      const overlap = cameCols.filter((k) => goneCols.has(k)).length;
      const total = Math.max(goneCols.size, cameCols.length, 1);
      const score = overlap / total;
      if (score > 0) out.tables.push({ from: gone.name, to: came.name, score });
    }
  }
  out.tables.sort((a, b) => b.score - a.score);

  for (const oldTable of oldJson.tables || []) {
    const renamedTo = tableRename[lower(oldTable.name)];
    const newTable = tableByName(newJson, renamedTo || oldTable.name);
    if (!newTable) continue;
    const newCols = new Set((newTable.columns || []).map((c) => lower(c.name)));
    const oldCols = new Set((oldTable.columns || []).map((c) => lower(c.name)));
    const removed = (oldTable.columns || []).filter((c) => !newCols.has(lower(c.name)));
    const added = (newTable.columns || []).filter((c) => !oldCols.has(lower(c.name)));
    for (const gone of removed) {
      for (const came of added) {
        let score = 0;
        if (lower(gone.type) === lower(came.type)) score += 0.7;
        if ((gone.nullable !== false) === (came.nullable !== false)) score += 0.2;
        if (Boolean(gone.primaryKey) === Boolean(came.primaryKey)) score += 0.1;
        if (score > 0) out.columns.push({ table: oldTable.name, from: gone.name, to: came.name, score });
      }
    }
  }
  out.columns.sort((a, b) => b.score - a.score);
  return out;
}

function diffJsonSchemas(oldJson, newJson, renames) {
  const changes = [];
  const tableRename = {};
  for (const r of (renames && renames.tables) || []) tableRename[lower(r.from)] = r.to;
  const columnRename = {};
  for (const r of (renames && renames.columns) || []) {
    columnRename[lower(r.table) + '|' + lower(r.from)] = r.to;
  }

  const newByName = {};
  for (const t of newJson.tables || []) newByName[lower(t.name)] = t;

  for (const oldTable of oldJson.tables || []) {
    const renamedTo = tableRename[lower(oldTable.name)];
    const target = renamedTo ? newByName[lower(renamedTo)] : newByName[lower(oldTable.name)];
    if (renamedTo && target) changes.push({ kind: 'renameTable', from: oldTable.name, to: target.name });
    if (!target) {
      changes.push({ kind: 'dropTable', name: oldTable.name });
      continue;
    }
    const targetCols = {};
    for (const c of target.columns || []) targetCols[lower(c.name)] = c;
    for (const oldCol of oldTable.columns || []) {
      const colRenamedTo = columnRename[lower(oldTable.name) + '|' + lower(oldCol.name)];
      const targetCol = colRenamedTo ? targetCols[lower(colRenamedTo)] : targetCols[lower(oldCol.name)];
      if (colRenamedTo && targetCol) {
        changes.push({ kind: 'renameColumn', table: target.name, from: oldCol.name, to: targetCol.name });
      }
      if (!targetCol) {
        changes.push({ kind: 'dropColumn', table: target.name, column: oldCol.name });
        continue;
      }
      const typeChanged = lower(oldCol.type) !== lower(targetCol.type);
      const nullableChanged = (oldCol.nullable !== false) !== (targetCol.nullable !== false);
      if (typeChanged || nullableChanged) {
        changes.push({
          kind: 'modifyColumn', table: target.name, column: targetCol.name,
          fromType: norm(oldCol.type), toType: norm(targetCol.type),
          changed: { type: typeChanged, nullable: nullableChanged }
        });
      }
    }
    const oldCols = new Set((oldTable.columns || []).map((c) => lower(c.name)));
    const renamedAway = new Set(Object.keys(columnRename)
      .filter((k) => k.startsWith(lower(oldTable.name) + '|'))
      .map((k) => lower(columnRename[k])));
    for (const newCol of target.columns || []) {
      if (oldCols.has(lower(newCol.name)) || renamedAway.has(lower(newCol.name))) continue;
      changes.push({ kind: 'addColumn', table: target.name, column: newCol.name });
    }
  }

  const oldNames = new Set((oldJson.tables || []).map((t) => lower(t.name)));
  const renamedTargets = new Set(Object.keys(tableRename).map((k) => lower(tableRename[k])));
  for (const newTable of newJson.tables || []) {
    if (oldNames.has(lower(newTable.name)) || renamedTargets.has(lower(newTable.name))) continue;
    changes.push({ kind: 'addTable', name: newTable.name });
  }
  return changes;
}

function changesFromDesigner(designerChanges) {
  const changes = [];
  for (const change of designerChanges || []) {
    if (change.kind === 'createTable') changes.push({ kind: 'addTable', name: change.table.name });
    else if (change.kind === 'dropTable') changes.push({ kind: 'dropTable', name: change.name });
    else if (change.kind === 'renameTable') changes.push({ kind: 'renameTable', from: change.from, to: change.to });
    else if (change.kind === 'addColumn') changes.push({ kind: 'addColumn', table: change.table, column: change.column.name });
    else if (change.kind === 'dropColumn') changes.push({ kind: 'dropColumn', table: change.table, column: change.column });
    else if (change.kind === 'renameColumn') changes.push({ kind: 'renameColumn', table: change.table, from: change.from, to: change.to });
    else if (change.kind === 'modifyColumn' && change.changed && (change.changed.type || change.changed.nullable)) {
      changes.push({
        kind: 'modifyColumn', table: change.table, column: change.column.name,
        fromType: norm(change.baseline && change.baseline.type), toType: norm(change.column.type),
        changed: { type: !!change.changed.type, nullable: !!change.changed.nullable }
      });
    }
  }
  return changes;
}

module.exports = { editableToJson, parseSchemaJson, renameCandidates, diffJsonSchemas, changesFromDesigner };
