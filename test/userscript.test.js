import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../weibo-shield-keyword.user.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(__dirname, '../weibo-shield-keyword.user.js');
const scriptContent = fs.readFileSync(scriptPath, 'utf8');

const {
    CONFIG,
    DAY_MS,
    isKeywordShieldPage,
    getXsrfToken,
    parseImportKeywords,
    extractKeywordsFromCards,
    parseConfigFromScriptText,
    checkUserVipStatus,
    buildRequestHeaders,
    evaluateAutoRenewDecision,
    formatAutoRenewStatus
} = globalThis.__WEIBO_SHIELD_KEYWORD_INTERNALS__;

test('Tampermonkey UserScript 元数据头部格式完整规范', () => {
    assert.match(scriptContent, /^\/\/ ==UserScript==/m);
    assert.match(scriptContent, /^\/\/ ==\/UserScript==/m);
    assert.match(scriptContent, /@name\s+Weibo ShieldKeyword - 微博屏蔽词增强助手/);
    assert.match(scriptContent, /@namespace\s+https:\/\/github\.com\/haorui-lab\/weibo-shield-keyword-js/);
    assert.match(scriptContent, /@license\s+MIT/);
    assert.match(scriptContent, /@match\s+https:\/\/weibo\.com\/\*/);
    assert.match(scriptContent, /@match\s+https:\/\/www\.weibo\.com\/\*/);
    assert.match(scriptContent, /@grant\s+GM_setClipboard/);
    assert.match(scriptContent, /@grant\s+unsafeWindow/);
});

test('核心功能按钮、自动续命滑块与毛玻璃 Toast 样式均已声明', () => {
    assert.ok(scriptContent.includes('https://weibo.com/ajax/setting/getFilteredWords'));
    assert.ok(scriptContent.includes('https://weibo.com/ajax/setting/updateBlockWords'));
    assert.ok(scriptContent.includes('https://weibo.com/ajax/setting/deleteFilteredWords'));
    assert.ok(scriptContent.includes('一键「续命」'));
    assert.ok(scriptContent.includes('一键「导出」'));
    assert.ok(scriptContent.includes('一键「导入」'));
    assert.ok(scriptContent.includes('一键「清空」'));
    assert.ok(scriptContent.includes('自动续命'));
    assert.ok(scriptContent.includes('.weibo-shield-switch'));
    assert.ok(scriptContent.includes('.weibo-shield-toast'));
    assert.ok(scriptContent.includes('backdrop-filter: blur(16px)'));
});

test('isKeywordShieldPage 路由判断逻辑准确识别屏蔽词页与非屏蔽词页', () => {
    assert.equal(isKeywordShieldPage('https://weibo.com/set/shield?type=keyword'), true);
    assert.equal(isKeywordShieldPage('https://www.weibo.com/set/shield?type=keyword'), true);
    assert.equal(isKeywordShieldPage('https://weibo.com/set/shield'), true);
    assert.equal(isKeywordShieldPage('https://weibo.com/set/shield?type=user'), false);
    assert.equal(isKeywordShieldPage('https://weibo.com/set/shield?type=weibo'), false);
    assert.equal(isKeywordShieldPage('https://weibo.com/home'), false);
    assert.equal(isKeywordShieldPage(''), false);
});

test('getXsrfToken 安全解析各种格式的 Cookie 字符串', () => {
    assert.equal(getXsrfToken('SUB=123; XSRF-TOKEN=abc-def_123; WBPSESS=xyz'), 'abc-def_123');
    assert.equal(getXsrfToken('XSRF-TOKEN=token_at_start; SUB=123'), 'token_at_start');
    assert.equal(getXsrfToken('SUB=123;XSRF-TOKEN=no_space_token'), 'no_space_token');
    assert.equal(getXsrfToken('XSRF-TOKEN=encoded%2Btoken%3D1'), 'encoded+token=1');
    assert.equal(getXsrfToken('SUB=123; OTHER_XSRF-TOKEN=fake'), null);
    assert.equal(getXsrfToken('SUB=123'), null);
    assert.equal(getXsrfToken(''), null);
});

test('parseImportKeywords 自动去除首尾空白、过滤空行并保持顺序去重', () => {
    const raw = '  剧透 \r\n\n  广告  \n剧透\n   \n营销号\r\n广告';
    assert.deepEqual(parseImportKeywords(raw), ['剧透', '广告', '营销号']);
    assert.deepEqual(parseImportKeywords('   \n  \r\n '), []);
    assert.deepEqual(parseImportKeywords(''), []);
    assert.deepEqual(parseImportKeywords(null), []);
});

test('extractKeywordsFromCards 正确过滤无效项与空白词条', () => {
    const mockCardGroup = [
        { title_sub: '关键词A' },
        { title_sub: '  关键词B  ' },
        { title_sub: '' },
        { other_field: '忽略项' },
        null,
        { title_sub: '关键词C' }
    ];
    assert.deepEqual(extractKeywordsFromCards(mockCardGroup), ['关键词A', '关键词B', '关键词C']);
    assert.deepEqual(extractKeywordsFromCards(null), []);
    assert.deepEqual(extractKeywordsFromCards({}), []);
});

test('parseConfigFromScriptText 与 checkUserVipStatus 准确识别会员与非会员', () => {
    const scriptText = 'var $CONFIG = {"user":{"idstr":"12345","screen_name":"test","mbrank":6,"vipUser":1}};';
    const parsed = parseConfigFromScriptText(scriptText);
    assert.ok(parsed && parsed.user);
    assert.equal(parsed.user.screen_name, 'test');
    assert.equal(checkUserVipStatus(parsed.user), true);

    assert.equal(checkUserVipStatus({ mbrank: 0, vipUser: 0 }), false);
    assert.equal(checkUserVipStatus({ mbrank: 1, vipUser: 0 }), true);
    assert.equal(checkUserVipStatus({ mbrank: 0, vipUser: 1 }), true);
    assert.equal(checkUserVipStatus({ mbrank: 0, vipUser: 0, svip: 1 }), true);
    assert.equal(checkUserVipStatus(null), false);
});

test('buildRequestHeaders 生成合法的请求头且不包含浏览器禁止头', () => {
    const headers = buildRequestHeaders('my-xsrf-token');
    assert.equal(headers['x-xsrf-token'], 'my-xsrf-token');
    assert.equal(headers['Content-Type'], 'application/json');
    assert.equal(headers['x-requested-with'], 'XMLHttpRequest');
    assert.equal('referer' in headers, false);
    assert.equal('origin' in headers, false);
    assert.equal('user-agent' in headers, false);
    assert.equal(CONFIG.requestDelayMs, 500);
    assert.equal(CONFIG.autoRenewMinIntervalDays, 15);
    assert.equal(CONFIG.autoRenewTriggerDays, 20);
});

test('evaluateAutoRenewDecision 严格遵守「默认开启、15天冷却上限、超20天触发」规则', () => {
    const now = 1795000000000;

    // 1. 默认开启，且从未记录过续命时间 -> 首次运行立即触发
    const firstRun = evaluateAutoRenewDecision({ now });
    assert.equal(firstRun.shouldRun, true);
    assert.equal(firstRun.reason, 'first_run');

    // 2. 开关被用户关闭 -> 不触发
    const disabled = evaluateAutoRenewDecision({
        enabled: false,
        lastRenewAt: now - 30 * DAY_MS,
        now
    });
    assert.equal(disabled.shouldRun, false);
    assert.equal(disabled.reason, 'disabled');

    // 3. 距离上次自动续命不足 15 天（即使传入异常的旧 lastRenewAt）-> 15 天冷却保护生效
    const cooldown = evaluateAutoRenewDecision({
        enabled: true,
        lastRenewAt: now - 25 * DAY_MS,
        lastAutoRenewAt: now - 10 * DAY_MS,
        now
    });
    assert.equal(cooldown.shouldRun, false);
    assert.equal(cooldown.reason, 'cooldown_15d');

    // 4. 距离上次续命 18 天（超过 15 天冷却，但未满 20 天阈值）-> 不触发
    const within20d = evaluateAutoRenewDecision({
        enabled: true,
        lastRenewAt: now - 18 * DAY_MS,
        lastAutoRenewAt: now - 18 * DAY_MS,
        now
    });
    assert.equal(within20d.shouldRun, false);
    assert.equal(within20d.reason, 'within_20d');

    // 5. 距离上次续命满 20 天（且距上次自动执行已满 15 天）-> 自动触发一轮
    const overdue20d = evaluateAutoRenewDecision({
        enabled: true,
        lastRenewAt: now - 20.5 * DAY_MS,
        lastAutoRenewAt: now - 20.5 * DAY_MS,
        now
    });
    assert.equal(overdue20d.shouldRun, true);
    assert.equal(overdue20d.reason, 'overdue_20d');
});

test('formatAutoRenewStatus 正确格式化上次续命时间提示', () => {
    const now = new Date('2026-11-20T12:00:00Z').getTime();

    assert.match(formatAutoRenewStatus(0, now), /尚未记录续命时间/);
    assert.match(formatAutoRenewStatus(now - 2 * 60 * 60 * 1000, now), /^上次续命：今天 \(\d{4}-\d{2}-\d{2}\)$/);
    assert.match(formatAutoRenewStatus(now - 21 * DAY_MS, now), /^上次续命：21 天前 \(\d{4}-\d{2}-\d{2}\)$/);
});
