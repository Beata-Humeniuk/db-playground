'use strict';

const assert = require('assert');
const { cleanFolder, resolveFolders, schemaRef } = require('../src/folders');

assert.strictEqual(cleanFolder(undefined), '');
assert.strictEqual(cleanFolder('  '), '');
assert.strictEqual(cleanFolder('./docs/db/'), 'docs/db');
assert.strictEqual(cleanFolder('docs\\db\\model'), 'docs/db/model');
assert.strictEqual(cleanFolder('.'), '');

const defaults = resolveFolders('shop', {});
assert.strictEqual(defaults.specDir, 'shop-spec');
assert.strictEqual(defaults.modelDir, 'shop-spec/db/model');
assert.strictEqual(defaults.migrationDir, 'shop-spec/db/migration');
assert.strictEqual(schemaRef(defaults, 'shop.schema.json'), 'db/model/shop.schema.json');

const inside = resolveFolders('shop', { modelFolder: 'shop-spec/schema/' });
assert.strictEqual(inside.modelDir, 'shop-spec/schema');
assert.strictEqual(inside.migrationDir, 'shop-spec/db/migration');
assert.strictEqual(schemaRef(inside, 'shop.schema.json'), 'schema/shop.schema.json');

const outside = resolveFolders('shop', { modelFolder: 'docs/db', migrationFolder: './sql/changes/' });
assert.strictEqual(outside.modelDir, 'docs/db');
assert.strictEqual(outside.migrationDir, 'sql/changes');
assert.strictEqual(schemaRef(outside, 'shop.schema.json'), 'docs/db/shop.schema.json');

const root = resolveFolders('shop', { modelFolder: 'shop-spec' });
assert.strictEqual(schemaRef(root, 'shop.schema.json'), 'shop.schema.json');

console.log('folders-test OK');
