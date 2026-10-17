import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJson } from './io.mjs';

export const TARGET_LABELS = {
  wechat_moments: '朋友圈', parent_group: '家长群', xiaohongshu: '小红书',
  video_title: '视频号 / 抖音标题', video_caption: '视频号 / 抖音描述'
};

export function generateCopy(facts) {
  const shown = facts.assets.filter(a => facts.selectedIds.includes(a.id));
  const ingredients = shown.filter(a => a.category === 'ingredient');
  const dishes = shown.filter(a => a.category === 'finished-dish');
  const scenes = shown.filter(a => a.category === 'dining-scene');
  const names = list => [...new Set(list.map(a => a.label))].slice(0, 6).join('、');
  const parts = [ingredients.length ? `备料照片：${names(ingredients)}` : '', dishes.length ? `餐食照片：${names(dishes)}` : '', scenes.length ? '用餐环境照片：用餐场景记录' : ''].filter(Boolean);
  const heading = scenes.length && !dishes.length && !ingredients.length ? '用餐环境记录' : facts.recordLabel;
  const brand = `${facts.brand}${facts.locationName ? `｜${facts.locationName}` : ''}`;
  const details = parts.join('；');
  const time = facts.date ? `\n记录日期：${facts.date}。` : '';
  const photoKind = ingredients.length && dishes.length ? '备料与餐食' : ingredients.length ? '备料' : dishes.length ? '餐食' : '用餐环境';
  const all = {
    wechat_moments: `${brand}｜${heading}\n分享这一组${photoKind}实拍。${details}。${time}\n留一份日常记录，欢迎翻看照片了解。`,
    parent_group: `各位家长好，分享${brand}的${heading}。${details}。${time}\n欢迎查看照片。`,
    xiaohongshu: `托管${photoKind}实拍，照片里有什么\n\n${brand}｜${heading}${time}\n\n把本次拍到的${photoKind}照片整理在一起，方便家长逐张查看。\n${parts.map(p => `· ${p}`).join('\n')}。\n\n图片保留原来的食物或环境外观，文字只说明已经确认的内容。这里展示的是部分拍摄记录，具体内容可以对照照片慢慢看；${dishes.length ? '如果想了解其中某一道菜，也可以进一步核对名称。' : '如果对照片内容有疑问，也可以进一步核对记录信息。'}\n\n#托管日常 #实拍记录`,
    video_title: `托管中心${photoKind}实拍，一起看看照片记录`,
    video_caption: `分享${brand}的${photoKind}实拍，本次共整理${shown.length}张照片，内容可以逐张查看。${facts.date ? `记录日期为${facts.date}。` : ''}`
  };
  return {
    schemaVersion: '1.1',
    copy_outputs: Object.fromEntries(facts.targets.map(target => [target, all[target]])),
    metadata: {
      requestedTargets: facts.targets, reviewStatus: 'draft', basedOnVerifiedFactsOnly: true,
      sourceAssetIds: facts.selectedIds, factIds: facts.factIds,
      sourceFactsByTarget: Object.fromEntries(facts.targets.map(target => [target, { sourceAssetIds: facts.selectedIds, factIds: facts.factIds }])),
      videoRendered: false
    }
  };
}

export function copyMarkdown(copy) {
  const paragraphs = ['# 配套文案（内部草稿 · 待人工审核）', `实际输出：${copy.metadata.requestedTargets.map(t => TARGET_LABELS[t]).join('、')}`];
  for (const [target, value] of Object.entries(copy.copy_outputs)) paragraphs.push(`## ${TARGET_LABELS[target]}\n\n${value}`);
  return `${paragraphs.join('\n\n')}\n`;
}

export async function writeCopy(dir, copy, { compact = false } = {}) {
  await writeJson(path.join(dir, 'copy-outputs.json'), copy);
  if (compact) return;
  for (const [target, value] of Object.entries(copy.copy_outputs)) {
    await fs.writeFile(path.join(dir, `copy_${target}.txt`), `${value}\n`, { mode: 0o600 });
  }
  await fs.writeFile(path.join(dir, 'copy.md'), copyMarkdown(copy), { mode: 0o600 });
}
