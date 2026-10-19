#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { inspectAssets, prepareContent } from '../scripts/lib/io.mjs';
import { build } from '../scripts/lib/pipeline.mjs';
import { createZip } from './zip.mjs';
import { limitsFor, fitsLabel } from './public/label-fit.mjs';

const PORT = Number(process.env.PORT ?? 8787);
// 托管平台会注入 PORT，此时必须监听 0.0.0.0；本地直接跑则只听回环，照片不出本机。
const HOST = process.env.HOST ?? (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const MAX_BODY = 60 * 1024 * 1024;
const TMP_ROOT = path.join(os.tmpdir(), 'meal-story-web');
const PUBLIC = path.join(import.meta.dirname, 'public');
const CATEGORIES = new Set(['ingredient', 'finished-dish', 'dining-scene', 'other']);
const BATCH_TTL = 60 * 60 * 1000;

// 批次只活在内存里：服务重启即失效，照片不落库，符合“处理完即可丢弃”的定位。
const batches = new Map();

// 长跑服务必须回收，否则每批 3MB 原图会一直堆在内存和磁盘里。
setInterval(async () => {
  const now = Date.now();
  for (const [id, entry] of batches) {
    if (now - entry.createdAt < BATCH_TTL) continue;
    batches.delete(id);
    await fs.rm(entry.dir, { recursive: true, force: true }).catch(() => {});
  }
}, 10 * 60 * 1000).unref();

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value), { 'Content-Type': 'application/json; charset=utf-8' });
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('上传内容超过 60 MB，请减少照片数量');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('请求内容不是合法 JSON'); }
}

async function handleAnalyze(req, res) {
  const body = await readJson(req);
  const files = Array.isArray(body.files) ? body.files : [];
  if (!files.length) throw new Error('请至少选择 1 张照片');
  if (files.length > 30) throw new Error('每批最多 30 张 JPG/PNG');

  const batchId = randomUUID().slice(0, 8);
  const dir = path.join(TMP_ROOT, batchId);
  const inputDir = path.join(dir, 'input');
  await fs.mkdir(inputDir, { recursive: true });

  let written = 0;
  for (const [index, file] of files.entries()) {
    const matched = /^data:image\/(jpeg|png);base64,(.+)$/s.exec(file?.dataUrl ?? '');
    if (!matched) continue;
    const ext = matched[1] === 'png' ? 'png' : 'jpg';
    const name = `${String(index + 1).padStart(2, '0')}.${ext}`;
    await fs.writeFile(path.join(inputDir, name), Buffer.from(matched[2], 'base64'));
    written += 1;
  }
  if (!written) throw new Error('没有收到可用的 JPG/PNG 照片');

  const scan = await inspectAssets(inputDir);
  const thumbs = await Promise.all(scan.assets.map(asset => sharp(asset.sourcePath)
    .resize(320, 320, { fit: 'cover' })
    .jpeg({ quality: 70 })
    .toBuffer()
    .then(buffer => `data:image/jpeg;base64,${buffer.toString('base64')}`)));

  batches.set(batchId, { dir, inputDir, scan, createdAt: Date.now() });
  sendJson(res, 200, {
    batchId,
    count: scan.count,
    warnings: scan.warnings,
    assets: scan.assets.map((asset, index) => ({
      id: asset.id,
      name: path.basename(asset.sourcePath),
      width: asset.width,
      height: asset.height,
      duplicateOf: asset.duplicateOf,
      thumb: thumbs[index]
    }))
  });
}

async function handleBuild(req, res) {
  const body = await readJson(req);
  const entry = batches.get(body.batchId);
  if (!entry) throw new Error('批次不存在或服务已重启，请重新上传照片');

  const picks = Array.isArray(body.assets) ? body.assets : [];
  const missing = entry.scan.assets.filter(asset => !picks.some(pick => pick.id === asset.id));
  if (missing.length) throw new Error(`还有 ${missing.length} 张照片没有确认分类`);

  const stamp = Date.now();
  const contentFile = path.join(entry.dir, `content-${stamp}.json`);
  const content = await prepareContent(entry.scan, contentFile);

  for (const asset of content.assets) {
    const pick = picks.find(item => item.id === asset.id);
    asset.category = CATEGORIES.has(pick.category) ? pick.category : 'other';
    // 分类由页面上的人选定，才算 verified；程序不替用户签字。
    asset.categoryStatus = 'verified';
    const label = typeof pick.label === 'string' ? pick.label.trim() : '';
    asset.label = label || null;
    asset.labelStatus = label ? 'verified' : 'needs-confirmation';
    asset.identifiableChildren = body.noMinors === true ? 'no' : 'unknown';
    asset.publicUsePermission = body.publishRight === true ? 'verified' : 'unverified';
  }
  if (typeof body.brand !== 'string' || !body.brand.trim()) throw new Error('请先填写机构名称');
  content.brand.name = body.brand.trim();
  if (typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    content.record.date = body.date;
    content.record.dateVerified = true;
  }

  // 菜名是单行徽章，宽度由列数决定。这里挡住放不下的名字，
  // 否则渲染会整页失败，用户只会看到「检查未通过」。
  const tally = { ingredient: 0, 'finished-dish': 0, 'dining-scene': 0 };
  for (const asset of content.assets) tally[asset.category] = (tally[asset.category] ?? 0) + 1;
  const limits = limitsFor(tally);
  for (const [index, asset] of content.assets.entries()) {
    const limit = limits[asset.category];
    if (!asset.label || !limit) continue;
    if (!fitsLabel(asset.label, limit)) {
      throw new Error(`第 ${index + 1} 张的菜名「${asset.label}」太长，当前排版最多 ${limit} 个字，请改短一些`);
    }
  }

  await fs.writeFile(contentFile, `${JSON.stringify(content, null, 2)}\n`);

  const outputName = `out-${stamp}`;
  const output = path.join(entry.dir, outputName);
  const qa = await build({ input: entry.inputDir, contentFile, output });
  const posters = qa.pages
    .filter(page => page.status === 'generated')
    .flatMap(page => page.outputFiles.map(file => ({
      name: file.file,
      url: `/preview/${body.batchId}/${outputName}/${encodeURIComponent(file.file)}`
    })));
  const copy = await fs.readFile(qa.copyFile, 'utf8');

  // 一次打包含文案；store 模式，7 MB 的图不额外压缩。
  const zipName = '餐食海报.zip';
  const zipEntries = [];
  for (const poster of posters) {
    zipEntries.push({ name: poster.name, data: await fs.readFile(path.join(output, poster.name)) });
  }
  zipEntries.push({ name: path.basename(qa.copyFile), data: Buffer.from(copy, 'utf8') });
  await fs.writeFile(path.join(output, zipName), createZip(zipEntries));

  sendJson(res, 200, {
    passed: qa.passed,
    errors: qa.errors,
    warnings: qa.warnings,
    posters,
    copy,
    zip: { name: zipName, url: `/preview/${body.batchId}/${outputName}/${encodeURIComponent(zipName)}` },
    bundleDigest: qa.bundleDigest
  });
}

async function servePreview(res, pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'preview' || parts.length !== 4) return false;
  const [, batchId, outputName, rawName] = parts;
  const entry = batches.get(batchId);
  if (!entry) return false;
  const base = path.join(entry.dir, outputName);
  const file = path.join(base, decodeURIComponent(rawName));
  if (!file.startsWith(`${base}${path.sep}`)) return false;
  let data;
  try { data = await fs.readFile(file); } catch { return false; }
  const ext = path.extname(file).toLowerCase();
  const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.txt': 'text/plain; charset=utf-8', '.zip': 'application/zip' };
  const headers = { 'Content-Type': types[ext] ?? 'application/octet-stream' };
  if (ext === '.zip') {
    headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`;
  }
  send(res, 200, data, headers);
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return send(res, 200, await fs.readFile(path.join(PUBLIC, 'index.html')), { 'Content-Type': 'text/html; charset=utf-8' });
    }
    if (req.method === 'GET' && url.pathname === '/label-fit.mjs') {
      return send(res, 200, await fs.readFile(path.join(PUBLIC, 'label-fit.mjs')), { 'Content-Type': 'text/javascript; charset=utf-8' });
    }
    if (req.method === 'GET' && await servePreview(res, url.pathname)) return;
    if (req.method === 'POST' && url.pathname === '/api/analyze') return await handleAnalyze(req, res);
    if (req.method === 'POST' && url.pathname === '/api/build') return await handleBuild(req, res);
    sendJson(res, 404, { error: '没有这个地址' });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`meal-story-web 已启动：http://${HOST}:${PORT}`);
  console.log(HOST === '0.0.0.0'
    ? '已监听所有网卡：局域网或公网设备可访问，照片会经网络传输。'
    : '仅本机可访问。手机测试请设 HOST=0.0.0.0，再用电脑局域网 IP 打开。');
});
