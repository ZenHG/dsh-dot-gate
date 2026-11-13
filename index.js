// SPDX-License-Identifier: MIT
/**
 * dsh-dot-gate - make an agent check its own verdict gate before it writes a
 * negative capability conclusion.
 *
 * Why this exists: a reminder driven by a tool-call counter fires when the agent
 * is *busy*. The failure this targets is different - the agent is *fast to
 * conclude*: it reads one source, declares a capability impossible, and writes
 * that into a knowledge base. Tool-call counts do not correlate with that, so the
 * trigger here is the action itself: a write or edit that lands a negative claim
 * inside a configured path.
 *
 * One fact decides everything: a turn has produced an uninspected negative claim
 * and has not yet been reminded about it. There is no timer, no polling and no
 * counter - with no matching tool call the plugin costs nothing.
 *
 * The plugin does not judge the claim. It cannot: whether three sources are
 * enough is a policy question, not a code question. It only refuses to let the
 * claim pass silently, and points at whatever gate the project already keeps.
 */

import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPack } from './src/pack.mjs'

// The skill travels with the package; the provider reads it from disk so an edited
// SKILL.md is visible without rebuilding anything.
function skillFile() {
  return join(dirname(fileURLToPath(import.meta.url)), 'skills', 'dot', 'SKILL.md')
}

/** Read the packaged skill, reporting absence as a state rather than an exception. */
function readSkill() {
  let raw
  try {
    raw = readFileSync(skillFile(), 'utf8')
  } catch {
    return { kind: 'missing' }
  }
  const parsed = readFrontmatter(raw)
  return parsed.name === '' ? { kind: 'missing' } : { kind: 'ok', ...parsed }
}

/** Read name/description out of the frontmatter of a file this package owns. */
function readFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (match === null) return { name: '', description: '', content: raw }
  const head = match[1].split(/\r?\n/)
  let name = ''
  let description = ''
  for (let i = 0; i < head.length; i++) {
    const line = head[i]
    const plain = line.match(/^name:\s*(.+)$/)
    if (plain !== null) { name = plain[1].trim(); continue }
    const block = line.match(/^description:\s*[|>]\s*$/)
    if (block !== null) {
      const parts = []
      for (let j = i + 1; j < head.length && /^\s+\S/.test(head[j]); j++) parts.push(head[j].trim())
      description = parts.join(' ')
      i += parts.length
      continue
    }
    const inline = line.match(/^description:\s*(.+)$/)
    if (inline !== null) description = inline[1].trim()
  }
  return { name, description, content: match[2] }
}

export const name = 'dot-gate'

// Declaring the dependency makes the loader wait for the skill registry instead of
// silently skipping the registration when it is not ready yet.
export const inject = ['skills']

const DEFAULTS = {
  // Empty means "the pack that ships with this package". Point it elsewhere to run a
  // different judgement pack without touching code.
  packPath: '',
  // Off by default: a gate that can block someone's write on its first day gets
  // uninstalled. Turn it on once the false-positive rate is known.
  hardMode: false,
  // Off by default: the plugin writes no file unless you ask it to. Point this at a
  // path to get one JSONL line per hit, which is how the false-positive rate gets
  // measured before hardMode is switched on.
  auditPath: '',
  // When a hit was only ever reminded about, the turn can still end as if the claim
  // had been checked. Steering once at the close boundary asks for that check in the
  // one place the turn cannot ignore. Off by default for the same reason hardMode is.
  steerAtTurnEnd: false,
  maxPerTurn: 1,
  paths: ['Wiki/'],
  tools: ['write', 'edit'],
  words: ['做不到', '不区分', '不可得', '没有自由度', 'cannot be done', 'does not work'],
}

const REMINDER = (hit) =>
  '结论闸：刚写入的内容里有判断性措辞「' + hit.word + '」（' + hit.path + '）。'
  + '在把它当成结论之前，先跑项目自己的结论闸并附上证据：来源数量、同模型正例检索、'
  + '用的量是否登记、对照变量是否真的有效、可复跑命令与观测值。'
  + '如果已经跑过，忽略本条。'

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizePath(p) {
  return String(p === undefined || p === null ? '' : p).replace(/\\/g, '/').replace(/\/+/g, '/')
}

/**
 * Validate configuration at load time. A YAML typo such as `words: 做不到` (a scalar
 * where a list belongs) otherwise throws deep inside `apply` and the plugin simply
 * fails to load with nothing useful said about why.
 */
function resolveOptions(config, pack) {
  const given = config === undefined || config === null ? {} : config
  // The pack owns the words and paths; config still wins when someone overrides them.
  const base = { ...DEFAULTS }
  if (pack !== null && pack !== undefined) {
    base.words = pack.words
    base.paths = pack.paths
  }
  const opts = { ...base, ...given }
  const bad = (key, want) => {
    throw new TypeError('dot-gate: config.' + key + ' must be ' + want + ' (got ' + JSON.stringify(given[key]) + ')')
  }
  if (!Array.isArray(opts.words) || opts.words.length === 0) bad('words', 'a non-empty array of strings')
  if (opts.words.some((w) => typeof w !== 'string' || w.length === 0)) bad('words', 'an array of non-empty strings')
  if (!Array.isArray(opts.paths) || opts.paths.some((p) => typeof p !== 'string')) bad('paths', 'an array of strings')
  if (!Array.isArray(opts.tools) || opts.tools.some((t) => typeof t !== 'string')) bad('tools', 'an array of strings')
  if (!Number.isInteger(opts.maxPerTurn) || opts.maxPerTurn < 0) bad('maxPerTurn', 'a non-negative integer')
  if (typeof opts.hardMode !== 'boolean') bad('hardMode', 'a boolean')
  if (typeof opts.auditPath !== 'string') bad('auditPath', 'a string path, or an empty string to disable')
  if (typeof opts.packPath !== 'string') bad('packPath', 'a string path, or an empty string for the shipped pack')
  if (typeof opts.steerAtTurnEnd !== 'boolean') bad('steerAtTurnEnd', 'a boolean')
  return opts
}

/**
 * Whether the match at `index` sits inside a quotation or a code span.
 *
 * A document that *describes* this plugin writes the trigger words inside backticks or
 * quotes; that is a mention, not a claim. Counting backticks backwards distinguishes
 * inside from outside, and the paired quote characters cover 「」 and " ".
 */
function isQuoted(body, index, length) {
  const before = body.slice(0, index)
  const fences = (before.match(/`/g) || []).length
  if (fences % 2 === 1) return true
  const prev = before.slice(-1)
  const next = body.slice(index + length, index + length + 1)
  const openers = '「『“"\''
  const closers = '」』”"\''
  // Empty-string guard: every string includes '', so a match at index 0 would
  // otherwise be classified as quoted and the gate would never fire on it.
  return (prev !== '' && openers.includes(prev)) || (next !== '' && closers.includes(next))
}

function matchCall(args, opts, pattern, prefixes) {
  const path = normalizePath(args.file_path === undefined ? (args.path === undefined ? args.file : args.path) : args.file_path)
  if (path === '') return null
  if (!prefixes.some((pre) => path.includes(pre))) return null
  const body = args.content === undefined ? (args.new_string === undefined ? '' : args.new_string) : args.content
  const text = String(body)
  const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')
  for (const found of text.matchAll(global)) {
    if (found.index === undefined) continue
    if (isQuoted(text, found.index, found[0].length)) continue
    return { word: found[0], path }
  }
  return null
}

function makeAudit(opts) {
  if (opts.auditPath === '') return () => {}
  return (entry) => {
    try {
      appendFileSync(opts.auditPath, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', 'utf8')
    } catch {
      // An audit failure must never take the gate down with it.
    }
  }
}

export function apply(ctx, config) {
  let pack = null
  try {
    pack = loadPack(config === undefined || config === null ? '' : config.packPath).pack
  } catch (error) {
    // A broken or missing pack must not take the gate down: fall back to the built-in
    // words and say so once, rather than loading silently with half the criteria.
    ctx.logger?.warn?.('dot-gate: pack unavailable, falling back to built-in defaults: ' + String(error && error.message ? error.message : error))
  }
  const opts = resolveOptions(config, pack)
  const audit = makeAudit(opts)
  const states = new Map()
  const pattern = new RegExp(opts.words.map(escapeRe).join('|'))
  const prefixes = opts.paths.map(normalizePath)

  const stateOf = (id) => {
    let s = states.get(id)
    if (s === undefined) {
      s = { nudged: 0, steered: 0, hit: null }
      states.set(id, s)
    }
    return s
  }

  ctx.on('session/event', (session, event) => {
    if (session === undefined || session === null || typeof session.id !== 'string') return
    const s = stateOf(session.id)
    const type = event === undefined || event === null ? '' : String(event.type === undefined ? '' : event.type)

    if (type === 'turn/start') {
      s.nudged = 0
      s.steered = 0
      s.hit = null
      return
    }
    if (type !== 'tool/call' && type !== 'tool/ptc-dispatch-start') return

    const d = event.data === undefined || event.data === null ? {} : event.data
    const tool = String(d.name === undefined ? (d.toolName === undefined ? '' : d.toolName) : d.name)
    if (!opts.tools.includes(tool)) return

    const args = d.arguments === undefined || d.arguments === null ? {} : d.arguments
    const hit = matchCall(args, opts, pattern, prefixes)
    if (hit === null) return
    s.hit = { word: hit.word, path: hit.path, tool }
    audit({ event: 'remind', mode: 'soft', tool, path: hit.path, word: hit.word })
  })

  // The reminder above arrives after the file is already on disk. This hook is the
  // only place a write can actually be stopped: returning a denial materializes a
  // model-facing reason and the write does not happen.
  if (opts.hardMode) {
    ctx.on('tools/pre-execute', async (execution, next) => {
      const tool = String(execution === undefined || execution === null ? '' : execution.name)
      if (!opts.tools.includes(tool)) return next()
      const args = execution.arguments === undefined || execution.arguments === null ? {} : execution.arguments
      const hit = matchCall(args, opts, pattern, prefixes)
      if (hit === null) return next()
      audit({ event: 'deny', mode: 'hard', tool, path: hit.path, word: hit.word })
      return {
        kind: 'deny',
        reason: 'dot-gate: 这次写入包含判断性措辞「' + hit.word + '」（' + hit.path + '）。'
          + '先把结论过一遍证据闸（来源数量、同模型正例检索、量名是否登记、对照变量是否有效、可复跑命令与观测值），'
          + '改成带证据的写法再写。若这是引用别人的说法，请标明是引用。',
      }
    })
  }

  // The reminder above fires mid-turn and is easy to walk past. This runs at the close
  // boundary: objecting there steers the agent, and the machine re-reads its inbox and
  // runs another step. One objection per turn, or a model that never satisfies the gate
  // would never end the turn.
  if (opts.steerAtTurnEnd) {
    ctx.on('agent/turn-stopping', (payload) => {
      const session = payload === undefined || payload === null || payload.agent === undefined ? undefined : payload.agent.session
      if (session === undefined || session === null || typeof session.id !== 'string') return
      const s = stateOf(session.id)
      if (s.hit === null || s.steered >= 1) return
      const hit = s.hit
      s.hit = null
      s.steered = 1
      audit({ event: 'steer', mode: 'soft', tool: hit.tool, path: hit.path, word: hit.word })
      payload.agent.steer({
        role: 'user',
        content: [{ type: 'text', text: REMINDER(hit) }],
        source: { kind: 'plugin:dot-gate' },
      })
    })
  }

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision === undefined || decision === null || decision.kind === 'reject') return decision
    const session = payload === undefined || payload === null || payload.agent === undefined ? undefined : payload.agent.session
    if (session === undefined || session === null || typeof session.id !== 'string') return decision

    const s = stateOf(session.id)
    if (s.hit === null) return decision
    if (s.nudged >= opts.maxPerTurn) return decision

    const hit = s.hit
    s.hit = null
    s.nudged += 1
    const message = {
      role: 'user',
      content: [{ type: 'text', text: REMINDER(hit) }],
      source: { kind: 'plugin:dot-gate' },
    }
    return { kind: 'enter', messages: [...decision.messages, message] }
  })

  // Contribute the skill through the registry rather than through a profile path.
  // A profile-level customSkillDirs override targets the first entry with that id,
  // which is a disabled layer - the registration is silently lost. Providers are the
  // seam the bundled skills use, so this is the supported route.
  ctx.skills.registerProvider((control) => ({
    name: 'dot-gate',
    async list() {
      const skill = readSkill()
      // A missing or unreadable SKILL.md is a persistent condition: skip the
      // candidate, tell the registry the catalog is incomplete, and invalidate once
      // instead of throwing on every request.
      if (skill.kind === 'missing') {
        control.invalidate()
        return { candidates: [], complete: false }
      }
      return {
        complete: true,
        candidates: [{
          name: skill.name,
          description: skill.description,
          invocation: { modelInvocable: true, userInvocable: true },
          provider: 'dot-gate',
          source: 'bundled',
          // Same precedence bucket as the bundled providers ship with.
          rank: 600,
          resourceBase: { kind: 'directory', path: dirname(skillFile()).split('\\').join('/') },
          locator: skillFile(),
        }],
      }
    },
    async get(candidate) {
      // Keep resourceBase: it tells the loader where relative files live.
      const { rank: _rank, locator: _locator, ...summary } = candidate
      const skill = readSkill()
      if (skill.kind === 'missing') {
        control.invalidate()
        return undefined
      }
      return { ...summary, content: skill.content }
    },
  }))
}
