# DeepSeek peak hours · DSH plugin

[![npm version](https://img.shields.io/npm/v/dsh-plugin-deepseek-peak-hours.svg)](https://www.npmjs.com/package/dsh-plugin-deepseek-peak-hours)
[![npm downloads](https://img.shields.io/npm/dm/dsh-plugin-deepseek-peak-hours.svg)](https://www.npmjs.com/package/dsh-plugin-deepseek-peak-hours)
[![license](https://img.shields.io/npm/l/dsh-plugin-deepseek-peak-hours.svg)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/hifengzy/dsh-plugin-deepseek-peak-hours.svg)](https://github.com/hifengzy/dsh-plugin-deepseek-peak-hours/stargazers)
[![CI](https://github.com/hifengzy/dsh-plugin-deepseek-peak-hours/actions/workflows/ci.yml/badge.svg)](https://github.com/hifengzy/dsh-plugin-deepseek-peak-hours/actions/workflows/ci.yml)

**English** · [简体中文](./README.zh.md)

A lightweight DeepSeek Harness (DSH) plugin that shows whether DeepSeek API usage is billing at the **peak** or **off-peak** rate right now, next to the composer's context meter. Clicking the badge opens the **FLASH / PRO price table** for that window.

```
Peak 09:00 - 12:00     ← click for the price table
```

## What it does

| Where | Appears when | Exact position |
| --- | --- | --- |
| `conversation.composer.dock` | A session with a conversation (composer docked at the bottom) | In the statistics row under the composer card, immediately right of the built-in `Context used x%` reading |
| `conversation.hero.options` | The New Session home (a blank session) | Right-hand side of the options row above the composer card, beside the workspace and preset controls |

- **Reading**: `Peak 09:00 - 12:00` during a peak window, `Off-peak 18:00 - 24:00` otherwise. Overnight and whole-day windows read their real range: `00:00 - 09:00`, `18:00 - 24:00`, `00:00 - 24:00`.
- **Click**: a table for the running window — rows `Input, 1M tokens (cache hit)` / `Input, 1M tokens (cache miss)` / `Output, 1M tokens`, columns `FLASH (CNY)` and `PRO (CNY)`, plus the note that off-peak rates are half the peak rates.
- **State dot**: amber for peak, green for off-peak, from DSH's `--dsw-alias-state-warn-primary` and `--dsw-alias-state-success-primary` tokens.

## Schedule and prices (official, not invented)

The schedule is quoted from DeepSeek's official pricing page:

> Off-peak rates are half of the peak rates. Beijing time, Monday to Friday (excluding Chinese statutory holidays) 09:00 - 12:00 and 14:00 - 18:00 are peak hours; all other times, including weekends and Chinese statutory holidays all day, are off-peak.

- Official pricing page: <https://api-docs.deepseek.com/zh-cn/quick_start/pricing/>
- 2026 holidays: State Council notice 国办发明电〔2025〕7 号 <https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm>
- 2027 holidays: State Council notice 国办发明电〔2026〕10 号 <https://www.gov.cn/zhengce/zhengceku/202611/content_7085102.htm>

Prices in CNY per million tokens, matching the official page on 2026-11-16:

| | FLASH peak | FLASH off-peak | PRO peak | PRO off-peak |
| --- | --- | --- | --- | --- |
| Input (cache hit) | 0.04 | 0.02 | 0.30 | 0.15 |
| Input (cache miss) | 2.00 | 1.00 | 9.00 | 4.50 |
| Output | 8.00 | 4.00 | 27.00 | 13.50 |

Background: time-of-day pricing started on 2026-08-17, weekends became off-peak all day on 2026-08-23, and the FLASH series switched to the prices above at 12:00 Beijing time on 2026-09-10. **When DeepSeek changes prices, update the plugin** (see below).

## Install

In DSH open **Plugins → Add plugin** and enter the npm package name:

```
dsh-plugin-deepseek-peak-hours
```

Or point it at this repository's directory for local development. The plugin is active for the whole profile and survives a restart. Refresh the page after installing.

## Design and performance

- **One timer, no polling**: it wakes at the next window boundary only — 00:00, 09:00, 12:00, 14:00 and 18:00 Beijing time, at most five times a day. Coming back to a background tab, or waking a laptop, recomputes from the current clock.
- **No network calls**: the schedule, the holiday calendar, and the price table all ship in the bundle.
- **No dependencies**: it uses only the browser module table's `react` / `react-dom`, and never imports `@deepseek-ai/dsh-client-ui-primitives` or other DSH Client packages that change without notice.
- **Native styling**: every color, radius, shadow and font size comes from `--dsw-*` / `--dsh-*` theme tokens, so light and dark themes both match; the popover copies the built-in statistics dialog (12px padding, `--dsw-radius-lg`, `elevation-prominent`, z-index 1100, Escape and outside-click dismissal).
- **Beijing time only**: the billing rule is defined in Beijing time, so the badge always computes in `Asia/Shanghai` regardless of the machine's zone (the test suite also passes under `TZ=America/New_York`).
- **Clean teardown**: styles render as a React element and disappear on unmount; the timer and listeners are released in effect cleanups.

## Known limitations

- **No badge on a session-less cold start**: on a home with no session at all DSH opens no slot under the composer, and no plugin seat exists there. The badge appears as soon as a session is selected or created — the same visibility the built-in context meter has.
- **Holiday data covers 2026–2027**: a later year falls back to the plain weekday rule (weekends still correct). Append the new State Council ranges to `HOLIDAY_RANGES` in `client.js` and publish a release when the notice appears.
- **Prices are a static snapshot**: update `PRICES` in `client.js` when DeepSeek changes its price list; the plugin does not scrape the web.

## Development

```bash
npm test        # schedule, holidays, boundaries, slots and dictionary wiring
npm run test:tz # the same suite under a non-Beijing machine zone
```

Files:

```
client.js            # everything: schedule + badge + price popover (no build step)
index.js             # Host half; registers nothing
cordis.patch.yml     # inserts the deepseek-peak-hours row
locale/{zh,en}.json  # Plugin Manager title and description
icon.svg             # 36×36 plugin icon (clock plus the peak wedge)
assets/icon-180.png  # 180×180 storefront tile
test/                # node --test suites
```

The schedule lives between `/* #region schedule */` markers, and the tests evaluate that block straight out of `client.js`, so there is exactly one implementation.

## License

[MIT](./LICENSE)

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
