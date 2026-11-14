'use strict';

// Drift between the schema the project describes (the model) and the schema
// exported from a live database (a schema-only dump). Both sides arrive as
// `.schema.json` objects (see schemaJson.editableToJson). Pure functions: no
// VS Code, no I/O, so the comparison is testable on its own.

const lower = (s) => String(s == null ? '' : s).trim().toLowerCase();
const unqualified = (name) => {
  const parts = lower(name).replace(/["`[\]]/g, '').split('.');
  return parts[parts.length - 1];
};

const TYPE_ALIASES = {
  'character varying': 'varchar',
  'varchar2': 'varchar',
  'nvarchar2': 'nvarchar',
  'character': 'char',
  'int': 'integer',
  'int4': 'integer',
  'serial': 'integer',
  'serial4': 'integer',
  'mediumint': 'integer',
  'int8': 'bigint',
  'bigserial': 'bigint',
  'serial8': 'bigint',
  'int2': 'smallint',
  'smallserial': 'smallint',
  'bool': 'boolean',
  'timestamp without time zone': 'timestamp',
  'timestamp with time zone': 'timestamptz',
  'time without time zone': 'time',
  'time with time zone': 'timetz',
  'double precision': 'double',
  'float8': 'double',
  'float4': 'real',
  'decimal': 'numeric',
  'dec': 'numeric',
};

const INTEGER_TYPES = /^(tinyint|smallint|mediumint|int|integer|bigint)$/;

function normType(type) {
  let t = lower(type).replace(/\s+/g, ' ').replace(/\s*([(),])\s*/g, '$1');
  const m = /^([a-z0-9_ ]+?)(\(.*\))?((?: [a-z ]+)*)$/.exec(t);
  if (!m) return t;
  let base = m[1].trim();
  let args = m[2] || '';
  let rest = (m[3] || '').trim();
  // "timestamp(3) with time zone" — the precision sits between the words.
  const joined = (base + (rest ? ' ' + rest : '')).trim();
  if (TYPE_ALIASES[joined]) {
    base = TYPE_ALIASES[joined];
    rest = '';
  } else if (TYPE_ALIASES[base]) {
    base = TYPE_ALIASES[base];
  }
  // MySQL display width (int(11)) means nothing for the stored values.
  if (INTEGER_TYPES.test(base)) {
    if (base === 'int') base = 'integer';
    args = '';
  }
  return base + args + (rest ? ' ' + rest : '');
}

function normDefault(value) {
  let v = String(value == null ? '' : value).trim();
  if (!v) return '';
  for (let i = 0; i < 3; i++) {
    const stripped = v.replace(/::[a-z_ ]+(\([^)]*\))?(\[\])?$/i, '').trim();
    const unwrapped = /^\((.*)\)$/.test(stripped) ? stripped.slice(1, -1).trim() : stripped;
    if (unwrapped === v) break;
    v = unwrapped;
  }
  const l = v.toLowerCase();
  if (l === 'now()' || l === 'current_timestamp()' || l === 'getdate()' || l === 'sysdate'
    || l === 'systimestamp' || l === 'localtimestamp') return 'current_timestamp';
  if (l === 'null') return '';
  if (l === "'t'" || l === 'true' || l === "b'1'") return 'true';
  if (l === "'f'" || l === 'false' || l === "b'0'") return 'false';
  if (/^'-?\d+(\.\d+)?'$/.test(v)) return v.slice(1, -1);
  return /^'.*'$/.test(v) ? v : l;
}

const isSequenceDefault = (v) => /^nextval\s*\(/i.test(String(v || '').trim());

const columnNullable = (c) => c.nullable !== false && !c.primaryKey;

function findTable(json, name) {
  const tables = json.tables || [];
  return tables.find((t) => lower(t.name) === lower(name))
    || tables.find((t) => unqualified(t.name) === unqualified(name))
    || null;
}

const indexKey = (ix) => (ix.unique ? 'u:' : 'i:') + (ix.columns || []).map(lower).join(',');
const relationKey = (r) => [
  unqualified(r.fromTable), (r.fromColumns || []).map(lower).join(','),
  unqualified(r.toTable), (r.toColumns || []).map(lower).join(',')
].join('|');

function pkKey(table) {
  return (table.columns || []).filter((c) => c.primaryKey).map((c) => lower(c.name)).sort().join(',');
}

// Every index on the primary key alone is the key itself, however a dump
// spells it.
function plainIndexes(table) {
  const pk = pkKey(table);
  return (table.indexes || []).filter((ix) => {
    const cols = (ix.columns || []).map(lower).sort().join(',');
    return !(pk && cols === pk);
  });
}

function schemaDrift(model, database, options) {
  const opts = options || {};
  const drift = {
    missingTables: [],   // in the model, not in the database
    extraTables: [],     // in the database, not in the model
    missingColumns: [],
    extraColumns: [],
    columnDiffs: [],     // same column, different definition
    primaryKeys: [],
    missingIndexes: [],
    extraIndexes: [],
    missingRelations: [],
    extraRelations: [],
  };
  const matched = new Set();
  for (const mt of model.tables || []) {
    const dt = findTable(database, mt.name);
    if (!dt) {
      drift.missingTables.push({ table: mt.name });
      continue;
    }
    matched.add(dt);
    const dbCols = new Map((dt.columns || []).map((c) => [lower(c.name), c]));
    const seen = new Set();
    for (const mc of mt.columns || []) {
      const dc = dbCols.get(lower(mc.name));
      if (!dc) {
        drift.missingColumns.push({ table: mt.name, column: mc.name, type: mc.type || '' });
        continue;
      }
      seen.add(lower(mc.name));
      const diffs = [];
      if (!opts.ignoreTypes && normType(mc.type) !== normType(dc.type)) {
        diffs.push({ what: 'type', model: mc.type || '', database: dc.type || '' });
      }
      if (columnNullable(mc) !== columnNullable(dc)) {
        diffs.push({
          what: 'nullable',
          model: columnNullable(mc) ? 'NULL' : 'NOT NULL',
          database: columnNullable(dc) ? 'NULL' : 'NOT NULL'
        });
      }
      const sequence = mc.autoIncrement || dc.autoIncrement
        || isSequenceDefault(mc.default) || isSequenceDefault(dc.default);
      if (!opts.ignoreDefaults && !sequence && normDefault(mc.default) !== normDefault(dc.default)) {
        diffs.push({ what: 'default', model: mc.default || '', database: dc.default || '' });
      }
      if (diffs.length) drift.columnDiffs.push({ table: mt.name, column: mc.name, diffs });
    }
    for (const dc of dt.columns || []) {
      if (!seen.has(lower(dc.name))) {
        drift.extraColumns.push({ table: mt.name, column: dc.name, type: dc.type || '' });
      }
    }
    if (pkKey(mt) !== pkKey(dt)) {
      const names = (t) => (t.columns || []).filter((c) => c.primaryKey).map((c) => c.name);
      drift.primaryKeys.push({ table: mt.name, model: names(mt), database: names(dt) });
    }
    if (!opts.ignoreIndexes) {
      const dbIx = new Map(plainIndexes(dt).map((ix) => [indexKey(ix), ix]));
      const modelIx = new Set();
      for (const ix of plainIndexes(mt)) {
        modelIx.add(indexKey(ix));
        if (!dbIx.has(indexKey(ix))) drift.missingIndexes.push({ table: mt.name, index: ix });
      }
      for (const [key, ix] of dbIx) {
        if (!modelIx.has(key)) drift.extraIndexes.push({ table: mt.name, index: ix });
      }
    }
  }
  for (const dt of database.tables || []) {
    if (!matched.has(dt)) drift.extraTables.push({ table: dt.name });
  }
  if (!opts.ignoreRelations) {
    // A relation between tables one side lacks is already reported as a
    // missing or extra table.
    const inBoth = (r) => findTable(model, r.fromTable) && findTable(database, r.fromTable)
      && findTable(model, r.toTable) && findTable(database, r.toTable);
    const dbRel = new Map((database.relations || []).map((r) => [relationKey(r), r]));
    const modelRel = new Set();
    for (const r of model.relations || []) {
      modelRel.add(relationKey(r));
      if (!dbRel.has(relationKey(r)) && inBoth(r)) drift.missingRelations.push(r);
    }
    for (const [key, r] of dbRel) {
      if (!modelRel.has(key) && inBoth(r)) drift.extraRelations.push(r);
    }
  }
  return drift;
}

function driftCount(drift) {
  return Object.keys(drift).reduce((n, k) => n + drift[k].length, 0);
}

const code = (s) => '`' + String(s) + '`';
const ixText = (ix) => (ix.unique ? 'UNIQUE ' : '') + '(' + (ix.columns || []).join(', ') + ')'
  + (ix.name ? ' — ' + ix.name : '');
const relText = (r) => code(r.fromTable + '(' + (r.fromColumns || []).join(', ') + ')')
  + ' → ' + code(r.toTable + '(' + (r.toColumns || []).join(', ') + ')');
const WHAT = { type: 'type', nullable: 'NULL / NOT NULL', default: 'default' };

function table(lines, header, rows) {
  lines.push('| ' + header.join(' | ') + ' |');
  lines.push('|' + header.map(() => '---').join('|') + '|');
  const cell = (v) => String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  for (const row of rows) lines.push('| ' + row.map(cell).join(' | ') + ' |');
  lines.push('');
}

function driftReportMd(drift, meta) {
  const m = meta || {};
  const lines = [];
  lines.push('---');
  lines.push('type: schema-drift-report');
  lines.push('generator: ' + (m.generator || ''));
  lines.push('generated: ' + (m.generatedAt || ''));
  lines.push('model: ' + (m.modelPath || ''));
  lines.push('database: ' + (m.databasePath || ''));
  lines.push('---');
  lines.push('');
  lines.push('# Model vs database: ' + (m.title || ''));
  lines.push('');
  lines.push('- **Model** (what the project describes): ' + code(m.modelPath || ''));
  lines.push('- **Database** (exported from the live database): ' + code(m.databasePath || ''));
  lines.push('');
  const total = driftCount(drift);
  if (!total) {
    lines.push('✅ **No discrepancies.** The database matches the model in tables, columns, types,');
    lines.push('NULL / NOT NULL, defaults, primary keys, indexes and foreign keys.');
    lines.push('');
    return lines.join('\n') + '\n';
  }
  const summary = [
    ['🔴 Missing in the database', drift.missingTables.length + drift.missingColumns.length],
    ['🟡 Defined differently', drift.columnDiffs.length + drift.primaryKeys.length],
    ['🟠 Keys and indexes', drift.missingIndexes.length + drift.extraIndexes.length
      + drift.missingRelations.length + drift.extraRelations.length],
    ['ℹ️ Only in the database', drift.extraTables.length + drift.extraColumns.length],
  ];
  lines.push('**' + total + ' discrepanc' + (total === 1 ? 'y' : 'ies') + '.**');
  lines.push('');
  table(lines, ['Group', 'Count'], summary);

  lines.push('## 🔴 In the model, missing in the database');
  lines.push('');
  lines.push('Code written against the model will fail on these.');
  lines.push('');
  if (!drift.missingTables.length && !drift.missingColumns.length) {
    lines.push('_Nothing._');
    lines.push('');
  } else {
    table(lines, ['Table', 'Column', 'Type in the model'], drift.missingTables
      .map((d) => [code(d.table), '_whole table_', ''])
      .concat(drift.missingColumns.map((d) => [code(d.table), code(d.column), d.type ? code(d.type) : ''])));
  }

  lines.push('## 🟡 Defined differently');
  lines.push('');
  if (!drift.columnDiffs.length && !drift.primaryKeys.length) {
    lines.push('_Nothing._');
    lines.push('');
  } else {
    const rows = [];
    for (const d of drift.columnDiffs) {
      for (const x of d.diffs) {
        rows.push([code(d.table + '.' + d.column), WHAT[x.what],
          x.model ? code(x.model) : '_none_', x.database ? code(x.database) : '_none_']);
      }
    }
    for (const d of drift.primaryKeys) {
      rows.push([code(d.table), 'primary key',
        d.model.length ? code(d.model.join(', ')) : '_none_',
        d.database.length ? code(d.database.join(', ')) : '_none_']);
    }
    table(lines, ['Where', 'What', 'Model', 'Database'], rows);
  }

  lines.push('## 🟠 Indexes and foreign keys');
  lines.push('');
  const keyRows = []
    .concat(drift.missingIndexes.map((d) => ['missing in the database', 'index', code(d.table) + ' ' + ixText(d.index)]))
    .concat(drift.missingRelations.map((r) => ['missing in the database', 'foreign key', relText(r)]))
    .concat(drift.extraIndexes.map((d) => ['only in the database', 'index', code(d.table) + ' ' + ixText(d.index)]))
    .concat(drift.extraRelations.map((r) => ['only in the database', 'foreign key', relText(r)]));
  if (!keyRows.length) {
    lines.push('_Nothing._');
    lines.push('');
  } else {
    lines.push('Indexes are compared by their columns and uniqueness, not by name.');
    lines.push('');
    table(lines, ['Status', 'Kind', 'Definition'], keyRows);
  }

  lines.push('## ℹ️ In the database, missing in the model');
  lines.push('');
  lines.push('Usually changes made directly in the database, or parts the model leaves out on purpose.');
  lines.push('');
  if (!drift.extraTables.length && !drift.extraColumns.length) {
    lines.push('_Nothing._');
    lines.push('');
  } else {
    table(lines, ['Table', 'Column', 'Type in the database'], drift.extraTables
      .map((d) => [code(d.table), '_whole table_', ''])
      .concat(drift.extraColumns.map((d) => [code(d.table), code(d.column), d.type ? code(d.type) : ''])));
  }

  lines.push('## How it was compared');
  lines.push('');
  lines.push('- Names ignore letter case and the `public` / `dbo` schema prefix.');
  lines.push('- Type spellings are unified (`int4` = `integer`, `character varying` = `varchar`,');
  lines.push('  `int(11)` = `integer`, …); lengths and precisions still count.');
  lines.push('- Primary-key columns count as NOT NULL; defaults of auto-increment columns are skipped.');
  if (m.inferred) {
    lines.push('- One side is a CSV or JSON file: its types and NULL / NOT NULL are inferred from the data,');
    lines.push('  so differences there may come from the sample rather than the database.');
  }
  lines.push('- Nothing was changed. To bring the database in line, edit the model in the designer');
  lines.push('  and generate the change script.');
  lines.push('');
  return lines.join('\n') + '\n';
}

function dumpHelpMd() {
  return [
    '# Exporting the schema from a live database',
    '',
    'DB Playground does not connect to databases. Export the structure (no data) with your',
    "database's own tool, then run **DB Playground → Compare the model with a database** and",
    'pick the exported file.',
    '',
    '## PostgreSQL',
    '',
    '```sh',
    'pg_dump --schema-only --no-owner --no-privileges -h HOST -p 5432 -U USER -d DATABASE -f db-schema.sql',
    '```',
    '',
    'Add `-n SCHEMA` to export one schema only.',
    '',
    '## MySQL / MariaDB',
    '',
    '```sh',
    'mysqldump --no-data --skip-comments -h HOST -u USER -p DATABASE > db-schema.sql',
    '```',
    '',
    '## SQL Server',
    '',
    'In SQL Server Management Studio: right-click the database → **Tasks → Generate Scripts…**,',
    'choose the tables, and under **Advanced** set **Types of data to script** to **Schema only**.',
    'Save as `db-schema.sql`.',
    '',
    '## Oracle',
    '',
    'In SQL Developer: **Tools → Database Export**, untick **Export Data**, save as `db-schema.sql`.',
    'SQL import does not cover every Oracle construct; check the report for tables it skipped.',
    '',
    '## MongoDB',
    '',
    'Export a sample of one collection (the comparison infers fields from the documents):',
    '',
    '```sh',
    'mongoexport --uri "mongodb://HOST:27017/DATABASE" --collection NAME --limit 5000 --out NAME.json',
    '```',
    '',
    '## Tips',
    '',
    '- Keep the export outside the repository, or add it to `.gitignore`, if the structure is',
    '  confidential.',
    '- Export from each environment (dev, test, prod) to see where each one drifts.',
    '',
  ].join('\n');
}

module.exports = { schemaDrift, driftCount, driftReportMd, dumpHelpMd, normType, normDefault };
