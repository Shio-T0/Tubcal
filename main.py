from server import brain, cache, config, db, notifier
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


def _backfill_avatars():
    """One-shot, in the background: fill in channel avatars for subscriptions
    that were added by channel id (older builds stored no thumbnail for those)."""
    import threading

    from server.sources import youtube

    def run():
        for sub in db.list_subscriptions("youtube"):
            if sub.get("thumbnail"):
                continue
            thumb = youtube.fetch_channel_avatar(sub["source_id"])
            if thumb:
                db.set_subscription_thumbnail(sub["id"], thumb)

    threading.Thread(target=run, daemon=True).start()


def main():
    db.init_db()
    app = create_app()
    _warm_caches()
    _backfill_avatars()
    notifier.start()
    brain.start()
    brain.edition.start()
    print(f"\n  Tubcal — private social hub")
    print(f"  http://{config.HOST}:{config.PORT}\n")
    app.run(host=config.HOST, port=config.PORT, debug=False, threaded=True)


if __name__ == "__main__":
    main()
