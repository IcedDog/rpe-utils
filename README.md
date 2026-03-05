# rpe-utils

utilities for manipulating rpe chart files. windows only.

pretty much vibed 99% of it, so tons of redundant code. pr welcome.

## quick start

### create a new project

```bash
bun run init.ts my-project
cd my-project
bun install rpe-utils prettier
```

this creates:

- `INPUT/` - put your chart files here
- `index.ts` - your main script
- `reload.ts` - dev server with hot reload
- `run.ps1` - quick start script
- `config.json` - file copy config
- `.prettierrc.json` - prettier config (you'll definitely want to have a formatter when doing extensive works)
- `.prettierignore` - prettier ignore rules

then put your charts in INPUT.

record the files you want to copy to OUTPUT folder in `config.json`.

you can nest directories in config.json for better file organization.

### build and play the chart

this playing feature is built for PhiZone Player.

**run `.\run.ps1` to start the dev server.** it will automatically build the chart and open up the player's web page upon modification.

you can change the `WATCH_FILES` variable in `reload.ts` to `false` to disable file watching, and run reload manually.
