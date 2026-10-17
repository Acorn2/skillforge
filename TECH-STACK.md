# 技术选择

选择 Node.js >=22、ES modules、原生文件与测试 API；运行依赖仅 `sharp@0.35.5` 和 `ajv@8.20.0`，由 Skill 自己的 lockfile 固定版本。无服务端、浏览器安装、外部 AI API 或运行时网络请求。

比较：

| 方案 | 优点 | 成本 / 取舍 |
|---|---|---|
| Sharp + 本地文字排版（采用） | 单一图像管线，支持 EXIF、ICC、PNG、中文文字实际测量，输出易校验 | 栅格由脚本维护，字体环境需要显式检查 |
| HTML/CSS + Playwright | 复杂页面排版和浏览器预览成熟 | 增加浏览器二进制及版本维护，P0 静态卡片不需要 |
| React / Remotion still | 未来视频组件可复用 | 当前没有视频需求，依赖与渲染链路更重 |

Sharp 使用保持比例的 contain/cover，不使用 fill。食品近景默认 cover 内部预览，公开导出要求逐素材审核裁切；场景默认 contain；转换 sRGB、剥离源 EXIF。中文经 Pango 渲染成真实像素后检查尺寸，字号不能通过无限缩小绕过溢出。

中文正文字体读取本机合法安装的字体，或用户提供的 `output.fontFile` + `output.fontFamily`。展示字体随 Skill 分发并保留 SIL OFL 许可证；Pango 使用 Fontconfig 后端以修复 macOS 忽略应用字体、回退黑体的问题。植物背景和装饰插画预先生成并保存在 Skill 内，生产运行无需生图服务；来源见 `references/asset-prompts.md`。macOS 自动尝试冬青黑体，Linux 尝试 Noto CJK，Windows 尝试 Microsoft YaHei；缺失则清晰报错。

Sharp 为 Apache-2.0，Ajv 为 MIT；图像底层原生库随包维护其各自许可。仅安装项目本地依赖，不修改全局系统环境。

选型依据：[Sharp 图片缩放](https://sharp.pixelplumbing.com/api-resize/)、[Sharp 文字输入](https://sharp.pixelplumbing.com/api-constructor/)、[Sharp 输出](https://sharp.pixelplumbing.com/api-output/)。安装时需取得适合目标平台的原生依赖，离线运行需先完成 `npm ci` 和字体准备。
