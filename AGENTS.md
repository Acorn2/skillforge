# Skillforge

这是可复用 Codex Skill 集合，每个根级业务子目录对应一个独立 Skill。不要将实现放入 `.agents/skills/`，不要在本仓库任务中自动安装到用户全局 Skill 目录。

- `meal-story-poster/`：真实餐食照片 → 确定性静态海报、一份五类汇总文案；默认不落盘技术记录，显式 --keep-state 才增加一个任务状态文件。
- 业务脚本、资源和依赖留在所属 Skill 中，根目录不建立共享运行框架。
- 当前验证：`cd meal-story-poster && npm test`；Skill 元数据用 Codex 自带 `quick_validate.py` 验证。
- 原图、授权记录和生成目录不入库。测试仅生成明确标识的合成几何图，不冒充真实餐食或儿童现场。
- 不能从 AI 建议、布尔授权或生成成功推断可公开发布。修改事实、隐私、公开导出逻辑时，必须运行相关失败路径测试。
