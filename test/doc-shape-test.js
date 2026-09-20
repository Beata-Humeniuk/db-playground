'use strict';

const {
  parseFieldPath, hasNestedPaths, buildShape, objectNodes,
  countShapeLeaves, containerKind, leafKind, typeColumn, SHAPE_SOURCE,
} = require('../src/docShape');

const assert = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exit(1); } };

const WORDS = {
  object: 'object',
  list: 'list',
  listOfLists: 'list of lists',
  listOfObjects: 'list of objects',
  listOfListsOfObjects: 'list of lists of objects',
};

assert(JSON.stringify(parseFieldPath('items[].sku')) ===
  JSON.stringify([{ key: 'items', arrays: 1 }, { key: 'sku', arrays: 0 }]), 'path split');
assert(parseFieldPath('a[][]')[0].arrays === 2, 'nested lists counted');
assert(parseFieldPath('plain').length === 1, 'a plain name is one segment');

assert(hasNestedPaths([{ name: 'a.b' }]), 'dotted path is nested');
assert(hasNestedPaths([{ name: 'tags[]' }]), 'list marker is nested');
assert(!hasNestedPaths([{ name: 'id' }, { name: 'email' }]), 'a flat table is not nested');

const columns = [
  { name: '_id', type: 'ObjectId' },
  { name: 'orderId', type: 'string' },
  { name: 'originalOrder', type: 'object' },
  { name: 'originalOrder.product', type: 'object' },
  { name: 'originalOrder.product.code', type: 'string' },
  { name: 'originalOrder.product.options', type: 'list' },
  { name: 'originalOrder.product.options[]', type: 'object' },
  { name: 'originalOrder.product.options[].id', type: 'integer' },
  { name: 'tags', type: 'list' },
  { name: 'tags[]', type: 'string' },
];

const root = buildShape(columns);
assert(root.children.map((c) => c.label).join(',') === '_id,orderId,originalOrder,tags[]',
  'top level keeps document order, got ' + root.children.map((c) => c.label).join(','));
assert(root.fields.length === 3 && root.objects.length === 1, 'leaves and subdocuments split');

const tags = root.children[3];
assert(tags.arrays === 1 && !tags.container, 'a list of scalars is a leaf');
assert(tags.column.name === 'tags' && tags.element.name === 'tags[]', 'both columns kept');
assert(typeColumn(tags).name === 'tags[]', 'the element carries the type');
assert(leafKind(tags, typeColumn(tags).type, WORDS) === 'list: string', 'list type label');

const product = root.objects[0].objects[0];
assert(product.path === 'originalOrder.product', 'path rebuilt, got ' + product.path);
assert(containerKind(product, WORDS) === 'object', 'embedded object');
const options = product.objects[0];
assert(options.label === 'options[]' && containerKind(options, WORDS) === 'list of objects',
  'a list of subdocuments, got ' + options.label + ' / ' + containerKind(options, WORDS));
assert(options.path === 'originalOrder.product.options[]', 'list path keeps the marker');
assert(countShapeLeaves(root.objects[0]) === 2, 'leaves below originalOrder, got ' + countShapeLeaves(root.objects[0]));

const nodes = objectNodes(root);
assert(nodes.length === 4, 'root + three subdocuments, got ' + nodes.length);
assert(nodes[0].parent === null && nodes[0].node === root, 'root comes first');
assert(nodes[3].parent === product, 'parents reported with the node');

const orphan = buildShape([{ name: 'a.b.c', type: 'string' }]);
assert(orphan.children[0].column === null, 'the missing parent has no column of its own');
assert(orphan.children[0].children[0].children[0].label === 'c', 'the leaf is still reached');

const fresh = buildShape([{ name: 'id', type: 'string' }, { name: '', type: 'string' }]);
assert(fresh.children.length === 2, 'the unnamed field is listed, got ' + fresh.children.length);
assert(fresh.column === null, 'the root keeps no column of its own');
assert(fresh.children[1].column.name === '', 'the unnamed column hangs off its own node');

assert(SHAPE_SOURCE.indexOf('require(') < 0 && SHAPE_SOURCE.indexOf('module.') < 0,
  'no module system inside the injected source');
assert(SHAPE_SOURCE.indexOf('`') < 0, 'no backticks: the source is injected inside a template literal');

console.log('doc-shape-test OK');
