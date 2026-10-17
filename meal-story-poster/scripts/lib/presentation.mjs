// Copy and layout share verified facts; decoration never supplies new claims.
export function pagePresentation(facts, template) {
  const period = facts.recordLabel === '今日餐食记录' ? '今日' : facts.multiDay ? '近期' : '';
  const presentations = {
    'meal-overview': {
      title: `${period}食材与餐食记录`, subtitle: '看得见的食材，留得住的一餐日常',
      footer: [['备料实拍', '记录食材的模样'], ['餐食出品', '留存一餐的日常'], ['真实记录', '与家长分享餐食']]
    },
    'ingredient-focus': {
      title: `${period}备料实拍`, subtitle: '从一份份食材开始，记录餐食的日常',
      footer: [['食材记录', '看见备料的模样'], ['照片留存', '留下一份日常'], ['与家长分享', '让餐食记录可见']]
    },
    'meal-focus': {
      title: `${period}餐食出品`, subtitle: '一餐一图，记录餐桌上的家常',
      footer: [['真实出品', '餐食照片实拍'], ['一餐记录', '留存餐食的模样'], ['与家长分享', '看得见的日常']]
    },
    'dining-scene': {
      title: '用餐时光记录', subtitle: '真实现场，留一份日常记录',
      footer: [['现场照片', '留存现场的模样'], ['用餐环境', '记录用餐的空间'], ['日常记录', '与家长分享日常']]
    }
  };
  if (!presentations[template]) throw new Error(`未知模板：${template}`);
  return { brand: facts.brand, ...presentations[template] };
}

export function cardPresentation(asset) {
  const raw = asset.category === 'ingredient';
  const neutral = [raw ? '食材备料' : asset.category === 'dining-scene' ? '用餐环境' : '餐食出品', '实拍记录'];
  let icon = null, lines = neutral;
  if (asset.labelVerified) {
    const label = asset.label;
    if (/番茄|西红柿/.test(label)) { icon = 'tomato'; lines = [raw ? /丁/.test(label) ? '番茄切丁' : /块/.test(label) ? '番茄切块' : '番茄备料' : /蛋/.test(label) ? '番茄与蛋' : '番茄入菜', '实拍记录']; }
    else if (/黄瓜/.test(label)) { icon = 'cucumber'; lines = [raw ? /丁/.test(label) ? '黄瓜切丁' : '黄瓜备料' : /肉/.test(label) ? '黄瓜与肉' : '黄瓜入菜', '实拍记录']; }
    else if (/土豆/.test(label)) { icon = 'potato'; lines = [/丝/.test(label) ? '土豆切丝' : '土豆入菜', '实拍记录']; }
    else if (/红薯/.test(label)) { icon = 'sweet-potato'; lines = [/条/.test(label) ? '红薯切条' : '红薯备料', '实拍记录']; }
    else if (/猪肉/.test(label)) { icon = 'pig'; lines = [raw ? '猪肉备料' : '猪肉出品', '实拍记录']; }
    else if (/汤/.test(label)) { icon = 'soup'; lines = ['汤品实拍', '餐食记录']; }
  }
  // Names alone do not establish freshness, taste, nutrition or pork species.
  if (asset.note) lines = [asset.note];
  return { captionLines: lines, icon };
}
