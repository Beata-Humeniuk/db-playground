'use strict';

const { parseSqlText } = require('../src/sqlSchema');
const { readCsvText } = require('../src/csvSchema');
const { readJsonText } = require('../src/jsonSchema');
const { modelToMarkdown } = require('../src/mdExport');

const assert = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exit(1); } };

const SQL = `
CREATE TABLE users (id integer NOT NULL PRIMARY KEY, email varchar(255) NOT NULL);
CREATE TABLE orders (id integer PRIMARY KEY, user_id integer REFERENCES users(id));
COMMENT ON COLUMN users.email IS 'E-mail | address';
`;
const sqlMd = modelToMarkdown(parseSqlText(SQL), { source: 'dump.sql', date: '2026-08-11' });

assert(sqlMd.startsWith('---\n'), 'frontmatter opens the file');
assert(sqlMd.includes('\ntype: db-playground-schema\n'), 'frontmatter type');
assert(sqlMd.includes('\nsource: dump.sql\n'), 'frontmatter source');
assert(sqlMd.includes('\nsourceFormat: sql\n'), 'frontmatter format');
assert(sqlMd.includes('\ngenerated: 2026-08-11\n'), 'frontmatter date');
assert(sqlMd.includes('\ntables: 2\n'), 'frontmatter table count');
assert(sqlMd.includes('# Database schema: dump'), 'title');
assert(sqlMd.includes('## Table: users'), 'table section');
assert(sqlMd.includes('| Column | Type | Required | Key | Default | Description |'), 'sql column header');
assert(sqlMd.includes('E-mail \\| address'), 'pipe escaped in comment');
assert(sqlMd.includes('## Relations'), 'relations section');
assert(sqlMd.includes('```mermaid'), 'mermaid block');
assert(sqlMd.includes('orders }o--|| users'), 'mermaid relation');
assert(sqlMd.includes('Primary key: `id`'), 'primary key line');
assert(!/\n{3,}/.test(sqlMd), 'no triple blank lines');

const csvMd = modelToMarkdown(readCsvText('a,b\n1,x\n2,y\n', { name: 'data' }), { source: 'data.csv', date: '2026-08-11' });
assert(csvMd.includes('# Data description: data'), 'csv title');
assert(csvMd.includes('| Column | Type | Filled in | Key | Example values |'), 'csv column header');
assert(csvMd.includes('integer'), 'spelled-out type label for a CSV source');
assert(csvMd.includes('| Records | 2 rows |'), 'row count with plural');
assert(csvMd.includes('100%'), 'presence percent');

const jsonMd = modelToMarkdown(
  readJsonText('{"a": 1, "b": {"$oid": "6613f0a2e4b0a1a2b3c4d5e6"}}', { name: 'collection' }),
  { source: 'export.json', date: '2026-08-11' }
);
assert(jsonMd.includes('# Collection schema: export'), 'json title');
assert(jsonMd.includes('| Field | Type | Presence | Key | Example values |'), 'json column header');
assert(jsonMd.includes('objectId'), 'a Mongo export is described in BSON type names');
assert(jsonMd.includes('| `a` | int |'), 'BSON int, not the spelled-out label');
assert(!jsonMd.includes('Document structure'), 'a flat document keeps the single table');

const NESTED = JSON.stringify({
  _id: { $oid: '6613f0a2e4b0a1a2b3c4d5e6' },
  orderId: 'A-1',
  originalOrder: { product: { code: 'X', options: [{ id: 1, label: 'l' }] } },
  tags: ['a'],
});
const nestedMd = modelToMarkdown(readJsonText(NESTED, { name: 'orders' }), { source: 'orders.json', date: '2026-08-11' });
assert(nestedMd.includes('| Nested objects | 3 objects |'), 'nested object count in the summary');
assert(nestedMd.includes('### Document structure'), 'structure section');
assert(nestedMd.includes('```mermaid'), 'document diagram');
assert(nestedMd.includes('erDiagram'), 'drawn as an ER diagram');
assert(nestedMd.includes('orders ||--|| originalOrder : "originalOrder"'), 'embedded object link');
assert(/originalOrder_product \|\|--o\{ originalOrder_product_options : "options"/.test(nestedMd), 'list of subdocuments link');
assert(nestedMd.includes('    objectId _id'), 'attribute keeps its name, got the _id line missing');
assert(nestedMd.includes('### Document fields'), 'top-level fields section');
assert(nestedMd.includes('### `originalOrder.product.options[]` — list of objects'), 'section per subdocument');
assert(nestedMd.includes('| `tags[]` | list: string |'), 'a list of scalars is one row');
assert(!/\| `originalOrder\.product\.code`/.test(nestedMd), 'no dotted paths in the field tables');

console.log('md-test OK');
