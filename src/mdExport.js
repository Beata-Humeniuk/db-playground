'use strict';

const { buildShape, objectNodes, containerKind, leafKind, typeColumn, hasNestedPaths } = require('./docShape');
const { DIALECTS } = require('./dialects');

const TYPE_LABELS = {
  integer: 'integer',
  number: 'number',
  boolean: 'boolean',
  date: 'date',
  datetime: 'date and time',
  string: 'text',
  null: 'empty',
  empty: 'empty',
  object: 'object',
  array: 'list',
  objectId: 'ObjectId',
  uuid: 'UUID',
  binary: 'binary',
  timestamp: 'timestamp',
  regex: 'regular expression',
};

const MONGO_TYPE_LABELS = DIALECTS.mongo.defaultTypes;

const DIALECT_LABELS = { mysql: 'MySQL/MariaDB', postgres: 'PostgreSQL' };

const SHAPE_WORDS = {
  object: 'object',
  list: 'list',
  listOfLists: 'list of lists',
  listOfObjects: 'list of objects',
  listOfListsOfObjects: 'list of lists of objects',
};

const DIAGRAM_TYPES = {
  integer: 'integer', number: 'number', boolean: 'boolean', date: 'date', datetime: 'datetime',
  string: 'string', objectId: 'ObjectId', uuid: 'UUID', binary: 'binary', timestamp: 'timestamp',
  regex: 'regex', object: 'object', array: 'list', null: 'empty', empty: 'empty',
};

function vocabulary(model) {
  const mongo = model.sourceFormat === 'json';
  return {
    types: mongo ? MONGO_TYPE_LABELS : TYPE_LABELS,
    diagram: mongo ? MONGO_TYPE_LABELS : DIAGRAM_TYPES,
  };
}

const MAX_DIAGRAM_FIELDS = 12;

function cell(value) {
  if (value == null || value === '') return '';
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function code(value) {
  const v = cell(value);
  return v ? '`' + v + '`' : '';
}

function typeText(col, voc) {
  if (!col) return '';
  if (col.type) return String(col.type);
  if (col.typeKeys && col.typeKeys.length) return col.typeKeys.map((k) => voc.types[k] || k).join(', ');
  return '';
}

function typeCell(col, voc) {
  if (col.type) return code(col.type);
  if (col.typeKeys && col.typeKeys.length) {
    return cell(col.typeKeys.map((k) => voc.types[k] || k).join(', '));
  }
  return '';
}

function keyCell(col) {
  const parts = [];
  if (col.primaryKey) parts.push('PK');
  if (col.references) {
    parts.push('FK → `' + col.references.table + (col.references.column ? '.' + col.references.column : '') + '`');
  }
  if (col.unique && !col.primaryKey) parts.push('UQ');
  return parts.join(', ');
}

function percent(value) {
  if (value == null) return '';
  return Math.round(value * 100) + '%';
}

function examplesCell(examples) {
  if (!examples || !examples.length) return '';
  return examples.map((e) => code(e)).join(', ');
}

function countLabel(n, forms) {
  return n.toLocaleString('en-US') + ' ' + (n === 1 ? forms[0] : forms[1]);
}

function mermaidName(name) {
  return String(name).replace(/[^A-Za-z0-9_]/g, '_');
}

function formatLabel(model) {
  if (model.sourceFormat === 'sql') {
    const dialect = DIALECT_LABELS[model.dialect];
    return 'SQL dump' + (dialect ? ' (' + dialect + ')' : '');
  }
  if (model.sourceFormat === 'csv') {
    const d = model.delimiter === '\t' ? 'tab' : '"' + model.delimiter + '"';
    return 'CSV file (delimiter: ' + d + ')';
  }
  const shape = { ndjson: 'NDJSON', array: 'array of documents', document: 'a single document' }[model.inputShape];
  return 'JSON export' + (shape ? ' (' + shape + ')' : '');
}

function titleFor(model, name) {
  if (model.sourceFormat === 'sql') return '# Database schema: ' + name;
  if (model.sourceFormat === 'csv') return '# Data description: ' + name;
  return '# Collection schema: ' + name;
}

function tableHeading(table) {
  if (table.kind === 'collection') return '## Collection: ' + table.name;
  if (table.kind === 'dataset') return '## Columns';
  return '## Table: ' + table.name;
}

function sqlColumnRows(table, voc) {
  const lines = [
    '| Column | Type | Required | Key | Default | Description |',
    '|---|---|---|---|---|---|',
  ];
  for (const col of table.columns) {
    const notes = [];
    if (col.comment) notes.push(col.comment);
    if (col.autoIncrement) notes.push('auto-increment');
    lines.push('| ' + [
      code(col.name),
      typeCell(col, voc),
      col.nullable === false ? 'yes' : '',
      keyCell(col),
      code(col.default),
      cell(notes.join('; ')),
    ].join(' | ') + ' |');
  }
  return lines;
}

function inferredColumnRows(table, voc) {
  const fieldLabel = table.kind === 'collection' ? 'Field' : 'Column';
  const presenceLabel = table.kind === 'collection' ? 'Presence' : 'Filled in';
  const lines = [
    '| ' + fieldLabel + ' | Type | ' + presenceLabel + ' | Key | Example values |',
    '|---|---|---|---|---|',
  ];
  for (const col of table.columns) {
    const key = [col.primaryKey ? 'PK' : '', col.unique ? 'UQ' : ''].filter(Boolean).join(', ');
    lines.push('| ' + [
      code(col.name),
      typeCell(col, voc),
      percent(col.presence),
      key,
      examplesCell(col.examples),
    ].join(' | ') + ' |');
  }
  return lines;
}

function diagramType(col, node, voc) {
  const key = (col && col.typeKeys && col.typeKeys[0]) || null;
  if (node && node.arrays) return 'list';
  return (key && voc.diagram[key]) || 'value';
}

function attrName(name) {
  const cleaned = String(name || '').replace(/[^A-Za-z0-9_]/g, '_');
  if (!cleaned || /^_+$/.test(cleaned)) return '';
  return /^[0-9]/.test(cleaned) ? 'p_' + cleaned : cleaned;
}

function entityNamer() {
  const taken = new Map();
  return (node, fallback) => {
    const raw = node.path ? node.path.replace(/\[\]/g, '') : (fallback || 'document');
    const base = mermaidName(raw) || 'document';
    if (!taken.has(base)) {
      taken.set(base, node.path);
      return base;
    }
    if (taken.get(base) === node.path) return base;
    let n = 2;
    while (taken.has(base + '_' + n)) n++;
    taken.set(base + '_' + n, node.path);
    return base + '_' + n;
  };
}

function documentDiagram(nodes, rootName, voc) {
  const nameOf = entityNamer();
  const ids = new Map();
  for (const { node } of nodes) ids.set(node, nameOf(node, rootName));
  const lines = ['```mermaid', 'erDiagram'];
  let truncated = false;
  for (const { node, parent } of nodes) {
    if (parent) {
      const arrow = node.arrays ? ' ||--o{ ' : ' ||--|| ';
      lines.push('  ' + ids.get(parent) + arrow + ids.get(node) + ' : "' + node.key.replace(/"/g, '') + '"');
    }
    const attrs = [];
    for (const child of node.children) {
      if (child.container) continue;
      const name = attrName(child.key);
      if (!name) continue;
      if (attrs.length >= MAX_DIAGRAM_FIELDS) { truncated = true; break; }
      attrs.push('    ' + diagramType(typeColumn(child), child, voc) + ' ' + name);
    }
    if (!attrs.length) {
      if (!parent) lines.push('  ' + ids.get(node));
      continue;
    }
    lines.push('  ' + ids.get(node) + ' {');
    lines.push(...attrs);
    lines.push('  }');
  }
  lines.push('```');
  if (truncated) {
    lines.push('');
    lines.push('The diagram shows the first ' + MAX_DIAGRAM_FIELDS +
      ' fields of every object — the full lists are in the tables below.');
  }
  return lines;
}

function shapeRows(node, voc) {
  const lines = [
    '| Field | Type | Presence | Key | Example values |',
    '|---|---|---|---|---|',
  ];
  for (const child of node.children) {
    const col = (child.container ? child.column : typeColumn(child)) || {};
    const type = child.container ? containerKind(child, SHAPE_WORDS) : leafKind(child, typeText(col, voc), SHAPE_WORDS);
    const key = [col.primaryKey ? 'PK' : '', col.unique ? 'UQ' : ''].filter(Boolean).join(', ');
    lines.push('| ' + [
      code(child.label),
      cell(type),
      percent(col.presence),
      key,
      child.container ? '' : examplesCell(col.examples),
    ].join(' | ') + ' |');
  }
  return lines;
}

function documentShapeSections(table, voc) {
  const root = buildShape(table.columns);
  const nodes = objectNodes(root);
  const lines = [];
  lines.push('### Document structure');
  lines.push('');
  lines.push(...documentDiagram(nodes, table.name, voc));
  lines.push('');
  for (const { node } of nodes) {
    if (!node.path) {
      lines.push('### Document fields');
    } else {
      lines.push('### ' + code(node.path) + ' — ' + containerKind(node, SHAPE_WORDS));
    }
    lines.push('');
    lines.push(...shapeRows(node, voc));
    lines.push('');
  }
  return lines;
}

function relationsSection(model) {
  const lines = ['## Relations', ''];
  lines.push('| Table | Columns | Points to | Columns |');
  lines.push('|---|---|---|---|');
  for (const rel of model.relations) {
    lines.push('| ' + [
      code(rel.fromTable),
      rel.fromColumns.map(code).join(', '),
      code(rel.toTable),
      rel.toColumns.map(code).join(', '),
    ].join(' | ') + ' |');
  }
  lines.push('');
  lines.push('```mermaid');
  lines.push('erDiagram');
  const declared = new Set();
  for (const rel of model.relations) {
    const from = mermaidName(rel.fromTable);
    const to = mermaidName(rel.toTable);
    declared.add(from);
    declared.add(to);
    lines.push('  ' + from + ' }o--|| ' + to + ' : "' + rel.fromColumns.join(', ') + '"');
  }
  for (const table of model.tables) {
    const name = mermaidName(table.name);
    if (!declared.has(name)) lines.push('  ' + name);
  }
  lines.push('```');
  return lines;
}

function modelToMarkdown(model, opts = {}) {
  const source = opts.source || '';
  const name = opts.name || source.replace(/\.[^.]+$/, '') || 'schema';
  const date = opts.date || new Date().toISOString().slice(0, 10);
  const voc = vocabulary(model);
  const lines = [];

  lines.push('---');
  lines.push('type: db-playground-schema');
  if (opts.generator) lines.push('generator: ' + opts.generator);
  lines.push('generated: ' + date);
  if (source) lines.push('source: ' + (/^[A-Za-z0-9._\/@-]+$/.test(source) ? source : JSON.stringify(source)));
  lines.push('sourceFormat: ' + model.sourceFormat);
  if (model.sourceFormat === 'sql' && model.dialect) lines.push('dialect: ' + DIALECT_LABELS[model.dialect]);
  lines.push('tables: ' + model.tables.length);
  lines.push('managed: true');
  lines.push('---');
  lines.push('');
  lines.push(titleFor(model, name));
  lines.push('');

  lines.push('| | |');
  lines.push('|---|---|');
  if (source) lines.push('| Source | ' + code(source) + ' |');
  lines.push('| Format | ' + cell(formatLabel(model)) + ' |');
  if (model.sourceFormat === 'sql') {
    lines.push('| Tables | ' + model.tables.length + ' |');
    if (model.relations.length) lines.push('| Relations | ' + model.relations.length + ' |');
  } else {
    const table = model.tables[0];
    const rowForms = table.kind === 'collection' ? ['document', 'documents'] : ['row', 'rows'];
    const colForms = table.kind === 'collection' ? ['field', 'fields'] : ['column', 'columns'];
    if (table.rowCount != null) lines.push('| Records | ' + countLabel(table.rowCount, rowForms) + ' |');
    lines.push('| ' + (table.kind === 'collection' ? 'Fields' : 'Columns') + ' | ' + countLabel(table.columns.length, colForms) + ' |');
    if (table.kind === 'collection' && hasNestedPaths(table.columns)) {
      const nested = objectNodes(buildShape(table.columns)).length - 1;
      if (nested > 0) {
        lines.push('| Nested objects | ' + countLabel(nested, ['object', 'objects']) + ' |');
      }
    }
  }
  lines.push('');

  for (const table of model.tables) {
    lines.push(tableHeading(table));
    lines.push('');
    if (table.comment) {
      lines.push(cell(table.comment));
      lines.push('');
    }
    if (model.sourceFormat === 'sql') {
      if (table.primaryKey.length) {
        lines.push('Primary key: ' + table.primaryKey.map(code).join(', '));
        lines.push('');
      }
      if (table.rowCount != null) {
        lines.push('Records in the dump: ' + table.rowCount.toLocaleString('en-US'));
        lines.push('');
      }
      lines.push(...sqlColumnRows(table, voc));
      if (table.indexes.length) {
        lines.push('');
        lines.push('Indexes:');
        for (const index of table.indexes) {
          const parts = [];
          if (index.name) parts.push(code(index.name));
          parts.push('(' + index.columns.map(code).join(', ') + ')');
          if (index.unique) parts.push('unique');
          lines.push('- ' + parts.join(' '));
        }
      }
    } else if (table.kind === 'collection' && hasNestedPaths(table.columns)) {
      lines.push(...documentShapeSections(table, voc));
    } else {
      lines.push(...inferredColumnRows(table, voc));
    }
    lines.push('');
  }

  if (model.relations.length) {
    lines.push(...relationsSection(model));
    lines.push('');
  }

  if (model.notes && model.notes.length) {
    lines.push('## Notes');
    lines.push('');
    for (const note of model.notes) lines.push('- ' + cell(note));
    lines.push('');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

module.exports = { modelToMarkdown };
