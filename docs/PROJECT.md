# HairPlay（AI 换发型）

移动优先的 AI 换发型网页应用：微信小程序 + H5 双端，一套 uni-app（Vue 3 + TypeScript）代码。
本项目是一个移动优先的发型应用原型，不接第三方后端，不打包用户照片。

## 目录结构

| 路径 | 内容 |
| --- | --- |
| `client/` | **当前唯一在维护的源码**：uni-app + Vue 3 + TS（H5 / mp-weixin） |
| `client/src/` | 页面、业务模型、平台适配层、离线素材 |
| `client/tests/` | 单元测试（Node test runner） |
| `docs/` | 项目说明与本仓库文档 |
| `tools/` | 预留的辅助脚本目录 |

## 常用命令

```bash
cd client
npm install          # 首次
npm run dev:h5       # 本地预览 http://127.0.0.1:8765
npm run build:h5     # 构建 H5 产物
npm run build:mp-weixin
npm run typecheck
npm test
```

## 当前状态与限制

- H5 可构建、类型检查通过、单元测试可运行；微信小程序可编译，但**未做真机/开发者工具验收**。
- 真实 AI 生成服务未接入：未配置时明确返回"服务未配置"，另有显式标注的演示模式，不会伪装成真实生成。
