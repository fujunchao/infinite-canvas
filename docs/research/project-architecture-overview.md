# 项目整体架构与实现地图（研究稿）

> 本文是对当前工作区（`VERSION = v0.18.2`）的只读源码分析：没有执行构建、类型检查或测试，也没有修改业务代码。所有结论均可按 `文件:行号` 回查；标「推断」的是未经运行时验证的判断。
>
> 撰写方式：按「仓库形态 → 运行拓扑 → 分层 → 数据模型 → 关键链路 → 设计不变量 → 风险 → 文档漂移 → 阶段判断」组织，目标是让人一次读完后能定位任何功能的入口。

## 0. 一句话定位

无限画布是一个**纯前端、零后端**的 AI 图片创作工作台：浏览器直连用户自己的 OpenAI/Gemini/Ark 兼容接口，画布项目、素材、生成日志全部落在浏览器 IndexedDB，可选 WebDAV 跨设备同步；另有一个**本机 Node 进程**（`canvas-agent`）把浏览器画布通过 MCP 暴露给本机 Codex/Claude，形成「AI 操作画布」的闭环。

## 1. 仓库形态：6 个可独立构建的目录

根目录**没有** `package.json`（不是 workspace），各目录独立安装/构建/发布：

| 目录 | 形态 | 产物 / 端口 | 关键证据 |
| --- | --- | --- | --- |
| `web/` | Vite 7 + React 19 SPA，唯一对外部署物 | 静态 `dist/`，3000 | `web/package.json:6-13`、`web/vite.config.ts` |
| `docs/` | Next + fumadocs 双语文档站 | standalone，容器 3000 / 宿主 3001 | `docs/next.config.mjs:6-14`、`docs/docker-compose.yml:3-6` |
| `plugins/canvas/` | 插件 monorepo：`sdk` + 5 个官方插件（html/markdown/panorama/sticky-note/svg）+ `registry` 构建器 + `template` | 单个 `.js` bundle | `plugins/canvas/README.md`、`plugins/canvas/registry/build.mjs:17-68` |
| `plugins/infinite-canvas/` | Codex app 插件（`plugin.json` + `.mcp.json` + 2 个 SKILL） | Codex 插件市场条目 | `plugins/infinite-canvas/.codex-plugin/plugin.json:13-14` |
| `canvas-agent/` | 独立 npm 包 `@basketikun/canvas-agent`（0.6.0，版本与仓库解耦） | 本机 HTTP `127.0.0.1:17371` + stdio MCP | `canvas-agent/src/config.ts:6`、`canvas-agent/package.json:3` |
| `canvas-proxy/` | 独立 npm 包，CORS 转发 | `127.0.0.1:23210` | `canvas-proxy/README.md`、`canvas-proxy/index.js` |

规模：`web/src` ≈ 33.7k 行 TS/TSX（179 个文件），`canvas-agent/src` ≈ 7.6k 行 TS；最大单文件 `web/src/pages/canvas/project.tsx` 3400 行。

## 2. 运行拓扑：三层、两个可选本机进程、零服务端

```
                    ┌─────────────────────────── 浏览器（唯一数据持有者）───────────────────────────┐
                    │ React SPA                                                                  │
                    │  ├─ 画布页面 project.tsx（状态真相源）                                      │
                    │  ├─ Zustand stores + IndexedDB(localforage) 画布/素材/日志/插件            │
                    │  ├─ services/api/*  ──fetch──► 用户 OpenAI/Gemini/Ark 接口（可经本地代理）  │
                    │  └─ Agent 面板  ──SSE + HTTP(token)──► 本机 canvas-agent(17371)            │
                    └────────────────────────────────────────────────────────────────────────────┘
                                                          │ stdio JSON-RPC
                                                          ▼
                                              codex app-server（Codex 宿主）
                                                          │ stdio MCP
                                                          ▼
                                          canvas-agent mcp 模式（34 个工具）
```

- **没有项目服务端**：`Dockerfile` 构建完前端后只跑 nginx，nginx 只有 SPA fallback + `/config.js` 禁缓存（`Dockerfile:1-20`、`nginx.conf:1-15`）。
- **两个可选本机进程**：`canvas-agent`（Agent 桥，17371）、`canvas-proxy`（CORS 转发，23210）。二者互不依赖。
- **部署形态共用一份构建**：本地 `vite dev` 3000 → Docker 3000:3000 → Render 同镜像 → Vercel `web/dist` → GitHub Pages（`VITE_BASE`）。

## 3. 前端分层

| 层 | 位置 | 职责 | 备注 |
| --- | --- | --- | --- |
| 路由/外壳 | `web/src/router.tsx`、`layouts/`、`components/layout/` | 8 条路由（home/image/video/assets/prompts/canvas/canvas:id/config）+ NotFound；`/canvas/:id` 时隐藏全局顶栏 | `router.tsx:15-35`、`app-top-nav.tsx:25` |
| 页面 | `web/src/pages/` | 画布、生图工作台、视频台、素材、提示词、配置 | 页面私有 hook/组件放各自目录 |
| 画布 UI 组件 | `web/src/components/canvas/` | 35 个 tsx / 7434 行：节点外壳、连线、小地图、工具栏、图编辑器 | 纯展示 + 手势，不含业务状态 |
| 画布状态 | `web/src/pages/canvas/project.tsx`（页面级 `useState`）+ `stores/canvas/*` | 交互真源在页面；store 只存项目列表/插件清单 | 最大分层张力点 |
| 纯函数域 | `web/src/lib/canvas/*` | 批次、几何、迁移、导出、插件运行时、Agent ops | 被页面/插件/Agent 复用 |
| 服务层 | `web/src/services/*` | 出网 API、Blob 存储、WebDAV 同步、配置导入导出 | 浏览器直连，无后端 |
| 全局 store | `web/src/stores/*` | 12 个 zustand store：config/asset/prompt-source/theme/agent/skill/workbench-agent/… | 配置在 localStorage，业务数据在 IndexedDB |
| i18n/主题 | `web/src/i18n`、`lib/app-theme.ts`、`lib/canvas-theme.ts` | zh-CN/en-US 各 657 行、608 个 key；antd token + canvasThemes + Tailwind dark | 三套主题机制并存 |

## 4. 数据模型与持久化

### 4.1 节点：6 种内置 + 开放插件类型，共用一个大 metadata

- `CanvasNodeType = image | text | config | video | audio | group`（`web/src/types/canvas.ts:12-19`）；插件节点为 `"<pluginId>:<name>"` 字符串（`:21-22`）。
- `CanvasNodeData = {id,type,title,position,width,height,metadata?}`（`:89-97`）。**没有按类型分 schema**：所有差异都落在 `CanvasNodeMetadata`（`:45-87`）的字段组合上。
- 状态：节点级 `metadata.status`（idle/loading/success/error）+ 每张图 `images[i].status` 两级。
- 连线：`{id,fromNodeId,toNodeId,kind?:"batch"}`，不存端点坐标，渲染时按几何算贝塞尔（`canvas-connections.tsx:23-29`）。

### 4.2 多图批次：根节点持资源 + 每张图一个「真实放置节点」

这是本项目最独特、也最容易读错的结构（`web/src/lib/canvas/canvas-image-placements.ts`）：

- **根节点**是图片资源权威：`metadata.images[]` 保存每个槽位的状态/尺寸/MIME/bytes/`storageKey`；`primaryImageId` 指定主图，根级 `content/storageKey/...` 始终镜像主图。
- **放置节点**是真实 `CanvasNodeData`（可选中/移动/缩放/连线/复制），只持久化 `metadata.imageRef = {batchNodeId,imageId}` 与自身几何、提示词草稿、配置覆盖；不重复存图片内容。
- 根 → 每个放置节点存一条 `kind:"batch"` 归属线：**不参与生成参考**（`canvas-resource-references.ts:73-78` 显式过滤），删线不解除归属，刷新不补回。
- 生成 N 张 = 1 个根节点 + N 个放置节点，所以画布上出现 N+1 个图片框。
- 旧数据迁移：`canvas-data-migration.ts:11` 按字段嗅探 `isBatchRoot/batchChildIds` 转为新结构，仅在打开项目时执行一次。

### 4.3 存储布局（全部在浏览器）

| 数据 | 介质 | 键 / storeName |
| --- | --- | --- |
| 画布项目（含节点/连线/助手会话/视口） | IndexedDB(localforage) `infinite-canvas` | `app_state` / `infinite-canvas:canvas_store` |
| 素材 | 同上 | `app_state` / `infinite-canvas:asset_store` |
| 已安装插件（含源码字符串） | 同上 | `app_state` / `infinite-canvas:plugin_store` |
| 图片 Blob | 同上 | `image_files`（key `image:<id>`） |
| 视频/音频 Blob | 同上 | `media_files`（key `media:`/`video:`/`audio:` 前缀） |
| 生图/视频日志 | 同上 | `image_generation_logs` / `video_generation_logs` |
| 提示词缓存 | 同上 | `prompt_cache` |
| AI 配置与密钥（明文） | localStorage | `infinite-canvas:ai_config_store` |
| 主题 / 语言 / 提示词源 / 画布侧栏 | localStorage | `infinite-canvas:theme_store` / `:locale` / `:prompt_source_store_v2` / `canvas-side-panel-*` |
| 插件私有存储 | IndexedDB `infinite-canvas-plugins` | storeName = pluginId |

要点：`content` 只是当前会话的 `blob:` URL，**长期标识是 `storageKey`**；base64 只在请求/响应瞬时存在（`image-storage.ts:43-59`）。

### 4.4 版本与迁移

- 导出 zip 声明 `version: 3`（`canvas-export.ts:29`），但**导入不校验**（`pages/canvas/index.tsx:46-57`）。
- `use-canvas-store` 的 zustand persist **没有 `version`/`migrate`**（`use-canvas-store.ts:133-144`）。
- 唯一兼容逻辑是打开项目时的字段嗅探迁移；没有全局数据版本号，也没有备份机制。

## 5. 关键链路

### 5.1 一次画布图片生成（最复杂分支）

1. `handleGenerateNode(nodeId, mode, prompt)`（`pages/canvas/project.tsx:2333`）→ 解析放置节点为真实资源 → `buildGenerationConfig` 按「节点 metadata > 全局配置 > 默认值」合并（`canvas-generation-helpers.ts:96-115`）。
2. `startGenerationRequest` 以 **targetNodeId** 为 key 注册 `AbortController`，同目标旧请求先 abort（`:328-333`）；`runningNodeId` 驱动停止按钮。
3. count>1（上限 15）→ 先落骨架：根 `images[]` 全 loading，按 2 列创建放置节点，写父→根连线与批次线（`:2411-2524`）。
4. `Promise.all` 并发 N 个请求（每个 `count:"1"`，`:2533-2569`）→ 成功即 `uploadImage` 存 Blob、更新 `images[i]`，首张自动成为主图并同步根几何。
5. 失败：单张置 error；部分失败 toast；abort 不覆盖配置节点状态（`:2571-2577`）。
6. 视频：先落 loading 节点 → 创建任务后把 `videoTaskId/videoTaskProvider/videoTaskModel` 写进 metadata → 刷新后可凭 id 续查（`:340-424`）。
7. 文本：`textCount` 决定子节点数，`/responses` SSE `onDelta` 流式写 content（`:2669-2712`）。

### 5.2 撤销/重做与持久化

- 历史 = 页面内 `past/future` 数组，每条是 `{nodes,connections,chatSessions,activeChatId,backgroundMode,showImageInfo}` 的**引用快照**（`project.tsx:138-143, 309-319`）。
- 变更检测靠引用相等 + 180ms 防抖（`:538-570`），拖拽期间暂停，整段拖拽只落一条；上限 50 条；视口和选中集**不入历史**。
- 持久化：任一业务字段变化 → `updateProject` → 400ms 防抖整包 JSON 写 localForage（`use-canvas-store.ts:56-64`）；视口另走 500ms 防抖（`project.tsx:581-591`）。
- 刷新时 `resetInterruptedGeneration` 把 loading 一律改 error，只有带 `videoTaskId` 的视频任务能续查（`canvas-generation-helpers.ts:117-135`）。

### 5.3 AI 出网：三套协议 + 每模型自定义脚本

- 渠道/模型配置：`ModelChannel{apiFormat: openai|gemini|ark, baseUrl, apiKey, models[{name,capability,script?}]}`，模型值编码为 `channelId::model`（`use-config-store.ts:8-57, 74`）。
- 请求分派顺序：**模型自定义脚本 → 协议分支（gemini/ark）→ 默认 OpenAI 形态**（`services/api/image.ts:711-868`）。
- 图像：`POST /v1/images/generations`；改图 `POST /v1/images/edits`（multipart，支持多图 + mask）；尺寸被硬约束为 16 的倍数、≤3840、像素区间（`image.ts:100-230`）。
- 视频：openai multipart `/v1/videos` + 轮询；Ark/Seedance `/contents/generations/tasks`；Gemini `predictLongRunning`；脚本视频结果只在内存 Map，刷新即失效（`video.ts:43, 95-98`）。
- 文本：`POST /v1/responses` SSE 流式。
- **自定义脚本**（`model-plugin.ts:113-164`）：把 `prompt/images/videos/audios/messages/params/model/baseUrl/apiKey/systemPrompt/reasoningEffort/http/request/poll/sleep/signal/onDelta` 作为同名形参注入，`new Function(...)` 包成 `"use strict"; return (async()=>{脚本})()`。**无沙箱、无执行超时**，脚本可读 `localStorage` 里的全部渠道 Key。
- 本地代理：开启后所有出网请求改写为 `{proxyBase}/{完整URL}`（`use-config-store.ts:489-495`），代理只做原样转发 + 宽松 CORS + SSE 透传（`canvas-proxy/index.js`）。

### 5.4 本地 Agent：MCP → SSE → 浏览器

- 拓扑：画布数据永远在浏览器；`canvas-agent` 只持有连接态、Codex 线程/历史、消息元数据、Skill。
- 工具链路：Codex/Claude → MCP（stdio，34 个工具）→ `/api/tools` → 服务端按 `boundClientId||activeClientId` 选标签页 → SSE `tool_call` → 浏览器 `applyCanvasAgentOps` 改 React 状态 → `POST /canvas/result`（30s 超时）。
- 工具面：画布 24 个（仅 `canvas_get_state/get_selection/export_snapshot` 由服务端内存快照回答，其余全部翻译为 8 种 op 的 `canvas_apply_ops`）+ 站点工具 10 个（浏览器本地执行：工作台生成、提示词、素材、导航）。
- 协议：`AGENT_PROTOCOL_VERSION = 6`，后端与前端各硬编码一处，不一致则前端断开（`session.ts:26`、`local-agent-panel.tsx:76`）；token 18 字节 hex，存 `~/.infinite-canvas/canvas-agent.json`（0700/0600），Origin 首次带正确 token 即持久化白名单。
- 消息权威性：消息 id 统一 `threadId:turnId:itemId`；历史快照（`settledTurnIds`）权威，实时事件只补未终结 turn；`replayed` 事件遇已权威 turn 丢弃，前端 ack 后服务端清重放（上限 240 条）。
- 双版本独立管理：协议版本 6 与消息元数据存储版本 1（manifest + 拒绝未知版本），后者尚无「先备份再迁移」实现。

### 5.5 插件：URL → Blob 动态 import → 注册表

1. `installPluginFromUrl`：fetch 源码（升级加 cache-bust）→ Blob URL → `import()` → 取 `default|plugin` 导出（可为工厂函数）→ `assertPlugin` 只校验 id 与非空 nodes（`plugin-loader.ts:11-68`）。
2. 激活：写 `node-registry`（type→definition，owner=pluginId）→ 注入 `<style data-canvas-plugin-style>` → 调 `plugin.setup(runtime)`。
3. 运行时：`globalThis.InfiniteCanvasRuntime` 提供宿主 React 与 hooks，插件 bundle 把 react 标 external，靠 SDK 拿宿主实例（`plugin-runtime.ts:28-41`、`plugins/canvas/sdk/src/runtime.ts`）。
4. 生态闭环：SDK → esbuild → `official-plugins.json` → CI 推到孤儿分支 `plugins-dist` → 前端经 jsDelivr 拉清单 → semver 提示升级。
5. 安全模型：**同源任意 JS**，无 iframe/Worker/CSP/权限清单；`SECURITY.md:34-48` 明文承认可读包括 API Key 在内的页面数据。

### 5.6 WebDAV 同步（可选）

- 4 个域：`canvas / assets / image-workbench / video-workbench`，每域一个 `manifest.json` + `files/` 目录（`app-sync.ts:27-34, 84-177`）。
- 合并：项目/素材按 `updatedAt`、日志按 `createdAt` 取较新；画布删除用 `deleted[{id,deletedAt}]` 墓碑，远端更晚的编辑可覆盖删除。
- 媒体按 `storageKey` 上传/下载，判定「远端无记录或字节数不同」，并发 3；**配置与密钥不同步**，只能 JSON 导入导出。

## 6. 设计不变量（改动前必须知道）

1. `content` 是易失 URL，`storageKey` 才是文件身份；删除走「引用清理」而非逐节点删除。
2. 批次归属线 `kind:"batch"` 只表示归属：不作为生成输入、删线不解除归属、刷新不重建。
3. 修改提示词/配置、打开图片工具、派生新图都不解除批次引用；只有实际替换原图资源才 `detach`。
4. 撤销保存的是引用快照，任何就地 mutation 都会悄悄破坏历史。
5. Agent 的写操作必须先经过浏览器（可二次确认 + 整快照撤销），服务端不直接改画布。
6. 插件共享宿主 React（external + 全局注入），插件 bundle 必须是单文件、不能裸 import react。
7. 数据格式没有全局版本：只有「打开项目时的字段嗅探迁移」，新增迁移必须同时考虑旧放置节点与批次线补齐。
8. 发版流程（AGENTS.md）显式要求不构建、不测试，CI 由 tag 触发即发布 → 发布质量依赖人工验收。

## 7. 风险与坑（按影响排序）

| 级别 | 问题 | 证据 |
| --- | --- | --- |
| 高 | 自定义模型脚本 = `new Function`，无沙箱/超时，可读全部 API Key；导入他人配置/脚本等于交出密钥 | `model-plugin.ts:118-164`、`use-config-store.ts:73` |
| 高 | 插件同为同源任意 JS，安装按钮无二次确认（只有常驻警示条），可读 localStorage/IndexedDB | `plugin-loader.ts:11-23`、`canvas-plugin-manager-modal.tsx:46-59,219-222` |
| 高 | `project.tsx` 3400 行、101 个 useCallback、15 个 useState：交互与生成逻辑物理耦合，任何改动都可能牵动生成链路 | `pages/canvas/project.tsx` |
| 中 | 无全局数据版本、导入不校验、无备份：格式调整只能靠嗅探迁移 | `canvas-export.ts:29`、`pages/canvas/index.tsx:46` |
| 中 | 刷新丢失进行中的图片生成（一律 loading→error），只有视频任务可续 | `canvas-generation-helpers.ts:117-135` |
| 中 | WebDAV 无字段级合并、按字节数判断重传：跨设备并发编辑会整块覆盖 | `app-sync.ts:250,298-337` |
| 中 | 主题三套并存，且节点 hover 工具栏硬编码白底深字，深色主题不一致（违反 AGENTS.md） | `canvas-node-hover-toolbar.tsx:192`、`canvas-node.tsx:18` |
| 低 | 插件加载失败只 `console.error`，UI 无失败态 | `plugin-loader.ts:107-109` |
| 低 | 死代码：`LOG_STORE_KEY`、未用的 WebDAV 单文件 API、不可达的 `channelMode:"remote"` | 见 ai-services 报告 §6 |
| 低 | 协议版本两处硬编码、需手动同步 | `session.ts:26`、`local-agent-panel.tsx:76` |

工程缺口：`web/tests` 有 5 个 `bun:test` 用例但 `web/package.json` 无 test 脚本；只有 `canvas-agent` 的 8 个 `tsx --test` 有入口；4 个 CI workflow 只构建/发布，从不跑测试。

## 8. 文档漂移清单（以代码为准）

1. `features.zh-CN.mdx:31` 仍写「三类节点」，实际 6 种（含 video/audio/group）。
2. `features.zh-CN.mdx:60,164` 称「不经过项目后端/代理」，漏了 v0.18.1 引入的可选本地代理。
3. `canvas-data-structure.zh-CN.mdx`：`CanvasProject` 缺 `showImageInfo`；助手消息 `role/mode/isLoading/images` 是旧结构；metadata 字段清单滞后。
4. `canvas-agent/README.md` 与 `plugins/infinite-canvas/README.md`：称「从 `/config` 读地址和 token」（实际只返 `hasToken`）、「MCP 启动自动拉起本地 Agent」（实际靠 SKILL.md 让模型执行 npx）、`CANVAS_URL`/localhost:3000 逻辑不存在。
5. `SECURITY.md:39-40` 称安装前有 warning，实际是常驻警示条、无二次确认。
6. CHANGELOG 缺 v0.16/v0.17 段（`v0.16.0` tag 只在 upstream 上），v0.18.1/v0.18.2 无日期（解析器要求 `## 版本 - 日期`）。
7. `docs/` 的 `next dev` 与 web 默认同为 3000 端口，文档未提示冲突。

## 9. 当前阶段

- v0.18.2 是 fork「选择性吸收上游」的版本：核心叙事是把上游的「单节点候选卡片」换回「根节点 + 真实放置节点」，同时保留上游 v0.18.0 的参考栏、组引用、视频截帧、本地代理、WebDAV 删除同步等能力。
- `progress/todo.zh-CN.mdx` 只剩 2 条（Claude Agent SDK adapter、Skill 生态）；`pending-test.zh-CN.mdx` 有 100+ 条待人工验收，并明写「未执行构建、类型检查或自动测试」。
- 结论：处于「功能高速迭代 + 人工验收」阶段，不是稳定期；文档滞后与测试缺口是当前最现实的工程债。

## 10. 建议阅读顺序（约 2 小时）

1. `README.md` + `docs/content/docs/overview/features.zh-CN.mdx`（产品是什么）
2. `web/src/types/canvas.ts` + `web/src/stores/canvas/use-canvas-store.ts`（数据模型）
3. `web/src/lib/canvas/canvas-image-placements.ts`（批次不变量，全项目最难）
4. `web/src/pages/canvas/project.tsx`：按 2333（生成）/538（历史）/747（可见性裁剪）/3155（连线渲染）四处切入
5. `web/src/components/canvas/infinite-canvas.tsx` + `canvas-node.tsx`（渲染与手势）
6. `web/src/services/api/model-plugin.ts` → `image.ts` → `video.ts`（出网）
7. `canvas-agent/src/canvas/session.ts` + `server/http.ts` + `web/src/components/agent/local-agent-panel.tsx`（Agent 链路）
8. `web/src/lib/canvas/plugin-loader.ts` + `plugins/canvas/sdk/src/types.ts`（插件契约）
9. `web/src/services/app-sync.ts` + `config-file.ts`（同步与迁移）
