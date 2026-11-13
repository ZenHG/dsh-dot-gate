#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * labelled-corpus.mjs - make a hit labelable after the fact, then score the labels.
 *
 * The audit log answers "how many hits" and nothing else: a line says which word
 * fired and where, but the text that actually triggered the gate is gone. Without
 * that text two raters can only guess, so index.js now writes a clipped snippet
 * into each record. This script turns a sample of those records into a sheet two
 * humans can fill in, then turns the filled sheet into the numbers TODO.md asks
 * for: precision, recall and Cohen's kappa, each with an interval and its n.
 *
 *   node scripts/labelled-corpus.mjs --export --path <audit.jsonl> [--n 30]
 *                                     [--out <dir>] [--seed 20261113] [--force]
 *   node scripts/labelled-corpus.mjs --score --sheet <labelled.csv>
 *   node scripts/labelled-corpus.mjs --selftest
 *
 * Sheet format: RFC 4180 CSV. A spreadsheet opens it, both raters can fill the two
 * label columns, and the parser below reads it back with no dependency. TSV would
 * have been shorter until a snippet contains a tab; CSV quoting already solves the
 * comma, the quote and the newline, and every spreadsheet exports it.
 *
 * The label question is the same for every row:
 *   "Does this written text contain an unsupported negative capability claim?"
 * yes -> the gate was right to fire (a true positive for a hit row; a miss for a
 *        non-hit row). no -> the gate should not have fired (false positive).
 * Blank means the rater skipped the row. Raters fill rater1/rater2, never "tp".
 *
 * A hit-only sheet cannot estimate recall: false negatives are, by definition,
 * rows the gate never logged. The sheet carries a source column so a sample of
 * writes that did NOT hit can be added later; until then recall is printed as n/a
 * with the reason, never as a fabricated 100%.
 *
 * Exit codes: 0 reported, 1 bad usage or unreadable sheet, 2 nothing to sample.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const DEFAULT_N = 30
const DEFAULT_SEED = 20261113
const DEFAULT_AUDIT = '.dot-audit.jsonl'
const SHEET_NAME = 'labelled-corpus.csv'
const HEADER = ['id', 'timestamp', 'word', 'path', 'snippet', 'source', 'rater1', 'rater2', 'notes']
const Z = 1.959963984540054 // 95% normal quantile, kept literal so no dependency
const SMALL_N = 30

class CliError extends Error {
  constructor(message, code = 1) {
    super(message)
    this.code = code
  }
}

function fail(message, code = 1) {
  throw new CliError(message, code)
}

// ---------------------------------------------------------------- arguments
function parseArgs(argv) {
  const args = {
    mode: '',
    path: process.env.DOT_AUDIT_PATH || DEFAULT_AUDIT,
    n: DEFAULT_N,
    out: '.',
    seed: DEFAULT_SEED,
    sheet: '',
    force: false,
    help: false,
  }
  const modes = []
  const value = (name, at) => {
    const v = argv[at + 1]
    if (v === undefined || v.startsWith('--')) fail(name + ' needs a value')
    return v
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--export' || a === '--score' || a === '--selftest') {
      modes.push(a.slice(2))
    } else if (a === '--path') {
      args.path = value(a, i); i++
    } else if (a === '--n') {
      args.n = Number(value(a, i)); i++
    } else if (a === '--out') {
      args.out = value(a, i); i++
    } else if (a === '--seed') {
      args.seed = Number(value(a, i)); i++
    } else if (a === '--sheet') {
      args.sheet = value(a, i); i++
    } else if (a === '--force') {
      args.force = true
    } else if (a === '--help' || a === '-h') {
      args.help = true
    } else {
      fail('unknown argument ' + a)
    }
  }
  if (args.help) return args
  if (modes.length !== 1) fail('choose exactly one of --export, --score, --selftest')
  args.mode = modes[0]
  if (args.mode === 'export') {
    if (!Number.isInteger(args.n) || args.n < 1) fail('--n takes a positive integer')
    if (!Number.isInteger(args.seed)) fail('--seed takes an integer')
  }
  if (args.mode === 'score' && args.sheet === '') fail('--score needs --sheet <file>')
  return args
}

function usage() {
  return [
    'usage:',
    '  node scripts/labelled-corpus.mjs --export --path <audit.jsonl> [--n 30] [--out <dir>] [--seed N] [--force]',
    '  node scripts/labelled-corpus.mjs --score --sheet <labelled.csv>',
    '  node scripts/labelled-corpus.mjs --selftest',
    '',
    'exit codes: 0 reported, 1 bad usage/unreadable sheet, 2 nothing to sample',
  ].join('\n')
}

// ---------------------------------------------------------------- audit input
function readAudit(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    fail('cannot read audit log at ' + file + ' - set config.auditPath and collect some hits first', 2)
  }
  const rows = []
  let bad = 0
  let incomplete = 0
  let unsnippeted = 0
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue
    let row
    try {
      row = JSON.parse(line)
    } catch {
      bad++
      continue
    }
    // A corpus row needs the two things the audit line always had, plus a snippet
    // to be judgeable. Older lines still count as hits; they are just unlabelable.
    if (
      row === null || typeof row !== 'object' || Array.isArray(row)
      || typeof row.at !== 'string' || typeof row.word !== 'string' || row.word === ''
      || typeof row.path !== 'string' || row.path === ''
    ) {
      incomplete++
      continue
    }
    rows.push(row)
    if (typeof row.snippet !== 'string' || row.snippet.trim() === '') unsnippeted++
  }
  return { rows, bad, incomplete, unsnippeted }
}

/** One unit of the corpus is a written claim, not one audit event: a remind and a
 * deny for the same write carry the same snippet, path and word. Collapsing them
 * keeps a corpus of 30 from being 15 claims counted twice. Lines without a snippet
 * are left alone because there is no content key to compare safely. */
function collapse(rows) {
  const seen = new Set()
  const out = []
  let duplicates = 0
  for (const row of rows) {
    const snippet = typeof row.snippet === 'string' ? row.snippet.trim() : ''
    if (snippet !== '') {
      const key = row.path + '\u0000' + row.word + '\u0000' + snippet
      if (seen.has(key)) {
        duplicates++
        continue
      }
      seen.add(key)
    }
    out.push(row)
  }
  return { rows: out, duplicates }
}

/** Mulberry32: a tiny deterministic PRNG so "which 30 hits" is reproducible from
 * the seed rather than being whatever the filesystem order happened to be. */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function sample(rows, n, seed) {
  const copy = rows.slice()
  const random = rng(seed)
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const tmp = copy[i]
    copy[i] = copy[j]
    copy[j] = tmp
  }
  return copy.slice(0, Math.min(n, copy.length))
}

function timeOf(row) {
  const t = Date.parse(row.at)
  return Number.isNaN(t) ? Infinity : t
}

// ---------------------------------------------------------------- CSV
function csvCell(value) {
  const text = value === undefined || value === null ? '' : String(value)
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text
}

function toCsv(records) {
  const lines = [HEADER.join(',')]
  for (const record of records) lines.push(HEADER.map((key) => csvCell(record[key])).join(','))
  return lines.join('\r\n') + '\r\n'
}

/** RFC 4180 reader: quoted fields, doubled quotes, CRLF or LF, one trailing row. */
function parseCsv(text) {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (quoted) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (ch === '\r') {
      if (body[i + 1] !== '\n') {
        row.push(field)
        rows.push(row)
        row = []
        field = ''
      }
    } else {
      field += ch
    }
  }
  if (quoted) fail('sheet has an unterminated quoted field', 1)
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  while (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0].trim() === '') rows.pop()
  return rows
}

const SKIPS = new Set(['', '-', '—', '?', 'na', 'n/a', 'skip', 'skipped'])
const YES = new Set(['yes', 'y', 'true', '1'])
const NO = new Set(['no', 'n', 'false', '0'])

function parseLabel(raw, id, rater) {
  const v = String(raw === undefined ? '' : raw).trim().toLowerCase()
  if (SKIPS.has(v)) return null
  if (YES.has(v)) return true
  if (NO.has(v)) return false
  fail('row ' + id + ': ' + rater + ' must be yes, no or blank (got "' + raw + '")', 1)
}

function parseSource(raw) {
  const v = String(raw === undefined ? '' : raw).trim().toLowerCase()
  if (v === '' || v === 'hit') return 'hit'
  if (v === 'miss' || v === 'nonhit' || v === 'non-hit') return 'miss'
  fail('source must be "hit" or "miss" (got "' + raw + '")', 1)
}

/** Read a filled sheet back into the three fields scoring needs. Unknown columns
 * are ignored so a spreadsheet user can add a column without breaking the score. */
function readSheet(text) {
  const table = parseCsv(text)
  if (table.length === 0) fail('sheet is empty', 1)
  const header = table[0].map((h) => String(h).trim().toLowerCase())
  for (const required of ['id', 'rater1', 'rater2']) {
    if (!header.includes(required)) fail('sheet header is missing "' + required + '"', 1)
  }
  const at = (name) => header.indexOf(name)
  const rows = []
  for (let i = 1; i < table.length; i++) {
    const cells = table[i]
    if (cells.every((cell) => String(cell).trim() === '')) continue
    const get = (name) => {
      const column = at(name)
      return column === -1 || cells[column] === undefined ? '' : cells[column]
    }
    const id = String(get('id')).trim() || 'row ' + (i + 1)
    rows.push({
      id,
      source: parseSource(get('source')),
      rater1: parseLabel(get('rater1'), id, 'rater1'),
      rater2: parseLabel(get('rater2'), id, 'rater2'),
    })
  }
  if (rows.length === 0) fail('sheet has a header but no rows', 2)
  return rows
}

// ---------------------------------------------------------------- arithmetic
/** Wilson score interval for a binomial proportion. Chosen over the normal
 * approximation because it still produces a finite interval when n is tiny and k
 * is 0 or n - which is exactly the state of a 5-row corpus. */
function wilson(k, n) {
  if (n <= 0) return null
  const p = k / n
  const z2 = Z * Z
  const denom = 1 + z2 / n
  const centre = (p + z2 / (2 * n)) / denom
  const half = (Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
  return { value: p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half), k, n }
}

function scoreRows(rows) {
  const rater1 = { true: 0, false: 0, skipped: 0 }
  const rater2 = { true: 0, false: 0, skipped: 0 }
  const pair = { a: 0, b: 0, c: 0, d: 0, n: 0 }
  const sourceCount = { hit: 0, miss: 0 }
  const hits = { tp: 0, fp: 0, unresolved: 0 }
  const misses = { fn: 0, tn: 0, unresolved: 0 }

  for (const row of rows) {
    sourceCount[row.source]++
    if (row.rater1 === null) rater1.skipped++
    else rater1[row.rater1 ? 'true' : 'false']++
    if (row.rater2 === null) rater2.skipped++
    else rater2[row.rater2 ? 'true' : 'false']++

    if (row.rater1 !== null && row.rater2 !== null) {
      pair.n++
      if (row.rater1 && row.rater2) pair.a++
      else if (row.rater1) pair.b++
      else if (row.rater2) pair.c++
      else pair.d++
    }

    const bucket = row.source === 'miss' ? misses : hits
    const positive = row.source === 'miss' ? 'fn' : 'tp'
    const negative = row.source === 'miss' ? 'tn' : 'fp'
    if (row.rater1 !== null && row.rater2 !== null) {
      if (row.rater1 === row.rater2) bucket[row.rater1 ? positive : negative]++
      else bucket.unresolved++
    } else if (row.rater1 !== null || row.rater2 !== null) {
      const label = row.rater1 !== null ? row.rater1 : row.rater2
      bucket[label ? positive : negative]++
    }
  }

  const hitLabeled = hits.tp + hits.fp
  const missLabeled = misses.fn + misses.tn
  const precision = wilson(hits.tp, hitLabeled)
  let recall = null
  let recallReason = ''
  if (sourceCount.miss === 0) {
    recallReason = 'no non-hit rows in this sheet - a log of hits cannot show what the gate missed'
  } else if (missLabeled === 0) {
    recallReason = 'non-hit rows exist but none has a usable label'
  } else {
    recall = wilson(hits.tp, hits.tp + misses.fn)
  }

  let kappa = null
  let kappaSe = null
  if (pair.n > 0) {
    const po = (pair.a + pair.d) / pair.n
    const r1yes = pair.a + pair.b
    const r1no = pair.c + pair.d
    const r2yes = pair.a + pair.c
    const r2no = pair.b + pair.d
    const pe = (r1yes * r2yes + r1no * r2no) / (pair.n * pair.n)
    if (pe < 1) {
      kappa = (po - pe) / (1 - pe)
      // Cohen's large-sample standard error. It is an approximation; the output
      // says so, and n is always printed next to it.
      kappaSe = Math.sqrt((po * (1 - po)) / (pair.n * (1 - pe) * (1 - pe)))
    }
  }

  return {
    rows: rows.length,
    sourceCount,
    rater1,
    rater2,
    pair,
    kappa: kappa === null ? null : {
      value: kappa,
      // A zero standard error happens at perfect (or perfectly inverse) agreement.
      // The normal interval then collapses to [1, 1], which reads as certainty and
      // is exactly the wrong message at small n. Report no interval instead.
      lo: kappaSe > 0 ? Math.max(-1, kappa - Z * kappaSe) : null,
      hi: kappaSe > 0 ? Math.min(1, kappa + Z * kappaSe) : null,
      n: pair.n,
    },
    precision: precision === null ? null : { ...precision, unresolved: hits.unresolved },
    recall: recall === null ? { reason: recallReason } : { ...recall, unresolved: misses.unresolved },
    hits,
    misses,
    hitLabeled,
    missLabeled,
  }
}

// ---------------------------------------------------------------- rendering
function pct(x) {
  return (x * 100).toFixed(1) + '%'
}

function interval(result) {
  return pct(result.value) + '  95% CI [' + pct(result.lo) + ', ' + pct(result.hi) + ']'
}

function pad(n, width) {
  return String(n).padStart(width)
}

function renderScore(rows, sheetPath) {
  const s = scoreRows(rows)
  const lines = []
  lines.push('dot-gate labelled corpus')
  lines.push('sheet     ' + sheetPath)
  lines.push('rows      ' + s.rows + '  (' + s.sourceCount.hit + ' hit, ' + s.sourceCount.miss + ' non-hit)')
  lines.push('skipped   rater1 ' + s.rater1.skipped + ' row(s)  ·  rater2 ' + s.rater2.skipped + ' row(s)')
  lines.push('')
  lines.push('rater agreement (paired labels only, n=' + s.pair.n + ')')
  lines.push('                rater2:yes  rater2:no')
  lines.push('  rater1:yes    ' + pad(s.pair.a, 9) + '  ' + pad(s.pair.b, 8))
  lines.push('  rater1:no     ' + pad(s.pair.c, 9) + '  ' + pad(s.pair.d, 8))
  lines.push('  total         ' + pad(s.pair.a + s.pair.c, 9) + '  ' + pad(s.pair.b + s.pair.d, 8) + '   (off-diagonal = disagreement)')
  lines.push('')
  if (s.kappa === null) {
    if (s.pair.n === 0) lines.push('kappa     n/a  (n=0 paired labels; kappa is undefined without two raters on the same row)')
    else lines.push('kappa     n/a  (n=' + s.pair.n + ' paired labels, but both raters used one category only; expected agreement is 1)')
  } else if (s.kappa.lo === null) {
    lines.push('kappa     ' + s.kappa.value.toFixed(3) + '  95% CI n/a  n=' + s.kappa.n + ' pairs (zero observed disagreement: the normal interval collapses to zero width, which would read as certainty)')
  } else {
    lines.push('kappa     ' + s.kappa.value.toFixed(3) + '  95% CI [' + s.kappa.lo.toFixed(3) + ', ' + s.kappa.hi.toFixed(3) + ']  n=' + s.kappa.n + ' pairs (normal approximation, clipped to [-1, 1])')
  }
  lines.push('')
  if (s.precision === null) {
    lines.push('precision n/a  (no hit row has a usable label)')
  } else {
    lines.push('precision ' + interval(s.precision) + '  ·  tp=' + s.hits.tp + ' fp=' + s.hits.fp + '  n=' + s.hitLabeled + ' labelled hit row(s) [Wilson]')
  }
  if (s.recall !== null && s.recall.reason === undefined) {
    lines.push('recall    ' + interval(s.recall) + '  ·  tp=' + s.hits.tp + ' fn=' + s.misses.fn + '  n=' + (s.hits.tp + s.misses.fn) + ' positive row(s) [Wilson]')
  } else {
    lines.push('recall    n/a  - ' + s.recall.reason)
  }
  lines.push('')
  const unresolved = s.hits.unresolved + s.misses.unresolved
  if (unresolved > 0) lines.push('unresolved ' + unresolved + ' row(s) disagree between raters; excluded from precision/recall, still counted by kappa')
  const single = s.hitLabeled + s.missLabeled - (s.pair.a + s.pair.d)
  if (single > 0) lines.push('single     ' + single + ' row(s) have one rater only; used in precision/recall, not in kappa')
  lines.push('')
  if (s.sourceCount.miss === 0) {
    lines.push('2x2       tp=' + s.hits.tp + '  fp=' + s.hits.fp + '  fn=?  tn=?   (a hit-only sheet cannot observe misses)')
  } else {
    lines.push('2x2       tp=' + s.hits.tp + '  fp=' + s.hits.fp + '  fn=' + s.misses.fn + '  tn=' + s.misses.tn + '   (gate vs labels)')
  }
  if (s.hitLabeled < SMALL_N) {
    lines.push('note      n=' + s.hitLabeled + ' labelled hit row(s) < ' + SMALL_N + ': quote the interval, not the point estimate. Kappa also needs its n.')
  }
  lines.push('')
  lines.push('intervals are 95%; proportions use Wilson, kappa uses the normal approximation.')
  return lines.join('\n')
}

// ---------------------------------------------------------------- commands
function runExport(args) {
  const { rows, bad, incomplete, unsnippeted } = readAudit(args.path)
  if (rows.length === 0) fail('no hit rows with at and word in ' + args.path, 2)
  const collapsed = collapse(rows)
  if (collapsed.rows.length === 0) fail('all rows were duplicates; nothing to sample', 2)
  const chosen = sample(collapsed.rows, args.n, args.seed)
  chosen.sort((a, b) => timeOf(a) - timeOf(b) || String(a.path).localeCompare(String(b.path)) || String(a.word).localeCompare(String(b.word)))
  const records = chosen.map((row, i) => ({
    id: 'H' + String(i + 1).padStart(3, '0'),
    timestamp: row.at,
    word: row.word,
    path: row.path,
    snippet: typeof row.snippet === 'string' ? row.snippet : '',
    source: 'hit',
    rater1: '',
    rater2: '',
    notes: '',
  }))
  const missing = records.filter((row) => row.snippet.trim() === '').length

  const outDir = resolve(args.out)
  if (existsSync(outDir) && !statSync(outDir).isDirectory()) fail('--out must be a directory: ' + outDir)
  mkdirSync(outDir, { recursive: true })
  const target = join(outDir, SHEET_NAME)
  if (existsSync(target) && !args.force) fail('sheet already exists: ' + target + ' (pass --force to overwrite a fresh sheet)', 1)
  writeFileSync(target, toCsv(records), 'utf8')

  const lines = []
  lines.push('dot-gate labelled corpus · export')
  lines.push('log       ' + args.path + '  (' + rows.length + ' valid line(s)' + (unsnippeted > 0 ? ', ' + unsnippeted + ' without snippet' : '') + ', ' + bad + ' unreadable, ' + incomplete + ' incomplete)')
  lines.push('sample    ' + records.length + ' of ' + collapsed.rows.length + ' distinct hit(s)  (requested ' + args.n + ', seed ' + args.seed + (collapsed.duplicates > 0 ? ', ' + collapsed.duplicates + ' duplicate(s) collapsed' : '') + ')')
  lines.push('sheet     ' + target)
  lines.push('fill      rater1/rater2: yes = the text makes an unsupported negative claim, no = false positive, blank = skip')
  lines.push('recall    n/a from this sheet - add rows with source=miss from a sample of non-hits before quoting it')
  if (missing > 0) {
    lines.push('warning   ' + missing + ' sampled row(s) have no snippet; those rows cannot be judged from the sheet alone')
    if (missing === records.length) lines.push('warning   every sampled row is unlabelable - this log predates snippet capture, collect fresh hits')
  }
  return lines.join('\n')
}

function runScore(args) {
  if (!existsSync(args.sheet)) fail('no sheet at ' + args.sheet, 1)
  const rows = readSheet(readFileSync(args.sheet, 'utf8'))
  return renderScore(rows, args.sheet)
}

// ---------------------------------------------------------------- selftest
function selftest() {
  const checks = []
  const check = (ok, name) => checks.push([Boolean(ok), name])
  const close = (a, b) => typeof a === 'number' && Math.abs(a - b) < 1e-12
  // Build a real CSV in memory and read it back, so the arithmetic is tested
  // through the same parse path a filled sheet takes, not on hand-built objects.
  const asSheet = (rows) => readSheet(toCsv(rows.map((row) => ({
    id: row.id,
    source: row.source,
    rater1: row.rater1 === null ? '' : row.rater1 ? 'yes' : 'no',
    rater2: row.rater2 === null ? '' : row.rater2 ? 'yes' : 'no',
  }))))

  // 1. Cohen's kappa on a table small enough to do by hand:
  //    a=10 b=2 c=3 d=5, n=20, po=0.75, pe=(12*13+8*7)/400=0.53
  //    kappa=(0.75-0.53)/(1-0.53)=22/47.
  const kappaRows = []
  for (let i = 0; i < 10; i++) kappaRows.push({ id: 'K' + i, source: 'hit', rater1: true, rater2: true })
  for (let i = 0; i < 2; i++) kappaRows.push({ id: 'K' + (10 + i), source: 'hit', rater1: true, rater2: false })
  for (let i = 0; i < 3; i++) kappaRows.push({ id: 'K' + (12 + i), source: 'hit', rater1: false, rater2: true })
  for (let i = 0; i < 5; i++) kappaRows.push({ id: 'K' + (15 + i), source: 'hit', rater1: false, rater2: false })
  const k = scoreRows(asSheet(kappaRows))
  check(k.pair.a === 10 && k.pair.b === 2 && k.pair.c === 3 && k.pair.d === 5, 'kappa table counts a=10 b=2 c=3 d=5')
  check(k.pair.n === 20, 'kappa uses 20 paired rows')
  check(close(k.kappa.value, 22 / 47), 'kappa on the hand-computed table is 22/47')
  check(k.hits.unresolved === 5, 'five disagreements are reported, not hidden')

  // 2. Precision/recall on a known confusion matrix:
  //    hits tp=6 fp=2; misses fn=3 tn=15 -> precision 6/8, recall 6/9.
  const matrix = []
  for (let i = 0; i < 6; i++) matrix.push({ id: 'P' + i, source: 'hit', rater1: true, rater2: true })
  for (let i = 0; i < 2; i++) matrix.push({ id: 'P' + (6 + i), source: 'hit', rater1: false, rater2: false })
  for (let i = 0; i < 3; i++) matrix.push({ id: 'M' + i, source: 'miss', rater1: true, rater2: true })
  for (let i = 0; i < 15; i++) matrix.push({ id: 'M' + (3 + i), source: 'miss', rater1: false, rater2: false })
  const m = scoreRows(asSheet(matrix))
  check(m.hits.tp === 6 && m.hits.fp === 2 && m.misses.fn === 3 && m.misses.tn === 15, 'confusion matrix is tp=6 fp=2 fn=3 tn=15')
  check(close(m.precision.value, 6 / 8), 'precision on the known matrix is 6/8')
  check(close(m.recall.value, 6 / 9), 'recall on the known matrix is 6/9')
  check(m.precision.lo <= m.precision.value && m.precision.value <= m.precision.hi, 'precision interval brackets the estimate')
  check(m.recall.lo <= m.recall.value && m.recall.value <= m.recall.hi, 'recall interval brackets the estimate')

  // 3. Low n has to look low-confidence: a 1-of-2 interval is much wider than the
  //    same proportion at 100-of-200, and perfect agreement at n=4 must not claim a
  //    zero-width kappa interval.
  const small = wilson(1, 2)
  const large = wilson(100, 200)
  check((small.hi - small.lo) > (large.hi - large.lo), 'a low n produces a wider Wilson interval')
  const perfect = scoreRows(asSheet([
    { id: 'C1', source: 'hit', rater1: true, rater2: true },
    { id: 'C2', source: 'hit', rater1: true, rater2: true },
    { id: 'C3', source: 'hit', rater1: false, rater2: false },
    { id: 'C4', source: 'hit', rater1: false, rater2: false },
  ]))
  check(perfect.kappa.value === 1 && perfect.kappa.lo === null, 'perfect agreement at n=4 reports no collapsed kappa interval')

  // 4. Zero rows: every estimate is absent, nothing divides by zero, and the
  //    renderer says what n is instead of printing NaN.
  const zero = scoreRows([])
  check(zero.precision === null, 'zero rows: precision is null, not a number')
  check(zero.recall === null || zero.recall.reason !== '', 'zero rows: recall is absent with a reason')
  check(zero.kappa === null, 'zero rows: kappa is null, not NaN')
  const zeroText = renderScore([], 'synthetic-zero.csv')
  check(/n=0|rows\s+0/.test(zeroText), 'zero-row report prints its n')

  // 5. A hit-only sheet must refuse to invent recall.
  const hitOnly = scoreRows(kappaRows)
  check(hitOnly.recall !== null && hitOnly.recall.reason.includes('non-hit'), 'a hit-only sheet reports recall as n/a')

  // 6. Skips are counted per rater and rows with one label still contribute.
  const skipped = [
    { id: 'S1', source: 'hit', rater1: true, rater2: null },
    { id: 'S2', source: 'hit', rater1: null, rater2: false },
    { id: 'S3', source: 'hit', rater1: null, rater2: null },
    { id: 'S4', source: 'hit', rater1: true, rater2: true },
  ]
  const sk = scoreRows(asSheet(skipped))
  check(sk.rater1.skipped === 2 && sk.rater2.skipped === 2, 'each rater has its own skip count')
  check(sk.pair.n === 1, 'only rows with both labels enter kappa')
  check(sk.hits.tp === 2 && sk.hits.fp === 1, 'single-rater labels still count in precision')

  // 7. CSV survives the characters a human or a snippet can put in a cell.
  const nasty = {
    id: 'H001',
    timestamp: '2026-11-13T00:00:00.000Z',
    word: '做不到',
    path: 'Wiki/a,b.md',
    snippet: '他说 "做不到"，\n然后停。',
    source: 'hit',
    rater1: 'yes',
    rater2: '',
    notes: 'comma, "quote"',
  }
  const round = parseCsv(toCsv([nasty]))
  check(round.length === 2 && round[1][4] === nasty.snippet, 'CSV round-trips a snippet with a comma, quote and newline')
  const back = readSheet(toCsv([nasty]))
  check(back.length === 1 && back[0].rater1 === true && back[0].rater2 === null, 'a filled sheet parses labels and blanks')

  const failed = checks.filter(([ok]) => !ok)
  for (const [ok, name] of checks) process.stdout.write((ok ? '  [OK]   ' : '  [FAIL] ') + name + '\n')
  if (failed.length > 0) {
    process.stderr.write('labelled-corpus selftest: ' + failed.length + ' failed\n')
    return 1
  }
  process.stdout.write('labelled-corpus selftest: ' + checks.length + ' checks pass\n')
  return 0
}

// ---------------------------------------------------------------- entry
function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(usage() + '\n')
    return 0
  }
  if (args.mode === 'selftest') return selftest()
  if (args.mode === 'export') {
    process.stdout.write(runExport(args) + '\n')
    return 0
  }
  process.stdout.write(runScore(args) + '\n')
  return 0
}

try {
  process.exitCode = main()
} catch (error) {
  const code = error instanceof CliError ? error.code : 1
  process.stderr.write('labelled-corpus: ' + (error && error.message ? error.message : String(error)) + '\n')
  if (code === 1 && error instanceof CliError === false) process.stderr.write(usage() + '\n')
  process.exitCode = code
}
