from server import config, db
from server import create_app


def main():
    db.init_db()
    app = create_app()
    print(f"\n  Tubcal — private social hub")
    print(f"  http://{config.HOST}:{config.PORT}\n")
    app.run(host=config.HOST, port=config.PORT, debug=False, threaded=True)


if __name__ == "__main__":
    main()
