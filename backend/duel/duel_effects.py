"""Card-ID keyed implementations of effects currently supported by the duel UI."""

from __future__ import annotations

import random
from copy import deepcopy
from collections.abc import Callable, Mapping
from typing import Any
from uuid import uuid4

from .duel_engine import (
    DuelEffectEngine,
    DuelRuleError,
    EffectContext,
    EffectDefinition,
    EffectRegistry,
    add_stat_modifier,
    apply_slifer_thunderforce,
    change_life_points,
    check_win_by_exodia as _engine_check_win_by_exodia,
    CRUSH_CARD_VIRUS_GY_LOCK,
    CLONE_DRAGON_ID,
    current_stats,
    destroy_card,
    draw_cards,
    find_card,
    has_face_up_jinzo,
    move_card,
    negate_chain_link,
    monster_effects_are_negated,
    opponent_of,
    QUICK_SPELL_IDS,
    trap_effect_is_negated,
    is_dragon_card as _is_dragon,
)


MAIN_PHASES = frozenset({"main1", "main2"})
GANDORA_ID = "m-gandora-the-dragon-of-destruction"
VALKYRION_ID = "m-valkyrion-the-magna-warrior"
CHAOS_EMPEROR_ID = "m-chaos-emperor-dragon-envoy-of-the-end"
CHAOS_LEVIANEER_ID = "m-chaos-dragon-levianeer"
CRASS_CLOWN_ID = "m-crass-clown"
CLONING_TRAP_ID = "t-cloning"
CRUSH_CARD_VIRUS_ID = "t-crush-card-virus"
FIELD_SELECTION_RULES = {
    "m-mobius-the-frost-monarch": {
        "min_count": 0,
        "max_count": 2,
        "target_mode": "field-spell-trap",
        "zones": frozenset({"spell_trap_zone"}),
        "categories": frozenset({"spell", "trap"}),
        "operation": "destroy",
    },
    "m-caius-the-shadow-monarch": {
        "min_count": 1,
        "max_count": 1,
        "target_mode": "field-card",
        "zones": frozenset({"monster_zone", "spell_trap_zone"}),
        "categories": frozenset({"monster", "fusion", "spell", "trap"}),
        "target_owner": "opponent",
        "operation": "banish",
    },
    "m-ryko-lightsworn-hunter": {
        "min_count": 1,
        "max_count": 1,
        "target_mode": "field-card-any",
        "zones": frozenset({"monster_zone", "spell_trap_zone"}),
        "categories": frozenset({"monster", "fusion", "spell", "trap"}),
        "source_zones": frozenset({"monster_zone", "graveyard"}),
        "operation": "destroy_and_mill",
    },
    "m-crass-clown": {
        "min_count": 1,
        "max_count": 1,
        "target_mode": "field-opponent-monster",
        "zones": frozenset({"monster_zone"}),
        "categories": frozenset({"monster", "fusion"}),
        "target_owner": "opponent",
        "operation": "return_to_hand",
    },
    "m-odd-eyes-advance-dragon": {
        "min_count": 1,
        "max_count": 1,
        "target_mode": "field-opponent-monster",
        "zones": frozenset({"monster_zone"}),
        "categories": frozenset({"monster", "fusion"}),
        "target_owner": "opponent",
        "operation": "destroy",
        "source_zones": frozenset({"monster_zone"}),
    },
    "m-night-assailant": {
        "min_count": 1,
        "max_count": 1,
        "target_mode": "field-opponent-monster",
        "zones": frozenset({"monster_zone"}),
        "categories": frozenset({"monster", "fusion"}),
        "target_owner": "opponent",
        "operation": "destroy",
        "source_zones": frozenset({"monster_zone"}),
    },
    "m-blue-eyes-solid-dragon": {
        "min_count": 1,
        "max_count": 1,
        "target_mode": "field-opponent-monster",
        "zones": frozenset({"monster_zone"}),
        "categories": frozenset({"monster", "fusion"}),
        "target_owner": "opponent",
        "face_up": True,
        "operation": "negate_effects",
        "source_zones": frozenset({"monster_zone"}),
    },
    "s-magical-dimension": {
        "min_count": 0,
        "max_count": 1,
        "target_mode": "field-opponent-monster",
        "zones": frozenset({"monster_zone"}),
        "categories": frozenset({"monster", "fusion"}),
        "target_owner": "opponent",
        "operation": "destroy",
        "source_zones": frozenset({"spell_trap_zone"}),
    },
    "s-dicephoon": {
        "min_count": 1,
        "max_count": 2,
        "target_mode": "field-spell-trap",
        "zones": frozenset({"spell_trap_zone"}),
        "categories": frozenset({"spell", "trap"}),
        "operation": "destroy",
        "source_zones": frozenset({"spell_trap_zone"}),
    },
    "s-twin-twisters": {
        "min_count": 1,
        "max_count": 2,
        "target_mode": "field-opponent-spell-trap",
        "zones": frozenset({"spell_trap_zone"}),
        "categories": frozenset({"spell", "trap"}),
        "target_owner": "opponent",
        "source_zones": frozenset({"spell_trap_zone"}),
        "operation": "destroy",
    },
}
SPELL_RECOVERY_RULES = {
    "s-spell-reproduction": {
        "discard_category": "spell",
        "target_category": "spell",
        "target_mode": "grave-own-spell",
    },
    "s-magical-stone-excavation": {
        "discard_category": None,
        "target_category": None,
        "target_mode": "grave-own-any",
    },
}
EQUIP_SPELL_IDS = frozenset(
    {
        "s-horn-of-the-unicorn",
        "s-magic-formula",
        "s-butterfly-dagger-elma",
        "s-mask-of-the-accursed",
        "s-sword-of-deep-seated",
    }
)
EffectAction = Callable[[dict[str, Any], EffectContext], None]


def _replace_state(state: dict[str, Any], replacement: Mapping[str, Any]) -> None:
    state.clear()
    state.update(replacement)


def apply_draw_triggers(state: dict[str, Any], player: str, drawn_count: int) -> None:
    if player not in {"player", "ai"}:
        raise DuelRuleError("Người chơi không hợp lệ.")
    if drawn_count <= 0 or state.get("over"):
        return
    has_solemn_wishes = any(
        card
        and card.get("card_id") == "t-solemn-wishes"
        and not card.get("face_down", False)
        and not trap_effect_is_negated(state, player)
        for card in _cards(state, player, "spell_trap_zone")
    )
    if has_solemn_wishes:
        change_life_points(state, player, 500)


def _cards(state: Mapping[str, Any], player: str, zone: str) -> list[Any]:
    return state["players"][player][zone]


def _is_union_equipped_spell(card: Mapping[str, Any]) -> bool:
    return bool(
        card.get("card_id") == "m-y-dragon-head"
        and card.get("union_equipped")
    )


def _face_up_monster(state: Mapping[str, Any], player: str, card_id: str) -> bool:
    return any(
        card
        and card.get("card_id") == card_id
        and not card.get("face_down", False)
        for card in _cards(state, player, "monster_zone")
    )


def _is_spellcaster(card: Mapping[str, Any]) -> bool:
    race = str(card.get("race") or card.get("monsterType") or "").lower()
    return "spellcaster" in race or "phù thủy" in race


def _can_be_special_summoned(card: Mapping[str, Any]) -> bool:
    if card.get("card_id") == GANDORA_ID:
        return False
    return (
        not card.get(CRUSH_CARD_VIRUS_GY_LOCK)
        and (
            card.get("card_id")
            not in {VALKYRION_ID, CHAOS_EMPEROR_ID, CHAOS_LEVIANEER_ID}
            or card.get("properly_summoned", False)
        )
    )


def _level(card: Mapping[str, Any]) -> int:
    try:
        return int(card.get("level", card.get("lv", 0)))
    except (TypeError, ValueError):
        return 0


def _move_to_grave(state: dict[str, Any], instance_id: str) -> None:
    found = find_card(state, instance_id)
    if found and found[1] in {"monster_zone", "spell_trap_zone"}:
        move_card(state, instance_id, found[3]["owner"], "graveyard")


def _record_dice_roll(
    state: dict[str, Any], context: EffectContext, value: int
) -> None:
    seq = int(state.get("dice_roll_seq", 0)) + 1
    state["dice_roll_seq"] = seq
    state["last_dice_roll"] = {
        "seq": seq,
        "value": int(value),
        "card_id": context.card_id,
        "player": context.player,
        "source_instance_id": context.source_instance_id,
    }


def _apply_dice_stat_modifier(
    state: dict[str, Any],
    context: EffectContext,
    controller: str,
    operation: str,
    rng: Callable[[], float],
) -> None:
    value = int(rng() * 6) + 1
    _record_dice_roll(state, context, value)
    for monster in _cards(state, controller, "monster_zone"):
        if not monster or monster.get("category") not in {"monster", "fusion"}:
            continue
        for stat in ("atk", "def"):
            updated = add_stat_modifier(
                state,
                target_instance_id=monster["instance_id"],
                source_instance_id=context.source_instance_id,
                source_card_id=context.card_id,
                owner=context.player,
                stat=stat,
                operation=operation,
                value=value,
                duration={"type": "turn_end"},
            )
            _replace_state(state, updated)


def _return_monster_to_controller_hand(
    state: dict[str, Any], controller: str, monster: dict[str, Any]
) -> None:
    """Return a monster to its current controller's hand and transfer permanent ownership."""
    monster["owner"] = controller
    monster.pop("temporary_control", None)
    move_card(state, monster["instance_id"], controller, "hand")


def _finish_spell(
    state: dict[str, Any], context: EffectContext, *, keep_on_field: bool = False
) -> None:
    source = find_card(state, context.source_instance_id)
    if not source or source[1] != "spell_trap_zone":
        return
    if keep_on_field:
        source[3]["face_down"] = False
    else:
        _move_to_grave(state, context.source_instance_id)


def _draw(state: dict[str, Any], player: str, count: int) -> int:
    if count <= 0 or state.get("over"):
        return 0
    next_state, drawn = draw_cards(state, player, count)
    _replace_state(state, next_state)
    apply_draw_triggers(state, player, len(drawn))
    return len(drawn)


def _mill_top_cards(state: dict[str, Any], player: str, count: int) -> None:
    deck = _cards(state, player, "deck")
    for _ in range(min(count, len(deck))):
        move_card(state, deck[-1]["instance_id"], player, "graveyard")


def _shuffle(cards: list[dict[str, Any]], rng: Callable[[], float]) -> None:
    for index in range(len(cards) - 1, 0, -1):
        swap_index = int(rng() * (index + 1))
        cards[index], cards[swap_index] = cards[swap_index], cards[index]


def _target(state: Mapping[str, Any], context: EffectContext) -> tuple[str, str, int, dict[str, Any]]:
    if not context.target_instance_ids:
        raise DuelRuleError("Hiệu ứng này cần chọn mục tiêu.")
    found = find_card(state, context.target_instance_ids[0])
    if not found:
        raise DuelRuleError("Mục tiêu hiệu ứng không còn hợp lệ.")
    return found


def _target_in_zone(
    state: Mapping[str, Any],
    target_id: str,
    zones: frozenset[str],
    *,
    owner: str | None = None,
    category: str | None = None,
    face_up: bool | None = None,
) -> bool:
    found = find_card(state, target_id)
    if not found or found[1] not in zones:
        return False
    if owner is not None and found[0] != owner:
        return False
    card = found[3]
    if category is not None and card.get("category") != category:
        if not (
            found[1] == "spell_trap_zone"
            and _is_union_equipped_spell(card)
            and category in {"spell", "trap"}
        ):
            return False
    if face_up is not None and (not card.get("face_down", False)) != face_up:
        return False
    return True


def _special_summon_target_in_zone(
    state: Mapping[str, Any],
    target_id: str,
    zones: frozenset[str],
    *,
    owner: str | None = None,
) -> bool:
    target = find_card(state, target_id)
    return bool(
        target
        and target[1] in zones
        and (owner is None or target[0] == owner)
        and target[3].get("category") == "monster"
        and _can_be_special_summoned(target[3])
    )


def _empty_monster_zone(state: Mapping[str, Any], player: str) -> int | None:
    return next(
        (
            index
            for index, card in enumerate(_cards(state, player, "monster_zone"))
            if card is None
        ),
        None,
    )


def _empty_spell_trap_zone(state: Mapping[str, Any], player: str) -> int | None:
    return next(
        (
            index
            for index, card in enumerate(_cards(state, player, "spell_trap_zone"))
            if card is None
        ),
        None,
    )


def _queue_cloning_triggers(
    state: dict[str, Any],
    summoned_player: str,
    monster_instance_id: str,
    summon_method: str,
) -> None:
    if summon_method not in {"normal", "tribute", "special"}:
        return
    summoned = find_card(state, monster_instance_id)
    if (
        not summoned
        or summoned[1] != "monster_zone"
        or summoned[3].get("face_down", False)
        or summoned[0] != summoned_player
    ):
        return
    trap_owner = opponent_of(summoned_player)
    pending_triggers = state.setdefault("pending_card_triggers", [])
    for trap in _cards(state, trap_owner, "spell_trap_zone"):
        if (
            trap
            and trap.get("card_id") == CLONING_TRAP_ID
            and trap.get("face_down", False)
            and int(trap.get("set_turn", state["turn"])) < state["turn"]
            and not any(
                trigger.get("card_id") == CLONING_TRAP_ID
                and trigger.get("source_instance_id") == trap["instance_id"]
                and trigger.get("summoned_instance_id") == monster_instance_id
                for trigger in pending_triggers
            )
        ):
            pending_triggers.append(
                {
                    "card_id": CLONING_TRAP_ID,
                    "source_instance_id": trap["instance_id"],
                    "player": trap_owner,
                    "summoned_instance_id": monster_instance_id,
                }
            )


def _special_summon(
    state: dict[str, Any],
    player: str,
    instance_id: str,
    *,
    position: str = "attack",
    allow_fusion: bool = False,
) -> bool:
    zone_index = _empty_monster_zone(state, player)
    found = find_card(state, instance_id)
    if (
        zone_index is None
        or not found
        or (
            found[3].get("category") != "monster"
            and not (allow_fusion and found[3].get("category") == "fusion")
        )
        or not _can_be_special_summoned(found[3])
    ):
        return False
    move_card(
        state,
        instance_id,
        player,
        "monster_zone",
        destination_index=zone_index,
    )
    monster = _cards(state, player, "monster_zone")[zone_index]
    monster["face_down"] = False
    active_jar_owners = [
        side
        for side in ("player", "ai")
        for trap in _cards(state, side, "spell_trap_zone")
        if trap
        and trap.get("card_id") == "t-dragon-capture-jar"
        and not trap.get("face_down", False)
        and not trap_effect_is_negated(state, side)
    ]
    jar_applies = any(
        side == player
        or state.get("effect_protection", {}).get(player) != state["turn"]
        for side in active_jar_owners
    )
    monster["position"] = (
        "defense"
        if jar_applies and _is_dragon(monster)
        else position
    )
    monster["summon_method"] = "special"
    monster["summoned_turn"] = state["turn"]
    triggered, still_on_field = apply_slifer_thunderforce(
        state, player, instance_id
    )
    if triggered and not still_on_field:
        return False
    if not triggered and find_card(state, instance_id):
        resolve_monster_summon_effects(state, player, instance_id, "special")
    elif triggered and still_on_field and current_stats(state, instance_id)["atk" if monster["position"] != "defense" else "def"] > 0 and find_card(state, instance_id):
        resolve_monster_summon_effects(state, player, instance_id, "special")
    return True


MAIDEN_ID = "m-maiden-with-eyes-of-blue"
BLUE_EYES_WHITE_DRAGON_ID = "m-blue-eyes-white-dragon"
MANA_ID = "m-palladium-oracle-mana"
DARK_MAGICIAN_GIRL_ID = "m-dark-magician-girl"


def _maiden_blue_eyes_candidates(
    state: Mapping[str, Any], player: str
) -> list[tuple[str, dict[str, Any]]]:
    return [
        (zone, card)
        for zone in ("deck", "hand", "graveyard")
        for card in _cards(state, player, zone)
        if card.get("card_id") == BLUE_EYES_WHITE_DRAGON_ID
        and _can_be_special_summoned(card)
    ]


def _queue_maiden_summon_selection(
    state: dict[str, Any],
    player: str,
    source_instance_id: str,
    effect_id: str,
    *,
    min_count: int,
) -> bool:
    candidates = _maiden_blue_eyes_candidates(state, player)
    if not candidates or _empty_monster_zone(state, player) is None:
        return False
    state["pending_decision"] = {
        "type": "select_blue_eyes_summon",
        "player": player,
        "source_instance_id": source_instance_id,
        "effect_card_id": MAIDEN_ID,
        "effect_id": effect_id,
        "min_count": min_count,
        "max_count": 1,
        "target_mode": "hand-deck-grave-blue-eyes",
        "eligible_target_instance_ids": [
            card["instance_id"] for _, card in candidates
        ],
        "eligible_cards": [
            {
                "instance_id": card["instance_id"],
                "card_id": card["card_id"],
                "name": card.get("name", card["card_id"]),
                "zone": zone,
            }
            for zone, card in candidates
        ],
    }
    return True


def _destroy_monsters(state: dict[str, Any], owner: str, effect_player: str) -> None:
    if (
        effect_player != owner
        and state.get("effect_protection", {}).get(owner) == state["turn"]
    ):
        return
    for card in list(_cards(state, owner, "monster_zone")):
        if card:
            destroy_card(state, card["instance_id"], by_player=effect_player)


def _is_protected(
    state: Mapping[str, Any], owner: str, effect_player: str
) -> bool:
    return (
        owner != effect_player
        and state.get("effect_protection", {}).get(owner) == state["turn"]
    )


def _destroy_backrow(state: dict[str, Any], owner: str) -> None:
    for card in list(_cards(state, owner, "spell_trap_zone")):
        if card:
            destroy_card(state, card["instance_id"])


def _condition_face_up(state: Mapping[str, Any], context: EffectContext, card_id: str) -> bool:
    if _face_up_monster(state, context.player, card_id):
        return True
    return bool(
        card_id == "m-blue-eyes-white-dragon"
        and any(
            card
            and card.get("card_id") == "m-blue-eyes-alternative-white-dragon"
            and not card.get("face_down", False)
            and not card.get("monster_effects_negated", False)
            for card in _cards(state, context.player, "monster_zone")
        )
    )


def _can_activate_set_trap(state: Mapping[str, Any], context: EffectContext) -> bool:
    source = find_card(state, context.source_instance_id)
    return bool(
        source
        and source[1] == "spell_trap_zone"
        and source[3].get("face_down", False)
        and source[3].get("set_turn", 0) < state["turn"]
    )


def _is_crush_card_virus_attack_target(
    state: Mapping[str, Any], player: str, target_instance_id: Any
) -> bool:
    target = (
        find_card(state, target_instance_id)
        if isinstance(target_instance_id, str)
        else None
    )
    return bool(
        target
        and target[0] == player
        and target[1] == "monster_zone"
        and target[3].get("category") in {"monster", "fusion"}
        and str(target[3].get("attribute") or "").upper() == "DARK"
        and current_stats(state, target[3]["instance_id"])["atk"] < 1000
    )


def _is_battle_locked_by_trap(
    state: Mapping[str, Any], player: str, monster_instance_id: str
) -> bool:
    return any(
        trap
        and not trap.get("face_down", False)
        and trap.get("card_id")
        in {
            "t-spellbinding-circle",
            "t-shadow-spell",
            "t-nightmare-wheel",
        }
        and trap.get("target_instance_id") == monster_instance_id
        and not trap_effect_is_negated(state, owner)
        for owner in ("player", "ai")
        for trap in _cards(state, owner, "spell_trap_zone")
    )


def _is_prevented_from_attacking(
    state: Mapping[str, Any], monster_instance_id: str
) -> bool:
    return any(
        card
        and not card.get("face_down", False)
        and card.get("card_id") == "s-mask-of-the-accursed"
        and card.get("target_instance_id") == monster_instance_id
        and (
            card.get("category") != "trap"
            or not trap_effect_is_negated(state, owner)
        )
        for owner in ("player", "ai")
        for card in _cards(state, owner, "spell_trap_zone")
    )


def _trap_definition(
    card_id: str,
    resolver: EffectAction,
    *,
    target_validator: Callable[[Mapping[str, Any], str, EffectContext], bool] | None = None,
    requires_target: bool = False,
    phases: frozenset[str] = frozenset({"draw", "standby", "main1", "battle", "main2", "end"}),
    can_activate: Callable[[Mapping[str, Any], EffectContext], bool] | None = None,
    on_activate: Callable[[dict[str, Any], EffectContext], None] | None = None,
    can_chain: bool = True,
) -> EffectDefinition:
    def resolve(state: dict[str, Any], context: EffectContext) -> None:
        source = find_card(state, context.source_instance_id)
        if source and source[1] == "spell_trap_zone":
            source[3]["face_down"] = False
        resolver(state, context)

    return EffectDefinition(
        card_id=card_id,
        effect_id="activate",
        effect_type="activated",
        speed=2,
        resolve=resolve,
        can_activate=can_activate or _can_activate_set_trap,
        on_activate=on_activate,
        target_is_valid=target_validator,
        source_zones=frozenset({"spell_trap_zone"}),
        phases=phases,
        requires_target=requires_target,
        can_chain=can_chain,
    )


def _spell_definition(
    card_id: str,
    action: EffectAction,
    *,
    condition: Callable[[Mapping[str, Any], EffectContext], bool] | None = None,
    on_activate: Callable[[dict[str, Any], EffectContext], None] | None = None,
    target_validator: Callable[[Mapping[str, Any], str, EffectContext], bool] | None = None,
    requires_target: bool = False,
    keep_on_field: bool = False,
    destination_zone: str = "spell_trap_zone",
) -> EffectDefinition:
    is_quick = card_id in QUICK_SPELL_IDS
    quick_phases = frozenset({"draw", "standby", "main1", "battle", "main2", "end"})

    def resolve(state: dict[str, Any], context: EffectContext) -> None:
        action(state, context)
        if not state.get("pending_decision"):
            _finish_spell(state, context, keep_on_field=keep_on_field)

    return EffectDefinition(
        card_id=card_id,
        effect_id="activate",
        effect_type="activated",
        speed=2 if is_quick else 1,
        resolve=resolve,
        can_activate=condition,
        on_activate=on_activate,
        target_is_valid=target_validator,
        source_zones=(
            frozenset({"hand", "spell_trap_zone"})
            if is_quick
            else frozenset({"hand"})
        ),
        phases=quick_phases if is_quick else MAIN_PHASES,
        requires_target=requires_target,
        can_chain=is_quick,
        move_source_on_activation=True,
        destination_zone=destination_zone,
    )


def build_effect_registry(
    random_source: Callable[[], float] | None = None,
) -> EffectRegistry:
    """Build the backend registry for effects already implemented in duelEffects.js."""
    rng = random_source or random.SystemRandom().random
    registry = EffectRegistry()

    def spell(
        card_id: str,
        action: EffectAction,
        **options: Any,
    ) -> None:
        registry.register(
            _spell_definition(card_id, action, **options)
        )

    def plain(
        card_id: str,
        action: EffectAction,
        *,
        keep: bool = False,
        condition: EffectCondition | None = None,
        destination_zone: str = "spell_trap_zone",
    ) -> None:
        spell(
            card_id,
            action,
            keep_on_field=keep,
            condition=condition,
            destination_zone=destination_zone,
        )

    # Phù Thủy Thời Gian: mặt có hình phá quái thú đối thủ, mặt kia phá quái thú của mình.
    def time_wizard_condition(
        state: Mapping[str, Any], context: EffectContext
    ) -> bool:
        source = find_card(state, context.source_instance_id)
        usage_key = f"{context.source_instance_id}:m-time-wizard"
        return bool(
            source
            and source[1] == "monster_zone"
            and not source[3].get("face_down", False)
            and state.get("effect_uses", {}).get(usage_key) != state["turn"]
        )

    def mark_time_wizard_use(
        state: dict[str, Any], context: EffectContext
    ) -> None:
        state.setdefault("effect_uses", {})[
            f"{context.source_instance_id}:m-time-wizard"
        ] = state["turn"]

    def time_wizard(state: dict[str, Any], context: EffectContext) -> None:
        coin_has_picture = rng() < 0.5
        if coin_has_picture:
            _destroy_monsters(state, opponent_of(context.player), context.player)
            return

        damage_basis = 0
        for monster in list(_cards(state, context.player, "monster_zone")):
            if not monster:
                continue
            face_up = not monster.get("face_down", False)
            atk = (
                current_stats(state, monster["instance_id"])["atk"]
                if face_up
                else 0
            )
            destroyed = destroy_card(
                state,
                monster["instance_id"],
                by_player=context.player,
            )
            if destroyed and face_up:
                damage_basis += atk
        if damage_basis:
            change_life_points(state, context.player, -(damage_basis // 2))

    registry.register(
        EffectDefinition(
            card_id="m-time-wizard",
            effect_id="activate",
            effect_type="activated",
            speed=1,
            resolve=time_wizard,
            can_activate=time_wizard_condition,
            on_activate=mark_time_wizard_use,
            source_zones=frozenset({"monster_zone"}),
            phases=MAIN_PHASES,
        )
    )

    def blue_eyes_alternative_condition(
        state: Mapping[str, Any], context: EffectContext
    ) -> bool:
        source = find_card(state, context.source_instance_id)
        usage_key = f"{context.source_instance_id}:m-blue-eyes-alternative-white-dragon"
        return bool(
            source
            and source[1] == "monster_zone"
            and not source[3].get("face_down", False)
            and state.get("effect_uses", {}).get(usage_key) != state["turn"]
        )

    def blue_eyes_alternative_target_is_valid(
        state: Mapping[str, Any],
        target_id: str,
        context: EffectContext,
    ) -> bool:
        target = find_card(state, target_id)
        return bool(
            target
            and target[0] == opponent_of(context.player)
            and target[1] == "monster_zone"
            and target[3].get("category") in {"monster", "fusion"}
        )

    def blue_eyes_alternative(state: dict[str, Any], context: EffectContext) -> None:
        target = find_card(state, context.target_instance_ids[0])
        if (
            target
            and target[1] == "monster_zone"
            and not _is_protected(state, target[0], context.player)
        ):
            destroy_card(state, target[3]["instance_id"], by_player=context.player)
        source = find_card(state, context.source_instance_id)
        if source and source[1] == "monster_zone":
            source[3]["cannot_attack_turn"] = state["turn"]

    def mark_blue_eyes_alternative_use(
        state: dict[str, Any], context: EffectContext
    ) -> None:
        state.setdefault("effect_uses", {})[
            f"{context.source_instance_id}:m-blue-eyes-alternative-white-dragon"
        ] = state["turn"]

    # Rồng Trắng Mắt Xanh Thay Thế: mỗi lượt một lần phá quái thú đối thủ và không thể tấn công lượt đó.
    registry.register(
        EffectDefinition(
            card_id="m-blue-eyes-alternative-white-dragon",
            effect_id="activate",
            effect_type="activated",
            speed=1,
            resolve=blue_eyes_alternative,
            can_activate=blue_eyes_alternative_condition,
            on_activate=mark_blue_eyes_alternative_use,
            target_is_valid=blue_eyes_alternative_target_is_valid,
            source_zones=frozenset({"monster_zone"}),
            phases=MAIN_PHASES,
            requires_target=True,
        )
    )

    def black_luster_soldier_condition(
        state: Mapping[str, Any], context: EffectContext
    ) -> bool:
        source = find_card(state, context.source_instance_id)
        usage_key = f"{context.player}:{context.source_instance_id}:black-luster-choice"
        return bool(
            source
            and source[1] == "monster_zone"
            and not source[3].get("face_down", False)
            and not monster_effects_are_negated(state, context.source_instance_id)
            and state.get("effect_uses", {}).get(usage_key) != state["turn"]
        )

    def black_luster_soldier_target_is_valid(
        state: Mapping[str, Any],
        target_id: str,
        context: EffectContext,
    ) -> bool:
        target = find_card(state, target_id)
        return bool(
            target
            and target[1] == "monster_zone"
            and target[3].get("category") in {"monster", "fusion"}
        )

    def mark_black_luster_soldier_use(
        state: dict[str, Any], context: EffectContext
    ) -> None:
        state.setdefault("effect_uses", {})[
            f"{context.player}:{context.source_instance_id}:black-luster-choice"
        ] = state["turn"]
        source = find_card(state, context.source_instance_id)
        if source and source[1] == "monster_zone":
            source[3]["cannot_attack_turn"] = state["turn"]

    def banish_black_luster_soldier_target(
        state: dict[str, Any], context: EffectContext
    ) -> None:
        target = find_card(state, context.target_instance_ids[0])
        if target and target[1] == "monster_zone":
            move_card(
                state,
                context.target_instance_ids[0],
                target[0],
                "banished",
            )

    registry.register(
        EffectDefinition(
            card_id="m-black-luster-soldier-envoy-of-the-beginning",
            effect_id="banish_monster",
            effect_type="activated",
            speed=1,
            resolve=banish_black_luster_soldier_target,
            can_activate=black_luster_soldier_condition,
            on_activate=mark_black_luster_soldier_use,
            target_is_valid=black_luster_soldier_target_is_valid,
            source_zones=frozenset({"monster_zone"}),
            phases=MAIN_PHASES,
            requires_target=True,
        )
    )

    def mana_quick_summon_condition(
        state: Mapping[str, Any], context: EffectContext
    ) -> bool:
        source = find_card(state, context.source_instance_id)
        chain = state.get("chain", {})
        links = chain.get("links", [])
        return bool(
            source
            and source[0] == context.player
            and source[1] == "hand"
            and source[3].get("card_id") == MANA_ID
            and _empty_monster_zone(state, context.player) is not None
            and chain.get("status") == "open"
            and chain.get("priority_player") == context.player
            and links
            and links[-1].get("player") == opponent_of(context.player)
        )

    def mana_quick_summon(
        state: dict[str, Any], context: EffectContext
    ) -> None:
        _special_summon(state, context.player, context.source_instance_id)

    registry.register(
        EffectDefinition(
            card_id=MANA_ID,
            effect_id="quick_summon",
            effect_type="quick",
            speed=2,
            resolve=mana_quick_summon,
            can_activate=mana_quick_summon_condition,
            source_zones=frozenset({"hand"}),
            can_chain=True,
        )
    )

    def maiden_quick_can_activate(
        state: Mapping[str, Any], context: EffectContext
    ) -> bool:
        source = find_card(state, context.source_instance_id)
        chain = state.get("chain", {})
        links = chain.get("links", [])
        if (
            not source
            or source[0] != context.player
            or source[1] != "monster_zone"
            or source[3].get("card_id") != MAIDEN_ID
            or source[3].get("face_down", False)
            or monster_effects_are_negated(state, context.source_instance_id)
            or state.get("effect_uses", {}).get(
                f"{context.player}:{MAIDEN_ID}"
            ) == state["turn"]
            or chain.get("status") != "open"
            or chain.get("priority_player") != context.player
            or not links
        ):
            return False
        previous_link = links[-1]
        return bool(
            previous_link.get("player") == opponent_of(context.player)
            and context.source_instance_id
            in previous_link.get("target_instance_ids", [])
            and _empty_monster_zone(state, context.player) is not None
            and _maiden_blue_eyes_candidates(state, context.player)
        )

    def mark_maiden_quick_use(
        state: dict[str, Any], context: EffectContext
    ) -> None:
        state.setdefault("effect_uses", {})[
            f"{context.player}:{MAIDEN_ID}"
        ] = state["turn"]

    def maiden_quick_summon(
        state: dict[str, Any], context: EffectContext
    ) -> None:
        chain_links = state.get("chain", {}).get("links", [])
        maiden_link_index = next(
            (
                index
                for index, link in enumerate(chain_links)
                if link.get("source_instance_id") == context.source_instance_id
                and link.get("effect_id") == context.effect_id
            ),
            None,
        )
        if maiden_link_index is None or maiden_link_index == 0:
            raise DuelRuleError("Không tìm thấy Chain Link được Thiếu Nữ Mắt Xanh phản hồi.")
        targeted_link_index = maiden_link_index - 1
        targeted_link = chain_links[targeted_link_index]
        if (
            targeted_link.get("player") != opponent_of(context.player)
            or context.source_instance_id
            not in targeted_link.get("target_instance_ids", [])
        ):
            raise DuelRuleError("Hiệu ứng của đối thủ không còn nhắm mục tiêu Thiếu Nữ Mắt Xanh.")
        negate_chain_link(state, targeted_link_index)

        candidates = _maiden_blue_eyes_candidates(state, context.player)
        if not candidates or _empty_monster_zone(state, context.player) is None:
            return
        if context.player == "ai":
            zone, target = candidates[0]
            if _special_summon(state, context.player, target["instance_id"]):
                if zone == "deck":
                    _shuffle(_cards(state, context.player, "deck"), rng)
            return
        _queue_maiden_summon_selection(
            state,
            context.player,
            context.source_instance_id,
            "quick_summon",
            min_count=1,
        )

    registry.register(
        EffectDefinition(
            card_id=MAIDEN_ID,
            effect_id="quick_summon",
            effect_type="quick",
            speed=2,
            resolve=maiden_quick_summon,
            can_activate=maiden_quick_can_activate,
            on_activate=mark_maiden_quick_use,
            source_zones=frozenset({"monster_zone"}),
            can_chain=True,
        )
    )

    def white_stone_recover_can_activate(
        state: Mapping[str, Any], context: EffectContext
    ) -> bool:
        source = find_card(state, context.source_instance_id)
        usage_key = f"{context.player}:m-the-white-stone-of-ancients"
        return bool(
            source
            and source[0] == context.player
            and source[1] == "graveyard"
            and source[3].get("card_id") == "m-the-white-stone-of-ancients"
            and state.get("effect_uses", {}).get(usage_key) != state["turn"]
        )

    def white_stone_recover_target_is_valid(
        state: Mapping[str, Any],
        target_id: str,
        context: EffectContext,
    ) -> bool:
        target = find_card(state, target_id)
        return bool(
            target
            and target_id != context.source_instance_id
            and target[0] == context.player
            and target[1] == "graveyard"
            and target[3].get("card_id") == "m-blue-eyes-white-dragon"
        )

    def mark_white_stone_recover_use(
        state: dict[str, Any], context: EffectContext
    ) -> None:
        state.setdefault("effect_uses", {})[
            f"{context.player}:m-the-white-stone-of-ancients"
        ] = state["turn"]
        move_card(state, context.source_instance_id, context.player, "banished")

    def white_stone_recover(state: dict[str, Any], context: EffectContext) -> None:
        target = find_card(state, context.target_instance_ids[0])
        if (
            target
            and target[0] == context.player
            and target[1] == "graveyard"
            and target[3].get("card_id") == "m-blue-eyes-white-dragon"
        ):
            move_card(state, target[3]["instance_id"], context.player, "hand")

    registry.register(
        EffectDefinition(
            card_id="m-the-white-stone-of-ancients",
            effect_id="grave_recover",
            effect_type="activated",
            speed=1,
            resolve=white_stone_recover,
            can_activate=white_stone_recover_can_activate,
            on_activate=mark_white_stone_recover_use,
            target_is_valid=white_stone_recover_target_is_valid,
            source_zones=frozenset({"graveyard"}),
            phases=MAIN_PHASES,
            requires_target=True,
        )
    )

    def solid_dragon_can_respond(
        state: Mapping[str, Any], context: EffectContext
    ) -> bool:
        source = find_card(state, context.source_instance_id)
        chain = state.get("chain", {})
        usage_key = f"{context.player}:m-blue-eyes-solid-dragon:quick"
        return bool(
            source
            and source[0] == context.player
            and source[1] == "monster_zone"
            and not source[3].get("face_down", False)
            and not monster_effects_are_negated(state, context.source_instance_id)
            and chain.get("status") == "open"
            and chain.get("priority_player") == context.player
            and chain.get("links")
            and chain["links"][-1].get("player") == opponent_of(context.player)
            and state.get("effect_uses", {}).get(usage_key) != state["turn"]
        )

    def mark_solid_dragon_response(
        state: dict[str, Any], context: EffectContext
    ) -> None:
        state.setdefault("effect_uses", {})[
            f"{context.player}:m-blue-eyes-solid-dragon:quick"
        ] = state["turn"]
        source = find_card(state, context.source_instance_id)
        if not source or source[1] != "monster_zone":
            raise DuelRuleError("Rồng Trắng Mắt Xanh Thể Rắn không còn trên sân.")
        owner = source[3]["owner"]
        move_card(state, context.source_instance_id, owner, "deck")
        _shuffle(_cards(state, owner, "deck"), rng)

    def resolve_solid_dragon_response(
        state: dict[str, Any], context: EffectContext
    ) -> None:
        target = next(
            (
                card
                for card in _cards(state, context.player, "deck")
                if card.get("card_id") == "m-blue-eyes-white-dragon"
                and _can_be_special_summoned(card)
            ),
            None,
        )
        if target:
            _special_summon(state, context.player, target["instance_id"])

    registry.register(
        EffectDefinition(
            card_id="m-blue-eyes-solid-dragon",
            effect_id="activate",
            effect_type="quick",
            speed=2,
            resolve=resolve_solid_dragon_response,
            can_activate=solid_dragon_can_respond,
            on_activate=mark_solid_dragon_response,
            source_zones=frozenset({"monster_zone"}),
            can_chain=True,
        )
    )

    def kaibaman_can_activate(
        state: Mapping[str, Any], context: EffectContext
    ) -> bool:
        source = find_card(state, context.source_instance_id)
        return bool(
            source
            and source[1] == "monster_zone"
            and not source[3].get("face_down", False)
            and any(
                card.get("card_id") == "m-blue-eyes-white-dragon"
                for zone in ("hand", "deck")
                for card in _cards(state, context.player, zone)
            )
        )

    def kaibaman(state: dict[str, Any], context: EffectContext) -> None:
        target = next(
            (
                (zone, card)
                for zone in ("hand", "deck")
                for card in _cards(state, context.player, zone)
                if card.get("card_id") == "m-blue-eyes-white-dragon"
            ),
            None,
        )
        if not target:
            return
        target_zone, blue_eyes = target
        if _special_summon(state, context.player, blue_eyes["instance_id"]):
            if target_zone == "deck":
                _shuffle(_cards(state, context.player, "deck"), rng)

    def tribute_kaibaman(state: dict[str, Any], context: EffectContext) -> None:
        move_card(
            state,
            context.source_instance_id,
            context.player,
            "graveyard",
        )

    # Kaibaman: hiến tế lá này để Triệu hồi Đặc biệt Rồng Trắng Mắt Xanh từ tay hoặc Bộ bài.
    registry.register(
        EffectDefinition(
            card_id="m-kaibaman",
            effect_id="activate",
            effect_type="activated",
            speed=1,
            resolve=kaibaman,
            can_activate=kaibaman_can_activate,
            on_activate=tribute_kaibaman,
            source_zones=frozenset({"monster_zone"}),
            phases=MAIN_PHASES,
        )
    )

    def chaos_emperor_can_activate(
        state: Mapping[str, Any], context: EffectContext
    ) -> bool:
        source = find_card(state, context.source_instance_id)
        usage_key = f"{context.player}:m-chaos-emperor-dragon:field-wipe"
        return bool(
            source
            and source[0] == context.player
            and source[1] == "monster_zone"
            and not source[3].get("face_down", False)
            and state["players"][context.player]["lp"] >= 1000
            and state.get("effect_uses", {}).get(usage_key) != state["turn"]
        )

    def chaos_emperor_cost(
        state: dict[str, Any], context: EffectContext
    ) -> None:
        state.setdefault("effect_uses", {})[
            f"{context.player}:m-chaos-emperor-dragon:field-wipe"
        ] = state["turn"]
        change_life_points(state, context.player, -1000)

    def chaos_emperor_field_wipe(
        state: dict[str, Any], context: EffectContext
    ) -> None:
        opponent = opponent_of(context.player)
        opponent_grave_count = len(_cards(state, opponent, "graveyard"))
        affected_ids = [
            card["instance_id"]
            for player in ("player", "ai")
            for zone in ("hand", "monster_zone", "spell_trap_zone")
            for card in list(_cards(state, player, zone))
            if card
        ]
        for instance_id in affected_ids:
            target = find_card(state, instance_id)
            if target and target[1] in {
                "hand",
                "monster_zone",
                "spell_trap_zone",
            }:
                move_card(
                    state,
                    instance_id,
                    target[3]["owner"],
                    "graveyard",
                )
        sent_to_opponent_grave = max(
            0,
            len(_cards(state, opponent, "graveyard")) - opponent_grave_count,
        )
        if sent_to_opponent_grave:
            change_life_points(
                state,
                opponent,
                -(sent_to_opponent_grave * 300),
            )

    # Chúa Rồng Hùng Mạnh: mỗi lượt một lần trả 1000 LP để gửi tay và sân vào Mộ.
    registry.register(
        EffectDefinition(
            card_id="m-chaos-emperor-dragon-envoy-of-the-end",
            effect_id="activate",
            effect_type="activated",
            speed=1,
            resolve=chaos_emperor_field_wipe,
            can_activate=chaos_emperor_can_activate,
            on_activate=chaos_emperor_cost,
            source_zones=frozenset({"monster_zone"}),
            phases=MAIN_PHASES,
        )
    )

    def blizzard_dragon_condition(
        state: Mapping[str, Any], context: EffectContext
    ) -> bool:
        source = find_card(state, context.source_instance_id)
        usage_key = f"{context.source_instance_id}:m-blizzard-dragon"
        return bool(
            source
            and source[1] == "monster_zone"
            and not source[3].get("face_down", False)
            and state.get("effect_uses", {}).get(usage_key) != state["turn"]
        )

    def blizzard_dragon(state: dict[str, Any], context: EffectContext) -> None:
        target = find_card(state, context.target_instance_ids[0])
        if not target or target[1] != "monster_zone":
            return
        until_turn = state["turn"] + 1
        target[3]["cannot_attack_until_turn"] = until_turn
        target[3]["cannot_change_position_until_turn"] = until_turn

    def mark_blizzard_dragon_use(
        state: dict[str, Any], context: EffectContext
    ) -> None:
        state.setdefault("effect_uses", {})[
            f"{context.source_instance_id}:m-blizzard-dragon"
        ] = state["turn"]

    # Rồng Băng Giá: mỗi lượt một lần, khóa tấn công và đổi thế của quái thú đối thủ đến hết lượt kế tiếp của họ.
    registry.register(
        EffectDefinition(
            card_id="m-blizzard-dragon",
            effect_id="activate",
            effect_type="activated",
            speed=1,
            resolve=blizzard_dragon,
            can_activate=blizzard_dragon_condition,
            on_activate=mark_blizzard_dragon_use,
            target_is_valid=lambda state, target, context: _target_in_zone(
                state,
                target,
                frozenset({"monster_zone"}),
                owner=opponent_of(context.player),
                category="monster",
            ),
            source_zones=frozenset({"monster_zone"}),
            phases=MAIN_PHASES,
            requires_target=True,
        )
    )

    def catapult_turtle_target_is_valid(
        state: Mapping[str, Any],
        target_id: str,
        context: EffectContext,
    ) -> bool:
        found = find_card(state, target_id)
        if not found:
            return False
        if context.payload.get("catapult_tribute_paid") == target_id:
            return True
        return (
            found[0] == context.player
            and found[1] == "monster_zone"
            and found[3].get("category") in {"monster", "fusion"}
        )

    def catapult_turtle_condition(
        state: Mapping[str, Any], context: EffectContext
    ) -> bool:
        source = find_card(state, context.source_instance_id)
        return bool(
            source
            and source[1] == "monster_zone"
            and not source[3].get("face_down", False)
            and len(context.target_instance_ids) == 1
        )

    def catapult_turtle_cost(
        state: dict[str, Any], context: EffectContext
    ) -> None:
        target_id = context.target_instance_ids[0]
        target = find_card(state, target_id)
        if not target:
            raise DuelRuleError("Quái thú hiến tế không còn hợp lệ.")
        context.payload["catapult_tribute_paid"] = target_id
        context.payload["damage"] = current_stats(state, target_id)["atk"] // 2
        move_card(state, target_id, context.player, "graveyard")

    def catapult_turtle(state: dict[str, Any], context: EffectContext) -> None:
        damage = context.payload.get("damage")
        if isinstance(damage, int) and not isinstance(damage, bool) and damage > 0:
            change_life_points(state, opponent_of(context.player), -damage)

    # Rùa Biển Đại Bác: hiến tế một quái thú của bạn để gây sát thương bằng nửa ATK hiện tại.
    registry.register(
        EffectDefinition(
            card_id="m-catapult-turtle",
            effect_id="activate",
            effect_type="activated",
            speed=1,
            resolve=catapult_turtle,
            can_activate=catapult_turtle_condition,
            on_activate=catapult_turtle_cost,
            target_is_valid=catapult_turtle_target_is_valid,
            source_zones=frozenset({"monster_zone"}),
            phases=MAIN_PHASES,
            requires_target=True,
        )
    )

    def gandora_can_activate(
        state: Mapping[str, Any],
        context: EffectContext,
    ) -> bool:
        source = find_card(state, context.source_instance_id)
        return bool(
            source
            and source[1] == "monster_zone"
            and not source[3].get("face_down", False)
            and state["players"][context.player]["lp"] > 0
        )

    def gandora_pay_half_lp(
        state: dict[str, Any],
        context: EffectContext,
    ) -> None:
        lp = state["players"][context.player]["lp"]
        change_life_points(state, context.player, -((lp + 1) // 2))

    def gandora(state: dict[str, Any], context: EffectContext) -> None:
        field_instance_ids = [
            card["instance_id"]
            for owner in ("player", "ai")
            for zone in ("monster_zone", "spell_trap_zone")
            for card in _cards(state, owner, zone)
            if card and card["instance_id"] != context.source_instance_id
        ]
        for instance_id in field_instance_ids:
            found = find_card(state, instance_id)
            if found and found[1] in {"monster_zone", "spell_trap_zone"}:
                destroy_card(
                    state,
                    instance_id,
                    by_player=context.player,
                    destination_zone="banished",
                )

        destroyed_count = 0
        for instance_id in field_instance_ids:
            found = find_card(state, instance_id)
            if found and found[1] == "banished":
                destroyed_count += 1
        source = find_card(state, context.source_instance_id)
        if destroyed_count and source and source[1] == "monster_zone":
            updated = add_stat_modifier(
                state,
                target_instance_id=context.source_instance_id,
                source_instance_id=context.source_instance_id,
                source_card_id=GANDORA_ID,
                owner=context.player,
                stat="atk",
                operation="increase",
                value=300 * destroyed_count,
                duration={"type": "permanent"},
            )
            _replace_state(state, updated)

    # Rồng Hủy Diệt Gandora: trả nửa LP, phá hủy rồi loại bỏ các lá khác và tăng ATK.
    registry.register(
        EffectDefinition(
            card_id=GANDORA_ID,
            effect_id="activate",
            effect_type="activated",
            speed=1,
            resolve=gandora,
            can_activate=gandora_can_activate,
            on_activate=gandora_pay_half_lp,
            source_zones=frozenset({"monster_zone"}),
            phases=MAIN_PHASES,
        )
    )

    # s-pot-of-greed — Hũ Tham Lam: rút 2 lá.
    plain("s-pot-of-greed", lambda state, context: _draw(state, context.player, 2))

    # s-raigeki — Lôi Kích: phá hủy toàn bộ quái thú đối thủ.
    plain(
        "s-raigeki",
        lambda state, context: _destroy_monsters(
            state, opponent_of(context.player), context.player
        ),
    )

    # Tia Sét Hủy Diệt: cần bài trên sân đối thủ, rồi chọn một trong hai hiệu ứng.
    def lightning_storm_can_activate(
        state: Mapping[str, Any], context: EffectContext
    ) -> bool:
        usage_key = f"{context.player}:s-lightning-storm"
        opponent = opponent_of(context.player)
        opponent_has_field_card = any(
            _cards(state, opponent, "monster_zone")
        ) or any(
            _cards(state, opponent, "spell_trap_zone")
        )
        return (
            context.payload.get("mode")
            in {"destroy_attack_monsters", "destroy_spell_traps"}
            and opponent_has_field_card
            and state.get("effect_uses", {}).get(usage_key) != state["turn"]
        )

    def lightning_storm_on_activate(
        state: dict[str, Any], context: EffectContext
    ) -> None:
        usage_key = f"{context.player}:s-lightning-storm"
        state.setdefault("effect_uses", {})[usage_key] = state["turn"]

    def lightning_storm(state: dict[str, Any], context: EffectContext) -> None:
        opponent = opponent_of(context.player)
        if context.payload["mode"] == "destroy_attack_monsters":
            if _is_protected(state, opponent, context.player):
                return
            for monster in list(_cards(state, opponent, "monster_zone")):
                if (
                    monster
                    and not monster.get("face_down", False)
                    and monster.get("position") == "attack"
                ):
                    destroy_card(
                        state,
                        monster["instance_id"],
                        by_player=context.player,
                    )
        else:
            for card in list(_cards(state, opponent, "spell_trap_zone")):
                if card:
                    destroy_card(
                        state,
                        card["instance_id"],
                        by_player=context.player,
                    )

    spell(
        "s-lightning-storm",
        lightning_storm,
        condition=lightning_storm_can_activate,
        on_activate=lightning_storm_on_activate,
    )

    # Sao Chép Ma Thuật và Đá Ma Thuật Phát Sáng: lấy lại 1 lá từ Mộ sau khi trả chi phí.
    def spell_recovery_condition(
        state: Mapping[str, Any], context: EffectContext
    ) -> bool:
        paid_cost = state.get("_paid_spell_recovery")
        return paid_cost == {
            "player": context.player,
            "source_instance_id": context.source_instance_id,
            "eligible_target_instance_ids": context.payload.get(
                "eligible_target_instance_ids"
            ),
        }

    def spell_recovery(state: dict[str, Any], context: EffectContext) -> None:
        rule = SPELL_RECOVERY_RULES[context.card_id]
        eligible_target_ids = context.payload.get("eligible_target_instance_ids")
        available_target_ids = []
        if isinstance(eligible_target_ids, list):
            for instance_id in eligible_target_ids:
                target = find_card(state, instance_id)
                if (
                    target
                    and target[0] == context.player
                    and target[1] == "graveyard"
                    and (
                        not rule["target_category"]
                        or target[3].get("category") == rule["target_category"]
                    )
                ):
                    available_target_ids.append(instance_id)
        if not available_target_ids:
            return
        state["pending_decision"] = {
            "type": "select_graveyard_card",
            "player": context.player,
            "count": 1,
            "source_instance_id": context.source_instance_id,
            "effect_card_id": context.card_id,
            "target_mode": rule["target_mode"],
            "eligible_target_instance_ids": available_target_ids,
        }

    for recovery_card_id in SPELL_RECOVERY_RULES:
        spell(
            recovery_card_id,
            spell_recovery,
            condition=spell_recovery_condition,
        )

    # s-heavy-storm và s-harpies-feather-duster — Bão Lớn và Chổi Lông Vũ Harpie: phá hủy hàng sau đối thủ.
    for card_id in ("s-heavy-storm", "s-harpies-feather-duster"):
        plain(
            card_id,
            lambda state, context: _destroy_backrow(
                state, opponent_of(context.player)
            ),
        )

    # s-card-of-sanctity — Thẻ Bài Thần Thánh: mỗi người rút đến khi có 6 lá trên tay.
    def card_of_sanctity(state: dict[str, Any], _context: EffectContext) -> None:
        for player in ("player", "ai"):
            if not state.get("over"):
                _draw(state, player, max(0, 6 - len(_cards(state, player, "hand"))))

    plain("s-card-of-sanctity", card_of_sanctity)

    # s-card-destruction — Hủy Diệt Bài Trên Tay: cả hai bỏ bài trên tay rồi rút lại số tương ứng.
    def card_destruction(state: dict[str, Any], _context: EffectContext) -> None:
        hand_sizes = {
            player: len(_cards(state, player, "hand"))
            for player in ("player", "ai")
        }
        for player in ("player", "ai"):
            for card in list(_cards(state, player, "hand")):
                move_card(state, card["instance_id"], player, "graveyard")
        for player in ("player", "ai"):
            if not state.get("over"):
                _draw(state, player, hand_sizes[player])

    plain("s-card-destruction", card_destruction)

    # s-graceful-charity — Lòng Hảo Tâm: rút 3 lá rồi chờ người chơi chọn 2 lá để bỏ.
    def graceful_charity(state: dict[str, Any], context: EffectContext) -> None:
        drawn = _draw(state, context.player, 3)
        if not state.get("over") and drawn == 3:
            state["pending_decision"] = {
                "type": "discard",
                "player": context.player,
                "count": 2,
                "source_instance_id": context.source_instance_id,
            }

    plain("s-graceful-charity", graceful_charity)

    # s-cost-down — Giảm Trọng Lượng: giảm Cấp mỗi quái thú trên tay đi 2, tối thiểu còn Cấp 1.
    def cost_down(state: dict[str, Any], context: EffectContext) -> None:
        for card in _cards(state, context.player, "hand"):
            if card.get("category") == "monster" and _level(card):
                card["level"] = max(1, _level(card) - 2)

    plain("s-cost-down", cost_down)

    # s-reload — Nạp Đạn: đưa bài trên tay về Bộ bài, xáo trộn rồi rút lại số lá tương ứng.
    def reload(state: dict[str, Any], context: EffectContext) -> None:
        hand = _cards(state, context.player, "hand")
        count = len(hand)
        _cards(state, context.player, "deck").extend(hand[:])
        hand.clear()
        _shuffle(_cards(state, context.player, "deck"), rng)
        _draw(state, context.player, count)

    plain("s-reload", reload)

    # s-dice-of-destiny — Xúc Xắc Định Mệnh: tung xúc xắc và rút từ 1 đến 6 lá.
    def dice_of_destiny(state: dict[str, Any], context: EffectContext) -> None:
        roll = int(rng() * 6) + 1
        _record_dice_roll(state, context, roll)
        _draw(state, context.player, roll)

    plain("s-dice-of-destiny", dice_of_destiny)

    # Rồng Hỏa Diệm: Triệu hồi Đặc biệt từ tay khi đối thủ có ít nhất 2 quái thú.
    def burning_dragon_can_activate(
        state: Mapping[str, Any], context: EffectContext
    ) -> bool:
        source = find_card(state, context.source_instance_id)
        usage_key = f"{context.player}:m-burning-dragon:special-summon"
        return bool(
            source
            and source[1] == "hand"
            and state.get("effect_uses", {}).get(usage_key) != state["turn"]
            and sum(
                1
                for monster in _cards(state, opponent_of(context.player), "monster_zone")
                if monster
            ) >= 2
            and _empty_monster_zone(state, context.player) is not None
        )

    def mark_burning_dragon_summon_use(
        state: dict[str, Any], context: EffectContext
    ) -> None:
        state.setdefault("effect_uses", {})[
            f"{context.player}:m-burning-dragon:special-summon"
        ] = state["turn"]

    def burning_dragon(
        state: dict[str, Any], context: EffectContext
    ) -> None:
        _special_summon(state, context.player, context.source_instance_id)

    registry.register(
        EffectDefinition(
            card_id="m-burning-dragon",
            effect_id="activate",
            effect_type="activated",
            speed=1,
            resolve=burning_dragon,
            can_activate=burning_dragon_can_activate,
            on_activate=mark_burning_dragon_summon_use,
            source_zones=frozenset({"hand"}),
            phases=MAIN_PHASES,
            can_chain=False,
        )
    )

    # Quan Tài Của Phù Thủy: hiến tế quái thú, chọn Spellcaster từ tay rồi chọn quái thú để phá hủy.
    def magical_dimension(
        state: dict[str, Any], context: EffectContext
    ) -> None:
        if not context.target_instance_ids:
            raise DuelRuleError("Quan Tài Của Phù Thủy cần chọn quái thú để Hiến tế.")
        tribute_id = context.target_instance_ids[0]
        tribute = find_card(state, tribute_id)
        if (
            not tribute
            or tribute[0] != context.player
            or tribute[1] != "monster_zone"
            or tribute[3].get("category") not in {"monster", "fusion"}
        ):
            raise DuelRuleError("Quái thú Hiến tế không còn hợp lệ.")
        move_card(state, tribute_id, context.player, "graveyard")
        candidates = [
            card
            for card in _cards(state, context.player, "hand")
            if card.get("category") in {"monster", "fusion"}
            and _is_spellcaster(card)
            and _can_be_special_summoned(card)
        ]
        if candidates and _empty_monster_zone(state, context.player) is not None:
            state["pending_decision"] = {
                "type": "select_field_cards",
                "player": context.player,
                "source_instance_id": context.source_instance_id,
                "effect_card_id": context.card_id,
                "selection_stage": "summon",
                "min_count": 1,
                "max_count": 1,
                "target_mode": "hand-spellcaster",
            }

    def magical_dimension_can_activate(
        state: Mapping[str, Any], context: EffectContext
    ) -> bool:
        return any(
            card.get("category") in {"monster", "fusion"}
            and _is_spellcaster(card)
            and _can_be_special_summoned(card)
            for card in _cards(state, context.player, "hand")
        )

    spell(
        "s-magical-dimension",
        magical_dimension,
        condition=magical_dimension_can_activate,
        target_validator=lambda state, target, context: _target_in_zone(
            state,
            target,
            frozenset({"monster_zone"}),
            owner=context.player,
        ),
        requires_target=True,
    )

    # Xúc Xắc Sấm Sét: tung xúc xắc 6 mặt và áp dụng hiệu ứng tương ứng.
    def dicephoon(state: dict[str, Any], context: EffectContext) -> None:
        roll = int(rng() * 6) + 1
        _record_dice_roll(state, context, roll)
        opposing_player = opponent_of(context.player)
        if roll in {2, 3, 4}:
            candidates = [
                card
                for card in _cards(state, opposing_player, "spell_trap_zone")
                if card
            ]
            if not candidates:
                return
            if context.player == "ai":
                destroy_card(state, candidates[0]["instance_id"], by_player=context.player)
                return
            state["pending_decision"] = {
                "type": "select_field_cards",
                "player": context.player,
                "source_instance_id": context.source_instance_id,
                "effect_card_id": "s-dicephoon",
                "min_count": 1,
                "max_count": 1,
                "target_mode": "field-opponent-spell-trap",
                "target_player": opposing_player,
            }
        elif roll == 5:
            candidates = [
                card
                for card in _cards(state, opposing_player, "monster_zone")
                if card
            ]
            if not candidates:
                return
            if context.player == "ai":
                for target in candidates[:2]:
                    destroy_card(state, target["instance_id"], by_player=context.player)
                return
            state["pending_decision"] = {
                "type": "select_field_cards",
                "player": context.player,
                "source_instance_id": context.source_instance_id,
                "effect_card_id": "s-dicephoon",
                "min_count": 1,
                "max_count": min(2, len(candidates)),
                "target_mode": "field-opponent-monster",
                "target_player": opposing_player,
            }
        elif roll in {1, 6}:
            change_life_points(state, opposing_player, -1000)

    plain("s-dicephoon", dicephoon)

    # Cấp Số Nhân: Hiến tế Kuriboh ngửa và Triệu hồi tối đa Kuriboh Token.
    def multiply(state: dict[str, Any], context: EffectContext) -> None:
        source = find_card(state, context.source_instance_id)
        if not source or source[1] != "spell_trap_zone":
            return
        tribute_id = (
            context.target_instance_ids[0]
            if context.target_instance_ids
            else context.payload.get("tribute_instance_id")
        )
        tribute = find_card(state, tribute_id) if isinstance(tribute_id, str) else None
        if (
            not tribute
            or tribute[0] != context.player
            or tribute[1] != "monster_zone"
            or tribute[3].get("card_id") != "m-kuriboh"
            or tribute[3].get("face_down", False)
        ):
            raise DuelRuleError("Cần Hiến tế Kuriboh ngửa làm chi phí.")
        move_card(state, tribute_id, context.player, "graveyard")
        for slot, card in enumerate(_cards(state, context.player, "monster_zone")):
            if card is not None:
                continue
            token = {
                "instance_id": f"{context.player}:kuriboh-token-{slot}",
                "card_id": "token-kuriboh",
                "name": "Kuriboh Token",
                "category": "monster",
                "attribute": "DARK",
                "race": "Ác quỷ",
                "level": 1,
                "atk": 300,
                "def": 200,
                "position": "defense",
                "face_down": False,
                "owner": context.player,
            }
            _cards(state, context.player, "monster_zone")[slot] = token

    spell(
        "s-multiply",
        multiply,
        target_validator=lambda state, target, context: _target_in_zone(
            state,
            target,
            frozenset({"monster_zone"}),
            owner=context.player,
            category="monster",
            face_up=True,
        ),
        requires_target=True,
    )

    # Thức Ăn Dự Phòng: tung xúc xắc, gửi tối đa Lá Phép/Bẫy tương ứng, hồi 1000 LP mỗi lá.
    def emergency_provisions(state: dict[str, Any], context: EffectContext) -> None:
        roll = int(rng() * 6) + 1
        destroyed = 0
        for owner in ("player", "ai"):
            for card in list(_cards(state, owner, "spell_trap_zone")):
                if card and destroyed < roll:
                    destroy_card(state, card["instance_id"], by_player=context.player)
                    destroyed += 1
        if destroyed:
            change_life_points(state, context.player, destroyed * 1000)

    plain("s-emergency-provisions", emergency_provisions)

    # Song Bão: bỏ 1 lá, sau đó chọn tối đa 2 Lá Phép/Bẫy của đối thủ để phá hủy.
    def twin_twisters(state: dict[str, Any], context: EffectContext) -> None:
        for target_id in context.target_instance_ids[:2]:
            if find_card(state, target_id):
                destroy_card(state, target_id, by_player=context.player)

    def twin_twisters_target_is_valid(
        state: dict[str, Any], target_id: str, context: EffectContext
    ) -> bool:
        return target_id != context.source_instance_id and any(
            _target_in_zone(
                state,
                target_id,
                frozenset({"spell_trap_zone"}),
                owner=opponent_of(context.player),
                category=category,
            )
            for category in ("spell", "trap")
        )

    def twin_twisters_can_activate(
        state: Mapping[str, Any], context: EffectContext
    ) -> bool:
        if not any(_cards(state, opponent_of(context.player), "spell_trap_zone")):
            return False
        source = find_card(state, context.source_instance_id)
        required_hand = 2 if source and source[1] == "hand" else 1
        return len(_cards(state, context.player, "hand")) >= required_hand

    spell(
        "s-twin-twisters",
        twin_twisters,
        target_validator=twin_twisters_target_is_valid,
        condition=twin_twisters_can_activate,
    )

    # Mèo Ma Thuật: Kích hoạt Phép/Bẫy từ Bộ bài khi lá này bị gửi xuống Mộ.
    plain(
        "s-ring-of-defense",
        lambda state, context: state.setdefault("battle", {}).update(
            {"damage_negated_player": context.player, "turn": state["turn"]}
        ),
    )

    # Tráo Đổi Linh Hồn: Hiến tế quái thú đối thủ thay cho quái thú của mình.
    def soul_exchange(state: dict[str, Any], context: EffectContext) -> None:
        target_id = context.target_instance_ids[0]
        target = find_card(state, target_id)
        if not target or target[0] == context.player or target[1] != "monster_zone":
            raise DuelRuleError("Mục tiêu Tráo Đổi Linh Hồn không hợp lệ.")
        target[3]["soul_exchange_owner"] = context.player
        target[3]["soul_exchange_turn"] = state["turn"]

    spell(
        "s-soul-exchange",
        soul_exchange,
        target_validator=lambda state, target, context: _target_in_zone(
            state,
            target,
            frozenset({"monster_zone"}),
            owner=opponent_of(context.player),
            category="monster",
            face_up=True,
        ),
        requires_target=True,
    )

    # s-graceful-dice — Xúc Xắc Thiên Thần: nhân ATK/DEF quái thú của bạn theo số nút xúc xắc.
    spell(
        "s-graceful-dice",
        lambda state, context: _apply_dice_stat_modifier(
            state, context, context.player, "multiply", rng
        ),
    )

    # t-skull-dice — Xúc Xắc Tiểu Quỷ: chia ATK/DEF quái thú đối thủ theo số nút xúc xắc.
    def skull_dice(state: dict[str, Any], context: EffectContext) -> None:
        _apply_dice_stat_modifier(
            state, context, opponent_of(context.player), "divide", rng
        )
        _move_to_grave(state, context.source_instance_id)

    registry.register(_trap_definition("t-skull-dice", skull_dice))

    # s-swords-of-revealing-light — Kiếm Ánh Sáng Tiết Lộ: lật ngửa quái thú úp của đối thủ và ở lại trên sân.
    def swords(state: dict[str, Any], context: EffectContext) -> None:
        for monster in _cards(state, opponent_of(context.player), "monster_zone"):
            if monster and monster.get("face_down", False):
                monster["face_down"] = False
                monster["position"] = "defense"

    plain("s-swords-of-revealing-light", swords, keep=True)

    # s-the-seal-of-orichalcos — Phong Ấn Orichalcos: đặt vào Ô Môi Trường, chỉ 1 người được kích hoạt trong trận, +500 ATK, không thể bị phá hủy.
    def orichalcos_condition(
        state: Mapping[str, Any], context: EffectContext
    ) -> bool:
        if state.get("orichalcos_activated"):
            return False
        for player_id in ("player", "ai"):
            for field_card in state["players"][player_id].get("field_zone", []):
                if (
                    field_card
                    and field_card.get("card_id") == "s-the-seal-of-orichalcos"
                ):
                    return False
        return state["players"][context.player].get("field_zone", [None])[0] is None

    def orichalcos_effect(state: dict[str, Any], context: EffectContext) -> None:
        state["orichalcos_activated"] = True
        state["orichalcos_controller"] = context.player

    plain(
        "s-the-seal-of-orichalcos",
        orichalcos_effect,
        keep=True,
        condition=orichalcos_condition,
        destination_zone="field_zone",
    )

    # s-dark-magic-curtain — Bức Màn Ma Thuật Bóng Tối: Triệu hồi Đặc biệt Dark Magician hoặc Dark Magician Girl từ Bộ bài.
    def curtain_condition(state: Mapping[str, Any], context: EffectContext) -> bool:
        return _empty_monster_zone(state, context.player) is not None and any(
            card.get("card_id") in {"m-dark-magician", "m-dark-magician-girl"}
            for card in _cards(state, context.player, "deck")
        )

    def dark_magic_curtain(state: dict[str, Any], context: EffectContext) -> None:
        card = next(
            (
                card
                for card in _cards(state, context.player, "deck")
                if card.get("card_id") in {"m-dark-magician", "m-dark-magician-girl"}
            ),
            None,
        )
        if card:
            _special_summon(state, context.player, card["instance_id"])

    spell("s-dark-magic-curtain", dark_magic_curtain, condition=curtain_condition)

    # s-sages-stone — Đá Hiền Triết: khi có Dark Magician Girl ngửa, Triệu hồi Đặc biệt Dark Magician.
    def sages_condition(state: Mapping[str, Any], context: EffectContext) -> bool:
        return (
            _face_up_monster(state, context.player, "m-dark-magician-girl")
            and _empty_monster_zone(state, context.player) is not None
            and any(
                card.get("card_id") == "m-dark-magician"
                for zone in ("hand", "deck")
                for card in _cards(state, context.player, zone)
            )
        )

    def sages_stone(state: dict[str, Any], context: EffectContext) -> None:
        card = next(
            (
                card
                for zone in ("hand", "deck")
                for card in _cards(state, context.player, zone)
                if card.get("card_id") == "m-dark-magician"
            ),
            None,
        )
        if card:
            _special_summon(state, context.player, card["instance_id"])

    spell("s-sages-stone", sages_stone, condition=sages_condition)

    # s-the-flute-of-summoning-dragon — Sáo Triệu Hồi Rồng: có Lord of D. thì Triệu hồi tối đa 2 Rồng từ tay.
    def flute_condition(state: Mapping[str, Any], context: EffectContext) -> bool:
        return (
            any(
                card
                and card.get("card_id") == "m-lord-of-d"
                and not card.get("face_down", False)
                and not card.get("monster_effects_negated", False)
                for card in _cards(state, context.player, "monster_zone")
            )
            and _empty_monster_zone(state, context.player) is not None
            and any(
                card and _is_dragon(card) and _can_be_special_summoned(card)
                for card in _cards(state, context.player, "hand")
            )
        )

    def flute(state: dict[str, Any], context: EffectContext) -> None:
        summoned = 0
        for card in list(_cards(state, context.player, "hand")):
            if summoned == 2 or _empty_monster_zone(state, context.player) is None:
                break
            if (
                _is_dragon(card)
                and _can_be_special_summoned(card)
                and _special_summon(
                    state, context.player, card["instance_id"]
                )
            ):
                summoned += 1

    spell("s-the-flute-of-summoning-dragon", flute, condition=flute_condition)

    # s-the-melody-of-awakening-dragon — Giai Điệu Đánh Thức Rồng: trả 1000 LP và Triệu hồi 2 Rồng.
    def melody_condition(state: Mapping[str, Any], context: EffectContext) -> bool:
        return (
            state["players"][context.player]["lp"] >= 1000
            and sum(
                1
                for zone in ("hand", "deck")
                for card in _cards(state, context.player, zone)
                if _is_dragon(card) and _can_be_special_summoned(card)
            )
            >= 2
            and sum(
                card is None
                for card in _cards(state, context.player, "monster_zone")
            )
            >= 2
        )

    def melody(state: dict[str, Any], context: EffectContext) -> None:
        if state.get("over"):
            return
        summoned = 0
        for zone in ("hand", "deck"):
            for card in list(_cards(state, context.player, zone)):
                if summoned == 2 or state.get("over"):
                    break
                if (
                    _is_dragon(card)
                    and _can_be_special_summoned(card)
                    and _special_summon(
                        state, context.player, card["instance_id"]
                    )
                ):
                    summoned_card = find_card(state, card["instance_id"])
                    if summoned_card:
                        summoned_card[3]["cannot_attack_turn"] = state["turn"]
                    summoned += 1

    spell(
        "s-the-melody-of-awakening-dragon",
        melody,
        condition=melody_condition,
        on_activate=lambda state, context: change_life_points(
            state, context.player, -1000
        ),
    )

    # s-bond-between-teacher-and-student — Tình Thầy Trò: có Dark Magician thì Triệu hồi Dark Magician Girl và đặt bài hỗ trợ phù hợp.
    def bond_condition(state: Mapping[str, Any], context: EffectContext) -> bool:
        return (
            _face_up_monster(state, context.player, "m-dark-magician")
            and _empty_monster_zone(state, context.player) is not None
            and any(
                card.get("card_id") == "m-dark-magician-girl"
                for zone in ("hand", "deck", "graveyard")
                for card in _cards(state, context.player, zone)
            )
        )

    def bond(state: dict[str, Any], context: EffectContext) -> None:
        card = next(
            (
                card
                for zone in ("hand", "deck", "graveyard")
                for card in _cards(state, context.player, zone)
                if card.get("card_id") == "m-dark-magician-girl"
            ),
            None,
        )
        if card:
            _special_summon(state, context.player, card["instance_id"])
        settable_ids = {
            "s-thousand-knives",
            "s-dark-burning-attack",
            "s-dark-magic-twin-burst",
            "s-dark-magic-attack",
        }
        zone_index = next(
            (
                index
                for index, current in enumerate(
                    _cards(state, context.player, "spell_trap_zone")
                )
                if current is None
            ),
            None,
        )
        settable = next(
            (
                card
                for card in _cards(state, context.player, "deck")
                if card.get("card_id") in settable_ids
            ),
            None,
        )
        if zone_index is not None and settable:
            set_card = move_card(
                state,
                settable["instance_id"],
                context.player,
                "spell_trap_zone",
                destination_index=zone_index,
            )
            set_card["face_down"] = True
            set_card["set_turn"] = state["turn"]

    spell("s-bond-between-teacher-and-student", bond, condition=bond_condition)

    # s-bond-between-teacher-and-student (Mộ): loại bỏ lá này để bảo vệ các Pháp sư Bóng Tối đến hết lượt.
    def bond_graveyard_condition(
        state: Mapping[str, Any], context: EffectContext
    ) -> bool:
        return any(
            card
            and card.get("card_id")
            in {"m-dark-magician", "m-dark-magician-girl"}
            for card in _cards(state, context.player, "monster_zone")
        )

    def bond_graveyard(state: dict[str, Any], context: EffectContext) -> None:
        move_card(
            state,
            context.source_instance_id,
            context.player,
            "banished",
        )
        protection = state.setdefault("card_effect_protection", {})
        for monster in _cards(state, context.player, "monster_zone"):
            if (
                monster
                and monster.get("card_id")
                in {"m-dark-magician", "m-dark-magician-girl"}
            ):
                protection[monster["instance_id"]] = state["turn"]

    registry.register(
        EffectDefinition(
            card_id="s-bond-between-teacher-and-student",
            effect_id="graveyard-protection",
            effect_type="activated",
            speed=2,
            resolve=bond_graveyard,
            can_activate=bond_graveyard_condition,
            source_zones=frozenset({"graveyard"}),
            can_chain=True,
        )
    )

    # s-dark-magic-attack — Đòn Tấn Công Ma Thuật Bóng Tối: cần Dark Magician; phá hủy hàng sau đối thủ.
    spell(
        "s-dark-magic-attack",
        lambda state, context: _destroy_backrow(
            state, opponent_of(context.player)
        ),
        condition=lambda state, context: _condition_face_up(
            state, context, "m-dark-magician"
        ),
    )

    # s-dark-burning-attack — Đòn Thiêu Đốt Bóng Tối: cần Dark Magician Girl; phá hủy quái thú đối thủ.
    spell(
        "s-dark-burning-attack",
        lambda state, context: _destroy_monsters(
            state, opponent_of(context.player), context.player
        ),
        condition=lambda state, context: _condition_face_up(
            state, context, "m-dark-magician-girl"
        ),
    )

    # s-burst-stream-of-destruction — Luồng Hủy Diệt Bùng Nổ: cần Blue-Eyes; phá hủy quái thú đối thủ và Blue-Eyes không thể tấn công.
    def burst_stream(state: dict[str, Any], context: EffectContext) -> None:
        _destroy_monsters(state, opponent_of(context.player), context.player)
        for monster in _cards(state, context.player, "monster_zone"):
            if monster and monster.get("card_id") in {
                "m-blue-eyes-white-dragon",
                "m-blue-eyes-alternative-white-dragon",
            }:
                monster["cannot_attack_turn"] = state["turn"]

    spell(
        "s-burst-stream-of-destruction",
        burst_stream,
        condition=lambda state, context: _condition_face_up(
            state, context, "m-blue-eyes-white-dragon"
        ),
    )

    # s-divine-shield — Khiên Thần Bảo Hộ: bảo vệ quái thú của bạn khỏi hiệu ứng phá hủy trong lượt này.
    def divine_shield(state: dict[str, Any], context: EffectContext) -> None:
        state.setdefault("effect_protection", {})[context.player] = state["turn"]

    plain("s-divine-shield", divine_shield)

    # s-rain-of-mercy — Mưa Ân Huệ: ở lại ngửa và hồi 1000 LP cho chủ bài trong Standby Phase của họ.
    plain("s-rain-of-mercy", lambda _state, _context: None, keep=True)

    # s-counterbalance-card — Ma Thuật Hiến Tế Công Bằng: ở lại ngửa và gửi bài trên cùng Bộ bài đối thủ xuống Mộ trong Standby Phase của họ.
    plain("s-counterbalance-card", lambda _state, _context: None, keep=True)

    # s-soul-absorption — Hấp Thụ Linh Hồn: chỉ bắt đầu hồi LP khi lá này đã ngửa và Chain Link kích hoạt được giải quyết.
    def soul_absorption(state: dict[str, Any], context: EffectContext) -> None:
        source = find_card(state, context.source_instance_id)
        if source and source[1] == "spell_trap_zone":
            source[3]["effect_active"] = True

    def prepare_soul_absorption(
        state: dict[str, Any], context: EffectContext
    ) -> None:
        source = find_card(state, context.source_instance_id)
        if source and source[1] == "spell_trap_zone":
            source[3]["effect_active"] = False

    spell(
        "s-soul-absorption",
        soul_absorption,
        keep_on_field=True,
        on_activate=prepare_soul_absorption,
    )

    # Dung Hợp Đa Chiều: trả 2000 LP để cả hai người Triệu hồi Đặc biệt quái thú bị loại bỏ.
    def dimension_fusion_condition(
        state: Mapping[str, Any], context: EffectContext
    ) -> bool:
        return state["players"][context.player]["lp"] >= 2000 and any(
            _empty_monster_zone(state, player) is not None
            and any(
                card.get("category") == "monster"
                and _can_be_special_summoned(card)
                for card in _cards(state, player, "banished")
            )
            for player in ("player", "ai")
        )

    def dimension_fusion(state: dict[str, Any], _context: EffectContext) -> None:
        for player in ("player", "ai"):
            for card in list(_cards(state, player, "banished")):
                if _empty_monster_zone(state, player) is None:
                    break
                if (
                    card.get("category") == "monster"
                    and _can_be_special_summoned(card)
                ):
                    _special_summon(state, player, card["instance_id"])

    spell(
        "s-dimension-fusion",
        dimension_fusion,
        condition=dimension_fusion_condition,
        on_activate=lambda state, context: change_life_points(
            state, context.player, -2000
        ),
    )

    _register_targeted_effects(registry)
    _register_normal_traps(registry)
    _register_counter_traps(registry)
    _register_attack_traps(registry, rng)
    _register_cloning_trap(registry)
    _register_equip_spells(registry)
    return registry


def _register_equip_spells(registry: EffectRegistry) -> None:
    def register(
        card_id: str,
        *,
        atk: int = 0,
        defense: int = 0,
        allowed_targets: frozenset[str] | None = None,
    ) -> None:
        def target_is_valid(
            state: Mapping[str, Any], target_id: str, _context: EffectContext
        ) -> bool:
            found = find_card(state, target_id)
            if (
                not found
                or found[1] != "monster_zone"
                or found[3].get("category") not in {"monster", "fusion"}
                or found[3].get("face_down", False)
            ):
                return False
            return allowed_targets is None or found[3].get("card_id") in allowed_targets

        def equip(state: dict[str, Any], context: EffectContext) -> None:
            target_id = context.target_instance_ids[0]
            source = find_card(state, context.source_instance_id)
            if not source or source[1] != "spell_trap_zone":
                return
            source[3]["target_instance_id"] = target_id
            if atk:
                updated = add_stat_modifier(
                    state,
                    target_instance_id=target_id,
                    source_instance_id=context.source_instance_id,
                    source_card_id=context.card_id,
                    owner=context.player,
                    stat="atk",
                    operation="increase",
                    value=atk,
                    duration={
                        "type": "source_leaves_field",
                        "source_instance_id": context.source_instance_id,
                    },
                )
                _replace_state(state, updated)
            if defense:
                updated = add_stat_modifier(
                    state,
                    target_instance_id=target_id,
                    source_instance_id=context.source_instance_id,
                    source_card_id=context.card_id,
                    owner=context.player,
                    stat="def",
                    operation="increase",
                    value=defense,
                    duration={
                        "type": "source_leaves_field",
                        "source_instance_id": context.source_instance_id,
                    },
                )
                _replace_state(state, updated)

        # Trang Bị chỉ được kích hoạt khi có quái thú ngửa phù hợp làm mục tiêu.
        registry.register(
            _spell_definition(
                card_id,
                equip,
                target_validator=target_is_valid,
                requires_target=True,
                keep_on_field=True,
            )
        )

    # Sừng Kỳ Lân: tăng 700 ATK và 700 DEF cho quái thú được trang bị.
    register("s-horn-of-the-unicorn", atk=700, defense=700)

    # Quyển Sách Ma Thuật: chỉ trang bị cho Dark Magician hoặc Dark Magician Girl, tăng 700 ATK.
    register(
        "s-magic-formula",
        atk=700,
        allowed_targets=frozenset(
            {"m-dark-magician", "m-dark-magician-girl"}
        ),
    )

    # Kiếm Bướm Elma: tăng 300 ATK cho quái thú được trang bị.
    register("s-butterfly-dagger-elma", atk=300)

    # Mặt Nạ Chú Hồn: quái thú được trang bị không thể tấn công.
    register("s-mask-of-the-accursed")

    # Kiếm Chấp Niệm: tăng 500 ATK và 500 DEF cho quái thú được trang bị.
    register("s-sword-of-deep-seated", atk=500, defense=500)


def _register_targeted_effects(registry: EffectRegistry) -> None:
    def register(
        card_id: str,
        action: EffectAction,
        validator: Callable[[Mapping[str, Any], str, EffectContext], bool],
        *,
        condition: Callable[[Mapping[str, Any], EffectContext], bool] | None = None,
        on_activate: Callable[[dict[str, Any], EffectContext], None] | None = None,
    ) -> None:
        registry.register(
            _spell_definition(
                card_id,
                action,
                condition=condition,
                on_activate=on_activate,
                target_validator=validator,
                requires_target=True,
            )
        )

    # s-monster-reborn — Hồi Sinh Quái Thú: Triệu hồi Đặc biệt 1 quái thú từ Mộ của một trong hai người chơi.
    def monster_reborn_effect(state: dict[str, Any], context: EffectContext) -> None:
        target_id = _target(state, context)[3]["instance_id"]
        if _special_summon(state, context.player, target_id):
            revived = find_card(state, target_id)
            if revived and revived[1] == "monster_zone":
                revived[3]["allow_position_change_on_summon_turn"] = True

    register(
        "s-monster-reborn",
        monster_reborn_effect,
        lambda state, target, _context: _special_summon_target_in_zone(
            state, target, frozenset({"graveyard"})
        )
        and _empty_monster_zone(state, _context.player) is not None,
    )

    # s-return-of-the-dragon-lords — Hồi Sinh Chúa Tể Rồng: Triệu hồi Đặc biệt Rồng Cấp 7 hoặc 8 của bạn từ Mộ.
    register(
        "s-return-of-the-dragon-lords",
        lambda state, context: _special_summon(
            state, context.player, _target(state, context)[3]["instance_id"]
        ),
        lambda state, target, context: (
            _special_summon_target_in_zone(
                state,
                target,
                frozenset({"graveyard"}),
                owner=context.player,
            )
            and _is_dragon(find_card(state, target)[3])
            and _level(find_card(state, target)[3]) in {7, 8}
            and _empty_monster_zone(state, context.player) is not None
        ),
    )

    # s-a-wingbeat-of-giant-dragon — Cánh Đập Của Rồng Khổng Lồ: trả Rồng Cấp 5 trở lên về tay để phá hủy hàng sau đối thủ.
    def wingbeat(state: dict[str, Any], context: EffectContext) -> None:
        found = _target(state, context)
        dragon_id = found[3]["instance_id"]
        move_card(state, dragon_id, context.player, "hand")
        _destroy_backrow(state, opponent_of(context.player))

    register(
        "s-a-wingbeat-of-giant-dragon",
        wingbeat,
        lambda state, target, context: (
            _target_in_zone(
                state,
                target,
                frozenset({"monster_zone"}),
                owner=context.player,
                category="monster",
                face_up=True,
            )
            and _is_dragon(find_card(state, target)[3])
            and _level(find_card(state, target)[3]) >= 5
        ),
    )

    # s-diffusion-wave-motion — Sóng Khuếch Tán: trả 1000 LP, phá hủy quái thú đối thủ và gây sát thương bằng một nửa ATK.
    def diffusion_condition(state: Mapping[str, Any], context: EffectContext) -> bool:
        return state["players"][context.player]["lp"] >= 1000

    def diffusion(state: dict[str, Any], context: EffectContext) -> None:
        if state.get("over"):
            return
        opponent = opponent_of(context.player)
        for monster in list(_cards(state, opponent, "monster_zone")):
            if monster:
                atk = current_stats(state, monster["instance_id"])["atk"]
                destroyed = destroy_card(
                    state, monster["instance_id"], by_player=context.player
                )
                if destroyed:
                    change_life_points(state, opponent, -(max(0, atk) // 2))

    register(
        "s-diffusion-wave-motion",
        diffusion,
        lambda state, target, context: (
            _target_in_zone(
                state,
                target,
                frozenset({"monster_zone"}),
                owner=context.player,
                category="monster",
                face_up=True,
            )
            and _is_spellcaster(find_card(state, target)[3])
            and _level(find_card(state, target)[3]) >= 7
        ),
        condition=diffusion_condition,
        on_activate=lambda state, context: change_life_points(
            state, context.player, -1000
        ),
    )

    # s-change-of-heart và s-brain-control — Đổi Ý và Điều Khiển Tâm Trí: chiếm quyền điều khiển quái thú đối thủ đến hết lượt.
    def take_control(state: dict[str, Any], context: EffectContext) -> None:
        found = _target(state, context)
        zone_index = found[2]
        card = found[3]
        free_index = _empty_monster_zone(state, context.player)
        if free_index is None:
            return
        origin = opponent_of(context.player)
        move_card(
            state,
            card["instance_id"],
            context.player,
            "monster_zone",
            destination_index=free_index,
        )
        card["temporary_control"] = {
            "return_to": origin,
            "zone_index": zone_index,
            "turn": state["turn"],
        }

    register(
        "s-change-of-heart",
        take_control,
        lambda state, target, context: _target_in_zone(
            state,
            target,
            frozenset({"monster_zone"}),
            owner=opponent_of(context.player),
            category="monster",
        )
        and not _is_protected(
            state, opponent_of(context.player), context.player
        )
        and _empty_monster_zone(state, context.player) is not None,
    )
    register(
        "s-brain-control",
        take_control,
        lambda state, target, context: _target_in_zone(
            state,
            target,
            frozenset({"monster_zone"}),
            owner=opponent_of(context.player),
            category="monster",
            face_up=True,
        )
        and not _is_protected(
            state, opponent_of(context.player), context.player
        )
        and _empty_monster_zone(state, context.player) is not None,
    )

    # s-thousand-knives — Ngàn Lưỡi Dao: cần Dark Magician ngửa; phá hủy 1 quái thú đối thủ.
    def destroy_target(state: dict[str, Any], context: EffectContext) -> None:
        found = _target(state, context)
        if found[1] != "monster_zone" or not _is_protected(
            state, found[0], context.player
        ):
            destroy_card(
                state, found[3]["instance_id"], by_player=context.player
            )

    register(
        "s-thousand-knives",
        destroy_target,
        lambda state, target, context: _target_in_zone(
            state,
            target,
            frozenset({"monster_zone"}),
            owner=opponent_of(context.player),
            category="monster",
        )
        and not _is_protected(
            state, opponent_of(context.player), context.player
        ),
        condition=lambda state, context: _face_up_monster(
            state, context.player, "m-dark-magician"
        ),
    )

    # s-soul-release — Giải Phóng Linh Hồn: loại bỏ tối đa 5 lá trong Mộ và đổi LP theo chủ sở hữu từng lá.
    def soul_release(state: dict[str, Any], context: EffectContext) -> None:
        own_count = 0
        opponent_count = 0
        for target_id in context.target_instance_ids:
            target = find_card(state, target_id)
            if not target or target[1] != "graveyard":
                continue
            owner = target[0]
            move_card(state, target_id, owner, "banished")
            if owner == context.player:
                own_count += 1
            else:
                opponent_count += 1
        if own_count:
            change_life_points(state, context.player, own_count * 500)
        if opponent_count and not state.get("over"):
            change_life_points(
                state, opponent_of(context.player), -(opponent_count * 500)
            )

    register(
        "s-soul-release",
        soul_release,
        lambda state, target, _context: _target_in_zone(
            state, target, frozenset({"graveyard"})
        ),
        condition=lambda _state, context: (
            1 <= len(context.target_instance_ids) <= 5
        ),
    )

    # s-mystical-space-typhoon — Lốc Xoáy Không Gian Huyền Bí: phá hủy 1 Lá Phép/Bẫy trên sân.
    register(
        "s-mystical-space-typhoon",
        destroy_target,
        lambda state, target, _context: _target_in_zone(
            state, target, frozenset({"spell_trap_zone"})
        ),
    )

    # s-soul-taker — Thợ Săn Linh Hồn: phá hủy quái thú ngửa của đối thủ và cho chủ của nó 1000 LP.
    def soul_taker(state: dict[str, Any], context: EffectContext) -> None:
        target = _target(state, context)
        owner, card = target[0], target[3]
        if _is_protected(state, owner, context.player):
            return
        destroyed = destroy_card(
            state, card["instance_id"], by_player=context.player
        )
        if destroyed and not state.get("over"):
            change_life_points(state, owner, 1000)

    register(
        "s-soul-taker",
        soul_taker,
        lambda state, target, context: _target_in_zone(
            state,
            target,
            frozenset({"monster_zone"}),
            owner=opponent_of(context.player),
            category="monster",
            face_up=True,
        )
        and not _is_protected(
            state, opponent_of(context.player), context.player
        ),
    )

    # s-shrink — Thu Nhỏ: giảm ATK gốc của quái thú được chọn còn một nửa.
    def shrink(state: dict[str, Any], context: EffectContext) -> None:
        target = _target(state, context)[3]
        updated = add_stat_modifier(
            state,
            target_instance_id=target["instance_id"],
            source_instance_id=context.source_instance_id,
            source_card_id=context.card_id,
            owner=context.player,
            stat="atk",
            operation="set",
            value=max(0, target["base_atk"] // 2),
            duration={"type": "permanent"},
        )
        _replace_state(state, updated)

    register(
        "s-shrink",
        shrink,
        lambda state, target, _context: _target_in_zone(
            state,
            target,
            frozenset({"monster_zone"}),
            category="monster",
            face_up=True,
        ),
    )

    # s-remove-trap — Giải Trừ Cạm Bẫy: phá hủy 1 Lá Bẫy ngửa trên sân.
    register(
        "s-remove-trap",
        destroy_target,
        lambda state, target, _context: (
            _target_in_zone(
                state,
                target,
                frozenset({"spell_trap_zone"}),
                category="trap",
                face_up=True,
            )
        ),
    )

    # s-de-spell — Giải Trừ Ma Pháp: phá hủy Lá Phép ngửa hoặc kiểm tra lá úp và phá hủy nếu đó là Lá Phép.
    def de_spell(state: dict[str, Any], context: EffectContext) -> None:
        target = _target(state, context)
        card = target[3]
        if card.get("category") == "spell":
            destroy_card(state, card["instance_id"])
        else:
            card["face_down"] = True

    register(
        "s-de-spell",
        de_spell,
        lambda state, target, _context: _target_in_zone(
            state, target, frozenset({"spell_trap_zone"})
        ),
    )

    # t-compulsory-evacuation-device — Cưỡng Chế Tháo Trang Bị: trả 1 quái thú trên sân về tay người đang điều khiển và chuyển quyền sở hữu cho họ.
    def compulsory_evacuation_activate(
        state: dict[str, Any], context: EffectContext
    ) -> None:
        target = _target(state, context)
        _return_monster_to_controller_hand(state, target[0], target[3])
        _move_to_grave(state, context.source_instance_id)

    registry.register(
        _trap_definition(
            "t-compulsory-evacuation-device",
            compulsory_evacuation_activate,
            target_validator=lambda state, target, _context: _target_in_zone(
                state,
                target,
                frozenset({"monster_zone"}),
                category="monster",
            )
            and not _is_protected(
                state,
                find_card(state, target)[0],
                _context.player,
            ),
            requires_target=True,
            can_chain=False,
        )
    )

def _register_normal_traps(registry: EffectRegistry) -> None:
    # Cổ Máy Gương Ma Thuật — khi quái thú đối thủ tấn công, lấy 1 Lá Phép trong Mộ đối thủ Úp ở sân mình.
    def magical_trick_mirror_target_is_valid(
        state: Mapping[str, Any], target_id: str, context: EffectContext
    ) -> bool:
        target = find_card(state, target_id)
        return bool(
            target
            and target[0] == opponent_of(context.player)
            and target[1] == "graveyard"
            and target[3].get("category") == "spell"
        )

    def magical_trick_mirror(
        state: dict[str, Any], context: EffectContext
    ) -> None:
        target_id = context.target_instance_ids[0]
        target = find_card(state, target_id)
        if not target:
            return
        slot = _empty_spell_trap_zone(state, context.player)
        if slot is None:
            return
        moved = move_card(
            state,
            target_id,
            context.player,
            "spell_trap_zone",
            destination_index=slot,
        )
        moved["face_down"] = True
        moved["set_turn"] = state["turn"]

    registry.register(
        _trap_definition(
            "t-magical-trick-mirror",
            magical_trick_mirror,
            target_validator=magical_trick_mirror_target_is_valid,
            requires_target=True,
        )
    )

    def trap_hole_target_is_valid(
        state: Mapping[str, Any],
        target_id: str,
        context: EffectContext,
    ) -> bool:
        target = find_card(state, target_id)
        return bool(
            target
            and target[0] == opponent_of(context.player)
            and target[1] == "monster_zone"
            and not target[3].get("face_down", False)
        )

    def trap_hole_summon_is_valid(
        state: Mapping[str, Any],
        target_id: str,
    ) -> bool:
        target = find_card(state, target_id)
        summoned_this_turn = bool(
            target
            and (
                (
                    target[3].get("summoned_turn") == state["turn"]
                    and target[3].get("summon_method")
                    in {"normal", "tribute"}
                )
                or target[3].get("flip_summoned_turn") == state["turn"]
            )
        )
        return bool(
            target
            and summoned_this_turn
            and current_stats(state, target_id)["atk"] >= 1000
        )

    def trap_hole_can_activate(
        state: Mapping[str, Any],
        context: EffectContext,
    ) -> bool:
        return (
            _can_activate_set_trap(state, context)
            and state.get("chain", {}).get("status") == "closed"
            and bool(context.target_instance_ids)
            and trap_hole_target_is_valid(
                state,
                context.target_instance_ids[0],
                context,
            )
            and trap_hole_summon_is_valid(
                state,
                context.target_instance_ids[0],
            )
        )

    def trap_hole(
        state: dict[str, Any],
        context: EffectContext,
    ) -> None:
        target_id = (
            context.target_instance_ids[0]
            if context.target_instance_ids
            else context.payload.get("summon_instance_id")
        )
        if trap_hole_target_is_valid(state, target_id, context):
            destroy_card(state, target_id, by_player=context.player)
        _move_to_grave(state, context.source_instance_id)

    registry.register(
        _trap_definition(
            "t-trap-hole",
            trap_hole,
            target_validator=trap_hole_target_is_valid,
            requires_target=True,
            can_activate=trap_hole_can_activate,
        )
    )

    def grave_robber_target_is_valid(
        state: Mapping[str, Any],
        target_id: str,
        context: EffectContext,
    ) -> bool:
        target = find_card(state, target_id)
        return bool(
            target
            and target[0] == opponent_of(context.player)
            and target[1] == "graveyard"
        )

    def grave_robber_can_activate(
        state: Mapping[str, Any],
        context: EffectContext,
    ) -> bool:
        return (
            _can_activate_set_trap(state, context)
            and any(
                _cards(state, opponent_of(context.player), "graveyard")
            )
        )

    def grave_robber(state: dict[str, Any], context: EffectContext) -> None:
        target_id = context.target_instance_ids[0]
        if not grave_robber_target_is_valid(state, target_id, context):
            return
        move_card(state, target_id, context.player, "hand")
        _move_to_grave(state, context.source_instance_id)

    # Kẻ Trộm Mộ: lấy một lá trong Mộ đối thủ lên tay, giữ nguyên chủ sở hữu.
    registry.register(
        _trap_definition(
            "t-graverobber",
            grave_robber,
            target_validator=grave_robber_target_is_valid,
            requires_target=True,
            can_activate=grave_robber_can_activate,
        )
    )

    def heavy_storm_duster_target_is_valid(
        state: Mapping[str, Any],
        target_id: str,
        _context: EffectContext,
    ) -> bool:
        target = find_card(state, target_id)
        return bool(
            target
            and target[1] == "spell_trap_zone"
            and target[3].get("category") in {"spell", "trap"}
        )

    def heavy_storm_duster_can_activate(
        state: Mapping[str, Any],
        context: EffectContext,
    ) -> bool:
        return (
            _can_activate_set_trap(state, context)
            and 1 <= len(context.target_instance_ids) <= 2
        )

    def heavy_storm_duster(state: dict[str, Any], context: EffectContext) -> None:
        # Cơn Bão Lớn: phá hủy tối đa hai Lá Phép/Bẫy đã chọn trên sân.
        for target_id in context.target_instance_ids:
            if find_card(state, target_id):
                destroy_card(state, target_id, by_player=context.player)
        _move_to_grave(state, context.source_instance_id)

    # Cơn Bão Lớn chỉ chọn tối đa hai Lá Phép/Bẫy đang nằm trên sân.
    registry.register(
        _trap_definition(
            "t-heavy-storm-duster",
            heavy_storm_duster,
            target_validator=heavy_storm_duster_target_is_valid,
            requires_target=True,
            can_activate=heavy_storm_duster_can_activate,
        )
    )

    # t-robbin-goblin — Tên Trộm Yêu Tinh: khi quái thú gây sát thương chiến đấu, đối thủ bỏ ngẫu nhiên 1 lá.
    registry.register(
        _trap_definition(
            "t-robbin-goblin",
            lambda _state, _context: None,
        )
    )

    # t-gravity-bind — Mạng Lưới Trọng Lực: hiệu ứng liên tục ngăn quái thú Cấp 4 trở lên tấn công.
    def gravity_bind_activate(state: dict[str, Any], context: EffectContext) -> None:
        pending_battle = state.get("pending_battle")
        if not isinstance(pending_battle, Mapping):
            return
        attacker_player = pending_battle.get("attacker_player")
        attacker_id = pending_battle.get("attacker_instance_id")
        found = find_card(state, attacker_id) if isinstance(attacker_id, str) else None
        if (
            found
            and attacker_player in {"player", "ai"}
            and found[0] == attacker_player
            and found[1] == "monster_zone"
            and _level(found[3]) >= 4
            and not _is_protected(state, attacker_player, context.player)
        ):
            state.setdefault("battle", {})["attack_cancelled"] = True

    registry.register(
        _trap_definition(
            "t-gravity-bind",
            gravity_bind_activate,
            can_chain=False,
        )
    )

    # t-solemn-wishes — Ân Huệ Của Thần: hồi 500 LP mỗi khi chủ bài rút bài.
    registry.register(
        _trap_definition(
            "t-solemn-wishes",
            lambda _state, _context: None,
        )
    )

    # t-dragon-capture-jar — Hũ Nhốt Rồng: chuyển các Rồng ngửa sang Thế Thủ và khóa đổi thế.
    def dragon_capture_jar(state: dict[str, Any], context: EffectContext) -> None:
        for player in ("player", "ai"):
            for monster in _cards(state, player, "monster_zone"):
                if (
                    monster
                    and not monster.get("face_down", False)
                    and _is_dragon(monster)
                    and not _is_protected(
                        state,
                        player,
                        context.player,
                    )
                ):
                    monster["position"] = "defense"

    registry.register(_trap_definition("t-dragon-capture-jar", dragon_capture_jar))

    def bind_monster(state: dict[str, Any], context: EffectContext) -> None:
        target_id = context.target_instance_ids[0]
        source = find_card(state, context.source_instance_id)
        if not source or source[1] != "spell_trap_zone":
            return
        source[3]["target_instance_id"] = target_id
        pending_battle = state.get("pending_battle")
        if (
            isinstance(pending_battle, Mapping)
            and pending_battle.get("attacker_instance_id") == target_id
        ):
            state.setdefault("battle", {})["attack_cancelled"] = True

    # t-spellbinding-circle — Vòng Tròn Pháp Thuật: khóa tấn công/đổi thế; tự hủy khi mục tiêu bị phá hủy.
    registry.register(
        _trap_definition(
            "t-spellbinding-circle",
            bind_monster,
            target_validator=lambda state, target, context: _target_in_zone(
                state,
                target,
                frozenset({"monster_zone"}),
                owner=opponent_of(context.player),
                category="monster",
                face_up=True,
            ),
            requires_target=True,
        )
    )

    def shadow_spell(state: dict[str, Any], context: EffectContext) -> None:
        bind_monster(state, context)
        target_id = context.target_instance_ids[0]
        updated = add_stat_modifier(
            state,
            target_instance_id=target_id,
            source_instance_id=context.source_instance_id,
            source_card_id=context.card_id,
            owner=context.player,
            stat="atk",
            operation="decrease",
            value=700,
            duration={"type": "target_leaves_field"},
        )
        _replace_state(state, updated)

    # t-shadow-spell — Lời Nguyền Bóng Tối: giảm 700 ATK, khóa tấn công/đổi thế đến khi mục tiêu rời sân.
    registry.register(
        _trap_definition(
            "t-shadow-spell",
            shadow_spell,
            target_validator=lambda state, target, context: _target_in_zone(
                state,
                target,
                frozenset({"monster_zone"}),
                owner=opponent_of(context.player),
                category="monster",
                face_up=True,
            ),
            requires_target=True,
        )
    )

    # Bánh Xe Ác Mộng: khóa quái thú đối thủ, gây 500 sát thương mỗi Standby Phase.
    def nightmare_wheel(state: dict[str, Any], context: EffectContext) -> None:
        target_id = context.target_instance_ids[0]
        source = find_card(state, context.source_instance_id)
        if source and source[1] == "spell_trap_zone":
            source[3]["target_instance_id"] = target_id
            pending_battle = state.get("pending_battle")
            if (
                isinstance(pending_battle, Mapping)
                and pending_battle.get("attacker_instance_id") == target_id
            ):
                state.setdefault("battle", {})["attack_cancelled"] = True

    registry.register(
        _trap_definition(
            "t-nightmare-wheel",
            nightmare_wheel,
            target_validator=lambda state, target, context: _target_in_zone(
                state,
                target,
                frozenset({"monster_zone"}),
                owner=opponent_of(context.player),
                category="monster",
                face_up=True,
            ),
            requires_target=True,
        )
    )

    # Tiếng Gọi Của Cái Chết Và Sự Sống: hồi sinh quái thú trong Mộ và gắn nó với lá Bẫy.
    def call_of_the_haunted(state: dict[str, Any], context: EffectContext) -> None:
        target_id = context.target_instance_ids[0]
        if _special_summon(state, context.player, target_id):
            source = find_card(state, context.source_instance_id)
            if source and source[1] == "spell_trap_zone":
                source[3]["target_instance_id"] = target_id

    def call_of_the_haunted_condition(
        state: Mapping[str, Any], context: EffectContext
    ) -> bool:
        return (
            _can_activate_set_trap(state, context)
            and _empty_monster_zone(state, context.player) is not None
        )

    registry.register(
        _trap_definition(
            "t-call-of-the-haunted",
            call_of_the_haunted,
            target_validator=lambda state, target, _context: (
                _special_summon_target_in_zone(
                    state,
                    target,
                    frozenset({"graveyard"}),
                )
                and _empty_monster_zone(state, _context.player) is not None
            ),
            requires_target=True,
            can_activate=call_of_the_haunted_condition,
        )
    )


def _register_counter_traps(registry: EffectRegistry) -> None:
    def previous_link(
        state: Mapping[str, Any], context: EffectContext
    ) -> Mapping[str, Any] | None:
        chain = state.get("chain", {})
        links = chain.get("links", [])
        if (
            chain.get("status") != "open"
            or not links
            or links[-1].get("player") == context.player
        ):
            return None
        return links[-1]

    def negate_previous_link(
        state: dict[str, Any],
        context: EffectContext,
        *,
        expected_category: str,
        opponent_draws: bool = False,
    ) -> None:
        source = find_card(state, context.source_instance_id)
        if source and source[1] == "spell_trap_zone":
            source[3]["face_down"] = False

        links = state.get("chain", {}).get("links", [])
        source_index = next(
            (
                index
                for index, link in enumerate(links)
                if link.get("source_instance_id") == context.source_instance_id
            ),
            None,
        )
        if source_index is None or source_index == 0:
            return
        link = links[source_index - 1]
        if (
            link.get("player") == context.player
            or not str(link.get("card_id", "")).startswith(expected_category)
        ):
            return

        link["negated"] = True
        negated_source = find_card(state, link.get("source_instance_id"))
        if negated_source and negated_source[1] == "spell_trap_zone":
            destroy_card(
                state,
                negated_source[3]["instance_id"],
                by_player=context.player,
            )
        if opponent_draws and not state.get("over"):
            _draw(state, opponent_of(context.player), 1)

        source = find_card(state, context.source_instance_id)
        if source and source[1] == "spell_trap_zone":
            move_card(state, context.source_instance_id, context.player, "graveyard")

    def register(
        card_id: str,
        *,
        expected_category: str | tuple[str, ...],
        lp_cost: int = 0,
        opponent_draws: bool = False,
    ) -> None:
        def can_activate(
            state: Mapping[str, Any], context: EffectContext
        ) -> bool:
            target_link = previous_link(state, context)
            return bool(
                _can_activate_set_trap(state, context)
                and target_link
                and (
                    not lp_cost
                    or state["players"][context.player]["lp"] >= lp_cost
                )
                and str(target_link.get("card_id", "")).startswith(expected_category)
            )

        def resolve(state: dict[str, Any], context: EffectContext) -> None:
            negate_previous_link(
                state,
                context,
                expected_category=expected_category,
                opponent_draws=opponent_draws,
            )

        def pay_cost(state: dict[str, Any], context: EffectContext) -> None:
            if lp_cost:
                change_life_points(state, context.player, -lp_cost)

        registry.register(
            EffectDefinition(
                card_id=card_id,
                effect_id="activate",
                effect_type="activated",
                speed=3,
                resolve=resolve,
                can_activate=can_activate,
                on_activate=pay_cost if lp_cost else None,
                source_zones=frozenset({"spell_trap_zone"}),
                phases=frozenset(
                    {"draw", "standby", "main1", "battle", "main2", "end"}
                ),
                can_chain=True,
            )
        )

    # Bảy Món Đồ Của Tên Trộm: trả 500 LP để vô hiệu hóa và phá hủy một Lá Bẫy.
    register(
        "t-seven-tools-of-the-bandit",
        expected_category="t-",
        lp_cost=500,
    )

    # Chặn Bẫy: vô hiệu hóa và phá hủy một Lá Bẫy vừa được kích hoạt.
    register("t-trap-jammer", expected_category="t-")

    # Mua Chuộc: vô hiệu hóa và phá hủy Lá Phép/Bẫy; đối thủ rút 1 lá.
    register(
        "t-dark-bribe",
        expected_category=("s-", "t-"),
        opponent_draws=True,
    )

    # Pháp Trận Quấy Nhiễu: hủy kích hoạt Lá Phép.
    register("t-magic-jammer", expected_category="s-")


def _register_attack_traps(
    registry: EffectRegistry,
    rng: Callable[[], float],
) -> None:
    def attacker(state: Mapping[str, Any], context: EffectContext) -> tuple[str, dict[str, Any]] | None:
        attacker_id = (
            context.payload.get("attacker_instance_id")
            or (state.get("pending_battle") or {}).get("attacker_instance_id")
        )
        found = find_card(state, attacker_id) if isinstance(attacker_id, str) else None
        if (
            not found
            or found[1] != "monster_zone"
            or found[0] == context.player
            or found[3].get("face_down", False)
            or found[3].get("position") == "defense"
        ):
            return None
        return found[0], found[3]

    def battle_condition(state: Mapping[str, Any], context: EffectContext) -> bool:
        return _can_activate_set_trap(state, context) and attacker(state, context) is not None

    def ordeal_condition(state: Mapping[str, Any], context: EffectContext) -> bool:
        source = find_card(state, context.source_instance_id)
        return bool(
            attacker(state, context)
            and source
            and source[1] == "spell_trap_zone"
            and source[3].get("category") == "trap"
            and (
                _can_activate_set_trap(state, context)
                or not source[3].get("face_down", False)
            )
            and _cards(state, context.player, "hand")
        )

    def ordeal_of_a_traveler(state: dict[str, Any], context: EffectContext) -> None:
        attacker_data = attacker(state, context)
        hand = _cards(state, context.player, "hand")
        if not attacker_data or not hand:
            return

        selected_card = hand[min(int(rng() * len(hand)), len(hand) - 1)]
        selected_category = selected_card.get("category")
        selected_type = (
            "monster"
            if selected_category in {"monster", "fusion"}
            else selected_category
        )
        attacker_player, attacking_monster = attacker_data
        state.setdefault("battle", {})

        if attacker_player == "player":
            state["_ordeal_traveler_pending"] = {
                "selected_type": selected_type,
                "attacker_instance_id": attacking_monster["instance_id"],
            }
            state["pending_decision"] = {
                "type": "ordeal_traveler_guess",
                "player": "player",
                "source_instance_id": context.source_instance_id,
            }
            return

        guess_types = ("monster", "spell", "trap")
        guessed_type = guess_types[
            min(int(rng() * len(guess_types)), len(guess_types) - 1)
        ]
        if guessed_type != selected_type:
            move_card(
                state,
                attacking_monster["instance_id"],
                attacking_monster.get("owner", attacker_player),
                "hand",
            )
            state["battle"]["attack_cancelled"] = True

    def register(
        card_id: str,
        action: EffectAction,
        *,
        keep: bool = False,
        condition: Callable[[Mapping[str, Any], EffectContext], bool] | None = None,
    ) -> None:
        def resolve(state: dict[str, Any], context: EffectContext) -> None:
            source = find_card(state, context.source_instance_id)
            if source:
                source[3]["face_down"] = False
            action(state, context)
            source = find_card(state, context.source_instance_id)
            if source and not keep:
                _move_to_grave(state, context.source_instance_id)

        registry.register(
            EffectDefinition(
                card_id=card_id,
                effect_id="attack",
                effect_type="trigger",
                speed=2,
                resolve=resolve,
                can_activate=condition or battle_condition,
                source_zones=frozenset({"spell_trap_zone"}),
                phases=frozenset({"battle"}),
                can_chain=True,
            )
        )

    # Vòng Tròn Của Phù Thuật — khi quái thú Phù thủy tấn công, triệu hồi quái thú Phù thủy ≤2000 ATK.
    def magicians_circle(state: dict[str, Any], context: EffectContext) -> None:
        target = attacker(state, context)
        if not target:
            return
        attacking_player, attacking_monster = target
        if not _is_spellcaster(attacking_monster):
            return
        for owner in ("player", "ai"):
            candidates = [
                card
                for card in _cards(state, owner, "deck")
                if card.get("category") == "monster"
                and _is_spellcaster(card)
                and int(card.get("atk", card.get("base_atk", 0)) or 0) <= 2000
            ]
            slot = _empty_monster_zone(state, owner)
            if candidates and slot is not None:
                summoned = move_card(
                    state,
                    candidates[0]["instance_id"],
                    owner,
                    "monster_zone",
                    destination_index=slot,
                )
                summoned["face_down"] = False
                summoned["position"] = "attack"
                summoned["summon_method"] = "special"
                summoned["summoned_turn"] = state["turn"]
                resolve_monster_summon_effects(
                    state, owner, summoned["instance_id"], "special"
                )

    register("t-magicians-circle", magicians_circle)

    # Boomerang Sắt — chuyển quái thú tấn công sang Phòng thủ hoặc trang bị tăng 500 ATK.
    def kunai_with_chain(state: dict[str, Any], context: EffectContext) -> None:
        target = attacker(state, context)
        if not target:
            return
        _, monster = target
        mode = context.payload.get("mode")
        if mode in {"defense", "both"}:
            monster["position"] = "defense"
        if mode in {"equip", "both"}:
            state["lacooda"] = state.get("lacooda", {})
            updated = add_stat_modifier(
                state,
                target_instance_id=monster["instance_id"],
                source_instance_id=context.source_instance_id,
                source_card_id="t-kunai-with-chain",
                owner=context.player,
                stat="atk",
                operation="increase",
                value=500,
                duration={"type": "target_leaves_field"},
            )
            _replace_state(state, updated)

    register("t-kunai-with-chain", kunai_with_chain)

    # t-mirror-force — Gương Phản Chiếu: phá hủy quái thú Tấn Công ngửa của đối thủ và hủy đòn tấn công.
    def mirror_force(state: dict[str, Any], context: EffectContext) -> None:
        attacking_player = context.payload.get("attacker_player")
        if attacking_player not in {"player", "ai"}:
            return
        if state.get("effect_protection", {}).get(attacking_player) == state["turn"]:
            return
        for monster in list(_cards(state, attacking_player, "monster_zone")):
            if monster and not monster.get("face_down", False) and monster.get("position") != "defense":
                destroy_card(
                    state, monster["instance_id"], by_player=context.player
                )
        state.setdefault("battle", {})["attack_cancelled"] = True

    register("t-mirror-force", mirror_force)

    # t-magic-cylinder — Trụ Ma Thuật: hủy đòn tấn công và gây sát thương bằng ATK của quái thú tấn công.
    def magic_cylinder(state: dict[str, Any], context: EffectContext) -> None:
        target = attacker(state, context)
        if not target:
            return
        player, monster = target
        damage = max(0, current_stats(state, monster["instance_id"])["atk"])
        change_life_points(state, player, -damage)
        state.setdefault("battle", {})["attack_cancelled"] = True

    register("t-magic-cylinder", magic_cylinder)

    # t-ring-of-destruction — Vòng Hủy Diệt: khi đối thủ tuyên bố tấn công, nhắm quái thú đang tấn công, phá hủy nó và gây thiệt hại ATK vào LP đối thủ.
    def ring_condition(state: Mapping[str, Any], context: EffectContext) -> bool:
        target = attacker(state, context)
        return bool(
            _can_activate_set_trap(state, context)
            and target is not None
            and not _is_protected(state, target[0], context.player)
        )

    def ring_of_destruction(state: dict[str, Any], context: EffectContext) -> None:
        target = attacker(state, context)
        if not target:
            return
        attacking_player, attacking_monster = target
        if _is_protected(state, attacking_player, context.player):
            return
        damage = max(0, current_stats(state, attacking_monster["instance_id"])["atk"])
        destroyed = destroy_card(
            state, attacking_monster["instance_id"], by_player=context.player
        )
        if destroyed and not state.get("over"):
            change_life_points(state, attacking_player, -damage)

    register(
        "t-ring-of-destruction",
        ring_of_destruction,
        condition=ring_condition,
    )

    # t-skull-dice — Xúc Xắc Tiểu Quỷ: khi đối thủ tấn công, chia ATK/DEF quái thú đối thủ theo số nút xúc xắc.
    register(
        "t-skull-dice",
        lambda state, context: _apply_dice_stat_modifier(
            state, context, opponent_of(context.player), "divide", rng
        ),
    )

    # Thử Thách Kẻ Du Hành — chọn ngẫu nhiên lá trên tay chủ bẫy; sai thì trả quái tấn công về tay.
    register(
        "t-ordeal-of-a-traveler",
        ordeal_of_a_traveler,
        keep=True,
        condition=ordeal_condition,
    )

    # t-waboku — Hòa Bình: ngăn sát thương và phá hủy trong chiến đấu đến hết lượt.
    def waboku(state: dict[str, Any], context: EffectContext) -> None:
        state["battle_protection"] = {
            "player": context.player,
            "turn": state["turn"],
        }

    register("t-waboku", waboku)

    # t-negate-attack — Vô Hiệu Hóa Tấn Công: hủy đòn tấn công và kết thúc Battle Phase.
    def negate_attack(state: dict[str, Any], _context: EffectContext) -> None:
        state.setdefault("battle", {}).update(
            {"attack_cancelled": True, "phase_ended": True}
        )

    register("t-negate-attack", negate_attack)

    # t-scrap-iron-scarecrow — Bù Nhìn Sắt Vụn: hủy đòn tấn công rồi úp lại chính lá này.
    def scarecrow(state: dict[str, Any], context: EffectContext) -> None:
        state.setdefault("battle", {})["attack_cancelled"] = True
        source = find_card(state, context.source_instance_id)
        if source:
            source[3]["face_down"] = True
            source[3]["set_turn"] = state["turn"]

    register("t-scrap-iron-scarecrow", scarecrow, keep=True)

    # t-silent-commander — Chỉ Huy Im Lặng: hủy đòn tấn công, kết thúc Battle Phase và rút 2 lá.
    def silent_commander(state: dict[str, Any], context: EffectContext) -> None:
        negate_attack(state, context)
        _draw(state, context.player, 2)

    register("t-silent-commander", silent_commander)

    def gravity_bind_attack_condition(
        state: Mapping[str, Any], context: EffectContext
    ) -> bool:
        if not battle_condition(state, context):
            return False
        target = attacker(state, context)
        if not target:
            return False
        attacking_player, attacking_monster = target
        return (
            _level(attacking_monster) >= 4
            and not _is_protected(state, attacking_player, context.player)
        )

    def gravity_bind_on_attack(
        state: dict[str, Any], context: EffectContext
    ) -> None:
        target = attacker(state, context)
        if not target:
            return
        attacking_player, attacking_monster = target
        if (
            _level(attacking_monster) >= 4
            and not _is_protected(state, attacking_player, context.player)
        ):
            state.setdefault("battle", {})["attack_cancelled"] = True

    register(
        "t-gravity-bind",
        gravity_bind_on_attack,
        keep=True,
        condition=gravity_bind_attack_condition,
    )

    def targeted_bind_attack_condition(
        state: Mapping[str, Any], context: EffectContext
    ) -> bool:
        if not battle_condition(state, context):
            return False
        target = attacker(state, context)
        if not target:
            return False
        attacking_player, _attacking_monster = target
        return not _is_protected(state, attacking_player, context.player)

    def spellbinding_on_attack(
        state: dict[str, Any], context: EffectContext
    ) -> None:
        target = attacker(state, context)
        source = find_card(state, context.source_instance_id)
        if not target or not source or source[1] != "spell_trap_zone":
            return
        attacking_player, attacking_monster = target
        if _is_protected(state, attacking_player, context.player):
            return
        source[3]["target_instance_id"] = attacking_monster["instance_id"]
        state.setdefault("battle", {})["attack_cancelled"] = True

    def shadow_spell_on_attack(
        state: dict[str, Any], context: EffectContext
    ) -> None:
        target = attacker(state, context)
        source = find_card(state, context.source_instance_id)
        if not target or not source or source[1] != "spell_trap_zone":
            return
        attacking_player, attacking_monster = target
        if _is_protected(state, attacking_player, context.player):
            return
        target_id = attacking_monster["instance_id"]
        source[3]["target_instance_id"] = target_id
        updated = add_stat_modifier(
            state,
            target_instance_id=target_id,
            source_instance_id=context.source_instance_id,
            source_card_id=context.card_id,
            owner=context.player,
            stat="atk",
            operation="decrease",
            value=700,
            duration={"type": "target_leaves_field"},
        )
        _replace_state(state, updated)
        state.setdefault("battle", {})["attack_cancelled"] = True

    register(
        "t-spellbinding-circle",
        spellbinding_on_attack,
        keep=True,
        condition=targeted_bind_attack_condition,
    )
    register(
        "t-shadow-spell",
        shadow_spell_on_attack,
        keep=True,
        condition=targeted_bind_attack_condition,
    )
    register(
        "t-nightmare-wheel",
        spellbinding_on_attack,
        keep=True,
        condition=targeted_bind_attack_condition,
    )

    def compulsory_evacuation_on_attack(
        state: dict[str, Any], context: EffectContext
    ) -> None:
        target = attacker(state, context)
        if not target:
            return
        attacking_player, attacking_monster = target
        if _is_protected(state, attacking_player, context.player):
            return
        _return_monster_to_controller_hand(state, attacking_player, attacking_monster)
        state.setdefault("battle", {})["attack_cancelled"] = True

    register(
        "t-compulsory-evacuation-device",
        compulsory_evacuation_on_attack,
        condition=targeted_bind_attack_condition,
    )

    def crush_card_virus_can_activate(
        state: Mapping[str, Any], context: EffectContext
    ) -> bool:
        return bool(
            battle_condition(state, context)
            and _is_crush_card_virus_attack_target(
                state,
                context.player,
                context.payload.get("defender_instance_id"),
            )
        )

    def crush_card_virus(state: dict[str, Any], context: EffectContext) -> None:
        source = find_card(state, context.source_instance_id)
        target_id = context.payload.get("defender_instance_id")
        if (
            not source
            or source[1] != "spell_trap_zone"
            or not isinstance(target_id, str)
            or not _is_crush_card_virus_attack_target(
                state, context.player, target_id
            )
        ):
            return
        source[3]["face_down"] = False
        source[3]["crush_card_virus_armed"] = True
        source[3]["crush_card_virus_target_instance_id"] = target_id

    registry.register(
        EffectDefinition(
            card_id=CRUSH_CARD_VIRUS_ID,
            effect_id="attack",
            effect_type="trigger",
            speed=2,
            resolve=crush_card_virus,
            can_activate=crush_card_virus_can_activate,
            source_zones=frozenset({"spell_trap_zone"}),
            phases=frozenset({"battle"}),
            can_chain=True,
            discard_source_after_resolution=True,
        )
    )


def _register_cloning_trap(registry: EffectRegistry) -> None:
    def target_is_valid(
        state: Mapping[str, Any],
        target_instance_id: str,
        context: EffectContext,
    ) -> bool:
        target = find_card(state, target_instance_id)
        return bool(
            target
            and target[0] == opponent_of(context.player)
            and target[1] == "monster_zone"
            and target[3].get("category") in {"monster", "fusion"}
            and not target[3].get("face_down", False)
            and target[3].get("summon_method") in {"normal", "tribute", "special"}
            and target[3].get("summoned_turn") == state["turn"]
            and _empty_monster_zone(state, context.player) is not None
        )

    def can_activate(
        state: Mapping[str, Any], context: EffectContext
    ) -> bool:
        target_id = context.target_instance_ids[0] if context.target_instance_ids else None
        activation = state.get("_cloning_activation")
        return bool(
            activation
            and activation.get("player") == context.player
            and activation.get("source_instance_id") == context.source_instance_id
            and activation.get("summoned_instance_id") == target_id
            and _can_activate_set_trap(state, context)
            and not trap_effect_is_negated(state, context.player)
            and isinstance(target_id, str)
            and target_is_valid(state, target_id, context)
        )

    def resolve(state: dict[str, Any], context: EffectContext) -> None:
        target_id = context.target_instance_ids[0]
        found = find_card(state, target_id)
        zone_index = _empty_monster_zone(state, context.player)
        if not found or zone_index is None:
            return
        original = found[3]
        base_atk = original.get("base_atk", original.get("atk", 0))
        base_def = original.get("base_def", original.get("def", 0))
        token = {
            "instance_id": str(uuid4()),
            "card_id": "token-clone",
            "id": "token-clone",
            "name": "Clone Token",
            "category": "monster",
            "owner": context.player,
            "controller": context.player,
            "is_token": True,
            "token_source_instance_id": target_id,
            "level": deepcopy(original.get("level")),
            "attribute": deepcopy(original.get("attribute")),
            "race": deepcopy(original.get("race")),
            "atk": base_atk,
            "def": base_def,
            "base_atk": base_atk,
            "base_def": base_def,
            "face_down": False,
            "position": "attack",
            "summon_method": "special",
            "summoned_turn": state["turn"],
        }
        for field in ("image", "monsterType"):
            if field in original:
                token[field] = deepcopy(original[field])
        _cards(state, context.player, "monster_zone")[zone_index] = token
        resolve_monster_summon_effects(
            state, context.player, token["instance_id"], "special"
        )

    registry.register(
        EffectDefinition(
            card_id=CLONING_TRAP_ID,
            effect_id="activate",
            effect_type="trigger",
            speed=2,
            resolve=resolve,
            can_activate=can_activate,
            target_is_valid=target_is_valid,
            source_zones=frozenset({"spell_trap_zone"}),
            phases=frozenset({"draw", "standby", "main1", "battle", "main2", "end"}),
            requires_target=True,
            can_chain=True,
            discard_source_after_resolution=True,
        )
    )


def resolve_standby_effects(state: dict[str, Any], phase_player: str) -> None:
    """Resolve the existing Rain of Mercy and Counterbalance standby triggers."""
    if phase_player not in {"player", "ai"}:
        raise DuelRuleError("Người chơi không hợp lệ.")
    monster_count = sum(
        card is not None
        for player in ("player", "ai")
        for card in _cards(state, player, "monster_zone")
    )
    standby_key = (state["turn"], phase_player)
    # Người Đá Dung Nham gây 1000 sát thương cho người đang điều khiển nó.
    for monster in _cards(state, phase_player, "monster_zone"):
        if (
            monster
            and monster.get("card_id") == "m-lava-golem"
            and not monster.get("monster_effects_negated", False)
            and monster.get("last_standby_key") != standby_key
        ):
            monster["last_standby_key"] = standby_key
            change_life_points(state, phase_player, -1000)
            if state.get("over"):
                return

    for owner in ("player", "ai"):
        for card in _cards(state, owner, "spell_trap_zone"):
            if not card or card.get("face_down", False) or card.get("last_standby_key") == standby_key:
                continue
            if card.get("card_id") == "s-rain-of-mercy" and owner == phase_player:
                change_life_points(state, owner, 1000)
                card["last_standby_key"] = standby_key
            elif card.get("card_id") == "s-counterbalance-card" and owner != phase_player:
                opponent = opponent_of(owner)
                deck = _cards(state, opponent, "deck")
                for _ in range(min(monster_count, len(deck))):
                    move_card(state, deck[-1]["instance_id"], opponent, "graveyard")
                card["last_standby_key"] = standby_key
            elif card.get("card_id") == "t-life-shaver" and owner == phase_player:
                elapsed_turns = max(
                    1,
                    state["turn"] - int(card.get("set_turn", state["turn"])),
                )
                opponent = opponent_of(owner)
                for _ in range(min(elapsed_turns, len(_cards(state, opponent, "hand")))):
                    hand_card = _cards(state, opponent, "hand")[0]
                    move_card(
                        state,
                        hand_card["instance_id"],
                        opponent,
                        "graveyard",
                    )
                card["last_standby_key"] = standby_key
    for owner in ("player", "ai"):
        for card in _cards(state, owner, "spell_trap_zone"):
            if (
                not card
                or card.get("face_down", False)
                or card.get("card_id")
                not in {"s-mask-of-the-accursed", "t-nightmare-wheel"}
                or card.get("last_standby_key") == standby_key
            ):
                continue
            target = find_card(state, card.get("target_instance_id"))
            if not target or target[1] != "monster_zone":
                continue
            card["last_standby_key"] = standby_key
            damaged_player = (
                target[0]
                if card["card_id"] == "s-mask-of-the-accursed"
                else opponent_of(owner)
            )
            change_life_points(state, damaged_player, -500)
            if state.get("over"):
                return


def resolve_end_phase_effects(state: dict[str, Any], ending_player: str) -> None:
    """Resolve temporary control and Swords' three-opponent-turn duration."""
    if ending_player not in {"player", "ai"}:
        raise DuelRuleError("Người chơi không hợp lệ.")
    for controller in ("player", "ai"):
        for monster in list(_cards(state, controller, "monster_zone")):
            temporary = monster.get("temporary_control") if monster else None
            if not temporary or temporary.get("turn") != state["turn"]:
                continue
            destination_player = temporary.get("return_to")
            if destination_player not in {"player", "ai"}:
                raise DuelRuleError("Thông tin quyền điều khiển tạm thời không hợp lệ.")
            destination_index = temporary.get("zone_index")
            if (
                not isinstance(destination_index, int)
                or isinstance(destination_index, bool)
                or not 0 <= destination_index < 5
                or _cards(state, destination_player, "monster_zone")[destination_index]
            ):
                destination_index = _empty_monster_zone(state, destination_player)
            monster.pop("temporary_control", None)
            if destination_index is None:
                move_card(
                    state,
                    monster["instance_id"],
                    destination_player,
                    "graveyard",
                )
            else:
                move_card(
                    state,
                    monster["instance_id"],
                    destination_player,
                    "monster_zone",
                    destination_index=destination_index,
                )

    for owner in ("player", "ai"):
        for spell in list(_cards(state, owner, "spell_trap_zone")):
            if (
                not spell
                or spell.get("card_id") != "s-swords-of-revealing-light"
                or spell.get("face_down", False)
                or owner == ending_player
            ):
                continue
            opponent_ends = spell.get("opponent_ends", 0) + 1
            if opponent_ends >= 3:
                destroy_card(state, spell["instance_id"])
            else:
                spell["opponent_ends"] = opponent_ends
    if ending_player == state["turn_player"]:
        # Thần Rồng Osiris: trong Giai đoạn Kết thúc, nếu được Triệu hồi Đặc biệt thì đưa vào Mộ.
        for owner in ("player", "ai"):
            for monster in list(_cards(state, owner, "monster_zone")):
                if (
                    not monster
                    or monster.get("card_id") != "m-slifer-the-sky-dragon"
                    or monster.get("face_down", False)
                    or monster.get("summon_method") != "special"
                    or monster_effects_are_negated(state, monster["instance_id"])
                ):
                    continue
                _move_to_grave(state, monster["instance_id"])
        # Rồng Hủy Diệt Gandora: tự gửi vào Mộ nếu được Triệu hồi Thường/Lật lượt này.
        for owner in ("player", "ai"):
            for monster in list(_cards(state, owner, "monster_zone")):
                if (
                    not monster
                    or monster.get("card_id") != GANDORA_ID
                    or monster.get("monster_effects_negated", False)
                    or not (
                        (
                            monster.get("summoned_turn") == state["turn"]
                            and monster.get("summon_method") in {"normal", "tribute"}
                        )
                        or monster.get("flip_summoned_turn") == state["turn"]
                    )
                ):
                    continue
                _move_to_grave(state, monster["instance_id"])
    if ending_player == state["turn_player"]:
        state["effect_protection"] = {
            player: turn
            for player, turn in state.get("effect_protection", {}).items()
            if turn != state["turn"]
        }
        state["card_effect_protection"] = {
            instance_id: turn
            for instance_id, turn in state.get("card_effect_protection", {}).items()
            if turn != state["turn"]
        }
        protection = state.get("battle_protection", {})
        if protection.get("turn") == state["turn"]:
            state.pop("battle_protection", None)


def can_declare_attack(
    state: Mapping[str, Any], player: str, monster_instance_id: str
) -> bool:
    if player not in {"player", "ai"}:
        raise DuelRuleError("Người chơi không hợp lệ.")
    found = find_card(state, monster_instance_id)
    if not found or found[0] != player or found[1] != "monster_zone":
        return False
    monster = found[3]
    if (
        monster.get("face_down", False)
        or monster.get("position") == "defense"
        or monster.get("cannot_attack_turn") == state["turn"]
        or monster.get("cannot_attack_until_turn", -1) >= state["turn"]
        or _is_prevented_from_attacking(state, monster_instance_id)
        or _is_battle_locked_by_trap(state, player, monster_instance_id)
    ):
        return False
    opponent = opponent_of(player)
    for card in _cards(state, opponent, "spell_trap_zone"):
        if not card or card.get("face_down", False):
            continue
        if card.get("card_id") == "s-swords-of-revealing-light" and not _is_protected(
            state, player, opponent
        ):
            return False
        if (
            card.get("card_id") == "t-gravity-bind"
            and _level(monster) >= 4
            and not trap_effect_is_negated(state, opponent)
            and not _is_protected(state, player, opponent)
        ):
            return False
    return True


def can_change_battle_position(
    state: Mapping[str, Any], player: str, monster_instance_id: str
) -> bool:
    if player not in {"player", "ai"}:
        raise DuelRuleError("Người chơi không hợp lệ.")
    found = find_card(state, monster_instance_id)
    if not found or found[0] != player or found[1] != "monster_zone":
        return False
    if found[3].get("cannot_change_position_until_turn", -1) >= state["turn"]:
        return False
    if _is_battle_locked_by_trap(state, player, monster_instance_id):
        return False
    dragon_jar_active = any(
        card
        and card.get("card_id") == "t-dragon-capture-jar"
        and not card.get("face_down", False)
        and not trap_effect_is_negated(state, owner)
        and (
            owner == player
            or state.get("effect_protection", {}).get(player) != state["turn"]
        )
        for owner in ("player", "ai")
        for card in _cards(state, owner, "spell_trap_zone")
    )
    return not (dragon_jar_active and _is_dragon(found[3]))


def is_battle_protected(
    state: Mapping[str, Any], player: str, monster_instance_id: str | None = None
) -> bool:
    if player not in {"player", "ai"}:
        raise DuelRuleError("Người chơi không hợp lệ.")
    if state.get("effect_protection", {}).get(player) == state["turn"]:
        return True
    if (
        monster_instance_id is not None
        and state.get("card_effect_protection", {}).get(monster_instance_id)
        == state["turn"]
    ):
        return True
    protection = state.get("battle_protection", {})
    return (
        protection.get("player") == player
        and protection.get("turn") == state["turn"]
        and not trap_effect_is_negated(state, player)
    )


def _queue_clone_dragon_triggers(
    state: dict[str, Any],
    summoned_player: str,
    monster_instance_id: str,
    summon_method: str,
) -> None:
    if summon_method not in {"normal", "tribute", "special"}:
        return
    summoned = find_card(state, monster_instance_id)
    if (
        not summoned
        or summoned[1] != "monster_zone"
        or summoned[3].get("face_down", False)
        or summoned[0] != summoned_player
    ):
        return
    pending_triggers = state.setdefault("pending_card_triggers", [])
    for clone in _cards(state, summoned_player, "hand"):
        if (
            clone
            and clone.get("card_id") == CLONE_DRAGON_ID
            and not any(
                trigger.get("card_id") == CLONE_DRAGON_ID
                and trigger.get("event") == "summon"
                and trigger.get("source_instance_id") == clone["instance_id"]
                and trigger.get("summoned_instance_id") == monster_instance_id
                for trigger in pending_triggers
            )
        ):
            pending_triggers.append(
                {
                    "card_id": CLONE_DRAGON_ID,
                    "event": "summon",
                    "source_instance_id": clone["instance_id"],
                    "player": summoned_player,
                    "summoned_instance_id": monster_instance_id,
                }
            )


def resolve_monster_summon_effects(
    state: dict[str, Any],
    player: str,
    monster_instance_id: str,
    summon_method: str,
) -> None:
    """Resolve supported summon and Flip effects."""
    if player not in {"player", "ai"}:
        raise DuelRuleError("Người chơi không hợp lệ.")
    summoned = find_card(state, monster_instance_id)
    if not summoned or summoned[1] != "monster_zone":
        return
    _queue_cloning_triggers(state, player, monster_instance_id, summon_method)
    _queue_clone_dragon_triggers(state, player, monster_instance_id, summon_method)
    card_id = summoned[3].get("card_id")
    if monster_effects_are_negated(state, monster_instance_id):
        if card_id == CHAOS_LEVIANEER_ID:
            summoned[3].pop("levianeer_summon_attributes", None)
        return
    if summon_method == "flip":
        resolve_flip_effects(state, player, card_id, monster_instance_id)

    if card_id == CHAOS_LEVIANEER_ID:
        attributes = summoned[3].pop("levianeer_summon_attributes", None)
        if (
            summon_method == "special"
            and isinstance(attributes, list)
            and len(attributes) == 2
            and set(attributes) <= {"LIGHT", "DARK"}
        ):
            summoned[3]["cannot_attack_until_turn"] = state["turn"]
            usage_key = f"{player}:{CHAOS_LEVIANEER_ID}:summon-effect"
            if state.get("effect_uses", {}).get(usage_key) != state["turn"]:
                state.setdefault("effect_uses", {})[usage_key] = state["turn"]
                state.setdefault("pending_card_triggers", []).append(
                    {
                        "card_id": CHAOS_LEVIANEER_ID,
                        "source_instance_id": monster_instance_id,
                        "player": player,
                        "attributes": attributes,
                    }
                )

    # Rồng Hỏa Diệm — sau khi Triệu hồi: có thể bỏ 1 Lá Phép để phá hủy hàng sau đối thủ.
    if card_id == "m-burning-dragon" and summon_method in {"normal", "tribute", "special"}:
        effect_use_key = f"{player}:m-burning-dragon:destroy-backrow"
        spell_cards = [
            card
            for card in _cards(state, player, "hand")
            if card.get("category") == "spell"
        ]
        if (
            state.get("effect_uses", {}).get(effect_use_key) != state["turn"]
            and spell_cards
        ):
            if player == "ai":
                if any(_cards(state, opponent_of(player), "spell_trap_zone")):
                    move_card(
                        state,
                        spell_cards[0]["instance_id"],
                        player,
                        "graveyard",
                    )
                    state.setdefault("effect_uses", {})[effect_use_key] = state["turn"]
                    _destroy_backrow(state, opponent_of(player))
            else:
                state["pending_decision"] = {
                    "type": "burning_dragon_discard",
                    "player": player,
                    "count": 1,
                    "source_instance_id": monster_instance_id,
                    "effect_card_id": card_id,
                    "discard_category": "spell",
                }

    # Berfomet — Triệu hồi Thường hoặc Lật: thêm Gazelle, Vua Thú Huyền Bí từ Bộ bài.
    if card_id == "m-berfomet" and summon_method in {"normal", "flip"}:
        for deck_card in reversed(_cards(state, player, "deck")):
            if deck_card.get("card_id") == "m-gazelle-king-of-mythical-beasts":
                move_card(state, deck_card["instance_id"], player, "hand")
                break

    # Nhà Vua Hiệp Sĩ — khi Triệu hồi Thường trong lúc điều khiển Nữ Hoàng Hiệp Sĩ.
    if card_id == "m-kings-knight" and summon_method == "normal":
        queen_on_field = _face_up_monster(state, player, "m-queens-knight")
        if queen_on_field:
            for deck_card in reversed(_cards(state, player, "deck")):
                if deck_card.get("card_id") == "m-jacks-knight":
                    _special_summon(state, player, deck_card["instance_id"])
                    break

    # Rồng Mắt Lẻ Tiến Công — Hiến tế triệu hồi phá hủy quái thú đối thủ và gây sát thương.
    if card_id == "m-odd-eyes-advance-dragon" and summon_method in {"tribute", "normal"}:
        candidates = [
            monster
            for monster in _cards(state, opponent_of(player), "monster_zone")
            if monster
        ]
        if player == "ai" and candidates:
            target = candidates[0]
            atk = current_stats(state, target["instance_id"])["atk"]
            destroy_card(state, target["instance_id"], by_player=player)
            change_life_points(state, opponent_of(player), -atk)
        elif candidates:
            state["pending_decision"] = {
                "type": "select_field_cards",
                "player": player,
                "source_instance_id": monster_instance_id,
                "effect_card_id": card_id,
                "min_count": 1,
                "max_count": 1,
                "target_mode": "field-opponent-monster",
            }

    # Lạc Đà Ba Bướu — hạ sát thương nhận được bằng cách phủ nhận và rút 3 lá.
    if card_id == "m-3-hump-lacooda" and summon_method in {"normal", "tribute", "special", "flip"}:
        state.setdefault("lacooda", {})[player] = monster_instance_id
    if (
        card_id == CRASS_CLOWN_ID
        and summon_method in {"normal", "tribute", "flip", "special"}
    ):
        opposing_player = opponent_of(player)
        targets = [
            card
            for card in _cards(state, opposing_player, "monster_zone")
            if card and card.get("category") in {"monster", "fusion"}
        ]
        if targets:
            if player == "ai":
                _return_monster_to_owner(state, targets[0]["instance_id"])
            else:
                # Chú Hề Ma Quái: khi được Triệu hồi, chọn quái thú đối thủ để trả về tay chủ sở hữu.
                state["pending_decision"] = {
                    "type": "select_field_cards",
                    "player": player,
                    "source_instance_id": monster_instance_id,
                    "effect_card_id": card_id,
                    "min_count": 1,
                    "max_count": 1,
                    "target_mode": "field-opponent-monster",
                    "target_player": opposing_player,
                }
    if (
        card_id == "m-blue-eyes-solid-dragon"
        and summon_method in {"normal", "tribute", "special"}
    ):
        effect_use_key = f"{player}:m-blue-eyes-solid-dragon:summon-negate"
        targets = [
            monster
            for monster in _cards(state, opponent_of(player), "monster_zone")
            if monster
            and monster.get("category") in {"monster", "fusion"}
            and not monster.get("face_down", False)
        ]
        if (
            targets
            and state.get("effect_uses", {}).get(effect_use_key) != state["turn"]
        ):
            if player == "ai":
                targets[0]["monster_effects_negated"] = True
                state.setdefault("effect_uses", {})[effect_use_key] = state["turn"]
            else:
                state["pending_decision"] = {
                    "type": "select_field_cards",
                    "player": player,
                    "source_instance_id": monster_instance_id,
                    "effect_card_id": card_id,
                    "min_count": 1,
                    "max_count": 1,
                    "target_mode": "field-opponent-monster",
                    "target_player": opponent_of(player),
                }
    if card_id == "m-berfomet" and summon_method in {"normal", "tribute", "flip"}:
        target = next(
            (
                card
                for card in _cards(state, player, "deck")
                if card.get("card_id") == "m-gazelle-king-of-mythical-beasts"
            ),
            None,
        )
        if target:
            move_card(state, target["instance_id"], player, "hand")
    if card_id == "m-mobius-the-frost-monarch" and summon_method == "tribute":
        available_targets = [
            card
            for owner in ("player", "ai")
            for card in _cards(state, owner, "spell_trap_zone")
            if card
            and (
                card.get("category") in {"spell", "trap"}
                or _is_union_equipped_spell(card)
            )
        ]
        if available_targets:
            if player == "ai":
                # Monarch Băng Giá của AI ưu tiên phá tối đa hai lá của người chơi.
                for target in [
                    card
                    for card in _cards(state, opponent_of(player), "spell_trap_zone")
                    if card
                    and (
                        card.get("category") in {"spell", "trap"}
                        or _is_union_equipped_spell(card)
                    )
                ][:2]:
                    destroy_card(state, target["instance_id"], by_player=player)
            else:
                # Monarch Băng Giá: khi Triệu hồi Hiến Tế, chọn tối đa hai lá Phép/Bẫy trên sân.
                state["pending_decision"] = {
                    "type": "select_field_cards",
                    "player": player,
                    "source_instance_id": monster_instance_id,
                    "effect_card_id": card_id,
                    "min_count": 0,
                    "max_count": 2,
                    "target_mode": "field-spell-trap",
                }
    if card_id == "m-caius-the-shadow-monarch" and summon_method == "tribute":
        # Monarch Bóng Tối chỉ chọn bài đối thủ; không có mục tiêu thì vẫn giữ Triệu hồi.
        opposing_player = opponent_of(player)
        available_targets = [
            card
            for zone in ("monster_zone", "spell_trap_zone")
            for card in _cards(state, opposing_player, zone)
            if card
            and card.get("category") in {"monster", "fusion", "spell", "trap"}
        ]
        if available_targets:
            if player == "ai":
                target = next(
                    (
                        card for card in available_targets
                        if card.get("category") in {"monster", "fusion"}
                        and card.get("attribute") == "DARK"
                    ),
                    available_targets[0],
                )
                _resolve_caius_target(state, player, target["instance_id"])
            else:
                # Monarch Bóng Tối: chỉ chọn một lá trên sân đối thủ để loại bỏ.
                state["pending_decision"] = {
                    "type": "select_field_cards",
                    "player": player,
                    "source_instance_id": monster_instance_id,
                    "effect_card_id": card_id,
                    "min_count": 1,
                    "max_count": 1,
                    "target_mode": "field-card",
                    "target_player": opposing_player,
                }


def resolve_flip_effects(
    state: dict[str, Any],
    player: str,
    card_id: str,
    monster_instance_id: str,
) -> None:
    if player not in {"player", "ai"}:
        raise DuelRuleError("Người chơi không hợp lệ.")
    if monster_effects_are_negated(state, monster_instance_id):
        return
    # Bình Cyber: phá hủy quái thú trên sân, rút 5 lá rồi Triệu hồi quái thú Cấp 4 trở xuống.
    if card_id == "m-cyber-jar":
        for owner in ("player", "ai"):
            for monster in list(_cards(state, owner, "monster_zone")):
                if monster:
                    destroy_card(state, monster["instance_id"], by_player=player)
        for owner in ("player", "ai"):
            drawn = _draw(state, owner, 5)
            if drawn:
                for card in list(_cards(state, owner, "hand")):
                    if (
                        card.get("category") in {"monster", "fusion"}
                        and _level(card) <= 4
                    ):
                        position = "attack"
                        slot = _empty_monster_zone(state, owner)
                        if slot is not None:
                            move_card(state, card["instance_id"], owner, "monster_zone")
                            summoned = find_card(state, card["instance_id"])
                            if summoned:
                                summoned[3]["face_down"] = False
                                summoned[3]["position"] = position
                                summoned[3]["summon_method"] = "special"
                                summoned[3]["summoned_turn"] = state["turn"]
                                resolve_monster_summon_effects(
                                    state,
                                    owner,
                                    card["instance_id"],
                                    "special",
                                )
    # Kẻ Tấn Công Bóng Đêm: lật ra chọn một quái thú đối thủ để phá hủy.
    elif card_id == "m-night-assailant":
        targets = [
            card
            for card in _cards(state, opponent_of(player), "monster_zone")
            if card
        ]
        if player == "ai" and targets:
            destroy_card(state, targets[0]["instance_id"], by_player=player)
        elif targets:
            state["pending_decision"] = {
                "type": "select_field_cards",
                "player": player,
                "source_instance_id": monster_instance_id,
                "effect_card_id": card_id,
                "min_count": 1,
                "max_count": 1,
                "target_mode": "field-opponent-monster",
            }
    # Sâu Ăn Lá: gửi tối đa 5 lá trên cùng Bộ bài đối thủ xuống Mộ.
    if card_id == "m-needle-worm":
        opponent = opponent_of(player)
        deck = _cards(state, opponent, "deck")
        for _ in range(min(5, len(deck))):
            move_card(state, deck[-1]["instance_id"], opponent, "graveyard")
    # Bình Biến Hóa: cả hai người chơi bỏ toàn bộ bài trên tay rồi rút 5 lá.
    elif card_id == "m-morphing-jar":
        for owner in ("player", "ai"):
            for card in list(_cards(state, owner, "hand")):
                move_card(state, card["instance_id"], owner, "graveyard")
        for owner in ("player", "ai"):
            _draw(state, owner, 5)
            if state.get("over"):
                return
    # Ryko: phá hủy một lá trên sân, sau đó gửi 3 lá đầu Bộ bài đối thủ xuống Mộ.
    elif card_id == "m-ryko-lightsworn-hunter":
        candidates = [
            card
            for owner in ("player", "ai")
            for zone in ("monster_zone", "spell_trap_zone")
            for card in _cards(state, owner, zone)
            if card and card.get("category") in {"monster", "fusion", "spell", "trap"}
        ]
        opponent = opponent_of(player)
        if player == "ai":
            opposing_candidates = [
                card
                for zone in ("monster_zone", "spell_trap_zone")
                for card in _cards(state, opponent, zone)
                if card and card.get("category") in {"monster", "fusion", "spell", "trap"}
            ]
            target = next(iter(opposing_candidates), next(iter(candidates), None))
            if target:
                destroy_card(state, target["instance_id"], by_player=player)
            _mill_top_cards(state, opponent, 3)
        elif candidates:
            state["pending_decision"] = {
                "type": "select_field_cards",
                "player": player,
                "source_instance_id": monster_instance_id,
                "effect_card_id": card_id,
                "min_count": 1,
                "max_count": 1,
                "target_mode": "field-card-any",
            }
        else:
            _mill_top_cards(state, opponent, 3)


def resolve_attack_trap(
    engine: DuelEffectEngine,
    state: Mapping[str, Any],
    *,
    attacker_player: str,
    attacker_instance_id: str,
) -> dict[str, Any]:
    """Open a Chain with the first eligible set attack-response Trap."""
    if attacker_player not in {"player", "ai"}:
        raise DuelRuleError("Người chơi không hợp lệ.")
    if has_face_up_jinzo(state):
        return dict(state)
    defender = opponent_of(attacker_player)
    pending_battle = state.get("pending_battle")
    defender_instance_id = (
        pending_battle.get("defender_instance_id")
        if isinstance(pending_battle, Mapping)
        else None
    )
    payload = {
        "attacker_player": attacker_player,
        "attacker_instance_id": attacker_instance_id,
        "defender_instance_id": defender_instance_id,
    }
    for card in _cards(state, defender, "spell_trap_zone"):
        is_set_trap = bool(
            card
            and card.get("face_down", False)
            and card.get("set_turn", 0) < state["turn"]
        )
        is_active_ordeal = bool(
            card
            and card.get("card_id") == "t-ordeal-of-a-traveler"
            and not card.get("face_down", False)
        )
        if (
            not card
            or card.get("category") != "trap"
            or not (is_set_trap or is_active_ordeal)
        ):
            continue
        card_id = card.get("card_id")
        if not isinstance(card_id, str):
            continue
        for effect in engine.registry.for_card(card_id):
            if (
                effect.effect_type != "trigger"
                or effect.effect_id != "attack"
                or "spell_trap_zone" not in effect.source_zones
                or "battle" not in effect.phases
            ):
                continue
            context = EffectContext(
                player=defender,
                source_instance_id=card["instance_id"],
                card_id=card_id,
                effect_id=effect.effect_id,
                target_instance_ids=(),
                payload=payload,
            )
            if effect.can_activate and not effect.can_activate(state, context):
                continue
            try:
                return engine.activate(
                    state,
                    player=defender,
                    source_instance_id=card["instance_id"],
                    effect_id=effect.effect_id,
                    payload=payload,
                )
            except DuelRuleError:
                continue
    return dict(state)


def complete_pending_discard(
    state: dict[str, Any],
    player: str,
    instance_ids: list[str],
    *,
    defer_tricky_summon: bool = False,
) -> None:
    """Resolve validated hand discards for effects that require a discard."""
    pending = state.get("pending_decision")
    pending_type = pending.get("type") if pending else None
    if (
        not pending
        or pending_type not in {
            "discard",
            "tricky_discard",
            "spell_recovery_discard",
            "twin_twisters_discard",
            "burning_dragon_discard",
        }
        or pending.get("player") != player
    ):
        raise DuelRuleError("Không có lựa chọn bỏ bài đang chờ.")
    if defer_tricky_summon and pending_type != "tricky_discard":
        raise DuelRuleError("Chỉ có thể hoãn Triệu hồi Tricky sau khi trả chi phí.")
    if (
        not isinstance(instance_ids, list)
        or len(instance_ids) != pending["count"]
        or any(
            not isinstance(instance_id, str) or not instance_id
            for instance_id in instance_ids
        )
        or len(set(instance_ids)) != len(instance_ids)
    ):
        raise DuelRuleError("Cần chọn đúng số lá bài khác nhau.")
    hand_ids = {card["instance_id"] for card in _cards(state, player, "hand")}
    if any(instance_id not in hand_ids for instance_id in instance_ids):
        raise DuelRuleError("Chỉ có thể bỏ lá bài trên tay của mình.")
    source_id = pending["source_instance_id"]
    if pending_type == "burning_dragon_discard":
        source = find_card(state, source_id)
        spell_id = instance_ids[0]
        spell = find_card(state, spell_id)
        effect_use_key = f"{player}:m-burning-dragon:destroy-backrow"
        if (
            pending.get("count") != 1
            or pending.get("effect_card_id") != "m-burning-dragon"
            or pending.get("discard_category") != "spell"
            or not source
            or source[0] != player
            or source[1] != "monster_zone"
            or source[3].get("card_id") != "m-burning-dragon"
            or source[3].get("face_down", False)
            or not spell
            or spell[0] != player
            or spell[1] != "hand"
            or spell[3].get("category") != "spell"
            or state.get("effect_uses", {}).get(effect_use_key) == state["turn"]
        ):
            raise DuelRuleError("Chi phí hoặc điều kiện hiệu ứng Rồng Hỏa Diệm không hợp lệ.")
        move_card(state, spell_id, player, "graveyard")
        state.setdefault("effect_uses", {})[effect_use_key] = state["turn"]
        _destroy_backrow(state, opponent_of(player))
        state["pending_decision"] = None
        return
    if pending_type == "twin_twisters_discard":
        source = find_card(state, source_id)
        if (
            pending["count"] != 1
            or source_id in instance_ids
            or not source
            or source[0] != player
            or source[1] not in {"hand", "spell_trap_zone"}
            or source[3].get("card_id") != "s-twin-twisters"
        ):
            raise DuelRuleError("Lựa chọn chi phí cho Song Bão không hợp lệ.")
        opponent = opponent_of(player)
        if not any(_cards(state, opponent, "spell_trap_zone")):
            raise DuelRuleError(
                "Song Bão chỉ có thể kích hoạt khi đối thủ có Lá Phép/Bẫy trên sân."
            )
        for instance_id in instance_ids:
            move_card(state, instance_id, player, "graveyard")
        if source[1] == "hand":
            moved_source = move_card(state, source_id, player, "spell_trap_zone")
            moved_source["face_down"] = False
        else:
            source[3]["face_down"] = False
        state["pending_decision"] = None
        state["pending_decision"] = {
            "type": "select_field_cards",
            "player": player,
            "source_instance_id": source_id,
            "effect_card_id": "s-twin-twisters",
            "min_count": 1,
            "max_count": 2,
            "target_mode": "field-opponent-spell-trap",
        }
        return
    if pending_type == "tricky_discard":
        source = find_card(state, source_id)
        if (
            pending["count"] != 1
            or source_id in instance_ids
            or not source
            or source[0] != player
            or source[1] != "hand"
            or source[3].get("card_id") != "m-the-tricky"
        ):
            raise DuelRuleError("Lựa chọn bỏ bài cho Tricky không hợp lệ.")
        if _empty_monster_zone(state, player) is None:
            raise DuelRuleError("Không còn ô Quái thú trống để Triệu hồi Tricky.")
        for instance_id in instance_ids:
            move_card(state, instance_id, player, "graveyard")
        state["pending_decision"] = None
        if defer_tricky_summon:
            return
        # Tricky: sau khi trả chi phí, Triệu hồi ngửa ở tư thế Công kích.
        _special_summon(state, player, source_id)
        return

    if pending_type == "spell_recovery_discard":
        effect_card_id = pending.get("effect_card_id")
        rule = SPELL_RECOVERY_RULES.get(effect_card_id)
        source = find_card(state, source_id)
        if (
            pending["count"] != 2
            or not rule
            or not isinstance(pending.get("eligible_target_instance_ids"), list)
            or not pending["eligible_target_instance_ids"]
            or any(
                not isinstance(instance_id, str) or not instance_id
                for instance_id in pending["eligible_target_instance_ids"]
            )
            or len(set(pending["eligible_target_instance_ids"]))
            != len(pending["eligible_target_instance_ids"])
            or source_id in instance_ids
            or not source
            or source[0] != player
            or source[1] != "hand"
            or source[3].get("category") != "spell"
            or source[3].get("card_id") != effect_card_id
        ):
            raise DuelRuleError("Lựa chọn chi phí cho hiệu ứng thu hồi không hợp lệ.")
        if rule["discard_category"] and any(
            find_card(state, instance_id)[3].get("category")
            != rule["discard_category"]
            for instance_id in instance_ids
        ):
            raise DuelRuleError("Sao Chép Ma Thuật chỉ được bỏ Lá Phép làm chi phí.")
        for instance_id in instance_ids:
            move_card(state, instance_id, player, "graveyard")
        state["pending_decision"] = None
        return

    for instance_id in instance_ids:
        move_card(state, instance_id, player, "graveyard")
    state["pending_decision"] = None
    _move_to_grave(state, source_id)


def complete_pending_card_selection(
    state: dict[str, Any], player: str, instance_ids: list[str]
) -> None:
    """Resolve validated field, deck, or Graveyard choices for card effects."""
    pending = state.get("pending_decision")
    if (
        pending
        and pending.get("type") == "select_deck_card"
        and pending.get("player") == player
        and pending.get("effect_card_id") == MANA_ID
    ):
        eligible_target_ids = pending.get("eligible_target_instance_ids")
        source = find_card(state, pending.get("source_instance_id"))
        if (
            pending.get("target_mode") != "mana-dark-magician-girl-summon"
            or pending.get("min_count") != 0
            or pending.get("max_count") != 1
            or not isinstance(eligible_target_ids, list)
            or not eligible_target_ids
            or len(set(eligible_target_ids)) != len(eligible_target_ids)
            or not isinstance(instance_ids, list)
            or len(instance_ids) > 1
            or any(not isinstance(target_id, str) or not target_id for target_id in instance_ids)
            or len(set(instance_ids)) != len(instance_ids)
            or not source
            or source[0] != player
            or source[1] not in {"graveyard", "banished"}
            or source[3].get("card_id") != MANA_ID
        ):
            raise DuelRuleError("Lựa chọn Nữ Phù Thủy Bóng Đêm cho Thần Quan Mana không hợp lệ.")
        if not instance_ids:
            state["pending_decision"] = None
            return
        target = find_card(state, instance_ids[0])
        if (
            instance_ids[0] not in eligible_target_ids
            or not target
            or target[0] != player
            or target[1] not in {"hand", "deck", "graveyard"}
            or target[3].get("card_id") != DARK_MAGICIAN_GIRL_ID
            or target[3].get("category") != "monster"
            or not _can_be_special_summoned(target[3])
            or _empty_monster_zone(state, player) is None
        ):
            raise DuelRuleError("Thần Quan Mana chỉ có thể Triệu hồi Nữ Phù Thủy Bóng Đêm từ tay, Bộ bài hoặc Mộ.")
        target_zone = target[1]
        state["pending_decision"] = None
        if not _special_summon(state, player, target[3]["instance_id"]):
            raise DuelRuleError("Không thể Triệu hồi Nữ Phù Thủy Bóng Đêm đã chọn bằng Thần Quan Mana.")
        summoned = find_card(state, target[3]["instance_id"])
        if summoned:
            summoned[3]["cannot_be_destroyed_by_battle"] = True
        if target_zone == "deck":
            random.shuffle(_cards(state, player, "deck"))
        return

    if (
        pending
        and pending.get("type") == "select_blue_eyes_summon"
        and pending.get("player") == player
    ):
        eligible_target_ids = pending.get("eligible_target_instance_ids")
        source = find_card(state, pending.get("source_instance_id"))
        usage_key = f"{player}:{MAIDEN_ID}"
        min_count = pending.get("min_count")
        if (
            pending.get("effect_card_id") != MAIDEN_ID
            or pending.get("effect_id") not in {"quick_summon", "attack_summon"}
            or pending.get("target_mode") != "hand-deck-grave-blue-eyes"
            or min_count not in {0, 1}
            or pending.get("max_count") != 1
            or not isinstance(eligible_target_ids, list)
            or not eligible_target_ids
            or any(not isinstance(target_id, str) or not target_id for target_id in eligible_target_ids)
            or len(set(eligible_target_ids)) != len(eligible_target_ids)
            or not isinstance(instance_ids, list)
            or len(instance_ids) < min_count
            or len(instance_ids) > 1
            or any(not isinstance(target_id, str) or not target_id for target_id in instance_ids)
            or len(set(instance_ids)) != len(instance_ids)
            or not source
            or source[3].get("card_id") != MAIDEN_ID
            or state.get("effect_uses", {}).get(usage_key) != state["turn"]
        ):
            raise DuelRuleError("Lựa chọn Rồng Trắng Mắt Xanh cho Thiếu Nữ Mắt Xanh không hợp lệ.")
        if not instance_ids:
            state["pending_decision"] = None
            return
        target = find_card(state, instance_ids[0])
        if (
            instance_ids[0] not in eligible_target_ids
            or not target
            or target[0] != player
            or target[1] not in {"hand", "deck", "graveyard"}
            or target[3].get("card_id") != BLUE_EYES_WHITE_DRAGON_ID
            or not _can_be_special_summoned(target[3])
            or _empty_monster_zone(state, player) is None
        ):
            raise DuelRuleError("Thiếu Nữ Mắt Xanh chỉ có thể Triệu hồi một Rồng Trắng Mắt Xanh hợp lệ từ tay, Bộ bài hoặc Mộ.")
        state["pending_decision"] = None
        if not _special_summon(state, player, target[3]["instance_id"]):
            raise DuelRuleError("Không thể Triệu hồi Rồng Trắng Mắt Xanh đã chọn bằng Thiếu Nữ Mắt Xanh.")
        if target[1] == "deck":
            _shuffle(_cards(state, player, "deck"), random.random)
        return

    if (
        pending
        and pending.get("type") == "select_deck_card"
        and pending.get("player") == player
        and pending.get("effect_card_id") == "m-the-white-stone-of-ancients"
    ):
        eligible_target_ids = pending.get("eligible_target_instance_ids")
        source = find_card(state, pending.get("source_instance_id"))
        usage_key = f"{player}:m-the-white-stone-of-ancients"
        if (
            pending.get("target_mode") != "deck-or-hand-blue-eyes-summon"
            or pending.get("min_count") != 0
            or pending.get("max_count") != 1
            or not isinstance(eligible_target_ids, list)
            or not eligible_target_ids
            or len(set(eligible_target_ids)) != len(eligible_target_ids)
            or not isinstance(instance_ids, list)
            or len(instance_ids) > 1
            or any(not isinstance(target_id, str) or not target_id for target_id in instance_ids)
            or len(set(instance_ids)) != len(instance_ids)
            or not source
            or source[0] != player
            or source[1] != "graveyard"
            or source[3].get("card_id") != "m-the-white-stone-of-ancients"
            or state.get("effect_uses", {}).get(usage_key) == state["turn"]
        ):
            raise DuelRuleError("Lựa chọn Rồng Trắng Mắt Xanh cho Bạch Thạch Cổ Đại không hợp lệ.")
        if not instance_ids:
            state["pending_decision"] = None
            return
        target = find_card(state, instance_ids[0])
        if (
            instance_ids[0] not in eligible_target_ids
            or not target
            or target[0] != player
            or target[1] not in {"deck", "hand"}
            or target[3].get("card_id") != "m-blue-eyes-white-dragon"
            or not _can_be_special_summoned(target[3])
            or _empty_monster_zone(state, player) is None
        ):
            raise DuelRuleError("Bạch Thạch Cổ Đại chỉ có thể Triệu hồi Rồng Trắng Mắt Xanh hợp lệ từ Bộ bài hoặc tay.")
        state["pending_decision"] = None
        state.setdefault("effect_uses", {})[usage_key] = state["turn"]
        if not _special_summon(state, player, target[3]["instance_id"]):
            raise DuelRuleError("Không thể Triệu hồi Rồng Trắng Mắt Xanh đã chọn bằng Bạch Thạch Cổ Đại.")
        if target[1] == "deck":
            random.shuffle(_cards(state, player, "deck"))
        return

    if (
        pending
        and pending.get("type") == "select_deck_card"
        and pending.get("player") == player
    ):
        eligible_target_ids = pending.get("eligible_target_instance_ids")
        source = find_card(state, pending.get("source_instance_id"))
        if (
            pending.get("effect_card_id") != "m-magicat"
            or pending.get("target_mode") != "deck-own-spell"
            or pending.get("min_count") != 0
            or pending.get("max_count") != 1
            or not isinstance(eligible_target_ids, list)
            or not eligible_target_ids
            or any(not isinstance(target_id, str) or not target_id for target_id in eligible_target_ids)
            or len(set(eligible_target_ids)) != len(eligible_target_ids)
            or not isinstance(instance_ids, list)
            or len(instance_ids) > 1
            or any(not isinstance(target_id, str) or not target_id for target_id in instance_ids)
            or len(set(instance_ids)) != len(instance_ids)
            or not source
            or source[0] != player
            or source[1] != "graveyard"
            or source[3].get("card_id") != "m-magicat"
        ):
            raise DuelRuleError("Lựa chọn Lá Phép cho Mèo Ma Thuật không hợp lệ.")
        if instance_ids:
            target = find_card(state, instance_ids[0])
            if (
                instance_ids[0] not in eligible_target_ids
                or not target
                or target[0] != player
                or target[1] != "deck"
                or target[3].get("category") != "spell"
            ):
                raise DuelRuleError("Mèo Ma Thuật chỉ có thể thêm Lá Phép từ Bộ bài của bạn.")
        state["pending_decision"] = None
        if instance_ids:
            move_card(state, instance_ids[0], player, "hand")
        return

    if (
        pending
        and pending.get("type") == "select_graveyard_card"
        and pending.get("player") == player
        and pending.get("effect_card_id") == CHAOS_LEVIANEER_ID
    ):
        eligible_target_ids = pending.get("eligible_target_instance_ids")
        source = find_card(state, pending.get("source_instance_id"))
        if (
            pending.get("count") != 1
            or pending.get("target_mode") != "grave-monster"
            or not isinstance(eligible_target_ids, list)
            or not isinstance(instance_ids, list)
            or len(instance_ids) != 1
            or not isinstance(instance_ids[0], str)
            or instance_ids[0] not in eligible_target_ids
            or not source
            or source[0] != player
            or source[1] != "monster_zone"
            or source[3].get("card_id") != CHAOS_LEVIANEER_ID
            or source[3].get("face_down", False)
        ):
            raise DuelRuleError("Lựa chọn quái thú trong Mộ cho Levianeer không hợp lệ.")
        target = find_card(state, instance_ids[0])
        if (
            not target
            or target[0] != player
            or target[1] != "graveyard"
            or target[3].get("category") not in {"monster", "fusion"}
            or not _can_be_special_summoned(target[3])
            or _empty_monster_zone(state, player) is None
        ):
            raise DuelRuleError("Levianeer chỉ có thể Triệu hồi một quái thú hợp lệ từ Mộ.")
        state["pending_decision"] = None
        if not _special_summon(
            state,
            player,
            target[3]["instance_id"],
            position="defense",
            allow_fusion=True,
        ):
            raise DuelRuleError("Không thể Triệu hồi quái thú đã chọn bằng Levianeer.")
        return

    if (
        pending
        and pending.get("type") == "select_graveyard_card"
        and pending.get("player") == player
        and pending.get("effect_card_id") == "m-night-assailant"
    ):
        eligible_target_ids = pending.get("eligible_target_instance_ids")
        source = find_card(state, pending.get("source_instance_id"))
        if (
            pending.get("count") != 1
            or pending.get("target_mode") != "grave-own-any"
            or not isinstance(eligible_target_ids, list)
            or not eligible_target_ids
            or any(not isinstance(target_id, str) or not target_id for target_id in eligible_target_ids)
            or len(set(eligible_target_ids)) != len(eligible_target_ids)
            or not isinstance(instance_ids, list)
            or len(instance_ids) != 1
            or not isinstance(instance_ids[0], str)
            or not instance_ids[0]
            or instance_ids[0] not in eligible_target_ids
            or not source
            or source[0] != player
            or source[1] != "graveyard"
            or source[3].get("card_id") != "m-night-assailant"
        ):
            raise DuelRuleError("Lựa chọn lá bài trong Mộ cho Kẻ Tấn Công Bóng Đêm không hợp lệ.")
        target = find_card(state, instance_ids[0])
        if (
            not target
            or target[0] != player
            or target[1] != "graveyard"
            or target[3]["instance_id"] == source[3]["instance_id"]
        ):
            raise DuelRuleError("Kẻ Tấn Công Bóng Đêm chỉ có thể trả một lá khác từ Mộ của bạn lên tay.")
        state["pending_decision"] = None
        move_card(state, target[3]["instance_id"], player, "hand")
        _engine_check_win_by_exodia(state, player)
        return

    if (
        pending
        and pending.get("type") == "select_graveyard_card"
        and pending.get("player") == player
    ):
        effect_card_id = pending.get("effect_card_id")
        rule = SPELL_RECOVERY_RULES.get(effect_card_id)
        eligible_target_ids = pending.get("eligible_target_instance_ids")
        if (
            not rule
            or pending.get("count") != 1
            or not isinstance(eligible_target_ids, list)
            or not isinstance(instance_ids, list)
            or len(instance_ids) != 1
            or not isinstance(instance_ids[0], str)
            or not instance_ids[0]
        ):
            raise DuelRuleError("Lựa chọn lá bài trong Mộ không hợp lệ.")
        source = find_card(state, pending.get("source_instance_id"))
        target = find_card(state, instance_ids[0])
        if (
            not source
            or source[0] != player
            or source[1] != "spell_trap_zone"
            or source[3].get("category") != "spell"
            or source[3].get("card_id") != effect_card_id
            or source[3].get("face_down", False)
            or not target
            or target[0] != player
            or target[1] != "graveyard"
            or instance_ids[0] not in eligible_target_ids
            or (
                rule["target_category"]
                and target[3].get("category") != rule["target_category"]
            )
        ):
            raise DuelRuleError("Mục tiêu không hợp lệ với hiệu ứng thu hồi.")
        state["pending_decision"] = None
        move_card(state, target[3]["instance_id"], player, "hand")
        _move_to_grave(state, source[3]["instance_id"])
        return

    if (
        pending
        and pending.get("type") == "select_field_cards"
        and pending.get("player") == player
        and pending.get("effect_card_id") == "s-magical-dimension"
        and pending.get("selection_stage") == "summon"
    ):
        source = find_card(state, pending.get("source_instance_id"))
        if (
            not isinstance(instance_ids, list)
            or len(instance_ids) != 1
            or not isinstance(instance_ids[0], str)
            or not instance_ids[0]
            or not source
            or source[0] != player
            or source[1] != "spell_trap_zone"
            or source[3].get("card_id") != "s-magical-dimension"
            or source[3].get("face_down", False)
        ):
            raise DuelRuleError("Lựa chọn Phù thủy cho Quan Tài Của Phù Thủy không hợp lệ.")
        target = find_card(state, instance_ids[0])
        slot = _empty_monster_zone(state, player)
        if (
            not target
            or target[0] != player
            or target[1] != "hand"
            or target[3].get("category") not in {"monster", "fusion"}
            or not _is_spellcaster(target[3])
            or not _can_be_special_summoned(target[3])
            or slot is None
        ):
            raise DuelRuleError("Chỉ có thể Triệu hồi Đặc biệt một Phù thủy hợp lệ từ tay.")
        summoned = move_card(
            state,
            instance_ids[0],
            player,
            "monster_zone",
            destination_index=slot,
        )
        summoned["face_down"] = False
        summoned["position"] = "attack"
        summoned["summon_method"] = "special"
        summoned["summoned_turn"] = state["turn"]
        resolve_monster_summon_effects(
            state, player, summoned["instance_id"], "special"
        )
        state["pending_decision"] = {
            "type": "select_field_cards",
            "player": player,
            "source_instance_id": source[3]["instance_id"],
            "effect_card_id": "s-magical-dimension",
            "selection_stage": "destroy",
            "min_count": 0,
            "max_count": 1,
            "target_mode": "field-opponent-monster",
        }
        return

    if (
        not pending
        or pending.get("type") != "select_field_cards"
        or pending.get("player") != player
    ):
        raise DuelRuleError("Không có lựa chọn mục tiêu trên sân đang chờ.")
    effect_card_id = pending.get("effect_card_id")
    if effect_card_id == CHAOS_LEVIANEER_ID:
        eligible_target_ids = pending.get("eligible_target_instance_ids")
        source = find_card(state, pending.get("source_instance_id"))
        if (
            pending.get("target_mode") != "field-card-any"
            or pending.get("min_count") != 0
            or pending.get("max_count") != 2
            or not isinstance(eligible_target_ids, list)
            or len(set(eligible_target_ids)) != len(eligible_target_ids)
            or not isinstance(instance_ids, list)
            or len(instance_ids) > 2
            or any(not isinstance(instance_id, str) or not instance_id for instance_id in instance_ids)
            or len(set(instance_ids)) != len(instance_ids)
            or any(instance_id not in eligible_target_ids for instance_id in instance_ids)
            or not source
            or source[0] != player
            or source[1] != "monster_zone"
            or source[3].get("card_id") != CHAOS_LEVIANEER_ID
            or source[3].get("face_down", False)
        ):
            raise DuelRuleError("Lựa chọn lá trên sân cho Levianeer không hợp lệ.")
        for instance_id in instance_ids:
            target = find_card(state, instance_id)
            if (
                not target
                or target[1] not in {"monster_zone", "spell_trap_zone"}
                or target[3].get("category") not in {"monster", "fusion", "spell", "trap"}
            ):
                raise DuelRuleError("Levianeer chỉ có thể phá hủy lá đang trên sân.")
        state["pending_decision"] = None
        for instance_id in instance_ids:
            destroy_card(state, instance_id, by_player=player)
        return
    rule = FIELD_SELECTION_RULES.get(effect_card_id)
    if effect_card_id == "s-dicephoon":
        if pending.get("target_mode") == "field-opponent-monster":
            rule = {
                "min_count": 1,
                "max_count": 2,
                "zones": frozenset({"monster_zone"}),
                "categories": frozenset({"monster", "fusion"}),
                "target_owner": "opponent",
                "operation": "destroy",
                "source_zones": frozenset({"spell_trap_zone"}),
            }
        else:
            rule = {
                "min_count": 1,
                "max_count": 1,
                "zones": frozenset({"spell_trap_zone"}),
                "categories": frozenset({"spell", "trap"}),
                "target_owner": "opponent",
                "operation": "destroy",
                "source_zones": frozenset({"spell_trap_zone"}),
            }
    if not rule:
        raise DuelRuleError("Hiệu ứng lựa chọn trên sân không được hỗ trợ.")
    if (
        not isinstance(instance_ids, list)
        or not rule["min_count"] <= len(instance_ids) <= rule["max_count"]
        or len(instance_ids) > pending.get("max_count", rule["max_count"])
        or len(instance_ids) < pending.get("min_count", rule["min_count"])
        or any(not isinstance(instance_id, str) or not instance_id for instance_id in instance_ids)
        or len(set(instance_ids)) != len(instance_ids)
    ):
        raise DuelRuleError("Số lượng mục tiêu trên sân không hợp lệ.")
    source = find_card(state, pending.get("source_instance_id"))
    allowed_source_zones = set(rule.get("source_zones", frozenset({"monster_zone"})))
    if effect_card_id in {
        "m-night-assailant",
        "m-ryko-lightsworn-hunter",
    }:
        allowed_source_zones.add("graveyard")
    if (
        not source
        or source[0] != player
        or source[1] not in allowed_source_zones
        or source[3].get("card_id") != effect_card_id
        or source[3].get("face_down", False)
    ):
        raise DuelRuleError("Lá bài kích hoạt hiệu ứng không còn ngửa trên sân.")
    targets = []
    for instance_id in instance_ids:
        target = find_card(state, instance_id)
        if (
            not target
            or target[1] not in rule["zones"]
            or (
                target[3].get("category") not in rule["categories"]
                and not (
                    target[1] == "spell_trap_zone"
                    and _is_union_equipped_spell(target[3])
                    and bool(rule["categories"] & {"spell", "trap"})
                )
            )
            or (
                rule.get("face_up")
                and target[3].get("face_down", False)
            )
            or (
                rule.get("target_owner") == "opponent"
                and target[0] != opponent_of(player)
            )
        ):
            raise DuelRuleError("Mục tiêu không hợp lệ với hiệu ứng của lá bài.")
        targets.append(instance_id)

    state["pending_decision"] = None
    for instance_id in targets:
        if rule["operation"] == "destroy":
            if effect_card_id == "m-odd-eyes-advance-dragon":
                destroyed_target = find_card(state, instance_id)
                if destroyed_target:
                    damage = current_stats(state, instance_id)["atk"]
            else:
                damage = 0
            destroy_card(state, instance_id, by_player=player)
            if damage:
                change_life_points(state, opponent_of(player), -damage)
        elif rule["operation"] == "destroy_and_mill":
            destroy_card(state, instance_id, by_player=player)
            _mill_top_cards(state, opponent_of(player), 3)
        elif rule["operation"] == "banish":
            _resolve_caius_target(state, player, instance_id)
        elif rule["operation"] == "return_to_hand":
            _return_monster_to_owner(state, instance_id)
        elif rule["operation"] == "negate_effects":
            target = find_card(state, instance_id)
            if target:
                target[3]["monster_effects_negated"] = True
                if (
                    target[3].get("card_id")
                    == "m-blue-eyes-alternative-white-dragon"
                ):
                    target[3].pop("name_alias", None)
                state.setdefault("effect_uses", {})[
                    f"{player}:m-blue-eyes-solid-dragon:summon-negate"
                ] = state["turn"]
    if effect_card_id in {"s-magical-dimension", "s-twin-twisters", "s-dicephoon"}:
        _move_to_grave(state, source[3]["instance_id"])


def _resolve_caius_target(
    state: dict[str, Any], player: str, target_instance_id: str
) -> None:
    target = find_card(state, target_instance_id)
    if not target:
        return
    category = target[3].get("category")
    attribute = target[3].get("attribute")
    target[3]["face_down"] = False
    move_card(state, target_instance_id, target[0], "banished")
    if category in {"monster", "fusion"} and attribute == "DARK":
        change_life_points(state, opponent_of(player), -1000)


def _return_monster_to_owner(state: dict[str, Any], instance_id: str) -> None:
    target = find_card(state, instance_id)
    if (
        not target
        or target[1] != "monster_zone"
        or target[3].get("category") not in {"monster", "fusion"}
    ):
        return
    destination_zone = (
        "extra_deck" if target[3].get("category") == "fusion" else "hand"
    )
    move_card(state, instance_id, target[3]["owner"], destination_zone)


def check_win_by_exodia(state: dict[str, Any], player: str) -> bool:
    """Expose the engine's Exodia check for effect/API callers."""
    return _engine_check_win_by_exodia(state, player)
