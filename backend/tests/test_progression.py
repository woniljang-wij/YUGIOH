import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import unquote

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app import (
    DECK_EXTRA_LIMIT,
    DECK_MAIN_LIMIT,
    DECK_COUNT,
    DECK_UNLOCK_PRICES,
    DUEL_MAIN_MIN,
    EXP_PER_ITEM,
    GEM_PACK_PRICE,
    GOLD_PACK_PRICE,
    LEVEL_THRESHOLDS,
    MAX_LEVEL,
    PACK_COUNTS,
    PACK_RARITY_WEIGHTS,
    SHOP_PACKS,
    ShopPackStockExhausted,
    STARTER_CHARACTER_IDS,
    _character_unlock_levels,
    _choose_pack_rewards,
    _deck_filter_options,
    _deck_snapshot,
    _duel_deck_error,
    _experience_after_items,
    _is_new_card_eligible,
    _load_card_catalog,
    _level_for_experience,
    _pack_payment,
    _validate_deck_cards,
    app as flask_app,
)


class SnapshotCursor:
    def __init__(self, owned_card_id, viewed_card_ids=(), selected_deck_number=1):
        self.owned_card_id = owned_card_id
        self.viewed_card_ids = set(viewed_card_ids)
        self.selected_deck_number = selected_deck_number
        self.rows = []

    def execute(self, query, *parameters):
        if "FROM dbo.PlayerDuelPreferences" in query:
            self.rows = (
                [SimpleNamespace(SelectedDeckNumber=self.selected_deck_number)]
                if self.selected_deck_number is not None
                else []
            )
        elif "FROM dbo.PlayerDecks" in query:
            self.rows = [SimpleNamespace(
                DeckNumber=1,
                Name="Bộ Bài 1",
                Notes="",
                IsUnlocked=True,
                Version=1,
            )]
        elif "FROM dbo.PlayerDeckCards" in query:
            self.rows = []
        elif "FROM dbo.PlayerCards" in query:
            self.rows = [SimpleNamespace(CardId=self.owned_card_id, Quantity=12)]
        elif "FROM dbo.PlayerNewCards" in query:
            self.rows = [
                SimpleNamespace(CardId=card_id)
                for card_id in self.viewed_card_ids
            ]
        elif "SELECT Gold, Gems FROM dbo.Users" in query:
            self.rows = [SimpleNamespace(Gold=1000, Gems=150)]
        else:
            raise AssertionError(f"Unexpected deck snapshot query: {query}")
        return self

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0] if self.rows else None


class ProgressionTests(unittest.TestCase):
    def test_deck_unlock_price_is_1000_gems_for_decks_two_through_ten(self):
        self.assertEqual(DECK_UNLOCK_PRICES, {
            deck_number: 1000 for deck_number in range(2, DECK_COUNT + 1)
        })

    def test_level_thresholds_match_the_requirements_table(self):
        self.assertEqual(
            LEVEL_THRESHOLDS,
            {
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
            },
        )

    def test_level_thresholds(self):
        for expected_level, threshold in LEVEL_THRESHOLDS.items():
            with self.subTest(level=expected_level):
                self.assertEqual(_level_for_experience(threshold), expected_level)
        self.assertEqual(_level_for_experience(99), 1)
        self.assertEqual(_level_for_experience(299), 2)

    def test_each_exp_item_grants_exactly_ten(self):
        self.assertEqual(EXP_PER_ITEM, 10)
        self.assertEqual(_experience_after_items(990, 1), (1000, 10, 5))
        self.assertEqual(_experience_after_items(995, 1), (1005, 10, 5))
        self.assertEqual(_experience_after_items(1000, 2), (1020, 20, 5))
        self.assertEqual(_experience_after_items(3600, 2), (3620, 20, 9))

    def test_level_ten_is_a_cap_without_truncating_experience(self):
        self.assertEqual(_experience_after_items(4400, 20), (4600, 200, MAX_LEVEL))
        self.assertEqual(_level_for_experience(4500), MAX_LEVEL)

    def test_new_character_selection_unlocks_only_selected_character_at_level_one(self):
        for selected in STARTER_CHARACTER_IDS:
            with self.subTest(selected=selected):
                unlock_levels = _character_unlock_levels(selected)
                self.assertEqual(
                    [character for character, level in unlock_levels.items() if level == 1],
                    [selected],
                )
                self.assertEqual(
                    {level for level in unlock_levels.values()},
                    {1, 5, 10},
                )
                self.assertEqual(len(unlock_levels), 3)

    def test_other_two_characters_unlock_at_levels_five_and_ten(self):
        self.assertEqual(
            _character_unlock_levels("kaiba-seto"),
            {"kaiba-seto": 1, "muto-yugi": 5, "jonouchi-katsuya": 10},
        )
        self.assertEqual(
            _character_unlock_levels("muto-yugi"),
            {"muto-yugi": 1, "jonouchi-katsuya": 5, "kaiba-seto": 10},
        )
        self.assertEqual(
            _character_unlock_levels("jonouchi-katsuya"),
            {"jonouchi-katsuya": 1, "kaiba-seto": 5, "muto-yugi": 10},
        )


class PackPaymentTests(unittest.TestCase):
    def test_pack_rewards_stop_at_the_card_copy_limit(self):
        card = {"id": "rare-card", "rarity": "R", "maxCopies": 3}
        rewards = _choose_pack_rewards(
            [card], 3,
            chooser=lambda choices: choices[0],
            rarity_chooser=lambda total: 0,
        )
        self.assertEqual(len(rewards), 3)
        self.assertTrue(all(reward is card for reward in rewards))
        with self.assertRaises(ShopPackStockExhausted):
            _choose_pack_rewards(
                [card], 4,
                chooser=lambda choices: choices[0],
                rarity_chooser=lambda total: 0,
            )

    def test_pack_rewards_skip_cards_that_have_reached_their_copy_limit(self):
        exhausted_card = {"id": "exhausted-card", "rarity": "R", "maxCopies": 3}
        available_card = {"id": "available-card", "rarity": "R", "maxCopies": 3}
        rewards = _choose_pack_rewards(
            [exhausted_card, available_card],
            1,
            chooser=lambda choices: choices[0],
            rarity_chooser=lambda total: 0,
            owned_quantities={"exhausted-card": 3},
        )
        self.assertEqual(rewards, [available_card])

    def test_pack_rewards_follow_rarity_odds_and_normalize_long_rarity_names(self):
        self.assertEqual(PACK_RARITY_WEIGHTS, {"R": 70, "SR": 20, "UR": 10})
        cards = [
            {"id": "rare-card", "rarity": "RARE", "maxCopies": 100},
            {"id": "super-card", "rarity": "SUPER RARE", "maxCopies": 100},
            {"id": "ultra-card", "rarity": "ULTRA RARE", "maxCopies": 100},
        ]
        rolls = iter(range(100))
        rewards = _choose_pack_rewards(
            cards,
            100,
            chooser=lambda choices: choices[0],
            rarity_chooser=lambda total: next(rolls),
        )

        self.assertEqual(
            {rarity: sum(card["rarity"] == rarity for card in rewards)
             for rarity in ("RARE", "SUPER RARE", "ULTRA RARE")},
            {"RARE": 70, "SUPER RARE": 20, "ULTRA RARE": 10},
        )

    def test_pack_prices_match_the_three_shop_buttons(self):
        self.assertEqual(PACK_COUNTS, (1, 10, 50))
        self.assertEqual(GOLD_PACK_PRICE, 500)
        self.assertEqual(GEM_PACK_PRICE, 700)
        self.assertEqual(
            [count * GOLD_PACK_PRICE for count in PACK_COUNTS],
            [500, 5000, 25000],
        )

    def test_character_cards_are_used_before_gold(self):
        self.assertEqual(_pack_payment(1, 1, 0, 0), (1, None, 0))
        self.assertEqual(_pack_payment(10, 3, 3500, 0), (3, "Gold", 3500))
        self.assertEqual(_pack_payment(50, 8, 21000, 0), (8, "Gold", 21000))

    def test_gems_replace_gold_when_gold_cannot_cover_remaining_packs(self):
        self.assertEqual(_pack_payment(10, 3, 3499, 4900), (3, "Gems", 4900))
        self.assertEqual(_pack_payment(1, 0, 0, 700), (0, "Gems", 700))

    def test_payment_reports_shortfall_currency_after_cards(self):
        self.assertEqual(_pack_payment(10, 3, 0, 0), (3, "Gems", 4900))
        self.assertEqual(_pack_payment(50, 60, 0, 0), (50, None, 0))


class DeckValidationTests(unittest.TestCase):
    def test_saving_main_deck_groups_monsters_spells_and_traps_stably(self):
        catalog = [
            {"id": "trap-b", "name": "Trap B", "category": "trap"},
            {"id": "spell-b", "name": "Spell B", "category": "spell"},
            {"id": "monster-b", "name": "Monster B", "category": "monster"},
            {"id": "trap-a", "name": "Trap A", "category": "trap"},
            {"id": "spell-a", "name": "Spell A", "category": "spell"},
            {"id": "monster-a", "name": "Monster A", "category": "monster"},
        ]
        main_cards = [
            {"card_id": card["id"], "quantity": 1}
            for card in catalog
        ]

        normalized = _validate_deck_cards(
            main_cards,
            [],
            catalog,
            {card["id"]: 1 for card in catalog},
        )

        self.assertEqual(
            [entry["card_id"] for entry in normalized["main"]],
            ["monster-b", "monster-a", "spell-b", "spell-a", "trap-b", "trap-a"],
        )

    def test_deck_snapshot_includes_only_owned_cards_with_exact_quantity(self):
        card_id = str(_load_card_catalog()[0]["id"])
        snapshot = _deck_snapshot(SnapshotCursor(card_id), user_id=1)

        self.assertEqual(len(snapshot["cards"]), 1)
        self.assertEqual(snapshot["cards"][0]["id"], card_id)
        self.assertEqual(snapshot["cards"][0]["ownedQuantity"], 12)
        self.assertTrue(snapshot["cards"][0]["isNew"])
        self.assertEqual(snapshot["new_cards_count"], 1)
        self.assertIn("filter_options", snapshot)
        self.assertEqual(snapshot["selected_deck_number"], 1)

    def test_deck_snapshot_keeps_an_account_without_a_saved_selection_unselected(self):
        card_id = str(_load_card_catalog()[0]["id"])
        snapshot = _deck_snapshot(
            SnapshotCursor(card_id, selected_deck_number=None),
            user_id=1,
        )

        self.assertIsNone(snapshot["selected_deck_number"])

    def test_deck_snapshot_does_not_mark_viewed_owned_cards_new(self):
        card_id = str(_load_card_catalog()[0]["id"])
        snapshot = _deck_snapshot(
            SnapshotCursor(card_id, viewed_card_ids=[card_id]),
            user_id=1,
        )

        self.assertFalse(snapshot["cards"][0]["isNew"])
        self.assertEqual(snapshot["new_cards_count"], 0)

    def test_deck_filters_include_values_from_the_full_card_catalog(self):
        catalog = _load_card_catalog()
        options = _deck_filter_options(catalog)
        expected_levels = set()
        for card in catalog:
            level = card.get("level")
            has_link_rating = any(
                card.get(field)
                for field in (
                    "linkRating",
                    "link_rating",
                    "linkValue",
                    "link_value",
                    "link",
                )
            )
            if has_link_rating or str(level or "").upper().startswith("LINK"):
                expected_levels.add("LINK")
            else:
                expected_levels.add(
                    str(level) if level not in (None, "") else "Chưa phân loại"
                )

        self.assertEqual(options["rarities"][:4], ["R", "SR", "UR", "GR"])
        self.assertTrue(expected_levels.issubset(set(options["levels"])))
        self.assertIn("LINK", options["levels"])
        self.assertIn("Chưa phân loại", options["levels"])
        self.assertTrue({"DARK", "LIGHT", "EARTH", "FIRE", "WATER", "WIND", "DIVINE"}.issubset(
            set(options["attributes"])
        ))
        self.assertIn("Chưa phân loại", options["attributes"])
        self.assertIn("Rồng", options["races"])

    def test_duel_deck_requires_at_least_forty_main_cards(self):
        deck = {
            "unlocked": True,
            "main_cards": [{"card_id": "card-a", "quantity": DUEL_MAIN_MIN - 1}],
            "extra_cards": [],
        }

        self.assertEqual(
            _duel_deck_error(deck, [], {"main": DECK_MAIN_LIMIT, "extra": DECK_EXTRA_LIMIT}),
            "Main Deck cần ít nhất 40 lá (hiện có 39).",
        )

    def test_duel_deck_accepts_a_saved_valid_list_with_exact_copy_counts(self):
        cards = [
            {
                "id": f"card-{index}",
                "category": "monster",
                "name": f"Card {index}",
                "ownedQuantity": 3,
                "maxCopies": 3,
            }
            for index in range(14)
        ]
        main_cards = [
            {"card_id": card["id"], "quantity": 3}
            for card in cards[:13]
        ] + [{"card_id": cards[13]["id"], "quantity": 1}]
        deck = {"unlocked": True, "main_cards": main_cards, "extra_cards": []}

        self.assertEqual(
            _duel_deck_error(deck, cards, {"main": DECK_MAIN_LIMIT, "extra": DECK_EXTRA_LIMIT}),
            "",
        )
        deck["main_cards"][0]["quantity"] = 4
        self.assertIn(
            "Không thể sử dụng quá 3 bản sao",
            _duel_deck_error(deck, cards, {"main": DECK_MAIN_LIMIT, "extra": DECK_EXTRA_LIMIT}),
        )

    def test_recently_added_cards_have_artwork_and_correct_character_packs(self):
        expected_packs = {
            "s-diffusion-wave-motion": "yugi",
            "m-lava-golem": "jonouchi",
            "m-naturia-rosewhip": "yugi",
            "s-card-destruction": "yugi",
            "m-red-eyes-black-dragon": "jonouchi",
            "m-morphing-jar": "yugi",
            "s-horn-of-the-unicorn": "yugi",
            "s-graceful-charity": "yugi",
            "m-marshmallon": "yugi",
            "m-electromagnetic-turtle": "yugi",
            "s-magic-formula": "yugi",
            "m-mobius-the-frost-monarch": "yugi",
            "t-dragon-capture-jar": "yugi",
            "s-dark-magic-attack": "yugi",
            "m-catapult-turtle": "yugi",
            "m-magicat": "yugi",
            "s-magical-stone-excavation": "yugi",
        }
        catalog = {
            card["id"]: card
            for card in _load_card_catalog()
        }
        asset_root = Path(__file__).resolve().parents[1]

        for card_id, pack_id in expected_packs.items():
            with self.subTest(card_id=card_id):
                card = catalog[card_id]
                self.assertEqual(
                    card["characterIds"],
                    [SHOP_PACKS[pack_id]["character_id"]],
                )
                self.assertTrue(card["image"])
                self.assertTrue(
                    (asset_root / unquote(card["image"])).is_file(),
                    card["image"],
                )

    def test_new_character_cards_have_verified_ids_rarities_and_pack_assignments(self):
        expected_cards = {
            "m-skilled-dark-magician": (73752131, "R", "yugi"),
            "m-archfiend-of-gilfer": (50287060, "SR", "yugi"),
            "t-solemn-wishes": (35346968, "R", "kaiba"),
            "m-wall-of-illusion": (13945283, "SR", "kaiba"),
            "m-double-coston": (44436472, "SR", "yugi"),
            "m-skilled-white-magician": (46363422, "R", "yugi"),
            "s-butterfly-dagger-elma": (69243953, "SR", "yugi"),
            "s-sages-stone": (13604200, "R", "yugi"),
            "m-the-tricky": (14778250, "R", "yugi"),
            "m-gandora-the-dragon-of-destruction": (64681432, "UR", "yugi"),
            "m-time-wizard": (71625222, "SR", "jonouchi"),
            "s-remove-trap": (51482758, "R", "yugi"),
            "s-graceful-dice": (74137509, "R", "jonouchi"),
            "s-mask-of-the-accursed": (56948373, "SR", "kaiba"),
            "t-nightmare-wheel": (54704216, "SR", "yugi"),
            "s-sword-of-deep-seated": (98495314, "SR", "kaiba"),
            "m-crass-clown": (93889755, "R", "kaiba"),
            "m-saggi-the-dark-clown": (66602787, "R", "kaiba"),
            "m-divine-knight-ishzark": (57902462, "SR", "kaiba"),
            "t-skull-dice": (126218, "R", "jonouchi"),
            "t-kunai-with-chain": (37390589, "SR", "jonouchi"),
            "s-dice-of-destiny": (None, "SR", "jonouchi"),
            "m-caius-the-shadow-monarch": (9748752, "SR", "kaiba"),
            "t-graverobber": (61705417, "SR", "jonouchi"),
            "s-rain-of-mercy": (66719324, "R", "kaiba"),
            "m-jinzo": (77585513, "SR", "jonouchi"),
            "s-harpies-feather-duster": (18144507, "SR", "jonouchi"),
            "s-dicephoon": (3493058, "SR", "jonouchi"),
            "m-revival-jam": (31709826, "UR", "yugi"),
            "t-gravity-bind": (85742772, "SR", "yugi"),
        }
        catalog = {
            card["id"]: card
            for card in _load_card_catalog()
        }

        self.assertEqual(catalog["m-kycoo-the-ghost-destroyer"]["externalId"], 88240808)
        for card_id, (external_id, rarity, character_id) in expected_cards.items():
            with self.subTest(card_id=card_id):
                card = catalog[card_id]
                self.assertEqual(card["externalId"], external_id)
                self.assertEqual(card["rarity"], rarity)
                self.assertEqual(card["characterIds"], [character_id])
                self.assertTrue(card["image"])
                self.assertTrue(
                    (Path(__file__).resolve().parents[1] / unquote(card["image"])).is_file(),
                    card["image"],
                )

        dice_card = catalog["s-dice-of-destiny"]
        self.assertEqual(dice_card["name"], "Xúc Xắc Định Mệnh")
        self.assertEqual(dice_card["category"], "spell")
        self.assertEqual(dice_card["spellType"], "Thường")

        kunai_skill = catalog["t-kunai-with-chain"]["skills"][0]
        self.assertEqual(kunai_skill["activation"]["selection"], "choose_one_or_both")
        self.assertEqual(
            [effect["id"] for effect in kunai_skill["effects"]],
            [
                "kunai_with_chain_change_attacking_monster_to_defense",
                "kunai_with_chain_equip_and_boost",
            ],
        )
        external_ids = [
            card["externalId"]
            for card in catalog.values()
            if card["externalId"] is not None
        ]
        self.assertEqual(len(external_ids), len(set(external_ids)))


    def test_new_card_eligibility_does_not_depend_on_rarity(self):
        for rarity in ("", "N", "R", "COMMON", "UR"):
            with self.subTest(rarity=rarity):
                self.assertTrue(_is_new_card_eligible({"id": "card-a", "rarity": rarity}))
        self.assertFalse(_is_new_card_eligible({"rarity": "UR"}))

    def test_deck_cannot_use_more_copies_than_owned(self):
        catalog = [{"id": "monster-a", "name": "Monster A", "category": "monster", "maxCopies": 3}]
        for quantity in (2, 3):
            with self.subTest(quantity=quantity):
                with self.assertRaisesRegex(ValueError, "không đủ"):
                    _validate_deck_cards(
                        [{"card_id": "monster-a", "quantity": quantity}],
                        [],
                        catalog,
                        {"monster-a": 1},
                    )

    def test_deck_can_use_three_copies_when_three_are_owned(self):
        catalog = [{"id": "monster-a", "name": "Monster A", "category": "monster", "maxCopies": 3}]
        content = _validate_deck_cards(
            [{"card_id": "monster-a", "quantity": 3}],
            [],
            catalog,
            {"monster-a": 3},
        )
        self.assertEqual(content["main"], [{"card_id": "monster-a", "quantity": 3}])

    def test_copy_limit_is_independent_for_each_deck(self):
        catalog = [{"id": "monster-a", "name": "Monster A", "category": "monster", "maxCopies": 3}]
        for _deck_number in (1, 2):
            content = _validate_deck_cards(
                [{"card_id": "monster-a", "quantity": 3}],
                [],
                catalog,
                {"monster-a": 3},
            )
            self.assertEqual(content["main"], [{"card_id": "monster-a", "quantity": 3}])

    def test_respects_card_specific_copy_limit_and_owned_quantity(self):
        catalog = [{"id": "limited-a", "name": "Limited A", "category": "spell", "maxCopies": 1}]
        content = _validate_deck_cards(
            [{"card_id": "limited-a", "quantity": 1}],
            [],
            catalog,
            {"limited-a": 2},
        )
        self.assertEqual(content["main"], [{"card_id": "limited-a", "quantity": 1}])
        with self.assertRaisesRegex(ValueError, "quá 1 bản sao"):
            _validate_deck_cards(
                [{"card_id": "limited-a", "quantity": 2}],
                [],
                catalog,
                {"limited-a": 2},
            )

    def test_rejects_fourth_copy_and_wrong_extra_deck_type(self):
        catalog = [
            {"id": "monster-a", "name": "Monster A", "category": "monster", "maxCopies": 3},
            {"id": "fusion-a", "name": "Fusion A", "category": "fusion", "maxCopies": 3},
        ]
        owned = {"monster-a": 1, "fusion-a": 1}
        with self.assertRaises(ValueError):
            _validate_deck_cards(
                [{"card_id": "monster-a", "quantity": 4}],
                [],
                catalog,
                owned,
            )
        with self.assertRaisesRegex(ValueError, "Extra Deck"):
            _validate_deck_cards(
                [{"card_id": "fusion-a", "quantity": 1}],
                [],
                catalog,
                owned,
            )

    def test_enforces_main_and_extra_deck_capacity(self):
        main_catalog = [
            {"id": f"monster-{index}", "name": f"Monster {index}", "category": "monster"}
            for index in range(DECK_MAIN_LIMIT + 1)
        ]
        main_entries = [{"card_id": card["id"], "quantity": 1} for card in main_catalog]
        main_owned = {card["id"]: 1 for card in main_catalog}
        with self.assertRaisesRegex(ValueError, "sức chứa"):
            _validate_deck_cards(main_entries, [], main_catalog, main_owned)

        extra_catalog = [
            {"id": f"fusion-{index}", "name": f"Fusion {index}", "category": "fusion", "maxCopies": 3}
            for index in range(7)
        ]
        extra_entries = [{"card_id": card["id"], "quantity": 3} for card in extra_catalog]
        extra_owned = {card["id"]: 3 for card in extra_catalog}
        with self.assertRaisesRegex(ValueError, "không được vượt quá 20"):
            _validate_deck_cards([], extra_entries, extra_catalog, extra_owned)


class DuelDeckSelectionTests(unittest.TestCase):
    class SelectionCursor:
        def __init__(self, existing_selection=None):
            self.existing_selection = existing_selection
            self.rows = []
            self.statements = []

        def execute(self, query, *parameters):
            self.statements.append((query, parameters))
            if "SELECT Id FROM dbo.Users" in query:
                self.rows = [SimpleNamespace(Id=7)]
            elif query.lstrip().startswith("SELECT SelectedDeckNumber"):
                self.rows = (
                    [SimpleNamespace(SelectedDeckNumber=self.existing_selection)]
                    if self.existing_selection is not None
                    else []
                )
            else:
                self.rows = []
            return self

        def fetchone(self):
            return self.rows[0] if self.rows else None

    class SelectionConnection:
        def __init__(self, existing_selection=None):
            self.test_cursor = DuelDeckSelectionTests.SelectionCursor(existing_selection)
            self.commits = 0

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_value, traceback):
            return False

        def cursor(self):
            return self.test_cursor

        def commit(self):
            self.commits += 1

    def test_selecting_a_valid_deck_persists_it_and_returns_the_selected_snapshot(self):
        connection = self.SelectionConnection()
        before = {"decks": [{"number": 2, "unlocked": True, "duel_error": ""}]}
        after = {"decks": before["decks"], "selected_deck_number": 2}
        with patch("app._current_user", return_value={"id": 7}), \
                patch("app._ensure_schema"), \
                patch("app._connection_string", return_value="connection"), \
                patch("app.pyodbc.connect", return_value=connection), \
                patch("app._deck_snapshot", side_effect=[before, after]):
            response = flask_app.test_client().post(
                "/api/decks/select",
                json={"deck_number": 2},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["snapshot"]["selected_deck_number"], 2)
        self.assertEqual(connection.commits, 1)
        self.assertTrue(any("INSERT INTO dbo.PlayerDuelPreferences" in query
                            for query, _ in connection.test_cursor.statements))

    def test_selecting_another_deck_updates_the_existing_account_preference(self):
        connection = self.SelectionConnection(existing_selection=1)
        before = {"decks": [{"number": 2, "unlocked": True, "duel_error": ""}]}
        after = {"decks": before["decks"], "selected_deck_number": 2}
        with patch("app._current_user", return_value={"id": 7}), \
                patch("app._ensure_schema"), \
                patch("app._connection_string", return_value="connection"), \
                patch("app.pyodbc.connect", return_value=connection), \
                patch("app._deck_snapshot", side_effect=[before, after]):
            response = flask_app.test_client().post(
                "/api/decks/select",
                json={"deck_number": 2},
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(any("UPDATE dbo.PlayerDuelPreferences" in query
                            for query, _ in connection.test_cursor.statements))
        self.assertFalse(any("INSERT INTO dbo.PlayerDuelPreferences" in query
                             for query, _ in connection.test_cursor.statements))

    def test_invalid_deck_selection_is_rejected_without_persisting(self):
        connection = self.SelectionConnection()
        invalid_snapshot = {
            "decks": [{
                "number": 2,
                "unlocked": True,
                "duel_error": "Main Deck cần ít nhất 40 lá.",
            }],
        }
        with patch("app._current_user", return_value={"id": 7}), \
                patch("app._ensure_schema"), \
                patch("app._connection_string", return_value="connection"), \
                patch("app.pyodbc.connect", return_value=connection), \
                patch("app._deck_snapshot", return_value=invalid_snapshot):
            response = flask_app.test_client().post(
                "/api/decks/select",
                json={"deck_number": 2},
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"], "Main Deck cần ít nhất 40 lá.")
        self.assertEqual(connection.commits, 0)
        self.assertFalse(any("INSERT INTO dbo.PlayerDuelPreferences" in query
                             for query, _ in connection.test_cursor.statements))


if __name__ == "__main__":
    unittest.main()
