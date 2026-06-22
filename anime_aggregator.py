from fastapi import FastAPI, HTTPException
import requests
import uvicorn

app = FastAPI()

# ---------------------------------------
# CONFIG
# ---------------------------------------

# Existing Consumet-compatible backend
UPSTREAM = "http://127.0.0.1:4000"

ANILIST_API = "https://graphql.anilist.co"

# Simple cache
mapping_cache = {}

# ---------------------------------------
# AniList Helpers
# ---------------------------------------


def get_anilist_title(anilist_id: int):
    query = """
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        title {
          romaji
          english
        }
      }
    }
    """

    r = requests.post(
        ANILIST_API, json={"query": query, "variables": {"id": anilist_id}}, timeout=20
    )

    r.raise_for_status()

    media = r.json()["data"]["Media"]

    return media["title"]["english"] or media["title"]["romaji"]


def search_provider(title: str):
    r = requests.get(f"{UPSTREAM}/anime/gogoanime/{title}", timeout=30)

    r.raise_for_status()

    return r.json()


# ---------------------------------------
# Endpoint 1
# ---------------------------------------


@app.get("/meta/anilist/info/{anilist_id}")
def anime_info(anilist_id: int, provider: str | None = None):
    try:
        title = get_anilist_title(anilist_id)

        anime = search_provider(title)

        episodes = []

        for ep in anime.get("episodes", []):
            episode_id = ep["id"]

            mapping_cache[episode_id] = {"provider": provider, "anime": anilist_id}

            episodes.append(
                {
                    "id": episode_id,
                    "number": ep["number"],
                    "title": ep.get("title"),
                    "image": ep.get("image"),
                }
            )

        return {"totalEpisodes": len(episodes), "episodes": episodes}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------
# Endpoint 2
# ---------------------------------------


@app.get("/meta/anilist/watch/{episode_id:path}")
def watch(episode_id: str, provider: str | None = None):
    try:
        r = requests.get(f"{UPSTREAM}/anime/gogoanime/watch/{episode_id}", timeout=30)

        r.raise_for_status()

        data = r.json()

        return {
            "sources": data.get("sources", []),
            "subtitles": data.get("subtitles", []),
            "headers": data.get("headers", {}),
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/")
def root():
    return {"status": "running", "api": "Consumet META.Anilist"}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=3000)
