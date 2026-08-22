/**
 * 客户端样式注入器：每个功能块自带 CSS 常量（features 下各功能块的 client/styles.ts），
 * 由本模块注入独立的 <style> 标签（data-plugin-css 按功能块 id 去重）。
 */
function installStyles(css: string, id: string): () => void {
    if (typeof document === 'undefined') return function () {
    }
    const fullId = '@dsh-omnifile/styles/' + id
    if (document.querySelector('style[data-plugin-css="' + fullId + '"]') !== null) return function () {
    }
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-omnifile'
    tag.dataset.pluginCss = fullId
    tag.textContent = css
    document.head.appendChild(tag)
    return function () {
        tag.remove()
    }
}

export { installStyles }
