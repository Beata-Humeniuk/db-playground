const assert = (ok, name) => { if (!ok) { console.error('FAIL: ' + name); process.exit(1); } };
const { confluenceBinding, withConfluenceBinding } = require('../src/confluenceBinding');

const published = ['---', 'confluence:', '  url: https://example.atlassian.net/wiki/x/1', '  version: 7',
  'type: contract', 'managed: true', '---', '', '# Contract'].join('\n');
const binding = confluenceBinding(published);
assert(binding.length === 3 && binding[0] === 'confluence:', 'binding lifted out of a published document');
assert(binding.indexOf('type: contract') < 0, 'document keys are not mistaken for the binding');
assert(confluenceBinding('---\ntype: contract\n---\n\n# X').length === 0, 'never published: no binding');
assert(confluenceBinding('# X bez frontmattera').length === 0, 'no frontmatter: no binding');

const regenerated = '---\ntype: contract\nmanaged: true\n---\n\n# Contract\n';
const restored = withConfluenceBinding(regenerated, binding);
assert(restored.startsWith('---\nconfluence:\n  url: https://'), 'binding put back on top');
assert(restored.includes('type: contract'), 'regenerated keys kept');
assert(withConfluenceBinding(regenerated, []) === regenerated, 'no binding: document untouched');

console.log('PASS: confluence binding survives regeneration');
