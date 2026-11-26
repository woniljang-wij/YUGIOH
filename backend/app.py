import calendar
from copy import deepcopy
import logging
import json
import os
import re
import secrets
import threading
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import unicodedata

import pyodbc
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, redirect, request, send_from_directory, session, stream_with_context, url_for
from werkzeug.security import check_password_hash, generate_password_hash

from duel.duel_actions import DuelActionEngine
from duel.duel_effects import build_effect_registry
from duel.duel_engine import (
    EXODIA_PIECE_IDS,
    DuelEffectEngine,
    DuelRuleError,
    check_win_by_exodia,
    create_duel_state,
    current_stats,
    find_card,
)


BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BACKEND_DIR.parent
FRONTEND_DIR = PROJECT_DIR / "frontend"
REACT_BUILD_DIR = FRONTEND_DIR / "react-build"
load_dotenv(BACKEND_DIR / ".env")

DATABASE_NAME = "YUGIOHDB"
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{3,24}$")
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
CHARACTER_IDS = {"kaiba-seto", "muto-yugi", "jonouchi-katsuya"}
STARTER_CHARACTER_IDS = ("kaiba-seto", "muto-yugi", "jonouchi-katsuya")
LEVEL_THRESHOLDS = {
    1: 0,
    2: 100,
    3: 300,
    4: 600,
    5: 1000,
    6: 1500,
    7: 2100,
    8: 2800,
    9: 3600,
    10: 4500,
}
MAX_LEVEL = max(LEVEL_THRESHOLDS)
EXP_PER_ITEM = 10
INVENTORY_ITEMS = {
    "character_card": {
        "name": "Thẻ bài nhân vật",
        "description": "Dùng để mua bài trong tiệm bài.",
        "image": "assets/images/items/character-card.png",
        "usable": False,
    },
    "rename_card": {
        "name": "Thẻ Đổi Tên",
        "description": "Dùng để thay đổi tên tài khoản người chơi.",
        "image": "assets/images/items/rename-card.png",
        "usable": False,
    },
    "r_fragment": {
        "name": "Mảnh R",
        "description": "Dùng để ghép thành Mảnh SR.",
        "image": "assets/images/items/r-fragment.png",
        "usable": False,
    },
    "sr_fragment": {
        "name": "Mảnh SR",
        "description": "Dùng để ghép thành Mảnh UR.",
        "image": "assets/images/items/sr-fragment.png",
        "usable": False,
    },
    "ur_fragment": {
        "name": "Mảnh UR",
        "description": "Dùng để ghép thành Mảnh GR.",
        "image": "assets/images/items/ur-fragment.png",
        "usable": False,
    },
    "gr_fragment": {
        "name": "Mảnh GR",
        "description": "Mảnh cấp cao nhất, không thể ghép tiếp.",
        "image": "assets/images/items/gr-fragment.png",
        "usable": False,
    },
    "exp": {
        "name": "EXP",
        "description": "Dùng để tăng kinh nghiệm cho tài khoản người chơi.",
        "image": "assets/images/items/exp.png",
        "usable": True,
    },
}
FRAGMENT_MERGE_RECIPES = {
    "r_fragment": {"quantity": 40, "gold": 1000, "reward_item": "sr_fragment"},
    "sr_fragment": {"quantity": 20, "gold": 2000, "reward_item": "ur_fragment"},
    "ur_fragment": {"quantity": 10, "gold": 3000, "reward_item": "gr_fragment"},
}
CARD_DISMANTLE_QUANTITY = 3
CARD_RARITY_FRAGMENT_ITEMS = {
    "R": "r_fragment",
    "RARE": "r_fragment",
    "SR": "sr_fragment",
    "SUPER RARE": "sr_fragment",
    "UR": "ur_fragment",
    "ULTRA RARE": "ur_fragment",
    "GR": "gr_fragment",
    "GOLD RARE": "gr_fragment",
}
INVENTORY_SOURCE_LABELS = {
    "character_card": "Điểm danh",
    "exp": "Điểm danh",
    "rename_card": "Shop Vật Phẩm",
}
CARD_DATA_PATH = BACKEND_DIR / "data" / "cards.json"
ASSETS_DIR = BACKEND_DIR / "assets"
GOD_PACK_ID = "god"
GOD_CARD_FRAGMENT_ITEM_ID = "ur_fragment"
GOD_CARD_GR_FRAGMENT_ITEM_ID = "gr_fragment"
GOD_CARD_FRAGMENT_COST = 5
SHOP_PACKS = {
    "kaiba": {
        "character_id": "kaiba",
        "unlock_character_id": "kaiba-seto",
        "owner": "SETO KAIBA",
        "name": "Gói Bài Rồng",
        "description": "Sức mạnh của rồng trắng mắt xanh",
    },
    "yugi": {
        "character_id": "yugi",
        "unlock_character_id": "muto-yugi",
        "owner": "YAMI YUGI",
        "name": "Gói Bài Phù Thủy",
        "description": "Đánh thức sức mạnh ngàn năm",
    },
    "jonouchi": {
        "character_id": "jonouchi",
        "unlock_character_id": "jonouchi-katsuya",
        "owner": "JONOUCHI KATSUYA",
        "name": "Gói Bài Chiến Binh",
        "description": "Những lá bài gắn với Jonouchi Katsuya",
    },
    GOD_PACK_ID: {
        "character_id": None,
        "unlock_character_id": None,
        "card_pack_id": GOD_PACK_ID,
        "purchase_mode": "single_card",
        "prices_by_card_id": {
            "s-the-seal-of-orichalcos": {
                "item_id": GOD_CARD_FRAGMENT_ITEM_ID,
                "quantity": 3,
            },
        },
        "prices_by_rarity": {
            "UR": {
                "item_id": GOD_CARD_FRAGMENT_ITEM_ID,
                "quantity": GOD_CARD_FRAGMENT_COST,
            },
            "GR": {
                "item_id": GOD_CARD_GR_FRAGMENT_ITEM_ID,
                "quantity": GOD_CARD_FRAGMENT_COST,
            },
        },
        "price_item_id": GOD_CARD_FRAGMENT_ITEM_ID,
        "price_per_card": GOD_CARD_FRAGMENT_COST,
        "resettable": False,
        "owner": "GÓI BÀI HƯ VÔ",
        "name": "Gói Bài Thần",
        "description": "Các lá bài thần thoại, mỗi lá chỉ được sở hữu một bản.",
    },
}
PACK_COUNTS = (1, 10, 50)
PACK_RARITY_WEIGHTS = {"R": 70, "SR": 20, "UR": 10}
GOLD_PACK_PRICE = 500
GEM_PACK_PRICE = 700
DECK_COUNT = 10
DUEL_MAIN_MIN = 40
DECK_MAIN_LIMIT = 60
DECK_EXTRA_LIMIT = 20
DECK_UNLOCK_PRICES = {deck_number: 1000 for deck_number in range(2, DECK_COUNT + 1)}
GEM_EXCHANGE_OPTIONS = {
    100: 1000,
    1000: 10000,
    6000: 60000,
}
RENAME_CARD_GEM_PRICE = 500
MAX_RENAME_CARD_PURCHASE = 2147483
BUSINESS_TIMEZONE = timezone(timedelta(hours=7), name="Asia/Ho_Chi_Minh")
ONLINE_HEARTBEAT_MAX_GAP_SECONDS = 90
ATTENDANCE_REWARDS = {
    "gold": {"name": "Vàng", "image": "assets/images/currency/gold.png"},
    "gems": {"name": "Gem", "image": "assets/images/currency/gem.png"},
    "character_card": {
        "name": "Thẻ bài nhân vật",
        "image": "assets/images/items/character-card.png",
    },
    "rename_card": {
        "name": INVENTORY_ITEMS["rename_card"]["name"],
        "image": INVENTORY_ITEMS["rename_card"]["image"],
    },
    "exp": {"name": "EXP", "image": "assets/images/items/exp.png"},
}
MONTHLY_ATTENDANCE_CYCLE = (
    ("gold", 100),
    ("gems", 50),
    ("character_card", 5),
    ("exp", 10),
)
ONLINE_ATTENDANCE_MILESTONES = (
    {"minutes": 5, "rewards": (("gold", 400),)},
    {"minutes": 10, "rewards": (("gold", 400),)},
    {"minutes": 20, "rewards": (("gold", 400),)},
    {"minutes": 30, "rewards": (("gold", 400),)},
    {
        "minutes": 60,
        "rewards": (
            ("gold", 1000),
            ("gems", 500),
            ("character_card", 10),
            ("exp", 10),
        ),
    },
)
MISSION_REWARDS = {
    "daily_login": {
        "name": "Đăng nhập hằng ngày",
        "description": "Đăng nhập vào game.",
        "target": 1,
        "cycle": "daily",
        "rewards": (("gold", 200), ("activity_points", 10)),
    },
    "daily_attendance": {
        "name": "Điểm danh",
        "description": "Thực hiện điểm danh 1 lần.",
        "target": 1,
        "cycle": "daily",
        "rewards": (("gold", 500), ("activity_points", 20)),
    },
    "daily_pack": {
        "name": "Mua gói bài",
        "description": "Mua thành công ít nhất 1 gói bài.",
        "target": 1,
        "cycle": "daily",
        "rewards": (("character_card", 5), ("activity_points", 30)),
    },
    "daily_packs_10": {
        "name": "Mua nhiều gói bài",
        "description": "Mua thành công 10 gói bài.",
        "target": 10,
        "cycle": "daily",
        "rewards": (("gold", 2500), ("activity_points", 50)),
    },
    "weekly_attendance": {
        "name": "Điểm danh tuần",
        "description": "Điểm danh 5 lần trong tuần.",
        "target": 5,
        "cycle": "weekly",
        "rewards": (("gems", 500), ("activity_points", 60)),
    },
}
QUEST_REWARD_DEFINITIONS = {
    "gold": {"name": "Vàng", "image": ATTENDANCE_REWARDS["gold"]["image"]},
    "gems": {"name": "Gem", "image": ATTENDANCE_REWARDS["gems"]["image"]},
    "character_card": {
        "name": INVENTORY_ITEMS["character_card"]["name"],
        "image": INVENTORY_ITEMS["character_card"]["image"],
    },
    "exp": {
        "name": INVENTORY_ITEMS["exp"]["name"],
        "image": INVENTORY_ITEMS["exp"]["image"],
    },
    "rename_card": {
        "name": INVENTORY_ITEMS["rename_card"]["name"],
        "image": INVENTORY_ITEMS["rename_card"]["image"],
    },
    "activity_points": {
        "name": "Điểm năng động",
        "image": "assets/images/progression/activity-points.png",
    },
}
ACTIVITY_CHESTS = (
    {"id": "chest_50", "threshold": 50, "rewards": (("gold", 200),)},
    {"id": "chest_100", "threshold": 100, "rewards": (("gold", 500),)},
    {"id": "chest_200", "threshold": 200, "rewards": (("gold", 1000), ("gems", 10))},
    {
        "id": "chest_300",
        "threshold": 300,
        "rewards": (("character_card", 5), ("exp", 5)),
    },
    {"id": "chest_500", "threshold": 500, "rewards": (("gems", 1000),)},
)

app = Flask(__name__, static_folder=None)
app.secret_key = os.environ.get("FLASK_SECRET_KEY")
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "false").lower() == "true",
)
app.logger.setLevel(logging.INFO)

HTML_PAGE_PATHS = {
    "/",
    "/login",
    "/login.html",
    "/react.html",
    "/start",
    "/start.html",
    "/react-start.html",
    "/index.html",
    "/duel.html",
}


def _business_datetime(now_utc=None):
    now_utc = now_utc or datetime.now(timezone.utc)
    if now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=timezone.utc)
    return now_utc.astimezone(BUSINESS_TIMEZONE)


def _attendance_reward(kind, amount):
    definition = ATTENDANCE_REWARDS[kind]
    return {
        "kind": kind,
        "name": definition["name"],
        "amount": amount,
        "image": definition["image"],
    }


def _monthly_attendance_reward(day):
    if not isinstance(day, int) or isinstance(day, bool) or day < 1:
        raise ValueError("Ngày điểm danh không hợp lệ.")
    kind, amount = MONTHLY_ATTENDANCE_CYCLE[(day - 1) % len(MONTHLY_ATTENDANCE_CYCLE)]
    return _attendance_reward(kind, amount)


def _rename_card_cost(successful_rename_count):
    return min(max(0, int(successful_rename_count)), 10)


def _rename_card_purchase_price(quantity):
    if (
        not isinstance(quantity, int)
        or isinstance(quantity, bool)
        or quantity < 1
        or quantity > MAX_RENAME_CARD_PURCHASE
    ):
        raise ValueError("Số lượng Thẻ Đổi Tên cần mua không hợp lệ.")
    return quantity * RENAME_CARD_GEM_PRICE


def _validated_player_name(value):
    if not isinstance(value, str):
        raise ValueError("Vui lòng nhập tên người chơi hợp lệ.")
    player_name = value.strip()
    if not player_name:
        raise ValueError("Tên người chơi không được để trống.")
    if len(player_name.encode("utf-16-le")) // 2 > 24:
        raise ValueError("Tên người chơi cần có từ 1 đến 24 ký tự.")
    allowed_categories = {"L", "M", "N"}
    if not all(
        character in " ._-"
        or unicodedata.category(character)[0] in allowed_categories
        for character in player_name
    ) or not any(
        unicodedata.category(character)[0] in {"L", "N"}
        for character in player_name
    ):
        raise ValueError("Tên chỉ được chứa chữ cái, chữ số, dấu cách, dấu chấm, gạch dưới hoặc gạch ngang.")
    return player_name


def _makeup_attendance_cost(successful_makeups):
    return min(100 + 50 * successful_makeups, 1000)


def _split_online_seconds(start_utc, end_utc):
    if start_utc.tzinfo is None:
        start_utc = start_utc.replace(tzinfo=timezone.utc)
    if end_utc.tzinfo is None:
        end_utc = end_utc.replace(tzinfo=timezone.utc)
    if end_utc <= start_utc:
        return {}

    daily_seconds = {}
    cursor = start_utc
    while cursor < end_utc:
        business_day = cursor.astimezone(BUSINESS_TIMEZONE).date()
        next_midnight = datetime.combine(
            business_day + timedelta(days=1),
            datetime.min.time(),
            BUSINESS_TIMEZONE,
        ).astimezone(timezone.utc)
        segment_end = min(end_utc, next_midnight)
        seconds = int((segment_end - cursor).total_seconds())
        if seconds > 0:
            daily_seconds[business_day] = daily_seconds.get(business_day, 0) + seconds
        cursor = segment_end
    return daily_seconds


def _online_attendance_milestones(claimed_keys=()):
    claimed_keys = set(claimed_keys)
    return [
        {
            "minutes": milestone["minutes"],
            "required_seconds": milestone["minutes"] * 60,
            "rewards": [
                _attendance_reward(kind, amount)
                for kind, amount in milestone["rewards"]
            ],
            "claimed": str(milestone["minutes"]) in claimed_keys,
        }
        for milestone in ONLINE_ATTENDANCE_MILESTONES
    ]


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
_duel_sessions = {}
_duel_sessions_lock = threading.RLock()
_duel_action_engine = DuelActionEngine(
    DuelEffectEngine(build_effect_registry())
)


class AuthConfigurationError(Exception):
    pass


class ActionRequestConflict(Exception):
    pass


class ShopPackStockExhausted(Exception):
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
                IF COL_LENGTH(N'dbo.Users', N'SuccessfulRenameCount') IS NULL
                    ALTER TABLE dbo.Users ADD SuccessfulRenameCount INT NOT NULL
                        CONSTRAINT DF_Users_SuccessfulRenameCount DEFAULT (0) WITH VALUES;
                """
            )
            cursor.execute(
                """
                IF COL_LENGTH(N'dbo.Users', N'SelectedCharacterId') IS NULL
                    ALTER TABLE dbo.Users ADD SelectedCharacterId NVARCHAR(32) NOT NULL
                        CONSTRAINT DF_Users_SelectedCharacterId
                        DEFAULT (N'jonouchi-katsuya') WITH VALUES;

                DECLARE @selectedCharacterDefault sysname;
                SELECT @selectedCharacterDefault = dc.name
                FROM sys.default_constraints dc
                INNER JOIN sys.columns c
                    ON c.object_id = dc.parent_object_id
                    AND c.column_id = dc.parent_column_id
                WHERE dc.parent_object_id = OBJECT_ID(N'dbo.Users')
                    AND c.name = N'SelectedCharacterId';
                IF @selectedCharacterDefault IS NOT NULL
                BEGIN
                    DECLARE @dropSelectedCharacterDefault nvarchar(max);
                    SET @dropSelectedCharacterDefault =
                        N'ALTER TABLE dbo.Users DROP CONSTRAINT '
                        + QUOTENAME(@selectedCharacterDefault);
                    EXEC sp_executesql @dropSelectedCharacterDefault;
                END;
                ALTER TABLE dbo.Users ALTER COLUMN SelectedCharacterId NVARCHAR(32) NULL;
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
                IF COL_LENGTH(N'dbo.Users', N'Experience') IS NULL
                    ALTER TABLE dbo.Users ADD Experience BIGINT NOT NULL
                        CONSTRAINT DF_Users_Experience DEFAULT (0) WITH VALUES;
                IF COL_LENGTH(N'dbo.Users', N'Level') IS NULL
                    ALTER TABLE dbo.Users ADD Level INT NOT NULL
                        CONSTRAINT DF_Users_Level DEFAULT (1) WITH VALUES;
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
            cursor.execute(
                """
                IF OBJECT_ID(N'dbo.PlayerDecks', N'U') IS NULL
                BEGIN
                    CREATE TABLE dbo.PlayerDecks (
                        UserId INT NOT NULL,
                        DeckNumber TINYINT NOT NULL,
                        Name NVARCHAR(32) NOT NULL,
                        Notes NVARCHAR(240) NOT NULL
                            CONSTRAINT DF_PlayerDecks_Notes DEFAULT (N''),
                        IsUnlocked BIT NOT NULL
                            CONSTRAINT DF_PlayerDecks_IsUnlocked DEFAULT (0),
                        Version INT NOT NULL
                            CONSTRAINT DF_PlayerDecks_Version DEFAULT (1),
                        CreatedAtUtc DATETIME2 NOT NULL
                            CONSTRAINT DF_PlayerDecks_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
                        UpdatedAtUtc DATETIME2 NOT NULL
                            CONSTRAINT DF_PlayerDecks_UpdatedAtUtc DEFAULT SYSUTCDATETIME(),
                        CONSTRAINT PK_PlayerDecks PRIMARY KEY (UserId, DeckNumber),
                        CONSTRAINT FK_PlayerDecks_Users FOREIGN KEY (UserId)
                            REFERENCES dbo.Users(Id) ON DELETE CASCADE,
                        CONSTRAINT CK_PlayerDecks_Number CHECK (DeckNumber BETWEEN 1 AND 10),
                        CONSTRAINT CK_PlayerDecks_Version CHECK (Version > 0)
                    )
                END
                IF OBJECT_ID(N'dbo.PlayerDeckCards', N'U') IS NULL
                BEGIN
                    CREATE TABLE dbo.PlayerDeckCards (
                        UserId INT NOT NULL,
                        DeckNumber TINYINT NOT NULL,
                        Location NVARCHAR(8) NOT NULL,
                        CardId NVARCHAR(64) NOT NULL,
                        Quantity INT NOT NULL,
                        SortOrder INT NOT NULL,
                        CONSTRAINT PK_PlayerDeckCards
                            PRIMARY KEY (UserId, DeckNumber, Location, CardId),
                        CONSTRAINT FK_PlayerDeckCards_Decks
                            FOREIGN KEY (UserId, DeckNumber)
                            REFERENCES dbo.PlayerDecks(UserId, DeckNumber) ON DELETE CASCADE,
                        CONSTRAINT CK_PlayerDeckCards_Location
                            CHECK (Location IN (N'main', N'extra')),
                        CONSTRAINT CK_PlayerDeckCards_Quantity CHECK (Quantity BETWEEN 1 AND 3),
                        CONSTRAINT CK_PlayerDeckCards_SortOrder CHECK (SortOrder >= 0)
                    )
                END
                IF OBJECT_ID(N'dbo.PlayerDuelPreferences', N'U') IS NULL
                BEGIN
                    CREATE TABLE dbo.PlayerDuelPreferences (
                        UserId INT NOT NULL,
                        SelectedDeckNumber TINYINT NOT NULL,
                        UpdatedAtUtc DATETIME2 NOT NULL
                            CONSTRAINT DF_PlayerDuelPreferences_UpdatedAtUtc DEFAULT SYSUTCDATETIME(),
                        CONSTRAINT PK_PlayerDuelPreferences PRIMARY KEY (UserId),
                        CONSTRAINT FK_PlayerDuelPreferences_Decks
                            FOREIGN KEY (UserId, SelectedDeckNumber)
                            REFERENCES dbo.PlayerDecks(UserId, DeckNumber) ON DELETE CASCADE,
                        CONSTRAINT CK_PlayerDuelPreferences_Deck
                            CHECK (SelectedDeckNumber BETWEEN 1 AND 10)
                    )
                END
                IF OBJECT_ID(N'dbo.PlayerNewCards', N'U') IS NULL
                BEGIN
                    CREATE TABLE dbo.PlayerNewCards (
                        UserId INT NOT NULL,
                        CardId NVARCHAR(64) NOT NULL,
                        IsViewed BIT NOT NULL
                            CONSTRAINT DF_PlayerNewCards_IsViewed DEFAULT (0),
                        CreatedAtUtc DATETIME2 NOT NULL
                            CONSTRAINT DF_PlayerNewCards_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
                        ViewedAtUtc DATETIME2 NULL,
                        CONSTRAINT PK_PlayerNewCards PRIMARY KEY (UserId, CardId),
                        CONSTRAINT FK_PlayerNewCards_Users FOREIGN KEY (UserId)
                            REFERENCES dbo.Users(Id) ON DELETE CASCADE
                    )
                END
                INSERT INTO dbo.PlayerDecks (UserId, DeckNumber, Name, IsUnlocked)
                SELECT users.Id, 1, N'Bộ Bài 1', 1
                FROM dbo.Users users
                WHERE NOT EXISTS (
                    SELECT 1 FROM dbo.PlayerDecks decks
                    WHERE decks.UserId = users.Id AND decks.DeckNumber = 1
                )
                """
            )
            cursor.execute(
                """
                IF OBJECT_ID(N'dbo.PlayerCharacters', N'U') IS NULL
                BEGIN
                    CREATE TABLE dbo.PlayerCharacters (
                        UserId INT NOT NULL,
                        CharacterId NVARCHAR(32) NOT NULL,
                        UnlockedAtLevel INT NOT NULL,
                        CONSTRAINT PK_PlayerCharacters PRIMARY KEY (UserId, CharacterId),
                        CONSTRAINT FK_PlayerCharacters_Users FOREIGN KEY (UserId)
                            REFERENCES dbo.Users(Id) ON DELETE CASCADE
                    )
                END
                """
            )
            cursor.execute(
                """
                IF OBJECT_ID(N'dbo.PlayerInventory', N'U') IS NULL
                BEGIN
                    CREATE TABLE dbo.PlayerInventory (
                        UserId INT NOT NULL,
                        ItemId NVARCHAR(32) NOT NULL,
                        Quantity INT NOT NULL,
                        CONSTRAINT PK_PlayerInventory PRIMARY KEY (UserId, ItemId),
                        CONSTRAINT FK_PlayerInventory_Users FOREIGN KEY (UserId)
                            REFERENCES dbo.Users(Id) ON DELETE CASCADE,
                        CONSTRAINT CK_PlayerInventory_Quantity CHECK (Quantity > 0)
                    )
                END
                """
            )
            cursor.execute(
                """
                IF OBJECT_ID(N'dbo.PlayerItemEvents', N'U') IS NULL
                BEGIN
                    CREATE TABLE dbo.PlayerItemEvents (
                        Id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                        UserId INT NOT NULL,
                        ItemId NVARCHAR(32) NOT NULL,
                        Quantity INT NOT NULL,
                        Source NVARCHAR(80) NOT NULL,
                        RequestId NVARCHAR(36) NULL,
                        CreatedAt DATETIME2 NOT NULL
                            CONSTRAINT DF_PlayerItemEvents_CreatedAt DEFAULT SYSUTCDATETIME(),
                        CONSTRAINT FK_PlayerItemEvents_Users FOREIGN KEY (UserId)
                            REFERENCES dbo.Users(Id) ON DELETE CASCADE
                    )
                END
                IF NOT EXISTS (
                    SELECT 1 FROM sys.indexes
                    WHERE name = N'UX_PlayerItemEvents_Request'
                        AND object_id = OBJECT_ID(N'dbo.PlayerItemEvents')
                )
                    CREATE UNIQUE INDEX UX_PlayerItemEvents_Request
                        ON dbo.PlayerItemEvents(UserId, RequestId)
                        WHERE RequestId IS NOT NULL
                """
            )
            cursor.execute(
                """
                IF OBJECT_ID(N'dbo.PlayerActionRequests', N'U') IS NULL
                BEGIN
                    CREATE TABLE dbo.PlayerActionRequests (
                        UserId INT NOT NULL,
                        RequestId NVARCHAR(36) NOT NULL,
                        Action NVARCHAR(32) NOT NULL,
                        ResponseJson NVARCHAR(MAX) NOT NULL,
                        CreatedAt DATETIME2 NOT NULL
                            CONSTRAINT DF_PlayerActionRequests_CreatedAt DEFAULT SYSUTCDATETIME(),
                        CONSTRAINT PK_PlayerActionRequests PRIMARY KEY (UserId, RequestId),
                        CONSTRAINT FK_PlayerActionRequests_Users FOREIGN KEY (UserId)
                            REFERENCES dbo.Users(Id) ON DELETE CASCADE
                    )
                END
                """
            )
            cursor.execute(
                """
                IF OBJECT_ID(N'dbo.PlayerAttendanceClaims', N'U') IS NULL
                BEGIN
                    CREATE TABLE dbo.PlayerAttendanceClaims (
                        UserId INT NOT NULL,
                        BusinessDate DATE NOT NULL,
                        ClaimType NVARCHAR(16) NOT NULL,
                        RewardKey NVARCHAR(16) NOT NULL,
                        IsMakeup BIT NOT NULL
                            CONSTRAINT DF_PlayerAttendanceClaims_IsMakeup DEFAULT (0),
                        MakeupGemCost INT NOT NULL
                            CONSTRAINT DF_PlayerAttendanceClaims_MakeupGemCost DEFAULT (0),
                        OnlineSeconds INT NULL,
                        RewardJson NVARCHAR(MAX) NOT NULL,
                        CreatedAtUtc DATETIME2 NOT NULL
                            CONSTRAINT DF_PlayerAttendanceClaims_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
                        CONSTRAINT PK_PlayerAttendanceClaims
                            PRIMARY KEY (UserId, BusinessDate, ClaimType, RewardKey),
                        CONSTRAINT FK_PlayerAttendanceClaims_Users FOREIGN KEY (UserId)
                            REFERENCES dbo.Users(Id) ON DELETE CASCADE,
                        CONSTRAINT CK_PlayerAttendanceClaims_Type
                            CHECK (ClaimType IN (N'monthly', N'online')),
                        CONSTRAINT CK_PlayerAttendanceClaims_Makeup
                            CHECK (MakeupGemCost >= 0),
                        CONSTRAINT CK_PlayerAttendanceClaims_OnlineSeconds
                            CHECK (OnlineSeconds IS NULL OR OnlineSeconds >= 0)
                    )
                END
                IF COL_LENGTH(N'dbo.PlayerAttendanceClaims', N'RewardJson') IS NULL
                    ALTER TABLE dbo.PlayerAttendanceClaims
                        ADD RewardJson NVARCHAR(MAX) NULL;
                IF OBJECT_ID(N'dbo.PlayerOnlinePresence', N'U') IS NULL
                BEGIN
                    CREATE TABLE dbo.PlayerOnlinePresence (
                        UserId INT NOT NULL,
                        BusinessDate DATE NOT NULL,
                        OnlineSeconds INT NOT NULL
                            CONSTRAINT DF_PlayerOnlinePresence_OnlineSeconds DEFAULT (0),
                        LastHeartbeatAtUtc DATETIME2 NULL,
                        CONSTRAINT PK_PlayerOnlinePresence
                            PRIMARY KEY (UserId, BusinessDate),
                        CONSTRAINT FK_PlayerOnlinePresence_Users FOREIGN KEY (UserId)
                            REFERENCES dbo.Users(Id) ON DELETE CASCADE,
                        CONSTRAINT CK_PlayerOnlinePresence_OnlineSeconds
                            CHECK (OnlineSeconds >= 0)
                    )
                END
                IF OBJECT_ID(N'dbo.PlayerMissionEvents', N'U') IS NULL
                BEGIN
                    CREATE TABLE dbo.PlayerMissionEvents (
                        UserId INT NOT NULL,
                        EventKey NVARCHAR(80) NOT NULL,
                        EventType NVARCHAR(24) NOT NULL,
                        BusinessDate DATE NOT NULL,
                        Quantity INT NOT NULL,
                        CreatedAtUtc DATETIME2 NOT NULL
                            CONSTRAINT DF_PlayerMissionEvents_CreatedAtUtc
                            DEFAULT SYSUTCDATETIME(),
                        CONSTRAINT PK_PlayerMissionEvents
                            PRIMARY KEY (UserId, EventKey),
                        CONSTRAINT FK_PlayerMissionEvents_Users FOREIGN KEY (UserId)
                            REFERENCES dbo.Users(Id) ON DELETE CASCADE,
                        CONSTRAINT CK_PlayerMissionEvents_Quantity CHECK (Quantity > 0)
                    )
                END
                IF OBJECT_ID(N'dbo.PlayerMissionProgress', N'U') IS NULL
                BEGIN
                    CREATE TABLE dbo.PlayerMissionProgress (
                        UserId INT NOT NULL,
                        MissionId NVARCHAR(32) NOT NULL,
                        PeriodStart DATE NOT NULL,
                        PeriodEnd DATE NOT NULL,
                        Progress INT NOT NULL
                            CONSTRAINT DF_PlayerMissionProgress_Progress DEFAULT (0),
                        IsClaimed BIT NOT NULL
                            CONSTRAINT DF_PlayerMissionProgress_IsClaimed DEFAULT (0),
                        ClaimedAtUtc DATETIME2 NULL,
                        CONSTRAINT PK_PlayerMissionProgress
                            PRIMARY KEY (UserId, MissionId, PeriodStart),
                        CONSTRAINT FK_PlayerMissionProgress_Users FOREIGN KEY (UserId)
                            REFERENCES dbo.Users(Id) ON DELETE CASCADE,
                        CONSTRAINT CK_PlayerMissionProgress_Progress CHECK (Progress >= 0)
                    )
                END
                IF OBJECT_ID(N'dbo.PlayerActivityPoints', N'U') IS NULL
                BEGIN
                    CREATE TABLE dbo.PlayerActivityPoints (
                        UserId INT NOT NULL,
                        WeekStart DATE NOT NULL,
                        WeekEnd DATE NOT NULL,
                        Points INT NOT NULL
                            CONSTRAINT DF_PlayerActivityPoints_Points DEFAULT (0),
                        CONSTRAINT PK_PlayerActivityPoints PRIMARY KEY (UserId, WeekStart),
                        CONSTRAINT FK_PlayerActivityPoints_Users FOREIGN KEY (UserId)
                            REFERENCES dbo.Users(Id) ON DELETE CASCADE,
                        CONSTRAINT CK_PlayerActivityPoints_Points CHECK (Points >= 0)
                    )
                END
                IF OBJECT_ID(N'dbo.PlayerActivityChestClaims', N'U') IS NULL
                BEGIN
                    CREATE TABLE dbo.PlayerActivityChestClaims (
                        UserId INT NOT NULL,
                        WeekStart DATE NOT NULL,
                        WeekEnd DATE NOT NULL,
                        ChestId NVARCHAR(16) NOT NULL,
                        ClaimedAtUtc DATETIME2 NOT NULL
                            CONSTRAINT DF_PlayerActivityChestClaims_ClaimedAtUtc
                            DEFAULT SYSUTCDATETIME(),
                        CONSTRAINT PK_PlayerActivityChestClaims
                            PRIMARY KEY (UserId, WeekStart, ChestId),
                        CONSTRAINT FK_PlayerActivityChestClaims_Users FOREIGN KEY (UserId)
                            REFERENCES dbo.Users(Id) ON DELETE CASCADE
                    )
                END
                """
            )
            cursor.execute(
                """
                IF COL_LENGTH(N'dbo.PlayerMissionProgress', N'PeriodEnd') IS NULL
                    ALTER TABLE dbo.PlayerMissionProgress ADD PeriodEnd DATE NULL;
                """
            )
            cursor.execute(
                """
                UPDATE dbo.PlayerMissionProgress
                SET PeriodEnd = CASE
                    WHEN MissionId = N'weekly_attendance'
                        THEN DATEADD(day, 6, PeriodStart)
                    ELSE PeriodStart
                END
                WHERE PeriodEnd IS NULL;
                """
            )
            cursor.execute(
                "ALTER TABLE dbo.PlayerMissionProgress ALTER COLUMN PeriodEnd DATE NOT NULL"
            )
            cursor.execute(
                """
                IF COL_LENGTH(N'dbo.PlayerActivityPoints', N'WeekEnd') IS NULL
                    ALTER TABLE dbo.PlayerActivityPoints ADD WeekEnd DATE NULL;
                """
            )
            cursor.execute(
                """
                UPDATE dbo.PlayerActivityPoints
                SET WeekEnd = DATEADD(day, 6, WeekStart)
                WHERE WeekEnd IS NULL;
                """
            )
            cursor.execute(
                "ALTER TABLE dbo.PlayerActivityPoints ALTER COLUMN WeekEnd DATE NOT NULL"
            )
            cursor.execute(
                """
                IF COL_LENGTH(N'dbo.PlayerActivityChestClaims', N'WeekEnd') IS NULL
                    ALTER TABLE dbo.PlayerActivityChestClaims ADD WeekEnd DATE NULL;
                """
            )
            cursor.execute(
                """
                UPDATE dbo.PlayerActivityChestClaims
                SET WeekEnd = DATEADD(day, 6, WeekStart)
                WHERE WeekEnd IS NULL;
                """
            )
            cursor.execute(
                "ALTER TABLE dbo.PlayerActivityChestClaims ALTER COLUMN WeekEnd DATE NOT NULL"
            )
            cursor.execute(
                """
                INSERT INTO dbo.PlayerCharacters (UserId, CharacterId, UnlockedAtLevel)
                SELECT users.Id, users.SelectedCharacterId, 1
                FROM dbo.Users users
                WHERE users.SelectedCharacterId IN (
                    N'kaiba-seto', N'muto-yugi', N'jonouchi-katsuya'
                )
                    AND NOT EXISTS (
                        SELECT 1 FROM dbo.PlayerCharacters unlocked
                        WHERE unlocked.UserId = users.Id
                            AND unlocked.CharacterId = users.SelectedCharacterId
                    )
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
        character_id = None
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


def _shop_pack_cards(definition, catalog=None):
    cards = _load_card_catalog() if catalog is None else catalog
    card_pack_id = definition.get("card_pack_id")
    if card_pack_id:
        return [
            card
            for card in cards
            if card_pack_id in card.get("packIds", [])
        ]

    character_id = definition.get("character_id")
    if not character_id:
        return []
    return [
        card
        for card in cards
        if character_id in card.get("characterIds", [])
    ]


def _shop_pack_card_price(definition, card):
    custom_prices = definition.get("prices_by_card_id")
    if isinstance(custom_prices, dict) and card.get("id") in custom_prices:
        price = custom_prices[card.get("id")]
    else:
        rarity = str(card.get("rarity") or "").strip().upper()
        prices_by_rarity = definition.get("prices_by_rarity")
        if prices_by_rarity is not None:
            price = prices_by_rarity.get(rarity)
            if price is None:
                raise ValueError("Gói bài chưa cấu hình giá cho cấp độ lá bài này.")
        else:
            price = {
                "item_id": definition.get("price_item_id"),
                "quantity": definition.get("price_per_card"),
            }
    if not isinstance(price, dict):
        raise ValueError("Dữ liệu giá đổi lá bài trong gói không hợp lệ.")
    item_id = price.get("item_id")
    quantity = price.get("quantity")
    if (
        item_id not in INVENTORY_ITEMS
        or not isinstance(quantity, int)
        or isinstance(quantity, bool)
        or quantity < 1
    ):
        raise ValueError("Dữ liệu giá đổi lá bài trong gói không hợp lệ.")
    return item_id, quantity


def _deck_filter_options(catalog):
    rarities = {"R", "SR", "UR", "GR"}
    levels = {"LINK"}
    attributes = {"DIVINE"}
    races = set()
    rarity_aliases = {
        "RARE": "R",
        "SUPER RARE": "SR",
        "ULTRA RARE": "UR",
        "GOLD RARE": "GR",
    }

    for card in catalog:
        rarity = str(card.get("rarity") or "").strip().upper()
        rarities.add(rarity_aliases.get(rarity, rarity) or "Chưa phân loại")

        level = card.get("level")
        link_rating = (
            card.get("linkRating")
            or card.get("link_rating")
            or card.get("linkValue")
            or card.get("link_value")
            or card.get("link")
        )
        if link_rating is not None or str(level or "").upper().startswith("LINK"):
            levels.add("LINK")
        else:
            levels.add(str(level) if level not in (None, "") else "Chưa phân loại")

        attributes.add(card.get("attribute") or "Chưa phân loại")
        races.add(card.get("race") or "Chưa phân loại")

    return {
        "rarities": sorted(rarities, key=lambda value: (
            ["R", "SR", "UR", "GR"].index(value)
            if value in {"R", "SR", "UR", "GR"}
            else 4,
            value,
        )),
        "levels": sorted(
            levels - {"LINK", "Chưa phân loại"},
            key=lambda value: (not value.isdigit(), int(value) if value.isdigit() else value),
        ) + (["LINK"] if "LINK" in levels else [])
        + (["Chưa phân loại"] if "Chưa phân loại" in levels else []),
        "attributes": sorted(attributes),
        "races": sorted(races, key=str.casefold),
    }


def _level_for_experience(experience):
    return max(
        level for level, threshold in LEVEL_THRESHOLDS.items()
        if experience >= threshold
    )


def _experience_after_items(current_experience, quantity):
    gained = EXP_PER_ITEM * quantity
    total = current_experience + gained
    return total, gained, min(MAX_LEVEL, _level_for_experience(total))


def _pack_payment(pack_count, tokens_available, gold_available, gems_available):
    tokens_used = min(pack_count, tokens_available)
    remaining_packs = pack_count - tokens_used
    gold_cost = remaining_packs * GOLD_PACK_PRICE
    gem_cost = remaining_packs * GEM_PACK_PRICE

    if remaining_packs == 0:
        return tokens_used, None, 0
    if gold_available >= gold_cost:
        return tokens_used, "Gold", gold_cost
    return tokens_used, "Gems", gem_cost


def _progress_state(cursor, user_id):
    row = cursor.execute(
        "SELECT Experience, Level, SelectedCharacterId FROM dbo.Users WHERE Id = ?",
        user_id,
    ).fetchone()
    if not row:
        return None

    experience = max(0, int(row.Experience))
    level = _level_for_experience(experience)
    if level != int(row.Level):
        cursor.execute("UPDATE dbo.Users SET Level = ? WHERE Id = ?", level, user_id)
    next_threshold = LEVEL_THRESHOLDS.get(level, LEVEL_THRESHOLDS[MAX_LEVEL])
    current_threshold = LEVEL_THRESHOLDS[level]
    return {
        "level": level,
        "experience": experience,
        "current_level_experience": current_threshold,
        "next_level_experience": next_threshold,
        "progress_experience": experience - current_threshold,
        "progress_required": max(0, next_threshold - current_threshold),
        "max_level": level >= MAX_LEVEL,
        "level_thresholds": LEVEL_THRESHOLDS,
        "selected_character_id": row.SelectedCharacterId,
    }


def _unlocked_character_ids(cursor, user_id):
    return [
        row.CharacterId
        for row in cursor.execute(
            "SELECT CharacterId FROM dbo.PlayerCharacters WHERE UserId = ?",
            user_id,
        ).fetchall()
    ]


def _character_unlock_levels(selected_character_id):
    if selected_character_id not in STARTER_CHARACTER_IDS:
        return {}
    selected_index = STARTER_CHARACTER_IDS.index(selected_character_id)
    remaining = STARTER_CHARACTER_IDS[selected_index + 1:] + STARTER_CHARACTER_IDS[:selected_index]
    return {
        selected_character_id: 1,
        remaining[0]: 5,
        remaining[1]: 10,
    }


def _apply_level_unlocks(cursor, user_id, old_level, new_level):
    if new_level <= old_level:
        return []
    selected = cursor.execute(
        "SELECT SelectedCharacterId FROM dbo.Users WHERE Id = ?",
        user_id,
    ).fetchone()
    if not selected:
        return []
    unlock_levels = _character_unlock_levels(selected.SelectedCharacterId)
    unlocked = []
    for character_id, required_level in unlock_levels.items():
        if not old_level < required_level <= new_level:
            continue
        exists = cursor.execute(
            """
            SELECT 1 FROM dbo.PlayerCharacters
            WHERE UserId = ? AND CharacterId = ?
            """,
            user_id,
            character_id,
        ).fetchone()
        if exists:
            continue
        cursor.execute(
            """
            INSERT INTO dbo.PlayerCharacters (UserId, CharacterId, UnlockedAtLevel)
            VALUES (?, ?, ?)
            """,
            user_id,
            character_id,
            required_level,
        )
        unlocked.append(character_id)
    return unlocked


def _grant_inventory_item(cursor, user_id, item_id, quantity, source, request_id=None):
    if item_id not in INVENTORY_ITEMS or not isinstance(quantity, int) or quantity <= 0:
        raise ValueError("Vật phẩm hoặc số lượng cấp không hợp lệ.")
    source = INVENTORY_SOURCE_LABELS.get(item_id, source)
    if request_id:
        previous = cursor.execute(
            """
            SELECT 1 FROM dbo.PlayerItemEvents
            WHERE UserId = ? AND RequestId = ?
            """,
            user_id,
            request_id,
        ).fetchone()
        if previous:
            return False

    result = cursor.execute(
        "UPDATE dbo.PlayerInventory SET Quantity = Quantity + ? WHERE UserId = ? AND ItemId = ?",
        quantity,
        user_id,
        item_id,
    )
    if result.rowcount == 0:
        cursor.execute(
            "INSERT INTO dbo.PlayerInventory (UserId, ItemId, Quantity) VALUES (?, ?, ?)",
            user_id,
            item_id,
            quantity,
        )
    cursor.execute(
        """
        INSERT INTO dbo.PlayerItemEvents (UserId, ItemId, Quantity, Source, RequestId)
        VALUES (?, ?, ?, ?, ?)
        """,
        user_id,
        item_id,
        quantity,
        source,
        request_id,
    )
    return True


def _inventory_state(cursor, user_id):
    rows = cursor.execute(
        """
        SELECT inventory.ItemId, inventory.Quantity,
            (
                SELECT TOP 1 events.Source
                FROM dbo.PlayerItemEvents events
                WHERE events.UserId = inventory.UserId
                    AND events.ItemId = inventory.ItemId
                    AND events.Quantity > 0
                ORDER BY events.Id DESC
            ) AS Source
        FROM dbo.PlayerInventory inventory
        WHERE inventory.UserId = ?
        ORDER BY inventory.ItemId
        """,
        user_id,
    ).fetchall()
    return [
        {
            "id": row.ItemId,
            **INVENTORY_ITEMS[row.ItemId],
            "quantity": int(row.Quantity),
            "source": INVENTORY_SOURCE_LABELS.get(
                row.ItemId,
                row.Source or "Chưa ghi nhận nguồn nhận",
            ),
        }
        for row in rows
        if row.ItemId in INVENTORY_ITEMS and int(row.Quantity) > 0
    ]


def _fragment_merge_recipe(item_id):
    recipe = FRAGMENT_MERGE_RECIPES.get(item_id)
    if recipe:
        return recipe
    if item_id == "gr_fragment":
        raise ValueError("Mảnh GR là cấp cao nhất, không thể ghép tiếp.")
    raise ValueError("Loại mảnh không hợp lệ.")


def _card_fragment_item(card):
    rarity = str(card.get("rarity") or "").strip().upper()
    item_id = CARD_RARITY_FRAGMENT_ITEMS.get(rarity)
    if not item_id:
        raise ValueError("Chỉ có thể tách bài có độ hiếm R, SR, UR hoặc GR.")
    return item_id


def _available_card_quantity(owned_quantity, deck_quantity):
    return max(0, int(owned_quantity) - int(deck_quantity))


def _request_id(data):
    value = data.get("request_id")
    if not isinstance(value, str):
        return None
    try:
        return str(uuid.UUID(value))
    except ValueError:
        return None


def _previous_action_response(cursor, user_id, request_id, action):
    row = cursor.execute(
        """
        SELECT Action, ResponseJson FROM dbo.PlayerActionRequests
        WHERE UserId = ? AND RequestId = ?
        """,
        user_id,
        request_id,
    ).fetchone()
    if not row:
        return None
    if row.Action != action:
        raise ActionRequestConflict("Mã giao dịch đã được sử dụng cho thao tác khác.")
    return json.loads(row.ResponseJson)


def _store_action_response(cursor, user_id, request_id, action, result):
    cursor.execute(
        """
        INSERT INTO dbo.PlayerActionRequests (UserId, RequestId, Action, ResponseJson)
        VALUES (?, ?, ?, ?)
        """,
        user_id,
        request_id,
        action,
        json.dumps(result, ensure_ascii=False),
    )


def _attendance_snapshot(cursor, user_id, business_now=None):
    business_now = business_now or _business_datetime()
    today = business_now.date()
    month_start = date(today.year, today.month, 1)
    next_month = (
        date(today.year + 1, 1, 1)
        if today.month == 12
        else date(today.year, today.month + 1, 1)
    )
    monthly_claim_rows = cursor.execute(
        """
        SELECT BusinessDate, IsMakeup, MakeupGemCost, CreatedAtUtc
        FROM dbo.PlayerAttendanceClaims
        WHERE UserId = ? AND ClaimType = N'monthly'
            AND BusinessDate >= ? AND BusinessDate < ?
        ORDER BY BusinessDate
        """,
        user_id,
        month_start,
        next_month,
    ).fetchall()
    online_row = cursor.execute(
        """
        SELECT OnlineSeconds FROM dbo.PlayerOnlinePresence
        WHERE UserId = ? AND BusinessDate = ?
        """,
        user_id,
        today,
    ).fetchone()
    online_claim_rows = cursor.execute(
        """
        SELECT RewardKey FROM dbo.PlayerAttendanceClaims
        WHERE UserId = ? AND BusinessDate = ? AND ClaimType = N'online'
        """,
        user_id,
        today,
    ).fetchall()
    wallet = cursor.execute(
        "SELECT Gold, Gems FROM dbo.Users WHERE Id = ?",
        user_id,
    ).fetchone()
    if not wallet:
        return None

    makeup_count = sum(1 for row in monthly_claim_rows if row.IsMakeup)
    return {
        "business_date": today.isoformat(),
        "server_now": business_now.isoformat(),
        "year": today.year,
        "month": today.month,
        "days_in_month": calendar.monthrange(today.year, today.month)[1],
        "monthly_rewards": [
            {"day": day, "reward": _monthly_attendance_reward(day)}
            for day in range(1, calendar.monthrange(today.year, today.month)[1] + 1)
        ],
        "monthly_claims": [
            {
                "day": row.BusinessDate.day,
                "is_makeup": bool(row.IsMakeup),
                "makeup_gem_cost": int(row.MakeupGemCost),
                "received_at": _business_datetime(row.CreatedAtUtc).isoformat(),
            }
            for row in monthly_claim_rows
        ],
        "monthly_claimed_count": len(monthly_claim_rows),
        "makeup_count": makeup_count,
        "makeup_cost": _makeup_attendance_cost(makeup_count),
        "wallet": {"gold": int(wallet.Gold), "gems": int(wallet.Gems)},
        "online_seconds": int(online_row.OnlineSeconds) if online_row else 0,
        "online_milestones": _online_attendance_milestones(
            row.RewardKey for row in online_claim_rows
        ),
    }


def _record_online_heartbeat(cursor, user_id, now_utc):
    if now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=timezone.utc)
    else:
        now_utc = now_utc.astimezone(timezone.utc)
    database_now = now_utc.replace(tzinfo=None)
    today = now_utc.astimezone(BUSINESS_TIMEZONE).date()
    latest = cursor.execute(
        """
        SELECT TOP (1) BusinessDate, LastHeartbeatAtUtc
        FROM dbo.PlayerOnlinePresence
        WHERE UserId = ? AND LastHeartbeatAtUtc IS NOT NULL
        ORDER BY BusinessDate DESC
        """,
        user_id,
    ).fetchone()

    if latest:
        previous_heartbeat = latest.LastHeartbeatAtUtc.replace(tzinfo=timezone.utc)
        elapsed = (now_utc - previous_heartbeat).total_seconds()
        if 0 < elapsed <= ONLINE_HEARTBEAT_MAX_GAP_SECONDS:
            for business_day, seconds in _split_online_seconds(
                previous_heartbeat, now_utc
            ).items():
                updated = cursor.execute(
                    """
                    UPDATE dbo.PlayerOnlinePresence
                    SET OnlineSeconds = OnlineSeconds + ?
                    WHERE UserId = ? AND BusinessDate = ?
                    """,
                    seconds,
                    user_id,
                    business_day,
                )
                if updated.rowcount == 0:
                    cursor.execute(
                        """
                        INSERT INTO dbo.PlayerOnlinePresence
                            (UserId, BusinessDate, OnlineSeconds)
                        VALUES (?, ?, ?)
                        """,
                        user_id,
                        business_day,
                        seconds,
                    )

    updated_today = cursor.execute(
        """
        UPDATE dbo.PlayerOnlinePresence
        SET LastHeartbeatAtUtc = ?
        WHERE UserId = ? AND BusinessDate = ?
        """,
        database_now,
        user_id,
        today,
    )
    if updated_today.rowcount == 0:
        cursor.execute(
            """
            INSERT INTO dbo.PlayerOnlinePresence
                (UserId, BusinessDate, OnlineSeconds, LastHeartbeatAtUtc)
            VALUES (?, ?, 0, ?)
            """,
            user_id,
            today,
            database_now,
        )


def _apply_attendance_rewards(cursor, user_id, rewards, source, request_id):
    result = []
    for kind, amount in rewards:
        reward = _attendance_reward(kind, amount)
        if kind in {"gold", "gems"}:
            column = "Gold" if kind == "gold" else "Gems"
            cursor.execute(
                f"UPDATE dbo.Users SET {column} = {column} + ? WHERE Id = ?",
                amount,
                user_id,
            )
        else:
            item_request_id = str(uuid.uuid5(uuid.UUID(request_id), kind))
            _grant_inventory_item(
                cursor,
                user_id,
                kind,
                amount,
                source,
                item_request_id,
            )
        result.append(reward)
    return result


def _week_start(day):
    return day - timedelta(days=day.weekday())


def _mission_period_start(mission_id, business_date):
    if MISSION_REWARDS[mission_id]["cycle"] == "weekly":
        return _week_start(business_date)
    return business_date


def _mission_period_end(mission_id, business_date):
    period_start = _mission_period_start(mission_id, business_date)
    if MISSION_REWARDS[mission_id]["cycle"] == "weekly":
        return period_start + timedelta(days=6)
    return period_start


def _mission_reward_payload(reward_entries):
    return [
        {
            "kind": kind,
            "name": QUEST_REWARD_DEFINITIONS[kind]["name"],
            "image": QUEST_REWARD_DEFINITIONS[kind]["image"],
            "amount": amount,
        }
        for kind, amount in reward_entries
    ]


def _upsert_mission_progress(cursor, user_id, mission_id, business_date, amount):
    mission = MISSION_REWARDS[mission_id]
    period_start = _mission_period_start(mission_id, business_date)
    updated = cursor.execute(
        """
        UPDATE dbo.PlayerMissionProgress
        SET Progress = CASE
            WHEN Progress + ? > ? THEN ?
            ELSE Progress + ?
        END
        WHERE UserId = ? AND MissionId = ? AND PeriodStart = ?
        """,
        amount,
        mission["target"],
        mission["target"],
        amount,
        user_id,
        mission_id,
        period_start,
    )
    if updated.rowcount == 0:
        cursor.execute(
            """
            INSERT INTO dbo.PlayerMissionProgress
                    (UserId, MissionId, PeriodStart, PeriodEnd, Progress)
                VALUES (?, ?, ?, ?, ?)
            """,
            user_id,
            mission_id,
            period_start,
            _mission_period_end(mission_id, business_date),
            min(amount, mission["target"]),
        )


def _record_mission_event(cursor, user_id, event_key, event_type, quantity, business_date):
    if event_type not in {"login", "attendance", "pack_purchase"} or quantity < 1:
        raise ValueError("Sự kiện nhiệm vụ không hợp lệ.")
    existing = cursor.execute(
        """
        SELECT 1 FROM dbo.PlayerMissionEvents
        WHERE UserId = ? AND EventKey = ?
        """,
        user_id,
        event_key,
    ).fetchone()
    if existing:
        return False

    cursor.execute(
        """
        INSERT INTO dbo.PlayerMissionEvents
            (UserId, EventKey, EventType, BusinessDate, Quantity)
        VALUES (?, ?, ?, ?, ?)
        """,
        user_id,
        event_key,
        event_type,
        business_date,
        quantity,
    )
    if event_type == "login":
        _upsert_mission_progress(cursor, user_id, "daily_login", business_date, 1)
    elif event_type == "attendance":
        _upsert_mission_progress(cursor, user_id, "daily_attendance", business_date, 1)
        _upsert_mission_progress(cursor, user_id, "weekly_attendance", business_date, 1)
    else:
        _upsert_mission_progress(cursor, user_id, "daily_pack", business_date, 1)
        _upsert_mission_progress(cursor, user_id, "daily_packs_10", business_date, quantity)
    return True


def _add_activity_points(cursor, user_id, business_date, amount):
    week_start = _week_start(business_date)
    updated = cursor.execute(
        """
        UPDATE dbo.PlayerActivityPoints
        SET Points = Points + ?
        WHERE UserId = ? AND WeekStart = ?
        """,
        amount,
        user_id,
        week_start,
    )
    if updated.rowcount == 0:
        cursor.execute(
            """
            INSERT INTO dbo.PlayerActivityPoints (UserId, WeekStart, WeekEnd, Points)
            VALUES (?, ?, ?, ?)
            """,
            user_id,
            week_start,
            week_start + timedelta(days=6),
            amount,
        )


def _mission_snapshot(cursor, user_id, business_now=None):
    business_now = business_now or _business_datetime()
    business_date = business_now.date()
    week_start = _week_start(business_date)
    if not cursor.execute(
        "SELECT Id FROM dbo.Users WHERE Id = ?",
        user_id,
    ).fetchone():
        return None
    point_row = cursor.execute(
        """
        SELECT Points FROM dbo.PlayerActivityPoints
        WHERE UserId = ? AND WeekStart = ?
        """,
        user_id,
        week_start,
    ).fetchone()
    points = int(point_row.Points) if point_row else 0
    claimed_chests = {
        row.ChestId
        for row in cursor.execute(
            """
            SELECT ChestId FROM dbo.PlayerActivityChestClaims
            WHERE UserId = ? AND WeekStart = ?
            """,
            user_id,
            week_start,
        ).fetchall()
    }

    missions = []
    for mission_id, definition in MISSION_REWARDS.items():
        period_start = _mission_period_start(mission_id, business_date)
        row = cursor.execute(
            """
            SELECT Progress, IsClaimed
            FROM dbo.PlayerMissionProgress
            WHERE UserId = ? AND MissionId = ? AND PeriodStart = ?
            """,
            user_id,
            mission_id,
            period_start,
        ).fetchone()
        progress = int(row.Progress) if row else 0
        claimed = bool(row.IsClaimed) if row else False
        missions.append({
            "id": mission_id,
            "name": definition["name"],
            "description": definition["description"],
            "cycle": definition["cycle"],
            "period_start": period_start.isoformat(),
            "progress": progress,
            "target": definition["target"],
            "claimed": claimed,
            "claimable": progress >= definition["target"] and not claimed,
            "rewards": _mission_reward_payload(definition["rewards"]),
        })

    chests = []
    for chest in ACTIVITY_CHESTS:
        claimed = chest["id"] in claimed_chests
        chests.append({
            **chest,
            "threshold": chest["threshold"],
            "claimed": claimed,
            "unlocked": points >= chest["threshold"],
            "rewards": _mission_reward_payload(chest["rewards"]),
        })
    pending_rewards = sum(1 for mission in missions if mission["claimable"])
    pending_rewards += sum(
        1 for chest in chests if chest["unlocked"] and not chest["claimed"]
    )
    return {
        "server_now": business_now.isoformat(),
        "business_date": business_date.isoformat(),
        "week_start": week_start.isoformat(),
        "week_end": (week_start + timedelta(days=6)).isoformat(),
        "activity_points": points,
        "missions": missions,
        "chests": chests,
        "pending_rewards": pending_rewards,
    }


def _grant_quest_rewards(cursor, user_id, reward_entries, source, request_id, business_date):
    granted = _mission_reward_payload(reward_entries)
    for kind, amount in reward_entries:
        if kind == "activity_points":
            _add_activity_points(cursor, user_id, business_date, amount)
        elif kind in {"gold", "gems"}:
            column = "Gold" if kind == "gold" else "Gems"
            cursor.execute(
                f"UPDATE dbo.Users SET {column} = {column} + ? WHERE Id = ?",
                amount,
                user_id,
            )
        else:
            item_request_id = str(uuid.uuid5(uuid.UUID(request_id), kind))
            _grant_inventory_item(
                cursor,
                user_id,
                kind,
                amount,
                source,
                item_request_id,
            )
    return granted


def _shop_state(cursor, user_id):
    wallet = cursor.execute(
        "SELECT Gold, Gems FROM dbo.Users WHERE Id = ?", user_id
    ).fetchone()
    if not wallet:
        return None
    token_row = cursor.execute(
        """
        SELECT Quantity FROM dbo.PlayerInventory
        WHERE UserId = ? AND ItemId = N'character_card'
        """,
        user_id,
    ).fetchone()
    unlocked = set(_unlocked_character_ids(cursor, user_id))

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
        for card in _shop_pack_cards(definition, catalog):
            owned_quantity = quantities.get(card["id"], 0)
            pack_card = {
                **card,
                "ownedQuantity": owned_quantity,
                "remainingQuantity": _remaining_card_copies(card, owned_quantity),
            }
            if definition.get("purchase_mode") == "single_card":
                price_item_id, price_per_card = _shop_pack_card_price(
                    definition, card
                )
                pack_card["price_item_id"] = price_item_id
                pack_card["price_per_card"] = price_per_card
            pack_cards.append(pack_card)
        packs.append({
            "id": pack_id,
            **definition,
            "unlocked": (
                not definition.get("unlock_character_id")
                or definition["unlock_character_id"] in unlocked
            ),
            "cards": pack_cards,
        })

    return {
        "wallet": {"gold": int(wallet.Gold), "gems": int(wallet.Gems)},
        "character_cards": int(token_row.Quantity) if token_row else 0,
        "purchase_options": {
            "gold_per_pack": GOLD_PACK_PRICE,
            "gem_per_pack": GEM_PACK_PRICE,
            "pack_counts": list(PACK_COUNTS),
            "max_pack_count": 50,
        },
        "inventory": _inventory_state(cursor, user_id),
        "packs": packs,
    }


def _is_new_card_eligible(card):
    return bool(card.get("id"))


def _card_copy_limit(card):
    max_copies = card.get("maxCopies", 3)
    if (
        not isinstance(max_copies, int)
        or isinstance(max_copies, bool)
        or max_copies < 1
    ):
        raise ValueError("Dữ liệu giới hạn số lượng thẻ không hợp lệ.")
    return max_copies


def _remaining_card_copies(card, owned_quantity):
    return max(0, _card_copy_limit(card) - owned_quantity)


def _choose_pack_rewards(
    pack_cards,
    pack_count,
    chooser=secrets.choice,
    rarity_chooser=secrets.randbelow,
    owned_quantities=None,
):
    if (
        not pack_cards
        or not isinstance(pack_count, int)
        or isinstance(pack_count, bool)
        or pack_count < 1
    ):
        raise ValueError("Gói bài hoặc số lượng mở không hợp lệ.")

    rarity_aliases = {
        "RARE": "R",
        "SUPER RARE": "SR",
        "ULTRA RARE": "UR",
    }
    rarity_pools = {rarity: [] for rarity in PACK_RARITY_WEIGHTS}
    remaining_by_id = {}
    for card in pack_cards:
        card_id = card.get("id")
        if not isinstance(card_id, str) or not card_id:
            raise ValueError("Lá bài trong gói thiếu mã định danh.")
        owned_quantity = (owned_quantities or {}).get(card_id, 0)
        if not isinstance(owned_quantity, int) or owned_quantity < 0:
            raise ValueError("Số lượng sở hữu thẻ không hợp lệ.")
        remaining_by_id[card_id] = max(
            0,
            _card_copy_limit(card) - owned_quantity,
        )
        rarity = str(card.get("rarity") or "").strip().upper()
        rarity = rarity_aliases.get(rarity, rarity)
        if rarity in rarity_pools:
            rarity_pools[rarity].append(card)

    if not any(rarity_pools.values()):
        raise ValueError("Gói bài chưa có lá R, SR hoặc UR để mở.")

    rewards = []
    for _ in range(pack_count):
        available_pools = {
            rarity: [
                card for card in cards
                if remaining_by_id[card["id"]] > 0
            ]
            for rarity, cards in rarity_pools.items()
        }
        available_weights = {
            rarity: weight
            for rarity, weight in PACK_RARITY_WEIGHTS.items()
            if available_pools[rarity]
        }
        total_weight = sum(available_weights.values())
        if not total_weight:
            raise ShopPackStockExhausted(
                "Gói bài đã hết số lá có thể nhận. Hãy tạo lại gói bài."
            )
        roll = rarity_chooser(total_weight)
        for rarity, weight in available_weights.items():
            if roll < weight:
                reward = chooser(available_pools[rarity])
                rewards.append(reward)
                remaining_by_id[reward["id"]] -= 1
                break
            roll -= weight
    return rewards


def _sort_main_deck_cards(entries, catalog_by_id):
    category_order = {"monster": 0, "spell": 1, "trap": 2}
    return sorted(
        entries,
        key=lambda entry: category_order.get(
            str(
                catalog_by_id.get(entry["card_id"], {}).get("category") or ""
            ).lower(),
            3,
        ),
    )


def _validate_deck_cards(
    main_cards,
    extra_cards,
    catalog,
    owned_quantities,
):
    if not isinstance(main_cards, list) or not isinstance(extra_cards, list):
        raise ValueError("Danh sách thẻ trong bộ bài không hợp lệ.")
    if len(main_cards) > DECK_MAIN_LIMIT or len(extra_cards) > DECK_EXTRA_LIMIT:
        raise ValueError("Bộ bài đã vượt quá sức chứa cho phép.")

    catalog_by_id = {str(card["id"]): card for card in catalog}
    normalized = {"main": [], "extra": []}
    for location, entries in (("main", main_cards), ("extra", extra_cards)):
        seen_ids = set()
        for entry in entries:
            if not isinstance(entry, dict):
                raise ValueError("Dữ liệu thẻ trong bộ bài không hợp lệ.")
            card_id = entry.get("card_id")
            quantity = entry.get("quantity")
            if (
                not isinstance(card_id, str)
                or not isinstance(quantity, int)
                or isinstance(quantity, bool)
                or quantity < 1
            ):
                raise ValueError("Số lượng thẻ trong bộ bài không hợp lệ.")
            if card_id in seen_ids:
                raise ValueError("Mỗi loại thẻ chỉ được gửi một dòng trong bộ bài.")
            seen_ids.add(card_id)

            card = catalog_by_id.get(card_id)
            if not card or owned_quantities.get(card_id, 0) < 1:
                raise ValueError("Bạn chưa sở hữu một hoặc nhiều thẻ trong bộ bài.")
            is_extra_card = str(card.get("category") or "").lower() == "fusion"
            if (location == "extra") != is_extra_card:
                raise ValueError("Thẻ Dung Hợp chỉ được đặt trong Extra Deck.")
            max_copies = card.get("maxCopies", 3)
            if (
                not isinstance(max_copies, int)
                or isinstance(max_copies, bool)
                or max_copies < 1
            ):
                max_copies = 3
            if quantity > min(3, max_copies):
                raise ValueError(f"Không thể sử dụng quá {min(3, max_copies)} bản sao của {card['name']}.")
            owned_quantity = owned_quantities.get(card_id, 0)
            if quantity > owned_quantity:
                raise ValueError(
                    f"Số lượng sở hữu của {card['name']} không đủ cho bộ bài."
                )
            normalized[location].append(
                {"card_id": card_id, "quantity": quantity}
            )

    normalized["main"] = _sort_main_deck_cards(normalized["main"], catalog_by_id)
    if sum(entry["quantity"] for entry in normalized["main"]) > DECK_MAIN_LIMIT:
        raise ValueError("Main Deck không được vượt quá 60 lá.")
    if sum(entry["quantity"] for entry in normalized["extra"]) > DECK_EXTRA_LIMIT:
        raise ValueError("Extra Deck không được vượt quá 20 lá.")
    return normalized


def _duel_deck_error(deck, owned_cards, deck_limits):
    if not deck or not deck.get("unlocked"):
        return "Bộ bài chưa được mở khóa."

    main_cards = deck.get("main_cards")
    extra_cards = deck.get("extra_cards")
    if not isinstance(main_cards, list) or not isinstance(extra_cards, list):
        return "Dữ liệu bộ bài không hợp lệ."
    for entry in [*main_cards, *extra_cards]:
        quantity = entry.get("quantity") if isinstance(entry, dict) else None
        if (
            not isinstance(quantity, int)
            or isinstance(quantity, bool)
            or quantity < 1
        ):
            return "Số lượng thẻ trong bộ bài không hợp lệ."

    main_limit = int(deck_limits.get("main", DECK_MAIN_LIMIT))
    extra_limit = int(deck_limits.get("extra", DECK_EXTRA_LIMIT))
    main_total = sum(
        entry.get("quantity", 0) for entry in main_cards if isinstance(entry, dict)
    )
    extra_total = sum(
        entry.get("quantity", 0) for entry in extra_cards if isinstance(entry, dict)
    )
    if main_total < DUEL_MAIN_MIN:
        return f"Main Deck cần ít nhất {DUEL_MAIN_MIN} lá (hiện có {main_total})."
    if main_total > main_limit:
        return f"Main Deck không được vượt quá {main_limit} lá."
    if extra_total > extra_limit:
        return f"Extra Deck không được vượt quá {extra_limit} lá."

    cards_by_id = {str(card["id"]): card for card in owned_cards}
    for location, entries in (("main", main_cards), ("extra", extra_cards)):
        seen_ids = set()
        for entry in entries:
            if not isinstance(entry, dict):
                return "Dữ liệu thẻ trong bộ bài không hợp lệ."
            card_id = entry.get("card_id")
            quantity = entry.get("quantity")
            if (
                not isinstance(card_id, str)
                or not isinstance(quantity, int)
                or isinstance(quantity, bool)
                or quantity < 1
            ):
                return "Số lượng thẻ trong bộ bài không hợp lệ."
            if card_id in seen_ids:
                return "Mỗi loại thẻ chỉ được xuất hiện một dòng trong bộ bài."
            seen_ids.add(card_id)

            card = cards_by_id.get(card_id)
            if not card:
                return "Bộ bài có thẻ bạn không sở hữu hoặc không còn trong danh mục."
            is_extra_card = str(card.get("category") or "").lower() == "fusion"
            if (location == "extra") != is_extra_card:
                return "Thẻ Dung Hợp chỉ được đặt trong Extra Deck."
            max_copies = card.get("maxCopies", 3)
            if (
                not isinstance(max_copies, int)
                or isinstance(max_copies, bool)
                or max_copies < 1
            ):
                max_copies = 3
            if quantity > min(3, max_copies):
                return f"Không thể sử dụng quá {min(3, max_copies)} bản sao của {card['name']}."
            if quantity > int(card.get("ownedQuantity", 0)):
                return f"Số lượng sở hữu của {card['name']} không đủ cho bộ bài."
    return ""


def _deck_snapshot(cursor, user_id):
    rows = cursor.execute(
        """
        SELECT DeckNumber, Name, Notes, IsUnlocked, Version
        FROM dbo.PlayerDecks
        WHERE UserId = ?
        ORDER BY DeckNumber
        """,
        user_id,
    ).fetchall()
    stored_decks = {
        int(row.DeckNumber): {
            "number": int(row.DeckNumber),
            "name": row.Name,
            "notes": row.Notes or "",
            "unlocked": bool(row.IsUnlocked),
            "version": int(row.Version),
            "main_cards": [],
            "extra_cards": [],
        }
        for row in rows
    }
    selected_deck = cursor.execute(
        """
        SELECT SelectedDeckNumber
        FROM dbo.PlayerDuelPreferences
        WHERE UserId = ?
        """,
        user_id,
    ).fetchone()
    deck_quantities = {}
    for row in cursor.execute(
        """
        SELECT DeckNumber, Location, CardId, Quantity, SortOrder
        FROM dbo.PlayerDeckCards
        WHERE UserId = ?
        ORDER BY DeckNumber, Location, SortOrder, CardId
        """,
        user_id,
    ).fetchall():
        deck = stored_decks.get(int(row.DeckNumber))
        if deck:
            card_id = str(row.CardId)
            deck_quantities[card_id] = (
                deck_quantities.get(card_id, 0) + int(row.Quantity)
            )
            deck[f"{row.Location}_cards"].append({
                "card_id": card_id,
                "quantity": int(row.Quantity),
            })

    owned_quantities = {
        row.CardId: int(row.Quantity)
        for row in cursor.execute(
            "SELECT CardId, Quantity FROM dbo.PlayerCards WHERE UserId = ?",
            user_id,
        ).fetchall()
    }
    viewed_cards = {
        row.CardId
        for row in cursor.execute(
            """
            SELECT CardId FROM dbo.PlayerNewCards
            WHERE UserId = ? AND IsViewed = 1
            """,
            user_id,
        ).fetchall()
    }
    new_cards = set(owned_quantities) - viewed_cards
    catalog = _load_card_catalog()
    catalog_by_id = {str(card["id"]): card for card in catalog}
    for deck in stored_decks.values():
        deck["main_cards"] = _sort_main_deck_cards(
            deck["main_cards"], catalog_by_id
        )
    filter_options = _deck_filter_options(catalog)
    cards = [
        {
            **card,
            "ownedQuantity": owned_quantities.get(str(card["id"]), 0),
            "deckQuantity": deck_quantities.get(str(card["id"]), 0),
            "availableQuantity": _available_card_quantity(
                owned_quantities.get(str(card["id"]), 0),
                deck_quantities.get(str(card["id"]), 0),
            ),
            "isNew": str(card["id"]) in new_cards,
        }
        for card in catalog
        if owned_quantities.get(str(card["id"]), 0) > 0
    ]
    decks = []
    for deck_number in range(1, DECK_COUNT + 1):
        deck = stored_decks.get(deck_number)
        unlocked = bool(deck and deck["unlocked"])
        decks.append({
            "number": deck_number,
            "name": deck["name"] if deck else f"Bộ Bài {deck_number}",
            "notes": deck["notes"] if deck else "",
            "unlocked": unlocked,
            "version": deck["version"] if deck else None,
            "main_cards": deck["main_cards"] if deck else [],
            "extra_cards": deck["extra_cards"] if deck else [],
            "unlock_gems": DECK_UNLOCK_PRICES.get(deck_number),
        })
    deck_limits = {"main": DECK_MAIN_LIMIT, "extra": DECK_EXTRA_LIMIT}
    for deck in decks:
        deck["duel_error"] = _duel_deck_error(deck, cards, deck_limits)
    wallet = cursor.execute(
        "SELECT Gold, Gems FROM dbo.Users WHERE Id = ?",
        user_id,
    ).fetchone()
    return {
        "cards": cards,
        "filter_options": filter_options,
        "decks": decks,
        "selected_deck_number": (
            int(selected_deck.SelectedDeckNumber) if selected_deck else None
        ),
        "new_cards_count": len(new_cards),
        "deck_limits": deck_limits,
        "wallet": {
            "gold": int(wallet.Gold),
            "gems": int(wallet.Gems),
        },
    }


def _expand_duel_deck(entries, cards_by_id):
    expanded = []
    for entry in entries:
        card = cards_by_id.get(entry["card_id"])
        if not card:
            raise DuelRuleError("Bộ bài chứa lá không còn trong danh mục.")
        expanded.extend(deepcopy(card) for _ in range(entry["quantity"]))
    return expanded


def _build_duel_ai_deck(catalog):
    category_limits = {"monster": 22, "spell": 11, "trap": 7}
    catalog_by_id = {}
    for card in catalog:
        card_id = card.get("id")
        category = str(card.get("category") or "").lower()
        max_copies = card.get("maxCopies", 3)
        if (
            category not in category_limits
            or not isinstance(card_id, str)
            or not card_id
            or not isinstance(max_copies, int)
            or isinstance(max_copies, bool)
            or max_copies < 1
            or card_id in catalog_by_id
        ):
            continue
        catalog_by_id[card_id] = card

    registry = build_effect_registry()
    archetypes = (
        {
            "monsters": (
                "m-dark-magician",
                "m-dark-magician-girl",
                "m-skilled-dark-magician",
            ),
            "spells": (
                "s-dark-magic-curtain",
                "s-thousand-knives",
                "s-dark-magic-attack",
                "s-sages-stone",
                "s-dark-burning-attack",
                "s-bond-between-teacher-and-student",
            ),
        },
        {
            "monsters": (
                "m-blue-eyes-white-dragon",
                "m-kaibaman",
                "m-lord-of-d",
                "m-the-white-stone-of-ancients",
                "m-maiden-with-eyes-of-blue",
            ),
            "spells": (
                "s-the-flute-of-summoning-dragon",
                "s-return-of-the-dragon-lords",
                "s-burst-stream-of-destruction",
                "s-the-melody-of-awakening-dragon",
            ),
        },
    )
    available_archetypes = [
        archetype
        for archetype in archetypes
        if all(
            card_id in catalog_by_id
            and catalog_by_id[card_id].get("category") == "monster"
            for card_id in archetype["monsters"]
        )
        and all(
            card_id in catalog_by_id
            and catalog_by_id[card_id].get("category") == "spell"
            and registry.has_card_effect(card_id)
            for card_id in archetype["spells"]
        )
    ]
    archetype = secrets.choice(available_archetypes) if available_archetypes else None

    deck_by_category = {category: [] for category in category_limits}
    selected_ids = set()

    def add_card(card_id):
        card = catalog_by_id.get(card_id)
        if (
            not card
            or card_id in selected_ids
            or len(deck_by_category[card["category"]])
            >= category_limits[card["category"]]
        ):
            return
        deck_by_category[card["category"]].append(deepcopy(card))
        selected_ids.add(card_id)

    if archetype:
        for card_id in archetype["monsters"] + archetype["spells"]:
            add_card(card_id)
    add_card("m-the-tricky")

    def number(card, key):
        try:
            return int(card.get(key) or 0)
        except (TypeError, ValueError):
            return 0

    theme_races = {
        str(catalog_by_id[card_id].get("race") or "").casefold()
        for card_id in archetype["monsters"]
    } if archetype else set()
    special_summon_bosses = {
        "m-black-luster-soldier-envoy-of-the-beginning",
        "m-chaos-emperor-dragon-envoy-of-the-end",
        "m-chaos-dragon-levianeer",
    }
    playable_high_level_monsters = special_summon_bosses | {
        card_id
        for card_id in (archetype["monsters"] if archetype else ())
        if number(catalog_by_id[card_id], "level") >= 7
    }

    def monster_score(card):
        level = number(card, "level")
        atk = number(card, "atk")
        defense = number(card, "def")
        score = atk + min(max(defense, 0), 3000) * 0.25
        if level <= 4:
            score += 750
        elif level == 5:
            score += 100
        elif level == 6:
            score -= 250
        elif level == 7:
            score -= 350
        else:
            score -= 800
        if registry.has_card_effect(card["id"]):
            score += 180
        if card["id"] in special_summon_bosses:
            score += 700
        if (
            theme_races
            and str(card.get("race") or "").casefold() in theme_races
        ):
            score += 150
        return score

    monsters = sorted(
        (
            card
            for card in catalog_by_id.values()
            if card["category"] == "monster"
            and card["id"] not in selected_ids
            and 1 <= number(card, "level") <= 12
            and (
                number(card, "level") <= 6
                or card["id"] in playable_high_level_monsters
            )
        ),
        key=lambda card: (-monster_score(card), card["id"]),
    )
    special_boss_count = 0
    tribute_monster_count = 0
    for card in monsters:
        if len(deck_by_category["monster"]) >= category_limits["monster"]:
            break
        if card["id"] in special_summon_bosses:
            if special_boss_count >= 2:
                continue
            special_boss_count += 1
        elif (
            number(card, "level") in {5, 6}
            and card["id"] not in (archetype["monsters"] if archetype else ())
        ):
            if tribute_monster_count >= 2:
                continue
            tribute_monster_count += 1
        add_card(card["id"])

    spell_priorities = (
        "s-pot-of-greed",
        "s-raigeki",
        "s-monster-reborn",
        "s-change-of-heart",
        "s-mystical-space-typhoon",
        "s-lightning-storm",
        "s-brain-control",
        "s-soul-taker",
        "s-swords-of-revealing-light",
        "s-shrink",
        "s-heavy-storm",
        "s-divine-shield",
        "s-cost-down",
    )
    for card_id in spell_priorities:
        if registry.has_card_effect(card_id):
            add_card(card_id)
    remaining_spells = sorted(
        (
            card
            for card in catalog_by_id.values()
            if card["category"] == "spell"
            and card["id"] not in selected_ids
            and registry.has_card_effect(card["id"])
        ),
        key=lambda card: card["id"],
    )
    for card in remaining_spells:
        if len(deck_by_category["spell"]) >= category_limits["spell"]:
            break
        add_card(card["id"])

    trap_priorities = (
        "t-mirror-force",
        "t-magic-cylinder",
        "t-trap-hole",
        "t-waboku",
        "t-compulsory-evacuation-device",
        "t-negate-attack",
        "t-trap-jammer",
        "t-magic-jammer",
        "t-call-of-the-haunted",
        "t-scrap-iron-scarecrow",
    )
    for card_id in trap_priorities:
        if registry.has_card_effect(card_id):
            add_card(card_id)
    remaining_traps = sorted(
        (
            card
            for card in catalog_by_id.values()
            if card["category"] == "trap"
            and card["id"] not in selected_ids
            and registry.has_card_effect(card["id"])
        ),
        key=lambda card: card["id"],
    )
    for card in remaining_traps:
        if len(deck_by_category["trap"]) >= category_limits["trap"]:
            break
        add_card(card["id"])

    deck = [
        card
        for category in ("monster", "spell", "trap")
        for card in deck_by_category[category]
    ]
    if len(deck) != DUEL_MAIN_MIN:
        raise DuelRuleError("Danh mục bài không đủ lá hợp lệ để tạo bộ bài AI.")
    return deck


def _public_duel_card(state, card, viewer):
    found_card = find_card(state, card["instance_id"])
    public_zone = found_card[1] if found_card else None
    public_zones = {"graveyard", "banished"}
    if (
        card.get("face_down", False)
        and card.get("owner") != viewer
        and public_zone not in public_zones
    ):
        return {
            "instance_id": card["instance_id"],
            "owner": card["owner"],
            "controller": card["controller"],
            "face_down": True,
            "position": card.get("position"),
        }
    public_card = deepcopy(card)
    if (
        card.get("category") in {"monster", "fusion"}
        and public_zone == "monster_zone"
    ):
        stats = current_stats(state, card["instance_id"])
        public_card["current_atk"] = stats["atk"]
        public_card["current_def"] = stats["def"]
    else:
        public_card.pop("current_atk", None)
        public_card.pop("current_def", None)
    if (
        viewer == "player"
        and card.get("controller") == "player"
        and not card.get("face_down", False)
        and card.get("clone_dragon_original_values")
    ):
        public_card["copy_effect_options"] = (
            _duel_action_engine.effect_engine.copied_monster_effect_options(
                state,
                player="player",
                source_instance_id=card["instance_id"],
            )
        )
    if (
        viewer == "player"
        and card.get("owner") == "player"
        and card.get("card_id")
        == "m-black-luster-soldier-envoy-of-the-beginning"
        and card.get("category") == "monster"
        and (
            find_card(state, card["instance_id"])
            and find_card(state, card["instance_id"])[1] == "hand"
        )
    ):
        light_cards = [
            grave_card
            for grave_card in state["players"]["player"]["graveyard"]
            if grave_card.get("category") in {"monster", "fusion"}
            and str(grave_card.get("attribute") or "").upper() == "LIGHT"
        ]
        dark_cards = [
            grave_card
            for grave_card in state["players"]["player"]["graveyard"]
            if grave_card.get("category") in {"monster", "fusion"}
            and str(grave_card.get("attribute") or "").upper() == "DARK"
        ]
        public_card["special_summon_options"] = [
            {
                "action": "special_summon_black_luster_soldier",
                "source_instance_id": card["instance_id"],
                "tribute_instance_ids": [light["instance_id"], dark["instance_id"]],
            }
            for light in light_cards
            for dark in dark_cards
            if light["instance_id"] != dark["instance_id"]
            and any(
                zone is None
                for zone in state["players"]["player"]["monster_zone"]
            )
        ]
    found_card = find_card(state, card["instance_id"])
    if (
        found_card
        and found_card[1] == "monster_zone"
        and found_card[0] == "player"
        and card.get("card_id")
        == "m-black-luster-soldier-envoy-of-the-beginning"
        and not card.get("face_down", False)
        and not card.get("monster_effects_negated", False)
        and state.get("chain", {}).get("status") == "closed"
        and state.get("phase") in {"main1", "main2"}
        and state.get("effect_uses", {}).get(
            f"player:{card['instance_id']}:black-luster-choice"
        ) != state["turn"]
    ):
        public_card["effect_options"] = [
            {
                "effect_id": "banish_monster",
                "requires_target": True,
                "valid_target_instance_ids": [
                    monster["instance_id"]
                    for owner in ("player", "ai")
                    for monster in state["players"][owner]["monster_zone"]
                    if monster
                ],
            }
        ]
    return public_card


def _public_duel_state(state, player_name=None, selected_character_id=None):
    players = {}
    for side in ("player", "ai"):
        zones = state["players"][side]
        is_human = side == "player"
        players[side] = {
            "player_name": player_name if is_human else "Đối thủ AI",
            "selected_character_id": (
                selected_character_id if is_human else None
            ),
            "lp": zones["lp"],
            "deck_count": len(zones["deck"]),
            "extra_deck_count": len(zones["extra_deck"]),
            "hand_count": len(zones["hand"]),
            "hand": (
                [_public_duel_card(state, card, "player") for card in zones["hand"]]
                if is_human
                else []
            ),
            "monster_zone": [
                _public_duel_card(state, card, "player") if card else None
                for card in zones["monster_zone"]
            ],
            "spell_trap_zone": [
                _public_duel_card(state, card, "player") if card else None
                for card in zones["spell_trap_zone"]
            ],
            "field_zone": [
                _public_duel_card(state, card, "player") if card else None
                for card in zones.get("field_zone", [None])
            ],
            "graveyard": [
                _public_duel_card(state, card, "player") for card in zones["graveyard"]
            ],
            "banished": [
                _public_duel_card(state, card, "player") for card in zones["banished"]
            ],
        }
    chain = deepcopy(state["chain"])
    chain["response_options"] = (
        _duel_action_engine.chain_response_options(state, "player")
        if (
            chain.get("status") == "open"
            and chain.get("priority_player") == "player"
            and chain.get("links")
            and chain["links"][-1].get("player") != "player"
        )
        else []
    )
    return {
        "match_id": state["match_id"],
        "turn": state["turn"],
        "turn_player": state["turn_player"],
        "first_player": state["first_player"],
        "phase": state["phase"],
        "drawn_this_turn": state["drawn_this_turn"],
        "normal_summon_used": deepcopy(state["normal_summon_used"]),
        "players": players,
        "chain": chain,
        "stat_modifiers": deepcopy(state["stat_modifiers"]),
        "pending_decision": deepcopy(state["pending_decision"]),
        "white_stone_effect_used": state.get("effect_uses", {}).get(
            "player:m-the-white-stone-of-ancients"
        ) == state["turn"],
        "maiden_effect_used": state.get("effect_uses", {}).get(
            "player:m-maiden-with-eyes-of-blue"
        ) == state["turn"],
        "pending_battle": deepcopy(state.get("pending_battle")),
        "last_dice_roll": deepcopy(state.get("last_dice_roll")),
        "last_slifer_triggers": [
            {
                **{key: value for key, value in entry.items() if key != "monster"},
                "monster": {
                    **_public_duel_card(state, entry["monster"], "player"),
                    "current_atk": entry.get("pre_atk"),
                    "current_def": entry.get("pre_def"),
                }
                if entry.get("monster")
                else None,
            }
            for entry in state.get("last_slifer_triggers", [])
        ],
        "attacked": deepcopy(state.get("attacked", {"player": [], "ai": []})),
        "over": state["over"],
        "winner": state["winner"],
        "exodia_winner": state.get("exodia_winner"),
    }


@app.get("/")
def home():
    return _serve_page("react.html")


def _serve_page(react_page):
    if not (REACT_BUILD_DIR / react_page).is_file():
        app.logger.error(
            "React production page %s is missing. Build it with npm --prefix frontend run build.",
            react_page,
        )
        return Response(
            "React production build is missing. Run npm --prefix frontend run build.",
            status=503,
            mimetype="text/plain",
        )
    response = send_from_directory(REACT_BUILD_DIR, react_page, max_age=0)
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    return response


@app.get("/login")
@app.get("/login.html")
@app.get("/react.html")
def login_page():
    return home()


@app.get("/start")
def start_page():
    if not _current_user():
        return redirect(url_for("home"))
    return _serve_page("react-start.html")


@app.get("/start.html")
@app.get("/react-start.html")
def start_html():
    return start_page()


@app.get("/index.html")
def game():
    if not _current_user():
        return redirect(url_for("home"))
    return _serve_page("index.html")


@app.get("/duel.html")
def duel():
    if not _current_user():
        return redirect(url_for("home"))
    return _serve_page("duel.html")


@app.get("/api/cards")
def api_cards():
    if not _current_user():
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    try:
        return jsonify(_load_card_data())
    except (OSError, json.JSONDecodeError, ValueError) as error:
        app.logger.error("Could not load card catalog: %s", error)
        return jsonify(error="Không thể tải dữ liệu bài."), 500


@app.post("/api/duel/start")
def api_duel_start():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    deck_number = _request_data().get("deck_number")
    if (
        not isinstance(deck_number, int)
        or isinstance(deck_number, bool)
        or not 1 <= deck_number <= DECK_COUNT
    ):
        return jsonify(error="Bộ bài được chọn không hợp lệ."), 400

    try:
        _ensure_schema()
        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            cursor = connection.cursor()
            if not cursor.execute(
                "SELECT Id FROM dbo.Users WHERE Id = ?",
                user["id"],
            ).fetchone():
                return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404
            snapshot = _deck_snapshot(cursor, user["id"])
            if snapshot["selected_deck_number"] != deck_number:
                return jsonify(error="Bộ bài đã chọn thay đổi. Hãy xác nhận lại bộ bài."), 409
            deck = next(
                (item for item in snapshot["decks"] if item["number"] == deck_number),
                None,
            )
            if not deck or not deck["unlocked"]:
                return jsonify(error="Bộ bài chưa được mở khóa."), 409
            if deck["duel_error"]:
                return jsonify(error=deck["duel_error"]), 400
            catalog = _load_card_catalog()

        cards_by_id = {str(card["id"]): card for card in catalog}
        player_deck = _expand_duel_deck(deck["main_cards"], cards_by_id)
        player_extra_deck = _expand_duel_deck(deck["extra_cards"], cards_by_id)
        ai_deck = _build_duel_ai_deck(catalog)
        state = create_duel_state(
            player_deck,
            ai_deck,
            player_extra_deck=player_extra_deck,
            first_player="player",
        )
    except DuelRuleError as error:
        return jsonify(error=str(error)), 400
    except AuthConfigurationError as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)
    except (OSError, json.JSONDecodeError, ValueError) as error:
        app.logger.error("Could not create duel from card catalog: %s", error)
        return jsonify(error="Không thể tải dữ liệu bài để bắt đầu Duel."), 500

    with _duel_sessions_lock:
        _duel_sessions[user["id"]] = {
            "deck_number": deck_number,
            "state": state,
        }
    return jsonify(
        match=_public_duel_state(
            state,
            user["player_name"],
            user.get("selected_character_id"),
        ),
        deck_number=deck_number,
    ), 201


@app.get("/api/duel/state")
def api_duel_state():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    match_id = request.args.get("match_id", "")
    if not match_id:
        return jsonify(error="Thiếu mã trận đấu."), 400
    with _duel_sessions_lock:
        match = _duel_sessions.get(user["id"])
        if not match or match["state"]["match_id"] != match_id:
            return jsonify(error="Không tìm thấy trận đấu đang hoạt động."), 404
        response = {
            "match": _public_duel_state(
                match["state"],
                user["player_name"],
                user.get("selected_character_id"),
            ),
            "deck_number": match["deck_number"],
        }
    return jsonify(response)


@app.post("/api/duel/action")
def api_duel_action():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    data = _request_data()
    match_id = data.get("match_id")
    action = data.get("action")
    if not isinstance(match_id, str) or not match_id:
        return jsonify(error="Mã trận đấu không hợp lệ."), 400
    if not isinstance(action, dict):
        return jsonify(error="Hành động Duel không hợp lệ."), 400

    with _duel_sessions_lock:
        match = _duel_sessions.get(user["id"])
        if not match or match["state"]["match_id"] != match_id:
            return jsonify(error="Không tìm thấy trận đấu đang hoạt động."), 404
        try:
            next_state = _duel_action_engine.apply(
                match["state"],
                player="player",
                action=action,
            )
        except DuelRuleError as error:
            return jsonify(error=str(error)), 400
        ai_turn_stages = next_state.pop("_ai_turn_stages", [])
        match["state"] = next_state
        response = {
            "match": _public_duel_state(
                next_state,
                user["player_name"],
                user.get("selected_character_id"),
            ),
            "deck_number": match["deck_number"],
        }
        if ai_turn_stages:
            response["ai_stages"] = [
                {
                    "type": stage["type"],
                    "match": _public_duel_state(
                        stage["state"],
                        user["player_name"],
                        user.get("selected_character_id"),
                    ),
                    **{
                        key: stage[key]
                        for key in ("attacker_instance_id", "defender_instance_id")
                        if key in stage
                    },
                }
                for stage in ai_turn_stages
            ]
    return jsonify(response)


@app.post("/api/duel/abandon")
def api_duel_abandon():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    match_id = _request_data().get("match_id")
    if not isinstance(match_id, str) or not match_id:
        return jsonify(error="Mã trận đấu không hợp lệ."), 400
    with _duel_sessions_lock:
        match = _duel_sessions.get(user["id"])
        if not match or match["state"]["match_id"] != match_id:
            return jsonify(error="Không tìm thấy trận đấu đang hoạt động."), 404
        del _duel_sessions[user["id"]]
    return jsonify(message="Đã kết thúc trận đấu.")


@app.get("/api/decks")
def api_decks():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    try:
        _ensure_schema()
        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            cursor = connection.cursor()
            if not cursor.execute(
                "SELECT Id FROM dbo.Users WHERE Id = ?",
                user["id"],
            ).fetchone():
                return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404
            return jsonify(snapshot=_deck_snapshot(cursor, user["id"]))
    except (AuthConfigurationError, ValueError) as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)


@app.post("/api/decks/select")
def api_deck_select():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    data = _request_data()
    deck_number = data.get("deck_number")
    if (
        not isinstance(deck_number, int)
        or isinstance(deck_number, bool)
        or not 1 <= deck_number <= DECK_COUNT
    ):
        return jsonify(error="Bộ bài được chọn không hợp lệ."), 400

    try:
        _ensure_schema()
        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            cursor = connection.cursor()
            if not cursor.execute(
                "SELECT Id FROM dbo.Users WITH (UPDLOCK, ROWLOCK) WHERE Id = ?",
                user["id"],
            ).fetchone():
                return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404

            snapshot = _deck_snapshot(cursor, user["id"])
            deck = next(
                (item for item in snapshot["decks"] if item["number"] == deck_number),
                None,
            )
            if not deck or not deck["unlocked"]:
                return jsonify(error="Bộ bài chưa được mở khóa."), 409
            if deck["duel_error"]:
                return jsonify(error=deck["duel_error"]), 400

            existing = cursor.execute(
                """
                SELECT SelectedDeckNumber
                FROM dbo.PlayerDuelPreferences WITH (UPDLOCK, HOLDLOCK)
                WHERE UserId = ?
                """,
                user["id"],
            ).fetchone()
            if existing:
                cursor.execute(
                    """
                    UPDATE dbo.PlayerDuelPreferences
                    SET SelectedDeckNumber = ?, UpdatedAtUtc = SYSUTCDATETIME()
                    WHERE UserId = ?
                    """,
                    deck_number,
                    user["id"],
                )
            else:
                cursor.execute(
                    """
                    INSERT INTO dbo.PlayerDuelPreferences (UserId, SelectedDeckNumber)
                    VALUES (?, ?)
                    """,
                    user["id"],
                    deck_number,
                )
            connection.commit()
            return jsonify(snapshot=_deck_snapshot(cursor, user["id"]))
    except (AuthConfigurationError, ValueError) as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)


@app.post("/api/cards/dismantle")
def api_card_dismantle():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    data = _request_data()
    card_id = data.get("card_id")
    request_id = _request_id(data)
    if not isinstance(card_id, str) or not card_id.strip() or not request_id:
        return jsonify(error="Lá bài hoặc mã giao dịch không hợp lệ."), 400
    card_id = card_id.strip()

    try:
        catalog = {
            str(card.get("id")): card
            for card in _load_card_catalog()
            if card.get("id") is not None
        }
        card = catalog.get(card_id)
        if not card:
            return jsonify(error="Không tìm thấy lá bài trong thư viện."), 404
        fragment_item_id = _card_fragment_item(card)
    except ValueError as error:
        return jsonify(error=str(error)), 400
    except (OSError, json.JSONDecodeError) as error:
        app.logger.error("Could not load card catalog for dismantling: %s", error)
        return jsonify(error="Không thể tải dữ liệu bài."), 503

    amount = CARD_DISMANTLE_QUANTITY
    fragment = INVENTORY_ITEMS[fragment_item_id]
    try:
        _ensure_schema()
        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            cursor = connection.cursor()
            account = cursor.execute(
                "SELECT Id FROM dbo.Users WITH (UPDLOCK, ROWLOCK) WHERE Id = ?",
                user["id"],
            ).fetchone()
            if not account:
                connection.rollback()
                return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404

            previous = _previous_action_response(
                cursor, user["id"], request_id, "dismantle_card"
            )
            if previous is not None:
                connection.commit()
                return jsonify(previous)

            owned_row = cursor.execute(
                """
                SELECT Quantity FROM dbo.PlayerCards WITH (UPDLOCK, HOLDLOCK)
                WHERE UserId = ? AND CardId = ?
                """,
                user["id"],
                card_id,
            ).fetchone()
            if not owned_row:
                connection.rollback()
                return jsonify(error="Bạn không sở hữu lá bài này."), 409

            owned_quantity = int(owned_row.Quantity)
            deck_row = cursor.execute(
                """
                SELECT COALESCE(SUM(Quantity), 0) AS Quantity
                FROM dbo.PlayerDeckCards
                WHERE UserId = ? AND CardId = ?
                """,
                user["id"],
                card_id,
            ).fetchone()
            deck_quantity = int(deck_row.Quantity) if deck_row else 0
            available_quantity = _available_card_quantity(
                owned_quantity, deck_quantity
            )
            if available_quantity < amount:
                connection.rollback()
                return jsonify(
                    error=(
                        f"Cần ít nhất {amount} bản sao chưa dùng trong bộ bài "
                        f"để tách; hiện có {available_quantity}."
                    )
                ), 409

            fragment_row = cursor.execute(
                """
                SELECT Quantity FROM dbo.PlayerInventory WITH (UPDLOCK, ROWLOCK)
                WHERE UserId = ? AND ItemId = ?
                """,
                user["id"],
                fragment_item_id,
            ).fetchone()
            if fragment_row and int(fragment_row.Quantity) >= 2147483647:
                connection.rollback()
                return jsonify(error="Số lượng mảnh nhận được vượt giới hạn kho vật phẩm."), 409

            remaining_quantity = owned_quantity - amount
            if remaining_quantity:
                cursor.execute(
                    """
                    UPDATE dbo.PlayerCards SET Quantity = ?
                    WHERE UserId = ? AND CardId = ?
                    """,
                    remaining_quantity,
                    user["id"],
                    card_id,
                )
            else:
                cursor.execute(
                    "DELETE FROM dbo.PlayerCards WHERE UserId = ? AND CardId = ?",
                    user["id"],
                    card_id,
                )

            if not _grant_inventory_item(
                cursor,
                user["id"],
                fragment_item_id,
                1,
                "Tách Bài",
                request_id,
            ):
                raise ActionRequestConflict("Mã giao dịch tách bài đã được sử dụng.")

            result = {
                "message": f"Tách thành công! Bạn nhận được {fragment['name']}.",
                "card_id": card_id,
                "owned_quantity": remaining_quantity,
                "deck_quantity": deck_quantity,
                "available_quantity": _available_card_quantity(
                    remaining_quantity, deck_quantity
                ),
                "reward": {
                    "id": fragment_item_id,
                    "kind": "fragment",
                    "name": fragment["name"],
                    "image": fragment["image"],
                    "amount": 1,
                },
                "inventory": _inventory_state(cursor, user["id"]),
            }
            _store_action_response(
                cursor, user["id"], request_id, "dismantle_card", result
            )
            connection.commit()
    except ActionRequestConflict as error:
        return jsonify(error=str(error)), 409
    except (AuthConfigurationError, ValueError) as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)

    return jsonify(result)


@app.post("/api/decks/save")
def api_deck_save():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    data = _request_data()
    deck_number = data.get("deck_number")
    expected_version = data.get("version")
    name = data.get("name")
    notes = data.get("notes", "")
    main_cards = data.get("main_cards")
    extra_cards = data.get("extra_cards")
    if (
        not isinstance(deck_number, int)
        or isinstance(deck_number, bool)
        or not 1 <= deck_number <= DECK_COUNT
        or not isinstance(expected_version, int)
        or isinstance(expected_version, bool)
        or not isinstance(name, str)
        or not isinstance(notes, str)
        or not isinstance(main_cards, list)
        or not isinstance(extra_cards, list)
    ):
        return jsonify(error="Thông tin lưu bộ bài không hợp lệ."), 400
    name = name.strip()
    notes = notes.strip()
    if not name or len(name) > 32 or len(notes) > 240:
        return jsonify(error="Tên bộ bài phải từ 1–32 ký tự, ghi chú tối đa 240 ký tự."), 400

    try:
        _ensure_schema()
        catalog = _load_card_catalog()
        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            cursor = connection.cursor()
            account = cursor.execute(
                "SELECT Id FROM dbo.Users WITH (UPDLOCK, ROWLOCK) WHERE Id = ?",
                user["id"],
            ).fetchone()
            if not account:
                connection.rollback()
                return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404
            deck = cursor.execute(
                """
                SELECT IsUnlocked, Version FROM dbo.PlayerDecks WITH (UPDLOCK, ROWLOCK)
                WHERE UserId = ? AND DeckNumber = ?
                """,
                user["id"],
                deck_number,
            ).fetchone()
            if not deck or not deck.IsUnlocked:
                connection.rollback()
                return jsonify(error="Bộ bài này chưa được mở khóa."), 409
            if int(deck.Version) != expected_version:
                connection.rollback()
                return jsonify(error="Bộ bài đã được cập nhật ở nơi khác. Tải lại dữ liệu trước khi lưu."), 409
            owned_quantities = {
                row.CardId: int(row.Quantity)
                for row in cursor.execute(
                    """
                    SELECT CardId, Quantity FROM dbo.PlayerCards WITH (UPDLOCK, HOLDLOCK)
                    WHERE UserId = ?
                    """,
                    user["id"],
                ).fetchall()
            }
            normalized = _validate_deck_cards(
                main_cards,
                extra_cards,
                catalog,
                owned_quantities,
            )
            updated = cursor.execute(
                """
                UPDATE dbo.PlayerDecks
                SET Name = ?, Notes = ?, Version = Version + 1,
                    UpdatedAtUtc = SYSUTCDATETIME()
                WHERE UserId = ? AND DeckNumber = ? AND Version = ?
                """,
                name,
                notes,
                user["id"],
                deck_number,
                expected_version,
            )
            if updated.rowcount != 1:
                connection.rollback()
                return jsonify(error="Bộ bài đã được cập nhật ở nơi khác. Tải lại dữ liệu trước khi lưu."), 409
            cursor.execute(
                "DELETE FROM dbo.PlayerDeckCards WHERE UserId = ? AND DeckNumber = ?",
                user["id"],
                deck_number,
            )
            for location in ("main", "extra"):
                for sort_order, entry in enumerate(normalized[location]):
                    cursor.execute(
                        """
                        INSERT INTO dbo.PlayerDeckCards
                            (UserId, DeckNumber, Location, CardId, Quantity, SortOrder)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        user["id"],
                        deck_number,
                        location,
                        entry["card_id"],
                        entry["quantity"],
                        sort_order,
                    )
            snapshot = _deck_snapshot(cursor, user["id"])
            connection.commit()
        return jsonify(snapshot=snapshot)
    except ValueError as error:
        return jsonify(error=str(error)), 400
    except (AuthConfigurationError, json.JSONDecodeError) as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)


@app.post("/api/decks/unlock")
def api_deck_unlock():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    data = _request_data()
    deck_number = data.get("deck_number")
    request_id = _request_id(data)
    if (
        not isinstance(deck_number, int)
        or isinstance(deck_number, bool)
        or not 1 <= deck_number <= DECK_COUNT
        or not request_id
    ):
        return jsonify(error="Bộ bài hoặc mã giao dịch không hợp lệ."), 400
    price = DECK_UNLOCK_PRICES.get(deck_number)
    if price is None:
        return jsonify(error="Giá mở khóa bộ bài này chưa được cấu hình."), 409

    action = f"unlock_deck_{deck_number}"
    try:
        _ensure_schema()
        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            cursor = connection.cursor()
            account = cursor.execute(
                "SELECT Gems FROM dbo.Users WITH (UPDLOCK, ROWLOCK) WHERE Id = ?",
                user["id"],
            ).fetchone()
            if not account:
                connection.rollback()
                return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404
            previous = _previous_action_response(
                cursor,
                user["id"],
                request_id,
                action,
            )
            if previous is not None:
                connection.commit()
                return jsonify(previous)
            existing = cursor.execute(
                """
                SELECT IsUnlocked FROM dbo.PlayerDecks WITH (UPDLOCK, ROWLOCK)
                WHERE UserId = ? AND DeckNumber = ?
                """,
                user["id"],
                deck_number,
            ).fetchone()
            if existing and existing.IsUnlocked:
                connection.rollback()
                return jsonify(error="Bộ bài này đã được mở khóa."), 409
            if int(account.Gems) < price:
                connection.rollback()
                return jsonify(error="Bạn không đủ gem để mở khóa bộ bài này."), 409
            cursor.execute(
                "UPDATE dbo.Users SET Gems = Gems - ? WHERE Id = ?",
                price,
                user["id"],
            )
            if existing:
                cursor.execute(
                    """
                    UPDATE dbo.PlayerDecks
                    SET IsUnlocked = 1, Version = Version + 1,
                        UpdatedAtUtc = SYSUTCDATETIME()
                    WHERE UserId = ? AND DeckNumber = ? AND IsUnlocked = 0
                    """,
                    user["id"],
                    deck_number,
                )
            else:
                cursor.execute(
                    """
                    INSERT INTO dbo.PlayerDecks (UserId, DeckNumber, Name, IsUnlocked)
                    VALUES (?, ?, ?, 1)
                    """,
                    user["id"],
                    deck_number,
                    f"Bộ Bài {deck_number}",
                )
            result = {
                "message": f"Đã mở khóa Bộ Bài {deck_number}.",
                "snapshot": _deck_snapshot(cursor, user["id"]),
            }
            _store_action_response(cursor, user["id"], request_id, action, result)
            connection.commit()
        return jsonify(result)
    except ActionRequestConflict as error:
        return jsonify(error=str(error)), 409
    except (AuthConfigurationError, ValueError) as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)


@app.post("/api/decks/cards/seen")
def api_deck_card_seen():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401
    card_id = _request_data().get("card_id")
    if not isinstance(card_id, str) or not card_id.strip():
        return jsonify(error="Thẻ bài không hợp lệ."), 400

    try:
        _ensure_schema()
        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            cursor = connection.cursor()
            owned = cursor.execute(
                "SELECT 1 FROM dbo.PlayerCards WHERE UserId = ? AND CardId = ?",
                user["id"],
                card_id,
            ).fetchone()
            if not owned:
                connection.rollback()
                return jsonify(error="Bạn chưa sở hữu thẻ bài này."), 404
            cursor.execute(
                """
                UPDATE dbo.PlayerNewCards
                SET IsViewed = 1, ViewedAtUtc = SYSUTCDATETIME()
                WHERE UserId = ? AND CardId = ? AND IsViewed = 0
                """,
                user["id"],
                card_id,
            )
            cursor.execute(
                """
                IF NOT EXISTS (
                    SELECT 1 FROM dbo.PlayerNewCards
                    WHERE UserId = ? AND CardId = ?
                )
                    INSERT INTO dbo.PlayerNewCards
                        (UserId, CardId, IsViewed, ViewedAtUtc)
                    VALUES (?, ?, 1, SYSUTCDATETIME())
                """,
                user["id"],
                card_id,
                user["id"],
                card_id,
            )
            count = cursor.execute(
                """
                SELECT COUNT(*) AS NewCardsCount
                FROM dbo.PlayerCards owned
                LEFT JOIN dbo.PlayerNewCards new_cards
                    ON new_cards.UserId = owned.UserId
                    AND new_cards.CardId = owned.CardId
                WHERE owned.UserId = ? AND owned.Quantity > 0
                    AND (new_cards.CardId IS NULL OR new_cards.IsViewed = 0)
                """,
                user["id"],
            ).fetchone().NewCardsCount
            connection.commit()
        return jsonify(card_id=card_id, new_cards_count=int(count))
    except (AuthConfigurationError, ValueError) as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)


@app.get("/<path:asset>")
def frontend_asset(asset):
    if asset.startswith("assets/"):
        return send_from_directory(BACKEND_DIR, asset)
    if asset.startswith("js/"):
        return Response("Legacy frontend scripts have been replaced by the React application.", status=404)
    if asset in {"legacy-index.html", "legacy-duel.html"}:
        return redirect(url_for("game" if asset == "legacy-index.html" else "duel"))
    return send_from_directory(FRONTEND_DIR, asset)


@app.get("/api/session")
def api_session():
    user = _current_user()
    if not user:
        return jsonify(user=None)

    try:
        _ensure_schema()
        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            cursor = connection.cursor()
            account = cursor.execute(
                "SELECT PlayerName FROM dbo.Users WHERE Id = ?",
                user["id"],
            ).fetchone()
            progress = _progress_state(cursor, user["id"])
            unlocked = _unlocked_character_ids(cursor, user["id"])
    except AuthConfigurationError as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)

    if not account or not progress:
        return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404
    user["player_name"] = account.PlayerName
    session["player_name"] = account.PlayerName
    character_id = progress["selected_character_id"]
    if character_id is not None and character_id not in CHARACTER_IDS:
        app.logger.error(
            "Invalid selected character %r for user id %s.",
            character_id,
            user["id"],
        )
        return jsonify(error="Nhân vật đại diện trong tài khoản không hợp lệ."), 500

    user["selected_character_id"] = character_id
    user["progress"] = progress
    user["unlocked_characters"] = unlocked
    user["character_unlock_levels"] = _character_unlock_levels(character_id)
    user["needs_character_selection"] = character_id is None
    session["selected_character_id"] = character_id
    return jsonify(user=user)


@app.get("/api/profile/rename-info")
def api_profile_rename_info():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    try:
        _ensure_schema()
        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            cursor = connection.cursor()
            account = cursor.execute(
                """
                SELECT PlayerName, SuccessfulRenameCount
                FROM dbo.Users
                WHERE Id = ?
                """,
                user["id"],
            ).fetchone()
            inventory = cursor.execute(
                """
                SELECT Quantity FROM dbo.PlayerInventory
                WHERE UserId = ? AND ItemId = N'rename_card'
                """,
                user["id"],
            ).fetchone()
    except AuthConfigurationError as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)

    if not account:
        return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404
    successful_rename_count = int(account.SuccessfulRenameCount)
    rename_card_count = int(inventory.Quantity) if inventory else 0
    user["player_name"] = account.PlayerName
    session["player_name"] = account.PlayerName
    return jsonify(
        player_name=account.PlayerName,
        successful_rename_count=successful_rename_count,
        required_cards=_rename_card_cost(successful_rename_count),
        rename_card_count=rename_card_count,
    )


@app.get("/api/missions")
def api_missions():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    try:
        _ensure_schema()
        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            snapshot = _mission_snapshot(connection.cursor(), user["id"])
    except (AuthConfigurationError, ValueError) as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)

    if not snapshot:
        return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404
    return jsonify(snapshot=snapshot)


@app.post("/api/missions/claim")
def api_mission_claim():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    data = _request_data()
    mission_id = data.get("mission_id")
    request_id = _request_id(data)
    if not isinstance(mission_id, str) or mission_id not in MISSION_REWARDS or not request_id:
        return jsonify(error="Nhiệm vụ hoặc mã giao dịch không hợp lệ."), 400

    action = f"claim_mission_{mission_id}"
    try:
        _ensure_schema()
        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            cursor = connection.cursor()
            account = cursor.execute(
                "SELECT Id FROM dbo.Users WITH (UPDLOCK, ROWLOCK) WHERE Id = ?",
                user["id"],
            ).fetchone()
            if not account:
                connection.rollback()
                return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404

            previous = _previous_action_response(
                cursor, user["id"], request_id, action
            )
            if previous is not None:
                connection.commit()
                return jsonify(previous)

            business_now = _business_datetime()
            business_date = business_now.date()
            period_start = _mission_period_start(mission_id, business_date)
            progress = cursor.execute(
                """
                SELECT Progress, IsClaimed
                FROM dbo.PlayerMissionProgress
                WHERE UserId = ? AND MissionId = ? AND PeriodStart = ?
                """,
                user["id"],
                mission_id,
                period_start,
            ).fetchone()
            if not progress or int(progress.Progress) < MISSION_REWARDS[mission_id]["target"]:
                connection.rollback()
                return jsonify(error="Nhiệm vụ chưa hoàn thành."), 409
            if progress.IsClaimed:
                connection.rollback()
                return jsonify(error="Phần thưởng nhiệm vụ này đã được nhận."), 409

            updated = cursor.execute(
                """
                UPDATE dbo.PlayerMissionProgress
                SET IsClaimed = 1, ClaimedAtUtc = SYSUTCDATETIME()
                WHERE UserId = ? AND MissionId = ? AND PeriodStart = ?
                    AND IsClaimed = 0 AND Progress >= ?
                """,
                user["id"],
                mission_id,
                period_start,
                MISSION_REWARDS[mission_id]["target"],
            )
            if updated.rowcount != 1:
                connection.rollback()
                return jsonify(error="Phần thưởng nhiệm vụ này đã được nhận."), 409

            rewards = _grant_quest_rewards(
                cursor,
                user["id"],
                MISSION_REWARDS[mission_id]["rewards"],
                f"mission_{mission_id}",
                request_id,
                business_date,
            )
            wallet = cursor.execute(
                "SELECT Gold, Gems FROM dbo.Users WHERE Id = ?",
                user["id"],
            ).fetchone()
            result = {
                "message": "Bạn đã nhận thưởng nhiệm vụ thành công!",
                "mission_id": mission_id,
                "rewards": rewards,
                "wallet": {"gold": int(wallet.Gold), "gems": int(wallet.Gems)},
                "inventory": _inventory_state(cursor, user["id"]),
                "snapshot": _mission_snapshot(cursor, user["id"], business_now),
            }
            _store_action_response(
                cursor, user["id"], request_id, action, result
            )
            connection.commit()
    except ActionRequestConflict as error:
        return jsonify(error=str(error)), 409
    except (AuthConfigurationError, ValueError) as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)

    return jsonify(result)


@app.post("/api/missions/chests/claim")
def api_activity_chest_claim():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    data = _request_data()
    chest_id = data.get("chest_id")
    request_id = _request_id(data)
    chest = next(
        (entry for entry in ACTIVITY_CHESTS if entry["id"] == chest_id),
        None,
    )
    if not chest or not request_id:
        return jsonify(error="Rương hoặc mã giao dịch không hợp lệ."), 400

    action = f"claim_chest_{chest_id}"
    try:
        _ensure_schema()
        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            cursor = connection.cursor()
            account = cursor.execute(
                "SELECT Id FROM dbo.Users WITH (UPDLOCK, ROWLOCK) WHERE Id = ?",
                user["id"],
            ).fetchone()
            if not account:
                connection.rollback()
                return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404

            previous = _previous_action_response(
                cursor, user["id"], request_id, action
            )
            if previous is not None:
                connection.commit()
                return jsonify(previous)

            business_now = _business_datetime()
            business_date = business_now.date()
            week_start = _week_start(business_date)
            point_row = cursor.execute(
                """
                SELECT Points FROM dbo.PlayerActivityPoints
                WHERE UserId = ? AND WeekStart = ?
                """,
                user["id"],
                week_start,
            ).fetchone()
            points = int(point_row.Points) if point_row else 0
            if points < chest["threshold"]:
                connection.rollback()
                return jsonify(error="Bạn chưa đủ điểm năng động để nhận rương này."), 409

            claimed = cursor.execute(
                """
                SELECT 1 FROM dbo.PlayerActivityChestClaims
                WHERE UserId = ? AND WeekStart = ? AND ChestId = ?
                """,
                user["id"],
                week_start,
                chest_id,
            ).fetchone()
            if claimed:
                connection.rollback()
                return jsonify(error="Rương này đã được nhận trong tuần hiện tại."), 409

            cursor.execute(
                """
                INSERT INTO dbo.PlayerActivityChestClaims
                    (UserId, WeekStart, WeekEnd, ChestId)
                VALUES (?, ?, ?, ?)
                """,
                user["id"],
                week_start,
                week_start + timedelta(days=6),
                chest_id,
            )
            rewards = _grant_quest_rewards(
                cursor,
                user["id"],
                chest["rewards"],
                f"activity_{chest_id}",
                request_id,
                business_date,
            )
            wallet = cursor.execute(
                "SELECT Gold, Gems FROM dbo.Users WHERE Id = ?",
                user["id"],
            ).fetchone()
            result = {
                "message": "Chúc mừng bạn đã nhận thành công phần thưởng!",
                "chest_id": chest_id,
                "rewards": rewards,
                "wallet": {"gold": int(wallet.Gold), "gems": int(wallet.Gems)},
                "inventory": _inventory_state(cursor, user["id"]),
                "snapshot": _mission_snapshot(cursor, user["id"], business_now),
            }
            _store_action_response(
                cursor, user["id"], request_id, action, result
            )
            connection.commit()
    except ActionRequestConflict as error:
        return jsonify(error=str(error)), 409
    except (AuthConfigurationError, ValueError) as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)

    return jsonify(result)


@app.get("/api/inventory")
def api_inventory():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    try:
        _ensure_schema()
        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            cursor = connection.cursor()
            inventory = _inventory_state(cursor, user["id"])
            progress = _progress_state(cursor, user["id"])
    except (AuthConfigurationError, ValueError) as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)

    if not progress:
        return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404
    return jsonify(inventory=inventory, progress=progress)


@app.post("/api/fragments/merge")
def api_fragment_merge():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    data = _request_data()
    item_id = data.get("item_id")
    request_id = _request_id(data)
    if not isinstance(item_id, str) or not request_id:
        return jsonify(error="Mảnh hoặc mã giao dịch không hợp lệ."), 400
    try:
        recipe = _fragment_merge_recipe(item_id)
    except ValueError as error:
        status = 409 if item_id == "gr_fragment" else 400
        return jsonify(error=str(error)), status

    amount = recipe["quantity"]
    gold_cost = recipe["gold"]
    reward_item_id = recipe["reward_item"]
    try:
        _ensure_schema()
        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            cursor = connection.cursor()
            wallet = cursor.execute(
                """
                SELECT Gold, Gems FROM dbo.Users WITH (UPDLOCK, ROWLOCK)
                WHERE Id = ?
                """,
                user["id"],
            ).fetchone()
            if not wallet:
                connection.rollback()
                return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404

            previous = _previous_action_response(
                cursor, user["id"], request_id, "merge_fragments"
            )
            if previous is not None:
                connection.commit()
                return jsonify(previous)

            fragment = cursor.execute(
                """
                SELECT Quantity FROM dbo.PlayerInventory WITH (UPDLOCK, ROWLOCK)
                WHERE UserId = ? AND ItemId = ?
                """,
                user["id"],
                item_id,
            ).fetchone()
            if not fragment or int(fragment.Quantity) < amount:
                connection.rollback()
                return jsonify(error=f"Bạn cần có đủ {amount} {INVENTORY_ITEMS[item_id]['name']}."), 409
            if int(wallet.Gold) < gold_cost:
                connection.rollback()
                return jsonify(error="Bạn không đủ Gold để ghép mảnh."), 409

            reward_row = cursor.execute(
                """
                SELECT Quantity FROM dbo.PlayerInventory WITH (UPDLOCK, ROWLOCK)
                WHERE UserId = ? AND ItemId = ?
                """,
                user["id"],
                reward_item_id,
            ).fetchone()
            if reward_row and int(reward_row.Quantity) >= 2147483647:
                connection.rollback()
                return jsonify(error="Số lượng mảnh nhận được vượt giới hạn kho vật phẩm."), 409

            updated_wallet = cursor.execute(
                """
                UPDATE dbo.Users
                SET Gold = Gold - ?
                OUTPUT INSERTED.Gold, INSERTED.Gems
                WHERE Id = ? AND Gold >= ?
                """,
                gold_cost,
                user["id"],
                gold_cost,
            ).fetchone()
            if not updated_wallet:
                connection.rollback()
                return jsonify(error="Bạn không đủ Gold để ghép mảnh."), 409

            remaining = int(fragment.Quantity) - amount
            if remaining:
                cursor.execute(
                    """
                    UPDATE dbo.PlayerInventory SET Quantity = ?
                    WHERE UserId = ? AND ItemId = ?
                    """,
                    remaining,
                    user["id"],
                    item_id,
                )
            else:
                cursor.execute(
                    "DELETE FROM dbo.PlayerInventory WHERE UserId = ? AND ItemId = ?",
                    user["id"],
                    item_id,
                )
            cursor.execute(
                """
                INSERT INTO dbo.PlayerItemEvents
                    (UserId, ItemId, Quantity, Source, RequestId)
                VALUES (?, ?, ?, N'Ghép Mảnh', NULL)
                """,
                user["id"],
                item_id,
                -amount,
            )
            _grant_inventory_item(
                cursor,
                user["id"],
                reward_item_id,
                1,
                "Ghép Mảnh",
            )
            reward_definition = INVENTORY_ITEMS[reward_item_id]
            result = {
                "message": f"Ghép thành công! Bạn nhận được {reward_definition['name']}.",
                "reward": {
                    "id": reward_item_id,
                    "kind": "fragment",
                    "name": reward_definition["name"],
                    "image": reward_definition["image"],
                    "amount": 1,
                },
                "wallet": {
                    "gold": int(updated_wallet.Gold),
                    "gems": int(updated_wallet.Gems),
                },
                "inventory": _inventory_state(cursor, user["id"]),
            }
            _store_action_response(
                cursor, user["id"], request_id, "merge_fragments", result
            )
            connection.commit()
    except ActionRequestConflict as error:
        return jsonify(error=str(error)), 409
    except (AuthConfigurationError, ValueError) as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)

    return jsonify(result)


@app.post("/api/inventory/use")
def api_inventory_use():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    data = _request_data()
    item_id = data.get("item_id")
    quantity = data.get("quantity")
    request_id = _request_id(data)
    if (
        item_id != "exp"
        or not isinstance(quantity, int)
        or isinstance(quantity, bool)
        or quantity < 1
        or quantity > 1000
        or not request_id
    ):
        return jsonify(error="Vật phẩm, số lượng hoặc mã giao dịch không hợp lệ."), 400

    try:
        _ensure_schema()
        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            cursor = connection.cursor()
            cursor.execute(
                "SELECT Id FROM dbo.Users WITH (UPDLOCK, ROWLOCK) WHERE Id = ?",
                user["id"],
            )
            previous = _previous_action_response(
                cursor, user["id"], request_id, "use_exp"
            )
            if previous is not None:
                connection.commit()
                return jsonify(previous)

            progress = _progress_state(cursor, user["id"])
            if not progress:
                connection.rollback()
                return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404
            if progress["level"] >= MAX_LEVEL:
                connection.rollback()
                return jsonify(error="Bạn đã đạt cấp tối đa, không thể sử dụng vật phẩm EXP."), 409

            inventory_row = cursor.execute(
                """
                SELECT Quantity FROM dbo.PlayerInventory WITH (UPDLOCK, ROWLOCK)
                WHERE UserId = ? AND ItemId = N'exp'
                """,
                user["id"],
            ).fetchone()
            if not inventory_row or int(inventory_row.Quantity) < quantity:
                connection.rollback()
                return jsonify(error="Bạn không có đủ vật phẩm EXP."), 409

            old_level = progress["level"]
            new_experience, experience_gained, new_level = _experience_after_items(
                progress["experience"], quantity
            )
            cursor.execute(
                "UPDATE dbo.Users SET Experience = ?, Level = ? WHERE Id = ?",
                new_experience,
                new_level,
                user["id"],
            )
            remaining = int(inventory_row.Quantity) - quantity
            if remaining:
                cursor.execute(
                    "UPDATE dbo.PlayerInventory SET Quantity = ? WHERE UserId = ? AND ItemId = N'exp'",
                    remaining,
                    user["id"],
                )
            else:
                cursor.execute(
                    "DELETE FROM dbo.PlayerInventory WHERE UserId = ? AND ItemId = N'exp'",
                    user["id"],
                )
            cursor.execute(
                """
                INSERT INTO dbo.PlayerItemEvents
                    (UserId, ItemId, Quantity, Source, RequestId)
                VALUES (?, N'exp', ?, N'used', ?)
                """,
                user["id"],
                -quantity,
                request_id,
            )
            newly_unlocked = _apply_level_unlocks(
                cursor, user["id"], old_level, new_level
            )
            result = {
                "message": f"Đã sử dụng {quantity} vật phẩm và nhận {experience_gained} EXP.",
                "items_used": quantity,
                "experience_gained": experience_gained,
                "progress": _progress_state(cursor, user["id"]),
                "unlocked_characters": newly_unlocked,
                "inventory": _inventory_state(cursor, user["id"]),
            }
            _store_action_response(
                cursor, user["id"], request_id, "use_exp", result
            )
            connection.commit()
    except ActionRequestConflict as error:
        return jsonify(error=str(error)), 409
    except (AuthConfigurationError, ValueError) as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)

    return jsonify(result)


@app.get("/api/attendance")
def api_attendance_snapshot():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    try:
        _ensure_schema()
        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            snapshot = _attendance_snapshot(connection.cursor(), user["id"])
    except (AuthConfigurationError, ValueError) as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)

    if not snapshot:
        return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404
    return jsonify(snapshot=snapshot)


@app.post("/api/attendance/heartbeat")
def api_attendance_heartbeat():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    try:
        _ensure_schema()
        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            cursor = connection.cursor()
            account = cursor.execute(
                "SELECT Id FROM dbo.Users WITH (UPDLOCK, ROWLOCK) WHERE Id = ?",
                user["id"],
            ).fetchone()
            if not account:
                connection.rollback()
                return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404

            now_utc = datetime.now(timezone.utc)
            _record_online_heartbeat(cursor, user["id"], now_utc)
            snapshot = _attendance_snapshot(
                cursor, user["id"], _business_datetime(now_utc)
            )
            connection.commit()
    except (AuthConfigurationError, ValueError) as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)

    if not snapshot:
        return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404
    return jsonify(snapshot=snapshot)


@app.post("/api/attendance/claim")
def api_attendance_claim():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    data = _request_data()
    claim_type = data.get("claim_type")
    request_id = _request_id(data)
    if (
        not isinstance(claim_type, str)
        or claim_type not in {"monthly", "makeup", "online"}
        or not request_id
    ):
        return jsonify(error="Yêu cầu điểm danh không hợp lệ."), 400

    makeup_day = data.get("day")
    milestone_minutes = data.get("milestone_minutes")
    if claim_type == "makeup" and (
        not isinstance(makeup_day, int)
        or isinstance(makeup_day, bool)
        or not 1 <= makeup_day <= 31
    ):
        return jsonify(error="Ngày cần điểm danh bù không hợp lệ."), 400
    if claim_type == "online" and (
        not isinstance(milestone_minutes, int)
        or isinstance(milestone_minutes, bool)
        or milestone_minutes
        not in {milestone["minutes"] for milestone in ONLINE_ATTENDANCE_MILESTONES}
    ):
        return jsonify(error="Mốc điểm danh online không hợp lệ."), 400

    action = f"attendance_{claim_type}"
    try:
        _ensure_schema()
        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            cursor = connection.cursor()
            account = cursor.execute(
                "SELECT Id FROM dbo.Users WITH (UPDLOCK, ROWLOCK) WHERE Id = ?",
                user["id"],
            ).fetchone()
            if not account:
                connection.rollback()
                return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404

            previous = _previous_action_response(
                cursor, user["id"], request_id, action
            )
            if previous is not None:
                connection.commit()
                return jsonify(previous)

            transaction_now = datetime.now(timezone.utc)
            business_now = _business_datetime(transaction_now)
            today = business_now.date()
            claim_date = today
            rewards = []
            reward_key = "monthly"
            is_makeup = False
            makeup_gem_cost = 0
            online_seconds = None

            if claim_type == "monthly":
                reward = _monthly_attendance_reward(today.day)
                existing = cursor.execute(
                    """
                    SELECT 1 FROM dbo.PlayerAttendanceClaims
                    WHERE UserId = ? AND BusinessDate = ?
                        AND ClaimType = N'monthly' AND RewardKey = N'monthly'
                    """,
                    user["id"],
                    today,
                ).fetchone()
                if existing:
                    connection.rollback()
                    return jsonify(error="Bạn đã điểm danh hôm nay rồi!"), 409
                rewards = [(reward["kind"], reward["amount"])]

            elif claim_type == "makeup":
                try:
                    missed_day = date(today.year, today.month, makeup_day)
                except ValueError:
                    connection.rollback()
                    return jsonify(error="Ngày cần điểm danh bù không tồn tại."), 400
                if missed_day >= today:
                    connection.rollback()
                    return jsonify(error="Chỉ có thể điểm danh bù ngày đã qua trong tháng này."), 400

                existing = cursor.execute(
                    """
                    SELECT 1 FROM dbo.PlayerAttendanceClaims
                    WHERE UserId = ? AND BusinessDate = ?
                        AND ClaimType = N'monthly' AND RewardKey = N'monthly'
                    """,
                    user["id"],
                    missed_day,
                ).fetchone()
                if existing:
                    connection.rollback()
                    return jsonify(error="Phần thưởng ngày này đã được nhận."), 409

                month_start = date(today.year, today.month, 1)
                next_month = (
                    date(today.year + 1, 1, 1)
                    if today.month == 12
                    else date(today.year, today.month + 1, 1)
                )
                makeup_count = cursor.execute(
                    """
                    SELECT COUNT(*) AS MakeupCount
                    FROM dbo.PlayerAttendanceClaims
                    WHERE UserId = ? AND ClaimType = N'monthly'
                        AND IsMakeup = 1 AND BusinessDate >= ? AND BusinessDate < ?
                    """,
                    user["id"],
                    month_start,
                    next_month,
                ).fetchone().MakeupCount
                makeup_gem_cost = _makeup_attendance_cost(int(makeup_count))
                wallet = cursor.execute(
                    "SELECT Gems FROM dbo.Users WHERE Id = ?",
                    user["id"],
                ).fetchone()
                if not wallet or int(wallet.Gems) < makeup_gem_cost:
                    connection.rollback()
                    return jsonify(error="Bạn không đủ gem để điểm danh bù."), 409
                cursor.execute(
                    "UPDATE dbo.Users SET Gems = Gems - ? WHERE Id = ?",
                    makeup_gem_cost,
                    user["id"],
                )
                reward = _monthly_attendance_reward(missed_day.day)
                rewards = [(reward["kind"], reward["amount"])]
                claim_date = missed_day
                is_makeup = True

            else:
                _record_online_heartbeat(cursor, user["id"], transaction_now)
                online_row = cursor.execute(
                    """
                    SELECT OnlineSeconds FROM dbo.PlayerOnlinePresence
                    WHERE UserId = ? AND BusinessDate = ?
                    """,
                    user["id"],
                    today,
                ).fetchone()
                online_seconds = int(online_row.OnlineSeconds) if online_row else 0
                milestone = next(
                    entry
                    for entry in ONLINE_ATTENDANCE_MILESTONES
                    if entry["minutes"] == milestone_minutes
                )
                if online_seconds < milestone_minutes * 60:
                    connection.rollback()
                    return jsonify(error="Bạn chưa đủ thời gian online để nhận thưởng này."), 409
                existing = cursor.execute(
                    """
                    SELECT 1 FROM dbo.PlayerAttendanceClaims
                    WHERE UserId = ? AND BusinessDate = ?
                        AND ClaimType = N'online' AND RewardKey = ?
                    """,
                    user["id"],
                    today,
                    str(milestone_minutes),
                ).fetchone()
                if existing:
                    connection.rollback()
                    return jsonify(error="Phần thưởng online này đã được nhận."), 409
                reward_key = str(milestone_minutes)
                rewards = list(milestone["rewards"])

            granted_rewards = _apply_attendance_rewards(
                cursor,
                user["id"],
                rewards,
                f"attendance_{claim_type}",
                request_id,
            )
            cursor.execute(
                """
                INSERT INTO dbo.PlayerAttendanceClaims
                    (UserId, BusinessDate, ClaimType, RewardKey, IsMakeup,
                        MakeupGemCost, OnlineSeconds, RewardJson)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                user["id"],
                claim_date,
                "online" if claim_type == "online" else "monthly",
                reward_key,
                is_makeup,
                makeup_gem_cost,
                online_seconds,
                json.dumps(granted_rewards, ensure_ascii=False),
            )
            if claim_type in {"monthly", "makeup"}:
                _record_mission_event(
                    cursor,
                    user["id"],
                    f"attendance:{today.isoformat()}",
                    "attendance",
                    1,
                    today,
                )
            wallet = cursor.execute(
                "SELECT Gold, Gems FROM dbo.Users WHERE Id = ?",
                user["id"],
            ).fetchone()
            snapshot = _attendance_snapshot(cursor, user["id"], business_now)
            result = {
                "message": (
                    "Điểm danh bù thành công!"
                    if is_makeup
                    else "Đã nhận phần thưởng điểm danh!"
                ),
                "claim": {
                    "type": claim_type,
                    "business_date": claim_date.isoformat(),
                    "is_makeup": is_makeup,
                    "makeup_gem_cost": makeup_gem_cost,
                    "milestone_minutes": milestone_minutes
                    if claim_type == "online"
                    else None,
                    "online_seconds": online_seconds,
                },
                "rewards": granted_rewards,
                "wallet": {"gold": int(wallet.Gold), "gems": int(wallet.Gems)},
                "snapshot": snapshot,
            }
            _store_action_response(
                cursor, user["id"], request_id, action, result
            )
            connection.commit()
    except ActionRequestConflict as error:
        return jsonify(error=str(error)), 409
    except (AuthConfigurationError, ValueError) as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)

    return jsonify(result)


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


@app.post("/api/shop/items/rename-card")
def api_shop_purchase_rename_cards():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    data = _request_data()
    try:
        quantity = data.get("quantity")
        total_price = _rename_card_purchase_price(quantity)
    except ValueError as error:
        return jsonify(error=str(error)), 400
    request_id = _request_id(data)
    if not request_id:
        return jsonify(error="Mã giao dịch mua hàng không hợp lệ."), 400

    try:
        _ensure_schema()
        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            cursor = connection.cursor()
            wallet = cursor.execute(
                """
                SELECT Gold, Gems FROM dbo.Users WITH (UPDLOCK, ROWLOCK)
                WHERE Id = ?
                """,
                user["id"],
            ).fetchone()
            if not wallet:
                connection.rollback()
                return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404

            previous = _previous_action_response(
                cursor, user["id"], request_id, "purchase_rename_card"
            )
            if previous is not None:
                connection.commit()
                return jsonify(previous)

            if int(wallet.Gems) < total_price:
                connection.rollback()
                return jsonify(error="Bạn không đủ Gem để mua vật phẩm này."), 409

            existing_item = cursor.execute(
                """
                SELECT Quantity FROM dbo.PlayerInventory WITH (UPDLOCK, ROWLOCK)
                WHERE UserId = ? AND ItemId = N'rename_card'
                """,
                user["id"],
            ).fetchone()
            current_quantity = int(existing_item.Quantity) if existing_item else 0
            if current_quantity > 2147483647 - quantity:
                connection.rollback()
                return jsonify(error="Số lượng Thẻ Đổi Tên vượt giới hạn kho vật phẩm."), 409

            updated_wallet = cursor.execute(
                """
                UPDATE dbo.Users
                SET Gems = Gems - ?
                OUTPUT INSERTED.Gold, INSERTED.Gems
                WHERE Id = ?
                """,
                total_price,
                user["id"],
            ).fetchone()
            _grant_inventory_item(
                cursor,
                user["id"],
                "rename_card",
                quantity,
                "shop_purchase",
                request_id,
            )
            result = {
                "message": "Mua Thẻ Đổi Tên thành công!",
                "item": {
                    "id": "rename_card",
                    "name": INVENTORY_ITEMS["rename_card"]["name"],
                    "quantity": quantity,
                    "unit_price": RENAME_CARD_GEM_PRICE,
                    "total_price": total_price,
                },
                "wallet": {
                    "gold": int(updated_wallet.Gold),
                    "gems": int(updated_wallet.Gems),
                },
                "inventory": _inventory_state(cursor, user["id"]),
            }
            _store_action_response(
                cursor, user["id"], request_id, "purchase_rename_card", result
            )
            connection.commit()
    except ActionRequestConflict as error:
        return jsonify(error=str(error)), 409
    except (AuthConfigurationError, ValueError) as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)

    return jsonify(result)


@app.post("/api/shop/purchase")
def api_shop_purchase():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    data = _request_data()
    pack_id = data.get("pack_id")
    pack_count = data.get("pack_count")
    request_id = _request_id(data)
    if (
        not isinstance(pack_id, str)
        or pack_id not in SHOP_PACKS
        or SHOP_PACKS[pack_id].get("purchase_mode") == "single_card"
        or not isinstance(pack_count, int)
        or isinstance(pack_count, bool)
        or pack_count not in PACK_COUNTS
        or not request_id
    ):
        return jsonify(error="Gói bài, số lượng mua hoặc mã giao dịch không hợp lệ."), 400

    try:
        _ensure_schema()
        pack = SHOP_PACKS[pack_id]
        pack_cards = _shop_pack_cards(pack)
        if not pack_cards:
            return jsonify(error="Gói bài hiện chưa có dữ liệu lá bài."), 503

        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            cursor = connection.cursor()
            wallet = cursor.execute(
                """
                SELECT Gold, Gems, SelectedCharacterId
                FROM dbo.Users WITH (UPDLOCK, ROWLOCK)
                WHERE Id = ?
                """,
                user["id"],
            ).fetchone()
            if not wallet:
                connection.rollback()
                return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404
            if wallet.SelectedCharacterId not in CHARACTER_IDS:
                connection.rollback()
                return jsonify(error="Bạn cần chọn nhân vật khởi đầu trước khi mua bài."), 409

            previous = _previous_action_response(
                cursor, user["id"], request_id, "purchase_pack"
            )
            if previous is not None:
                connection.commit()
                return jsonify(previous)

            unlocked = cursor.execute(
                """
                SELECT 1 FROM dbo.PlayerCharacters
                WHERE UserId = ? AND CharacterId = ?
                """,
                user["id"],
                pack["unlock_character_id"],
            ).fetchone()
            if not unlocked:
                connection.rollback()
                return jsonify(error="Bạn chưa mở khóa nhân vật sở hữu gói bài này."), 403

            owned = {
                row.CardId: int(row.Quantity)
                for row in cursor.execute(
                    "SELECT CardId, Quantity FROM dbo.PlayerCards WITH (UPDLOCK, HOLDLOCK) WHERE UserId = ?",
                    user["id"],
                ).fetchall()
            }
            try:
                rewards = _choose_pack_rewards(
                    pack_cards,
                    pack_count,
                    owned_quantities=owned,
                )
            except ShopPackStockExhausted as error:
                connection.rollback()
                return jsonify(error=str(error)), 409

            token_row = cursor.execute(
                """
                SELECT Quantity FROM dbo.PlayerInventory WITH (UPDLOCK, ROWLOCK)
                WHERE UserId = ? AND ItemId = N'character_card'
                """,
                user["id"],
            ).fetchone()
            tokens_available = int(token_row.Quantity) if token_row else 0
            tokens_used, currency, remaining_cost = _pack_payment(
                pack_count,
                tokens_available,
                int(wallet.Gold),
                int(wallet.Gems),
            )
            balance = (
                int(wallet.Gold if currency == "Gold" else wallet.Gems)
                if currency else 0
            )
            if balance < remaining_cost:
                connection.rollback()
                payment_name = "vàng" if currency == "Gold" else "gem"
                return jsonify(
                    error=(
                        f"Bạn có {tokens_available} thẻ, cần thêm "
                        f"{remaining_cost - balance:,} "
                        f"{payment_name} "
                        f"để mua đủ {pack_count} gói."
                    ).replace(",", ".")
                ), 409

            if tokens_used:
                token_remaining = tokens_available - tokens_used
                if token_remaining:
                    cursor.execute(
                        """
                        UPDATE dbo.PlayerInventory SET Quantity = ?
                        WHERE UserId = ? AND ItemId = N'character_card'
                        """,
                        token_remaining,
                        user["id"],
                    )
                else:
                    cursor.execute(
                        """
                        DELETE FROM dbo.PlayerInventory
                        WHERE UserId = ? AND ItemId = N'character_card'
                        """,
                        user["id"],
                    )
                cursor.execute(
                    """
                    INSERT INTO dbo.PlayerItemEvents
                        (UserId, ItemId, Quantity, Source, RequestId)
                    VALUES (?, N'character_card', ?, N'shop_purchase', ?)
                    """,
                    user["id"],
                    -tokens_used,
                    request_id,
                )
            if remaining_cost:
                cursor.execute(
                    f"UPDATE dbo.Users SET {currency} = {currency} - ? WHERE Id = ?",
                    remaining_cost,
                    user["id"],
                )
            for reward in rewards:
                if (
                    owned.get(reward["id"], 0) == 0
                    and _is_new_card_eligible(reward)
                ):
                    cursor.execute(
                        """
                        UPDATE dbo.PlayerNewCards
                        SET IsViewed = 0, CreatedAtUtc = SYSUTCDATETIME(),
                            ViewedAtUtc = NULL
                        WHERE UserId = ? AND CardId = ?;
                        IF @@ROWCOUNT = 0
                            INSERT INTO dbo.PlayerNewCards (UserId, CardId)
                            VALUES (?, ?)
                        """,
                        user["id"],
                        reward["id"],
                        user["id"],
                        reward["id"],
                    )
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
                owned[reward["id"]] = owned.get(reward["id"], 0) + 1

            _record_mission_event(
                cursor,
                user["id"],
                f"purchase:{request_id}",
                "pack_purchase",
                pack_count,
                _business_datetime().date(),
            )
            state = _shop_state(cursor, user["id"])
            updated_pack = next(item for item in state["packs"] if item["id"] == pack_id)
            reward_cards = {card["id"]: card for card in updated_pack["cards"]}
            result = {
                "message": "Đã mở " + str(pack_count) + " gói bài.",
                "rewards": [reward_cards[card["id"]] for card in rewards],
                "tokens_used": tokens_used,
                "currency_used": currency.lower() if remaining_cost else None,
                "currency_spent": remaining_cost,
                **state,
            }
            _store_action_response(
                cursor, user["id"], request_id, "purchase_pack", result
            )
            connection.commit()

    except ActionRequestConflict as error:
        return jsonify(error=str(error)), 409
    except (AuthConfigurationError, ValueError) as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)

    return jsonify(result)


@app.post("/api/shop/redeem-card")
def api_shop_redeem_card():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    data = _request_data()
    card_id = data.get("card_id")
    request_id = _request_id(data)
    if not isinstance(card_id, str) or not card_id.strip() or not request_id:
        return jsonify(error="Lá bài hoặc mã giao dịch không hợp lệ."), 400
    card_id = card_id.strip()

    try:
        pack = SHOP_PACKS[GOD_PACK_ID]
        card = next(
            (
                item for item in _shop_pack_cards(pack)
                if str(item.get("id")) == card_id
            ),
            None,
        )
        if not card:
            return jsonify(error="Lá bài không thuộc Gói Bài Thần."), 404
        if (
            card.get("maxCopies") != 1
            or card.get("rarity") not in pack.get("prices_by_rarity", {})
        ):
            app.logger.error(
                "God pack card %s has an unsupported rarity or copy limit.",
                card_id,
            )
            return jsonify(error="Dữ liệu lá bài trong gói không hợp lệ."), 503
        price_item_id, price = _shop_pack_card_price(pack, card)
    except (OSError, json.JSONDecodeError) as error:
        app.logger.error("Could not load card catalog for god pack: %s", error)
        return jsonify(error="Không thể tải dữ liệu bài."), 503
    except (AuthConfigurationError, ValueError) as error:
        return jsonify(error=str(error)), 503

    try:
        _ensure_schema()
        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            cursor = connection.cursor()
            account = cursor.execute(
                "SELECT Id FROM dbo.Users WITH (UPDLOCK, ROWLOCK) WHERE Id = ?",
                user["id"],
            ).fetchone()
            if not account:
                connection.rollback()
                return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404

            previous = _previous_action_response(
                cursor, user["id"], request_id, "redeem_god_pack_card"
            )
            if previous is not None:
                connection.commit()
                return jsonify(previous)

            owned_row = cursor.execute(
                """
                SELECT Quantity FROM dbo.PlayerCards WITH (UPDLOCK, HOLDLOCK)
                WHERE UserId = ? AND CardId = ?
                """,
                user["id"],
                card_id,
            ).fetchone()
            if owned_row:
                connection.rollback()
                return jsonify(error="Bạn đã sở hữu lá bài này; mỗi lá chỉ được lấy một bản."), 409

            fragment_row = cursor.execute(
                """
                SELECT Quantity FROM dbo.PlayerInventory WITH (UPDLOCK, ROWLOCK)
                WHERE UserId = ? AND ItemId = ?
                """,
                user["id"],
                price_item_id,
            ).fetchone()
            available_fragments = int(fragment_row.Quantity) if fragment_row else 0
            if available_fragments < price:
                connection.rollback()
                return jsonify(
                    error=(
                        f"Bạn cần {price} "
                        f"{INVENTORY_ITEMS[price_item_id]['name']} để đổi lá bài này."
                    )
                ), 409

            remaining_fragments = available_fragments - price
            if remaining_fragments:
                cursor.execute(
                    """
                    UPDATE dbo.PlayerInventory SET Quantity = ?
                    WHERE UserId = ? AND ItemId = ?
                    """,
                    remaining_fragments,
                    user["id"],
                    price_item_id,
                )
            else:
                cursor.execute(
                    "DELETE FROM dbo.PlayerInventory WHERE UserId = ? AND ItemId = ?",
                    user["id"],
                    price_item_id,
                )
            cursor.execute(
                """
                INSERT INTO dbo.PlayerItemEvents
                    (UserId, ItemId, Quantity, Source, RequestId)
                VALUES (?, ?, ?, N'Gói Bài Thần', ?)
                """,
                user["id"],
                price_item_id,
                -price,
                request_id,
            )
            cursor.execute(
                """
                UPDATE dbo.PlayerNewCards
                SET IsViewed = 0, CreatedAtUtc = SYSUTCDATETIME(),
                    ViewedAtUtc = NULL
                WHERE UserId = ? AND CardId = ?;
                IF @@ROWCOUNT = 0
                    INSERT INTO dbo.PlayerNewCards (UserId, CardId)
                    VALUES (?, ?)
                """,
                user["id"],
                card_id,
                user["id"],
                card_id,
            )
            cursor.execute(
                "INSERT INTO dbo.PlayerCards (UserId, CardId, Quantity) VALUES (?, ?, 1)",
                user["id"],
                card_id,
            )

            state = _shop_state(cursor, user["id"])
            if not state:
                connection.rollback()
                return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404
            result = {
                **state,
                "message": f"Đổi thành công {card['name']}.",
                "redeemed_card_id": card_id,
            }
            _store_action_response(
                cursor, user["id"], request_id, "redeem_god_pack_card", result
            )
            connection.commit()
    except ActionRequestConflict as error:
        return jsonify(error=str(error)), 409
    except (AuthConfigurationError, ValueError) as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)

    return jsonify(result)


@app.post("/api/shop/reset")
def api_shop_reset():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    pack_id = _request_data().get("pack_id")
    if (
        not isinstance(pack_id, str)
        or pack_id not in SHOP_PACKS
        or not SHOP_PACKS[pack_id].get("resettable", True)
    ):
        return jsonify(error="Gói bài cần tạo lại không hợp lệ."), 400

    try:
        _ensure_schema()
        pack_cards = _shop_pack_cards(SHOP_PACKS[pack_id])
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

    try:
        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            cursor = connection.cursor()
            account = cursor.execute(
                "SELECT Id FROM dbo.Users WITH (UPDLOCK, ROWLOCK) WHERE Id = ?",
                int(row.Id),
            ).fetchone()
            if not account:
                connection.rollback()
                return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404
            business_date = _business_datetime().date()
            _record_mission_event(
                cursor,
                int(row.Id),
                f"login:{business_date.isoformat()}",
                "login",
                1,
                business_date,
            )
            connection.commit()
    except pyodbc.Error as error:
        return _database_error(error)

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
            row = cursor.execute(
                """
                SELECT SelectedCharacterId FROM dbo.Users WITH (UPDLOCK, ROWLOCK)
                WHERE Id = ?
                """,
                user["id"],
            ).fetchone()
            if not row:
                connection.rollback()
                return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404
            if row.SelectedCharacterId is None:
                if character_id not in STARTER_CHARACTER_IDS:
                    connection.rollback()
                    return jsonify(error="Nhân vật khởi đầu được chọn không hợp lệ."), 400
                cursor.execute(
                    """
                    IF NOT EXISTS (
                        SELECT 1 FROM dbo.PlayerCharacters
                        WHERE UserId = ? AND CharacterId = ?
                    )
                        INSERT INTO dbo.PlayerCharacters
                            (UserId, CharacterId, UnlockedAtLevel)
                        VALUES (?, ?, 1)
                    """,
                    user["id"],
                    character_id,
                    user["id"],
                    character_id,
                )
                user_progress = _progress_state(cursor, user["id"])
                if user_progress:
                    cursor.execute(
                        "UPDATE dbo.Users SET SelectedCharacterId = ? WHERE Id = ?",
                        character_id,
                        user["id"],
                    )
                    _apply_level_unlocks(
                        cursor, user["id"], 1, user_progress["level"]
                    )
            else:
                unlocked = cursor.execute(
                    """
                    SELECT 1 FROM dbo.PlayerCharacters
                    WHERE UserId = ? AND CharacterId = ?
                    """,
                    user["id"],
                    character_id,
                ).fetchone()
                if not unlocked:
                    connection.rollback()
                    return jsonify(error="Bạn chưa mở khóa nhân vật này."), 403
            cursor.execute(
                "UPDATE dbo.Users SET SelectedCharacterId = ? WHERE Id = ?",
                character_id,
                user["id"],
            )
            connection.commit()
            unlocked = _unlocked_character_ids(cursor, user["id"])
    except AuthConfigurationError as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)

    session["selected_character_id"] = character_id
    return jsonify(
        message="Đã lưu nhân vật đại diện.",
        selected_character_id=character_id,
        unlocked_characters=unlocked,
        character_unlock_levels=_character_unlock_levels(character_id),
    )


@app.post("/api/profile/player-name")
def api_update_player_name():
    user = _current_user()
    if not user:
        return jsonify(error="Phiên đăng nhập không còn hợp lệ."), 401

    data = _request_data()
    try:
        player_name = _validated_player_name(data.get("player_name"))
    except ValueError as error:
        return jsonify(error=str(error)), 400

    request_id = _request_id(data)
    if not request_id:
        return jsonify(error="Mã giao dịch đổi tên không hợp lệ."), 400

    try:
        _ensure_schema()
        with pyodbc.connect(_connection_string(DATABASE_NAME), timeout=5) as connection:
            cursor = connection.cursor()
            account = cursor.execute(
                """
                SELECT PlayerName, SuccessfulRenameCount
                FROM dbo.Users WITH (UPDLOCK, ROWLOCK)
                WHERE Id = ?
                """,
                user["id"],
            ).fetchone()
            if not account:
                connection.rollback()
                return jsonify(error="Không tìm thấy tài khoản. Vui lòng đăng nhập lại."), 404

            previous = _previous_action_response(
                cursor, user["id"], request_id, "rename_player_name"
            )
            if previous is not None:
                connection.commit()
                session["player_name"] = previous["player_name"]
                return jsonify(previous)

            if account.PlayerName == player_name:
                connection.rollback()
                return jsonify(error="Tên mới phải khác tên người chơi hiện tại."), 400

            successful_rename_count = int(account.SuccessfulRenameCount)
            required_cards = _rename_card_cost(successful_rename_count)
            inventory = cursor.execute(
                """
                SELECT Quantity FROM dbo.PlayerInventory WITH (UPDLOCK, ROWLOCK)
                WHERE UserId = ? AND ItemId = N'rename_card'
                """,
                user["id"],
            ).fetchone()
            current_cards = int(inventory.Quantity) if inventory else 0
            if current_cards < required_cards:
                connection.rollback()
                return jsonify(
                    error=f"Không đủ Thẻ Đổi Tên. Bạn cần {required_cards} thẻ nhưng hiện có {current_cards} thẻ."
                ), 409

            if required_cards:
                remaining_cards = current_cards - required_cards
                if remaining_cards:
                    cursor.execute(
                        """
                        UPDATE dbo.PlayerInventory SET Quantity = ?
                        WHERE UserId = ? AND ItemId = N'rename_card'
                        """,
                        remaining_cards,
                        user["id"],
                    )
                else:
                    cursor.execute(
                        """
                        DELETE FROM dbo.PlayerInventory
                        WHERE UserId = ? AND ItemId = N'rename_card'
                        """,
                        user["id"],
                    )
                cursor.execute(
                    """
                    INSERT INTO dbo.PlayerItemEvents
                        (UserId, ItemId, Quantity, Source, RequestId)
                    VALUES (?, N'rename_card', ?, N'used', ?)
                    """,
                    user["id"],
                    -required_cards,
                    request_id,
                )

            update = cursor.execute(
                """
                UPDATE dbo.Users
                SET PlayerName = ?, SuccessfulRenameCount = SuccessfulRenameCount + 1
                WHERE Id = ?
                """,
                player_name,
                user["id"],
            )
            if update.rowcount != 1:
                connection.rollback()
                return jsonify(error="Không thể cập nhật dữ liệu người chơi."), 500

            inventory_state = _inventory_state(cursor, user["id"])
            updated_count = successful_rename_count + 1
            message = (
                "Đổi tên lần đầu thành công! Bạn không cần sử dụng Thẻ Đổi Tên."
                if required_cards == 0
                else "Đổi tên thành công! Tên người chơi mới của bạn đã được cập nhật."
            )
            result = {
                "message": message,
                "player_name": player_name,
                "successful_rename_count": updated_count,
                "required_cards": _rename_card_cost(updated_count),
                "rename_card_count": max(0, current_cards - required_cards),
                "inventory": inventory_state,
            }
            _store_action_response(
                cursor, user["id"], request_id, "rename_player_name", result
            )
            connection.commit()
    except ActionRequestConflict as error:
        return jsonify(error=str(error)), 409
    except AuthConfigurationError as error:
        return jsonify(error=str(error)), 503
    except pyodbc.Error as error:
        return _database_error(error)

    session["player_name"] = player_name
    return jsonify(result)


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
