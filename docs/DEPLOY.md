# 有型（HairPlay）发布

公开地址：<https://liangz77.cn/hairplay/>。静态 H5 前端 + 独立服务端邮箱验证码登录（最多 100 个验证用户）和 Ark 图生图（每人终身最多 3 张成功图，失败不扣）；演示模式不上传照片。无支付。小程序仅做编译检查，邮箱登录/真实生成尚未接入且未真机验收。

## 本地构建检查

```sh
npm ci
npm run typecheck
npm test
npm run test:dev-security  # Vite 5.4.21 /@fs、?import&raw、伪造 Host、CORS 泄露回归
npm --workspace client run build:public
npm --workspace client run build:mp-weixin
```

`build:public` 使用 `/hairplay/` 作为资源前缀。`client/scripts/check-public-build.mjs` 对静态资源执行 SHA-256 白名单校验，移除 uni-app 从本机复制的**已知名称**研究图，并对未知静态文件、macOS `._*` 元数据和 source map 拒绝发布、删除不合格产物。请勿将 `hairai-study/`、原始截图、`catalog-*.jpg` 或 `dracula.jpg` 手动复制到产物中；建议在 Git 干净导出的目录重建。

打包用 `bash scripts/package-release.sh client/dist/build/h5 /tmp/全新输出目录`，得到 `release.tgz` 与逐文件 SHA-256 `manifest.json`；此脚本只做本地校验打包，**不执行部署**。`scripts/release.py` 会拒绝多余文件、macOS AppleDouble、符号链接、路径穿越和未经批准的元数据；不要用 macOS `tar -czf` 代替（它可能添加 `._*` 资源叉，先前线上 51 个此类文件已清理）。Linux 服务器上的 `scripts/release-remote.sh` 支持按版本清单验证、原子 `mv -T` 切换及失败回滚；使用前检查路径、发布清单、Caddy 配置及相关参数。`python3 scripts/test_release.py` 与 Linux 上的 `python3 scripts/test_atomic_switch.py` 可复验打包和切换逻辑。

## 服务器位置与路由

参考 `go-sites/Caddyfile`：`/hairplay` 永久重定向到 `/hairplay/`；`handle /hairplay/api/*` 只代理至本机 `127.0.0.1:8777`，并由 Caddy **覆盖** `X-Real-IP`（用于邮箱/IP限流）；`handle_path /hairplay/*` 静态读取 `/srv/sites/liangz77.cn/hairplay/current`，与主站 `/srv/sites/liangz77.cn/current` 及 `/fleeting/` 相互独立。发布目录为 `hairplay/releases/<版本>`，`current` 是指向版本目录的软链接。目录权限 755、文件 644；不对目录执行递归 `chmod 644`。

2026-10-09 首次发布版本：`20261009T034347Z`（已移除 macOS 归档产生的 `._*` 文件，并在修正发布流程后通过线上 46 文件 SHA-256 校验）。对应 Caddy 配置备份：`/etc/caddy/sites-enabled/liangz77.cn.caddy.bak-before-hairplay-20261009T034347Z`。远端 Caddy 总入口为 `/etc/caddy/Caddyfile`，站点配置在 `/etc/caddy/sites-enabled/liangz77.cn.caddy`。配置变更前备份、`caddy validate --config /etc/caddy/Caddyfile` 验证后用 `systemctl reload caddy` 平滑重载；失败时恢复旧配置和旧软链接。要撤销路由，恢复配置备份并验证、重载；要回退静态文件，将 `current` 原子切到前一个已验证版本并探活。任何回滚都先确认路径和实际软链接目标。

2026-10-09 邮箱登录/图生图发布：静态与 API 版本 `20261009T124822Z`；`hairplay-api.service` 仅监听 127.0.0.1；后端代码与 Linux `sharp`/`nodemailer` 在 `/opt/hairplay/current -> releases/20261009T124822Z`；持久额度库在 `/var/lib/hairplay/auth.sqlite`（hairplay:hairplay 0600），SMTP/Ark 凭据在 `/etc/hairplay/{mail,ark}.env`（目录 0700、文件 0600，绝不在静态目录/Git）。服务端服务用户 `hairplay`，`ProtectSystem=strict`，仅可写其持久目录。Caddy 本次备份 `/etc/caddy/sites-enabled/liangz77.cn.caddy.bak-before-hairplay-api-20261009T124822Z`，API 代理位于静态路由之前。已验证 SMTP 465 TLS 身份和实际自发自收请求返回 SMTP accepted；**邮箱收件箱实际收到与否尚未人工核对**。禁止为了测试使用真实私人照片/付费生成；用假邮件+假 Ark 的自动化测试覆盖登录/额度。

2026-10-09 登录界面修复版本：静态与 API `20261009T134649Z`，此前回退版本均为 `20261009T124822Z`。修复注册引导、空字段反馈和快速点击时 uni-input 模型更新延迟；删除个人资料页两段冗长内部说明。API 更新前后 `/var/lib/hairplay/auth.sqlite` inode 一致，未重置账号/额度；静态 46 文件线上哈希一致。

2026-10-10 性别/样图/缓存版本：静态与 API **`20261010T005434Z`**，前版本 `20261009T134649Z`。公开目录已打开图片（包括画廊下载）在 `/hairplay/` 作用域的 Service Worker CacheStorage 按需保存，图片 URL 带已批准 SHA 前缀保证替换不误读旧 HTTP 缓存；个人上传照及 API 不缓存。注册性别选填男/女/不填写，老用户迁移为未知；未知时首页右上角用女款「许士剪」，男款用「发际纹身渐变」；脏辫/班图结样图重新文字生成亚裔成人示例（见 `docs/ARK.md` 的哈希）。主站隐私政策版本 v1.1 位于单独站点发布 `20261010-hairplay-cache-gender-privacy`，原主站发布 `20261009-221855` 仍保留。切换前数据库经 SQLite `.backup` 复制到仅 root 可读的 `/var/lib/hairplay/backups/auth-before-gender-20261010T005434Z.sqlite`；数据库 inode、0600 权限及登录额度均未重置；公开静态 47 文件哈希逐一验证，API 仍仅绑定回环地址。**真人邮箱投递/真人验证码登录仍需用户自行在网页确认，不要把验证码发送给助手。**

2026-10-10 首页默认分类调整：仅静态 H5 发布 `20261010T025546Z`（默认「所有风格」，未选择/未知性别仍显示女款示例）；API **保持** `20261010T005434Z`，主站隐私仍为 `20261010-hairplay-cache-gender-privacy`，SW 文件哈希未变。回退这个首页小改动可直接切回静态 `20261010T005434Z`，不需要改 API/数据库；公网 360/390 宽度与 47 文件哈希均验收。

**图片缓存版本回退特别注意：**浏览器已安装的 Service Worker 不会因为旧静态版本缺少 worker 文件而自动注销。不要直接把 `current` 切到无 worker 的旧目录。已从验证过的 `20261009T134649Z` 克隆出回退目录 **`releases/20261010T005319Z`**（`manifest=/tmp/hairplay-static-20261010T005319Z.manifest.json`），仅在同一 `/hairplay/hairplay-images-sw.js` 路径添加了取消注册/清空公开图缓存的 reset worker；历史目录不改。回滚本次功能时，静态用 `scripts/release-remote.sh switch 20261010T005319Z <上面的manifest> /tmp/release.py`（它会阻止直接切换无 SW 旧版），API 原子切回 `releases/20261009T134649Z` 并重启服务；主站隐私文案原则上保留（新性别字段仍在 DB，即使旧 API 暂不使用）。任何图片修改都更新 `public-assets.json` 并重新构建；若再次从无 worker 版本发布新 worker，必须设置 `HAIRPLAY_CACHE_RESET_RELEASE_ID`、`HAIRPLAY_CACHE_RESET_MANIFEST`、`HAIRPLAY_CACHE_RESET_SHA256`，供发布失败自动回退。Linux 隔离测试 `scripts/test_remote_cache_rollback.py` 覆盖 deploy/switch、强制 HTTP 失败、JSON 转义键、优化 Python 和禁止回退无 SW 的路径。

**回滚顺序：**先原子切回以前经校验的静态发布（有缓存版本需用带 reset worker 的回退克隆；无缓存的历史版本为 `20261009T034347Z`），再从备份恢复 Caddy 站点配置、验证 `caddy validate --config /etc/caddy/Caddyfile` 并 `systemctl reload caddy`，最后 `systemctl stop hairplay-api.service`。不要删除 `/var/lib/hairplay` 用户/额度数据库，也不要递归改密钥权限；恢复前核对服务器当前 `current` 链接及 Caddy 内容，避免覆盖他人后续改动。若只是回滚后端，需保留 `/hairplay/api/*` 代理或同时回滚前端，禁止指向失效 API。额度账本和发信账号复用前需评估风险。

上线检查：`/hairplay/`、CSS/JS、三张首页 AI 目录图 200；`/hairplay` 301；原始研究图及不存在的文件 404；真实浏览器首页、分类和详情加载无跨前缀请求或控制台错误；主站 `/`、`/private`、`/fleeting/` 不受影响。
