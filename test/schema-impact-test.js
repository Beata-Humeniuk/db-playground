'use strict';

const assert = require('assert');
const { computeSchemaImpact, applyRenames, impactReportMd, substitutionReportMd, normSchemaRef } = require('../src/schemaImpact');

const SCHEMA_PATH = 'db/model/shop.schema.json';

const flowReferencing = {
  dbSchema: SCHEMA_PATH,
  steps: [
    { type: 'validation', title: 'Validation' },
    { type: 'dbRead', title: 'Customer read', sql: 'SELECT id, account_no FROM customer WHERE id = ?',
      output: { name: 'customer', fields: [{ path: 'account_no', type: 'varchar(26)' }] } },
    { type: 'dbWrite', title: 'Application write', sql: 'INSERT INTO applications (id, status) VALUES (?, ?)' }
  ]
};
const flowUnreferenced = {
  steps: [{ type: 'dbRead', title: 'Something from the database', sql: 'SELECT * FROM customer' }]
};
const flowOtherSchema = {
  dbSchema: 'db/model/other.schema.json',
  steps: [{ type: 'dbRead', sql: 'SELECT account_no FROM customer' }]
};
const packages = [
  { dir: 'api/offers', flow: flowReferencing },
  { dir: 'api/customers', flow: flowUnreferenced },
  { dir: 'api/other', flow: flowOtherSchema }
];

const impact = computeSchemaImpact([
  { kind: 'dropTable', name: 'applications' },
  { kind: 'renameColumn', table: 'customer', from: 'account_no', to: 'account_number' },
  { kind: 'addColumn', table: 'customer', column: 'email' }
], packages, SCHEMA_PATH);

assert.strictEqual(impact.red.length, 1);
assert.strictEqual(impact.red[0].pkg, 'api/offers');
assert.ok(impact.red[0].step.indexOf('Application write') >= 0);
assert.strictEqual(impact.yellow.length, 1, 'a column rename catches both the SQL and the model field — once per step');
assert.strictEqual(impact.info.length, 1);
assert.strictEqual(impact.unreferenced.length, 1);
assert.strictEqual(impact.unreferenced[0].pkg, 'api/customers');
assert.ok(!JSON.stringify(impact).includes('api/other'), 'a package with another schema is skipped');

const modelOnly = computeSchemaImpact(
  [{ kind: 'modifyColumn', table: 'customer', column: 'account_no', fromType: 'varchar', toType: 'text', changed: { type: true } }],
  [{ dir: 'api/offers', flow: { dbSchema: SCHEMA_PATH, steps: [
    { type: 'dbRead', sql: 'SELECT * FROM customer', output: { name: 'k', fields: [{ path: 'account_no' }] } }
  ] } }],
  SCHEMA_PATH
);
assert.strictEqual(modelOnly.yellow.length, 1);

const flowToFix = JSON.parse(JSON.stringify(flowReferencing));
const { substitutions } = applyRenames(flowToFix, {
  tables: [], columns: [{ table: 'customer', from: 'account_no', to: 'account_number' }]
});
assert.ok(flowToFix.steps[1].sql.includes('account_number'));
assert.ok(!flowToFix.steps[1].sql.includes('account_no'));
assert.strictEqual(flowToFix.steps[1].output.fields[0].path, 'account_number');
assert.strictEqual(substitutions.length, 2, 'one substitution in SQL, one in a model field');
assert.deepStrictEqual(substitutions.map((s) => s.where).sort(), ['field', 'sql']);

const untouched = { steps: [{ type: 'validation', description: 'account_no has 26 digits' }] };
assert.strictEqual(applyRenames(untouched, { columns: [{ from: 'account_no', to: 'x' }] }).substitutions.length, 0);

const dottedFlow = { steps: [{ type: 'dbRead', sql: 'SELECT account_no FROM customer',
  output: { name: 'k', fields: [{ path: 'customer.account_no' }, { path: 'account_note' }] } }] };
const dotted = applyRenames(dottedFlow, { columns: [{ table: 'customer', from: 'account_no', to: 'account_number' }] });
assert.strictEqual(dottedFlow.steps[0].output.fields[0].path, 'customer.account_number',
  'suffix match renames only the last segment');
assert.strictEqual(dottedFlow.steps[0].output.fields[1].path, 'account_note',
  'a longer name that merely contains the column is untouched');
assert.strictEqual(dotted.substitutions.filter((s) => s.where === 'field').length, 1);

const swapFlow = { steps: [{ type: 'dbRead', sql: 'SELECT a, b FROM t',
  output: { name: 't', fields: [{ path: 'a' }, { path: 'b' }] } }] };
applyRenames(swapFlow, { columns: [{ table: 't', from: 'a', to: 'b' }, { table: 't', from: 'b', to: 'a' }] });
assert.strictEqual(swapFlow.steps[0].sql, 'SELECT b, a FROM t', 'renames do not chain in SQL');
assert.deepStrictEqual(swapFlow.steps[0].output.fields.map((f) => f.path), ['b', 'a'],
  'renames do not chain in model fields');

assert.strictEqual(normSchemaRef(' db\\model\\shop.schema.json '), 'db/model/shop.schema.json');
const backslashed = computeSchemaImpact(
  [{ kind: 'dropTable', name: 'applications' }],
  [{ dir: 'api/offers', flow: { dbSchema: 'db\\model\\shop.schema.json', steps: [
    { type: 'dbWrite', sql: 'INSERT INTO applications (id) VALUES (?)' }
  ] } }],
  SCHEMA_PATH
);
assert.strictEqual(backslashed.red.length, 1, 'a Windows-written dbSchema still matches');

const report = impactReportMd(
  [{ kind: 'dropTable', name: 'applications' }], impact,
  { schemaPath: SCHEMA_PATH, generator: 'db-playground@test', generatedAt: '2026-08-26' }
);
assert.ok(report.includes('type: schema-impact-report'));
assert.ok(report.includes('## 🔴 Will break'));
assert.ok(report.includes('## 🟡 To review'));
assert.ok(report.includes('## ℹ️ New and the rest'));
assert.ok(report.includes('Packages with no schema reference'));
assert.ok(report.includes('dropped table `applications`'));
assert.ok(report.includes('The report changes nothing'));

const emptyImpact = computeSchemaImpact([], [], SCHEMA_PATH);
const emptyReport = impactReportMd([], emptyImpact, { schemaPath: SCHEMA_PATH });
assert.ok(emptyReport.includes('_Nothing._'));
assert.ok(emptyReport.includes('_No changes._'));

const subReport = substitutionReportMd(
  [{ dir: 'api/offers', substitutions }], { schemaPath: SCHEMA_PATH });
assert.ok(subReport.includes('api/offers'));
assert.ok(subReport.includes('`account_no` → `account_number`'));

console.log('schema-impact-test OK');
