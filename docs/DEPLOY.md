# 有型（HairPlay）发布

公开地址：<https://liangz77.cn/hairplay/>。静态 H5 前端 + 独立服务端邮箱验证码登录（最多 100 个验证用户）和 Ark 图生图（每人终身最多 3 张成功图，失败不扣）；上传时只把照片发送一次、原照片不落盘不入库，生成结果保存在云端账户并在本机保留一份缓存（删除会同时删除云端副本），收藏的模板在登录后与账户同步，退出仅隐藏账户相册与账户收藏，不删除云端数据；未登录新添收藏和未关联账户的历史生成记录只存本机。无支付。小程序仅做编译检查，邮箱登录/真实生成尚未接入且未真机验收。

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

打包用 `bash scripts/package-release.sh client/dist/build/h5 /tmp/全新输出目录`，得到 `release.tgz` 与逐文件 SHA-256 `manifest.json`；此脚本只做本地校验打包，**不执行部署**。`scripts/release.py` 会拒绝多余文件、macOS AppleDouble、符号链接、路径穿越和未经批准的元数据；不要用 macOS `tar -czf` 代替（它可能添加 `._*` 资源叉，先前线上 51 个此类文件已清理）。Linux 服务器上的 `scripts/release-remote.sh` 支持按版本清单验证、原子 `mv -T` 切换及失败回滚；使用前检查路径、发布清单、Caddy 配置及相关参数。`python3 scripts/test_release.py` 与 Linux 上的 `python3 scripts/test_atomic_switch.py` 可复验打包和切换逻辑。`scripts/release.py` 的 `--kind static|api` 覆盖两种发布物：静态用 `pack`/`verify-archive`/`verify-http`，API 用 `pack-api`/`verify-api-release`（见下节）。

## API 发布（`scripts/deploy-api.sh` + `scripts/release-api-remote.sh`）

后端不是纯静态文件：发布树里除代码外还有依赖 `node_modules/`、软链接 `.data -> /var/lib/hairplay`（额度/相册 SQLite）和 `.secrets -> /etc/hairplay`（SMTP/Ark 凭据）。所以 API 走独立发布通道；**发布包只含已提交的后端源码**，绝不包含依赖、数据库或密钥。允许清单是**显式白名单**（`scripts/release.py` 的 `API_ALLOWED`）：四个后端模块 `server/{ark,auth,auth-worker,mail}.mjs`、目录索引 `client/src/core/catalog.json`、目录图片 `client/src/static/catalog/*.jpg` 与 `package.json`/`package-lock.json`——共 34 个文件（27 张图 + 索引 + 4 个模块 + 2 个清单）。测试文件（如 `server/ark.test.mjs`）、前端页面/平台源码、`.svg` 与任何未知文件都会被拒绝，而不是被默默收进包里。`pack_api` 与 `manifest(...,'api')` 共用同一条规则，分别报 `Unapproved API file: …` 和 `Unapproved API path: …`；此外仍拒绝 `node_modules/`、`.data/`、`.secrets/`、`.git/`、点号开头的组件与 `*.sqlite*|*.env|*.log|*.pem|*.key|*.tgz` 等后缀。`verify_api_tree` 另外拒绝符号链接或缺失的发布目录（`node_modules` 与 `.data`/`.secrets` 两条运行时软链接除外）。

本地（macOS，需要干净的 `server/`、`client/src/`、`package.json`、`package-lock.json`）：

```sh
scripts/deploy-api.sh <版本号> [switch]   # 版本号形如 20261011T012345Z；switch 只切换已存在的版本
```

它用 `git archive --format=tar HEAD package.json package-lock.json server/ark.mjs server/auth.mjs server/auth-worker.mjs server/mail.mjs client/src/core/catalog.json client/src/static/catalog ':(exclude)client/src/static/catalog/placeholder.svg' | tar -x -C <tree>` 取**已提交**树的**显式路径列表**（后端有未提交改动会直接拒绝发布；`placeholder.svg` 只在 H5 产物里用，不进 API 包），本地跑 `python3 scripts/release.py pack-api` 生成 `release.tgz` + 逐文件 SHA-256 清单并 `verify-archive --kind api` 自查，把包上传到远端 `/tmp/hairplay-api-deploy-<id>`，再对比本地与远端的 `release.py`／`release-api-remote.sh` SHA-256；两者不一致就拒绝发布（远端执行的是远端那份检查器，必须逐字节相同），一致才调用远端脚本。

远端 `/opt/hairplay` 布局：`releases/<id>/`（`server/`、`client/src/`、`package.json`、`package-lock.json`、`node_modules/`，以及 `.data`/`.secrets` 两条软链接）、`current -> releases/<id>`、`.publish.lock`。`scripts/release-api-remote.sh deploy <id> <manifest> <checker> <archive>` 的顺序：

1. `flock -n .publish.lock`（并发发布直接失败），`verify-archive --kind api` 校验发布包；已存在的版本目录拒绝覆盖。
2. 逐成员复制到 `releases/.staging-<id>.XXXX`（**不用 `tar extractall`**），`verify-tree --kind api` 校验，然后目录 755、文件 644。
3. 链接 `.data`/`.secrets`；`package-lock.json` 与上一版逐字节相同则 `cp -a` 复用旧 `node_modules`，否则 `npm ci --omit=dev --no-audit --no-fund`。
4. 切换前冒烟：`node -e "import('./server/ark.mjs')"` 必须导出 `createApp` 且无副作用。
5. 仅 root 可读的数据库备份 `sqlite3 /var/lib/hairplay/auth.sqlite ".backup '/var/lib/hairplay/backups/auth-before-api-<id>.sqlite'"`（0600 root:root）。
6. 原子 `mv -Tf` 切换 `current`，`systemctl restart hairplay-api.service`，再探活 20×1 s：`curl http://127.0.0.1:8777/hairplay/api/session` 必须 HTTP 200，且响应体的原始 **16 字节**与 `{"account":null}` 完全相同（curl 写临时文件，用 `cmp` 比较；拒绝 NUL/换行等后缀，不将响应体放进 bash 变量），且 `SELECT count(*) FROM users` 与切换前一致（仅证明用户行数未变，不替代额度内容验证）。任何一步失败即切回旧版本、重启、重新探活，并打印 `API_PUBLISH_ROLLED_BACK current=…`。

`switch <id> <manifest> <checker>` 只做「校验目标发布树 → 原子切换 → 重启 → 探活」，用于回滚。旧版本目录和失败目录都保留（失败时给出路径便于排查），**同一版本号不能重复发布**，重发必须换新 id。`HAIRPLAY_API_ROOT|DATA|SECRETS|RESTART|HEALTH` 只用于隔离演练（`python3 scripts/test_api_remote_publish.py`，Linux 上跑，共 53 项断言：happy publish、覆盖拒绝、错误响应体/多一行/NUL 后缀/尾随换行/尾随空行/非 200 健康失败回滚、依赖重装、备份与软链接、篡改包与含密钥清单拒绝、switch 回滚/前滚等），**禁止在生产主机上设置**。演练里的 stub 服务把 stub restarter 写进健康文件的**原始字节**直接吐回来，所以演练验的是发布脚本真正看到的响应；注意 stub restarter 的 `case` 模式必须写成 `"$broken")` 这类单个带引号展开——`"releases/""$id"")` 在 bash 5.2 上会因为空串引号导致模式永不匹配并静默落入健康分支，使这些断言全部失效。

信号回归另运行 `python3 scripts/test_api_remote_signals.py`（Linux，仅临时目录，须与主发布演练一样的依赖/权限）：用完整 publisher 验 PID TERM 与进程组 TERM/HUP/INT 四例，均须拒绝、回滚、保留失败树且清理健康临时文件。发布脚本显式 signal→rollback，不依赖被中断子进程的 ERR；测试子进程重置默认信号，避免 nohup 的 inherited ignore 令 HUP/INT 探针无效。53 项主演练与这 4 例分别计数。

`/hairplay/api/*` 之外没有 `/health` 路由（直接访问 404），线上健康检查只认 `/hairplay/api/session`。发布顺序固定为**先 API、后静态**：旧前端会忽略新增的响应字段，而新前端依赖新的 `POST /api/gallery/*`，先发 API 才不会出现 404 窗口。

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
