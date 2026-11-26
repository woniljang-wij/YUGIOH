from pathlib import Path
import sys
import unittest
import uuid
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app import (
    INVENTORY_ITEMS,
    INVENTORY_SOURCE_LABELS,
    app as flask_app,
    _rename_card_cost,
    _rename_card_purchase_price,
    _validated_player_name,
)


class RenameCardTests(unittest.TestCase):
    def test_rename_card_cost_increases_until_ten_then_stays_capped(self):
        self.assertEqual(
            [_rename_card_cost(count) for count in range(12)],
            list(range(11)) + [10],
        )
        self.assertEqual(_rename_card_cost(15), 10)

    def test_rename_card_price_is_calculated_and_quantity_is_bounded(self):
        self.assertEqual(_rename_card_purchase_price(1), 500)
        self.assertEqual(_rename_card_purchase_price(5), 2500)
        self.assertEqual(_rename_card_purchase_price(2147483), 1073741500)
        for value in (0, -1, 2147484, True, 1.5):
            with self.subTest(value=value), self.assertRaises(ValueError):
                _rename_card_purchase_price(value)

    def test_rename_card_uses_the_existing_inventory_item_catalog(self):
        self.assertEqual(INVENTORY_ITEMS["rename_card"]["name"], "Thẻ Đổi Tên")
        self.assertEqual(
            INVENTORY_ITEMS["rename_card"]["image"],
            "assets/images/items/rename-card.png",
        )
        self.assertFalse(INVENTORY_ITEMS["rename_card"]["usable"])

    def test_inventory_descriptions_and_sources_are_player_friendly(self):
        self.assertEqual(
            INVENTORY_ITEMS["character_card"]["description"],
            "Dùng để mua bài trong tiệm bài.",
        )
        self.assertEqual(
            INVENTORY_ITEMS["exp"]["description"],
            "Dùng để tăng kinh nghiệm cho tài khoản người chơi.",
        )
        self.assertEqual(
            INVENTORY_ITEMS["rename_card"]["description"],
            "Dùng để thay đổi tên tài khoản người chơi.",
        )
        self.assertEqual(INVENTORY_SOURCE_LABELS["character_card"], "Điểm danh")
        self.assertEqual(INVENTORY_SOURCE_LABELS["exp"], "Điểm danh")
        self.assertEqual(INVENTORY_SOURCE_LABELS["rename_card"], "Shop Vật Phẩm")

    def test_purchase_endpoint_rejects_invalid_quantity_without_database_access(self):
        with flask_app.test_client() as client, patch(
            "app._current_user", return_value={"id": 1}
        ):
            response = client.post(
                "/api/shop/items/rename-card",
                json={"quantity": 0, "request_id": str(uuid.uuid4())},
            )
        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.get_json())

    def test_player_name_validation_accepts_unicode_names_and_trims_whitespace(self):
        self.assertEqual(_validated_player_name("  Đấu sĩ 01  "), "Đấu sĩ 01")
        self.assertEqual(_validated_player_name("Tu\u0301"), "Tu\u0301")

    def test_player_name_validation_rejects_empty_overlong_and_invalid_names(self):
        for value in ("   ", "a" * 25, "Tên@khônghợp lệ", "---"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                _validated_player_name(value)


if __name__ == "__main__":
    unittest.main()
