import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import Ajv from 'ajv';

export const skillRoot = fileURLToPath(new URL('../../', import.meta.url));
export function defaultOutputDirectory(prefix = 'meal') {
  const timestamp = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).format(new Date()).replace(/\D/g, '');
  return path.join(skillRoot, 'outputs', `${prefix}-${timestamp}-${randomUUID().slice(0, 8)}`);
}
export const imageOptions = { limitInputPixels: 64_000_000, failOn: 'warning' };
export const hash = data => createHash('sha256').update(data).digest('hex');
export const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
export async function writeJson(file, data) {
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}
export function inside(root, file) {
  const rel = path.relative(root, file);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}
export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number(value.slice(0, 4)) >= 1900
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function validTimestamp(value, asOf) {
  return typeof value === 'string' && validDate(value.slice(0, 10)) && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && !Number.isNaN(Date.parse(value)) && value.slice(0, 10) <= asOf;
}
export function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export async function freshDirectory(dir) {
  await fs.mkdir(path.dirname(dir), { recursive: true });
  try { await fs.mkdir(dir, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const stat = await fs.lstat(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory() || (await fs.readdir(dir)).length) {
      throw new Error(`输出目录必须不存在或为空，避免覆盖与旧图误发：${dir}`);
    }
    await fs.chmod(dir, 0o700);
  }
}

export async function inspectAssets(input) {
  const root = await fs.realpath(input);
  if (!(await fs.stat(root)).isDirectory()) throw new Error('输入必须是本地照片文件夹');
  const files = [], warnings = [];
  async function walk(dir) {
    for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (entry.name.startsWith('.')) continue;
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) { warnings.push({ code: 'symlink-skipped', file }); continue; }
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && /\.(jpe?g|png)$/i.test(entry.name)) files.push(file);
      else if (/\.(heic|heif|webp|gif)$/i.test(entry.name)) warnings.push({ code: 'unsupported-format', file });
    }
  }
  await walk(root);
  if (files.length > 30) throw new Error('每批最多 30 张 JPG/PNG，请拆分输入目录');
  const assets = [], seen = new Map();
  for (const file of files) {
    try {
      if ((await fs.stat(file)).size > 64_000_000) throw new Error('图片文件超过 64 MB');
      const data = await fs.readFile(file);
      const metadata = await sharp(data, imageOptions).metadata();
      if (!['jpeg', 'png'].includes(metadata.format) || (metadata.pages ?? 1) !== 1) throw new Error('仅支持单帧 JPG/PNG');
      // Force decoding; metadata alone does not reject truncated pixel data.
      await sharp(data, imageOptions).autoOrient().resize(8, 8).raw().toBuffer();
      const sha256 = hash(data);
      const duplicateOf = seen.get(sha256) ?? null;
      const item = {
        id: `src-${String(assets.length + 1).padStart(2, '0')}`,
        sourcePath: file, sha256, format: metadata.format,
        width: metadata.width, height: metadata.height,
        orientedWidth: metadata.autoOrient?.width ?? metadata.width,
        orientedHeight: metadata.autoOrient?.height ?? metadata.height,
        orientation: metadata.orientation ?? 1, duplicateOf
      };
      assets.push(item);
      if (!duplicateOf) seen.set(sha256, item.id);
      else warnings.push({ code: 'duplicate-photo', assetId: item.id, duplicateOf });
    } catch (error) { warnings.push({ code: 'invalid-image', file, reason: error.message }); }
  }
  if (!assets.length) throw new Error('没有可解码的 JPG/PNG 照片；HEIC 请先另存为 JPG');
  return { schemaVersion: '1.1', inputRoot: root, count: assets.length, assets, warnings };
}

let validator;
export async function loadContent(file) {
  return validateContent(await json(file));
}
export async function validateContent(value) {
  validator ??= new Ajv({ allErrors: true, strict: false }).compile(await json(path.join(skillRoot, 'references/content.schema.json')));
  if (!validator(value)) throw new Error(`content.json 不符合 Schema 1.1：${JSON.stringify(validator.errors)}`);
  const ids = value.assets.map(a => a.id);
  if (new Set(ids).size !== ids.length) throw new Error('assets[].id 不能重复');
  if (value.output?.templates?.includes('auto') && value.output.templates.length !== 1) throw new Error('auto 不能与显式模板混用');
  return value;
}

export async function prepareContent(scan, outputFile, analysisFile) {
  let suggestions = [];
  if (analysisFile) {
    const analysis = await json(analysisFile);
    suggestions = analysis.assets;
    if (!Array.isArray(suggestions)) throw new Error('analysis.json 需要 assets 数组');
    const ids = new Set(scan.assets.map(a => a.id));
    if (suggestions.some(a => !ids.has(a.assetId)) || new Set(suggestions.map(a => a.assetId)).size !== suggestions.length) throw new Error('识别结果引用了未知或重复 assetId');
  }
  const content = {
    schemaVersion: '1.1', brand: { name: '三人行托管中心', locationName: null, locationVerified: false, siteId: null },
    record: { date: null, dateVerified: false, scope: 'single-day' },
    output: { templates: ['auto'], width: 1080, height: 1440, format: 'png', fit: 'cover' },
    assets: scan.assets.map(a => {
      const s = suggestions.find(s => s.assetId === a.id);
      const category = ['ingredient', 'finished-dish', 'dining-scene', 'other'].includes(s?.suggestedCategory) ? s.suggestedCategory : 'other';
      return {
        id: a.id, file: path.relative(path.dirname(path.resolve(outputFile)), a.sourcePath), sha256: a.sha256,
        category, categoryStatus: 'needs-confirmation',
        label: typeof s?.suggestedName === 'string' ? s.suggestedName : null, labelStatus: 'needs-confirmation',
        note: null, noteStatus: 'needs-confirmation', capturedAt: null, siteId: null,
        identifiableChildren: 'unknown', publicUsePermission: 'unverified'
      };
    }),
    confirmedLinks: [], diningScene: { enabled: false, assetIds: [], privacyMode: 'prefer-anonymous', publicUsePermission: 'unverified' },
    copy: { tone: 'warm-and-factual', targets: [...TARGETS], enableNutritionClaims: false, allowUnverifiedClaims: false },
    approval: { contentApproved: false, publicReleaseApproved: false, approvedBy: null }
  };
  await fs.mkdir(path.dirname(path.resolve(outputFile)), { recursive: true });
  await fs.writeFile(outputFile, `${JSON.stringify(content, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return content;
}

export const TARGETS = ['wechat_moments', 'parent_group', 'xiaohongshu', 'video_title', 'video_caption'];
export const TEMPLATES = ['meal-overview', 'ingredient-focus', 'meal-focus', 'dining-scene'];
