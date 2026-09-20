'use strict';

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (sql, name) =>
  !!String(name || '').trim() && new RegExp('\\b' + escapeRe(String(name).trim()) + '\\b', 'i').test(String(sql || ''));

const lower = (s) => String(s || '').trim().toLowerCase();

const normSchemaRef = (v) => String(v || '').trim().replace(/\\/g, '/');

function dbSteps(flow) {
  const steps = [];
  ((flow && flow.steps) || []).forEach((step, index) => {
    if (step && (step.type === 'dbRead' || step.type === 'dbWrite')) steps.push({ step, index });
  });
  return steps;
}

function stepLabel(step, index) {
  const title = String((step && step.title) || '').trim();
  return (index + 1) + '. ' + (title || (step.type === 'dbWrite' ? 'zapis do bazy' : 'odczyt z bazy'));
}

function fieldMatches(step, column) {
  const fields = (step.output && step.output.fields) || [];
  return fields.some((f) => lower(f.path) === lower(column) || lower(f.path).endsWith('.' + lower(column)));
}

function computeSchemaImpact(changes, packages, schemaPath) {
  const impact = { red: [], yellow: [], info: [], unreferenced: [] };
  for (const change of changes || []) {
    if (change.kind === 'addTable') impact.info.push({ change });
    if (change.kind === 'addColumn') impact.info.push({ change });
  }
  for (const pkg of packages || []) {
    const flow = pkg.flow || {};
    const steps = dbSteps(flow);
    const ref = normSchemaRef(flow.dbSchema);
    if (!ref) {
      if (steps.length) impact.unreferenced.push({ pkg: pkg.dir, steps: steps.length });
      continue;
    }
    if (ref !== schemaPath) continue;
    for (const { step, index } of steps) {
      const label = stepLabel(step, index);
      for (const change of changes || []) {
        if (change.kind === 'dropTable' && mentions(step.sql, change.name)) {
          impact.red.push({ pkg: pkg.dir, step: label, change });
        } else if (change.kind === 'dropColumn'
          && (mentions(step.sql, change.column) || fieldMatches(step, change.column))) {
          impact.red.push({ pkg: pkg.dir, step: label, change });
        } else if (change.kind === 'renameTable' && mentions(step.sql, change.from)) {
          impact.yellow.push({ pkg: pkg.dir, step: label, change });
        } else if (change.kind === 'renameColumn'
          && (mentions(step.sql, change.from) || fieldMatches(step, change.from))) {
          impact.yellow.push({ pkg: pkg.dir, step: label, change });
        } else if (change.kind === 'modifyColumn'
          && (mentions(step.sql, change.column) || fieldMatches(step, change.column))) {
          impact.yellow.push({ pkg: pkg.dir, step: label, change });
        }
      }
    }
  }
  return impact;
}

function applyRenames(flow, renames) {
  const substitutions = [];
  const tableRenames = (renames && renames.tables) || [];
  const columnRenames = (renames && renames.columns) || [];
  const swaps = [];
  const toByFrom = new Map();
  for (const r of tableRenames.concat(columnRenames)) {
    const key = lower(r.from);
    if (!key || toByFrom.has(key)) continue;
    toByFrom.set(key, r.to);
    swaps.push({ from: r.from, to: r.to });
  }
  ((flow && flow.steps) || []).forEach((step, index) => {
    if (!step || (step.type !== 'dbRead' && step.type !== 'dbWrite')) return;
    if (swaps.length) {
      const re = new RegExp('\\b(?:' + swaps.map((s) => escapeRe(s.from)).join('|') + ')\\b', 'gi');
      const counts = new Map();
      const sql = String(step.sql || '');
      const replaced = sql.replace(re, (match) => {
        const key = lower(match);
        counts.set(key, (counts.get(key) || 0) + 1);
        return toByFrom.get(key);
      });
      if (replaced !== sql) {
        step.sql = replaced;
        for (const swap of swaps) {
          const count = counts.get(lower(swap.from)) || 0;
          if (count) substitutions.push({ stepIndex: index, where: 'sql', from: swap.from, to: swap.to, count });
        }
      }
    }
    const fields = (step.output && step.output.fields) || [];
    const renamedFields = new Set();
    for (const r of columnRenames) {
      const from = lower(r.from);
      for (const field of fields) {
        if (renamedFields.has(field)) continue;
        const path = lower(field.path);
        let renamedTo = null;
        if (path === from) {
          renamedTo = r.to;
        } else if (path.endsWith('.' + from)) {
          renamedTo = String(field.path).slice(0, String(field.path).length - r.from.length) + r.to;
        }
        if (renamedTo !== null) {
          renamedFields.add(field);
          substitutions.push({ stepIndex: index, where: 'field', from: field.path, to: renamedTo, count: 1 });
          field.path = renamedTo;
        }
      }
    }
  });
  return { flow, substitutions };
}

function changeText(change) {
  if (change.kind === 'dropTable') return 'dropped table `' + change.name + '`';
  if (change.kind === 'addTable') return 'added table `' + change.name + '`';
  if (change.kind === 'renameTable') return 'renamed table `' + change.from + '` → `' + change.to + '`';
  if (change.kind === 'dropColumn') return 'dropped column `' + change.table + '.' + change.column + '`';
  if (change.kind === 'addColumn') return 'added column `' + change.table + '.' + change.column + '`';
  if (change.kind === 'renameColumn') {
    return 'renamed column `' + change.table + '.' + change.from + '` → `' + change.to + '`';
  }
  if (change.kind === 'modifyColumn') {
    const parts = [];
    if (change.changed && change.changed.type) parts.push('type `' + change.fromType + '` → `' + change.toType + '`');
    if (change.changed && change.changed.nullable) parts.push('nullability (NULL/NOT NULL)');
    return 'changed column `' + change.table + '.' + change.column + '`: ' + parts.join(', ');
  }
  return change.kind;
}

function section(lines, title, entries) {
  lines.push('## ' + title);
  lines.push('');
  if (!entries.length) {
    lines.push('_Nothing._');
  } else {
    for (const line of entries) lines.push('- ' + line);
  }
  lines.push('');
}

function impactReportMd(changes, impact, meta) {
  const lines = [];
  lines.push('---');
  lines.push('type: schema-impact-report');
  lines.push('generator: ' + (meta.generator || ''));
  lines.push('generated: ' + (meta.generatedAt || ''));
  lines.push('schema: ' + (meta.schemaPath || ''));
  lines.push('---');
  lines.push('');
  lines.push('# Schema change impact: ' + (meta.schemaPath || ''));
  lines.push('');
  lines.push('The report changes nothing — writes happen only once you approve them (DECISIONS §28).');
  lines.push('');
  lines.push('## Schema changes');
  lines.push('');
  if (!(changes || []).length) lines.push('_No changes._');
  for (const change of changes || []) lines.push('- ' + changeText(change));
  lines.push('');
  section(lines, '🔴 Will break', impact.red.map((e) =>
    '`' + e.pkg + '`, step ' + e.step + ' — ' + changeText(e.change)));
  section(lines, '🟡 To review', impact.yellow.map((e) =>
    '`' + e.pkg + '`, step ' + e.step + ' — ' + changeText(e.change)));
  section(lines, 'ℹ️ New and the rest', impact.info.map((e) => changeText(e.change)));
  if (impact.unreferenced.length) {
    lines.push('## Packages with no schema reference');
    lines.push('');
    lines.push('These packages have database steps but point at no schema, so there is no way to');
    lines.push('tell whether this change touches them. Point them at one with the "Logic Spec:');
    lines.push('Set the database schema for the package" command (the `dbSchema` field in api.json).');
    lines.push('');
    for (const entry of impact.unreferenced) {
      lines.push('- `' + entry.pkg + '` (' + entry.steps + ' database step(s))');
    }
    lines.push('');
  }
  lines.push('## What next');
  lines.push('');
  if (impact.red.length || impact.yellow.length) {
    lines.push('- 🔴 steps will stop matching the schema — update the SQL and the output models');
    lines.push('  in Logic Spec (renames can be substituted automatically once approved).');
    lines.push('- 🟡 steps need a read-through: a name or a type changes, the meaning may hold.');
  } else {
    lines.push('- No step pointing at this schema touches the changed tables or columns.');
  }
  return lines.join('\n') + '\n';
}

function substitutionReportMd(entries, meta) {
  const lines = [];
  lines.push('# Reference substitution after renames: ' + (meta.schemaPath || ''));
  lines.push('');
  if (!entries.length) {
    lines.push('_No reference needed substituting._');
    return lines.join('\n') + '\n';
  }
  for (const pkg of entries) {
    lines.push('## `' + pkg.dir + '`');
    lines.push('');
    for (const s of pkg.substitutions) {
      lines.push('- step ' + (s.stepIndex + 1) + ', ' + (s.where === 'sql' ? 'SQL' : 'model field')
        + ': `' + s.from + '` → `' + s.to + '`' + (s.count > 1 ? ' (' + s.count + '×)' : ''));
    }
    lines.push('');
  }
  return lines.join('\n') + '\n';
}

module.exports = { computeSchemaImpact, applyRenames, impactReportMd, substitutionReportMd, changeText, normSchemaRef };
