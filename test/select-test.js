'use strict';

const { buildSelect } = require('../src/selectGen');

const assert = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exit(1); } };

const query = {
  table: 'users',
  joins: [{ type: 'LEFT JOIN', table: 'orders', fromColumn: 'user_id', toTable: 'users', toColumn: 'id' }],
  columns: [
    { table: 'users', column: 'email' },
    { table: 'orders', column: 'total' },
  ],
  where: [
    { table: 'users', column: 'status', op: '=', value: 'active' },
    { table: 'orders', column: 'total', op: '>', value: '100' },
    { table: 'users', column: 'nick', op: 'IS NULL' },
    { table: 'users', column: 'role', op: 'IN', value: 'admin, editor' },
  ],
  orderBy: [{ table: 'orders', column: 'total', dir: 'DESC' }],
  limit: '50',
};

const pg = buildSelect(query, 'postgres');
assert(pg.includes('SELECT users.email, orders.total'), 'pg select list, got:\n' + pg);
assert(pg.includes('FROM users'), 'pg from');
assert(pg.includes('LEFT JOIN orders ON orders.user_id = users.id'), 'pg join');
assert(pg.includes("WHERE users.status = 'active'"), 'pg where first');
assert(pg.includes('  AND orders.total > 100'), 'pg where numeric literal unquoted');
assert(pg.includes('  AND users.nick IS NULL'), 'pg is null');
assert(pg.includes("  AND users.role IN ('admin', 'editor')"), 'pg in list');
assert(pg.includes('ORDER BY orders.total DESC'), 'pg order');
assert(pg.trim().endsWith('LIMIT 50;'), 'pg limit');

const ora = buildSelect(query, 'oracle');
assert(ora.includes('FETCH FIRST 50 ROWS ONLY'), 'oracle fetch first, got:\n' + ora);
assert(!ora.includes('LIMIT'), 'oracle has no LIMIT');

const ms = buildSelect(query, 'mssql');
assert(ms.includes('SELECT TOP (50) users.email'), 'mssql top, got:\n' + ms);

const simple = buildSelect({ table: 'users', joins: [], columns: [], where: [], orderBy: [], limit: '' }, 'postgres');
assert(simple.startsWith('SELECT *'), 'star when nothing picked, got: ' + simple);
assert(simple.includes('FROM users'), 'simple from');

const quotedQ = buildSelect({ table: 'user orders', joins: [], columns: [{ table: '', column: 'e-mail' }], where: [], orderBy: [], limit: '' }, 'mysql');
assert(quotedQ.includes('`e-mail`'), 'mysql backtick quoting, got: ' + quotedQ);
assert(quotedQ.includes('FROM `user orders`'), 'mysql table quoting');

const inj = buildSelect({ table: 'users', joins: [], columns: [], where: [{ table: 'users', column: 'name', op: '=', value: "o'brien" }], orderBy: [], limit: '' }, 'postgres');
assert(inj.includes("'o''brien'"), 'quote escaping in literals, got: ' + inj);

const mongo = buildSelect({
  table: 'customers',
  joins: [],
  columns: [{ table: 'customers', column: 'email' }, { table: 'customers', column: 'address.city' }],
  where: [
    { table: 'customers', column: 'age', op: '>=', value: '18' },
    { table: 'customers', column: 'name', op: 'LIKE', value: 'A%' },
    { table: 'customers', column: 'segment', op: 'IN', value: 'vip,new' },
  ],
  orderBy: [{ table: 'customers', column: 'age', dir: 'DESC' }],
  limit: '10',
}, 'mongo');
assert(mongo.startsWith('db.customers.find('), 'mongo find, got:\n' + mongo);
assert(mongo.includes('"age": { $gte: 18 }'), 'mongo gte');
assert(mongo.includes('"name": { $regex: "A.*" }'), 'mongo like->regex');
assert(mongo.includes('"segment": { $in: ["vip", "new"] }'), 'mongo in');
assert(mongo.includes('"address.city": 1'), 'mongo projection with dotted path');
assert(mongo.includes('.sort({ "age": -1 })'), 'mongo sort');
assert(mongo.includes('.limit(10)'), 'mongo limit');

console.log('select-test OK');
