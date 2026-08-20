# DshOmniFile（dsh-omnifile）— 文件适配插件

整合 **dsh-file-upload** / **dsh-plugin-anydoc** / **@anionex/dsh-vision-toolkit** 三个插件的能力为一个通用插件：
**文件接入（拖拽 / 粘贴 / 点击多选）+ anydoc 文档解析 + 多模态模型识别 + 主模型通用**。

## 功能

1. **文件接入**
   - 拖拽文件到窗口、在输入框粘贴（支持剪贴板图片/文件）、点击输入框左侧 上传 按钮多选本地文件。
   - **在输入框输入 `@` 可弹出当前会话工作目录的文件选择菜单**：递归列出工作区内的文件（仅文件，不含目录；
     自动跳过 node_modules/.git/dist/uploads 等噪声目录，最多 2000 个、深度 12），支持继续键入按文件名/相对
     路径过滤，↑↓ 选择、Enter 确认。选中后与粘贴/拖拽/点击上传完全一致：输入框出现可见的文件 chip，
     发送时自动解析，聊天内生成文件卡片。
   - 图片文件走 DSH 原生附件流：输入框上方原生缩略图栏、聊天内图片、点击灯箱预览。
   - 非图片文件（文档/文本/音视频/其他）保存到会话工作区 uploads/，输入框内出现**可见的文件 chip**（文件名），
     输入框上方同时显示文件卡片（图标+文件名+大小+状态）。删除输入框中的 chip 即主动移除该附件。
     （`@` 选中的文件就在工作区内，不重复拷贝，chip 直接引用其真实路径。）

2. **文档解析（@firecrawl/anydoc）**
   - 支持格式：Word（.doc/.docx/.docm）、PowerPoint（.ppt/.pps/.pot/.pptx/.pptm/.ppsx/.ppsm）、
     Excel（.xls/.xlsx/.xlsm/.xlsb）、OpenDocument（.odt/.ods/.odp）、RTF、EPUB、CSV、PDF。
   - 纯文本格式（JSON/TXT/MD/HTML/SHTML）不经 anydoc，直接解码为文字：UTF-8（含 BOM）优先，
     GB18030/GBK 兜底；JSON 自动美化，HTML 自动剥标签。
   - non-PDF 文档通过 `toDocument` 提取内嵌图片（document.assets）单独保存到 uploads/images/，
     交给配置的多模态模型识别，Markdown + 图片描述组合成最终文本。
   - **容错**：docx/pptx 等含图片的文档正常解析并提取图片；遇到 anydoc 无法转换的文档
     （如纯扫描图像型 PDF → `unsupported`）不再整体报错，而是给出可读的降级说明
     （已保存路径 + 失败原因 + 已提取图片的识别结果）。

3. **多模态模型配置**
   - 设置页「DshOmniFile」（设置左侧导航 → DshOmniFile）或 settings.yaml 的 omnifile: 小节配置。
   - **只从「设置-模型」选择多模态模型（唯一配置来源）**：设置页下拉列出「设置-模型」里所有支持 image 输入的
     提供商/模型，选中后保存**唯一引用 providerRef**（<命名空间>/<提供商>/<模型id>），不在此保存多份模型配置，
     也没有手动备用方案；实际 API 地址 / API Key / 模型信息全部以「设置-模型」为准。可「刷新列表」或前往
     「设置-模型」管理模型（当前 DSH 未开放插件小节直跳接口，按钮会给出导航提示）。
   - **常规模型参数**：采样温度 temperature（0-2，默认 0.7）、top_p（0-1，默认 1）、最大输出 token（默认 8192）、
     多模态并发数（默认 1）、是否启用思考模式（默认禁止；开启时发送 reasoning_effort，默认 medium）。
   - 设置面板已按 DSH theme 重排：明暗主题 / 主题色切换时自动适配（全部使用 --dsw-alias-* / --dsw-specific-* 令牌）。

4. **发送到主模型**
   - **选中即解析**：文件一经选定（拖拽 / 粘贴 / 点击上传 / `@` 选文件）立即后台调用
     `/api/omnifile/process` 解析，不必等发送按键才触发；解析进度实时显示在输入框上方的文件 chip 上。
   - **发送时等待解析完成**：点击发送时若还有文件未解析完，会等所有文件解析完成后再发出消息——
     因为解析早已在选中后开始，绝大多数情况下发送是秒开的，不会阻塞；等待期间在**对话区底部（AI 回答
     将出现的位置）实时显示解析进度**：“正在解析文件 x/y：识别内嵌图片 2/5（完成后自动发送）”，
     全部解析完成后该进度行消失、消息随即发出、主模型开始回答。
   - **防重复发送**：等待解析期间再点发送会被忽略（提示“请勿重复点击”），不会产生重复消息；
     该提示在发送提交后自动清理。
   - **移除与发送解耦**：等待期间可随时移除某个文件（每行右侧 × 始终可用）——移除不影响本次发送，
     被移除文件的标记自动丢弃，剩余文件/纯文本照常发送；全部移除则仅发文字（模型直接回答）。
   - 非图片文件发送时，把 一行可读引用（解析后保存路径）写进消息 content 发给主模型；
     完整 Markdown / 图片描述统一落盘为 {源文件名}.md，由大模型按路径触发 read 工具读取。
   - 图片文件：多模态模型直接看到原图（可与问题一起分析）；文本-only 主模型经 omnifile-* 变体提供商
     在发送/生成时把图片块改写为多模态模型生成的文字描述（保留图片绝对路径证据），并把**用户当前问题**
     一并作为识图上下文，让描述围绕问题生成、与问题匹配（多模态主模型无需此步，直接看图）。

5. **聊天内文件卡片**
   - 发送后聊天里在**用户消息上方**为每个文件显示**一行卡片**（图标 + 文件名 + 展开箭头），
     点击该行**展开/收缩解析结果**：懒加载显示 `{源文件名}.md` 的完整内容（文档 Markdown＋图片
     描述 / 文本原文 / 图片文字描述），超出自动滚动。
   - 行最右侧的 **📂 按钮**用本地默认程序打开**源文件**（转换前的原始文件，本地默认程序打开；
     标记尾部 `（源文件：<源路径>）` 用于精确回指）。无法按文本读取的格式（二进制/APK/ZIP 等）
     显示为可点击的文件行，点击即本地打开源文件。
   - 解析结果统一落盘为 **`{源文件名}.md`**（保持原名再追加 `.md`，如 `报告.docx` → `报告.docx.md`、
     `utils.js` → `utils.js.md`），保存到会话工作区 `uploads/`；消息 content 里的「解析后保存路径」
     就是该 md 的**绝对路径**，供大模型对路径触发内置 `read` 工具读取。
     **气泡内该段对用户视觉隐藏**，只显示用户的原始输入。

6. **omnifile 工具**
   - 注册 omnifile 工具：主模型可随时自行解析本地文件（图片识别 / 文档转 Markdown+识图 / 文本直读 / 文件信息）。

## 安装

插件真实目录放在 web profile 的 node_modules（保证依赖可解析）；D:\deepseek\dsh-omnifile 是指向它的 junction。

1. 目录 C:\Users\<you>\.dsh\profiles\web\node_modules\dsh-omnifile 包含本插件全部文件
   （lib/index.js 宿主端、lib/client.js 浏览器端、lib/common.js 双端共用、cordis.patch.yml、package.json）。
2. web profile 的 package.json dsh.profile.bundles 列表末尾已加入 "dsh-omnifile"。
   被整合的三个旧插件（file-upload / anydoc / vision-toolkit）已从 bundles 列表移除，
   由其承载的工具/路由/提供商能力统一由本插件接管（不再各自注册，避免冲突）。
3. $DSH_HOME/settings.yaml：
   - agent-default-model.provider 改为 omnifile-vllm（文本-only 主模型经 omnifile-* 变体
     提供商在线上把图片块改写为多模态描述；多模态主模型则保持原样）
   - 新增 omnifile: 小节（多模态模型配置）
4. 重启 DSH Desktop（或 dsh web）加载新 bundle。

插件的 cordis.patch.yml 仅在 web profile 的插件清单里插入 omnifile 行，不做其它修改。

## 配置（settings.yaml 示例）

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
      concurrency: 1              # 多模态并发（默认 1，可在设置页调整）
      temperature: 0.7            # 采样温度（0-2，默认 0.7）
      topP: 1                     # nucleus 采样 top_p（0-1，默认 1）
      maxTokens: 8192             # 单次输出最大 token 数（默认 8192）

## Host 端路由

| 路由 | 说明 |
| --- | --- |
| GET  /api/omnifile/common.js | 把 lib/common.js 原文按 ESM 返回给浏览器端 client.js（dynamic import 用；双端共用常量的唯一来源） |
| POST /api/omnifile/save | 保存 base64 文件到会话 uploads/，返回绝对路径 |
| POST /api/omnifile/process | 解析文件（anydoc 文档 / 纯文本直读 / 按文本读取可读的其他格式），组合结果（可选带 token 上报进度） |
| GET  /api/omnifile/status | 按 token 查询处理实时进度（阶段 / 选中图片序数 / 总数） |
| POST /api/omnifile/open | 用本地默认程序打开文件（预览） |
| GET  /api/omnifile/parsed | 按保存路径返回解析结果全文（`<uploads>/<源文件名>.md`；路径本身带 `.md` 时直接读，旧标记则按规则推导） |
| GET  /api/omnifile/models | 枚举「设置-模型」里已配置且支持 image 输入的提供商/模型（设置页下拉点选用） |
| GET  /api/omnifile/list   | 递归列出当前会话工作区内的文件（仅文件；跳过噪声目录，上限 2000 个 / 深度 12），供输入框 @ 文件选择器使用 |

## 注意事项

- 旧插件（file-upload / anydoc / vision-toolkit）不再出现在 web profile bundles 中；
  如需恢复旧插件，把 bundles / settings 改回去即可。
- 思考模式由插件显式决定并在请求体中下发，不交给服务器默认：
   - 关闭时发送 `reasoning_effort: "none"` + `chat_template_kwargs.enable_thinking=false`
     （兼容 llama.cpp / vllm / sglang / OpenAI 兼容端点）；
   - 开启时发送配置的 reasoningEffort + `enable_thinking=true`。
   - 大多数 OpenAI 兼容端点会忽略未知字段；个别端点不支持时可自行在服务端兜底。
- PDF 无法用 anydoc 提取内嵌图片（toDocument 不支持 pdf），仅返回 Markdown 文本；
  纯扫描/图像型 PDF（需 OCR）会以 `unsupported` 被优雅降级，不会中断发送。
- .json/.txt/.md/.html/.shtml 为纯文本直读（不经 anydoc）；GBK/GB18030 编码的中文文本文件可正常读取。
- **多模态识别带内容哈希缓存**：同一张图片（内容相同）+ 同一提示词 + 同一端点只调用一次多模态模型，
  之后的识别（对话历史里同一附件每轮重放、工具再次识别同一文件）直接复用结果，不再重复产生“Deep diving...”等待。
- **处理进度可见**：文件处理（尤其文档内嵌图片 / 扫描 PDF 逐页识别）期间，客户端轮询
  /api/omnifile/status 并把实时阶段显示在输入框上方的文件 chip 上（如“识别内嵌图片 2/5”），
  不再长时间只显示一句“解析中.../Deep diving...”。
- **host 端改动需重启生效**：client 端（lib/client.js）改动由 DSH 客户端 HMR 即时热替换、无需重启；
  host 端（lib/index.js）新增/修改的路由与逻辑需重启 DSH（或 dsh web）后注册。**本轮新增
  /api/omnifile/common.js 路由（lib/common.js 的唯一来源，浏览器端经它加载共用常量）——
  升级后请重启一次再使用**，否则客户端拿不到 common.js、卡片/气泡隐藏会退化。
- **与 read_image 的关系**：DSH 内置的 read_image 工具把图片以 image block 直接注入模型（要求当前模型支持
  image 输入）；本插件 omnifile 的图片模式则调用外配多模态模型转成文字。二者互补不冲突：
  当前模型支持 image 时优先用 read_image 看原图、无需再调 omnifile 识别图片；文本-only 模型
  （走 omnifile-* 变体）自动用 omnifile 的描述文本。
- **聊天卡片标记（无需 token）**：发送文档/文本后，消息正文仍保留**可读文本**标记
  （`解析后保存路径：<uploads>/<源文件名>.md（完整内容见上方文件卡片，可点击展开；源文件：<源绝对路径>）`），
  供大模型用 read 工具读取、客户端定位卡片；卡片显示在该条用户消息的**上方**，每文件**一行**，
  点击展开/收缩解析内容，📂 按钮按尾部 `（源文件：…）` 精确定位并打开源文件。
  不向消息里塞任何 `[[omnifile:...]]` 之类的无意义 token；**气泡内该段由客户端按 DOM 视觉隐藏**。
- **标记格式（marker/常量/组装函数）唯一来源 lib/common.js**：宿主 index.js 静态 import、
  浏览器 client.js 经 /api/omnifile/common.js 动态加载同一份导出；改动状态词/保存路径前缀/
  源文件标签/markerText 时只需改 common.js 一处，两端自动一致，不再“改不全导致卡片漏抽”。
- **消息只放引用、内容在卡片**：为保持对话栏整洁，发送时仅写入上述**一行可读引用**到消息 content
  （供模型 read 工具与客户端定位卡片），不把解析内容全文填充进对话栏；完整解析内容统一落盘为
  `{源文件名}.md`，需要精确原文时点击卡片行展开查看 / 📂 本地打开，模型则按保存路径 read 获取。
- 该插件不传任何内容到第三方云端，多模态调用指向你配置的本地/内网端点。

## 许可

MIT
