'use strict';

const assert = require('assert');
const { SqlScanner } = require('../src/sqlSchema');
const { toEditable } = require('../src/schemaEdit');
const { editableToJson } = require('../src/schemaJson');
const { schemaDrift, driftCount, driftReportMd, dumpHelpMd, normType, normDefault } = require('../src/schemaDrift');

function sqlToJson(sql) {
  const scanner = new SqlScanner();
  scanner.push(sql);
  const model = scanner.end();
  const editable = toEditable(model);
  return editableToJson(editable.schema, { source: 'x.sql', dialect: editable.dialect });
}

// Type and default spellings that mean the same thing.
assert.strictEqual(normType('character varying(100)'), normType('VARCHAR(100)'));
assert.strictEqual(normType('int4'), normType('integer'));
assert.strictEqual(normType('int(11)'), normType('INT'));
assert.strictEqual(normType('serial'), normType('integer'));
assert.strictEqual(normType('timestamp without time zone'), normType('timestamp'));
assert.strictEqual(normType('numeric(10, 2)'), normType('DECIMAL(10,2)'));
assert.notStrictEqual(normType('varchar(100)'), normType('varchar(255)'), 'lengths still count');
assert.strictEqual(normDefault("'new'::character varying"), normDefault("'new'"));
assert.strictEqual(normDefault('now()'), normDefault('CURRENT_TIMESTAMP'));
assert.strictEqual(normDefault("'0'"), normDefault('0'));

const MODEL = `
CREATE TABLE customer (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  account_no VARCHAR(26),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX customer_email_ux ON customer (email);
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customer(id),
  status VARCHAR(20) NOT NULL DEFAULT 'new',
  total NUMERIC(10,2)
);
CREATE TABLE invoices (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL
);
`;

// What pg_dump --schema-only writes for a database that drifted.
const DATABASE = `
SET statement_timeout = 0;
CREATE TABLE public.customer (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    account_no character varying(34),
    created_at timestamp without time zone DEFAULT now(),
    phone text
);
CREATE SEQUENCE public.customer_id_seq AS integer START WITH 1 INCREMENT BY 1;
ALTER TABLE ONLY public.customer ALTER COLUMN id SET DEFAULT nextval('public.customer_id_seq'::regclass);
CREATE TABLE public.orders (
    id integer NOT NULL,
    customer_id integer,
    status character varying(20) DEFAULT 'new'::character varying NOT NULL
);
CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    payload jsonb
);
ALTER TABLE ONLY public.customer ADD CONSTRAINT customer_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.orders ADD CONSTRAINT orders_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX customer_email_key ON public.customer USING btree (email);
CREATE INDEX orders_status_idx ON public.orders USING btree (status);
`;

const model = sqlToJson(MODEL);
const db = sqlToJson(DATABASE);

// Identical schemas: nothing to report, even across spellings.
assert.strictEqual(driftCount(schemaDrift(model, model)), 0, 'a model matches itself');

const drift = schemaDrift(model, db);
assert.deepStrictEqual(drift.missingTables.map((d) => d.table), ['invoices']);
assert.deepStrictEqual(drift.extraTables.map((d) => d.table), ['audit_log']);
assert.deepStrictEqual(drift.missingColumns.map((d) => d.table + '.' + d.column), ['orders.total']);
assert.deepStrictEqual(drift.extraColumns.map((d) => d.table + '.' + d.column), ['customer.phone']);

const diffs = {};
for (const d of drift.columnDiffs) diffs[d.table + '.' + d.column] = d.diffs.map((x) => x.what);
assert.deepStrictEqual(diffs['customer.account_no'], ['type'], 'varchar(26) vs character varying(34)');
assert.deepStrictEqual(diffs['orders.customer_id'], ['nullable']);
assert.ok(!diffs['customer.id'], 'serial vs integer + nextval is the same column');
assert.ok(!diffs['customer.created_at'], 'CURRENT_TIMESTAMP = now(); timestamp spellings agree');
assert.ok(!diffs['orders.status'], "'new' = 'new'::character varying");
assert.ok(!diffs['customer.email'], 'same column');

assert.deepStrictEqual(drift.primaryKeys, [], 'primary keys agree (inline vs ALTER TABLE)');
assert.deepStrictEqual(drift.missingIndexes, [], 'the unique index matches despite another name');
assert.deepStrictEqual(drift.extraIndexes.map((d) => d.table + ':' + d.index.columns.join(',')), ['orders:status']);
assert.deepStrictEqual(drift.missingRelations.map((r) => r.fromTable + '->' + r.toTable), ['orders->customer'],
  'the foreign key from the model is missing in the database');
assert.deepStrictEqual(drift.extraRelations, []);

const md = driftReportMd(drift, { title: 'shop', modelPath: 'shop.sql', databasePath: 'prod-schema.sql' });
assert.ok(md.startsWith('---\ntype: schema-drift-report\n'));
for (const needle of ['`invoices`', '`total`', '`audit_log`', '`phone`',
  '`customer.account_no`', '`VARCHAR(26)`', 'NULL / NOT NULL', '(status)', 'foreign key']) {
  assert.ok(md.includes(needle), 'report mentions ' + needle);
}
assert.ok(driftReportMd(schemaDrift(model, model), {}).includes('No discrepancies'));
assert.ok(dumpHelpMd().includes('pg_dump --schema-only') && dumpHelpMd().includes('mysqldump --no-data'));

console.log('schema-drift-test: OK');
