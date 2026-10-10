# tools

预留目录：放与产品无关的本地辅助脚本（数据采集、对比、批量处理等）。
实际的构建/测试命令在 `client/package.json` 中，请优先使用那些脚本。

- `generate-catalog-images.mjs`：用火山方舟重生成目录示例图的**一次性**脚本（提示词即 `client/src/static/catalog/ai-catalog-55-*.jpg` 的来源记录）。需要 owner-only 的 `.secrets/ark.env`，会消耗真实额度，不属于构建/发布流程。
