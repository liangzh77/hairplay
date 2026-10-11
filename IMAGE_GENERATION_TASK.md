# 发型目录图替换记录

27 张发型目录图已在本机生成并映射到 `client/src/core/catalog.json`：26 张 `ai-catalog-*.jpg` 和一张 `ai-dracula.jpg`。图片位于 `client/src/static/catalog/`；首页默认展示男士分类的 `ai-catalog-53-0.jpg` 和 `ai-catalog-53-1.jpg`，点击「所有风格」可看到顶部的 `ai-dracula.jpg`。原版裁剪图 `catalog-*.jpg` 和 `dracula.jpg` 留在本机，被 `.gitignore` 排除，不纳入公开仓库。`placeholder.svg` 是早期演示记录的对照示意，现已不再被界面引用，也并非 AI 生成。

这些目录照片用于静态发型展示与风格选择，**不是**用户照片的生成结果。用户照片的真实 AI 换发型由服务端代理火山方舟 Seedream 完成（每人终身最多 3 张成功图，失败不扣额度），结果保存在云端账户并在本机保留一份缓存；生成时上传的原照片不落盘、不入库。目录图的重生成方式与提示词记录见 `tools/README.md` 与 `docs/ARK.md`；如要商业使用，需要另行核对供应商授权条款。

本机预览如果仍运行旧的独立 GitHub 克隆，请拉取最新提交后重启服务；本工作目录的修改不会自动同步到那个预览进程。
