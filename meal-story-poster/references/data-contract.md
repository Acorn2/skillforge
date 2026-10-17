# 数据契约 1.1

机器校验以 [content.schema.json](content.schema.json) 为准；完整可编辑外形见 [content.example.json](content.example.json)。示例不包含实际照片或有效批准。建议用 prepare 根据扫描结果生成，避免手写错路径。

`prepare` 与 `build` 的 --output 均可省略，自动创建 Skill outputs 下的新批次。build 默认仅落盘中文海报和一份发布文案.txt；返回 output、posters、copy、passed、errors、warnings、bundleDigest。检查在内存执行，不写隐藏目录或报告。

只有显式 `build --keep-state` 才增加一个任务状态.json，内容为 schemaVersion、outputLayout=minimal-v1、inputRoot、content、manifest；content 中的照片路径绝对化并绑定源图 SHA-256，manifest 保留渲染记录。该文件用于事后完整核对，含内部路径和许可信息，不公开分发。无需为普通出图保留。

## 原始素材与建议

`inspect` 递归扫描输入文件夹中的 JPG/JPEG/PNG（忽略隐藏目录、跳过符号链接），上限 30 张，记录尺寸、EXIF 朝向、SHA-256、原路径和重复情况；强制尝试解码。HEIC、GIF、WebP 暂不支持，不暗中转换或使用远程图片。

AI 看图建议为独立文件：

```json
{
  "assets": [
    {"assetId": "src-01", "suggestedCategory": "finished-dish", "suggestedName": "汤品", "uncertain": true, "source": "image-analysis"}
  ]
}
```

assetId 必须对应本次 inspect 的 ID，重复或未知 ID 报错。prepare 导入后所有分类、名称、日期、许可仍待确认；未识别时先归 other。脚本不内置多模态识别，不将概率或文件名当证据。

## 内容字段

文件路径相对 **content.json 所在目录** 解析，必须最终指向 `--input` 内已登记、可解码照片；也支持绝对本地路径。不能用远程 URL。prepare 会记录哈希，素材变更需重新审核。

| 字段 | 意义与默认 |
|---|---|
| schemaVersion | 固定 `1.1` |
| brand.name | 默认三人行托管中心 |
| brand.locationName / locationVerified / siteId | 默认空/false；展示门店还要求被选照片 siteId 全部匹配 |
| record.date / dateVerified / scope | 默认空/false/single-day；支持 multi-day、week 中性时间视角 |
| assets[].category | ingredient / finished-dish / dining-scene / other |
| assets[].categoryStatus | 本实现增加的明确确认状态；默认 needs-confirmation，只有 verified 才参与页面 |
| label / labelStatus | 正式名称；未确认则降级为中性文案 |
| note / noteStatus | 可选短备注，仅确认且不触及 P0 承诺边界时显示；小卡片可省略 |
| capturedAt | ISO 日期或以本地 YYYY-MM-DD 开头的时间；不从 EXIF 推断或确认 |
| sha256 | 可选输入指纹；prepare 自动写入，扫描和渲染前重新核对 |
| publicUsePermission | unverified（默认）/ verified / denied |
| identifiableChildren | unknown（默认）/ yes / no，背影不自动等于 no |
| fit / cropReviewed / position | 食品默认 cover；内部草稿允许待审裁切，公开导出要求 cropReviewed=true；D 默认 contain；支持 centre 和八方向焦点 |
| output.templates | 默认 `["auto"]`；或选 meal-overview / ingredient-focus / meal-focus / dining-scene，auto 不能混用 |
| output.width / height | P0 固定 1080 / 1440，不支持伪拉伸变体 |
| output.format / jpegQuality | png 默认；jpg 表示在 PNG 外额外输出 JPG，质量默认 90、范围 88～92 |
| output.fontFile / fontFamily | 可选合法本地中文正文字体；自定义时必须一起填写；展示字体内置，无运行时下载 |
| diningScene.enabled / assetIds | 默认 false/[]，尝试 D 的候选白名单；仍需单图及全局公开许可 |
| copy.targets | 默认五类；显式选择只产出所选文字 |
| approval | 人工批准输入的兼容字段；build 不据此自动公开，正式复制还需绑定摘要的独立批准文件 |

未支持字段会由 Schema 拒绝，以避免拼写错误静默失效。原规格中的单布尔 consent 不作为有效权限模型。

## 隐私审查记录

每张公开海报照片需要 `publicUsePermission=verified`，并且人工确实检查后填写：

```json
{
  "identifiableChildren": "no",
  "publicUsePermission": "verified",
  "privacyReview": {
    "reviewedBy": "实际审核人代号",
    "reviewedAt": "2026-10-16T10:00:00+08:00",
    "risksChecked": true,
    "identifiablePeople": "no",
    "sensitiveInfo": "no",
    "subjectCount": 0,
    "subjects": []
  }
}
```

以上只是字段示例，不得自动复制成真实审核结论。若有人可识别，identifiablePeople 为 yes，subjectCount 必须匹配 subjects 的唯一主体数。每个主体记录至少包括：

```json
{
  "subjectId": "私有主体代号",
  "isMinor": true,
  "permission": "unverified",
  "guardianPermissionVerified": false,
  "channels": ["wechat_moments"],
  "purpose": "meal-story-publicity",
  "validUntil": "2026-12-31"
}
```

未成年人必须核实监护人许可；渠道必须覆盖实际公开用途、权限未过期、人工审查时间有效，任何 unverified/denied 均不放行。D 另外要求 `diningScene.publicUsePermission=verified`。记录仅保存在私有目录，不写入图片、公开文案和公开清单。

## 人工批准与公开导出

1. 需要公开导出时以 build --keep-state 生成；查看 PNG、汇总文案、命令返回的检查结果和原图，按事实/隐私规则完成审核。
2. `validate --output 批次目录` 重新验证，取得命令返回的 bundleDigest（verification 必须为 full）。
3. 基于用户对该批内容的明确批准，填写 [publication-approval.example.json](publication-approval.example.json) 的 contentApproved/publicReleaseApproved、真实 approvedBy、带时区的 approvedAt、上述 reviewedDigest、用途和实际 channels。没有人工许可时保持 false/null。
4. export 重新检查源图哈希、当前授权、QA、摘要和渠道，复制到新的独立目录。照片或文案变化时旧摘要失效，需重新生成/审核。

build 永远不会自动标记正式发布。新批次公开目录仅含生成的海报、发布文案.txt、无隐私来源的 publication-manifest.json。源素材路径、权限记录与渲染数据仅保存在可选任务状态中；兼容旧 private/.internal 批次原结构；公开导出不等于向社交平台发布。
