# herdr-changes-diff

A [Herdr](https://herdr.dev) mod: an IntelliJ-style Changes panel (local
changes plus unpushed commits, with a commit box that commits only the files
you leave checked and takes a multi-line message) and a side-by-side Diff tab
that walks through the changes with `↑`/`↓` or `F7`/`Shift+F7`.

![Changes + Diff](preview.png)

## Install

Ask your agent in Herdr:

> Read ~/.config/herdr-app/AGENTS.md, then add this mod: herdr.dev/mods/ausema/herdr-changes-diff

Then put `changes-ij` in your layout's Changes panel in place of `changes`.

It runs `git` in the repo you are working in (read-only, except `git add` and
`git commit` of the checked files when you press Commit) and makes no network calls. In a
folder that holds several repos, it finds them one level down with `find` and
shows one group per repo with changes.

## Develop

```sh
for m in changes-ij diff-ij; do (cd mods/$m && for t in test/*.test.js; do node --test "$t"; done); done
```

See [RECIPE.md](RECIPE.md) for how it looks and behaves.
