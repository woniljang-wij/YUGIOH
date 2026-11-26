"""Server-side primitives for authoritative, single-player duel state."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import random
import uuid
from typing import Any, Callable, Mapping


PLAYER_IDS = ("player", "ai")
CRUSH_CARD_VIRUS_GY_LOCK = "crush_card_virus_no_special_summon_from_graveyard"
CLONE_DRAGON_ID = "m-clone-dragon"
UNION_MONSTER_IDS = frozenset({"m-y-dragon-head", "m-z-metal-tank"})
EQUIP_SPELL_IDS = frozenset(
    {
        "s-horn-of-the-unicorn",
        "s-magic-formula",
        "s-butterfly-dagger-elma",
        "s-mask-of-the-accursed",
        "s-sword-of-deep-seated",
    }
)
QUICK_SPELL_IDS = frozenset(
    {
        "s-multiply",
        "s-magical-dimension",
        "s-mystical-space-typhoon",
        "s-emergency-provisions",
        "s-ring-of-defense",
        "s-reload",
        "s-shrink",
        "s-divine-shield",
        "s-twin-twisters",
        "s-graceful-dice",
        "s-dicephoon",
    }
)
PHASES = ("draw", "standby", "main1", "battle", "main2", "end")
FIELD_ZONES = ("monster_zone", "spell_trap_zone", "field_zone")
PLAYER_ZONES = (
    "deck",
    "extra_deck",
    "hand",
    "monster_zone",
    "spell_trap_zone",
    "field_zone",
    "graveyard",
    "banished",
)
EFFECT_TYPES = frozenset(
    {
        "activated",
        "trigger",
        "continuous",
        "ignition",
        "quick",
        "flip",
        "summon",
        "battle",
        "graveyard",
        "equip",
        "field",
        "duration",
        "stat",
        "restriction",
    }
)
EXODIA_PIECE_IDS = frozenset(
    {
        "m-exodia-the-forbidden-one",
        "m-right-arm-of-the-forbidden-one",
        "m-left-arm-of-the-forbidden-one",
        "m-right-leg-of-the-forbidden-one",
        "m-left-leg-of-the-forbidden-one",
    }
)
DYNAMIC_STAT_CARD_IDS = frozenset(
    {
        "m-slifer-the-sky-dragon",
        "m-the-winged-dragon-of-ra",
    }
)


def is_dragon_card(card: Mapping[str, Any]) -> bool:
    race = str(card.get("race") or card.get("monsterType") or "").lower()
    return "dragon" in race or "rồng" in race


def is_spellcaster_card(card: Mapping[str, Any]) -> bool:
    race = str(card.get("race") or card.get("monsterType") or "").lower()
    return "spellcaster" in race or "phù thủy" in race


def is_ghost_monster(card: Mapping[str, Any]) -> bool:
    if str(card.get("category") or "").lower() not in {"monster", "fusion"}:
        return False
    identity = " ".join(
        str(card.get(field) or "")
        for field in ("name", "race", "keyword", "monsterType")
    ).lower()
    return "ghost" in identity or "bóng ma" in identity


class DuelRuleError(ValueError):
    """Raised when a duel operation violates an engine rule."""


def opponent_of(player: str) -> str:
    if player == "player":
        return "ai"
    if player == "ai":
        return "player"
    raise DuelRuleError("Người chơi không hợp lệ.")


# Bậc Thầy Hủy Diệt Jinzo: khóa kích hoạt Bẫy khi có Jinzo ngửa trên sân.
def has_face_up_jinzo(state: Mapping[str, Any]) -> bool:
    return any(
        monster
        and monster.get("card_id") == "m-jinzo"
        and not monster.get("face_down", False)
        and not monster.get("monster_effects_negated", False)
        for player in PLAYER_IDS
        for monster in state["players"][player]["monster_zone"]
    )


def trap_effect_is_negated(state: Mapping[str, Any], trap_owner: str) -> bool:
    jinzo_controller = opponent_of(trap_owner)
    return any(
        monster
        and monster.get("card_id") == "m-jinzo"
        and not monster.get("face_down", False)
        and not monster.get("monster_effects_negated", False)
        for monster in state["players"][jinzo_controller]["monster_zone"]
    )


def _read_stat(card: Mapping[str, Any], key: str) -> int:
    value = card.get(key, 0)
    if value == "?" and card.get("id") in DYNAMIC_STAT_CARD_IDS:
        return 0
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise DuelRuleError(f"Chỉ số {key.upper()} của lá bài không hợp lệ.")
    return value


def _card_instance(card: Mapping[str, Any], owner: str, *, extra: bool = False) -> dict[str, Any]:
    if not isinstance(card, Mapping):
        raise DuelRuleError("Dữ liệu lá bài không hợp lệ.")
    card_id = card.get("id")
    category = str(card.get("category") or "").lower()
    if not isinstance(card_id, str) or not card_id.strip():
        raise DuelRuleError("Lá bài thiếu Card ID hợp lệ.")
    if category not in {"monster", "spell", "trap", "fusion"}:
        raise DuelRuleError("Loại lá bài không hợp lệ.")
    if (category == "fusion") != extra:
        raise DuelRuleError("Lá Fusion chỉ được đặt trong Extra Deck.")

    instance = deepcopy(dict(card))
    instance.update(
        {
            "instance_id": str(uuid.uuid4()),
            "card_id": card_id,
            "category": category,
            "owner": owner,
            "controller": owner,
            "base_atk": _read_stat(card, "atk") if category in {"monster", "fusion"} else 0,
            "base_def": _read_stat(card, "def") if category in {"monster", "fusion"} else 0,
        }
    )
    instance["atk"] = instance["base_atk"]
    instance["def"] = instance["base_def"]
    return instance


def _build_player(
    main_deck: list[Mapping[str, Any]],
    extra_deck: list[Mapping[str, Any]],
    owner: str,
    shuffle: Callable[[list[dict[str, Any]]], None],
) -> dict[str, Any]:
    if not isinstance(main_deck, list) or not 40 <= len(main_deck) <= 60:
        raise DuelRuleError("Main Deck cần từ 40 đến 60 lá.")
    if not isinstance(extra_deck, list) or len(extra_deck) > 20:
        raise DuelRuleError("Extra Deck không được vượt quá 20 lá.")

    for entries in (main_deck, extra_deck):
        copies: dict[str, int] = {}
        limits: dict[str, int] = {}
        for card in entries:
            if not isinstance(card, Mapping):
                raise DuelRuleError("Dữ liệu lá bài không hợp lệ.")
            card_id = card.get("id")
            if not isinstance(card_id, str):
                raise DuelRuleError("Lá bài thiếu Card ID hợp lệ.")
            max_copies = card.get("maxCopies", 3)
            if (
                not isinstance(max_copies, int)
                or isinstance(max_copies, bool)
                or max_copies < 1
            ):
                max_copies = 3
            copies[card_id] = copies.get(card_id, 0) + 1
            limits[card_id] = min(3, max_copies)
            if copies[card_id] > limits[card_id]:
                raise DuelRuleError("Bộ bài vượt quá giới hạn số bản sao của một lá.")

    deck = [_card_instance(card, owner) for card in main_deck]
    extra = [_card_instance(card, owner, extra=True) for card in extra_deck]
    shuffle(deck)
    return {
        "lp": 8000,
        "deck": deck,
        "extra_deck": extra,
        "hand": [],
        "monster_zone": [None] * 5,
        "spell_trap_zone": [None] * 5,
        "field_zone": [None],
        "graveyard": [],
        "banished": [],
    }


def create_duel_state(
    player_deck: list[Mapping[str, Any]],
    ai_deck: list[Mapping[str, Any]],
    *,
    player_extra_deck: list[Mapping[str, Any]] | None = None,
    ai_extra_deck: list[Mapping[str, Any]] | None = None,
    first_player: str = "player",
    shuffle: Callable[[list[dict[str, Any]]], None] | None = None,
) -> dict[str, Any]:
    """Create a fresh match from server-verified card definitions."""
    if first_player not in PLAYER_IDS:
        raise DuelRuleError("Người chơi đi trước không hợp lệ.")
    shuffle_cards = shuffle or random.SystemRandom().shuffle
    player_extra = [] if player_extra_deck is None else player_extra_deck
    ai_extra = [] if ai_extra_deck is None else ai_extra_deck
    state = {
        "match_id": str(uuid.uuid4()),
        "turn": 1,
        "turn_player": first_player,
        "first_player": first_player,
        "phase": "draw",
        "drawn_this_turn": False,
        "normal_summon_used": {"player": False, "ai": False},
        "attacked": {"player": [], "ai": []},
        "pending_battle": None,
        "battle": {},
        "players": {
            "player": _build_player(
                player_deck, player_extra, "player", shuffle_cards
            ),
            "ai": _build_player(ai_deck, ai_extra, "ai", shuffle_cards),
        },
        "chain": {
            "status": "closed",
            "links": [],
            "priority_player": None,
            "consecutive_passes": 0,
        },
        "stat_modifiers": [],
        "slifer_trigger_seq": 0,
        "last_slifer_triggers": [],
        "effect_protection": {},
        "card_effect_protection": {},
        "pending_decision": None,
        "over": False,
        "winner": None,
    }
    for player in PLAYER_IDS:
        state["players"][player]["hand"] = [
            state["players"][player]["deck"].pop() for _ in range(5)
        ]
    for player in (first_player, opponent_of(first_player)):
        check_win_by_exodia(state, player)
        if state["over"]:
            break
    return state


def check_win_by_exodia(state: dict[str, Any], player: str) -> bool:
    if player not in PLAYER_IDS:
        raise DuelRuleError("Người chơi không hợp lệ.")
    hand_ids = {
        card.get("card_id") for card in state["players"][player]["hand"]
    }
    if not EXODIA_PIECE_IDS.issubset(hand_ids):
        return False
    loser = opponent_of(player)
    loser_zones = state["players"][loser]
    for zone_name in ("monster_zone", "spell_trap_zone"):
        zone_cards = loser_zones.get(zone_name, [])
        for idx, card in enumerate(zone_cards):
            if card:
                card["face_down"] = False
                loser_zones["graveyard"].append(card)
                zone_cards[idx] = None
    loser_zones["lp"] = 0
    state["exodia_winner"] = player
    state["over"] = True
    state["winner"] = player
    return True


def change_life_points(state: dict[str, Any], player: str, amount: int) -> None:
    """Apply signed LP change and record the winner at zero LP."""
    if player not in PLAYER_IDS:
        raise DuelRuleError("Người chơi không hợp lệ.")
    if isinstance(amount, bool) or not isinstance(amount, int):
        raise DuelRuleError("Lượng thay đổi LP phải là số nguyên.")
    if state.get("over"):
        raise DuelRuleError("Duel đã kết thúc.")
    next_lp = max(0, state["players"][player]["lp"] + amount)
    state["players"][player]["lp"] = next_lp
    if next_lp == 0:
        state["over"] = True
        state["winner"] = opponent_of(player)


def move_card(
    state: dict[str, Any],
    instance_id: str,
    destination_player: str,
    destination_zone: str,
    *,
    destination_index: int | None = None,
    destroyed: bool = False,
) -> dict[str, Any]:
    """Move a card between authoritative zones, applying field-leave expirations."""
    if destination_player not in PLAYER_IDS or destination_zone not in PLAYER_ZONES:
        raise DuelRuleError("Khu vực nhận lá bài không hợp lệ.")
    source = find_card(state, instance_id)
    if not source:
        raise DuelRuleError("Không tìm thấy lá bài cần di chuyển.")
    source_player, source_zone, source_index, card = source
    if (
        source_zone == "graveyard"
        and destination_zone == "monster_zone"
        and card.get(CRUSH_CARD_VIRUS_GY_LOCK)
    ):
        raise DuelRuleError("Lá bài này không thể được Triệu hồi Đặc Biệt từ Mộ.")
    if source_zone == "graveyard" and destination_zone != "graveyard":
        card.pop(CRUSH_CARD_VIRUS_GY_LOCK, None)
        if card.get("card_id") == "t-crush-card-virus":
            card.pop("crush_card_virus_armed", None)
            card.pop("crush_card_virus_target_instance_id", None)
    attached_traps_to_destroy: list[str] = []
    attached_monsters_to_destroy: list[str] = []
    if source_zone == "monster_zone" and destination_zone != "monster_zone":
        for player in PLAYER_IDS:
            for trap in state["players"][player]["spell_trap_zone"]:
                if (
                    not trap
                    or trap.get("target_instance_id") != instance_id
                ):
                    continue
                if trap.get("card_id") in {
                    "s-horn-of-the-unicorn",
                    "s-magic-formula",
                    "s-butterfly-dagger-elma",
                    "s-mask-of-the-accursed",
                    "s-sword-of-deep-seated",
                    *UNION_MONSTER_IDS,
                    "t-nightmare-wheel",
                    "t-call-of-the-haunted",
                    "t-shadow-spell",
                } or (
                    destroyed and trap.get("card_id") == "t-spellbinding-circle"
                ):
                    attached_traps_to_destroy.append(trap["instance_id"])
    if (
        source_zone == "spell_trap_zone"
        and destination_zone not in FIELD_ZONES
        and card.get("card_id") == "t-call-of-the-haunted"
    ):
        target = find_card(state, card.get("target_instance_id"))
        if target and target[1] == "monster_zone":
            attached_monsters_to_destroy.append(target[3]["instance_id"])
    was_equipped = (
        source_zone == "spell_trap_zone"
        and card.get("card_id") in {
            "s-horn-of-the-unicorn",
            "s-magic-formula",
            "s-butterfly-dagger-elma",
            "s-mask-of-the-accursed",
            "s-sword-of-deep-seated",
        } | UNION_MONSTER_IDS
        and isinstance(card.get("target_instance_id"), str)
    )
    if was_equipped and destination_zone == "graveyard":
        if card.get("card_id") in {
            "s-horn-of-the-unicorn",
            "s-sword-of-deep-seated",
        }:
            destination_zone = "deck"
        elif card.get("card_id") == "s-butterfly-dagger-elma" and destroyed:
            destination_zone = "hand"
    if source_zone == "extra_deck" and destination_zone in FIELD_ZONES:
        raise DuelRuleError("Triệu hồi Dung Hợp hiện chưa được hỗ trợ.")
    if destination_zone == "extra_deck" and card.get("category") != "fusion":
        raise DuelRuleError("Chỉ lá Fusion mới được đặt trong Extra Deck.")
    if destination_zone == "monster_zone" and card.get("category") not in {
        "monster",
        "fusion",
    }:
        raise DuelRuleError("Chỉ quái thú mới được đặt trong Monster Zone.")
    if destination_zone == "spell_trap_zone" and card.get("category") not in {
        "spell",
        "trap",
    } and not (
        card.get("card_id") in UNION_MONSTER_IDS
        and card.get("union_equipped")
    ):
        raise DuelRuleError("Chỉ Spell/Trap mới được đặt trong Spell/Trap Zone.")
    if destination_zone == "field_zone" and card.get("category") != "spell":
        raise DuelRuleError("Chỉ Bài Phép Môi Trường mới được đặt trong Ô Môi Trường.")

    destination = state["players"][destination_player][destination_zone]
    if destination_zone in FIELD_ZONES:
        if destination_index is None:
            destination_index = next(
                (index for index, item in enumerate(destination) if item is None),
                None,
            )
        if (
            isinstance(destination_index, bool)
            or not isinstance(destination_index, int)
            or not 0 <= destination_index < len(destination)
            or destination[destination_index] is not None
        ):
            raise DuelRuleError("Ô nhận lá bài không hợp lệ hoặc đã có bài.")
    elif destination_index is not None:
        raise DuelRuleError("Không thể chỉ định ô cho khu vực dạng danh sách.")

    if card.get("card_id") == "m-blue-eyes-alternative-white-dragon":
        if destination_zone == "graveyard" or (
            destination_zone == "monster_zone"
            and not card.get("monster_effects_negated", False)
        ):
            card["name_alias"] = "Rồng Trắng Mắt Xanh"
        else:
            card.pop("name_alias", None)

    if source_zone in FIELD_ZONES and destination_zone not in FIELD_ZONES:
        for event in ("card_left_field", "target_leaves_field"):
            expired = expire_effects(state, event, instance_id=instance_id)
            state["stat_modifiers"] = expired["stat_modifiers"]
        card.pop("effect_active", None)
        card.pop("monster_effects_negated", None)
        card.pop("target_instance_id", None)
        card.pop("union_equipped", None)
        card.pop("summoned_turn", None)
        card.pop("flip_summoned_turn", None)
        card.pop("position_changed_turn", None)
        card.pop("allow_position_change_on_summon_turn", None)
        card.pop("cannot_attack_turn", None)
        card.pop("cannot_attack_until_turn", None)
        card.pop("cannot_change_position_until_turn", None)
        card.pop("cannot_be_destroyed_by_battle", None)

    if (
        source_zone == "monster_zone"
        and destination_zone != "monster_zone"
        and isinstance(card.get("clone_dragon_original_values"), Mapping)
    ):
        original_values = card.pop("clone_dragon_original_values")
        values = original_values.get("values", {})
        present_keys = original_values.get("present_keys", ())
        for key, value in values.items():
            if key in present_keys:
                card[key] = value
            else:
                card.pop(key, None)
        card.pop("clone_dragon_copied_card_id", None)

    if source_zone in FIELD_ZONES:
        state["players"][source_player][source_zone][source_index] = None
    else:
        state["players"][source_player][source_zone].pop(source_index)

    card["controller"] = (
        destination_player
        if destination_zone in FIELD_ZONES or destination_zone == "hand"
        else card["owner"]
    )
    if (
        card.get("is_token") or card.get("card_id") == "token-kuriboh"
    ) and destination_zone not in FIELD_ZONES:
        return card
    if destination_zone in FIELD_ZONES:
        destination[destination_index] = card
    else:
        if destination_zone in {"hand", "deck", "graveyard", "banished", "extra_deck"}:
            if destination_zone != "hand":
                destination_player = card["owner"]
            state["players"][destination_player][destination_zone].append(card)
        else:
            raise DuelRuleError("Khu vực nhận lá bài chưa được hỗ trợ.")
    if (
        was_equipped
        and card.get("card_id") == "s-magic-formula"
        and destination_zone == "graveyard"
        and not state.get("over")
    ):
        change_life_points(state, card["owner"], 1000)
    if destroyed:
        expired = expire_effects(state, "card_destroyed", instance_id=instance_id)
        state["stat_modifiers"] = expired["stat_modifiers"]
    if source_zone != destination_zone and destination_zone in {
        "graveyard",
        "banished",
    } and not state.get("over"):
        for player in PLAYER_IDS:
            active_absorptions = sum(
                1
                for source_card in state["players"][player]["spell_trap_zone"]
                if source_card
                and source_card.get("card_id") == "s-soul-absorption"
                and not source_card.get("face_down")
                and source_card.get("effect_active")
            )
            if active_absorptions:
                change_life_points(state, player, active_absorptions * 500)
    # Tiếng Gọi Của Cái Chết Và Sự Sống: quái thú được hồi sinh bị phá hủy khi Bẫy rời sân.
    attached_destination_zone = (
        "banished"
        if destroyed and destination_zone == "banished"
        else "graveyard"
    )
    for monster_instance_id in attached_monsters_to_destroy:
        target = find_card(state, monster_instance_id)
        if target and target[1] == "monster_zone":
            destroy_card(
                state,
                monster_instance_id,
                destination_zone=attached_destination_zone,
            )
    for trap_instance_id in attached_traps_to_destroy:
        if find_card(state, trap_instance_id):
            destroy_card(
                state,
                trap_instance_id,
                destination_zone=attached_destination_zone,
            )
    return card


def destroy_card(
    state: dict[str, Any],
    instance_id: str,
    *,
    by_player: str | None = None,
    destination_zone: str = "graveyard",
    by_battle: bool = False,
) -> dict[str, Any] | None:
    found = find_card(state, instance_id)
    if not found or found[1] not in FIELD_ZONES:
        raise DuelRuleError("Chỉ có thể phá hủy lá bài đang ở trên sân.")
    if by_player is not None and by_player not in PLAYER_IDS:
        raise DuelRuleError("Người chơi gây phá hủy không hợp lệ.")
    if destination_zone not in {"graveyard", "banished"}:
        raise DuelRuleError("Khu vực nhận lá bài bị phá hủy không hợp lệ.")
    controller, _zone, _index, card = found
    if (
        card.get("card_id") == "s-the-seal-of-orichalcos"
        and not card.get("face_down", False)
        and not by_battle
    ):
        return None
    if card.get("category") in {"monster", "fusion"}:
        if (
            not by_battle
            and is_spellcaster_card(card)
            and any(
                monster
                and monster.get("card_id") == "m-palladium-oracle-mana"
                and not monster.get("face_down", False)
                and not monster.get("monster_effects_negated", False)
                for monster in state["players"][controller]["monster_zone"]
            )
        ):
            return None
        if (
            by_player is not None
            and by_player != controller
            and state.get("effect_protection", {}).get(controller) == state["turn"]
        ):
            return None
        if (
            by_player is not None
            and by_player != controller
            and state.get("card_effect_protection", {}).get(instance_id) == state["turn"]
        ):
            return None
        race = str(card.get("race") or card.get("monsterType") or "").lower()
        if "dragon" in race or "rồng" in race:
            replacement = next(
                (
                    candidate
                    for candidate in state["players"][controller]["graveyard"]
                    if candidate.get("card_id") == "s-return-of-the-dragon-lords"
                ),
                None,
            )
            if replacement:
                move_card(state, replacement["instance_id"], controller, "banished")
                return None
    union_protection = next(
        (
            candidate
            for player in PLAYER_IDS
            for candidate in state["players"][player]["spell_trap_zone"]
            if candidate
            and candidate.get("card_id") in UNION_MONSTER_IDS
            and candidate.get("union_equipped")
            and candidate.get("target_instance_id") == instance_id
            and not candidate.get("face_down", False)
            and not candidate.get("monster_effects_negated", False)
        ),
        None,
    )
    if union_protection:
        destroy_card(
            state,
            union_protection["instance_id"],
            by_player=by_player,
        )
        return None
    destroyed_card = move_card(
        state,
        instance_id,
        found[3]["owner"],
        destination_zone,
        destroyed=True,
    )
    destroyed_location = find_card(state, instance_id)
    destroyed_in_graveyard = bool(
        destroyed_location and destroyed_location[1] == "graveyard"
    )
    if (
        destroyed_card
        and destroyed_card.get("card_id") == CLONE_DRAGON_ID
        and destination_zone == "graveyard"
        and destroyed_in_graveyard
    ):
        state.setdefault("pending_card_triggers", []).append(
            {
                "card_id": CLONE_DRAGON_ID,
                "event": "destroyed",
                "source_instance_id": instance_id,
                "player": destroyed_card["owner"],
            }
        )
    if destroyed_card and destroyed_card.get("card_id") == "m-palladium-oracle-mana":
        state.setdefault("pending_card_triggers", []).append(
            {
                "card_id": "m-palladium-oracle-mana",
                "event": "destroyed",
                "source_instance_id": instance_id,
                "player": destroyed_card["owner"],
            }
        )
    if by_battle and destroyed_card:
        for owner in PLAYER_IDS:
            for virus in state["players"][owner]["graveyard"]:
                if (
                    virus.get("card_id") == "t-crush-card-virus"
                    and virus.get("crush_card_virus_armed")
                    and virus.get("crush_card_virus_target_instance_id")
                    == instance_id
                ):
                    state.setdefault("pending_card_triggers", []).append(
                        {
                            "card_id": "t-crush-card-virus",
                            "source_instance_id": virus["instance_id"],
                            "player": owner,
                            "target_instance_id": instance_id,
                        }
                    )
    if (
        destroyed_card
        and destroyed_card.get("card_id") == "m-magicat"
        and destination_zone == "graveyard"
        and destroyed_in_graveyard
    ):
        state.setdefault("pending_card_triggers", []).append(
            {
                "card_id": "m-magicat",
                "source_instance_id": instance_id,
                "player": destroyed_card["owner"],
            }
        )
    if (
        destroyed_card
        and destroyed_card.get("card_id") == "m-archfiend-of-gilfer"
        and destination_zone == "graveyard"
        and destroyed_in_graveyard
    ):
        state.setdefault("pending_card_triggers", []).append(
            {
                "card_id": "m-archfiend-of-gilfer",
                "source_instance_id": instance_id,
                "player": destroyed_card["owner"],
            }
        )
    if (
        destroyed_card
        and destroyed_card.get("card_id") == "m-night-assailant"
        and destination_zone == "graveyard"
        and destroyed_in_graveyard
    ):
        state.setdefault("pending_card_triggers", []).append(
            {
                "card_id": "m-night-assailant",
                "source_instance_id": instance_id,
                "player": destroyed_card["owner"],
            }
        )
    if destroyed_card and destination_zone == "graveyard" and destroyed_in_graveyard:
        clone_token_ids = [
            card["instance_id"]
            for player in PLAYER_IDS
            for card in state["players"][player]["monster_zone"]
            if card
            and card.get("is_token")
            and card.get("token_source_instance_id") == instance_id
        ]
        for token_id in clone_token_ids:
            token = find_card(state, token_id)
            if token and token[1] == "monster_zone":
                move_card(
                    state,
                    token_id,
                    token[0],
                    "graveyard",
                    destroyed=True,
                )
    return destroyed_card


def draw_cards(
    state: Mapping[str, Any], player: str, count: int
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    if player not in PLAYER_IDS:
        raise DuelRuleError("Người chơi không hợp lệ.")
    if isinstance(count, bool) or not isinstance(count, int) or count < 0:
        raise DuelRuleError("Số lá cần rút không hợp lệ.")
    if state.get("over"):
        raise DuelRuleError("Duel đã kết thúc.")
    next_state = deepcopy(dict(state))
    drawn: list[dict[str, Any]] = []
    for _ in range(count):
        deck = next_state["players"][player]["deck"]
        if not deck:
            next_state["over"] = True
            next_state["winner"] = opponent_of(player)
            break
        card = deck.pop()
        next_state["players"][player]["hand"].append(card)
        drawn.append(card)
        if check_win_by_exodia(next_state, player):
            break
    return next_state, drawn


def find_card(
    state: Mapping[str, Any], instance_id: str
) -> tuple[str, str, int, dict[str, Any]] | None:
    """Find a card by its server-created instance ID and current zone."""
    for player in PLAYER_IDS:
        player_state = state.get("players", {}).get(player, {})
        for zone in PLAYER_ZONES:
            cards = player_state.get(zone, [])
            if not isinstance(cards, list):
                continue
            for index, card in enumerate(cards):
                if isinstance(card, dict) and card.get("instance_id") == instance_id:
                    return player, zone, index, card
    return None


def monster_effects_are_negated(
    state: Mapping[str, Any], instance_id: str
) -> bool:
    found = find_card(state, instance_id)
    return bool(
        found
        and found[1] == "monster_zone"
        and found[3].get("monster_effects_negated", False)
    )


def _valid_duration(
    state: Mapping[str, Any],
    duration: Mapping[str, Any],
    source_instance_id: str,
    target_instance_id: str,
) -> dict[str, Any]:
    if not isinstance(duration, Mapping):
        raise DuelRuleError("Thời hạn hiệu ứng không hợp lệ.")
    kind = duration.get("type")
    if kind in {"turn_end", "opponent_turn_end"}:
        end_player = state["turn_player"]
        end_turn = state["turn"]
        if kind == "opponent_turn_end":
            end_player = opponent_of(end_player)
            end_turn += 1
        return {
            "type": kind,
            "turn": end_turn,
            "player": end_player,
        }
    if kind in {"end_phase", "opponent_end_phase"}:
        end_player = state["turn_player"]
        end_turn = state["turn"]
        if kind == "opponent_end_phase":
            end_player = opponent_of(end_player)
            end_turn += 1
        return {"type": kind, "turn": end_turn, "player": end_player}
    if kind in {"source_leaves_field", "continuous"}:
        return {"type": kind, "source_instance_id": source_instance_id}
    if kind in {"card_destroyed", "target_leaves_field"}:
        return {"type": kind, "target_instance_id": target_instance_id}
    if kind == "permanent":
        return {"type": kind}
    raise DuelRuleError("Loại thời hạn hiệu ứng chưa được hỗ trợ.")


def add_stat_modifier(
    state: Mapping[str, Any],
    *,
    target_instance_id: str,
    source_instance_id: str,
    source_card_id: str,
    owner: str,
    stat: str,
    operation: str,
    value: int,
    duration: Mapping[str, Any],
) -> dict[str, Any]:
    """Return a copied state with an ordered ATK/DEF modifier."""
    if owner not in PLAYER_IDS:
        raise DuelRuleError("Chủ sở hữu hiệu ứng không hợp lệ.")
    if stat not in {"atk", "def"}:
        raise DuelRuleError("Chỉ số cần thay đổi không hợp lệ.")
    if operation not in {
        "increase",
        "decrease",
        "multiply",
        "divide",
        "set",
        "reset",
    }:
        raise DuelRuleError("Cách thay đổi chỉ số không hợp lệ.")
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise DuelRuleError("Giá trị thay đổi chỉ số không hợp lệ.")
    if operation == "divide" and value == 0:
        raise DuelRuleError("Không thể chia chỉ số cho 0.")
    target = find_card(state, target_instance_id)
    if (
        not target
        or target[1] != "monster_zone"
        or target[3].get("category") not in {"monster", "fusion"}
    ):
        raise DuelRuleError("Mục tiêu thay đổi chỉ số không còn trên sân.")
    source = find_card(state, source_instance_id)
    if (
        not source
        or source[0] != owner
        or source[3].get("card_id") != source_card_id
    ):
        raise DuelRuleError("Nguồn hiệu ứng không còn hợp lệ.")

    next_state = deepcopy(dict(state))
    next_state.setdefault("stat_modifiers", []).append(
        {
            "modifier_id": str(uuid.uuid4()),
            "target_instance_id": target_instance_id,
            "source_instance_id": source_instance_id,
            "source_card_id": source_card_id,
            "owner": owner,
            "stat": stat,
            "operation": operation,
            "value": value,
            "duration": _valid_duration(
                state, duration, source_instance_id, target_instance_id
            ),
            "negated": False,
        }
    )
    return next_state


def current_stats(state: Mapping[str, Any], instance_id: str) -> dict[str, int]:
    found = find_card(state, instance_id)
    if not found:
        raise DuelRuleError("Không tìm thấy quái thú.")
    card = found[3]
    if isinstance(card.get("clone_dragon_original_values"), Mapping):
        stats = {"atk": card["base_atk"], "def": card["base_def"]}
    elif (
        card.get("card_id") == "m-slifer-the-sky-dragon"
        and not card.get("monster_effects_negated", False)
    ):
        controller = card.get("controller", found[0])
        hand_size = len(state["players"][controller]["hand"])
        stats = {"atk": hand_size * 1000, "def": hand_size * 1000}
    else:
        stats = {"atk": card["base_atk"], "def": card["base_def"]}
    # Hiệp Sĩ Khiên Xanh: tăng 400 ATK khi người điều khiển có tối đa 1 lá trên tay.
    if (
        card.get("card_id") == "m-blade-knight"
        and found[1] == "monster_zone"
        and not card.get("face_down")
        and not card.get("monster_effects_negated", False)
        and len(state["players"][found[0]]["hand"]) <= 1
    ):
        stats["atk"] += 400
    if (
        card.get("card_id") == "m-buster-blader"
        and found[1] == "monster_zone"
        and not card.get("face_down")
        and not card.get("monster_effects_negated", False)
    ):
        opponent = opponent_of(card.get("controller", found[0]))
        opponent_state = state["players"][opponent]
        dragon_count = sum(
            1
            for zone in ("monster_zone", "graveyard")
            for monster in opponent_state[zone]
            if isinstance(monster, Mapping)
            and monster.get("category") in {"monster", "fusion"}
            and monster.get("race") == "Rồng"
        )
        stats["atk"] += dragon_count * 500
    # Nữ Phù Thủy Bóng Đêm: mỗi Phù Thủy Áo Đen trong hai Mộ tăng 300 ATK.
    if (
        card.get("card_id") == "m-dark-magician-girl"
        and found[1] == "monster_zone"
        and not card.get("face_down")
        and not card.get("monster_effects_negated", False)
    ):
        magician_count = sum(
            1
            for player in PLAYER_IDS
            for monster in state["players"][player]["graveyard"]
            if isinstance(monster, Mapping)
            and (
                monster.get("card_id") == "m-dark-magician"
                or monster.get("name") == "Phù Thủy Áo Đen"
            )
        )
        stats["atk"] += magician_count * 300
    # Phong Ấn Orichalcos: tăng 500 ATK cho tất cả quái thú của người điều khiển.
    if (
        found[1] == "monster_zone"
        and not card.get("face_down")
    ):
        controller = card.get("controller", found[0])
        if any(
            field_card
            and field_card.get("card_id") == "s-the-seal-of-orichalcos"
            and not field_card.get("face_down", False)
            for field_card in state["players"][controller].get("field_zone", [])
        ):
            stats["atk"] += 500
    for modifier in state.get("stat_modifiers", []):
        if (
            modifier.get("target_instance_id") != instance_id
            or modifier.get("negated")
        ):
            continue
        if modifier.get("source_card_id") in EQUIP_SPELL_IDS:
            source = find_card(state, modifier.get("source_instance_id"))
            if (
                not source
                or source[3].get("target_instance_id") != instance_id
            ):
                continue
        duration = modifier["duration"]
        if duration["type"] in {"continuous", "source_leaves_field"}:
            source = find_card(state, duration["source_instance_id"])
            if (
                not source
                or source[1] not in FIELD_ZONES
                or source[3].get("face_down")
                or (
                    source[3].get("category") in {"monster", "fusion"}
                    and source[3].get("monster_effects_negated", False)
                )
                or (
                    source[3].get("category") == "trap"
                    and trap_effect_is_negated(state, source[0])
                )
            ):
                continue
        stat = modifier["stat"]
        value = modifier["value"]
        operation = modifier["operation"]
        if operation == "increase":
            stats[stat] += value
        elif operation == "decrease":
            stats[stat] = max(0, stats[stat] - value)
        elif operation == "multiply":
            stats[stat] *= value
        elif operation == "divide":
            stats[stat] //= value
        elif operation == "set":
            stats[stat] = value
        elif operation == "reset":
            stats[stat] = card[f"base_{stat}"]
    return stats


def expire_effects(
    state: Mapping[str, Any],
    event: str,
    *,
    player: str | None = None,
    turn: int | None = None,
    phase: str | None = None,
    instance_id: str | None = None,
) -> dict[str, Any]:
    """Expire modifiers at explicit turn, phase, or card-movement events."""
    next_state = deepcopy(dict(state))

    def remains(modifier: Mapping[str, Any]) -> bool:
        duration = modifier["duration"]
        kind = duration["type"]
        if (
            event == "turn_end"
            and kind in {"turn_end", "opponent_turn_end"}
            and duration["player"] == player
            and duration["turn"] == turn
        ):
            return False
        if (
            event == "phase_end"
            and phase == "end"
            and kind in {"end_phase", "opponent_end_phase"}
            and duration["player"] == player
            and duration["turn"] == turn
        ):
            return False
        if (
            event == "card_left_field"
            and kind == "source_leaves_field"
            and duration["source_instance_id"] == instance_id
        ):
            return False
        if (
            event == "card_destroyed"
            and kind == "card_destroyed"
            and duration["target_instance_id"] == instance_id
        ):
            return False
        if (
            event == "card_left_field"
            and kind == "target_leaves_field"
            and duration["target_instance_id"] == instance_id
        ):
            return False
        return True

    next_state["stat_modifiers"] = [
        modifier for modifier in next_state.get("stat_modifiers", []) if remains(modifier)
    ]
    return next_state


@dataclass(frozen=True)
class EffectContext:
    player: str
    source_instance_id: str
    card_id: str
    effect_id: str
    target_instance_ids: tuple[str, ...]
    payload: dict[str, Any]


EffectCondition = Callable[[Mapping[str, Any], EffectContext], bool]
EffectActivation = Callable[[dict[str, Any], EffectContext], None]
EffectResolver = Callable[[dict[str, Any], EffectContext], None]
TargetValidator = Callable[[Mapping[str, Any], str, EffectContext], bool]


@dataclass(frozen=True)
class EffectDefinition:
    card_id: str
    effect_id: str
    effect_type: str
    speed: int
    resolve: EffectResolver
    can_activate: EffectCondition | None = None
    on_activate: EffectActivation | None = None
    target_is_valid: TargetValidator | None = None
    source_zones: frozenset[str] = frozenset(FIELD_ZONES)
    phases: frozenset[str] = frozenset(PHASES)
    requires_target: bool = False
    can_chain: bool = False
    move_source_on_activation: bool = False
    discard_source_after_resolution: bool = False
    destination_zone: str = "spell_trap_zone"

    def __post_init__(self) -> None:
        if not self.card_id or not self.effect_id:
            raise ValueError("An effect requires a card ID and effect ID.")
        if self.effect_type not in EFFECT_TYPES:
            raise ValueError(f"Unsupported effect type: {self.effect_type}")
        if isinstance(self.speed, bool) or self.speed not in {1, 2, 3}:
            raise ValueError("Effect speed must be 1, 2, or 3.")
        if not self.source_zones or not self.source_zones.issubset(PLAYER_ZONES):
            raise ValueError("Effect source zones are invalid.")
        if not self.phases or not self.phases.issubset(PHASES):
            raise ValueError("Effect phases are invalid.")


class EffectRegistry:
    """Resolve effect behavior by stable Card ID and effect ID."""

    def __init__(self) -> None:
        self._effects: dict[tuple[str, str], EffectDefinition] = {}

    def register(self, effect: EffectDefinition) -> None:
        key = (effect.card_id, effect.effect_id)
        if key in self._effects:
            raise ValueError(f"Effect already registered: {key}")
        self._effects[key] = effect

    def get(self, card_id: str, effect_id: str) -> EffectDefinition:
        try:
            return self._effects[(card_id, effect_id)]
        except KeyError as error:
            raise DuelRuleError("Hiệu ứng này chưa được hỗ trợ.") from error

    def for_card(self, card_id: str) -> tuple[EffectDefinition, ...]:
        return tuple(
            effect
            for (registered_card_id, _), effect in self._effects.items()
            if registered_card_id == card_id
        )

    def has_card_effect(self, card_id: str) -> bool:
        return any(registered_card_id == card_id for registered_card_id, _ in self._effects)


class DuelEffectEngine:
    """Validate activations, manage response priority, and resolve chains."""

    def __init__(self, registry: EffectRegistry) -> None:
        self.registry = registry

    def clone_dragon_copyable_effects(
        self, card_id: str
    ) -> tuple[EffectDefinition, ...]:
        return tuple(
            effect
            for effect in self.registry.for_card(card_id)
            if "monster_zone" in effect.source_zones
            and not effect.move_source_on_activation
        )

    def clone_dragon_target_ids(
        self, state: Mapping[str, Any]
    ) -> list[str]:
        target_ids = []
        for player in PLAYER_IDS:
            for target in state["players"][player]["monster_zone"]:
                if (
                    not target
                    or target.get("face_down", False)
                    or target.get("monster_effects_negated", False)
                    or target.get("category") not in {"monster", "fusion"}
                    or not self.clone_dragon_copyable_effects(
                        str(
                            target.get("clone_dragon_copied_card_id")
                            or target.get("card_id")
                            or ""
                        )
                    )
                ):
                    continue
                target_ids.append(target["instance_id"])
        return target_ids

    def apply_clone_dragon_copy(
        self,
        state: Mapping[str, Any],
        *,
        source_instance_id: str,
        target_instance_id: str,
    ) -> dict[str, Any]:
        source = find_card(state, source_instance_id)
        target = find_card(state, target_instance_id)
        if (
            not source
            or source[1] != "monster_zone"
            or source[3].get("card_id") != CLONE_DRAGON_ID
            or not target
            or target[1] != "monster_zone"
            or target[3].get("face_down", False)
            or target[3].get("monster_effects_negated", False)
            or target[3].get("category") not in {"monster", "fusion"}
            or not self.clone_dragon_copyable_effects(
                str(
                    target[3].get("clone_dragon_copied_card_id")
                    or target[3].get("card_id")
                    or ""
                )
            )
        ):
            raise DuelRuleError("Mục tiêu không có hiệu ứng trên sân được Rồng Vô Tính sao chép.")

        target_stats = current_stats(state, target_instance_id)
        next_state = deepcopy(dict(state))
        copied_source = find_card(next_state, source_instance_id)
        copied_target = find_card(next_state, target_instance_id)
        if not copied_source or not copied_target:
            raise DuelRuleError("Không thể sao chép quái thú đã rời sân.")

        original_fields = (
            "card_id",
            "name",
            "name_alias",
            "description",
            "skills",
            "base_atk",
            "base_def",
            "atk",
            "def",
        )
        copied_source[3]["clone_dragon_original_values"] = {
            "values": {
                key: deepcopy(copied_source[3].get(key))
                for key in original_fields
            },
            "present_keys": tuple(
                key for key in original_fields if key in copied_source[3]
            ),
        }
        copied_source[3]["clone_dragon_copied_card_id"] = (
            copied_target[3].get("clone_dragon_copied_card_id")
            or copied_target[3]["card_id"]
        )
        copied_source[3]["name"] = (
            copied_target[3].get("name_alias") or copied_target[3].get("name")
        )
        copied_source[3].pop("name_alias", None)
        for key in ("description", "skills"):
            if key in copied_target[3]:
                copied_source[3][key] = deepcopy(copied_target[3][key])
            else:
                copied_source[3].pop(key, None)
        copied_source[3]["base_atk"] = target_stats["atk"]
        copied_source[3]["base_def"] = target_stats["def"]
        copied_source[3]["atk"] = target_stats["atk"]
        copied_source[3]["def"] = target_stats["def"]
        return next_state

    def copied_monster_effect_options(
        self,
        state: Mapping[str, Any],
        *,
        player: str,
        source_instance_id: str,
    ) -> list[dict[str, Any]]:
        source = find_card(state, source_instance_id)
        if (
            player not in PLAYER_IDS
            or state.get("chain", {}).get("status") != "closed"
            or not source
            or source[0] != player
            or source[1] != "monster_zone"
            or source[3].get("face_down", False)
            or source[3].get("monster_effects_negated", False)
            or not isinstance(source[3].get("clone_dragon_original_values"), Mapping)
        ):
            return []

        card_id = str(source[3].get("clone_dragon_copied_card_id") or "")
        validation_state = self._effect_validation_state(
            state, source_instance_id, card_id
        )
        all_target_ids = [
            card["instance_id"]
            for side in PLAYER_IDS
            for zone in (
                "hand",
                "monster_zone",
                "spell_trap_zone",
                "graveyard",
                "banished",
            )
            if zone != "hand" or side == player
            for card in state["players"][side].get(zone, [])
            if card and isinstance(card.get("instance_id"), str)
        ]
        options = []
        for effect in self.clone_dragon_copyable_effects(card_id):
            if state.get("phase") not in effect.phases:
                continue
            if effect.requires_target:
                if not effect.target_is_valid:
                    continue
                target_sets = []
                for target_id in all_target_ids:
                    context = self._context(
                        player,
                        source_instance_id,
                        card_id,
                        effect.effect_id,
                        (target_id,),
                        {},
                    )
                    if effect.target_is_valid(
                        validation_state, target_id, context
                    ):
                        target_sets.append((target_id,))
            else:
                target_sets = [()]

            for target_ids in target_sets:
                try:
                    self.activate(
                        state,
                        player=player,
                        source_instance_id=source_instance_id,
                        effect_id=effect.effect_id,
                        target_instance_ids=target_ids,
                    )
                except DuelRuleError:
                    continue
                options.append(
                    {
                        "source_instance_id": source_instance_id,
                        "card_id": card_id,
                        "effect_id": effect.effect_id,
                        "target_instance_ids": list(target_ids),
                    }
                )
        return options

    @staticmethod
    def _is_spell_trap_card_activation(
        source: tuple[str, str, int, dict[str, Any]] | None,
    ) -> bool:
        return bool(
            source
            and source[3].get("category") in {"spell", "trap"}
            and (
                source[1] == "hand"
                or (
                    source[1] == "spell_trap_zone"
                    and source[3].get("face_down", False)
                )
            )
        )

    @staticmethod
    def _has_opposing_rosewhip(
        state: Mapping[str, Any], player: str
    ) -> bool:
        return any(
            monster
            and monster.get("card_id") == "m-naturia-rosewhip"
            and not monster.get("face_down", False)
            and not monster.get("monster_effects_negated", False)
            for monster in state["players"][opponent_of(player)]["monster_zone"]
        )

    @staticmethod
    def spell_trap_activation_forbidden(
        state: Mapping[str, Any],
        *,
        player: str,
        source_instance_id: str,
    ) -> bool:
        source = find_card(state, source_instance_id)
        if (
            not source
            or source[0] != player
            or not DuelEffectEngine._is_spell_trap_card_activation(source)
        ):
            return False
        if (
            source[3].get("category") == "trap"
            and has_face_up_jinzo(state)
        ):
            return True
        if not DuelEffectEngine._has_opposing_rosewhip(state, player):
            return False
        return state.get("effect_uses", {}).get(
            f"{player}:m-naturia-rosewhip"
        ) == state["turn"]

    @staticmethod
    def _context(
        player: str,
        source_instance_id: str,
        card_id: str,
        effect_id: str,
        targets: tuple[str, ...],
        payload: Mapping[str, Any],
    ) -> EffectContext:
        return EffectContext(
            player=player,
            source_instance_id=source_instance_id,
            card_id=card_id,
            effect_id=effect_id,
            target_instance_ids=targets,
            payload=dict(payload),
        )

    @staticmethod
    def _effect_validation_state(
        state: Mapping[str, Any],
        source_instance_id: str,
        effect_card_id: str,
    ) -> Mapping[str, Any]:
        source = find_card(state, source_instance_id)
        if not source or source[3].get("card_id") == effect_card_id:
            return state
        validation_state = deepcopy(dict(state))
        validation_source = find_card(validation_state, source_instance_id)
        if validation_source:
            validation_source[3]["card_id"] = effect_card_id
        return validation_state

    def activate(
        self,
        state: Mapping[str, Any],
        *,
        player: str,
        source_instance_id: str,
        effect_id: str,
        target_instance_ids: tuple[str, ...] = (),
        payload: Mapping[str, Any] | None = None,
        destination_index: int | None = None,
    ) -> dict[str, Any]:
        if player not in PLAYER_IDS:
            raise DuelRuleError("Người chơi không hợp lệ.")
        if state.get("over"):
            raise DuelRuleError("Duel đã kết thúc.")
        if not isinstance(source_instance_id, str) or not source_instance_id:
            raise DuelRuleError("Nguồn kích hoạt không hợp lệ.")
        if not isinstance(effect_id, str) or not effect_id:
            raise DuelRuleError("Hiệu ứng được yêu cầu không hợp lệ.")
        if not isinstance(target_instance_ids, (tuple, list)) or any(
            not isinstance(target_id, str) or not target_id
            for target_id in target_instance_ids
        ):
            raise DuelRuleError("Danh sách mục tiêu không hợp lệ.")
        if payload is not None and not isinstance(payload, Mapping):
            raise DuelRuleError("Dữ liệu hiệu ứng không hợp lệ.")
        if state.get("pending_decision"):
            raise DuelRuleError("Hãy hoàn tất lựa chọn đang chờ trước khi kích hoạt hiệu ứng khác.")
        chain = state.get("chain", {})
        if chain.get("status") == "resolving":
            raise DuelRuleError("Không thể kích hoạt hiệu ứng khi Chain đang giải quyết.")
        if chain.get("status") == "open" and any(
            link.get("source_instance_id") == source_instance_id
            for link in chain.get("links", [])
        ):
            raise DuelRuleError("Lá bài này đã được kích hoạt trong Chain hiện tại.")
        source = find_card(state, source_instance_id)
        if not source or source[0] != player:
            raise DuelRuleError("Nguồn kích hoạt không thuộc người chơi.")
        source_card_id = str(source[3].get("card_id") or "")
        card_id = str(
            source[3].get("clone_dragon_copied_card_id") or source_card_id
        )
        if (
            source[3].get("category") in {"monster", "fusion"}
            and source[3].get("monster_effects_negated", False)
        ):
            raise DuelRuleError("Hiệu ứng quái thú này đang bị vô hiệu hóa.")
        effect = self.registry.get(card_id, effect_id)
        if source[1] not in effect.source_zones or state.get("phase") not in effect.phases:
            raise DuelRuleError("Hiệu ứng không thể kích hoạt tại vị trí hoặc Phase này.")
        if source[3].get("category") == "spell":
            if source[1] == "hand" and state.get("turn_player") != player:
                raise DuelRuleError("Chỉ có thể kích hoạt Bài Phép từ trên tay trong lượt của bạn.")
            if (
                source[1] == "spell_trap_zone"
                and source[3].get("set_turn") == state.get("turn")
            ):
                raise DuelRuleError("Lá Phép Tức Thời vừa úp chưa thể kích hoạt ngay trong lượt này.")
        if source[3].get("category") == "trap":
            if has_face_up_jinzo(state):
                raise DuelRuleError("Không thể kích hoạt Bẫy khi Jinzo đang ngửa trên sân.")
            if (
                source[1] == "spell_trap_zone"
                and not source[3].get("face_down", False)
                and trap_effect_is_negated(state, player)
            ):
                raise DuelRuleError("Hiệu ứng Bẫy này đang bị Jinzo vô hiệu hóa.")
        if self.spell_trap_activation_forbidden(
            state,
            player=player,
            source_instance_id=source_instance_id,
        ):
            raise DuelRuleError("Đối thủ đang giới hạn kích hoạt một Lá Phép/Bẫy mỗi lượt.")

        targets = tuple(target_instance_ids)
        if len(set(targets)) != len(targets):
            raise DuelRuleError("Không thể chọn trùng mục tiêu.")
        context = self._context(
            player,
            source_instance_id,
            card_id,
            effect_id,
            targets,
            deepcopy(dict(payload or {})),
        )
        if effect.requires_target and not targets:
            if card_id == "s-brain-control" and not any(
                target
                and isinstance(target.get("instance_id"), str)
                and effect.target_is_valid
                and effect.target_is_valid(
                    state, target["instance_id"], context
                )
                for target in state["players"][opponent_of(player)][
                    "monster_zone"
                ]
            ):
                raise DuelRuleError(
                    "Tẩy Não chỉ có thể kích hoạt khi có quái thú đối thủ ngửa hợp lệ trên sân."
                )
            raise DuelRuleError("Hiệu ứng này cần ít nhất một mục tiêu.")
        validation_state = state
        if card_id != source_card_id:
            validation_state = deepcopy(dict(state))
            validation_source = find_card(validation_state, source_instance_id)
            if validation_source:
                validation_source[3]["card_id"] = card_id
        for target_id in targets:
            if not self._target_is_valid(
                effect, validation_state, target_id, context
            ):
                raise DuelRuleError("Mục tiêu hiệu ứng không hợp lệ.")
        if effect.can_activate and not effect.can_activate(validation_state, context):
            raise DuelRuleError("Không đủ điều kiện kích hoạt hiệu ứng.")

        next_state = deepcopy(dict(state))
        if effect.move_source_on_activation:
            if source[1] == "hand":
                target_zone = effect.destination_zone or "spell_trap_zone"
                activated_source = move_card(
                    next_state,
                    source_instance_id,
                    player,
                    target_zone,
                    destination_index=(
                        0 if target_zone == "field_zone" else destination_index
                    ),
                )
                activated_source["face_down"] = False
                activated_source["activated_turn"] = next_state["turn"]
            elif (
                source[1] == "spell_trap_zone"
                and "spell_trap_zone" in effect.source_zones
            ):
                activated_source = find_card(next_state, source_instance_id)
                if activated_source:
                    activated_source[3]["face_down"] = False
                    activated_source[3]["activated_turn"] = next_state["turn"]
            else:
                raise DuelRuleError("Lá bài này chỉ được kích hoạt từ trên tay.")
        next_chain = next_state.setdefault(
            "chain",
            {
                "status": "closed",
                "links": [],
                "priority_player": None,
                "consecutive_passes": 0,
            },
        )
        if next_chain["status"] == "closed":
            next_chain["status"] = "open"
            next_chain["links"] = []
        else:
            if next_chain.get("priority_player") != player:
                raise DuelRuleError("Người chơi hiện không có quyền phản hồi Chain.")
            if not effect.can_chain:
                raise DuelRuleError("Hiệu ứng này không thể phản hồi Chain.")
            if effect.speed < max(link["speed"] for link in next_chain["links"]):
                raise DuelRuleError("Tốc độ hiệu ứng không cho phép phản hồi Chain này.")

        if source[1] == "spell_trap_zone" and source[3].get("category") == "trap":
            activated_source = find_card(next_state, source_instance_id)
            if activated_source:
                activated_source[3]["face_down"] = False

        if (
            self._is_spell_trap_card_activation(source)
            and self._has_opposing_rosewhip(next_state, player)
        ):
            next_state.setdefault("effect_uses", {})[
                f"{player}:m-naturia-rosewhip"
            ] = next_state["turn"]

        activated_copy_source = (
            find_card(next_state, source_instance_id)
            if card_id != source_card_id
            else None
        )
        if activated_copy_source:
            activated_copy_source[3]["card_id"] = card_id
        if effect.on_activate:
            effect.on_activate(next_state, context)
        if activated_copy_source:
            current_source = find_card(next_state, source_instance_id)
            if current_source:
                current_source[3]["card_id"] = source_card_id
        if next_state.get("over"):
            self._discard_activated_source(
                next_state,
                {"source_instance_id": source_instance_id},
                effect,
            )
            next_state["chain"] = {
                "status": "closed",
                "links": [],
                "priority_player": None,
                "consecutive_passes": 0,
            }
            return next_state
        link = {
            "player": player,
            "source_instance_id": source_instance_id,
            "card_id": card_id,
            "source_card_id": source_card_id,
            "effect_id": effect_id,
            "target_instance_ids": list(targets),
            "payload": dict(context.payload),
            "speed": effect.speed,
            "negated": False,
        }
        next_chain["links"].append(link)
        if (
            self._is_spell_trap_card_activation(source)
            and source[3].get("category") == "spell"
        ):
            for target_id in targets:
                target = find_card(next_state, target_id)
                if (
                    target
                    and target[1] == "monster_zone"
                    and target[3].get("card_id") == "m-big-shield-gardna"
                    and target[3].get("face_down", False)
                ):
                    target[3]["face_down"] = False
                    target[3]["position"] = "defense"
                    link["negated"] = True
        next_chain["priority_player"] = opponent_of(player)
        next_chain["consecutive_passes"] = 0
        return next_state

    @staticmethod
    def _target_is_valid(
        effect: EffectDefinition,
        state: Mapping[str, Any],
        target_id: str,
        context: EffectContext,
    ) -> bool:
        found = find_card(state, target_id)
        if not found:
            return False
        card = found[3]
        source = find_card(state, context.source_instance_id)
        # Kycoo không thể bị chọn làm mục tiêu bởi hiệu ứng quái thú Bóng Ma.
        if (
            found[1] == "monster_zone"
            and card.get("card_id") == "m-kycoo-the-ghost-destroyer"
            and not card.get("face_down")
            and not card.get("monster_effects_negated", False)
            and source
            and is_ghost_monster(source[3])
        ):
            return False
        if (
            found[1] == "monster_zone"
            and card.get("category") in {"monster", "fusion"}
            and not card.get("face_down")
            and is_dragon_card(card)
            and any(
                monster
                and monster.get("card_id") == "m-lord-of-d"
                and not monster.get("face_down")
                and not monster.get("monster_effects_negated", False)
                for player in PLAYER_IDS
                for monster in state["players"][player]["monster_zone"]
            )
        ):
            return False
        return effect.target_is_valid(state, target_id, context) if effect.target_is_valid else True

    def chain_response_options(
        self, state: Mapping[str, Any], player: str
    ) -> list[dict[str, Any]]:
        chain = state.get("chain", {})
        links = chain.get("links", [])
        if (
            player not in PLAYER_IDS
            or chain.get("status") != "open"
            or chain.get("priority_player") != player
            or not links
        ):
            return []

        minimum_speed = max(link["speed"] for link in links)
        used_sources = {
            link["source_instance_id"]
            for link in links
            if isinstance(link.get("source_instance_id"), str)
        }
        all_target_ids = [
            card["instance_id"]
            for side in PLAYER_IDS
            for zone in (
                "hand",
                "monster_zone",
                "spell_trap_zone",
                "graveyard",
                "banished",
            )
            if zone != "hand" or side == player
            for card in state["players"][side].get(zone, [])
            if card and isinstance(card.get("instance_id"), str)
        ]
        options = []
        seen_options = set()

        for zone in PLAYER_ZONES:
            for source in state["players"][player].get(zone, []):
                if not source or source.get("instance_id") in used_sources:
                    continue
                if zone == "hand" and source.get("category") == "spell":
                    continue
                if (
                    zone == "spell_trap_zone"
                    and source.get("category") == "spell"
                    and (
                        not source.get("face_down", False)
                        or source.get("set_turn") == state.get("turn")
                    )
                ):
                    continue
                card_id = source.get("clone_dragon_copied_card_id") or source.get(
                    "card_id"
                )
                if not isinstance(card_id, str):
                    continue
                validation_state = self._effect_validation_state(
                    state, source["instance_id"], card_id
                )
                for effect in self.registry.for_card(card_id):
                    if (
                        not effect.can_chain
                        or effect.effect_type == "trigger"
                        or zone not in effect.source_zones
                        or state.get("phase") not in effect.phases
                        or effect.speed < minimum_speed
                    ):
                        continue

                    if effect.requires_target:
                        if not effect.target_is_valid:
                            continue
                        target_sets = []
                        for target_id in all_target_ids:
                            context = self._context(
                                player,
                                source["instance_id"],
                                card_id,
                                effect.effect_id,
                                (target_id,),
                                {},
                            )
                            if effect.target_is_valid(
                                validation_state, target_id, context
                            ):
                                target_sets.append((target_id,))
                    else:
                        target_sets = [()]

                    for target_ids in target_sets:
                        try:
                            self.activate(
                                state,
                                player=player,
                                source_instance_id=source["instance_id"],
                                effect_id=effect.effect_id,
                                target_instance_ids=target_ids,
                            )
                        except DuelRuleError:
                            continue
                        option_key = (
                            source["instance_id"],
                            effect.effect_id,
                            target_ids,
                        )
                        if option_key in seen_options:
                            continue
                        seen_options.add(option_key)
                        options.append(
                            {
                                "source_instance_id": source["instance_id"],
                                "card_id": card_id,
                                "effect_id": effect.effect_id,
                                "target_instance_ids": list(target_ids),
                            }
                        )

        return options

    def pass_priority(
        self, state: Mapping[str, Any], *, player: str
    ) -> dict[str, Any]:
        chain = state.get("chain", {})
        if chain.get("status") != "open" or chain.get("priority_player") != player:
            raise DuelRuleError("Người chơi hiện không có quyền chuyền lượt Chain.")
        next_state = deepcopy(dict(state))
        next_chain = next_state["chain"]
        next_chain["consecutive_passes"] += 1
        if next_chain["consecutive_passes"] == 2:
            return self._resolve_chain(next_state)
        next_chain["priority_player"] = opponent_of(player)
        return next_state

    def _resolve_chain(self, state: dict[str, Any]) -> dict[str, Any]:
        chain = state["chain"]
        chain["status"] = "resolving"
        for link in reversed(chain["links"]):
            self._resolve_chain_link(state, link)
        state["chain"] = {
            "status": "closed",
            "links": [],
            "priority_player": None,
            "consecutive_passes": 0,
        }
        return state

    def _resolve_chain_link(
        self, state: dict[str, Any], link: Mapping[str, Any]
    ) -> None:
        effect = self.registry.get(link["card_id"], link["effect_id"])
        source = find_card(state, link["source_instance_id"])
        source_card_id = link.get(
            "source_card_id",
            source[3].get("card_id") if source else None,
        )
        is_clone_dragon_copy = (
            source_card_id == CLONE_DRAGON_ID
            and link["card_id"] != CLONE_DRAGON_ID
        )
        if source and is_clone_dragon_copy:
            source[3]["card_id"] = link["card_id"]
        try:
            if (
                source
                and source[3].get("category") == "trap"
                and trap_effect_is_negated(state, link["player"])
            ):
                self._discard_activated_source(state, link, effect)
                return
            if (
                source
                and source[1] == "monster_zone"
                and source[3].get("category") in {"monster", "fusion"}
                and source[3].get("monster_effects_negated", False)
            ):
                return
            if link["negated"]:
                self._discard_activated_source(state, link, effect)
                return
            targets = tuple(
                target_id
                for target_id in link["target_instance_ids"]
                if self._target_is_valid(
                    effect,
                    state,
                    target_id,
                    self._context(
                        link["player"],
                        link["source_instance_id"],
                        link["card_id"],
                        link["effect_id"],
                        tuple(link["target_instance_ids"]),
                        link["payload"],
                    ),
                )
            )
            if effect.requires_target and not targets:
                self._discard_activated_source(state, link, effect)
                return
            context = self._context(
                link["player"],
                link["source_instance_id"],
                link["card_id"],
                link["effect_id"],
                targets,
                link["payload"],
            )
            effect.resolve(state, context)
            if effect.discard_source_after_resolution:
                self._discard_activated_source(state, link, effect)
        finally:
            if is_clone_dragon_copy:
                current_source = find_card(state, link["source_instance_id"])
                if current_source:
                    current_source[3]["card_id"] = CLONE_DRAGON_ID

    @staticmethod
    def _discard_activated_source(
        state: dict[str, Any],
        link: Mapping[str, Any],
        effect: EffectDefinition,
    ) -> None:
        if not (
            effect.move_source_on_activation
            or effect.discard_source_after_resolution
        ):
            return
        source = find_card(state, link["source_instance_id"])
        if source and source[1] == "spell_trap_zone":
            move_card(state, source[3]["instance_id"], source[3]["owner"], "graveyard")


def negate_chain_link(state: dict[str, Any], link_index: int) -> None:
    """Mark a Chain Link negated; intended for validated effect resolvers."""
    chain = state.get("chain", {})
    links = chain.get("links", [])
    if chain.get("status") != "resolving" or not 0 <= link_index < len(links):
        raise DuelRuleError("Chain Link cần vô hiệu hóa không hợp lệ.")
    state["chain"]["links"][link_index]["negated"] = True


def apply_slifer_thunderforce(
    state: dict[str, Any], summoned_player: str, monster_instance_id: str
) -> tuple[bool, bool]:
    """Apply Slifer's Thunderforce ATK/DEF reduction and record trigger details.

    Returns (triggered, still_on_field).
    """
    found = find_card(state, monster_instance_id)
    if (
        not found
        or found[0] != summoned_player
        or found[1] != "monster_zone"
        or found[3].get("face_down", False)
    ):
        return False, True

    slifer_player = opponent_of(summoned_player)
    slifer = next(
        (
            card
            for card in state["players"][slifer_player]["monster_zone"]
            if card
            and card.get("card_id") == "m-slifer-the-sky-dragon"
            and not card.get("face_down", False)
            and not monster_effects_are_negated(state, card["instance_id"])
        ),
        None,
    )
    if (
        not slifer
        or state.get("effect_protection", {}).get(summoned_player) == state["turn"]
    ):
        return False, True

    zone_index = found[2]
    monster = found[3]
    pre_stats = current_stats(state, monster_instance_id)
    pre_monster = deepcopy(monster)
    pre_monster["atk"] = pre_stats["atk"]
    pre_monster["def"] = pre_stats["def"]
    pre_monster["current_atk"] = pre_stats["atk"]
    pre_monster["current_def"] = pre_stats["def"]

    stat = "def" if monster.get("position") == "defense" else "atk"
    updated = add_stat_modifier(
        state,
        target_instance_id=monster_instance_id,
        source_instance_id=slifer["instance_id"],
        source_card_id="m-slifer-the-sky-dragon",
        owner=slifer_player,
        stat=stat,
        operation="decrease",
        value=2000,
        duration={"type": "target_leaves_field"},
    )
    state.clear()
    state.update(updated)

    post_stats = current_stats(state, monster_instance_id)
    destroyed = False
    if post_stats[stat] == 0:
        destroyed_card = destroy_card(
            state, monster_instance_id, by_player=slifer_player
        )
        destroyed = destroyed_card is not None

    seq = int(state.get("slifer_trigger_seq") or 0) + 1
    state["slifer_trigger_seq"] = seq
    triggers = state.setdefault("last_slifer_triggers", [])
    triggers.append(
        {
            "seq": seq,
            "slifer_player": slifer_player,
            "slifer_instance_id": slifer["instance_id"],
            "target_player": summoned_player,
            "target_instance_id": monster_instance_id,
            "target_zone_index": zone_index,
            "stat": stat,
            "pre_atk": pre_stats["atk"],
            "pre_def": pre_stats["def"],
            "post_atk": post_stats["atk"],
            "post_def": post_stats["def"],
            "destroyed": destroyed,
            "monster": pre_monster,
        }
    )
    if len(triggers) > 8:
        del triggers[:-8]
    return True, not destroyed
