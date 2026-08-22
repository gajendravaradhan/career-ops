# app-pack-v1

`app-pack-v1` is the local, update-safe application-package overlay. Its Git
commit contains only files under `local-tools/`; it does not replace upstream
career-ops modes, scripts, templates, or package metadata.

Normal `node update-system.mjs apply` updates should preserve the overlay
because `config/local-paths.txt` declares `local-tools/` as user-owned. After a
raw upstream reset, restore it from the local annotated tag:

```sh
git cherry-pick app-pack-v1
node local-tools/app-pack-v1-overlay.mjs apply
node local-tools/app-pack-v1-overlay.mjs verify
node --test local-tools/application-package.test.mjs local-tools/app-pack-v1-overlay.test.mjs
node validate-system-paths-coverage.mjs
```

The installer changes only:

- the single `local-tools/` declaration in `config/local-paths.txt`; and
- the content between `<!-- app-pack-v1:start -->` and
  `<!-- app-pack-v1:end -->` in `modes/_custom.md`.

It preserves all other user rules. A malformed or duplicated marker block
fails closed instead of guessing what to overwrite.
