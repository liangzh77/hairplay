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

## 测试

在仓库根目录执行：

```bash
npm run typecheck          # vue-tsc
npm test                   # 客户端单测 + 服务端测试
npm run test:browser       # 真实 Chrome 端到端（需先 build:public）
npm run test:browser:live  # 部署后的线上复核（需要网络，只读）
```

`client/tests/browser/` 里的脚本用真实 Chrome 驱动**已构建的 H5 产物**（或线上站点），覆盖单测无法证明的行为：两个标签页同时删除时的 Web Locks 串行化与「过期快照不复活」、无 Web Locks 时的 fail-closed、Service Worker 图片缓存与 hash URL 绕开旧 HTTP 缓存、回滚用的 reset worker、生成图片不进公开缓存、窄屏布局、以及与线上一致的功能冒烟。

离线脚本会在临时端口上自己起静态服务器（stub 掉 `/api/*`，**不调用真实生成服务、不发邮件、不写服务器**），先 `npm --workspace client run build:public` 生成被测产物。Chrome 按顺序查找：`$HAIRPLAY_CHROME`、`$CHROME_PATH`、系统常见安装路径、Playwright 的 `channel: 'chrome'`；`HAIRPLAY_HEADED=1` 可看着它跑，`HAIRPLAY_BASE=<url>` 可指向预览环境。依赖是 `playwright-core`（不下载浏览器）。
