# 账户同步 v2（本地实施中，未批准发布）

本合同替代 CLOUD_FIX3 中的“仅邮箱头绑定、无头生成兼容”和页面读写 epoch 方案。生产尚未变更；回归、固定提交、干净 archive 和独立复验未完成前禁止发布。

## 身份

HttpOnly Cookie 是唯一认证凭据。`GET /api/session`、成功 login 的 account 增加随机 128-bit `context`，与每条会话关联；不能用于登录。同邮箱重登有不同 context。旧会话在 BEGIN IMMEDIATE 迁移中回填随机 context，保留 token hash/期限。绝不向客户端返回原 token、hash、pepper。

新 UI 的 favorites、gallery、generate/import/delete、gender/logout、私图读取和下载都发送 `X-HairPlay-Context`。服务端在照片请求体读入、解码、预留额度和上游前校验它与 Cookie 会话一致。不匹配 409 `CONTEXT_MISMATCH`；未认证 401 `SESSION_REQUIRED`；敏感操作无 context 428 `CONTEXT_REQUIRED`，要求刷新。body 的邮箱/owner 不是授权来源。保留旧 X-HairPlay-Account 的校验，但它不替代 context。

session/code/login 是明确例外；session 是探测，只有本机最新 probe 可以接纳。新 UI login/logout 用同源 Web Lock 串行，开始即隔离旧账户，结束再核验；排队期间身份变化的动作丢弃。logout 的期望 context 在隔离前捕获；服务端拒绝不匹配的 logout 时不注销会话、不设置 Cookie。不能承诺浏览器撤销已经发送的旧响应中的 Set-Cookie；旧端或其他登录入口改变共享 Cookie 的未观察窗口，需靠新请求服务端校验、已观察不一致时隔离、重新聚焦核验收敛。

## 持久 revision 和响应

`resource_revisions(user PRIMARY KEY,favorites INTEGER,gallery INTEGER)`。新账户两个资源起点 0；旧已初始化收藏/非空图库迁移起点 1，旧未初始化/空图库为 0。计数不是时间戳，也不是客户端内容哈希。

修改与版本递增同一 SQLite 事务：
- favorites 首次初始化（含空采纳、缺项 remove）递增；实际 add/remove 递增；重复 add/remove 无变化不递增；采纳 409 不递增。
- gallery 插入新图、真实删除递增；重复导入、缺项删除不递增。
- finishWithImage 图片/成功扣额/图库 revision 同事务；失败回滚不递增；删除不返额度。

GET favorites：`{owner,context,revision,ids,initialized}`。
GET gallery：`{owner,context,revision,images}`。
收藏 POST 返回相同的提交快照加 `ok`，409 也带权威快照。
图库 import/delete/generate 返回相同的提交图库快照，保留原 id/created、deleted、image/record/remaining 等字段。列表和 revision 不是两个时间点拼接。私图 GET 在同一读取事务取图片与 revision，通过 `X-HairPlay-Owner/Context/Revision` 响应头返回元数据；HTTP 仍 private,no-store。

旧数据 hash/gender、会话、额度、用户和图片字节不重建。迁移和回填串行；不能以 import smoke 代替旧库实际构造测试。

## 集中接纳和本机缓存

`core/account-sync.ts` 维护身份代次、最新 session probe、每邮箱/资源已知 revision；`platform/account-coordinator.ts` 将网络响应与捕获 ticket/快照许可关联。账户/会话不符、身份未知、低 revision 全部静默丢弃，GET 和 mutation 共用规则。锁等待后再读取共享缓存下界；广播不是认证凭据。旧 ticket 必须先判失效，不能让旧 A 响应反过来隔离已经核验的 B。

收藏缓存为 `accountFavorites:{owner,context,revision,items}`；匿名 favorites 独立。成功首次采纳仅清捕获且已采纳 ID，409 不清，偏好变更不取消捕获集清理；随后更高资源版本不授权旧列表落屏。

图库仍保留旧 records 数组以兼容读取；新关联云端记录增加 owner/context/revision。`hairplay.gallery.stamp.v2` 保存空图库的版本/tombstone，在同一个图库 Web Lock 内先写并回读确认，再写数组。这不是 localStorage 多键原子事务：崩溃/数组写失败可能留下较新下界，只能保守拒绝旧任务，不能将此标记当服务器真相。缓存写失败仍可在身份/资源许可有效时内存显示图片，诚实提示。无 Web Locks 不写缓存。

BC/storage 通知只加速失效和重读。观察到 owner/context 不一致先同步隐藏旧私图/收藏，再探测；同版本幂等，不循环写同一快照。更高 revision 立即隔离旧显示并重读。后台恢复、聚焦核验；网络不可达时身份未知而非已确认。生成在 A 已受理后可继续在 A 完成；切 B 不显示/写 A 结果，不谎称取消上游。下载前后有门禁，但无法追回已保存文件。无 WebSocket/瞬时跨设备一致性承诺。

## API-first 兼容与回滚

先 API 后静态。无 context 的旧已公开客户端：favorites/gallery/私图读暂保留 Cookie 认证；favorites 原子编辑/采纳、delete/gender 暂兼容，不声称有新身份绑定保证。generate/import/logout 必须刷新新 UI（428），不能为了不停机而继续无头上传或退出后来的会话。任何提供但错误的 context 均拒绝。新 UI 没有无头重试后门。此策略依据历史 UI 的实际接口调用；新增敏感请求即使只发送头而不发 body 也必须立即拒绝。上线前还需独立验收及明确授权；API 回退保留新增列/表，但旧 API 不提供 v2 合同，新 UI 需同步回退。

## 隐私和人工事项

原照片只用于经用户确认的生成，不落盘入库；localStorage 压缩副本是有意的持久私图缓存，退出隐藏而非擦除。HTTP no-store、公开 SW CacheStorage 和本机缓存不同。真实邮箱/邮件、经同意的一次真实 Ark、两台物理设备传播、小程序账户接入/真机、隐私签署均不被 fake-only 回归替代。go-sites 隐私不得在用户签署前 push/deploy。
