import json
from pathlib import Path
import sys
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app import (
    CARD_DISMANTLE_QUANTITY,
    _available_card_quantity,
    _card_fragment_item,
    app as flask_app,
)


class DismantleCursor:
    def __init__(self, owned_quantity=5, deck_quantity=2, fragment_quantity=0, previous=None):
        self.owned_quantity = owned_quantity
        self.deck_quantity = deck_quantity
        self.fragment_quantity = fragment_quantity
        self.previous = previous
        self.rows = []
        self.rowcount = 1
        self.events = []
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
        elif "SELECT COALESCE(SUM(Quantity), 0) AS Quantity" in query:
            self.rows = [SimpleNamespace(Quantity=self.deck_quantity)]
        elif "SELECT Quantity FROM dbo.PlayerInventory WITH (UPDLOCK, ROWLOCK)" in query:
            self.rows = (
                [SimpleNamespace(Quantity=self.fragment_quantity)]
                if self.fragment_quantity
                else []
            )
        elif "SELECT 1 FROM dbo.PlayerItemEvents" in query:
            self.rows = []
        elif "UPDATE dbo.PlayerCards SET Quantity = ?" in query:
            self.owned_quantity = parameters[0]
            self.rowcount = 1
        elif "DELETE FROM dbo.PlayerCards WHERE UserId = ? AND CardId = ?" in query:
            self.owned_quantity = 0
            self.rowcount = 1
        elif "UPDATE dbo.PlayerInventory SET Quantity = Quantity + ?" in query:
            if self.fragment_quantity:
                self.fragment_quantity += parameters[0]
                self.rowcount = 1
            else:
                self.rowcount = 0
        elif "INSERT INTO dbo.PlayerInventory" in query:
            self.fragment_quantity = parameters[2]
            self.rowcount = 1
        elif "INSERT INTO dbo.PlayerItemEvents" in query:
            self.events.append(parameters)
        elif "INSERT INTO dbo.PlayerActionRequests" in query:
            self.saved_response = json.loads(parameters[3])
        else:
            raise AssertionError(f"Unexpected query: {query}")
        return self

    def fetchone(self):
        return self.rows[0] if self.rows else None


class DismantleConnection:
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


class DismantleTests(unittest.TestCase):
    def test_rarity_maps_to_matching_fragment(self):
        for rarity, item_id in (
            ("R", "r_fragment"),
            ("RARE", "r_fragment"),
            ("SR", "sr_fragment"),
            ("SUPER RARE", "sr_fragment"),
            ("UR", "ur_fragment"),
            ("ULTRA RARE", "ur_fragment"),
            ("GR", "gr_fragment"),
            ("GOLD RARE", "gr_fragment"),
        ):
            with self.subTest(rarity=rarity):
                self.assertEqual(_card_fragment_item({"rarity": rarity}), item_id)

    def test_available_quantity_excludes_every_saved_deck(self):
        self.assertEqual(_available_card_quantity(5, 2), 3)
        self.assertEqual(_available_card_quantity(2, 3), 0)
        self.assertEqual(CARD_DISMANTLE_QUANTITY, 3)

    def test_successful_dismantle_consumes_three_cards_and_grants_one_fragment(self):
        cursor = DismantleCursor(owned_quantity=5, deck_quantity=2)
        connection = DismantleConnection(cursor)
        with flask_app.test_client() as client, patch(
            "app._current_user", return_value={"id": 1}
        ), patch("app._ensure_schema"), patch(
            "app._connection_string", return_value="test"
        ), patch("app.pyodbc.connect", return_value=connection), patch(
            "app._inventory_state", return_value=[{"id": "r_fragment", "quantity": 1}]
        ):
            response = client.post(
                "/api/cards/dismantle",
                json={
                    "card_id": "m-kycoo-the-ghost-destroyer",
                    "request_id": str(uuid.uuid4()),
                },
            )

        payload = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(cursor.owned_quantity, 2)
        self.assertEqual(cursor.fragment_quantity, 1)
        self.assertEqual(payload["available_quantity"], 0)
        self.assertEqual(payload["reward"]["id"], "r_fragment")
        self.assertTrue(connection.committed)

    def test_dismantle_rejects_copies_reserved_in_decks(self):
        cursor = DismantleCursor(owned_quantity=5, deck_quantity=3)
        connection = DismantleConnection(cursor)
        with flask_app.test_client() as client, patch(
            "app._current_user", return_value={"id": 1}
        ), patch("app._ensure_schema"), patch(
            "app._connection_string", return_value="test"
        ), patch("app.pyodbc.connect", return_value=connection):
            response = client.post(
                "/api/cards/dismantle",
                json={
                    "card_id": "m-kycoo-the-ghost-destroyer",
                    "request_id": str(uuid.uuid4()),
                },
            )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(cursor.owned_quantity, 5)
        self.assertEqual(cursor.fragment_quantity, 0)
        self.assertTrue(connection.rolled_back)

    def test_dismantle_rejects_fewer_than_three_owned_copies(self):
        cursor = DismantleCursor(owned_quantity=2, deck_quantity=0)
        connection = DismantleConnection(cursor)
        with flask_app.test_client() as client, patch(
            "app._current_user", return_value={"id": 1}
        ), patch("app._ensure_schema"), patch(
            "app._connection_string", return_value="test"
        ), patch("app.pyodbc.connect", return_value=connection):
            response = client.post(
                "/api/cards/dismantle",
                json={
                    "card_id": "m-kycoo-the-ghost-destroyer",
                    "request_id": str(uuid.uuid4()),
                },
            )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(cursor.owned_quantity, 2)
        self.assertEqual(cursor.fragment_quantity, 0)
        self.assertTrue(connection.rolled_back)

    def test_repeated_request_returns_saved_result_without_consuming_again(self):
        saved = {
            "card_id": "m-kycoo-the-ghost-destroyer",
            "owned_quantity": 2,
            "available_quantity": 0,
            "reward": {"id": "r_fragment", "amount": 1},
            "inventory": [],
        }
        cursor = DismantleCursor(
            owned_quantity=2,
            deck_quantity=2,
            fragment_quantity=1,
            previous=SimpleNamespace(
                Action="dismantle_card",
                ResponseJson=json.dumps(saved),
            ),
        )
        connection = DismantleConnection(cursor)
        with flask_app.test_client() as client, patch(
            "app._current_user", return_value={"id": 1}
        ), patch("app._ensure_schema"), patch(
            "app._connection_string", return_value="test"
        ), patch("app.pyodbc.connect", return_value=connection):
            response = client.post(
                "/api/cards/dismantle",
                json={
                    "card_id": "m-kycoo-the-ghost-destroyer",
                    "request_id": str(uuid.uuid4()),
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), saved)
        self.assertEqual(cursor.owned_quantity, 2)
        self.assertEqual(cursor.fragment_quantity, 1)
        self.assertTrue(connection.committed)

    def test_unsupported_rarity_is_rejected_without_database_access(self):
        with flask_app.test_client() as client, patch(
            "app._current_user", return_value={"id": 1}
        ), patch("app._load_card_catalog", return_value=[{"id": "n-card", "rarity": "N"}]), patch(
            "app._ensure_schema"
        ) as ensure_schema:
            response = client.post(
                "/api/cards/dismantle",
                json={"card_id": "n-card", "request_id": str(uuid.uuid4())},
            )

        self.assertEqual(response.status_code, 400)
        ensure_schema.assert_not_called()


if __name__ == "__main__":
    unittest.main()
