from server import brain, cache, config, db, housekeeping, modules
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
    # Pull the latest anime-scraper fixes before anything imports it: allanime
    # changes its crypto every so often and the fix ships as an anipy-api
    # release. Best-effort — never blocks a normal (already-current) start.
    if modules.has("anime"):
        from server import updater
        updater.check_and_update()
    db.init_db()
    db.note_modules(modules.installed(), chosen=modules.chosen_explicitly())
    db.note_install({"objects_3d": config.INSTALL_3D})
    app = create_app()
    if modules.has("youtube"):
        from server import notifier
        _warm_caches()
        _backfill_avatars()
        notifier.start()
    brain.start()
    housekeeping.start()
    print(f"\n  Tubcal — private social hub")
    print(f"  http://{config.HOST}:{config.PORT}\n")
    app.run(host=config.HOST, port=config.PORT, debug=False, threaded=True)


if __name__ == "__main__":
    main()
