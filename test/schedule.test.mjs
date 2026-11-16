/**
 * Unit tests for the schedule fold inside `client.js`.
 *
 * The Client module is a plain browser bundle with no build step, so the pure
 * schedule block is delimited by `#region schedule` markers and evaluated here
 * on its own. The block must stay free of React, `window`, and `document`.
 *
 * Every expectation is written in Beijing time; the suite also runs under a
 * foreign `TZ` (`npm run test:tz`) to prove the badge ignores the machine zone.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const start = source.indexOf('/* #region schedule */')
const end = source.indexOf('/* #endregion schedule */')

assert.ok(start >= 0 && end > start, 'client.js keeps its #region schedule markers')

const schedule = new Function(`${source.slice(start, end)}
return { describe, epochAt, formatMinute, beijingParts, HOLIDAYS, PEAK_WINDOWS }`)()

const { describe, epochAt, formatMinute, beijingParts, HOLIDAYS } = schedule

/**
 * Resolve a Beijing wall clock to an instant.
 * @param {string} key - `YYYY-MM-DD`.
 * @param {string} clock - `HH:MM`.
 * @returns {number} epoch milliseconds.
 */
function beijing(key, clock) {
  const [hour, minute] = clock.split(':').map(Number)
  return epochAt(key, hour * 60 + minute)
}

test('peak windows read 09:00 - 12:00 and 14:00 - 18:00', () => {
  const morning = describe(beijing('2026-11-16', '09:30'))
  assert.equal(morning.peak, true)
  assert.equal(morning.range, '09:00 - 12:00')
  assert.equal(morning.nextAt, beijing('2026-11-16', '12:00'))

  const afternoon = describe(beijing('2026-11-16', '15:00'))
  assert.equal(afternoon.peak, true)
  assert.equal(afternoon.range, '14:00 - 18:00')
  assert.equal(afternoon.nextAt, beijing('2026-11-16', '18:00'))
})

test('off-peak blocks split at the peak windows and at midnight', () => {
  assert.deepEqual(
    ['00:00', '08:59', '12:00', '13:59', '18:00', '23:59'].map(clock => describe(beijing('2026-11-16', clock)).range),
    ['00:00 - 09:00', '00:00 - 09:00', '12:00 - 14:00', '12:00 - 14:00', '18:00 - 24:00', '18:00 - 24:00'],
  )
  assert.equal(describe(beijing('2026-11-16', '23:59')).nextAt, epochAt('2026-11-16', 1440))
  assert.equal(formatMinute(1440), '24:00')
})

test('weekends bill off-peak all day', () => {
  for (const day of ['2026-11-21', '2026-11-22']) {
    const reading = describe(beijing(day, '10:00'))
    assert.equal(reading.peak, false)
    assert.equal(reading.range, '00:00 - 24:00')
  }
})

test('statutory holidays bill off-peak all day, including a 2027 notice', () => {
  const cases = [
    ['2026-10-01', '2026-10-08'], // National Day, then the first ordinary Thursday
    ['2027-02-08', '2027-02-15'], // Spring Festival, then the first ordinary Monday
  ]
  for (const [holiday, workday] of cases) {
    assert.equal(describe(beijing(holiday, '10:00')).range, '00:00 - 24:00', holiday)
    assert.equal(describe(beijing(workday, '10:00')).range, '09:00 - 12:00', workday)
  }
  assert.ok(HOLIDAYS.has('2026-01-01'))
  assert.ok(HOLIDAYS.has('2027-10-07'))
  assert.ok(!HOLIDAYS.has('2026-10-08'))
})

test('the next reading is the following boundary, never the current instant', () => {
  for (const instant of [
    beijing('2026-11-16', '09:00'),
    beijing('2026-11-16', '11:59'),
    beijing('2026-11-16', '18:00'),
    beijing('2026-11-16', '23:59'),
    beijing('2026-11-21', '12:00'),
    beijing('2027-01-01', '00:00'),
  ]) {
    const reading = describe(instant)
    assert.ok(reading.nextAt > instant, `nextAt after ${new Date(instant).toISOString()}`)
    assert.ok(reading.nextAt - instant <= 24 * 60 * 60_000, 'the next boundary stays inside one day')
  }
})

test('a holiday midnight hands back to the next day rule', () => {
  const newYear = beijing('2027-01-01', '00:00')
  assert.equal(describe(newYear - 60_000).range, '18:00 - 24:00')
  assert.equal(describe(newYear).range, '00:00 - 24:00')
  assert.equal(describe(epochAt('2027-01-04', 0)).range, '00:00 - 09:00')
})

test('the schedule is read from Beijing time, not the machine zone', () => {
  // 2026-11-16T01:30:00Z is 09:30 in Beijing; the local zone must not matter.
  const reading = describe(Date.parse('2026-11-16T01:30:00Z'))
  assert.equal(reading.range, '09:00 - 12:00')
  assert.equal(reading.nextAt, Date.parse('2026-11-16T04:00:00Z'))
  assert.deepEqual(beijingParts(Date.parse('2026-11-16T16:30:00Z')), {
    year: 2026, month: 11, day: 17, hour: 0, minute: 30,
  })
})
