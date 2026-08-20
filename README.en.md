# DshOmniFile (dsh-omnifile)

> A file-adaptation plugin for DSH: drag & drop / paste / multi-select / `@`-pick local files, parse documents with anydoc, recognize images with a multimodal model, and feed the results to your main model.
>
> English | **[中文](README.md)**

## Features

- **File intake**: drag files onto the window, paste them into the composer (images/files), or use the **Upload** button; type `@` in the composer to open a file picker over the current session workspace (files only, noisy dirs skipped, type to filter).
- **Document parsing** (@firecrawl/anydoc): supports `.doc/.docx/.docm .ppt/pptx/.pps/.pot/.pptm/.ppsx/.ppsm .xls/.xlsx/.xlsm/.xlsb .odt/.ods/.odp .rtf .epub .csv .pdf`; plain text (`.json/.txt/.md/.html/.shtml`) is read directly (UTF-8 with BOM preferred, GB18030/GBK fallback; JSON prettified, HTML stripped); image-only PDFs degrade gracefully instead of failing.
- **Multimodal image recognition**: images, document-embedded images, and scanned PDFs are turned into text descriptions by your configured multimodal model; identical images are cached by (content hash + prompt + endpoint) to avoid repeated calls.
- **Send to model**: files start parsing in the background as soon as they are added (`/api/omnifile/process`); on send, the message waits for any still-parsing files and only then dispatches — with live parse progress shown at the bottom of the conversation.
- **Chat file card**: one row per file sits above each user message (icon + filename); click to expand/collapse the converted `{source-name}.md` content; the 📂 button opens the original file with your local default application.
- **Text-only model enhancement**: omnifile-* variant providers rewrite image blocks into text descriptions at send time, using **your current question** as recognition context (multimodal main models view the image directly and skip this).
- **omnifile tool**: the main model can parse local files on demand.

## Usage

1. Add files via **drag & drop / paste / upload button / `@` picker** — the composer shows a file chip; images use DSH native attachments.
2. Parsing starts **immediately** in the background; progress appears on the chip above the composer; a collapsible file card is generated in the chat once done.
3. Click **send**: if files are still parsing it waits first (progress line at the bottom of the conversation: "parsing file x/y: …"); you may remove any file freely without affecting the send. When all resolve, the message dispatches and the model answers.
4. Click 📂 on a chat card to open the **source file** locally; click the card row to expand the converted markdown.
5. Images go to image-capable main models directly; text-only main models (via omnifile-* variants) receive a multimodal description generated around your question.

## Installation

1. Put the `dsh-omnifile` plugin folder into the web profile's node_modules:
   `C:\Users\<you>\.dsh\profiles\web\node_modules\dsh-omnifile`
   (it contains `lib/`, `cordis.patch.yml`, `package.json`, etc.).
2. Add `"dsh-omnifile"` to `dsh.profile.bundles` in the web profile's `package.json`.
3. Add an `omnifile:` section to `$DSH_HOME/settings.yaml` (see "Configuration"); if you use a
   text-only main model, also point `agent-default-model.provider` at an `omnifile-*` variant.
4. **Restart DSH Desktop** (or dsh web) to load the new bundle.

## Configuration (settings.yaml example)

```yaml
omnifile:
  providerRef: llm-pi-ai/vision/general-model   # unique ref of the multimodal model picked in Settings → Models
  reasoningEffort: medium     # reasoning_effort sent when thinking is enabled
  thinking: false             # thinking disabled by default
  enableVariants: true        # register omnifile-* image variants for text-only main models
  timeoutMs: 60000            # per multimodal call timeout (ms)
  maxFileBytes: 52428800      # max single-file size (50MB)
  maxDocImages: 8             # max images per document sent to the multimodal model
  docMaxChars: 120000         # markdown char cap per document (truncated beyond)
  describeCacheMax: 300       # LRU cache size for recognition results
  listMaxFiles: 2000          # @ picker max files
  listMaxDepth: 12            # @ picker max recursion depth
  maxNameChars: 120           # max sanitized filename length (chars)
  maxBatchImages: 20          # max native-attachment images per paste/drop (client)
  progressPollMs: 400         # parse-progress polling interval, ms (client)
  concurrency: 1              # multimodal call concurrency
  temperature: 0.7            # sampling temperature (0-2, default 0.7)
  topP: 1                     # nucleus top_p (0-1, default 1)
  maxTokens: 8192             # max output tokens per call
```

The multimodal model is **picked only from Settings → Models** (single source of truth): choose an image-capable provider/model in the "DshOmniFile" settings panel; it stores a single `providerRef` reference, not multiple model configs.

## Notes

- You must first **configure an image-capable model in Settings → Models**; otherwise image / document-image recognition will error.
- **Thinking mode** is sent explicitly by the plugin: off → `reasoning_effort: "none"` + `enable_thinking=false`; on → the configured `reasoningEffort`. Some endpoints ignore unknown fields; fall back server-side if needed.
- Recognition is **content-hash cached**: same image + same prompt + same endpoint calls the multimodal model only once.
- While waiting to send, **repeated clicks are ignored** (notice "please don't click repeatedly", auto-cleared after submit); **removing a file does not affect the send** — its marker is dropped.
- `read_image` is a built-in DSH tool (requires an image-capable model); this plugin's recognition calls your external multimodal model instead — they complement each other.
- The message body carries only a one-line "parsed path" readable reference (for the model's read tool and client card lookup); the full content is saved to `{source-name}.md` and hidden from the bubble UI.
- Nothing is uploaded to third-party clouds; multimodal calls target your configured local/intranet endpoint.

## License

MIT
