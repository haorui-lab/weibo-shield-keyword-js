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
    isKeywordShieldPage,
    getXsrfToken,
    parseImportKeywords,
    extractKeywordsFromCards,
    parseConfigFromScriptText,
    checkUserVipStatus,
    buildRequestHeaders
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

test('核心功能按钮与微博官方接口均已声明', () => {
    assert.ok(scriptContent.includes('https://weibo.com/ajax/setting/getFilteredWords'));
    assert.ok(scriptContent.includes('https://weibo.com/ajax/setting/updateBlockWords'));
    assert.ok(scriptContent.includes('https://weibo.com/ajax/setting/deleteFilteredWords'));
    assert.ok(scriptContent.includes('一键「续命」'));
    assert.ok(scriptContent.includes('一键「导出」'));
    assert.ok(scriptContent.includes('一键「导入」'));
    assert.ok(scriptContent.includes('一键「清空」'));
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
});
