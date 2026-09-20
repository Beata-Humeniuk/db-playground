'use strict';

const assert = require('assert');
const { editableToJson, parseSchemaJson, renameCandidates, diffJsonSchemas, changesFromDesigner } = require('../src/schemaJson');

const editable = {
  tables: [
    {
      id: 't1', name: 'customer', comment: '',
      columns: [
        { id: 'c1', name: 'id', type: 'bigint', nullable: false, primaryKey: true, default: '', comment: '', autoIncrement: true },
        { id: 'c2', name: 'account_no', type: 'varchar(26)', nullable: true, primaryKey: false, default: '', comment: '' }
      ],
      indexes: [{ id: 'i1', name: 'ix_account', columns: ['account_no'], unique: true }]
    },
    { id: 't2', name: '', columns: [], indexes: [] }
  ],
  relations: [
    { id: 'r1', name: '', fromTable: 'contract', fromColumns: ['customer_id'], toTable: 'customer', toColumns: ['id'] }
  ]
};
const json = editableToJson(editable, { source: 'dump.sql', dialect: 'postgres' });
assert.strictEqual(json.schemaVersion, 1);
assert.strictEqual(json.tables.length, 1, 'an unnamed table is dropped');
assert.strictEqual(json.tables[0].columns[0].primaryKey, true);
assert.strictEqual(json.tables[0].columns[1].primaryKey, undefined, 'false is not written');
assert.strictEqual(json.tables[0].indexes[0].unique, true);
assert.strictEqual(json.relations[0].fromTable, 'contract');
assert.strictEqual(JSON.stringify(json), JSON.stringify(editableToJson(editable, { source: 'dump.sql', dialect: 'postgres' })),
  'the same content gives a byte-identical output');

assert.strictEqual(parseSchemaJson('not json'), null);
assert.strictEqual(parseSchemaJson('{"tables": 1}'), null);
assert.ok(parseSchemaJson(JSON.stringify(json)));

const oldJson = {
  tables: [
    { name: 'customer', columns: [
      { name: 'id', type: 'bigint', nullable: false, primaryKey: true },
      { name: 'account_no', type: 'varchar(26)', nullable: true }
    ] }
  ]
};
const newJson = {
  tables: [
    { name: 'customer', columns: [
      { name: 'id', type: 'bigint', nullable: false, primaryKey: true },
      { name: 'account_number', type: 'varchar(26)', nullable: true }
    ] }
  ]
};
const candidates = renameCandidates(oldJson, newJson);
assert.strictEqual(candidates.columns.length, 1);
assert.strictEqual(candidates.columns[0].from, 'account_no');
assert.strictEqual(candidates.columns[0].to, 'account_number');
assert.ok(candidates.columns[0].score >= 0.9);

const oldT = { tables: [{ name: 'applications', columns: [{ name: 'id', type: 'bigint' }, { name: 'status', type: 'varchar' }] }] };
const newT = { tables: [{ name: 'requests', columns: [{ name: 'id', type: 'bigint' }, { name: 'status', type: 'varchar' }] }] };
const tCand = renameCandidates(oldT, newT);
assert.strictEqual(tCand.tables.length, 1);
assert.strictEqual(tCand.tables[0].from, 'applications');
assert.strictEqual(tCand.tables[0].to, 'requests');
assert.strictEqual(tCand.tables[0].score, 1);

const oldTC = { tables: [{ name: 'applications', columns: [
  { name: 'id', type: 'bigint' }, { name: 'status', type: 'varchar' }] }] };
const newTC = { tables: [{ name: 'requests', columns: [
  { name: 'id', type: 'bigint' }, { name: 'state', type: 'varchar' }] }] };
assert.strictEqual(renameCandidates(oldTC, newTC).columns.length, 0,
  'no column candidates before the table identity is approved');
const pairedCand = renameCandidates(oldTC, newTC, { tables: [{ from: 'applications', to: 'requests' }] });
assert.strictEqual(pairedCand.columns.length, 1,
  'the renamed table pairs up and its columns get candidates');
assert.strictEqual(pairedCand.columns[0].table, 'applications',
  'candidates carry the OLD table name — the key diffJsonSchemas expects');
assert.strictEqual(pairedCand.columns[0].from, 'status');
assert.strictEqual(pairedCand.columns[0].to, 'state');

const noRenames = diffJsonSchemas(oldJson, newJson, null);
assert.deepStrictEqual(noRenames.map((c) => c.kind).sort(), ['addColumn', 'dropColumn'],
  'unapproved identity = drop + add, never a guess');

const withRenames = diffJsonSchemas(oldJson, newJson,
  { columns: [{ table: 'customer', from: 'account_no', to: 'account_number' }] });
assert.deepStrictEqual(withRenames.map((c) => c.kind), ['renameColumn']);
assert.strictEqual(withRenames[0].from, 'account_no');
assert.strictEqual(withRenames[0].to, 'account_number');

const tDiff = diffJsonSchemas(oldT, newT, { tables: [{ from: 'applications', to: 'requests' }] });
assert.deepStrictEqual(tDiff.map((c) => c.kind), ['renameTable']);

const tcDiff = diffJsonSchemas(oldTC, newTC, {
  tables: [{ from: 'applications', to: 'requests' }],
  columns: [{ table: 'applications', from: 'status', to: 'state' }]
});
assert.deepStrictEqual(tcDiff.map((c) => c.kind).sort(), ['renameColumn', 'renameTable']);
const dropInRenamed = diffJsonSchemas(oldTC, newTC, { tables: [{ from: 'applications', to: 'requests' }] });
const drop = dropInRenamed.find((c) => c.kind === 'dropColumn');
assert.strictEqual(drop.table, 'requests', 'dropColumn reports the new table name');
assert.strictEqual(drop.column, 'status');

const typed = diffJsonSchemas(
  { tables: [{ name: 'k', columns: [{ name: 'amount', type: 'int', nullable: true }] }] },
  { tables: [{ name: 'k', columns: [{ name: 'amount', type: 'numeric(12,2)', nullable: false }] }] },
  null
);
assert.strictEqual(typed.length, 1);
assert.strictEqual(typed[0].kind, 'modifyColumn');
assert.ok(typed[0].changed.type && typed[0].changed.nullable);

const designer = changesFromDesigner([
  { kind: 'renameColumn', table: 'customer', from: 'account_no', to: 'account_number' },
  { kind: 'dropTable', name: 'legacy' },
  { kind: 'setTableComment', table: 'customer', comment: 'x' },
  { kind: 'modifyColumn', table: 'customer', column: { name: 'amount', type: 'numeric' },
    baseline: { type: 'int' }, changed: { type: true, nullable: false, default: false, comment: false } },
  { kind: 'modifyColumn', table: 'customer', column: { name: 'description', type: 'text' },
    baseline: { type: 'text' }, changed: { type: false, nullable: false, default: false, comment: true } }
]);
assert.deepStrictEqual(designer.map((c) => c.kind), ['renameColumn', 'dropTable', 'modifyColumn'],
  'comments and defaults do not enter the impact');

console.log('schema-json-test OK');
