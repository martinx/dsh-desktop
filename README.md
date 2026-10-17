# DSH Desktop builds

Unofficial, unsigned macOS desktop builds of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), produced by GitHub Actions directly from upstream source and published here for download.

- **Nightly** — rebuilds whenever upstream `master` moves, published to the rolling `nightly` release.
- **Versions** — one release per upstream `dsh-v*` tag.
- **Site** — a static download page served from GitHub Pages.

This repository is not a fork and stores none of the upstream code. Every build checks out `deepseek-ai/deepseek-harness` at the resolved commit or tag.

## Why unsigned

Upstream packages the desktop app on self-hosted machines that hold Apple Developer ID certificates, notarization credentials, and Tencent COS upload keys. Those cannot run on a fork or a public repository. The upstream build scripts do support a credential-free mode (`package:desktop:mac:arm64:unsigned`, which skips the release dotenv and the updater), and that is the mode used here.

Consequences:

- macOS quarantines the download. After copying the app to `/Applications`, run
  `xattr -dr com.apple.quarantine "/Applications/DeepSeek Harness.app"`.
- The unsigned build has no updater, so upgrades mean downloading a newer image.
- No Apple notarization, so Gatekeeper shows the usual unidentified-developer warning.

## Workflows

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `nightly.yml` | hourly cron, manual | Resolve upstream `master`, package an unsigned arm64 image, update the `nightly` release, redeploy the site |
| `versions.yml` | hourly cron, manual | Find upstream `dsh-v*` tags without a release, package each, publish per-tag releases, redeploy the site |

Scheduled runs only build tags newer than the newest existing release, so a tag that fails to package cannot retry every hour forever. Manual `workflow_dispatch` with `backfill=true` builds missing older tags; `max_tags` caps how many run at once.

Release bodies carry a marker the site reads:

```
<!-- dsh-build: {"channel":"version","version":"0.2.1-alpha.5","sha":"…","builtAt":"…"} -->
```

`scripts/build-manifest.mjs` collects those markers into `site/data/builds.json` during deployment.

## Download site

Static HTML in `site/`, deployed with `actions/deploy-pages`. `site/CNAME` points at `dsh.bitey.ai`; DNS needs a `CNAME` record from `dsh.bitey.ai` to `martinx.github.io`. Until DNS resolves, the site is reachable at `https://martinx.github.io/dsh-desktop/` once Pages is enabled.

## Adding platforms

Only macOS arm64 is built. `apps/desktop/package.json` also exposes `package:desktop:mac:x64:unsigned` and `package:desktop:win:x64:unsigned`, but a Windows unsigned build still reads `apps/desktop/.env.windows`, which requires mandatory-update origins that would be baked into the app. Add a Windows job only after deciding what those origins should be.

## Notice

Not affiliated with or endorsed by DeepSeek. "DeepSeek Harness" is a trademark of DeepSeek and is used here only to describe the source of these builds. Upstream is MIT licensed; this repository's workflows and site are MIT licensed as well.
