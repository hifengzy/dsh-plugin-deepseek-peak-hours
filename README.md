# DeepSeek 峰谷时段 · DSH 插件

在 DeepSeek Harness（DSH）的输入框底部实时显示 DeepSeek API 当前是**峰时**还是**闲时**，点击徽标即可查看此时段 FLASH / PRO 的单价。外观、字号、悬停与弹层表面全部取自 DSH 内置主题 token，和「上下文已用 x%」等内置读数排在同一行。

```
峰时 09:00 - 12:00     ← 点击后弹出价格表
```

## 它做什么

| 位置 | 出现条件 | 具体位置 |
| --- | --- | --- |
| `conversation.composer.dock` | 已有会话（输入框停靠在底部） | 输入框卡片下方统计行，「上下文已用 x%」右侧 |
| `conversation.hero.options` | 新会话首页（空白会话） | 输入框卡片上方的选项行右侧，与工作区/预设控件同排 |

- 文案：峰时 `峰时 09:00 - 12:00`；闲时 `闲时 18:00 - 24:00`；跨夜/整日空闲会显示 `00:00 - 09:00`、`18:00 - 24:00`、`00:00 - 24:00` 等真实区间。
- 点击弹出当前时段的价目表：行为「百万 tok 输入（缓存命中）」「百万 tok 输入（缓存未命中）」「百万 tok 输出」，列为 `FLASH（元）`、`PRO（元）`，并注明「空闲时段单价为高峰时段的一半」。
- 左侧小圆点：峰时琥珀色、闲时绿色，取自 DSH 的 `--dsw-alias-state-warn-primary` / `--dsw-alias-state-success-primary`。

## 时段与价格来源（官方定义，非臆造）

时段定义逐字来自 DeepSeek 官方定价页：

> 空闲时段价格为高峰时段价格的一半。北京时间周一至周五（不含中国法定节假日）9:00 - 12:00、14:00 - 18:00 为高峰时段；其余时段，包括周末及中国法定节假日全天均为空闲时段。

- 官方定价页：<https://api-docs.deepseek.com/zh-cn/quick_start/pricing/>
- 2026 年节假日：国务院办公厅《关于 2026 年部分节假日安排的通知》（国办发明电〔2025〕7 号）<https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm>
- 2027 年节假日：国务院办公厅《关于 2027 年部分节假日安排的通知》（国办发明电〔2026〕10 号）<https://www.gov.cn/zhengce/zhengceku/202611/content_7085102.htm>

价格表（元 / 百万 tokens，随官方定价页同步于 2026-11-16）：

| | FLASH 峰时 | FLASH 闲时 | PRO 峰时 | PRO 闲时 |
| --- | --- | --- | --- | --- |
| 输入（缓存命中） | 0.04 | 0.02 | 0.30 | 0.15 |
| 输入（缓存未命中） | 2.00 | 1.00 | 9.00 | 4.50 |
| 输出 | 8.00 | 4.00 | 27.00 | 13.50 |

背景：峰谷分时定价自 2026-08-17 起生效，2026-08-23 起周六、周日全天不再区分峰谷，Flash 系列自 2026-09-10 12:00（北京时间）起按上表价格计费。**官方改价后需要更新插件**（见下文）。

## 安装

在 DSH 的 **插件（Plugins）** 页面点 **添加插件（Add plugin）**，填入 npm 包名：

```
dsh-plugin-deepseek-peak-hours
```

或填入本仓库的本地目录路径（开发时推荐）。安装后按提示刷新页面即可；插件作用于整个 profile，重启后依然生效。

## 设计与性能

- **单定时器，不轮询**：只在下一个时段边界（北京时间 00:00 / 09:00 / 12:00 / 14:00 / 18:00）唤醒一次，一天最多 5 次；标签页重新可见或窗口获得焦点时补算一次，睡眠唤醒后也按当前时钟重算。
- **零网络请求**：时段规则、节假日、价目表都在本地，不请求 DeepSeek 接口。
- **零依赖**：只用浏览器模块表里的 `react` / `react-dom`，不引用 `@deepseek-ai/dsh-client-ui-primitives` 等会随时变化的 Client 包。
- **样式同源**：颜色、圆角、阴影、字体全部走 `--dsw-*` / `--dsh-*` 主题 token，自动适配亮/暗主题；弹层结构与内置统计弹层一致（12px 内边距、`--dsw-radius-lg`、`elevation-prominent`、1100 层级、Esc/点击外部关闭）。
- **时区固定**：计费规则由北京时间定义，因此始终按 `Asia/Shanghai` 计算，与机器时区无关（测试在 `TZ=America/New_York` 下同样通过）。
- **可卸载干净**：样式以 React 元素形式渲染、随组件卸载移除；定时器与监听器都在 effect 清理函数中释放。

## 已知限制

- **无会话的冷启动首页不显示**：DSH 在「没有任何会话」的首页只渲染输入框上方的区域，没有向插件开放输入框下方的挂载位；选中或新建会话后徽标即出现。新会话（空白会话）显示在输入框上方的选项行，这是官方为该状态提供的插件位置。
- **节假日数据覆盖 2026–2027**：之后年份退化为「周一至周五 09:00-12:00、14:00-18:00 峰时」的普通规则，周末仍然正确。国务院发布新一年安排后，把新区间追加到 `client.js` 的 `HOLIDAY_RANGES` 并发布新版本即可。
- **价格是静态快照**：官方调整价格后需要更新 `client.js` 的 `PRICES`；插件不抓取网页。

## 开发

```bash
npm test        # 时段/节假日/边界单元测试
npm run test:tz # 在非北京时区下重跑，验证与机器时区无关
```

文件结构：

```
client.js            # 全部功能：时段计算 + 徽标 + 价格弹层（无构建步骤）
index.js             # Host 半边，无需注册任何资源
cordis.patch.yml     # 插入 deepseek-peak-hours 这一行
locale/{zh,en}.json  # 插件管理页的标题、描述
icon.svg             # 插件图标（36×36，时钟 + 峰时扇形）
test/schedule.test.mjs
```

时段计算被 `/* #region schedule */` 标记包围，测试直接从 `client.js` 取出这段纯函数执行，因此这份逻辑只有一份实现。

## English summary

A lightweight DSH plugin that shows the running DeepSeek API billing window next to the composer's context meter (and in the New Session options row), with a click-open FLASH / PRO price table. It follows the official schedule — Beijing time, Monday to Friday except Chinese statutory holidays, 09:00-12:00 and 14:00-18:00 peak; everything else off-peak at half price — and arms a single timer at the next boundary instead of polling. Install it from **Plugins → Add plugin** with the package name above. Offline pricing means the shipped numbers must be updated when DeepSeek publishes new prices.

## License

[MIT](./LICENSE)
