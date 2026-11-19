import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell } from './csv.ts';
test('normal names, blanks and trusted numeric values remain unchanged', () => {
  assert.equal(csvCell('示例经营公司'), '"示例经营公司"');
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell(undefined), '""');
  assert.equal(csvCell(0), '"0"');
  assert.equal(csvCell(-12.5), '"-12.5"');
  assert.equal(csvCell('1000.00'), '"1000.00"');
});
test('formula-like text includes whitespace, control, invisible and full-width variants', () => {
  for (const value of ['=1+1', '+1+1', '-1+1', '@SUM(1,1)', ' =1+1', '\n=1+1', '\r=1+1', '\t=1+1', '\uFEFF=1+1', '\u0000=1+1', '\u200b=1+1', '＝1+1', '＋1+1', '－1+1', '＠SUM(1,1)', '  ＝1+1']) {
    assert(csvCell(value).startsWith('"\t\''), JSON.stringify(value));
  }
});
test('quotes and separators cannot break out into additional cells', () => {
  assert.equal(csvCell('safe",=1+1'), '"safe"",=1+1"');
  assert.equal(csvCell('=1+2";=1+2'), '"\t\'=1+2"";=1+2"');
  assert.equal(csvCell('name,with;separators'), '"name,with;separators"');
});
test('line breaks stay in quoted fields and leading control text is neutralized', () => {
  assert.equal(csvCell('第一行\n第二行'), '"第一行\n第二行"');
  assert.equal(csvCell('\n普通内容'), '"\t\'\n普通内容"');
  assert.equal(csvCell(' \t普通内容'), '"\t\' \t普通内容"');
});
test('the protection changes only the export representation', () => {
  const row = { name: ' =1+1' };
  const result = csvCell(row.name);
  assert.equal(row.name, ' =1+1');
  assert.notEqual(result, '" =1+1"');
});
