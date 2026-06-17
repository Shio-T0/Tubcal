from server import cache, config, db
from server import create_app


def _warm_caches():
    """Prime the slow 'picked for you' shelf in the background so it's ready by
    the time the browser opens, instead of computing on first request."""
    from server.sources import youtube

    def discover():
        subs = db.list_subscriptions("youtube")
        history = db.get_history("youtube")
        return youtube.get_discover([s["source_id"] for s in subs], history, region="US")

    cache.warm("yt:discover:US", config.TTL_YT_DISCOVER, discover)


def main():
    db.init_db()
    app = create_app()
    _warm_caches()
    print(f"\n  Tubcal — private social hub")
    print(f"  http://{config.HOST}:{config.PORT}\n")
    app.run(host=config.HOST, port=config.PORT, debug=False, threaded=True)


if __name__ == "__main__":
    main()
