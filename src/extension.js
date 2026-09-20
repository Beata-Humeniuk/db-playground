'use strict';

const vscode = require('vscode');
const path = require('path');
const { keepConfluenceBinding } = require('./confluenceBinding');
const { writeUnlessUnchanged } = require('./writeIfChanged');
const { forLanguage } = require('./nls');
const { resolveFolders, schemaRef } = require('./folders');

const nls = forLanguage(vscode.env && vscode.env.language);

const SUPPORTED = /\.(sql|csv|tsv|json|ndjson|jsonl)$/i;
const MAX_JSON_BYTES = 512 * 1024 * 1024;

let extensionVersion = '';

function activate(context) {
  extensionVersion = context.extension.packageJSON.version;
  context.subscriptions.push(
    vscode.commands.registerCommand('dbPlayground.describe', describeCommand),
    vscode.commands.registerCommand('dbPlayground.design', designCommand),
    vscode.commands.registerCommand('dbPlayground.compareSchema', compareSchemaCommand)
  );
}

function deactivate() {}

async function describeCommand(uri) {
  try {
    const fileUri = uri instanceof vscode.Uri ? uri : await pickSource();
    if (!fileUri) return;
    const fsPath = fileUri.fsPath;
    const format = formatOf(fsPath);
    if (!format) {
      vscode.window.showErrorMessage(nls.t('error.unsupportedFileType'));
      return;
    }
    const model = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: nls.t('progress.readingFile', { file: path.basename(fsPath) }) },
      () => buildModel(fsPath, format)
    );
    const { modelToMarkdown } = require('./mdExport');
    const markdown = modelToMarkdown(model, {
      source: vscode.workspace.asRelativePath(fileUri, false) !== fileUri.fsPath
        ? vscode.workspace.asRelativePath(fileUri, false)
        : path.basename(fsPath),
      generator: 'db-playground@' + extensionVersion
    });
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: markdown });
    await vscode.window.showTextDocument(doc, { preview: false });
    await offerSave(fileUri, markdown, model);
  } catch (err) {
    vscode.window.showErrorMessage(nls.t('error.describeFailed', { error: err && err.message ? err.message : String(err) }));
  }
}

async function designCommand(uri) {
  try {
    const fileUri = uri instanceof vscode.Uri ? uri : await pickSource();
    if (!fileUri) return;
    const session = await loadDesignSession(fileUri);
    require('./designerGui').openDesigner(session);
  } catch (err) {
    vscode.window.showErrorMessage(nls.t('error.designerFailed', { error: err && err.message ? err.message : String(err) }));
  }
}

const STATE_SUFFIX = '.db-playground.json';
const STATE_FILE = /\.db-playground\.json$/i;

async function existingState(uri) {
  try {
    await vscode.workspace.fs.stat(uri);
    return uri;
  } catch (err) {
    return null;
  }
}

async function loadDesignSession(fileUri) {
  const fsPath = fileUri.fsPath;
  if (STATE_FILE.test(fsPath)) {
    return { state: await readState(fileUri), stateUri: fileUri };
  }
  const base = fsPath.replace(SUPPORTED, '');
  const stateUri = vscode.Uri.file(base + STATE_SUFFIX);
  const found = await existingState(stateUri);
  if (found) {
    vscode.window.showInformationMessage(nls.t('info.stateLoaded', { file: path.basename(found.fsPath) }));
    return { state: await readState(found), stateUri: found };
  }
  const format = formatOf(fsPath);
  if (!format) {
    throw new Error(nls.t('error.unsupportedFileTypeInline'));
  }
  const model = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: nls.t('progress.readingFile', { file: path.basename(fsPath) }) },
    () => buildModel(fsPath, format)
  );
  const { toEditable } = require('./schemaEdit');
  const { dialect, schema } = toEditable(model);
  const state = {
    version: 1,
    source: path.basename(fsPath),
    dialect,
    baseline: JSON.parse(JSON.stringify(schema)),
    schema,
    queries: [],
  };
  return { state, stateUri };
}

async function readState(uri) {
  const raw = await vscode.workspace.fs.readFile(uri);
  let state;
  try {
    state = JSON.parse(Buffer.from(raw).toString('utf8'));
  } catch (err) {
    throw new Error(nls.t('error.stateCorrupted', { error: err.message }));
  }
  if (!state || !state.schema || !Array.isArray(state.schema.tables)) {
    throw new Error(nls.t('error.stateNoSchema'));
  }
  if (!state.baseline) state.baseline = JSON.parse(JSON.stringify(state.schema));
  if (!Array.isArray(state.schema.relations)) state.schema.relations = [];
  if (!Array.isArray(state.queries)) state.queries = [];
  if (!state.dialect) state.dialect = 'postgres';
  return state;
}

async function pickSource() {
  const active = vscode.window.activeTextEditor;
  if (active && SUPPORTED.test(active.document.fileName) && active.document.uri.scheme === 'file') {
    return active.document.uri;
  }
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: nls.t('dialog.describeLabel'),
    filters: { [nls.t('dialog.dataSources')]: ['sql', 'csv', 'tsv', 'json', 'ndjson', 'jsonl'] },
  });
  return picked && picked[0];
}

function formatOf(fsPath) {
  const ext = path.extname(fsPath).toLowerCase();
  if (ext === '.sql') return 'sql';
  if (ext === '.csv' || ext === '.tsv') return 'csv';
  if (ext === '.json' || ext === '.ndjson' || ext === '.jsonl') return 'json';
  return null;
}

function streamInto(fsPath, sink) {
  const fs = require('fs');
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(fsPath, { encoding: 'utf8' });
    stream.on('data', (chunk) => {
      try {
        sink.push(chunk);
      } catch (err) {
        stream.destroy();
        reject(err);
      }
    });
    stream.on('error', reject);
    stream.on('end', resolve);
  });
}

async function buildModel(fsPath, format) {
  const name = path.basename(fsPath).replace(SUPPORTED, '');
  if (format === 'sql') {
    const { SqlScanner } = require('./sqlSchema');
    const scanner = new SqlScanner();
    await streamInto(fsPath, scanner);
    const model = scanner.end();
    if (!model.tables.length) {
      throw new Error(nls.t('error.noCreateTable'));
    }
    return model;
  }
  if (format === 'csv') {
    const { CsvDesigner } = require('./csvSchema');
    const delimiter = /\.tsv$/i.test(fsPath) ? '\t' : null;
    const designer = new CsvDesigner({ delimiter });
    await streamInto(fsPath, designer);
    designer.end();
    const model = designer.model({ name });
    if (!model.tables[0].columns.length) {
      throw new Error(nls.t('error.noColumns'));
    }
    return model;
  }
  const { readJsonText, NdjsonScanner } = require('./jsonSchema');
  const language = vscode.env && vscode.env.language;
  if (/\.(ndjson|jsonl)$/i.test(fsPath)) {
    const scanner = new NdjsonScanner();
    await streamInto(fsPath, scanner);
    const model = scanner.end({ name });
    if (model) return model;
  }
  const fs = require('fs');
  const stat = await fs.promises.stat(fsPath);
  if (stat.size > MAX_JSON_BYTES) {
    throw new Error(nls.t('error.jsonTooBig'));
  }
  const text = await fs.promises.readFile(fsPath, 'utf8');
  return readJsonText(text, { name, language });
}

function resultLabel(model) {
  if (model.sourceFormat === 'sql') {
    const n = model.tables.length;
    return n + ' ' + nls.plural('plural.table', n);
  }
  const table = model.tables[0];
  const n = table.columns.length;
  return n + ' ' + nls.plural(table.kind === 'collection' ? 'plural.field' : 'plural.column', n);
}

// The folder settings, read for one workspace folder (folder-level values
// win over workspace and user ones, as VS Code resolves them).
function folderSettings(folder) {
  const config = vscode.workspace.getConfiguration('dbPlayground', folder ? folder.uri : undefined);
  return { modelFolder: config.get('modelFolder', ''), migrationFolder: config.get('migrationFolder', '') };
}

function workspaceFolders(folder) {
  return resolveFolders(path.basename(folder.uri.fsPath), folderSettings(folder));
}

function savePlan(projectName, settings) {
  const folders = resolveFolders(projectName, settings);
  return { markdownDir: folders.modelDir, schemaDir: folders.modelDir };
}

async function offerSave(sourceUri, markdown, model) {
  const folder = vscode.workspace.getWorkspaceFolder(sourceUri);
  const plan = folder
    ? savePlan(path.basename(folder.uri.fsPath), folderSettings(folder))
    : null;
  const base = path.basename(sourceUri.fsPath).replace(SUPPORTED, '');
  const fileName = base + '-schema.md';
  const targetDir = folder
    ? vscode.Uri.joinPath(folder.uri, plan.markdownDir)
    : vscode.Uri.file(path.dirname(sourceUri.fsPath));
  const target = vscode.Uri.joinPath(targetDir, fileName);
  const shownPath = folder ? plan.markdownDir + '/' + fileName : fileName;

  const saveAction = nls.t('action.save');
  const pick = await vscode.window.showInformationMessage(
    nls.t('info.describeReady', { summary: resultLabel(model), path: shownPath }),
    saveAction
  );
  if (pick !== saveAction) return;

  let exists = true;
  try {
    await vscode.workspace.fs.stat(target);
  } catch (err) {
    exists = false;
  }
  if (exists) {
    const overwriteAction = nls.t('action.overwrite');
    const confirm = await vscode.window.showWarningMessage(
      nls.t('warn.fileExists', { path: shownPath }), overwriteAction);
    if (confirm !== overwriteAction) return;
  }
  await vscode.workspace.fs.createDirectory(targetDir);
  await writeUnlessUnchanged(vscode, target, await keepConfluenceBinding(vscode, target, markdown));
  const { toEditable } = require('./schemaEdit');
  const { editableToJson } = require('./schemaJson');
  const editable = toEditable(model);
  const schemaDir = folder ? vscode.Uri.joinPath(folder.uri, plan.schemaDir) : targetDir;
  await vscode.workspace.fs.createDirectory(schemaDir);
  const schemaTarget = vscode.Uri.joinPath(schemaDir, base + '.schema.json');
  await writeUnlessUnchanged(vscode, schemaTarget, JSON.stringify(editableToJson(editable.schema, {
    source: vscode.workspace.asRelativePath(sourceUri, false) !== sourceUri.fsPath
      ? vscode.workspace.asRelativePath(sourceUri, false)
      : path.basename(sourceUri.fsPath),
    dialect: editable.dialect
  }), null, 2) + '\n');
  const opened = await vscode.workspace.openTextDocument(target);
  await vscode.window.showTextDocument(opened, { preview: false });
  vscode.window.showInformationMessage(nls.t('info.saved', { path: shownPath }));
}

async function compareSchemaCommand(uri) {
  try {
    const fileUri = uri instanceof vscode.Uri ? uri : await pickSource();
    if (!fileUri) return;
    const format = formatOf(fileUri.fsPath);
    if (!format) {
      vscode.window.showErrorMessage(nls.t('error.unsupportedFileType'));
      return;
    }
    const { parseSchemaJson, editableToJson, renameCandidates, diffJsonSchemas } = require('./schemaJson');
    const { reportAndSubstitute } = require('./schemaBridge');
    const folder = vscode.workspace.getWorkspaceFolder(fileUri);
    const base = path.basename(fileUri.fsPath).replace(SUPPORTED, '');
    const schemaFile = base + '.schema.json';
    const folders = folder ? workspaceFolders(folder) : null;
    const schemaRelPath = folders ? schemaRef(folders, schemaFile) : schemaFile;
    const shownSchemaPath = folders ? folders.modelDir + '/' + schemaFile : schemaFile;
    const schemaUri = folder
      ? vscode.Uri.joinPath(folder.uri, folders.modelDir, schemaFile)
      : null;
    let oldText = null;
    if (schemaUri) {
      try {
        oldText = Buffer.from(await vscode.workspace.fs.readFile(schemaUri)).toString('utf8');
      } catch (e) { }
    }
    const oldJson = oldText === null ? null : parseSchemaJson(oldText);
    if (!oldJson) {
      vscode.window.showWarningMessage(nls.t('error.noTreeSchema', { path: shownSchemaPath }));
      return;
    }
    const model = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: nls.t('progress.readingFile', { file: path.basename(fileUri.fsPath) }) },
      () => buildModel(fileUri.fsPath, format)
    );
    const { toEditable } = require('./schemaEdit');
    const editable = toEditable(model);
    const newJson = editableToJson(editable.schema, {
      source: path.basename(fileUri.fsPath), dialect: editable.dialect
    });

    const renames = await askIdentities(oldJson, newJson, renameCandidates);
    if (renames === null) return;
    const changes = diffJsonSchemas(oldJson, newJson, renames);
    if (!changes.length) {
      vscode.window.showInformationMessage(nls.t('info.schemaUpToDate'));
      return;
    }
    await reportAndSubstitute({
      changes, folder, schemaRelPath,
      generator: 'db-playground@' + extensionVersion
    });
    const saveAction = nls.t('action.save');
    const pick = await vscode.window.showWarningMessage(
      nls.t('compare.saveAsk', { path: shownSchemaPath }), { modal: true }, saveAction);
    if (pick === saveAction) {
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(schemaUri, '..'));
      await writeUnlessUnchanged(vscode, schemaUri, JSON.stringify(newJson, null, 2) + '\n');
      vscode.window.showInformationMessage(nls.t('info.saved', { path: shownSchemaPath }));
    }
  } catch (err) {
    vscode.window.showErrorMessage(nls.t('error.compareFailed', { error: err && err.message ? err.message : String(err) }));
  }
}

async function askIdentities(oldJson, newJson, renameCandidates) {
  const renames = { tables: [], columns: [] };
  const byFrom = (list, key) => {
    const groups = new Map();
    for (const c of list) {
      const k = key(c);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    }
    return groups;
  };
  const ask = async (placeHolder, options) => {
    const items = options.map((c) => ({
      label: nls.t('compare.sameAs', { to: c.to, score: Math.round(c.score * 100) }),
      to: c.to
    }));
    items.push({ label: nls.t('compare.different'), to: null });
    return vscode.window.showQuickPick(items, { placeHolder, ignoreFocusOut: true });
  };
  for (const [from, options] of byFrom(renameCandidates(oldJson, newJson).tables, (c) => c.from)) {
    const picked = await ask(nls.t('compare.goneTable', { from }), options);
    if (picked === undefined) return null;
    if (picked.to) renames.tables.push({ from, to: picked.to });
  }
  const candidates = renameCandidates(oldJson, newJson, { tables: renames.tables });
  for (const [key, options] of byFrom(candidates.columns, (c) => c.table + '|' + c.from)) {
    const [table, from] = key.split('|');
    const picked = await ask(nls.t('compare.goneColumn', { table, from }), options);
    if (picked === undefined) return null;
    if (picked.to) renames.columns.push({ table, from, to: picked.to });
  }
  return renames;
}

module.exports = { activate, deactivate, savePlan, workspaceFolders, extensionVersion: () => extensionVersion };
