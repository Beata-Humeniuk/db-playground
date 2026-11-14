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
    vscode.commands.registerCommand('dbPlayground.compareSchema', compareSchemaCommand),
    vscode.commands.registerCommand('dbPlayground.compareWithDatabase', compareWithDatabaseCommand)
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
    await saveDescription(fileUri, markdown, model);
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

// The description and the schema JSON are written at once, side by side in
// the model folder: a description saved by hand from an unsaved tab (Ctrl+S)
// or a missed "Save" notification left the Markdown without its
// .schema.json, which Logic Spec reads. Only overwriting an existing
// description asks first; declined, the description opens unsaved.
async function saveDescription(sourceUri, markdown, model) {
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

  // The JSON first: Logic Spec reads it, and it is data, rewritten as the
  // designer's save rewrites it; only the description may hold edits.
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
  const schemaShown = folder ? plan.schemaDir + '/' + base + '.schema.json' : base + '.schema.json';
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
    if (confirm !== overwriteAction) {
      const draft = await vscode.workspace.openTextDocument({ language: 'markdown', content: markdown });
      await vscode.window.showTextDocument(draft, { preview: false });
      vscode.window.showInformationMessage(nls.t('info.saved', { path: schemaShown }));
      return;
    }
  }
  await vscode.workspace.fs.createDirectory(targetDir);
  await writeUnlessUnchanged(vscode, target, await keepConfluenceBinding(vscode, target, markdown));
  const opened = await vscode.workspace.openTextDocument(target);
  await vscode.window.showTextDocument(opened, { preview: false });
  vscode.window.showInformationMessage(nls.t('info.described', { summary: resultLabel(model), path: shownPath, schema: schemaShown }));
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

// The model is what the project says the database looks like: the designer's
// latest edits, the stored .schema.json, or the source file itself. The other
// side is a schema-only export from the live database; the extension never
// connects to one.
async function modelCandidates(fileUri) {
  const { parseSchemaJson, editableToJson } = require('./schemaJson');
  const out = [];
  const fsPath = fileUri.fsPath;
  const base = path.basename(fsPath).replace(STATE_FILE, '').replace(SUPPORTED, '');
  const stateUri = STATE_FILE.test(fsPath) ? fileUri : vscode.Uri.file(fsPath.replace(SUPPORTED, '') + STATE_SUFFIX);
  if (await existingState(stateUri)) {
    out.push({
      label: nls.t('drift.modelDesigner'), description: path.basename(stateUri.fsPath), shown: path.basename(stateUri.fsPath),
      load: async () => {
        const state = await readState(stateUri);
        return editableToJson(state.schema, { source: state.source, dialect: state.dialect });
      }
    });
  }
  const folder = vscode.workspace.getWorkspaceFolder(fileUri);
  if (folder) {
    const folders = workspaceFolders(folder);
    const schemaUri = vscode.Uri.joinPath(folder.uri, folders.modelDir, base + '.schema.json');
    let text = null;
    try {
      text = Buffer.from(await vscode.workspace.fs.readFile(schemaUri)).toString('utf8');
    } catch (e) { }
    const json = text === null ? null : parseSchemaJson(text);
    if (json) {
      const shown = folders.modelDir + '/' + base + '.schema.json';
      out.push({ label: nls.t('drift.modelStored'), description: shown, shown, load: async () => json });
    }
  }
  const format = formatOf(fsPath);
  if (format && !STATE_FILE.test(fsPath)) {
    out.push({
      label: nls.t('drift.modelSource'), description: path.basename(fsPath), shown: path.basename(fsPath),
      inferred: format !== 'sql',
      load: async () => fileToSchemaJson(fileUri, format)
    });
  }
  return out;
}

async function fileToSchemaJson(fileUri, format) {
  const { editableToJson } = require('./schemaJson');
  const { toEditable } = require('./schemaEdit');
  const model = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: nls.t('progress.readingFile', { file: path.basename(fileUri.fsPath) }) },
    () => buildModel(fileUri.fsPath, format)
  );
  const editable = toEditable(model);
  return editableToJson(editable.schema, { source: path.basename(fileUri.fsPath), dialect: editable.dialect });
}

async function openMarkdown(content) {
  const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content });
  await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
}

async function compareWithDatabaseCommand(uri) {
  try {
    const { schemaDrift, driftCount, driftReportMd, dumpHelpMd } = require('./schemaDrift');
    const fileUri = uri instanceof vscode.Uri ? uri : await pickSource();
    if (!fileUri) return;
    const candidates = await modelCandidates(fileUri);
    if (!candidates.length) {
      vscode.window.showErrorMessage(nls.t('error.unsupportedFileType'));
      return;
    }
    const modelPick = candidates.length === 1 ? candidates[0] : await vscode.window.showQuickPick(candidates, {
      placeHolder: nls.t('drift.pickModel'), ignoreFocusOut: true
    });
    if (!modelPick) return;

    const chooseItem = { label: nls.t('drift.chooseDump'), detail: nls.t('drift.chooseDumpDetail'), choose: true };
    const helpItem = { label: nls.t('drift.howToDump'), detail: nls.t('drift.howToDumpDetail') };
    const how = await vscode.window.showQuickPick([chooseItem, helpItem], {
      placeHolder: nls.t('drift.pickDatabase'), ignoreFocusOut: true
    });
    if (!how) return;
    if (!how.choose) {
      await openMarkdown(dumpHelpMd());
      return;
    }
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: nls.t('drift.openLabel'),
      defaultUri: vscode.Uri.file(path.dirname(fileUri.fsPath)),
      filters: { [nls.t('dialog.dataSources')]: ['sql', 'csv', 'tsv', 'json', 'ndjson', 'jsonl'] },
    });
    const dumpUri = picked && picked[0];
    if (!dumpUri) return;
    const dumpFormat = formatOf(dumpUri.fsPath);
    if (!dumpFormat) {
      vscode.window.showErrorMessage(nls.t('error.unsupportedFileType'));
      return;
    }

    const modelJson = await modelPick.load();
    const databaseJson = await fileToSchemaJson(dumpUri, dumpFormat);
    const drift = schemaDrift(modelJson, databaseJson);
    const shownDump = vscode.workspace.asRelativePath(dumpUri, false);
    await openMarkdown(driftReportMd(drift, {
      title: path.basename(fileUri.fsPath).replace(STATE_FILE, '').replace(SUPPORTED, ''),
      modelPath: modelPick.shown,
      databasePath: shownDump,
      inferred: Boolean(modelPick.inferred) || dumpFormat !== 'sql',
      generator: 'db-playground@' + extensionVersion,
      generatedAt: new Date().toISOString().slice(0, 10)
    }));
    const n = driftCount(drift);
    if (n) {
      vscode.window.showWarningMessage(nls.t('drift.found', { count: n, discrepancies: nls.plural('plural.discrepancy', n) }));
    } else {
      vscode.window.showInformationMessage(nls.t('drift.none'));
    }
  } catch (err) {
    vscode.window.showErrorMessage(nls.t('error.driftFailed', { error: err && err.message ? err.message : String(err) }));
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
