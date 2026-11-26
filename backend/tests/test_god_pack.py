import json
import sys
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import unquote
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app import (
    GOD_CARD_FRAGMENT_COST,
    GOD_CARD_FRAGMENT_ITEM_ID,
    GOD_PACK_ID,
    SHOP_PACKS,
    _load_card_catalog,
    _shop_pack_card_price,
    _shop_pack_cards,
    _validate_deck_cards,
    app as flask_app,
)


class GodPackCursor:
    def __init__(self, fragment_quantity=10, owned_quantity=0, previous=None):
        self.fragment_quantity = fragment_quantity
        self.owned_quantity = owned_quantity
        self.previous = previous
        self.rows = []
        self.rowcount = 1
        self.card_inserted = False
        self.item_events = []
        self.saved_response = None

    def execute(self, query, *parameters):
        if "SELECT Id FROM dbo.Users WITH (UPDLOCK, ROWLOCK)" in query:
            self.rows = [SimpleNamespace(Id=1)]
        elif "SELECT Action, ResponseJson FROM dbo.PlayerActionRequests" in query:
            self.rows = [self.previous] if self.previous else []
        elif "SELECT Quantity FROM dbo.PlayerCards WITH (UPDLOCK, HOLDLOCK)" in query:
            self.rows = (
                [SimpleNamespace(Quantity=self.owned_quantity)]
                if self.owned_quantity
                else []
            )
        elif "SELECT Quantity FROM dbo.PlayerInventory WITH (UPDLOCK, ROWLOCK)" in query:
            self.rows = (
                [SimpleNamespace(Quantity=self.fragment_quantity)]
                if self.fragment_quantity
                else []
            )
        elif "UPDATE dbo.PlayerInventory SET Quantity = ?" in query:
            self.fragment_quantity = parameters[0]
            self.rowcount = 1
        elif "DELETE FROM dbo.PlayerInventory WHERE UserId = ? AND ItemId = ?" in query:
            self.fragment_quantity = 0
            self.rowcount = 1
        elif "INSERT INTO dbo.PlayerItemEvents" in query:
            self.item_events.append(parameters)
        elif "UPDATE dbo.PlayerNewCards" in query:
            self.rowcount = 0
        elif "INSERT INTO dbo.PlayerCards" in query:
            self.card_inserted = True
        elif "INSERT INTO dbo.PlayerActionRequests" in query:
            self.saved_response = json.loads(parameters[3])
        else:
            raise AssertionError(f"Unexpected query: {query}")
        return self

    def fetchone(self):
        return self.rows[0] if self.rows else None


class GodPackConnection:
    def __init__(self, cursor):
        self._cursor = cursor
        self.committed = False
        self.rolled_back = False

    def __enter__(self):
        return self

    def __exit__(self, _error_type, _error, _traceback):
        return False

    def cursor(self):
        return self._cursor

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True


class GodPackTests(unittest.TestCase):
    def setUp(self):
        self.cards = _shop_pack_cards(
            SHOP_PACKS[GOD_PACK_ID],
            _load_card_catalog(),
        )

    def test_exodia_cards_are_ur_global_cards_with_one_copy_limit(self):
        cards = [card for card in self.cards if card["rarity"] == "UR"]
        exodia_cards = [card for card in cards if "forbidden-one" in card["id"]]
        self.assertEqual(len(exodia_cards), 5)
        self.assertEqual(len(cards), 6)
        for card in cards:
            with self.subTest(card=card["id"]):
                self.assertEqual(card["rarity"], "UR")
                self.assertEqual(card["maxCopies"], 1)
                self.assertNotIn("characterIds", card)
                self.assertTrue(card["image"])
                artwork_path = Path(__file__).resolve().parents[1] / unquote(card["image"])
                self.assertTrue(artwork_path.is_file(), artwork_path)

    def test_four_god_cards_are_gr_with_artwork_and_limited_to_one_copy(self):
        cards = [card for card in self.cards if card["rarity"] == "GR"]

        self.assertEqual(len(cards), 4)
        for card in cards:
            with self.subTest(card=card["id"]):
                self.assertEqual(card["maxCopies"], 1)
                self.assertTrue(card["image"])
                artwork_path = Path(__file__).resolve().parents[1] / unquote(card["image"])
                self.assertTrue(artwork_path.is_file(), artwork_path)
                self.assertNotIn("characterIds", card)
                self.assertEqual(card["packIds"], [GOD_PACK_ID])
                with self.assertRaisesRegex(ValueError, "quá 1 bản sao"):
                    _validate_deck_cards(
                        [{"card_id": card["id"], "quantity": 2}],
                        [],
                        self.cards,
                        {card["id"]: 2},
                    )

    def test_slifer_reduces_atk_or_def_for_either_summon_position(self):
        slifer = next(card for card in self.cards if card["id"] == "m-slifer-the-sky-dragon")
        effects = {skill["name"]: skill["description"] for skill in slifer["skills"]}

        self.assertIn("hiến tế 3 quái thú", effects["Triệu Hồi Thần Rồng Osiris"])
        self.assertIn("không thể bị vô hiệu hóa", effects["Triệu Hồi Thần Rồng Osiris"])
        self.assertIn("1000 ATK", effects["Sức Mạnh Từ Bài Trên Tay"])
        self.assertIn("1000 DEF", effects["Sức Mạnh Từ Bài Trên Tay"])
        self.assertIn("mỗi lá bài trên tay bạn", effects["Sức Mạnh Từ Bài Trên Tay"])
        self.assertNotIn("2000", effects["Sức Mạnh Từ Bài Trên Tay"])
        self.assertIn("ở tư thế tấn công", effects["Sấm Sét Thần"])
        self.assertIn("2000 ATK", effects["Sấm Sét Thần"])
        self.assertIn("ở tư thế phòng thủ", effects["Sấm Sét Thần"])
        self.assertIn("2000 DEF", effects["Sấm Sét Thần"])
        self.assertIn("trong Giai đoạn Kết thúc", effects["Kết Thúc Triệu Hồi Đặc Biệt"])
        self.assertIn("đưa nó vào Mộ", effects["Kết Thúc Triệu Hồi Đặc Biệt"])

    def test_obelisk_has_summon_protection_and_tribute_effects(self):
        obelisk = next(card for card in self.cards if card["id"] == "m-obelisk-the-tormentor")
        effects = {skill["name"]: skill["description"] for skill in obelisk["skills"]}

        self.assertIn("hiến tế 3 quái thú", effects["Triệu Hồi Thần Obelisk"])
        self.assertIn("không thể bị vô hiệu hóa", effects["Triệu Hồi Thần Obelisk"])
        self.assertIn("không thể kích hoạt bài hoặc hiệu ứng khác", effects["Triệu Hồi Thần Obelisk"])
        self.assertIn("Không người chơi nào", effects["Thân Thể Bất Khả Xâm Phạm"])
        self.assertIn("chọn lá bài này làm mục tiêu", effects["Thân Thể Bất Khả Xâm Phạm"])
        self.assertIn("hiến tế 2 quái thú", effects["Cú Đấm Hỏa Binh"])
        self.assertIn("phá hủy toàn bộ quái thú đối thủ", effects["Cú Đấm Hỏa Binh"])
        self.assertIn("không thể tuyên bố tấn công", effects["Cú Đấm Hỏa Binh"])
        self.assertIn("trong Giai đoạn Kết thúc", effects["Kết Thúc Triệu Hồi Đặc Biệt"])

    def test_ra_lists_its_summoning_and_both_life_point_effects(self):
        ra = next(card for card in self.cards if card["id"] == "m-the-winged-dragon-of-ra")
        effects = {skill["name"]: skill["description"] for skill in ra["skills"]}

        self.assertIn("3 quái thú", effects["Triệu hồi Thần Rồng Ra"])
        self.assertNotIn("Không thể Triệu hồi Đặc biệt", effects["Triệu hồi Thần Rồng Ra"])
        self.assertIn("không thể kích hoạt bài hoặc hiệu ứng khác", effects["Triệu hồi Thần Rồng Ra"])
        self.assertIn("tổng ATK", effects["Sức Mạnh Vật Hiến Tế"])
        self.assertIn("tổng DEF", effects["Sức Mạnh Vật Hiến Tế"])
        self.assertIn("có thể kích hoạt hiệu ứng này hoặc bỏ qua", effects["Sinh Lực Mặt Trời"])
        self.assertIn("chỉ còn 100 LP", effects["Sinh Lực Mặt Trời"])
        self.assertIn("tăng ATK và DEF bằng số LP đã trả", effects["Sinh Lực Mặt Trời"])
        self.assertIn("trả 1000 LP", effects["Khẩu Pháo Thần Công"])
        self.assertIn("phá hủy", effects["Khẩu Pháo Thần Công"])
        self.assertIn("trong Giai đoạn Kết thúc", effects["Kết Thúc Triệu Hồi Đặc Biệt"])
        self.assertIn("đưa nó vào Mộ", effects["Kết Thúc Triệu Hồi Đặc Biệt"])

    def test_god_pack_prices_cards_by_rarity(self):
        ur_card = next(card for card in self.cards if card["rarity"] == "UR")
        gr_cards = [card for card in self.cards if card["rarity"] == "GR"]

        self.assertEqual(
            _shop_pack_card_price(SHOP_PACKS[GOD_PACK_ID], ur_card),
            ("ur_fragment", 5),
        )
        self.assertEqual(len(gr_cards), 4)
        for card in gr_cards:
            with self.subTest(card=card["id"]):
                self.assertEqual(
                    _shop_pack_card_price(SHOP_PACKS[GOD_PACK_ID], card),
                    ("gr_fragment", GOD_CARD_FRAGMENT_COST),
                )

    def test_new_god_cards_are_in_library_catalog_response(self):
        with flask_app.test_client() as client, patch(
            "app._current_user", return_value={"id": 1}
        ):
            response = client.get("/api/cards")

        payload = response.get_json()
        god_cards = {
            card["id"]
            for card in payload["cards"]
            if card["rarity"] == "GR" and card.get("packIds") == [GOD_PACK_ID]
        }
        self.assertEqual(response.status_code, 200)
        self.assertTrue({
            "m-slifer-the-sky-dragon",
            "m-obelisk-the-tormentor",
            "m-the-winged-dragon-of-ra",
            "m-the-creator-god-of-light-horakhty",
        }.issubset(god_cards))

    def test_exodia_head_has_its_five_piece_win_condition_skill(self):
        head = next(card for card in self.cards if card["id"] == "m-exodia-the-forbidden-one")

        self.assertEqual(len(head["skills"]), 1)
        self.assertEqual(head["skills"][0]["name"], "Exodia")
        self.assertIn("đủ bốn mảnh còn lại", head["skills"][0]["description"])
        self.assertIn("trên tay", head["skills"][0]["description"])
        self.assertIn("thắng trận đấu", head["skills"][0]["description"])

    def test_exodia_cards_are_deck_limited_to_one_copy(self):
        card = self.cards[0]
        with self.assertRaisesRegex(ValueError, "quá 1 bản sao"):
            _validate_deck_cards(
                [{"card_id": card["id"], "quantity": 2}],
                [],
                self.cards,
                {card["id"]: 2},
            )

    def test_successful_redemption_spends_five_ur_fragments_and_adds_one_card(self):
        card = self.cards[0]
        cursor = GodPackCursor(fragment_quantity=8)
        connection = GodPackConnection(cursor)
        state = {
            "wallet": {"gold": 0, "gems": 0},
            "inventory": [{"id": GOD_CARD_FRAGMENT_ITEM_ID, "quantity": 3}],
            "packs": [{"id": GOD_PACK_ID, "cards": [{**card, "ownedQuantity": 1}]}],
        }
        with flask_app.test_client() as client, patch(
            "app._current_user", return_value={"id": 1}
        ), patch("app._load_card_catalog", return_value=self.cards), patch(
            "app._ensure_schema"
        ), patch("app._connection_string", return_value="test"), patch(
            "app.pyodbc.connect", return_value=connection
        ), patch("app._shop_state", return_value=state):
            response = client.post(
                "/api/shop/redeem-card",
                json={"card_id": card["id"], "request_id": str(uuid.uuid4())},
            )

        payload = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(cursor.fragment_quantity, 3)
        self.assertTrue(cursor.card_inserted)
        self.assertEqual(cursor.item_events[0][2], -GOD_CARD_FRAGMENT_COST)
        self.assertEqual(payload["redeemed_card_id"], card["id"])
        self.assertTrue(connection.committed)

    def test_successful_god_card_redemption_spends_five_gr_fragments(self):
        card = next(card for card in self.cards if card["rarity"] == "GR")
        cursor = GodPackCursor(fragment_quantity=8)
        connection = GodPackConnection(cursor)
        with flask_app.test_client() as client, patch(
            "app._current_user", return_value={"id": 1}
        ), patch("app._load_card_catalog", return_value=self.cards), patch(
            "app._ensure_schema"
        ), patch("app._connection_string", return_value="test"), patch(
            "app.pyodbc.connect", return_value=connection
        ), patch(
            "app._shop_state",
            return_value={
                "wallet": {"gold": 0, "gems": 0},
                "inventory": [],
                "packs": [],
            },
        ):
            response = client.post(
                "/api/shop/redeem-card",
                json={"card_id": card["id"], "request_id": str(uuid.uuid4())},
            )

        payload = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(cursor.fragment_quantity, 3)
        self.assertEqual(cursor.item_events[0][1], "gr_fragment")
        self.assertEqual(cursor.item_events[0][2], -5)
        self.assertTrue(cursor.card_inserted)
        self.assertEqual(payload["redeemed_card_id"], card["id"])
        self.assertTrue(connection.committed)

    def test_redemption_rejects_insufficient_fragments_without_granting_card(self):
        card = self.cards[0]
        cursor = GodPackCursor(fragment_quantity=GOD_CARD_FRAGMENT_COST - 1)
        connection = GodPackConnection(cursor)
        with flask_app.test_client() as client, patch(
            "app._current_user", return_value={"id": 1}
        ), patch("app._load_card_catalog", return_value=self.cards), patch(
            "app._ensure_schema"
        ), patch("app._connection_string", return_value="test"), patch(
            "app.pyodbc.connect", return_value=connection
        ):
            response = client.post(
                "/api/shop/redeem-card",
                json={"card_id": card["id"], "request_id": str(uuid.uuid4())},
            )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(cursor.fragment_quantity, GOD_CARD_FRAGMENT_COST - 1)
        self.assertFalse(cursor.card_inserted)
        self.assertTrue(connection.rolled_back)

    def test_redemption_rejects_a_second_copy(self):
        card = next(card for card in self.cards if card["rarity"] == "GR")
        cursor = GodPackCursor(fragment_quantity=10, owned_quantity=1)
        connection = GodPackConnection(cursor)
        with flask_app.test_client() as client, patch(
            "app._current_user", return_value={"id": 1}
        ), patch("app._load_card_catalog", return_value=self.cards), patch(
            "app._ensure_schema"
        ), patch("app._connection_string", return_value="test"), patch(
            "app.pyodbc.connect", return_value=connection
        ):
            response = client.post(
                "/api/shop/redeem-card",
                json={"card_id": card["id"], "request_id": str(uuid.uuid4())},
            )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(cursor.fragment_quantity, 10)
        self.assertFalse(cursor.card_inserted)
        self.assertTrue(connection.rolled_back)

    def test_repeated_redemption_request_returns_saved_result_without_spending_again(self):
        card = self.cards[0]
        saved = {
            "message": "Đổi thành công.",
            "inventory": [{"id": GOD_CARD_FRAGMENT_ITEM_ID, "quantity": 3}],
            "redeemed_card_id": card["id"],
        }
        cursor = GodPackCursor(
            fragment_quantity=3,
            owned_quantity=1,
            previous=SimpleNamespace(
                Action="redeem_god_pack_card",
                ResponseJson=json.dumps(saved),
            ),
        )
        connection = GodPackConnection(cursor)
        with flask_app.test_client() as client, patch(
            "app._current_user", return_value={"id": 1}
        ), patch("app._load_card_catalog", return_value=self.cards), patch(
            "app._ensure_schema"
        ), patch("app._connection_string", return_value="test"), patch(
            "app.pyodbc.connect", return_value=connection
        ):
            response = client.post(
                "/api/shop/redeem-card",
                json={"card_id": card["id"], "request_id": str(uuid.uuid4())},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), saved)
        self.assertEqual(cursor.fragment_quantity, 3)
        self.assertFalse(cursor.card_inserted)
        self.assertTrue(connection.committed)

    def test_god_pack_cannot_use_random_pack_purchase_endpoint(self):
        with flask_app.test_client() as client, patch(
            "app._current_user", return_value={"id": 1}
        ):
            response = client.post(
                "/api/shop/purchase",
                json={
                    "pack_id": GOD_PACK_ID,
                    "pack_count": 1,
                    "request_id": str(uuid.uuid4()),
                },
            )

        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
