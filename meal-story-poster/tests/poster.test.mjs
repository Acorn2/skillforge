import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectAssets, prepareContent, loadContent, json, writeJson, hash, skillRoot } from '../scripts/lib/io.mjs';
import { compileFacts, privacyDecision } from '../scripts/lib/facts.mjs';
import { generateCopy, writeCopy } from '../scripts/lib/copy.mjs';
import { build as buildMinimal, validateOutput, exportPublic } from '../scripts/lib/pipeline.mjs';
import { AS_OF, workspace, reviewed, fixture } from './helpers.mjs';

// Fact, layout and export regressions explicitly opt into the single review snapshot.
const build = options => buildMinimal({ ...options, keepState: true });
const compile = async f => compileFacts(f.content, f.contentFile, await inspectAssets(f.input), AS_OF);
const generated = facts => facts.pages.filter(p => ['planned', 'generated'].includes(p.status));

test('CLI auto-selects Skill outputs from another cwd and preserves previous batches', async () => {
  const f = await fixture(await workspace(), ['finished-dish']);
  const run = args => promisify(execFile)(process.execPath, [path.join(skillRoot, 'scripts/meal-story-poster.mjs'), ...args], { cwd: f.root });
  const prepared = JSON.parse((await run(['prepare', '--input', f.input])).stdout);
  assert.equal(path.dirname(path.dirname(prepared.file)), path.join(skillRoot, 'outputs'));
  const content = await json(prepared.file);
  Object.assign(content.assets[0], { category: 'finished-dish', categoryStatus: 'verified' });
  await writeJson(prepared.file, content);
  const args = ['build', '--input', f.input, '--content', prepared.file, '--as-of', AS_OF];
  const first = JSON.parse((await run(args)).stdout);
  assert.equal(first.passed, true);
  assert.equal(path.dirname(first.output), path.join(skillRoot, 'outputs'));
  const poster = path.join(first.output, '03_餐食海报.png');
  const originalHash = hash(await fs.readFile(poster));
  const second = JSON.parse((await run(args)).stdout);
  assert.equal(second.passed, true);
  assert.notEqual(first.output, second.output);
  assert.equal(hash(await fs.readFile(poster)), originalHash);
  assert.equal((await validateOutput(second.output)).passed, true);
  assert.deepEqual((await fs.readdir(second.output)).sort(), ['03_餐食海报.png', '发布文案.txt'].sort());
});

test('1/2/4/5/9 photos complete PNG, shared copy and QA pipeline', async t => {
  for (const count of [1, 2, 4, 5, 9]) await t.test(`${count} photos`, async () => {
    const categories = count === 9 ? [...Array(4).fill('ingredient'), ...Array(5).fill('finished-dish')] : Array(count).fill('finished-dish');
    const f = await fixture(await workspace(), categories);
    const before = await Promise.all(f.content.assets.map(a => fs.readFile(a.file).then(hash)));
    const output = path.join(f.root, 'batch');
    const qa = await build({ input: f.input, contentFile: f.contentFile, output, asOf: AS_OF });
    assert.equal(qa.passed, true, JSON.stringify(qa.errors));
    const manifest = (await json(path.join(output, '任务状态.json'))).manifest;
    assert.equal(generated(manifest).length, count === 9 ? 3 : 1);
    assert.equal(manifest.pages.find(p => p.template === 'dining-scene').status, 'skipped');
    const shown = new Set(generated(manifest).flatMap(p => p.assetIds));
    assert.equal(shown.size, count);
    const copies = qa.copy;
    assert.equal(Object.keys(copies.copy_outputs).length, 5);
    assert.equal(new Set(Object.values(copies.copy_outputs)).size, 5);
    assert.equal(copies.metadata.basedOnVerifiedFactsOnly, true);
    assert.equal(copies.metadata.reviewStatus, 'draft');
    assert.equal(manifest.publicReleaseApproved, false);
    const meta = await sharp(path.join(output, generated(manifest)[0].deliveryFile)).metadata();
    assert.equal(meta.width, 1080); assert.equal(meta.height, 1440); assert.equal(meta.format, 'png');
    if (count === 1) {
      const photo = generated(manifest)[0].photoBoxes[0];
      const center = await sharp(path.join(output, generated(manifest)[0].deliveryFile))
        .extract({ left: photo.x + Math.floor(photo.width / 2), top: photo.y + Math.floor(photo.height / 2), width: 1, height: 1 }).removeAlpha().raw().toBuffer();
      const originalCenter = await sharp(f.content.assets[0].file).extract({ left: 360, top: 270, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
      assert(center.every((channel, i) => Math.abs(channel - originalCenter[i]) <= 2), '中心照片像素应保留源图外观');
    }
    assert.deepEqual(await Promise.all(f.content.assets.map(a => fs.readFile(a.file).then(hash))), before);
    await assert.rejects(build({ input: f.input, contentFile: f.contentFile, output, asOf: AS_OF }), /输出目录/);
  });
});

test('custom institution is the largest heading on every A/B/C/D page and copy shares the brand', async () => {
  const f = await fixture(await workspace(), [...Array(4).fill('ingredient'), ...Array(5).fill('finished-dish'), 'dining-scene']);
  f.content.brand.name = '青禾托管中心';
  f.content.record = { date: AS_OF, dateVerified: true, scope: 'single-day' };
  f.content.diningScene = { enabled: true, assetIds: ['img-10'], publicUsePermission: 'verified' };
  await f.save();
  const output = path.join(f.root, 'batch');
  const qa = await build({ input: f.input, contentFile: f.contentFile, output, asOf: AS_OF });
  assert.equal(qa.passed, true, JSON.stringify(qa.errors));
  const manifestFile = path.join(output, '任务状态.json');
  const state = await json(manifestFile), manifest = state.manifest, pages = generated(manifest);
  assert.equal(pages.length, 4);
  for (const page of pages) {
    const brand = page.textBoxes.find(b => b.role === 'brand'), title = page.textBoxes.find(b => b.role === 'title');
    assert.equal(page.brand, '青禾托管中心'); assert.equal(brand.text, '青禾托管中心');
    assert(brand.y < title.y && brand.fontSize > title.fontSize);
    assert.doesNotMatch(page.subtitle, /新鲜|营养|孩子.*爱吃|采购/);
  }
  assert.equal(pages.find(p => p.template === 'meal-focus').title, '今日餐食出品');
  const dishPage = pages.find(p => p.template === 'meal-focus');
  const rows = new Map();
  for (const photo of dishPage.photoBoxes) rows.set(photo.y, (rows.get(photo.y) ?? 0) + 1);
  assert.deepEqual([...rows.values()], [3, 2]);
  const copy = qa.copy;
  assert.doesNotMatch(JSON.stringify(copy), /三人行托管中心/);
  assert.match(copy.copy_outputs.wechat_moments, /青禾托管中心/);
  // A changed brand in the render record must invalidate review of this batch.
  pages[0].brand = '错误机构';
  await writeJson(manifestFile, state);
  const changed = await validateOutput(output);
  assert.equal(changed.passed, false);
  assert(changed.errors.some(e => e.name.startsWith('page-heading-facts:')));
});

test('reference poster marketing phrases are removed from cards even when supplied as verified notes', async () => {
  const f = await fixture(await workspace(), ['ingredient']);
  const phrases = ['自然成熟', '新鲜现切', '营养搭配', '营养更均衡', '丰富膳食纤维', '暖胃暖心', '孩子更爱吃', '孩子更容易接受', '每日现做实拍'];
  const scan = await inspectAssets(f.input);
  for (const note of phrases) {
    Object.assign(f.content.assets[0], { note, noteStatus: 'verified' });
    const facts = await compileFacts(f.content, f.contentFile, scan, AS_OF);
    assert.equal(facts.assets[0].note, '', `不应从参考图采纳承诺：${note}`);
  }
  f.content.assets[0].note = phrases.join('、');
  await f.save();
  const output = path.join(f.root, 'batch');
  const qa = await build({ input: f.input, contentFile: f.contentFile, output, asOf: AS_OF });
  assert.equal(qa.passed, true);
  const page = generated((await json(path.join(output, '任务状态.json'))).manifest)[0];
  assert.equal(page.cards[0].note, '');
  assert(page.textBoxes.every(b => b.role !== 'asset-note'));
  assert.doesNotMatch(page.title, /今日|新鲜/);
});

test('T03/T04/T07: neutral soup, no inferred links, no invented date or branch', async () => {
  const f = await fixture(await workspace(), ['ingredient', 'finished-dish', 'finished-dish']);
  Object.assign(f.content.assets[0], { label: '红薯条', labelStatus: 'verified' });
  Object.assign(f.content.assets[1], { label: '土豆丝', labelStatus: 'verified' });
  Object.assign(f.content.assets[2], { label: '汤品', labelStatus: 'needs-confirmation' });
  f.content.record = { date: '2026-10-16', dateVerified: false, scope: 'single-day' };
  f.content.brand.locationName = '未核实分店';
  const facts = await compile(f), copy = generateCopy(facts);
  assert.deepEqual(facts.confirmedLinks, []);
  assert.equal(facts.assets[2].label, '汤品');
  assert.equal(facts.locationName, null); assert.equal(facts.date, null);
  assert.doesNotMatch(JSON.stringify(copy), /今日|2026-10-16|未核实分店|南瓜|鸡汤|变成|做成/);
});

test('T06: duplicate bytes are reported and cannot fill a layout', async () => {
  const f = await fixture(await workspace(), ['finished-dish', 'finished-dish']);
  await fs.copyFile(f.content.assets[0].file, f.content.assets[1].file);
  const facts = await compile(f);
  assert.equal(facts.assets.length, 1); assert.equal(generated(facts)[0].assetIds.length, 1);
  assert(facts.warnings.some(w => w.code === 'duplicate-excluded'));
});

test('T08 and explicit template selection never create empty ingredient/overview pages', async () => {
  const f = await fixture(await workspace(), ['finished-dish', 'finished-dish']);
  assert.deepEqual(generated(await compile(f)).map(p => p.template), ['meal-focus']);
  f.content.output.templates = ['meal-overview'];
  assert.equal(generated(await compile(f)).length, 0);
  const onlyRaw = await fixture(await workspace(), ['ingredient']);
  assert.deepEqual(generated(await compile(onlyRaw)).map(p => p.template), ['ingredient-focus']);
});

test('T09/T18/T19: unsupported claims removed, no invented happy diners or supervision', async () => {
  const f = await fixture(await workspace(), ['finished-dish']);
  Object.assign(f.content.assets[0], { label: '增强免疫', labelStatus: 'verified', note: '当天采购，孩子都爱吃', noteStatus: 'verified' });
  f.content.copy = { requestedClaims: ['今日最新鲜，老师正在陪餐'], allowUnverifiedClaims: true, enableNutritionClaims: true };
  const facts = await compile(f), copy = generateCopy(facts);
  assert.equal(facts.assets[0].label, '餐食实拍'); assert.equal(facts.assets[0].note, '');
  assert.doesNotMatch(JSON.stringify(copy), /增强免疫|采购|最新鲜|都爱吃|开心|照看|陪餐|营养均衡/);
  assert(facts.warnings.some(w => w.code === 'unsupported-claim-removed'));
});

test('T11: extreme aspect ratios preserve aspect; EXIF orientation and JPG derivative supported', async () => {
  const f = await fixture(await workspace(), ['finished-dish', 'finished-dish'], { sizes: [[1800, 300], [300, 1800]] });
  const original = await fs.readFile(f.content.assets[0].file);
  const jpg = path.join(f.input, 'oriented.jpg');
  await sharp(original).jpeg().withMetadata({ orientation: 6 }).toFile(jpg);
  f.content.assets[0].file = jpg;
  f.content.output.format = 'jpg';
  f.content.output.fit = 'contain';
  await f.save();
  const output = path.join(f.root, 'batch');
  const qa = await build({ input: f.input, contentFile: f.contentFile, output, asOf: AS_OF });
  assert.equal(qa.passed, true, JSON.stringify(qa.errors));
  const page = generated((await json(path.join(output, '任务状态.json'))).manifest)[0];
  assert(page.photoBoxes.every(p => p.fit === 'contain'));
  assert(page.outputFiles.some(f => f.format === 'jpg'));
  const scan = await inspectAssets(f.input);
  const oriented = scan.assets.find(a => a.sourcePath === jpg);
  assert.equal(oriented.orientedWidth, 300); assert.equal(oriented.orientedHeight, 1800);
});

test('T12/T15/T16: global permission and back view do not bypass per-person review', async () => {
  const f = await fixture(await workspace(), ['finished-dish', 'dining-scene']);
  f.content.diningScene = { enabled: true, assetIds: ['img-2'], publicUsePermission: 'verified' };
  Object.assign(f.content.assets[1], reviewed({ children: true }));
  f.content.assets[1].privacyReview.subjects[0].permission = 'unverified';
  let facts = await compile(f);
  assert.equal(facts.pages.find(p => p.template === 'dining-scene').status, 'skipped');
  assert.equal(generated(facts).length, 1);
  f.content.assets[1].identifiableChildren = 'no';
  f.content.assets[1].privacyReview.identifiablePeople = 'unknown';
  facts = await compile(f);
  assert.equal(facts.pages.find(p => p.template === 'dining-scene').status, 'skipped');
  Object.assign(f.content.assets[0], { identifiableChildren: 'yes', publicUsePermission: 'unverified' });
  assert.equal(generated(await compile(f)).length, 0);
});

test('T13/T20: safe D can render and refused D never copies children into public export', async () => {
  const f = await fixture(await workspace(), ['ingredient', 'ingredient', 'finished-dish', 'finished-dish', 'dining-scene']);
  f.content.diningScene = { enabled: true, assetIds: ['img-5'], publicUsePermission: 'verified' };
  await f.save();
  const output = path.join(f.root, 'batch');
  const qa = await build({ input: f.input, contentFile: f.contentFile, output, asOf: AS_OF });
  assert.equal(qa.passed, true, JSON.stringify(qa.errors));
  assert.equal(generated((await json(path.join(output, '任务状态.json'))).manifest).length, 4);
  Object.assign(f.content.assets[4], reviewed({ children: true }));
  f.content.assets[4].privacyReview.subjects[0].guardianPermissionVerified = false;
  await f.save();
  const rejectedOutput = path.join(f.root, 'rejected-scene-batch');
  const rejectedQa = await build({ input: f.input, contentFile: f.contentFile, output: rejectedOutput, asOf: AS_OF });
  assert.equal(rejectedQa.passed, true);
  assert.equal(generated((await json(path.join(rejectedOutput, '任务状态.json'))).manifest).length, 3);
  const approvalFile = path.join(f.root, 'test-only-approval.json');
  await writeJson(approvalFile, { contentApproved: true, publicReleaseApproved: true, approvedBy: 'TEST-ONLY', approvedAt: '2026-10-16T00:00:00Z', reviewedDigest: rejectedQa.bundleDigest,
    channels: ['wechat_moments', 'parent_group', 'xiaohongshu', 'video_title', 'video_caption'], purpose: 'meal-story-publicity' });
  const destination = path.join(f.root, 'public');
  await exportPublic({ output: rejectedOutput, approvalFile, destination, asOf: AS_OF });
  const filenames = await fs.readdir(destination);
  assert(!filenames.some(f => /dining|content|review|asset-manifest|privacy|05\.png/.test(f)));
  assert.equal(filenames.length, 5); // 3 posters + 1 copy document + redacted publication manifest
  const publicManifest = await json(path.join(destination, 'publication-manifest.json'));
  assert.doesNotMatch(JSON.stringify(publicManifest), /TEST-SUBJECT|guardian|sourcePath|TEST-REVIEWER/);
});

test('D permission requires valid scope, date, count and no sensitive identifiers', () => {
  const a = reviewed({ children: true, channels: ['wechat_moments'] });
  assert.equal(privacyDecision(a, ['wechat_moments'], AS_OF).safe, true);
  assert.equal(privacyDecision(a, ['xiaohongshu'], AS_OF).safe, false);
  a.privacyReview.subjects[0].validUntil = '2026-10-15';
  assert.equal(privacyDecision(a, ['wechat_moments'], AS_OF).safe, false);
  a.privacyReview.subjects[0].validUntil = '2027-02-30';
  assert.equal(privacyDecision(a, ['wechat_moments'], AS_OF).safe, false);
  a.privacyReview.subjects[0].validUntil = '2027-01-01';
  a.privacyReview.subjectCount = 2;
  assert.equal(privacyDecision(a, ['wechat_moments'], AS_OF).safe, false);
  a.privacyReview.subjectCount = 1; a.privacyReview.sensitiveInfo = 'yes';
  assert.equal(privacyDecision(a, ['wechat_moments'], AS_OF).safe, false);
});

test('D-only batch copy describes environment without inventing any dish', async () => {
  const f = await fixture(await workspace(), ['dining-scene']);
  f.content.diningScene = { enabled: true, assetIds: ['img-1'], publicUsePermission: 'verified' };
  const facts = await compile(f);
  assert.deepEqual(generated(facts).map(p => p.template), ['dining-scene']);
  assert.doesNotMatch(JSON.stringify(generateCopy(facts)), /某一道菜|备料照片|餐食照片|炒蛋|汤品|开心|陪餐/);
});

test('T21: selected platforms only, exact copy verification detects tampering', async () => {
  const f = await fixture(await workspace(), ['finished-dish']);
  f.content.copy = { targets: ['wechat_moments', 'parent_group'] };
  await f.save();
  const output = path.join(f.root, 'batch');
  assert.equal((await build({ input: f.input, contentFile: f.contentFile, output, asOf: AS_OF })).passed, true);
  const files = await fs.readdir(output);
  assert.deepEqual(files.filter(f => f.endsWith('.txt')), ['发布文案.txt']);
  const copyDocument = await fs.readFile(path.join(output, '发布文案.txt'), 'utf8');
  assert.match(copyDocument, /【朋友圈】/); assert.match(copyDocument, /【家长群】/);
  assert.doesNotMatch(copyDocument, /【小红书】/);
  await fs.appendFile(path.join(output, '发布文案.txt'), '全员光盘');
  const qa = await validateOutput(output);
  assert.equal(qa.passed, false);
  assert(qa.errors.some(e => e.name === 'copy-document-matches-facts'));
  await fs.appendFile(path.join(output, '03_餐食海报.png'), 'changed');
  assert((await validateOutput(output)).errors.some(e => e.name.startsWith('output-hash:')));
});

test('six cards render readably, larger batches paginate without hiding sources', async () => {
  const f = await fixture(await workspace(), Array(6).fill('finished-dish'));
  f.content.approval = { contentApproved: true, publicReleaseApproved: true, approvedBy: 'TEST-ONLY' };
  await f.save();
  const output = path.join(f.root, 'batch');
  const qa = await build({ input: f.input, contentFile: f.contentFile, output, asOf: AS_OF });
  assert.equal(qa.passed, true, JSON.stringify(qa.errors));
  const manifest = (await json(path.join(output, '任务状态.json'))).manifest;
  assert.equal(generated(manifest)[0].assetIds.length, 6);
  assert.equal(manifest.publicReleaseApproved, false, '输入批准字段不能让 build 自动公开');
  const more = await fixture(await workspace(), Array(8).fill('ingredient'));
  const facts = await compile(more);
  assert.deepEqual(generated(facts).map(p => p.assetIds.length), [6, 2]);
  assert.equal(facts.selectedIds.length, 8);
});

test('T05: long verified name rejects affected image instead of overlapping', async () => {
  const f = await fixture(await workspace(), ['finished-dish']);
  f.content.assets[0].label = '超长菜名'.repeat(25);
  await f.save();
  const output = path.join(f.root, 'batch');
  const qa = await build({ input: f.input, contentFile: f.contentFile, output, asOf: AS_OF });
  assert.equal(qa.passed, false);
  const page = ((await json(path.join(output, '任务状态.json'))).manifest).pages.find(p => p.template === 'meal-focus');
  assert.equal(page.status, 'failed'); assert.match(page.reason, /文字过长/);
});

test('AI suggestions cannot confirm facts or permissions; invalid schema and hashes fail', async () => {
  const f = await fixture(await workspace(), ['finished-dish']);
  const scan = await inspectAssets(f.input), analysis = path.join(f.root, 'analysis.json'), draft = path.join(f.root, 'draft.json');
  await writeJson(analysis, { assets: [{ assetId: scan.assets[0].id, suggestedCategory: 'finished-dish', suggestedName: '猪肉', labelStatus: 'verified', publicUsePermission: 'verified' }] });
  const content = await prepareContent(scan, draft, analysis);
  assert.equal(content.assets[0].labelStatus, 'needs-confirmation');
  assert.equal(content.assets[0].publicUsePermission, 'unverified');
  assert.equal(content.approval.publicReleaseApproved, false);
  assert.equal((await loadContent(draft)).schemaVersion, '1.1');
  const facts = await compileFacts(content, draft, scan, AS_OF);
  assert.equal(generated(facts).length, 0);
  assert.doesNotMatch(JSON.stringify(generateCopy(facts)), /猪肉/);
  await assert.rejects(prepareContent(scan, draft, analysis), /EEXIST/);
  f.content.assets[0].sha256 = '0'.repeat(64);
  await assert.rejects(compile(f), /哈希/);
  f.content.output.width = 100;
  await f.save();
  await assert.rejects(loadContent(f.contentFile), /Schema/);
});

test('mixed dates and branches downgrade shared facts; verified single day may use 今日', async () => {
  const f = await fixture(await workspace(), ['ingredient', 'finished-dish']);
  f.content.record = { date: AS_OF, dateVerified: true, scope: 'single-day' };
  f.content.brand = { name: '测试机构', locationName: '东门点', locationVerified: true, siteId: 'east' };
  f.content.assets.forEach(a => { a.siteId = 'east'; a.capturedAt = AS_OF; });
  let facts = await compile(f);
  assert.equal(facts.recordLabel, '今日餐食记录'); assert.equal(facts.locationName, '东门点');
  f.content.assets[1].siteId = 'west'; f.content.assets[1].capturedAt = '2026-10-15';
  facts = await compile(f);
  assert.equal(facts.recordLabel, '近期餐食记录'); assert.equal(facts.date, null); assert.equal(facts.locationName, null);
  assert.doesNotMatch(JSON.stringify(generateCopy(facts)), /今日|东门点/);
});

test('invalid files, remote paths, file escape and unsafe crop fail safely', async () => {
  const f = await fixture(await workspace(), ['finished-dish']);
  await fs.writeFile(path.join(f.input, 'bad.jpg'), 'not an image');
  const scan = await inspectAssets(f.input);
  assert.equal(scan.count, 1); assert(scan.warnings.some(w => w.code === 'invalid-image'));
  f.content.assets[0].fit = 'cover';
  f.content.assets[0].cropReviewed = false;
  const cropped = await compile(f);
  assert.equal(cropped.assets[0].fit, 'cover');
  assert(cropped.warnings.some(w => w.code === 'crop-review-required'));
  f.content.assets[0].file = 'https://example.com/meal.jpg';
  await assert.rejects(compile(f), /本地/);
  const external = path.join(f.root, 'external.png');
  await fs.copyFile(scan.assets[0].sourcePath, external);
  f.content.assets[0].file = external;
  await assert.rejects(compile(f), /输入文件夹/);
});

test('export needs exact human approval digest and current source bytes', async () => {
  const f = await fixture(await workspace(), ['finished-dish']);
  const output = path.join(f.root, 'batch'), approvalFile = path.join(f.root, 'approval.json');
  const qa = await build({ input: f.input, contentFile: f.contentFile, output, asOf: AS_OF });
  await writeJson(approvalFile, { contentApproved: true, publicReleaseApproved: true, approvedBy: 'TEST-ONLY', approvedAt: '2026-10-16T00:00:00Z', reviewedDigest: 'wrong',
    channels: ['wechat_moments', 'parent_group', 'xiaohongshu', 'video_title', 'video_caption'], purpose: 'meal-story-publicity' });
  await assert.rejects(exportPublic({ output, approvalFile, destination: path.join(f.root, 'public'), asOf: AS_OF }), /人工批准/);
  await fs.appendFile(f.content.assets[0].file, 'changed');
  await assert.rejects(validateOutput(output), /哈希/);
  assert.equal(qa.passed, true);
});

test('reference composition fills food frames, uses fixed rows and keeps the ninth photo on C', async () => {
  const f = await fixture(await workspace(), [...Array(4).fill('ingredient'), ...Array(5).fill('finished-dish')], { sizes: Array(9).fill([480, 640]) });
  await f.save();
  const output = path.join(f.root, 'reference-batch');
  assert.equal((await build({ input: f.input, contentFile: f.contentFile, output, asOf: AS_OF })).passed, true);
  const pages = generated((await json(path.join(output, '任务状态.json'))).manifest);
  const rowCounts = page => [...page.photoBoxes.reduce((m, b) => m.set(b.y, (m.get(b.y) ?? 0) + 1), new Map()).values()];
  assert.deepEqual(rowCounts(pages[0]), [4, 4]);
  assert.deepEqual(rowCounts(pages[1]), [4]);
  assert.deepEqual(rowCounts(pages[2]), [3, 2]);
  assert.deepEqual(pages[0].deferredAssetIds, ['img-9']);
  assert(pages[2].assetIds.includes('img-9'));
  for (const page of pages) {
    assert.equal(page.visualStyle, 'botanical-reference-v2');
    assert(page.photoBoxes.every(p => p.fit === 'cover' && p.frameFillRatio === 1));
    assert(page.photoBoxes.every(p => p.retainedSourceRatio > 0 && p.retainedSourceRatio <= 1));
    assert(page.cards.every(c => c.captionLines.length > 0));
  }
  f.content.output.templates = ['meal-overview'];
  await f.save();
  const onlyA = path.join(f.root, 'only-overview');
  assert.equal((await build({ input: f.input, contentFile: f.contentFile, output: onlyA, asOf: AS_OF })).passed, true);
  assert.equal(generated((await json(path.join(onlyA, '任务状态.json'))).manifest)[0].assetIds.length, 9);
});

test('cover may render privately but cannot export without a crop review, even with verified privacy', async () => {
  const f = await fixture(await workspace(), ['finished-dish']);
  f.content.assets[0].cropReviewed = false;
  await f.save();
  const output = path.join(f.root, 'crop-unreviewed');
  const qa = await build({ input: f.input, contentFile: f.contentFile, output, asOf: AS_OF });
  assert.equal(qa.passed, true); assert.equal(qa.publicReleaseEligible, false);
  const approvalFile = path.join(f.root, 'approval.json');
  await writeJson(approvalFile, { contentApproved: true, publicReleaseApproved: true, approvedBy: 'TEST-ONLY', approvedAt: '2026-10-16T00:00:00Z', reviewedDigest: qa.bundleDigest,
    channels: ['wechat_moments', 'parent_group', 'xiaohongshu', 'video_title', 'video_caption'], purpose: 'meal-story-publicity' });
  await assert.rejects(exportPublic({ output, approvalFile, destination: path.join(f.root, 'public'), asOf: AS_OF }), /公开资格/);
});

test('bundled brush font renders distinct glyphs instead of silently falling back on macOS', async () => {
  const { resolveFont } = await import('../scripts/lib/render.mjs');
  const font = await resolveFont({}, skillRoot);
  const ink = (family, file) => sharp({ text: { text: '三人行托管中心', font: `${family} 100`, fontfile: file, rgba: true } }).png().toBuffer();
  assert.notEqual(hash(await ink(font.family, font.file)), hash(await ink(font.displayFamily, font.displayFile)));
  assert.equal(process.env.PANGOCAIRO_BACKEND, 'fc');
  const dot = await sharp({ text: { text: '·', font: `${font.displayFamily} 100`, fontfile: font.displayFile, rgba: true } }).png().toBuffer({ resolveWithObject: true });
  assert(dot.info.width < 50, '缺失字形会显示 Unicode 方框，不能冒充有效标点');
});

test('default delivery keeps exactly four files, with no hidden records or validation artifacts', async () => {
  const f = await fixture(await workspace(), [...Array(4).fill('ingredient'), ...Array(5).fill('finished-dish')]);
  const output = path.join(f.root, 'minimal-delivery');
  const qa = await buildMinimal({ input: f.input, contentFile: f.contentFile, output, asOf: AS_OF });
  assert.equal(qa.passed, true); assert.equal(qa.verification, 'full');
  const files = (await fs.readdir(output)).sort();
  assert.deepEqual(files, ['01_综合海报.png', '02_备料海报.png', '03_餐食海报.png', '发布文案.txt'].sort());
  assert.equal(qa.stateFile, undefined); assert.equal(qa.entryFile, undefined);
  assert.equal(qa.fileHashes['发布文案.txt'], hash(await fs.readFile(qa.copyFile)));
  const later = await validateOutput(output);
  assert.equal(later.passed, true); assert.equal(later.verification, 'files-only');
  assert.equal(later.publicReleaseEligible, false);
  assert.deepEqual((await fs.readdir(output)).sort(), files);
  await assert.rejects(exportPublic({ output, approvalFile: 'not-used.json', destination: path.join(f.root, 'public') }), /keep-state/);
});

test('optional task state is one file, enables full revalidation and never expands back into reports', async () => {
  const f = await fixture(await workspace(), ['finished-dish']);
  const output = path.join(f.root, 'state-delivery');
  const qa = await build({ input: f.input, contentFile: f.contentFile, output, asOf: AS_OF });
  assert.equal(qa.passed, true);
  assert.deepEqual((await fs.readdir(output)).sort(), ['03_餐食海报.png', '发布文案.txt', '任务状态.json'].sort());
  const later = await validateOutput(output);
  assert.equal(later.verification, 'full'); assert.equal(later.passed, true);
  assert.equal(later.bundleDigest, qa.bundleDigest);
  assert.deepEqual((await fs.readdir(output)).sort(), ['03_餐食海报.png', '发布文案.txt', '任务状态.json'].sort());
  await fs.writeFile(path.join(output, '发布文案.txt'), '篡改文案');
  assert.equal((await validateOutput(output)).passed, false);
});

test('delivery HTML escapes user text and pagination produces distinct readable filenames', async () => {
  const { deliveryHtml, deliveryName } = await import('../scripts/lib/delivery.mjs');
  const brand = '<script>alert("x")</script>';
  const html = deliveryHtml({ brand, date: null }, [], { copy_outputs: { parent_group: '</textarea><img src=x onerror=alert(1)>' } });
  assert(html.includes('&lt;script&gt;'));
  assert(!html.includes(brand)); assert(!html.includes('<img src=x'));
  assert.equal(deliveryName({ template: 'ingredient-focus', file: '02_fresh_ingredients_02.png' }), '02_备料海报_02.png');
});

test('legacy private batches remain verifiable with their original copy files and filenames', async () => {
  const f = await fixture(await workspace(), ['finished-dish']);
  const output = path.join(f.root, 'legacy-batch');
  await build({ input: f.input, contentFile: f.contentFile, output, asOf: AS_OF });
  const stateFile = path.join(output, '任务状态.json'), state = await json(stateFile);
  await fs.rename(stateFile, path.join(f.root, 'test-state-backup.json'));
  const oldDir = path.join(output, 'private'); await fs.mkdir(oldDir);
  const manifest = state.manifest;
  delete manifest.outputLayout;
  for (const page of generated(manifest)) {
    for (const item of page.outputFiles) {
      await fs.rename(path.join(output, item.file), path.join(oldDir, page.file)); item.file = page.file;
    }
    delete page.deliveryFile;
  }
  await writeJson(path.join(oldDir, 'content.json'), state.content);
  await writeJson(path.join(oldDir, 'render-manifest.json'), manifest);
  const facts = await compile(f);
  await writeJson(path.join(oldDir, 'asset-manifest.json'), { inputRoot: f.input, assets: facts.assets.map(a => ({ id: a.id, sha256: a.sha256 })) });
  await writeJson(path.join(oldDir, 'review.json'), {}); await writeJson(path.join(oldDir, 'warnings.json'), []);
  await writeCopy(oldDir, generateCopy(facts));
  const qa = await validateOutput(output);
  assert.equal(qa.passed, true, JSON.stringify(qa.errors));
  assert(qa.checks.some(c => c.name === 'copy-markdown-matches-facts'));
});


test('minimal file inspection rejects corrupt posters and does not mistake a file check for fact approval', async () => {
  const f = await fixture(await workspace(), ['finished-dish']);
  const output = path.join(f.root, 'broken-files');
  await buildMinimal({ input: f.input, contentFile: f.contentFile, output, asOf: AS_OF });
  // Finder metadata is not a generated review file and must not break a batch.
  await fs.writeFile(path.join(output, '.DS_Store'), 'TEST-ONLY');
  assert.equal((await validateOutput(output)).passed, true);
  await fs.writeFile(path.join(output, '03_餐食海报.png'), 'not an image');
  const qa = await validateOutput(output);
  assert.equal(qa.passed, false); assert.equal(qa.verification, 'files-only');
  assert.equal(qa.publicReleaseEligible, false);
  assert(qa.errors.some(e => e.name.startsWith('file-readable:')));
});
