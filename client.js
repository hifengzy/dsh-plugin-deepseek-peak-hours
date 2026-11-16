/**
 * DeepSeek API peak / off-peak badge for the DSH composer.
 *
 * The badge rides two official slots:
 *   - `conversation.composer.dock` (a session with a conversation): the
 *     statistics row under the composer card, immediately right of the built-in
 *     context meter.
 *   - `conversation.hero.options` (the New Session home): the options row above
 *     the composer card. DSH does not render the dock slot in the hero phase.
 *
 * Clicking the badge portals a price table for the window that is running now.
 * The schedule follows the official pricing page: Beijing time, Monday to
 * Friday (excluding Chinese statutory holidays), 09:00 - 12:00 and
 * 14:00 - 18:00 are peak; everything else, including whole weekends and
 * holidays, is off-peak, billed at half the peak rate.
 *
 * The badge is cheap: it arms one timer for the next window boundary
 * (00:00 / 09:00 / 12:00 / 14:00 / 18:00 Beijing time) instead of polling.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-deepseek-peak-hours',
  factory(require) {
    const React = require('react')
    const { createPortal } = require('react-dom')
    const h = React.createElement

    /** Locale namespace owned by this plugin. */
    const NS = 'deepseekPeakHours'
    /** Composer statistics row (docked composer only). */
    const DOCK_SLOT = 'conversation.composer.dock'
    /** New Session options row (hero phase). */
    const HERO_SLOT = 'conversation.hero.options'
    /** Unique entry id inside both lists. */
    const ENTRY_ID = 'deepseek-peak-hours'

    /* #region schedule */

    /** Official billing time zone: the schedule is defined in Beijing time. */
    const TIME_ZONE = 'Asia/Shanghai'
    const MINUTE = 60_000
    const DAY_MINUTES = 24 * 60

    /** Peak windows as Beijing wall-clock minutes: 09:00-12:00 and 14:00-18:00. */
    const PEAK_WINDOWS = [
      [9 * 60, 12 * 60],
      [14 * 60, 18 * 60],
    ]

    /**
     * Chinese statutory holiday ranges, inclusive, from the State Council
     * notices (国办发明电〔2025〕7号 for 2026, 国办发明电〔2026〕10号 for 2027).
     * Days inside a range are billed off-peak all day; make-up working weekends
     * need no entry because Saturday and Sunday are already off-peak.
     *
     * A year without entries falls back to the plain weekday rule, so the badge
     * stays correct for weekends and ordinary weekdays and simply misses the
     * holidays of an unpublished year. Append the next notice when it appears.
     */
    const HOLIDAY_RANGES = [
      // 2026
      ['2026-01-01', '2026-01-03'],
      ['2026-02-15', '2026-02-23'],
      ['2026-04-04', '2026-04-06'],
      ['2026-05-01', '2026-05-05'],
      ['2026-06-19', '2026-06-21'],
      ['2026-09-25', '2026-09-27'],
      ['2026-10-01', '2026-10-07'],
      // 2027
      ['2027-01-01', '2027-01-03'],
      ['2027-02-05', '2027-02-13'],
      ['2027-04-03', '2027-04-05'],
      ['2027-05-01', '2027-05-05'],
      ['2027-06-09', '2027-06-09'],
      ['2027-09-15', '2027-09-15'],
      ['2027-10-01', '2027-10-07'],
    ]

    /** Prices in yuan per million tokens, from the official pricing page. */
    const PRICES = {
      flash: { peak: [0.04, 2, 8], idle: [0.02, 1, 4] },
      pro: { peak: [0.3, 9, 27], idle: [0.15, 4.5, 13.5] },
    }

    /** Table rows, in display order, indexing the price arrays above. */
    const PRICE_ROWS = [
      { key: 'table.cacheHit', index: 0 },
      { key: 'table.cacheMiss', index: 1 },
      { key: 'table.output', index: 2 },
    ]

    /** Beijing wall-clock part formatter, built once and reused. */
    const PARTS = new Intl.DateTimeFormat('en-US', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })

    /**
     * Expand inclusive date-only ranges into a set of `YYYY-MM-DD` keys.
     * @param ranges - inclusive `[start, end]` ISO date pairs.
     * @returns every covered calendar day.
     */
    function expandRanges(ranges) {
      const days = new Set()
      for (const [start, end] of ranges) {
        const stop = Date.parse(`${end}T00:00:00Z`)
        for (let cursor = Date.parse(`${start}T00:00:00Z`); cursor <= stop; cursor += 86_400_000) {
          days.add(new Date(cursor).toISOString().slice(0, 10))
        }
      }
      return days
    }

    /** Every off-peak calendar day covered by the notices above. */
    const HOLIDAYS = expandRanges(HOLIDAY_RANGES)

    /**
     * Read the Beijing wall clock at one instant.
     * @param epochMs - instant in epoch milliseconds.
     * @returns its Beijing year, month, day, hour, and minute.
     */
    function beijingParts(epochMs) {
      const parts = {}
      for (const part of PARTS.formatToParts(epochMs)) {
        if (part.type !== 'literal') parts[part.type] = Number(part.value)
      }
      return {
        year: parts.year,
        month: parts.month,
        day: parts.day,
        hour: parts.hour,
        minute: parts.minute,
      }
    }

    /**
     * The `YYYY-MM-DD` key of a Beijing calendar date.
     * @param parts - Beijing wall-clock parts.
     * @returns the date key used by the holiday set.
     */
    function dateKey(parts) {
      return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
    }

    /**
     * Resolve a Beijing wall-clock minute to its epoch instant.
     *
     * The first guess treats the wall clock as UTC, then the measured offset
     * between that instant's Beijing reading and the wall clock corrects it, so
     * the result stays right for any zone rule the formatter applies.
     * @param key - `YYYY-MM-DD` Beijing date.
     * @param minuteOfDay - minutes after local midnight; 1440 is the next midnight.
     * @returns the instant in epoch milliseconds.
     */
    function epochAt(key, minuteOfDay) {
      const [year, month, day] = key.split('-').map(Number)
      const guess = Date.UTC(year, month - 1, day) + minuteOfDay * MINUTE
      const parts = beijingParts(guess)
      const wall = Date.UTC(parts.year, parts.month - 1, parts.day) + (parts.hour * 60 + parts.minute) * MINUTE
      return guess - (wall - guess)
    }

    /**
     * Format a minute of the day as `HH:MM`, where 1440 reads as `24:00`.
     * @param minuteOfDay - minutes after local midnight.
     * @returns the clock reading.
     */
    function formatMinute(minuteOfDay) {
      return `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`
    }

    /**
     * Describe the window running at one instant.
     * @param epochMs - instant in epoch milliseconds.
     * @returns the peak flag, the window's first and last minute, the range text,
     * and the instant the reading next changes.
     */
    function describe(epochMs) {
      const parts = beijingParts(epochMs)
      const key = dateKey(parts)
      const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()
      const workday = weekday >= 1 && weekday <= 5 && !HOLIDAYS.has(key)
      const minute = parts.hour * 60 + parts.minute

      /**
       * Assemble one window reading.
       * @param peak - whether the window bills at the peak rate.
       * @param from - first minute of the window.
       * @param to - end minute of the window (exclusive, 1440 for midnight).
       * @returns the window reading.
       */
      const windowOf = (peak, from, to) => ({
        peak,
        from,
        to,
        range: `${formatMinute(from)} - ${formatMinute(to)}`,
        nextAt: epochAt(key, to),
      })

      // A weekend or a statutory holiday bills off-peak from 00:00 to 24:00.
      if (!workday) return windowOf(false, 0, DAY_MINUTES)

      for (const [from, to] of PEAK_WINDOWS) {
        if (minute >= from && minute < to) return windowOf(true, from, to)
      }
      if (minute < PEAK_WINDOWS[0][0]) return windowOf(false, 0, PEAK_WINDOWS[0][0])
      if (minute < PEAK_WINDOWS[1][0]) return windowOf(false, PEAK_WINDOWS[0][1], PEAK_WINDOWS[1][0])
      return windowOf(false, PEAK_WINDOWS[1][1], DAY_MINUTES)
    }

    /* #endregion schedule */

    /** Locale dictionary routes every visible string through the Client locale service. */
    const ZH = {
      'label.peak': '峰时 {range}',
      'label.idle': '闲时 {range}',
      'trigger.aria': '{label}，点击查看此时段价格',
      'dialog.title': 'DeepSeek API 价格',
      'dialog.note': '空闲时段单价为高峰时段的一半，价格以 DeepSeek 官方定价页为准。',
      'table.cacheHit': '百万 tok 输入（缓存命中）',
      'table.cacheMiss': '百万 tok 输入（缓存未命中）',
      'table.output': '百万 tok 输出',
      'table.flash': 'FLASH（元）',
      'table.pro': 'PRO（元）',
    }

    const EN = {
      'label.peak': 'Peak {range}',
      'label.idle': 'Off-peak {range}',
      'trigger.aria': '{label}, click for this window’s prices',
      'dialog.title': 'DeepSeek API pricing',
      'dialog.note': 'Off-peak rates are half the peak rates; prices follow the official pricing page.',
      'table.cacheHit': 'Input, 1M tokens (cache hit)',
      'table.cacheMiss': 'Input, 1M tokens (cache miss)',
      'table.output': 'Output, 1M tokens',
      'table.flash': 'FLASH (CNY)',
      'table.pro': 'PRO (CNY)',
    }

    const STYLES = `
.dph-root{display:inline-flex;flex:none;order:1;max-width:100%;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));font-variant-numeric:tabular-nums}
.dph-trigger{display:inline-flex;align-items:center;gap:6px;flex:none;max-width:100%;padding:1px 8px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);font-family:inherit;font-size:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;cursor:pointer}
.dph-trigger[aria-expanded='true']{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
@media (hover:hover){.dph-trigger:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}
.dph-dot{width:6px;height:6px;flex:none;border-radius:999px}
.dph-dot[data-mode='peak']{background:var(--dsw-alias-state-warn-primary)}
.dph-dot[data-mode='idle']{background:var(--dsw-alias-state-success-primary)}
.dph-root[data-surface='hero'] .dph-trigger{height:28px;padding:0 8px;color:var(--dsw-alias-label-secondary);font-weight:500}
.dph-label{min-width:0;overflow:hidden;text-overflow:ellipsis}
.dph-panel{position:fixed;z-index:1100;box-sizing:border-box;left:0;top:0;visibility:hidden;width:max-content;min-width:min(300px,calc(100vw - 24px));max-width:min(432px,calc(100vw - 24px));max-height:calc(100dvh - 24px);padding:16px;border:0;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);cursor:default;overflow-x:hidden;overflow-y:auto;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.dph-title{display:flex;justify-content:space-between;gap:16px;margin-bottom:8px;color:var(--dsw-alias-label-primary);font-weight:500}
.dph-title-label{display:inline-flex;align-items:center;gap:6px;min-width:0}
.dph-title-label svg{width:14px;height:14px;flex:none}
.dph-title-value{font-variant-numeric:tabular-nums;white-space:nowrap}
.dph-rule{margin-bottom:10px;border-top:0.5px solid var(--dsw-alias-border-l2)}
.dph-table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.dph-table thead th{padding:0 0 6px;border-bottom:0.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-weight:400;white-space:nowrap}
.dph-table thead th+th{padding-left:16px;text-align:right}
.dph-table tbody th{padding:4px 16px 0 0;color:var(--dsw-alias-label-tertiary);font-weight:400;text-align:left;white-space:nowrap}
.dph-table tbody td{padding:4px 0 0 16px;color:var(--dsw-alias-label-secondary);text-align:right;white-space:nowrap}
.dph-note{margin:10px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
`

    /**
     * A clock glyph seated left of the dialog heading, matching the size the
     * built-in statistic dialogs use.
     * @returns the glyph element.
     */
    function clockGlyph() {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 14,
          height: 14,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          'aria-hidden': true,
        },
        h('circle', { cx: 8, cy: 8, r: 6 }),
        h('path', { d: 'M8 4.7V8l2.2 1.5' }),
      )
    }

    /**
     * The badge: a compact reading that opens the current window's price table.
     *
     * `surface` selects the host row it sits in. The composer statistics row
     * reads at 22px (the height of the built-in context meter and stat pills),
     * while the New Session options row uses the compact 28px chip geometry of
     * the workspace, preset, and worktree controls; the two must not share one
     * height or one of them breaks the row it belongs to.
     * @param props - slot props, plus the surface this registration renders in.
     * @returns the badge and, while open, its portaled dialog.
     */
    function PeakHoursBadge(props) {
      const t = props.t
      const surface = props.surface === 'hero' ? 'hero' : 'dock'
      const [now, setNow] = React.useState(() => Date.now())
      const [open, setOpen] = React.useState(false)
      const rootRef = React.useRef(null)
      const buttonRef = React.useRef(null)
      const panelRef = React.useRef(null)
      const anchorId = React.useId().replace(/[^A-Za-z0-9_-]/g, '')

      const reading = React.useMemo(() => describe(now), [now])

      // One timer at the next boundary: the reading changes at most five times
      // a day, so nothing polls. A late timer (sleep, throttling) recomputes
      // from the current clock when it fires.
      React.useEffect(() => {
        const delay = Math.min(Math.max(reading.nextAt - Date.now() + 120, 200), DAY_MINUTES * MINUTE)
        const timer = window.setTimeout(() => { setNow(Date.now()) }, delay)
        return () => { window.clearTimeout(timer) }
      }, [now, reading.nextAt])

      // Background tabs throttle timers; resync when the page comes back.
      React.useEffect(() => {
        const sync = () => {
          if (document.visibilityState === 'visible') setNow(Date.now())
        }
        document.addEventListener('visibilitychange', sync)
        window.addEventListener('focus', sync)
        return () => {
          document.removeEventListener('visibilitychange', sync)
          window.removeEventListener('focus', sync)
        }
      }, [])

      React.useEffect(() => {
        if (!open) return undefined
        const onPointerDown = (event) => {
          if (rootRef.current?.contains(event.target) || panelRef.current?.contains(event.target)) return
          setOpen(false)
        }
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          setOpen(false)
          buttonRef.current?.focus()
        }
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown)
        }
      }, [open])

      // Place the panel above the trigger, inside the window's 12px inset; a
      // trigger too close to the top flips the panel below it.
      React.useLayoutEffect(() => {
        if (!open) return undefined
        const place = () => {
          const panel = panelRef.current
          const trigger = buttonRef.current
          if (panel === null || trigger === null) return
          const rect = trigger.getBoundingClientRect()
          const margin = 12
          const width = panel.offsetWidth
          const height = panel.offsetHeight
          const left = Math.min(Math.max(rect.left, margin), Math.max(margin, window.innerWidth - width - margin))
          let top = rect.top - height - 8
          if (top < margin) top = Math.min(rect.bottom + 8, window.innerHeight - height - margin)
          panel.style.left = `${Math.round(left)}px`
          panel.style.top = `${Math.max(margin, Math.round(top))}px`
          panel.style.visibility = 'visible'
        }
        place()
        window.addEventListener('resize', place)
        return () => { window.removeEventListener('resize', place) }
      }, [open])

      const label = t(reading.peak ? 'label.peak' : 'label.idle', { range: reading.range })
      const mode = reading.peak ? 'peak' : 'idle'
      const priceOf = (model, index) => PRICES[model][mode][index].toFixed(2)

      const panel = h(
        'div',
        {
          ref: panelRef,
          className: 'dph-panel',
          role: 'dialog',
          'aria-label': t('dialog.title'),
          'data-peak-hours-dialog': '',
        },
        h(
          'div',
          { className: 'dph-title' },
          h('span', { className: 'dph-title-label' }, clockGlyph(), t('dialog.title')),
          h('span', { className: 'dph-title-value' }, label),
        ),
        h('div', { className: 'dph-rule', 'aria-hidden': true }),
        h(
          'table',
          { className: 'dph-table' },
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              h('th', { scope: 'col' }),
              h('th', { scope: 'col' }, t('table.flash')),
              h('th', { scope: 'col' }, t('table.pro')),
            ),
          ),
          h(
            'tbody',
            null,
            PRICE_ROWS.map(row => h(
              'tr',
              { key: row.key },
              h('th', { scope: 'row' }, t(row.key)),
              h('td', null, priceOf('flash', row.index)),
              h('td', null, priceOf('pro', row.index)),
            )),
          ),
        ),
        h('p', { className: 'dph-note' }, t('dialog.note')),
      )

      return h(
        React.Fragment,
        null,
        h('style', { 'data-plugin-css': ENTRY_ID }, STYLES),
        h(
          'span',
          {
            ref: rootRef,
            className: 'dph-root',
            'data-peak-hours': anchorId,
            'data-mode': mode,
            'data-surface': surface,
          },
          h(
            'button',
            {
              ref: buttonRef,
              type: 'button',
              className: 'dph-trigger',
              'aria-haspopup': 'dialog',
              'aria-expanded': open,
              'aria-label': t('trigger.aria', { label }),
              onClick: () => { setOpen(value => !value) },
            },
            h('span', { className: 'dph-dot', 'data-mode': mode, 'aria-hidden': true }),
            h('span', { className: 'dph-label' }, label),
          ),
          open ? createPortal(panel, document.body) : null,
        ),
      )
    }

    /**
     * Wrap the badge for one host row.
     * @param surface - `dock` for the composer statistics row, `hero` for the New Session row.
     * @returns a slot component bound to that row's geometry.
     */
    function badgeFor(surface) {
      function SurfaceBadge(props) {
        return h(PeakHoursBadge, { ...props, surface })
      }
      SurfaceBadge.displayName = `PeakHoursBadge(${surface})`
      return SurfaceBadge
    }

    // Stable identities: a slot owner that re-declares (an input bar remount)
    // must not hand React a new component type and remount the open dialog.
    const DOCK_BADGE = badgeFor('dock')
    const HERO_BADGE = badgeFor('hero')

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(
          () => ctx.locale.register(NS, { zh: ZH, en: EN }),
          'deepseek-peak-hours: dictionaries',
        )
        const register = (name, options, Component) => {
          ctx.slots.inject(name, () => ctx.slots.register({ name, locale: NS, ...options }, Component))
        }
        // The dock entry renders before the built-in context meter in DOM order;
        // `.dph-root{order:1}` moves it after the meter inside the same flex row.
        register(DOCK_SLOT, { id: ENTRY_ID, order: 10 }, DOCK_BADGE)
        register(HERO_SLOT, { id: ENTRY_ID, order: 10 }, HERO_BADGE)
      },
    }
  },
})
