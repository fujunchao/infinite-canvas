# 上游 v0.18.0 与当前 fork 的差异研究

本文保留实施前的版本与工作区分析。经确认后的选择性移植已整理为 v0.18.1，当前实际变更与验收范围以[待测试清单](D:/augment-projects/infinite-canvas/docs/content/docs/progress/pending-test.zh-CN.mdx)为准，不能把本文的旧工作区描述当作移植后的状态。

## 结论

1. 本次核验的上游最新 `main` 与 `v0.18.0` 指向同一个提交 `d213a74614e0e4bd8a26383d1e1e907249e9c61b`。当前 fork 已提交版本是 `v0.15.4`，但其上游基线是 `v0.15.1`，不能按版本号把本地当作“纯上游 v0.15.4”。[版本记录][release-log] [fork 提交][fork-head]
2. 用户感到每张图片不再好操作，对应的是**真实独立节点变成单节点内部的候选卡片**。这条路线在上游 `v0.15.0` 已引入，`v0.16–v0.18` 继续完善，并没有恢复旧版“每张候选图原地拥有完整节点交互”。最新版仍由一个 `CanvasNodeData` 保存 `metadata.images[]`，展开的 `ExpandedImageCard` 不是画布节点。[版本记录][release-log] [生成结构][image-generation] [候选卡片][image-cards]
3. 不必在“保留旧操作”与“获得新功能”之间二选一。API 请求修复、临时图片持久化、Agent 改进、本地代理、视频续查等可以按功能移植；不宜整文件覆盖画布页面、节点渲染、资源解析和数据迁移实现。后者会把本地正在恢复的独立节点语义重新换回上游候选卡片语义。[上游差异范围][baseline-compare]

本报告是 Git 历史与固定提交源码研究，不是浏览器实测；没有运行构建、测试或语法检查，也没有切换分支、合并或修改业务代码。有关 API 的表述说明“上游代码如何发送请求”，不等于所有模型服务已经验证支持这些字段。

## 一、对比口径

| 对象 | 固定提交 | 含义 |
| --- | --- | --- |
| fork `v0.14.1` | `eb9e3a4b4fe1f80245b87276783787dd0078be9c` | 用户所说的“14.1”，合并上游 v0.14.0 后的 fork 版本；这里使用 annotated tag 解引用后的 commit |
| 共同上游基线 `v0.15.1` | `a2576d559ad765ba83e9563894adfbcd4e63405a` | 当前 fork 已包含的上游能力基线 |
| 当前 fork `HEAD / v0.15.4` | `86201d7cf073ac6beb3d83b76cce63108bf3e6af` | 含候选图拖出、双击或按钮放置为新独立节点的 fork 补丁 |
| 上游 `v0.16.0` | `9414048f9d0a099386aa15d81bedb5376b79ee61` | 导航、候选预览、工具栏和文本次数调整 |
| 上游 `v0.17.0` | `93ddcdedd58ffbf42a33982ca1bd92328824b126` | 引用栏、组输入、文本候选、遮罩流程和多项修复 |
| 上游 `v0.18.0` | `d213a74614e0e4bd8a26383d1e1e907249e9c61b` | 视频、尺寸设置、分组、本地代理、同步及 API 修复 |

当前工作区还有未提交的“资源根节点 + `metadata.imageRef` 真实放置节点”实现，**不能把它当成已发布 v0.15.4，也不能拿纯 HEAD 代表用户当前全部代码**。旧版交互与该实现的详细比较见下面第三、四节。本报告后半部分的“本地已有/缺少”默认以固定 HEAD 为准。[旧版 fork][fork-old] [当前 fork][fork-head]

`HEAD...upstream/main` 为本地独有 13 个提交、上游独有 49 个提交，包括合并提交；这是分叉量，不是功能数量。以下按真实用户功能归类，而不逐条机械翻译提交标题。

## 二、本地项目的整体链路

### 2.1 它不是单纯的生图页面，也不是云端画布后端

主应用是浏览器本地优先的多模态创作工作台。画布编排、独立生图/视频工作台、提示词、资产和全站 Agent 共享配置与资源能力，但并非同一个页面或同一份任务状态。[路由][local-router] [工作台状态][local-workbench-store]

| 部分 | 当前实现与职责 | 主要源码 |
| --- | --- | --- |
| 主应用与布局 | Vite + React 19 + React Router + TypeScript；Ant Design 6、Tailwind、Zustand；`UserLayout` 外挂全站 Agent 侧栏 | [依赖][local-web-package]、[路由][local-router]、[布局][local-layout] |
| 画布交互 | 普通 React DOM 节点通过 CSS translate/scale 变换到世界坐标；SVG 绘制连线。不是把所有节点画在同一张 bitmap 上 | [画布容器][local-canvas-container]、[画布页面][local-canvas-page] |
| 即时状态与保存 | 当前页面维护 nodes、connections、选区、视口、拖动和历史；Zustand 保存项目列表/项目快照，存储写入有 400ms 合并。画布 UI store 主要负责项目列表编辑/选择，不是所有节点交互的总仓库 | [页面状态][local-canvas-page]、[项目 store][local-canvas-store]、[项目 UI store][local-canvas-ui-store] |
| 生成链路 | 节点提示词 + 上游连线资源 → 生成上下文 → 节点覆盖全局生成配置 → image/video/audio/text API 或模型脚本 → 媒体保存 → 节点状态更新 | [生成上下文][local-generation-context]、[生成辅助][local-generation-helpers]、[图像 API][local-image-api] |
| 图片/视频工作台 | `/image`、`/video` 独立页面有各自生成记录与任务逻辑；它们与画布共享 API、配置及存储服务，而非复用画布节点 UI | [图像工作台][local-image-page]、[视频工作台][local-video-page] |
| 本地媒体与同步 | localforage/IndexedDB 保存项目、资产、Blob、工作台记录、提示词缓存；WebDAV 是用户配置的可选同步，不是账号登录后的云端自动同步 | [图片存储][local-image-storage]、[应用同步][local-app-sync]、[提示词缓存][local-prompts] |
| Canvas Agent | 独立 Node.js/Express 本机桥接服务，通过 HTTP/SSE 与网页交互，通过 MCP 暴露工具；网页才是节点变更的执行方 | [HTTP 服务][local-agent-http]、[浏览器桥接][local-agent-bridge]、[操作应用][local-agent-ops] |
| 节点插件与文档 | 注册表管理内置及动态节点；远程插件与模型调用脚本是不同扩展机制；`docs` 是独立 Next.js 文档站，主应用容器则是 nginx 静态站 | [节点注册][local-node-registry]、[插件加载][local-plugin-loader]、[主应用 Dockerfile][local-docker]、[文档 Dockerfile][local-docs-docker] |

生成链路的关键不是“图片显示在哪”，而是**哪一个 node id 被选择、哪一个 node id 是连线端点、请求从哪里取到该图的真实资源**。因此仅把候选卡片样式画得像节点，并不能恢复独立节点操作。

### 2.2 三种身份不能混为一谈

- **节点身份**：`CanvasNodeData.id`，决定选择、坐标、宽高、工具栏、连线、复制、删除和 Agent 寻址。
- **图片资源身份**：`storageKey` 指向真实 Blob；`blob:` 展示 URL 只适合当前浏览器会话。多个节点可以共享同一张图片文件，不必重复存文件。
- **批次/分组关系**：多图批次用于共同生成与挑主图；`Group + metadata.groupId` 用于整理画布中的不同节点。两者都能呈现“成组”，但数据语义与操作目的不同。[本地类型][local-canvas-types] [图片存储][local-image-storage]

本地当前的 API Key 仍由浏览器保存并用于请求所配置模型接口。Canvas Agent 服务不承担默认 AI 图片请求的统一服务端代理；上游 v0.18 新增的 Canvas Proxy 又是另一个可选进程，三者不能混写。[图像请求][local-image-api] [Agent 服务][local-agent-http] [新代理][proxy-source]

### 2.3 fork 不是只改了版本号

除了 v0.15.3 的窄节点按钮适配、v0.15.4 的候选图放置补丁，本地还保留了：素材只有 `storageKey` 而 URL 为空时的资源解析、素材插入元信息、提示词引用展示修正、旧多图数据关系处理、旧 Agent IndexedDB 附件只读回退，以及自己的仓库/GHCR/部署/版本检查/插件入口。[fork 版本记录][local-changelog] [素材解析][local-image-source] [历史附件回退][local-legacy-agent]

上游与 fork 的文件差异中，“上游没有某个 fork 文件”不意味着上游主动删除了该功能；例如本地新增的迁移、资源解析和历史附件回退文件，应按 fork 补丁看待。只按 `git diff` 的删除标记或整文件取上游，会误丢这些补丁。

## 三、v0.14.1 的独立图片节点到底怎样工作

### 3.1 生成 3 张图片，实际是 4 个节点框

旧版数量大于 1 时创建 **1 个根节点 + N 个真实子图节点**，N 个子图从一开始就是 `nodes[]` 的成员，各有 id、坐标、宽高、状态和图片元数据。根使用 `isBatchRoot / batchChildIds`，子图使用 `batchRootId`；展开状态 `imageBatchExpanded` 存在根元数据中。[旧版类型][old-types] [旧版生成创建][old-generation]

```text
提示词/配置 ─→ 根节点（主图镜像）
                 ├─→ 图片 A：独立节点，可移动、缩放、接下游
                 ├─→ 图片 B：独立节点，可移动、缩放、接下游
                 └─→ 图片 C：独立节点，可移动、缩放、接下游
```

这是关系示意，不是固定坐标截图。初始布局在根右侧按两列放置子图；**4 个框不等于请求生成 4 张图**，实际仅向 N 个子槽位逐项发 count=1 的生成请求，根显示第一张成功图片的镜像。[旧版生成创建][old-generation] [旧版结果回填][old-generation-results]

- 空图片节点生成 1 张：直接填回原节点。
- 空图片节点生成多张：原节点成为根，并创建 N 个子节点，默认展开。
- 已有图片继续生成：原图作为参考保留，在下游创建新批次。
- 每项有自己的 loading/success/error；成功图可用，失败图可单项重试，不需要等待整批全成功。[旧版生成创建][old-generation] [旧版重试][old-retry]

### 3.2 用户手上的操作顺序

| 动作 | v0.14.1 的实际语义 | 证据 |
| --- | --- | --- |
| 单击普通图片/批次子图 | 选中该图的真实 id，显示对应工具栏；未拖动的单图点击可打开自身下方提示词面板 | [选择与拖动结束][old-selection] |
| 拖动某张子图 | 更新同一个节点的坐标；不新建副本，不必先脱离批次 | [节点拖动][old-selection] |
| 拖动根节点 | 把 `batchChildIds` 加入移动集合，子图随根平移；单拖子图不会移动根 | [拖动集合][old-selection] |
| 拖四角 | 对该节点独立改宽高和位置，默认按原图比例；允许显式自由比例 | [尺寸计算][old-resize] |
| 从子图连线 | 子图本身就有左右连接点，连线端点是该子图 id，可以直接参与后续工作流 | [连接点][old-node-events] |
| 双击子图/普通图片 | 打开放大预览，不生成副本 | [双击判断][old-node-events] |
| 双击根/点击数量按钮 | 展开或收起本批图；折叠隐藏子图和对应连线，数据仍在 | [双击判断][old-node-events]、[收放状态][old-primary]、[隐藏判定][old-geometry] |
| 设为主图 | 从子图上的按钮将根显示切到该图，子节点本身保留 | [主图按钮][old-image-content]、[主图切换][old-primary] |
| 使用图像工具 | 选中该图后可下载、存素材、编辑提示词、裁剪、局部编辑、切图、放大、角度编辑等；不需要先“创建副本”取得工具栏资格 | [旧工具栏][old-toolbar] |
| 删除 | 删除子图同步更新根的子图列表/主图；删除根级联删除子图；删掉对应真实连线 | [旧版删除][old-delete] |
| 保存再打开 | 节点位置、尺寸、连线、批次字段和展开字段都属于项目数据；图片用 storageKey 重新解析展示 URL | [旧版类型][old-types]、[项目 store][local-canvas-store] |

补充两个容易被“还原旧版”说法掩盖的细节：

1. 根有多个随动子节点时，旧 `finishNodeDrag` 用“拖动集合只有一个节点”识别点击，因此“单击子图开面板”不能机械扩大成“所有根节点单击都自动开面板”。[旧选择源码][old-selection]
2. 旧复制逻辑已有节点与连线复制，但没有系统重映射所有批次字段；旧设主图也没有同步写齐 `storageKey / bytes / mimeType`。应保留旧操作方式，不应为了像旧版而恢复这些实现缺口。[旧复制逻辑][old-copy] [旧主图实现][old-primary]

### 3.3 改变手感的真正断点

上游提交 [`de49430`：把多图合并为单节点][collapse-into-one] 在 v0.15.0 中把 N 个子图从真实节点变成了根的 `metadata.images[]`。随后再用 `ExpandedImageCard` 画出备选图。

从画面上看仍有多张图片，但从系统角度，备选图没有自己的画布节点 id、坐标持久化、缩放边框和连线端口。**“选中一张结果就能继续操作”变成了“先挑候选，再创建副本，才能按节点继续操作”。**这是交互模型变化，不是单靠按钮颜色、默认工具或卡片间距能解决的问题。

## 四、当前发布版、工作区与上游不能混着比较

### 4.1 四种实现的直接对照

| 维度 | fork v0.14.1 | fork v0.15.4（HEAD） | 当前未提交工作区 | 上游 v0.18.0 |
| --- | --- | --- | --- | --- |
| 生成 3 图的画布结构 | 1 根 + 3 真子节点 | 1 根 + 2 内部候选卡片 | 1 资源根 + 3 真放置节点 | 1 根 + 2 内部候选卡片 |
| 候选身份 | 真正 node id | image id，不是 node id | 真正 node id，另带 imageRef | image id，不是 node id |
| 拖某张候选 | 移动原节点 | 拖出后新增节点，源候选仍保留 | 移动原放置节点 | 卡片不支持独立拖动，须创建副本 |
| 候选原地选中/缩放/接线 | 支持 | 不完整，需先放置为新节点 | 已接入普通节点路径，待手工验证 | 不支持，须先创建副本 |
| 双击候选 | 预览 | 新建独立节点 | 预览 | 预览 |
| 双击根 | 收放批次 | 收放批次 | 收放批次 | 预览主图 |
| 收放状态 | 根 metadata，随项目保存 | 页面单 id，部分其它操作会收起 | 页面 Set，多批；不持久化 | 页面 Set，多批；不持久化 |
| 图片资源 | 子节点完整元信息，根镜像主图 | 根 images[]，放置副本共享 Blob | 根 images[] 权威资源，放置节点引用 | 根 images[]，独立副本共享 Blob |

旧版证据见第三节；HEAD 的 `placeBatchImage` 明确 `nanoid()` 后追加节点，没有移除源候选。[本地放置实现][head-placement] 上游同类操作是 `duplicateBatchImage`。[上游创建副本][duplicate-image] 工作区行为来自本次读取的未提交源码，不能用线上 fork HEAD 链接替代。[工作区放置模型][wip-placement-model] [工作区画布接入][wip-canvas-page] [工作区节点渲染][wip-node]

v0.15.3 主要解决窄图按钮显示；v0.15.4 增加拖出、双击和“独立到画布”按钮，但二者没有让批次候选从生成之初就拥有完整节点身份。因此“v0.15.4 恢复旧版交互”的发布标题不等于与 v0.14.1 完全等价。[本地版本记录][local-changelog] [放置实现][head-placement]

### 4.2 未提交方案已做什么，仍有哪些不同

工作区没有退回整套旧数据格式，而是保留 `metadata.images[]`，给每个资源增加真实 `CanvasNodeData` 放置节点，以 `metadata.imageRef = { batchNodeId, imageId }` 指向根资源。`resolveImagePlacementNode` 在渲染/使用时补出图片内容与参数，不重复保存图片 Blob。[工作区放置模型][wip-placement-model] [工作区类型][wip-types]

已经能在源码中看到的配套链路包括：生成时建立 N 个真实放置节点；渲染前解析资源；普通选择/拖动/缩放/连线和工具栏；设主图；折叠隐藏节点及外部连线；根拖动联动子图；删除/解散；复制引用重映射；旧数据转换；Agent 操作应用及引用解析。[工作区画布接入][wip-canvas-page] [工作区数据转换][wip-migration] [工作区 Agent 操作][wip-agent-ops] [工作区引用][wip-references]

但它不是逐字节复刻 v0.14.1：

- **没有旧版根→子内部连线**：关系通过 imageRef 表示，外部工作流连线仍是真实连线。旧版内部连线会在转换时被移除。
- **展开状态不随项目保存**：当前是页面 Set；初次载入与旧 metadata 布尔值的行为不同。
- **编辑会解除引用**：打开裁剪/遮罩/切图/放大/角度工具时，或修改提示词/配置时，先 materialize 为普通图片节点。部分动作在打开编辑弹窗时就发生，并非只在确认结果时发生。若它是该图片最后一个放置引用，根中对应资源会移除；剩一图时解散批次。
- **默认工具仍为选择**：当前 pan 模式仍可从节点上拖动画布，尚未引入上游“仅背景 pan、节点保持可拖”的命中修正。
- **设主图采用改进后的尺寸/元信息同步**：保留根中心与最大边长，再适配新比例，而不是旧版直接照搬子节点宽高。

以上分别来自 [工作区放置逻辑][wip-placement-model]、[工作区页面的收放/编辑入口][wip-canvas-page]、[当前导航容器][local-canvas-container]，都是现有改动的行为描述，不是本次新增实现。

### 4.3 建议先确定的交互约定

若目标是恢复 v0.14.1 最有价值的手感，建议后续以这些约定验收，而不是以“节点看起来分开了”验收：

1. 每张候选图从生成开始就可作为真实节点操作；拖动只改变同一 id 的坐标，不悄悄复制。
2. 候选不必先脱离批次，就能选中、按原比例缩放、连接下游、预览、下载、重试和打开完整工具栏。
3. 普通操作不改变其主图身份或批次成员关系；何时解除引用应是明确设计，不应被“打开工具又取消”隐式触发。
4. 折叠只隐藏，不销毁候选位置和外部连线；切主图只改变根镜像，不改变其它候选及其下游引用。
5. 根/子图的移动、删除、复制、刷新恢复、Agent 操作使用同一套关系语义；节点多份展示可共享文件，不复制 Blob。
6. 是否保留根→子连线、是否记住展开状态、根双击是收放还是预览，作为三项明确的旧习惯取舍，不随功能升级默认变更。

这些是本报告提出的后续设计/验收建议，不代表现有工作区已经全部满足。当前相关事项仍列在原有待测文档中。[现有待测清单][local-pending-tests]

## 五、v0.15.1 → v0.16.0

| 类别 | 上游变更 | 与当前 fork HEAD 的关系 |
| --- | --- | --- |
| 画布导航 | 默认工具从“选择”改为“移动”；移动模式左键拖背景平移、左键拖真节点移动该节点；中键仍可平移 | 本地已有选择/移动两模式和 Ctrl/空格临时反转，新增的是默认值和命中判定，不是整套导航。[导航提交][nav-change] |
| 多图展开 | 单个展开 id 改成 Set，允许多批同时展开；点空白、拖动、缩放不再自动收起 | 本地 HEAD 仍是单个 `expandedImageNodeId`；工作区未提交方案另计。[展开提交][expand-change] |
| 双击图片 | 多图根双击改为预览，不再切换展开；展开候选双击直接预览该候选，不必先设为主图 | 与本地 HEAD 的“候选双击放置独立节点”冲突，也与旧版“根双击收放”不同。[预览提交][preview-change] [fork 放置补丁][fork-head] |
| 提示词与工具栏 | 图片工具栏默认只显示图标；去掉图片的“编辑”入口和文本的“编辑正文”按钮；文本单击也直接开下方面板 | 本地图片、视频单击下方面板已经存在，不能算新功能；新增的是文本单击行为和入口简化。[工具栏与次数提交][text-count-toolbar] |
| 缩放稳定性 | 缩放期间临时不渲染下方提示词面板，释放后恢复 | 可单独移植的稳定性修复，不要求替换图片数据模型。[缩放提交][resize-change] |
| 文本生成 | 新增 `metadata.textCount`，默认为 1，配置/文本节点不再误用图片 `count`；UI 范围 1–15 | 可独立采用次数字段，不必连带采用 v0.17 文本候选卡片。[工具栏与次数提交][text-count-toolbar] |
| 提示词来源 | 新增 Freestylefly GPT Image 2 内置来源 | 本地已有提示词来源系统，仅缺新增来源条目。[来源提交][prompt-source] |
| 协议删减 | 删除 `ark` 协议、Seedance 特定设置、参数转换、参考素材校验；独立视频工作台同时移除参考视频/音频 UI | 这不是单纯新增。使用 Ark/Seedance 专用能力时，整包合并会失去现有入口。[删除适配提交][ark-removal] |
| 请求错误 | 识别无响应的网络失败，最初增加跨域相关提示 | v0.17 后又改为通用“请求失败”，不能把早期“明确诊断跨域”的 changelog 直接当作 v0.18 当前文案。[初始处理][network-change] [后续调整][network-message-change] |

## 六、v0.16.0 → v0.17.0

| 类别 | 上游变更 | 本地状态与边界 |
| --- | --- | --- |
| 参考内容栏 | 提示词输入框和放大编辑框上方增加引用预览、移除按钮、“+”连续从画布选取节点；Esc/完成后回到输入面板 | 本地已有连线和 `@` 引用，但没有这套参考栏选择模式。[参考栏提交][reference-change] |
| 组作为输入 | Group 可用一条输出连线或一个 `@` 引用组内有效资源；组本身不能成为连线目标 | 本地已有可拖入/移出及联动移动的组容器；“组输入生成”是增量，不是首次引入组。[组输入提交][group-input-change] |
| 侧栏层级 | 画布元素列表按组/子项展示，可展开折叠 | 本地已有元素列表定位、预览和批量导出，新增的是组树展示。[侧栏提交][group-tree-change] |
| 视频截帧 | 右键视频可截首帧、尾帧、当前帧，生成等比图片节点并连接到视频；使用独立 video 元素截取，不修改原播放器时间 | 本地缺少此入口；与独立图片节点相容。[截帧提交][video-frame-change] |
| 文本多结果 | 多次文本生成不再创建多个结果节点，改为一个节点的 `texts[] / primaryTextId`，其余作为可展开备选文本 | 与偏好“每个结果都是独立节点”的方向不一致；不要只因名为“优化”就采用。[文本候选提交][text-batch-change] |
| 文本按钮 | 移除文本正文右上角的生图按钮，正文占满区域 | 不是取消文本生图能力，上方工具栏 `generateImage` 仍保留。[按钮提交][text-button-change] [当前工具栏][node-toolbar] |
| 透明图片 | 候选卡片有图片内容时去掉底色、边框和阴影，透明图不再出现白底 | 可采用视觉效果，但无需搬回整套候选卡片。[透明修复][transparent-change] |
| 图像 API | GPT Image 的生成/编辑请求不再强制发送 `response_format`；其他模型仍保留对应设置 | 本地仍发送该字段，可小范围移植。[参数修复][gpt-response-fix] |
| 图片存储 | 统一在 `uploadImage` 下载外链、校验可解码后本地保存，支持取消/超时；无法 fetch 但仍能显示的远程图可保留原 URL | 本地已会把可读取图片保存到 IndexedDB；新增的是统一处理与失败语义，不是首次支持本地存图。[外链修复][remote-image-fix] [统一持久化][image-persistence-refactor] |
| 遮罩编辑 | 删除 API `mask` 参数流程；改为原图 + 蓝色半透明区域标注图，作为两张参考图并用提示词说明编辑区域 | 会改变请求语义、画布节点数量和模型处理方式；适合单独决定，不应当作无感修复。[遮罩重做][mask-change] |
| Agent | CLI stderr 先按行缓冲再脱敏；配置目录/文件设置 0700/0600；连接 Token 用 URL fragment 读取后清除；纯已有节点引用的提示词不再复制出文本节点 | 可按边界移植，无需改图像交互；Agent 消息存储协议不是这次整体重写对象。[日志脱敏][agent-log-fix] [配置权限][agent-permissions-fix] [fragment][agent-fragment-fix] [引用复用][agent-reference-fix] |
| 文档站 | 默认英文路径重写/语言切换调整，解决重定向循环；移动端分类选择、桌面滚动目录改善；更新指南与待测说明 | 本地已具有双语文档和顶部分类，新增的是路由修正及导航增量，不是从零搭建文档。[导航提交][docs-navigation-change] [路由提交][docs-routing-change] |

## 七、v0.17.0 → v0.18.0

| 类别 | 上游变更 | 本地状态与边界 |
| --- | --- | --- |
| 生图 API 修复 | 多图编辑以 `image[]` 提交，单图仍用 `image`；Gemini 图片配置改为 `generationConfig.imageConfig`；上游文本按“文本N”分块 | 都可按较小代码片段移植，不需要改掉独立节点。[多图参数修复][multipart-fix] [图片 API][image-api] [文本编号修复][text-label-fix] |
| 图像尺寸 | 分辨率 1K/2K/4K/auto 与比例拆开；增加 21:9、9:21；根据比例使用固定像素表并识别分辨率档位 | 本地已有部分 2K/4K 预设和尺寸输入，新增的是组合式设置及固定表。上游“4K 方图”是 2880×2880，不代表每个比例长边均为 4096。[设置提交][size-settings-change] [最终尺寸表][media-size] |
| 视频设置 | 480p/720p/1080p 与 1:1、3:4、4:3、16:9、9:16、21:9、auto 组合计算宽高；保留自定义尺寸/分辨率输入；时长改成 4–30 秒滑杆 | 本地已有分辨率、宽高和时长设置，不是首次支持这些参数。[视频设置源码][video-settings] |
| 视频生成模式 | 默认 `frames` 首尾帧、可选 `reference` 全能参考；多于两张图会自动按全能参考发送；补充内置 Gemini 长任务路径 | OpenAI、Gemini 内置请求和脚本模板都按模式组装相应字段，但是否被具体渠道接受仍取决于渠道协议。[视频模式提交][video-mode-change] [视频 API][video-api] |
| 视频恢复 | 保存内置 OpenAI/Gemini 任务 id 与 provider，画布重新打开后续查；有 id 但无内容时可手动“获取任务状态” | 本地视频工作台原本已管理任务记录；新增重点是画布视频节点刷新续查。自定义脚本不具备同等恢复能力。[视频恢复提交][video-resume-change] [画布恢复源码][video-resume-source] |
| 自定义调用脚本 | 全屏分步骤编辑器、复制外部 AI 写脚本说明；模板使用英文函数和 JSDoc；补全图像质量/背景及视频/音频参考 File[]、视频 mode 参数 | 本地已有脚本系统，不是首次支持自定义请求。视频工作台页面并未随之恢复视频/音频参考上传 UI。[脚本编辑器][script-editor] [脚本运行与模板][script-runtime] [当前视频工作台][video-workbench] |
| 多选打组 | 整体虚线选区、一键打组/解组，右键和 Ctrl/Cmd+G、Ctrl/Cmd+Shift+G；组工具栏支持解组 | 本地已能手动创建 Group 并拖入子节点，新增的是选区包组与解散入口。[分组提交][selection-group-change] |
| 本地代理 | 配置增加本地代理开关、地址、连通测试和启动命令；新增独立 `@basketikun/canvas-proxy` 包，默认本机 23210；接口、模型列表、媒体下载、脚本 HTTP helper 可通过它转发 | 本地缺此统一转发层；它不是把画布改成云端数据库，也不是取代 Canvas Agent。脚本绕开 helper 自己直接 fetch 不自动改写。[代理提交][proxy-change] [代理实现][proxy-source] [代理 URL helper][proxy-helper] |
| WebDAV | 测试与同步也走启用的本地代理；记录删除画布的时间戳，避免远端旧画布在同步时复活 | 本地源码已存在可选 WebDAV，同步不是 v0.18 首次引入。删除标记按更新时间比较，不是无条件删除远端所有同 id 内容。[同步修复提交][sync-change] [合并规则][sync-source] |
| 资产下载 | 先读 `storageKey` 对应 Blob，再回退 URL，使用 Blob 下载并处理失败 | 修复预览地址/下载地址不一致等问题，不影响图片节点交互。[下载修复][asset-download-fix] |
| URL 配置导入 | Base URL 规范化后匹配已有渠道；匹配则更新，否则新增，不再覆盖第一渠道；缺失或非法 URL 不改配置 | 本地已有 URL 导入入口，新增的是不破坏已有渠道的导入规则。[渠道修复][channel-import-fix] |
| 其他 | 启动示例显式使用 `@latest`；README 添加服务商介绍/推广图；版本及文档更新 | 不属于画布核心交互；同步时仍需保留 fork 的仓库、镜像、插件注册表和发布来源。[启动命令提交][agent-latest-change] [最终版本记录][release-log] |

## 八、最新版“每张图”的交互事实

### 8.1 一批图仍然只有一个真实节点

- 生成 N 张图时先创建一个根节点，内部建立 N 个 `CanvasNodeImage` 槽位，而不是 N 个真实 `CanvasNodeData`。第一个成功结果同步到根的 `metadata.content / storageKey / naturalWidth / naturalHeight / primaryImageId`，供根显示和下游引用。[生成源码][image-generation]
- 根上有 N 张时，展开显示的是主图 + N−1 个绝对定位候选卡片；不是旧版 root + N 个独立子节点。最多 4 列，卡片尺寸统一取根的 `width / height`，图片以 `object-contain` 放入，不具有自己的节点边界或连线端口。[候选源码][image-cards]
- 候选卡片的 `onMouseDown` 与 `onPointerDown` 都 `stopPropagation()`。上层节点的捕获选择可落在根上，但没有独立候选 node id 可选；卡片不能直接作为一等节点独立拖动、缩放或接线。[节点捕获与端口][node-selection] [候选事件][image-cards]
- “创建副本”才会 `nanoid()` 出一个独立图片节点；新节点拥有普通图像交互，原候选保留不动。它不是把那张候选原地移动，也不是恢复根与候选之间的旧关系。[创建副本源码][duplicate-image]

这正是交互负担的来源：旧版可直接拿某张结果继续连线、移动、编辑；上游现在把“挑选候选”和“编辑/编排节点”分成两步。区别不只是按钮样式。

### 8.2 展开、双击、主图、下游引用

- 右上角张数按钮是展开/折叠入口；根双击预览当前主图，候选双击预览对应候选。展开状态由页面 Set 管理，多批可以同时开；拖动、缩放、点其它区域不自动关闭。它不写入项目元数据，重新挂载页面默认还是未展开状态。[预览提交][preview-change] [展开提交][expand-change] [页面 state][canvas-state]
- 修改主图会改根的 content/存储元信息，保留中心与当前最大边长，再按新图比例调整根尺寸；自由缩放模式保留确切宽高。[主图切换][set-primary]
- 引用图像节点默认读取的是节点 `metadata.content`，不是候选 `images[]` 的某一项。直接连接一个多图根，是连接其当前主图；后续切主图会改变下一次生成解析到的引用图。要稳定使用某候选，上游路径是先创建独立副本。[引用读取][generation-inputs]
- 展开某批时会隐藏该根的浮动工具栏；其他未展开节点仍可显示工具栏。这一点本地 v0.15.4 已做了类似“只隐藏对应根”的调整，不能全部列作新功能。[当前画布工具栏接入][toolbar-integration] [fork 补丁][fork-head]

### 8.3 真节点并没有因为默认“移动工具”而不能移动

`InfiniteCanvas.handlePointerDown` 先排除输入面板/连线创建菜单，再用 `[data-node-id],[data-connection-id]` 区分背景。只有“中键”或“左键 + pan + 背景”启动平移；左键落到普通节点继续走 `handleNodeMouseDown` 的拖动逻辑。Ctrl/空格临时反转工具，改变的是背景拖动的选择/平移行为。[平移判定][canvas-navigation] [节点拖动][node-drag]

因此要分别看待三件事：默认导航手感、真实节点拖动、候选卡片缺少独立节点能力。只把默认 pan 改回 select，并不能修复第三件事。

### 8.4 工具栏与文本不是功能全部消失

图片工具栏默认 `showLabels: false`，但配置仍可打开文字；去掉的是图片“编辑”快捷入口和文本 `editText` 入口。文本正文仍双击编辑；图片仍可裁剪、切图、局部编辑、放大、换角度等；视频保留独立 edit 按钮。[工具栏配置][image-tools] [当前工具栏][node-toolbar] [双击处理][node-selection]

v0.17 文本候选复用同一套 `BatchFrame`：一个结果节点、多个 `texts[]`、切主文本。生成结束后只保留成功文本，失败项从 `texts[]` 移除并提示错误，不等同于图像候选长期保留失败槽位及单项重试的行为。[文本渲染][text-cards] [文本生成收尾][text-generation]

## 九、需要特别区分的新增交互

### 9.1 参考栏、Group 和图像批次不是同一个概念

1. Group 通过 `metadata.groupId` 收集直接子资源，不是按 `metadata.images[]` 展开一个批次，也不是任意层级递归 Group。[组资源读取][group-resources]
2. 组引用会在参考栏展开为多个缩略项，但每项的 `sourceNodeId` 仍为组 id；删除任一项会断开整条“组 → 目标”连线，而非只排除那一张图。[参考栏源码][reference-bar]
3. “+”进入连续选择模式：目标/已连接内容禁选，可引用节点可点选；此时暂时关闭下方面板、隐藏普通缩放/连线手柄；Esc 或完成回到目标面板。[参考选择提交][reference-change] [节点模式处理][node-selection]
4. 一键打组会把选中 Group 的直接成员展平进新组；解组会移除被解散组及其相关连接。它不是保留任意嵌套结构的通用分组系统。[组几何与连接处理][group-geometry]

移植到本地真实 `imageRef` 放置节点时，需要沿用本地资源解析并明确根/放置节点去重、隐藏候选是否可引用等规则；直接复制上游只读 `metadata.content` 的代码会绕过这层语义。上游分组工具栏还存在固定白底/深色文字样式，应按本项目主题规范适配，而不是原样搬入。[引用读取][generation-inputs] [分组工具栏][selection-toolbar]

### 9.2 新版遮罩实际是“区域标注参考图”

原流程调用 `requestEdit(config, prompt, [source], mask, options)`。新流程：在原图上叠加透明度 0.4 的蓝色涂抹，保存为普通图片；画布增加标注图节点和目标图节点，并从原图、标注图分别连到目标；请求发送两张参考图，提示词说明哪张是原图、哪张标注待编辑区域。导出只准备这些节点；“生成”再执行请求。[完整遮罩提交][mask-change] [当前标注合成][mask-source]

这不等同于协议层显式 mask：模型是在理解标注图，而不是接收标准透明掩膜字段。应把它视为另一种局部编辑模式，而不是强制替换用户既有操作。

### 9.3 视频更新的准确边界

- 内置 OpenAI 请求：首尾帧发 `first_frame / last_frame`；全能参考发 `image[]`，另有 `video[] / audio[]`。内置 Gemini 发送 `image / lastFrame` 或 `referenceImages`，使用 `predictLongRunning` 与 operation 查询。[视频 API][video-api]
- 模式显式设为 reference **或图片超过两张**时，发送全能参考。也就是说 UI 选了首尾帧，超过两图仍可能按 reference 执行。[模式判定][video-api]
- 画布内置任务保存 `videoTaskId / videoTaskProvider` 后可恢复；查询失败保留 id 以便重试，确认远端任务失败时清 id；已有视频内容不再续查。[画布恢复][video-resume-source]
- 查询循环仍有上限：最多 120 次、查询之间等待 2500 ms，另加请求耗时，并非无限自动查询。恢复只在画布还原后触发一次，不是整个应用后台永久监控所有项目。[轮询源码][video-api] [恢复 effect][video-restore-effect]
- 自定义脚本在创建阶段内部执行 create+poll，结果只保存在 `pluginVideoResults` 内存 Map；没有内置远端 task id 的同等刷新恢复保证。[脚本视频路径][video-api]
- 最新独立视频工作台仍只提供最多 7 张参考图片，并非“视频/音频参考 UI 全面回归”。API/脚本支持 File[] 与页面是否提供上传入口，需要分开描述。[视频工作台源码][video-workbench]

### 9.4 “临时图片已本地化”也不是绝对保证

`uploadImage` 成功 fetch 并解码的内容才写入本地。若 fetch 因网络/跨域失败，但 HTMLImageElement 仍能读取尺寸，上游保留远程 URL，返回的 `storageKey` 可为空。HTTP 非成功、下载超时、取消则不走这个显示兜底。[图片持久化源码][image-storage]

因此可移植统一保存与取消能力，但不能宣称所有临时链接都已经离线保存；本地资源根/放置节点应继续能够区分“有本地资源”和“仅远程显示”。

## 十、保留独立节点的移植建议

以下是依据代码触及范围提出的建议，不是已经实施的升级结果。

### A. 优先移植：与节点身份基本解耦

- GPT Image 去 `response_format`、多参考图 `image[]`、Gemini `imageConfig`、文本编号分块：按最小代码片段采用，不整文件替换本地资源解析。[图像 API][image-api] [编号修复][text-label-fix]
- URL 渠道导入修复、资产 Blob 下载、Freestylefly 来源。[渠道修复][channel-import-fix] [下载修复][asset-download-fix] [来源提交][prompt-source]
- Agent 日志脱敏、配置权限、fragment 引导及纯引用复用；保留本地已有消息归属/存储补丁。[日志][agent-log-fix] [权限][agent-permissions-fix] [fragment][agent-fragment-fix] [引用复用][agent-reference-fix]
- 提示词面板缩放期间隐藏；独立 `textCount` 字段可以保留，即使继续输出独立文本节点。[缩放修复][resize-change] [次数字段][text-count-toolbar]
- 文档站路由/导航修复，保留 fork 链接和既有双语修订。[文档路由][docs-routing-change]

### B. 可移植，但要做集成适配

- 图片外链持久化：统一 `uploadImage`、可选 storageKey、AbortSignal 和错误状态；与本地根资源、候选放置、导出/清理流程一起检查，不能丢失存储引用。[图片持久化][image-storage]
- 本地代理 + WebDAV 删除记录：请求层与节点 UI 解耦，但横跨 config、脚本 helper、媒体存储、WebDAV 与同步状态；拆开代理和删除标记两个能力集成。[代理提交][proxy-change] [同步提交][sync-change]
- 视频续查、视频截帧、尺寸设置和脚本编辑器：不会要求图像候选退回卡片；但调用参数、Node metadata、画布状态入口和语言资源需要同步接好。[视频恢复][video-resume-change] [视频截帧][video-frame-change] [尺寸设置][size-settings-change]
- 参考栏、Group 输入、侧栏树、一键分组：功能有价值，但必须适配真正可寻址的本地放置节点、主图根去重、连线归属和统一主题。[参考栏][reference-change] [组输入][group-input-change] [分组][selection-group-change]
- 展开状态按 Set 管理、不因点空白自动收起：可保留行为，但应落在本地真实候选节点的显示控制上，不复制上游 `ExpandedImageCard`。[展开提交][expand-change]

### C. 不应随整包更新默认接受

- 上游 `CanvasNode` 的虚拟候选卡片、`duplicateBatchImage` 工作流，以及与之耦合的生成/引用布局；这正是用户不适应的交互方向。[候选卡片][image-cards] [副本创建][duplicate-image]
- 根双击从收放变预览、候选双击从放置变预览、图片工具栏入口消失、默认 pan：属于使用习惯选择，不能混入“修 bug”无声覆盖。[预览变化][preview-change] [工具栏变化][text-count-toolbar] [导航变化][nav-change]
- 文本多结果并成 `texts[]`：同样把可直接编排的结果收进候选面板。[文本批次][text-batch-change]
- 删除原 API mask、删除 Ark/Seedance 与视频工作台参考媒体入口：属于能力/语义删改，不是必须接受的技术前提。[遮罩变化][mask-change] [协议删减][ark-removal]

建议采用“**保留节点身份与交互约定，逐功能吸收上游能力**”，而不是“先覆盖到 v0.18 再追着恢复所有旧操作”。上游大量功能集中修改画布页面及节点组件，Git 能自动合并并不代表用户交互语义保持不变。[完整差异][baseline-compare]

## 本次工作范围与进度文档

- 本次只读取本地代码、Git 历史与上游源码，并新增本研究报告；没有改业务代码，没有升级、合并、提交或发布。
- 开始时工作区已有的多图节点、资源关系、迁移与待测文档改动均保留，不能记成本次实现。
- 已检查中英文 TODO 和 pending-test：没有新增已实现功能或已完成 TODO，因此本次不移动待办、不增加虚假的测试通过记录，也不改现有待测清单。

## 一手来源索引

已提交版本的链接固定到核验的 commit，不使用移动的 `main` 作为结论证据。明确标注“工作区”的绝对路径链接对应本次读取的未提交快照；后续编辑可能改变其内容。

[local-web-package]: https://github.com/fujunchao/infinite-canvas/blob/86201d7cf073ac6beb3d83b76cce63108bf3e6af/web/package.json
[local-router]: https://github.com/fujunchao/infinite-canvas/blob/86201d7cf073ac6beb3d83b76cce63108bf3e6af/web/src/router.tsx
[local-layout]: https://github.com/fujunchao/infinite-canvas/blob/86201d7cf073ac6beb3d83b76cce63108bf3e6af/web/src/layouts/user-layout.tsx
[local-canvas-container]: https://github.com/fujunchao/infinite-canvas/blob/86201d7cf073ac6beb3d83b76cce63108bf3e6af/web/src/components/canvas/infinite-canvas.tsx
[local-canvas-page]: https://github.com/fujunchao/infinite-canvas/blob/86201d7cf073ac6beb3d83b76cce63108bf3e6af/web/src/pages/canvas/project.tsx
[local-canvas-store]: https://github.com/fujunchao/infinite-canvas/blob/86201d7cf073ac6beb3d83b76cce63108bf3e6af/web/src/stores/canvas/use-canvas-store.ts
[local-canvas-ui-store]: https://github.com/fujunchao/infinite-canvas/blob/86201d7cf073ac6beb3d83b76cce63108bf3e6af/web/src/stores/canvas/use-canvas-ui-store.ts
[local-workbench-store]: https://github.com/fujunchao/infinite-canvas/blob/86201d7cf073ac6beb3d83b76cce63108bf3e6af/web/src/stores/use-workbench-agent-store.ts
[local-generation-context]: https://github.com/fujunchao/infinite-canvas/blob/86201d7cf073ac6beb3d83b76cce63108bf3e6af/web/src/components/canvas/canvas-node-generation.ts
[local-generation-helpers]: https://github.com/fujunchao/infinite-canvas/blob/86201d7cf073ac6beb3d83b76cce63108bf3e6af/web/src/lib/canvas/canvas-generation-helpers.ts
[local-image-api]: https://github.com/fujunchao/infinite-canvas/blob/86201d7cf073ac6beb3d83b76cce63108bf3e6af/web/src/services/api/image.ts
[local-image-page]: https://github.com/fujunchao/infinite-canvas/blob/86201d7cf073ac6beb3d83b76cce63108bf3e6af/web/src/pages/image/index.tsx
[local-video-page]: https://github.com/fujunchao/infinite-canvas/blob/86201d7cf073ac6beb3d83b76cce63108bf3e6af/web/src/pages/video/index.tsx
[local-image-storage]: https://github.com/fujunchao/infinite-canvas/blob/86201d7cf073ac6beb3d83b76cce63108bf3e6af/web/src/services/image-storage.ts
[local-app-sync]: https://github.com/fujunchao/infinite-canvas/blob/86201d7cf073ac6beb3d83b76cce63108bf3e6af/web/src/services/app-sync.ts
[local-prompts]: https://github.com/fujunchao/infinite-canvas/blob/86201d7cf073ac6beb3d83b76cce63108bf3e6af/web/src/services/api/prompts.ts
[local-agent-http]: https://github.com/fujunchao/infinite-canvas/blob/86201d7cf073ac6beb3d83b76cce63108bf3e6af/canvas-agent/src/server/http.ts
[local-agent-bridge]: https://github.com/fujunchao/infinite-canvas/blob/86201d7cf073ac6beb3d83b76cce63108bf3e6af/web/src/pages/canvas/hooks/use-agent-bridge.ts
[local-agent-ops]: https://github.com/fujunchao/infinite-canvas/blob/86201d7cf073ac6beb3d83b76cce63108bf3e6af/web/src/lib/canvas/canvas-agent-ops.ts
[local-node-registry]: https://github.com/fujunchao/infinite-canvas/blob/86201d7cf073ac6beb3d83b76cce63108bf3e6af/web/src/lib/canvas/node-registry.ts
[local-plugin-loader]: https://github.com/fujunchao/infinite-canvas/blob/86201d7cf073ac6beb3d83b76cce63108bf3e6af/web/src/lib/canvas/plugin-loader.ts
[local-docker]: https://github.com/fujunchao/infinite-canvas/blob/86201d7cf073ac6beb3d83b76cce63108bf3e6af/Dockerfile
[local-docs-docker]: https://github.com/fujunchao/infinite-canvas/blob/86201d7cf073ac6beb3d83b76cce63108bf3e6af/docs/Dockerfile
[local-canvas-types]: https://github.com/fujunchao/infinite-canvas/blob/86201d7cf073ac6beb3d83b76cce63108bf3e6af/web/src/types/canvas.ts
[local-changelog]: https://github.com/fujunchao/infinite-canvas/blob/86201d7cf073ac6beb3d83b76cce63108bf3e6af/CHANGELOG.md
[local-image-source]: https://github.com/fujunchao/infinite-canvas/blob/86201d7cf073ac6beb3d83b76cce63108bf3e6af/web/src/lib/canvas/canvas-image-source.ts
[local-legacy-agent]: https://github.com/fujunchao/infinite-canvas/blob/86201d7cf073ac6beb3d83b76cce63108bf3e6af/web/src/services/legacy-agent-chat-storage.ts
[old-types]: https://github.com/fujunchao/infinite-canvas/blob/eb9e3a4b4fe1f80245b87276783787dd0078be9c/web/src/types/canvas.ts#L28-L86
[old-generation]: https://github.com/fujunchao/infinite-canvas/blob/eb9e3a4b4fe1f80245b87276783787dd0078be9c/web/src/pages/canvas/project.tsx#L2110-L2203
[old-generation-results]: https://github.com/fujunchao/infinite-canvas/blob/eb9e3a4b4fe1f80245b87276783787dd0078be9c/web/src/pages/canvas/project.tsx#L2205-L2255
[old-retry]: https://github.com/fujunchao/infinite-canvas/blob/eb9e3a4b4fe1f80245b87276783787dd0078be9c/web/src/pages/canvas/project.tsx#L2463-L2495
[old-selection]: https://github.com/fujunchao/infinite-canvas/blob/eb9e3a4b4fe1f80245b87276783787dd0078be9c/web/src/pages/canvas/project.tsx#L1064-L1159
[old-resize]: https://github.com/fujunchao/infinite-canvas/blob/eb9e3a4b4fe1f80245b87276783787dd0078be9c/web/src/components/canvas/canvas-node.tsx#L225-L290
[old-node-events]: https://github.com/fujunchao/infinite-canvas/blob/eb9e3a4b4fe1f80245b87276783787dd0078be9c/web/src/components/canvas/canvas-node.tsx#L359-L438
[old-primary]: https://github.com/fujunchao/infinite-canvas/blob/eb9e3a4b4fe1f80245b87276783787dd0078be9c/web/src/pages/canvas/project.tsx#L1496-L1547
[old-geometry]: https://github.com/fujunchao/infinite-canvas/blob/eb9e3a4b4fe1f80245b87276783787dd0078be9c/web/src/lib/canvas/canvas-node-geometry.ts
[old-image-content]: https://github.com/fujunchao/infinite-canvas/blob/eb9e3a4b4fe1f80245b87276783787dd0078be9c/web/src/components/canvas/canvas-node.tsx#L667-L734
[old-toolbar]: https://github.com/fujunchao/infinite-canvas/blob/eb9e3a4b4fe1f80245b87276783787dd0078be9c/web/src/components/canvas/canvas-node-hover-toolbar.tsx#L112-L157
[old-delete]: https://github.com/fujunchao/infinite-canvas/blob/eb9e3a4b4fe1f80245b87276783787dd0078be9c/web/src/pages/canvas/project.tsx#L721-L755
[old-copy]: https://github.com/fujunchao/infinite-canvas/blob/eb9e3a4b4fe1f80245b87276783787dd0078be9c/web/src/pages/canvas/project.tsx#L801-L898
[collapse-into-one]: https://github.com/basketikun/infinite-canvas/commit/de49430976f9bcd3bbc0371c8ff6d61616c3b4bf
[head-placement]: https://github.com/fujunchao/infinite-canvas/blob/86201d7cf073ac6beb3d83b76cce63108bf3e6af/web/src/pages/canvas/project.tsx#L1498-L1535
[wip-placement-model]: D:/augment-projects/infinite-canvas/web/src/lib/canvas/canvas-image-placements.ts
[wip-canvas-page]: D:/augment-projects/infinite-canvas/web/src/pages/canvas/project.tsx
[wip-node]: D:/augment-projects/infinite-canvas/web/src/components/canvas/canvas-node.tsx
[wip-types]: D:/augment-projects/infinite-canvas/web/src/types/canvas.ts
[wip-migration]: D:/augment-projects/infinite-canvas/web/src/lib/canvas/canvas-data-migration.ts
[wip-agent-ops]: D:/augment-projects/infinite-canvas/web/src/lib/canvas/canvas-agent-ops.ts
[wip-references]: D:/augment-projects/infinite-canvas/web/src/lib/canvas/canvas-resource-references.ts
[local-pending-tests]: D:/augment-projects/infinite-canvas/docs/content/docs/progress/pending-test.zh-CN.mdx

[release-log]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/CHANGELOG.md#L5-L85
[fork-old]: https://github.com/fujunchao/infinite-canvas/commit/eb9e3a4b4fe1f80245b87276783787dd0078be9c
[fork-head]: https://github.com/fujunchao/infinite-canvas/commit/86201d7cf073ac6beb3d83b76cce63108bf3e6af
[baseline-compare]: https://github.com/basketikun/infinite-canvas/compare/a2576d559ad765ba83e9563894adfbcd4e63405a...d213a74614e0e4bd8a26383d1e1e907249e9c61b
[nav-change]: https://github.com/basketikun/infinite-canvas/commit/693639838ca87b474f9b61d739c40c45e56cc1a9
[expand-change]: https://github.com/basketikun/infinite-canvas/commit/e44c0c4b3ee9b0682547334a3722763445b2c789
[preview-change]: https://github.com/basketikun/infinite-canvas/commit/fadba9f7a56983353bab29c2c4529e31b3048a42
[text-count-toolbar]: https://github.com/basketikun/infinite-canvas/commit/b8053ee9f8b6a81bb19dbd768a75c42cd7417706
[resize-change]: https://github.com/basketikun/infinite-canvas/commit/2c220f7435589d17647513c13ec87f693a557148
[prompt-source]: https://github.com/basketikun/infinite-canvas/commit/b66936d891b82c2b51c1ed05e1a6eae3e31d4ca3
[ark-removal]: https://github.com/basketikun/infinite-canvas/commit/0bdc820247a938c160366ea0ee8a6de59e5fe4dd
[network-change]: https://github.com/basketikun/infinite-canvas/commit/9414048f9d0a099386aa15d81bedb5376b79ee61
[network-message-change]: https://github.com/basketikun/infinite-canvas/commit/7329e700f53d54982b680824c745bb66c723af6b
[reference-change]: https://github.com/basketikun/infinite-canvas/commit/48ac1c7174b83be903976eec6c596ab037cbf81f
[group-input-change]: https://github.com/basketikun/infinite-canvas/commit/a188916586bac1cabf83d882e20e2c3868cbcc50
[group-tree-change]: https://github.com/basketikun/infinite-canvas/commit/63cfb4fcf5ee00cda48a318e49d267245b796e54
[video-frame-change]: https://github.com/basketikun/infinite-canvas/commit/b5a8cd71f248e1b153b63c5bfd8ff4a471203f30
[text-batch-change]: https://github.com/basketikun/infinite-canvas/commit/aa3208d545fae94592902ff556efb26732541455
[text-button-change]: https://github.com/basketikun/infinite-canvas/commit/86d0d4b7badd345de61bdc8daa5e9617038e6260
[transparent-change]: https://github.com/basketikun/infinite-canvas/commit/0b4c70e365bf349f6d1971ce4044d5c447fbe3fc
[gpt-response-fix]: https://github.com/basketikun/infinite-canvas/commit/6b30319aab691faaced25ab42fdf3acf8f28e6a2
[remote-image-fix]: https://github.com/basketikun/infinite-canvas/commit/d5366189f26360864cdbc15d41713d86f8d1316f
[image-persistence-refactor]: https://github.com/basketikun/infinite-canvas/commit/1172783e427ada5893a98887819e1b0dbe0bbc5b
[mask-change]: https://github.com/basketikun/infinite-canvas/commit/a2303590c92216fdcf6964015c44394ab98e5656
[agent-log-fix]: https://github.com/basketikun/infinite-canvas/commit/65b9cd5f3b359b2802124b3f9d36443b311f5ff5
[agent-permissions-fix]: https://github.com/basketikun/infinite-canvas/commit/a60636e718b11af31789f82ae8cd57ebd1f8911f
[agent-fragment-fix]: https://github.com/basketikun/infinite-canvas/commit/a4aaf248a9b98b78926ff25fdc79bf5cbd8fac54
[agent-reference-fix]: https://github.com/basketikun/infinite-canvas/commit/3ef8683a4ade98dfeae37d31071f7e00dc67cd70
[docs-navigation-change]: https://github.com/basketikun/infinite-canvas/commit/d72e092f7bae26115ddc2930d663430041cd3a46
[docs-routing-change]: https://github.com/basketikun/infinite-canvas/commit/3e72f33fb9e7341ac04f27e841a2a45e47d98ffa
[multipart-fix]: https://github.com/basketikun/infinite-canvas/commit/8aac603c0bec9d9c7a4764918999a0a20035f709
[text-label-fix]: https://github.com/basketikun/infinite-canvas/commit/611a1b470cdf4d8a85353c4eb026972e7e8660b5
[size-settings-change]: https://github.com/basketikun/infinite-canvas/commit/effd21508d47b46a8ee78e1ad4763e8fcdd1a67b
[video-mode-change]: https://github.com/basketikun/infinite-canvas/commit/1c269f5f9d8e9fce2cb43889a1f2647ff3d91de9
[video-resume-change]: https://github.com/basketikun/infinite-canvas/commit/6b9abfab986025ee86240dea7a3ae91d47f2c56e
[selection-group-change]: https://github.com/basketikun/infinite-canvas/commit/be0612bffe6de777a7fb931e445ef60769981c29
[proxy-change]: https://github.com/basketikun/infinite-canvas/commit/e0b644e2b6e1f4ca9a1325532a1f4c0a635704fe
[sync-change]: https://github.com/basketikun/infinite-canvas/commit/9698162dc9ae399f471cc62396db9c7c4a482c12
[asset-download-fix]: https://github.com/basketikun/infinite-canvas/commit/1246db7af31ad757c3b6f5af6f5464045b2ec9b4
[channel-import-fix]: https://github.com/basketikun/infinite-canvas/commit/fa523624340fbe05766a71fe4fe558cba5773cbc
[agent-latest-change]: https://github.com/basketikun/infinite-canvas/commit/7783de0f589637168ad1c22ff6e32159bc5a9dc2
[image-generation]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/web/src/pages/canvas/project.tsx#L2350-L2451
[image-cards]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/web/src/components/canvas/canvas-node.tsx#L729-L879
[node-selection]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/web/src/components/canvas/canvas-node.tsx#L299-L445
[duplicate-image]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/web/src/pages/canvas/project.tsx#L1709-L1742
[set-primary]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/web/src/pages/canvas/project.tsx#L1669-L1707
[canvas-state]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/web/src/pages/canvas/project.tsx#L220-L259
[canvas-navigation]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/web/src/components/canvas/infinite-canvas.tsx#L109-L145
[node-drag]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/web/src/pages/canvas/project.tsx#L1235-L1311
[image-tools]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/web/src/components/canvas/canvas-image-toolbar-tools.tsx#L34-L166
[node-toolbar]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/web/src/components/canvas/canvas-node-hover-toolbar.tsx#L112-L197
[toolbar-integration]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/web/src/pages/canvas/project.tsx#L3231-L3270
[text-cards]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/web/src/components/canvas/canvas-node.tsx#L536-L651
[text-generation]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/web/src/pages/canvas/project.tsx#L2567-L2679
[generation-inputs]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/web/src/components/canvas/canvas-node-generation.ts#L128-L200
[group-resources]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/web/src/lib/canvas/canvas-resource-references.ts#L51-L100
[reference-bar]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/web/src/components/canvas/canvas-node-reference-bar.tsx#L11-L52
[group-geometry]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/web/src/lib/canvas/canvas-node-geometry.ts#L48-L123
[selection-toolbar]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/web/src/components/canvas/canvas-selection-toolbar.tsx#L59-L85
[mask-source]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/web/src/components/canvas/canvas-node-mask-edit-dialog.tsx#L419-L438
[image-api]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/web/src/services/api/image.ts
[image-storage]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/web/src/services/image-storage.ts#L20-L129
[media-size]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/web/src/lib/media-size.ts#L1-L151
[video-settings]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/web/src/components/video-settings-panel.tsx
[video-api]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/web/src/services/api/video.ts#L21-L329
[video-resume-source]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/web/src/pages/canvas/project.tsx#L305-L381
[video-restore-effect]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/web/src/pages/canvas/project.tsx#L463-L470
[video-workbench]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/web/src/pages/video/index.tsx#L119-L188
[script-editor]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/web/src/components/layout/model-script-editor.tsx
[script-runtime]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/web/src/services/api/model-plugin.ts
[proxy-source]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/canvas-proxy/index.js
[proxy-helper]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/web/src/stores/use-config-store.ts#L476-L496
[sync-source]: https://github.com/basketikun/infinite-canvas/blob/d213a74614e0e4bd8a26383d1e1e907249e9c61b/web/src/services/app-sync.ts#L298-L322
