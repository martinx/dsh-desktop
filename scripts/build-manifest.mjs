#!/usr/bin/env node
// Collect every Desktop release into the JSON the download site renders.
//
// Release bodies carry a single-line marker written by the build workflows:
//   <!-- dsh-build: {"channel":"nightly","version":"0.2.1-alpha.5","sha":"…","builtAt":"…"} -->
import { execFileSync } from 'node:child_process'

const REPO = process.env.GH_REPO ?? process.env.GITHUB_REPOSITORY ?? 'martinx/dsh-desktop'
const UPSTREAM = process.env.UPSTREAM ?? 'deepseek-ai/deepseek-harness'
const MARKER = /<!--\s*dsh-build:\s*(\{.*?\})\s*-->/su

const gh = (args) => JSON.parse(execFileSync('gh', [...args, '--repo', REPO], { encoding: 'utf8' }))
const releases = gh(['release', 'list', '--limit', '200', '--json', 'tagName,publishedAt,isPrerelease'])

/** Map an installer filename to the platform it targets. */
function platformOf(name) {
  if (name.includes('-mac-arm64-')) return 'mac-arm64'
  if (name.includes('-mac-x64-')) return 'mac-x64'
  if (name.includes('-win-x64-')) return 'win-x64'
  return 'unknown'
}

const builds = []
for (const release of releases) {
  const detail = gh(['release', 'view', release.tagName, '--json', 'body,url,assets'])
  const marker = MARKER.exec(detail.body ?? '')
  if (!marker) continue
  let meta
  try {
    meta = JSON.parse(marker[1])
  } catch {
    continue
  }
  builds.push({
    channel: meta.channel,
    version: meta.version,
    sha: meta.sha,
    builtAt: meta.builtAt,
    tag: release.tagName,
    pageUrl: detail.url,
    assets: (detail.assets ?? []).map((asset) => ({
      name: asset.name,
      size: asset.size,
      downloads: asset.downloadCount,
      url: asset.url,
      platform: platformOf(asset.name),
      extension: asset.name.split('.').pop(),
    })),
  })
}

builds.sort((left, right) => String(right.builtAt).localeCompare(String(left.builtAt)))

process.stdout.write(`${JSON.stringify({
  generatedAt: new Date().toISOString(),
  upstream: UPSTREAM,
  repo: REPO,
  builds,
}, null, 2)}\n`)
