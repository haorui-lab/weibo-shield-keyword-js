// ==UserScript==
// @name         Weibo ShieldKeyword - 微博屏蔽词增强助手
// @name:zh-CN   Weibo ShieldKeyword - 微博屏蔽词增强助手
// @name:en      Weibo ShieldKeyword - Keyword Shield Manager
// @namespace    https://github.com/haorui-lab/weibo-shield-keyword-js
// @version      2.1.0
// @description  为微博屏蔽词提供一键式与全自动管理 ———— 自动后台续命、一键续期（续命）、一键导入、一键导出、一键清空。注意：受限于微博功能限制，非会员无法使用屏蔽词功能。
// @description:en One-click and automatic management for Weibo shield keywords — auto renew, batch renew, import, export, and clear.
// @author       haorui
// @license      MIT
// @homepageURL  https://github.com/haorui-lab/weibo-shield-keyword-js
// @supportURL   https://github.com/haorui-lab/weibo-shield-keyword-js/issues
// @downloadURL  https://raw.githubusercontent.com/haorui-lab/weibo-shield-keyword-js/main/weibo-shield-keyword.user.js
// @updateURL    https://raw.githubusercontent.com/haorui-lab/weibo-shield-keyword-js/main/weibo-shield-keyword.user.js
// @match        https://weibo.com/*
// @match        https://www.weibo.com/*
// @icon         https://weibo.com/favicon.ico
// @run-at       document-idle
// @grant        GM_setClipboard
// @grant        unsafeWindow
// ==/UserScript==

(function () {
    'use strict';

    // ==========================================
    // Configuration
    // ==========================================
    const CONFIG = {
        requestDelayMs: 500,            // 批量请求间隔（毫秒），防止触发微博频控
        autoRenewDelayMs: 5000,         // 页面打开后触发后台自动续命巡检的延迟（毫秒），避开首屏加载高峰
        autoRenewMinIntervalDays: 15,   // 自动续命最小冷却周期（天）：每 15 天最多自动执行 1 次
        autoRenewTriggerDays: 20,       // 自动续命触发阈值（天）：距离上次续命超过 20 天自动跑一轮
        autoRenewLockTtlMs: 10 * 60 * 1000, // 跨标签页并发锁超时时间（10 分钟）
        scanDebounceMs: 100,            // SPA DOM 变更防抖扫描间隔（毫秒）
        toastSuccessDurationMs: 2600,
        toastErrorDurationMs: 4200
    };

    const DAY_MS = 24 * 60 * 60 * 1000;
    const CONTAINER_ID = 'weibo-shield-keyword-helper';
    const MODAL_ID = 'weibo-shield-keyword-modal';
    const STYLE_ID = 'weibo-shield-keyword-styles';
    const TARGET_SELECTOR = '.wbpro-setup__line2';
    const RENEW_FLAG_KEY = 'weiboRenewComplete';
    const STORAGE_KEYS = {
        autoRenewEnabled: 'weiboShieldAutoRenewEnabled',
        lastRenewAt: 'weiboShieldLastRenewAt',
        lastAutoRenewAt: 'weiboShieldLastAutoRenewAt',
        autoRenewLock: 'weiboShieldAutoRenewLock'
    };

    let isBatchOperating = false;
    let activeToast = null;
    let activeToastTimer = null;
    let statusStripUpdater = null;

    // ==========================================
    // 1. Pure Utility Functions
    // ==========================================

    /**
     * 检查当前 URL 是否在「屏蔽设置 -> 关键词」标签页
     * @param {string} urlString
     * @returns {boolean}
     */
    function isKeywordShieldPage(urlString) {
        const href = urlString || (typeof window !== 'undefined' ? window.location.href : '');
        if (!href) return false;
        try {
            const url = new URL(href, 'https://weibo.com');
            if (!url.pathname.startsWith('/set/shield')) {
                return false;
            }
            const type = url.searchParams.get('type');
            return !type || type === 'keyword';
        } catch (e) {
            return href.includes('/set/shield') && (!href.includes('type=') || href.includes('type=keyword'));
        }
    }

    /**
     * 从 Cookie 字符串中安全提取 XSRF-TOKEN
     * @param {string} cookieStr
     * @returns {string|null}
     */
    function getXsrfToken(cookieStr) {
        const raw = cookieStr !== undefined ? cookieStr : (typeof document !== 'undefined' ? document.cookie : '');
        if (!raw) return null;
        const match = raw.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/);
        return match && match[1] ? decodeURIComponent(match[1]) : null;
    }

    /**
     * 解析并去重用户输入的关键词文本（支持 \n 与 \r\n）
     * @param {string} rawText
     * @returns {string[]}
     */
    function parseImportKeywords(rawText) {
        if (!rawText || typeof rawText !== 'string') return [];
        const seen = new Set();
        const result = [];
        const lines = rawText.split(/\r?\n/);
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length > 0 && !seen.has(trimmed)) {
                seen.add(trimmed);
                result.push(trimmed);
            }
        }
        return result;
    }

    /**
     * 从微博 getFilteredWords 接口返回的 card_group 中提取有效关键词数组
     * @param {Array} cardGroup
     * @returns {string[]}
     */
    function extractKeywordsFromCards(cardGroup) {
        if (!Array.isArray(cardGroup)) return [];
        const result = [];
        for (const item of cardGroup) {
            if (item && typeof item.title_sub === 'string') {
                const kw = item.title_sub.trim();
                if (kw.length > 0) {
                    result.push(kw);
                }
            }
        }
        return result;
    }

    /**
     * 从脚本标签文本中解析微博 $CONFIG 对象
     * @param {string} scriptContent
     * @returns {object|null}
     */
    function parseConfigFromScriptText(scriptContent) {
        if (!scriptContent || !scriptContent.includes('$CONFIG')) return null;
        const configMatch = scriptContent.match(/\$CONFIG\s*=\s*({[\s\S]*?});/);
        if (configMatch && configMatch[1]) {
            try {
                return JSON.parse(configMatch[1]);
            } catch (e) {
                return null;
            }
        }
        return null;
    }

    /**
     * 根据微博 user 对象判断是否为有效 VIP 会员
     * @param {object} userInfo
     * @returns {boolean}
     */
    function checkUserVipStatus(userInfo) {
        if (!userInfo || typeof userInfo !== 'object') return false;
        // mbrank: 0-非会员, 1~9-不同等级微博会员; vipUser: 1-会员标识; svip: 超级会员
        return Number(userInfo.mbrank) > 0 || Number(userInfo.vipUser) === 1 || Number(userInfo.svip) > 0;
    }

    /**
     * 构建微博接口请求头（兼容无 navigator.userAgentData 的 Firefox / Safari）
     * @param {string} xsrfToken
     * @returns {Record<string, string>}
     */
    function buildRequestHeaders(xsrfToken) {
        const headers = {
            'Content-Type': 'application/json',
            'accept': 'application/json, text/plain, */*',
            'x-xsrf-token': xsrfToken,
            'x-requested-with': 'XMLHttpRequest'
        };

        if (typeof navigator !== 'undefined' && navigator.userAgentData) {
            try {
                if (Array.isArray(navigator.userAgentData.brands)) {
                    headers['sec-ch-ua'] = navigator.userAgentData.brands
                        .map(b => `"${b.brand}";v="${b.version}"`)
                        .join(', ');
                }
                headers['sec-ch-ua-mobile'] = navigator.userAgentData.mobile ? '?1' : '?0';
                if (navigator.userAgentData.platform) {
                    headers['sec-ch-ua-platform'] = `"${navigator.userAgentData.platform}"`;
                }
            } catch (e) {
                // 忽略部分浏览器对 userAgentData 的安全限制
            }
        }

        return headers;
    }

    /**
     * 判定当前是否满足「自动续命」触发条件（纯函数）
     * 规则：
     * 1. autoRenewEnabled 默认开启（未禁用时为 true）
     * 2. 每 15 天最多自动执行 1 次（距 lastAutoRenewAt 不足 15 天绝不触发）
     * 3. 距离上次续命（含手动/自动）超过 20 天，或从未记录过续命时间，自动跑一轮
     *
     * @param {object} state
     * @param {boolean} [state.enabled=true]
     * @param {number} [state.lastRenewAt=0]
     * @param {number} [state.lastAutoRenewAt=0]
     * @param {number} [state.now=Date.now()]
     * @param {number} [state.minIntervalDays=CONFIG.autoRenewMinIntervalDays]
     * @param {number} [state.triggerDays=CONFIG.autoRenewTriggerDays]
     * @returns {{ shouldRun: boolean, reason: string, daysSinceLastRenew: number|null, daysSinceLastAuto: number|null }}
     */
    function evaluateAutoRenewDecision(state = {}) {
        const {
            enabled = true,
            lastRenewAt = 0,
            lastAutoRenewAt = 0,
            now = Date.now(),
            minIntervalDays = CONFIG.autoRenewMinIntervalDays,
            triggerDays = CONFIG.autoRenewTriggerDays
        } = state;

        const validLastAuto = Number(lastAutoRenewAt) > 0 ? Number(lastAutoRenewAt) : 0;
        const validLastRenew = Math.max(
            Number(lastRenewAt) > 0 ? Number(lastRenewAt) : 0,
            validLastAuto
        );

        const daysSinceLastAuto = validLastAuto > 0 ? (now - validLastAuto) / DAY_MS : null;
        const daysSinceLastRenew = validLastRenew > 0 ? (now - validLastRenew) / DAY_MS : null;

        if (!enabled) {
            return {
                shouldRun: false,
                reason: 'disabled',
                daysSinceLastRenew,
                daysSinceLastAuto
            };
        }

        // 硬性上限：每 15 天最多自动执行 1 次
        if (daysSinceLastAuto !== null && daysSinceLastAuto < minIntervalDays) {
            return {
                shouldRun: false,
                reason: 'cooldown_15d',
                daysSinceLastRenew,
                daysSinceLastAuto
            };
        }

        // 从未执行过续命：首次自动巡检直接执行一轮并建立基准时间戳
        if (daysSinceLastRenew === null) {
            return {
                shouldRun: true,
                reason: 'first_run',
                daysSinceLastRenew: null,
                daysSinceLastAuto
            };
        }

        // 距离上次续命超过 20 天：自动跑一轮
        if (daysSinceLastRenew >= triggerDays) {
            return {
                shouldRun: true,
                reason: 'overdue_20d',
                daysSinceLastRenew,
                daysSinceLastAuto
            };
        }

        return {
            shouldRun: false,
            reason: 'within_20d',
            daysSinceLastRenew,
            daysSinceLastAuto
        };
    }

    /**
     * 格式化上次续命状态文案（供设置面板显示）
     * @param {number} lastRenewAt
     * @param {number} [now=Date.now()]
     * @returns {string}
     */
    function formatAutoRenewStatus(lastRenewAt, now = Date.now()) {
        const ts = Number(lastRenewAt);
        if (!ts || ts <= 0 || Number.isNaN(ts)) {
            return '尚未记录续命时间（将在后台自动巡检）';
        }
        const diffMs = Math.max(0, now - ts);
        const diffDays = Math.floor(diffMs / DAY_MS);
        const date = new Date(ts);
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        const dateStr = `${yyyy}-${mm}-${dd}`;

        if (diffDays === 0) {
            return `上次续命：今天 (${dateStr})`;
        }
        return `上次续命：${diffDays} 天前 (${dateStr})`;
    }

    // ==========================================
    // 2. Environment, Storage & Clipboard Helpers
    // ==========================================

    function isAutoRenewEnabled() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.autoRenewEnabled);
            // 默认开启：仅当显式存为 'false' 时才关闭
            return raw !== 'false';
        } catch (e) {
            return true;
        }
    }

    function setAutoRenewEnabled(enabled) {
        try {
            localStorage.setItem(STORAGE_KEYS.autoRenewEnabled, enabled ? 'true' : 'false');
        } catch (e) {}
    }

    function getLastRenewTimestamp() {
        try {
            const lastRenew = Number(localStorage.getItem(STORAGE_KEYS.lastRenewAt) || 0);
            const lastAuto = Number(localStorage.getItem(STORAGE_KEYS.lastAutoRenewAt) || 0);
            return Math.max(lastRenew || 0, lastAuto || 0);
        } catch (e) {
            return 0;
        }
    }

    function getLastAutoRenewTimestamp() {
        try {
            return Number(localStorage.getItem(STORAGE_KEYS.lastAutoRenewAt) || 0) || 0;
        } catch (e) {
            return 0;
        }
    }

    function recordRenewTimestamp(isAuto = false, timestamp = Date.now()) {
        try {
            const tsStr = String(timestamp);
            localStorage.setItem(STORAGE_KEYS.lastRenewAt, tsStr);
            if (isAuto) {
                localStorage.setItem(STORAGE_KEYS.lastAutoRenewAt, tsStr);
            }
        } catch (e) {}
        if (typeof statusStripUpdater === 'function') {
            statusStripUpdater();
        }
    }

    function acquireAutoRenewLock(now = Date.now()) {
        try {
            const existingLock = Number(localStorage.getItem(STORAGE_KEYS.autoRenewLock) || 0);
            if (existingLock > 0 && (now - existingLock) < CONFIG.autoRenewLockTtlMs) {
                return false;
            }
            localStorage.setItem(STORAGE_KEYS.autoRenewLock, String(now));
            return true;
        } catch (e) {
            return true;
        }
    }

    function releaseAutoRenewLock() {
        try {
            localStorage.removeItem(STORAGE_KEYS.autoRenewLock);
        } catch (e) {}
    }

    /**
     * 获取当前微博页面的全局 window 对象（兼容 Tampermonkey 沙箱）
     */
    function getPageWindow() {
        try {
            if (typeof unsafeWindow !== 'undefined' && unsafeWindow) {
                return unsafeWindow;
            }
        } catch (e) {}
        return typeof window !== 'undefined' ? window : null;
    }

    /**
     * 检查当前登录用户是否为微博会员
     * @returns {boolean}
     */
    function isVipUser() {
        try {
            let userInfo = null;
            const pageWin = getPageWindow();

            // 1. 优先从页面全局 window.$CONFIG 读取
            if (pageWin && pageWin.$CONFIG && pageWin.$CONFIG.user) {
                userInfo = pageWin.$CONFIG.user;
            }

            // 2. 尝试从 Vue 3 根实例中探查用户信息
            if (!userInfo && typeof document !== 'undefined') {
                const appEl = document.querySelector('#app');
                const vueGlobal = appEl && appEl.__vue_app__ && appEl.__vue_app__.config && appEl.__vue_app__.config.globalProperties;
                if (vueGlobal && vueGlobal.$CONFIG && vueGlobal.$CONFIG.user) {
                    userInfo = vueGlobal.$CONFIG.user;
                }
            }

            // 3. 遍历 script 标签查找内联 $CONFIG
            if (!userInfo && typeof document !== 'undefined') {
                const scripts = document.querySelectorAll('script');
                for (const script of scripts) {
                    const config = parseConfigFromScriptText(script.textContent || '');
                    if (config && config.user) {
                        userInfo = config.user;
                        break;
                    }
                }
            }

            // 4. 若成功拿到 userInfo，按会员等级字段判定
            if (userInfo) {
                return checkUserVipStatus(userInfo);
            }

            // 5. 若页面结构更新导致未能提取到 userInfo，默认放行交由后端 API 鉴权，避免误伤正常会员
            return true;
        } catch (error) {
            console.warn('[Weibo-ShieldKeyword] 检查会员状态异常，默认放行:', error);
            return true;
        }
    }

    /**
     * 复制文本到剪贴板（三级回退：GM_setClipboard -> navigator.clipboard -> execCommand）
     * @param {string} text
     */
    async function copyToClipboard(text) {
        if (typeof GM_setClipboard === 'function') {
            try {
                GM_setClipboard(text, 'text');
                return;
            } catch (e) {
                // 继续回退
            }
        }

        if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            try {
                await navigator.clipboard.writeText(text);
                return;
            } catch (e) {
                // 继续回退
            }
        }

        const fallbackTextarea = document.createElement('textarea');
        fallbackTextarea.value = text;
        fallbackTextarea.style.position = 'fixed';
        fallbackTextarea.style.left = '-9999px';
        fallbackTextarea.style.top = '0';
        document.body.appendChild(fallbackTextarea);
        fallbackTextarea.focus();
        fallbackTextarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(fallbackTextarea);
        if (!ok) {
            throw new Error('无法写入剪贴板，请检查浏览器权限');
        }
    }

    // ==========================================
    // 3. Weibo Shield API Client
    // ==========================================

    /**
     * 获取当前全部已屏蔽关键词卡片列表
     * @returns {Promise<Array>}
     */
    async function fetchFilteredWords() {
        const response = await fetch('https://weibo.com/ajax/setting/getFilteredWords', {
            method: 'GET',
            credentials: 'same-origin'
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        if (!data || !Array.isArray(data.card_group)) {
            throw new Error('未找到关键词数据');
        }
        return data.card_group;
    }

    /**
     * 更新或新增单个屏蔽词（带延迟防频控）
     * @param {string} keyword
     * @param {number} currentIndex
     * @param {number} totalKeywords
     * @param {HTMLElement|null} progressText
     * @param {object} [options]
     * @param {boolean} [options.silent=false] 静默模式下不弹出错误 Toast
     */
    function updateBlockWord(keyword, currentIndex, totalKeywords, progressText, options = {}) {
        const { silent = false } = options;
        return new Promise((resolve, reject) => {
            setTimeout(async () => {
                try {
                    const xsrfToken = getXsrfToken();
                    if (!xsrfToken) {
                        throw new Error('无法获取 XSRF-TOKEN，请确认已登录微博');
                    }

                    const response = await fetch('https://weibo.com/ajax/setting/updateBlockWords', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: buildRequestHeaders(xsrfToken),
                        body: JSON.stringify({
                            value: keyword,
                            status: 1,
                            comment: 0
                        })
                    });

                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    const result = await response.json();
                    if (result.ok !== 1) {
                        throw new Error(result.msg || '接口返回失败');
                    }
                    if (progressText) {
                        progressText.innerText = `正在处理：${currentIndex}/${totalKeywords}（${keyword}）`;
                    }
                    resolve(result);
                } catch (error) {
                    console.error(`[Weibo-ShieldKeyword] 更新屏蔽词失败: ${keyword}`, error);
                    if (progressText) {
                        progressText.innerText = `更新失败: ${keyword}（${error.message}）`;
                    }
                    if (!silent) {
                        showErrorMessage(`更新 "${keyword}" 失败: ${error.message}`);
                    }
                    reject(error);
                }
            }, CONFIG.requestDelayMs);
        });
    }

    /**
     * 删除单个屏蔽词（带延迟防频控）
     */
    function deleteBlockWord(keyword, currentIndex, totalKeywords, progressText) {
        return new Promise((resolve, reject) => {
            setTimeout(async () => {
                try {
                    const xsrfToken = getXsrfToken();
                    if (!xsrfToken) {
                        throw new Error('无法获取 XSRF-TOKEN，请确认已登录微博');
                    }

                    const response = await fetch('https://weibo.com/ajax/setting/deleteFilteredWords', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: buildRequestHeaders(xsrfToken),
                        body: JSON.stringify({
                            value: keyword
                        })
                    });

                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    const result = await response.json();
                    if (result.ok !== 1) {
                        throw new Error(result.msg || '接口返回失败');
                    }
                    if (progressText) {
                        progressText.innerText = `正在删除：${currentIndex}/${totalKeywords}（${keyword}）`;
                    }
                    resolve(result);
                } catch (error) {
                    console.error(`[Weibo-ShieldKeyword] 删除屏蔽词失败: ${keyword}`, error);
                    if (progressText) {
                        progressText.innerText = `删除失败: ${keyword}（${error.message}）`;
                    }
                    showErrorMessage(`删除 "${keyword}" 失败: ${error.message}`);
                    reject(error);
                }
            }, CONFIG.requestDelayMs);
        });
    }

    // ==========================================
    // 4. UI Notification (Weibo Dark Frosted-Glass Toast) & Toolbar Injection
    // ==========================================

    const TOAST_ICONS = {
        success: `
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3.5 8.5 6.5 11.5 12.5 5"></polyline>
            </svg>
        `,
        error: `
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="11.5" y1="4.5" x2="4.5" y2="11.5"></line>
                <line x1="4.5" y1="4.5" x2="11.5" y2="11.5"></line>
            </svg>
        `
    };

    function injectStyles() {
        if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            /* Floating Toast Notification matching Weibo dark frosted glass style (aligned with Weibo FollowFlow) */
            .weibo-shield-toast {
                position: fixed;
                top: 76px;
                left: 50%;
                transform: translate(-50%, -10px);
                background: rgba(30, 30, 30, 0.9);
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                color: #ffffff;
                font-size: 13.5px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                font-weight: 500;
                line-height: 1.4;
                padding: 7px 18px;
                border-radius: 9999px;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.12);
                display: inline-flex;
                align-items: center;
                gap: 6px;
                z-index: 999999;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1), transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
                user-select: none;
            }
            .weibo-shield-toast.wb-toast-show {
                opacity: 1;
                transform: translate(-50%, 0);
            }
            .weibo-shield-toast .wb-toast-icon {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                color: #00ba7c;
            }
            .weibo-shield-toast.wb-toast-error .wb-toast-icon {
                color: #f4212e;
            }
            .weibo-shield-toast .wb-toast-text {
                white-space: nowrap;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    /**
     * 轻微毛玻璃悬浮胶囊提示（与 weibo-follow-flow 视觉风格一致）
     */
    function showToast(message, options = {}) {
        if (typeof document === 'undefined') return;
        injectStyles();

        const {
            type = 'success',
            durationMs = type === 'error' ? CONFIG.toastErrorDurationMs : CONFIG.toastSuccessDurationMs
        } = options;

        if (activeToast) {
            clearTimeout(activeToastTimer);
            if (activeToast.parentElement) {
                activeToast.parentElement.removeChild(activeToast);
            }
            activeToast = null;
        }

        const toast = document.createElement('div');
        toast.className = `weibo-shield-toast${type === 'error' ? ' wb-toast-error' : ''}`;
        toast.setAttribute('role', 'alert');

        const iconSpan = document.createElement('span');
        iconSpan.className = 'wb-toast-icon';
        iconSpan.innerHTML = type === 'error' ? TOAST_ICONS.error : TOAST_ICONS.success;

        const textSpan = document.createElement('span');
        textSpan.className = 'wb-toast-text';
        textSpan.textContent = message;

        toast.appendChild(iconSpan);
        toast.appendChild(textSpan);

        (document.body || document.documentElement).appendChild(toast);
        activeToast = toast;

        const scheduleShow = typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame
            : (fn) => setTimeout(fn, 16);

        scheduleShow(() => {
            toast.classList.add('wb-toast-show');
        });

        activeToastTimer = setTimeout(() => {
            toast.classList.remove('wb-toast-show');
            setTimeout(() => {
                if (toast.parentElement) {
                    toast.parentElement.removeChild(toast);
                }
                if (activeToast === toast) {
                    activeToast = null;
                }
            }, 250);
        }, durationMs);
    }

    function showSuccessMessage(message) {
        showToast(message, {
            type: 'success',
            durationMs: CONFIG.toastSuccessDurationMs
        });
    }

    function showErrorMessage(message) {
        showToast(message, {
            type: 'error',
            durationMs: CONFIG.toastErrorDurationMs
        });
    }

    function showCompletionMessage() {
        showToast('屏蔽词续命完成', {
            type: 'success',
            durationMs: CONFIG.toastSuccessDurationMs
        });
    }

    /**
     * 清理已挂载的增强按钮与模态框（用于切换到非关键词 Tab 时回收 DOM）
     */
    function removeUI() {
        const container = document.getElementById(CONTAINER_ID);
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
        const modal = document.getElementById(MODAL_ID);
        if (modal && modal.parentNode) {
            modal.parentNode.removeChild(modal);
        }
        statusStripUpdater = null;
    }

    /**
     * 根据 VIP 状态与批量任务锁更新四个操作按钮的可用状态
     */
    function syncButtonsState(buttons, vipNotice) {
        const { renewButton, exportButton, importButton, clearButton } = buttons;
        const isVip = isVipUser();

        if (!isVip) {
            const all = [renewButton, exportButton, importButton, clearButton];
            for (const btn of all) {
                btn.disabled = true;
                btn.style.backgroundColor = '#cccccc';
                btn.style.cursor = 'not-allowed';
                btn.title = '仅限微博会员使用此功能';
            }
            if (vipNotice) {
                vipNotice.style.color = '#ff5722';
            }
            return;
        }

        if (isBatchOperating) {
            const all = [renewButton, exportButton, importButton, clearButton];
            for (const btn of all) {
                btn.disabled = true;
                btn.style.backgroundColor = '#cccccc';
                btn.style.cursor = 'not-allowed';
            }
            return;
        }

        renewButton.disabled = false;
        renewButton.style.backgroundColor = '#ff5722';
        renewButton.style.cursor = 'pointer';
        renewButton.innerText = '一键「续命」';

        exportButton.disabled = false;
        exportButton.style.backgroundColor = '#2196F3';
        exportButton.style.cursor = 'pointer';
        exportButton.innerText = '一键「导出」';

        importButton.disabled = false;
        importButton.style.backgroundColor = '#4CAF50';
        importButton.style.cursor = 'pointer';
        importButton.innerText = '一键「导入」';

        clearButton.disabled = false;
        clearButton.style.backgroundColor = '#FF5252';
        clearButton.style.cursor = 'pointer';
        clearButton.innerText = '一键「清空」';
    }

    /**
     * 创建统一样式的操作按钮
     */
    function createActionButton(label, bgColor) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.style.padding = '10px 20px';
        btn.style.backgroundColor = bgColor;
        btn.style.color = '#ffffff';
        btn.style.border = 'none';
        btn.style.borderRadius = '5px';
        btn.style.cursor = 'pointer';
        btn.style.margin = '0';
        btn.style.fontSize = '14px';
        btn.style.fontWeight = '500';
        btn.style.transition = 'opacity 0.2s ease, background-color 0.2s ease';
        btn.innerText = label;
        return btn;
    }

    /**
     * 向页面注入工具栏按钮、自动续命开关条和导入弹窗
     */
    function mountToolbar() {
        const targetElement = document.querySelector(TARGET_SELECTOR);
        if (!targetElement) {
            return;
        }

        if (targetElement.querySelector(`#${CONTAINER_ID}`)) {
            return;
        }

        const oldModal = document.getElementById(MODAL_ID);
        if (oldModal && oldModal.parentNode) {
            oldModal.parentNode.removeChild(oldModal);
        }

        const buttonContainer = document.createElement('div');
        buttonContainer.id = CONTAINER_ID;
        buttonContainer.style.textAlign = 'center';
        buttonContainer.style.marginTop = '8px';

        const vipNotice = document.createElement('div');
        vipNotice.style.color = '#666';
        vipNotice.style.fontSize = '12px';
        vipNotice.style.marginBottom = '10px';
        vipNotice.style.textAlign = 'center';
        vipNotice.innerHTML = '⚠️ <b>提示：「屏蔽关键词」功能仅对 VIP 会员开放</b>';
        vipNotice.setAttribute('data-vip-notice', '');

        const buttonGroup = document.createElement('div');
        buttonGroup.style.display = 'flex';
        buttonGroup.style.justifyContent = 'center';
        buttonGroup.style.flexWrap = 'wrap';
        buttonGroup.style.gap = '10px';
        buttonGroup.style.margin = '10px auto';

        // 自动续命状态与开关条
        const autoRenewBar = document.createElement('div');
        autoRenewBar.style.display = 'inline-flex';
        autoRenewBar.style.alignItems = 'center';
        autoRenewBar.style.justifyContent = 'center';
        autoRenewBar.style.flexWrap = 'wrap';
        autoRenewBar.style.gap = '10px';
        autoRenewBar.style.marginTop = '4px';
        autoRenewBar.style.padding = '6px 14px';
        autoRenewBar.style.borderRadius = '9999px';
        autoRenewBar.style.backgroundColor = 'rgba(255, 130, 0, 0.08)';
        autoRenewBar.style.fontSize = '12px';
        autoRenewBar.style.color = '#666';

        const autoRenewLabel = document.createElement('label');
        autoRenewLabel.style.display = 'inline-flex';
        autoRenewLabel.style.alignItems = 'center';
        autoRenewLabel.style.gap = '5px';
        autoRenewLabel.style.cursor = 'pointer';
        autoRenewLabel.style.fontWeight = '500';
        autoRenewLabel.style.color = '#333';
        autoRenewLabel.title = '默认开启：距离上次续命超过 20 天时在后台自动静默续命（每 15 天最多自动执行 1 次）';

        const autoRenewCheckbox = document.createElement('input');
        autoRenewCheckbox.type = 'checkbox';
        autoRenewCheckbox.checked = isAutoRenewEnabled();
        autoRenewCheckbox.style.cursor = 'pointer';
        autoRenewCheckbox.style.accentColor = '#ff8200';
        autoRenewCheckbox.style.margin = '0';

        const autoRenewTitleText = document.createElement('span');
        autoRenewTitleText.innerText = '自动「续命」（满 20 天后台静默续期）';

        autoRenewLabel.appendChild(autoRenewCheckbox);
        autoRenewLabel.appendChild(autoRenewTitleText);

        const autoRenewDivider = document.createElement('span');
        autoRenewDivider.innerText = '·';
        autoRenewDivider.style.color = '#ccc';

        const autoRenewStatusText = document.createElement('span');
        autoRenewStatusText.style.color = '#888';

        const refreshStatusText = () => {
            autoRenewCheckbox.checked = isAutoRenewEnabled();
            autoRenewStatusText.innerText = formatAutoRenewStatus(getLastRenewTimestamp());
        };
        statusStripUpdater = refreshStatusText;
        refreshStatusText();

        autoRenewCheckbox.addEventListener('change', () => {
            const enabled = autoRenewCheckbox.checked;
            setAutoRenewEnabled(enabled);
            refreshStatusText();
            showSuccessMessage(enabled ? '已开启自动续命' : '已关闭自动续命');
        });

        autoRenewBar.appendChild(autoRenewLabel);
        autoRenewBar.appendChild(autoRenewDivider);
        autoRenewBar.appendChild(autoRenewStatusText);

        const progressText = document.createElement('div');
        progressText.style.marginTop = '10px';
        progressText.style.fontSize = '13px';
        progressText.style.color = '#ff5722';

        const progressBar = document.createElement('div');
        progressBar.style.width = '100%';
        progressBar.style.height = '5px';
        progressBar.style.backgroundColor = '#e0e0e0';
        progressBar.style.borderRadius = '2.5px';
        progressBar.style.marginTop = '10px';
        progressBar.style.overflow = 'hidden';
        progressBar.style.display = 'none';

        const progressFill = document.createElement('div');
        progressFill.style.width = '0%';
        progressFill.style.height = '100%';
        progressFill.style.backgroundColor = '#4CAF50';
        progressFill.style.transition = 'width 0.3s ease-in-out';

        const renewButton = createActionButton('一键「续命」', '#ff5722');
        const exportButton = createActionButton('一键「导出」', '#2196F3');
        const importButton = createActionButton('一键「导入」', '#4CAF50');
        const clearButton = createActionButton('一键「清空」', '#FF5252');

        const buttons = { renewButton, exportButton, importButton, clearButton };

        // 构建导入模态框
        const modal = document.createElement('div');
        modal.id = MODAL_ID;
        modal.style.display = 'none';
        modal.style.position = 'fixed';
        modal.style.top = '0';
        modal.style.left = '0';
        modal.style.width = '100%';
        modal.style.height = '100%';
        modal.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        modal.style.zIndex = '10000';
        modal.style.justifyContent = 'center';
        modal.style.alignItems = 'center';

        const modalContent = document.createElement('div');
        modalContent.style.backgroundColor = '#ffffff';
        modalContent.style.color = '#333333';
        modalContent.style.padding = '20px';
        modalContent.style.borderRadius = '10px';
        modalContent.style.width = '80%';
        modalContent.style.maxWidth = '500px';
        modalContent.style.position = 'relative';
        modalContent.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.2)';

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.innerHTML = '×';
        closeButton.style.position = 'absolute';
        closeButton.style.right = '12px';
        closeButton.style.top = '10px';
        closeButton.style.border = 'none';
        closeButton.style.background = 'none';
        closeButton.style.fontSize = '22px';
        closeButton.style.cursor = 'pointer';
        closeButton.style.color = '#666';

        const title = document.createElement('h3');
        title.innerText = '一键「导入」';
        title.style.marginTop = '0';
        title.style.marginBottom = '12px';
        title.style.fontSize = '16px';

        const modalVipNotice = document.createElement('div');
        modalVipNotice.style.color = '#666';
        modalVipNotice.style.fontSize = '12px';
        modalVipNotice.style.marginBottom = '12px';
        modalVipNotice.innerHTML = '⚠️ <b>提示：「屏蔽关键词」功能仅对 VIP 会员开放（自动过滤空行与重复词）</b>';

        const textarea = document.createElement('textarea');
        textarea.style.width = '100%';
        textarea.style.height = '200px';
        textarea.style.marginBottom = '15px';
        textarea.style.padding = '10px';
        textarea.style.boxSizing = 'border-box';
        textarea.style.border = '1px solid #ddd';
        textarea.style.borderRadius = '5px';
        textarea.style.fontSize = '14px';
        textarea.style.lineHeight = '1.5';
        textarea.style.resize = 'vertical';
        textarea.placeholder = '请输入要屏蔽的关键词，每行一个';

        const importProgress = document.createElement('div');
        importProgress.style.display = 'none';
        importProgress.style.marginBottom = '15px';
        importProgress.style.fontSize = '13px';
        importProgress.style.color = '#666';

        const confirmButton = createActionButton('确认导入', '#4CAF50');

        modalContent.appendChild(closeButton);
        modalContent.appendChild(title);
        modalContent.appendChild(modalVipNotice);
        modalContent.appendChild(textarea);
        modalContent.appendChild(importProgress);
        modalContent.appendChild(confirmButton);
        modal.appendChild(modalContent);
        document.body.appendChild(modal);

        buttonGroup.appendChild(renewButton);
        buttonGroup.appendChild(exportButton);
        buttonGroup.appendChild(importButton);
        buttonGroup.appendChild(clearButton);
        progressBar.appendChild(progressFill);
        buttonContainer.appendChild(vipNotice);
        buttonContainer.appendChild(buttonGroup);
        buttonContainer.appendChild(autoRenewBar);
        buttonContainer.appendChild(progressText);
        buttonContainer.appendChild(progressBar);

        targetElement.appendChild(buttonContainer);

        const resetModal = () => {
            if (isBatchOperating) return;
            modal.style.display = 'none';
            textarea.value = '';
            importProgress.style.display = 'none';
            confirmButton.disabled = false;
            confirmButton.style.backgroundColor = '#4CAF50';
            confirmButton.style.cursor = 'pointer';
        };

        // 1. 一键「导出」事件
        exportButton.addEventListener('click', async () => {
            if (isBatchOperating) return;
            if (!isVipUser()) {
                showErrorMessage('此功能仅限微博会员使用');
                return;
            }
            try {
                isBatchOperating = true;
                syncButtonsState(buttons, vipNotice);
                exportButton.innerText = '导出中...';

                const cards = await fetchFilteredWords();
                const keywords = extractKeywordsFromCards(cards);

                if (keywords.length === 0) {
                    showErrorMessage('当前没有可导出的屏蔽词');
                    return;
                }

                await copyToClipboard(keywords.join('\n'));
                showSuccessMessage(`已导出 ${keywords.length} 个屏蔽词到剪贴板`);
            } catch (error) {
                console.error('[Weibo-ShieldKeyword] 导出失败:', error);
                showErrorMessage(`导出失败: ${error.message}`);
            } finally {
                isBatchOperating = false;
                syncButtonsState(buttons, vipNotice);
            }
        });

        // 2. 一键「续命」事件
        renewButton.addEventListener('click', async () => {
            if (isBatchOperating) return;
            if (!isVipUser()) {
                showErrorMessage('此功能仅限微博会员使用');
                return;
            }
            try {
                isBatchOperating = true;
                syncButtonsState(buttons, vipNotice);
                renewButton.innerText = '正在处理...';

                const cards = await fetchFilteredWords();
                const keywords = extractKeywordsFromCards(cards);
                const totalKeywords = keywords.length;

                if (totalKeywords === 0) {
                    showErrorMessage('当前没有需要续期的屏蔽词');
                    isBatchOperating = false;
                    syncButtonsState(buttons, vipNotice);
                    return;
                }

                progressBar.style.display = 'block';
                progressFill.style.width = '0%';

                for (let i = 0; i < totalKeywords; i++) {
                    await updateBlockWord(keywords[i], i + 1, totalKeywords, progressText);
                    progressFill.style.width = `${((i + 1) / totalKeywords) * 100}%`;
                }

                recordRenewTimestamp(false);
                localStorage.setItem(RENEW_FLAG_KEY, 'true');
                window.location.reload();
            } catch (error) {
                console.error('[Weibo-ShieldKeyword] 续期操作失败:', error);
                progressText.innerText = `操作失败: ${error.message}`;
                progressBar.style.display = 'none';
                isBatchOperating = false;
                syncButtonsState(buttons, vipNotice);
            }
        });

        // 3. 一键「导入」弹窗与确认事件
        importButton.addEventListener('click', () => {
            if (isBatchOperating) return;
            if (!isVipUser()) {
                showErrorMessage('此功能仅限微博会员使用');
                return;
            }
            modal.style.display = 'flex';
            textarea.focus();
        });

        closeButton.addEventListener('click', resetModal);

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                resetModal();
            }
        });

        confirmButton.addEventListener('click', async () => {
            if (isBatchOperating) return;
            if (!isVipUser()) {
                showErrorMessage('此功能仅限微博会员使用');
                return;
            }
            try {
                const keywords = parseImportKeywords(textarea.value);
                if (keywords.length === 0) {
                    showErrorMessage('请输入要屏蔽的关键词');
                    return;
                }

                isBatchOperating = true;
                syncButtonsState(buttons, vipNotice);
                confirmButton.disabled = true;
                confirmButton.style.backgroundColor = '#cccccc';
                confirmButton.style.cursor = 'not-allowed';
                importProgress.style.display = 'block';
                importProgress.innerText = `准备导入 ${keywords.length} 个屏蔽词...`;

                for (let i = 0; i < keywords.length; i++) {
                    await updateBlockWord(keywords[i], i + 1, keywords.length, importProgress);
                }

                recordRenewTimestamp(false);
                showSuccessMessage(`已导入 ${keywords.length} 个屏蔽词`);
                isBatchOperating = false;
                resetModal();
                window.location.reload();
            } catch (error) {
                console.error('[Weibo-ShieldKeyword] 一键导入失败:', error);
                showErrorMessage(`一键「导入」失败: ${error.message}`);
                isBatchOperating = false;
                confirmButton.disabled = false;
                confirmButton.style.backgroundColor = '#4CAF50';
                confirmButton.style.cursor = 'pointer';
                syncButtonsState(buttons, vipNotice);
            }
        });

        // 4. 一键「清空」事件
        clearButton.addEventListener('click', async () => {
            if (isBatchOperating) return;
            if (!isVipUser()) {
                showErrorMessage('此功能仅限微博会员使用');
                return;
            }

            if (!confirm('确定要删除所有屏蔽词吗？此操作不可恢复！')) {
                return;
            }

            try {
                isBatchOperating = true;
                syncButtonsState(buttons, vipNotice);
                clearButton.innerText = '正在清空...';

                const cards = await fetchFilteredWords();
                const keywords = extractKeywordsFromCards(cards);
                const totalKeywords = keywords.length;

                if (totalKeywords === 0) {
                    showErrorMessage('没有找到需要删除的屏蔽词');
                    isBatchOperating = false;
                    syncButtonsState(buttons, vipNotice);
                    return;
                }

                progressBar.style.display = 'block';
                progressFill.style.width = '0%';

                for (let i = 0; i < totalKeywords; i++) {
                    await deleteBlockWord(keywords[i], i + 1, totalKeywords, progressText);
                    progressFill.style.width = `${((i + 1) / totalKeywords) * 100}%`;
                }

                showSuccessMessage('所有屏蔽词已清空');
                window.location.reload();
            } catch (error) {
                console.error('[Weibo-ShieldKeyword] 清空失败:', error);
                progressText.innerText = `清空失败: ${error.message}`;
                progressBar.style.display = 'none';
                isBatchOperating = false;
                syncButtonsState(buttons, vipNotice);
            }
        });

        syncButtonsState(buttons, vipNotice);
    }

    // ==========================================
    // 5. Background Auto-Renew Engine
    // ==========================================

    /**
     * 后台静默自动续命巡检：
     * - 默认开启
     * - 每 15 天最多自动执行 1 次
     * - 距离上次续命超过 20 天（或首次运行）时自动跑一轮
     * - 静默执行不刷新页面，完成后以毛玻璃小胶囊轻提示
     */
    async function maybeRunAutoRenew() {
        if (isBatchOperating) return;

        const decision = evaluateAutoRenewDecision({
            enabled: isAutoRenewEnabled(),
            lastRenewAt: getLastRenewTimestamp(),
            lastAutoRenewAt: getLastAutoRenewTimestamp(),
            now: Date.now()
        });

        if (!decision.shouldRun) {
            return;
        }

        // 必须处于已登录状态（存在 XSRF-TOKEN）且为 VIP 用户
        if (!getXsrfToken() || !isVipUser()) {
            return;
        }

        // 获取跨标签页互斥锁，防止同时打开多个微博标签页并发执行
        if (!acquireAutoRenewLock()) {
            return;
        }

        try {
            isBatchOperating = true;
            const cards = await fetchFilteredWords();
            const keywords = extractKeywordsFromCards(cards);

            if (keywords.length === 0) {
                // 没有设置任何屏蔽词时，记录一次巡检时间戳避免每次打开页面都空查接口
                recordRenewTimestamp(true);
                return;
            }

            for (let i = 0; i < keywords.length; i++) {
                await updateBlockWord(keywords[i], i + 1, keywords.length, null, { silent: true });
            }

            recordRenewTimestamp(true);
            showSuccessMessage(`已自动续命 ${keywords.length} 个屏蔽词`);
        } catch (error) {
            console.warn('[Weibo-ShieldKeyword] 后台自动续命未完成:', error);
        } finally {
            isBatchOperating = false;
            releaseAutoRenewLock();
        }
    }

    // ==========================================
    // 6. Lifecycle & SPA Route Observer
    // ==========================================

    function checkAndMount() {
        if (!isKeywordShieldPage()) {
            if (!isBatchOperating) {
                removeUI();
            }
            return;
        }
        const target = document.querySelector(TARGET_SELECTOR);
        if (target && !target.querySelector(`#${CONTAINER_ID}`)) {
            mountToolbar();
        }
    }

    function boot() {
        try {
            if (localStorage.getItem(RENEW_FLAG_KEY) === 'true') {
                showCompletionMessage();
                localStorage.removeItem(RENEW_FLAG_KEY);
            }
        } catch (e) {}

        checkAndMount();

        // 延迟启动后台自动续命巡检，避开首屏渲染与网络高峰
        setTimeout(() => {
            maybeRunAutoRenew();
        }, CONFIG.autoRenewDelayMs);

        let scanTimer = null;
        const scheduleScan = () => {
            if (scanTimer) clearTimeout(scanTimer);
            scanTimer = setTimeout(() => {
                scanTimer = null;
                checkAndMount();
            }, CONFIG.scanDebounceMs);
        };

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    scheduleScan();
                    break;
                }
            }
        });

        if (document.body) {
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        }

        window.addEventListener('popstate', scheduleScan);
        window.addEventListener('hashchange', scheduleScan);
    }

    // Export pure helpers for Node.js unit testing
    const exportedHelpers = {
        CONFIG,
        DAY_MS,
        STORAGE_KEYS,
        isKeywordShieldPage,
        getXsrfToken,
        parseImportKeywords,
        extractKeywordsFromCards,
        parseConfigFromScriptText,
        checkUserVipStatus,
        buildRequestHeaders,
        evaluateAutoRenewDecision,
        formatAutoRenewStatus
    };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = exportedHelpers;
    }
    if (typeof globalThis !== 'undefined') {
        globalThis.__WEIBO_SHIELD_KEYWORD_INTERNALS__ = exportedHelpers;
    }

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            window.addEventListener('DOMContentLoaded', boot);
        } else {
            boot();
        }
    }
})();
