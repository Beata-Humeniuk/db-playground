'use strict';

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DIALECTS, DIALECT_ORDER } = require('./dialects');
const { diffSchemas } = require('./schemaEdit');
const { changesToScript, fullCreateScript } = require('./alterGen');
const { buildSelect, OPERATORS } = require('./selectGen');
const { SHAPE_SOURCE } = require('./docShape');
const { forLanguage } = require('./nls');

const nls = forLanguage(vscode.env && vscode.env.language);

const { schemaRef } = require('./folders');
const workspaceFolders = (folder) => require('./extension').workspaceFolders(folder);

const LOGIC_SPEC_EXT = 'beatahumeniuk.logic-spec';
const INSERT_SQL_COMMAND = 'logicSpec.insertStepSql';
const logicSpecAvailable = () =>
  !!(vscode.extensions && vscode.extensions.getExtension && vscode.extensions.getExtension(LOGIC_SPEC_EXT));

function sessionBase(session) {
  return path.basename(session.stateUri.fsPath).replace(/\.db-playground\.json$/i, '');
}

async function writeSchemaJson(session) {
  const folder = vscode.workspace.getWorkspaceFolder(session.stateUri) ||
    (vscode.workspace.workspaceFolders || [])[0];
  if (!folder) return null;
  const { editableToJson } = require('./schemaJson');
  const { writeUnlessUnchanged } = require('./writeIfChanged');
  const folders = workspaceFolders(folder);
  const schemaFile = sessionBase(session) + '.schema.json';
  const relPath = schemaRef(folders, schemaFile);
  const target = vscode.Uri.joinPath(folder.uri, folders.modelDir, schemaFile);
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '..'));
  await writeUnlessUnchanged(vscode, target, JSON.stringify(editableToJson(session.state.schema, {
    source: session.state.source, dialect: session.state.dialect
  }), null, 2) + '\n');
  return { folder, relPath };
}

function scriptTargetUri(session, full, mongo) {
  const folder = vscode.workspace.getWorkspaceFolder(session.stateUri) ||
    (vscode.workspace.workspaceFolders || [])[0];
  if (!folder) return null;
  const base = path.basename(session.stateUri.fsPath).replace(/\.db-playground\.json$/i, '');
  const name = base + (full ? '-model' : '-migration') + (mongo ? '.js' : '.sql');
  const folders = workspaceFolders(folder);
  return vscode.Uri.joinPath(folder.uri, full ? folders.modelDir : folders.migrationDir, name);
}

function openDesigner(session) {
  const panel = vscode.window.createWebviewPanel(
    'dbSchemaDesigner',
    nls.t('designer.title', { source: session.state.source }),
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] }
  );
  panel.iconPath = vscode.Uri.file(path.join(__dirname, '..', 'icon.png'));
  panel.webview.html = buildDesignerHtml();
  wirePanel(panel, session);
  return panel;
}

function computePreviews(state, ui) {
  let script = '';
  try {
    if (ui && ui.scriptMode === 'full') {
      script = fullCreateScript(state.schema, state.dialect);
    } else {
      const changes = diffSchemas(state.baseline, state.schema);
      script = changesToScript(changes, state.dialect);
      if (script && changes.length) {
        const comment = DIALECTS[state.dialect].kind === 'mongo' ? '// ' : '-- ';
        script += '\n' + comment + changes.length + ' ' +
          nls.plural('plural.change', changes.length) + ' · ' + nls.t('script.notApplied');
      }
    }
  } catch (err) {
    script = nls.t('script.error', { error: err.message });
  }
  if (!script) {
    script = ui && ui.scriptMode === 'full'
      ? nls.t('script.noNamedTables')
      : nls.t('script.noChanges');
  }
  let sql = '';
  const query = (state.queries || []).find((q) => q.id === (ui && ui.queryId));
  if (query) {
    try {
      sql = buildSelect(query, state.dialect) || nls.t('query.pickTable');
    } catch (err) {
      sql = nls.t('query.error', { error: err.message });
    }
  }
  return { script, sql };
}

function baselineIdList(baseline) {
  const ids = [];
  for (const t of baseline.tables || []) {
    ids.push(t.id);
    for (const c of t.columns || []) ids.push(c.id);
    for (const ix of t.indexes || []) ids.push(ix.id);
  }
  return ids;
}

function wirePanel(panel, session) {
  let saveTimer = null;
  let pendingSave = false;
  let disposed = false;
  const writeState = async () => {
    pendingSave = false;
    try {
      const body = JSON.stringify(session.state, null, 2);
      await vscode.workspace.fs.writeFile(session.stateUri, Buffer.from(body, 'utf8'));
      if (!disposed) panel.webview.postMessage({ type: 'saved', file: path.basename(session.stateUri.fsPath) });
    } catch (err) {
      if (!disposed) panel.webview.postMessage({ type: 'saved', error: String(err && err.message || err) });
    }
  };
  const persist = () => {
    pendingSave = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeState, 500);
  };

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'ready') {
      const { baseline, ...visible } = session.state;
      panel.webview.postMessage({ type: 'load', state: visible, baselineIds: baselineIdList(session.state.baseline) });
      panel.webview.postMessage({ type: 'previews', ...computePreviews(session.state, msg.ui) });
      panel.webview.postMessage({ type: 'logicSpec', available: logicSpecAvailable() });
      return;
    }
    if (msg.type === 'state') {
      session.state.dialect = msg.dialect;
      session.state.schema = msg.schema;
      session.state.queries = msg.queries;
      persist();
      panel.webview.postMessage({ type: 'previews', ...computePreviews(session.state, msg.ui) });
      return;
    }
    if (msg.type === 'open') {
      const previews = computePreviews(session.state, msg.ui);
      const mongo = DIALECTS[session.state.dialect].kind === 'mongo';
      const language = mongo ? 'javascript' : 'sql';
      if (msg.which === 'sql') {
        const doc = await vscode.workspace.openTextDocument({ language, content: previews.sql });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
        return;
      }
      const full = !!(msg.ui && msg.ui.scriptMode === 'full');
      const target = scriptTargetUri(session, full, mongo);
      if (!target) {
        const doc = await vscode.workspace.openTextDocument({ language, content: previews.script });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
        return;
      }
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '..'));
      await vscode.workspace.fs.writeFile(target, Buffer.from(previews.script, 'utf8'));
      const written = await writeSchemaJson(session);
      const doc = await vscode.workspace.openTextDocument(target);
      await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
      vscode.window.setStatusBarMessage(
        nls.t('info.saved', { path: vscode.workspace.asRelativePath(target, false) }), 3000);
      if (!full && written) {
        const { changesFromDesigner } = require('./schemaJson');
        const { reportAndSubstitute } = require('./schemaBridge');
        const changes = changesFromDesigner(diffSchemas(session.state.baseline, session.state.schema));
        if (changes.length) {
          await reportAndSubstitute({
            changes, folder: written.folder, schemaRelPath: written.relPath,
            generator: 'db-playground@' + require('./extension').extensionVersion()
          });
        }
      }
      return;
    }
    if (msg.type === 'sendSql') {
      if (!logicSpecAvailable()) {
        vscode.window.showErrorMessage(nls.t('error.needLogicSpec'));
        return;
      }
      const previews = computePreviews(session.state, msg.ui);
      const query = (session.state.queries || []).find((q) => q.id === (msg.ui && msg.ui.queryId));
      if (!query || !query.table || !(previews.sql || '').trim() || previews.sql.startsWith('--')) {
        vscode.window.showWarningMessage(nls.t('error.noQuerySql'));
        return;
      }
      const stateFolder = vscode.workspace.getWorkspaceFolder(session.stateUri) ||
        (vscode.workspace.workspaceFolders || [])[0];
      await vscode.commands.executeCommand(INSERT_SQL_COMMAND, {
        sql: previews.sql,
        name: (query.name || '').trim(),
        schemaPath: stateFolder
          ? schemaRef(workspaceFolders(stateFolder), sessionBase(session) + '.schema.json')
          : sessionBase(session) + '.schema.json'
      });
      return;
    }
    if (msg.type === 'copy') {
      await vscode.env.clipboard.writeText(String(msg.text || ''));
      vscode.window.setStatusBarMessage(nls.t('status.copied'), 2000);
    }
  }, undefined, []);

  const extensionsWatcher = vscode.extensions && vscode.extensions.onDidChange
    ? vscode.extensions.onDidChange(() =>
        panel.webview.postMessage({ type: 'logicSpec', available: logicSpecAvailable() }))
    : null;
  panel.onDidDispose(() => {
    disposed = true;
    clearTimeout(saveTimer);
    if (pendingSave) writeState();
    if (extensionsWatcher) extensionsWatcher.dispose();
  });
}

function dialectOptions() {
  return DIALECT_ORDER.map((key) => ({ key, label: DIALECTS[key].label }));
}

function defaultStringTypes() {
  const out = {};
  for (const key of DIALECT_ORDER) out[key] = DIALECTS[key].defaultTypes.string;
  return out;
}

function dialectTypeOptions() {
  const out = {};
  for (const key of DIALECT_ORDER) {
    out[key] = Array.from(new Set(Object.values(DIALECTS[key].defaultTypes))).sort();
  }
  return out;
}

const OPERATOR_KEYS = {
  '=': 'op.eq', '<>': 'op.ne',
  '>': 'op.gt', '>=': 'op.ge',
  '<': 'op.lt', '<=': 'op.le',
  'LIKE': 'op.like', 'IN': 'op.in',
  'IS NULL': 'op.isNull', 'IS NOT NULL': 'op.isNotNull',
};

function operatorLabels(catalog) {
  const out = {};
  for (const op of Object.keys(OPERATOR_KEYS)) out[op] = catalog.t(OPERATOR_KEYS[op]);
  return out;
}

const mediaFile = (name) => fs.readFileSync(path.join(__dirname, '..', 'media', name), 'utf8');

function buildDesignerHtml(languageTag) {
  const catalog = languageTag ? forLanguage(languageTag) : nls;
  const t = catalog.t;
  const nonce = crypto.randomBytes(16).toString('base64');
  return [
    '<!DOCTYPE html><html lang="' + catalog.lang + '"><head><meta charset="utf-8">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'nonce-' + nonce + '\'; script-src \'nonce-' + nonce + '\'">',
    '<style nonce="' + nonce + '">', mediaFile('designer.css'), '</style>',
    '</head><body>',
    '<header>',
    '  <span id="sourceName" class="srcName mono"></span>',
    '  <label class="dialectWrap">' + t('ui.dialect') + ' <select id="dialect" class="mono"></select></label>',
    '  <nav><button id="tabSchema" class="tab active">' + t('ui.tabSchema') + '</button><button id="tabQueries" class="tab">' + t('ui.queries') + '</button></nav>',
    '  <span class="spacer"></span>',
    '  <span id="status" class="muted"></span>',
    '</header>',
    '<main id="schemaView">',
    '  <aside class="side left">',
    '    <div class="asideHead"><span id="tableListTitle">' + t('ui.tables') + '</span><span class="spacer"></span><button id="addTable" class="plus" title="' + t('ui.addTable') + '">+</button></div>',
    '    <ul id="tableList"></ul>',
    '  </aside>',
    '  <section class="center">',
    '    <div id="schemaContent" class="content"></div>',
    '    <div class="panel">',
    '      <div class="panelHead"><span class="panelTitle">' + t('ui.changeScript') + '</span>',
    '        <select id="scriptMode" class="tiny"><option value="diff">' + t('ui.modeDiff') + '</option><option value="full">' + t('ui.modeFull') + '</option></select>',
    '        <span class="spacer"></span>',
    '        <button id="openScript" class="tiny">' + t('ui.openAsFile') + '</button>',
    '        <button id="copyScript" class="tiny">' + t('ui.copy') + '</button>',
    '      </div>',
    '      <div id="scriptPreview" class="code"></div>',
    '    </div>',
    '  </section>',
    '  <aside class="side props">',
    '    <div class="asideHead"><span id="schemaPropsTitle">' + t('ui.properties') + '</span></div>',
    '    <div id="schemaProps" class="propsBody"></div>',
    '  </aside>',
    '</main>',
    '<main id="queryView" hidden>',
    '  <aside class="side left">',
    '    <div class="asideHead"><span>' + t('ui.queries') + '</span><span class="spacer"></span><button id="addQuery" class="plus" title="' + t('ui.addQuery') + '">+</button></div>',
    '    <ul id="queryList"></ul>',
    '  </aside>',
    '  <section class="center">',
    '    <div id="queryEditor" class="content"></div>',
    '    <div class="panel">',
    '      <div class="panelHead"><span class="panelTitle">' + t('ui.query') + '</span>',
    '        <span id="sqlMode" class="modeChip mono"></span>',
    '        <span class="spacer"></span>',
    '        <button id="sendSql" class="tiny" hidden>' + t('ui.sendToStep') + '</button>',
    '        <button id="openSql" class="tiny">' + t('ui.openAsFile') + '</button>',
    '        <button id="copySql" class="tiny">' + t('ui.copy') + '</button>',
    '      </div>',
    '      <div id="sqlPreview" class="code"></div>',
    '    </div>',
    '  </section>',
    '  <aside class="side props">',
    '    <div class="asideHead"><span id="queryPropsTitle">' + t('ui.properties') + '</span></div>',
    '    <div id="queryProps" class="propsBody"></div>',
    '  </aside>',
    '</main>',
    '<datalist id="typeOptions"></datalist>',
    '<script nonce="' + nonce + '">',
    'const DIALECT_OPTIONS = ' + JSON.stringify(dialectOptions()) + ';',
    'const DIALECT_KINDS = ' + JSON.stringify(Object.fromEntries(DIALECT_ORDER.map((k) => [k, DIALECTS[k].kind]))) + ';',
    'const DEFAULT_STRING_TYPE = ' + JSON.stringify(defaultStringTypes()) + ';',
    'const DIALECT_TYPES = ' + JSON.stringify(dialectTypeOptions()) + ';',
    'const OPERATORS = ' + JSON.stringify(OPERATORS) + ';',
    'const OP_LABELS = ' + JSON.stringify(operatorLabels(catalog)) + ';',
    'const NLS = ' + JSON.stringify(catalog.stringsTable()) + ';',
    'const NLS_FORMS = ' + JSON.stringify(catalog.formsTable()) + ';',
    'const NLS_LANG = ' + JSON.stringify(catalog.lang) + ';',
    SHAPE_SOURCE,
    mediaFile('designer.js'),
    '</script>',
    '</body></html>',
  ].join('\n');
}

module.exports = { openDesigner, buildDesignerHtml, computePreviews };
