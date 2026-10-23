import logging
import json
import os
import re
import secrets
import threading
from pathlib import Path

import pyodbc
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, redirect, request, send_from_directory, session, stream_with_context, url_for
from werkzeug.security import check_password_hash, generate_password_hash


BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BACKEND_DIR.parent
FRONTEND_DIR = PROJECT_DIR / "frontend"
load_dotenv(BACKEND_DIR / ".env")

DATABASE_NAME = "YUGIOHDB"
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{3,24}$")
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
CHARACTER_IDS = {"kaiba-seto", "muto-yugi", "jonouchi-katsuya"}
CARD_DATA_PATH = BACKEND_DIR / "data" / "cards.json"
ASSETS_DIR = BACKEND_DIR / "assets"
SHOP_PACKS = {
    "kaiba": {
        "character_id": "kaiba",
        "owner": "SETO KAIBA",
        "name": "Gói Bài Rồng",
        "description": "Sức mạnh của rồng xanh mắt trắng",
    },
    "yugi": {
        "character_id": "yugi",
        "owner": "YAMI YUGI",
        "name": "Gói Bài Phù Thủy",
        "description": "Đánh thức sức mạnh ngàn năm",
    },
    "jonouchi": {
        "character_id": "jonouchi",
        "owner": "JONOUCHI KATSUYA",
        "name": "Gói Bài Chiến Binh",
        "description": "Những lá bài gắn với Jonouchi Katsuya",
    },
}
PACK_PURCHASES = {
    1: ("Gems", 1),
    10: ("Gems", 10),
    50: ("Gold", 30000),
}
GEM_EXCHANGE_OPTIONS = {
    100: 1000,
    1000: 10000,
    6000: 60000,
}

app = Flask(__name__, static_folder=None)
app.secret_key = os.environ.get("FLASK_SECRET_KEY")
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "false").lower() == "true",
)
app.logger.setLevel(logging.INFO)

HTML_PAGE_PATHS = {"/", "/login", "/start", "/login.html", "/start.html", "/index.html", "/duel.html"}


@app.after_request
def prevent_html_page_caching(response):
    if request.path in HTML_PAGE_PATHS:
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


_schema_ready = False
_schema_lock = threading.Lock()
_app_instance_id = secrets.token_urlsafe(32)


class AuthConfigurationError(Exception):
    pass


def _required_setting(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise AuthConfigurationError(f"{name} chưa được cấu hình trong backend/.env.")
    return value


def _odbc_value(value):
    return "{" + value.replace("}", "}}") + "}"


def _connection_string(database):
    driver = os.environ.get("SQL_DRIVER", "ODBC Driver 18 for SQL Server").strip()
    server = os.environ.get("SQL_SERVER", r".\SQLEXPRESS").strip()
    encrypt = os.environ.get("SQL_ENCRYPT", "no").strip()
    parts = [
        f"DRIVER={_odbc_value(driver)};"
        f"SERVER={_odbc_value(server)};",
        f"DATABASE={_odbc_value(database)};",
        f"Encrypt={encrypt};",
        "TrustServerCertificate=yes;",
    ]
    auth_mode = os.environ.get("SQL_AUTH_MODE", "windows").strip().lower()
    if auth_mode == "windows":
        parts.append("Trusted_Connection=yes;")
    elif auth_mode == "sql":
        parts.extend(
            [
                f"UID={_odbc_value(_required_setting('SQL_USERNAME'))};",
                f"PWD={_odbc_value(_required_setting('SQL_PASSWORD'))};",
            ]
        )
    else:
        raise AuthConfigurationError("SQL_AUTH_MODE chỉ nhận giá trị 'windows' hoặc 'sql'.")
    return "".join(parts)


def _ensure_schema():
    global _schema_ready
    if _schema_ready:
        return

    with _schema_lock:
        if _schema_ready:
            return

        _required_setting("FLASK_SECRET_KEY")
        with pyodbc.connect(
            _connection_string("master"),
            timeout=5,
            autocommit=True,
        ) as master_connection:
            master_connection.cursor().execute(
                "IF DB_ID(N'YUGIOHDB') IS NULL CREATE DATABASE [YUGIOHDB]"
            )
            master_connection.cursor().execute("ALTER DATABASE [YUGIOHDB] SET AUTO_CLOSE OFF")

        with pyodbc.connect(
            _connection_string(DATABASE_NAME),
            timeout=5,
            autocommit=True,
        ) as connection:
            cursor = connection.cursor()
            cursor.execute(
                """
                IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
                BEGIN
                    CREATE TABLE dbo.Users (
                        Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                        Username NVARCHAR(24) NOT NULL,
                        PlayerName NVARCHAR(24) NOT NULL,
                        Email NVARCHAR(254) NOT NULL,
                        PasswordHash NVARCHAR(255) NOT NULL,
                        CreatedAt DATETIME2 NOT NULL
                            CONSTRAINT DF_Users_CreatedAt DEFAULT SYSUTCDATETIME()
                    )
                END
                """
            )
            cursor.execute(
                """
                IF COL_LENGTH(N'dbo.Users', N'PlayerName') IS NULL
                    ALTER TABLE dbo.Users ADD PlayerName NVARCHAR(24) NULL;
                """
            )
            cursor.execute(
                """
                UPDATE dbo.Users
                SET PlayerName = Username
                WHERE PlayerName IS NULL OR LTRIM(RTRIM(PlayerName)) = N'';
                """
            )
            cursor.execute(
                """
                ALTER TABLE dbo.Users ALTER COLUMN PlayerName NVARCHAR(24) NOT NULL;
                """
            )
            cursor.execute(
                """
                IF COL_LENGTH(N'dbo.Users', N'SelectedCharacterId') IS NULL
                    ALTER TABLE dbo.Users ADD SelectedCharacterId NVARCHAR(32) NOT NULL
                        CONSTRAINT DF_Users_SelectedCharacterId
                        DEFAULT (N'jonouchi-katsuya') WITH VALUES;
                """
            )
            cursor.execute(
                """
                IF COL_LENGTH(N'dbo.Users', N'Gold') IS NULL
                    ALTER TABLE dbo.Users ADD Gold BIGINT NOT NULL
                        CONSTRAINT DF_Users_Gold DEFAULT (103000) WITH VALUES;
                IF COL_LENGTH(N'dbo.Users', N'Gems') IS NULL
                    ALTER TABLE dbo.Users ADD Gems INT NOT NULL
                        CONSTRAINT DF_Users_Gems DEFAULT (3500) WITH VALUES;
                """
            )

            cursor.execute(
                """
                IF NOT EXISTS (
                    SELECT 1 FROM sys.indexes
                    WHERE name = N'UX_Users_Username' AND object_id = OBJECT_ID(N'dbo.Users')
                )
                    CREATE UNIQUE INDEX UX_Users_Username ON dbo.Users(Username)
                """
            )
            cursor.execute(
                """
                IF NOT EXISTS (
                    SELECT 1 FROM sys.indexes
                    WHERE name = N'UX_Users_Email' AND object_id = OBJECT_ID(N'dbo.Users')
                )
                    CREATE UNIQUE INDEX UX_Users_Email ON dbo.Users(Email)
                """
            )
            cursor.execute(
                """
                IF OBJECT_ID(N'dbo.PlayerCards', N'U') IS NULL
                BEGIN
                    CREATE TABLE dbo.PlayerCards (
                        UserId INT NOT NULL,
                        CardId NVARCHAR(64) NOT NULL,
                        Quantity INT NOT NULL,
                        CONSTRAINT PK_PlayerCards PRIMARY KEY (UserId, CardId),
                        CONSTRAINT FK_PlayerCards_Users FOREIGN KEY (UserId)
                            REFERENCES dbo.Users(Id) ON DELETE CASCADE,
                        CONSTRAINT CK_PlayerCards_Quantity CHECK (Quantity > 0)
                    )
                END
                """
            )
        _schema_ready = True


def _database_error(error):
    app.logger.error("SQL Server operation failed: %s", error)
    return jsonify(
        error="Không thể kết nối hoặc khởi tạo cơ sở dữ liệu. Hãy kiểm tra SQL Server, ODBC Driver và cấu hình backend/.env."
    ), 503


def _request_data():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def _current_user():
    user_id = session.get("user_id")
    username = session.get("username")
    if (
        not isinstance(user_id, int)
        or not isinstance(username, str)
        or session.get("app_instance_id") != _app_instance_id
    ):
        return None
    player_name = session.get("player_name")
    if not isinstance(player_name, str) or not player_name.strip():
        player_name = username
    character_id = session.get("selected_character_id")
    if not isinstance(character_id, str) or character_id not in CHARACTER_IDS:
        character_id = "jonouchi-katsuya"
    return {
        "id": user_id,
        "username": username,
        "player_name": player_name,
        "selected_character_id": character_id,
    }


def _load_card_data():
    with CARD_DATA_PATH.open("r", encoding="utf-8") as card_file:
        data = json.load(card_file)
    if not isinstance(data, dict) or not isinstance(data.get("cards"), list):
        raise ValueError("Dữ liệu cards.json không hợp lệ.")
    return data


def _load_card_catalog():
    return _load_card_data()["cards"]


def _shop_state(cursor, user_id):
    wallet = cursor.execute(
        "SELECT Gold, Gems FROM dbo.Users WHERE Id = ?", user_id
    ).fetchone()
    if not wallet:
        return None

    quantities = {
        row.CardId: int(row.Quantity)
        for row in cursor.execute(
            "SELECT CardId, Quantity FROM dbo.PlayerCards WHERE UserId = ?",
            user_id,
        ).fetchall()
    }
    catalog = _load_card_catalog()
    packs = []
    for pack_id, definition in SHOP_PACKS.items():
        pack_cards = []
        for card in catalog:
            if definition["character_id"] not in card.get("characterIds", []):
                continue
            pack_cards.append({**card, "ownedQuantity": quantities.get(card["id"], 0)})
        packs.append({"id": pack_id, **definition, "cards": pack_cards})

    return {
        "wallet": {"gold": int(wallet.Gold), "gems": int(wallet.Gems)},
        "packs": packs,
    }


@app.get("/")
def home():
    return send_from_directory(FRONTEND_DIR, "login.html")


@app.get("/login")
def login_page():
    return home()


@app.get("/start")
def start_page():
    if not _current_user():
        return redirect(url_for("home"))
    return send_from_directory(FRONTEND_DIR, "start.html")


@app.get("/start.html")
def start_html():
    return start_page()


@app.get("/index.html")
def game():
    if not _current_user():
        return redirect(url_for("home"))
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.get("/duel.html")
def duel():
    if not _current_user():
        return redirect(url_for("home"))
    return send_from_directory(FRONTEND_DIR, "duel.html")


@app.get("/api/cards")
def api_cards():
    if not _current_user():
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    try:
        return jsonify(_load_card_data())
    except (OSError, json.JSONDecodeError, ValueError) as error:
        app.logger.error("Could not load card catalog: %s", error)
        return jsonify(error="Không thể tải dữ liệu bài."), 500


@app.get("/<path:asset>")
def frontend_asset(asset):
    if asset.startswith("assets/"):
        return send_from_directory(BACKEND_DIR, asset)
    return send_from_directory(FRONTEND_DIR, asset)


@app.get("/api/session")
def api_session():
    user = _current_user()
    if not user:
        return jsonify(user=None)

    try:
        _ensure_schema()
        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            row = connection.cursor().execute(
                "SELECT SelectedCharacterId FROM dbo.Users WHERE Id = ?",
                user["id"],
            ).fetchone()
    except AuthConfigurationError as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)

    if not row:
        return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404
    if row.SelectedCharacterId not in CHARACTER_IDS:
        app.logger.error(
            "Invalid selected character %r for user id %s.",
            row.SelectedCharacterId,
            user["id"],
        )
        return jsonify(error="Nhân vật đại diện trong tài khoản không hợp lệ."), 500

    user["selected_character_id"] = row.SelectedCharacterId
    session["selected_character_id"] = row.SelectedCharacterId
    return jsonify(user=user)


@app.get("/api/wallet")
def api_wallet():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    try:
        _ensure_schema()
        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            wallet = connection.cursor().execute(
                "SELECT Gold, Gems FROM dbo.Users WHERE Id = ?",
                user["id"],
            ).fetchone()
    except (AuthConfigurationError, ValueError) as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)

    if not wallet:
        return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404
    return jsonify(wallet={"gold": int(wallet.Gold), "gems": int(wallet.Gems)})


@app.post("/api/wallet/exchange")
def api_wallet_exchange():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    gems = _request_data().get("gems")
    if (
        not isinstance(gems, int)
        or isinstance(gems, bool)
        or gems not in GEM_EXCHANGE_OPTIONS
    ):
        return jsonify(error="Mức đổi gem không hợp lệ."), 400

    gold = GEM_EXCHANGE_OPTIONS[gems]
    try:
        _ensure_schema()
        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            cursor = connection.cursor()
            wallet = cursor.execute(
                "SELECT Gold, Gems FROM dbo.Users WITH (UPDLOCK, ROWLOCK) WHERE Id = ?",
                user["id"],
            ).fetchone()
            if not wallet:
                return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404
            if int(wallet.Gems) < gems:
                connection.rollback()
                return jsonify(error="Bạn không có đủ gem để đổi mức này."), 409

            updated_wallet = cursor.execute(
                """
                UPDATE dbo.Users
                SET Gems = Gems - ?, Gold = Gold + ?
                OUTPUT INSERTED.Gold, INSERTED.Gems
                WHERE Id = ?
                """,
                gems,
                gold,
                user["id"],
            ).fetchone()
            connection.commit()
    except (AuthConfigurationError, ValueError) as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)

    return jsonify(
        message=f"Đã đổi {gems:,} gem lấy {gold:,} vàng.".replace(",", "."),
        exchange={"gems": gems, "gold": gold},
        wallet={"gold": int(updated_wallet.Gold), "gems": int(updated_wallet.Gems)},
    )


@app.get("/api/shop")
def api_shop_state():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    try:
        _ensure_schema()
        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            state = _shop_state(connection.cursor(), user["id"])
    except (AuthConfigurationError, ValueError) as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)

    if not state:
        return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404
    return jsonify(**state)


@app.post("/api/shop/purchase")
def api_shop_purchase():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    data = _request_data()
    pack_id = data.get("pack_id")
    pack_count = data.get("pack_count")
    if (
        not isinstance(pack_id, str)
        or pack_id not in SHOP_PACKS
        or not isinstance(pack_count, int)
        or isinstance(pack_count, bool)
        or pack_count not in PACK_PURCHASES
    ):
        return jsonify(error="Gói bài hoặc số lượng mua không hợp lệ."), 400

    try:
        _ensure_schema()
        pack = SHOP_PACKS[pack_id]
        pack_cards = [
            card for card in _load_card_catalog()
            if pack["character_id"] in card.get("characterIds", [])
        ]
        if not pack_cards:
            return jsonify(error="Gói bài hiện chưa có dữ liệu lá bài."), 503

        currency, cost = PACK_PURCHASES[pack_count]
        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            cursor = connection.cursor()
            wallet = cursor.execute(
                "SELECT Gold, Gems FROM dbo.Users WITH (UPDLOCK, ROWLOCK) WHERE Id = ?",
                user["id"],
            ).fetchone()
            if not wallet:
                return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404

            owned = {
                row.CardId: int(row.Quantity)
                for row in cursor.execute(
                    "SELECT CardId, Quantity FROM dbo.PlayerCards WHERE UserId = ?",
                    user["id"],
                ).fetchall()
            }
            rewards = []
            updated_owned = dict(owned)
            for _ in range(pack_count):
                available = [
                    card for card in pack_cards
                    if updated_owned.get(card["id"], 0) < int(card.get("maxCopies", 3))
                ]
                if not available:
                    connection.rollback()
                    return jsonify(error="Bạn đã sở hữu tối đa các lá bài trong gói này."), 409
                reward = secrets.choice(available)
                updated_owned[reward["id"]] = updated_owned.get(reward["id"], 0) + 1
                rewards.append(reward)

            balance = int(wallet.Gold if currency == "Gold" else wallet.Gems)
            if balance < cost:
                connection.rollback()
                return jsonify(error="Không đủ " + ("vàng" if currency == "Gold" else "gem") + " để mua gói."), 409

            cursor.execute(
                f"UPDATE dbo.Users SET {currency} = {currency} - ? WHERE Id = ?",
                cost,
                user["id"],
            )
            for reward in rewards:
                result = cursor.execute(
                    "UPDATE dbo.PlayerCards SET Quantity = Quantity + 1 WHERE UserId = ? AND CardId = ?",
                    user["id"],
                    reward["id"],
                )
                if result.rowcount == 0:
                    cursor.execute(
                        "INSERT INTO dbo.PlayerCards (UserId, CardId, Quantity) VALUES (?, ?, 1)",
                        user["id"],
                        reward["id"],
                    )
            connection.commit()

            state = _shop_state(cursor, user["id"])

    except (AuthConfigurationError, ValueError) as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)

    updated_pack = next(item for item in state["packs"] if item["id"] == pack_id)
    reward_cards = {card["id"]: card for card in updated_pack["cards"]}
    reward_details = [reward_cards[card["id"]] for card in rewards]
    return jsonify(
        message="Đã mở " + str(pack_count) + " gói bài.",
        rewards=reward_details,
        **state,
    )


@app.post("/api/shop/reset")
def api_shop_reset():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    pack_id = _request_data().get("pack_id")
    if not isinstance(pack_id, str) or pack_id not in SHOP_PACKS:
        return jsonify(error="Gói bài cần tạo lại không hợp lệ."), 400

    try:
        _ensure_schema()
        character_id = SHOP_PACKS[pack_id]["character_id"]
        pack_cards = [
            card for card in _load_card_catalog()
            if character_id in card.get("characterIds", [])
        ]
        if not pack_cards:
            return jsonify(error="Gói bài hiện chưa có dữ liệu lá bài."), 503

        card_ids = [card["id"] for card in pack_cards]
        placeholders = ", ".join("?" for _ in card_ids)
        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            cursor = connection.cursor()
            cursor.execute(
                f"DELETE FROM dbo.PlayerCards WHERE UserId = ? AND CardId IN ({placeholders})",
                user["id"],
                *card_ids,
            )
            state = _shop_state(cursor, user["id"])
            if not state:
                connection.rollback()
                return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404
            connection.commit()
    except (AuthConfigurationError, ValueError) as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)

    return jsonify(message="Đã tạo lại gói bài.", **state)


@app.get("/api/game/load-progress")
def api_game_load_progress():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    def report(progress, status):
        return f"data: {json.dumps({'progress': progress, 'status': status}, ensure_ascii=False)}\n\n"

    def stream_progress():
        yield report(5, "Đang xác nhận tài khoản...")
        try:
            _ensure_schema()
            with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
                yield report(55, "Đã kết nối máy chủ, đang tải hồ sơ...")
                row = connection.cursor().execute(
                    "SELECT Id, Username, PlayerName FROM dbo.Users WHERE Id = ?",
                    user["id"],
                ).fetchone()
                if not row:
                    yield f"data: {json.dumps({'error': 'Không tìm thấy tài khoản. Vui lòng đăng nhập lại.'}, ensure_ascii=False)}\n\n"
                    return
                yield report(90, "Đang chuẩn bị dữ liệu vào game...")
                loaded_user = {
                    "id": int(row.Id),
                    "username": row.Username,
                    "player_name": row.PlayerName,
                }
            yield f"data: {json.dumps({'progress': 100, 'status': 'Máy chủ đã sẵn sàng.', 'user': loaded_user}, ensure_ascii=False)}\n\n"
        except AuthConfigurationError as error:
            app.logger.error("Game bootstrap configuration failed: %s", error)
            yield f"data: {json.dumps({'error': str(error)}, ensure_ascii=False)}\n\n"
        except pyodbc.Error as error:
            app.logger.exception("Game bootstrap could not load data from SQL Server.")
            yield f"data: {json.dumps({'error': 'Không tải được dữ liệu từ SQL Server. Hãy thử lại.'}, ensure_ascii=False)}\n\n"

    return Response(
        stream_with_context(stream_progress()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/register")
def api_register():
    data = _request_data()
    raw_username = data.get("username", "")
    raw_email = data.get("email", "")
    password = data.get("password", "")
    confirmation = data.get("confirmation", "")

    if not isinstance(raw_username, str):
        return jsonify(error="Vui lòng nhập tên tài khoản hợp lệ."), 400
    if not isinstance(raw_email, str):
        return jsonify(error="Vui lòng nhập địa chỉ email hợp lệ."), 400
    username = raw_username.strip()
    email = raw_email.strip().lower()
    if not USERNAME_PATTERN.fullmatch(username):
        return jsonify(error="Tên tài khoản cần dài 3–24 ký tự, chỉ gồm chữ, số, dấu chấm, gạch dưới hoặc gạch ngang."), 400
    if len(email) > 254 or not EMAIL_PATTERN.fullmatch(email):
        return jsonify(error="Vui lòng nhập địa chỉ email hợp lệ."), 400
    if not isinstance(password, str) or len(password) < 8 or len(password) > 128:
        return jsonify(error="Mật khẩu cần có từ 8 đến 128 ký tự."), 400
    if password != confirmation:
        return jsonify(error="Mật khẩu xác nhận không khớp."), 400

    try:
        _ensure_schema()
        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            cursor = connection.cursor()
            cursor.execute(
                "SELECT Username, Email FROM dbo.Users WHERE Username = ? OR Email = ?",
                username,
                email,
            )
            existing = cursor.fetchone()
            if existing:
                if existing.Username.casefold() == username.casefold():
                    return jsonify(error="Tên tài khoản đã được sử dụng."), 409
                return jsonify(error="Email đã được sử dụng."), 409

            cursor.execute(
                "INSERT INTO dbo.Users (Username, PlayerName, Email, PasswordHash) VALUES (?, ?, ?, ?)",
                username,
                username,
                email,
                generate_password_hash(password),
            )
            connection.commit()
    except AuthConfigurationError as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)

    return jsonify(message="Đăng ký thành công. Hãy đăng nhập bằng tài khoản vừa tạo."), 201


@app.post("/api/login")
def api_login():
    data = _request_data()
    username = data.get("username", "")
    password = data.get("password", "")
    if not isinstance(username, str) or not username.strip() or not isinstance(password, str) or not password:
        return jsonify(error="Nhập tên tài khoản và mật khẩu."), 400
    username = username.strip()

    try:
        _ensure_schema()
        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            row = connection.cursor().execute(
                """
                SELECT Id, Username, PlayerName, PasswordHash, SelectedCharacterId
                FROM dbo.Users
                WHERE Username = ?
                """,
                username,
            ).fetchone()
    except AuthConfigurationError as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)

    if not row or not check_password_hash(row.PasswordHash, password):
        return jsonify(error="Tên tài khoản hoặc mật khẩu không đúng."), 401

    session.clear()
    session["user_id"] = int(row.Id)
    session["username"] = row.Username
    session["player_name"] = row.PlayerName
    session["selected_character_id"] = row.SelectedCharacterId
    session["app_instance_id"] = _app_instance_id
    return jsonify(
        message="Đăng nhập thành công.",
        user={
            "id": int(row.Id),
            "username": row.Username,
            "player_name": row.PlayerName,
            "selected_character_id": row.SelectedCharacterId,
        },
    )


@app.post("/api/profile/character")
def api_update_selected_character():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    character_id = _request_data().get("character_id")
    if not isinstance(character_id, str) or character_id not in CHARACTER_IDS:
        return jsonify(error="Nhân vật được chọn không hợp lệ."), 400

    try:
        _ensure_schema()
        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            cursor = connection.cursor()
            cursor.execute(
                "UPDATE dbo.Users SET SelectedCharacterId = ? WHERE Id = ?",
                character_id,
                user["id"],
            )
            if cursor.rowcount != 1:
                return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404
            connection.commit()
    except AuthConfigurationError as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)

    session["selected_character_id"] = character_id
    return jsonify(message="Đã lưu nhân vật đại diện.", selected_character_id=character_id)


@app.post("/api/profile/player-name")
def api_update_player_name():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    player_name = _request_data().get("player_name")
    if not isinstance(player_name, str):
        return jsonify(error="Vui lòng nhập tên người chơi hợp lệ."), 400
    player_name = player_name.strip()
    if not player_name or len(player_name.encode("utf-16-le")) // 2 > 24:
        return jsonify(error="Tên người chơi cần có từ 1 đến 24 ký tự."), 400

    try:
        _ensure_schema()
        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            cursor = connection.cursor()
            cursor.execute(
                "UPDATE dbo.Users SET PlayerName = ? WHERE Id = ?",
                player_name,
                user["id"],
            )
            if cursor.rowcount != 1:
                return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404
            connection.commit()
    except AuthConfigurationError as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)

    session["player_name"] = player_name
    return jsonify(message="Đã cập nhật tên người chơi.", player_name=player_name)


@app.post("/api/logout")
def api_logout():
    session.clear()
    return jsonify(message="Đã đăng xuất.")


if __name__ == "__main__":
    try:
        _ensure_schema()
    except (AuthConfigurationError, pyodbc.Error):
        app.logger.exception("Could not initialize SQL Server database %s.", DATABASE_NAME)
        raise SystemExit(1)
    app.logger.info(
        "Connected to SQL Server %s using %s authentication; database %s is ready.",
        os.environ.get("SQL_SERVER", r".\SQLEXPRESS"),
        os.environ.get("SQL_AUTH_MODE", "windows"),
        DATABASE_NAME,
    )
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5000")), debug=False)
