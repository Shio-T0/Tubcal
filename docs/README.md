# Tubcal docs site

The public site for Tubcal, served by GitHub Pages from this folder. It is written
for people who want to use Tubcal, not build it: plain language, no code internals.
The technical side lives in the repository's own README and CLAUDE.md.

- `index.html` — **The Tour** (key 1): the top (what Tubcal is, the install command, a guide to the three channels and their rooms, short facts), then a stop for the home screen, each channel (Social, Coding, Video), the Anime, Saved & Settings, the skins and privacy, ending with the install command again. Every room is shown as real screenshots (`assets/shots/app-<screen>-<skin>.webp` and `anime-<view>-<skin>.webp`, every screen in every skin, so they follow the skin picked on the page); the Edition and the player have playable demos, and Settings → Rooms has working switches. The `app-` shots come from a throwaway demo profile that follows public channels, subreddits and GitHub projects, not anyone's own feed; the Anime shots show a real list with the account renamed "You". Retake them when the app's look changes.
- `manual.html` — **The Manual** (key 2): install, first steps, the `tubcal` command, channels and rooms, saving, watching, the Anime, the optional AI, keyboard, settings, accounts, privacy and your data, troubleshooting, questions.
- `404.html` — self-contained, so it works at any depth.

Plain HTML, CSS and JavaScript. No build step, no dependencies, fonts self-hosted in `assets/fonts/`. The eight skins and the design tokens are copied from `frontend/src/styles/` (Cutting Mat's JetBrains Mono is self-hosted here too, Latin only), so if a skin changes there, update `assets/css/site.css` to match. The channels and the rooms' descriptions live in `assets/js/data.js`; keep them in step with `frontend/src/lib/rooms.js` when a room is added, moved or retired.

## Publish

Repository **Settings → Pages → Build and deployment**: *Deploy from a branch*, branch `main`, folder `/docs`. The site appears at `https://shio-t0.github.io/Tubcal/`.

## Preview locally

```bash
python -m http.server -d docs 8000   # → http://127.0.0.1:8000
```
