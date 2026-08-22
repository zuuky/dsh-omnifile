# DshOmniFile（dsh-omnifile）

> 文件适配插件：在 DSH 中 **拖拽 / 粘贴 / 点击多选 / @ 选择** 本地文件，用 anydoc 解析文档、多模态模型识别图片，把解析结果整合给主模型。
>
> **[English](README.en.md)** | 中文

## 功能

- **文件接入**：拖拽到窗口、输入框粘贴（图片/文件）、输入框左侧「上传」按钮多选；输入框内输入 `@` 弹出当前会话工作区的文件选择菜单（仅文件、自动跳过噪声目录、可键入过滤）。
- **文档解析**（@firecrawl/anydoc）：支持 `.doc/.docx/.docm .ppt/pptx/.pps/.pot/.pptm/.ppsx/.ppsm .xls/.xlsx/.xlsm/.xlsb .odt/.ods/.odp .rtf .epub .csv .pdf`；纯文本（`.json/.txt/.md/.html/.shtml`）直读（UTF-8 含 BOM 优先、UTF-16 LE/BE（含无 BOM）/UTF-32 LE/BE、GB18030/GBK 兜底，不把文本误判为二进制；JSON 美化、HTML 剥标签）；PDF 含图片时不中断，给出可读降级说明。
- **多模态识图**：图片 / 文档内嵌图片 / 纯扫描 PDF 交给配置的多模态模型转为文字描述；同一图片按「内容哈希 + 提示词 + 端点」缓存，避免重复调用。
- **发送给主模型**：文件一经选择立即后台解析（`/api/omnifile/process`），发送时若仍有文件未解析完会等待其完成后再发出、才开始回答；等待期间在对话区底部实时显示解析进度。
- **聊天内文件卡片**：每条用户消息上方显示一行文件卡片（图标 + 文件名），点击展开/收缩显示解析出的 `{源文件名}.md` 全文；右侧 📂 用本地默认程序打开源文件。
- **文本-only 主模型增强**：omnifile-* 变体提供商在发送时把图片块改写为文字描述，并把**用户当前问题**一并作为识图上下文（多模态主模型直接看图，无需此步）。
- **omnifile 工具**：主模型可随时自行解析本地文件。
- **会话内消息导航**：有用户消息即在聊天区右缘显示精简导航条，每个用户消息一个锚点圆点、点击即滚动定位（长 AI 回复中可快速回到各用户提问）；鼠标悬停圆点显示该条用户消息内容预览（超 100 字截断）；超过 10 条时窗口化，上下端出现「展开更多」（▲/▼）可定位到更早/更晚的消息；无用户消息不显示；低层级 + 事件默认穿透，不遮挡任何弹窗/页面（替代独立插件 `@vlln/dsh-navbar`）。

## 使用

1. 通过 **拖拽 / 粘贴 / 点击上传按钮 / `@` 选文件** 把文件加入输入框：输入框出现文件 chip，图片走 DSH 原生附件。
2. 文件加入后**立即开始后台解析**，解析进度实时显示在输入框上方 chip 上；解析完成后聊天内生成可展开的文件卡片。
3. 点击**发送**：若还有文件在解析会先等待（对话区底部显示“正在解析文件 x/y：…”，可随时移除单个文件、不影响本次发送），全部完成后消息发出、主模型开始回答。
4. 点击聊天卡片上的 📂 可本地打开**源文件**；点击卡片行可展开查看转换后的 md 全文。
5. 图片发给支持 image 的主模型时直接看原图；文本-only 主模型（走 omnifile-* 变体）会收到围绕你问题生成的多模态描述。

## 安装

用 DSH 的插件命令直接安装（会自动拉取 GitHub 仓库、安装并启用本插件的 bundle）：

```bash
dsh plugin --profile web add github:zuuky/dsh-omnifile
```

安装后：

1. 在 `$DSH_HOME/settings.yaml` 新增 `omnifile:` 小节（见「配置」）；如使用文本-only 主模型，
   再把 `agent-default-model.provider` 指到 `omnifile-*` 变体（多模态主模型可跳过）。
2. **重启 DSH Desktop**（或 dsh web），加载插件后即可使用。

## 配置（settings.yaml 示例）

```yaml
omnifile:
  providerRef: llm-pi-ai/vision/general-model   # 「设置-模型」中选择的多模态模型唯一引用
  reasoningEffort: medium     # 启用思考模式时发送的 reasoning_effort
  thinking: false             # 默认禁止思考模式
  enableVariants: true        # 为文本-only 主模型注册 omnifile-* 变体
  timeoutMs: 60000            # 单次多模态调用超时（毫秒）
  maxFileBytes: 52428800      # 单文件上限（50MB）
  maxDocImages: 8             # 每个文档最多识别的内嵌图片数
  docMaxChars: 120000         # 文档 Markdown 截断上限（字符）
  describeCacheMax: 300       # 识图结果缓存条数（LRU）
  listMaxFiles: 2000          # @ 文件选择器最多列出文件数
  listMaxDepth: 12            # @ 文件选择器递归深度
  maxNameChars: 120           # 文件名清洗后最大长度（字符）
  maxBatchImages: 20          # 一次粘贴/拖拽最多放入原生附件的图片数（客户端）
  progressPollMs: 400         # 解析进度轮询间隔（毫秒，客户端）
  concurrency: 1              # 多模态并发数
  temperature: 0.7            # 采样温度（0-2，默认 0.7）
  topP: 1                     # nucleus 采样 top_p（0-1，默认 1）
  maxTokens: 8192             # 单次输出最大 token 数
```

多模态模型**从「设置-模型」中选择**（唯一配置来源）：设置页「DshOmniFile」下拉会**全面列出当前 DSH 已注册的所有提供商/模型**（含 DSH 自带的官方 DeepSeek `deepseek-v4-*` 与你在「设置-模型」配置的 pi-ai 等自定义提供商），每项标注图片能力（🖼 支持图片输入 / 📝 纯文本）。保存一条 `providerRef` 引用，不在此保存多份模型配置；选择纯文本模型用于识图会失败，请优先选择 🖼 标注的模型。

## 注意事项

- **多模态模型需先在「设置-模型」配置**并支持 image 输入，否则图片/文档内嵌图片识别会报错（下拉里 🖼 标注的模型才有图片输入能力；DSH 内置 DeepSeek 为纯文本模型，选择其做识图会失败）。
- **思考模式**由插件显式下发：关闭时 `reasoning_effort: "none"` + `enable_thinking=false`；开启时用配置的 `reasoningEffort`。部分端点不支持未知字段时可自行在服务端兜底。
- 图片识别带**内容哈希缓存**，同一图片 + 同一提示词 + 同一端点只调一次多模态模型。
- 发送等待期间**重复点击会被忽略**（提示“请勿重复点击”，提交后自动清理）；**移除文件不影响本次发送**，被移除文件的标记自动丢弃。
- `read_image` 是 DSH 内置工具（要求模型支持 image）；本插件的识图是调外配多模态模型转文字，二者互补。
- 消息正文只放一行「解析后保存路径」可读引用（供模型 read 工具与客户端定位卡片），完整内容落盘为 `{源文件名}.md`，气泡内对用户视觉隐藏。
- 本插件不向第三方云端传任何内容，多模态调用指向你配置的本地/内网端点。


## 开发（TypeScript + Vite）

源码在 src/（TypeScript），按功能模块化组织，由 Vite 构建三个目标到 lib/（保持既有 main/exports/部署路径不变）：

```text
src/common/ → lib/common.js   （双端共用常量/标记/工具，ESM 零依赖；宿主 /api/omnifile/common.js 路由原样返回）
  constants.ts  markers.ts  util.ts  index.ts(barrel)
src/host/   → lib/index.js    （宿主端，Node ESM，所有外部依赖外部化，common 内联）
  index.ts(入口/apply)  config.ts(设置schema与限额)  extensions.ts(文件分类)
  logger.ts  paths.ts(路径/工作目录)  http.ts(请求/响应/凭据)  limiter.ts  progress.ts
  text.ts(编码/二进制检测/纯文本)  models.ts(模型枚举/解析)  describe.ts(多模态识图+缓存)
  anydoc.ts(文档解析+PDF兜底)  variants.ts(文本模型变体)  workspace.ts(@文件列表)
  routes.ts(全部 /api 路由)  tool.ts(dshomnifile 工具)
src/client/ → lib/client.js   （客户端，DSH ModuleLoader 单文件 bundle：react / dsh-client-runtime 外部化）
  index.ts(apply入口)  styles.ts(CSS)  constants.ts(文案/限额)  util.ts(通用工具)
  parse.ts(消息标记解析)  controller.ts(核心控制器)  components.ts(React 组件)
  chat.ts(聊天卡片定义)  dom.ts(拖拽/粘贴/marker隐藏)  source.ts(@文件源注册)
```

依赖 vite + typescript（devDependencies）。

```bash
pnpm install       # 安装依赖（含构建工具链）
pnpm build         # 构建全部三个目标 → lib/
pnpm build:watch   # 监视 src 增量重建（三个 vite 进程并行）
pnpm typecheck     # tsc --noEmit 类型检查
pnpm test          # 回归测试（node --test，读取 lib/ 构建产物）
```

- 客户端 bundle 由 scripts/build.mjs + vite.client.config.mts 产出，构建时通过自定义
  Vite 插件的 generateBundle hook 包进 DSH 的 window.__ModuleLoader__.load({ id, factory }) 格式；
- common 构建期内联进宿主/客户端 bundle（与两端同一份 TS 源码，单源）；/api/omnifile/common.js
  路由保留用于向后兼容旧客户端 bundle。
- 构建同时生成 lib/host/*.d.ts 与 lib/common/*.d.ts（tsconfig.build.json 声明输出，
  package.json types/exports 指向 lib/host/index.d.ts）。
- 回归测试覆盖：CSS 断言、lastUserQuestion、chips 渲染/发送流程、模型枚举，以及二进制检测
  （UTF-8/GBK/UTF-16（含无 BOM）/UTF-32 中文与英文文本不误判、真实二进制不放过）
  与文件 chip 置顶插入（无论输入框有无文字，chip 始终在正文之前）。

## 许可

MIT
