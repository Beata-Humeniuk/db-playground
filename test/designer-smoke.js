'use strict';

const assert = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exit(1); } };

const Module = require('module');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'vscode') return 'vscode-stub';
  return originalResolve.call(this, request, ...rest);
};
require.cache['vscode-stub'] = { id: 'vscode-stub', filename: 'vscode-stub', loaded: true, exports: {} };

const { buildDesignerHtml, computePreviews } = require('../src/designerGui');
const { parseSqlText } = require('../src/sqlSchema');
const { toEditable } = require('../src/schemaEdit');

const html = buildDesignerHtml();
assert(html.includes('<html lang="en">'), 'English base without a display language');
assert(html.includes('Content-Security-Policy'), 'CSP present');
assert(html.includes("default-src 'none'"), 'restrictive CSP');
assert(html.includes('acquireVsCodeApi'), 'webview API acquired');
assert(html.includes('Database'), 'dialect picker label');
assert(html.includes('Tables'), 'tables heading');
assert(html.includes('Queries'), 'queries heading');
assert(html.includes('changes only'), 'diff mode option');
assert(html.includes('full CREATE'), 'full mode option');
assert(html.includes('PostgreSQL') && html.includes('MongoDB') && html.includes('Oracle'), 'dialect options injected');
assert(html.includes('"ph.queryName":"query name"'), 'query name left to the user');
assert(html.includes('function buildShape'), 'the shape code is injected into the page');
assert(!/value="[^"]*table1/.test(html), 'no auto-filled names');

const foreignHtml = buildDesignerHtml('pl-PL');
assert(foreignHtml.includes('<html lang="en">'), 'a foreign display language still renders English');
assert(foreignHtml === html, 'the page does not depend on the display language');
assert(!/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(html), 'no Polish text in the webview');
assert(html.includes('"shape.tree":"Tree"') && html.includes('Diagram'), 'shape views offered');
assert(html.includes('"zoom.fit":"Fit"'), 'diagram zoom controls');

const { dialect, schema } = toEditable(parseSqlText('CREATE TABLE users (id int PRIMARY KEY, email text NOT NULL);'));
const state = {
  source: 'x.sql',
  dialect,
  baseline: JSON.parse(JSON.stringify(schema)),
  schema: JSON.parse(JSON.stringify(schema)),
  queries: [{ id: 'q1', name: '', table: 'users', joins: [], columns: [], where: [], orderBy: [], limit: '5' }],
};
const clean = computePreviews(state, { scriptMode: 'diff', queryId: 'q1' });
assert(clean.script.includes('no changes'), 'no-changes placeholder, got: ' + clean.script);
assert(clean.sql.includes('SELECT *') && clean.sql.includes('LIMIT 5'), 'query preview, got: ' + clean.sql);

state.schema.tables[0].columns.push({ id: 'c99', name: 'phone', type: 'text', nullable: true, primaryKey: false, default: '', comment: '', autoIncrement: false });
const dirty = computePreviews(state, { scriptMode: 'diff', queryId: null });
assert(dirty.script.includes('ALTER TABLE users ADD COLUMN phone text;'), 'alter preview, got: ' + dirty.script);

const full = computePreviews(state, { scriptMode: 'full', queryId: null });
assert(full.script.includes('CREATE TABLE users ('), 'full preview');

const { savePlan } = require('../src/extension');
const defaults = savePlan('habitino', {});
assert(defaults.markdownDir === 'habitino-spec/db/model', 'default description dir, got ' + defaults.markdownDir);
assert(defaults.schemaDir === 'habitino-spec/db/model', 'default bridge dir, got ' + defaults.schemaDir);
const custom = savePlan('habitino', { modelFolder: 'docs-src/schemas' });
assert(custom.markdownDir === 'docs-src/schemas', 'modelFolder steers the description');
assert(custom.schemaDir === 'docs-src/schemas',
  'the bridge file follows modelFolder, got ' + custom.schemaDir);

console.log('designer-smoke OK');
