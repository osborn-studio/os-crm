import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
export const MAX_ATTACHMENT_BYTES = 1024 * 1024;
export const MAX_TENANT_ATTACHMENT_BYTES = 16 * MAX_ATTACHMENT_BYTES;
export function attachmentInput(filename: unknown, encoded: unknown) {
  if (
    typeof filename !== 'string' ||
    !filename.trim() ||
    filename.length > 160 ||
    /[\x00-\x1f\x7f/\\<>:"|?*]/.test(filename) ||
    /[. ]$/.test(filename)
  )
    throw new BadRequestException('文件名无效，不得包含路径或控制字符');
  if (
    typeof encoded !== 'string' ||
    !encoded.length ||
    encoded.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  )
    throw new BadRequestException('附件需为不超过1MiB的标准Base64');
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES || bytes.toString('base64') !== encoded)
    throw new BadRequestException('附件内容或大小无效');
  const lower = filename.toLowerCase();
  const mediaType =
    lower.endsWith('.pdf') && bytes.subarray(0, 5).toString() === '%PDF-'
      ? 'application/pdf'
      : lower.endsWith('.png') && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? 'image/png'
        : /\.jpe?g$/.test(lower) && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          ? 'image/jpeg'
          : null;
  if (!mediaType) throw new BadRequestException('只接收扩展名及文件头一致的PDF、PNG或JPEG');
  return {
    filename: filename.trim(),
    bytes,
    size: bytes.length,
    mediaType,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
