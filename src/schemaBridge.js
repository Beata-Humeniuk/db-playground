'use strict';

const vscode = require('vscode');
const path = require('path');
const { computeSchemaImpact, applyRenames, impactReportMd, substitutionReportMd, normSchemaRef } = require('./schemaImpact');
const { forLanguage } = require('./nls');

const nls = forLanguage(vscode.env && vscode.env.language);

const specDirName = (folderUri) => path.basename(folderUri.fsPath) + '-spec';

async function readApiPackages(folder) {
  if (!folder) return [];
  const found = await vscode.workspace.findFiles(
    specDirName(folder.uri) + '/api/**/api.json', '**/node_modules/**', 400);
  const out = [];
  for (const fileUri of found) {
    try {
      const raw = Buffer.from(await vscode.workspace.fs.readFile(fileUri)).toString('utf8');
      out.push({
        dir: path.relative(folder.uri.fsPath, path.dirname(fileUri.fsPath)).split(path.sep).join('/'),
        flow: JSON.parse(raw),
        uri: fileUri
      });
    } catch (e) { }
  }
  return out.sort((a, b) => a.dir.localeCompare(b.dir));
}

async function openMarkdownReport(content) {
  const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content });
  await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
}

async function reportAndSubstitute(options) {
  const { changes, folder, schemaRelPath, generator } = options;
  const packages = await readApiPackages(folder);
  const impact = computeSchemaImpact(changes, packages, schemaRelPath);
  const empty = !impact.red.length && !impact.yellow.length && !impact.info.length && !impact.unreferenced.length;
  if (!changes.length && empty) return impact;
  await openMarkdownReport(impactReportMd(changes, impact, {
    schemaPath: schemaRelPath,
    generator,
    generatedAt: new Date().toISOString().slice(0, 10)
  }));

  const renames = {
    tables: changes.filter((c) => c.kind === 'renameTable').map((c) => ({ from: c.from, to: c.to })),
    columns: changes.filter((c) => c.kind === 'renameColumn')
      .map((c) => ({ table: c.table, from: c.from, to: c.to }))
  };
  const renameCount = renames.tables.length + renames.columns.length;
  if (!renameCount) return impact;

  const substituteAction = nls.t('action.substitute');
  const pick = await vscode.window.showWarningMessage(
    nls.t('impact.substituteAsk', {
      count: renameCount,
      references: nls.plural('plural.reference', renameCount)
    }), { modal: true }, substituteAction);
  if (pick !== substituteAction) return impact;

  const touched = [];
  for (const pkg of packages) {
    if (normSchemaRef(pkg.flow && pkg.flow.dbSchema) !== schemaRelPath) continue;
    const { substitutions } = applyRenames(pkg.flow, renames);
    if (!substitutions.length) continue;
    await vscode.workspace.fs.writeFile(pkg.uri,
      Buffer.from(JSON.stringify(pkg.flow, null, 2) + '\n', 'utf8'));
    touched.push({ dir: pkg.dir, substitutions });
  }
  await openMarkdownReport(substitutionReportMd(touched, { schemaPath: schemaRelPath }));
  if (touched.length) {
    vscode.window.showInformationMessage(
      nls.t('info.substituted', { packages: touched.map((t) => t.dir).join(', ') }));
  }
  return impact;
}

module.exports = { readApiPackages, reportAndSubstitute, specDirName };
