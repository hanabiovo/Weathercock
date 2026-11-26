# Weathercock（风见鸡）开发文档

> 轻量、开源的 New API 中转站常用模型状态与资费聚合监控工具。  
> 默认部署于 Cloudflare Worker 免费 `*.workers.dev` 域名，零个人资源绑定，开箱即用，支持分享给朋友各自填入自用中转站。

---

## 1. 项目定位与分期目标

- **解决痛点**：多家中转站均使用 New API，但模型广场列表极长、状态监控分散且常有缺失；需要一个清爽面板，只盯住自己真正在用的那几个模型，随时查看**在架状态、实时资费、公开探针状态**，并能一键实测**连通性、工具调用支持与 token 计数是否正常**。
- **分期规划**：
  - **v1（当前阶段）**：完整独立网页版。自由管理多个中转站与关注模型，支持自定义标签分栏（例如 `酒馆`、`栖息地`、`备用`），支持配置脱敏导出/导入与开源一键部署。
  - **v2（后续扩展）**：在 Worker 中暴露精简只读接口或可嵌入视图，接入栖息地（Roost）「设置 → 模型与连接」，只展示带 `栖息地` 标签的模型卡片。

---

## 2. 已实测的上游接口事实

以下接口均已完成实测（2026-11-24），可直接作为 v1 适配器依据：

### 2.1 New API 模型广场（通用标准接口）

- **地址**：`GET <baseUrl>/api/pricing`（免登录、公开可读、无验证盾）
- **已验证站点**：
  - 酒栈：`https://api.jiuzhan.top/api/pricing`（252 个模型）
  - 小鸡：`https://ckffai.com/api/pricing`（189 个模型）
- **核心返回字段**：
  - 顶层：`data[]`、`group_ratio`（分组倍率映射）、`usable_group`（分组说明）、`vendors`（厂商信息）、`supported_endpoint`
  - 单条 `data[i]`：
    - `model_name`：模型 ID
    - `vendor_id` / `owner_by`：归属厂商
    - `quota_type`：`0` = 按量计费，`1` = 按次计费
    - `model_ratio`：输入倍率
    - `completion_ratio`：输出相对输入的倍率
    - `model_price`：按次计费单价（美元/次）
    - `enable_groups`：该模型可用的分组列表
- **New API 标准资费换算**：
  - 按量（`quota_type === 0`）：
    - 输入单价（`$/1M tokens`）= `model_ratio × 2 × group_ratio[group]`
    - 输出单价（`$/1M tokens`）= `输入单价 × completion_ratio`
  - 按次（`quota_type === 1`）：
    - 单次价格（`$/次`）= `model_price × group_ratio[group]`
  - 人民币折算：若用户为该站点填写了充值汇率 `exchangeRate`（如 `1 美元 = ¥2.0`），页面同步展示折算后的人民币单价。

### 2.2 Uptime Kuma 公开状态页

- **已验证站点**：小鸡 `https://status.68886868.xyz/status/api`
- **解析规则**：从 `<origin>/status/<slug>` 提取 `origin` 与 `slug`，并发请求两个公开 JSON 接口：
  - 元数据：`GET <origin>/api/status-page/<slug>` → `publicGroupList[].monitorList[]`（含 `id`、`name`）
  - 心跳数据：`GET <origin>/api/status-page/heartbeat/<slug>` → `heartbeatList[id][]`（最近心跳 `status: 1正常 / 0异常 / 2维护`、`ping`、`time`）与 `uptimeList["<id>_24"]`（24h 在线率）

### 2.3 需鉴权的站内监控页

- **已验证站点**：酒栈 `https://api.jiuzhan.top/monitor`
  - 公开 `/api/uptime/status` 返回空列表 `[]`，`/api/models/status` 返回 `HTTP 401`（需登录态）。
- **处理策略**：不抓取或绕过需要登录/人机验证的页面；统一通过「模型广场在架与资费 + 手动一键实测探针」覆盖状态检查。

---

## 3. 系统架构与安全设计

### 3.1 总体架构

- **单 Cloudflare Worker（TypeScript + Wrangler）**：
  - 托管静态前端页面（HTML/CSS/JS，部署即用）。
  - 提供无状态 `/api/*` 代理接口，解决浏览器跨域（CORS）限制。
- **双存储模式（默认零数据库）**：
  - **默认模式（推荐开源开箱体验）**：所有站点配置、关注清单、标签和可选 API Key 均保存在**用户各自浏览器的 `localStorage`**。将部署好的 `*.workers.dev` 链接发给朋友，每人数据完全隔离在各自浏览器内；支持一键导出/导入 JSON 备份。
  - **可选云同步模式（预留）**：若部署者在 `wrangler.toml` 中绑定 `MONITOR_KV` 并配置环境变量 `ACCESS_TOKEN`，则启用跨设备云同步（也为后续栖息地内嵌读取同一份清单预留能力）。

### 3.2 Worker 后端接口设计

| 路由 | 方法 | 用途 | 关键细节 |
| --- | --- | --- | --- |
| `/api/proxy/pricing` | `GET` | 拉取中转站 `/api/pricing` | 参数 `baseUrl`；服务端可做 60s 轻量缓存；标准化返回模型列表与分组倍率 |
| `/api/proxy/kuma` | `GET` | 拉取 Uptime Kuma 状态页 | 参数 `statusUrl`；解析 `origin + slug` 并发拉取元数据与心跳，只返回精简字段 |
| `/api/probe` | `POST` | 手动一键实测单个模型 | 请求体 `{ baseUrl, apiKey, model, testTools }`；发极短非流式 `/v1/chat/completions` |
| `/api/sync`（可选） | `GET` / `PUT` | 可选 KV 云同步 | 仅在绑定 `MONITOR_KV` 且校验 `ACCESS_TOKEN` 通过时启用 |

#### `/api/probe` 实测探针规范

- **请求构造**：
  - 仅在用户**手动点击**时触发，不做无人值守定时轮询，避免产生意外费用。
  - 当 `testTools = false`：发送极短文本请求（如 `Reply OK`，`max_tokens: 16`）。
  - 当 `testTools = true`：附带一个极简函数工具定义（如 `ping()`），指令要求模型调用该工具一次（`max_tokens: 64`），用于真实检测上游是否吞掉了 `tools`（Function Calling）。
- **返回结构**：
  ```json
  {
    "ok": true,
    "httpStatus": 200,
    "latencyMs": 1420,
    "supportsTools": true,
    "usage": {
      "promptTokens": 120,
      "completionTokens": 28,
      "totalTokens": 148,
      "cacheReadTokens": null
    },
    "error": null
  }
  ```
- **价值**：除了测通不通和延迟，还能直接暴露两类常见中转站坑点：
  1. `supportsTools: false`（上游不支持或丢弃了工具定义）；
  2. `promptTokens` 或 `completionTokens` 明显异常（如思考 token 计入输出、输入倍率虚高）。

### 3.3 安全底线

1. **SSRF 防护**：所有代理与探针接口只允许 `https://` 公开域名，严格拒绝 `localhost`、`127.0.0.0/8`、`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`、`169.254.0.0/16`、`::1`、`fc00::/7` 等内网/保留地址，且 `fetch` 强制 `redirect: 'error'`。
2. **密钥不落盘、不回显**：Worker 绝不记录或打印请求体里的 `apiKey`；上游报错正文做脱敏截断后再返回前端。
3. **导出默认脱敏**：前端「导出配置 JSON」默认**剔除所有 `apiKey`**（单独提供勾选框并附醒目警告），方便用户直接把模型清单分享给朋友。

---

## 4. 前端数据结构与界面设计

### 4.1 本地存储结构（`localStorage` key：`weathercock:v1`）

```ts
interface WeathercockConfig {
  version: 1;
  sites: Array<{
    id: string;
    name: string;           // 如 "酒栈"、"小鸡"
    baseUrl: string;        // 如 "https://api.jiuzhan.top"
    statusUrl?: string;     // 可选 Uptime Kuma 地址
    exchangeRate?: number;  // 可选：1 美元折合人民币（如 2.0）
    apiKey?: string;        // 可选：仅用于手动一键实测
  }>;
  watched: Array<{
    id: string;
    siteId: string;
    modelName: string;      // 精确模型 ID
    group?: string;         // 选用分组（用于匹配 group_ratio）
    alias?: string;         // 自定义备注名
    tags: string[];         // 如 ["酒馆"]、["栖息地"]
    kumaMonitorId?: string; // 可选：手动绑定的 Kuma 监控项 ID
    lastProbe?: {
      at: number;
      ok: boolean;
      latencyMs: number;
      supportsTools?: boolean;
      usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
      error?: string;
    };
  }>;
  ui: {
    theme: 'light' | 'dark' | 'system';
    activeTag: string;      // 'all' 或具体标签名
    view: 'cards' | 'table';
  };
}
```

### 4.2 界面风格与核心视图

- **视觉基调**：默认清爽暖米白浅色卡片风 + 一键切换深色模式；响应式布局，手机竖屏与桌面宽屏均易读。
- **核心板块**：
  1. **顶栏与标签切换**：品牌「风见鸡 Weathercock」、标签胶囊（`全部` / `酒馆` / `栖息地` / 自定义标签）、刷新广场与状态、批量实测、添加模型、站点管理、导入导出、主题切换。
  2. **关注看板（主视图）**：支持卡片视图与紧凑表格视图切换。每条关注模型展示：
     - 站点名 + 模型名（或自定义备注）+ 标签
     - **在架状态**：在架（绿）/ 广场已下架（红）
     - **实时资费**：输入/输出单价（美元 + 折算人民币），或按次单价，以及可选分组切换
     - **Uptime Kuma 状态条**（若站点配置了状态页）：24h 在线率 + 最近心跳红绿条；支持自动模糊匹配与手动指定绑定项
     - **实测结果区**：最近一次实测时间、耗时、工具支持标识（`Tools ✓ / ✗`）、token 读数，以及单卡「测连通」「测工具」按钮
  3. **模型广场浏览器（抽屉/弹窗）**：选择站点 → 拉取该站 `/api/pricing` → 关键词搜索、按分组/按量按次筛选 → 点一下「+ 关注」并勾选标签。
  4. **站点管理与配置导入导出**：增删改中转站；支持一键导入/导出脱敏 JSON。

---

## 5. 推荐目录结构与开发里程碑

### 5.1 仓库目录结构

```text
Weathercock_风见鸡/
├── src/
│   ├── index.ts          # Worker 入口路由与静态资源服务
│   ├── ssrf.ts           # URL 与私网地址安全校验
│   ├── pricing.ts        # New API /api/pricing 抓取与标准化
│   ├── kuma.ts           # Uptime Kuma 状态页抓取与心跳解析
│   └── probe.ts          # 手动一键实测（连通 + 工具调用 + usage）
├── public/
│   ├── index.html        # 单页应用入口
│   ├── style.css         # 浅/深色主题与响应式样式
│   └── app.js            # 前端状态、资费换算、广场检索与交互
├── tests/
│   ├── ssrf.test.mjs
│   ├── pricing.test.mjs
│   ├── kuma.test.mjs
│   └── probe.test.mjs
├── wrangler.toml         # Cloudflare Worker 配置（含可选 KV 注释说明）
├── package.json
├── tsconfig.json
├── README.md             # 中文开源说明与一键部署指南
└── LICENSE               # MIT
```

### 5.2 推荐开发顺序（新工作区可直接按此推进）

1. **阶段 1：项目初始化与后端接口** — 搭好 `package.json`、`wrangler.toml`、TypeScript 配置，实现 `ssrf.ts`、`pricing.ts`、`kuma.ts`、`probe.ts` 及对应单元测试（使用 `node:test`）。
2. **阶段 2：前端完全版页面** — 实现站点管理、模型广场检索加星、关注看板（含资费换算、Kuma 心跳条、手动实测）、标签分栏、脱敏导入导出与浅/深色切换。
3. **阶段 3：本地联调与发布** — 用 `wrangler dev` 本地实测酒栈与小鸡两个真实站点，确认价格换算、Kuma 匹配与探针脱敏无误后，执行 `wrangler deploy` 部署到免费 `*.workers.dev` 并整理开源 `README.md`。
4. **阶段 4（后续）**：回到 `Roost_栖息地` 项目，接入 Weathercock 的精简数据或视图作为「设置 → 模型与连接」的内嵌模块。
