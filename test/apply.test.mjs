/**
 * Wiring test for the Client module.
 *
 * The bundle is a browser script with no build step, so this test installs a
 * fake module loader, runs the factory, and drives `apply` with a recording
 * context. It checks the two slot registrations, the locale namespace, and that
 * every literal `t('…')` key in the component exists in both dictionaries.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

/** Minimal React surface touched before the first render. */
const react = {
  createElement() { throw new Error('render is not part of this wiring test') },
  Fragment: Symbol('Fragment'),
}

/** The bundle's React import and portal helper. */
const requireStub = (spec) => {
  if (spec === 'react') return react
  if (spec === 'react-dom') return { createPortal: () => null }
  throw new Error(`unexpected require("${spec}")`)
}

/** Capture the loader registration. */
let registration
const fakeWindow = {
  __ModuleLoader__: { load: value => { registration = value } },
  setTimeout: () => 0,
  clearTimeout: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
}

// eslint-disable-next-line no-new-func -- the bundle is a classic script
new Function('window', source)(fakeWindow)

test('the factory registers under the package name', () => {
  assert.equal(registration.id, 'dsh-plugin-deepseek-peak-hours')
})

test('apply registers both slots and the dictionaries', () => {
  const module = registration.factory(requireStub)
  assert.deepEqual(module.inject, ['slots', 'locale'])

  const seen = { effects: [], injections: [], registrations: [], locales: [] }
  const ctx = {
    effect(effect, label) {
      seen.effects.push(label)
      const dispose = effect()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    slots: {
      inject(name, callback) {
        seen.injections.push(name)
        return callback()
      },
      register(options, Component) {
        seen.registrations.push({ options, Component })
        return () => {}
      },
    },
    locale: {
      register(namespace, dictionaries) {
        seen.locales.push({ namespace, dictionaries })
        return () => {}
      },
    },
  }

  module.apply(ctx)

  assert.deepEqual(seen.injections, ['conversation.composer.dock', 'conversation.hero.options'])
  assert.deepEqual(seen.registrations.map(entry => entry.options), [
    { name: 'conversation.composer.dock', locale: 'deepseekPeakHours', id: 'deepseek-peak-hours', order: 10 },
    { name: 'conversation.hero.options', locale: 'deepseekPeakHours', id: 'deepseek-peak-hours', order: 10 },
  ])
  assert.equal(typeof seen.registrations[0].Component, 'function')
  // One wrapper per surface: the dock reading is 22px, the New Session chip 28px.
  assert.notEqual(seen.registrations[0].Component, seen.registrations[1].Component)
  assert.deepEqual(seen.effects, ['deepseek-peak-hours: dictionaries'])
  assert.equal(seen.locales.length, 1)
  assert.equal(seen.locales[0].namespace, 'deepseekPeakHours')
})

test('both dictionaries cover the same keys, and every literal key exists', () => {
  const module = registration.factory(requireStub)
  let dictionaries
  module.apply({
    effect: effect => effect(),
    slots: { inject: (_name, callback) => callback(), register: () => () => {} },
    locale: {
      register: (_namespace, value) => {
        dictionaries = value
        return () => {}
      },
    },
  })

  assert.deepEqual(Object.keys(dictionaries).sort(), ['en', 'zh'])
  const zh = Object.keys(dictionaries.zh).sort()
  const en = Object.keys(dictionaries.en).sort()
  assert.deepEqual(zh, en)
  assert.ok(zh.length >= 10)

  const used = new Set([...source.matchAll(/\bt\('([A-Za-z][\w.]*)'/g)].map(match => match[1]))
  for (const key of used) assert.ok(zh.includes(key), `missing dictionary key "${key}"`)
  // Keys used through a ternary are not direct t() arguments; every dictionary
  // key must still appear in the module as a quoted literal.
  for (const key of zh) assert.ok(source.includes(`'${key}'`), `unused dictionary key "${key}"`)

  // The peak/idle labels must carry the range the badge formats.
  assert.match(dictionaries.zh['label.peak'], /\{range\}/)
  assert.match(dictionaries.zh['label.idle'], /\{range\}/)
  assert.match(dictionaries.zh['label.peak'], /^峰时 /)
  assert.match(dictionaries.zh['label.idle'], /^闲时 /)
})

test('the hero chip is 28px while the dock reading stays 22px', () => {
  // The New Session row's native controls (workspace chip, preset seat, worktree
  // toggle) are 28px chips; the composer statistics row reads at 22px.
  assert.match(source, /\.dph-root\[data-surface='hero'\] \.dph-trigger\{height:28px;padding:0 8px/)
  assert.match(source, /\.dph-trigger\{[^}]*padding:1px 8px/)
})
