# 发型目录图替换记录

27 张发型目录图已在本机生成并映射到 `client/src/core/catalog.json`：26 张 `ai-catalog-*.jpg` 和一张 `ai-dracula.jpg`。图片位于 `client/src/static/catalog/`；首页默认展示男士分类的 `ai-catalog-53-0.jpg` 和 `ai-catalog-53-1.jpg`，点击「所有风格」可看到顶部的 `ai-dracula.jpg`。原版裁剪图 `catalog-*.jpg` 和 `dracula.jpg` 留在本机，被 `.gitignore` 排除，不纳入公开仓库。`placeholder.svg` 仍用于演示记录的对照示意，并非 AI 生成。

这些目录照片仅用于静态发型展示。**应用并未接入用户照片的真实 AI 换发型服务**；演示模式生成记录也不代表用户照片经过 AI 处理。图片生成模型和授权条款未在本仓库留存供应商记录；如要商业使用，需要另行核对。

本机预览如果仍运行旧的独立 GitHub 克隆，请拉取最新提交后重启服务；本工作目录的修改不会自动同步到那个预览进程。
