'use strict';

const assert = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exit(1); } };

const Module = require('module');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'vscode') return 'vscode-stub';
  return originalResolve.call(this, request, ...rest);
};
require.cache['vscode-stub'] = { id: 'vscode-stub', filename: 'vscode-stub', loaded: true, exports: {} };

const { buildDesignerHtml } = require('../src/designerGui');
const { readJsonText } = require('../src/jsonSchema');
const { parseSqlText } = require('../src/sqlSchema');
const { toEditable } = require('../src/schemaEdit');

function makeElement(tag) {
  const node = {
    tagName: tag,
    children: [],
    style: {},
    attrs: {},
    className: '',
    textContent: '',
    title: '',
    value: '',
    hidden: false,
    disabled: false,
    clientWidth: 900,
    scrollLeft: 0,
    scrollTop: 0,
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    setAttribute(key, value) { this.attrs[key] = value; },
    getAttribute(key) { return this.attrs[key]; },
    querySelector() { return null; },
    closest() { return null; },
    addEventListener() {},
  };
  node.classList = {
    add(name) { if (!node.className.split(' ').includes(name)) node.className = (node.className + ' ' + name).trim(); },
    remove(name) { node.className = node.className.split(' ').filter((c) => c && c !== name).join(' '); },
    contains(name) { return node.className.split(' ').includes(name); },
    toggle(name, on) { if (on) node.classList.add(name); else node.classList.remove(name); },
  };
  Object.defineProperty(node, 'innerHTML', {
    get() { return ''; },
    set() { node.children = []; },
  });
  return node;
}

function runPage(html) {
  const byId = new Map();
  const document = {
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, makeElement('div'));
      return byId.get(id);
    },
    createElement: makeElement,
    createElementNS: (ns, tag) => makeElement(tag),
  };
  const messages = [];
  let onMessage = null;
  const window = {
    addEventListener(type, fn) { if (type === 'message') onMessage = fn; },
  };
  const script = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  const run = new Function('document', 'window', 'acquireVsCodeApi', script);
  run(document, window, () => ({ postMessage: (m) => messages.push(m) }));
  return {
    byId,
    messages,
    load: (state, baselineIds) => onMessage({ data: { type: 'load', state, baselineIds } }),
  };
}

const walk = (node, out) => {
  for (const child of node.children || []) {
    out.push(child);
    walk(child, out);
  }
  return out;
};
const all = (node) => walk(node, []);
const withClass = (node, name) => all(node).filter((n) => String(n.className).split(' ').includes(name));
const findText = (node, text) => all(node).find((n) => n.textContent === text);

const DOC = {
  _id: { $oid: '6613f0a2e4b0a1a2b3c4d5e6' },
  orderId: 'A-1',
  status: 'NEW',
  originalOrder: {
    product: { code: 'X', name: 'Y', options: [{ id: 1, label: 'l' }] },
    customer: { name: 'Ala', taxIdStatus: true },
  },
  tags: ['a', 'b'],
};

const mongo = toEditable(readJsonText(JSON.stringify(DOC), { name: 'Storefront.order' }));
const mongoState = {
  source: 'order.json',
  dialect: mongo.dialect,
  schema: mongo.schema,
  queries: [],
};
assert(mongo.dialect === 'mongo', 'JSON source opens as MongoDB');

const page = runPage(buildDesignerHtml());
page.load(JSON.parse(JSON.stringify(mongoState)), mongo.schema.tables[0].columns.map((c) => c.id));

const content = page.byId.get('schemaContent');
const columnCount = mongo.schema.tables[0].columns.length;

let rows = withClass(content, 'treeRow');
assert(rows.length > 0, 'tree rows rendered');
assert(rows.length < columnCount, 'collapsed tree is shorter than the ' + columnCount + ' paths, got ' + rows.length);
const names = withClass(content, 'treeName').map((n) => n.textContent);
assert(names.includes('orderId'), 'top-level field shown, got ' + names.join(', '));
assert(names.includes('originalOrder'), 'subdocument shown as one row');
assert(names.includes('tags[]'), 'a list of scalars keeps its list marker');
assert(!names.some((n) => n.indexOf('.') >= 0), 'no dotted paths in the tree, got ' + names.join(', '));

const typeOf = (name) => {
  const row = withClass(content, 'treeRow').find((r) => withClass(r, 'treeName')[0].textContent === name);
  return withClass(row, 'cType')[0].textContent;
};
assert(typeOf('originalOrder') === 'object', 'subdocument type, got ' + typeOf('originalOrder'));
assert(typeOf('tags[]') === 'list: string', 'list of strings, got ' + typeOf('tags[]'));

findText(content, 'Expand all').onclick();
const expanded = withClass(page.byId.get('schemaContent'), 'treeName').map((n) => n.textContent);
assert(expanded.includes('options[]'), 'list of subdocuments reached, got ' + expanded.join(', '));
assert(expanded.includes('taxIdStatus'), 'deep leaf reached');
assert(expanded.length > rows.length, 'expanding shows more rows');

findText(page.byId.get('schemaContent'), 'Collapse all').onclick();
assert(withClass(page.byId.get('schemaContent'), 'treeRow').length === rows.length, 'collapsing goes back');

findText(page.byId.get('schemaContent'), 'List').onclick();
const listRows = withClass(page.byId.get('schemaContent'), 'row');
assert(listRows.length === columnCount, 'list mode keeps all ' + columnCount + ' columns, got ' + listRows.length);

findText(page.byId.get('schemaContent'), 'Diagram').onclick();
let diagram = page.byId.get('schemaContent');
const boxes = withClass(diagram, 'dgBox');
const titles = withClass(diagram, 'dgTitle').map((n) => n.textContent);
assert(boxes.length === 5, 'root + 4 subdocuments, got ' + boxes.length + ': ' + titles.join(', '));
assert(titles.includes('Storefront.order'), 'the collection is the root box, got ' + titles.join(', '));
assert(titles.includes('options[]'), 'a list of subdocuments gets its own box');
const edges = all(diagram).filter((n) => n.attrs.class === 'dgEdge');
assert(edges.length === 4, 'four nesting links, got ' + edges.length);
const labels = all(diagram).filter((n) => n.attrs.class === 'dgLabel').map((n) => n.textContent);
assert(labels.filter((l) => l === 'n').length === 1, 'the list link is marked n, got ' + labels.join(', '));
assert(withClass(diagram, 'dgZoom')[0].textContent.endsWith('%'), 'zoom level shown');

const sql = toEditable(parseSqlText(
  'CREATE TABLE users (id integer PRIMARY KEY, email text NOT NULL);\n' +
  'CREATE TABLE orders (id integer PRIMARY KEY, user_id integer REFERENCES users(id));'
));
const sqlPage = runPage(buildDesignerHtml());
sqlPage.load({ source: 'dump.sql', dialect: sql.dialect, schema: sql.schema, queries: [] }, []);
const sqlContent = sqlPage.byId.get('schemaContent');
assert(!findText(sqlContent, 'Tree'), 'no tree offered for a schema without nesting');
assert(withClass(sqlContent, 'row').length === 2, 'columns of the selected table listed');

findText(sqlContent, 'Diagram').onclick();
const sqlDiagram = sqlPage.byId.get('schemaContent');
const sqlTitles = withClass(sqlDiagram, 'dgTitle').map((n) => n.textContent);
assert(sqlTitles.length === 2 && sqlTitles.includes('users') && sqlTitles.includes('orders'),
  'both tables drawn, got ' + sqlTitles.join(', '));
const sqlLabels = all(sqlDiagram).filter((n) => n.attrs.class === 'dgLabel').map((n) => n.textContent);
assert(sqlLabels.includes('user_id'), 'the foreign key names the link, got ' + sqlLabels.join(', '));

console.log('designer-render-test OK');
