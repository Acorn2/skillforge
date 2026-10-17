# Skillforge

可复用 Codex Skill 集合。每个根级业务子目录是一份可以独立复制、维护和安装的 Skill，脚本与依赖留在各自目录。

| Skill | 能力 | 入口 |
|---|---|---|
| meal-story-poster | 真实餐食照片生成绿叶手写风格品牌海报、五类文案与私有审核报告 | [SKILL.md](meal-story-poster/SKILL.md) |

本地使用：

```bash
cd meal-story-poster
npm ci
node scripts/meal-story-poster.mjs --help
npm test
```

在 Codex 中可直接要求「读取本仓库 `meal-story-poster/SKILL.md` 并执行」。独立分发时复制完整子目录，保留 `package-lock.json`、`assets/` 内背景/插画/字体及其许可证，在目标目录执行 `npm ci`。本仓库不会自动修改用户全局 Skill 配置。

测试真实照片时只需提供照片文件夹。Skill 自动在自身 outputs 下新建批次。默认只留下中文海报与一份发布文案.txt：标准九图总共 4 个文件，没有隐藏记录、HTML 或重复文案格式。生成时在内存检查事实、排版、源图和权限；只有明确需要事后完整复核时，才用 --keep-state 额外保存一个任务状态.json。历史批次不自动清理。

调用时可明确写「顶部机构名称：三人行托管中心」。该名称会完整显示在每张海报的深绿色品牌区，并统一用于文案。可复制的完整指令见 [输入指南](meal-story-poster/references/input-guide.md)。

合成图流程预览：`npm run demo`。输出路径写入 `meal-story-poster/outputs/latest-demo.json`，所有测试图明确标注为非真实餐食，不能作为宣传材料。实际素材、许可记录与输出不入库。
