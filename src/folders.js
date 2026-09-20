'use strict';

// Where the extension writes: the model folder (Markdown description, full
// CREATE script and the `.schema.json` bridge file) and the migration folder
// (change scripts from the designer). Both default to the generated
// `<project>-spec/` tree and can be pointed elsewhere from the settings.
// Pure functions — no vscode here — so the resolution is testable.

const MODEL_SUBDIR = 'db/model';
const MIGRATION_SUBDIR = 'db/migration';

const specDirName = (projectName) => projectName + '-spec';

// A workspace-relative folder as typed in the settings: slashes normalised,
// no leading `./`, no trailing slash. Empty means "use the default".
function cleanFolder(value) {
  let s = String(value === undefined || value === null ? '' : value).trim().replace(/\\/g, '/');
  s = s.replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  return s === '.' ? '' : s;
}

function resolveFolders(projectName, settings) {
  const s = settings || {};
  const specDir = specDirName(projectName);
  return {
    specDir,
    modelDir: cleanFolder(s.modelFolder) || specDir + '/' + MODEL_SUBDIR,
    migrationDir: cleanFolder(s.migrationFolder) || specDir + '/' + MIGRATION_SUBDIR,
  };
}

// The reference other tools store for a schema file (`dbSchema` in a Logic
// Spec package): relative to the spec tree when the model folder lies inside
// it — `db/model/<base>.schema.json` — and workspace-relative otherwise.
function schemaRef(folders, fileName) {
  const prefix = folders.specDir + '/';
  let dir = folders.modelDir;
  if (dir === folders.specDir) dir = '';
  else if (dir.startsWith(prefix)) dir = dir.slice(prefix.length);
  return (dir ? dir + '/' : '') + fileName;
}

module.exports = { MODEL_SUBDIR, MIGRATION_SUBDIR, specDirName, cleanFolder, resolveFolders, schemaRef };
