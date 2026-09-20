'use strict';

const { DIALECTS } = require('./dialects');

const OPERATORS = ['=', '<>', '>', '>=', '<', '<=', 'LIKE', 'IN', 'IS NULL', 'IS NOT NULL'];
const NO_VALUE_OPS = new Set(['IS NULL', 'IS NOT NULL']);

function literal(value) {
  const s = String(value == null ? '' : value).trim();
  if (s === '') return "''";
  if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return s;
  if (/^null$/i.test(s)) return 'NULL';
  if (/^(true|false)$/i.test(s)) return s.toUpperCase();
  return "'" + s.replace(/'/g, "''") + "'";
}

function condition(w, ref) {
  const col = ref(w);
  if (NO_VALUE_OPS.has(w.op)) return col + ' ' + w.op;
  if (w.op === 'IN') {
    const items = String(w.value || '').split(',').map((v) => literal(v)).filter((v) => v !== "''");
    return col + ' IN (' + (items.length ? items.join(', ') : "''") + ')';
  }
  return col + ' ' + w.op + ' ' + literal(w.value);
}

function buildSql(query, dialectKey) {
  const d = DIALECTS[dialectKey];
  const joins = (query.joins || []).filter((j) => j.table);
  const qualified = joins.length > 0;
  const ref = (c) => (qualified && c.table ? d.quote(c.table) + '.' : '') + d.quote(c.column);

  const limit = parseInt(query.limit, 10) > 0 ? parseInt(query.limit, 10) : null;
  const cols = (query.columns || []).filter((c) => c.column);
  const colList = cols.length ? cols.map(ref).join(', ') : '*';

  const lines = [];
  lines.push('SELECT ' + (dialectKey === 'mssql' && limit ? 'TOP (' + limit + ') ' : '') + colList);
  lines.push('FROM ' + d.quote(query.table));
  for (const j of joins) {
    lines.push(j.type + ' ' + d.quote(j.table) + ' ON ' +
      d.quote(j.table) + '.' + d.quote(j.fromColumn) + ' = ' +
      d.quote(j.toTable) + '.' + d.quote(j.toColumn));
  }
  const where = (query.where || []).filter((w) => w.column && w.op);
  where.forEach((w, i) => {
    lines.push((i === 0 ? 'WHERE ' : '  AND ') + condition(w, ref));
  });
  const order = (query.orderBy || []).filter((o) => o.column);
  if (order.length) {
    lines.push('ORDER BY ' + order.map((o) => ref(o) + (o.dir === 'DESC' ? ' DESC' : '')).join(', '));
  }
  if (limit) {
    if (d.limitStyle === 'limit') lines.push('LIMIT ' + limit);
    else if (d.limitStyle === 'fetch') lines.push('FETCH FIRST ' + limit + ' ROWS ONLY');
  }
  return lines.join('\n') + ';';
}

function mongoLiteral(value) {
  const s = String(value == null ? '' : value).trim();
  if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return s;
  if (/^(true|false|null)$/i.test(s)) return s.toLowerCase();
  return JSON.stringify(s);
}

function mongoCondition(w) {
  const key = JSON.stringify(w.column);
  switch (w.op) {
    case '=': return key + ': ' + mongoLiteral(w.value);
    case '<>': return key + ': { $ne: ' + mongoLiteral(w.value) + ' }';
    case '>': return key + ': { $gt: ' + mongoLiteral(w.value) + ' }';
    case '>=': return key + ': { $gte: ' + mongoLiteral(w.value) + ' }';
    case '<': return key + ': { $lt: ' + mongoLiteral(w.value) + ' }';
    case '<=': return key + ': { $lte: ' + mongoLiteral(w.value) + ' }';
    case 'LIKE': return key + ': { $regex: ' + JSON.stringify(String(w.value || '').replace(/%/g, '.*')) + ' }';
    case 'IN': return key + ': { $in: [' + String(w.value || '').split(',').map((v) => mongoLiteral(v)).join(', ') + '] }';
    case 'IS NULL': return key + ': null';
    case 'IS NOT NULL': return key + ': { $ne: null }';
    default: return key + ': ' + mongoLiteral(w.value);
  }
}

function buildMongo(query) {
  const filter = (query.where || []).filter((w) => w.column && w.op).map(mongoCondition);
  const projection = (query.columns || []).filter((c) => c.column).map((c) => JSON.stringify(c.column) + ': 1');
  const args = [];
  args.push(filter.length ? '{ ' + filter.join(', ') + ' }' : '{}');
  if (projection.length) args.push('{ ' + projection.join(', ') + ' }');
  let out = 'db.' + query.table + '.find(' + args.join(', ') + ')';
  const order = (query.orderBy || []).filter((o) => o.column);
  if (order.length) {
    out += '.sort({ ' + order.map((o) => JSON.stringify(o.column) + ': ' + (o.dir === 'DESC' ? '-1' : '1')).join(', ') + ' })';
  }
  const limit = parseInt(query.limit, 10);
  if (limit > 0) out += '.limit(' + limit + ')';
  return out + ';';
}

function buildSelect(query, dialectKey) {
  if (!query || !query.table) return '';
  if (DIALECTS[dialectKey].kind === 'mongo') return buildMongo(query);
  return buildSql(query, dialectKey);
}

module.exports = { buildSelect, OPERATORS };
