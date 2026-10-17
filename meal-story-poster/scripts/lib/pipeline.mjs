import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { inspectAssets, loadContent, validateContent, json, writeJson, hash, inside, freshDirectory, validTimestamp, today, defaultOutputDirectory } from './io.mjs';
import { compileFacts, privacyDecision } from './facts.mjs';
import { generateCopy, copyMarkdown } from './copy.mjs';
import { resolveFont, renderPage } from './render.mjs';
import { pagePresentation, cardPresentation } from './presentation.mjs';
import { ENTRY_FILE, COPY_FILE, INTERNAL_DIR, STATE_FILE, deliveryName, deliveryHtml, copyText, writeDelivery } from './delivery.mjs';

const overlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const deliveryFiles = async dir => (await fs.readdir(dir)).filter(name => !['.DS_Store', 'Thumbs.db'].includes(name));

export async function build({ input, contentFile, output = defaultOutputDirectory(), asOf = today(), keepState = false }) {
  const scan = await inspectAssets(input), content = await loadContent(contentFile);
  const outputPath = path.resolve(output);
  // Check the real parent so symlinked output parents cannot route files into source folders.
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const resolvedOutput = path.join(await fs.realpath(path.dirname(outputPath)), path.basename(outputPath));
  if (inside(scan.inputRoot, resolvedOutput) || inside(resolvedOutput, scan.inputRoot)) throw new Error('输入与输出目录必须分离且不能互相包含');
  const facts = await compileFacts(content, contentFile, scan, asOf);
  const font = facts.pages.some(p => p.status === 'planned') ? await resolveFont(facts.output, path.dirname(path.resolve(contentFile))) : null;
  await freshDirectory(resolvedOutput);
  const dir = resolvedOutput;
  // Build keeps review data in memory; only --keep-state persists one snapshot.
  const snapshot = structuredClone(content);
  snapshot.assets = await Promise.all(content.assets.map(async a => {
    const file = await fs.realpath(path.resolve(path.dirname(path.resolve(contentFile)), a.file));
    return { ...a, file, sha256: scan.assets.find(s => s.sourcePath === file)?.sha256 ?? a.sha256 };
  }));
  if (snapshot.output?.fontFile) snapshot.output.fontFile = path.resolve(path.dirname(path.resolve(contentFile)), snapshot.output.fontFile);
  const pages = [];
  for (const page of facts.pages) {
    if (page.status !== 'planned') { pages.push(page); continue; }
    try {
      const rendered = await renderPage(facts, page, resolvedOutput, font, deliveryName(page));
      pages.push(rendered);
      if (rendered.photoBoxes.some(b => b.frameFillRatio < .9)) facts.warnings.push({ code: 'photo-frame-padding', file: rendered.file, action: '完整显示模式存在留白；逐张核对是否符合预期' });
    } catch (error) {
      pages.push({ ...page, status: 'failed', reason: error.message });
      facts.warnings.push({ code: 'render-failed', file: page.file, reason: error.message });
    }
  }
  const copy = generateCopy(facts);
  await writeDelivery(resolvedOutput, copy);
  const assetManifest = {
    schemaVersion: '1.1', inputRoot: scan.inputRoot,
    assets: facts.assets.map(a => ({
      id: a.id, sourcePath: a.sourcePath, sha256: a.sha256, format: a.format,
      width: a.width, height: a.height, orientedWidth: a.orientedWidth, orientedHeight: a.orientedHeight,
      category: a.category, label: a.label, labelVerified: a.labelVerified,
      publicUse: a.privacy, usedIn: pages.filter(p => p.status === 'generated' && p.assetIds.includes(a.id)).map(p => p.file)
    }))
  };
  const manifest = {
    schemaVersion: '1.1', outputLayout: 'minimal-v1', asOf, pages, copyTargetsGenerated: facts.targets,
    font, publicReleaseApproved: false, reviewStatus: 'draft'
  };
  if (keepState) await writeJson(path.join(dir, STATE_FILE), {
    schemaVersion: '1.1', outputLayout: 'minimal-v1', inputRoot: scan.inputRoot, content: snapshot, manifest
  });
  const context = { root: resolvedOutput, dir, content: snapshot, manifest, assets: assetManifest, facts, simple: true, compact: true, keepState };
  const qa = await validateBatch(context);
  return { ...qa, outputDirectory: resolvedOutput, copyFile: path.join(resolvedOutput, COPY_FILE),
    ...(keepState ? { stateFile: path.join(resolvedOutput, STATE_FILE) } : {}),
    pages, copy, warnings: [...facts.warnings, ...qa.warnings] };
}

async function exists(file) {
  try { await fs.lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function readPrivate(output) {
  const root = path.resolve(output);
  if (await exists(path.join(root, STATE_FILE))) {
    const stateFile = await safeOutputFile(root, STATE_FILE), state = await json(stateFile);
    if (state.outputLayout !== 'minimal-v1' || state.manifest?.outputLayout !== 'minimal-v1') throw new Error('无法识别任务状态格式');
    const content = await validateContent(state.content), scan = await inspectAssets(state.inputRoot);
    const facts = await compileFacts(content, stateFile, scan, state.manifest.asOf);
    return { root, dir: root, content, manifest: state.manifest, facts, assets: { inputRoot: scan.inputRoot,
      assets: facts.assets.map(a => ({ id: a.id, sha256: content.assets.find(s => s.id === a.id)?.sha256 })) }, simple: true, compact: true, keepState: true };
  }
  if (!await exists(path.join(root, INTERNAL_DIR)) && !await exists(path.join(root, 'private'))) {
    throw new Error('精简批次未保留任务状态；如需事后事实复核或公开导出，请生成时添加 --keep-state');
  }
  let internal = INTERNAL_DIR;
  try { await fs.lstat(path.join(root, internal)); } catch (error) { if (error.code !== 'ENOENT') throw error; internal = 'private'; }
  const dir = await fs.realpath(path.join(root, internal));
  if (!inside(path.resolve(output), dir)) throw new Error('private 目录不能是指向外部的符号链接');
  const contentFile = path.join(dir, 'content.json');
  const content = await loadContent(contentFile);
  const manifest = await json(path.join(dir, 'render-manifest.json'));
  const assets = await json(path.join(dir, 'asset-manifest.json'));
  const scan = await inspectAssets(assets.inputRoot);
  const facts = await compileFacts(content, contentFile, scan, manifest.asOf);
  if (internal === INTERNAL_DIR && manifest.outputLayout !== 'simple-v1') throw new Error('无法识别结果目录布局');
  return { dir, content, manifest, assets, facts, simple: internal === INTERNAL_DIR, root };
}

async function safeOutputFile(dir, file) {
  if (typeof file !== 'string' || path.basename(file) !== file || file.startsWith('.')) throw new Error('输出文件名必须是目录内普通文件');
  const resolved = await fs.realpath(path.join(dir, file));
  if (!inside(dir, resolved) || (await fs.lstat(path.join(dir, file))).isSymbolicLink()) throw new Error('输出文件不能是符号链接');
  return resolved;
}

export async function validateOutput(output) {
  const root = path.resolve(output);
  if (!await exists(path.join(root, STATE_FILE)) && !await exists(path.join(root, INTERNAL_DIR)) && !await exists(path.join(root, 'private'))) return validateFilesOnly(root);
  return validateBatch(await readPrivate(output));
}

async function validateBatch(context) {
  const { dir, manifest, assets, facts, simple, root, compact = false, keepState = false } = context;
  const artifactDir = simple ? root : dir;
  const errors = [], checks = [], warnings = [];
  const check = (name, passed, details = null) => { checks.push({ name, passed, ...(details ? { details } : {}) }); if (!passed) errors.push({ name, details }); };
  const generated = manifest.pages.filter(p => p.status === 'generated');
  check('at-least-one-poster', generated.length > 0);
  check('no-failed-pages', manifest.pages.every(p => ['generated', 'skipped'].includes(p.status)));
  check('page-plan-matches-facts', same(manifest.pages.map(p => [p.template, p.assetIds, p.file ?? null]), facts.pages.map(p => [p.template, p.assetIds, p.file ?? null])));
  check('draft-status', manifest.publicReleaseApproved === false && manifest.reviewStatus === 'draft');
  for (const asset of assets.assets) {
    const actual = facts.assets.find(a => a.id === asset.id);
    let unchanged = false;
    try { unchanged = Boolean(actual) && actual.sha256 === asset.sha256 && hash(await fs.readFile(actual.sourcePath)) === asset.sha256; } catch { /* Missing or changed source is a failed check. */ }
    check(`source-hash:${asset.id}`, unchanged);
  }
  check('asset-manifest-complete', same(assets.assets.map(a => a.id), facts.assets.map(a => a.id)));
  for (const page of generated) {
    try {
      const planned = facts.pages.find(p => p.file === page.file);
      const expectedPresentation = pagePresentation(facts, page.template);
      const brandBox = page.textBoxes.find(b => b.role === 'brand');
      const titleBox = page.textBoxes.find(b => b.role === 'title');
      check(`page-heading-facts:${page.file}`, same([page.brand, page.title, page.subtitle, page.footer],
        [expectedPresentation.brand, expectedPresentation.title, expectedPresentation.subtitle, expectedPresentation.footer]));
      check(`brand-prominence:${page.file}`, Boolean(brandBox && titleBox && brandBox.text === facts.brand && brandBox.y < titleBox.y
        && brandBox.fontSize > titleBox.fontSize && brandBox.y < 120));
      check(`unique-photos:${page.file}`, new Set(page.assetIds.map(id => facts.assets.find(a => a.id === id)?.sha256)).size === page.assetIds.length);
      const actualAssets = page.assetIds.map(id => facts.assets.find(a => a.id === id));
      check(`card-facts:${page.file}`, same(page.cards.map(c => [c.assetId, c.label]), actualAssets.map(a => [a.id, a.label])));
      check(`card-captions:${page.file}`, same(page.cards.map(c => [c.note, c.captionLines, c.icon]), actualAssets.map(a => [a.note, cardPresentation(a).captionLines, cardPresentation(a).icon])));
      check(`privacy-eligibility:${page.file}`, page.publicReleaseEligible === actualAssets.every(a => a.privacy.safe && a.categoryStatus === 'verified' && (a.fit !== 'cover' || a.cropReviewed === true)));
      if (page.template === 'dining-scene') check(`scene-permissions:${page.file}`, actualAssets.every(a => a.privacy.safe) && planned.status === 'planned');
      check(`source-layout:${page.file}`, same(page.photoBoxes.map(b => [b.assetId, b.sha256, b.fit]), actualAssets.map(a => [a.id, a.sha256, a.fit])));
      check(`layout-bounds:${page.file}`, [...page.textBoxes, ...page.photoBoxes].every(b => b.x >= 0 && b.y >= 0 && b.width > 0 && b.height > 0 && b.x + b.width <= 1080 && b.y + b.height <= 1440));
      check(`text-measured:${page.file}`, page.textBoxes.every(b => b.width <= b.maxWidth && b.fontSize >= 24));
      // Only the matching name pill may cross its photo's bottom edge, by <=18px.
      check(`text-photo-separation:${page.file}`, page.textBoxes.every(t => page.photoBoxes.every(p => !overlap(t, p)
        || (t.role === 'asset-label' && t.assetId === p.assetId && t.y >= p.y + p.height - 18 && t.x >= p.x && t.x + t.width <= p.x + p.width))));
      check(`cover-fills-frame:${page.file}`, page.photoBoxes.every(p => p.fit !== 'cover' || Math.abs(p.frameFillRatio - 1) < .001));
      check(`source-crop-bounds:${page.file}`, page.photoBoxes.every(p => {
        const a = actualAssets.find(a => a.id === p.assetId), c = p.sourceCrop;
        return c && c.x >= 0 && c.y >= 0 && c.width > 0 && c.height > 0 && c.x + c.width <= a.orientedWidth + .001 && c.y + c.height <= a.orientedHeight + .001;
      }));
      check(`text-separation:${page.file}`, page.textBoxes.every((t, i) => page.textBoxes.slice(i + 1).every(other => !overlap(t, other))));
      check(`photo-separation:${page.file}`, page.photoBoxes.every((p, i) => page.photoBoxes.slice(i + 1).every(other => !overlap(p, other))));
      check(`png-required:${page.file}`, page.outputFiles.some(f => f.file === (simple ? deliveryName(page) : page.file) && f.format === 'png'));
      for (const item of page.outputFiles) {
        const file = await safeOutputFile(artifactDir, item.file), bytes = await fs.readFile(file), meta = await sharp(bytes).metadata();
        check(`output-hash:${item.file}`, hash(bytes) === item.sha256);
        check(`image-size:${item.file}`, meta.width === 1080 && meta.height === 1440 && meta.space === 'srgb' && (item.format === 'jpg' ? meta.format === 'jpeg' : meta.format === 'png'));
        check(`exif-stripped:${item.file}`, !meta.exif);
      }
    } catch (error) { check(`page-readable:${page.file}`, false, error.message); }
  }
  const expectedCopy = generateCopy(facts), actualCopy = compact ? expectedCopy : await json(path.join(dir, 'copy-outputs.json'));
  if (!compact) check('copy-matches-shared-facts', same(actualCopy, expectedCopy));
  if (simple) {
    check('copy-document-matches-facts', (await fs.readFile(await safeOutputFile(root, COPY_FILE), 'utf8')) === copyText(expectedCopy));
    if (!compact) check('result-page-matches-facts', (await fs.readFile(await safeOutputFile(root, ENTRY_FILE), 'utf8')) === deliveryHtml(facts, manifest.pages, expectedCopy));
  } else check('copy-markdown-matches-facts', (await fs.readFile(await safeOutputFile(dir, 'copy.md'), 'utf8')) === copyMarkdown(expectedCopy));
  check('copy-targets-match-request', same(manifest.copyTargetsGenerated, facts.targets));
  check('platform-texts-differ', new Set(Object.values(actualCopy.copy_outputs)).size === facts.targets.length);
  const publicFiles = generated.flatMap(p => p.outputFiles.map(f => f.file));
  for (const target of facts.targets) {
    const file = `copy_${target}.txt`;
    if (!simple) {
      try { check(`copy-text:${target}`, (await fs.readFile(await safeOutputFile(dir, file), 'utf8')) === `${expectedCopy.copy_outputs[target]}\n`); }
      catch (error) { check(`copy-text:${target}`, false, error.message); }
      publicFiles.push(file);
    }
    const length = [...expectedCopy.copy_outputs[target]].length;
    const ranges = { wechat_moments: [50, 120], parent_group: [40, 100], xiaohongshu: [120, 300], video_title: [12, 28], video_caption: [20, 80] };
    if (length < ranges[target][0] || length > ranges[target][1]) warnings.push({ code: 'copy-length-soft-target', target, length, range: ranges[target] });
  }
  if (simple) publicFiles.push(COPY_FILE);
  const files = await deliveryFiles(artifactDir);
  check('no-unrequested-platform-files', files.filter(f => /^copy_.+\.txt$/.test(f)).every(f => publicFiles.includes(f)));
  const registeredPosters = new Set(generated.flatMap(p => p.outputFiles.map(f => f.file)));
  check('no-stale-posters', files.filter(f => /^0[1-4]_.+\.(png|jpg)$/.test(f)).every(f => registeredPosters.has(f)));
  const technicalFiles = ['copy-outputs.json', 'content.json', 'asset-manifest.json', 'render-manifest.json', 'review.json', 'warnings.json'];
  if (compact) check('minimal-output-files', same(files.sort(), [...publicFiles, ...(keepState ? [STATE_FILE] : [])].sort()));
  const bundleFiles = [...new Set(compact ? [...publicFiles, ...(keepState ? [STATE_FILE] : [])] : simple ? [...publicFiles, ENTRY_FILE, ...technicalFiles.map(f => `${INTERNAL_DIR}/${f}`)] : [...publicFiles, 'copy.md', ...technicalFiles])].sort();
  const fileHashes = {};
  for (const file of bundleFiles) {
    try {
      const internalFile = simple && file.startsWith(`${INTERNAL_DIR}/`);
      fileHashes[file] = hash(await fs.readFile(await safeOutputFile(internalFile ? dir : artifactDir, internalFile ? path.basename(file) : file)));
    }
    catch (error) { check(`bundle-readable:${file}`, false, error.message); }
  }
  const report = {
    schemaVersion: '1.1', verification: 'full', passed: errors.length === 0, errors, checks, warnings,
    reviewStatus: 'draft', publicReleaseApproved: false,
    bundleDigest: hash(JSON.stringify(fileHashes)), fileHashes,
    publicReleaseEligible: generated.length > 0 && generated.every(p => p.publicReleaseEligible) && errors.length === 0,
    manualReviewRequired: ['原图与成图逐张核对', '中文显示、裁切与手机可读性', '菜名、日期、门店与同批次关系', '逐素材、逐主体授权及用途范围']
  };
  return report;
}

async function validateFilesOnly(root) {
  root = await fs.realpath(root);
  const files = await deliveryFiles(root), checks = [], fileHashes = {};
  const check = (name, passed) => checks.push({ name, passed });
  const posters = files.filter(file => /^0[1-4]_.+\.(png|jpg)$/.test(file));
  check('at-least-one-poster', posters.some(file => file.endsWith('.png')));
  check('copy-document-present', files.includes(COPY_FILE));
  check('only-delivery-files', files.every(file => posters.includes(file) || file === COPY_FILE));
  for (const file of [...posters, COPY_FILE]) {
    try {
      const bytes = await fs.readFile(await safeOutputFile(root, file));
      fileHashes[file] = hash(bytes);
      if (file === COPY_FILE) check('copy-document-not-empty', bytes.toString('utf8').trim().length > 0);
      else {
        const meta = await sharp(bytes).metadata();
        await sharp(bytes).resize(8, 8).raw().toBuffer();
        check(`image-size:${file}`, meta.width === 1080 && meta.height === 1440 && meta.space === 'srgb' && meta.format === (file.endsWith('.png') ? 'png' : 'jpeg'));
        check(`exif-stripped:${file}`, !meta.exif);
      }
    } catch { check(`file-readable:${file}`, false); }
  }
  const errors = checks.filter(c => !c.passed);
  return { schemaVersion: '1.1', verification: 'files-only', passed: errors.length === 0, checks, errors,
    warnings: [{ code: 'facts-not-rechecked', reason: '未保留任务状态；这里只检查成品文件，事实与来源已在生成时校验' }],
    fileHashes, bundleDigest: hash(JSON.stringify(fileHashes)), reviewStatus: 'draft', publicReleaseApproved: false, publicReleaseEligible: false };
}

export async function exportPublic({ output, approvalFile, destination, asOf = today() }) {
  const { dir, content, manifest, facts, simple, root, assets, compact } = await readPrivate(output);
  const qa = await validateOutput(output);
  const approval = await json(approvalFile);
  if (!qa.passed || !qa.publicReleaseEligible) throw new Error('QA 或素材公开资格未通过，不能导出公开版');
  if (approval.contentApproved !== true || approval.publicReleaseApproved !== true || !approval.approvedBy?.trim()
    || !validTimestamp(approval.approvedAt, asOf) || approval.reviewedDigest !== qa.bundleDigest
    || approval.purpose !== 'meal-story-publicity' || !Array.isArray(approval.channels)
    || !facts.targets.every(t => approval.channels.includes(t))) throw new Error('需要人工批准记录，且摘要、用途、渠道和审核时间必须覆盖本批产物');
  for (const id of facts.selectedIds) {
    const original = content.assets.find(a => a.id === id);
    if (!privacyDecision(original, approval.channels, asOf).safe) throw new Error(`授权过期或未覆盖实际发布渠道：${id}`);
  }
  const currentFacts = await compileFacts(content, path.join(dir, compact ? STATE_FILE : 'content.json'), await inspectAssets(assets.inputRoot), asOf);
  if (!same(generateCopy(currentFacts).copy_outputs, generateCopy(facts).copy_outputs)) throw new Error('时间或权限状态变化，请重新生成并审核');
  const target = path.resolve(destination);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const resolvedTarget = path.join(await fs.realpath(path.dirname(target)), path.basename(target));
  if (inside(root, resolvedTarget) || inside(resolvedTarget, root)
    || inside(assets.inputRoot, resolvedTarget)) throw new Error('公开目录必须与原图及 private 审核目录分开');
  // Recheck exact bytes immediately before copying; no original image or private report is in this allowlist.
  const files = [...manifest.pages.filter(p => p.status === 'generated').flatMap(p => p.outputFiles.map(f => f.file)), ...(simple ? [COPY_FILE] : facts.targets.map(t => `copy_${t}.txt`))];
  const buffers = new Map();
  for (const file of files) {
    const bytes = await fs.readFile(await safeOutputFile(simple ? root : dir, file));
    if (hash(bytes) !== qa.fileHashes[file]) throw new Error('审核后产物变化，需重新审核');
    buffers.set(file, bytes);
  }
  await freshDirectory(resolvedTarget);
  for (const [file, bytes] of buffers) await fs.writeFile(path.join(resolvedTarget, file), bytes, { flag: 'wx', mode: 0o600 });
  // Public metadata contains no source paths, participant identifiers or guardian records.
  await writeJson(path.join(resolvedTarget, 'publication-manifest.json'), {
    schemaVersion: '1.1', publicReleaseApproved: true, reviewedDigest: qa.bundleDigest,
    channels: approval.channels, purpose: approval.purpose,
    files: files.map(file => ({ file, sha256: qa.fileHashes[file] }))
  });
  if (!compact) await writeJson(path.join(dir, 'publication-receipt.json'), { ...approval, destination: resolvedTarget, files });
  return { destination: resolvedTarget, files, publicReleaseApproved: true };
}
