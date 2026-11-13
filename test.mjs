// SPDX-License-Identifier: MIT
import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, name } from './index.js'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

const preExecute = (h) => h.handlers.get('tools/pre-execute')

test('hardMode is off by default and registers no guard', () => {
  const h = harness()
  assert.equal(preExecute(h), undefined)
})

test('hardMode denies a matching write with a model-facing reason', async () => {
  const h = harness({ hardMode: true })
  const decision = await preExecute(h)({ name: 'write', arguments: { file_path: 'Wiki/X.md', content: '这个模型做不到。' } }, async () => ({ kind: 'allow' }))
  assert.equal(decision.kind, 'deny')
  assert.match(decision.reason, /做不到/)
})

test('hardMode lets a neutral write through', async () => {
  const h = harness({ hardMode: true })
  const decision = await preExecute(h)({ name: 'write', arguments: { file_path: 'Wiki/X.md', content: '跑了 124 帧。' } }, async () => ({ kind: 'allow' }))
  assert.equal(decision.kind, 'allow')
})

test('hardMode ignores tools outside the configured set', async () => {
  const h = harness({ hardMode: true })
  const decision = await preExecute(h)({ name: 'read', arguments: { file_path: 'Wiki/X.md' } }, async () => ({ kind: 'allow' }))
  assert.equal(decision.kind, 'allow')
})

test('ignores a trigger word inside a code span', async () => {
  const h = harness()
  const s = { id: 'q1' }
  h.emit(s, turnStart)
  h.emit(s, wikiWrite('我们查的是 `做不到` 这类断言。'))
  assert.equal((await h.step(s)).messages.length, 0)
})

test('ignores a trigger word inside corner quotes', async () => {
  const h = harness()
  const s = { id: 'q2' }
  h.emit(s, turnStart)
  h.emit(s, wikiWrite('文中有「做不到」三个字，是在描述机制。'))
  assert.equal((await h.step(s)).messages.length, 0)
})

test('still fires when the same word appears outside the quotes', async () => {
  const h = harness()
  const s = { id: 'q3' }
  h.emit(s, turnStart)
  h.emit(s, wikiWrite('提到「做不到」之后，正文又直接断言：这个模型做不到。'))
  assert.equal((await h.step(s)).messages.length, 1)
})

test('writes one audit line per hit when auditPath is set', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dotgate-audit-'))
  const file = join(dir, 'a.jsonl')
  const h = harness({ auditPath: file })
  const s = { id: 'a1' }
  h.emit(s, turnStart)
  h.emit(s, wikiWrite('这个模型做不到。'))
  await h.step(s)
  const lines = readFileSync(file, 'utf8').trim().split('\n')
  assert.equal(lines.length, 1)
  const entry = JSON.parse(lines[0])
  assert.equal(entry.event, 'remind')
  assert.equal(entry.mode, 'soft')
  rmSync(dir, { recursive: true, force: true })
})

test('writes no audit file when auditPath is empty', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dotgate-noaudit-'))
  const file = join(dir, 'a.jsonl')
  const h = harness({ auditPath: '' })
  const s = { id: 'a2' }
  h.emit(s, turnStart)
  h.emit(s, wikiWrite('这个模型做不到。'))
  await h.step(s)
  assert.equal(existsSync(file), false)
  rmSync(dir, { recursive: true, force: true })
})

test('steerAtTurnEnd is off by default', () => {
  const h = harness()
  assert.equal(h.handlers.get('agent/turn-stopping'), undefined)
})

test('steers once at the close boundary when a hit was never addressed', async () => {
  const h = harness({ steerAtTurnEnd: true })
  const steers = []
  const s = { id: 't1' }
  h.emit(s, turnStart)
  h.emit(s, wikiWrite('这个模型做不到。'))
  const agent = { session: s, steer: (m) => steers.push(m) }
  h.handlers.get('agent/turn-stopping')({ agent, turn: 1 })
  h.handlers.get('agent/turn-stopping')({ agent, turn: 1 })
  assert.equal(steers.length, 1)
  assert.match(steers[0].content[0].text, /做不到|结论闸/)
  assert.equal(steers[0].source.kind, 'plugin:dot-gate')
})

test('does not steer when nothing was hit', () => {
  const h = harness({ steerAtTurnEnd: true })
  const steers = []
  const s = { id: 't2' }
  h.emit(s, turnStart)
  h.handlers.get('agent/turn-stopping')({ agent: { session: s, steer: (m) => steers.push(m) }, turn: 1 })
  assert.equal(steers.length, 0)
})

test('reads its words from the pack, not from a hard-coded copy', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'dotgate-pack-'))
  const base = JSON.parse(readFileSync(join(process.cwd(), 'packs', 'evidence-for-capability-claims.json'), 'utf8'))
  base.words = ['banana']
  const packPath = join(scratch, 'p.json')
  writeFileSync(packPath, JSON.stringify(base), 'utf8')

  const h = harness({ packPath })
  const s = { id: 'p1' }
  h.emit(s, turnStart)
  h.emit(s, wikiWrite('这个模型做不到。'))
  assert.equal((await h.step(s)).messages.length, 0, 'the built-in word must no longer fire')

  h.emit(s, wikiWrite('the banana is unripe.'))
  assert.equal((await h.step(s)).messages.length, 1, 'the pack word must fire')

  rmSync(scratch, { recursive: true, force: true })
})

test('a broken pack falls back instead of taking the gate down', async () => {
  const h = harness({ packPath: 'definitely/not/here.json' })
  const s = { id: 'p2' }
  h.emit(s, turnStart)
  h.emit(s, wikiWrite('这个模型做不到。'))
  assert.equal((await h.step(s)).messages.length, 1, 'built-in defaults still work')
})
