import fs from 'node:fs/promises';
import path from 'node:path';
import { inside, validDate, validTimestamp, TARGETS } from './io.mjs';

// P0 deliberately omits operating/health promises, even when a name is marked verified.
const restricted = /增强免疫|提高免疫|营养(?:更?均衡|搭配|达标)|膳食纤维|暖胃|自然成熟|天然成熟|孩子更爱吃|孩子更容易接受|安全达标|百分百|100\s*%|绝对|无公害|当天采购|当日采购|每日采购|每天采购|新鲜现切|最新鲜|严选优质|现做现炒|每日现做|都爱吃|全员光盘|吃得开心|开心吃饭|老师.*陪餐|工作人员.*照看|每天|每日|今天|今日|本周|新鲜|卫生|有机|冷链/iu;
export const hasRestrictedClaim = text => typeof text === 'string' && restricted.test(text);
const meaningful = value => typeof value === 'string' && value.trim().length > 0;
const normalText = value => !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value);

export function privacyDecision(asset, channels, asOf) {
  const review = asset.privacyReview;
  if (asset.publicUsePermission !== 'verified') return { safe: false, reason: `public-use-permission-${asset.publicUsePermission ?? 'unverified'}` };
  if (!review || !meaningful(review.reviewedBy) || !validTimestamp(review.reviewedAt, asOf) || review.risksChecked !== true) {
    return { safe: false, reason: 'human-privacy-review-required' };
  }
  if (review.sensitiveInfo !== 'no' || review.identifiablePeople === 'unknown') return { safe: false, reason: 'sensitive-or-unknown-identifiability' };
  if (!['yes', 'no'].includes(asset.identifiableChildren)) return { safe: false, reason: 'children-identifiability-unknown' };
  if (review.identifiablePeople === 'no') {
    if (asset.identifiableChildren === 'yes' || review.subjects.length || (review.subjectCount ?? 0) !== 0) return { safe: false, reason: 'contradictory-privacy-review' };
    return { safe: true, reason: 'human-reviewed-no-identifiable-person' };
  }
  if (!review.subjectCount || review.subjectCount !== review.subjects.length || new Set(review.subjects.map(s => s.subjectId)).size !== review.subjects.length) {
    return { safe: false, reason: 'per-subject-review-incomplete' };
  }
  const hasMinor = review.subjects.some(s => s.isMinor);
  if (hasMinor !== (asset.identifiableChildren === 'yes')) return { safe: false, reason: 'contradictory-minor-review' };
  for (const subject of review.subjects) {
    if (subject.permission !== 'verified' || (subject.isMinor && subject.guardianPermissionVerified !== true)
      || subject.purpose !== 'meal-story-publicity' || !validDate(subject.validUntil) || subject.validUntil < asOf
      || !channels.every(channel => subject.channels.includes(channel))) {
      return { safe: false, reason: 'subject-permission-or-scope-unverified' };
    }
  }
  return { safe: true, reason: 'per-subject-public-use-verified' };
}

export async function compileFacts(content, contentFile, scan, asOf) {
  if (!validDate(asOf)) throw new Error('as-of 必须是有效的 YYYY-MM-DD 日期');
  const warnings = [...scan.warnings];
  const warn = (code, data = {}) => warnings.push({ code, ...data });
  const targets = content.copy?.targets ?? TARGETS;
  const requested = content.output?.templates ?? ['auto'];
  const originalRoot = path.dirname(path.resolve(contentFile));
  const byPath = new Map(scan.assets.map(a => [a.sourcePath, a]));
  const usedHashes = new Map(), assets = [];
  for (const source of content.assets) {
    if (/^[a-z]+:\/\//iu.test(source.file) || source.file.startsWith('data:')) throw new Error('仅允许本地登记照片，拒绝远程 URL');
    const sourcePath = await fs.realpath(path.resolve(originalRoot, source.file));
    if (!inside(scan.inputRoot, sourcePath) || !byPath.has(sourcePath)) throw new Error(`照片必须位于输入文件夹内且已通过扫描：${source.id}`);
    const inspected = byPath.get(sourcePath);
    if (source.sha256 && source.sha256 !== inspected.sha256) throw new Error(`源照片哈希不一致，需重新审核：${source.id}`);
    if (usedHashes.has(inspected.sha256)) {
      warn('duplicate-excluded', { assetId: source.id, duplicateOf: usedHashes.get(inspected.sha256) });
      continue;
    }
    usedHashes.set(inspected.sha256, source.id);
    const category = source.categoryStatus === 'verified' ? source.category : 'other';
    const fallback = category === 'ingredient' ? '备料实拍' : category === 'dining-scene' ? '用餐环境' : '餐食实拍';
    let label = fallback;
    const labelVerified = source.labelStatus === 'verified' && meaningful(source.label) && normalText(source.label) && !hasRestrictedClaim(source.label);
    if (labelVerified) label = source.label.trim();
    else if (source.label === '汤品' && source.category === 'finished-dish') label = '汤品';
    if (!labelVerified) warn('label-needs-confirmation', { assetId: source.id, suggestedLabel: source.label ?? null, renderedLabel: label });
    if (hasRestrictedClaim(source.label)) warn('unsupported-claim-removed', { assetId: source.id, field: 'label' });
    let note = '';
    if (source.note) {
      if (source.noteStatus === 'verified' && normalText(source.note) && !hasRestrictedClaim(source.note)) note = source.note.trim();
      else warn('unverified-or-restricted-note-removed', { assetId: source.id, field: 'note' });
    }
    if (source.categoryStatus !== 'verified') warn('category-needs-confirmation', { assetId: source.id });
    const privacy = privacyDecision(source, targets, asOf);
    let fit = source.fit ?? (category === 'dining-scene' ? 'contain' : content.output?.fit ?? 'cover');
    if (fit === 'cover' && source.cropReviewed !== true) {
      if (category === 'dining-scene') fit = 'contain';
      else warn('crop-review-required', { assetId: source.id, action: '内部草稿允许铺满；公开导出前逐图核对主体裁切' });
    }
    if (!privacy.safe) warn('asset-public-use-blocked', { assetId: source.id, reason: privacy.reason, action: '人工检查人物、姓名、校服及间接识别信息，并核实逐素材/逐主体的传播许可' });
    // A risk found on any category cannot be bypassed by classifying a scene as food.
    const knownRisk = source.identifiableChildren === 'yes' || source.privacyReview?.identifiablePeople === 'yes' || source.privacyReview?.sensitiveInfo === 'yes';
    const eligibleForDraft = source.publicUsePermission !== 'denied' && (!knownRisk || privacy.safe);
    assets.push({
      ...source, ...inspected, id: source.id, category, sourcePath, label, note, labelVerified, fit, privacy,
      eligibleForDraft,
      factIds: [`asset:${source.id}:presence`, ...(labelVerified ? [`asset:${source.id}:label`] : []), ...(note ? [`asset:${source.id}:note`] : [])]
    });
  }
  const registeredIds = new Set(content.assets.map(a => a.id));
  for (const id of content.diningScene?.assetIds ?? []) if (!registeredIds.has(id)) throw new Error(`D 引用了未知素材：${id}`);
  const links = [];
  for (const link of content.confirmedLinks ?? []) {
    const ingredient = assets.find(a => a.id === link.ingredientId), dish = assets.find(a => a.id === link.dishId);
    if (!ingredient || !dish || ingredient.category !== 'ingredient' || dish.category !== 'finished-dish') throw new Error('原料成品配对必须引用已登记且类型相符的素材');
    if (link.status !== 'verified' || !meaningful(link.reviewedBy) || !validTimestamp(link.reviewedAt, asOf)) { warn('unverified-link-ignored', { ingredientId: link.ingredientId, dishId: link.dishId }); continue; }
    if ((ingredient.siteId && dish.siteId && ingredient.siteId !== dish.siteId)
      || (ingredient.capturedAt && dish.capturedAt && ingredient.capturedAt.slice(0, 10) !== dish.capturedAt.slice(0, 10))) {
      warn('contradictory-link-ignored', { ingredientId: ingredient.id, dishId: dish.id }); continue;
    }
    // P0 records human-confirmed links for review; no before/after claim is rendered.
    links.push(link);
  }
  for (const text of content.copy?.requestedClaims ?? []) warn('requested-claim-not-supported-in-p0', { text });
  if (content.copy?.enableNutritionClaims || content.copy?.allowUnverifiedClaims) warn('claim-flags-ignored-in-p0');
  const brand = content.brand?.name ?? '三人行托管中心';
  if (!normalText(brand) || hasRestrictedClaim(brand)) throw new Error('品牌名包含不支持的承诺或控制字符');
  const ingredients = assets.filter(a => a.category === 'ingredient' && a.eligibleForDraft);
  const dishes = assets.filter(a => a.category === 'finished-dish' && a.eligibleForDraft);
  const sceneConfig = content.diningScene ?? {};
  let scenes = [];
  let diningReason = sceneConfig.enabled ? 'no-scene-assets' : 'disabled';
  if (sceneConfig.enabled) {
    if (sceneConfig.privacyMode === 'crop-or-blur') warn('automatic-blur-not-supported-in-p0');
    for (const id of sceneConfig.assetIds ?? []) {
      const asset = assets.find(a => a.id === id);
      if (!asset) continue;
      const reason = asset.category !== 'dining-scene' ? 'not-a-dining-scene'
        : sceneConfig.publicUsePermission !== 'verified' ? 'scene-public-use-permission-unverified'
          : !asset.privacy.safe ? asset.privacy.reason : !asset.eligibleForDraft ? 'scene-ineligible' : null;
      if (reason) { diningReason = reason; warn('dining-scene-skipped', { assetId: id, reason }); }
      else scenes.push(asset);
    }
    scenes.sort((a, b) => (a.privacyReview.identifiablePeople === 'no' ? 0 : 1) - (b.privacyReview.identifiablePeople === 'no' ? 0 : 1));
    if (scenes.length) diningReason = null;
  }
  const auto = requested.includes('auto');
  const selected = auto ? new Set([
    ...(ingredients.length && dishes.length ? ['meal-overview'] : []),
    ...(ingredients.length && (!dishes.length || (ingredients.length >= 2 && dishes.length >= 2)) ? ['ingredient-focus'] : []),
    ...(dishes.length && (!ingredients.length || (ingredients.length >= 2 && dishes.length >= 2)) ? ['meal-focus'] : []),
    ...(scenes.length ? ['dining-scene'] : [])
  ]) : new Set(requested);
  const pages = [];
  const filenames = { 'meal-overview': '01_cover_mix', 'ingredient-focus': '02_fresh_ingredients', 'meal-focus': '03_meal_output', 'dining-scene': '04_dining_scene' };
  function add(template, groups, reason) {
    if (!selected.has(template) || !groups.length || !groups.flat().length) {
      pages.push({ template, status: 'skipped', reason: !selected.has(template) ? (auto && template === 'dining-scene' ? diningReason : 'not-selected') : reason, assetIds: [] });
      return;
    }
    for (let i = 0; i < groups.length; i++) {
      pages.push({ template, status: 'planned', file: `${filenames[template]}${i ? `_${String(i + 1).padStart(2, '0')}` : ''}.png`,
        assetIds: groups[i].map(a => a.id), width: 1080, height: 1440, publicReleaseEligible: false });
    }
  }
  const chunks = list => Array.from({ length: Math.ceil(list.length / 6) }, (_, i) => list.slice(i * 6, i * 6 + 6));
  // The overview is an eight-card summary when detail pages carry the full set.
  const overviewDishes = dishes.slice(0, selected.has('meal-focus') ? 4 : 5);
  add('meal-overview', ingredients.length && dishes.length ? [[...ingredients.slice(0, 4), ...overviewDishes]] : [], 'requires-ingredients-and-dishes');
  add('ingredient-focus', chunks(ingredients), 'no-ingredient-assets');
  add('meal-focus', chunks(dishes), 'no-dish-assets');
  add('dining-scene', scenes.length ? [scenes.slice(0, 1)] : [], diningReason);
  const overview = pages.find(p => p.template === 'meal-overview' && p.status === 'planned');
  if (overview) {
    overview.deferredAssetIds = [...ingredients, ...dishes].filter(a => !overview.assetIds.includes(a.id)
      && pages.some(p => p.template !== 'meal-overview' && p.status === 'planned' && p.assetIds.includes(a.id))).map(a => a.id);
    if (overview.deferredAssetIds.length) warn('overview-assets-on-detail-pages', { assetIds: overview.deferredAssetIds });
  }
  const selectedIds = [...new Set(pages.filter(p => p.status === 'planned').flatMap(p => p.assetIds))];
  const chosen = assets.filter(a => selectedIds.includes(a.id));
  for (const a of assets) if (!selectedIds.includes(a.id)) warn('asset-not-displayed', { assetId: a.id });
  const knownDates = chosen.map(a => a.capturedAt).filter(Boolean).map(date => date.slice(0, 10));
  if (knownDates.some(d => !validDate(d))) throw new Error('capturedAt 必须以有效日期开头');
  const multiDay = content.record?.scope !== undefined && content.record.scope !== 'single-day' || new Set(knownDates).size > 1;
  const dateValid = !multiDay && content.record?.dateVerified === true && validDate(content.record.date)
    && knownDates.every(d => d === content.record.date) && content.record.date <= asOf;
  if (!dateValid) warn('date-not-used', { reason: multiDay ? 'multi-day-assets' : 'missing-unverified-or-conflicting-date' });
  const recordLabel = multiDay ? '近期餐食记录' : dateValid && content.record.date === asOf ? '今日餐食记录' : '餐食记录';
  const location = content.brand?.locationName;
  const siteValid = Boolean(location && content.brand?.locationVerified && content.brand.siteId && chosen.length
    && chosen.every(a => a.siteId === content.brand.siteId) && normalText(location) && !hasRestrictedClaim(location));
  if (location && !siteValid) warn('location-not-used', { reason: 'unverified-or-mixed-site' });
  if (!location) warn('location-missing');
  const factIds = [...new Set(chosen.flatMap(a => a.factIds)), ...(dateValid ? ['record:date'] : []), ...(siteValid ? ['brand:location'] : [])];
  return {
    schemaVersion: '1.1', asOf, brand, locationName: siteValid ? location : null,
    date: dateValid ? content.record.date : null, recordLabel, multiDay, assets, pages,
    targets, selectedIds, factIds, confirmedLinks: links, warnings,
    output: { width: 1080, height: 1440, format: 'png', ...content.output }
  };
}
