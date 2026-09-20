const assert = (ok, name) => { if (!ok) { console.error('FAIL: ' + name); process.exit(1); } };
const { sameContent, VOLATILE_MARKDOWN } = require('../src/writeIfChanged');

const yesterday = '---\ntype: contract\ngenerated: 2026-08-12\nmanaged: true\n---\n\n# Contract\n';
const today = '---\ntype: contract\ngenerated: 2026-08-13\nmanaged: true\n---\n\n# Contract\n';
const edited = '---\ntype: contract\ngenerated: 2026-08-13\nmanaged: true\n---\n\n# Contract v2\n';

assert(sameContent(yesterday, today, VOLATILE_MARKDOWN), 'a new date alone is not a change');
assert(!sameContent(today, edited, VOLATILE_MARKDOWN), 'changed content is a change');
assert(!sameContent(yesterday, today, []), 'without volatile keys the comparison is literal');

console.log('PASS: unchanged documents are not rewritten');
