import sys
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app import (
    FRAGMENT_MERGE_RECIPES,
    INVENTORY_ITEMS,
    _fragment_merge_recipe,
    app as flask_app,
)


class FragmentMergeTests(unittest.TestCase):
    def test_fragment_items_use_existing_magic_box_catalog_and_artwork(self):
        for item_id, rarity in (
            ("r_fragment", "r"),
            ("sr_fragment", "sr"),
            ("ur_fragment", "ur"),
            ("gr_fragment", "gr"),
        ):
            with self.subTest(item_id=item_id):
                item = INVENTORY_ITEMS[item_id]
                self.assertEqual(item["image"], f"assets/images/items/{rarity}-fragment.png")
                self.assertFalse(item["usable"])
                self.assertTrue((Path(__file__).resolve().parents[1] / item["image"]).is_file())

    def test_merge_recipes_match_the_required_costs_and_rewards(self):
        self.assertEqual(
            FRAGMENT_MERGE_RECIPES,
            {
                "r_fragment": {
                    "quantity": 40,
                    "gold": 1000,
                    "reward_item": "sr_fragment",
                },
                "sr_fragment": {
                    "quantity": 20,
                    "gold": 2000,
                    "reward_item": "ur_fragment",
                },
                "ur_fragment": {
                    "quantity": 10,
                    "gold": 3000,
                    "reward_item": "gr_fragment",
                },
            },
        )

    def test_gr_cannot_be_merged(self):
        with self.assertRaisesRegex(ValueError, "Mảnh GR"):
            _fragment_merge_recipe("gr_fragment")

    def test_merge_endpoint_rejects_gr_before_database_access(self):
        with flask_app.test_client() as client, patch(
            "app._current_user", return_value={"id": 1}
        ), patch("app._ensure_schema") as ensure_schema:
            response = client.post(
                "/api/fragments/merge",
                json={"item_id": "gr_fragment", "request_id": str(uuid.uuid4())},
            )

        self.assertEqual(response.status_code, 409)
        self.assertIn("Mảnh GR", response.get_json()["error"])
        ensure_schema.assert_not_called()

    def test_merge_endpoint_rejects_invalid_item_and_request_id(self):
        with flask_app.test_client() as client, patch(
            "app._current_user", return_value={"id": 1}
        ), patch("app._ensure_schema") as ensure_schema:
            invalid_item = client.post(
                "/api/fragments/merge",
                json={"item_id": "n_fragment", "request_id": str(uuid.uuid4())},
            )
            invalid_request = client.post(
                "/api/fragments/merge",
                json={"item_id": "r_fragment", "request_id": "not-a-uuid"},
            )

        self.assertEqual(invalid_item.status_code, 400)
        self.assertEqual(invalid_request.status_code, 400)
        ensure_schema.assert_not_called()


if __name__ == "__main__":
    unittest.main()
