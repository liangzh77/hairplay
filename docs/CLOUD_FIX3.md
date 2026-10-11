# 云端相册第三轮修复（本地，未批准发布）

基线 `33084cb`，实施提交 `61c7444`；两轮独立报告均已完整阅读。本轮不 deploy、不读取生产私库、不调用真实邮箱或 Ark。主站隐私改动仅本地提交 `c48c527`，待用户签署，不推送/部署。HairPlay 也尚未推送。

## 缺陷与实测

证据目录：`/tmp/hairplay-cloud-fix3/`（本地临时证据，不随发布包）。旧报告脚本复制到该目录，仅修改仓库引用及把漏洞存在断言改为关闭断言；没有把提前退出当作通过。

| 项 | 修复 / 新反例观测 | 证据 |
|---|---|---|
| F9 / C1–C2 | `favorites` 为本机独有集合，`accountFavorites` 为带邮箱的账户缓存；登录展示服务端列表，退出账户收藏卡为 0。首次成功采纳移除捕获项，409 保留本机项。B 账户 GET 挂起时收藏卡为 0，放行后只展示 B 的列表。隐私区分 localStorage、HTTP no-store 与公开 SW CacheStorage。 | `account-boundary.log`、`favorite-scope.test.ts`、主站本地隐私提交 |
| N1 | 旧收藏 POST 200 在退出后放行：收藏卡 0、本机独有集合未改；回调在响应、锁内写入与落屏前校验代次及邮箱。 | `account-boundary.log` |
| N2 | 挂起旧 gallery / generate / import / session 200；退出后私图弹窗 0，迟到生成存储行 0，迟到导入不改两份 localStorage，旧 session 不恢复登录。账号动作开始即失效旧代次；提示原账户中已受理请求可能仍完成，可重新登录核对。下载、图片缓存、删除和性别刷新也有门禁。 | `account-boundary.log` |
| N3 | 无锁关闭横幅：state 写入 0、横幅仍显示、明确错误；偏好均通过锁内增量修改与内容级回读。两标签同时修改不同高级选项，两个键与收藏均保留。 | `account-boundary.log` |
| N4 | 导入成功、本机关联失败有实在可点击的重试按钮；先拒绝再恢复写入后重试成功，importCalls 始终 1、云端行 1、指针已保存，按钮消失。相册详情快照随行刷新。 | `account-boundary.log` |
| N5 | 先 ALTER hash 再建索引，BEGIN IMMEDIATE 内检查、迁移、回填旧图哈希。真实 68c22d9 模块创建有图旧库后迁移成功；提交内真实 SQLite 旧 schema 三进程启动、保图、同图重试去重、新图继续写入通过。 | `legacy-migration.log`、`server/migration.test.mjs` |
| N6 | 报告四个混合/额外字段 HTTP 反例全部 400；新回归还拒绝 null、数组、空对象及错类型。首次采纳、409 权威、原子 add/remove 保持。 | `server-counterexamples.log`、`server/gallery.test.mjs` |
| N7 | 原始响应写临时文件，HTTP 状态单独检查，cmp 比较 16 字节；NUL 后缀 rc=1，额外行/换行/空行/503/users 变化均拒绝。临时文件正常/失败/信号退出清理。 | `release-counterexamples.log`、`linux-rehearsal-final.log` |
| N8 | 全部 JPEG 已跟踪；dev-security 自建并清理 fake-only 目录。不复制 .secrets、不提供 ignored 研究图的 git archive 副本回归全通过。 | `clean-summary.log`、`clean-logs/` |

旧格式没有来源标记：首次账户同步时，重合项按账户副本归类，本机独有（服务端没有的）项保留；尚未同步时无法恢复旧记录的真实历史归属，不能宣称能无损重建这种来源信息。新格式不再混写两类收藏。

## 回归与负向对照

从实施提交 `git archive` 导出，仅共享已安装依赖，不复制图片/密钥/构建产物：typecheck 0；client 25/25；server 连续三次各 26/26；release 13 项；dev-security PASS；H5 47 文件/40 资产、小程序 53 文件/40 资产；Chrome 浏览器护栏 5/5，account-boundary harness_errors=0。汇总 `clean-summary.log`，原始日志 `clean-logs/`。最后新增 B 账户同步挂起的护栏另已复跑通过，最终提交仍须干净导出复跑。

- 在干净基线 `33084cb` 编译旧产品，运行新账户护栏，正常执行到结束并报告 **7 个失败场景**（关联按钮、退出收藏、无锁偏好、并发偏好、迟到收藏、迟到生成、迟到导入）。这是负向对照，不算产品通过；`baseline-negative.log`。
- Linux 仅远端 `/tmp/hairplay-fix3-linux-1791695812/` 演练，复制工具 SHA-256 已核对。最终脚本 **53 PASS / 0 FAIL**，包含原 38 项和 NUL/换行/空行三组额外回滚/保留现场断言。
- 独立 `/tmp` 负向副本将 cmp 改成读取 bash 变量：**12 FAIL**（三个后缀各拒绝、回滚、未服务、恢复断言失败），演练报告 FAILED，证明确实能拦截旧缺口。`linux-negative.log`。
- 服务端旧容量、事务 trigger、并发上游+导入、hash 去重、HTTP 退出取图、原子收藏反例全通过，分别见 `server-counterexamples.log`、`http-cache-counterexample.log`。字节门禁仍独立测试全部禁入文件与父目录链接。
- 数字在 `audit.txt` 逐项与日志核对。未把模块 import smoke、stub 浏览器或 users 行数不变夸大为真实生产验证。

## 放行条件

独立 **Astra high** 对 `6a49586` 已完成并给出 **REJECT**，完整报告 `/tmp/hairplay-cloud-fix3/independent/REVIEW3.md`；发现 R1–R5，原指定反例通过不豁免新窗口。返工后仍须指定 Astra high 完整独立复验；模型不可用立即报告，不换模型。不得生产发布。

## R1–R5 返工实测（未放行）

- R1：将 guard 传入照片重编码函数，decode/toBlob/FileReader 后、实际 POST 前检查。新客户端还发送 `X-HairPlay-Account`，服务端在读照片/调用上游/预留额度前拒绝与当前 Cookie 账户不符的确认（409）；无该头的旧客户端仍兼容。真实 API 观测 `requests=[], upstreamCalls=0, A_images=0, B_images=0, B_remaining=3`。
- R2：通过 BroadcastChannel（不可用时用独立无身份内容的 localStorage 信号键）在账号动作开始及结束通知所有标签失效/重新读会话；账户缓存 owner 不同的 storage 事件先核验会话。真实共享 Cookie B 登录后放行 A 200：`privateModal=0, generationStorageChanged=false, lateTabAWrites=[]`，A 服务端图仍完成，未谎报任务取消。
- R3：收藏读/写代次防止旧 GET 覆盖已确认的原子编辑；同一账户同步合并为串行+dirty 重读，避免丢失首次成功采纳的捕获项清理。真实 API `server=[], cards=0, cached=[]`。
- R4：相册读/写代次在生成、导入、删除成功时失效旧 GET 与旧下载缓存任务；真实 API 放行旧空 GET 后 `serverImages=1, cards=1, remaining=2`。
- R5：信号显式进入 `rollback 1`，不再依赖 `trap false` 触发 ERR。Linux `test_api_remote_signals.py` 用完整 publisher、真实临时 SQLite/HTTP，PID TERM、进程组 TERM/HUP/INT 四种均回滚，失败树保留、健康临时文件均 0。测试子进程先重置默认信号，避免 nohup 驱动继承的 ignored HUP/INT 把探针变成无效测试。主发布演练仍 53 PASS / 0 FAIL，信号是另外 4 例，不混称 57 条主演练断言。把 publisher 单独换回 `6a49586` 的原文件、新信号护栏完整执行到总结：PID TERM/组 INT PASS，组 TERM/HUP FAIL，rc=1，证明新护栏确实拒绝旧实现（`r5-signals-negative.log`）。

反例提升为提交内 `account-adversarial.mjs`（从独立 fake-only 探针迁入）和 `real-account-races.mjs`（真实 createApp/SQLite/Cookie，只有上游 fake-only）；浏览器整套 7/7。原“并行匿名标签在另一标签登录后仍保持匿名”护栏已按共享会话真实语义调整：新登录会传播，采纳期间并发本机独有项用真实 Web Lock 写入验证，仅清捕获项、不清新增项。跨标签旧结果护栏允许正确实现不发迟到的 session 刷新，仍在真实旧 200 放行后检查弹窗和 setter，并非靠等待不存在的旧行为假通过。

日志：`r1-r5-browser.log`、`repair-real-account-races.log`、`r5-signals-final.log`、`r5-rehearsal-final.log`、`r5-linux-sha.log`。Linux 新演练只在 `/tmp/hairplay-fix3-r5-1791698593/`，不触碰生产。返工本地 typecheck、client 25/25、server 连续三次各 27/27（新增期望账户头真实 HTTP 回归）、release 13、dev-security、H5 47 文件/40 资产、小程序 53 文件/40 资产及 browser 7/7 已实测。最终提交还须干净 git archive 复跑，再交独立复验。

最终 `6a49586` 的干净归档复跑已完成，`clean-final-summary.log` 全部 rc=0；基线最终新护栏完整报告 8 失败（之前文中 7 是新增 B 挂起用例之前的旧版本），不将这些计数当成互相独立根因数。

人工仍需验证：真实邮件投递/登录；明确同意的一次真实生成及额度；两设备同邮箱相册、删除和收藏传播；隐私 v1.2 签署。小程序账户接入、开发者工具及真机验收未做。没有执行任何真实生产发布或改变生产服务/配置。
