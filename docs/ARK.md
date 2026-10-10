# 火山方舟本机试用

火山方舟 Seedream 4.5 图生图已用两张**项目自有 AI 目录样图**跑通：开发环境密钥成功列出模型，`POST /api/v3/images/generations` 返回有效 JPEG；本机浏览器确认“取消”不发送照片，“确认上传并生成”才调用接口并显示图片。**未用私人照片测试。**输出效果属实验性质，人物五官不保证完全保真。

## 公开样图与个人资料补充

目录里的 `ai-catalog-55-0.jpg`（脏辫）和 `ai-catalog-55-1.jpg`（班图结）已用项目开发 Ark 密钥从文字提示生成全新的**虚构成年亚裔面孔**示例，再去元数据转 JPEG；没有提供原人物照片、私照或外部照片给上游。两张新文件 SHA-256 分别为 `fe4f0ef65c0cbf2ab3fe9fe2364f8680abd81b318cfc88b1b079ec07201c7ae0` 和 `1bbd8fc0d87092ec13e9be7f459b8b095489ea6fefd9930498ccf425cc6050af`；批准哈希见 `client/scripts/public-assets.json`。AI 图片不代表真实顾客、真人或服务实际试戴结果。

H5 注册可选男/女/不填写，性别仅写入受限的服务端账户数据库，用于「所有风格」右上角公开示例；既有账户迁移为未知，未知显示女款、男显示「发际纹身渐变」、女显示「许士剪」。用户可以登录后改选或清空；不根据上传照片推断。已浏览的公开发型示例与图标可在浏览器 CacheStorage 持久缓存；API、用户照片及 AI 结果不进入图片缓存。主站隐私政策同步说明。

## 本机启动

凭据仅在项目根目录 `.secrets/ark.env`，权限 600、Git 忽略。已从 WiseCut 的**开发环境** Ark Key 初始化；切勿将密钥写入 `client/`、`VITE_*` 环境变量、前端包、README、日志或公网站点。可用的配置格式（值为占位符）：

```dotenv
VOLCENGINE_ARK_API_KEY=your-dev-only-key
VOLCENGINE_ARK_MODEL=doubao-seedream-4-5-251128
VOLCENGINE_ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
```

分别启动 `npm run dev:api`（仅绑定 `127.0.0.1:8777`）与 H5 开发服务器 `cd client && ../node_modules/.bin/uni --host 127.0.0.1 --port 8767 --strictPort`。打开 http://127.0.0.1:8767/，在「个人资料」用邮箱验证码登录；然后选照片和发型，不勾选演示模式，点击生成，再**明确确认**照片将上传至火山方舟。验证码由服务器上的 SMTP 发出；`.secrets/mail.env` 是仅本机使用的 0600 文件，临时复用用户授权的 WiseCut 生产监控发信账号，绝不能入 Git/前端。SMTP 465 强制 TLS 和证书校验，服务端验证码发送冷却、每 IP/邮箱限流、服务器每小时限发。已向发件邮箱自身发一封测试验证码并得到 SMTP 接受回执，**尚未验证收件箱投递**。上传前浏览器先将可解码的照片缩至最长边 2048 像素并重新编码为真正的 JPEG，避免部分手机“文件名/MIME 写着 JPG、实际字节不是 JPEG”的错误，同时不把原始 EXIF/GPS 元数据发给服务。请求通过 Vite 开发代理到本机服务，Key 不返回给浏览器。生成结果会自动保存到**本机浏览器**的相册「我的生成」（localStorage 键 `hairplay.generations.v1`，最多 6 张，写入前用 canvas 缩到最长边 1080 像素并重编码为 JPEG，单张上限约 1.6 MB；读写两端用同一套便宜的**结构**校验（不是完整 JPEG 解析）：以 JPEG SOI 开头、紧跟着一个编码器真正会写在最前面的段（APPn/COM/DQT/DHT/SOF）且其声明的段长合理、并以 EOI（FF D9）结尾；因此 `FF 00` 填充字节、`FF 02` 保留码、零长度 `FF E0` 这类伪图在读写两端都会被拒绝。权威校验是写入前用浏览器 `img.decode()` 再解码一次，写入后立即回读，写不进（本机存储空间不足/隐私模式）或删除未生效都会明确提示失败，绝不假报成功，此时可用「下载这张」自行保存），上传的原照片仍不保存到任何位置；相册里可放大、下载到本机、逐张或批量删除。所有增删都先重新读取 localStorage 再写回、写后再回读校验；跨标签页并发用 Web Locks（`navigator.locks`，锁名 `hairplay.storage.<键>`）把整段读改写串行化，第二个标签页会等第一个写完并在锁内重新读取，因此过期快照不会复活已删除的图片（获取锁 5 秒超时，或运行环境没有 Web Locks 时，都如实提示且**不写入**，宁可失败也不丢数据：没有可靠互斥就没有安全的读改写，无锁写入会让另一标签页的过期快照复活已删除的图片；小程序是每用户单实例、无共享标签页，才直接写入），同时监听 `storage` 事件同步界面；批量删除时 AI 区写入失败就不再动模板示例记录，模板区失败则明确提示“AI 生成图片已删除，但模板示例记录未删除”；模板示例记录在写入时同样裁到 50 条上限。生成结果不写入服务器数据库，也不进入公开图片 Service Worker 缓存，因此换设备/清理浏览器数据后记录不会同步。服务可能产生云端费用。服务端 SQLite `.data/auth.sqlite`（0600，Git 忽略）持久保存最多 100 个经验证码验证的邮箱账户及每人终身最多 3 张成功图；失败、演示不扣额度；重启不会重置用户额度。验证码 10 分钟有效、5 次错误后失效；登录会话 7 天，退出后会话失效。服务端全局同时只允许一个生成任务，并对每小时生成量限流。个人照片与生成结果不写入数据库。

H5 与小程序构建仍可运行；**小程序邮箱登录和真实生成尚未接入**。`https://liangz77.cn/hairplay/` 现已接入受限的 `hairplay-api.service`：未登录生成返回 401；公网 `GET /hairplay/api/session` 返回账户或 `null`。Ark 开发密钥与经用户授权临时复用的 WiseCut 生产监控 SMTP 凭据部署在服务器 `/etc/hairplay/`（目录 0700，文件 0600），不在前端静态资源中。实际生成消耗 Ark 额度；注册最多 100 个邮箱，已有用户在满额后仍可登录；服务端持久额度保存在独立数据库，重启不重置。SMTP accepted 仅证明发信服务器接受，不证明邮件已到收件箱。生产服务与静态站点回滚详情见 `docs/DEPLOY.md`。

安全回归：`npm run typecheck && npm test && npm run test:dev-security && npm --workspace client run build:public && npm --workspace client run build:mp-weixin`。Vite 已升级到 5.4.21；uni 插件声明的 Vite 5.2.8 peer 范围较旧，本项目 H5/mp 实测通过，但后续升级仍应复测。本机 API 测试使用假上游，不消耗云端调用；实际成功调用仅用于人工集成验证。任何公开构建都必须通过 `client/scripts/check-public-build.mjs` 的静态文件白名单，不能包含 `.secrets/`、`.data/`、服务器代码、数据库或原始参考图片。

## 阶段 A 实现补充（没有执行部署）

- Node 22.23+，使用 `node:sqlite`（目前会给出 experimental warning）；数据库 WAL、busy timeout、幂等初始化，DB/WAL/SHM 权限600，独立随机 pepper 仅保存于受限数据库。高熵会话及验证码只保存哈希。
- 邮箱小写/去首尾空白；发送按 IP 与邮箱分别至少60秒间隔、每小时各最多5次；全服务每小时最多100封请求。新/老账号请求响应相同；SMTP 失败仍占发送预算且使本次验证码失效，不记录底层错误。验证码校验成功后才在 `BEGIN IMMEDIATE` 中原子注册/登录，第101个新邮箱拒绝，已有账号可继续登录。
- HttpOnly/SameSite=Lax，会话7天到期，HTTPS配置用 Secure cookie；Path 与 `HAIRPLAY_BASE` 对齐，退出不删除账户记录。写操作要求允许的 Origin + JSON，无匿名/开发生成绕过，响应 no-store。本地默认不信任转发 IP 头（反代请求共享回环 IP，限制更保守）；只有显式配置且 HTTPS 时才可选择信任覆盖后的 X-Real-IP。
- 生成在事务中原子预留：成功数+pending最多3；成功幂等落账，失败释放；全局每小时3次生成尝试（失败也占成本预算），且全服务仅一个在途。预算持久化。服务重启 pending 继续占位，10分钟后有界回收；上游硬超时150秒。上游已接受但响应丢失时会算失败，云端费用仍可能发生；不对云供应商保证 exactly-once。
- H5 canvas 去元数据后上传，服务端 sharp 再解码、限制像素、缩放重编码去 EXIF；原图不落盘。生成输出验证真实可解码 JPEG。演示不需要登录、不联网、不扣次数；小程序真实生成与邮箱登录未接入。
- SMTP 缺失/不安全配置 fail-closed。`scripts/copy-monitor-smtp.py` 只复制必要五字段至600权限配置，不输出值、不改 WiseCut、目标存在不覆盖。`scripts/check-smtp-self.mjs` 发信前持久化独占标记并 fsync，标记存在不重试，即使失败也不重发；最多一封到发件账户自身。SMTP accepted 不等于收件箱实收。
- 根路径与 `/hairplay/` 浏览器测试使用假 SMTP/Ark、公有 AI 目录图，取消不上传、确认才调用、演示不扣、登录状态及剩余额度均经过验证。测试代码/非敏感日志在 `/tmp/hairplay/`；扫描可运行 `python3 scripts/check-private-values.py`，只输出汇总。
- 子路径本地 API：`HAIRPLAY_BASE=/hairplay/ npm run dev:api`；对应 H5 使用相同 base。Vite 代理覆盖所有 API，`HAIRPLAY_API_PORT` 只允许切换回环测试端口。`HAIRPLAY_ORIGIN` 可显式设置单一源，公网部署尚未执行。

本次阶段 A 没有 SSH/Caddy/systemd 操作、生产发布或真实付费 Ark 调用；未提交/push，独立验收由外层执行。
