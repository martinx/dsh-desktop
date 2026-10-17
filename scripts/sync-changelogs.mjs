#!/usr/bin/env node
// Snapshot every upstream release note this site ships, rendered to HTML.
//
// The landing page must not depend on github.com at view time, so the notes are
// captured here, converted once, and written to site/data/changelogs.json. The
// page only reads that file.
import { execFileSync } from 'node:child_process'

const REPO = process.env.GH_REPO ?? process.env.GITHUB_REPOSITORY ?? 'martinx/dsh-desktop'
const UPSTREAM = process.env.UPSTREAM ?? 'deepseek-ai/deepseek-harness'
const MARKER = /<!--\s*dsh-build:\s*(\{.*?\})\s*-->/su

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** Allow only absolute http(s) links; everything else renders as text. */
function safeUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function renderInline(text) {
  let html = escapeHtml(text)
  html = html.replace(/`([^`]+)`/gu, '<code>$1</code>')
  html = html.replace(/\*\*([^*]+)\*\*/gu, '<strong>$1</strong>')
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/gu, (match, label, href) => {
    const target = safeUrl(href.replaceAll('&amp;', '&'))
    return target ? `<a href="${escapeHtml(target)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label
  })
  return html
}

/**
 * Convert the subset of Markdown used by upstream release notes.
 *
 * Notes combine plain Markdown headings, lists, rules, and bold or linked text
 * with raw `<h3 id="…">` anchors, so raw HTML lines pass through unchanged.
 */
function renderMarkdown(markdown) {
  const lines = String(markdown ?? '').replaceAll('\r\n', '\n').split('\n')
  const out = []
  let list = []
  let paragraph = []
  let code = null
  let skippedNav = false

  const flushList = () => {
    if (!list.length) return
    out.push(`<ul>${list.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ul>`)
    list = []
  }
  const flushParagraph = () => {
    if (!paragraph.length) return
    out.push(`<p>${renderInline(paragraph.join(' '))}</p>`)
    paragraph = []
  }
  const flushAll = () => {
    flushList()
    flushParagraph()
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    const trimmed = line.trim()

    if (code !== null) {
      if (trimmed.startsWith('```')) {
        out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
        code = null
      } else {
        code.push(rawLine)
      }
      continue
    }
    if (trimmed.startsWith('```')) {
      flushAll()
      code = []
      continue
    }

    // The notes open with an in-page language switcher, which is meaningless here.
    if (!skippedNav && /^\[中文\]\(#|^\[English\]\(#/u.test(trimmed)) {
      skippedNav = true
      continue
    }
    skippedNav = true

    if (trimmed === '') {
      flushAll()
      continue
    }
    if (/^<[/a-zA-Z]/u.test(trimmed)) {
      flushAll()
      out.push(trimmed)
      continue
    }
    const heading = /^(#{2,4})\s+(.*)$/u.exec(trimmed)
    if (heading) {
      flushAll()
      const level = heading[1].length + 1
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`)
      continue
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/u.test(trimmed)) {
      flushAll()
      out.push('<hr>')
      continue
    }
    if (/^>\s?/u.test(trimmed)) {
      flushAll()
      out.push(`<blockquote>${renderInline(trimmed.replace(/^>\s?/u, ''))}</blockquote>`)
      continue
    }
    const item = /^[-*]\s+(.*)$/u.exec(trimmed)
    if (item) {
      flushParagraph()
      list.push(item[1])
      continue
    }
    const numbered = /^\d+\.\s+(.*)$/u.exec(trimmed)
    if (numbered) {
      flushParagraph()
      list.push(numbered[1])
      continue
    }
    flushList()
    paragraph.push(trimmed)
  }
  if (code !== null) out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
  flushAll()
  return out.join('\n')
}

/** Read the version our own release marker recorded. */
function releaseVersion(body) {
  const marker = MARKER.exec(body ?? '')
  if (!marker) return null
  try {
    return JSON.parse(marker[1]).version ?? null
  } catch {
    return null
  }
}

const releases = JSON.parse(gh(['release', 'list', '--repo', REPO, '--limit', '200', '--json', 'tagName,publishedAt,isPrerelease']))
const entries = {}

for (const release of releases) {
  const tag = release.tagName
  const detail = JSON.parse(gh(['release', 'view', tag, '--repo', REPO, '--json', 'body']))
  const version = releaseVersion(detail.body)
  const base = {
    tag,
    version,
    publishedAt: release.publishedAt,
    channel: tag === 'nightly' ? 'nightly' : 'version',
  }
  if (tag === 'nightly') {
    entries[tag] = { ...base, html: '', note: 'nightly tracks upstream master; see the versioned releases for per-version notes.' }
    continue
  }
  try {
    const upstream = JSON.parse(gh(['api', `repos/${UPSTREAM}/releases/tags/${tag}`]))
    entries[tag] = {
      ...base,
      title: upstream.name || version || tag,
      publishedAt: upstream.published_at || release.publishedAt,
      html: renderMarkdown(upstream.body),
    }
  } catch {
    entries[tag] = { ...base, html: '', note: `No upstream release note for ${tag}.` }
  }
}

process.stdout.write(`${JSON.stringify({
  generatedAt: new Date().toISOString(),
  upstream: UPSTREAM,
  entries,
}, null, 2)}\n`)
