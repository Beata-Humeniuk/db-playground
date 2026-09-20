'use strict';

const { readCsvText, CsvDesigner, detectDelimiter } = require('../src/csvSchema');

const assert = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exit(1); } };

assert(detectDelimiter('a;b;c') === ';', 'delimiter ;');
assert(detectDelimiter('a\tb\tc') === '\t', 'delimiter tab');
assert(detectDelimiter('a,b,"c;d"') === ',', 'quoted ; does not win');

const CSV = [
  'id;first_name;amount;active;registered_on;note',
  '1;Ala;19,99;true;2024-01-05;"multiline',
  'note; with ""x"""',
  '2;Ola;5,00;false;2024-02-10;',
  '3;Ela;12,50;true;2024-03-15;plain text',
  '',
].join('\n');

const model = readCsvText(CSV, { name: 'customers' });
const table = model.tables[0];
assert(model.delimiter === ';', 'detected ; delimiter');
assert(table.rowCount === 3, 'row count 3, got ' + table.rowCount);
assert(table.columns.length === 6, '6 columns, got ' + table.columns.length);

const byName = Object.fromEntries(table.columns.map((c) => [c.name, c]));
assert(byName['id'].typeKeys[0] === 'integer', 'id is integer');
assert(byName['id'].unique === true, 'id unique');
assert(byName['id'].nullable === false, 'id has no empty values');
assert(byName['amount'].typeKeys[0] === 'number', 'comma decimal detected as number, got ' + byName['amount'].typeKeys[0]);
assert(byName['active'].typeKeys[0] === 'boolean', 'boolean column');
assert(byName['registered_on'].typeKeys[0] === 'date', 'date column');
assert(byName['first_name'].typeKeys[0] === 'string', 'string column');
assert(byName['note'].nullable === true, 'empty value makes column nullable');
assert(Math.round(byName['note'].presence * 100) === 67, 'note presence 67%, got ' + byName['note'].presence);
assert(byName['note'].examples[0].includes('multiline'), 'quoted multiline value parsed');
assert(byName['note'].examples[0].includes('"x"'), 'doubled quotes unescaped');

const chunked = new CsvDesigner();
for (let i = 0; i < CSV.length; i += 3) chunked.push(CSV.slice(i, i + 3));
chunked.end();
const chunkedModel = chunked.model({ name: 'customers' });
assert(chunkedModel.tables[0].rowCount === 3, 'chunked: same row count');
assert(chunkedModel.tables[0].columns.length === 6, 'chunked: same column count');
assert(chunkedModel.tables[0].columns[5].examples[0].includes('"x"'), 'chunked: doubled quote across chunks');

const plain = readCsvText('a,b,\n1,x,9\n2,y,8\n', { name: 'plain' });
assert(plain.delimiter === ',', 'comma delimiter');
assert(plain.tables[0].columns[2].name === 'column_3', 'empty header gets a placeholder name');

console.log('csv-test OK');
