#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * hygiene.mjs - turn the release checklist into a program.
 *
 * A checklist that lives in a document is a rule the author has to remember.
 * These gates run in one command and fail loudly, so forgetting is not an option.
 *
 *   S1b  history       no token literal in recent commit messages (file scanning is secretlint's job)
 *   S2   local paths   no drive-letter path in the public surface
 *   S2b  identity      the machine's user/host name does not appear in public text
 *   S14  SPDX          every .js / .mjs / .rs / .py carries an SPDX identifier
 *   S18  skills        every SKILL.md has frontmatter with name and description
 *   S16  packaging     .gitignore covers node_modules and *.tgz, no stray tarball
 *   (packaging sanity is publint's job: npm run gate:publint)
 *
 * Exit codes: 0 clean, 1 at least one gate failed, 2 at least one gate skipped.
 * A skipped gate is not a passing gate, and --require-all turns a skip into a failure.
 *
 * Usage: node scripts/hygiene.mjs [--list] [--require-all]
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const BS = String.fromCharCode(92)
const LF = String.fromCharCode(10)

const SKIP_DIRS = new Set(['node_modules', '.git', 'coverage', 'dist'])
const TEXT_EXT = new Set(['.md', '.js', '.mjs', '.cjs', '.json', '.yml', '.yaml', '.txt', '.toml', '.ini', '.cfg'])

// Built from parts so this file never contains the pattern it searches for.
const DRIVE_PATH = new RegExp('(?<![-A-Za-z0-9+.(?])[A-Za-z]:[' + BS + BS + '/]')
const SECRETS = [
  ['GitHub PAT', new RegExp('gh[pousr]_[A-Za-z0-9]{20,}')],
  ['GitHub fine-grained', new RegExp('github_pat_[A-Za-z0-9_]{30,}')],
  ['OpenAI/Anthropic style', new RegExp('sk-[A-Za-z0-9_-]{24,}')],
  ['npm token', new RegExp('npm_[A-Za-z0-9]{20,}')],
]
const GENERIC_IDENTITIES = new Set(['root', 'user', 'runner', 'admin', 'administrator', 'ubuntu', 'node', 'vm', 'ci'])

const PASS = []
const FAIL = []
const SKIP = []

function ok(name) { PASS.push(name); console.log('  [OK]   ' + name) }
function bad(name, detail) { FAIL.push(name); console.log('  [FAIL] ' + name + (detail ? '  ' + detail : '')) }
function skip(name, why) { SKIP.push(name); console.log('  [SKIP] ' + name + (why ? '  ' + why : '')) }

function git(args) {
  try {
    return execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    return null
  }
}

function readText(rel) {
  try { return readFileSync(join(ROOT, rel), 'utf8') } catch { return '' }
}

function walkDisk() {
  const out = []
  const stack = [ROOT]
  while (stack.length > 0) {
    const cur = stack.pop()
    for (const name of readdirSync(cur)) {
      const full = join(cur, name)
      const st = statSync(full)
      if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) stack.push(full) }
      else out.push(full)
    }
  }
  return out.map((f) => relative(ROOT, f).split(BS).join('/'))
}

const tracked = git(['ls-files'])
const inGit = tracked !== null
const publicFiles = inGit
  ? tracked.split(LF).map((s) => s.trim()).filter((s) => s !== '')
  : walkDisk()

// Docs are scanned from disk even when untracked: a leak is usually written
// before anyone stages it.
const docsOnDisk = existsSync(join(ROOT, 'docs'))
  ? readdirSync(join(ROOT, 'docs')).filter((n) => n.endsWith('.md')).map((n) => 'docs/' + n)
  : []

const scanSet = [...new Set([...publicFiles, ...docsOnDisk])].filter((rel) => TEXT_EXT.has(extname(rel)))

console.log('hygiene: ' + scanSet.length + ' public text files (' + (inGit ? 'git index' : 'disk') + ')')

// ---------------------------------------------------------------- S1
// File-level credential scanning is not re-implemented here: secretlint owns it,
// with a rule set far larger than anything worth hand-writing. What secretlint
// cannot do is look at history, so that is the only thing this gate keeps.
if (!inGit) {
  skip('S1b commit history', 'not a git repository')
} else {
  const log = git(['log', '--format=%B', '-30']) || ''
  const logHits = SECRETS.filter(([, rx]) => rx.test(log)).map(([label]) => label)
  if (logHits.length === 0) ok('S1b no credential in the last 30 commit messages')
  else bad('S1b no credential in the last 30 commit messages', logHits.join('; '))
}

// ---------------------------------------------------------------- S2
const s2hits = []
for (const rel of scanSet) {
  const body = readText(rel)
  const m = body.match(DRIVE_PATH)
  if (m === null) continue
  const line = body.slice(0, m.index).split(LF).length
  s2hits.push(rel + ':' + line + ' (' + m[0] + ')')
}
if (s2hits.length === 0) ok('S2 no local drive path in public text')
else bad('S2 no local drive path in public text', s2hits.slice(0, 5).join('; '))

// ---------------------------------------------------------------- S2b
const identities = [process.env.USERNAME, process.env.USER, process.env.COMPUTERNAME]
  .filter((v) => typeof v === 'string' && v.trim().length >= 4)
  .map((v) => v.trim())
  .filter((v, i, all) => !GENERIC_IDENTITIES.has(v.toLowerCase()) && all.indexOf(v) === i)
if (identities.length === 0) {
  skip('S2b machine identity', 'no non-generic user/host name in the environment')
} else {
  const idhits = []
  for (const rel of scanSet) {
    const body = readText(rel)
    for (const id of identities) if (body.includes(id)) idhits.push(rel + ' (' + id + ')')
  }
  if (idhits.length === 0) ok('S2b machine identity does not appear in public text')
  else bad('S2b machine identity does not appear in public text', idhits.slice(0, 5).join('; '))
}

// ---------------------------------------------------------------- S14
const s14hits = []
for (const rel of publicFiles.filter((f) => ['.js', '.mjs', '.cjs', '.rs', '.py'].includes(extname(f)))) {
  const head = readText(rel).split(LF).slice(0, 2).map((l) => l.trim())
  if (!head.some((l) => l.startsWith('// SPDX-License-Identifier:'))) s14hits.push(rel)
}
if (s14hits.length === 0) ok('S14 every script carries an SPDX identifier')
else bad('S14 every script carries an SPDX identifier', s14hits.join('; '))

// ---------------------------------------------------------------- S16
const ignorePath = join(ROOT, '.gitignore')
if (!existsSync(ignorePath)) {
  bad('S16 .gitignore present and complete', '.gitignore missing')
} else {
  const ig = readFileSync(ignorePath, 'utf8')
  const missing = ['node_modules', '*.tgz'].filter((needle) => !ig.includes(needle))
  if (missing.length === 0) ok('S16 .gitignore covers node_modules and *.tgz')
  else bad('S16 .gitignore covers node_modules and *.tgz', 'missing: ' + missing.join(', '))
}
const tarballs = walkDisk().filter((f) => f.endsWith('.tgz'))
if (tarballs.length === 0) ok('S16 no stray tarball')
else bad('S16 no stray tarball', tarballs.join('; '))

// ---------------------------------------------------------------- packaging
// package.json "files"/"exports" resolvability is publint's job (npm run gate:publint).
// Re-implementing a weaker version of it here would only create a second truth.

// ---------------------------------------------------------------- S18
const skillFiles = publicFiles.filter((f) => f.endsWith('SKILL.md'))
const s18hits = []
for (const rel of skillFiles) {
  const body = readText(rel)
  const fm = body.startsWith('---') ? body.slice(3, body.indexOf(LF + '---', 3)) : ''
  if (fm === '') { s18hits.push(rel + ' (no frontmatter)'); continue }
  if (!/(^|\n)name:/.test(fm)) s18hits.push(rel + ' (no name)')
  if (!/(^|\n)description:/.test(fm)) s18hits.push(rel + ' (no description)')
}
if (s18hits.length === 0) ok('S18 every SKILL.md has frontmatter with name and description')
else bad('S18 every SKILL.md has frontmatter with name and description', s18hits.join('; '))

// ---------------------------------------------------------------- summary
if (process.argv.includes('--list')) {
  console.log('')
  console.log('gates: S1b commit history, S2 local paths, S2b identity, S14 SPDX, S16 packaging (secrets: secretlint, packaging: publint)')
}
const requireAll = process.argv.includes('--require-all')
if (FAIL.length > 0) { console.log(''); console.log('hygiene: FAILED (' + FAIL.length + ')'); process.exit(1) }
if (SKIP.length > 0) {
  console.log('')
  console.log('hygiene: ' + PASS.length + ' passed, ' + SKIP.length + ' skipped')
  process.exit(requireAll ? 1 : 2)
}
console.log('')
console.log('hygiene: ' + PASS.length + ' gates clean')
process.exit(0)
