# Weibo ShieldKeyword (`weibo-shield-keyword-js`)

<p align="center">
  <strong>面向新浪微博 (Weibo.com) 的轻量级屏蔽词增强用户脚本 —— 提供屏蔽关键词自动后台续命、一键续期（续命）、一键批量导入、一键导出备份与一键清空。</strong>
</p>

<p align="center">
  <a href="https://github.com/haorui-lab/weibo-shield-keyword-js/releases"><img src="https://img.shields.io/badge/version-2.1.0-orange.svg?style=flat-square" alt="Version"></a>
  <a href="./package.json"><img src="https://img.shields.io/badge/license-MIT-green.svg?style=flat-square" alt="License"></a>
  <a href="https://www.tampermonkey.net/"><img src="https://img.shields.io/badge/Tampermonkey-支持-black?style=flat-square&logo=tampermonkey" alt="Tampermonkey"></a>
  <a href="https://violentmonkey.github.io/"><img src="https://img.shields.io/badge/Violentmonkey-支持-orange?style=flat-square" alt="Violentmonkey"></a>
  <a href="https://github.com/haorui-lab/weibo-shield-keyword-js/pulls"><img src="https://img.shields.io/badge/PRs-欢迎提交-brightgreen.svg?style=flat-square" alt="PRs Welcome"></a>
</p>

---

## 💡 为什么需要 Weibo ShieldKeyword？

新浪微博的「屏蔽关键词」是过滤营销号、剧透与垃圾内容的核心功能，但官方原生管理界面存在诸多痛点：

1. **屏蔽词存在有效期限制**：微博屏蔽词默认具有过期时间，一旦过期需要逐个手动点击续期，词条多时极其耗时。
2. **仅支持单条逐个添加/删除**：官方界面每次只能输入一个关键词提交，无法批量导入已有词库，也无法一键清空。
3. **缺乏导出备份能力**：更换账号或定期整理词库时，无法将已配置的数百个屏蔽词一次性导出备份。

**Weibo ShieldKeyword** 直接在微博原生「屏蔽设置 - 关键词」面板中无缝注入四个增强按钮，用最直观的方式解决以上全部痛点。

> ⚠️ **前置说明**：受限于新浪微博官方机制，**「屏蔽关键词」底层接口仅对微博 VIP 会员开放**。脚本会自动识别当前账号的 VIP 状态并给出相应提示。

---

## ✨ 核心特性

- ⚡ **自动「续命」（全站后台静默巡检）**：
  - **默认开启**：日常打开任意微博页面时自动在后台静默检查，无需专门进入设置页面；
  - **克制防打扰策略**：每 **15 天**最多自动执行 1 次；当距离上次续命超过 **20 天**（或首次安装未记录续命时间）时，自动在后台静默续期全部屏蔽词；
  - **跨标签页互斥锁 + 轻微毛玻璃通知**：多标签页不重复触发，后台完成后仅以顶部深色毛玻璃小胶囊轻提示 `已自动续命 N 个屏蔽词`，绝不刷新或打断当前浏览。
- 🔄 **一键「续命」（手动批量续期）**：
  - 自动拉取当前全部已设置的屏蔽关键词，按安全间隔逐一重新提交更新，一键刷新所有词条有效期；
  - 内置可视化进度条与实时计数提示，完成后自动刷新页面展示最新状态。
- 📤 **一键「导出」（剪贴板备份）**：
  - 一键提取全部屏蔽词并按行拼接写入系统剪贴板（支持 `GM_setClipboard` / `navigator.clipboard` / `execCommand` 三级回退）；
  - 导出格式与导入格式完全一致（每行一个词），方便跨账号迁移或本地备份。
- 📥 **一键「导入」（批量去重写入）**：
  - 提供清爽的弹窗输入面板，支持按行粘贴任意数量的屏蔽词；
  - 自动清理首尾空格、过滤空行并对重复词条去重，串行安全写入。
- 🗑️ **一键「清空」（防误触批量删除）**：
  - 内置原生二次确认弹窗，防止误操作；
  - 确认后自动遍历并删除当前账号下的全部屏蔽关键词。
- 🚀 **SPA 路由感知与防并发保护**：
  - 支持从微博首页/信息流通过单页应用（SPA）无刷新跳转至屏蔽设置页时自动挂载；
  - 批量任务执行期间全局锁定操作按钮，严防重复点击引发并发冲突。
- 🔒 **100% 本地隐私安全**：纯浏览器客户端运行，直接复用当前微博登录会话调用官方接口，绝无任何第三方服务器请求或数据上报。

---

## 🎨 功能按钮一览

| 按钮名称 | 按钮配色 | 核心作用 | 交互反馈 |
| :--- | :---: | :--- | :--- |
| **一键「续命」** | 微博橙 (`#FF5722`) | 批量重新提交现有全部屏蔽词，刷新有效期 | 实时进度条 + `正在处理：X/N` + 完成后自动刷新 |
| **一键「导出」** | 经典蓝 (`#2196F3`) | 将当前全部屏蔽词按行复制到剪贴板 | 顶部悬浮提示 `已成功导出 N 个屏蔽词到剪贴板！` |
| **一键「导入」** | 翠绿色 (`#4CAF50`) | 打开批量导入弹窗，每行一词批量写入（自动去重） | 弹窗内实时进度提示 + 完成后自动刷新 |
| **一键「清空」** | 警示红 (`#FF5252`) | 二次确认后批量删除所有屏蔽词 | 确认弹窗 + 实时删除进度条 + 完成后自动刷新 |

---

## 📦 支持页面

- ✅ `https://weibo.com/set/shield?type=keyword`（微博屏蔽设置 - 关键词页）
- ✅ `https://weibo.com/set/shield`（微博屏蔽设置默认入口）
- ✅ `https://www.weibo.com/set/shield*`（兼容 `www` 子域名及微博站内 SPA 路由切换）
- ⚪ `https://weibo.com/set/shield?type=user` / `type=weibo`（屏蔽用户 / 屏蔽微博标签页自动隐藏工具栏）

---

## 🚀 快速安装

### 前置条件

请先在浏览器中安装以下任意一款用户脚本管理器：
- [**Tampermonkey (篡改猴)**](https://www.tampermonkey.net/)（推荐：Chrome、Edge、Safari、Firefox）
- [**Violentmonkey (暴力猴)**](https://violentmonkey.github.io/)（Chrome、Firefox、Edge）
- [**ScriptCat (脚本猫)**](https://docs.scriptcat.org/)

### 一键在线安装

点击下方任意直链即可直接调出 Tampermonkey / Violentmonkey 的一键安装窗口（无需手动复制代码）：

- 👉 **[GitHub Raw 一键安装 `weibo-shield-keyword.user.js`](https://raw.githubusercontent.com/haorui-lab/weibo-shield-keyword-js/main/weibo-shield-keyword.user.js)**
- 👉 **[jsDelivr CDN 一键安装（国内网络推荐）](https://fastly.jsdelivr.net/gh/haorui-lab/weibo-shield-keyword-js@main/weibo-shield-keyword.user.js)**

也可以复制以下 URL，在 Tampermonkey「实用工具 -> 从 URL 安装」中直接粘贴导入：

```text
https://raw.githubusercontent.com/haorui-lab/weibo-shield-keyword-js/main/weibo-shield-keyword.user.js
```

---

## ⚙️ 个性化配置

脚本顶部提供了直观的配置对象 `CONFIG`，可根据网络状况与个人偏好自由微调：

```javascript
const CONFIG = {
    requestDelayMs: 500,            // 批量请求间隔（毫秒），默认 500ms 防止触发微博接口频控
    autoRenewDelayMs: 5000,         // 页面打开后触发后台自动续命巡检的延迟（毫秒），避开首屏加载高峰
    autoRenewMinIntervalDays: 15,   // 自动续命最小冷却周期（天）：每 15 天最多自动执行 1 次
    autoRenewTriggerDays: 20,       // 自动续命触发阈值（天）：距离上次续命超过 20 天自动跑一轮
    autoRenewLockTtlMs: 600000,     // 跨标签页并发锁超时时间（毫秒）
    scanDebounceMs: 100,            // SPA DOM 变更防抖扫描间隔（毫秒）
    toastSuccessDurationMs: 2600,   // 成功提示气泡显示时长（毫秒）
    toastErrorDurationMs: 4200      // 错误提示气泡显示时长（毫秒）
};
```

---

## 🛠️ 技术原理与架构

```
┌─────────────────────────────────────────────────────────────────┐
│                   Weibo.com 现代 Web 运行环境                   │
│                                                                 │
│   ┌──────────────────────┐             ┌─────────────────────┐  │
│   │  SPA 路由与 DOM 监听 │             │   VIP 状态检测器    │  │
│   │  (MutationObserver)  │             │ ($CONFIG / Vue3 树) │  │
│   └──────────┬───────────┘             └──────────┬──────────┘  │
│              │ 识别 .wbpro-setup__line2           │ 校验会员权限│
│              ▼                                    ▼             │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │         Toolbar & Modal UI (原生设置面板工具栏注入)      │  │
│   │    [ 一键续命 ]  [ 一键导出 ]  [ 一键导入 ]  [ 一键清空 ]│  │
│   └──────────────────────────┬───────────────────────────────┘  │
│                              │ 串行队列调度 (500ms 防频控)      │
│                              ▼                                  │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │             Weibo Shield API Client (XSRF 鉴权)          │  │
│   │   • 查询: GET  /ajax/setting/getFilteredWords            │  │
│   │   • 更新: POST /ajax/setting/updateBlockWords            │  │
│   │   • 删除: POST /ajax/setting/deleteFilteredWords         │  │
│   └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

1. **沙箱穿透与 VIP 识别**：优先通过 `unsafeWindow.$CONFIG`、Vue 3 根实例 `globalProperties` 及内联脚本解析用户 `mbrank` / `vipUser` / `svip` 状态。
2. **串行防频控调度**：批量续期、导入与清空均采用 `500ms` 间隔串行队列执行，兼顾执行效率与账号安全。
3. **跨浏览器兼容请求构建**：自动提取 Cookie 中的 `XSRF-TOKEN`，动态适配 Chromium / Firefox / Safari 请求头。

---

## 🧪 自动化单元测试

项目内置基于 Node.js 原生测试运行器（`node:test`）的单元测试套件，零第三方依赖：

```bash
# 克隆仓库
git clone git@github.com:haorui-lab/weibo-shield-keyword-js.git
cd weibo-shield-keyword-js

# 运行测试
npm test
```

测试覆盖：
- Tampermonkey UserScript 元数据头规范校验
- 微博屏蔽设置路由判断（`isKeywordShieldPage`）
- `XSRF-TOKEN` 边界场景与 URL 编码提取（`getXsrfToken`）
- 批量导入词条空白清理与保序去重（`parseImportKeywords`）
- 接口 `card_group` 数据提取过滤（`extractKeywordsFromCards`）
- `$CONFIG` 脚本解析与 VIP 会员状态判定（`parseConfigFromScriptText` / `checkUserVipStatus`）

---

## 🛡️ 安全与隐私规范

- **零数据外流**：纯本地运行，绝不连接任何第三方服务器，零 Telemetry / Analytics。
- **凭据零泄露**：不保存、不外传您的密码、Cookie 或 `XSRF-TOKEN`。
- **纯手动触发**：所有批量管理操作均需用户点击对应按钮显式触发。

---

## 📄 开源许可证

本项目基于 [MIT License](./package.json) 开源。
