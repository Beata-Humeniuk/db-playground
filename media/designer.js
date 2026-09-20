const vscodeApi = acquireVsCodeApi();
let state = null;
let baselineIds = new Set();
const ui = { view: 'schema', tableId: null, queryId: null, scriptMode: 'diff', shapeView: 'tree', open: {}, zoom: 1 };
let sel = null;
let qsel = null;
let uidCounter = 1;
const $ = (id) => document.getElementById(id);

function M(key, params) {
  let text = NLS[key] || key;
  if (params) for (const name in params) text = text.replace('{' + name + '}', params[name]);
  return text;
}

const SHAPE_WORDS = {
  object: M('shape.object'),
  list: M('shape.listKind'),
  listOfLists: M('shape.listOfLists'),
  listOfObjects: M('shape.listOfObjects'),
  listOfListsOfObjects: M('shape.listOfListsOfObjects'),
};

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function keyboardClickable(node) {
  node.tabIndex = 0;
  node.onkeydown = (e) => {
    if (e.target !== node || (e.key !== 'Enter' && e.key !== ' ') || !node.onclick) return;
    e.preventDefault();
    node.onclick(e);
  };
}

function uid(prefix) { return prefix + (uidCounter++); }

function initUid() {
  let max = 0;
  const scan = (id) => { const m = /(\d+)$/.exec(String(id || '')); if (m) max = Math.max(max, parseInt(m[1], 10)); };
  for (const t of state.schema.tables) {
    scan(t.id);
    t.columns.forEach((c) => scan(c.id));
    t.indexes.forEach((ix) => scan(ix.id));
  }
  state.schema.relations.forEach((r) => scan(r.id));
  (state.queries || []).forEach((q) => scan(q.id));
  uidCounter = max + 1;
}

let syncTimer = null;
function sync() {
  clearTimeout(syncTimer);
  setStatus(M('status.saving'));
  syncTimer = setTimeout(() => {
    vscodeApi.postMessage({ type: 'state', dialect: state.dialect, schema: state.schema, queries: state.queries, ui });
  }, 250);
}

function setStatus(text) { $('status').textContent = text; }
const isMongo = () => DIALECT_KINDS[state.dialect] === 'mongo';
const isNew = (id) => !baselineIds.has(id);
const namedTables = () => state.schema.tables.filter((t) => t.name.trim());
const tableByName = (name) => state.schema.tables.find((t) => t.name === name);
const columnsOf = (name) => { const t = tableByName(name); return t ? t.columns.filter((c) => c.name.trim()) : []; };
const currentTable = () => state.schema.tables.find((t) => t.id === ui.tableId);
const relationFor = (table, col) => state.schema.relations.find(
  (r) => r.fromTable === table.name && r.fromColumns.length === 1 && r.fromColumns[0] === col.name
);

function renameTableRefs(oldName, newName) {
  if (!oldName) return;
  for (const r of state.schema.relations) {
    if (r.fromTable === oldName) r.fromTable = newName;
    if (r.toTable === oldName) r.toTable = newName;
  }
  for (const q of state.queries) {
    if (q.table === oldName) q.table = newName;
    for (const j of q.joins) {
      if (j.table === oldName) j.table = newName;
      if (j.toTable === oldName) j.toTable = newName;
    }
    for (const list of [q.columns, q.where, q.orderBy]) {
      for (const item of list) if (item.table === oldName) item.table = newName;
    }
  }
}

function renameColumnRefs(table, oldName, newName) {
  if (!oldName) return;
  const map = (c) => (c === oldName ? newName : c);
  for (const ix of table.indexes) ix.columns = ix.columns.map(map);
  for (const r of state.schema.relations) {
    if (r.fromTable === table.name) r.fromColumns = r.fromColumns.map(map);
    if (r.toTable === table.name) r.toColumns = r.toColumns.map(map);
  }
  for (const q of state.queries) {
    for (const j of q.joins) {
      if (j.table === table.name && j.fromColumn === oldName) j.fromColumn = newName;
      if (j.toTable === table.name && j.toColumn === oldName) j.toColumn = newName;
    }
    for (const list of [q.columns, q.where, q.orderBy]) {
      for (const item of list) if (item.table === table.name && item.column === oldName) item.column = newName;
    }
  }
}

function textInput(value, onInput, placeholder) {
  const input = el('input');
  input.type = 'text';
  input.value = value == null ? '' : value;
  if (placeholder) input.placeholder = placeholder;
  input.oninput = (e) => onInput(e.target.value);
  return input;
}

function textArea(value, onInput) {
  const input = el('textarea');
  input.value = value == null ? '' : value;
  input.oninput = (e) => onInput(e.target.value);
  return input;
}

function checkRow(text, checked, onChange, hintMono, purple) {
  const label = el('label', 'checkRow');
  const input = el('input');
  input.type = 'checkbox';
  if (purple) input.classList.add('purple');
  input.checked = Boolean(checked);
  input.onchange = (e) => onChange(e.target.checked);
  label.appendChild(input);
  label.appendChild(el('span', null, text));
  if (hintMono) label.appendChild(el('span', 'hintMono', hintMono));
  return label;
}

function selectInput(options, value, onChange) {
  const selNode = el('select');
  for (const opt of options) {
    const o = el('option', null, opt.label != null ? opt.label : opt.value);
    o.value = opt.value;
    selNode.appendChild(o);
  }
  selNode.value = value == null ? '' : value;
  selNode.onchange = (e) => onChange(e.target.value);
  return selNode;
}

function field(labelText, control) {
  const wrap = el('div', 'field');
  wrap.appendChild(el('span', 'lbl', labelText));
  wrap.appendChild(control);
  return wrap;
}

function badge(text, cls, tip) {
  const b = el('span', 'badge' + (cls ? ' ' + cls : ''), text);
  if (tip) b.title = tip;
  return b;
}

function section(headText, extras) {
  const wrap = el('div', 'section');
  const head = el('div', 'secHead');
  head.appendChild(el('span', null, headText));
  for (const x of extras || []) head.appendChild(x);
  wrap.appendChild(head);
  return { wrap, head };
}

function setCode(host, text) {
  host.innerHTML = '';
  for (const line of String(text || '').split('\n')) {
    const t = line.trim();
    const div = el('div', (t.startsWith('--') || t.startsWith('//')) ? 'cmt' : null);
    div.textContent = line || ' ';
    host.appendChild(div);
  }
}

function refreshTypeOptions() {
  const list = $('typeOptions');
  list.innerHTML = '';
  for (const t of DIALECT_TYPES[state.dialect] || []) {
    const o = el('option');
    o.value = t;
    list.appendChild(o);
  }
}

let shapeKey = null;
let shapeRoot = null;
function tableShape(table) {
  const key = table.id + '|' + table.columns.map((c) => c.name).join('>');
  if (key !== shapeKey) { shapeKey = key; shapeRoot = buildShape(table.columns); }
  return shapeRoot;
}

function plForm(n, key) {
  const forms = NLS_FORMS[key] || [key];
  if (n === 1) return forms[0];
  if (NLS_LANG === 'pl') {
    const d = n % 10;
    const h = n % 100;
    return (d >= 2 && d <= 4 && (h < 12 || h > 14)) ? forms[1] : forms[2];
  }
  return forms[forms.length - 1];
}

function shapeModes(table) {
  const modes = [];
  if (hasNestedPaths(table.columns)) modes.push({ key: 'tree', label: M('shape.tree') });
  modes.push({ key: 'list', label: M('shape.list') });
  modes.push({ key: 'diagram', label: M('shape.diagram') });
  return modes;
}

function shapeMode(table) {
  const keys = shapeModes(table).map((m) => m.key);
  return keys.indexOf(ui.shapeView) >= 0 ? ui.shapeView : keys[0];
}

function modeSwitch(table) {
  const wrap = el('div', 'viewSwitch');
  const mode = shapeMode(table);
  for (const m of shapeModes(table)) {
    const button = el('button', 'switchBtn' + (m.key === mode ? ' on' : ''), m.label);
    button.onclick = () => { ui.shapeView = m.key; renderSchemaView(); };
    wrap.appendChild(button);
  }
  return wrap;
}

const openKey = (table, node) => table.id + '::' + node.path;
const isOpen = (table, node) => ui.open[openKey(table, node)] === true;

function toggleNode(table, node) {
  const key = openKey(table, node);
  if (ui.open[key]) delete ui.open[key]; else ui.open[key] = true;
}

function openAll(table, value) {
  if (!value) { ui.open = {}; renderSchemaView(); return; }
  for (const entry of objectNodes(tableShape(table))) ui.open[openKey(table, entry.node)] = true;
  renderSchemaView();
}

function nodeTypeText(node) {
  if (node.container) return containerKind(node, SHAPE_WORDS);
  const col = typeColumn(node);
  return leafKind(node, col ? col.type : '', SHAPE_WORDS);
}

function treeRow(table, node, depth) {
  const primary = node.column || node.element;
  const selected = primary && sel && sel.kind === 'column' && sel.id === primary.id;
  const row = el('div', 'row treeRow' + (selected ? ' selected' : ''));
  row.style.paddingLeft = (6 + depth * 15) + 'px';
  const twisty = el('button', 'twisty', node.container ? (isOpen(table, node) ? '▾' : '▸') : '');
  twisty.title = node.container ? M('tree.expandCollapse') : '';
  twisty.onclick = (e) => {
    e.stopPropagation();
    if (!node.container) return;
    toggleNode(table, node);
    renderSchemaView();
  };
  row.appendChild(twisty);
  row.appendChild(el('span', 'cName treeName' + (primary && node.label ? '' : ' ghost'), node.label || M('ui.unnamed')));
  row.appendChild(el('span', 'cType', nodeTypeText(node)));
  const badges = el('div', 'badges');
  if (node.container) {
    const n = countShapeLeaves(node);
    badges.appendChild(badge(n + ' ' + plForm(n, 'plural.field'), 'soft', M('tree.fieldsInside')));
  }
  if (primary) {
    for (const b of columnBadges(table, primary)) badges.appendChild(badge(b[0], b[1], b[2]));
  }
  row.appendChild(badges);
  row.title = node.path + (primary && primary.comment ? ' - ' + primary.comment : '');
  keyboardClickable(row);
  row.onclick = () => {
    if (primary) sel = { kind: 'column', id: primary.id };
    else if (node.container) toggleNode(table, node);
    renderSchemaView();
  };
  return row;
}

function renderTreeRows(host, table) {
  const rows = el('div', 'rows');
  const walk = (node, depth) => {
    for (const child of node.children) {
      rows.appendChild(treeRow(table, child, depth));
      if (child.container && isOpen(table, child)) walk(child, depth + 1);
    }
  };
  walk(tableShape(table), 0);
  host.appendChild(rows);
}

const DG = { boxW: 236, rowH: 20, headH: 34, pad: 6, gapX: 84, gapY: 22, margin: 18, maxRows: 12 };
const SVG_NS = 'http://www.w3.org/2000/svg';
let fittedFor = null;

function documentDiagram(table) {
  const boxes = [];
  const edges = [];
  const byNode = new Map();
  for (const entry of objectNodes(tableShape(table))) {
    const node = entry.node;
    const rows = [];
    for (const child of node.children) {
      if (rows.length >= DG.maxRows) break;
      rows.push({ name: child.label || M('ui.unnamed'), type: nodeTypeText(child), ref: child.container });
    }
    const primary = node.column || node.element;
    const box = {
      key: node.path || '(document)',
      title: node.path ? node.label : (table.name.trim() || M('diagram.document')),
      kind: node.path ? containerKind(node, SHAPE_WORDS) : M('diagram.document'),
      rows: rows,
      hidden: Math.max(0, node.children.length - rows.length),
      selected: primary
        ? Boolean(sel && sel.kind === 'column' && sel.id === primary.id)
        : Boolean(!node.path && sel && sel.kind === 'table' && sel.id === table.id),
      onClick: () => {
        if (node.path && primary) sel = { kind: 'column', id: primary.id };
        else sel = { kind: 'table', id: table.id };
        if (node.container) ui.open[openKey(table, node)] = true;
        renderSchemaView();
      },
    };
    boxes.push(box);
    byNode.set(node, box);
    if (entry.parent) {
      edges.push({
        from: byNode.get(entry.parent).key, to: box.key,
        label: node.arrays ? 'n' : '1', many: Boolean(node.arrays),
      });
    }
  }
  return { boxes: boxes, edges: edges, legend: M('diagram.legendNesting') };
}

function tablesDiagram(current) {
  const boxes = [];
  const edges = [];
  for (const t of namedTables()) {
    const rows = [];
    for (const col of t.columns) {
      if (rows.length >= DG.maxRows) break;
      rows.push({ name: col.name || M('ui.unnamed'), type: col.type, key: col.primaryKey });
    }
    boxes.push({
      key: t.id,
      title: t.name,
      kind: t.comment || (isMongo() ? M('diagram.collection') : M('diagram.table')),
      rows: rows,
      hidden: Math.max(0, t.columns.length - rows.length),
      selected: t.id === current.id,
      onClick: () => { ui.tableId = t.id; sel = { kind: 'table', id: t.id }; renderSchemaView(); },
    });
  }
  const idOf = (name) => { const t = tableByName(name); return t ? t.id : null; };
  for (const rel of state.schema.relations) {
    const from = idOf(rel.toTable);
    const to = idOf(rel.fromTable);
    if (!from || !to) continue;
    edges.push({ from: from, to: to, label: rel.fromColumns.filter(Boolean).join(', '), many: true });
  }
  return {
    boxes: boxes, edges: edges,
    legend: edges.length ? M('diagram.legendFk') : '',
  };
}

function diagramModel(table) {
  return hasNestedPaths(table.columns) ? documentDiagram(table) : tablesDiagram(table);
}

function layoutDiagram(model) {
  const map = new Map();
  for (const b of model.boxes) {
    const shown = b.rows.length + (b.hidden ? 1 : 0);
    b.h = 2 + DG.headH + (shown ? shown * DG.rowH + DG.pad * 2 : 0);
    b.w = DG.boxW;
    b.depth = 0;
    b.parents = [];
    b.kids = [];
    b.placed = false;
    map.set(b.key, b);
  }
  const links = model.edges.filter((e) => map.has(e.from) && map.has(e.to) && e.from !== e.to);
  for (const e of links) {
    map.get(e.to).parents.push(map.get(e.from));
    map.get(e.from).kids.push(map.get(e.to));
  }
  for (let pass = 0; pass < model.boxes.length; pass++) {
    let moved = false;
    for (const e of links) {
      const a = map.get(e.from);
      const b = map.get(e.to);
      if (b.depth < a.depth + 1) { b.depth = a.depth + 1; moved = true; }
    }
    if (!moved) break;
  }
  const tidy = model.boxes.every((b) => b.parents.length <= 1);
  const nextY = {};
  const cursor = (d) => (nextY[d] == null ? DG.margin : nextY[d]);
  const place = (b) => {
    if (b.placed) return;
    b.placed = true;
    if (tidy && b.kids.length) {
      for (const kid of b.kids) place(kid);
      const first = b.kids[0];
      const last = b.kids[b.kids.length - 1];
      b.y = Math.max(cursor(b.depth), (first.y + last.y + last.h) / 2 - b.h / 2);
    } else {
      b.y = cursor(b.depth);
    }
    nextY[b.depth] = b.y + b.h + DG.gapY;
  };
  for (const b of model.boxes) if (!b.parents.length) place(b);
  for (const b of model.boxes) place(b);
  let width = 0;
  let height = 0;
  for (const b of model.boxes) {
    b.x = DG.margin + b.depth * (DG.boxW + DG.gapX);
    width = Math.max(width, b.x + b.w + DG.margin);
    height = Math.max(height, b.y + b.h + DG.margin);
  }
  return { boxes: model.boxes, links: links, map: map, width: width, height: height };
}

function edgeGeometry(a, b) {
  const rightward = a.x <= b.x;
  const x1 = rightward ? a.x + a.w : a.x;
  const x2 = rightward ? b.x : b.x + b.w;
  const y1 = a.y + a.h / 2;
  const y2 = b.y + b.h / 2;
  const bend = Math.max(30, Math.abs(x2 - x1) / 2.4) * (rightward ? 1 : -1);
  return {
    d: 'M ' + x1 + ' ' + y1 + ' C ' + (x1 + bend) + ' ' + y1 + ', ' + (x2 - bend) + ' ' + y2 + ', ' + x2 + ' ' + y2,
    x1: x1, y1: y1, x2: x2, y2: y2, rightward: rightward,
  };
}

function drawEdges(laid) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'dgEdges');
  svg.setAttribute('width', String(laid.width));
  svg.setAttribute('height', String(laid.height));
  for (const link of laid.links) {
    const geom = edgeGeometry(laid.map.get(link.from), laid.map.get(link.to));
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', geom.d);
    path.setAttribute('class', 'dgEdge');
    svg.appendChild(path);
    for (const point of [[geom.x1, geom.y1], [geom.x2, geom.y2]]) {
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', String(point[0]));
      dot.setAttribute('cy', String(point[1]));
      dot.setAttribute('r', '3');
      dot.setAttribute('class', 'dgDot');
      svg.appendChild(dot);
    }
    if (link.label) {
      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', String((geom.x1 + geom.x2) / 2));
      text.setAttribute('y', String((geom.y1 + geom.y2) / 2 - 5));
      text.setAttribute('class', 'dgLabel');
      text.setAttribute('text-anchor', 'middle');
      text.textContent = link.label.length > 18 ? link.label.slice(0, 17) + '…' : link.label;
      text.appendChild(document.createElementNS(SVG_NS, 'title')).textContent = link.label;
      svg.appendChild(text);
    }
  }
  return svg;
}

function diagramBox(b) {
  const box = el('div', 'dgBox' + (b.selected ? ' selected' : ''));
  box.style.left = b.x + 'px';
  box.style.top = b.y + 'px';
  box.style.width = b.w + 'px';
  const head = el('div', 'dgHead');
  head.appendChild(el('span', 'dgTitle', b.title));
  head.appendChild(el('span', 'dgKind', b.kind));
  head.title = b.title + (b.kind ? ' - ' + b.kind : '');
  box.appendChild(head);
  if (b.rows.length) {
    const body = el('div', 'dgBody');
    for (const r of b.rows) {
      const row = el('div', 'dgRow' + (r.ref ? ' ref' : ''));
      const name = el('span', 'dgF' + (r.key ? ' pk' : ''), r.name);
      row.appendChild(name);
      row.appendChild(el('span', 'dgT', r.type));
      row.title = r.name + (r.type ? ' - ' + r.type : '');
      body.appendChild(row);
    }
    if (b.hidden) {
      body.appendChild(el('div', 'dgMore', '+' + b.hidden + ' ' + plForm(b.hidden, 'plural.field')));
    }
    box.appendChild(body);
  }
  box.onclick = b.onClick;
  keyboardClickable(box);
  return box;
}

function renderDiagram(host, table) {
  const model = diagramModel(table);
  const laid = layoutDiagram(model);
  const wrap = el('div', 'dgWrap');
  const scroll = el('div', 'dgScroll');
  const sizer = el('div', 'dgSizer');
  const canvas = el('div', 'dgCanvas');
  canvas.style.width = laid.width + 'px';
  canvas.style.height = laid.height + 'px';
  canvas.appendChild(drawEdges(laid));
  for (const b of laid.boxes) canvas.appendChild(diagramBox(b));
  sizer.appendChild(canvas);
  scroll.appendChild(sizer);

  const zoomLabel = el('span', 'dgZoom mono');
  const applyZoom = () => {
    canvas.style.transform = 'scale(' + ui.zoom + ')';
    sizer.style.width = Math.ceil(laid.width * ui.zoom) + 'px';
    sizer.style.height = Math.ceil(laid.height * ui.zoom) + 'px';
    zoomLabel.textContent = Math.round(ui.zoom * 100) + '%';
  };
  const setZoom = (z) => { ui.zoom = Math.min(2.5, Math.max(0.25, z)); applyZoom(); };
  const fitTo = (both) => {
    const room = scroll.clientWidth - 8;
    if (room < 40) { applyZoom(); return; }
    const scale = both
      ? Math.min(1, room / laid.width, (scroll.clientHeight - 8) / laid.height)
      : Math.min(1, room / laid.width);
    setZoom(scale);
  };

  const bar = el('div', 'dgBar');
  if (laid.boxes.length) {
    const smaller = el('button', 'tiny', '−');
    smaller.title = M('zoom.out');
    smaller.onclick = () => setZoom(ui.zoom / 1.2);
    const bigger = el('button', 'tiny', '+');
    bigger.title = M('zoom.in');
    bigger.onclick = () => setZoom(ui.zoom * 1.2);
    const fitBtn = el('button', 'tiny', M('zoom.fit'));
    fitBtn.title = M('zoom.fitTitle');
    fitBtn.onclick = () => fitTo(true);
    bar.appendChild(smaller);
    bar.appendChild(zoomLabel);
    bar.appendChild(bigger);
    bar.appendChild(fitBtn);
    if (model.legend) bar.appendChild(el('span', 'dgHint', model.legend));
  }
  wrap.appendChild(bar);
  wrap.appendChild(scroll);
  host.appendChild(wrap);

  if (!laid.boxes.length) {
    scroll.appendChild(el('div', 'dgEmpty', M('diagram.empty')));
    return;
  }

  scroll.onwheel = (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom(ui.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  };
  let drag = null;
  scroll.onmousedown = (e) => {
    if (e.target.closest('.dgBox')) return;
    drag = { x: e.clientX, y: e.clientY, left: scroll.scrollLeft, top: scroll.scrollTop };
    scroll.classList.add('grabbing');
  };
  scroll.onmousemove = (e) => {
    if (!drag) return;
    scroll.scrollLeft = drag.left - (e.clientX - drag.x);
    scroll.scrollTop = drag.top - (e.clientY - drag.y);
  };
  const endDrag = () => { drag = null; scroll.classList.remove('grabbing'); };
  scroll.onmouseup = endDrag;
  scroll.onmouseleave = endDrag;

  if (fittedFor === table.id) applyZoom(); else { fittedFor = table.id; fitTo(false); }
}

function renderTableList() {
  $('tableListTitle').textContent = isMongo() ? M('list.collections') : M('ui.tables');
  const ul = $('tableList');
  ul.innerHTML = '';
  if (!state.schema.tables.length) {
    ul.appendChild(el('div', 'emptyList', isMongo() ? M('list.noCollections') : M('list.noTables')));
    return;
  }
  for (const t of state.schema.tables) {
    const li = el('li', t.id === ui.tableId ? 'active' : '');
    li.appendChild(el('span', 'liName' + (t.name.trim() ? '' : ' ghost'), t.name.trim() || M('ui.unnamed')));
    li.appendChild(el('span', 'liCount', String(t.columns.length)));
    li.onclick = () => { ui.tableId = t.id; sel = { kind: 'table', id: t.id }; renderSchemaView(); };
    keyboardClickable(li);
    ul.appendChild(li);
  }
}

function columnBadges(table, col) {
  const badges = [];
  if (col.primaryKey && !isMongo()) badges.push(['PK', 'pk', M('badge.pkTip')]);
  if (!isMongo()) {
    const rel = state.schema.relations.find((r) => r.fromTable === table.name && r.fromColumns.includes(col.name));
    if (rel) badges.push(['→ ' + rel.toTable + (rel.toColumns[0] ? '.' + rel.toColumns[0] : ''), '', M('badge.fkTip')]);
  }
  if (!col.nullable) badges.push(['●', 'req', isMongo() ? M('badge.requiredMongo') : M('badge.requiredSql')]);
  if (isNew(col.id)) badges.push([isMongo() ? M('badge.newMongo') : M('badge.newSql'), 'new', M('badge.newTip')]);
  return badges;
}

function renderSchemaContent() {
  const host = $('schemaContent');
  host.innerHTML = '';
  const table = currentTable();
  if (!table) {
    host.appendChild(el('div', 'contentEmpty',
      isMongo() ? M('empty.pickCollection') : M('empty.pickTable')));
    return;
  }
  const collection = isMongo();

  const title = el('div', 'titleRow' + (sel && sel.kind === 'table' ? ' selected' : ''));
  title.appendChild(el('span', 'tname' + (table.name.trim() ? '' : ' ghost'), table.name.trim() || M('ui.unnamed')));
  if (table.comment) title.appendChild(el('span', 'tdesc', table.comment));
  title.title = M('title.editHint');
  title.onclick = () => { sel = { kind: 'table', id: table.id }; renderSchemaView(); };
  keyboardClickable(title);
  host.appendChild(title);

  const mode = shapeMode(table);
  const heads = [el('span', 'count', String(table.columns.length))];
  if (mode === 'tree') {
    const expand = el('button', 'link', M('action.expandAll'));
    expand.onclick = () => openAll(table, true);
    const collapse = el('button', 'link', M('action.collapseAll'));
    collapse.onclick = () => openAll(table, false);
    heads.push(expand, collapse);
  }
  heads.push(modeSwitch(table));
  const cols = section(collection ? M('sec.fields') : M('sec.columns'), heads);
  if (mode === 'diagram') {
    cols.wrap.classList.add('grow');
    host.appendChild(cols.wrap);
    renderDiagram(cols.wrap, table);
    return;
  }
  if (mode === 'tree') {
    renderTreeRows(cols.wrap, table);
  } else {
    const colRows = el('div', 'rows');
    for (const col of table.columns) {
      const row = el('div', 'row pathRow' + (sel && sel.kind === 'column' && sel.id === col.id ? ' selected' : ''));
      row.appendChild(el('span', 'cName cPath' + (col.name.trim() ? '' : ' ghost'), col.name.trim() || M('ui.unnamed')));
      row.appendChild(el('span', 'cType', col.type));
      const badges = el('div', 'badges');
      for (const [text, cls, tip] of columnBadges(table, col)) badges.appendChild(badge(text, cls, tip));
      row.appendChild(badges);
      row.title = col.name + (col.comment ? ' — ' + col.comment : '');
      row.onclick = () => { sel = { kind: 'column', id: col.id }; renderSchemaView(); };
      keyboardClickable(row);
      colRows.appendChild(row);
    }
    cols.wrap.appendChild(colRows);
  }
  const addColWrap = el('div', 'addRow');
  const addCol = el('button', 'link', collection ? M('action.addField') : M('action.addColumn'));
  addCol.onclick = () => {
    const col = { id: uid('c'), name: '', type: DEFAULT_STRING_TYPE[state.dialect], nullable: true, primaryKey: false, default: '', comment: '', autoIncrement: false };
    table.columns.push(col);
    sel = { kind: 'column', id: col.id };
    renderSchemaView();
    const first = $('schemaProps').querySelector('input[type=text]');
    if (first) first.focus();
    sync();
  };
  addColWrap.appendChild(addCol);
  cols.wrap.appendChild(addColWrap);
  host.appendChild(cols.wrap);

  const ix = section(M('sec.indexes'));
  const ixRows = el('div', 'rows');
  for (const index of table.indexes) {
    const row = el('div', 'row' + (sel && sel.kind === 'index' && sel.id === index.id ? ' selected' : ''));
    row.appendChild(el('span', 'cName cWide' + (index.name.trim() ? '' : ' ghost'), index.name.trim() || M('ui.unnamed')));
    row.appendChild(el('span', 'cType cTypeWide', '(' + index.columns.join(', ') + ')'));
    const badges = el('div', 'badges');
    if (index.unique) badges.appendChild(badge('UQ', 'uq', M('badge.uniqueTip')));
    if (isNew(index.id)) badges.appendChild(badge(M('badge.newIndex'), 'new', M('badge.newTip')));
    row.appendChild(badges);
    row.onclick = () => { sel = { kind: 'index', id: index.id }; renderSchemaView(); };
    keyboardClickable(row);
    ixRows.appendChild(row);
  }
  ix.wrap.appendChild(ixRows);
  const addIxWrap = el('div', 'addRow');
  const addIx = el('button', 'link', M('action.addIndex'));
  addIx.onclick = () => {
    const index = { id: uid('i'), name: '', columns: [], unique: false };
    table.indexes.push(index);
    sel = { kind: 'index', id: index.id };
    renderSchemaView();
    const first = $('schemaProps').querySelector('input[type=text]');
    if (first) first.focus();
    sync();
  };
  addIxWrap.appendChild(addIx);
  ix.wrap.appendChild(addIxWrap);
  host.appendChild(ix.wrap);
}

function renderSchemaProps() {
  const host = $('schemaProps');
  host.innerHTML = '';
  const table = currentTable();
  const setTitle = (t) => { $('schemaPropsTitle').textContent = t; };
  if (!table || !sel) {
    setTitle(M('ui.properties'));
    host.appendChild(el('div', 'propsEmpty', M('props.nothingSelected')));
    return;
  }
  if (sel.kind === 'table') {
    setTitle(isMongo() ? M('props.collection') : M('props.table'));
    return renderTableProps(host, table);
  }
  if (sel.kind === 'column') {
    const col = table.columns.find((c) => c.id === sel.id);
    if (col) {
      setTitle(isMongo() ? M('props.field') : M('props.column'));
      return renderColumnProps(host, table, col);
    }
  }
  if (sel.kind === 'index') {
    const ix = table.indexes.find((x) => x.id === sel.id);
    if (ix) {
      setTitle(M('props.index'));
      return renderIndexProps(host, table, ix);
    }
  }
  setTitle(M('ui.properties'));
  host.appendChild(el('div', 'propsEmpty', M('props.nothingSelected')));
}

function renderTableProps(host, table) {
  const collection = isMongo();
  host.appendChild(field(M('field.name'), textInput(table.name, (v) => {
    renameTableRefs(table.name, v);
    table.name = v;
    renderTableList();
    refreshContentSoft();
    sync();
  }, collection ? M('ph.collectionName') : M('ph.tableName'))));
  host.appendChild(field(M('field.description'), textArea(table.comment, (v) => { table.comment = v; sync(); })));
  const remove = el('button', 'danger', collection ? M('action.deleteCollection') : M('action.deleteTable'));
  remove.onclick = () => {
    state.schema.tables = state.schema.tables.filter((t) => t.id !== table.id);
    state.schema.relations = state.schema.relations.filter((r) => r.fromTable !== table.name && r.toTable !== table.name);
    ui.tableId = state.schema.tables[0] ? state.schema.tables[0].id : null;
    sel = ui.tableId ? { kind: 'table', id: ui.tableId } : null;
    renderSchemaView();
    sync();
  };
  host.appendChild(remove);
}

function renderColumnProps(host, table, col) {
  const collection = isMongo();
  host.appendChild(field(M('field.name'), textInput(col.name, (v) => {
    renameColumnRefs(table, col.name, v);
    col.name = v;
    refreshContentSoft();
    sync();
  }, collection ? M('ph.fieldName') : M('ph.columnName'))));
  const typeInput = textInput(col.type, (v) => { col.type = v; refreshContentSoft(); sync(); });
  typeInput.setAttribute('list', 'typeOptions');
  host.appendChild(field(M('field.type'), typeInput));

  const checks = el('div', 'checkGroup');
  checks.appendChild(checkRow(collection ? M('check.requiredMongo') : M('check.requiredSql'), !col.nullable, (v) => {
    col.nullable = !v;
    refreshContentSoft();
    sync();
  }, collection ? '●' : 'NOT NULL'));
  if (!collection) {
    checks.appendChild(checkRow(M('check.primaryKey'), col.primaryKey, (v) => {
      col.primaryKey = v;
      refreshContentSoft();
      sync();
    }, 'PK'));
  }
  host.appendChild(checks);

  host.appendChild(field(M('field.default'), textInput(col.default, (v) => { col.default = v; sync(); }, M('ph.none'))));
  host.appendChild(field(M('field.description'), textArea(col.comment, (v) => { col.comment = v; sync(); })));

  if (!collection) {
    host.appendChild(el('div', 'sep'));
    renderColumnFk(host, table, col);
  }

  const remove = el('button', 'danger', collection ? M('action.deleteField') : M('action.deleteColumn'));
  remove.onclick = () => {
    table.columns = table.columns.filter((c) => c.id !== col.id);
    state.schema.relations = state.schema.relations.filter(
      (r) => !(r.fromTable === table.name && r.fromColumns.length === 1 && r.fromColumns[0] === col.name)
    );
    sel = { kind: 'table', id: table.id };
    renderSchemaView();
    sync();
  };
  host.appendChild(remove);
}

function renderColumnFk(host, table, col) {
  const rel = relationFor(table, col);
  const wrap = el('div', 'field');
  wrap.appendChild(el('span', 'lbl', M('field.fk')));
  const pair = el('div', 'pair');
  const tables = namedTables().filter((t) => t.id !== table.id).map((t) => ({ value: t.name }));
  pair.appendChild(selectInput([{ value: '', label: M('opt.none') }].concat(tables), rel ? rel.toTable : '', (v) => {
    let r = relationFor(table, col);
    if (!v) {
      if (r) state.schema.relations = state.schema.relations.filter((x) => x.id !== r.id);
    } else {
      if (!r) {
        r = { id: uid('r'), name: '', fromTable: table.name, fromColumns: [col.name], toTable: '', toColumns: [''] };
        state.schema.relations.push(r);
      }
      r.toTable = v;
      const target = tableByName(v);
      const pk = target ? target.columns.find((c) => c.primaryKey) : null;
      r.toColumns = [pk ? pk.name : ''];
    }
    renderSchemaView();
    sync();
  }));
  if (rel) {
    const cols = columnsOf(rel.toTable).map((c) => ({ value: c.name }));
    pair.appendChild(selectInput([{ value: '', label: M('opt.column') }].concat(cols), rel.toColumns[0] || '', (v) => {
      rel.toColumns = [v];
      refreshContentSoft();
      sync();
    }));
  }
  wrap.appendChild(pair);
  host.appendChild(wrap);
}

function renderIndexProps(host, table, ix) {
  host.appendChild(field(M('field.name'), textInput(ix.name, (v) => { ix.name = v; refreshContentSoft(); sync(); }, M('ph.indexName'))));
  host.appendChild(field(M('field.columns'), textInput(ix.columns.join(', '), (v) => {
    ix.columns = v.split(',').map((s) => s.trim()).filter(Boolean);
    refreshContentSoft();
    sync();
  }, M('ph.columnsCsv'))));
  const checks = el('div', 'checkGroup');
  checks.appendChild(checkRow(M('check.unique'), ix.unique, (v) => { ix.unique = v; refreshContentSoft(); sync(); }, 'UQ'));
  host.appendChild(checks);
  const remove = el('button', 'danger', M('action.deleteIndex'));
  remove.onclick = () => {
    table.indexes = table.indexes.filter((x) => x.id !== ix.id);
    sel = { kind: 'table', id: table.id };
    renderSchemaView();
    sync();
  };
  host.appendChild(remove);
}

function refreshContentSoft() {
  if (ui.view === 'schema') renderSchemaContent();
}

function renderSchemaView() {
  renderTableList();
  renderSchemaContent();
  renderSchemaProps();
}

function currentQuery() { return state.queries.find((q) => q.id === ui.queryId); }

function renderQueryList() {
  const ul = $('queryList');
  ul.innerHTML = '';
  if (!state.queries.length) {
    ul.appendChild(el('div', 'emptyList', M('list.noQueries')));
    return;
  }
  for (const q of state.queries) {
    const li = el('li', q.id === ui.queryId ? 'active' : '');
    li.appendChild(el('span', 'liName' + (q.name.trim() ? '' : ' ghost'), q.name.trim() || M('ui.unnamed')));
    li.onclick = () => { ui.queryId = q.id; qsel = null; renderQueryView(); sync(); };
    keyboardClickable(li);
    ul.appendChild(li);
  }
}

function includedTables(query) {
  const names = isMongo() ? [query.table] : [query.table].concat(query.joins.map((j) => j.table));
  return names.filter((n, i) => n && tableByName(n) && names.indexOf(n) === i);
}

function columnRefs(query) {
  const refs = [];
  for (const name of includedTables(query)) {
    for (const c of columnsOf(name)) refs.push({ table: name, column: c.name });
  }
  return refs;
}

function refSelect(query, current, onChange, emptyLabel) {
  const refs = columnRefs(query);
  const qualified = includedTables(query).length > 1;
  const options = [{ value: '', label: emptyLabel || M('opt.column') }].concat(refs.map((r, i) => ({
    value: String(i),
    label: qualified ? r.table + '.' + r.column : r.column,
  })));
  const idx = refs.findIndex((r) => r.table === current.table && r.column === current.column);
  return selectInput(options, idx >= 0 ? String(idx) : '', (v) => {
    const r = refs[parseInt(v, 10)];
    if (r) { current.table = r.table; current.column = r.column; } else { current.table = ''; current.column = ''; }
    onChange();
  });
}

function joinSuggestions(query) {
  const included = includedTables(query);
  const out = [];
  for (const rel of state.schema.relations) {
    let candidate = null;
    if (included.includes(rel.toTable) && !included.includes(rel.fromTable) && tableByName(rel.fromTable)) {
      candidate = { table: rel.fromTable, fromColumn: rel.fromColumns[0] || '', toTable: rel.toTable, toColumn: rel.toColumns[0] || '', via: rel.fromColumns[0] || '' };
    } else if (included.includes(rel.fromTable) && !included.includes(rel.toTable) && tableByName(rel.toTable)) {
      candidate = { table: rel.toTable, fromColumn: rel.toColumns[0] || '', toTable: rel.fromTable, toColumn: rel.fromColumns[0] || '', via: rel.fromColumns[0] || '' };
    }
    if (candidate && candidate.fromColumn && candidate.toColumn && !out.some((c) => c.table === candidate.table)) {
      out.push(candidate);
    }
  }
  return out;
}

function renderQueryEditor() {
  const host = $('queryEditor');
  host.innerHTML = '';
  $('sqlMode').textContent = isMongo() ? 'find' : 'SQL';
  const query = currentQuery();
  if (!query) {
    host.appendChild(el('div', 'contentEmpty', M('empty.addQuery')));
    return;
  }

  const head = el('div', 'headRow');
  const nameField = field(M('field.queryName'), textInput(query.name, (v) => { query.name = v; renderQueryList(); sync(); }, M('ph.queryName')));
  nameField.style.width = '240px';
  head.appendChild(nameField);
  const tableOpts = [{ value: '', label: M('opt.pick') }].concat(namedTables().map((t) => ({ value: t.name })));
  const tableSelect = selectInput(tableOpts, query.table, (v) => {
    query.table = v; query.joins = []; query.columns = []; qsel = null;
    renderQueryEditor(); renderQueryProps(); sync();
  });
  const tableField = field(M('field.lookingFor'), tableSelect);
  tableField.style.width = '260px';
  head.appendChild(tableField);
  head.appendChild(el('span', 'hint', M('hint.queryFlow')));
  host.appendChild(head);

  if (!query.table) return;

  if (!isMongo()) renderJoins(host, query);
  renderColumnPick(host, query);
  renderWhere(host, query);
  renderOrderAndLimit(host, query);
}

function joinTypeOptions() {
  return [
    { value: 'JOIN', label: M('join.matchedOnly') },
    { value: 'LEFT JOIN', label: M('join.alsoUnmatched') },
  ];
}

function renderJoins(host, query) {
  const suggestions = joinSuggestions(query);
  const hasAny = query.joins.length || suggestions.length;
  if (!hasAny) return;
  const sec = section(M('sec.joins'),
    suggestions.length ? [el('span', 'hint', M('hint.joinSuggestion'))] : []);

  for (const join of query.joins) {
    if (join.table && join.fromColumn && join.toColumn) {
      const row = el('div', 'joinRow' + (qsel && qsel.kind === 'join' && qsel.id === join.id ? ' selected' : ''));
      const label = el('span', 'joinLabel');
      label.appendChild(document.createTextNode(join.table + ' '));
      const via = el('span', 'mono', M('join.matchedBy') + join.toTable + '.' + join.toColumn + ' → ' + join.table + '.' + join.fromColumn);
      label.appendChild(via);
      row.appendChild(label);
      const typeSel = selectInput(joinTypeOptions(), join.type, (v) => { join.type = v; renderQueryProps(); sync(); });
      typeSel.onclick = (e) => e.stopPropagation();
      row.appendChild(typeSel);
      const rm = el('button', 'iconBtn', '×');
      rm.title = M('action.removeJoin');
      rm.onclick = (e) => { e.stopPropagation(); removeJoin(query, join); };
      row.appendChild(rm);
      row.onclick = () => { qsel = { kind: 'join', id: join.id }; renderQueryEditor(); renderQueryProps(); };
      sec.wrap.appendChild(row);
    } else {
      const row = el('div', 'condRow');
      const tableOpts = [{ value: '', label: M('opt.table') }].concat(namedTables().filter((t) => t.name !== query.table).map((t) => ({ value: t.name })));
      const tSel = selectInput(tableOpts, join.table, (v) => { join.table = v; renderQueryEditor(); sync(); });
      tSel.className = 'w-col';
      row.appendChild(tSel);
      row.appendChild(el('span', 'lbl muted', 'ON'));
      const fromOpts = [{ value: '', label: M('opt.column') }].concat(columnsOf(join.table).map((c) => ({ value: c.name })));
      row.appendChild(selectInput(fromOpts, join.fromColumn, (v) => { join.fromColumn = v; renderQueryEditor(); sync(); }));
      row.appendChild(el('span', 'lbl muted', '='));
      const toTableOpts = includedTables(query).filter((n) => n !== join.table).map((n) => ({ value: n }));
      row.appendChild(selectInput(toTableOpts, join.toTable || query.table, (v) => { join.toTable = v; join.toColumn = ''; renderQueryEditor(); sync(); }));
      const toColOpts = [{ value: '', label: M('opt.column') }].concat(columnsOf(join.toTable || query.table).map((c) => ({ value: c.name })));
      row.appendChild(selectInput(toColOpts, join.toColumn, (v) => { join.toColumn = v; join.toTable = join.toTable || query.table; renderQueryEditor(); renderQueryProps(); sync(); }));
      const rm = el('button', 'iconBtn', '×');
      rm.title = M('action.removeJoinRow');
      rm.onclick = () => removeJoin(query, join);
      row.appendChild(rm);
      sec.wrap.appendChild(row);
    }
  }

  const chipRow = el('div', 'formRow');
  for (const s of suggestions) {
    const chip = el('button', 'chipBtn');
    chip.appendChild(document.createTextNode('+ ' + s.table));
    chip.appendChild(el('span', 'tech', s.via));
    chip.title = M('join.byFk');
    chip.onclick = () => {
      const join = { id: uid('j'), type: 'LEFT JOIN', table: s.table, fromColumn: s.fromColumn, toTable: s.toTable, toColumn: s.toColumn };
      query.joins.push(join);
      qsel = { kind: 'join', id: join.id };
      renderQueryEditor(); renderQueryProps(); sync();
    };
    chipRow.appendChild(chip);
  }
  const manual = el('button', 'link', M('action.otherJoin'));
  manual.onclick = () => {
    query.joins.push({ id: uid('j'), type: 'LEFT JOIN', table: '', fromColumn: '', toTable: query.table, toColumn: '' });
    renderQueryEditor(); sync();
  };
  chipRow.appendChild(manual);
  sec.wrap.appendChild(chipRow);
  host.appendChild(sec.wrap);
}

function removeJoin(query, join) {
  query.joins = query.joins.filter((j) => j.id !== join.id);
  query.columns = query.columns.filter((c) => c.table !== join.table);
  if (qsel && qsel.kind === 'join' && qsel.id === join.id) qsel = null;
  renderQueryEditor(); renderQueryProps(); sync();
}

function renderColumnPick(host, query) {
  const sec = section(M('sec.output'), [el('span', 'hint', M('hint.nonePicked'))]);
  const groups = el('div', 'pickGroups');
  for (const name of includedTables(query)) {
    const table = tableByName(name);
    const group = el('div', 'pickGroup');
    group.appendChild(el('span', 'pgTitle mono', name));
    for (const col of columnsOf(name)) {
      const item = el('label', 'pickItem');
      const input = el('input');
      input.type = 'checkbox';
      input.classList.add('purple');
      input.checked = query.columns.some((c) => c.table === name && c.column === col.name);
      input.onchange = (e) => {
        if (e.target.checked) query.columns.push({ table: name, column: col.name });
        else query.columns = query.columns.filter((c) => !(c.table === name && c.column === col.name));
        sync();
      };
      item.appendChild(input);
      if (col.comment) {
        item.appendChild(el('span', 'pLabel', col.comment));
        item.appendChild(el('span', 'pName', col.name));
      } else {
        item.appendChild(el('span', 'pLabel mono', col.name));
      }
      group.appendChild(item);
    }
    groups.appendChild(group);
  }
  sec.wrap.appendChild(groups);
  host.appendChild(sec.wrap);
}

function renderWhere(host, query) {
  const sec = section(M('sec.where'));
  for (const w of query.where) {
    const row = el('div', 'condRow');
    const colSel = refSelect(query, w, () => sync());
    colSel.className = 'w-col';
    row.appendChild(colSel);
    const opSel = selectInput(OPERATORS.map((op) => ({ value: op, label: OP_LABELS[op] || op })), w.op, (v) => { w.op = v; renderQueryEditor(); sync(); });
    opSel.className = 'w-op';
    row.appendChild(opSel);
    if (w.op !== 'IS NULL' && w.op !== 'IS NOT NULL') {
      const valueInput = textInput(w.value, (v) => { w.value = v; sync(); }, w.op === 'IN' ? M('ph.valuesCsv') : M('ph.value'));
      valueInput.className = 'w-val';
      row.appendChild(valueInput);
    }
    const rm = el('button', 'iconBtn', '×');
    rm.title = M('action.removeCondition');
    rm.onclick = () => { query.where = query.where.filter((x) => x.id !== w.id); renderQueryEditor(); sync(); };
    row.appendChild(rm);
    sec.wrap.appendChild(row);
  }
  const add = el('button', 'link', M('action.addCondition'));
  add.onclick = () => {
    query.where.push({ id: uid('w'), table: '', column: '', op: '=', value: '' });
    renderQueryEditor(); sync();
  };
  sec.wrap.appendChild(add);
  host.appendChild(sec.wrap);
}

function renderOrderAndLimit(host, query) {
  const sec = section(M('sec.orderLimit'));
  const row = el('div', 'orderRow');
  if (!query.orderBy.length) query.orderBy = [{ id: uid('o'), table: '', column: '', dir: 'ASC' }];
  const o = query.orderBy[0];
  row.appendChild(el('span', 'lbl', M('order.first')));
  const colSel = refSelect(query, o, () => sync(), M('opt.noSort'));
  colSel.style.width = '200px';
  row.appendChild(colSel);
  row.appendChild(selectInput([
    { value: 'ASC', label: M('order.asc') },
    { value: 'DESC', label: M('order.desc') },
  ], o.dir, (v) => { o.dir = v; sync(); }));
  row.appendChild(el('span', 'lbl', M('order.showAtMost')));
  const limitInput = el('input');
  limitInput.type = 'number';
  limitInput.min = '1';
  limitInput.value = query.limit || '';
  limitInput.oninput = (e) => { query.limit = e.target.value; sync(); };
  row.appendChild(limitInput);
  row.appendChild(el('span', 'lbl', M('order.rows')));
  sec.wrap.appendChild(row);
  host.appendChild(sec.wrap);
}

function renderQueryProps() {
  const host = $('queryProps');
  host.innerHTML = '';
  const setTitle = (t) => { $('queryPropsTitle').textContent = t; };
  const query = currentQuery();
  if (!query) {
    setTitle(M('ui.properties'));
    host.appendChild(el('div', 'propsEmpty', M('props.nothingSelected')));
    return;
  }
  const join = !isMongo() && qsel && qsel.kind === 'join' ? query.joins.find((j) => j.id === qsel.id) : null;
  if (join && join.table && join.fromColumn && join.toColumn) {
    setTitle(M('props.joinedData'));
    return renderJoinProps(host, query, join);
  }
  setTitle(M('props.query'));
  host.appendChild(field(M('field.name'), textInput(query.name, (v) => { query.name = v; renderQueryList(); renderQueryEditor(); sync(); }, M('ph.queryName'))));
  const remove = el('button', 'danger', M('action.deleteQuery'));
  remove.onclick = () => {
    state.queries = state.queries.filter((q) => q.id !== query.id);
    ui.queryId = state.queries[0] ? state.queries[0].id : null;
    qsel = null;
    renderQueryView(); sync();
  };
  host.appendChild(remove);
}

function renderJoinProps(host, query, join) {
  const what = el('div', 'field');
  what.appendChild(el('span', 'lbl', M('join.what')));
  what.appendChild(el('div', 'valueBox', join.table));
  host.appendChild(what);

  const rowsWrap = el('div', 'field');
  rowsWrap.appendChild(el('span', 'lbl', M('join.unmatchedRows')));
  const group = el('div', 'checkGroup');
  group.appendChild(checkRow(M('join.skipThem'), join.type === 'JOIN', (v) => {
    join.type = v ? 'JOIN' : 'LEFT JOIN';
    renderQueryEditor(); renderQueryProps(); sync();
  }, null, true));
  group.appendChild(checkRow(M('join.showEmpty'), join.type === 'LEFT JOIN', (v) => {
    join.type = v ? 'LEFT JOIN' : 'JOIN';
    renderQueryEditor(); renderQueryProps(); sync();
  }, null, true));
  group.appendChild(el('span', 'hintMono mono', 'JOIN / LEFT JOIN'));
  rowsWrap.appendChild(group);
  host.appendChild(rowsWrap);

  const match = el('div', 'field');
  match.appendChild(el('span', 'lbl', M('join.match')));
  match.appendChild(el('div', 'valueBox', join.table + '.' + join.fromColumn + ' = ' + join.toTable + '.' + join.toColumn));
  match.appendChild(el('span', 'fieldNote', M('join.fromSchemaNote')));
  host.appendChild(match);

  const remove = el('button', 'danger', M('action.removeJoin'));
  remove.onclick = () => removeJoin(query, join);
  host.appendChild(remove);
}

function renderQueryView() {
  renderQueryList();
  renderQueryEditor();
  renderQueryProps();
}

function renderHeader() {
  $('sourceName').textContent = state.source || '';
  const selNode = $('dialect');
  selNode.innerHTML = '';
  for (const d of DIALECT_OPTIONS) {
    const o = el('option', null, d.label);
    o.value = d.key;
    selNode.appendChild(o);
  }
  selNode.value = state.dialect;
}

function showView(view) {
  ui.view = view;
  $('schemaView').hidden = view !== 'schema';
  $('queryView').hidden = view !== 'queries';
  $('tabSchema').classList.toggle('active', view === 'schema');
  $('tabQueries').classList.toggle('active', view === 'queries');
}

function renderAll() {
  renderHeader();
  refreshTypeOptions();
  renderSchemaView();
  renderQueryView();
}

$('dialect').onchange = (e) => { state.dialect = e.target.value; renderAll(); sync(); };
$('tabSchema').onclick = () => showView('schema');
$('tabQueries').onclick = () => showView('queries');
$('addTable').onclick = () => {
  const t = { id: uid('t'), name: '', comment: '', columns: [], indexes: [] };
  state.schema.tables.push(t);
  ui.tableId = t.id;
  sel = { kind: 'table', id: t.id };
  renderSchemaView();
  const first = $('schemaProps').querySelector('input[type=text]');
  if (first) first.focus();
  sync();
};
$('addQuery').onclick = () => {
  const q = { id: uid('q'), name: '', table: '', joins: [], columns: [], where: [], orderBy: [], limit: '' };
  state.queries.push(q);
  ui.queryId = q.id;
  qsel = null;
  renderQueryView();
  const first = $('queryEditor').querySelector('input[type=text]');
  if (first) first.focus();
  sync();
};
$('scriptMode').onchange = (e) => { ui.scriptMode = e.target.value; sync(); };
$('openScript').onclick = () => vscodeApi.postMessage({ type: 'open', which: 'script', ui });
$('copyScript').onclick = () => vscodeApi.postMessage({ type: 'copy', text: $('scriptPreview').innerText });
$('openSql').onclick = () => vscodeApi.postMessage({ type: 'open', which: 'sql', ui });
$('copySql').onclick = () => vscodeApi.postMessage({ type: 'copy', text: $('sqlPreview').innerText });
$('sendSql').onclick = () => vscodeApi.postMessage({ type: 'sendSql', ui });

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || !msg.type) return;
  if (msg.type === 'load') {
    state = msg.state;
    if (!Array.isArray(state.queries)) state.queries = [];
    baselineIds = new Set(msg.baselineIds || []);
    initUid();
    ui.tableId = state.schema.tables[0] ? state.schema.tables[0].id : null;
    ui.queryId = state.queries[0] ? state.queries[0].id : null;
    sel = ui.tableId ? { kind: 'table', id: ui.tableId } : null;
    qsel = null;
    renderAll();
    sync();
    return;
  }
  if (msg.type === 'previews') {
    setCode($('scriptPreview'), msg.script || '');
    setCode($('sqlPreview'), msg.sql || '');
    return;
  }
  if (msg.type === 'logicSpec') {
    $('sendSql').hidden = !msg.available;
    return;
  }
  if (msg.type === 'saved') {
    if (msg.error) {
      setStatus(M('status.saveError', { error: msg.error }));
    } else {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      setStatus(M('status.savedAt', { time: hh + ':' + mm }));
    }
  }
});

vscodeApi.postMessage({ type: 'ready', ui });
