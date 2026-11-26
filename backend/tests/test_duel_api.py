from collections import Counter
from copy import deepcopy
from pathlib import Path
import sys
import unittest
import uuid
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app import (
    _duel_sessions,
    _duel_sessions_lock,
    _build_duel_ai_deck,
    _load_card_catalog,
    _public_duel_state,
    app as flask_app,
)
from duel.duel_actions import DuelActionEngine
from duel.duel_effects import EQUIP_SPELL_IDS, build_effect_registry
from duel.duel_engine import DuelEffectEngine, find_card, move_card


class DuelApiCursor:
    def execute(self, _query, *_parameters):
        return self

    @staticmethod
    def fetchone():
        return object()


class DuelApiConnection:
    def __enter__(self):
        return self

    def __exit__(self, _error_type, _error, _traceback):
        return False

    @staticmethod
    def cursor():
        return DuelApiCursor()


class DuelApiTests(unittest.TestCase):
    def setUp(self):
        with _duel_sessions_lock:
            _duel_sessions.clear()
        self.user = {
            "id": 71,
            "username": "player",
            "player_name": "Tên tài khoản thật",
            "selected_character_id": "kaiba-seto",
        }
        self.catalog = _load_card_catalog()
        legal_main_cards = [
            card
            for card in self.catalog
            if card.get("category") in {"monster", "spell", "trap"}
        ]
        selected_cards = legal_main_cards[:40]
        self.low_level_monsters = [
            card
            for card in self.catalog
            if card.get("category") == "monster"
            and int(card.get("level", card.get("lv", 0))) <= 4
        ][:2]
        self.low_level_monster = self.low_level_monsters[0]
        self.high_level_monster = next(
            card
            for card in self.catalog
            if card.get("category") == "monster"
            and 7 <= int(card.get("level", card.get("lv", 0))) <= 9
            and isinstance(card.get("atk"), int)
            and card["atk"] >= 2000
            and card["id"]
            not in {
                "m-slifer-the-sky-dragon",
                "m-obelisk-the-tormentor",
                "m-the-winged-dragon-of-ra",
            }
        )
        required_cards = [
            next(card for card in self.catalog if card["id"] == "s-pot-of-greed"),
            *self.low_level_monsters,
            self.high_level_monster,
            *[
                next(card for card in self.catalog if card["id"] == card_id)
                for card_id in (
                    "m-slifer-the-sky-dragon",
                    "m-obelisk-the-tormentor",
                    "m-the-winged-dragon-of-ra",
                    "m-the-creator-god-of-light-horakhty",
                )
            ],
        ]
        selected_ids = {card["id"] for card in selected_cards}
        required_ids = {card["id"] for card in required_cards}
        for required_card in required_cards:
            if required_card["id"] not in selected_ids:
                replace_index = next(
                    index
                    for index in range(len(selected_cards) - 1, -1, -1)
                    if selected_cards[index]["id"] not in required_ids
                )
                replaced = selected_cards.pop(replace_index)
                selected_ids.remove(replaced["id"])
                selected_cards.append(required_card)
                selected_ids.add(required_card["id"])
        self.main_cards = [
            {"card_id": str(card["id"]), "quantity": 1}
            for card in selected_cards
        ]
        self.assertEqual(len(self.main_cards), 40)
        self.snapshot = {
            "selected_deck_number": 1,
            "decks": [
                {
                    "number": 1,
                    "unlocked": True,
                    "duel_error": "",
                    "main_cards": self.main_cards,
                    "extra_cards": [],
                }
            ],
        }
        self.patches = [
            patch("app._current_user", return_value=self.user),
            patch("app._ensure_schema"),
            patch(
                "app.pyodbc.connect",
                return_value=DuelApiConnection(),
            ),
            patch("app._deck_snapshot", return_value=self.snapshot),
        ]
        for patcher in self.patches:
            patcher.start()
        self.addCleanup(self._stop_patches)
        self.addCleanup(self._clear_sessions)
        self.client = flask_app.test_client()

    def _stop_patches(self):
        for patcher in reversed(self.patches):
            patcher.stop()

    @staticmethod
    def _clear_sessions():
        with _duel_sessions_lock:
            _duel_sessions.clear()

    def test_sorcerer_of_dark_magic_is_not_in_the_card_catalog(self):
        self.assertFalse(
            any(
                card["id"] == "m-sorcerer-of-dark-magic"
                for card in self.catalog
            )
        )

    def test_ai_deck_uses_a_supported_theme_and_balanced_unique_cards(self):
            expected_profiles = (
                {
                    "m-dark-magician",
                    "m-dark-magician-girl",
                    "m-skilled-dark-magician",
                    "s-dark-magic-curtain",
                    "s-thousand-knives",
                },
                {
                    "m-blue-eyes-white-dragon",
                    "m-kaibaman",
                    "m-lord-of-d",
                    "s-the-flute-of-summoning-dragon",
                    "s-burst-stream-of-destruction",
                },
            )
            registry = build_effect_registry()

            for profile_index, profile_cards in enumerate(expected_profiles):
                with patch(
                    "app.secrets.choice",
                    side_effect=lambda choices, index=profile_index: choices[index],
                ):
                    ai_deck = _build_duel_ai_deck(self.catalog)

                card_ids = [card["id"] for card in ai_deck]
                self.assertEqual(len(ai_deck), 40)
                self.assertEqual(len(set(card_ids)), 40)
                self.assertEqual(
                    Counter(card["category"] for card in ai_deck),
                    {"monster": 22, "spell": 11, "trap": 7},
                )
                self.assertIn("m-the-tricky", card_ids)
                self.assertTrue(profile_cards.issubset(set(card_ids)))
                self.assertTrue(
                    all(
                        registry.has_card_effect(card["id"])
                        for card in ai_deck
                        if card["category"] in {"spell", "trap"}
                    )
                )
                self.assertFalse(
                    {
                        "m-obelisk-the-tormentor",
                        "m-valkyrion-the-magna-warrior",
                        "m-blue-eyes-alternative-white-dragon",
                    }
                    & set(card_ids)
                )

    def _start_duel(self):
        return self.client.post("/api/duel/start", json={"deck_number": 1})

    def _act(self, match_id, action):
        return self.client.post(
            "/api/duel/action",
            json={"match_id": match_id, "action": action},
        )

    @staticmethod
    def _find_hand_or_deck_card(state, player, card_id):
        return next(
            card
            for zone in ("hand", "deck")
            for card in state["players"][player][zone]
            if card["card_id"] == card_id
        )

    def _add_catalog_card_to_zone(
        self,
        state,
        player,
        card_id,
        zone,
        zone_index,
        *,
        face_down=False,
        position="attack",
        set_turn=None,
    ):
        definition = next(card for card in self.catalog if card["id"] == card_id)
        card = deepcopy(definition)
        card.update(
            {
                "instance_id": str(uuid.uuid4()),
                "card_id": card_id,
                "owner": player,
                "controller": player,
                "base_atk": card.get("atk", 0),
                "base_def": card.get("def", 0),
                "face_down": face_down,
            }
        )
        if zone == "monster_zone":
            card["position"] = position
        if set_turn is not None:
            card["set_turn"] = set_turn
        state["players"][player][zone][zone_index] = card
        return card

    def _add_catalog_monster_to_field(self, state, player, card_id, zone_index):
        return self._add_catalog_card_to_zone(
            state,
            player,
            card_id,
            "monster_zone",
            zone_index,
        )

    def test_hand_monster_shows_printed_stats_while_field_shows_modified_stats(self):
        self._start_duel()
        state = _duel_sessions[71]["state"]
        hand_card = deepcopy(
            next(
                card
                for card in self.catalog
                if card["id"] == "m-blue-eyes-white-dragon"
            )
        )
        hand_card.update(
            {
                "instance_id": str(uuid.uuid4()),
                "card_id": "m-blue-eyes-white-dragon",
                "owner": "player",
                "controller": "player",
                "base_atk": 3000,
                "base_def": 2500,
            }
        )
        state["players"]["player"]["hand"].append(hand_card)
        field_card = self._add_catalog_monster_to_field(
            state,
            "player",
            "m-blue-eyes-white-dragon",
            0,
        )
        equip_card = self._add_catalog_card_to_zone(
            state,
            "player",
            "s-butterfly-dagger-elma",
            "spell_trap_zone",
            0,
        )
        equip_card["target_instance_id"] = field_card["instance_id"]
        state["stat_modifiers"].append(
            {
                "target_instance_id": field_card["instance_id"],
                "source_instance_id": equip_card["instance_id"],
                "source_card_id": "s-butterfly-dagger-elma",
                "owner": "player",
                "stat": "atk",
                "operation": "increase",
                "value": 300,
                "duration": {
                    "type": "continuous",
                    "source_instance_id": equip_card["instance_id"],
                },
                "negated": False,
            }
        )

        public_match = _public_duel_state(state)
        public_hand_card = next(
            card
            for card in public_match["players"]["player"]["hand"]
            if card["instance_id"] == hand_card["instance_id"]
        )
        public_field_card = public_match["players"]["player"]["monster_zone"][0]

        self.assertEqual(public_hand_card["atk"], 3000)
        self.assertNotIn("current_atk", public_hand_card)
        self.assertEqual(public_field_card["current_atk"], 3300)

    def test_start_creates_server_state_without_exposing_ai_hand_or_deck(self):
        response = self._start_duel()

        self.assertEqual(response.status_code, 201)
        match = response.json["match"]
        self.assertEqual(
            match["players"]["player"]["player_name"],
            "Tên tài khoản thật",
        )
        self.assertEqual(
            match["players"]["player"]["selected_character_id"],
            "kaiba-seto",
        )
        self.assertEqual(
            match["players"]["ai"]["player_name"],
            "Đối thủ AI",
        )
        self.assertEqual(match["players"]["player"]["hand_count"], 5)
        self.assertEqual(len(match["players"]["player"]["hand"]), 5)
        self.assertEqual(match["players"]["ai"]["hand_count"], 5)
        self.assertEqual(match["players"]["ai"]["hand"], [])
        self.assertNotIn("deck", match["players"]["ai"])
        self.assertEqual(match["players"]["ai"]["deck_count"], 35)
        self.assertFalse(match["drawn_this_turn"])
        self.assertEqual(
            match["normal_summon_used"],
            {"player": False, "ai": False},
        )

    def test_match_state_is_available_only_to_its_authenticated_owner(self):
        started = self._start_duel()
        match_id = started.json["match"]["match_id"]

        state = self.client.get(
            "/api/duel/state",
            query_string={"match_id": match_id},
        )
        self.assertEqual(state.status_code, 200)
        self.assertEqual(state.json["match"]["match_id"], match_id)
        self.assertEqual(
            state.json["match"]["players"]["player"]["player_name"],
            "Tên tài khoản thật",
        )

        with patch("app._current_user", return_value={**self.user, "id": 72}):
            hidden = self.client.get(
                "/api/duel/state",
                query_string={"match_id": match_id},
            )
        self.assertEqual(hidden.status_code, 404)

    def test_action_snapshot_keeps_the_authenticated_profile_name(self):
        started = self._start_duel()
        match_id = started.json["match"]["match_id"]

        response = self._act(match_id, {"type": "advance_phase"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json["match"]["players"]["player"]["player_name"],
            "Tên tài khoản thật",
        )
        self.assertEqual(
            response.json["match"]["players"]["ai"]["player_name"],
            "Đối thủ AI",
        )

    def test_state_masks_the_identity_of_opponents_set_cards(self):
        started = self._start_duel()
        match_id = started.json["match"]["match_id"]
        with _duel_sessions_lock:
            ai = _duel_sessions[71]["state"]["players"]["ai"]
            hidden_card = next(
                card for card in ai["deck"] if card["category"] == "monster"
            )
            ai["deck"].remove(hidden_card)
            hidden_card["face_down"] = True
            hidden_card["position"] = "defense"
            ai["monster_zone"][0] = hidden_card

        response = self.client.get(
            "/api/duel/state",
            query_string={"match_id": match_id},
        )
        public_card = response.json["match"]["players"]["ai"]["monster_zone"][0]

        self.assertTrue(public_card["face_down"])
        self.assertNotIn("card_id", public_card)
        self.assertNotIn("name", public_card)
        self.assertNotIn("atk", public_card)

    def test_state_reveals_opponent_cards_in_graveyard_even_if_still_face_down(self):
        started = self._start_duel()
        match_id = started.json["match"]["match_id"]
        with _duel_sessions_lock:
            state = _duel_sessions[71]["state"]
            trap = next(
                card
                for card in state["players"]["ai"]["deck"]
                if card["category"] == "trap"
            )
            state["players"]["ai"]["deck"].remove(trap)
            trap["face_down"] = True
            trap["position"] = None
            state["players"]["ai"]["graveyard"].append(trap)

        response = self.client.get(
            "/api/duel/state",
            query_string={"match_id": match_id},
        )
        self.assertEqual(response.status_code, 200)
        public_card = next(
            card
            for card in response.json["match"]["players"]["ai"]["graveyard"]
            if card["instance_id"] == trap["instance_id"]
        )
        self.assertEqual(public_card["card_id"], trap["card_id"])
        self.assertEqual(public_card["name"], trap["name"])
        self.assertEqual(public_card["category"], "trap")

    def test_state_reveals_opponent_cards_banished_even_if_still_face_down(self):
        started = self._start_duel()
        match_id = started.json["match"]["match_id"]
        with _duel_sessions_lock:
            state = _duel_sessions[71]["state"]
            banished_card = next(
                card
                for card in state["players"]["ai"]["deck"]
                if card["category"] in {"monster", "spell", "trap"}
            )
            state["players"]["ai"]["deck"].remove(banished_card)
            banished_card["face_down"] = True
            banished_card["position"] = None
            state["players"]["ai"]["banished"].append(banished_card)

        response = self.client.get(
            "/api/duel/state",
            query_string={"match_id": match_id},
        )
        self.assertEqual(response.status_code, 200)
        public_card = next(
            card
            for card in response.json["match"]["players"]["ai"]["banished"]
            if card["instance_id"] == banished_card["instance_id"]
        )
        self.assertEqual(public_card["card_id"], banished_card["card_id"])
        self.assertEqual(public_card["name"], banished_card["name"])
        self.assertIn(public_card["category"], {"monster", "spell", "trap"})

    def test_player_effect_resolves_when_ai_passes_chain_priority(self):
        started = self._start_duel()
        match_id = started.json["match"]["match_id"]
        with _duel_sessions_lock:
            state = _duel_sessions[71]["state"]
            state["phase"] = "main1"
            player = state["players"]["player"]
            source = self._find_hand_or_deck_card(
                state,
                "player",
                "s-pot-of-greed",
            )
            if source not in player["hand"]:
                move_card(state, source["instance_id"], "player", "hand")
            hand_count_before_activation = len(player["hand"])

        activated = self._act(
            match_id,
            {
                "type": "activate_effect",
                "source_instance_id": source["instance_id"],
            },
        )
        self.assertEqual(
            activated.status_code,
            200,
            activated.json,
        )
        self.assertEqual(activated.json["match"]["chain"]["status"], "open")
        self.assertEqual(
            activated.json["match"]["chain"]["priority_player"],
            "player",
        )
        self.assertEqual(
            activated.json["match"]["players"]["player"]["hand_count"],
            hand_count_before_activation - 1,
        )

        resolved = self._act(match_id, {"type": "pass_chain"})
        self.assertEqual(resolved.status_code, 200, resolved.json)
        self.assertEqual(
            resolved.json["match"]["players"]["player"]["hand_count"],
            hand_count_before_activation + 1,
        )
        self.assertEqual(
            sum(
                card["card_id"] == "s-pot-of-greed"
                for card in resolved.json["match"]["players"]["player"]["graveyard"]
            ),
            1,
        )

    def test_graceful_charity_resolves_chain_then_requires_two_discards(self):
        started = self._start_duel()
        match_id = started.json["match"]["match_id"]
        with _duel_sessions_lock:
            state = _duel_sessions[71]["state"]
            state["phase"] = "main1"
            player = state["players"]["player"]
            source = player["deck"][0]
            source.update(
                next(
                    card
                    for card in self.catalog
                    if card["id"] == "s-graceful-charity"
                )
            )
            source["card_id"] = "s-graceful-charity"
            move_card(state, source["instance_id"], "player", "hand")
            deck_count = len(player["deck"])

        activated = self._act(
            match_id,
            {
                "type": "activate_effect",
                "source_instance_id": source["instance_id"],
            },
        )
        self.assertEqual(activated.status_code, 200, activated.json)

        resolved = self._act(match_id, {"type": "pass_chain"})
        self.assertEqual(resolved.status_code, 200, resolved.json)
        match = resolved.json["match"]
        self.assertEqual(match["chain"]["status"], "closed")
        self.assertEqual(match["pending_decision"]["type"], "discard")
        self.assertEqual(match["pending_decision"]["count"], 2)
        self.assertEqual(match["players"]["player"]["deck_count"], deck_count - 3)

        hand_ids = [
            card["instance_id"]
            for card in resolved.json["match"]["players"]["player"]["hand"]
        ]
        completed = self._act(
            match_id,
            {
                "type": "complete_discard",
                "instance_ids": hand_ids[:2],
            },
        )
        self.assertEqual(completed.status_code, 200, completed.json)
        completed_match = completed.json["match"]
        self.assertIsNone(completed_match["pending_decision"])
        self.assertEqual(completed_match["players"]["player"]["hand_count"], 6)

    def test_card_destruction_resolves_chain_and_redraws_both_hands(self):
        started = self._start_duel()
        match_id = started.json["match"]["match_id"]
        with _duel_sessions_lock:
            state = _duel_sessions[71]["state"]
            state["phase"] = "main1"
            player = state["players"]["player"]
            ai = state["players"]["ai"]
            source = player["deck"][0]
            source.update(
                next(
                    card
                    for card in self.catalog
                    if card["id"] == "s-card-destruction"
                )
            )
            source["card_id"] = "s-card-destruction"
            move_card(state, source["instance_id"], "player", "hand")

            while len(player["hand"]) < 3:
                move_card(
                    state,
                    player["deck"][0]["instance_id"],
                    "player",
                    "hand",
                )
            while len(ai["hand"]) < 2:
                move_card(
                    state,
                    ai["deck"][0]["instance_id"],
                    "ai",
                    "hand",
                )

            player_count = len(player["hand"])
            ai_count = len(ai["hand"])

        activated = self._act(
            match_id,
            {
                "type": "activate_effect",
                "source_instance_id": source["instance_id"],
            },
        )
        self.assertEqual(activated.status_code, 200, activated.json)
        self.assertEqual(activated.json["match"]["chain"]["status"], "open")
        self.assertEqual(
            activated.json["match"]["chain"]["priority_player"],
            "player",
        )

        resolved = self._act(match_id, {"type": "pass_chain"})
        self.assertEqual(resolved.status_code, 200)
        self.assertEqual(resolved.json["match"]["chain"]["status"], "closed")
        self.assertEqual(
            resolved.json["match"]["players"]["player"]["hand_count"],
            player_count - 1,
        )
        self.assertEqual(
            resolved.json["match"]["players"]["ai"]["hand_count"],
            ai_count,
        )

    def test_first_player_cannot_draw_and_rejected_action_keeps_state(self):
        started = self._start_duel()
        match_id = started.json["match"]["match_id"]

        rejected = self._act(match_id, {"type": "draw"})
        current = self.client.get(
            "/api/duel/state",
            query_string={"match_id": match_id},
        )

        self.assertEqual(rejected.status_code, 400)
        self.assertEqual(current.json["match"]["players"]["player"]["hand_count"], 5)
        self.assertEqual(current.json["match"]["players"]["player"]["deck_count"], 35)

    def test_first_player_cannot_attack_on_opening_turn(self):
        started = self._start_duel()
        match_id = started.json["match"]["match_id"]
        with _duel_sessions_lock:
            state = _duel_sessions[71]["state"]
            state["phase"] = "battle"
            attacker = self._add_catalog_monster_to_field(
                state,
                "player",
                self.low_level_monster["id"],
                0,
            )

        rejected = self._act(
            match_id,
            {
                "type": "attack",
                "attacker_instance_id": attacker["instance_id"],
                "defender_instance_id": None,
            },
        )
        current = self.client.get(
            "/api/duel/state",
            query_string={"match_id": match_id},
        )

        self.assertEqual(rejected.status_code, 400)
        self.assertIn("không được tấn công", rejected.json["error"].lower())
        self.assertIsNone(current.json["match"]["pending_battle"])
        self.assertEqual(
            current.json["match"]["players"]["player"]["monster_zone"][0][
                "instance_id"
            ],
            attacker["instance_id"],
        )

    def test_draw_phase_enters_standby_resolves_effect_then_enters_main1(self):
        started = self._start_duel()
        match_id = started.json["match"]["match_id"]
        with _duel_sessions_lock:
            state = _duel_sessions[71]["state"]
            state["turn"] = 2
            state["first_player"] = "ai"
            state["turn_player"] = "player"
            player = state["players"]["player"]
            hand_count = len(player["hand"])
            deck_count = len(player["deck"])
            self._add_catalog_card_to_zone(
                state,
                "player",
                "s-rain-of-mercy",
                "spell_trap_zone",
                0,
            )

        entered_standby = self._act(match_id, {"type": "advance_phase"})

        self.assertEqual(entered_standby.status_code, 200)
        standby_match = entered_standby.json["match"]
        self.assertEqual(standby_match["phase"], "standby")
        self.assertTrue(standby_match["drawn_this_turn"])
        self.assertEqual(standby_match["players"]["player"]["hand_count"], hand_count + 1)
        self.assertEqual(standby_match["players"]["player"]["deck_count"], deck_count - 1)
        self.assertEqual(standby_match["players"]["player"]["lp"], 9000)

        entered_main1 = self._act(match_id, {"type": "advance_phase"})

        self.assertEqual(entered_main1.status_code, 200)
        self.assertEqual(entered_main1.json["match"]["phase"], "main1")
        self.assertEqual(entered_main1.json["match"]["players"]["player"]["lp"], 9000)

    def test_first_turn_advances_through_standby_without_drawing(self):
        started = self._start_duel()
        match_id = started.json["match"]["match_id"]

        entered_standby = self._act(match_id, {"type": "advance_phase"})

        self.assertEqual(entered_standby.status_code, 200)
        standby_match = entered_standby.json["match"]
        self.assertEqual(standby_match["phase"], "standby")
        self.assertFalse(standby_match["drawn_this_turn"])
        self.assertEqual(standby_match["players"]["player"]["hand_count"], 5)
        self.assertEqual(standby_match["players"]["player"]["deck_count"], 35)

        entered_main1 = self._act(match_id, {"type": "advance_phase"})

        self.assertEqual(entered_main1.status_code, 200)
        self.assertEqual(entered_main1.json["match"]["phase"], "main1")
        self.assertEqual(entered_main1.json["match"]["players"]["player"]["hand_count"], 5)

        entered_main2 = self._act(match_id, {"type": "advance_phase"})

        self.assertEqual(entered_main2.status_code, 200)
        self.assertEqual(entered_main2.json["match"]["phase"], "main2")

    def test_normal_summon_is_validated_and_recorded_by_the_backend(self):
        started = self._start_duel()
        match_id = started.json["match"]["match_id"]
        with _duel_sessions_lock:
            state = _duel_sessions[71]["state"]
            state["phase"] = "main1"
            player = state["players"]["player"]
            monster = self._find_hand_or_deck_card(
                state,
                "player",
                self.low_level_monster["id"],
            )
            if monster not in player["hand"]:
                move_card(state, monster["instance_id"], "player", "hand")

        response = self._act(
            match_id,
            {
                "type": "summon",
                "instance_id": monster["instance_id"],
                "zone_index": 0,
            },
        )

        self.assertEqual(response.status_code, 200)
        summoned = response.json["match"]["players"]["player"]["monster_zone"][0]
        self.assertEqual(summoned["instance_id"], monster["instance_id"])
        self.assertFalse(summoned["face_down"])
        self.assertTrue(_duel_sessions[71]["state"]["normal_summon_used"]["player"])

    def test_tribute_summon_requires_and_consumes_the_exact_number_of_tributes(self):
        started = self._start_duel()
        match_id = started.json["match"]["match_id"]
        with _duel_sessions_lock:
            state = _duel_sessions[71]["state"]
            state["phase"] = "main1"
            player = state["players"]["player"]
            tributes = []
            for zone_index, card in enumerate(self.low_level_monsters):
                tribute = self._find_hand_or_deck_card(
                    state,
                    "player",
                    card["id"],
                )
                move_card(
                    state,
                    tribute["instance_id"],
                    "player",
                    "monster_zone",
                    destination_index=zone_index,
                )
                tributes.append(tribute)
            high_level = self._find_hand_or_deck_card(
                state,
                "player",
                self.high_level_monster["id"],
            )
            if high_level not in player["hand"]:
                move_card(state, high_level["instance_id"], "player", "hand")

        rejected = self._act(
            match_id,
            {
                "type": "summon",
                "instance_id": high_level["instance_id"],
                "zone_index": 0,
                "tribute_instance_ids": [tributes[0]["instance_id"]],
            },
        )
        self.assertEqual(rejected.status_code, 400)

        summoned = self._act(
            match_id,
            {
                "type": "summon",
                "instance_id": high_level["instance_id"],
                "zone_index": 0,
                "tribute_instance_ids": [
                    tribute["instance_id"] for tribute in tributes
                ],
            },
        )

        self.assertEqual(summoned.status_code, 200)
        self.assertEqual(
            summoned.json["match"]["players"]["player"]["monster_zone"][0][
                "instance_id"
            ],
            high_level["instance_id"],
        )
        summoned_monster = summoned.json["match"]["players"]["player"]["monster_zone"][0]
        self.assertFalse(summoned_monster["face_down"])
        self.assertEqual(summoned_monster["position"], "attack")
        self.assertEqual(
            len(summoned.json["match"]["players"]["player"]["graveyard"]),
            2,
        )

    def test_tribute_set_requires_and_consumes_exact_tributes(self):
        started = self._start_duel()
        match_id = started.json["match"]["match_id"]
        with _duel_sessions_lock:
            state = _duel_sessions[71]["state"]
            state["phase"] = "main1"
            player = state["players"]["player"]
            tributes = []
            for zone_index, definition in enumerate(self.low_level_monsters):
                tribute = self._find_hand_or_deck_card(
                    state,
                    "player",
                    definition["id"],
                )
                move_card(
                    state,
                    tribute["instance_id"],
                    "player",
                    "monster_zone",
                    destination_index=zone_index,
                )
                tributes.append(tribute)
            high_level = self._find_hand_or_deck_card(
                state,
                "player",
                self.high_level_monster["id"],
            )
            if high_level not in player["hand"]:
                move_card(state, high_level["instance_id"], "player", "hand")

        rejected = self._act(
            match_id,
            {
                "type": "set_card",
                "instance_id": high_level["instance_id"],
                "zone_index": 0,
            },
        )
        self.assertEqual(rejected.status_code, 400)

        response = self._act(
            match_id,
            {
                "type": "set_card",
                "instance_id": high_level["instance_id"],
                "zone_index": 0,
                "tribute_instance_ids": [
                    tribute["instance_id"] for tribute in tributes
                ],
            },
        )

        self.assertEqual(response.status_code, 200)
        set_monster = response.json["match"]["players"]["player"]["monster_zone"][0]
        self.assertEqual(set_monster["instance_id"], high_level["instance_id"])
        self.assertTrue(set_monster["face_down"])
        self.assertEqual(set_monster["position"], "defense")
        self.assertEqual(
            len(response.json["match"]["players"]["player"]["graveyard"]),
            2,
        )

    def test_horakhty_requires_all_three_gods_and_wins_on_summon(self):
        started = self._start_duel()
        match_id = started.json["match"]["match_id"]
        god_ids = (
            "m-slifer-the-sky-dragon",
            "m-obelisk-the-tormentor",
            "m-the-winged-dragon-of-ra",
        )
        with _duel_sessions_lock:
            state = _duel_sessions[71]["state"]
            state["phase"] = "main1"
            player = state["players"]["player"]
            gods = []
            for zone_index, card_id in enumerate(god_ids):
                god = self._find_hand_or_deck_card(
                    state,
                    "player",
                    card_id,
                )
                move_card(
                    state,
                    god["instance_id"],
                    "player",
                    "monster_zone",
                    destination_index=zone_index,
                )
                gods.append(god)
            horakhty = self._find_hand_or_deck_card(
                state,
                "player",
                "m-the-creator-god-of-light-horakhty",
            )
            if horakhty not in player["hand"]:
                move_card(state, horakhty["instance_id"], "player", "hand")

        response = self._act(
            match_id,
            {
                "type": "summon",
                "instance_id": horakhty["instance_id"],
                "zone_index": 0,
                "tribute_instance_ids": [
                    god["instance_id"] for god in gods
                ],
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json["match"]["over"])
        self.assertEqual(response.json["match"]["winner"], "player")

    def test_ra_gains_the_summed_stats_of_its_three_tributes(self):
        started = self._start_duel()
        match_id = started.json["match"]["match_id"]
        with _duel_sessions_lock:
            state = _duel_sessions[71]["state"]
            state["phase"] = "main1"
            player = state["players"]["player"]
            tributes = []
            tribute_cards = [*self.low_level_monsters, self.high_level_monster]
            for zone_index, definition in enumerate(tribute_cards):
                tribute = self._find_hand_or_deck_card(
                    state,
                    "player",
                    definition["id"],
                )
                move_card(
                    state,
                    tribute["instance_id"],
                    "player",
                    "monster_zone",
                    destination_index=zone_index,
                )
                tributes.append(tribute)
            ra = self._find_hand_or_deck_card(
                state,
                "player",
                "m-the-winged-dragon-of-ra",
            )
            if ra not in player["hand"]:
                move_card(state, ra["instance_id"], "player", "hand")

        response = self._act(
            match_id,
            {
                "type": "summon",
                "instance_id": ra["instance_id"],
                "zone_index": 0,
                "tribute_instance_ids": [
                    tribute["instance_id"] for tribute in tributes
                ],
            },
        )

        self.assertEqual(response.status_code, 200)
        summoned_ra = response.json["match"]["players"]["player"]["monster_zone"][0]
        self.assertEqual(
            summoned_ra["current_atk"],
            sum(tribute["atk"] for tribute in tributes),
        )
        self.assertEqual(
            summoned_ra["current_def"],
            sum(tribute["def"] for tribute in tributes),
        )

    def test_slifer_triggers_on_normal_summon_and_can_destroy_low_atk_monster(self):
        started = self._start_duel()
        match_id = started.json["match"]["match_id"]
        with _duel_sessions_lock:
            state = _duel_sessions[71]["state"]
            state["phase"] = "main1"
            player = state["players"]["player"]
            monster = self._find_hand_or_deck_card(
                state,
                "player",
                self.low_level_monster["id"],
            )
            if monster not in player["hand"]:
                move_card(state, monster["instance_id"], "player", "hand")
            self._add_catalog_monster_to_field(
                state,
                "ai",
                "m-slifer-the-sky-dragon",
                0,
            )

        response = self._act(
            match_id,
            {
                "type": "summon",
                "instance_id": monster["instance_id"],
                "zone_index": 0,
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertIsNone(
            response.json["match"]["players"]["player"]["monster_zone"][0]
        )
        self.assertTrue(
            any(
                card["instance_id"] == monster["instance_id"]
                for card in response.json["match"]["players"]["player"]["graveyard"]
            )
        )

    def test_direct_attack_applies_current_attack_as_life_point_damage(self):
        started = self._start_duel()
        match_id = started.json["match"]["match_id"]
        with _duel_sessions_lock:
            state = _duel_sessions[71]["state"]
            state["turn"] = 2
            state["phase"] = "battle"
            attacker = self._add_catalog_monster_to_field(
                state,
                "player",
                self.high_level_monster["id"],
                0,
            )

        response = self._act(
            match_id,
            {
                "type": "attack",
                "attacker_instance_id": attacker["instance_id"],
                "defender_instance_id": None,
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json["match"]["players"]["ai"]["lp"],
            8000 - attacker["atk"],
        )
        self.assertIn(
            attacker["instance_id"],
            response.json["match"]["attacked"]["player"],
        )

    def test_attack_trap_resolves_in_chain_and_cancels_the_battle(self):
        started = self._start_duel()
        match_id = started.json["match"]["match_id"]
        with _duel_sessions_lock:
            state = _duel_sessions[71]["state"]
            state["turn"] = 2
            state["phase"] = "battle"
            attacker = self._add_catalog_monster_to_field(
                state,
                "player",
                self.high_level_monster["id"],
                0,
            )
            self._add_catalog_card_to_zone(
                state,
                "ai",
                "t-mirror-force",
                "spell_trap_zone",
                0,
                face_down=True,
                set_turn=0,
            )

        declared = self._act(
            match_id,
            {
                "type": "attack",
                "attacker_instance_id": attacker["instance_id"],
                "defender_instance_id": None,
            },
        )
        self.assertEqual(declared.status_code, 200)
        self.assertEqual(declared.json["match"]["chain"]["status"], "open")
        self.assertEqual(
            declared.json["match"]["players"]["ai"]["lp"],
            8000,
        )

        resolved = self._act(match_id, {"type": "pass_chain"})

        self.assertEqual(resolved.status_code, 200)
        self.assertEqual(resolved.json["match"]["chain"]["status"], "closed")
        self.assertEqual(
            resolved.json["match"]["players"]["ai"]["lp"],
            8000,
        )
        self.assertIsNone(
            resolved.json["match"]["players"]["player"]["monster_zone"][0]
        )
        self.assertIn(
            attacker["instance_id"],
            resolved.json["match"]["attacked"]["player"],
        )

    def test_ordeal_guess_keeps_the_selected_ai_card_type_private(self):
        started = self._start_duel()
        match_id = started.json["match"]["match_id"]
        with _duel_sessions_lock:
            state = _duel_sessions[71]["state"]
            state["turn"] = 2
            state["phase"] = "battle"
            attacker = self._add_catalog_monster_to_field(
                state,
                "player",
                self.high_level_monster["id"],
                0,
            )
            self._add_catalog_card_to_zone(
                state,
                "ai",
                "t-ordeal-of-a-traveler",
                "spell_trap_zone",
                0,
                face_down=True,
                set_turn=0,
            )

        declared = self._act(
            match_id,
            {
                "type": "attack",
                "attacker_instance_id": attacker["instance_id"],
                "defender_instance_id": None,
            },
        )
        self.assertEqual(declared.status_code, 200)
        resolved = self._act(match_id, {"type": "pass_chain"})

        self.assertEqual(resolved.status_code, 200)
        pending = resolved.json["match"]["pending_decision"]
        self.assertEqual(pending["type"], "ordeal_traveler_guess")
        self.assertNotIn("selected_type", pending)
        self.assertEqual(resolved.json["match"]["players"]["ai"]["hand"], [])
        self.assertNotIn("_ordeal_traveler_pending", resolved.json["match"])

        with _duel_sessions_lock:
            state = _duel_sessions[71]["state"]
            self.assertNotIn(
                "selected_type",
                _public_duel_state(state)["pending_decision"],
            )
            selected_type = state["_ordeal_traveler_pending"]["selected_type"]
        wrong_guess = next(
            guess
            for guess in ("monster", "spell", "trap")
            if guess != selected_type
        )
        guessed = self._act(
            match_id,
            {
                "type": "complete_ordeal_traveler_guess",
                "guess": wrong_guess,
            },
        )

        self.assertEqual(guessed.status_code, 200)
        self.assertIsNone(guessed.json["match"]["pending_decision"])
        self.assertIn(
            attacker["instance_id"],
            [
                card["instance_id"]
                for card in guessed.json["match"]["players"]["player"]["hand"]
            ],
        )

    def test_end_phase_runs_the_server_managed_ai_turn(self):
        started = self._start_duel()
        match_id = started.json["match"]["match_id"]
        for _ in range(4):
            response = self._act(match_id, {"type": "advance_phase"})
            self.assertEqual(response.status_code, 200)

        response = self._act(match_id, {"type": "advance_phase"})

        self.assertEqual(response.status_code, 200)
        match = response.json["match"]
        self.assertEqual(match["turn"], 3)
        self.assertEqual(match["turn_player"], "player")
        self.assertEqual(match["phase"], "draw")
        self.assertTrue(match["drawn_this_turn"])
        self.assertEqual(match["players"]["player"]["hand_count"], 6)
        self.assertLess(match["players"]["ai"]["hand_count"], 6)
        ai_stages = response.json["ai_stages"]
        self.assertEqual(ai_stages[0]["type"], "draw")
        self.assertTrue(
            all(
                stage["match"]["turn_player"] == "ai"
                for stage in ai_stages
                if stage["type"] != "end"
            )
        )
        self.assertTrue(all("match" in stage for stage in ai_stages))
        self.assertGreater(
            sum(card is not None for card in match["players"]["ai"]["monster_zone"])
            + sum(card is not None for card in match["players"]["ai"]["spell_trap_zone"]),
            0,
        )

    def test_ai_attacks_directly_or_only_when_it_can_win_battle(self):
        self._start_duel()
        state = _duel_sessions[71]["state"]
        state["turn"] = 2
        state["phase"] = "battle"
        state["players"]["ai"]["monster_zone"] = [None] * 5
        state["players"]["player"]["monster_zone"] = [None] * 5
        attacker = self._add_catalog_monster_to_field(
            state,
            "ai",
            self.high_level_monster["id"],
            0,
        )
        attacker["base_atk"] = 2000

        self.assertEqual(
            DuelActionEngine._ai_choose_attack(state),
            (attacker["instance_id"], None),
        )

        state["players"]["player"]["monster_zone"] = [None] * 5
        attack_position_target = self._add_catalog_monster_to_field(
            state,
            "player",
            self.low_level_monster["id"],
            0,
        )
        attack_position_target["base_atk"] = 2000
        self.assertEqual(
            DuelActionEngine._ai_choose_attack(state),
            (attacker["instance_id"], attack_position_target["instance_id"]),
        )

        attack_position_target["base_atk"] = 1500
        self.assertEqual(
            DuelActionEngine._ai_choose_attack(state),
            (attacker["instance_id"], attack_position_target["instance_id"]),
        )

        state["players"]["player"]["monster_zone"] = [None] * 5
        defense_position_target = self._add_catalog_card_to_zone(
            state,
            "player",
            self.low_level_monster["id"],
            "monster_zone",
            0,
            position="defense",
        )
        defense_position_target["base_def"] = 2000
        self.assertIsNone(DuelActionEngine._ai_choose_attack(state))

        defense_position_target["base_def"] = 1999
        self.assertEqual(
            DuelActionEngine._ai_choose_attack(state),
            (attacker["instance_id"], defense_position_target["instance_id"]),
        )

    def test_ai_activates_equip_spells_on_valid_monsters(self):
        self._start_duel()
        starting_state = deepcopy(_duel_sessions[71]["state"])
        ai = DuelActionEngine(DuelEffectEngine(build_effect_registry()))

        for card_id in EQUIP_SPELL_IDS:
            state = deepcopy(starting_state)
            state["turn"] = 2
            state["turn_player"] = "ai"
            state["phase"] = "main1"
            state["chain"] = {"status": "closed", "links": []}
            state["pending_decision"] = None
            state["players"]["ai"]["hand"] = [None]
            state["players"]["ai"]["monster_zone"] = [None] * 5
            state["players"]["ai"]["spell_trap_zone"] = [None] * 5
            state["players"]["player"]["monster_zone"] = [None] * 5
            state["players"]["player"]["spell_trap_zone"] = [None] * 5
            ai_monster = self._add_catalog_monster_to_field(
                state,
                "ai",
                "m-dark-magician",
                0,
            )
            opponent_monster = self._add_catalog_monster_to_field(
                state,
                "player",
                "m-blue-eyes-white-dragon",
                0,
            )
            self._add_catalog_card_to_zone(
                state,
                "ai",
                card_id,
                "hand",
                0,
            )

            self.assertTrue(ai._ai_activate_best_main_spell(state), card_id)
            equipped_card = next(
                card for card in state["players"]["ai"]["spell_trap_zone"]
                if card and card["card_id"] == card_id
            )
            expected_target = (
                opponent_monster["instance_id"]
                if card_id == "s-mask-of-the-accursed"
                else ai_monster["instance_id"]
            )
            self.assertEqual(
                equipped_card["target_instance_id"],
                expected_target,
                card_id,
            )

    def test_start_requires_the_currently_selected_saved_deck(self):
        self.snapshot["selected_deck_number"] = 2

        response = self._start_duel()

        self.assertEqual(response.status_code, 409)
        self.assertEqual(_duel_sessions, {})

    def test_abandon_removes_only_the_matching_active_match(self):
        started = self._start_duel()
        match_id = started.json["match"]["match_id"]

        response = self.client.post(
            "/api/duel/abandon",
            json={"match_id": match_id},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(_duel_sessions, {})
        missing = self.client.get(
            "/api/duel/state",
            query_string={"match_id": match_id},
        )
        self.assertEqual(missing.status_code, 404)

    def test_duel_routes_reject_invalid_login_sessions(self):
        with patch("app._current_user", return_value=None):
            start = self.client.post("/api/duel/start", json={"deck_number": 1})
            state = self.client.get(
                "/api/duel/state",
                query_string={"match_id": "unknown"},
            )
            abandon = self.client.post(
                "/api/duel/abandon",
                json={"match_id": "unknown"},
            )

        self.assertEqual(start.status_code, 401)
        self.assertEqual(state.status_code, 401)
        self.assertEqual(abandon.status_code, 401)

    def test_normal_summon_supports_face_up_defense_position(self):
        started = self._start_duel()
        match_id = started.json["match"]["match_id"]
        with _duel_sessions_lock:
            state = _duel_sessions[self.user["id"]]["state"]
            state["phase"] = "main1"
            monster = self._add_catalog_card_to_zone(
                state,
                "player",
                self.low_level_monster["id"],
                "hand",
                0,
            )

        summon = self._act(
            match_id,
            {
                "type": "summon",
                "instance_id": monster["instance_id"],
                "zone_index": 1,
                "position": "defense",
                "tribute_instance_ids": [],
            },
        )
        self.assertEqual(summon.status_code, 200, summon.json)
        summoned = summon.json["match"]["players"]["player"]["monster_zone"][1]
        self.assertEqual(summoned["card_id"], self.low_level_monster["id"])
        self.assertEqual(summoned["position"], "defense")
        self.assertFalse(summoned["face_down"])


if __name__ == "__main__":
    unittest.main()
