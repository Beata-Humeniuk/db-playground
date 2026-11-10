'use strict';

// Describe writes the Markdown description and the .schema.json at once,
// into the model folder, without waiting for a notification button.

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const assert = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exit(1); } };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dbp-describe-'));
const project = path.join(root, 'shop');
fs.mkdirSync(path.join(project, 'shop-spec', 'db'), { recursive: true });
const sqlPath = path.join(project, 'shop-spec', 'db', 'db.sql');
fs.writeFileSync(sqlPath, 'CREATE TABLE "OFFER" ("ID" bigint NOT NULL, "NAME" varchar(50), CONSTRAINT "PK_OFFER" PRIMARY KEY ("ID"));\n');

class Uri { constructor(p) { this.fsPath = p; this.scheme = 'file'; } }
const toUri = (p) => new Uri(p);
const messages = { info: [], warn: [], error: [] };
const commands = {};
const vscode = {
  env: { language: 'en' },
  Uri: Object.assign(Uri, { file: toUri, joinPath: (u, ...parts) => toUri(path.join(u.fsPath, ...parts)) }),
  ProgressLocation: { Notification: 15 },
  commands: { registerCommand: (id, fn) => { commands[id] = fn; return { dispose() {} }; } },
  workspace: {
    getWorkspaceFolder: () => ({ uri: toUri(project) }),
    asRelativePath: (u) => path.relative(project, u.fsPath).split(path.sep).join('/'),
    getConfiguration: () => ({ get: (k, d) => d }),
    openTextDocument: async (arg) => ({ arg }),
    fs: {
      stat: async (u) => fs.promises.stat(u.fsPath),
      createDirectory: async (u) => fs.promises.mkdir(u.fsPath, { recursive: true }),
      readFile: async (u) => fs.promises.readFile(u.fsPath),
      writeFile: async (u, data) => fs.promises.writeFile(u.fsPath, data)
    }
  },
  window: {
    withProgress: async (opts, fn) => fn(),
    showTextDocument: async () => ({}),
    showInformationMessage: async (m, ...actions) => { messages.info.push({ m, actions }); return undefined; },
    showWarningMessage: async (m) => { messages.warn.push(m); return undefined; },
    showErrorMessage: async (m) => { messages.error.push(m); return undefined; }
  }
};
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'vscode') return 'vscode-stub';
  return originalResolve.call(this, request, ...rest);
};
require.cache['vscode-stub'] = { id: 'vscode-stub', filename: 'vscode-stub', loaded: true, exports: vscode };

const ext = require('../src/extension');
ext.activate({ subscriptions: [], extension: { packageJSON: { version: 'test' } } });

(async () => {
  await commands['dbPlayground.describe'](toUri(sqlPath));
  const modelDir = path.join(project, 'shop-spec', 'db', 'model');
  assert(!messages.error.length, 'no error: ' + messages.error.join(' | '));
  assert(fs.existsSync(path.join(modelDir, 'db-schema.md')), 'the description is written');
  const json = JSON.parse(fs.readFileSync(path.join(modelDir, 'db.schema.json'), 'utf8'));
  assert(json.tables[0].name === 'OFFER' && json.tables[0].columns.length === 2, 'the schema JSON is written beside it');
  assert(messages.info.every((x) => !x.actions.length), 'nothing waits for a button');
  assert(/db\.schema\.json/.test(messages.info.map((x) => x.m).join(' ')), 'the message names the JSON too');

  // A description saved by hand before, without its JSON: describing again
  // writes the JSON, and the description is not overwritten unasked.
  fs.writeFileSync(path.join(modelDir, 'db-schema.md'), 'mine\n');
  fs.rmSync(path.join(modelDir, 'db.schema.json'));
  await commands['dbPlayground.describe'](toUri(sqlPath));
  assert(fs.readFileSync(path.join(modelDir, 'db-schema.md'), 'utf8') === 'mine\n', 'an existing description is not overwritten unasked');
  assert(messages.warn.length === 1, 'overwriting asks first');
  assert(fs.existsSync(path.join(modelDir, 'db.schema.json')), 'the schema JSON is written even when the description is kept');
  fs.rmSync(root, { recursive: true, force: true });
  console.log('OK: describe writes the description and the schema JSON at once');
})().catch((e) => { console.error('FAIL: ' + (e && e.stack || e)); process.exit(1); });
