import { csvRecords, nameKey, parseCsv } from './customer-policy';
describe('Customer import boundary', () => {
  it('normalizes width, whitespace and case without exposing customer identifiers', () => {
    expect(nameKey(' ＡＣＭＥ　公司 ')).toBe(nameKey('acme公司'));
    expect(nameKey('不同公司')).not.toBe(nameKey('acme公司'));
  });
  it('parses BOM, quoted commas, escaped quotes and multiline remarks', () => {
    const rows = csvRecords('\uFEFF客户名称,备注\r\n"甲,公司","第一行\n第二行"\r\n乙公司,"他说""你好"""\r\n');
    expect(rows[0].data).toEqual({ name: '甲,公司', remark: '第一行\n第二行' });
    expect(rows[1].data.remark).toBe('他说"你好"');
  });
  it.each([
    '客户名称,ownerId\n甲,1',
    '客户名称,客户名称\n甲,乙',
    'constructor\n甲',
    '客户名称\n"未闭合',
    '客户名称\n"甲"尾部',
    '客户名称\n甲"乙',
  ])('rejects malformed or unexpected CSV %s', (csv) => expect(() => csvRecords(csv)).toThrow());
  it('reports row errors before any write and enforces existing schema limits', () => {
    const rows = csvRecords('客户名称,行业,级别\n甲,' + 'a'.repeat(51) + ',未知\n,制造,普通客户\n乙,制造,普通客户');
    expect(rows[0].error).toBeTruthy();
    expect(rows[1].error).toBeTruthy();
    expect(rows[2].error).toBe('');
  });
  it('bounds rows and bytes', () => {
    expect(() => parseCsv('客户名称\n' + Array.from({ length: 201 }, (_, i) => '客户' + i).join('\n'))).toThrow();
    expect(() => parseCsv('x'.repeat(1024 * 1024 + 1))).toThrow();
  });
});
