# 风见鸡 · Weathercock

轻量、开源的 **New API 中转站常用模型状态与资费聚合监控工具**。  
单 Cloudflare Worker 即可免费部署在 `*.workers.dev`，零数据库、零个人资源绑定，支持 PWA 安装到手机/桌面，方便自用或直接分享给朋友各自填入中转站。

## 核心特性

- **多站模型广场聚合**：通过 New API 公开接口 `GET /api/pricing` 拉取各中转站模型列表，实时显示**在架 / 已下架**状态。
- **实时资费换算**：同时支持**按量计费**（`$/1M tokens`）与**按次计费**（`$/次`），支持单卡切换分组倍率（`group_ratio`）以及按站点自定义充值汇率折算人民币单价。
- **Uptime Kuma 状态条**：为站点填上公开状态页地址（`https://<域名>/status/<slug>`），自动模糊匹配或手动绑定监控项，展示 24h 在线率与最近心跳条。
- **可选深度诊断探针（默认隐藏，按需开启）**：
  - 无需填写 API Key 即可使用全部广场、资费与 Kuma 监控功能；在「站点管理 → 高级：深度诊断配置」中填入测试令牌后，才会显示单卡与批量诊断入口。
  - **测连通**：发送极短非流式请求，检查真实延迟与 `usage`（输入 / 输出 / 缓存 / 思考 token）。
  - **测工具**：附带极简 `ping()` 工具定义，实测上游是否真正支持 Function Calling（`Tools ✓ / ✗`）。
  - 不做无人值守定时轮询，避免产生意外费用。
- **三视图与多维比价**：支持**卡片 / 表格 / 跨站比价**三种视图切换，支持按单价、24h 可用率、站点或名称排序；比价视图自动归并同名模型并高亮最低价与最稳渠道。
- **标签分栏与全局管理**：支持自定义标签筛选、全局重命名/删除标签、取消关注一键撤销、浅色 / 深色主题切换。
- **隐私与安全底线**：
  - 默认纯浏览器本地存储（`localStorage`），多人共用同一部署地址时数据完全隔离。
  - 导出配置 JSON **默认剔除所有 `apiKey`**，方便直接分享模型清单。
  - 服务端代理与探针内置 **SSRF 防护**（仅放行公开 `https://` 地址，拒绝内网/保留段与重定向），错误正文自动脱敏截断。
- **完整 PWA 支持**：已内置风见鸡多尺寸图标、Maskable 安全区图标、`manifest.json` 与离线外壳 Service Worker（`sw.js`）。

## 本地开发

需要 Node.js 22+：

```bash
npm install
npm test        # 运行后端单元测试（node:test）
npm run typecheck
npm run dev     # 启动 wrangler dev 本地预览
```

## 部署到 Cloudflare Workers

```bash
npx wrangler login
npm run deploy
```

部署完成后即可获得免费的 `https://weathercock.<你的子域>.workers.dev` 地址，开箱即用。

### 可选：启用跨设备云同步（Cloudflare KV）

默认情况下项目**不绑定任何 KV**，完全运行在纯本地模式。如果你需要跨设备同步配置：

1. 创建 KV 命名空间：
   ```bash
   npx wrangler kv namespace create MONITOR_KV
   ```
2. 取消 `wrangler.toml` 底部的 `[[kv_namespaces]]` 注释并填入上一步生成的 `id`。
3. 设置访问令牌 Secret：
   ```bash
   npx wrangler secret put ACCESS_TOKEN
   ```
4. 重新执行 `npm run deploy`，前端「导入 / 导出」弹窗将自动显示云同步面板。

## License

[MIT](./LICENSE)
