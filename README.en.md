# DshOmniFile (dsh-omnifile)

> A file-adaptation plugin for DSH: drag & drop / paste / multi-select / `@`-pick local files, parse documents with anydoc, recognize images with a multimodal model, and feed the results to your main model.
>
> English | **[中文](README.md)**

## Features

- **File intake**: drag files onto the window, paste them into the composer (images/files), or use the **Upload** button; type `@` in the composer to open a file picker over the current session workspace (files only, noisy dirs skipped, type to filter).
- **Document parsing** (@firecrawl/anydoc): supports `.doc/.docx/.docm .ppt/pptx/.pps/.pot/.pptm/.ppsx/.ppsm .xls/.xlsx/.xlsm/.xlsb .odt/.ods/.odp .rtf .epub .csv .pdf`; plain text (`.json/.txt/.md/.html/.shtml`) is read directly (UTF-8 with BOM preferred, UTF-16 LE/BE (with or without BOM), UTF-32 LE/BE, and GB18030/GBK fallbacks — text is never misdetected as binary; JSON prettified, HTML stripped); image-only PDFs degrade gracefully instead of failing.
- **Multimodal image recognition**: images, document-embedded images, and scanned PDFs are turned into text descriptions by your configured multimodal model; identical images are cached by (content hash + prompt + endpoint) to avoid repeated calls.
- **Send to model**: files start parsing in the background as soon as they are added (`/api/omnifile/process`); on send, the message waits for any still-parsing files and only then dispatches — with live parse progress shown at the bottom of the conversation.
- **Chat file card**: one row per file sits above each user message (icon + filename); click to expand/collapse the converted `{source-name}.md` content; the 📂 button opens the original file with your local default application.
- **Text-only model enhancement**: omnifile-* variant providers rewrite image blocks into text descriptions at send time, using **your current question** as recognition context (multimodal main models view the image directly and skip this).
- **omnifile tool**: the main model can parse local files on demand.
- **In-conversation message navigation**: as soon as user messages exist, a slim nav strip appears at the right edge of the chat flow — one anchor dot per user message, click to scroll straight to it (easy to get back to each prompt inside a long AI reply); hovering a dot previews that user message's content (truncated to 100 chars); it caps the list to 10 dots at a time, with ▲/▼ "show more" buttons at either end to reach older/newer messages; hidden when there are no user messages; low z-index with pointer events that pass through by default, so it never covers modals or pages (replaces the standalone `@vlln/dsh-navbar` plugin).

## Usage

1. Add files via **drag & drop / paste / upload button / `@` picker** — the composer shows a file chip; images use DSH native attachments.
2. Parsing starts **immediately** in the background; progress appears on the chip above the composer; a collapsible file card is generated in the chat once done.
3. Click **send**: if files are still parsing it waits first (progress line at the bottom of the conversation: "parsing file x/y: …"); you may remove any file freely without affecting the send. When all resolve, the message dispatches and the model answers.
4. Click 📂 on a chat card to open the **source file** locally; click the card row to expand the converted markdown.
5. Images go to image-capable main models directly; text-only main models (via omnifile-* variants) receive a multimodal description generated around your question.

## Installation

Install with the DSH plugin command (it pulls the GitHub repo, installs it, and enables this plugin's bundle automatically):

```bash
dsh plugin --profile web add github:zuuky/dsh-omnifile
```

After installing:

1. Add an `omnifile:` section to `$DSH_HOME/settings.yaml` (see "Configuration"); if you use a
   text-only main model, also point `agent-default-model.provider` at an `omnifile-*` variant (skip for multimodal main models).
2. **Restart DSH Desktop** (or dsh web) to load the plugin.

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

The multimodal model is **picked from Settings → Models** (single source of truth): the "DshOmniFile" dropdown now **lists every provider/model currently registered in DSH** — including the built-in official DeepSeek `deepseek-v4-*` and your custom providers (e.g. pi-ai) — each annotated with image capability (🖼 image input / 📝 text-only). It stores a single `providerRef` reference, not multiple model configs; choosing a text-only model for recognition will fail, prefer 🖼-annotated models.

## Notes

- You must first **configure an image-capable model in Settings → Models** (🖼-annotated in the dropdown); otherwise image / document-image recognition will error (the built-in DSH DeepSeek is text-only).
- **Thinking mode** is sent explicitly by the plugin: off → `reasoning_effort: "none"` + `enable_thinking=false`; on → the configured `reasoningEffort`. Some endpoints ignore unknown fields; fall back server-side if needed.
- Recognition is **content-hash cached**: same image + same prompt + same endpoint calls the multimodal model only once.
- While waiting to send, **repeated clicks are ignored** (notice "please don't click repeatedly", auto-cleared after submit); **removing a file does not affect the send** — its marker is dropped.
- `read_image` is a built-in DSH tool (requires an image-capable model); this plugin's recognition calls your external multimodal model instead — they complement each other.
- The message body carries only a one-line "parsed path" readable reference (for the model's read tool and client card lookup); the full content is saved to `{source-name}.md` and hidden from the bubble UI.
- Nothing is uploaded to third-party clouds; multimodal calls target your configured local/intranet endpoint.

## Development (TypeScript + Vite)

Source lives in `src/` (TypeScript), organized **by feature** (no longer by runtime layer `client/common/host`). Vite builds three targets into `lib/` (existing `main`/`exports`/deploy paths unchanged):

```text
src/core/                           Project-wide shared layer (infrastructure with no feature owner)
  constants.ts  markers.ts  util.ts  dual-end constants / message markers / pure helpers (barrel → lib/common.js)
  host/                             host-side shared: config.ts (settings schema & limits), logger.ts,
                                    paths.ts (paths & parsed-md persistence), http.ts (request/response/credentials),
                                    progress.ts, limiter.ts, extensions.ts (file classification)
  client/                           client-side shared: styles.ts (style injector), util.ts (helpers)
src/host/                           Host composition root (apply entry wiring every feature's register fn)
  index.ts  serve-common.ts (/api/omnifile/common.js backward-compat route)
src/client/                         Client composition root (apply entry wiring every feature's install fn)
  index.ts
src/features/                       One folder per plugin feature
  file-intake/     file intake: drag & drop / paste / upload button / @ file picker
                   (host: /save /list routes; client: controller/dom/source/components)
  file-parsing/    file parsing: anydoc documents + plain-text decoding
                   (host: /process /status routes + anydoc/text)
  vision/          multimodal recognition: model enumeration / provider resolution / content-hash cache
                   (host: /models route + models/describe)
  variants/        text-only main-model enhancement: omnifile-* image variants adapter (host-only)
  omnifile-tool/   the dshomnifile tool (host-only)
  chat-card/       chat file cards: parse card / 📂 open source / marker hiding
                   (host: /parsed /open routes; client: chat/parse/components/dom)
  navigation/      in-conversation user-message quick navigation (client-only)
  settings/        settings panel (host: /config route; client: settings component)
```

Conventions (details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)):

- **One folder per feature** (`features/<name>/`); inside a feature, split into `host/` and `client/`
  subfolders by runtime (the Node host bundle and the browser bundle build separately and never import each other).
- Each feature exposes `register*(ctx, getConfig)` from `host/index.ts` and `install*(ctx, deps)` + `css`
  from `client/index.ts`; the composition roots (`src/host`/`src/client`/`index.ts`) are the single wiring
  point (dependency injection: create the controller, inject `getConfig`, call each feature's register/install).
- **Config applies live**: every route handler must call `getConfig()` per request — never snapshot at registration.
- Shared tools/constants/behaviors/conventions/config live under `src/core/` (dual-end elements are the single
  source of truth; host-only shared goes to `core/host/`, client-only to `core/client/`); cross-feature imports
  on the host side are allowed only in the documented capability direction:
  `vision → file-parsing → omnifile-tool / variants` — no reverse or cyclic dependencies.
- Client styles are co-located per feature (`client/styles.ts` exporting `css`), injected as a separate
  `<style>` tag via `installStyles` in `core/client/styles.ts`.

Build still produces three targets (artifact paths and `package.json` main/exports unchanged):

```text
src/core/index.ts      → lib/common.js   (dual-end elements; served at /api/omnifile/common.js for old client bundles)
src/host/index.ts      → lib/index.js    (host Node ESM, core inlined)
src/client/index.ts    → lib/client.js   (client ModuleLoader bundle, core inlined, react externalized)
```

Depends on vite + typescript (devDependencies).

```bash
pnpm install       # install dependencies (incl. build toolchain)
pnpm build         # build all three targets → lib/
pnpm build:watch   # watch src and rebuild incrementally (three vite processes in parallel)
pnpm typecheck     # tsc --noEmit type check
pnpm test          # regression tests (node --test against lib/ build output)
```

- The client bundle is produced by `scripts/build.mjs` + `vite.client.config.mts`; a custom Vite plugin's
  `generateBundle` hook wraps it into DSH's `window.__ModuleLoader__.load({ id, factory })` format.
- `core` is inlined into the host/client bundles at build time (single TS source shared by both ends); the
  `/api/omnifile/common.js` route is kept for backward compatibility with older client bundles.
- Declarations `lib/host/*.d.ts` and `lib/core/*.d.ts` are emitted by `tsconfig.build.json`
  (`package.json` `types`/`exports` point to `lib/host/index.d.ts`).
- Regression tests are organized per feature under `test/` (shared harness in `test/helpers.mjs`):

```text
core.test.mjs        shared: marker assembly/parsing, file-kind classification
file-intake.test.mjs intake: dock chip/sendwait rendering, send-wait/dup-guard/removal decoupling, chip pinning
file-parsing.test.mjs parsing: multi-encoding decode & binary detection (UTF-8/GBK/UTF-16 incl. no BOM/UTF-32)
vision.test.mjs      vision: model enumeration (image flag/variant skip/profile fallback), providerRef resolution
variants.test.mjs    variants: lastUserQuestion, describe-prompt composition
chat-card.test.mjs   chat card: CSS assertions, ParseBlock render/lazy expansion
navigation.test.mjs  navigation: show/position/windowing/hover preview/event pass-through
```

## License

MIT
