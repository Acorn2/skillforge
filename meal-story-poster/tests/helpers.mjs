import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { skillRoot, writeJson } from '../scripts/lib/io.mjs';

export const AS_OF = '2026-10-16';
export async function workspace() {
  const base = path.resolve(skillRoot, '../.tmp/meal-story-poster-tests');
  await fs.mkdir(base, { recursive: true });
  return fs.mkdtemp(path.join(base, 'run-'));
}
export function reviewed({ children = false, channels = ['wechat_moments', 'parent_group', 'xiaohongshu', 'video_title', 'video_caption'] } = {}) {
  return {
    identifiableChildren: children ? 'yes' : 'no', publicUsePermission: 'verified',
    privacyReview: {
      reviewedBy: 'TEST-REVIEWER', reviewedAt: '2026-10-16T00:00:00Z', risksChecked: true,
      identifiablePeople: children ? 'yes' : 'no', sensitiveInfo: 'no', subjectCount: children ? 1 : 0,
      subjects: children ? [{ subjectId: 'TEST-SUBJECT-01', isMinor: true, permission: 'verified', guardianPermissionVerified: true,
        channels, purpose: 'meal-story-publicity', validUntil: '2027-01-01' }] : []
    }
  };
}

export async function fixture(root, categories, { sizes, review = true } = {}) {
  const input = path.join(root, 'input');
  await fs.mkdir(input, { recursive: true });
  const assets = [];
  for (let i = 0; i < categories.length; i++) {
    const [width, height] = sizes?.[i] ?? [720, 540];
    const color = `hsl(${(i * 41 + 30) % 360},45%,65%)`;
    // Deliberately geometric, never resembling food or a person.
    const data = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/><circle cx="${width * 0.4}" cy="${height * 0.5}" r="${Math.min(width, height) * 0.22}" fill="#F9F7EF"/><rect x="${width * 0.65}" y="${height * 0.2}" width="${width * 0.15}" height="${height * 0.6}" fill="#286A3D"/></svg>`);
    const file = path.join(input, `${String(i + 1).padStart(2, '0')}.png`);
    await sharp(data).png().toFile(file);
    assets.push({ id: `img-${i + 1}`, file, category: categories[i], categoryStatus: 'verified',
      label: `${categories[i] === 'ingredient' ? '备料' : categories[i] === 'dining-scene' ? '环境' : '菜品'}测试${i + 1}`, labelStatus: 'verified',
      note: null, noteStatus: 'needs-confirmation', capturedAt: null, siteId: null, cropReviewed: true,
      ...(review ? reviewed() : { identifiableChildren: 'unknown', publicUsePermission: 'unverified' }) });
  }
  const content = {
    schemaVersion: '1.1', brand: { name: '合成图测试 · 非真实餐食' },
    record: { date: null, dateVerified: false, scope: 'single-day' },
    assets, output: { templates: ['auto'], width: 1080, height: 1440, format: 'png' },
    diningScene: { enabled: false, assetIds: [], publicUsePermission: 'unverified' },
    approval: { contentApproved: false, publicReleaseApproved: false, approvedBy: null }
  };
  const contentFile = path.join(root, 'content.json');
  await writeJson(contentFile, content);
  return { root, input, contentFile, content, save: () => writeJson(contentFile, content) };
}
