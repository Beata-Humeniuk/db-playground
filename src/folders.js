'use strict';

const MODEL_SUBDIR = 'db/model';
const MIGRATION_SUBDIR = 'db/migration';

const specDirName = (projectName) => projectName + '-spec';

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

function schemaRef(folders, fileName) {
  const prefix = folders.specDir + '/';
  let dir = folders.modelDir;
  if (dir === folders.specDir) dir = '';
  else if (dir.startsWith(prefix)) dir = dir.slice(prefix.length);
  return (dir ? dir + '/' : '') + fileName;
}

module.exports = { MODEL_SUBDIR, MIGRATION_SUBDIR, specDirName, cleanFolder, resolveFolders, schemaRef };
