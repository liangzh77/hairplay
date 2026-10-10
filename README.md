# HairPlay — AI 换发型（H5 / 微信小程序）

**有型（HairPlay）**：移动优先的发型网页演示，uni-app + Vue 3 + TypeScript 一套代码输出微信小程序与 H5。公网提供 AI 目录图片和邮箱验证码登录试用：最多 100 个已验证邮箱，每个账户终身最多 3 张成功生成（失败和演示不扣），额度由服务端 SQLite 持久化。**真实生成消耗云端额度；小程序登录及真实生成尚未接入。** H5 的公开目录图片按需在浏览器持久缓存，私人照片和生成结果不缓存；注册性别选填，仅决定「所有风格」右上角示例，未知时显示女款。

线上演示：https://liangz77.cn/hairplay/

- 源码：`client/`
- 项目说明与目录结构：`docs/PROJECT.md`
- 命名：`docs/NAME.md`
- 发布及回滚：`docs/DEPLOY.md`
- 邮箱登录与火山方舟接入：`docs/ARK.md`（密钥、邮箱数据库不进入仓库或静态前端构建）
- 发型示例图：`client/src/static/catalog/ai-*.jpg`（AI 生成的静态目录示例，不是用户照片生成结果）

本机后端须先配置 owner-only 的 `.secrets/ark.env` 与 `.secrets/mail.env`，再 `npm run dev:api`。使用 Node 22.23+（`node:sqlite`），本地 H5 建议端口 8767，详细启动与安全说明见 `docs/ARK.md`。

```bash
cd client
npm install
npm run dev:h5
```
