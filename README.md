# DSH Desktop builds

Unofficial, unsigned desktop builds of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), produced by GitHub Actions directly from upstream source.

- **Download site** — https://dsh.bitey.ai (bilingual, detects your OS, offers every published version)
- **Nightly** — rebuilds whenever upstream `master` moves; rolling `nightly` release
- **Versions** — one release per upstream `dsh-v*` tag

The site picks the right installer for the visitor's OS and lets them choose any published version. Download links point at the release assets.

Supported targets, limited by what upstream packaging defines:

| Platform | Target | Runner | Installer |
| --- | --- | --- | --- |
| macOS Apple silicon | `mac-arm64` | `macos-14` | `.dmg` |
| macOS Intel | `mac-x64` | `macos-14` (cross-build) | `.dmg` |
| Windows x64 | `win-x64` | `windows-latest` | `.exe` |
| Linux | — | — | not supported upstream |

`apps/desktop/scripts/electron-builder-config.mjs` carries an AppImage config, but the packaging pipeline (`package-target.ts`, `desktop-build-paths.mjs`) only implements `mac-arm64`, `mac-x64`, and `win-x64`. There is no Linux artifact path to drive.

## Why unsigned

Upstream packages the desktop app on self-hosted machines that hold Apple Developer ID certificates, notarization credentials, and Tencent COS upload keys; publication additionally needs a GitHub App key and approval environments. None of that runs in a public repository.

The upstream scripts do support credential-free packaging:

- macOS: `package:desktop:mac:{arm64,x64}:unsigned` takes `localMacOSPackageEnvironment()`, which ignores `apps/desktop/.env.macos` entirely.
- Windows: `package:desktop:win:x64:unsigned` still loads `apps/desktop/.env.windows`, so the workflow writes one with policy origins. This is why the Windows build is the least verified of the three.

Consequences:

- macOS quarantines the download. After copying the app to `/Applications`, run
  `xattr -dr com.apple.quarantine "/Applications/DeepSeek Harness.app"`.
- Windows shows SmartScreen (`More info` → `Run anyway`).
- Unsigned builds ship without the updater, so upgrading means downloading a newer installer.
- No notarization, so Gatekeeper reports an unidentified developer.

## Workflows

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `nightly.yml` | hourly cron (`:05`), manual | Resolve upstream `master`, build all three platforms, update the `nightly` release, redeploy the site |
| `versions.yml` | hourly cron (`:35`), manual | Find upstream `dsh-v*` tags without a release, build each tag on all platforms, publish per-tag releases, redeploy the site |
| `site.yml` | manual | Regenerate the manifest from current releases and redeploy the site |

Scheduled runs only build tags newer than the newest existing release, so a tag that fails to package cannot retry every hour forever. Manual `workflow_dispatch` with `backfill=true` builds missing older tags; `max_tags` caps how many run at once.

Release bodies carry a marker the site reads:

```
<!-- dsh-build: {"channel":"version","version":"0.2.1-alpha.5","sha":"…","builtAt":"…"} -->
```

`scripts/build-manifest.mjs` collects those markers into `site/data/builds.json`, adding a `platform` per asset parsed from the installer filename.

## Site

Static HTML/CSS/JS in `site/`, deployed with `actions/deploy-pages`. No build step: the page fetches `site/data/builds.json`, which the workflows regenerate before deploying.

- `site/CNAME` points at `dsh.bitey.ai`; DNS needs `CNAME dsh.bitey.ai → martinx.github.io`.
- Language toggle persists in `localStorage`; default follows `navigator.language`.
- Platform detection defaults Windows visitors to `win-x64` and everyone else to `mac-arm64`; visitors can switch manually.
- The version picker lists `nightly` first, then every version release.

## Caveat: GitHub download reachability

Release assets redirect to `objects.githubusercontent.com`. On networks where `github.com` resolves to a blocked address, downloads fail even though the site loads. If that becomes a problem, mirror assets to object storage (Cloudflare R2, Tencent COS) and point the download links there.

## Notice

Not affiliated with or endorsed by DeepSeek. "DeepSeek Harness" is a trademark of DeepSeek and is used here only to describe the source of these builds. Upstream is MIT licensed; this repository's workflows and site are MIT licensed as well.
