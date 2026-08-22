/**
 * 设置面板：DshOmniFile 多模态模型配置（从「设置-模型」全量枚举 + 参数调整）。
 */
import * as React from 'react'
import { useStore, setPath } from '../../../core/client/util.js'
function OmnifileSettings(props: any): any {
    const scope = props.scope
    if (scope === undefined) return React.createElement('div', { className: 'omnifile-hint' }, '设置服务不可用。可在 $DSH_HOME/settings.yaml 的 omnifile: 小节配置。')
    const snap = useStore(scope)
    const [draft, setDraft] = React.useState<any>(null)
    const [savedTick, setSavedTick] = React.useState(0)
    const [catalog, setCatalog] = React.useState<any>(null)
    const [catalogError, setCatalogError] = React.useState<string | null>(null)
    const [jumpHint, setJumpHint] = React.useState(false)
    const base = snap && snap.value ? snap.value : {}
    const value = draft || base

    const update = function (path: string[], val: any) {
        const nextDraft = JSON.parse(JSON.stringify(draft || base || {}))
        setPath(nextDraft, path, val)
        setDraft(nextDraft)
        setSavedTick(0)
    }

    /* 拉取「设置-模型」里已注册的全部提供商/模型（含 DSH 内置 DeepSeek），供下拉选择（唯一配置来源）。 */
    const loadCatalog = function () {
        setCatalogError(null)
        fetch('/api/omnifile/models')
            .then(function (res) {
                return res.json()
            })
            .catch(function () {
                return { ok: false }
            })
            .then(function (json: any) {
                if (json && json.ok === true && Array.isArray(json.providers)) {
                    setCatalog(json.providers.map(function (p: any) {
                        return {
                            ref: p.ref,
                            displayName: p.providerDisplay || p.displayName || p.provider || '',
                            modelId: p.modelId,
                            modelName: p.modelName || p.modelId,
                            baseURL: p.baseURL,
                            apiKeyEnv: p.apiKeyEnv || '',
                            image: p.image === true,
                            modalities: Array.isArray(p.modalities) ? p.modalities : [],
                            settingsNs: p.settingsNs || '',
                        }
                    }))
                } else {
                    setCatalog([])
                    setCatalogError((json && json.error) || '读取已配置模型失败')
                }
            })
    }
    React.useEffect(function () {
        loadCatalog()
    }, [])

    /* 选中已配置模型 → 只保存一条 providerRef 引用（不保存多份模型配置）。 */
    const pickCatalog = function (ref: string) {
        update(['providerRef'], ref)
    }

    /* 前往「设置-模型」：优先使用平台暴露的跳转能力（当前 DSH 无公共 API，给出提示降级）。 */
    const goToModels = function () {
        let jumped = false
        try {
            if (props.settings && typeof props.settings.openSection === 'function') {
                props.settings.openSection('models')
                jumped = true
            }
        } catch (e) { /* ignore */ }
        if (jumped) return
        setJumpHint(true)
    }

    /* 保存：写入的都是顶层标量（settingsScope.set 按单段路径写入），确保真正生效；
     * 顺带清理历史遗留的旧 provider 点分键 / _auto，保证“不保存多份模型配置”。 */
    const commit = function () {
        const target = draft || base
        const fields = ['providerRef', 'reasoningEffort', 'thinking', 'concurrency', 'temperature', 'topP', 'maxTokens',
            'describeCacheMax', 'listMaxFiles', 'listMaxDepth', 'maxNameChars', 'maxBatchImages', 'progressPollMs',
            'maxFileBytes', 'maxDocImages', 'docMaxChars', 'enableVariants', 'timeoutMs']
        const writes: Array<[string, any]> = fields
            .filter(function (key) {
                return target[key] !== undefined && target[key] !== null
            })
            .map(function (key) {
                return [key, target[key]] as [string, any]
            })
        writes.push(['providerRef', typeof target.providerRef === 'string' ? target.providerRef : ''])
        writes.reduce(function (chain, op) {
            return chain.then(function () {
                return scope.set(op[0], op[1])
            })
        }, Promise.resolve())
            .then(function () {
                return ['provider', 'provider.baseUrl', 'provider.model', 'provider.credential', '_auto']
                    .reduce(function (chain, key) {
                        return chain.then(function () {
                            return scope.unset(key)
                        }).catch(function () {
                            /* 旧键可能不存在，忽略 */
                        })
                    }, Promise.resolve())
            })
            .then(function () {
                setSavedTick(function (n) {
                    return n + 1
                })
                scope.load()
            })
    }

    const activeRef = (value && value.providerRef) || ''
    const activeItem = (catalog || []).find(function (item: any) {
        return item.ref === activeRef
    })

    const field = function (label: string, control: any, hint?: string) {
        const children = [React.createElement('span', { className: 'omnifile-cfg-label' }, label), control]
        if (hint) children.push(React.createElement('span', { className: 'omnifile-cfg-hint' }, hint))
        return React.createElement('div', { className: 'omnifile-cfg-group' }, children)
    }
    /* 通用数值输入：mb=true 以 MB 展示/落盘；integer=true 只保留正整数。 */
    const numberInput = function (key: string, fallback: number, opts: any) {
        const o = opts || {}
        const div = o.mb ? 1024 * 1024 : 1
        const current = value[key] === undefined || value[key] === null ? fallback : Number(value[key])
        return React.createElement('input', {
            className: 'omnifile-cfg-input',
            type: 'number',
            min: o.min,
            max: o.max,
            step: o.step,
            value: current / div,
            onChange: function (e: any) {
                const n = parseFloat(e.target.value)
                const raw = !Number.isFinite(n) ? fallback
                    : o.mb ? Math.round(n * div)
                        : o.integer ? (n >= 1 ? Math.floor(n) : fallback)
                            : n
                update([key], raw)
            },
        })
    }
    const numField = function (label: string, key: string, fallback: number, min: number, step: number, hint: string, mb?: boolean) {
        return field(label, numberInput(key, fallback, { min: min, step: step, mb: mb }),
            hint + (mb && (value[key] === undefined || value[key] === null) ? '（当前 ' + Math.round(fallback / (1024 * 1024)) + 'MB）' : ''))
    }

    return React.createElement('div', { className: 'omnifile-cfg' },
        /* 头部 */
        React.createElement('div', { className: 'omnifile-cfg-head' }, [
            React.createElement('h3', { className: 'omnifile-cfg-title' }, '多模态模型配置'),
            React.createElement('p', { className: 'omnifile-cfg-desc' }, '用于识别用户添加的图片、文档内嵌图片，并为文本-only 主模型生成图像描述。只从「设置-模型」中选择一个已配置的多模态模型，不在此保存多份模型配置。'),
        ]),
        /* 从「设置-模型」选择（唯一配置来源） */
        React.createElement('div', { className: 'omnifile-cfg-group' }, [
            React.createElement('span', { className: 'omnifile-cfg-label' }, '多模态模型（来自「设置-模型」）'),
            React.createElement('select', {
                className: 'omnifile-cfg-select',
                value: activeRef,
                disabled: catalog === null,
                onChange: function (e: any) {
                    pickCatalog(e.target.value)
                },
            }, [
                React.createElement('option', { key: '', value: '', disabled: true }, catalog === null ? '正在读取已配置模型...' : '—— 请选择多模态模型 ——'),
                (catalog || []).map(function (item: any) {
                    /* 标注图片能力：🖼 支持图片 / 📝 纯文本（不支持识图） */
                    const badge = item.image === true ? '🖼' : '📝'
                    return React.createElement('option', { key: item.ref, value: item.ref },
                        badge + ' ' + String(item.displayName || item.modelId) + ' · ' + item.modelName + ' (' + item.modelId + ')'
                        + (item.image === true ? '' : ' · 无图片输入'))
                }),
            ]),
            activeItem
                ? React.createElement('div', {
                    className: 'omnifile-cfg-tag',
                    'data-image': activeItem.image === true ? 'yes' : 'no',
                    title: (activeItem.modalities || []).join(', '),
                }, [
                    React.createElement('b', { key: 'b' }, (activeItem.image === true ? '🖼 ' : '📝 ') + (activeItem.displayName || activeItem.modelId)),
                    React.createElement('span', { key: 'c' }, activeItem.modelName + '（' + activeItem.modelId + '） · ' + (activeItem.baseURL || '默认端点')),
                ])
                : React.createElement('span', { className: 'omnifile-cfg-hint' }, '选择后将保存为该模型的唯一引用（providerRef），实际地址/密钥都来自「设置-模型」。'),
            activeItem && activeItem.image !== true
                ? React.createElement('div', { className: 'omnifile-cfg-hint' }, '⚠ 该模型不支持图片输入（仅文本）。若用作多模态识图，识图请求会失败；请优先选择带 🖼 标注的支持图片的模型。')
                : null,
            catalogError && React.createElement('div', { className: 'omnifile-cfg-error' }, '⚠ ' + catalogError),
            catalog !== null && catalog.length === 0 && !catalogError
                ? React.createElement('div', { className: 'omnifile-cfg-empty' }, [
                    React.createElement('p', { key: '1' }, '当前没有可用的模型列表。请先到「设置-模型」里配置至少一个提供商/模型（支持图片输入的模型会带 🖼 标注）。'),
                    React.createElement('div', { key: '2', className: 'omnifile-cfg-actions' },
                        React.createElement('button', { type: 'button', className: 'omnifile-cfg-btn', onClick: goToModels }, '前往「设置-模型」配置'),
                    ),
                ])
                : React.createElement('div', { className: 'omnifile-cfg-actions' }, [
                    React.createElement('button', { type: 'button', className: 'omnifile-cfg-btn omnifile-cfg-btn-ghost', onClick: loadCatalog }, '刷新列表'),
                    React.createElement('button', { type: 'button', className: 'omnifile-cfg-btn-link', onClick: goToModels }, '在「设置-模型」中管理模型 →'),
                ]),
            jumpHint && React.createElement('div', { className: 'omnifile-cfg-hint' }, '当前 DSH 版本未开放从插件小节直接跳转的接口；请点击设置面板左侧导航中的「模型」标签页。'),
        ]),
        React.createElement('hr', { className: 'omnifile-cfg-divider' }),
        /* 常规模型参数 */
        React.createElement('div', { className: 'omnifile-cfg-grid' }, [
            field('采样温度 temperature（0–2）', numberInput('temperature', 0.7, { min: 0, max: 2, step: 0.1 }), '数值越低越确定，默认 0.7'),
            field('top_p（0–1）', numberInput('topP', 1, { min: 0, max: 1, step: 0.05 }), 'nucleus 采样，默认 1'),
            field('最大输出 token', numberInput('maxTokens', 8192, { min: 1, step: 128, integer: true }), '默认 8192'),
            field('多模态并发数', numberInput('concurrency', 1, { min: 1, max: 16, step: 1, integer: true }), '同时识别多张图的任务数'),
        ]),
        React.createElement('hr', { className: 'omnifile-cfg-divider' }),
        /* 限制参数（可在设置界面配置） */
        React.createElement('div', { className: 'omnifile-cfg-group' }, [
            React.createElement('span', { className: 'omnifile-cfg-label' }, '上限与限制参数'),
            React.createElement('div', { className: 'omnifile-cfg-grid' }, [
                numField('单文件大小（MB）', 'maxFileBytes', 50 * 1024 * 1024, 1, 1, '单个上传文件大小上限', true),
                numField('单文档最多识别图片数', 'maxDocImages', 8, 1, 1, '文档内嵌图片/扫描页交给多模态识别的数量上限'),
                numField('文档字符保留上限', 'docMaxChars', 120000, 1000, 1000, '文档转 Markdown 后保留的最大字符数，超出截断'),
                numField('识图缓存条数', 'describeCacheMax', 300, 16, 1, '同一图片描述结果的 LRU 缓存条数'),
                numField('@ 文件选择器最大文件数', 'listMaxFiles', 2000, 1, 100, '递归列出工作区文件的上限'),
                numField('@ 文件选择器最大深度', 'listMaxDepth', 12, 1, 1, '递归遍历最大深度'),
                numField('文件名最大长度（字符）', 'maxNameChars', 120, 8, 1, '文件名清洗后的最大长度'),
                numField('单次图片批量上限', 'maxBatchImages', 20, 1, 1, '一次粘贴/拖拽最多放入原生附件的图片数'),
                numField('进度轮询间隔（毫秒）', 'progressPollMs', 400, 50, 50, '解析进度轮询间隔'),
            ]),
            React.createElement('span', { className: 'omnifile-cfg-hint' }, '修改后点击「保存配置」生效；宿主侧（文件大小/文档截断/@ 列表等）需重启后完全生效，客户端侧（图片批量/轮询间隔）由设置保存后即时生效。'),
        ]),
        React.createElement('div', { className: 'omnifile-cfg-group' }, [
            React.createElement('label', { className: 'omnifile-cfg-check' },
                React.createElement('input', {
                    type: 'checkbox',
                    checked: value.thinking === true,
                    onChange: function (e: any) {
                        update(['thinking'], e.target.checked)
                    },
                }),
                '启用思考模式（默认禁止；开启时发送 reasoning_effort）',
            ),
        ]),
        /* 底部操作 */
        React.createElement('div', { className: 'omnifile-cfg-actions' }, [
            React.createElement('button', { type: 'button', className: 'omnifile-cfg-btn', onClick: commit }, '保存配置'),
            savedTick > 0 && React.createElement('span', { key: 'saved', className: 'omnifile-cfg-saved' }, '✓ 已保存'),
        ]),
    )
}



export { OmnifileSettings }
