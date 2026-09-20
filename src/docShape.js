'use strict';

const SHAPE_SOURCE = String.raw`
function parseFieldPath(path) {
  var segments = [];
  var raw = String(path == null ? '' : path).split('.');
  for (var i = 0; i < raw.length; i++) {
    var m = /^([\s\S]*?)((?:\[\])*)$/.exec(raw[i]);
    segments.push({ key: m[1], arrays: m[2].length / 2 });
  }
  return segments;
}

function hasNestedPaths(columns) {
  return (columns || []).some(function (c) { return /[.]|\[\]/.test(String(c.name || '')); });
}

function brackets(n) {
  var s = '';
  for (var i = 0; i < n; i++) s += '[]';
  return s;
}

function newShapeNode(key, depth) {
  return {
    key: key, arrays: 0, label: key, path: key, depth: depth,
    entries: [], column: null, element: null,
    children: [], fields: [], objects: [], container: false,
  };
}

function buildShape(columns) {
  var root = newShapeNode('', 0);
  var index = new Map();
  index.set('', root);
  var list = columns || [];
  for (var i = 0; i < list.length; i++) {
    var column = list[i];
    var segments = parseFieldPath(column.name);
    if (segments.length === 1 && !segments[0].key) {
      var blank = newShapeNode('', 1);
      blank.entries.push({ column: column, arrays: 0 });
      root.children.push(blank);
      continue;
    }
    var node = root;
    var keyPath = '';
    for (var s = 0; s < segments.length; s++) {
      var seg = segments[s];
      keyPath = keyPath ? keyPath + '.' + seg.key : seg.key;
      var child = index.get(keyPath);
      if (!child) {
        child = newShapeNode(seg.key, node.depth + 1);
        index.set(keyPath, child);
        node.children.push(child);
      }
      if (seg.arrays > child.arrays) child.arrays = seg.arrays;
      if (s === segments.length - 1) child.entries.push({ column: column, arrays: seg.arrays });
      node = child;
    }
  }
  finishShapeNode(root, '');
  return root;
}

function finishShapeNode(node, parentPath) {
  node.label = node.key + brackets(node.arrays);
  node.path = parentPath ? parentPath + '.' + node.label : node.label;
  node.container = node.children.length > 0;
  var base = null;
  var element = null;
  for (var i = 0; i < node.entries.length; i++) {
    var entry = node.entries[i];
    if (!base && entry.arrays === 0) base = entry;
    if (!element && node.arrays > 0 && entry.arrays === node.arrays) element = entry;
  }
  if (!base) base = node.entries[0] || null;
  node.column = base ? base.column : null;
  node.element = element ? element.column : null;
  for (var c = 0; c < node.children.length; c++) {
    var child = node.children[c];
    finishShapeNode(child, node.path);
    if (child.container) node.objects.push(child); else node.fields.push(child);
  }
}

function objectNodes(root) {
  var out = [];
  var walk = function (node, parent) {
    out.push({ node: node, parent: parent });
    for (var i = 0; i < node.objects.length; i++) walk(node.objects[i], node);
  };
  walk(root, null);
  return out;
}

function countShapeLeaves(node) {
  var n = node.fields.length;
  for (var i = 0; i < node.objects.length; i++) n += countShapeLeaves(node.objects[i]);
  return n;
}

function listWord(arrays, words) { return arrays >= 2 ? words.listOfLists : words.list; }

function containerKind(node, words) {
  if (!node.arrays) return words.object;
  if (!node.container) return listWord(node.arrays, words);
  return node.arrays >= 2 ? words.listOfListsOfObjects : words.listOfObjects;
}

function leafKind(node, typeText, words) {
  var t = typeText == null ? '' : String(typeText).trim();
  if (!node.arrays) return t;
  if (!t) return listWord(node.arrays, words);
  return listWord(node.arrays, words) + ': ' + t;
}

function typeColumn(node) {
  return node.element || node.column;
}
`;

const api = new Function(SHAPE_SOURCE + '\nreturn { parseFieldPath: parseFieldPath, hasNestedPaths: hasNestedPaths,' +
  ' buildShape: buildShape, objectNodes: objectNodes, countShapeLeaves: countShapeLeaves,' +
  ' containerKind: containerKind, leafKind: leafKind, typeColumn: typeColumn };')();

module.exports = Object.assign({ SHAPE_SOURCE }, api);
