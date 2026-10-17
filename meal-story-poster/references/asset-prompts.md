# 内置视觉素材

这些文件是背景或装饰，不是机构食物、采购、儿童现场或食品质量的证据。生产 build 只读本地素材，不联网生成图片。食物照片始终来自用户登记原图。

## 植物背景

- 文件：`assets/botanical/background.png`。
- 来源：2026-10-17，通过内置 `image_gen.imagegen` 生成；以用户的综合参考海报作为风格编辑输入，不裁取其中菜品。
- 模式：参考图编辑，输出不透明 3:4 背景。
- 定稿提示词：

```text
Use case: ads-marketing. Create a reusable EMPTY botanical background,
portrait 3:4, for a Chinese childcare meal-record poster matching the
reference's green botanical warmth. No words, letters, numbers, food, dishes,
people, cards, grid boxes or logos. Top 22%: deep leafy forest-green painterly
bokeh with an uncluttered dark center for a white headline. Below 22%:
luminous pale spring-green and cream wash, small leaf branches at the bottom
corners, clean center for real photographs and cream cards. Watercolor/gouache,
dimensional natural leaves, soft paper texture. No sun icon; that is composed
separately by the renderer.
```

## 透明装饰插画

- 源图：`assets/botanical/sticker-atlas.png`；透明，3 列 × 2 行。
- 来源：2026-10-17，通过内置 `image_gen.imagegen` 生成的独立装饰贴纸图集。
- 模式：新建透明背景图集。
- 定稿提示词：

```text
Create six isolated watercolor/gouache sticker illustrations on a truly
transparent background, arranged in a 3-column, 2-row atlas with generous
clear padding. Top row: red tomato with a cut half; green cucumber with
round slices; golden potato. Bottom row: sweet potato with an orange cut
face; friendly pink cartoon pig; orange bowl of generic soup with steam.
Dimensional, warm, playful, suitable for a Chinese childcare meal poster.
No words, labels, letters, numbers, grid lines, photographs or background.
These are small decorative illustrations, not replacements for meal photos.
```

- 本地按透明连通区域拆出 tomato/cucumber/potato/sweet-potato/pig/soup.png，裁剪框记入 `crops.json`。边缘只做透明区域分离，不修改真实照片。
- 插画只在已核实名称对应时选用。未知肉类不匹配猪；未知食材用通用叶片图标。通用汤碗不表示汤的具体原料。

## 中文展示字体

- `assets/fonts/MaShanZheng-Regular.ttf`：Ma Shan Zheng Regular；[Google Fonts 项目](https://github.com/google/fonts/tree/main/ofl/mashanzheng)。
- 字体文件来自 [Google Fonts 静态字体资源](https://fonts.gstatic.com/s/mashanzheng/v18/NaPecZTRCLxvwo41b4gvzkXaRMQ.ttf)，依据官方 CSS 中的完整 TTF 地址下载。
- SIL Open Font License 1.1，原版权与许可证完整保存在 `assets/fonts/OFL.txt`，分发时必须一起保留。许可证来源为官方 Google Fonts 仓库 `ofl/mashanzheng/OFL.txt` 的 CDN 镜像。
- 只供标题、标签和短句；正文仍使用本机合法中文字体。Pango 进程使用 Fontconfig 后端和 Skill 内的配置；不全局安装字体、不修改系统配置。
