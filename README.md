# dsh-omnifile — 全文件适配插件

整合 **dsh-file-upload** / **dsh-plugin-anydoc** / **@anionex/dsh-vision-toolkit** 三个插件的能力为一个通用插件：
**全文件接入（拖拽 / 粘贴 / 点击多选）+ anydoc 文档解析 + 多模态模型识别 + 主模型通用**。

## 功能

1. **文件接入**
   - 拖拽文件到窗口、在输入框粘贴（支持剪贴板图片/文件）、点击输入框左侧 📎 按钮多选本地文件。
   - 图片文件走 DSH 原生附件流：输入框上方原生缩略图栏、聊天内图片、点击灯箱预览。
   - 非图片文件（文档/文本/音视频/其他）保存到会话工作区 uploads/，输入框内出现**可见的文件 chip**（文件名），
     输入框上方同时显示文件卡片（图标+文件名+大小+状态）。删除输入框中的 chip 即主动移除该附件。

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

3. **多模态模型配置（参考 vision-toolkit 精简版）**
   - 设置页「全文件（Omnifile）」或 settings.yaml 的 omnifile: 小节配置：
     API 地址、模型名、API Key（credential 引用）、是否启用思考模式（默认禁止）。
   - 默认值即当前环境的 http://10.218.230.4:8015/v1 + general-model + VISION_API_KEY。
   - 启用思考模式时请求体追加 reasoning_effort（默认 medium）。

4. **发送到主模型**
   - 非图片文件发送时，插件自动调用 /api/omnifile/process 解析，把 Markdown / 图片描述 /
     文件路径组合为文本发给主模型（文本-only / 多模态主模型都能识别）。
   - 图片文件：多模态模型直接看到原图；文本-only 主模型经 omnifile-* 变体提供商
     在线上把图片块改写为多模态模型生成的文字描述（保留图片绝对路径证据）。

5. **聊天内文件卡片**
   - 发送后聊天里显示文件卡片（图标 + 文件名），点击通过 DSH 的 host.openPath
     （回退到本插件 /api/omnifile/open）用本地默认程序打开预览。

6. **omnifile 工具**
   - 注册 omnifile 工具：主模型可随时自行解析本地文件（图片识别 / 文档转 Markdown+识图 / 文本直读 / 文件信息）。

## 安装

插件真实目录放在 web profile 的 node_modules（保证依赖可解析）；D:\deepseek\dsh-omnifile 是指向它的 junction。

1. 目录 C:\Users\<you>\.dsh\profiles\web\node_modules\dsh-omnifile 包含本插件全部文件
   （lib/index.js 宿主端、lib/client.js 浏览器端、cordis.patch.yml、package.json）。
2. web profile 的 package.json dsh.profile.bundles 列表末尾已加入 "dsh-omnifile"。
3. $DSH_HOME/settings.yaml：
   - agent-default-model.provider 改为 omnifile-vllm（替代 vision-toolkit-vllm）
   - 新增 omnifile: 小节（多模态模型配置）
4. 重启 DSH Desktop（或 dsh web）加载新 bundle。

插件的 cordis.patch.yml 会插入 omnifile 行，并停用被整合的三个旧插件行
（file-upload、anydoc、vision-toolkit），避免工具/路由/提供商冲突。

## 配置（settings.yaml 示例）

    omnifile:
      provider:
        baseUrl: http://10.218.230.4:8015/v1
        credential: VISION_API_KEY
        model: general-model
        reasoningEffort: medium   # 启用思考模式时发送的 reasoning_effort
      thinking: false             # 默认禁止思考模式
      enableVariants: true        # 为文本-only 主模型注册 omnifile-* 变体
      timeoutMs: 60000
      maxFileBytes: 31457280      # 单文件上限（30MB）
      maxDocImages: 8             # 每个文档最多识别的内嵌图片数
      docMaxChars: 120000         # 文档 Markdown 截断上限
      concurrency: 1              # 多模态并发（默认 1，可在设置页调整）

## Host 端路由

| 路由 | 说明 |
| --- | --- |
| POST /api/omnifile/save | 保存 base64 文件到会话 uploads/，返回绝对路径 |
| POST /api/omnifile/process | anydoc 解析 / 图片识别 / 组合结果 |
| POST /api/omnifile/describe | 单张图片多模态识别 |
| POST /api/omnifile/open | 用本地默认程序打开文件（预览） |
| GET  /api/omnifile/file | 会话内文件预览/缩略图（路径校验在会话工作区内） |

## 注意事项

- 启用后旧插件行被停用；如需恢复，删除 cordis.patch.yml 里对应的 disabled: true 行并把 bundles / settings 改回去。
- 思考模式由插件显式决定并在请求体中下发，不交给服务器默认：
   - 关闭时发送 `reasoning_effort: "none"` + `chat_template_kwargs.enable_thinking=false`
     （兼容 llama.cpp / vllm / sglang / OpenAI 兼容端点）；
   - 开启时发送配置的 reasoningEffort + `enable_thinking=true`。
   - 大多数 OpenAI 兼容端点会忽略未知字段；个别端点不支持时可自行在服务端兜底。
- PDF 无法用 anydoc 提取内嵌图片（toDocument 不支持 pdf），仅返回 Markdown 文本；
  纯扫描/图像型 PDF（需 OCR）会以 `unsupported` 被优雅降级，不会中断发送。
- .json/.txt/.md/.html/.shtml 为纯文本直读（不经 anydoc）；GBK/GB18030 编码的中文文本文件可正常读取。
- 该插件不传任何内容到第三方云端，多模态调用指向你配置的本地/内网端点。

## 许可

MIT
