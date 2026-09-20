'use strict';

const { readJsonText } = require('../src/jsonSchema');

const assert = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exit(1); } };

const NDJSON = [
  '{"_id":{"$oid":"6613f0a2e4b0a1a2b3c4d5e6"},"name":"Ala","age":30,"tags":["vip","new"],"address":{"city":"London","zip":"10001"},"created":{"$date":"2024-01-01T00:00:00Z"},"balance":{"$numberDecimal":"19.99"}}',
  '{"_id":{"$oid":"6613f0a2e4b0a1a2b3c4d5e7"},"name":"Ola","age":null,"tags":[],"created":{"$date":"2024-02-01T00:00:00Z"}}',
  '',
].join('\n');

const model = readJsonText(NDJSON, { name: 'customers' });
const table = model.tables[0];
assert(model.inputShape === 'ndjson', 'ndjson detected, got ' + model.inputShape);
assert(table.kind === 'collection', 'collection kind');
assert(table.rowCount === 2, '2 documents, got ' + table.rowCount);

const byName = Object.fromEntries(table.columns.map((c) => [c.name, c]));
assert(byName['_id'].typeKeys.includes('objectId'), '_id is ObjectId');
assert(byName['_id'].primaryKey === true, '_id marked as key');
assert(byName['created'].typeKeys.includes('datetime'), '$date is datetime');
assert(byName['balance'].typeKeys.includes('number'), '$numberDecimal is number');
assert(byName['age'].typeKeys.includes('integer'), 'age integer');
assert(byName['age'].nullable === true, 'null value makes age nullable');
assert(byName['address.city'].presence === 0.5, 'nested presence 0.5, got ' + byName['address.city'].presence);
assert(byName['tags[]'].typeKeys.includes('string'), 'array element type');
assert(byName['name'].presence === 1, 'name present in all docs');
assert(byName['name'].examples.includes('Ala'), 'example captured');

const arr = readJsonText('[{"a":1},{"a":2,"b":{"c":true}}]', { name: 'arr' });
assert(arr.inputShape === 'array', 'array shape');
assert(arr.tables[0].rowCount === 2, 'array doc count');
const arrBy = Object.fromEntries(arr.tables[0].columns.map((c) => [c.name, c]));
assert(arrBy['b.c'].typeKeys.includes('boolean'), 'nested bool');
assert(arrBy['b.c'].presence === 0.5, 'nested presence');

const single = readJsonText('{"x": "y"}', { name: 'one' });
assert(single.inputShape === 'document', 'single document shape');
assert(single.tables[0].rowCount === 1, 'single doc count');

const broken = readJsonText('{"a":1}\nnie-json\n{"a":2}', { name: 'broken' });
assert(broken.tables[0].rowCount === 2, 'broken lines skipped');
assert(broken.notes.length === 1, 'note about skipped lines');

console.log('json-test OK');
