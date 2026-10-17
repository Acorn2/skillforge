import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { skillRoot, json, imageOptions, hash } from './io.mjs';
import { pagePresentation, cardPresentation } from './presentation.mjs';

process.env.FONTCONFIG_FILE ??= path.join(skillRoot, 'assets/fontconfig.conf');
// On macOS CoreText silently ignores Pango's app font registration. Fontconfig
// keeps the bundled brush face available without installing a system font.
process.env.PANGOCAIRO_BACKEND = 'fc';
const esc = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const svg = (w, h, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);
const art = file => path.join(skillRoot, 'assets/botanical', file);

export async function resolveFont(output, baseDir) {
  const candidates = output.fontFile ? [[path.resolve(baseDir, output.fontFile), output.fontFamily]] : [
    ['/System/Library/Fonts/Hiragino Sans GB.ttc', 'Hiragino Sans GB'],
    ['/System/Library/Fonts/PingFang.ttc', 'PingFang SC'],
    ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 'Noto Sans CJK SC'],
    ['/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf', 'Noto Sans SC'],
    ['C:/Windows/Fonts/msyh.ttc', 'Microsoft YaHei']
  ];
  for (const [file, family] of candidates) {
    try {
      await fs.access(file);
      if (!family) throw new Error('自定义字体必须同时填写 output.fontFamily');
      const displayFile = path.join(skillRoot, 'assets/fonts/MaShanZheng-Regular.ttf');
      await fs.access(displayFile);
      // Register the body face before any display text so punctuation missing
      // from the brush font has a real fallback on the very first page.
      await sharp({ text: { text: '。·', font: `${family} 24`, fontfile: file, rgba: true } }).png().toBuffer();
      return { file, family, displayFile, displayFamily: 'Ma Shan Zheng' };
    } catch (error) { if (output.fontFile) throw error; }
  }
  throw new Error('找不到中文正文字体。请提供合法使用的 output.fontFile 和 fontFamily。');
}

const rowsFor = count => count <= 3 ? [count] : count === 4 ? [2, 2] : count === 5 ? [3, 2] : [3, 3];
const positionFactors = position => ({ centre: [.5, .5], center: [.5, .5], north: [.5, 0], northeast: [1, 0], east: [1, .5], southeast: [1, 1], south: [.5, 1], southwest: [0, 1], west: [0, .5], northwest: [0, 0] }[position] ?? [.5, .5]);

export async function renderPage(facts, page, dir, font, filename = page.file) {
  const theme = await json(path.join(skillRoot, 'assets/green-warm.json'));
  const backgrounds = [], photos = [], decorations = [], texts = [];
  const textBoxes = [], photoBoxes = [], cards = [];
  const presentation = pagePresentation(facts, page.template);
  const assets = page.assetIds.map(id => facts.assets.find(a => a.id === id));
  const shape = (body, overlay = false) => (overlay ? decorations : backgrounds).push({ input: svg(1080, 1440, body), left: 0, top: 0 });
  const panel = (x, y, w, h) => shape(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="36" fill="${theme.cream}" fill-opacity=".97"/>`);
  async function text(value, x, y, maxWidth, size, minSize, fill, maxHeight = 100, options = {}) {
    if (!value) return;
    for (let current = size; current >= minSize; current -= 2) {
      const display = options.display !== false;
      const result = await sharp({ text: { text: `<span foreground="${fill}" weight="${options.bold ? 'bold' : 'normal'}">${esc(value)}</span>`,
        font: `${display ? font.displayFamily : font.family} ${current}`, fontfile: display ? font.displayFile : font.file, rgba: true, dpi: 72 } }).png().toBuffer({ resolveWithObject: true });
      if (result.info.width <= maxWidth && result.info.height <= maxHeight) {
        const left = Math.round(options.center ? x + (maxWidth - result.info.width) / 2 : x);
        if (options.badge) shape(`<rect x="${left - 20}" y="${y - 10}" width="${result.info.width + 40}" height="${result.info.height + 20}" rx="28" fill="${options.badge}" stroke="${theme.cream}" stroke-width="3"/>`, true);
        texts.push({ input: result.data, left, top: y });
        const box = { text: value, x: left, y, width: result.info.width, height: result.info.height, maxWidth, fontSize: current,
          color: fill, role: options.role ?? 'body', ...(options.assetId ? { assetId: options.assetId } : {}) };
        textBoxes.push(box);
        return box;
      }
    }
    throw new Error(`文字过长，请精简后重试：${String(value).slice(0, 30)}`);
  }
  function emblem(kind, x, y, size, fill = theme.green) {
    const symbols = {
      leaf: '<path d="M19 66Q5 25 72 12Q81 65 31 76L56 35L22 72Z" fill="white"/>',
      bowl: '<path d="M10 42H76Q71 73 43 73Q15 73 10 42Z" fill="white"/><path d="M25 30Q17 23 26 15M43 30Q35 23 44 15M61 30Q53 23 62 15" fill="none" stroke="white" stroke-width="5" stroke-linecap="round"/>',
      camera: '<rect x="13" y="27" width="62" height="44" rx="9" fill="none" stroke="white" stroke-width="6"/><circle cx="44" cy="49" r="13" fill="none" stroke="white" stroke-width="5"/><path d="M30 27L35 17H53L58 27" fill="none" stroke="white" stroke-width="6"/>',
      record: '<rect x="22" y="17" width="45" height="59" rx="6" fill="none" stroke="white" stroke-width="6"/><path d="M31 31H56M31 44H56M31 57H48" stroke="white" stroke-width="5" stroke-linecap="round"/>',
      heart: '<path d="M44 70L17 44C0 25 23 8 44 30C65 8 88 25 71 44Z" fill="white"/>'
    };
    shape(`<g transform="translate(${x} ${y}) scale(${size / 90})"><defs><linearGradient id="medal-${x}-${y}" x2="1" y2="1"><stop stop-color="#8CCC4B"/><stop offset="1" stop-color="${fill}"/></linearGradient></defs><circle cx="45" cy="45" r="44" fill="url(#medal-${x}-${y})"/>${symbols[kind] ?? symbols.leaf}</g>`, true);
  }
  function sparks(x, y) {
    shape(`<g stroke="#FFD33F" stroke-width="7" stroke-linecap="round"><path d="M${x} ${y}l5 -15M${x + 14} ${y + 6}l9 -10"/></g>`, true);
  }
  async function sticker(name, x, y, w, h) {
    if (!name) { emblem('leaf', x + 9, y + 14, Math.min(w, h) - 18); return; }
    const { data, info } = await sharp(art(`${name}.png`)).resize(w, h, { fit: 'inside' }).png().toBuffer({ resolveWithObject: true });
    decorations.push({ input: data, left: Math.round(x + (w - info.width) / 2), top: Math.round(y + (h - info.height) / 2) });
  }

  // Header geometry follows the reference, independent of source aspect ratios.
  shape('<path d="M214 145Q234 134 270 142L795 140Q854 141 856 184Q855 222 810 224L267 228Q211 228 214 190Q202 179 214 145Z" fill="#FFEB83"/>');
  shape('<g fill="none" stroke="#FFE261" stroke-width="7" stroke-linecap="round"><circle cx="65" cy="91" r="20" fill="#FFE261"/><path d="M65 52V42M65 140V130M26 91H16M114 91H104M36 62L29 55M95 122L102 129M36 120L29 127M95 62L102 55"/></g>');
  shape('<path d="M880 169L1072 129L1080 252L885 290Z" fill="#FFFCEB" opacity=".95"/>');
  const brand = await text(presentation.brand, 112, 22, 906, 130, 44, '#FFFDF2', 116, { center: true, bold: true, role: 'brand' });
  await text(presentation.title, 226, 151, 616, Math.min(78, brand.fontSize - 6), 30, '#063C19', 68, { center: true, role: 'title' });
  await text(presentation.subtitle, 138, 246, 735, 38, 26, '#FFFDF2', 38, { center: true, role: 'subtitle' });
  shape('<path d="M452 291Q495 282 542 286" stroke="#FFDA47" stroke-width="5" fill="none" stroke-linecap="round"/>');
  await text('用照片记录', 914, 177, 150, 28, 24, theme.ink, 30, { center: true, role: 'aside' });
  await text('一餐的日常', 897, 220, 162, 28, 24, theme.ink, 30, { center: true, role: 'aside' });
  const meta = [facts.date, facts.locationName].filter(Boolean).join(' / ');
  if (meta) await text(meta, 180, 285, 720, 24, 24, theme.ink, 28, { center: true, role: 'metadata' });

  async function section(label, y, orange = false, detail = '') {
    const color = orange ? theme.orange : theme.green;
    emblem(orange ? 'bowl' : 'leaf', 29, y - 6, 61, color);
    await text(label, 104, y + 2, 460, 46, 34, '#FFFDF2', 54, { badge: color, role: 'section' });
    if (detail) {
      await text(detail, 648, y + 11, 365, 28, 24, theme.text, 32, { center: true, role: 'section-detail' });
      shape(`<path d="M710 ${y + 52}Q840 ${y + 42} 997 ${y + 50}" stroke="#FFD33F" stroke-width="4" fill="none"/>`, true);
    }
  }
  async function grid(list, y, height, sizes = rowsFor(list.length), compact = false) {
    const gap = 16, rowHeight = Math.floor((height - gap * (sizes.length - 1)) / sizes.length);
    let offset = 0;
    for (let row = 0; row < sizes.length; row++) {
      const columns = sizes[row], width = Math.floor((1016 - gap * (columns - 1)) / columns);
      const captionHeight = compact ? 80 : columns === 4 ? 106 : columns === 3 ? 122 : 132;
      const imageHeight = rowHeight - captionHeight;
      if (imageHeight < 86) throw new Error('照片区域不足，请减少卡片或使用详情页');
      for (let column = 0; column < columns; column++) {
        const asset = list[offset++], x = 32 + column * (width + gap), top = y + row * (rowHeight + gap);
        backgrounds.push({ input: svg(width, rowHeight, `<rect width="${width}" height="${rowHeight}" rx="24" fill="#FFFCF1"/>`), left: x, top });
        const source = await fs.readFile(asset.sourcePath);
        if (hash(source) !== asset.sha256) throw new Error(`渲染前原图变化：${asset.id}`);
        const [px, py] = positionFactors(asset.position);
        const sw = asset.orientedWidth, sh = asset.orientedHeight;
        const scale = asset.fit === 'cover' ? Math.max(width / sw, imageHeight / sh) : Math.min(width / sw, imageHeight / sh);
        const cropW = asset.fit === 'cover' ? Math.min(sw, width / scale) : sw;
        const cropH = asset.fit === 'cover' ? Math.min(sh, imageHeight / scale) : sh;
        const sourceCrop = { x: (sw - cropW) * px, y: (sh - cropH) * py, width: cropW, height: cropH };
        const photo = await sharp(source, imageOptions).autoOrient().toColourspace('srgb')
          .resize(width, imageHeight, { fit: asset.fit, position: asset.position ?? 'centre', background: theme.pale }).ensureAlpha()
          .composite([{ input: svg(width, imageHeight, `<rect width="${width}" height="${imageHeight}" rx="20" fill="white"/>`), blend: 'dest-in' }]).png().toBuffer();
        photos.push({ input: photo, left: x, top });
        const color = asset.category === 'finished-dish' ? theme.orange : theme.green;
        await text(asset.label, x + 20, top + imageHeight - 14, width - 40, columns === 4 ? 36 : 42, 30, '#FFFDF2', 48,
          { center: true, badge: color, role: 'asset-label', assetId: asset.id });
        const card = cardPresentation(asset), iconWidth = Math.min(108, Math.floor(width * .30));
        const captionY = top + imageHeight + 44;
        const displayedLines = compact ? card.captionLines.slice(0, 1) : card.captionLines;
        for (let i = 0; i < displayedLines.length; i++) {
          await text(card.captionLines[i], x + 23, captionY + i * 34, width - iconWidth - 30, columns === 4 ? 26 : 30, 24, theme.text, 34,
            { display: false, role: asset.note ? 'asset-note' : 'asset-caption', assetId: asset.id });
        }
        await sticker(card.icon, x + width - iconWidth - 5, captionY - 6, iconWidth, captionHeight - 39);
        sparks(x + width - 26, captionY - 8);
        const visiblePhotoArea = asset.fit === 'cover' ? width * imageHeight : sw * sh * scale * scale;
        photoBoxes.push({ assetId: asset.id, sha256: asset.sha256, x, y: top, width, height: imageHeight, fit: asset.fit,
          position: asset.position ?? 'centre', sourceCrop, retainedSourceRatio: cropW * cropH / (sw * sh), visiblePhotoArea, frameFillRatio: visiblePhotoArea / (width * imageHeight) });
        cards.push({ assetId: asset.id, label: asset.label, note: asset.note, ...card, displayedCaptionLines: displayedLines, factIds: asset.factIds });
      }
    }
  }
  async function footer(y, height) {
    panel(8, y, 1064, height);
    const kinds = ['leaf', 'bowl', 'record'];
    for (let i = 0; i < 3; i++) {
      const x = 35 + i * 350;
      emblem(kinds[i], x, y + 18, 76);
      await text(presentation.footer[i][0], x + 96, y + 24, 215, 38, 26, '#073D1C', 44, { badge: '#FFF090', role: 'footer-title' });
      await text(presentation.footer[i][1], x + 82, y + 90, 244, 24, 24, theme.text, 30, { display: false, center: true, role: 'footer-detail' });
      if (i < 2) shape(`<path d="M${x + 327} ${y + 29}V${y + height - 27}" stroke="${theme.green}" stroke-width="1.5" stroke-dasharray="5 5"/>`, true);
    }
  }
  if (page.template === 'meal-overview') {
    const raw = assets.filter(a => a.category === 'ingredient'), meals = assets.filter(a => a.category === 'finished-dish');
    panel(8, 307, 1064, 463); panel(8, 782, 1064, 476);
    await section('食材备料实拍', 325, false, '一份食材 · 一份记录');
    await grid(raw, 389, 364, raw.length <= 4 ? [raw.length] : rowsFor(raw.length));
    await section('餐食出品', 800, true, '家常餐食 · 实拍分享');
    await grid(meals, 864, 377, meals.length <= 4 ? [meals.length] : rowsFor(meals.length), meals.length > 4);
    await footer(1272, 146);
  } else if (page.template === 'ingredient-focus' && assets.length <= 4) {
    panel(8, 307, 1064, 537);
    await section('食材备料实拍', 325, false, '备料照片 · 看得见');
    await grid(assets, 399, 426, [assets.length]);
    panel(8, 857, 1064, 249); await section('备料小记', 877, true, '记录这一份备料日常');
    const features = [['leaf', '食材模样', '从备料照片看起'], ['camera', '实拍留存', '保留照片的记录'], ['record', '分享日常', '与家长一同看见']];
    for (let i = 0; i < 3; i++) {
      const x = 34 + i * 350;
      shape(`<rect x="${x - 9}" y="963" width="330" height="125" rx="30" fill="#EFF5D9"/>`);
      emblem(features[i][0], x + 5, 976, 90);
      await text(features[i][1], x + 115, 981, 190, 38, 28, '#073D1C', 44, { badge: '#FFF090', role: 'info-title' });
      await text(features[i][2], x + 104, 1043, 207, 24, 24, theme.text, 28, { display: false, role: 'info-detail' });
    }
    panel(8, 1119, 1064, 299);
    emblem('heart', 31, 1134, 62);
    await text('让家长看见餐食日常', 112, 1140, 800, 46, 36, '#FFFDF2', 54, { badge: theme.green, role: 'info-heading' });
    for (let i = 0; i < 3; i++) {
      const x = 41 + i * 350;
      emblem(['leaf', 'record', 'camera'][i], x + 5, 1241, 96);
      await text(presentation.footer[i][0], x + 119, 1230, 195, 38, 26, '#073D1C', 44, { role: 'footer-title' });
      await text(presentation.footer[i][1], x + 114, 1300, 202, 24, 24, theme.text, 56, { display: false, role: 'footer-detail' });
    }
  } else {
    panel(8, 307, 1064, 920);
    const isMeal = page.template === 'meal-focus';
    if (isMeal && assets.length === 5) await grid(assets, 324, 886, [3, 2]);
    else {
      await section(isMeal ? '餐食出品' : page.template === 'dining-scene' ? '用餐环境' : '食材备料', 325, isMeal);
      await grid(assets, 395, 815);
    }
    await footer(1240, 178);
  }
  const base = await sharp(art('background.png')).resize(1080, 1440, { fit: 'cover' }).png().toBuffer();
  const png = await sharp(base).composite([...backgrounds, ...photos, ...decorations, ...texts]).flatten({ background: theme.cream })
    .toColourspace('srgb').withIccProfile('srgb').png().toBuffer();
  await fs.writeFile(path.join(dir, filename), png, { mode: 0o600 });
  const outputFiles = [{ file: filename, sha256: hash(png), format: 'png' }];
  if (facts.output.format === 'jpg') {
    const file = filename.replace(/\.png$/, '.jpg'), data = await sharp(png).jpeg({ quality: facts.output.jpegQuality ?? 90 }).withIccProfile('srgb').toBuffer();
    await fs.writeFile(path.join(dir, file), data, { mode: 0o600 });
    outputFiles.push({ file, sha256: hash(data), format: 'jpg' });
  }
  return { ...page, status: 'generated', publicReleaseEligible: assets.every(a => a.privacy.safe && a.categoryStatus === 'verified' && (a.fit !== 'cover' || a.cropReviewed === true)), publicReleaseApproved: false,
    brand: presentation.brand, title: presentation.title, subtitle: presentation.subtitle, footer: presentation.footer,
    visualStyle: 'botanical-reference-v2', deliveryFile: filename, cards, outputFiles, textBoxes, photoBoxes,
    photoSlotRatio: photoBoxes.reduce((s, b) => s + b.width * b.height, 0) / (1080 * 1440),
    visiblePhotoRatio: photoBoxes.reduce((s, b) => s + b.visiblePhotoArea, 0) / (1080 * 1440) };
}

