import { DUEL_DRAW_STAGGER_MS } from './duelMotion.js';
import { EQUIP_SPELL_CARD_IDS } from './duelTargetDrag.js';

const DUEL_PHASES = ['draw', 'standby', 'main1', 'battle', 'main2', 'end'];
const POT_OF_GREED_ID = 's-pot-of-greed';
const RELOAD_ID = 's-reload';
const CARD_DESTRUCTION_ID = 's-card-destruction';
const SWORDS_OF_REVEALING_LIGHT_ID = 's-swords-of-revealing-light';
const GRAVITY_BIND_ID = 't-gravity-bind';
const DICE_STAT_MODIFIER_OPERATIONS = {
  't-skull-dice': 'divide',
  's-graceful-dice': 'multiply'
};
const TEMPORARY_CONTROL_SPELL_IDS = new Set([
  's-brain-control',
  's-change-of-heart'
]);
const TARGETED_ATTACK_LOCK_CARD_IDS = new Set([
  't-spellbinding-circle',
  't-shadow-spell',
  't-nightmare-wheel',
  's-mask-of-the-accursed'
]);
let drawMotionSequence = 0;

function mapCard(card) {
  if (!card) return null;
  return {
    ...card,
    name: card.name_alias || card.name,
    id: card.card_id || card.id,
    type: card.category || card.type,
    atk: card.current_atk ?? card.atk,
    def: card.current_def ?? card.def,
    baseAtk: card.base_atk ?? card.atk,
    baseDef: card.base_def ?? card.def,
    faceDown: Boolean(card.face_down),
    setTurn: card.set_turn,
    summonedTurn: card.summoned_turn,
    flipSummonedTurn: card.flip_summoned_turn,
    positionChangedTurn: card.position_changed_turn,
    allowPositionChangeOnSummonTurn: Boolean(card.allow_position_change_on_summon_turn),
    summonMethod: card.summon_method
  };
}

function hiddenCards(count, prefix) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    faceDown: true
  }));
}

function withDrawMotions(cards, previousCards, isInitialDeal, forceRedraw) {
  const previousIds = new Set(
    (previousCards || []).map((card) => card.instance_id || card.id)
  );
  let drawIndex = 0;
  return cards.map((card) => {
    const cardId = card.instance_id || card.id;
    if (!isInitialDeal && !forceRedraw && previousIds.has(cardId)) return card;
    const motionIndex = drawIndex++;
    return {
      ...card,
      _motion: `${cardId}-${++drawMotionSequence}-draw`,
      _motionDelay: motionIndex * DUEL_DRAW_STAGGER_MS
    };
  });
}

function withPlacementMotions(cards, previousCards, isInitialDeal) {
  if (isInitialDeal) return cards;
  const previousIds = new Set(
    (previousCards || []).map((card) => card?.instance_id).filter(Boolean)
  );
  return cards.map((card) => {
    if (!card?.instance_id || previousIds.has(card.instance_id)) return card;
    return {
      ...card,
      _motion: `${card.instance_id}-${++drawMotionSequence}-summon`
    };
  });
}

function mapPlayer(
  player,
  side,
  previousHand,
  previousMonsters,
  previousSpellTraps,
  previousFieldZone,
  isInitialDeal,
  forceRedraw
) {
  const hand = side === 'me'
    ? player.hand.map(mapCard)
    : hiddenCards(player.hand_count, `${side}-hand`);
  return {
    lp: player.lp,
    hand: withDrawMotions(hand, previousHand, isInitialDeal, forceRedraw),
    deck: hiddenCards(player.deck_count, `${side}-deck`),
    extraDeck: (player.extra_deck || []).map(mapCard),
    grave: player.graveyard.map(mapCard),
    banished: player.banished.map(mapCard),
    mon: withPlacementMotions(
      player.monster_zone.map(mapCard),
      previousMonsters,
      isInitialDeal
    ),
    st: withPlacementMotions(
      player.spell_trap_zone.map(mapCard),
      previousSpellTraps,
      isInitialDeal
    ),
    fieldZone: withPlacementMotions(
      (player.field_zone || [null]).map(mapCard),
      previousFieldZone,
      isInitialDeal
    )
  };
}

export function mapDuelMatch(
  match,
  previousGame = null,
  { forceRedrawSides = [] } = {}
) {
  const previousMonsters = previousGame
    ? [...previousGame.field.me.mon, ...previousGame.field.opp.mon]
    : null;
  const players = {
    me: mapPlayer(
      match.players.player,
      'me',
      previousGame?.hand.me,
      previousMonsters,
      previousGame?.field.me.st,
      previousGame?.field?.me?.fieldZone,
      !previousGame,
      forceRedrawSides.includes('me')
    ),
    opp: mapPlayer(
      match.players.ai,
      'opp',
      previousGame?.hand.opp,
      previousMonsters,
      previousGame?.field.opp.st,
      previousGame?.field?.opp?.fieldZone,
      !previousGame,
      forceRedrawSides.includes('opp')
    )
  };
  const pendingDecision = match.pending_decision;
  const pendingSource = pendingDecision
    ? [
      ...players.me.hand,
      ...players.me.grave,
      ...players.me.banished,
      ...players.me.mon,
      ...players.me.st
    ].find(
      (card) => card?.instance_id === pendingDecision.source_instance_id
    )
    : null;
  const isFieldCardSelection = pendingDecision?.type === 'select_field_cards';
  const isGraveyardCardSelection = pendingDecision?.type === 'select_graveyard_card';
  const isDeckCardSelection = pendingDecision?.type === 'select_deck_card';
  const isBlueEyesSummonSelection = pendingDecision?.type === 'select_blue_eyes_summon';
  const isTargetSelection = isFieldCardSelection
    || isGraveyardCardSelection
    || isDeckCardSelection
    || isBlueEyesSummonSelection

  return {
    authoritative: true,
    matchId: match.match_id,
    profile: {
      me: {
        name: match.players.player.player_name
          || previousGame?.profile?.me?.name
          || '',
        selectedCharacterId: match.players.player.selected_character_id
          || previousGame?.profile?.me?.selectedCharacterId
          || null
      },
      opp: {
        name: match.players.ai.player_name
          || previousGame?.profile?.opp?.name
          || 'Đối thủ AI'
      }
    },
    turn: match.turn_player === 'player' ? 'me' : 'opp',
    firstPlayer: match.first_player === 'player' ? 'me' : 'opp',
    phaseIndex: DUEL_PHASES.indexOf(match.phase),
    turnCount: match.turn,
    selected: null,
    selectedPosition: 'attack',
    selectedTributes: [],
    selectedTargets: [],
    attackingIndex: null,
    effectMode: ['discard', 'tricky_discard', 'spell_recovery_discard', 'twin_twisters_discard', 'burning_dragon_discard'].includes(pendingDecision?.type)
      ? 'discard-for-effect'
      : isTargetSelection
        ? 'targeted-effect'
        : null,
    pendingEffect: pendingDecision ? {
      sourceInstanceId: pendingDecision.source_instance_id,
      card: pendingSource,
      player: 'me',
      ...(isTargetSelection
        ? {
          targetMode: pendingDecision.target_mode || 'field-spell-trap',
          minTargets: pendingDecision.min_count ?? pendingDecision.count ?? 0,
          maxTargets: pendingDecision.max_count ?? pendingDecision.count,
          singleTarget: (
            ['deck-own-spell', 'deck-or-hand-blue-eyes-summon', 'hand-deck-grave-blue-eyes', 'mana-dark-magician-girl-summon', 'hand-spellcaster', 'clone-dragon-field-monster'].includes(pendingDecision.target_mode)
            || (
              pendingDecision.target_mode === 'field-opponent-monster'
              && pendingDecision.effect_card_id !== 's-dicephoon'
            )
            || (
              pendingDecision.effect_card_id === 's-dicephoon'
              && (pendingDecision.max_count ?? 1) <= 1
            )
          ),
          targetSide: pendingDecision.target_player === 'ai'
            ? 'opp'
            : pendingDecision.target_player === 'player'
              ? 'me'
              : null
        }
        : {})
    } : null,
    pendingDiscardCount: pendingDecision?.count || 0,
    pendingDiscardIds: [],
    chain: match.chain,
    pendingDecision,
    whiteStoneEffectUsed: Boolean(match.white_stone_effect_used),
    maidenEffectUsed: Boolean(match.maiden_effect_used),
    attacked: {
      me: match.attacked.player,
      opp: match.attacked.ai
    },
    normalSummonUsed: {
      me: match.normal_summon_used.player,
      opp: match.normal_summon_used.ai
    },
    pendingBattle: match.pending_battle ? {
      attackerInstanceId: match.pending_battle.attacker_instance_id,
      defenderInstanceId: match.pending_battle.defender_instance_id,
      awaitingResolution: Boolean(match.pending_battle.awaiting_resolution),
      revealedFaceDown: Boolean(match.pending_battle.revealed_face_down)
    } : null,
    lastDiceRoll: match.last_dice_roll ? {
      seq: Number(match.last_dice_roll.seq || 0),
      value: Number(match.last_dice_roll.value || 1),
      cardId: match.last_dice_roll.card_id || '',
      player: match.last_dice_roll.player === 'ai' ? 'opp' : 'me',
      sourceInstanceId: match.last_dice_roll.source_instance_id || null
    } : null,
    lastSliferTriggers: Array.isArray(match.last_slifer_triggers)
      ? match.last_slifer_triggers.map((entry) => ({
        seq: Number(entry.seq || 0),
        sliferSide: entry.slifer_player === 'ai' ? 'opp' : 'me',
        sliferInstanceId: entry.slifer_instance_id || null,
        targetSide: entry.target_player === 'ai' ? 'opp' : 'me',
        targetInstanceId: entry.target_instance_id || null,
        targetZoneIndex: Number.isInteger(entry.target_zone_index) ? entry.target_zone_index : 0,
        stat: entry.stat === 'def' ? 'def' : 'atk',
        preAtk: Number(entry.pre_atk ?? 0),
        preDef: Number(entry.pre_def ?? 0),
        postAtk: Number(entry.post_atk ?? 0),
        postDef: Number(entry.post_def ?? 0),
        destroyed: Boolean(entry.destroyed),
        monster: entry.monster ? mapCard(entry.monster) : null
      }))
      : [],
    drawnThisTurn: match.drawn_this_turn,
    firstTurn: match.turn === 1 && match.first_player === 'player',
    lp: { me: players.me.lp, opp: players.opp.lp },
    busy: false,
    over: match.over,
    winner: match.winner === 'player' ? 'me' : match.winner === 'ai' ? 'opp' : null,
    exodiaWinner: match.exodia_winner === 'player' ? 'me' : match.exodia_winner === 'ai' ? 'opp' : null,
    deck: { me: players.me.deck, opp: players.opp.deck },
    extraDeck: { me: players.me.extraDeck, opp: players.opp.extraDeck },
    hand: { me: players.me.hand, opp: players.opp.hand },
    grave: { me: players.me.grave, opp: players.opp.grave },
    banished: { me: players.me.banished, opp: players.opp.banished },
    field: {
      me: {
        mon: players.me.mon,
        st: players.me.st,
        fieldZone: players.me.fieldZone
      },
      opp: {
        mon: players.opp.mon,
        st: players.opp.st,
        fieldZone: players.opp.fieldZone
      }
    },
    log: previousGame?.log || [],
    logId: previousGame?.logId || 0,
    motionId: previousGame?.motionId || 0,
    logOpen: previousGame?.logOpen || false,
    ready: true
  };
}

export function mergeDuelPlayerProfile(match, user) {
  return {
    ...match,
    players: {
      ...match.players,
      player: {
        ...match.players.player,
        player_name: user.player_name
          || user.username
          || match.players.player.player_name
          || '',
        selected_character_id: user.selected_character_id
          ?? match.players.player.selected_character_id
          ?? null
      }
    }
  };
}

function isTrapDisabledByJinzo(game, trapOwner) {
  const jinzoController = trapOwner === 'me' ? 'opp' : 'me';
  return Boolean(
    game?.field?.[jinzoController]?.mon?.some(
      (card) => card?.id === 'm-jinzo'
        && !card.faceDown
        && !card.monster_effects_negated
    )
  );
}

export function isMonsterAttackLockedBySpellTrap(game, side, monster) {
  if ((side !== 'me' && side !== 'opp') || !monster) return false;
  if (
    Number.isInteger(monster.cannot_attack_until_turn)
    && Number.isInteger(game?.turnCount)
    && monster.cannot_attack_until_turn >= game.turnCount
  ) return true;
  if (monster.faceDown) return false;
  const monsterInstanceId = monster.instance_id || monster.id;
  if (!monsterInstanceId) return false;

  const opposingSide = side === 'me' ? 'opp' : 'me';
  const opposingEffects = game?.field?.[opposingSide]?.st || [];
  if (opposingEffects.some(
    (card) => card
      && !card.faceDown
      && card.id === SWORDS_OF_REVEALING_LIGHT_ID
  )) return true;

  const level = Number(monster.level ?? monster.lv);
  if (
    level >= 4
    && opposingEffects.some(
      (card) => card
        && !card.faceDown
        && card.id === GRAVITY_BIND_ID
        && !isTrapDisabledByJinzo(game, opposingSide)
    )
  ) return true;

  return ['me', 'opp'].some((owner) =>
    (game?.field?.[owner]?.st || []).some((card) => {
      if (
        !card
        || card.faceDown
        || !TARGETED_ATTACK_LOCK_CARD_IDS.has(card.id)
        || card.target_instance_id !== monsterInstanceId
      ) return false;
      const isTrap = card.type === 'trap' || card.category === 'trap';
      return !isTrap || !isTrapDisabledByJinzo(game, owner);
    })
  );
}

export function getAiActivatedSpellTrap(previousGame, stageGame) {
  const previousOppTrapIds = new Set(
    (previousGame?.field?.opp?.st || [])
      .filter(Boolean)
      .map((card) => card.instance_id)
  );
  for (let index = 0; index < 5; index += 1) {
    const card = stageGame?.field?.opp?.st?.[index];
    if (!card) continue;
    const previousCard = previousGame?.field?.opp?.st?.[index];
    if (
      !card.faceDown
      && (
        !previousOppTrapIds.has(card.instance_id)
        || previousCard?.faceDown
      )
    ) {
      if (
        !previousOppTrapIds.has(card.instance_id)
        && (previousGame?.hand?.opp || []).length
          > (stageGame?.hand?.opp || []).length
      ) {
        return {
          card,
          index: Math.floor((previousGame.hand.opp.length - 1) / 2),
          source: 'hand'
        };
      }
      return { card, index };
    }
  }

  const previousGraveIds = new Set(
    (previousGame?.grave?.opp || []).map((card) => card?.instance_id)
  );
  const newGraveCard = (stageGame?.grave?.opp || []).find(
    (card) => card?.instance_id
      && !previousGraveIds.has(card.instance_id)
  );
  if (newGraveCard) {
    const index = (previousGame?.field?.opp?.st || []).findIndex(
      (card) => card?.instance_id === newGraveCard.instance_id
    );
    if (index >= 0) return { card: newGraveCard, index };

    const previousHand = previousGame?.hand?.opp || [];
    let handIndex = previousHand.findIndex(
      (card) => card?.instance_id === newGraveCard.instance_id
    );
    if (
      handIndex < 0
      && ['spell', 'trap'].includes(
        String(newGraveCard.category || newGraveCard.type || '').toLowerCase()
      )
      && (
        previousHand.length > (stageGame?.hand?.opp || []).length
        || (
          previousHand.length > 0
          && (stageGame?.deck?.opp?.length || 0) < (previousGame?.deck?.opp?.length || 0)
        )
      )
    ) {
      handIndex = Math.floor((previousHand.length - 1) / 2);
    }
    if (handIndex >= 0) {
      return { card: newGraveCard, index: handIndex, source: 'hand' };
    }
  }
  return null;
}

export function getAiDiscardedCards(previousGame, stageGame) {
  const discardCount = (previousGame?.hand?.opp?.length || 0)
    - (stageGame?.hand?.opp?.length || 0);
  if (discardCount <= 0) return [];

  const previousGraveIds = new Set(
    (previousGame?.grave?.opp || []).map((card) => card?.instance_id)
  );
  return (stageGame?.grave?.opp || [])
    .filter((card) =>
      card?.instance_id && !previousGraveIds.has(card.instance_id)
    )
    .slice(-discardCount);
}

export function getRevivedJamCards(previousGame, nextGame) {
  if (!previousGame?.field || !nextGame?.field) return [];
  const revived = [];
  ['me', 'opp'].forEach((side) => {
    (nextGame.field[side].mon || []).forEach((card, nextIndex) => {
      if (!card?.instance_id || card.id !== 'm-revival-jam') return;
      const prevIndex = (previousGame.field[side].mon || []).findIndex(
        (prevCard) => prevCard?.instance_id === card.instance_id
      );
      if (prevIndex < 0) return;
      const prevCard = previousGame.field[side].mon[prevIndex];
      if (Number(card.revival_count || 0) > Number(prevCard?.revival_count || 0)) {
        revived.push({
          side,
          prevIndex,
          nextIndex,
          instanceId: card.instance_id,
          card
        });
      }
    });
  });
  return revived;
}

export function getAiDestroyedFieldCards(previousGame, stageGame) {
  const activatedSpellTrap = getAiActivatedSpellTrap(previousGame, stageGame);
  const activatedSourceId = activatedSpellTrap?.card?.instance_id || null;
  const effectDestroyed = [];
  const sourceDestroyed = [];

  ['opp', 'me'].forEach((side) => {
    ['mon', 'st'].forEach((kind) => {
      const previousCards = previousGame?.field?.[side]?.[kind] || [];
      const currentIds = new Set(
        ['opp', 'me'].flatMap((checkSide) =>
          (stageGame?.field?.[checkSide]?.[kind] || [])
            .filter(Boolean)
            .map((card) => card.instance_id)
        )
      );
      const previousGraveIds = new Set(
        ['opp', 'me'].flatMap((checkSide) =>
          (previousGame?.grave?.[checkSide] || []).map((card) => card?.instance_id)
        )
      );
      const currentGraveIds = new Set(
        ['opp', 'me'].flatMap((checkSide) =>
          (stageGame?.grave?.[checkSide] || []).map((card) => card?.instance_id)
        )
      );

      previousCards.forEach((card, index) => {
        if (
          !card?.instance_id
          || currentIds.has(card.instance_id)
          || previousGraveIds.has(card.instance_id)
          || !currentGraveIds.has(card.instance_id)
        ) return;
        const entry = { side, kind, index, instanceId: card.instance_id };
        const isAiSourceSpellTrap = kind === 'st' && card.instance_id === activatedSourceId;
        const isPlayerActivatedTrapDuringAiStage = !activatedSourceId
          && side === 'me'
          && kind === 'st'
          && (
            card.faceDown
            || String(card.category || card.type || '').toLowerCase() === 'trap'
          );
        if (isAiSourceSpellTrap || isPlayerActivatedTrapDuringAiStage) {
          sourceDestroyed.push(entry);
        } else {
          effectDestroyed.push(entry);
        }
      });
    });
  });

  return [...effectDestroyed, ...sourceDestroyed];
}

export function getMillCountsBetweenStages(
  previousGame,
  nextGame,
  excludedSides = []
) {
  return ['me', 'opp'].filter((side) => !excludedSides.includes(side)).flatMap((side) => {
    const previousDeck = previousGame?.deck?.[side];
    const nextDeck = nextGame?.deck?.[side];
    const previousGrave = previousGame?.grave?.[side];
    const nextGrave = nextGame?.grave?.[side];
    if (
      !Array.isArray(previousDeck)
      || !Array.isArray(nextDeck)
      || !Array.isArray(previousGrave)
      || !Array.isArray(nextGrave)
    ) return [];

    const deckDecrease = previousDeck.length - nextDeck.length;
    const previousGraveIds = new Set(
      previousGrave.map((card) => card?.instance_id).filter(Boolean)
    );
    const previousNonDeckIds = new Set([
      ...(previousGame.hand?.[side] || []),
      ...(previousGame.field?.[side]?.mon || []),
      ...(previousGame.field?.[side]?.st || []),
      ...(previousGame.banished?.[side] || []),
      ...(previousGame.extraDeck?.[side] || [])
    ].map((card) => card?.instance_id).filter(Boolean));
    const newGraveCards = nextGrave.filter(
      (card) => card?.instance_id && !previousGraveIds.has(card.instance_id)
    );
    const graveIncrease = newGraveCards.filter(
      (card) => !previousNonDeckIds.has(card.instance_id)
    ).length;
    const count = Math.max(0, Math.min(deckDecrease, graveIncrease));
    return count > 0 ? [{ side, count }] : [];
  });
}

export function createAiTurnStages(previousGame, match, aiStages = []) {
  if (
    previousGame?.authoritative
    && Array.isArray(aiStages)
    && aiStages.length
    && ['ai', 'player'].includes(match?.turn_player)
  ) {
    let stagePreviousGame = previousGame;
    const actionStages = aiStages.map((stage) => {
      const stageGame = {
        ...mapDuelMatch(stage.match, stagePreviousGame),
        busy: true
      };
      stagePreviousGame = stageGame;
      return {
        type: stage.type,
        attackerInstanceId: stage.attacker_instance_id || null,
        defenderInstanceId: stage.defender_instance_id || null,
        game: stageGame
      };
    });
    return {
      actionStages,
      boardStage: stagePreviousGame
    };
  }

  if (
    !previousGame?.authoritative
    || previousGame.turn !== 'me'
    || previousGame.phaseIndex !== DUEL_PHASES.indexOf('end')
    || match?.turn_player !== 'player'
    || match.turn !== previousGame.turnCount + 2
    || match.over
    || match.pending_decision
    || match.pending_battle
    || match.chain?.status !== 'closed'
    || !Array.isArray(match.players?.player?.hand)
    || match.players.player.hand.length < previousGame.hand.me.length
  ) return null;

  const drawnCardId = `opp-hand-${previousGame.hand.opp.length}`;
  const drawStage = {
    ...previousGame,
    turn: 'opp',
    turnCount: previousGame.turnCount + 1,
    phaseIndex: 0,
    firstTurn: false,
    drawnThisTurn: true,
    busy: true,
    hand: {
      ...previousGame.hand,
      opp: [
        ...previousGame.hand.opp,
        {
          id: drawnCardId,
          faceDown: true,
          _motion: `${drawnCardId}-${++drawMotionSequence}-draw`,
          _motionDelay: 0
        }
      ]
    },
    deck: {
      ...previousGame.deck,
      opp: previousGame.deck.opp.slice(1)
    },
    normalSummonUsed: {
      ...previousGame.normalSummonUsed,
      opp: false
    },
    attacked: {
      ...previousGame.attacked,
      opp: []
    },
    pendingBattle: null,
    pendingDecision: null,
    pendingEffect: null,
    effectMode: null
  };
  const player = match.players.player;
  const oldPlayerHand = player.hand.slice(0, previousGame.hand.me.length);
  const aiTurnMatch = {
    ...match,
    turn: previousGame.turnCount + 1,
    turn_player: 'ai',
    phase: 'main1',
    drawn_this_turn: true,
    pending_decision: null,
    pending_battle: null,
    players: {
      ...match.players,
      player: {
        ...player,
        hand: oldPlayerHand,
        hand_count: oldPlayerHand.length,
        deck_count: previousGame.deck.me.length
      }
    }
  };
  return {
    drawStage,
    boardStage: {
      ...mapDuelMatch(aiTurnMatch, drawStage),
      busy: true
    },
    hasSummon: hasNewlySummonedMonster(previousGame, {
      field: {
        me: { mon: match.players.player.monster_zone.map(mapCard) },
        opp: { mon: match.players.ai.monster_zone.map(mapCard) }
      }
    })
  };
}

export function stageCardDestructionResolution(updatedGame) {
  return {
    ...updatedGame,
    busy: true,
    hand: {
      me: [],
      opp: []
    }
  };
}

export function stageEquipSpellResolution(
  previousGame,
  stageGame,
  side,
  targetInstanceId = null
) {
  if (!['me', 'opp'].includes(side)) return null;
  const equipIndex = stageGame?.field?.[side]?.st?.findIndex((card) => {
    if (!EQUIP_SPELL_CARD_IDS.has(card?.id) || card.faceDown) return false;
    const previousCard = previousGame?.field?.[side]?.st?.find(
      (candidate) => candidate?.instance_id === card.instance_id
    );
    return !previousCard || previousCard.faceDown;
  }) ?? -1;
  if (equipIndex < 0) return null;

  const equipCard = stageGame.field[side].st[equipIndex];
  const previousEquipCard = previousGame?.field?.[side]?.st?.find(
    (card) => card?.instance_id === equipCard.instance_id
  );

  const equippedMonsterId = equipCard.target_instance_id || targetInstanceId;
  if (!equippedMonsterId) return null;
  const targetLocation = findMonsterLocation(stageGame, equippedMonsterId);
  const previousTarget = findMonsterLocation(previousGame, equippedMonsterId);
  if (!targetLocation || !previousTarget) return null;

  const field = {
    me: {
      mon: stageGame.field.me.mon.slice(),
      st: stageGame.field.me.st.slice()
    },
    opp: {
      mon: stageGame.field.opp.mon.slice(),
      st: stageGame.field.opp.st.slice()
    }
  };
  field[targetLocation.side].mon[targetLocation.index] = previousTarget.card;
  field[side].st[equipIndex] = {
    ...equipCard,
    target_instance_id: equippedMonsterId,
    ...(!previousEquipCard && !equipCard._motion
      ? { _motion: `${equipCard.instance_id}-equip-summon` }
      : {})
  };

  return {
    ...stageGame,
    field,
    busy: true
  };
}

export function stageSpellTrapActivation(previousGame, match, action) {
  const sourceInstanceId = action.type === 'activate_effect'
    ? action.source_instance_id
    : action.type === 'complete_discard'
      ? previousGame.pendingDecision?.source_instance_id
      : null;
  if (typeof sourceInstanceId !== 'string') return null;

  const sourceCard = [
    ...previousGame.hand.me,
    ...previousGame.field.me.st
  ].find((card) => card?.instance_id === sourceInstanceId);
  const category = String(sourceCard?.category || sourceCard?.type || '').toLowerCase();
  if (!['spell', 'trap'].includes(category)) return null;

  const stagedGame = mapDuelMatch(match, previousGame);
  const holdDiceStats = Boolean(DICE_STAT_MODIFIER_OPERATIONS[sourceCard?.id]);
  const finishActivationStage = (activationGame) => {
    const baseStage = holdDiceStats
      ? {
        ...activationGame,
        field: {
          ...activationGame.field,
          me: { ...activationGame.field.me, mon: previousGame.field.me.mon.slice() },
          opp: { ...activationGame.field.opp, mon: previousGame.field.opp.mon.slice() }
        }
      }
      : activationGame;
    const summonStage = stageMonsterSummonResolution(previousGame, baseStage);
    return stageFieldDestructionResolution(
      previousGame,
      summonStage || baseStage
    ) || summonStage || baseStage;
  };
  const activatedCard = stagedGame.field.me.st.find(
    (card) => card?.instance_id === sourceInstanceId && !card.faceDown
  ) || stagedGame.field.me.fieldZone?.find(
    (card) => card?.instance_id === sourceInstanceId && !card.faceDown
  );
  const equipStage = stageEquipSpellResolution(
    previousGame,
    stagedGame,
    'me',
    action.target_instance_ids?.[0]
  );
  if (equipStage) return finishActivationStage(equipStage);
  if (activatedCard) return finishActivationStage({ ...stagedGame, busy: true });

  if (
    previousGame.hand.me.some((card) => card?.instance_id === sourceInstanceId)
    && !TEMPORARY_CONTROL_SPELL_IDS.has(sourceCard.id)
  ) {
    const activationZoneIndex = (
      Number.isInteger(action?.zone_index)
      && !previousGame.field.me.st[action.zone_index]
    )
      ? action.zone_index
      : previousGame.field.me.st.findIndex((card) => !card);
    if (activationZoneIndex >= 0) {
      const field = {
        me: {
          ...stagedGame.field.me,
          mon: stagedGame.field.me.mon.slice(),
          st: stagedGame.field.me.st.slice()
        },
        opp: {
          ...stagedGame.field.opp,
          mon: stagedGame.field.opp.mon.slice(),
          st: stagedGame.field.opp.st.slice()
        }
      };
      field.me.st[activationZoneIndex] = {
        ...sourceCard,
        faceDown: false
      };
      return finishActivationStage({
        ...stagedGame,
        field,
        hand: {
          ...stagedGame.hand,
          me: stagedGame.hand.me.filter((card) => card?.instance_id !== sourceInstanceId)
        },
        grave: {
          ...stagedGame.grave,
          me: stagedGame.grave.me.filter((card) => card?.instance_id !== sourceInstanceId)
        },
        busy: true
      });
    }
  }

  if (
    !TEMPORARY_CONTROL_SPELL_IDS.has(sourceCard.id)
    || !stagedGame.grave.me.some((card) => card?.instance_id === sourceInstanceId)
  ) return null;

  const sourceZoneIndex = previousGame.field.me.st.findIndex(
    (card) => card?.instance_id === sourceInstanceId
  );
  const activationZoneIndex = sourceZoneIndex >= 0
    ? sourceZoneIndex
    : previousGame.field.me.st.findIndex((card) => !card);
  if (activationZoneIndex < 0) return null;

  const transfers = getTemporaryControlTransfers(previousGame, stagedGame);
  const field = {
    me: {
      mon: stagedGame.field.me.mon.slice(),
      st: stagedGame.field.me.st.slice()
    },
    opp: {
      mon: stagedGame.field.opp.mon.slice(),
      st: stagedGame.field.opp.st.slice()
    }
  };
  transfers.forEach(({ instanceId, fromSide, fromIndex, toSide, toIndex }) => {
    const transferredCard = field[toSide].mon[toIndex];
    if (transferredCard?.instance_id !== instanceId) return;
    field[toSide].mon[toIndex] = null;
    const originalCard = previousGame.field[fromSide].mon[fromIndex];
    if (originalCard) field[fromSide].mon[fromIndex] = originalCard;
  });

  field.me.st[activationZoneIndex] = {
    ...sourceCard,
    faceDown: false
  };
  return finishActivationStage({
    ...stagedGame,
    field,
    hand: {
      ...stagedGame.hand,
      me: stagedGame.hand.me.filter((card) => card?.instance_id !== sourceInstanceId)
    },
    grave: {
      ...stagedGame.grave,
      me: stagedGame.grave.me.filter((card) => card?.instance_id !== sourceInstanceId)
    },
    busy: true
  });
}

function findMonsterLocation(game, instanceId) {
  for (const side of ['me', 'opp']) {
    const index = game?.field?.[side]?.mon?.findIndex(
      (card) => card?.instance_id === instanceId
    ) ?? -1;
    if (index >= 0) return { side, index, card: game.field[side].mon[index] };
  }
  return null;
}

function getControlOwnerSide(control) {
  const owner = control?.return_to ?? control?.returnTo;
  if (owner === 'player' || owner === 'me') return 'me';
  if (owner === 'ai' || owner === 'opp') return 'opp';
  return null;
}

function getTemporaryControl(card) {
  return card?.temporary_control || card?.temporaryControl || null;
}

export function getTemporaryControlTransfers(previousGame, updatedGame) {
  if (!previousGame?.field || !updatedGame?.field) return [];

  const instanceIds = new Set();
  ['me', 'opp'].forEach((side) => {
    previousGame.field[side].mon.forEach((card) => {
      if (getTemporaryControl(card)) instanceIds.add(card.instance_id);
    });
    updatedGame.field[side].mon.forEach((card) => {
      if (getTemporaryControl(card)) instanceIds.add(card.instance_id);
    });
  });

  return [...instanceIds].flatMap((instanceId) => {
    if (!instanceId) return [];
    const previous = findMonsterLocation(previousGame, instanceId);
    const updated = findMonsterLocation(updatedGame, instanceId);
    if (!previous || !updated || previous.side === updated.side) return [];

    const previousControl = getTemporaryControl(previous.card);
    const updatedControl = getTemporaryControl(updated.card);
    if (updatedControl) {
      const ownerSide = getControlOwnerSide(updatedControl);
      if (previous.side !== ownerSide || updated.side === ownerSide) return [];
    } else {
      const ownerSide = getControlOwnerSide(previousControl);
      if (updated.side !== ownerSide || previous.side === ownerSide) return [];
    }

    return [{
      instanceId,
      fromSide: previous.side,
      fromIndex: previous.index,
      toSide: updated.side,
      toIndex: updated.index
    }];
  });
}

export function stageTemporaryControlTransfers(previousGame, updatedGame) {
  const transfers = getTemporaryControlTransfers(previousGame, updatedGame);
  if (!transfers.length) return null;

  const finalGame = {
    ...updatedGame,
    field: {
      me: {
        ...updatedGame.field.me,
        mon: updatedGame.field.me.mon.slice(),
        st: updatedGame.field.me.st.slice()
      },
      opp: {
        ...updatedGame.field.opp,
        mon: updatedGame.field.opp.mon.slice(),
        st: updatedGame.field.opp.st.slice()
      }
    }
  };
  transfers.forEach(({ instanceId, toSide, toIndex }) => {
    const card = finalGame.field[toSide].mon[toIndex];
    if (!card || card.instance_id !== instanceId) return;
    const { _motion, _motionDelay, ...withoutPlacementMotion } = card;
    finalGame.field[toSide].mon[toIndex] = withoutPlacementMotion;
  });

  const stageGame = {
    ...finalGame,
    field: {
      me: {
        ...finalGame.field.me,
        st: finalGame.field.me.st.slice()
      },
      opp: finalGame.field.opp
    },
    grave: {
      ...finalGame.grave,
      me: finalGame.grave.me.slice()
    },
    busy: true
  };
  const resolvedControlSpell = [
    ...previousGame.hand.me,
    ...previousGame.field.me.st
  ].find((card) =>
    TEMPORARY_CONTROL_SPELL_IDS.has(card?.id)
    && updatedGame.grave.me.some(
      (graveCard) => graveCard?.instance_id === card.instance_id
    )
  );
  if (resolvedControlSpell) {
    const existingZoneIndex = previousGame.field.me.st.findIndex(
      (card) => card?.instance_id === resolvedControlSpell.instance_id
    );
    const zoneIndex = existingZoneIndex >= 0
      ? existingZoneIndex
      : previousGame.field.me.st.findIndex((card) => !card);
    if (
      zoneIndex >= 0
      && (
        !stageGame.field.me.st[zoneIndex]
        || stageGame.field.me.st[zoneIndex].instance_id === resolvedControlSpell.instance_id
      )
    ) {
      stageGame.field.me.st[zoneIndex] = {
        ...resolvedControlSpell,
        faceDown: false
      };
      stageGame.grave.me = stageGame.grave.me.filter(
        (card) => card?.instance_id !== resolvedControlSpell.instance_id
      );
      stageGame.hand.me = stageGame.hand.me.filter(
        (card) => card?.instance_id !== resolvedControlSpell.instance_id
      );
    }
  }

  return { stageGame, finalGame };
}

export function getLightningStormDestroyedZones(previousGame, updatedGame, action) {
  if (action.type !== 'activate_effect') return [];
  const sourceCard = [
    ...previousGame.hand.me,
    ...previousGame.field.me.st
  ].find((card) => card?.instance_id === action.source_instance_id);
  if (sourceCard?.id !== 's-lightning-storm') return [];

  const kind = action.payload?.mode === 'destroy_attack_monsters'
    ? 'mon'
    : action.payload?.mode === 'destroy_spell_traps'
      ? 'st'
      : null;
  if (!kind) return [];

  return previousGame.field.opp[kind].flatMap((card, index) => {
    if (!card?.instance_id) return [];
    const remainsOnField = updatedGame.field.opp[kind].some(
      (fieldCard) => fieldCard?.instance_id === card.instance_id
    );
    const reachedGraveOrBanished = updatedGame.grave.opp.some(
      (graveCard) => graveCard?.instance_id === card.instance_id
    ) || updatedGame.banished.opp.some(
      (banishedCard) => banishedCard?.instance_id === card.instance_id
    );
    return !remainsOnField && reachedGraveOrBanished
      ? [{ side: 'opp', kind, index }]
      : [];
  });
}

export function didResolveCardDestruction(previousGame, match, action) {
  if (match.chain?.status !== 'closed') return false;

  const directSource = action.type === 'activate_effect'
    ? previousGame.hand.me.find(
      (card) => card?.instance_id === action.source_instance_id
        && card.id === CARD_DESTRUCTION_ID
    )
    : null;
  const chainLink = previousGame.chain?.links?.find(
    (link) => link.card_id === CARD_DESTRUCTION_ID
      && link.player === 'player'
  );
  const sourceInstanceId = directSource?.instance_id
    || chainLink?.source_instance_id;
  if (!sourceInstanceId) return false;

  const playerGraveyard = match.players.player.graveyard;
  const playerGraveIds = new Set(
    playerGraveyard.map((card) => card.instance_id)
  );
  if (!playerGraveIds.has(sourceInstanceId)) return false;

  const priorPlayerHandIds = previousGame.hand.me
    .filter((card) => card.instance_id !== sourceInstanceId)
    .map((card) => card.instance_id);
  if (!priorPlayerHandIds.every((instanceId) => playerGraveIds.has(instanceId))) {
    return false;
  }

  const priorAiGraveIds = new Set(
    previousGame.grave.opp.map((card) => card.instance_id)
  );
  const newlyDiscardedAiCards = match.players.ai.graveyard.filter(
    (card) => !priorAiGraveIds.has(card.instance_id)
  );
  return newlyDiscardedAiCards.length >= previousGame.hand.opp.length;
}

export function stagePotOfGreedResolution(previousGame, updatedGame) {
  for (const side of ['me', 'opp']) {
    const graveyard = updatedGame.grave[side];
    const candidates = previousGame.field[side].st
      .map((card, zoneIndex) => ({ card, zoneIndex }))
      .filter(({ card }) => card?.id === POT_OF_GREED_ID
        && graveyard.some((graveCard) =>
          graveCard?.instance_id === card.instance_id
        ));
    const previousIds = new Set(
      previousGame.hand[side].map((card) => card.instance_id || card.id)
    );
    const drawnCards = updatedGame.hand[side].filter(
      (card) => !previousIds.has(card.instance_id || card.id)
    );
    if (candidates.length !== 1 || drawnCards.length !== 2) continue;

    const { card, zoneIndex } = candidates[0];
    if (updatedGame.field[side].st[zoneIndex]) continue;
    const spellTrapZone = updatedGame.field[side].st.slice();
    spellTrapZone[zoneIndex] = card;
    return {
      ...updatedGame,
      busy: true,
      field: {
        ...updatedGame.field,
        [side]: { ...updatedGame.field[side], st: spellTrapZone }
      },
      grave: {
        ...updatedGame.grave,
        [side]: graveyard.filter(
          (graveCard) => graveCard?.instance_id !== card.instance_id
        )
      }
    };
  }
  return null;
}

export function stageFieldDestructionResolution(previousGame, resolvedGame) {
  const field = {
    me: { ...resolvedGame.field.me },
    opp: { ...resolvedGame.field.opp }
  };
  const grave = {
    me: resolvedGame.grave.me.slice(),
    opp: resolvedGame.grave.opp.slice()
  };
  const banished = {
    me: resolvedGame.banished.me.slice(),
    opp: resolvedGame.banished.opp.slice()
  };
  let stagedAny = false;

  for (const side of ['me', 'opp']) {
    for (const kind of ['mon', 'st']) {
      const zone = resolvedGame.field[side][kind].slice();
      for (const [index, card] of (previousGame.field[side][kind] || []).entries()) {
        if (!card?.instance_id) continue;
        const stillOnAnySide = ['me', 'opp'].some((checkSide) =>
          (resolvedGame.field[checkSide][kind] || []).some(
            (currentCard) => currentCard?.instance_id === card.instance_id
          )
        );
        if (stillOnAnySide || zone[index]) continue;

        const graveOwnerSide = ['me', 'opp'].find((checkSide) =>
          grave[checkSide].some((graveCard) => graveCard?.instance_id === card.instance_id)
        );
        const banishedOwnerSide = !graveOwnerSide
          ? ['me', 'opp'].find((checkSide) =>
            banished[checkSide].some(
              (banishedCard) => banishedCard?.instance_id === card.instance_id
            )
          )
          : null;
        if (!graveOwnerSide && !banishedOwnerSide) continue;

        const graveCard = graveOwnerSide
          ? grave[graveOwnerSide].find((graveEntry) => graveEntry?.instance_id === card.instance_id)
          : null;
        const banishedCard = banishedOwnerSide
          ? banished[banishedOwnerSide].find(
            (banishedEntry) => banishedEntry?.instance_id === card.instance_id
          )
          : null;
        const wasBattleRevealedFaceUp = Boolean(
          card.faceDown
          && previousGame.pendingBattle?.defenderInstanceId === card.instance_id
          && previousGame.pendingBattle?.revealedFaceDown
        );
        zone[index] = wasBattleRevealedFaceUp
          ? { ...(graveCard || banishedCard || card), faceDown: false }
          : card;
        if (graveOwnerSide) {
          grave[graveOwnerSide] = grave[graveOwnerSide].filter(
            (graveCard) => graveCard?.instance_id !== card.instance_id
          );
        }
        if (banishedOwnerSide) {
          banished[banishedOwnerSide] = banished[banishedOwnerSide].filter(
            (banishedCard) => banishedCard?.instance_id !== card.instance_id
          );
        }
        stagedAny = true;
      }
      field[side][kind] = zone;
    }
  }

  return stagedAny
    ? { ...resolvedGame, busy: true, field, grave, banished }
    : null;
}

export function stageDiceStatModification(previousGame, resolvedGame, diceRoll) {
  const operation = DICE_STAT_MODIFIER_OPERATIONS[diceRoll?.cardId];
  const value = Number(diceRoll?.value);
  if (
    !operation
    || !Number.isFinite(value)
    || value <= 0
    || !previousGame?.field
    || !resolvedGame?.field
  ) return null;

  const targetSide = diceRoll.cardId === 't-skull-dice'
    ? (diceRoll.player === 'me' ? 'opp' : 'me')
    : (diceRoll.player === 'opp' ? 'opp' : 'me');
  const previousMonsters = previousGame.field?.[targetSide]?.mon || [];
  const resolvedMonsters = resolvedGame.field?.[targetSide]?.mon || [];
  let changed = false;

  const nextMonsters = previousMonsters.map((previousCard) => {
    if (!previousCard?.instance_id) return previousCard;
    const resolvedCard = resolvedMonsters.find(
      (candidate) => candidate?.instance_id === previousCard.instance_id
    );
    const prevAtk = Number(previousCard.atk ?? 0);
    const prevDef = Number(previousCard.def ?? 0);
    const nextAtk = resolvedCard
      ? Number(resolvedCard.atk ?? prevAtk)
      : operation === 'divide'
        ? Math.floor(prevAtk / value)
        : prevAtk * value;
    const nextDef = resolvedCard
      ? Number(resolvedCard.def ?? prevDef)
      : operation === 'divide'
        ? Math.floor(prevDef / value)
        : prevDef * value;
    if (nextAtk === prevAtk && nextDef === prevDef) return previousCard;
    changed = true;
    return {
      ...previousCard,
      atk: nextAtk,
      def: nextDef,
      current_atk: nextAtk,
      current_def: nextDef
    };
  });

  if (!changed) return null;

  return {
    ...previousGame,
    busy: true,
    lastDiceRoll: resolvedGame.lastDiceRoll || diceRoll,
    field: {
      ...previousGame.field,
      [targetSide]: {
        ...previousGame.field[targetSide],
        mon: nextMonsters
      }
    }
  };
}

export function stageMonsterSummonResolution(previousGame, resolvedGame) {
  if (!hasNewlySummonedMonster(previousGame, resolvedGame)) return null;

  const field = {
    me: { ...resolvedGame.field.me, mon: resolvedGame.field.me.mon.slice() },
    opp: { ...resolvedGame.field.opp, mon: resolvedGame.field.opp.mon.slice() }
  };
  const previousIds = new Set(
    ['me', 'opp'].flatMap((side) =>
      previousGame.field[side].mon
        .map((card) => card?.instance_id)
        .filter(Boolean)
    )
  );
  let stagedAny = false;

  for (const side of ['me', 'opp']) {
    field[side].mon = field[side].mon.map((card) => {
      if (!card?.instance_id || card.faceDown || previousIds.has(card.instance_id)) {
        return card;
      }
      stagedAny = true;
      return null;
    });
  }

  return stagedAny
    ? { ...resolvedGame, busy: true, field }
    : null;
}

export function hasNewlySummonedMonster(previousGame, resolvedGame) {
  if (!previousGame?.field || !resolvedGame?.field) return false;
  const previousIds = new Set(
    ['me', 'opp'].flatMap((side) =>
      previousGame.field[side].mon
        .map((card) => card?.instance_id)
        .filter(Boolean)
    )
  );
  return ['me', 'opp'].some((side) =>
    resolvedGame.field[side].mon.some((card) =>
      card?.instance_id && !card.faceDown && !previousIds.has(card.instance_id)
    )
  );
}

export function stageReloadActivation(previousGame, activationGame, sourceInstanceId) {
  const sourceCard = previousGame.hand.me.find(
    (card) => card?.instance_id === sourceInstanceId
  );
  if (sourceCard?.id !== RELOAD_ID || !activationGame) return null;

  return {
    ...activationGame,
    busy: true,
    hand: {
      ...activationGame.hand,
      me: previousGame.hand.me.filter(
        (card) => card?.instance_id !== sourceInstanceId
      )
    },
    deck: {
      ...activationGame.deck,
      me: previousGame.deck.me
    }
  };
}

export function stageReloadResolution(
  activationGame,
  updatedGame,
  sourceCardId
) {
  if (
    !activationGame
    || !updatedGame
    || sourceCardId !== RELOAD_ID
  ) return null;
  const returnedCards = activationGame.hand.me;
  if (!returnedCards.length) return null;

  const returnedCardIds = new Set(
    returnedCards.map((card) => card.instance_id || card.id)
  );
  const drawnCards = updatedGame.hand.me.filter(
    (card) => !returnedCardIds.has(card.instance_id || card.id)
  );
  if (drawnCards.length > returnedCards.length) return null;

  return {
    returnedCount: returnedCards.length,
    drawnCount: drawnCards.length,
    shuffleStage: {
      ...activationGame,
      busy: true,
      hand: {
        ...activationGame.hand,
        me: []
      },
      deck: {
        ...activationGame.deck,
        me: hiddenCards(
          updatedGame.deck.me.length + drawnCards.length,
          'me-reload-shuffle'
        )
      }
    },
    drawStage: {
      ...activationGame,
      busy: true,
      hand: {
        ...activationGame.hand,
        me: drawnCards
      },
      deck: {
        ...activationGame.deck,
        me: updatedGame.deck.me
      }
    }
  };
}

export function stageAiReloadResolution(
  previousGame,
  updatedGame,
  sourceHandIndex
) {
  if (
    !previousGame
    || !updatedGame
    || !Number.isInteger(sourceHandIndex)
    || sourceHandIndex < 0
    || sourceHandIndex >= previousGame.hand.opp.length
  ) return null;

  const returnedCards = previousGame.hand.opp.filter(
    (_, index) => index !== sourceHandIndex
  );
  if (!returnedCards.length) return null;
  const drawnCount = updatedGame.hand.opp.length;
  if (drawnCount > returnedCards.length) return null;

  const activationStage = {
    ...updatedGame,
    busy: true,
    hand: {
      ...updatedGame.hand,
      opp: returnedCards
    },
    deck: {
      ...updatedGame.deck,
      opp: previousGame.deck.opp
    }
  };
  const shuffleStage = {
    ...activationStage,
    hand: {
      ...activationStage.hand,
      opp: []
    },
    deck: {
      ...activationStage.deck,
      opp: hiddenCards(
        updatedGame.deck.opp.length + drawnCount,
        'opp-reload-shuffle'
      )
    }
  };
  const drawStage = {
    ...activationStage,
    hand: {
      ...activationStage.hand,
      opp: hiddenCards(drawnCount, 'opp-reload-draw').map((card, index) => ({
        ...card,
        _motion: `${card.id}-${++drawMotionSequence}-draw`,
        _motionDelay: index * DUEL_DRAW_STAGGER_MS
      }))
    },
    deck: {
      ...activationStage.deck,
      opp: updatedGame.deck.opp
    }
  };

  return {
    returnedCount: returnedCards.length,
    drawnCount,
    activationStage,
    shuffleStage,
    drawStage
  };
}

export function getBattleDefenderState(game, action) {
  const instanceId = action.type === 'attack'
    ? action.defender_instance_id
    : game.pendingBattle?.defenderInstanceId;
  const faceDown = Boolean(
    instanceId
    && (
      action.type === 'attack'
        ? game.field.opp.mon.some(
          (card) => card?.instance_id === instanceId && card.faceDown
        )
        : game.pendingBattle?.revealedFaceDown
          || game.field.opp.mon.some(
            (card) => card?.instance_id === instanceId && card.faceDown
          )
    )
  );
  return { instanceId, faceDown };
}

export function getMagicCylinderRedirect(previousGame, updatedGame, action) {
  const pendingAttackerId = previousGame.pendingBattle?.attackerInstanceId;
  const attackerInstanceId = pendingAttackerId
    || (action.type === 'attack' ? action.attacker_instance_id : null);
  if (!attackerInstanceId) return null;

  const attackerSide = ['me', 'opp'].find((side) =>
    previousGame.field[side].mon.some(
      (card) => card?.instance_id === attackerInstanceId
    )
  );
  if (!attackerSide) return null;

  const chainSourceId = previousGame.chain?.links?.find(
    (link) => link.card_id === 't-magic-cylinder'
  )?.source_instance_id;
  const sourceInstanceId = action.type === 'activate_effect'
    ? action.source_instance_id
    : chainSourceId;
  const resolvedTrap = ['me', 'opp'].flatMap((side) =>
    previousGame.field[side].st
      .filter((card) =>
        card?.instance_id
        && (!card.id || card.id === 't-magic-cylinder')
        && (!sourceInstanceId || card.instance_id === sourceInstanceId)
      )
      .map((card) => ({ side, card }))
  ).find(({ side, card }) =>
    updatedGame.grave[side].some(
      (graveCard) =>
        graveCard?.instance_id === card.instance_id
        && graveCard.id === 't-magic-cylinder'
    )
  );
  if (!resolvedTrap) return null;

  const attacker = previousGame.field[attackerSide].mon.find(
    (card) => card?.instance_id === attackerInstanceId
  );
  const damage = Math.max(0, Number(attacker?.atk) || 0);
  const lifePointLoss = previousGame.lp[attackerSide] - updatedGame.lp[attackerSide];
  if (lifePointLoss < damage) return null;

  return { attackerSide, attackerInstanceId };
}

export function getLacoodaBattleNegation(previousGame, updatedGame, attackerSide) {
  if (!previousGame?.field || !updatedGame?.field || !['me', 'opp'].includes(attackerSide)) {
    return null;
  }
  const defenderSide = attackerSide === 'me' ? 'opp' : 'me';
  if (
    updatedGame.lp?.[attackerSide] !== previousGame.lp?.[attackerSide]
    || updatedGame.lp?.[defenderSide] !== previousGame.lp?.[defenderSide]
  ) {
    return null;
  }
  const prevHandLen = previousGame.hand?.[defenderSide]?.length ?? 0;
  const nextHandLen = updatedGame.hand?.[defenderSide]?.length ?? 0;
  if (nextHandLen <= prevHandLen) return null;

  const zoneIndex = (updatedGame.field?.[defenderSide]?.mon || []).findIndex(
    (card) =>
      card?.id === 'm-3-hump-lacooda'
      && !card.faceDown
      && (previousGame.field?.[defenderSide]?.mon || []).some(
        (prevCard) => prevCard?.instance_id === card.instance_id
      )
  );
  if (zoneIndex < 0) return null;

  return {
    side: defenderSide,
    zoneIndex,
    card: updatedGame.field[defenderSide].mon[zoneIndex]
  };
}

export function stageSliferPreTriggerResolution(previousGame, resolvedGame, handledSliferSeq = 0) {
  const triggers = (resolvedGame?.lastSliferTriggers || []).filter(
    (entry) => entry?.seq > handledSliferSeq && entry.monster && entry.targetInstanceId
  );
  if (!triggers.length || !resolvedGame?.field) return null;

  const previousMonsterIds = new Set(
    ['me', 'opp'].flatMap((side) =>
      (previousGame?.field?.[side]?.mon || [])
        .map((card) => card?.instance_id)
        .filter(Boolean)
    )
  );
  const field = {
    me: { ...resolvedGame.field.me, mon: resolvedGame.field.me.mon.slice() },
    opp: { ...resolvedGame.field.opp, mon: resolvedGame.field.opp.mon.slice() }
  };
  const grave = {
    me: (resolvedGame.grave?.me || []).slice(),
    opp: (resolvedGame.grave?.opp || []).slice()
  };
  const banished = {
    me: (resolvedGame.banished?.me || []).slice(),
    opp: (resolvedGame.banished?.opp || []).slice()
  };
  let stagedAny = false;

  triggers.forEach((trigger) => {
    const side = trigger.targetSide;
    const zoneIndex = field[side].mon.findIndex(
      (card) => card?.instance_id === trigger.targetInstanceId
    );
    const resolvedIndex = zoneIndex >= 0 ? zoneIndex : trigger.targetZoneIndex;
    if (resolvedIndex < 0 || resolvedIndex >= field[side].mon.length) return;

    const existingOnField = zoneIndex >= 0 ? field[side].mon[zoneIndex] : null;
    if (existingOnField) {
      field[side].mon[resolvedIndex] = {
        ...existingOnField,
        atk: trigger.preAtk,
        def: trigger.preDef,
        current_atk: trigger.preAtk,
        current_def: trigger.preDef
      };
      stagedAny = true;
      return;
    }

    if (!field[side].mon[resolvedIndex]) {
      const wasAlreadyOnField = previousMonsterIds.has(trigger.targetInstanceId);
      field[side].mon[resolvedIndex] = {
        ...trigger.monster,
        atk: trigger.preAtk,
        def: trigger.preDef,
        current_atk: trigger.preAtk,
        current_def: trigger.preDef,
        ...(wasAlreadyOnField
          ? {}
          : { _motion: `${trigger.targetInstanceId}-${++drawMotionSequence}-summon` })
      };
      ['me', 'opp'].forEach((checkSide) => {
        grave[checkSide] = grave[checkSide].filter(
          (card) => card?.instance_id !== trigger.targetInstanceId
        );
        banished[checkSide] = banished[checkSide].filter(
          (card) => card?.instance_id !== trigger.targetInstanceId
        );
      });
      stagedAny = true;
    }
  });

  return stagedAny
    ? { ...resolvedGame, busy: true, field, grave, banished }
    : null;
}

export function applySliferTriggerStatReduction(baseGame, trigger) {
  if (!baseGame?.field || !trigger?.targetInstanceId) return null;
  const side = trigger.targetSide;
  const monsters = baseGame.field?.[side]?.mon;
  if (!Array.isArray(monsters)) return null;
  const index = monsters.findIndex(
    (card) => card?.instance_id === trigger.targetInstanceId
  );
  if (index < 0) return null;

  const targetCard = monsters[index];
  const nextMonsters = monsters.slice();
  nextMonsters[index] = {
    ...targetCard,
    _motion: undefined,
    atk: trigger.postAtk,
    def: trigger.postDef,
    current_atk: trigger.postAtk,
    current_def: trigger.postDef
  };
  return {
    ...baseGame,
    busy: true,
    field: {
      ...baseGame.field,
      [side]: {
        ...baseGame.field[side],
        mon: nextMonsters
      }
    }
  };
}

export async function requestDuelJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('Máy chủ không trả về dữ liệu Duel dạng JSON.');
  }
  if (!response.ok) {
    throw new Error(result.error || 'Yêu cầu Duel không thành công.');
  }
  return result;
}

export async function postDuelAction(matchId, action) {
  return requestDuelJson('/api/duel/action', {
    method: 'POST',
    body: JSON.stringify({ match_id: matchId, action })
  });
}
