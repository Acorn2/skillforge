// 海报上的菜名是一枚单行徽章，宽度由卡片列数决定：列数越多，能放的字越少。
// 这里把「照片张数 → 列数 → 最大字数」的推导集中到一处，
// 前端实时提示和后端校验共用同一份规则，避免两边判断不一致。

const GAP = 16;
const SIDE_PADDING = 40;
const MIN_FONT = 30;

export const maxWidthFor = columns =>
  Math.floor((1016 - GAP * (columns - 1)) / columns) - SIDE_PADDING;

// 30px 中文约 30px 宽，实测会少掉 7px 左右的行首留白。
export const charsFor = columns =>
  Math.max(4, Math.floor((maxWidthFor(columns) + 7) / MIN_FONT));

const overviewCols = n => (n <= 4 ? n : 3);
const mealFocusCols = n => (n === 5 ? 3 : n <= 3 ? n : n === 4 ? 2 : 3);
const sceneCols = n => (n <= 3 ? n : n === 4 ? 2 : 3);

// 同一张照片可能同时出现在综合页和详情页，取列数多的那个（约束更紧）。
export function columnsFor(counts) {
  const ingredient = counts.ingredient ?? 0;
  const meal = counts['finished-dish'] ?? 0;
  const scene = counts['dining-scene'] ?? 0;
  return {
    ingredient: ingredient > 0 ? overviewCols(ingredient) : 0,
    'finished-dish': meal > 0
      ? (ingredient > 0 ? Math.max(overviewCols(meal), mealFocusCols(meal)) : mealFocusCols(meal))
      : 0,
    'dining-scene': scene > 0 ? sceneCols(scene) : 0
  };
}

export function limitsFor(counts) {
  const columns = columnsFor(counts);
  const limits = {};
  for (const [category, value] of Object.entries(columns)) {
    limits[category] = value ? charsFor(value) : 0;
  }
  return limits;
}

// 中文约 29px、英文数字约 15px（30px 字号下），按 1 : 0.5 折算。
export function unitsOf(text) {
  let units = 0;
  for (const char of String(text ?? '')) {
    units += /[\u2e80-\u9fff\uff00-\uffef]/.test(char) ? 1 : 0.5;
  }
  return units;
}

export function fitsLabel(text, limit) {
  return unitsOf(text) <= limit + 0.001;
}
