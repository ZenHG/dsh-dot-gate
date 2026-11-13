// SPDX-License-Identifier: MIT
import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, name } from './index.js'

function harness(config) {
  const handlers = new Map()
  let provider = null
  // The plugin declares inject = ['skills'], so a harness without the service would
  // exercise a code path the host never takes.
  const ctx = {
    on: (ev, fn) => { handlers.set(ev, fn) },
    skills: {
      registerProvider: (create) => {
        provider = create({ signal: undefined, invalidate() {} })
        return () => {}
      },
    },
  }
  apply(ctx, config)
  const getProvider = () => provider
  const emit = (session, event) => handlers.get('session/event')(session, event)
  const step = async (session) => {
    const decision = { kind: 'enter', messages: [] }
    return handlers.get('agent/pre-step')({ agent: { session } }, async () => decision)
  }
  return { emit, step, handlers, getProvider }
}

const call = (tool, args) => ({ type: 'tool/call', data: { name: tool, arguments: args } })
const turnStart = { type: 'turn/start' }
const wikiWrite = (body) => call('write', { file_path: 'Wiki/Judge.md', content: body })

test('exposes the plugin name', () => assert.equal(name, 'dot-gate'))

test('flags a negative claim written into a watched path', async () => {
  const h = harness()
  const s = { id: 's1' }
  h.emit(s, turnStart)
  h.emit(s, wikiWrite('这个模型不区分变焦与前推。'))
  const d = await h.step(s)
  assert.equal(d.messages.length, 1)
  assert.match(d.messages[0].content[0].text, /不区分/)
  assert.equal(d.messages[0].source.kind, 'plugin:dot-gate')
})

test('ignores writes outside the watched paths', async () => {
  const h = harness()
  const s = { id: 's2' }
  h.emit(s, turnStart)
  h.emit(s, call('write', { file_path: 'tmp/notes.md', content: '这个模型不区分 A 与 B。' }))
  assert.equal((await h.step(s)).messages.length, 0)
})

test('ignores neutral text', async () => {
  const h = harness()
  const s = { id: 's3' }
  h.emit(s, turnStart)
  h.emit(s, wikiWrite('zC 跑了 124 帧，脸宽 0.43 倍。'))
  assert.equal((await h.step(s)).messages.length, 0)
})

test('respects maxPerTurn', async () => {
  const h = harness({ maxPerTurn: 1 })
  const s = { id: 's4' }
  h.emit(s, turnStart)
  h.emit(s, wikiWrite('做不到。'))
  assert.equal((await h.step(s)).messages.length, 1)
  h.emit(s, wikiWrite('还是做不到。'))
  assert.equal((await h.step(s)).messages.length, 0)
})

test('resets on turn/start', async () => {
  const h = harness({ maxPerTurn: 1 })
  const s = { id: 's5' }
  h.emit(s, turnStart)
  h.emit(s, wikiWrite('做不到。'))
  assert.equal((await h.step(s)).messages.length, 1)
  h.emit(s, turnStart)
  h.emit(s, wikiWrite('做不到。'))
  assert.equal((await h.step(s)).messages.length, 1)
})

test('survives events with no data', async () => {
  const h = harness()
  const s = { id: 's6' }
  h.emit(s, { type: 'tool/call' })
  h.emit(s, { type: 'tool/call', data: {} })
  assert.equal((await h.step(s)).messages.length, 0)
})

test('accepts edit tool via new_string', async () => {
  const h = harness()
  const s = { id: 's7' }
  h.emit(s, turnStart)
  h.emit(s, call('edit', { file_path: 'Wiki/A.md', old_string: 'x', new_string: '这个写法不可得。' }))
  assert.equal((await h.step(s)).messages.length, 1)
})

test('registers a skill provider named dot-gate', () => {
  const h = harness()
  const provider = h.getProvider()
  assert.ok(provider !== null)
  assert.equal(provider.name, 'dot-gate')
})

test('the provider lists the dot skill', async () => {
  const h = harness()
  const { candidates, complete } = await h.getProvider().list({})
  assert.equal(complete, true)
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].name, 'dot')
  assert.equal(candidates[0].provider, 'dot-gate')
  assert.ok(candidates[0].description.length > 20)
  assert.equal(candidates[0].invocation.modelInvocable, true)
})

test('the provider returns the skill body', async () => {
  const h = harness()
  const { candidates } = await h.getProvider().list({})
  const definition = await h.getProvider().get(candidates[0], {})
  assert.equal(definition.name, 'dot')
  assert.ok(definition.content.includes('When to run it'))
  assert.ok(!definition.content.startsWith('---'))
})

test('rejects a scalar where a list belongs', () => {
  assert.throws(() => harness({ words: '做不到' }), /config\.words must be/)
})

test('rejects a negative maxPerTurn', () => {
  assert.throws(() => harness({ maxPerTurn: -1 }), /config\.maxPerTurn must be/)
})
