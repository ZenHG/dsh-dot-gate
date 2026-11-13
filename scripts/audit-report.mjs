#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * audit-report.mjs - turn the gate's opt-in audit log into one screen of numbers.
 *
 * The gate can append one JSON line per hit (config key: auditPath). The point of
 * this script is that a human decides whether to loosen or tighten the phrase list
 * by reading a number, not by reading the log or the code.
 *
 *   node scripts/audit-report.mjs --path <file> [--since 7d] [--json]
 *   node scripts/audit-report.mjs --selftest
 *
 * The line shape is whatever index.js writes:
 *   { at, event: 'remind'|'deny'|'steer', mode: 'soft'|'hard', tool, path, word }
 * Unknown fields are ignored and unreadable lines are counted, never fatal.
 *
 * Exit codes: 0 reported, 1 bad usage, 2 nothing to read yet.
 */
import { existsSync, readFileSync } from 'node:fs'

const EVENTS = ['remind', 'deny', 'steer']
const TOP = 5

function fail(message) {
  process.stderr.write('audit-report: ' + message + '\n')
  process.exit(1)
}

function parseArgs(argv) {
  const args = { path: process.env.DOT_AUDIT_PATH || '.dot-audit.jsonl', since: '7d', json: false, selftest: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') args.json = true
    else if (a === '--selftest') args.selftest = true
    else if (a === '--path' || a === '--since') {
      const v = argv[++i]
      if (v === undefined || v.startsWith('--')) fail(a + ' needs a value')
      if (a === '--path') args.path = v
      else args.since = v
    } else fail('unknown argument ' + a)
  }
  return args
}

/** '7d' | '24h' | '30m' | an ISO timestamp -> the millisecond cutoff. */
function parseSince(text) {
  const m = /^(\d+)([mhd])$/.exec(text)
  if (m) {
    const n = Number(m[1])
    const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]]
    return { ms: n * unit, label: text }
  }
  const at = Date.parse(text)
  if (Number.isNaN(at)) fail('--since takes 7d / 24h / 30m or an ISO timestamp, got ' + text)
  return { ms: null, absolute: at, label: 'until ' + text }
}

function readEntries(file) {
  const text = readFileSync(file, 'utf8')
  const entries = []
  let bad = 0
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue
    try {
      const row = JSON.parse(line)
      if (typeof row !== 'object' || row === null || typeof row.at !== 'string') throw new Error('shape')
      entries.push(row)
    } catch {
      bad++
    }
  }
  return { entries, bad }
}

function countBy(rows, pick) {
  const counts = new Map()
  for (const row of rows) {
    const key = pick(row)
    if (key === undefined || key === null || key === '') continue
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
}

export function summarise(entries, bad, opts) {
  const times = entries.map((e) => Date.parse(e.at)).filter((t) => !Number.isNaN(t))
  const from = times.length ? Math.min(...times) : opts.now - 7 * 86_400_000
  const to = times.length ? Math.max(...times) : opts.now
  const spanDays = Math.max((to - from) / 86_400_000, 1 / 24)
  const byEvent = {}
  for (const name of EVENTS) byEvent[name] = entries.filter((e) => e.event === name).length
  return {
    window: { from, to, label: opts.label, spanDays },
    total: entries.length,
    bad,
    byEvent,
    perDay: entries.length / spanDays,
    topWords: countBy(entries, (e) => e.word).slice(0, TOP),
    topTools: countBy(entries, (e) => e.tool).slice(0, TOP),
    topPaths: countBy(entries, (e) => e.path).slice(0, TOP),
  }
}

function pct(part, whole) {
  return whole === 0 ? '0%' : Math.round((part / whole) * 100) + '%'
}

function list(pairs, total) {
  if (pairs.length === 0) return '(none)'
  return pairs.map(([k, n]) => k + ' ' + n + ' ' + pct(n, total)).join(' · ')
}

export function render(s) {
  const lines = []
  const from = new Date(s.window.from).toISOString().slice(0, 16).replace('T', ' ')
  const to = new Date(s.window.to).toISOString().slice(0, 16).replace('T', ' ')
  const days = s.window.spanDays >= 1 ? s.window.spanDays.toFixed(1) + 'd' : Math.round(s.window.spanDays * 24) + 'h'
  lines.push('dot-gate audit · ' + from + ' .. ' + to + ' (' + days + ') · ' + s.total + ' event(s)')
  for (const name of EVENTS) {
    lines.push('  ' + name.padEnd(7) + String(s.byEvent[name]).padStart(5) + '  ' + pct(s.byEvent[name], s.total).padStart(4))
  }
  lines.push('  rate    ' + s.perDay.toFixed(1) + '/day' + (s.bad ? '   unreadable lines: ' + s.bad : ''))
  lines.push('  word    ' + list(s.topWords, s.total))
  lines.push('  tool    ' + list(s.topTools, s.total))
  lines.push('  path    ' + list(s.topPaths, s.total))
  lines.push('  read    ' + advice(s))
  return lines.join('\n')
}

/** The one sentence a human needs in order to decide. */
export function advice(s) {
  if (s.total === 0) return 'no hits in this window - nothing to loosen or tighten.'
  const [word, hits] = s.topWords[0] || ['', 0]
  const share = hits / s.total
  if (share >= 0.5) return "one phrase ('" + word + "') is " + pct(hits, s.total) + ' of all hits - the word list is probably too broad.'
  if (s.byEvent.deny > s.total / 2) return 'more than half the hits were hard denials - check that before widening the list.'
  if (s.perDay >= 10) return s.perDay.toFixed(1) + ' hits/day is a lot for one reviewer - sample it, do not read it all.'
  return 'the split looks balanced - keep the list as it is and re-check next week.'
}

function selftest() {
  const now = Date.parse('2026-11-13T00:00:00Z')
  const mk = (i, event, word) => ({
    at: new Date(now - i * 3_600_000).toISOString(),
    event,
    mode: event === 'deny' ? 'hard' : 'soft',
    tool: i % 2 ? 'write' : 'edit',
    path: 'a.md',
    word,
  })
  const entries = []
  for (let i = 0; i < 20; i++) entries.push(mk(i + 1, 'remind', i < 14 ? 'not-supported' : 'cannot'))
  for (let i = 0; i < 4; i++) entries.push(mk(i + 1, 'deny', 'cannot'))
  entries.push(mk(1, 'steer', 'not-supported'))
  const s = summarise(entries, 2, { now, label: '7d' })
  const checks = [
    [s.total === 25, 'total counts every parsed line'],
    [s.bad === 2, 'unreadable lines are counted, not fatal'],
    [s.byEvent.remind === 20, 'remind grouped'],
    [s.byEvent.deny === 4, 'deny grouped'],
    [s.byEvent.steer === 1, 'steer grouped'],
    [s.topWords[0][0] === 'not-supported' && s.topWords[0][1] === 15, 'top word counted'],
    [pct(15, 25) === '60%', 'percentages are of the whole'],
    [/too broad/.test(advice(s)), 'a dominant phrase is called out'],
  ]
  const failed = checks.filter(([ok]) => !ok)
  for (const [ok, name] of checks) process.stdout.write((ok ? '  [OK]   ' : '  [FAIL] ') + name + '\n')
  if (failed.length) {
    process.stderr.write('audit-report selftest: ' + failed.length + ' failed\n')
    process.exit(1)
  }
  process.stdout.write('audit-report selftest: ' + checks.length + ' checks pass\n')
  process.exit(0)
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.selftest) selftest()
  if (!existsSync(args.path)) {
    process.stderr.write('audit-report: no audit log at ' + args.path + ' - set config.auditPath on the gate first\n')
    process.exit(2)
  }
  const since = parseSince(args.since)
  const now = Date.now()
  const cutoff = since.ms === null ? since.absolute : now - since.ms
  const { entries, bad } = readEntries(args.path)
  const kept = entries.filter((e) => {
    const t = Date.parse(e.at)
    return !Number.isNaN(t) && t >= cutoff
  })
  const s = summarise(kept, bad, { now, label: since.label })
  process.stdout.write((args.json ? JSON.stringify(s) : render(s)) + '\n')
  process.exit(0)
}

main()
