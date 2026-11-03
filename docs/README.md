# Tubcal's website

The public page for Tubcal, served by GitHub Pages from this folder. It shows Tubcal in
short videos for people who want to use it, in plain language, with no code internals.
The technical side lives in the repository's own README and CLAUDE.md.

- `index.html`: one page. A wooden TV set stays on screen while a programme guide scrolls
  beside it; the entry you're reading plays on the set. Each entry has a short plain
  description and the steps the video goes through (they light up as it plays, and a
  click jumps to that moment). Below: how to install, a few facts, credits.
- `assets/video/<id>.mp4` and `<id>.webp`: one silent H.264 video (1920×1080) and poster
  per entry. Only the one on the set loads.
- `assets/css/showcase.css`, `assets/js/showcase.js`, `assets/fonts/` (Fraunces and
  Schibsted Grotesk, self-hosted), `assets/icon.svg`.
- `404.html`: self-contained, so it works at any depth.

Plain HTML, CSS and JavaScript. No build step for the page itself, no dependencies. With
reduced motion switched on, nothing plays until you press Play.

## The videos

They were recorded from a demo profile, not anyone's own data: a fresh database that
follows public YouTube channels, subreddits and GitHub projects, a made-up AniList list
named "You", and an editor folder with a public project in it. The films that play are
Blender Studio's open movies *Spring* and *Charge* (Creative Commons Attribution) and a
NASA video. The phone video comes from the Android emulator.

The guide's entries and their steps were written out together with the videos, by
recording scripts kept outside the repository (a git-excluded `.showcase/` folder in the
maintainer's checkout). Small wording changes can be made in `index.html` directly; if
the app's look changes, record the videos again.

## Publish

Repository **Settings → Pages → Build and deployment**: *Deploy from a branch*, branch
`main`, folder `/docs`. The site appears at `https://shio-t0.github.io/Tubcal/`.

## Preview locally

```bash
python -m http.server -d docs 8000   # → http://127.0.0.1:8000
```

Python's server doesn't answer range requests, so there the steps can't jump to their
moment in a video (it plays from the start instead). GitHub Pages answers them.
