'use strict';

/**
 * 「面板 → AnimatedImage 格式」—— 勾选要保留的格式。
 *
 * 这个面板只做展示和转发：勾选存在 Editor.Profile 的工程配置里，文件搬运、生成文件重写、
 * trim.json 与 cc_plugin.json 的改写全部由主进程调 editor/trim.js 完成。
 *
 * 「当前状态」一行读的是磁盘真实情况（editor/trim.js 的 inspect()）而不是存下来的勾选，
 * 这样配置和磁盘不一致时（上次应用中途失败、有人手动动过文件）看得见而不是静默错着。
 *
 * module.exports 而不是 export default：面板加载器读的是 module.exports，
 * 写错的表现是面板一片空白且没有任何报错。ready() 不接收参数，可变状态在 ready() 里重置
 * —— methods 这个对象字面量在扩展整个生命周期里只有一份，面板关掉再打开残留还在。
 */

const PACKAGE = 'animated-image';

function formatBytes (bytes) {
    if (!bytes) return '—';
    return `${(bytes / 1024).toFixed(1)} KB`;
}

function escapeHtml (text) {
    return String(text).replace(/[&<>"]/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
    }[c]));
}

module.exports = Editor.Panel.define({
    template: `
<div class="wrap">
    <div class="intro">勾选要保留的格式。<b>未勾选的格式不会进入构建产物</b> —— 对应源码会被移到扩展的 <code>trimmed/</code> 目录，勾回来即恢复。</div>
    <div id="groups" class="groups"></div>
    <div id="status" class="status"></div>
    <div id="warnings" class="warnings"></div>
    <div class="footer">
        <ui-button id="apply" type="primary">应用</ui-button>
    </div>
</div>`,
    style: `
.wrap { display: flex; flex-direction: column; height: 100%; padding: 10px; box-sizing: border-box; }
.intro { color: var(--color-normal-fill-weakest); line-height: 1.6; margin-bottom: 10px; }
.groups { flex: 1; overflow-y: auto; }
.row { display: flex; align-items: center; padding: 5px 0; }
.row > ui-checkbox { flex: 1; }
.row .size { color: var(--color-normal-fill-weakest); white-space: nowrap; margin-left: 8px; }
.note { color: var(--color-normal-fill-weakest); margin: -2px 0 6px 20px; line-height: 1.5; }
.note.warn { color: var(--color-warn-fill); }
.status { margin: 8px 0 0; padding-top: 8px; border-top: 1px solid var(--color-normal-border); line-height: 1.6; }
.warnings { color: var(--color-warn-fill); line-height: 1.6; white-space: pre-wrap; }
.footer { margin-top: 10px; text-align: right; }
code { background: var(--color-normal-fill-emphasis); padding: 0 3px; border-radius: 2px; }`,
    $: {
        groups: '#groups',
        status: '#status',
        warnings: '#warnings',
        apply: '#apply',
    },
    methods: {
        /** Pull config + on-disk truth from the main process and rebuild the rows. */
        async refresh () {
            let info;
            try {
                info = await Editor.Message.request(PACKAGE, 'query-formats');
            } catch (e) {
                this.$.groups.innerHTML = '';
                this.$.status.innerHTML = `读取配置失败：${escapeHtml(e && e.message)}`;
                this.$.apply.setAttribute('disabled', '');
                return;
            }

            const rows = info.order.map((key) => {
                const group = info.groups[key];
                const checked = info.formats[key] ? ' checked=""' : '';
                const noteClass = key === 'demo' ? 'note warn' : 'note';
                const prefix = key === 'demo' ? '⚠ ' : '';
                const state = group.missing
                    ? ' <span class="size">（源码缺失）</span>'
                    : group.partial
                        ? ' <span class="size">（文件不完整）</span>'
                        : '';
                return `
<div class="row">
    <ui-checkbox data-key="${key}"${checked}>${escapeHtml(group.label)}</ui-checkbox>
    <span class="size">${formatBytes(group.bytes)}${key === 'webp' ? ' + wasm / 原生' : ''}</span>
</div>
<div class="${noteClass}">${prefix}${escapeHtml(group.note)}${state}</div>`;
            });
            this.$.groups.innerHTML = rows.join('');

            const trimmed = info.order.filter((key) => !info.groups[key].present);
            const labels = trimmed.map((key) => info.groups[key].label);
            this.$.status.innerHTML = `当前磁盘状态：已裁剪 <b>${labels.length ? escapeHtml(labels.join(' / ')) : '无'}</b>`;
            this.$.warnings.innerHTML = '';
            this.$.apply.removeAttribute('disabled');
        },

        /** Read the checkboxes, hand them to the main process, then re-read the disk. */
        async apply () {
            const formats = {};
            for (const box of this.$.groups.querySelectorAll('ui-checkbox')) {
                formats[box.getAttribute('data-key')] = !!box.value;
            }
            // Disabling before the await matters: the apply path moves files and
            // must not be re-entered by a second click.
            this.$.apply.setAttribute('disabled', '');
            this.$.status.innerHTML = '正在应用…';
            this.$.warnings.innerHTML = '';
            try {
                const report = await Editor.Message.request(PACKAGE, 'apply-formats', formats);
                await this.refresh();
                const notes = (report && report.warnings) || [];
                this.$.warnings.innerHTML = notes.length
                    ? notes.map(escapeHtml).join('\n')
                    : '已应用。若资源管理器或构建结果没有跟着更新，重启一次编辑器即可。';
            } catch (e) {
                this.$.apply.removeAttribute('disabled');
                this.$.status.innerHTML = '';
                this.$.warnings.innerHTML = `应用失败：${escapeHtml(e && e.message)}`;
            }
        },
    },
    ready () {
        this.$.apply.addEventListener('confirm', () => void this.apply());
        void this.refresh();
    },
});
