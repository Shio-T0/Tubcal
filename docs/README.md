# Tubcal docs site

The documentation and presentation site for Tubcal, served by GitHub Pages from this folder.

- `index.html` — **The Tour** (channel 1): the chooser, then a playable demo of each part of the app.
- `manual.html` — **The Manual** (channel 2): install, configuration, keyboard, accounts, how it works, the API reference.
- `404.html` — self-contained, so it works at any depth.

Plain HTML, CSS and JavaScript. No build step, no dependencies, fonts self-hosted in `assets/fonts/`. The seven skins and the design tokens are copied from `frontend/src/styles/`, so if a skin changes there, update `assets/css/site.css` to match.

## Publish

Repository **Settings → Pages → Build and deployment**: *Deploy from a branch*, branch `main`, folder `/docs`. The site appears at `https://shio-t0.github.io/Tubcal/`.

## Preview locally

```bash
python -m http.server -d docs 8000   # → http://127.0.0.1:8000
```

## Keep the API reference current

`assets/js/routes.js` is generated from the blueprints in `server/api/`:

```bash
python docs/tools/extract_routes.py
```
