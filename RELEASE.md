# Releasing satz

satz is versioned with [ChronVer](https://chronver.org) (`YYYY.MM.DD`).

1. Set `version` in `ende.json` to today's date, e.g. `2026.10.18`, and land
   that on `primary` with CI green.
1. Create a GitHub release whose tag is exactly that version (`2026.10.18`, no
   `v`), from `primary`.
1. Publishing the release runs the `publish` workflow: it checks that the tag
   matches `ende.json`, runs `ende task ok`, and publishes to JSR with GitHub
   OIDC. That needs `@ende/satz` linked to `theende/satz` in its JSR settings.

The workflow can also be run by hand (`workflow_dispatch`), which skips the tag
check and publishes the version in `ende.json`.
