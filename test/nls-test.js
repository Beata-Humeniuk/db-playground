'use strict';

const assert = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exit(1); } };

const { forLanguage, baseLanguage, EN, TRANSLATIONS } = require('../src/nls');

assert(Object.keys(TRANSLATIONS).length === 0, 'no translations — the extension speaks English only');

for (const key of Object.keys(EN)) {
  const value = EN[key];
  if (Array.isArray(value)) {
    assert(value.length === 2, key + ': plural forms are [one, many]');
    assert(value.every((v) => typeof v === 'string' && v !== ''), key + ': plural forms are non-empty');
  } else {
    assert(typeof value === 'string' && value !== '', key + ': base value is a non-empty string');
  }
}

assert(baseLanguage('pl-PL') === 'pl' && baseLanguage('en-US') === 'en' && baseLanguage('') === 'en',
  'language tag reduces to its base');

const en = forLanguage('en-US');
const pl = forLanguage('pl-PL');
const de = forLanguage('de');
assert(en.lang === 'en' && pl.lang === 'en' && de.lang === 'en', 'every language resolves to English');
assert(en.t('ui.copy') === 'Copy' && pl.t('ui.copy') === 'Copy' && de.t('ui.copy') === 'Copy', 'simple lookup');
assert(en.t('info.saved', { path: 'a/b.md' }) === 'Saved: a/b.md', 'placeholder substitution');
assert(en.t('no.such.key') === 'no.such.key', 'unknown key returns the key');

assert(en.plural('plural.change', 1) === 'change' && en.plural('plural.change', 5) === 'changes', 'plural forms');
assert(pl.plural('plural.change', 5) === 'changes', 'a foreign language still gets the English plural');

const strings = en.stringsTable();
const forms = en.formsTable();
assert(strings['ui.copy'] === 'Copy' && !('plural.change' in strings), 'strings table holds only strings');
assert(Array.isArray(forms['plural.change']) && !('ui.copy' in forms), 'forms table holds only plural forms');

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const POLISH = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;
for (const dir of ['src', 'media']) {
  for (const file of fs.readdirSync(path.join(root, dir))) {
    const text = fs.readFileSync(path.join(root, dir, file), 'utf8');
    assert(!POLISH.test(text), dir + '/' + file + ' holds no Polish text');
  }
}

const manifest = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
const nlsEn = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.json'), 'utf8'));
const used = new Set((manifest.match(/%[\w.]+%/g) || []).map((m) => m.slice(1, -1)));
assert(used.size > 0, 'manifest references nls keys');
for (const key of used) {
  assert(typeof nlsEn[key] === 'string' && nlsEn[key] !== '', 'package.nls.json defines ' + key);
}
const nlsFiles = fs.readdirSync(root).filter((f) => /^package\.nls\..+\.json$/.test(f));
assert(nlsFiles.length === 0, 'no per-language manifest files, got: ' + nlsFiles.join(', '));

console.log('nls-test OK');
