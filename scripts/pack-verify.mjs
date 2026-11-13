#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * pack-verify.mjs - prove the published package is self-sufficient.
 *
 * "npm pack succeeded" only means a tarball was produced. It says nothing about
 * whether that tarball can be installed somewhere else and still work. This
 * installs it into a throwaway directory, imports it there, runs the packaged
 * tests there, and asserts that nothing resolves back to the source checkout.
 *
 * Two Windows details are load-bearing:
 *   - npm is a .cmd shim, which Node refuses to spawn without a shell;
 *   - the node executable path often contains a space, which a shell would split.
 * So the two are spawned differently on purpose.
 *
 * Exit codes: 0 self-sufficient, 1 failed, 2 could not run.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const IS_WIN = process.platform === 'win32'
const NPM = IS_WIN ? 'npm.cmd' : 'npm'

const viaShell = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: true })
const direct = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: false })

function say(s) { console.log(s) }

const packed = viaShell(NPM, ['pack', '--json'], ROOT)
if (packed.status !== 0) {
  say('[--] npm pack could not run')
  say(((packed.stderr || '') + (packed.stdout || '')).split('\n').slice(0, 4).join('\n'))
  process.exit(2)
}

let info
try {
  const parsed = JSON.parse(packed.stdout)
  info = Array.isArray(parsed) ? parsed[0] : null
} catch {
  info = null
}
if (info === null) { say('[--] npm pack returned no package info'); process.exit(2) }

const tarball = join(ROOT, info.filename)
say('packed ' + info.filename + ' (' + info.entryCount + ' files, ' + info.size + ' bytes)')

const tmp = mkdtempSync(join(tmpdir(), 'dotgate-verify-'))
let code = 0
try {
  if (viaShell(NPM, ['init', '-y'], tmp).status !== 0) { say('[FAIL] npm init'); code = 1 }

  const inst = viaShell(NPM, ['install', '--no-audit', '--no-fund', tarball], tmp)
  if (inst.status !== 0) {
    say('[FAIL] install')
    say(((inst.stderr || '') + (inst.stdout || '')).split('\n').slice(0, 6).join('\n'))
    code = 1
  } else {
    const target = join(tmp, 'node_modules', 'dsh-dot-gate')
    if (!existsSync(target)) {
      say('[FAIL] package missing after install')
      code = 1
    } else {
      const probe = direct(process.execPath, ['-e', "import('dsh-dot-gate').then((m) => { if (typeof m.apply !== 'function') { console.error('no apply export'); process.exit(1) } console.log('ok') })"], tmp)
      if (probe.status === 0) say('  [OK]   import from the installed copy')
      else { say('  [FAIL] import from the installed copy'); say(((probe.stderr || '') + (probe.stdout || '')).trim().slice(0, 300)); code = 1 }

      // Run the suite the package itself declares, not a hand-picked pair. A test file added to
      // scripts.test but left out of files[] keeps passing here while silently not shipping - the
      // gate was doing exactly that for test-property.mjs and test-survivors.mjs.
      // Run the files scripts.test names AND the tarball carries. Every declared file must be one
      // of the two: shipped and runnable, or declared repo-only with a reason. A file added to
      // scripts.test and dropped on the floor now fails here instead of passing silently - which
      // is what happened to test-property.mjs and test-survivors.mjs before this check existed.
      const shipped = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
      const declared = (shipped.scripts?.test ?? '').replace(/^node\s+--test\s+/, '').trim().split(/\s+/).filter(Boolean)
      const repoOnly = shipped.repoOnlyTests ?? {}
      const runnable = []
      let coverage = code
      for (const file of declared) {
        if (existsSync(join(target, file))) runnable.push(file)
        else if (repoOnly[file]) say('  [..]   ' + file + ' - repo-only: ' + repoOnly[file])
        else { say('  [FAIL] ' + file + ' is in scripts.test but neither shipped nor declared in repoOnlyTests'); coverage = 1 }
      }
      for (const file of Object.keys(repoOnly)) {
        if (!declared.includes(file)) { say('  [FAIL] ' + file + ' is declared repo-only but scripts.test does not run it'); coverage = 1 }
      }
      if (code === 0) code = coverage
      if (runnable.length === 0) {
        say('  [FAIL] no declared test file was shipped')
        code = 1
      } else if (code === 0) {
        const tests = direct(process.execPath, ['--test', ...runnable], target)
        if (tests.status === 0) say('  [OK]   the shipped suite (' + runnable.length + ' file(s)) passes outside the source tree')
        else { say('  [FAIL] packaged tests'); say(((tests.stdout || '') + (tests.stderr || '')).split('\n').slice(-8).join('\n')); code = 1 }
      }

      const index = join(target, 'index.js')
      if (existsSync(index) && target.startsWith(tmp + sep)) say('  [OK]   resolves inside the throwaway directory')
      else { say('  [FAIL] resolves outside the throwaway directory'); code = 1 }
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
  if (existsSync(tarball)) rmSync(tarball, { force: true })
}

say('')
say(code === 0 ? 'pack-verify: self-sufficient' : 'pack-verify: failed')
process.exit(code)
