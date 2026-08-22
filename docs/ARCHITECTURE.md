# dsh-omnifile 架构说明

> 本文档描述 dsh-omnifile 的源码组织、分层规则、功能块契约与扩展指南。
> 面向「后续持续叠加新插件功能」的可维护性设计：**按功能块组织代码，共享要素下沉到全局层**。

## 1. 设计目标

- **功能即结构**：一个插件功能对应一个文件夹（`src/features/<name>/`），新增功能 = 新增一个文件夹，
  而不是分散到 client/common/host 三处。
- **单一职责 + 组合根**：功能块是自包含单元；`src/host/index.ts` 与 `src/client/index.ts` 是仅有的
  装配点（组合根），负责依赖注入与生命周期接线。
- **共享层唯一来源**：跨功能共用的工具/常量/行为/约定/配置全部收敛到 `src/core/`，避免重复实现与
  改一处漏一处。
- **常规设计模式**：组合根（Composition Root）+ 依赖注入、Facade（功能块 entry 导出）、
  Service Object（有状态能力，如控制器/缓存放服务对象）、模块化单体（Modular Monolith，功能块间
  单向能力依赖）。
- **可测试**：测试按功能块组织（`test/<feature>.test.mjs`），均有真实实现对应，无虚假覆盖。

## 2. 目录总览

```text
src/
  core/                 全项目共享层（无功能归属）
    index.ts            双端共用的 barrel（constants/markers/util）→ 构建为 lib/common.js
    constants.ts        唯一来源：NAMESPACE / SOURCE / KIND_* / MARKER_*
    markers.ts          消息标记组装与解析（markerText / sourcePathOf）
    util.ts             双端纯函数（messageOf）
    host/               宿主侧共享：config / extensions / http / limiter / logger / paths / progress
    client/             客户端侧共享：styles（样式注入器）/ util
  host/                 宿主组合根（DSH 插件 apply 入口）
    index.ts            apply：注册设置、common.js 路由、各功能块 host 注册
    serve-common.ts     /api/omnifile/common.js 向后兼容路由
  client/               客户端组合根（DSH 客户端 apply 入口）
    index.ts            apply：创建控制器、安装各功能块
  features/<name>/      功能块
    host/               该功能的宿主侧代码（Node ESM）
      index.ts          导出 register*(ctx, getConfig)
    client/             该功能的客户端侧代码（浏览器 bundle）
      index.ts          导出 install*(ctx, deps) + css
      styles.ts         本功能块样式
      constants.ts      本功能块私有常量（非跨功能共用）
```

## 3. 分层规则

| 层 | 谁可以导入 | 内容 |
| --- | --- | --- |
| `core/index.ts`（双端共用） | 宿主与客户端都行 | 常量、消息标记、纯函数（零依赖/仅 ESM） |
| `core/host/` | 仅宿主 | 配置 schema、路径、HTTP 辅助、并发限制器、日志、进度、文件分类 |
| `core/client/` | 仅客户端 | 样式注入器、客户端工具（React hooks 等） |
| `features/*/host/` | 仅宿主 + 能力层依赖 | 该功能的宿主逻辑与路由 |
| `features/*/client/` | 仅客户端 | 该功能的 UI/组件/DOM |

**绝对红线：**

- `core/index.ts` 不得导入任何 `core/host/*`、`core/client/*` 或功能块代码；
- 客户端代码不得导入 `core/host/*`（会拉进 Node 依赖）；宿主代码不得导入 `core/client/*`；
- 功能块之间只允许宿主侧按「能力层」单向依赖：
  `vision → file-parsing → omnifile-tool` 与 `vision → variants`，
  禁止反向依赖与循环依赖（构建期会内联为单一 bundle，循环会直接炸）。

## 4. 功能块契约

每个功能块必须提供：

### 宿主侧（`features/<name>/host/index.ts`）

```ts
export function register<Name>(ctx: any, getConfig: () => Record<string, any>): void
```

- `ctx`：DSH 插件上下文（`ctx.get('webServer')` / `ctx.effect(...)` 等）；
- `getConfig`：**实时**读取配置的函数（配置是 live 生效的，handler 内每次调用，禁止注册期快照）；
- 职责：注册本功能的 `/api` 路由、工具、adapter、事件监听等，全部通过 `ctx.effect` 注册以获得
  自动清理能力。若注册对象不存在（如无 webServer）则安全返回。
- 如需手动生命周期（如 variants 的 adapter 列表），返回一个 dispose 函数由组合根收集。

### 客户端侧（`features/<name>/client/index.ts`）

```ts
export const css: string                        // 本功能块样式（自行注入）
export function install<Name>(ctx: any, deps): void
```

- `deps`：组合根注入的依赖（如共享的 `controller`），由各功能块的槽位/组件消费；
- 样式通过 `core/client/styles.js` 的 `installStyles(css, '<feature>')` 注入独立 `<style>`；
- 职责：注册 DSH 客户端槽位（`ctx.slots.inject(...)`）、事件监听、DOM 集成。

### 组合根装配

`src/host/index.ts` 按顺序调用各功能块 `register*`；`src/client/index.ts` 创建控制器后调用各
功能块 `install*`。新增功能只需：在组合根 import + 调用一次。

## 5. 构建模型

三个独立的 Vite 目标（产物路径与 `package.json main/exports` 保持不变）：

| 目标 | 入口 | 产物 | 说明 |
| --- | --- | --- | --- |
| host | `src/host/index.ts` | `lib/index.js` | Node ESM；外部依赖外部化；core 与功能块内联 |
| common | `src/core/index.ts` | `lib/common.js` | 双端共用元素；`/api/omnifile/common.js` 供旧客户端 |
| client | `src/client/index.ts` | `lib/client.js` | CJS ModuleLoader bundle；react/dsh-client-runtime 外部化；core 与功能块内联 |

- `vite.*.config.mts` 与 `build/shared.mjs` 位于仓库根/`build/`；
- 类型声明由 `tsconfig.build.json` 输出（`lib/host/*.d.ts`、`lib/core/*.d.ts` 等）。

## 6. 测试组织

`test/` 按功能块组织，共享 harness 在 `test/helpers.mjs`：

- `helpers.mjs`：读取 `lib/client.js` / `lib/index.js`，提供 `extractFn`、`bootClient`、`bootNav`、
  `loadTextUtils` / `loadExtensionUtils` / `loadModelUtils`、`makeModelCtx` 等；
  markers 直接 `import { markerText, sourcePathOf } from '../lib/common.js'`（真实产物）。
- 每个功能测试只覆盖其功能块的行为（不经由读取源码，全部针对构建产物，保证「测试的就是
  发布的」）。

新增功能的原型：先建 `features/<name>/` 实现，再建 `test/<name>.test.mjs`，并在 README 的
「功能 / 测试覆盖」列表同步登记——三者（代码、文档、测试）始终一一对应。

## 7. 新增一个功能块的步骤

1. `src/features/<name>/host/index.ts`（+ 需要的服务文件）与/或
   `src/features/<name>/client/index.ts`（+ `styles.ts`/`components.ts`/`constants.ts`）；
2. 在上述 entry 实现 `register*` / `install*`，遵守「配置实时读取」「单向能力依赖」；
3. 在 `src/host/index.ts`（host 侧）或 `src/client/index.ts`（客户端侧）组合根导入并调用；
4. 若需要新路由，用 `core/host/http.js` 的 `writeJson`/`readJsonBody` + `ctx.effect(webServer.register...)`；
5. 若需要新配置项，在 `core/host/config.ts` 的 `Config` schema 增加字段（READ端口即生效）；
6. `pnpm typecheck && pnpm build && pnpm test`；
7. 新增 `test/<name>.test.mjs`（或扩展现有），更新 README（中/英）功能与覆盖列表。
