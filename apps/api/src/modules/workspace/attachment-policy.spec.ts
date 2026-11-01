import { attachmentInput, MAX_ATTACHMENT_BYTES } from './attachment-policy';
describe('evidence input integrity and filename boundary', () => {
  const pdf = Buffer.from('%PDF-1.7\nsynthetic fixture\n%%EOF');
  it('preserves exact bytes with a SHA256 identity', () => {
    const result = attachmentInput('验收证据.pdf', pdf.toString('base64'));
    expect(result.bytes.equals(pdf)).toBe(true);
    expect(result.sha256).toHaveLength(64);
    expect(result.mediaType).toBe('application/pdf');
  });
  test.each(['../e.pdf', 'a\\b.pdf', 'evil\r\n.pdf', '<script>.pdf', 'a.pdf.'])('rejects unsafe filename %s', (name) =>
    expect(() => attachmentInput(name, pdf.toString('base64'))).toThrow(),
  );
  test.each(['', '%%%=', 'Zg', 'Zg===', 'Zg==\n'])('rejects noncanonical encoding %s', (content) =>
    expect(() => attachmentInput('a.pdf', content)).toThrow(),
  );
  it('rejects extension/header mismatch and oversize content', () => {
    expect(() => attachmentInput('a.png', pdf.toString('base64'))).toThrow();
    expect(() => attachmentInput('a.html', pdf.toString('base64'))).toThrow();
    expect(() => attachmentInput('a.pdf', Buffer.alloc(MAX_ATTACHMENT_BYTES + 1).toString('base64'))).toThrow();
  });
});
