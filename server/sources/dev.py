"""The Workbench source — one programming language per "service manual".

A language entry in LANGUAGES is pure curation: identity (name, mascot, accent),
spec-sheet facts, the reference shelf (docs), the bench radio dial (podcast RSS
feeds), and the change-log wires (core-team blog feeds + the language's GitHub
repo for releases). Everything dynamic hangs off that registry, so adding a
language is adding one dict — no new endpoints, no new UI.

Feed parsing is deliberately namespace-agnostic (local-name matching over
xml.etree) because the wires span RSS 2.0, Atom, and itunes-flavoured podcast
RSS; every remote fetch is best-effort per-feed and cached, so one dead feed
never blanks a shelf.
"""

from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote

from .. import cache, config, httpc

LANGUAGES = {
    "rust": {
        "id": "rust",
        "name": "Rust",
        "mascot": "🦀",
        "tagline": "Fast, reliable software — the compiler holds the other end of the board.",
        "accent": "#d0673f",
        "site": "https://www.rust-lang.org",
        "repo": "rust-lang/rust",
        "gh_language": "Rust",
        "video_query": "rust programming language",
        "facts": [
            ["first stable", "May 2015 · v1.0"],
            ["typing", "static, inferred"],
            ["memory", "ownership & borrows — no GC"],
            ["package manager", "cargo · crates.io"],
            ["compiles via", "LLVM, to native"],
            ["release train", "every six weeks"],
            ["mascot", "Ferris the crab"],
        ],
        "docs": [
            {"title": "The Rust Book", "note": "the front-to-back introduction; where everyone starts", "url": "https://doc.rust-lang.org/book/", "kind": "book"},
            {"title": "Standard library", "note": "std API reference — the page you keep open", "url": "https://doc.rust-lang.org/std/", "kind": "reference"},
            {"title": "Rust by Example", "note": "the whole language as runnable snippets", "url": "https://doc.rust-lang.org/rust-by-example/", "kind": "practice"},
            {"title": "The Cargo Book", "note": "workspaces, features, profiles, publishing", "url": "https://doc.rust-lang.org/cargo/", "kind": "reference"},
            {"title": "The Rustonomicon", "note": "unsafe Rust, for when the gloves come off", "url": "https://doc.rust-lang.org/nomicon/", "kind": "book"},
            {"title": "docs.rs", "note": "rendered docs for every crate on crates.io", "url": "https://docs.rs", "kind": "reference"},
            {"title": "Rustlings", "note": "small exercises to get the borrow checker under your fingers", "url": "https://rustlings.rust-lang.org/", "kind": "practice"},
            {"title": "The Playground", "note": "compile and share snippets in the browser", "url": "https://play.rust-lang.org/", "kind": "tool"},
        ],
        "podcasts": [
            {"show": "Rustacean Station", "rss": "https://rustacean-station.org/podcast.rss", "home": "https://rustacean-station.org"},
            {"show": "Oxide and Friends", "rss": "https://feeds.transistor.fm/oxide-and-friends", "home": "https://oxide.computer/podcasts/oxide-and-friends"},
        ],
        "feeds": [
            {"name": "Rust Blog", "url": "https://blog.rust-lang.org/feed.xml"},
            {"name": "Inside Rust", "url": "https://blog.rust-lang.org/inside-rust/feed.xml"},
            {"name": "This Week in Rust", "url": "https://this-week-in-rust.org/rss.xml"},
        ],
    },
    "python": {
        "id": "python",
        "name": "Python",
        "mascot": "🐍",
        "tagline": "Executable pseudocode with three decades of batteries included.",
        "accent": "#4c8cc9",
        "site": "https://www.python.org",
        "repo": "python/cpython",
        "tag_re": r"^v(\d+\.\d+\.\d+)$",  # finals only — skip a5/b3/rc tags
        "gh_language": "Python",
        "video_query": "python programming",
        "facts": [
            ["first release", "February 1991"],
            ["typing", "dynamic · gradual hints"],
            ["memory", "refcounting + cycle GC"],
            ["package manager", "pip · PyPI"],
            ["runs on", "CPython bytecode VM"],
            ["release train", "one minor per year"],
            ["named after", "Monty Python, not the snake"],
        ],
        "docs": [
            {"title": "The Tutorial", "note": "the official walk through the language", "url": "https://docs.python.org/3/tutorial/", "kind": "book"},
            {"title": "Library reference", "note": "the standard library, module by module", "url": "https://docs.python.org/3/library/", "kind": "reference"},
            {"title": "Language reference", "note": "the grammar and data model, precisely", "url": "https://docs.python.org/3/reference/", "kind": "reference"},
            {"title": "PEP index", "note": "every Python Enhancement Proposal, the language's paper trail", "url": "https://peps.python.org", "kind": "reference"},
            {"title": "Packaging guide", "note": "building, publishing, and pinning distributions", "url": "https://packaging.python.org", "kind": "book"},
            {"title": "PyPI", "note": "the package index itself", "url": "https://pypi.org", "kind": "tool"},
        ],
        "podcasts": [
            {"show": "Talk Python To Me", "rss": "https://talkpython.fm/episodes/rss", "home": "https://talkpython.fm"},
            {"show": "Python Bytes", "rss": "https://pythonbytes.fm/episodes/rss", "home": "https://pythonbytes.fm"},
            {"show": "The Real Python Podcast", "rss": "https://realpython.com/podcasts/rpp/feed", "home": "https://realpython.com/podcasts/rpp/"},
        ],
        "feeds": [
            {"name": "Python Insider", "url": "https://blog.python.org/feeds/posts/default?alt=rss"},
            {"name": "PSF Blog", "url": "https://pyfound.blogspot.com/feeds/posts/default?alt=rss"},
        ],
    },
    "go": {
        "id": "go",
        "name": "Go",
        "mascot": "🐹",
        "tagline": "Small language, fast compiler, goroutines for everything else.",
        "accent": "#4fb3ce",
        "site": "https://go.dev",
        "repo": "golang/go",
        # golang/go doesn't cut GitHub releases and its /tags listing is
        # lexicographic (pages of ancient weekly.* refs first) — go.dev's own
        # download manifest is the authoritative stable list.
        "version_url": "https://go.dev/dl/?mode=json",
        "gh_language": "Go",
        "video_query": "golang programming",
        "facts": [
            ["first stable", "March 2012 · go1"],
            ["typing", "static, structural interfaces"],
            ["memory", "concurrent tri-color GC"],
            ["package manager", "go modules · proxy.golang.org"],
            ["compiles to", "static native binaries"],
            ["release train", "every six months"],
            ["mascot", "the Go gopher"],
        ],
        "docs": [
            {"title": "A Tour of Go", "note": "the interactive first pass", "url": "https://go.dev/tour/", "kind": "book"},
            {"title": "Standard library", "note": "pkg.go.dev/std — the whole stdlib", "url": "https://pkg.go.dev/std", "kind": "reference"},
            {"title": "Effective Go", "note": "how idiomatic Go is actually written", "url": "https://go.dev/doc/effective_go", "kind": "book"},
            {"title": "Go by Example", "note": "annotated programs for every corner", "url": "https://gobyexample.com", "kind": "practice"},
            {"title": "The spec", "note": "short enough to read in an afternoon", "url": "https://go.dev/ref/spec", "kind": "reference"},
            {"title": "The Playground", "note": "run and share snippets in the browser", "url": "https://go.dev/play/", "kind": "tool"},
        ],
        "podcasts": [
            {"show": "Go Time", "rss": "https://changelog.com/gotime/feed", "home": "https://changelog.com/gotime"},
        ],
        "feeds": [
            {"name": "The Go Blog", "url": "https://go.dev/blog/feed.atom"},
            {"name": "Golang Weekly", "url": "https://golangweekly.com/rss"},
        ],
    },
    "typescript": {
        "id": "typescript",
        "name": "TypeScript",
        "mascot": "🧩",
        "tagline": "JavaScript that tells you what it is before it runs.",
        "accent": "#6f8fc9",
        "site": "https://www.typescriptlang.org",
        "repo": "microsoft/TypeScript",
        "gh_language": "TypeScript",
        "video_query": "typescript programming",
        "facts": [
            ["first release", "October 2012"],
            ["typing", "static, structural — erased at runtime"],
            ["compiles to", "plain JavaScript"],
            ["package manager", "npm · the JS ecosystem"],
            ["type ecosystem", "DefinitelyTyped / @types"],
            ["release train", "roughly quarterly"],
            ["stewarded by", "Microsoft, in the open"],
        ],
        "docs": [
            {"title": "The Handbook", "note": "the canonical guide to the type system", "url": "https://www.typescriptlang.org/docs/handbook/intro.html", "kind": "book"},
            {"title": "The Playground", "note": "try types against any compiler version", "url": "https://www.typescriptlang.org/play", "kind": "tool"},
            {"title": "Release notes", "note": "what each compiler version added", "url": "https://www.typescriptlang.org/docs/handbook/release-notes/overview.html", "kind": "reference"},
            {"title": "Do's and Don'ts", "note": "declaration-file style, from the source", "url": "https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html", "kind": "book"},
            {"title": "Type search", "note": "find @types packages for any library", "url": "https://www.typescriptlang.org/dt/search", "kind": "tool"},
            {"title": "tsconfig reference", "note": "every compiler flag, explained", "url": "https://www.typescriptlang.org/tsconfig/", "kind": "reference"},
        ],
        "podcasts": [
            {"show": "Syntax", "rss": "https://feed.syntax.fm/rss", "home": "https://syntax.fm"},
            {"show": "JS Party", "rss": "https://changelog.com/jsparty/feed", "home": "https://changelog.com/jsparty"},
        ],
        "feeds": [
            {"name": "TypeScript Blog", "url": "https://devblogs.microsoft.com/typescript/feed/"},
        ],
    },
}

# Display order on the shelf — Rust first, it's the featured manual.
LANGUAGE_ORDER = ["rust", "python", "go", "typescript"]

EPISODES_PER_SHOW = 8
UPDATES_CAP = 40


def get_language(lang_id):
    """Return the registry entry for a language id, or None."""
    return LANGUAGES.get((lang_id or "").lower())


def list_languages():
    """The shelf: id/name/mascot/accent/tagline for every language, in order."""
    out = []
    for lid in LANGUAGE_ORDER:
        lang = LANGUAGES[lid]
        out.append({k: lang[k] for k in ("id", "name", "mascot", "accent", "tagline")})
    return out


def dossier(lang_id):
    """The static manual front-matter — pure registry, no network."""
    lang = get_language(lang_id)
    if not lang:
        return None
    return {k: v for k, v in lang.items() if k not in ("video_query",)}


# ---------------------------------------------------------------------------
# Feed parsing (RSS 2.0 / Atom / podcast RSS), namespace-agnostic.

def _local(tag):
    """Strip the XML namespace: '{ns}title' → 'title'."""
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _child_text(el, name):
    for c in el:
        if _local(c.tag) == name and c.text:
            return c.text.strip()
    return None


def _parse_date(text):
    """Epoch seconds from an RFC-822 (RSS) or ISO-8601 (Atom) date. 0 on failure."""
    if not text:
        return 0
    text = text.strip()
    try:
        from email.utils import parsedate_to_datetime
        return int(parsedate_to_datetime(text).timestamp())
    except (ValueError, TypeError):
        pass
    try:
        from datetime import datetime
        return int(datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp())
    except (ValueError, TypeError):
        return 0


def _parse_duration(text):
    """itunes:duration is either plain seconds or H:MM:SS / MM:SS. None on failure."""
    if not text:
        return None
    text = text.strip()
    if text.isdigit():
        return int(text)
    parts = text.split(":")
    if all(p.isdigit() for p in parts) and 1 < len(parts) <= 3:
        secs = 0
        for p in parts:
            secs = secs * 60 + int(p)
        return secs
    return None


def _atom_link(el):
    """Best <link> from an Atom entry: prefer rel=alternate, take href."""
    fallback = None
    for c in el:
        if _local(c.tag) != "link":
            continue
        href = c.get("href")
        if not href:
            continue
        if c.get("rel") in (None, "alternate"):
            return href
        fallback = fallback or href
    return fallback


def _entry_common(el, is_atom):
    """Fields shared by blog posts and podcast episodes."""
    title = _child_text(el, "title") or ""
    if is_atom:
        url = _atom_link(el)
        published = _child_text(el, "published") or _child_text(el, "updated")
        summary = _child_text(el, "summary") or _child_text(el, "content")
    else:
        url = _child_text(el, "link")
        published = _child_text(el, "pubDate") or _child_text(el, "date")
        summary = _child_text(el, "description")
    return title, url, _parse_date(published), summary


def _strip_html(text, limit=280):
    if not text:
        return ""
    import re
    clean = re.sub(r"<[^>]+>", " ", text)
    clean = re.sub(r"\s+", " ", clean).strip()
    return clean[:limit]


def parse_feed(xml_text):
    """Parse RSS 2.0 or Atom into {title, image, entries:[...]}.

    Each entry: {title, url, published_at, summary, audio, duration}. `audio`
    comes from an RSS <enclosure> (podcast feeds); blog feeds simply have none.
    """
    import xml.etree.ElementTree as ET

    root = ET.fromstring(xml_text)
    is_atom = _local(root.tag) == "feed"
    channel = root if is_atom else next(
        (c for c in root if _local(c.tag) == "channel"), root
    )

    feed_title = _child_text(channel, "title") or ""
    feed_image = None
    for c in channel:
        name = _local(c.tag)
        if name == "image":
            # itunes:image carries href; RSS <image> nests a <url>
            feed_image = c.get("href") or _child_text(c, "url") or feed_image
            if feed_image:
                break

    entries = []
    entry_tag = "entry" if is_atom else "item"
    for el in channel.iter():
        if _local(el.tag) != entry_tag:
            continue
        title, url, published_at, summary = _entry_common(el, is_atom)
        audio = None
        duration = None
        image = None
        for c in el:
            name = _local(c.tag)
            if name == "enclosure" and c.get("url"):
                mime = c.get("type") or ""
                if not mime or mime.startswith("audio"):
                    audio = c.get("url")
            elif name == "duration":
                duration = _parse_duration(c.text)
            elif name == "image":
                image = c.get("href") or image
        entries.append({
            "title": title,
            "url": url,
            "published_at": published_at,
            "summary": _strip_html(summary),
            "audio": audio,
            "duration": duration,
            "image": image,
        })
    return {"title": feed_title, "image": feed_image, "entries": entries}


def _fetch_feed(url):
    return parse_feed(httpc.get(url).text)


# ---------------------------------------------------------------------------
# The shelves.

def videos(lang_id):
    """Talks & tutorials — YouTube-wide search via Invidious, playable in-app."""
    lang = get_language(lang_id)
    if not lang:
        return {"items": []}
    from . import invidious
    return invidious.search(lang["video_query"], page=1)


def podcasts(lang_id):
    """Recent episodes from the language's curated shows, merged newest-first."""
    lang = get_language(lang_id)
    if not lang:
        return {"episodes": []}

    def fetch():
        def one(show):
            try:
                feed = _fetch_feed(show["rss"])
            except Exception:
                return []
            eps = []
            for e in feed["entries"][:EPISODES_PER_SHOW * 3]:
                if not e["audio"]:
                    continue
                eps.append({
                    "id": f"dev:pod:{lang['id']}:{e['audio']}",
                    "title": e["title"],
                    "url": e["url"] or show["home"],
                    "audio": e["audio"],
                    "published_at": e["published_at"],
                    "duration": e["duration"],
                    "summary": e["summary"],
                    "show": show["show"],
                    "show_home": show["home"],
                    "show_art": e["image"] or feed["image"],
                })
                if len(eps) >= EPISODES_PER_SHOW:
                    break
            return eps

        with ThreadPoolExecutor(max_workers=4) as ex:
            per_show = list(ex.map(one, lang["podcasts"]))
        episodes = [e for lst in per_show for e in lst]
        episodes.sort(key=lambda e: e["published_at"] or 0, reverse=True)
        return episodes

    episodes, stale = cache.cached(f"dev:pods:{lang['id']}", config.TTL_DEV_PODCASTS, fetch)
    return {"episodes": episodes or [], "stale": stale}


def updates(lang_id):
    """The change log: GitHub releases + core-team blog dispatches, one stream."""
    lang = get_language(lang_id)
    if not lang:
        return {"items": []}

    def fetch():
        items = []

        def one_feed(feed_def):
            try:
                feed = _fetch_feed(feed_def["url"])
            except Exception:
                return []
            out = []
            for e in feed["entries"][:15]:
                if not e["url"]:
                    continue
                out.append({
                    "id": f"dev:blog:{lang['id']}:{e['url']}",
                    "type": "blog",
                    "title": e["title"],
                    "url": e["url"],
                    "source": feed_def["name"],
                    "published_at": e["published_at"],
                    "summary": e["summary"],
                })
            return out

        def gh_releases():
            from . import github
            try:
                data = github._fetch(f"/repos/{quote(lang['repo'])}/releases?per_page=8")
            except Exception:
                return []
            out = []
            for r in data or []:
                if not isinstance(r, dict) or not r.get("tag_name"):
                    continue
                out.append({
                    "id": f"dev:release:{lang['id']}:{r.get('id') or r['tag_name']}",
                    "type": "release",
                    "title": r.get("name") or r["tag_name"],
                    "tag": r["tag_name"],
                    "url": r.get("html_url") or "",
                    "source": lang["repo"],
                    "published_at": _parse_iso(r.get("published_at") or r.get("created_at")),
                    "prerelease": bool(r.get("prerelease")),
                    "summary": _strip_html(r.get("body") or "", 200),
                })
            return out

        jobs = [lambda f=f: one_feed(f) for f in lang["feeds"]] + [gh_releases]
        with ThreadPoolExecutor(max_workers=4) as ex:
            results = list(ex.map(lambda fn: fn(), jobs))
        for lst in results:
            items.extend(lst)
        items.sort(key=lambda i: i["published_at"] or 0, reverse=True)
        return items[:UPDATES_CAP]

    items, stale = cache.cached(f"dev:updates:{lang['id']}", config.TTL_DEV_UPDATES, fetch)
    return {"items": items or [], "stale": stale}


def _parse_iso(iso_str):
    if not iso_str:
        return 0
    try:
        from datetime import datetime
        return int(datetime.fromisoformat(iso_str.replace("Z", "+00:00")).timestamp())
    except (ValueError, TypeError):
        return 0


def release(lang_id):
    """The "current stable" stamp — best-effort, from GitHub.

    rust/TypeScript publish real GitHub releases; CPython and Go only tag, and
    their /tags listing is neither chronological nor stable-only — so the
    fallback filters tags through the language's `tag_re` (which excludes
    betas/rc's and Go's ancient weekly.* refs) and takes the highest version.
    Returns {} when nothing resolves — the stamp just doesn't get inked.
    """
    lang = get_language(lang_id)
    if not lang:
        return {}

    def fetch():
        from . import github
        if lang.get("version_url"):
            try:
                data = httpc.get(lang["version_url"]).json()
                stable = next(
                    (d for d in data if d.get("stable") and d.get("version")), None
                )
                if stable:
                    return {
                        "tag": stable["version"],
                        "url": f"{lang['site']}/doc/devel/release",
                        "published_at": 0,
                    }
            except Exception:
                pass
        if not lang.get("tag_re"):
            try:
                r = github._fetch(f"/repos/{quote(lang['repo'])}/releases/latest")
                if isinstance(r, dict) and r.get("tag_name"):
                    return {
                        "tag": r["tag_name"],
                        "url": r.get("html_url") or "",
                        "published_at": _parse_iso(r.get("published_at")),
                    }
            except Exception:
                pass
        try:
            import re
            tag_re = re.compile(lang.get("tag_re") or r"^v?(\d+(?:\.\d+)+)$")
            tags = github._fetch(f"/repos/{quote(lang['repo'])}/tags?per_page=100")
            best = None
            for t in tags or []:
                m = tag_re.match(t.get("name") or "")
                if not m:
                    continue
                ver = tuple(int(p) for p in m.group(1).split("."))
                if best is None or ver > best[0]:
                    best = (ver, t["name"])
            if best:
                return {
                    "tag": best[1],
                    "url": f"https://github.com/{lang['repo']}/releases/tag/{quote(best[1])}",
                    "published_at": 0,
                }
        except Exception:
            pass
        return {}

    data, _ = cache.cached(f"dev:release:{lang['id']}", config.TTL_DEV_RELEASE, fetch)
    return data or {}


def repos(lang_id, period="weekly"):
    """What's being built — trending repos in this language, via the GitHub source."""
    lang = get_language(lang_id)
    if not lang:
        return {"items": []}
    from . import github
    return github.trending(period=period, language=lang["gh_language"])
