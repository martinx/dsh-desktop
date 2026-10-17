#!/usr/bin/env node
// Decide which upstream `dsh-v*` tags still need a Desktop build.
//
// Scheduled runs only consider tags newer than the newest existing release, so a
// tag that fails to package cannot re-run every hour forever. Manual dispatch can
// set BACKFILL=true to include every missing tag.
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'

const UPSTREAM = process.env.UPSTREAM ?? 'deepseek-ai/deepseek-harness'
const REPO = process.env.GH_REPO ?? process.env.GITHUB_REPOSITORY ?? 'martinx/dsh-desktop'
const backfill = process.env.BACKFILL === 'true'
const maxTags = Number.parseInt(process.env.MAX_TAGS ?? '0', 10) || 0

/** Order versions numerically, treating a missing prerelease as newer. */
function compareVersions(left, right) {
  const parse = (value) => {
    const [core, prerelease = ''] = value.split('-')
    return { numbers: core.split('.').map((part) => Number.parseInt(part, 10) || 0), prerelease }
  }
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < 3; index += 1) {
    const difference = (a.numbers[index] ?? 0) - (b.numbers[index] ?? 0)
    if (difference !== 0) return difference
  }
  if (a.prerelease === b.prerelease) return 0
  if (!a.prerelease) return 1
  if (!b.prerelease) return -1
  return a.prerelease < b.prerelease ? -1 : 1
}

const refs = execFileSync('git', ['ls-remote', '--tags', `https://github.com/${UPSTREAM}.git`, 'refs/tags/dsh-v*'], { encoding: 'utf8' })
const tags = new Map()
for (const line of refs.split('\n')) {
  const [sha, ref] = line.split('\t')
  if (!sha || !ref) continue
  const name = ref.replace('refs/tags/', '')
  const peeled = name.endsWith('^{}')
  const tag = peeled ? name.slice(0, -3) : name
  if (!/^dsh-v\d/u.test(tag)) continue
  const entry = tags.get(tag) ?? { tag, version: tag.replace(/^dsh-v/u, ''), sha: '' }
  // An annotated tag lists its tag object first and the commit as `<tag>^{}`.
  if (peeled || !entry.sha) entry.sha = sha
  tags.set(tag, entry)
}

const releases = JSON.parse(execFileSync('gh', ['release', 'list', '--repo', REPO, '--limit', '200', '--json', 'tagName'], { encoding: 'utf8' }))
const released = new Set(releases.map((release) => release.tagName))

let candidates = [...tags.values()].filter((entry) => !released.has(entry.tag))
if (!backfill && candidates.length > 0) {
  const releasedVersions = [...released]
    .map((tag) => tag.replace(/^dsh-v/u, ''))
    .filter((version) => /^\d+\.\d+\.\d+/u.test(version))
    .sort(compareVersions)
  const newest = releasedVersions.at(-1)
  candidates = newest === undefined
    ? [candidates.sort((left, right) => compareVersions(left.version, right.version)).at(-1)]
    : candidates.filter((entry) => compareVersions(entry.version, newest) > 0)
}
candidates.sort((left, right) => compareVersions(right.version, left.version))
if (maxTags > 0) candidates = candidates.slice(0, maxTags)

const PLATFORMS = [
  { platform: 'mac-arm64', runner: 'macos-14', script: 'package:desktop:mac:arm64:unsigned' },
  { platform: 'mac-x64', runner: 'macos-13', script: 'package:desktop:mac:x64:unsigned' },
  { platform: 'win-x64', runner: 'windows-latest', script: 'package:desktop:win:x64:unsigned' },
]
const matrix = {
  include: candidates.flatMap((entry) => PLATFORMS.map((platform) => ({
    ...platform,
    tag: entry.tag,
    version: entry.version,
    sha: entry.sha,
  }))),
}
const tagMatrix = { include: candidates.map(({ tag, version, sha }) => ({ tag, version, sha })) }
const output = process.env.GITHUB_OUTPUT
if (output) {
  appendFileSync(output, `has=${candidates.length > 0}\n`)
  appendFileSync(output, `matrix=${JSON.stringify(matrix)}\n`)
  appendFileSync(output, `tags=${JSON.stringify(tagMatrix)}\n`)
}
const summary = process.env.GITHUB_STEP_SUMMARY
if (summary) {
  const lines = [`Selected ${candidates.length} tag(s) × ${PLATFORMS.length} platform(s).`, '']
  for (const entry of candidates) lines.push(`- \`${entry.tag}\` (${entry.sha?.slice(0, 10) ?? 'unknown'})`)
  appendFileSync(summary, `${lines.join('\n')}\n`)
}
process.stdout.write(`${JSON.stringify({ matrix, tags: tagMatrix }, null, 2)}\n`)
