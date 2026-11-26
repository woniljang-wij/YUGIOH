import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CardFace } from '../components/CardFace.jsx';
import CardDetailDialog from '../components/CardDetailDialog.jsx';
import { mountOrichalcosBoardEffect } from '../renderers/orichalcosRenderer.js';
import { playSliferLightningMotion } from '../renderers/sliferLightningRenderer.js';
import { getDuelCardArtwork, getRetriedDuelCardArtworkSource } from './duelCardArt.js';
import {
  EQUIP_SPELL_CARD_IDS,
  DRAGGABLE_EFFECT_TARGET_MODES,
  getEquipSpellTarget,
  getFieldEffectTarget
} from './duelTargetDrag.js';
import { scheduleAutoPhaseAdvance } from './duelAutoPhase.js';
import AttackLockChainOverlay from './AttackLockChainOverlay.jsx';
import AttackArrowCanvas from './AttackArrowCanvas.jsx';
import { MidlineExDivider, MonsterZoneFrame } from './DuelBoardFrames.jsx';
import DuelResultModal from './DuelResultModal.jsx';
import {
  getAttackArrowHeadPoints,
  getAttackArrowStart,
  DUEL_CONTROL_TRANSFER_DURATION_MS,
  DUEL_PLACEMENT_DURATION_MS,
  DUEL_SUMMON_DURATION_MS,
  DUEL_TRICKY_DISCARD_JUMP_DURATION_MS,
  DUEL_TRICKY_DISCARD_FLIGHT_DURATION_MS,
  getDrawSequenceDuration,
  createDuelHandReturnMotion,
  playDuelBattleMotion,
  playDuelCardMotion,
  playDuelCounterbalanceMotion,
  playDuelTrapActivationMotion,
  playDuelEffectActivationGlow,
  playDuelControlTransferMotion,
  playDuelExodiaFinish,
  playDuelSurrenderExplosion,
  playDuelDiceRoll,
  playDuelDestructionMotion,
  playDuelDeckShuffleMotion,
  playDuelMillMotion,
  playDuelSfx,
  createDuelHandDiscardMotion
} from './duelMotion.js';
import {
  applyLifePointChange,
  applySliferSummonEffect,
  canBeTargetedByEffects,
  calculateBattle,
  calculateDirectAttack,
  calculateRaTributeStats,
  DUEL_PHASES,
  getLegalActions,
  hasFaceUpOpponentMonster,
  getRequiredTributes,
  getSliferStats,
  MAX_END_PHASE_HAND_SIZE,
  MAX_FIELD_ZONES,
  STARTING_LP,
  validateTributes
} from './duelRules.js';
import {
  applyDrawTriggers,
  checkWinByExodia,
  getTargetMode,
  resolveAttackTrap,
  resolveMonsterSummonEffects,
  resolveNormalSpell,
  resolveStandbyEffects,
  resolveTrapActivation,
  resolveTargetedEffect
} from './duelEffects.js';
import {
  getBattleDefenderState,
  getLacoodaBattleNegation,
  createAiTurnStages,
  hasNewlySummonedMonster,
  getTemporaryControlTransfers,
  getAiActivatedSpellTrap,
  getAiDiscardedCards,
  getAiDestroyedFieldCards,
  getMillCountsBetweenStages,
  getMagicCylinderRedirect,
  getLightningStormDestroyedZones,
  getRevivedJamCards,
  isMonsterAttackLockedBySpellTrap,
  mapDuelMatch,
  mergeDuelPlayerProfile,
  postDuelAction,
  requestDuelJson,
  didResolveCardDestruction,
  stageCardDestructionResolution,
  stageDiceStatModification,
  stageEquipSpellResolution,
  stageSpellTrapActivation,
  stageTemporaryControlTransfers,
  stagePotOfGreedResolution,
  stageFieldDestructionResolution,
  stageMonsterSummonResolution,
  stageAiReloadResolution,
  stageReloadActivation,
  stageReloadResolution,
  stageSliferPreTriggerResolution,
  applySliferTriggerStatReduction
} from './duelApi.js';
import { useDuelCanvasEngine } from './useDuelCanvasEngine.js';
import { useOnlinePresence } from '../useOnlinePresence.js';

const PHASES = [
  { id: DUEL_PHASES[0], label: 'RÚT BÀI' },
  { id: DUEL_PHASES[1], label: 'CHỜ' },
  { id: DUEL_PHASES[2], label: 'CHÍNH 1' },
  { id: DUEL_PHASES[3], label: 'CHIẾN ĐẤU' },
  { id: DUEL_PHASES[4], label: 'CHÍNH 2' },
  { id: DUEL_PHASES[5], label: 'KẾT THÚC' }
];
const HAND_TARGET_DRAG_SPELL_IDS = new Set([
  's-brain-control',
  's-change-of-heart'
]);

const DUEL_CHARACTER_AVATARS = {
  'kaiba-seto': '/assets/images/hero/kaiba-seto.png',
  'muto-yugi': '/assets/images/hero/muto-yugi.png',
  'jonouchi-katsuya': '/assets/images/hero/jonouchi-katsuya.png'
};

function normalizeCard(card) {
  if (!card) return null;
  const category = String(card.category || card.type || '').toLowerCase();
  if (!['monster', 'fusion', 'spell', 'trap'].includes(category)) return null;
  return {
    ...card,
    category,
    type: category === 'fusion' ? 'monster' : category,
    attr: card.attribute || card.attr || '',
    lv: card.level || card.lv || 0
  };
}

function shuffle(cards) {
  const result = cards.slice();
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function buildDeck(size, catalog) {
  const cards = catalog.map(normalizeCard).filter(Boolean);
  if (!cards.length) throw new Error('Danh sách bài đấu không có lá bài hợp lệ.');
  return shuffle(Array.from({ length: size }, (_, index) => cards[index % cards.length]));
}

function buildSelectedDeck(entries, catalog) {
  if (!Array.isArray(entries)) throw new Error('Danh sách Main Deck không hợp lệ.');
  const cardsById = new Map(
    catalog.map((card) => {
      const normalized = normalizeCard(card);
      return normalized ? [String(normalized.id), normalized] : null;
    }).filter(Boolean)
  );
  const cards = [];
  for (const entry of entries) {
    if (!entry || !Number.isInteger(entry.quantity) || entry.quantity < 1) {
      throw new Error('Số lượng thẻ trong bộ bài không hợp lệ.');
    }
    const card = cardsById.get(String(entry.card_id));
    if (!card) throw new Error('Một hoặc nhiều thẻ trong bộ bài không có trong danh mục.');
    for (let count = 0; count < entry.quantity; count += 1) {
      cards.push({ ...card });
    }
  }
  if (cards.length < 40 || cards.length > 60) {
    throw new Error(`Main Deck cần từ 40 đến 60 lá (hiện có ${cards.length}).`);
  }
  return shuffle(cards);
}

function createGame(catalog, warning, selectedDeck) {
  const game = {
    turn: 'me',
    firstPlayer: 'me',
    phaseIndex: 0,
    turnCount: 1,
    selected: null,
    selectedPosition: 'attack',
    selectedTributes: [],
    attackingIndex: null,
    effectMode: null,
    pendingEffect: null,
    pendingDiscardCount: 0,
    attacked: { me: [], opp: [] },
    normalSummonUsed: { me: false, opp: false },
    drawnThisTurn: false,
    firstTurn: true,
    lp: { me: STARTING_LP, opp: STARTING_LP },
    busy: false,
    over: false,
    winner: null,
    deck: {
      me: selectedDeck ? buildSelectedDeck(selectedDeck.main_cards, catalog) : buildDeck(40, catalog),
      opp: buildDeck(40, catalog)
    },
    hand: { me: [], opp: [] },
    grave: { me: [], opp: [] },
    field: {
      me: { mon: Array(MAX_FIELD_ZONES).fill(null), st: Array(MAX_FIELD_ZONES).fill(null) },
      opp: { mon: Array(MAX_FIELD_ZONES).fill(null), st: Array(MAX_FIELD_ZONES).fill(null) }
    },
    log: [],
    logId: 0,
    motionId: 0,
    logOpen: false,
    ready: true
  };

  for (let index = 0; index < 5; index += 1) {
    game.hand.me.push(game.deck.me.pop());
    game.hand.opp.push(game.deck.opp.pop());
  }
  if (checkWinByExodia(game, 'me')) {
    appendLog(game, 'Bạn tập hợp đủ 5 mảnh Exodia và thắng Duel!', 'me');
  } else if (checkWinByExodia(game, 'opp')) {
    appendLog(game, 'Đối thủ tập hợp đủ 5 mảnh Exodia và thắng Duel!', 'opp');
  }
  appendLog(game, 'Trận đấu bắt đầu! LP mỗi bên: <b>8000</b>.', 'sys');
  appendLog(game, 'Lượt đầu tiên: người đi trước không rút bài. Chọn giai đoạn để bắt đầu.', 'me');
  if (warning) {
    appendLog(
      game,
      `Không tải được danh mục bài từ máy chủ; trận đấu đang dùng bộ bài mẫu. ${warning}`,
      'sys'
    );
  }
  return game;
}

function appendLog(game, message, kind = 'sys') {
  if (game.log?.some((entry, index) => index < 8 && entry.message === message && entry.kind === (kind === 'me' || kind === 'opp' ? kind : 'sys'))) {
    return game;
  }
  game.log = [
    { id: game.logId++, message, kind: kind === 'me' || kind === 'opp' ? kind : 'sys' },
    ...game.log
  ].slice(0, 60);
}

function draw(game, who, silent = false) {
  if (!game.deck[who].length) {
    game.over = true;
    game.winner = who === 'me' ? 'opp' : 'me';
    appendLog(game, `<b>${who === 'me' ? 'Bạn' : 'Đối thủ'}</b> thua vì không thể rút bài.`, 'sys');
    return null;
  }
  const card = game.deck[who].pop();
  game.hand[who].push(card);
  if (checkWinByExodia(game, who)) {
    appendLog(game, `${who === 'me' ? 'Bạn' : 'Đối thủ'} tập hợp đủ 5 mảnh Exodia và thắng Duel!`, who);
  }
  const triggerLogs = applyDrawTriggers(game, who, 1);
  if (!silent) appendLog(game, `<b>${who === 'me' ? 'Bạn' : 'Đối thủ'}</b> rút 1 lá bài.`, who);
  triggerLogs.forEach((message) => appendLog(game, message, who));
  return card;
}

function withChangedGame(state, mutate) {
  const next = {
    ...state,
    lp: { ...state.lp },
    attacked: { me: state.attacked.me.slice(), opp: state.attacked.opp.slice() },
    normalSummonUsed: { ...state.normalSummonUsed },
    selectedTributes: state.selectedTributes.slice(),
    deck: { me: state.deck.me.slice(), opp: state.deck.opp.slice() },
    hand: { me: state.hand.me.slice(), opp: state.hand.opp.slice() },
    grave: { me: state.grave.me.slice(), opp: state.grave.opp.slice() },
    field: {
      me: { mon: state.field.me.mon.slice(), st: state.field.me.st.slice() },
      opp: { mon: state.field.opp.mon.slice(), st: state.field.opp.st.slice() }
    },
    log: state.log.slice()
  };
  mutate(next);
  if (!next.over) {
    if (checkWinByExodia(next, 'me')) {
      appendLog(next, 'Bạn tập hợp đủ 5 mảnh Exodia và thắng Duel!', 'me');
    } else if (checkWinByExodia(next, 'opp')) {
      appendLog(next, 'Đối thủ tập hợp đủ 5 mảnh Exodia và thắng Duel!', 'opp');
    }
  }
  return next;
}

function placeCard(game, who, kind, index, card) {
  const dragonCaptureJarActive = ['me', 'opp'].some((owner) =>
    game.field[owner].st.some((trap) => trap?.id === 't-dragon-capture-jar' && !trap.faceDown)
  );
  const position = kind === 'mon' && !card.faceDown && dragonCaptureJarActive && isDragonCard(card)
    ? 'defense'
    : card.position || 'attack';
  const placedCard = {
    ...card,
    position: kind === 'mon' ? position : undefined,
    summonedTurn: kind === 'mon' && !card.faceDown ? game.turnCount : undefined,
    setTurn: card.faceDown || card.type === 'trap' ? game.turnCount : undefined,
    _motion: `${game.motionId++}-summon`
  };
  game.field[who][kind][index] = placedCard;
  const action = card.faceDown || card.type === 'trap'
    ? 'đặt úp'
    : kind === 'mon' ? 'triệu hồi' : 'kích hoạt';
  appendLog(game, `<b>${who === 'me' ? 'Bạn' : 'Đối thủ'}</b> ${action} <b>${card.name}</b>.`, who);
}

function placeSpecialSummon(game, who, index, card, position = 'attack') {
  const dragonCaptureJarActive = ['me', 'opp'].some((owner) =>
    game.field[owner].st.some((trap) => trap?.id === 't-dragon-capture-jar' && !trap.faceDown)
  );
  const summoned = {
    ...card,
    faceDown: false,
    position: dragonCaptureJarActive && isDragonCard(card) ? 'defense' : position,
    summonMethod: 'special',
    summonedTurn: game.turnCount,
    _motion: `${game.motionId++}-summon`
  };
  game.field[who].mon[index] = summoned;
  const opponent = who === 'me' ? 'opp' : 'me';
  if (
    !game.field[opponent].mon.some((monster) => monster?.id === 'm-slifer-the-sky-dragon')
    || game.effectProtection?.[who] === game.turnCount
  ) return summoned;
  // m-slifer-the-sky-dragon — Sấm Sét Thần applies to every opposing summon.
  const result = applySliferSummonEffect(summoned, summoned.position);
  game.field[who].mon[index] = result.monster;
  appendLog(game, `Sấm Sét Thần của <b>Slifer</b> giảm ${result.stat.toUpperCase()} của <b>${card.name}</b> 2000.`, opponent);
  if (result.destroyed) {
    removeFromFieldToGrave(game, who, index);
    appendLog(game, `<b>${card.name}</b> bị phá hủy bởi hiệu ứng của Slifer.`, 'sys');
    return null;
  }
  return result.monster;
}

function refreshSlifer(game, who) {
  const sliferIndex = game.field[who].mon.findIndex((card) => card?.id === 'm-slifer-the-sky-dragon');
  if (sliferIndex === -1) return;
  const slifer = game.field[who].mon[sliferIndex];
  const stats = getSliferStats(slifer, game.hand[who].length);
  game.field[who].mon[sliferIndex] = { ...slifer, ...stats };
}

function isMainPhase(phaseIndex) {
  return phaseIndex === 2 || phaseIndex === 4;
}

function removeFromFieldToGrave(game, who, index) {
  const card = game.field[who].mon[index];
  if (!card) return null;
  game.field[who].mon[index] = null;
  if (card.id !== 'token-kuriboh') game.grave[who].push(card);
  return card;
}

function returnTemporaryControl(game, controller, turnCount) {
  game.field[controller].mon.forEach((card, index) => {
    if (card?.temporaryControl?.turnCount !== turnCount) return;
    // s-change-of-heart / s-brain-control — return borrowed monsters at end of turn.
    const { returnTo, zoneIndex } = card.temporaryControl;
    const destination = game.field[returnTo].mon[zoneIndex]
      ? game.field[returnTo].mon.findIndex((monster) => !monster)
      : zoneIndex;
    game.field[controller].mon[index] = null;
    const { temporaryControl, ...returnedCard } = card;
    if (destination < 0) {
      game.grave[returnTo].push(returnedCard);
      appendLog(game, `<b>${returnedCard.name}</b> được gửi vào Mộ vì sân chủ sở hữu đã đầy.`, 'sys');
      return;
    }
    game.field[returnTo].mon[destination] = returnedCard;
    appendLog(game, `<b>${returnedCard.name}</b> trở về quyền điều khiển của chủ sở hữu.`, 'sys');
  });
}

function advanceSwordsOfRevealingLight(game, endingPlayer) {
  for (const owner of ['me', 'opp']) {
    game.field[owner].st.forEach((card, index) => {
      if (card?.id !== 's-swords-of-revealing-light' || card.faceDown || owner === endingPlayer) return;
      const opponentEnds = (card.opponentEnds || 0) + 1;
      if (opponentEnds >= 3) {
        game.field[owner].st[index] = null;
        game.grave[owner].push(card);
        appendLog(game, '<b>Vòng Tròn Kiếm Ánh Sáng</b> bị phá hủy sau lượt thứ ba của đối thủ.', 'sys');
      } else {
        game.field[owner].st[index] = { ...card, opponentEnds };
      }
    });
  }
}

function completePendingEffect(game, target) {
  const pending = game.pendingEffect;
  const resolution = resolveTargetedEffect(game, pending.player, pending.card, {
    ...target,
    sourceIndex: pending.sourceIndex
  });
  if (!resolution.activated) {
    appendLog(game, resolution.reason || 'Mục tiêu không hợp lệ.', 'sys');
    return false;
  }
  if (pending.source !== 'field') {
    game.grave[pending.player].push(pending.card);
  } else if (!resolution.keepOnField) {
    const trap = game.field[pending.player].st[pending.sourceIndex];
    if (trap) {
      game.field[pending.player].st[pending.sourceIndex] = null;
      game.grave[pending.player].push(trap);
    }
  }
  game.pendingEffect = null;
  game.effectMode = null;
  appendLog(game, `<b>${pending.card.name}</b> được giải quyết.`, pending.player);
  resolution.logs.forEach((message) => appendLog(game, message, 'sys'));
  refreshSlifer(game, 'me');
  refreshSlifer(game, 'opp');
  return true;
}

function isDragonCard(card) {
  const race = String(card?.race || card?.monsterType || '').toLowerCase();
  return race.includes('rồng') || race.includes('dragon');
}

const VALKYRION_ID = 'm-valkyrion-the-magna-warrior';
const HORAKHTY_ID = 'm-the-creator-god-of-light-horakhty';
const GOD_MONSTER_IDS = new Set([
  'm-slifer-the-sky-dragon',
  'm-obelisk-the-tormentor',
  'm-the-winged-dragon-of-ra',
  HORAKHTY_ID
]);
const NON_NORMAL_SUMMON_MONSTER_IDS = new Set([
  VALKYRION_ID,
  'm-blue-eyes-alternative-white-dragon',
  'm-chaos-emperor-dragon-envoy-of-the-end',
  'm-chaos-dragon-levianeer'
]);
const FLIP_ACTIVATION_MONSTER_IDS = new Set([
  'm-morphing-jar',
  'm-needle-worm',
  'm-ryko-lightsworn-hunter',
  'm-night-assailant',
  'm-man-eater-bug',
  'm-marshmallon'
]);
const VALKYRION_MATERIAL_IDS = [
  'm-alpha-the-magnet-warrior',
  'm-beta-the-magnet-warrior',
  'm-gamma-the-magnet-warrior'
];

function getValkyrionMaterialCandidates(game) {
  return [
    ...(game?.hand?.me || []).map((card) => ({ card, zone: 'hand' })),
    ...(game?.field?.me?.mon || [])
      .filter((card) => card && !card.faceDown)
      .map((card) => ({ card, zone: 'field' }))
  ].filter(({ card }) => VALKYRION_MATERIAL_IDS.includes(card.id));
}

function canSummonValkyrionFromHand(game, card) {
  if (card?.id !== VALKYRION_ID) return false;
  const candidates = getValkyrionMaterialCandidates(game);
  return VALKYRION_MATERIAL_IDS.every((materialId) =>
    candidates.some(({ card: candidate }) => candidate.id === materialId)
  ) && (
    game.field.me.mon.some((fieldCard) => !fieldCard)
    || candidates.some(({ card: candidate, zone }) =>
      zone === 'field' && VALKYRION_MATERIAL_IDS.includes(candidate.id)
    )
  );
}

function canSplitValkyrion(game, card) {
  const grave = game?.grave?.me || [];
  return card?.id === VALKYRION_ID
    && !card.faceDown
    && VALKYRION_MATERIAL_IDS.every((materialId) =>
      grave.some((graveCard) => graveCard.id === materialId)
    )
    && game.field.me.mon.filter((fieldCard) => !fieldCard).length + 1
      >= VALKYRION_MATERIAL_IDS.length;
}

function hasValkyrionMaterialTypeSelected(game, selectedIds, materialId) {
  return getValkyrionMaterialCandidates(game).some(
    ({ card }) => card.id === materialId && selectedIds.includes(card.instance_id)
  );
}

function hasGraveValkyrionMaterialTypeSelected(game, selectedIds, materialId) {
  return (game?.grave?.me || []).some(
    (card) => card.id === materialId && selectedIds.includes(card.instance_id)
  );
}

function hasCompleteValkyrionMaterialSet(game, selectedIds) {
  const selected = getValkyrionMaterialCandidates(game)
    .filter(({ card }) => selectedIds.includes(card.instance_id));
  const selectedTypes = new Set(selected.map(({ card }) => card.id));
  return selected.length === VALKYRION_MATERIAL_IDS.length
    && VALKYRION_MATERIAL_IDS.every((materialId) => selectedTypes.has(materialId));
}

function hasCompleteGraveValkyrionMaterialSet(game, selectedIds) {
  const selected = (game?.grave?.me || [])
    .filter((card) => selectedIds.includes(card.instance_id));
  const selectedTypes = new Set(selected.map((card) => card.id));
  return selected.length === VALKYRION_MATERIAL_IDS.length
    && VALKYRION_MATERIAL_IDS.every((materialId) => selectedTypes.has(materialId));
}

function hasChaosEmperorAttributeSelected(game, selectedIds, attribute) {
  return (game?.grave?.me || []).some(
    (card) => selectedIds.includes(card.instance_id)
      && String(card.attribute || '').toUpperCase() === attribute
  );
}

function hasCompleteChaosEmperorMaterialSet(game, selectedIds) {
  const selected = (game?.grave?.me || [])
    .filter((card) => selectedIds.includes(card.instance_id));
  const attributes = new Set(
    selected.map((card) => String(card.attribute || '').toUpperCase())
  );
  return selected.length === 2
    && attributes.has('LIGHT')
    && attributes.has('DARK');
}

function hasCompleteLevianeerMaterialSet(game, selectedIds) {
  const selected = (game?.grave?.me || [])
    .filter((card) => selectedIds.includes(card.instance_id));
  return selected.length === 2
    && selected.every((card) =>
      ['monster', 'fusion'].includes(card.type)
      && ['LIGHT', 'DARK'].includes(
        String(card.attribute || '').toUpperCase()
      )
    );
}

function canSummonLevianeerFromHand(game, card) {
  if (!game?.field) return false;
  const grave = game?.grave?.me || [];
  const materials = grave.filter((graveCard) =>
    ['monster', 'fusion'].includes(graveCard.type)
    && ['LIGHT', 'DARK'].includes(
      String(graveCard.attribute || '').toUpperCase()
    )
  );
  return card?.id === 'm-chaos-dragon-levianeer'
    && game.field.me.mon.some((fieldCard) => !fieldCard)
    && materials.length >= 2;
}

function canSummonChaosEmperorFromHand(game, card) {
  if (!game?.field) return false;
  const grave = game?.grave?.me || [];
  return card?.id === 'm-chaos-emperor-dragon-envoy-of-the-end'
    && game.field.me.mon.some((fieldCard) => !fieldCard)
    && grave.some((graveCard) =>
      ['monster', 'fusion'].includes(graveCard.type)
      && String(graveCard.attribute || '').toUpperCase() === 'LIGHT'
    )
    && grave.some((graveCard) =>
      ['monster', 'fusion'].includes(graveCard.type)
      && String(graveCard.attribute || '').toUpperCase() === 'DARK'
    );
}

function getUnionRule(card) {
  if (card?.id === 'm-y-dragon-head') {
    return { targetIds: ['m-x-head-cannon'] };
  }
  if (card?.id === 'm-z-metal-tank') {
    return { targetIds: ['m-x-head-cannon', 'm-y-dragon-head'] };
  }
  return null;
}

function canEquipUnionMonster(game, card) {
  if (!game?.field) return false;
  const rule = getUnionRule(card);
  const isOnMonsterField = game.field.me.mon.some(
    (fieldCard) => fieldCard?.instance_id === card?.instance_id
  );
  return Boolean(rule)
    && (!isOnMonsterField || (!card.faceDown && !card.monster_effects_negated))
    && game.field.me.mon.some((fieldCard) =>
      rule.targetIds.includes(fieldCard?.id) && !fieldCard.faceDown
    )
    && game.field.me.st.some((fieldCard) => !fieldCard);
}

function canDetachUnionMonster(game, card) {
  if (!game?.field) return false;
  return Boolean(getUnionRule(card))
    && card.union_equipped
    && !card.faceDown
    && Boolean(card.target_instance_id)
    && game.field.me.mon.some((fieldCard) => !fieldCard);
}

function hasValkyrionSummonSpaceForSelection(game, selectedIds) {
  return game.field.me.mon.some((card) => !card)
    || getValkyrionMaterialCandidates(game).some(
      ({ card, zone }) => zone === 'field' && selectedIds.includes(card.instance_id)
    );
}

function getPendingGraveChoices(game) {
  const targetMode = game.pendingEffect?.targetMode;
  const eligibleIds = game.pendingDecision?.eligible_target_instance_ids;
  if (!targetMode?.startsWith('grave-')) return [];
  return ['me', 'opp'].flatMap((owner) =>
    game.grave[owner]
      .map((card, index) => ({ card, owner, index }))
      .filter(({ card, owner }) => {
        if (Array.isArray(eligibleIds) && !eligibleIds.includes(card.instance_id)) {
          return false;
        }
        if (targetMode === 'grave-any') return true;
        if (targetMode === 'grave-opponent-any') return owner === 'opp';
        if (targetMode === 'grave-own-any') return owner === 'me';
        if (targetMode === 'grave-valkyrion') {
          return owner === 'me' && VALKYRION_MATERIAL_IDS.includes(card.id);
        }
        if (targetMode === 'grave-chaos-emperor') {
          return owner === 'me'
            && ['monster', 'fusion'].includes(card.type)
            && ['LIGHT', 'DARK'].includes(
              String(card.attribute || '').toUpperCase()
            );
        }
        if (targetMode === 'grave-levianeer') {
          return owner === 'me'
            && ['monster', 'fusion'].includes(card.type)
            && ['LIGHT', 'DARK'].includes(
              String(card.attribute || '').toUpperCase()
            );
        }
        if (targetMode === 'grave-own-spell') {
          return owner === 'me' && card.type === 'spell';
        }
        if (targetMode === 'grave-white-stone') {
          return owner === 'me' && card.id === 'm-blue-eyes-white-dragon';
        }
        if (targetMode === 'grave-monster') return card.type === 'monster';
        const level = Number(card.level ?? card.lv);
        return targetMode === 'grave-dragon-level-7-8'
          && owner === game.pendingEffect.player
          && card.type === 'monster'
          && isDragonCard(card)
          && [7, 8].includes(level);
      })
  );
}

function resolveBattle(game, attackerIndex, defenderIndex) {
  const attacker = game.field.me.mon[attackerIndex];
  if (!attacker) {
    appendLog(game, 'Quái thú tấn công không còn trên sân.', 'sys');
    game.attackingIndex = null;
    return;
  }
  const attackTrap = resolveAttackTrap(game, 'me', attackerIndex);
  if (attackTrap.activated) {
    attackTrap.logs.forEach((message) => appendLog(game, message, 'opp'));
    if (attackTrap.cancelled) {
      game.attacked.me.push(attackerIndex);
      game.attackingIndex = null;
      return;
    }
  }
  const defenderProtected = game.battleProtection?.player === 'opp'
    && game.battleProtection.turn === game.turn
    && game.battleProtection.turnCount === game.turnCount;
  const defender = game.field.opp.mon[defenderIndex];
  if (!defender) {
    const direct = calculateDirectAttack(attacker, game.field.opp.mon);
    if (!direct.legal) {
      appendLog(game, 'Không thể tấn công trực tiếp khi đối thủ còn quái thú.', 'sys');
      return;
    }
    const damage = defenderProtected ? 0 : direct.damage;
    Object.assign(game, applyLifePointChange(game, 'opp', damage));
    appendLog(game, `<b>${attacker.name}</b> tấn công trực tiếp, gây ${damage} sát thương.`, 'me');
  } else {
    const result = calculateBattle(attacker, defender, defender.position);
    if (game.effectProtection?.me === game.turnCount) {
      result.destroyed = result.destroyed.filter((destroyedCard) => destroyedCard !== 'attacker');
    }
    if (game.effectProtection?.opp === game.turnCount) {
      result.destroyed = result.destroyed.filter((destroyedCard) => destroyedCard !== 'defender');
    }
    if (defenderProtected) {
      result.destroyed = result.destroyed.filter((destroyedCard) => destroyedCard !== 'defender');
      result.damage.defender = 0;
    }
    if (result.destroyed.includes('attacker')) removeFromFieldToGrave(game, 'me', attackerIndex);
    if (result.destroyed.includes('defender')) removeFromFieldToGrave(game, 'opp', defenderIndex);
    if (result.damage.attacker) Object.assign(game, applyLifePointChange(game, 'me', result.damage.attacker));
    if (result.damage.defender) Object.assign(game, applyLifePointChange(game, 'opp', result.damage.defender));
    // m-marshmallon — survives battle; if attacked face-down, burns the attacker for 1000.
    if (defender.id === 'm-marshmallon' && defender.faceDown) {
      game.field.opp.mon[defenderIndex] = game.field.opp.mon[defenderIndex]
        ? { ...game.field.opp.mon[defenderIndex], faceDown: false }
        : null;
      Object.assign(game, applyLifePointChange(game, 'me', 1000));
      appendLog(game, 'Marshmallon gây thêm 1000 sát thương cho người tấn công.', 'opp');
    }
    // m-giant-germ — on battle destruction, damages the opponent and summons copies from Deck.
    if (result.destroyed.includes('defender') && defender.id === 'm-giant-germ') {
      Object.assign(game, applyLifePointChange(game, 'me', 500));
      appendLog(game, 'Vi Khuẩn Khổng Lồ gây 500 sát thương khi bị phá hủy trong chiến đấu.', 'opp');
      while (game.field.opp.mon.some((monster) => !monster)) {
        const germIndex = game.deck.opp.findIndex((card) => card.id === 'm-giant-germ');
        if (germIndex < 0) break;
        const zoneIndex = game.field.opp.mon.findIndex((monster) => !monster);
        const [germ] = game.deck.opp.splice(germIndex, 1);
        placeSpecialSummon(game, 'opp', zoneIndex, germ, 'defense');
      }
    }
    // m-revival-jam — on battle destruction, Special Summons itself in Defense Position.
    if (result.destroyed.includes('defender') && defender.id === 'm-revival-jam') {
      const graveIndex = game.grave.opp.findIndex((card) => card.id === defender.id);
      if (graveIndex >= 0) {
        const zoneIndex = game.field.opp.mon.findIndex((monster) => !monster);
        if (zoneIndex >= 0) {
          const [jam] = game.grave.opp.splice(graveIndex, 1);
          placeSpecialSummon(game, 'opp', zoneIndex, jam, 'defense');
        }
      }
    }
    // m-wall-of-illusion — after being attacked, returns the surviving attacker to its hand.
    if (defender.id === 'm-wall-of-illusion') {
      const currentAttacker = game.field.me.mon[attackerIndex];
      if (currentAttacker) {
        game.field.me.mon[attackerIndex] = null;
        game.hand.me.push(currentAttacker);
        appendLog(game, `<b>${currentAttacker.name}</b> bị trả về tay bởi Tường Ảo Ảnh.`, 'opp');
      }
    }
    appendLog(
      game,
      `<b>${attacker.name}</b> chiến đấu với <b>${defender.name}</b>.`,
      'me'
    );
    if (result.damage.attacker) appendLog(game, `Bạn mất ${result.damage.attacker} LP.`, 'sys');
    if (result.damage.defender) appendLog(game, `Đối thủ mất ${result.damage.defender} LP.`, 'sys');
  }
  game.attacked.me.push(attackerIndex);
  game.attackingIndex = null;
  if (game.lp.me === 0 || game.lp.opp === 0) {
    game.over = true;
    game.winner = game.lp.me === 0 ? (game.lp.opp === 0 ? null : 'opp') : 'me';
  }
}

function reducer(state, action) {
  if (action.type === 'initialize') return action.game;
  if (!state.ready) return state;
  if (action.type === 'uiDeselectCard') {
    return {
      ...state,
      selected: null,
      selectedPosition: 'attack',
      selectedTributes: []
    };
  }
  if (state.authoritative) {
    if (action.type === 'serverSync') return action.game;
    if (action.type === 'serverBusy') return { ...state, busy: action.busy };
    if (action.type === 'serverError') {
      const next = { ...state, log: state.log.slice(), logOpen: false };
      if (!action.silent) appendLog(next, action.message, 'sys');
      return next;
    }
    if (action.type === 'serverLog') {
      const next = { ...state, log: state.log.slice(), logOpen: true };
      appendLog(next, action.message, 'sys');
      return next;
    }
    if (action.type === 'toggleLog') return { ...state, logOpen: !state.logOpen };
    if (action.type === 'select') {
      const card = state.hand.me[action.index];
      if (!card || state.over || state.turn !== 'me' || state.busy) return state;
      return {
        ...state,
        selected: action.index,
        selectedPosition: 'attack',
        selectedTributes: []
      };
    }
    if (action.type === 'uiSetSummonPosition') {
      if (state.selected === null || !['attack', 'defense'].includes(action.position)) {
        return state;
      }
      return { ...state, selectedPosition: action.position };
    }
    if (action.type === 'uiToggleTribute') {
      const { index } = action;
      return {
        ...state,
        selectedTributes: state.selectedTributes.includes(index)
          ? state.selectedTributes.filter((selectedIndex) => selectedIndex !== index)
          : [...state.selectedTributes, index]
      };
    }
    if (action.type === 'uiSetAttacker') {
      return { ...state, attackingIndex: action.index };
    }
    if (action.type === 'uiBeginTarget') {
      return {
        ...state,
        selected: null,
        effectMode: 'targeted-effect',
        pendingEffect: { player: 'me', ...action.pendingEffect },
        selectedTargets: []
      };
    }
    if (action.type === 'uiToggleTarget') {
      const targetId = action.instanceId;
      const maxTargets = state.pendingEffect?.maxTargets;
      return {
        ...state,
        selectedTargets: state.pendingEffect?.singleTarget
          ? state.selectedTargets[0] === targetId ? [] : [targetId]
          : state.selectedTargets.includes(targetId)
            ? state.selectedTargets.filter((selectedId) => selectedId !== targetId)
            : Number.isInteger(maxTargets) && state.selectedTargets.length >= maxTargets
              ? state.selectedTargets
              : [...state.selectedTargets, targetId]
      };
    }
    if (action.type === 'uiCancelTarget') {
      return { ...state, effectMode: null, pendingEffect: null, selectedTargets: [] };
    }
    if (action.type === 'uiClearSelection') {
      return {
        ...state,
        selected: null,
        selectedPosition: 'attack',
        selectedTributes: [],
        attackingIndex: null,
        effectMode: null,
        pendingEffect: null,
        selectedTargets: []
      };
    }
    if (action.type === 'uiDiscardSelection') {
      const id = action.instanceId;
      return {
        ...state,
        pendingDiscardIds: state.pendingDiscardIds.includes(id)
          ? state.pendingDiscardIds.filter((selectedId) => selectedId !== id)
          : [...state.pendingDiscardIds, id]
      };
    }
    return state;
  }

  switch (action.type) {
    case 'cancelEffect': {
      if (!state.pendingEffect || state.effectMode !== 'targeted-effect') return state;
      return withChangedGame(state, (game) => {
        const pending = game.pendingEffect;
        if (pending.source === 'field') {
          game.field[pending.player].st[pending.sourceIndex] = {
            ...pending.card,
            faceDown: true
          };
        } else {
          game.hand[pending.player].push(pending.card);
        }
        game.pendingEffect = null;
        game.effectMode = null;
        game.pendingDiscardCount = 0;
        appendLog(game, `Đã hủy chọn mục tiêu cho <b>${pending.card.name}</b>; lá bài được trả về tay.`, 'sys');
        refreshSlifer(game, pending.player);
      });
    }
    case 'resolveEffectChoice': {
      if (state.effectMode !== 'targeted-effect' || !state.pendingEffect) return state;
      return withChangedGame(state, (game) => {
        completePendingEffect(game, action.target);
      });
    }
    case 'select': {
      if (state.over || state.turn !== 'me' || state.busy) return state;
      if (state.effectMode === 'discard-for-effect' && state.pendingEffect) {
        const discardedCard = state.hand.me[action.index];
        if (!discardedCard) return state;
        return withChangedGame(state, (game) => {
          const [discarded] = game.hand.me.splice(action.index, 1);
          game.grave.me.push(discarded);
          game.pendingDiscardCount -= 1;
          appendLog(game, `Bỏ <b>${discarded.name}</b> bằng hiệu ứng của <b>${game.pendingEffect.card.name}</b>.`, 'me');
          if (game.pendingDiscardCount === 0) {
            game.grave.me.push(game.pendingEffect.card);
            game.pendingEffect = null;
            game.effectMode = null;
            appendLog(game, 'Hiệu ứng được giải quyết hoàn tất.', 'sys');
          }
          refreshSlifer(game, 'me');
        });
      }
      if (state.phaseIndex === 5 && state.hand.me.length > MAX_END_PHASE_HAND_SIZE) {
        return withChangedGame(state, (game) => {
          const [discarded] = game.hand.me.splice(action.index, 1);
          if (discarded) {
            game.grave.me.push(discarded);
            appendLog(game, `Bỏ <b>${discarded.name}</b> để còn tối đa ${MAX_END_PHASE_HAND_SIZE} lá trên tay.`, 'me');
          }
          game.selected = null;
          refreshSlifer(game, 'me');
        });
      }
      const card = state.hand.me[action.index];
      if (!card) return state;
      return withChangedGame(state, (game) => {
        game.selected = action.index;
        game.selectedPosition = 'attack';
        appendLog(game, `Đã chọn <b>${card.name}</b>.`, 'me');
      });
    }
    case 'zone': {
      const { who, kind, index } = action;
      const card = state.field[who][kind][index];
      const isTributeDestination = Boolean(
        card
        && who === 'me'
        && kind === 'mon'
        && state.selected !== null
        && state.selectedTributes.includes(index)
        && isMainPhase(state.phaseIndex)
      );
      if (state.over) return state;
      if (state.effectMode === 'targeted-effect' && state.pendingEffect) {
        return withChangedGame(state, (game) => {
          completePendingEffect(game, { who, kind, index });
        });
      }
      if (state.effectMode === 'ra-destroy' && who === 'opp' && kind === 'mon') {
        if (!card) {
          return withChangedGame(state, (game) => appendLog(game, 'Chọn một quái thú đối thủ làm mục tiêu của Ra.', 'sys'));
        }
        if (state.effectProtection?.opp === state.turnCount) {
          return withChangedGame(state, (game) => appendLog(game, 'Quái thú đối thủ được Khiên Thần Bảo Hộ bảo vệ.', 'sys'));
        }
        if (!canBeTargetedByEffects(card)) {
          return withChangedGame(state, (game) => appendLog(game, 'Obelisk không thể bị chọn làm mục tiêu bởi hiệu ứng bài.', 'sys'));
        }
        if (state.lp.me < 1000) {
          return withChangedGame(state, (game) => appendLog(game, 'Không đủ LP để kích hoạt hiệu ứng của Ra.', 'sys'));
        }
        return withChangedGame(state, (game) => {
          Object.assign(game, applyLifePointChange(game, 'me', 1000));
          if (!game.over) removeFromFieldToGrave(game, 'opp', index);
          game.effectMode = null;
          appendLog(
            game,
            game.over
              ? '<b>Bạn</b> mất Duel vì LP về 0 trước khi hiệu ứng của Ra được giải quyết.'
              : '<b>Thần Rồng Ra</b> trả 1000 LP để phá hủy quái thú mục tiêu.',
            'me'
          );
        });
      }
      if (state.effectMode === 'obelisk' && who === 'me' && kind === 'mon' && card) {
        return withChangedGame(state, (game) => {
          game.selectedTributes = game.selectedTributes.includes(index)
            ? game.selectedTributes.filter((selectedIndex) => selectedIndex !== index)
            : [...game.selectedTributes, index];
          if (game.selectedTributes.length === 2) {
            for (const tributeIndex of game.selectedTributes.slice().sort((left, right) => right - left)) {
              removeFromFieldToGrave(game, 'me', tributeIndex);
            }
            game.field.opp.mon.forEach((opponentCard, opponentIndex) => {
              if (opponentCard && game.effectProtection?.opp !== game.turnCount) {
                removeFromFieldToGrave(game, 'opp', opponentIndex);
              }
            });
            const obeliskIndex = game.field.me.mon.findIndex((monster) => monster?.id === 'm-obelisk-the-tormentor');
            if (obeliskIndex !== -1) {
              game.field.me.mon[obeliskIndex] = {
                ...game.field.me.mon[obeliskIndex],
                cannotAttackTurn: game.turnCount
              };
            }
            game.effectMode = null;
            game.selectedTributes = [];
            appendLog(game, '<b>Thần Obelisk</b> hiến tế 2 quái thú và phá hủy toàn bộ quái thú đối thủ.', 'me');
          } else {
            appendLog(game, `Đã chọn ${game.selectedTributes.length}/2 quái thú làm vật hiến tế cho Obelisk.`, 'me');
          }
        });
      }
      if (card && !isTributeDestination) {
        if (who === 'me' && kind === 'st' && card.faceDown) {
          if (card.type !== 'trap') {
            return withChangedGame(state, (game) => appendLog(game, 'Chỉ có thể kích hoạt Bẫy đang úp.', 'sys'));
          }
          if (!isMainPhase(state.phaseIndex) || card.setTurn >= state.turnCount) {
            return withChangedGame(state, (game) => appendLog(game, 'Bẫy không thể được kích hoạt trong lượt đã Úp.', 'sys'));
          }
          return withChangedGame(state, (game) => {
            const trap = game.field.me.st[index];
            const resolution = resolveTrapActivation(game, 'me', trap);
            if (resolution.requiresTarget) {
              game.field.me.st[index] = { ...trap, faceDown: false };
              game.pendingEffect = {
                card: trap,
                player: 'me',
                source: 'field',
                sourceIndex: index,
                targetMode: resolution.targetMode
              };
              game.effectMode = 'targeted-effect';
              appendLog(game, `Chọn mục tiêu hợp lệ cho <b>${trap.name}</b>.`, 'me');
              return;
            }
            if (!resolution.activated) {
              appendLog(game, `Không thể kích hoạt <b>${trap.name}</b>: ${resolution.reason}`, 'sys');
              return;
            }
            game.field.me.st[index] = { ...trap, faceDown: false };
            if (!resolution.keepOnField) {
              game.field.me.st[index] = null;
              game.grave.me.push(trap);
            }
            appendLog(game, `<b>Bạn</b> kích hoạt <b>${trap.name}</b>.`, 'me');
            resolution.logs.forEach((message) => appendLog(game, message, 'sys'));
          });
        }
        if (who === 'opp' && card.faceDown) {
          return withChangedGame(state, (game) => appendLog(game, 'Lá bài của đối thủ đang úp.', 'sys'));
        }
        if (who === 'me' && kind === 'mon' && card.faceDown) {
          if (!isMainPhase(state.phaseIndex) || card.setTurn >= state.turnCount) {
            return withChangedGame(state, (game) => appendLog(game, 'Quái thú vừa được úp không thể Flip Summon trong lượt này.', 'sys'));
          }
          return withChangedGame(state, (game) => {
            const dragonCaptureJarActive = ['me', 'opp'].some((owner) =>
              game.field[owner].st.some((trap) => trap?.id === 't-dragon-capture-jar' && !trap.faceDown)
            );
            const flipped = {
              ...card,
              faceDown: false,
              position: dragonCaptureJarActive && isDragonCard(card) ? 'defense' : 'attack',
              flipSummonedTurn: game.turnCount
            };
            const opposingSlifer = game.field.opp.mon.some((monster) => monster?.id === 'm-slifer-the-sky-dragon');
            if (opposingSlifer && game.effectProtection?.me !== game.turnCount) {
              const result = applySliferSummonEffect(flipped, flipped.position);
              game.field.me.mon[index] = result.monster;
              appendLog(game, `Sấm Sét Thần của <b>Slifer</b> giảm ${result.stat.toUpperCase()} của <b>${card.name}</b> 2000.`, 'opp');
              if (result.destroyed) {
                removeFromFieldToGrave(game, 'me', index);
                appendLog(game, `<b>${card.name}</b> bị phá hủy bởi hiệu ứng của Slifer.`, 'sys');
              }
            } else {
              game.field.me.mon[index] = flipped;
              appendLog(game, `<b>${card.name}</b> được Flip Summon ở thế Công kích.`, 'me');
            }
            const flippedMonster = game.field.me.mon[index];
            if (flippedMonster) {
              resolveMonsterSummonEffects(game, 'me', flippedMonster, 'flip')
                .forEach((message) => appendLog(game, message, 'sys'));
            }
          });
        }
        if (
          who === 'me'
          && kind === 'mon'
          && state.turn === 'me'
          && !state.busy
          && isMainPhase(state.phaseIndex)
          && state.selected === null
          && card.id === 'm-obelisk-the-tormentor'
        ) {
          return withChangedGame(state, (game) => {
            game.effectMode = 'obelisk';
            game.selectedTributes = [];
            appendLog(game, 'Chọn 2 quái thú trên sân của bạn làm vật hiến tế cho Obelisk.', 'me');
          });
        }
        if (
          who === 'me'
          && kind === 'mon'
          && state.turn === 'me'
          && !state.busy
          && isMainPhase(state.phaseIndex)
          && state.selected === null
          && card.id === 'm-the-winged-dragon-of-ra'
        ) {
          return withChangedGame(state, (game) => {
            game.effectMode = 'ra-destroy';
            appendLog(game, 'Chọn một quái thú trên sân để Ra phá hủy bằng cách trả 1000 LP.', 'me');
          });
        }
        if (
          who === 'me'
          && kind === 'mon'
          && state.turn === 'me'
          && !state.busy
          && isMainPhase(state.phaseIndex)
          && state.selected === null
        ) {
          return withChangedGame(state, (game) => {
            game.selectedTributes = game.selectedTributes.includes(index)
              ? game.selectedTributes.filter((selectedIndex) => selectedIndex !== index)
              : [...game.selectedTributes, index];
            appendLog(game, `Đã ${game.selectedTributes.includes(index) ? 'chọn' : 'bỏ chọn'} <b>${card.name}</b> làm vật hiến tế.`, 'me');
          });
        }
        return withChangedGame(state, (game) => {
          game.field[who][kind][index] = { ...card, faceDown: false };
          const extra = card.atk ? ` — ATK ${card.atk} / DEF ${card.def}` : '';
          appendLog(game, `<b>${card.name}</b>${extra}`, who);
        });
      }
      if (state.turn !== 'me' || state.busy) return state;
      if (!isMainPhase(state.phaseIndex)) {
        return withChangedGame(state, (game) => appendLog(game, 'Chỉ được triệu hồi hoặc đặt bài trong Main Phase.', 'sys'));
      }
      if (who !== 'me') {
        return withChangedGame(state, (game) => appendLog(game, 'Không thể đặt bài sang sân đối thủ.', 'sys'));
      }
      if (state.selected === null) {
        return withChangedGame(state, (game) => appendLog(game, 'Hãy chọn một lá bài trên tay trước.', 'sys'));
      }
      const selectedCard = state.hand.me[state.selected];
      if (kind === 'mon' && selectedCard.id === VALKYRION_ID) {
        return withChangedGame(state, (game) => appendLog(
          game,
          'Chiến Binh Kim Loại chỉ có thể được Triệu hồi Đặc biệt bằng hiệu ứng riêng.',
          'sys'
        ));
      }
      if (kind === 'mon' && selectedCard.category === 'fusion') {
        return withChangedGame(state, (game) => appendLog(game, 'Triệu hồi Fusion hiện chưa được triển khai.', 'sys'));
      }
      if (
        kind === 'mon'
        && state.selectedPosition === 'defense'
        && ['m-slifer-the-sky-dragon', 'm-obelisk-the-tormentor', 'm-the-winged-dragon-of-ra', 'm-the-creator-god-of-light-horakhty'].includes(selectedCard.id)
      ) {
        return withChangedGame(state, (game) => appendLog(game, 'Các lá Thần không thể được Úp Thường.', 'sys'));
      }
      if (kind === 'st' && selectedCard.type === 'monster') {
        return withChangedGame(state, (game) => appendLog(game, 'Ô Phép/Bẫy chỉ đặt được thẻ Phép hoặc Bẫy.', 'sys'));
      }
      if (kind === 'mon' && selectedCard.type !== 'monster') {
        return withChangedGame(state, (game) => appendLog(game, 'Ô Quái thú chỉ đặt được thẻ Quái thú.', 'sys'));
      }
      if (kind === 'mon' && state.field.me.mon.filter(Boolean).length - state.selectedTributes.length >= 5) {
        return withChangedGame(state, (game) => appendLog(game, 'Sân quái thú đã đầy.', 'sys'));
      }
      if (kind === 'mon' && selectedCard.id !== 'm-the-creator-god-of-light-horakhty' && state.normalSummonUsed.me) {
        return withChangedGame(state, (game) => appendLog(game, 'Bạn đã Normal Summon hoặc Tribute Summon trong lượt này.', 'sys'));
      }
      const tributeCards = state.selectedTributes.map((tributeIndex) => state.field.me.mon[tributeIndex]);
      if (kind === 'mon' && selectedCard.id === 'm-the-creator-god-of-light-horakhty') {
        const requiredGods = new Set([
          'm-slifer-the-sky-dragon',
          'm-obelisk-the-tormentor',
          'm-the-winged-dragon-of-ra'
        ]);
        if (
          tributeCards.length !== 3
          || new Set(tributeCards.map((tribute) => tribute?.id)).size !== 3
          || tributeCards.some((tribute) => !requiredGods.has(tribute?.id))
        ) {
          return withChangedGame(state, (game) => appendLog(game, 'Horakhty cần hiến tế đúng Slifer, Obelisk và Ra.', 'sys'));
        }
      } else if (kind === 'mon') {
        const required = getRequiredTributes(selectedCard);
        const validation = validateTributes(tributeCards, required, selectedCard);
        if (!validation.valid) {
          return withChangedGame(state, (game) => appendLog(
            game,
            required
              ? `Cần chọn đúng ${required} vật hiến tế (quái thú Fusion tính là 2).`
              : 'Quái thú này không cần hiến tế; hãy bỏ chọn các quái thú đã chọn.',
            'sys'
          ));
        }
      } else if (state.selectedTributes.length) {
        return withChangedGame(state, (game) => appendLog(game, 'Không cần hiến tế để đặt bài Phép/Bẫy.', 'sys'));
      }
      if (kind === 'mon') {
        const actionType = selectedCard.id === 'm-the-creator-god-of-light-horakhty'
          ? 'specialSummon'
          : state.selectedPosition === 'defense' ? 'setMonster' : 'normalSummon';
        const selectedIndexes = state.selectedTributes.slice().sort((left, right) => left - right);
        const canSummon = getLegalActions(state).some((legalAction) =>
          legalAction.type === actionType
          && legalAction.handIndex === state.selected
          && legalAction.zoneIndex === index
          && legalAction.tributeIndexes.length === selectedIndexes.length
          && legalAction.tributeIndexes.every((tributeIndex, tributeOffset) => tributeIndex === selectedIndexes[tributeOffset])
        );
        if (!canSummon) {
          return withChangedGame(state, (game) => appendLog(game, 'Hành động triệu hồi không hợp lệ theo luật hiện tại.', 'sys'));
        }
      }
      return withChangedGame(state, (game) => {
        const tributes = game.selectedTributes.map((tributeIndex) => game.field.me.mon[tributeIndex]).filter(Boolean);
        for (const tributeIndex of game.selectedTributes.slice().sort((left, right) => right - left)) {
          removeFromFieldToGrave(game, 'me', tributeIndex);
        }
        const played = { ...game.hand.me.splice(state.selected, 1)[0] };
        if (played.type === 'spell') {
          const resolution = resolveNormalSpell(game, 'me', played);
          if (resolution.requiresDiscard) {
            if (game.over) {
              game.grave.me.push(played);
              appendLog(game, `<b>${played.name}</b> được gửi vào Mộ sau khi người chơi thua do hết bài.`, 'sys');
              return;
            }
            game.pendingEffect = { card: played, player: 'me' };
            game.pendingDiscardCount = resolution.requiresDiscard;
            game.effectMode = 'discard-for-effect';
            game.selected = null;
            game.selectedPosition = 'attack';
            game.selectedTributes = [];
            appendLog(game, `Chọn ${resolution.requiresDiscard} lá trên tay để bỏ bằng hiệu ứng của <b>${played.name}</b>.`, 'me');
            return;
          }
          if (resolution.requiresTarget) {
            game.pendingEffect = {
              card: played,
              player: 'me',
              source: 'hand',
              targetMode: resolution.targetMode
            };
            game.effectMode = 'targeted-effect';
            game.selected = null;
            game.selectedPosition = 'attack';
            game.selectedTributes = [];
            appendLog(game, `Chọn mục tiêu hợp lệ cho <b>${played.name}</b>.`, 'me');
            return;
          }
          if (!resolution.activated) {
            game.hand.me.splice(state.selected, 0, played);
            appendLog(game, `Không thể kích hoạt <b>${played.name}</b>: ${resolution.reason}`, 'sys');
            return;
          }
          if (resolution.keepOnField) {
            game.field.me.st[index] = { ...played, faceDown: false, opponentEnds: 0 };
            appendLog(game, `<b>Bạn</b> kích hoạt <b>${played.name}</b>.`, 'me');
            resolution.logs.forEach((message) => appendLog(game, message, 'sys'));
            game.selected = null;
            game.selectedPosition = 'attack';
            game.selectedTributes = [];
            refreshSlifer(game, 'me');
            return;
          }
          game.grave.me.push(played);
          appendLog(game, `<b>Bạn</b> kích hoạt <b>${played.name}</b>.`, 'me');
          resolution.logs.forEach((message) => appendLog(game, message, 'sys'));
          game.selected = null;
          game.selectedPosition = 'attack';
          game.selectedTributes = [];
          refreshSlifer(game, 'me');
          return;
        }
        if (played.id === 'm-the-winged-dragon-of-ra') {
          Object.assign(played, calculateRaTributeStats(tributes));
        }
        if (kind === 'mon') {
          played.faceDown = game.selectedPosition === 'defense';
          played.position = game.selectedPosition;
        }
        played.summonMethod = played.id === 'm-the-creator-god-of-light-horakhty'
          ? 'special'
          : tributes.length ? 'tribute' : 'normal';
        placeCard(game, 'me', kind, index, played);
        if (kind === 'mon') {
          game.normalSummonUsed.me = played.id !== 'm-the-creator-god-of-light-horakhty';
          // m-the-creator-god-of-light-horakhty — valid summon wins the Duel.
          if (played.id === 'm-the-creator-god-of-light-horakhty') {
            game.over = true;
            game.winner = 'me';
            appendLog(game, '<b>Horakhty</b> được Triệu hồi Đặc biệt hợp lệ. Bạn thắng Duel!', 'sys');
          } else if (!played.faceDown) {
            const opposingSliferIndex = game.field.opp.mon.findIndex((opponentCard) => opponentCard?.id === 'm-slifer-the-sky-dragon');
            if (opposingSliferIndex !== -1 && game.effectProtection?.me !== game.turnCount) {
              const summoned = game.field.me.mon[index] || played;
              const result = applySliferSummonEffect(summoned, summoned.position);
              game.field.me.mon[index] = result.monster;
              appendLog(game, `Sấm Sét Thần của <b>Slifer</b> giảm ${result.stat.toUpperCase()} của <b>${played.name}</b> 2000.`, 'opp');
              if (result.destroyed) {
                removeFromFieldToGrave(game, 'me', index);
                appendLog(game, `<b>${played.name}</b> bị phá hủy bởi hiệu ứng của Slifer.`, 'sys');
              }
            }
          }
          const summonedMonster = game.field.me.mon[index];
          if (summonedMonster && !summonedMonster.faceDown) {
            resolveMonsterSummonEffects(game, 'me', summonedMonster, summonedMonster.summonMethod)
              .forEach((message) => appendLog(game, message, 'sys'));
          }
        } else if (played.type === 'trap') {
          game.field.me.st[index] = { ...game.field.me.st[index], faceDown: true, setTurn: game.turnCount };
        }
        game.selected = null;
        game.selectedPosition = 'attack';
        game.selectedTributes = [];
        refreshSlifer(game, 'me');
      });
    }
    case 'raBoost': {
      const card = state.field.me.mon[action.index];
      if (
        state.over
        || state.turn !== 'me'
        || state.busy
        || !isMainPhase(state.phaseIndex)
        || card?.id !== 'm-the-winged-dragon-of-ra'
        || card.summonMethod !== 'tribute'
        || card.summonedTurn !== state.turnCount
        || card.raBoostUsed
        || state.lp.me <= 100
      ) {
        return state;
      }
      return withChangedGame(state, (game) => {
        const ra = game.field.me.mon[action.index];
        const boost = game.lp.me - 100;
        game.lp.me = 100;
        game.field.me.mon[action.index] = {
          ...ra,
          atk: ra.atk + boost,
          def: ra.def + boost,
          raBoostUsed: true
        };
        game.effectMode = null;
        appendLog(game, `<b>Thần Rồng Ra</b> trả ${boost} LP để tăng ATK/DEF tương ứng.`, 'me');
      });
    }
    case 'changePosition': {
      const card = state.field.me.mon[action.index];
      if (
        state.over
        || state.turn !== 'me'
        || state.busy
        || !isMainPhase(state.phaseIndex)
        || !card
        || card.faceDown
        || (card.summonedTurn === state.turnCount && !card.allowPositionChangeOnSummonTurn)
        || card.flipSummonedTurn === state.turnCount
        || card.positionChangedTurn === state.turnCount
      ) {
        return state;
      }
      return withChangedGame(state, (game) => {
        const monster = game.field.me.mon[action.index];
        const position = monster.position === 'defense' ? 'attack' : 'defense';
        game.field.me.mon[action.index] = { ...monster, position, positionChangedTurn: game.turnCount };
        appendLog(game, `<b>${monster.name}</b> chuyển sang thế ${position === 'attack' ? 'Công kích' : 'Phòng thủ'}.`, 'me');
      });
    }
    case 'draw': {
      if (state.turn !== 'me' || state.busy || state.over || state.phaseIndex !== 0 || state.drawnThisTurn) return state;
      if (state.firstTurn) {
        return withChangedGame(state, (game) => appendLog(game, 'Người đi trước không rút bài ở lượt đầu tiên.', 'sys'));
      }
      return withChangedGame(state, (game) => {
        const card = draw(game, 'me');
        if (card) game.hand.me[game.hand.me.length - 1] = { ...card, _motion: `${game.motionId++}-draw` };
        game.drawnThisTurn = true;
        refreshSlifer(game, 'me');
      });
    }
    case 'autoPlace': {
      return withChangedGame(state, (game) => appendLog(game, 'Đặt bài tự động không tuân thủ lựa chọn vật hiến tế và đã bị tắt.', 'sys'));
    }
    case 'endTurn':
    case 'advancePhase':
      if (state.busy || state.over || state.turn !== 'me' || state.pendingEffect) return state;
      return withChangedGame(state, (game) => {
        if (game.phaseIndex === 5) {
          if (game.hand.me.length > MAX_END_PHASE_HAND_SIZE) {
            appendLog(game, `Bỏ bài để kết thúc lượt với tối đa ${MAX_END_PHASE_HAND_SIZE} lá trên tay.`, 'sys');
            return;
          }
          returnTemporaryControl(game, 'me', game.turnCount);
          advanceSwordsOfRevealingLight(game, 'me');
          game.busy = true;
          game.battleProtection = null;
          game.selected = null;
          game.selectedPosition = 'attack';
          game.selectedTributes = [];
          game.effectMode = null;
          game.turn = 'opp';
          game.phaseIndex = 0;
          game.attacked = { me: [], opp: [] };
          appendLog(game, '— Kết thúc lượt của bạn —', 'sys');
          return;
        }
        if (game.phaseIndex === 0 && !game.drawnThisTurn && !game.firstTurn) {
          const card = draw(game, 'me');
          if (card) game.hand.me[game.hand.me.length - 1] = { ...card, _motion: `${game.motionId++}-draw` };
          game.drawnThisTurn = true;
          refreshSlifer(game, 'me');
        }
        game.phaseIndex = game.phaseIndex === 2
          && game.firstTurn
          && game.turn === game.firstPlayer
          ? 4
          : game.phaseIndex + 1;
        game.attackingIndex = null;
        game.effectMode = null;
        if (game.phaseIndex === 1 && !game.over) {
          resolveStandbyEffects(game, 'me').forEach((message) => appendLog(game, message, 'sys'));
        }
      });
    case 'opponentDraw':
      if (state.over) return state;
      return withChangedGame(state, (game) => {
        draw(game, 'opp');
        game.drawnThisTurn = true;
        refreshSlifer(game, 'opp');
        if (!game.over) {
          resolveStandbyEffects(game, 'opp').forEach((message) => appendLog(game, message, 'sys'));
        }
      });
    case 'opponentPlay':
      if (state.over) return state;
      return withChangedGame(state, (game) => {
        const card = game.hand.opp[game.hand.opp.length - 1];
        if (!card) return;
        const kind = card.type === 'monster' ? 'mon' : 'st';
        const free = game.field.opp[kind].map((item, index) => item ? -1 : index).filter((index) => index >= 0);
        if (!free.length) {
          appendLog(game, 'Đối thủ không còn ô trống.', 'opp');
          return;
        }
        const index = free[Math.floor(Math.random() * free.length)];
        game.hand.opp.pop();
        game.field.opp[kind][index] = { ...card, faceDown: true };
        appendLog(game, 'Đối thủ đặt 1 lá bài úp trên sân.', 'opp');
        refreshSlifer(game, 'opp');
      });
    case 'finishTurn':
      return withChangedGame(state, (game) => {
        advanceSwordsOfRevealingLight(game, 'opp');
        game.turnCount += 1;
        game.turn = 'me';
        game.phaseIndex = 0;
        game.busy = false;
        game.firstTurn = false;
        game.drawnThisTurn = false;
        game.normalSummonUsed.me = false;
        game.attacked.me = [];
        game.attackingIndex = null;
        game.selected = null;
        game.selectedPosition = 'attack';
        game.selectedTributes = [];
        game.effectMode = null;
        appendLog(game, '— Đến lượt bạn —', 'me');
      });
    case 'toggleLog':
      return { ...state, logOpen: !state.logOpen };
    default:
      return state;
  }
}

function LogMessage({ message }) {
  return message.split(/(<b>.*?<\/b>)/g).map((part, index) => {
    const bold = part.match(/^<b>(.*?)<\/b>$/);
    return bold ? <strong key={index}>{bold[1]}</strong> : part;
  });
}

function TurnBannerFrame() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    function draw() {
      const rect = canvas.parentElement?.getBoundingClientRect();
      const width = Math.round(rect?.width || 0);
      const height = Math.round(rect?.height || 0);
      if (!width || !height) return;

      const dpr = window.devicePixelRatio || 1;
      const pw = Math.max(1, Math.round(width * dpr));
      const pv = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== pw) canvas.width = pw;
      if (canvas.height !== pv) canvas.height = pv;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const cut = Math.min(11, Math.floor(height * 0.28));
      const pad = 1.5;
      const w = width - pad * 2;
      const h = height - pad * 2;

      const traceFrame = () => {
        ctx.beginPath();
        ctx.moveTo(pad + cut, pad);
        ctx.lineTo(pad + w - cut, pad);
        ctx.lineTo(pad + w, pad + cut);
        ctx.lineTo(pad + w, pad + h - cut);
        ctx.lineTo(pad + w - cut, pad + h);
        ctx.lineTo(pad + cut, pad + h);
        ctx.lineTo(pad, pad + h - cut);
        ctx.lineTo(pad, pad + cut);
        ctx.closePath();
      };

      const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
      bgGrad.addColorStop(0, 'rgba(9, 32, 68, 0.94)');
      bgGrad.addColorStop(0.5, 'rgba(5, 19, 44, 0.92)');
      bgGrad.addColorStop(1, 'rgba(7, 26, 56, 0.95)');
      traceFrame();
      ctx.fillStyle = bgGrad;
      ctx.fill();

      ctx.save();
      ctx.shadowColor = 'rgba(72, 202, 255, 0.55)';
      ctx.shadowBlur = 10;
      ctx.strokeStyle = 'rgba(116, 214, 255, 0.78)';
      ctx.lineWidth = 1.4;
      traceFrame();
      ctx.stroke();
      ctx.restore();

      ctx.strokeStyle = 'rgba(170, 232, 255, 0.24)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad + cut + 8, pad + 3.5);
      ctx.lineTo(pad + w - cut - 8, pad + 3.5);
      ctx.moveTo(pad + cut + 8, pad + h - 3.5);
      ctx.lineTo(pad + w - cut - 8, pad + h - 3.5);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(130, 230, 255, 0.92)';
      ctx.lineWidth = 2;
      const tick = 8;
      ctx.beginPath();
      ctx.moveTo(pad + cut, pad + 1);
      ctx.lineTo(pad + cut + tick, pad + 1);
      ctx.moveTo(pad + w - cut - tick, pad + 1);
      ctx.lineTo(pad + w - cut, pad + 1);
      ctx.moveTo(pad + cut, pad + h - 1);
      ctx.lineTo(pad + cut + tick, pad + h - 1);
      ctx.moveTo(pad + w - cut - tick, pad + h - 1);
      ctx.lineTo(pad + w - cut, pad + h - 1);
      ctx.stroke();
    }

    draw();
    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(draw)
      : null;
    if (observer && canvas.parentElement) {
      observer.observe(canvas.parentElement);
    }
    window.addEventListener('resize', draw);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', draw);
    };
  }, []);

  return <canvas ref={canvasRef} className="turnflag__canvas" aria-hidden="true" />;
}

function CardBack() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    function draw() {
      const size = window.getComputedStyle(canvas);
      const width = parseFloat(size.width);
      const height = parseFloat(size.height);
      if (!width || !height) return;

      const pixelRatio = window.devicePixelRatio || 1;
      const pixelWidth = Math.max(1, Math.round(width * pixelRatio));
      const pixelHeight = Math.max(1, Math.round(height * pixelRatio));
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, pixelWidth, pixelHeight);

      const fillsDefenseCard = canvas.parentElement?.classList.contains('card--back')
        && canvas.parentElement.classList.contains('card--defense');
      const fillsBackrowCard = canvas.parentElement?.classList.contains('card--back')
        && canvas.parentElement.parentElement?.classList.contains('zone--st');
      if (fillsDefenseCard || fillsBackrowCard) {
        context.setTransform(pixelWidth / 265, 0, 0, pixelHeight / 357, 0, 0);
      } else {
        const scale = Math.min(pixelWidth / 265, pixelHeight / 357);
        const offsetX = (pixelWidth - 265 * scale) / 2;
        const offsetY = (pixelHeight - 357 * scale) / 2;
        context.setTransform(scale, 0, 0, scale, offsetX, offsetY);
      }
      context.fillStyle = '#d6ae7a';
      context.fillRect(0, 0, 265, 357);
      context.strokeStyle = '#21120d';
      context.lineWidth = 1.5;
      context.strokeRect(0.75, 0.75, 263.5, 355.5);
      context.fillStyle = '#28150f';
      context.fillRect(9.5, 8.5, 246, 340);
      context.save();
      context.beginPath();
      context.rect(12, 11, 241, 335);
      context.clip();
      context.fillStyle = '#764131';
      context.fillRect(12, 11, 241, 335);
      context.restore();
      context.beginPath();
      context.ellipse(132.5, 178.5, 50, 88, 0, 0, Math.PI * 2);
      context.fillStyle = '#4b4c46';
      context.fill();
      context.beginPath();
      context.ellipse(132.5, 178.5, 50, 88, 0, 0, Math.PI * 2);
      context.strokeStyle = '#100c09';
      context.lineWidth = 2.5;
      context.stroke();
    }

    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, []);
  return <canvas ref={canvasRef} className="card__back-canvas" aria-hidden="true"></canvas>;
}

function BattlefieldMonster({
  card,
  onArtClick,
  onPositionAction,
  canChangePosition,
  canDragAttack,
  actionLabel,
  actionGlyph,
  animation,
  selected
}) {
  const cardRef = useRef(null);
  const [fallbackApplied, setFallbackApplied] = useState(!card.image);
  const [imageFailed, setImageFailed] = useState(false);
  const [imageRetryCount, setImageRetryCount] = useState(0);
  const fallbackImage = getDuelCardArtwork(card).fallback;
  const imagePath = card.image && !fallbackApplied ? card.image : fallbackImage;
  const resolvedImageSource = imagePath?.startsWith('assets/') ? `/${imagePath}` : imagePath;
  const imageSource = card.image && !fallbackApplied
    ? getRetriedDuelCardArtworkSource(resolvedImageSource, imageRetryCount)
    : resolvedImageSource;
  const position = card.position === 'defense' ? 'defense' : 'attack';
  const level = Number.parseInt(String(card.level ?? card.lv ?? ''), 10) || 0;
  const linkRating = card.linkRating ?? card.link_rating ?? card.linkValue ?? card.link_value ?? card.link;
  const attackIncreased = Number.isFinite(Number(card.atk))
    && Number.isFinite(Number(card.baseAtk))
    && Number(card.atk) > Number(card.baseAtk);
  const defenseIncreased = Number.isFinite(Number(card.def))
    && Number.isFinite(Number(card.baseDef))
    && Number(card.def) > Number(card.baseDef);

  useEffect(() => {
    setFallbackApplied(!card.image);
    setImageFailed(false);
    setImageRetryCount(0);
  }, [card.image, fallbackImage]);

  useLayoutEffect(() => {
    if (animation && cardRef.current) {
      playDuelCardMotion(cardRef.current, animation, {
        delay: card?._motionDelay
      });
    }
  }, [animation, card?._motion, card?._motionDelay]);

  const formatStat = (value) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue.toLocaleString('vi-VN') : value ?? '?';
  };

  return (
    <div ref={cardRef} className="duel-field-monster-motion">
      <div className={`duel-field-monster duel-field-monster--${position}${selected ? ' is-selected' : ''}${canDragAttack ? ' is-attack-draggable' : ''}`} data-position={position}>
        <div className="duel-field-monster__frame" aria-hidden="true"></div>
        <button
          type="button"
          className="duel-field-monster__art"
          onClick={onArtClick}
          aria-label={`Xem thông tin lá bài ${card.name}`}
        >
          {imageSource && !imageFailed
            ? <img
              src={imageSource}
              alt=""
              draggable={false}
              onError={() => {
                if (card.image && imageRetryCount === 0) setImageRetryCount(1);
                else if (card.image && !fallbackApplied) setFallbackApplied(true);
                else setImageFailed(true);
              }}
            />
            : <span className="duel-field-monster__art-missing" aria-hidden="true">✦</span>}
        </button>
        <div className="duel-field-monster__rank" aria-label={linkRating != null ? `LINK ${linkRating}` : `${level} sao`}>
          {linkRating != null
            ? <><span>LINK</span><b>{linkRating}</b></>
            : <><span aria-hidden="true">★</span><b>{level}</b></>}
        </div>
        <div className="duel-field-monster__stats" aria-label={`ATK ${formatStat(card.atk)}, DEF ${formatStat(card.def)}`}>
          <span className={`${position === 'attack' ? 'is-active' : 'is-dim'}${attackIncreased ? ' is-boosted' : ''}`}>
            <b>ATK</b><AnimatedStatValue value={card.atk} />
          </span>
          <span className={`${position === 'defense' ? 'is-active' : 'is-dim'}${defenseIncreased ? ' is-boosted' : ''}`}>
            <b>DEF</b><AnimatedStatValue value={card.def} />
          </span>
        </div>
        {canChangePosition && (
          <button
            type="button"
            className="duel-field-monster__position"
            onClick={onPositionAction}
            aria-label={`${actionLabel} ${card.name}`}
            title={actionLabel}
          >
            {actionGlyph}
          </button>
        )}
      </div>
    </div>
  );
}

function DuelCard({
  card,
  size,
  faceDown = false,
  selected = false,
  hidden = false,
  handIndex,
  onClick,
  onDoubleClick,
  onPointerDown,
  effectDragSource = false,
  animation
}) {
  const cardRef = useRef(null);
  const classNames = [
    'card',
    !faceDown && !card?.faceDown ? 'card--shared-face' : '',
    size === 'sm' ? 'card--sm' : '',
    size === 'xs' ? 'card--xs' : '',
    card?.type === 'spell' ? 'card--spell' : '',
    card?.type === 'trap' ? 'card--trap' : '',
    faceDown || card?.faceDown ? 'card--back' : '',
    card?.position === 'defense' ? 'card--defense' : '',
    selected ? 'card--sel' : '',
    effectDragSource ? 'is-effect-source' : ''
  ].filter(Boolean).join(' ');
  const category = card && (card.category || card.type);
  const monsterType = card && (card.monsterType || 'Thường');

  useLayoutEffect(() => {
    if (animation && cardRef.current) {
      playDuelCardMotion(cardRef.current, animation, {
        delay: card?._motionDelay
      });
    }
  }, [animation, card?._motion, card?._motionDelay]);

  if (faceDown || card?.faceDown) {
    return (
      <div
        ref={cardRef}
        className={classNames}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onPointerDown={onPointerDown}
      >
        <CardBack />
        <div className="card__frame"></div>
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      className={classNames}
      data-hand={handIndex}
      data-id={card?.id}
      data-card-category={category}
      data-card-monster-type={monsterType}
      data-attribute={card?.attribute || card?.attr}
      data-level={card?.level ?? card?.lv}
      style={{
        ...(size ? {} : { '--cw': 'clamp(27px,3.8vw,34px)' }),
        ...(hidden ? { opacity: 0, pointerEvents: 'none' } : {})
      }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onPointerDown={onPointerDown}
    >
      <CardFace
        card={card.monsterType ? card : { ...card, monsterType }}
        className="duel-card-face"
        fallbackImage={getDuelCardArtwork(card).fallback}
      />
    </div>
  );
}

function AnimatedStatValue({ value }) {
  const numericTarget = Number(value);
  const targetValue = Number.isFinite(numericTarget) ? numericTarget : 0;
  const [displayValue, setDisplayValue] = useState(targetValue);
  const [counting, setCounting] = useState(false);
  const displayedValueRef = useRef(targetValue);

  useEffect(() => {
    const startValue = displayedValueRef.current;
    if (startValue === targetValue) {
      setCounting(false);
      return undefined;
    }

    const reduceMotion = window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      displayedValueRef.current = targetValue;
      setDisplayValue(targetValue);
      setCounting(false);
      return undefined;
    }

    setCounting(true);
    const startTime = performance.now();
    let frameId = 0;
    const update = (now) => {
      const progress = Math.min(1, (now - startTime) / 650);
      const eased = 1 - ((1 - progress) ** 3);
      const nextValue = Math.round(
        startValue + (targetValue - startValue) * eased
      );
      displayedValueRef.current = nextValue;
      setDisplayValue(nextValue);
      if (progress < 1) {
        frameId = window.requestAnimationFrame(update);
      } else {
        setCounting(false);
      }
    };
    frameId = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(frameId);
  }, [targetValue]);

  return (
    <strong className={counting ? 'is-counting' : ''}>
      {Number.isFinite(numericTarget)
        ? displayValue.toLocaleString('vi-VN')
        : value ?? '?'}
    </strong>
  );
}

function formatLP(value) {
  return value.toLocaleString('vi-VN');
}

function AnimatedLifePoints({ value, side, instant = false }) {
  const targetValue = Number.isFinite(value) ? value : 0;
  const [displayValue, setDisplayValue] = useState(targetValue);
  const [change, setChange] = useState(null);
  const previousValueRef = useRef(targetValue);
  const displayedValueRef = useRef(targetValue);

  useEffect(() => {
    const previousValue = previousValueRef.current;
    previousValueRef.current = targetValue;
    const difference = targetValue - previousValue;
    if (!difference) return undefined;

    if (instant) {
      displayedValueRef.current = targetValue;
      setDisplayValue(targetValue);
      setChange(null);
      return undefined;
    }

    setChange({
      direction: difference < 0 ? 'is-damage' : 'is-heal',
      amount: Math.abs(difference)
    });

    let frameId = 0;
    const timeoutId = window.setTimeout(() => setChange(null), 900);
    const startValue = displayedValueRef.current;
    const startTime = performance.now();
    const reduceMotion = window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduceMotion) {
      displayedValueRef.current = targetValue;
      setDisplayValue(targetValue);
    } else {
      const animate = (now) => {
        const progress = Math.min(1, (now - startTime) / 650);
        const eased = 1 - ((1 - progress) ** 3);
        const nextValue = Math.round(
          startValue + (targetValue - startValue) * eased
        );
        displayedValueRef.current = nextValue;
        setDisplayValue(nextValue);
        if (progress < 1) frameId = window.requestAnimationFrame(animate);
      };
      frameId = window.requestAnimationFrame(animate);
    }

    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [targetValue, instant]);

  return (
    <span
      className={`pinfo__lp ${targetValue === STARTING_LP ? 'is-full' : targetValue < STARTING_LP ? 'is-below' : 'is-over'}${change ? ` ${change.direction}` : ''}`}
      data-js={`lp-${side}`}
      aria-label={`${formatLP(targetValue)} LP`}
    >
      <span aria-hidden="true">{formatLP(displayValue)}</span>
      <span className="pinfo__sr-only" aria-live="polite" aria-atomic="true">
        {formatLP(targetValue)} LP
      </span>
      {change && (
        <span className="pinfo__change" aria-hidden="true">
          {change.direction === 'is-damage' ? '-' : '+'}{formatLP(change.amount)}
        </span>
      )}
    </span>
  );
}

function AnimatedDeckCount({ value, hand, matchId }) {
  const hasValue = Number.isFinite(value);
  const targetValue = hasValue ? value : 0;
  const drawnCards = (Array.isArray(hand) ? hand : []).filter(
    (card) => typeof card?._motion === 'string' && card._motion.endsWith('-draw')
  );
  const drawnSignature = drawnCards.map((card) => card._motion).join('|');
  const [displayValue, setDisplayValue] = useState(() =>
    hasValue ? (drawnCards.length > 0 ? targetValue + drawnCards.length : targetValue) : null
  );
  const scheduledMotionsRef = useRef(new Set());
  const activeTimersRef = useRef(new Set());
  const lastMatchIdRef = useRef(matchId);
  const targetValueRef = useRef(targetValue);
  targetValueRef.current = targetValue;

  const clearActiveTimers = () => {
    activeTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    activeTimersRef.current.clear();
  };

  useEffect(() => () => clearActiveTimers(), []);

  useEffect(() => {
    if (lastMatchIdRef.current !== matchId) {
      lastMatchIdRef.current = matchId;
      scheduledMotionsRef.current = new Set();
      clearActiveTimers();
    }

    if (!hasValue) {
      clearActiveTimers();
      setDisplayValue(null);
      return;
    }

    const activeDrawn = (Array.isArray(hand) ? hand : []).filter(
      (card) => typeof card?._motion === 'string' && card._motion.endsWith('-draw')
    );
    const pendingDrawn = activeDrawn.filter(
      (card) => !scheduledMotionsRef.current.has(card._motion)
    );

    if (!pendingDrawn.length) {
      if (activeTimersRef.current.size === 0) {
        setDisplayValue(targetValue);
      }
      return;
    }

    const sortedDrawn = [...pendingDrawn].sort(
      (a, b) => (Number(a._motionDelay) || 0) - (Number(b._motionDelay) || 0)
    );
    sortedDrawn.forEach((card) => scheduledMotionsRef.current.add(card._motion));
    clearActiveTimers();
    const startCount = targetValue + sortedDrawn.length;
    setDisplayValue(startCount);

    sortedDrawn.forEach((card, index) => {
      const delay = Math.max(0, Number(card._motionDelay) || 0) + 180;
      const timerId = window.setTimeout(() => {
        activeTimersRef.current.delete(timerId);
        const nextCount = startCount - (index + 1);
        setDisplayValue(
          activeTimersRef.current.size === 0
            ? targetValueRef.current
            : Math.max(targetValueRef.current, nextCount)
        );
      }, delay);
      activeTimersRef.current.add(timerId);
    });
  }, [hasValue, targetValue, matchId, drawnSignature]);

  return <b>{displayValue === null ? '' : displayValue}</b>;
}

function getFieldMonsterActionType(card) {
  if (card.id === 'm-the-winged-dragon-of-ra') return 'raBoost';
  if (card.id === 'm-kaibaman') return 'kaibamanEffect';
  if (card.id === 'm-catapult-turtle') return 'catapultTurtleEffect';
  if (card.id === 'm-gandora-the-dragon-of-destruction') return 'gandoraEffect';
  if (card.id === 'm-blizzard-dragon') return 'blizzardDragonEffect';
  if (card.id === 'm-blue-eyes-alternative-white-dragon') return 'blueEyesAlternativeEffect';
  return 'changePosition';
}

function DuelPage() {
  const [game, dispatch] = useReducer(reducer, null);
  const [duelInitError, setDuelInitError] = useState('');
  const [matchId, setMatchId] = useState('');
  const [hoveredZone, setHoveredZone] = useState('');
  const [cocosError, setCocosError] = useState('');
  const [cocosFallback, setCocosFallback] = useState(false);
  const [zoneViewer, setZoneViewer] = useState(null);
  const [previewCard, setPreviewCard] = useState(null);
  const [attackLockChainLayerActive, setAttackLockChainLayerActive] = useState(false);
  const [transientAttackLockChains, setTransientAttackLockChains] = useState([]);
  const [attackDrag, setAttackDrag] = useState(null);
  const [aiAttackArrow, setAiAttackArrow] = useState(null);
  const [aiEquipTargetZoneKey, setAiEquipTargetZoneKey] = useState(null);
  const [trickyPromptSourceId, setTrickyPromptSourceId] = useState(null);
  const [trickyDiscardSelection, setTrickyDiscardSelection] = useState('');
  const [gracefulDiscardSelection, setGracefulDiscardSelection] = useState([]);
  const [blizzardPromptSourceId, setBlizzardPromptSourceId] = useState(null);
  const [blizzardTargetSelection, setBlizzardTargetSelection] = useState('');
  const [lightningStormChoiceSourceId, setLightningStormChoiceSourceId] = useState(null);
  const [spellDropChoice, setSpellDropChoice] = useState(null);
  const [monsterDropChoice, setMonsterDropChoice] = useState(null);
  const [pendingHandPlacementId, setPendingHandPlacementId] = useState(null);
  const [summonDelayedChainIds, setSummonDelayedChainIds] = useState([]);
  const [burstingDestructionIds, setBurstingDestructionIds] = useState([]);
  const [trapFlippingIds, setTrapFlippingIds] = useState([]);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [surrenderConfirmOpen, setSurrenderConfirmOpen] = useState(false);
  const [resultExplosionDone, setResultExplosionDone] = useState(false);
  const resultExplosionStartedRef = useRef(false);
  const exodiaFinalGameRef = useRef(null);
  const bgmStoppedForResultRef = useRef(false);
  const resultSfxPlayedRef = useRef(false);
  const [musicEnabled, setMusicEnabled] = useState(() => {
    try {
      return window.localStorage.getItem('yugioh.music') !== 'off';
    } catch {
      return true;
    }
  });
  const [sfxEnabled, setSfxEnabled] = useState(() => {
    try {
      return window.localStorage.getItem('yugioh.sfx') !== 'off';
    } catch {
      return true;
    }
  });
  const [viewportSize, setViewportSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }));
  const audioRef = useRef(null);
  const cardSetSfxRef = useRef(null);
  const sfxEnabledRef = useRef(sfxEnabled);
  const prevFieldSfxSnapshotRef = useRef(null);
  const prevMatchIdForSfxRef = useRef(null);
  const lastHandledDiceSeqRef = useRef(0);
  const lastHandledSliferSeqRef = useRef(0);
  const prevAttackLockKeysRef = useRef(new Set());
  const canvasRef = useRef(null);
  const boardRef = useRef(null);
  const wrapRef = useRef(null);
  const attackPointerRef = useRef(null);
  const suppressAttackClickRef = useRef(false);
  const actionBusyRef = useRef(false);
  const autoPhaseTransitionRef = useRef('');
  const sendServerActionRef = useRef(null);
  const initializationPromiseRef = useRef(null);
  const handledSummonChainDelayRef = useRef(new Set());
  const attackLockedChains = [];
  if (game?.field) {
    const lockCheckGame = trapFlippingIds.length
      ? {
        ...game,
        field: {
          me: {
            ...game.field.me,
            st: game.field.me.st.map((stCard) =>
              stCard && trapFlippingIds.includes(stCard.instance_id)
                ? { ...stCard, faceDown: true }
                : stCard
            )
          },
          opp: {
            ...game.field.opp,
            st: game.field.opp.st.map((stCard) =>
              stCard && trapFlippingIds.includes(stCard.instance_id)
                ? { ...stCard, faceDown: true }
                : stCard
            )
          }
        }
      }
      : game;
    ['me', 'opp'].forEach((side) => {
      game.field[side].mon.forEach((card, index) => {
        if (
          !isMonsterAttackLockedBySpellTrap(lockCheckGame, side, card)
          || summonDelayedChainIds.includes(card.instance_id)
          || burstingDestructionIds.includes(card.instance_id)
        ) return;
        const instanceId = card.instance_id || card.id;
        if (!instanceId) return;
        attackLockedChains.push({
          instanceId: String(instanceId),
          zoneKey: `${side}-mon-${index}`,
          position: card.position === 'defense' ? 'defense' : 'attack'
        });
      });
    });
  }
  transientAttackLockChains.forEach((chain) => {
    if (!attackLockedChains.some((entry) => entry.instanceId === chain.instanceId)) {
      attackLockedChains.push(chain);
    }
  });
  const attackLockChainSignature = attackLockedChains
    .map(({ instanceId, zoneKey, position }) => `${instanceId}:${zoneKey}:${position}`)
    .join('|');

  useEffect(() => {
    if (attackLockChainSignature) setAttackLockChainLayerActive(true);
  }, [attackLockChainSignature]);

  useEffect(() => {
    if (!game?.field) return undefined;
    const newlySummonedIds = [];
    ['me', 'opp'].forEach((side) => {
      (game.field[side]?.mon || []).forEach((card) => {
        if (!card?.instance_id || !card._motion?.endsWith('-summon')) return;
        const motionKey = `${card.instance_id}:${card._motion}`;
        if (handledSummonChainDelayRef.current.has(motionKey)) return;
        handledSummonChainDelayRef.current.add(motionKey);
        newlySummonedIds.push(card.instance_id);
        window.setTimeout(() => {
          setSummonDelayedChainIds((prev) =>
            prev.filter((id) => id !== card.instance_id)
          );
        }, DUEL_SUMMON_DURATION_MS + 60);
      });
    });
    if (newlySummonedIds.length) {
      setSummonDelayedChainIds((prev) => [
        ...new Set([...prev, ...newlySummonedIds])
      ]);
    }
    return undefined;
  }, [game?.field]);

  useEffect(() => {
    if (!lightningStormChoiceSourceId && !monsterDropChoice && !spellDropChoice) return undefined;
    const dismissOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      setLightningStormChoiceSourceId(null);
      setMonsterDropChoice(null);
      setSpellDropChoice(null);
    };
    window.addEventListener('keydown', dismissOnEscape);
    return () => window.removeEventListener('keydown', dismissOnEscape);
  }, [lightningStormChoiceSourceId, monsterDropChoice, spellDropChoice]);

  useEffect(() => {
    if (
      !game
      || game.turn !== 'me'
      || !isMainPhase(game.phaseIndex)
      || game.over
      || game.chain?.status === 'open'
      || game.pendingDecision
    ) {
      setMonsterDropChoice(null);
      setSpellDropChoice(null);
    }
  }, [game?.turn, game?.phaseIndex, game?.over, game?.chain?.status, game?.pendingDecision]);

  useEffect(() => {
    const updateViewportSize = () => {
      setViewportSize({
        width: window.innerWidth,
        height: window.innerHeight
      });
    };
    window.addEventListener('resize', updateViewportSize);
    return () => window.removeEventListener('resize', updateViewportSize);
  }, []);

  useOnlinePresence();
  useDuelCanvasEngine(canvasRef, game, (message) => {
    setCocosFallback(true);
    setCocosError(message);
  });

  useEffect(() => {
    if (
      game?.effectMode !== 'targeted-effect'
      || !DRAGGABLE_EFFECT_TARGET_MODES.has(game.pendingEffect?.targetMode)
    ) return undefined;

    const handleTargetKeys = (event) => {
      if (event.target instanceof HTMLElement && (
        event.target.isContentEditable
        || event.target.matches('input, textarea, select, button, a')
      )) return;
      if (
        event.key === 'Enter'
        && !game.busy
        && game.selectedTargets.length >= (game.pendingEffect.minTargets ?? 1)
      ) {
        event.preventDefault();
        handleAction({ type: 'resolveSelectedEffect' });
      } else if (
        event.key === 'Escape'
        && !game.busy
        && !game.pendingDecision
      ) {
        event.preventDefault();
        handleAction({ type: 'cancelEffect' });
      }
    };

    window.addEventListener('keydown', handleTargetKeys);
    return () => window.removeEventListener('keydown', handleTargetKeys);
  }, [
    game?.effectMode,
    game?.pendingEffect,
    game?.selectedTargets,
    game?.pendingDecision,
    game?.busy
  ]);

  function openCardPreview(card) {
    const originalAtk = card.baseAtk ?? card.base_atk;
    const originalDef = card.baseDef ?? card.base_def;
    setPreviewCard({
      ...card,
      ...(originalAtk == null ? {} : { atk: originalAtk }),
      ...(originalDef == null ? {} : { def: originalDef })
    });
  }

  function getAttackDropTarget(clientX, clientY, attackerIndex) {
    const legalActions = getLegalActions(game);
    const hovered = document.elementFromPoint(clientX, clientY);
    const opponentProfile = hovered?.closest('[data-js="pinfo-opp"]');
    if (
      opponentProfile
      && !game.field.opp.mon.some(Boolean)
      && legalActions.some((action) =>
        action.type === 'attack'
        && action.attackerIndex === attackerIndex
        && action.direct
      )
    ) {
      return { direct: true };
    }

    const targetZone = hovered?.closest('[data-zone]');
    const targetMatch = targetZone?.dataset.zone.match(/^opp-mon-(\d+)$/);
    if (!targetMatch) return null;
    const defenderIndex = Number(targetMatch[1]);
    const defender = game.field.opp.mon[defenderIndex];
    if (
      !defender
      || !legalActions.some((action) =>
        action.type === 'attack'
        && action.attackerIndex === attackerIndex
        && action.targetIndex === defenderIndex
      )
    ) return null;
    return {
      direct: false,
      defenderIndex,
      zoneKey: targetZone.dataset.zone
    };
  }

  function getEffectDropTarget(clientX, clientY, pendingEffect = game.pendingEffect) {
    const hovered = document.elementFromPoint(clientX, clientY);
    const targetZone = hovered?.closest('[data-zone]');
    const targetMatch = targetZone?.dataset.zone.match(/^(me|opp)-(mon|st)-(\d+)$/);
    if (!targetMatch) return null;
    const [, who, kind, targetIndex] = targetMatch;
    const targetGame = pendingEffect === game.pendingEffect
      ? game
      : { ...game, effectMode: 'targeted-effect', pendingEffect };
    const target = getFieldEffectTarget(targetGame, who, kind, Number(targetIndex));
    return target ? { ...target, who, kind, index: Number(targetIndex) } : null;
  }

  function canDragEquipSpell(card) {
    return Boolean(
      EQUIP_SPELL_CARD_IDS.has(card?.id)
      && game?.authoritative
      && game.turn === 'me'
      && isMainPhase(game.phaseIndex)
      && !game.busy
      && !game.over
      && !game.pendingBattle?.awaitingResolution
      && !game.pendingDecision
      && !game.pendingEffect
      && game.chain?.status === 'closed'
      && game.field.me.st.some((fieldCard) => !fieldCard)
    );
  }

  function canDragTargetSpell(card) {
    if (
      !HAND_TARGET_DRAG_SPELL_IDS.has(card?.id)
      || !game?.authoritative
      || game.turn !== 'me'
      || !isMainPhase(game.phaseIndex)
      || game.busy
      || game.over
      || game.pendingBattle?.awaitingResolution
      || game.pendingDecision
      || game.pendingEffect
      || game.chain?.status !== 'closed'
      || !game.hand.me.some((handCard) => handCard?.instance_id === card.instance_id)
      || !game.field.me.mon.some((monster) => !monster)
    ) return false;

    return card.id === 's-brain-control'
      ? hasFaceUpOpponentMonster(game)
      : game.field.opp.mon.some((monster) => monster?.instance_id);
  }

  function getEquipSpellDropTarget(clientX, clientY, sourceInstanceId) {
    const hovered = document.elementFromPoint(clientX, clientY);
    const targetZone = hovered?.closest('[data-zone]');
    const targetMatch = targetZone?.dataset.zone.match(/^(me|opp)-(mon|st)-(\d+)$/);
    if (!targetMatch) return null;
    const [, who, kind, targetIndex] = targetMatch;
    const sourceCard = game.hand.me.find(
      (card) => card?.instance_id === sourceInstanceId
    );
    const target = getEquipSpellTarget(
      game,
      sourceCard,
      who,
      kind,
      Number(targetIndex)
    );
    return target ? { ...target, who, kind, index: Number(targetIndex) } : null;
  }

  function startEquipSpellPointer(event, card, source) {
    if (
      event.button !== 0
      || !source
      || !canDragEquipSpell(card)
      || event.target.closest(
        '.duel-field-monster__inspect, .duel-field-monster__position'
      )
    ) return false;

    attackPointerRef.current = {
      kind: 'equip-spell',
      pointerId: event.pointerId,
      sourceInstanceId: card.instance_id,
      sourceRect: source.getBoundingClientRect(),
      startX: event.clientX,
      startY: event.clientY,
      active: false
    };
    return true;
  }

  function canDragSpellTrapCard(card) {
    return Boolean(
      card
      && ['spell', 'trap'].includes(card.type)
      && !EQUIP_SPELL_CARD_IDS.has(card.id)
      && !HAND_TARGET_DRAG_SPELL_IDS.has(card.id)
      && game?.authoritative
      && game.turn === 'me'
      && isMainPhase(game.phaseIndex)
      && !game.busy
      && !game.over
      && !game.pendingBattle?.awaitingResolution
      && !game.pendingDecision
      && !game.pendingEffect
      && game.chain?.status === 'closed'
      && game.hand.me.some((handCard) => handCard?.instance_id === card.instance_id)
      && (
        card.id === 's-the-seal-of-orichalcos'
          ? !orichalcosActive && !game.field?.me?.fieldZone?.[0]
          : game.field.me.st.some((fieldCard) => !fieldCard)
      )
    );
  }

  function getSpellTrapZoneDropTarget(clientX, clientY, card = null) {
    const hovered = document.elementFromPoint(clientX, clientY);
    if (card?.id === 's-the-seal-of-orichalcos') {
      const fieldZoneEl = hovered?.closest('[data-field-zone="me"]');
      if (!fieldZoneEl || orichalcosActive || game?.field?.me?.fieldZone?.[0]) {
        return null;
      }
      return {
        who: 'me',
        kind: 'field',
        index: 0,
        zoneKey: 'me-field-0'
      };
    }
    const targetZone = hovered?.closest('[data-zone]');
    const targetMatch = targetZone?.dataset.zone.match(/^me-st-(\d+)$/);
    if (!targetMatch) return null;
    const index = Number(targetMatch[1]);
    if (game?.field?.me?.st?.[index]) return null;
    return {
      who: 'me',
      kind: 'st',
      index,
      zoneKey: `me-st-${index}`
    };
  }

  function canDragMonsterCard(card) {
    if (
      !card
      || card.type !== 'monster'
      || NON_NORMAL_SUMMON_MONSTER_IDS.has(card.id)
      || !game?.authoritative
      || game.turn !== 'me'
      || !isMainPhase(game.phaseIndex)
      || game.busy
      || game.over
      || game.pendingBattle?.awaitingResolution
      || game.pendingDecision
      || game.pendingEffect
      || game.chain?.status !== 'closed'
      || (game.normalSummonUsed?.me && card.id !== HORAKHTY_ID)
      || !game.hand.me.some((handCard) => handCard?.instance_id === card.instance_id)
    ) return false;

    const required = getRequiredTributes(card);
    const monsters = game.field?.me?.mon || [];
    if (required === 0) return monsters.some((fieldCard) => !fieldCard);
    return monsters.filter(Boolean).length >= required;
  }

  function isValidMonsterDropIndex(index, card) {
    const monsters = game?.field?.me?.mon || [];
    if (index < 0 || index >= monsters.length) return false;
    const required = getRequiredTributes(card);
    if (required === 0) return !monsters[index];

    const occupiedIndexes = monsters
      .map((fieldCard, slotIndex) => (fieldCard ? slotIndex : -1))
      .filter((slotIndex) => slotIndex >= 0);
    if (occupiedIndexes.length < required) return false;

    const selectedTributes = (game?.selectedTributes || []).filter((slotIndex) =>
      Boolean(monsters[slotIndex])
    );
    if (selectedTributes.length === required) {
      return !monsters[index] || selectedTributes.includes(index);
    }
    if (occupiedIndexes.length === monsters.length && required < monsters.length) {
      return Boolean(monsters[index]);
    }
    return !monsters[index] || Boolean(monsters[index]);
  }

  function getMonsterZoneDropTarget(clientX, clientY, card = null) {
    const hovered = document.elementFromPoint(clientX, clientY);
    const targetZone = hovered?.closest('[data-zone]');
    const targetMatch = targetZone?.dataset.zone.match(/^me-mon-(\d+)$/);
    if (!targetMatch) return null;
    const index = Number(targetMatch[1]);
    if (!isValidMonsterDropIndex(index, card)) return null;
    return {
      who: 'me',
      kind: 'mon',
      index,
      zoneKey: `me-mon-${index}`
    };
  }

  function startMonsterDragPointer(event, card, source) {
    if (
      event.button !== 0
      || !source
      || !canDragMonsterCard(card)
      || event.target.closest('.duel-field-monster__inspect, .duel-field-monster__position')
    ) return false;

    setSpellDropChoice(null);
    setMonsterDropChoice(null);
    attackPointerRef.current = {
      kind: 'monster-place',
      pointerId: event.pointerId,
      sourceInstanceId: card.instance_id,
      card,
      sourceRect: source.getBoundingClientRect(),
      startX: event.clientX,
      startY: event.clientY,
      active: false
    };
    return true;
  }

  function startSpellTrapDragPointer(event, card, source) {
    if (
      event.button !== 0
      || !source
      || !canDragSpellTrapCard(card)
      || event.target.closest('.duel-field-monster__inspect, .duel-field-monster__position')
    ) return false;

    setSpellDropChoice(null);
    setMonsterDropChoice(null);
    attackPointerRef.current = {
      kind: 'spell-trap-place',
      pointerId: event.pointerId,
      sourceInstanceId: card.instance_id,
      card,
      sourceRect: source.getBoundingClientRect(),
      startX: event.clientX,
      startY: event.clientY,
      active: false
    };
    return true;
  }

  function startEffectTargetPointer(event, card, source) {
    const pendingEffectSource = Boolean(
      game?.effectMode === 'targeted-effect'
      && DRAGGABLE_EFFECT_TARGET_MODES.has(game.pendingEffect?.targetMode)
      && game.pendingEffect.sourceInstanceId
      && card?.instance_id === game.pendingEffect.sourceInstanceId
    );
    const directTargetSpell = canDragTargetSpell(card);
    if (
      event.button !== 0
      || !source
      || (!pendingEffectSource && !directTargetSpell)
      || event.target.closest('.duel-field-monster__inspect, .duel-field-monster__position')
    ) return false;

    attackPointerRef.current = {
      kind: directTargetSpell ? 'targeted-spell' : 'effect-target',
      pointerId: event.pointerId,
      sourceInstanceId: card.instance_id,
      pendingEffect: directTargetSpell
        ? getEffectTargetFallback(card.instance_id)
        : game.pendingEffect,
      sourceRect: source.getBoundingClientRect(),
      startX: event.clientX,
      startY: event.clientY,
      active: false
    };
    return true;
  }

  function canMonsterChangeBattlePosition(card) {
    if (
      !card
      || card.faceDown
      || !game?.authoritative
      || game.turn !== 'me'
      || !isMainPhase(game.phaseIndex)
      || game.busy
      || game.over
      || game.pendingBattle?.awaitingResolution
      || game.pendingEffect
      || game.pendingDecision
      || Boolean(monsterDropChoice)
      || Boolean(spellDropChoice)
      || game.chain?.status !== 'closed'
      || (card.summonedTurn === game.turnCount && !card.allowPositionChangeOnSummonTurn)
      || card.flipSummonedTurn === game.turnCount
      || card.positionChangedTurn === game.turnCount
      || game.attacked?.me?.includes(card.instance_id)
    ) return false;
    return true;
  }

  function isPositionChangeDragLocked(pointer, clientY) {
    if (pointer.currentPosition === 'defense') {
      const maxUpY = Math.min(
        pointer.startY - 28,
        (pointer.sourceRect?.top ?? pointer.startY) + 10
      );
      return clientY <= maxUpY;
    }
    const minDownY = Math.max(
      pointer.startY + 28,
      (pointer.sourceRect?.bottom ?? pointer.startY) - 10
    );
    return clientY >= minDownY;
  }

  function handleAttackPointerDown(event, who, kind, index, card) {
    if (event.button !== 0) return;
    const sourceElement = event.currentTarget.querySelector('.duel-field-monster, .card');
    if (startEffectTargetPointer(event, card, sourceElement)) return;

    if (
      who === 'me'
      && kind === 'mon'
      && !card?.faceDown
      && canMonsterChangeBattlePosition(card)
      && !event.target.closest(
        '.duel-field-monster__inspect, .duel-field-monster__position'
      )
    ) {
      const source = event.currentTarget.querySelector('.duel-field-monster');
      if (!source) return;
      attackPointerRef.current = {
        kind: 'position-change',
        pointerId: event.pointerId,
        zoneIndex: index,
        sourceInstanceId: card.instance_id,
        currentPosition: card.position || 'attack',
        sourceRect: source.getBoundingClientRect(),
        startX: event.clientX,
        startY: event.clientY,
        active: false
      };
      return;
    }

    if (
      who !== 'me'
      || kind !== 'mon'
      || !card
      || game?.turn !== 'me'
      || game.phaseIndex !== 3
      || game.busy
      || game.over
      || game.pendingBattle?.awaitingResolution
      || game.pendingEffect
      || game.chain?.status !== 'closed'
      || game.attacked.me.includes(card.instance_id)
      || !getLegalActions(game).some((action) =>
        action.type === 'attack' && action.attackerIndex === index
      )
      || event.target.closest(
        '.duel-field-monster__inspect, .duel-field-monster__position'
      )
    ) return;

    const source = event.currentTarget.querySelector('.duel-field-monster');
    if (!source) return;
    attackPointerRef.current = {
      pointerId: event.pointerId,
      attackerIndex: index,
      attackerInstanceId: card.instance_id,
      sourceRect: source.getBoundingClientRect(),
      startX: event.clientX,
      startY: event.clientY,
      active: false
    };
  }

  function handleAttackPointerMove(event) {
    const pointer = attackPointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - pointer.startX;
    const deltaY = event.clientY - pointer.startY;
    if (!pointer.active && Math.hypot(deltaX, deltaY) < 8) return;

    if (!pointer.active) {
      pointer.active = true;
      suppressAttackClickRef.current = true;
      try {
        wrapRef.current?.setPointerCapture(event.pointerId);
      } catch (error) {
        console.warn('Không thể giữ con trỏ trong lúc kéo chọn mục tiêu:', error);
      }
    }

    if (pointer.kind === 'spell-trap-place' || pointer.kind === 'monster-place') {
      const target = pointer.kind === 'monster-place'
        ? getMonsterZoneDropTarget(
          event.clientX,
          event.clientY,
          pointer.card
        )
        : getSpellTrapZoneDropTarget(
          event.clientX,
          event.clientY,
          pointer.card
        );
      setAttackDrag({
        ...pointer,
        clientX: event.clientX,
        clientY: event.clientY,
        targetZoneKey: target?.zoneKey || null,
        directTarget: false
      });
      event.preventDefault();
      return;
    }

    if (['effect-target', 'targeted-spell', 'equip-spell'].includes(pointer.kind)) {
      const target = pointer.kind === 'equip-spell'
        ? getEquipSpellDropTarget(
          event.clientX,
          event.clientY,
          pointer.sourceInstanceId
        )
        : getEffectDropTarget(
          event.clientX,
          event.clientY,
          pointer.pendingEffect
        );
      setAttackDrag({
        ...pointer,
        clientX: event.clientX,
        clientY: event.clientY,
        targetZoneKey: target?.zoneKey || null,
        directTarget: false
      });
      event.preventDefault();
      return;
    }

    if (pointer.kind === 'position-change') {
      const source = boardRef.current?.querySelector(
        `[data-zone="me-mon-${pointer.zoneIndex}"] .duel-field-monster`
      );
      if (source) pointer.sourceRect = source.getBoundingClientRect();
      const positionSwitchLocked = isPositionChangeDragLocked(pointer, event.clientY);
      setAttackDrag({
        ...pointer,
        clientX: event.clientX,
        clientY: event.clientY,
        targetZoneKey: null,
        directTarget: false,
        positionSwitchLocked
      });
      event.preventDefault();
      return;
    }

    const source = boardRef.current?.querySelector(
      `[data-zone="me-mon-${pointer.attackerIndex}"] .duel-field-monster`
    );
    if (source) pointer.sourceRect = source.getBoundingClientRect();
    const target = getAttackDropTarget(
      event.clientX,
      event.clientY,
      pointer.attackerIndex
    );
    const nextDrag = {
      ...pointer,
      clientX: event.clientX,
      clientY: event.clientY,
      targetZoneKey: target?.zoneKey || null,
      directTarget: Boolean(target?.direct),
      defenderIndex: target?.defenderIndex
    };
    setAttackDrag(nextDrag);
    event.preventDefault();
  }

  function clearAttackPointer(pointerId) {
    attackPointerRef.current = null;
    suppressAttackClickRef.current = false;
    setAttackDrag(null);
    if (pointerId != null && wrapRef.current?.hasPointerCapture(pointerId)) {
      wrapRef.current.releasePointerCapture(pointerId);
    }
  }

  function handleAttackPointerUp(event) {
    const pointer = attackPointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    const activeDrag = pointer.active;
    if (pointer.kind === 'monster-place') {
      const target = activeDrag
        ? getMonsterZoneDropTarget(
          event.clientX,
          event.clientY,
          pointer.card
        )
        : null;
      clearAttackPointer(event.pointerId);
      if (!activeDrag) return;

      suppressAttackClickRef.current = true;
      window.setTimeout(() => {
        suppressAttackClickRef.current = false;
      }, 0);
      if (!target) return;

      const monsters = game?.field?.me?.mon || [];
      const required = getRequiredTributes(pointer.card);
      const occupiedIndexes = monsters
        .map((fieldCard, slotIndex) => (fieldCard ? slotIndex : -1))
        .filter((slotIndex) => slotIndex >= 0);
      let tributeIndexes = [];
      if (required > 0) {
        const preselected = (game?.selectedTributes || []).filter((slotIndex) =>
          Boolean(monsters[slotIndex])
        );
        if (preselected.length === required) {
          tributeIndexes = preselected;
        } else if (occupiedIndexes.length === required) {
          tributeIndexes = occupiedIndexes;
        } else {
          tributeIndexes = preselected.slice(0, required);
          if (
            monsters[target.index]
            && !tributeIndexes.includes(target.index)
            && tributeIndexes.length < required
          ) {
            tributeIndexes.push(target.index);
          }
        }
      }

      dispatch({ type: 'uiClearSelection' });
      setMonsterDropChoice({
        instanceId: pointer.sourceInstanceId,
        card: pointer.card,
        zoneIndex: target.index,
        tributeIndexes
      });
      return;
    }

    if (pointer.kind === 'spell-trap-place') {
      const target = activeDrag
        ? getSpellTrapZoneDropTarget(
          event.clientX,
          event.clientY,
          pointer.card
        )
        : null;
      clearAttackPointer(event.pointerId);
      if (!activeDrag) return;

      suppressAttackClickRef.current = true;
      window.setTimeout(() => {
        suppressAttackClickRef.current = false;
      }, 0);
      if (!target) return;

      dispatch({ type: 'uiClearSelection' });
      if (pointer.card?.type === 'trap') {
        setPendingHandPlacementId(pointer.sourceInstanceId);
        sendServerAction({
          type: 'set_card',
          instance_id: pointer.sourceInstanceId,
          zone_index: target.index
        });
        return;
      }
      if (pointer.card?.type === 'spell') {
        const immediateDropSpells = new Set([
          's-graceful-dice',
          's-dicephoon',
          's-dice-of-destiny'
        ]);
        if (
          pointer.card.spellType === 'Tức Thời'
          && !immediateDropSpells.has(pointer.card.id)
        ) {
          setSpellDropChoice({
            instanceId: pointer.sourceInstanceId,
            card: pointer.card,
            zoneIndex: target.index
          });
        } else {
          activateSpellFromHand(pointer.card, target.index);
        }
      }
      return;
    }

    if (pointer.kind === 'equip-spell') {
      const target = activeDrag
        ? getEquipSpellDropTarget(
          event.clientX,
          event.clientY,
          pointer.sourceInstanceId
        )
        : null;
      clearAttackPointer(event.pointerId);
      if (!activeDrag) return;

      suppressAttackClickRef.current = true;
      window.setTimeout(() => {
        suppressAttackClickRef.current = false;
      }, 0);
      if (!target) return;

      sendServerAction({
        type: 'activate_effect',
        source_instance_id: pointer.sourceInstanceId,
        effect_id: 'activate',
        target_instance_ids: [target.instanceId]
      });
      return;
    }

    if (['effect-target', 'targeted-spell'].includes(pointer.kind)) {
      const target = activeDrag
        ? getEffectDropTarget(
          event.clientX,
          event.clientY,
          pointer.pendingEffect
        )
        : null;
      clearAttackPointer(event.pointerId);
      if (!activeDrag) return;

      suppressAttackClickRef.current = true;
      window.setTimeout(() => {
        suppressAttackClickRef.current = false;
      }, 0);
      if (!target) return;

      if (pointer.kind === 'targeted-spell') {
        sendServerAction({
          type: 'activate_effect',
          source_instance_id: pointer.sourceInstanceId,
          effect_id: 'activate',
          target_instance_ids: [target.instanceId]
        }, pointer.pendingEffect);
        return;
      }

      const alreadySelected = game.selectedTargets.includes(target.instanceId);
      const nextTargetIds = alreadySelected
        ? game.selectedTargets.filter((targetId) => targetId !== target.instanceId)
        : game.pendingEffect.singleTarget
          ? [target.instanceId]
          : [...game.selectedTargets, target.instanceId];
      dispatch({ type: 'uiToggleTarget', instanceId: target.instanceId });

      const maxTargets = game.pendingEffect.maxTargets;
      const minTargets = game.pendingEffect.minTargets ?? 1;
      if (
        !alreadySelected
        && nextTargetIds.length >= minTargets
        && (
          game.pendingEffect.singleTarget
          || maxTargets === 1
          || Number.isInteger(maxTargets) && nextTargetIds.length >= maxTargets
        )
      ) {
        handleAction({
          type: 'resolveSelectedEffect',
          targetInstanceIds: nextTargetIds
        });
      }
      return;
    }

    if (pointer.kind === 'position-change') {
      const draggedInTargetDirection = activeDrag
        && isPositionChangeDragLocked(pointer, event.clientY);
      clearAttackPointer(event.pointerId);
      if (!activeDrag) return;

      suppressAttackClickRef.current = true;
      window.setTimeout(() => {
        suppressAttackClickRef.current = false;
      }, 0);
      if (!draggedInTargetDirection) return;

      sendServerAction({
        type: 'change_position',
        instance_id: pointer.sourceInstanceId
      });
      return;
    }

    const target = activeDrag
      ? getAttackDropTarget(
        event.clientX,
        event.clientY,
        pointer.attackerIndex
      )
      : null;
    clearAttackPointer(event.pointerId);
    if (!activeDrag) return;

    suppressAttackClickRef.current = true;
    window.setTimeout(() => {
      suppressAttackClickRef.current = false;
    }, 0);
    if (!target) return;

    const defenderId = target.direct
      ? null
      : game.field.opp.mon[target.defenderIndex]?.instance_id;
    sendServerAction({
      type: 'attack',
      attacker_instance_id: pointer.attackerInstanceId,
      defender_instance_id: defenderId
    });
  }

  function handleAttackClickCapture(event) {
    if (!suppressAttackClickRef.current) return;
    suppressAttackClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  function handleBlankClick(event) {
    if (!(event.target instanceof Element)) return;
    if (
      event.target.closest(
        'button, a, input, select, textarea, [role="button"], [role="dialog"], [data-zone], [data-hand], .card'
      )
    ) {
      return;
    }
    if (spellDropChoice) setSpellDropChoice(null);
    if (monsterDropChoice) setMonsterDropChoice(null);
    if (game?.selected != null) dispatch({ type: 'uiDeselectCard' });
  }

  async function showAttackDeclarationArrow({
    attackerSide = 'opp',
    attackerInstanceId,
    defenderInstanceId = null,
    sourceGame = game,
    durationMs = 380
  }) {
    if (!sourceGame?.field || !attackerInstanceId) return;
    const defenderSide = attackerSide === 'me' ? 'opp' : 'me';
    const attackerIndex = sourceGame.field[attackerSide].mon.findIndex(
      (card) => card?.instance_id === attackerInstanceId
    );
    if (attackerIndex < 0) return;

    const attackerZone = boardRef.current?.querySelector(
      `[data-zone="${attackerSide}-mon-${attackerIndex}"]`
    );
    const defenderIndex = defenderInstanceId
      ? sourceGame.field[defenderSide].mon.findIndex(
        (card) => card?.instance_id === defenderInstanceId
      )
      : -1;
    const targetZone = defenderIndex >= 0
      ? boardRef.current?.querySelector(
        `[data-zone="${defenderSide}-mon-${defenderIndex}"]`
      )
      : null;
    const targetProfile = defenderInstanceId
      ? null
      : wrapRef.current?.querySelector(`[data-js="pinfo-${defenderSide}"]`);

    const reduceMotion = window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const attackerVisual = attackerZone?.querySelector('.duel-field-monster');
    const targetVisual = targetProfile || targetZone?.querySelector(
      '.duel-field-monster, .card'
    );
    if (reduceMotion || !attackerVisual || !targetVisual) return;

    const sourceRect = attackerVisual.getBoundingClientRect();
    const targetRect = targetVisual.getBoundingClientRect();
    const end = {
      x: targetRect.left + targetRect.width / 2,
      y: targetRect.top + targetRect.height / 2
    };
    setAiAttackArrow({
      start: getAttackArrowStart(sourceRect, end.x, end.y),
      end,
      directTarget: Boolean(targetProfile),
      directTargetSide: targetProfile ? defenderSide : null,
      targetZoneKey: targetZone?.dataset.zone || null
    });
    await new Promise((resolve) => window.setTimeout(resolve, durationMs));
  }

  async function playTransientNegateAttackChain({
    previousGame,
    nextGame,
    attackerSide,
    attackerInstanceId
  }) {
    if (!previousGame?.field || !nextGame?.grave || !attackerInstanceId) return;
    if (attackerSide === 'me' && nextGame.phaseIndex === 3) return;
    const COUNTER_NEGATE_TRAP_IDS = new Set([
      't-dark-bribe',
      't-seven-tools-of-the-bandit',
      't-trap-jammer'
    ]);
    const counterTrapNegated = (previousGame.field[attackerSide]?.st || []).some(
      (previousTrap) =>
        previousTrap?.instance_id
        && previousTrap.faceDown
        && (nextGame.grave[attackerSide] || []).some(
          (graveCard) =>
            graveCard?.instance_id === previousTrap.instance_id
            && COUNTER_NEGATE_TRAP_IDS.has(graveCard.id)
        )
    );
    if (counterTrapNegated) return;
    const defenderSide = attackerSide === 'me' ? 'opp' : 'me';
    const negateAttackActivated = (previousGame.field[defenderSide]?.st || []).some(
      (previousTrap) =>
        previousTrap?.instance_id
        && previousTrap.faceDown
        && (nextGame.grave[defenderSide] || []).some(
          (graveCard) =>
            graveCard?.instance_id === previousTrap.instance_id
            && graveCard.id === 't-negate-attack'
        )
    );
    if (!negateAttackActivated) return;

    const attackerIndex = previousGame.field[attackerSide].mon.findIndex(
      (card) => card?.instance_id === attackerInstanceId
    );
    if (attackerIndex < 0) return;
    const attackerCard = previousGame.field[attackerSide].mon[attackerIndex];
    const chainEntry = {
      instanceId: String(attackerInstanceId),
      zoneKey: `${attackerSide}-mon-${attackerIndex}`,
      position: attackerCard?.position === 'defense' ? 'defense' : 'attack'
    };
    setTransientAttackLockChains([chainEntry]);
    setAttackLockChainLayerActive(true);
    await new Promise((resolve) => window.setTimeout(resolve, 420));
    return true;
  }

  async function playBattleMotionForAction(
    action,
    previousGame,
    updatedGame,
    attackerSide = 'me',
    animatePendingBattle = false,
    skipArrow = false
  ) {
    const magicCylinderRedirect = getMagicCylinderRedirect(
      previousGame,
      updatedGame,
      action
    );
    if (
      !['attack', 'resolve_battle'].includes(action.type)
      && !magicCylinderRedirect
    ) return;
    if (
      updatedGame.chain?.status === 'open'
      || (
        action.type === 'attack'
        && updatedGame.pendingBattle?.awaitingResolution
        && !animatePendingBattle
        && !magicCylinderRedirect
      )
    ) return;
    attackerSide = magicCylinderRedirect?.attackerSide || attackerSide;
    const lacoodaNegation = !magicCylinderRedirect
      ? getLacoodaBattleNegation(previousGame, updatedGame, attackerSide)
      : null;
    if (lacoodaNegation) {
      const lacoodaZone = boardRef.current?.querySelector(
        `[data-zone="${lacoodaNegation.side}-mon-${lacoodaNegation.zoneIndex}"]`
      );
      if (lacoodaNegation.card?.faceDown === false) {
        const revealedMon = (previousGame.field?.[lacoodaNegation.side]?.mon || []).map(
          (card, idx) => (
            idx === lacoodaNegation.zoneIndex && card
              ? { ...card, ...lacoodaNegation.card, faceDown: false }
              : card
          )
        );
        dispatch({
          type: 'serverSync',
          game: {
            ...previousGame,
            busy: true,
            field: {
              ...previousGame.field,
              [lacoodaNegation.side]: {
                ...previousGame.field[lacoodaNegation.side],
                mon: revealedMon
              }
            }
          }
        });
        await new Promise((resolve) => {
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(resolve);
          });
        });
      }
      await playDuelEffectActivationGlow(lacoodaZone, 750);
      return;
    }
    const defenderSide = attackerSide === 'me' ? 'opp' : 'me';
    const attackerInstanceId = magicCylinderRedirect?.attackerInstanceId
      || (action.type === 'attack'
        ? action.attacker_instance_id
        : previousGame.pendingBattle?.attackerInstanceId);
    const defenderInstanceId = action.type === 'attack'
      ? action.defender_instance_id
      : previousGame.pendingBattle?.defenderInstanceId;
    const attackerIndex = previousGame.field[attackerSide].mon.findIndex(
      (card) => card?.instance_id === attackerInstanceId
    );
    if (attackerIndex < 0) return;
    const previousAttacker = previousGame.field[attackerSide].mon[attackerIndex];
    const updatedAttacker = updatedGame.field[attackerSide].mon.find(
      (card) => card?.instance_id === attackerInstanceId
    );
    const COUNTER_NEGATE_TRAP_IDS = new Set([
      't-dark-bribe',
      't-seven-tools-of-the-bandit',
      't-trap-jammer',
      't-solemn-judgment'
    ]);
    const counterTrapNegated = (previousGame.field[attackerSide]?.st || []).some(
      (previousTrap) =>
        previousTrap?.instance_id
        && previousTrap.faceDown
        && (
          (updatedGame.grave[attackerSide] || []).some(
            (graveCard) =>
              graveCard?.instance_id === previousTrap.instance_id
              && COUNTER_NEGATE_TRAP_IDS.has(graveCard.id)
          )
          || (updatedGame.field[attackerSide]?.st || []).some(
            (currentTrap) =>
              currentTrap?.instance_id === previousTrap.instance_id
              && !currentTrap.faceDown
              && COUNTER_NEGATE_TRAP_IDS.has(currentTrap.id)
          )
        )
    );
    const STAT_OR_BATTLE_MODIFIER_TRAP_IDS = new Set(['t-skull-dice']);
    const resolveDefenderTrapCardId = (previousTrap) => {
      const fromField = (updatedGame.field[defenderSide]?.st || []).find(
        (card) => card?.instance_id === previousTrap.instance_id
      );
      const fromGrave = (updatedGame.grave[defenderSide] || []).find(
        (card) => card?.instance_id === previousTrap.instance_id
      );
      const fromBanished = (updatedGame.banished[defenderSide] || []).find(
        (card) => card?.instance_id === previousTrap.instance_id
      );
      return (fromField || fromGrave || fromBanished || previousTrap)?.id || '';
    };
    const defenderTrapActivated = !counterTrapNegated && (previousGame.field[defenderSide]?.st || []).some(
      (previousTrap) => {
        if (!previousTrap?.instance_id || !previousTrap.faceDown) return false;
        const resolvedCardId = resolveDefenderTrapCardId(previousTrap);
        if (STAT_OR_BATTLE_MODIFIER_TRAP_IDS.has(resolvedCardId)) return false;
        const flippedOnField = (updatedGame.field[defenderSide]?.st || []).some(
          (currentTrap) =>
            currentTrap?.instance_id === previousTrap.instance_id && !currentTrap.faceDown
        );
        const resolvedToGraveOrBanished = (updatedGame.grave[defenderSide] || []).some(
          (graveCard) => graveCard?.instance_id === previousTrap.instance_id
        ) || (updatedGame.banished[defenderSide] || []).some(
          (banishedCard) => banishedCard?.instance_id === previousTrap.instance_id
        );
        return flippedOnField || resolvedToGraveOrBanished;
      }
    );
    const updatedDefender = defenderInstanceId
      ? updatedGame.field[defenderSide].mon.find(
        (card) => card?.instance_id === defenderInstanceId
      )
      : null;
    const previousDefender = defenderInstanceId
      ? previousGame.field[defenderSide].mon.find(
        (card) => card?.instance_id === defenderInstanceId
      )
      : null;
    const noBattleImpactOnDefender = (
      updatedGame.lp.me === previousGame.lp.me
      && updatedGame.lp.opp === previousGame.lp.opp
      && (
        !defenderInstanceId
        || (
          Boolean(updatedDefender)
          && Boolean(updatedDefender.faceDown) === Boolean(previousDefender?.faceDown)
        )
      )
    );
    const attackCancelledBeforeDamage = Boolean(
      !magicCylinderRedirect
      && (
        (
          updatedAttacker
          && isMonsterAttackLockedBySpellTrap(updatedGame, attackerSide, updatedAttacker)
        )
        || (
          updatedAttacker
          && updatedAttacker.position === 'defense'
          && previousAttacker?.position !== 'defense'
        )
        || (!updatedAttacker && (defenderTrapActivated || noBattleImpactOnDefender))
        || (defenderTrapActivated && noBattleImpactOnDefender)
      )
    );
    if (attackCancelledBeforeDamage) {
      return;
    }

    const attackerZone = boardRef.current?.querySelector(
      `[data-zone="${attackerSide}-mon-${attackerIndex}"]`
    );
    const defenderIndex = defenderInstanceId
      ? previousGame.field[defenderSide].mon.findIndex(
        (card) => card?.instance_id === defenderInstanceId
      )
      : -1;
    const targetZone = !magicCylinderRedirect && defenderIndex >= 0
      ? boardRef.current?.querySelector(
        `[data-zone="${defenderSide}-mon-${defenderIndex}"]`
      )
      : null;
    const targetProfile = magicCylinderRedirect
      ? wrapRef.current?.querySelector(`[data-js="pinfo-${attackerSide}"]`)
      : defenderInstanceId
      ? null
      : wrapRef.current?.querySelector(`[data-js="pinfo-${defenderSide}"]`);

    if (attackerSide === 'opp' && !skipArrow) {
      const reduceMotion = window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const attackerVisual = attackerZone?.querySelector('.duel-field-monster');
      const targetVisual = targetProfile || targetZone?.querySelector(
        '.duel-field-monster, .card'
      );
      if (!reduceMotion && attackerVisual && targetVisual) {
        const sourceRect = attackerVisual.getBoundingClientRect();
        const targetRect = targetVisual.getBoundingClientRect();
        const end = {
          x: targetRect.left + targetRect.width / 2,
          y: targetRect.top + targetRect.height / 2
        };
        setAiAttackArrow({
          start: getAttackArrowStart(sourceRect, end.x, end.y),
          end,
          directTarget: Boolean(targetProfile),
          directTargetSide: targetProfile ? defenderSide : null,
          targetZoneKey: targetZone?.dataset.zone || null
        });
        await new Promise((resolve) => window.setTimeout(resolve, 320));
        setAiAttackArrow(null);
      }
    }

    await playDuelBattleMotion({
      attackerZone,
      targetZone,
      targetProfile,
      board: boardRef.current
    });
  }

  useEffect(() => {
    document.body.className = 'duel';
    document.title = 'Yu-Gi-Oh! H5 — Bàn đấu';
    const background = document.querySelector('.bg-image');
    const backgroundImage = background && getComputedStyle(background).backgroundImage.match(/url\((['"]?)(.*?)\1\)/)?.[2];
    if (backgroundImage) {
      const probe = new Image();
      probe.addEventListener('load', () => document.body.classList.add('has-bg'), { once: true });
      probe.src = backgroundImage;
    }
    let cancelled = false;

    async function initialize() {
      if (!initializationPromiseRef.current) {
        initializationPromiseRef.current = (async () => {
          const params = new URLSearchParams(window.location.search);
          const mode = params.get('mode');
          const deckParameter = params.get('deck');
          let deckNumber = deckParameter === null ? null : Number(deckParameter);
          if (mode === 'ai' && (
            !Number.isInteger(deckNumber) || deckNumber < 1 || deckNumber > 10
          )) {
            throw new Error('Thông tin bộ bài được chọn không hợp lệ. Hãy quay lại Đấu Trường để chọn lại.');
          }
          if (deckNumber === null) {
            const deckResult = await requestDuelJson('/api/decks');
            deckNumber = deckResult.snapshot?.selected_deck_number;
          }
          if (!Number.isInteger(deckNumber) || deckNumber < 1 || deckNumber > 10) {
            throw new Error('Hãy chọn một bộ bài hợp lệ trước khi bắt đầu Duel.');
          }
          const [sessionResult, duelResult] = await Promise.all([
            requestDuelJson('/api/session'),
            requestDuelJson('/api/duel/start', {
              method: 'POST',
              body: JSON.stringify({ deck_number: deckNumber })
            })
          ]);
          if (!sessionResult.user) {
            throw new Error('Không thể tải thông tin người chơi đang đăng nhập.');
          }
          return {
            ...duelResult,
            match: mergeDuelPlayerProfile(
              duelResult.match,
              sessionResult.user
            )
          };
        })();
      }
      const result = await initializationPromiseRef.current;
      if (!cancelled) {
        setMatchId(result.match.match_id);
        dispatch({ type: 'initialize', game: mapDuelMatch(result.match) });
      }
    }

    initialize().catch((error) => {
      console.error('Không thể khởi tạo trận đấu:', error);
      if (cancelled) return;
      setDuelInitError(error.message || 'Không thể khởi tạo trận đấu với bộ bài đã chọn.');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const tracks = ['/assets/music/bgm/duel1.mp3', '/assets/music/bgm/duel2.mp3'];
    let trackIndex = Math.floor(Math.random() * tracks.length);
    let wantsPlayback = true;
    let disposed = false;
    try {
      wantsPlayback = window.localStorage.getItem('yugioh.music') !== 'off';
    } catch (error) {
      console.error('Không thể đọc tùy chọn nhạc nền:', error);
    }

    audio.preload = 'auto';
    audio.volume = 0.55;
    audio.src = tracks[trackIndex];

    function removeGestureListeners() {
      document.removeEventListener('pointerdown', onUserGesture, true);
      document.removeEventListener('keydown', onUserGesture, true);
    }
    function startPlayback() {
      if (disposed || bgmStoppedForResultRef.current) return;
      const request = audio.play();
      if (!request || typeof request.then !== 'function') return;
      request.then(removeGestureListeners).catch((error) => {
        console.warn('Nhạc nền duel đang chờ tương tác để phát:', error);
        document.addEventListener('pointerdown', onUserGesture, true);
        document.addEventListener('keydown', onUserGesture, true);
      });
    }
    function onUserGesture() {
      if (bgmStoppedForResultRef.current) {
        removeGestureListeners();
        return;
      }
      if (wantsPlayback && audio.paused) startPlayback();
    }
    function handleEnded() {
      if (bgmStoppedForResultRef.current || orichalcosBgmSwitchedRef.current) return;
      trackIndex = (trackIndex + 1) % tracks.length;
      audio.src = tracks[trackIndex];
      if (wantsPlayback) startPlayback();
    }
    function handleError() {
      console.error('Không tải được nhạc nền duel:', audio.currentSrc || audio.src);
    }
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);
    if (wantsPlayback) {
      document.addEventListener('pointerdown', onUserGesture, true);
      document.addEventListener('keydown', onUserGesture, true);
      startPlayback();
    }
    return () => {
      disposed = true;
      removeGestureListeners();
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      audio.pause();
    };
  }, []);

  const orichalcosBgmSwitchedRef = useRef(false);
  const orichalcosEffectStartedRef = useRef(false);
  const orichalcosEffectHandleRef = useRef(null);
  const orichalcosActive = Boolean(
    game?.field?.me?.fieldZone?.[0]?.id === 's-the-seal-of-orichalcos'
    || game?.field?.opp?.fieldZone?.[0]?.id === 's-the-seal-of-orichalcos'
  );

  useEffect(() => {
    if (!orichalcosActive) return undefined;
    const audio = audioRef.current;

    const startSealAnimation = () => {
      if (orichalcosEffectStartedRef.current || !boardRef.current) return;
      orichalcosEffectStartedRef.current = true;
      mountOrichalcosBoardEffect(boardRef.current).then((handle) => {
        if (!orichalcosEffectStartedRef.current) {
          handle?.destroy?.();
          return;
        }
        orichalcosEffectHandleRef.current = handle;
      });
    };

    if (!orichalcosBgmSwitchedRef.current) {
      orichalcosBgmSwitchedRef.current = true;
      if (audio) {
        audio.loop = true;
        audio.src = '/assets/music/bgm/Orichalcosbgm.mp3';
        try {
          audio.currentTime = 0;
        } catch {
          // ignore seek errors
        }
        let musicOn = true;
        try {
          musicOn = window.localStorage.getItem('yugioh.music') !== 'off';
        } catch {
          // ignore storage errors
        }
        if (musicOn && !bgmStoppedForResultRef.current) {
          const onPlaying = () => {
            audio.removeEventListener('playing', onPlaying);
            audio.removeEventListener('error', onAudioError);
            startSealAnimation();
          };
          const onAudioError = () => {
            audio.removeEventListener('playing', onPlaying);
            audio.removeEventListener('error', onAudioError);
            startSealAnimation();
          };
          audio.addEventListener('playing', onPlaying);
          audio.addEventListener('error', onAudioError);
          const req = audio.play();
          if (req && typeof req.catch === 'function') {
            req.catch((error) => {
              console.warn('Không phát được nhạc Orichalcos:', error);
              audio.removeEventListener('playing', onPlaying);
              audio.removeEventListener('error', onAudioError);
              startSealAnimation();
            });
          }
          return () => {
            audio.removeEventListener('playing', onPlaying);
            audio.removeEventListener('error', onAudioError);
          };
        }
      }
      startSealAnimation();
    }
    return undefined;
  }, [orichalcosActive]);

  useEffect(() => () => {
    orichalcosEffectStartedRef.current = false;
    orichalcosEffectHandleRef.current?.destroy?.();
    orichalcosEffectHandleRef.current = null;
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem('yugioh.music', musicEnabled ? 'on' : 'off');
    } catch {
      // ignore storage errors
    }
    const audio = audioRef.current;
    if (!audio) return;
    if (musicEnabled && !bgmStoppedForResultRef.current) {
      const req = audio.play();
      if (req && typeof req.catch === 'function') req.catch(() => {});
    } else {
      audio.pause();
    }
  }, [musicEnabled]);

  useEffect(() => {
    sfxEnabledRef.current = sfxEnabled;
    try {
      window.localStorage.setItem('yugioh.sfx', sfxEnabled ? 'on' : 'off');
    } catch {
      // ignore storage errors
    }
    if (!sfxEnabled && cardSetSfxRef.current && !cardSetSfxRef.current.paused) {
      cardSetSfxRef.current.pause();
      cardSetSfxRef.current.currentTime = 0;
    }
  }, [sfxEnabled]);

  useEffect(() => {
    const sfx = new Audio('/assets/music/sfx/card_set.mp3');
    sfx.preload = 'auto';
    sfx.volume = 0.75;
    cardSetSfxRef.current = sfx;
    return () => {
      sfx.pause();
      cardSetSfxRef.current = null;
    };
  }, []);

  useEffect(() => {
    const activeMatchKey = matchId || 'local';
    if (prevMatchIdForSfxRef.current !== activeMatchKey) {
      prevMatchIdForSfxRef.current = activeMatchKey;
      prevFieldSfxSnapshotRef.current = null;
      lastHandledDiceSeqRef.current = 0;
      lastHandledSliferSeqRef.current = 0;
      prevAttackLockKeysRef.current = new Set();
      bgmStoppedForResultRef.current = false;
      resultSfxPlayedRef.current = false;
    }
    const field = game?.field;
    if (!field) return;

    const toSlotSnapshot = (card) => (
      card
        ? {
            key: card.instance_id || card.instanceId || card.uid || card.id || '',
            faceDown: Boolean(card.faceDown)
          }
        : null
    );
    const snapshot = {
      meMon: (field.me?.mon || []).map(toSlotSnapshot),
      meSt: (field.me?.st || []).map(toSlotSnapshot),
      meField: toSlotSnapshot(field.me?.fieldSpell),
      oppMon: (field.opp?.mon || []).map(toSlotSnapshot),
      oppSt: (field.opp?.st || []).map(toSlotSnapshot),
      oppField: toSlotSnapshot(field.opp?.fieldSpell)
    };

    const prev = prevFieldSfxSnapshotRef.current;
    prevFieldSfxSnapshotRef.current = snapshot;
    if (!prev) return;

    const prevFaceDownKeys = new Set();
    [...prev.meMon, ...prev.meSt, prev.meField, ...prev.oppMon, ...prev.oppSt, prev.oppField]
      .forEach((slot) => {
        if (slot?.faceDown && slot.key) prevFaceDownKeys.add(slot.key);
      });

    const isNewlySetSlot = (curSlot, prevSlot) => {
      if (!curSlot?.faceDown) return false;
      if (curSlot.key && prevFaceDownKeys.has(curSlot.key)) return false;
      return !prevSlot || !prevSlot.faceDown || (curSlot.key && prevSlot.key !== curSlot.key);
    };

    const hasNewlySetCard = [
      [snapshot.meMon, prev.meMon],
      [snapshot.meSt, prev.meSt],
      [snapshot.oppMon, prev.oppMon],
      [snapshot.oppSt, prev.oppSt]
    ].some(([curZone, prevZone]) =>
      curZone.some((curSlot, idx) => isNewlySetSlot(curSlot, prevZone[idx]))
    )
      || isNewlySetSlot(snapshot.meField, prev.meField)
      || isNewlySetSlot(snapshot.oppField, prev.oppField);

    if (!hasNewlySetCard || !sfxEnabledRef.current) return;
    playDuelSfx('card_set.mp3', 1.0);
  }, [game?.field, matchId]);

  const attackLockKeySignature = attackLockedChains
    .map((chain) => `${chain.instanceId}:${chain.zoneKey}`)
    .sort()
    .join('|');

  useEffect(() => {
    const nextKeys = new Set(
      attackLockKeySignature ? attackLockKeySignature.split('|') : []
    );
    const prevKeys = prevAttackLockKeysRef.current;
    let hasNewLock = false;
    nextKeys.forEach((key) => {
      if (!prevKeys.has(key)) hasNewLock = true;
    });
    prevAttackLockKeysRef.current = nextKeys;
    if (hasNewLock && sfxEnabledRef.current) {
      playDuelSfx('block.mp3', 1.0);
    }
  }, [attackLockKeySignature]);

  useEffect(() => {
    if (!game?.over || game?.busy) return undefined;
    if (resultExplosionStartedRef.current) return undefined;
    resultExplosionStartedRef.current = true;
    let cancelled = false;
    const isExodiaWin = Boolean(
      game.exodiaWinner
      || checkWinByExodia(game, 'me')
    );
    (async () => {
      try {
        if (isExodiaWin) {
          const drawnMotions = [...(game.hand?.me || []), ...(game.hand?.opp || [])]
            .filter((card) => card?._motion?.endsWith('-draw'));
          const maxDrawDelay = drawnMotions.reduce(
            (max, card) => Math.max(max, Number(card?._motionDelay) || 0),
            0
          );
          const drawWaitMs = drawnMotions.length
            ? maxDrawDelay + getDrawSequenceDuration(1) + 180
            : 0;
          if (drawWaitMs > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, drawWaitMs));
            if (cancelled) return;
          }
          await playDuelExodiaFinish(boardRef.current, {
            onVideoCovered: () => {
              if (exodiaFinalGameRef.current) {
                const finalExodiaGame = exodiaFinalGameRef.current;
                exodiaFinalGameRef.current = null;
                dispatch({ type: 'serverSync', game: finalExodiaGame });
              }
            }
          });
        } else {
          await playDuelSurrenderExplosion(boardRef.current);
        }
      } catch (error) {
        console.error('Không thể phát hiệu ứng kết thúc trận:', error);
      }
      if (!cancelled) setResultExplosionDone(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [game?.over, game?.busy]);

  const resultPopupOpen = Boolean(game?.over && resultExplosionDone);

  useEffect(() => {
    if (!resultPopupOpen) return;
    bgmStoppedForResultRef.current = true;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      try {
        audio.currentTime = 0;
      } catch {
        // ignore seek errors
      }
    }
    if (!resultSfxPlayedRef.current) {
      resultSfxPlayedRef.current = true;
      if (sfxEnabledRef.current) {
        if (game?.winner === 'me') {
          playDuelSfx('win.mp3', 1.0);
        } else if (game?.winner === 'opp') {
          playDuelSfx('lose.mp3', 1.0);
        }
      }
    }
  }, [resultPopupOpen, game?.winner]);

  async function sendServerAction(action, targetFallback = null) {
    if (!matchId || !game || actionBusyRef.current) return;
    if (
      game.pendingBattle?.awaitingResolution
      && action.type !== 'resolve_battle'
    ) return;
    actionBusyRef.current = true;
    dispatch({ type: 'serverBusy', busy: true });
    let displayedGame = game;
    const activatedHandCard = action.type === 'activate_effect'
      ? game.hand.me.find(
        (card) => card?.instance_id === action.source_instance_id
      )
      : null;
    const reloadSourceInstanceId = activatedHandCard?.id === 's-reload'
      ? activatedHandCard.instance_id || null
      : null;
    const trickySummonInstanceId = action.type === 'complete_discard'
      && game.pendingDecision?.type === 'tricky_discard'
      ? game.pendingDecision.source_instance_id
      : null;
    const discardSources = action.type === 'complete_discard'
      && Array.isArray(action.instance_ids)
      ? action.instance_ids.flatMap((instanceId) => {
        const index = game.hand.me.findIndex(
          (card) => card?.instance_id === instanceId
        );
        if (index < 0) return [];
        const source = wrapRef.current?.querySelector(
          `[data-js="hand-me"] [data-hand="${index}"]`
        );
        return source ? [source] : [];
      })
      : [];
    const handDiscardMotion = discardSources.length
      ? createDuelHandDiscardMotion(
        discardSources,
        'me',
        trickySummonInstanceId
          ? {
            jumpDuration: DUEL_TRICKY_DISCARD_JUMP_DURATION_MS,
            flightDuration: DUEL_TRICKY_DISCARD_FLIGHT_DURATION_MS
          }
          : undefined
      )
      : null;
    const animateControlTransfers = async (previousGame, updatedGame) => {
      const transfers = getTemporaryControlTransfers(previousGame, updatedGame);
      if (!transfers.length) return false;

      const sourceRects = transfers.map((transfer) => {
        const sourceZone = boardRef.current?.querySelector(
          `[data-zone="${transfer.fromSide}-mon-${transfer.fromIndex}"]`
        );
        const sourceCard = sourceZone?.querySelector(
          '.duel-field-monster-motion, .duel-field-monster, .card'
        );
        return {
          ...transfer,
          sourceRect: sourceCard?.getBoundingClientRect()
        };
      });
      const staged = stageTemporaryControlTransfers(previousGame, updatedGame);
      if (!staged) return false;

      dispatch({ type: 'serverSync', game: staged.stageGame });
      displayedGame = staged.stageGame;
      await new Promise((resolve) => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(resolve);
        });
      });

      await Promise.all(sourceRects.map(async (transfer) => {
        const targetZone = boardRef.current?.querySelector(
          `[data-zone="${transfer.toSide}-mon-${transfer.toIndex}"]`
        );
        try {
          await playDuelControlTransferMotion({
            sourceRect: transfer.sourceRect,
            targetZone,
            duration: DUEL_CONTROL_TRANSFER_DURATION_MS
          });
        } catch (error) {
          console.error('Không thể phát hiệu ứng chuyển quyền điều khiển quái thú:', error);
        }
      }));

      dispatch({ type: 'serverSync', game: staged.finalGame });
      displayedGame = staged.finalGame;
      return true;
    };
    try {
      let result = await postDuelAction(matchId, action);
      const revealedChainLinks = new Set();
      const animatedTrapFlipIds = new Set();
      const isTrapCard = (card) =>
        String(card?.category || card?.type || '').toLowerCase() === 'trap';
      const findTrapZoneElement = (side, index) => boardRef.current
        ?.querySelector(`[data-zone="${side}-st-${index}"]`)
        ?.querySelector('.card');
      const animateTrapFlipsBetweenGames = async (
        previousGame,
        nextGame,
        { activatedSourceIds = null, allowGraveTrapFlip = false } = {}
      ) => {
        if (!previousGame?.field || !nextGame?.field) return previousGame;
        const effectiveActivatedIds = new Set(
          [
            ...(activatedSourceIds || []),
            ...(previousGame.chain?.links || []).map((link) => link?.source_instance_id),
            ...(nextGame.chain?.links || []).map((link) => link?.source_instance_id)
          ].filter((id) => typeof id === 'string' && id)
        );
        const trapTransitions = [];
        for (const side of ['me', 'opp']) {
          (previousGame.field[side].st || []).forEach((previousCard, index) => {
            if (
              !previousCard?.instance_id
              || !previousCard.faceDown
            ) return;
            const currentFieldCard = nextGame.field[side].st.find(
              (card) => card?.instance_id === previousCard.instance_id
            );
            const movedToGraveOrBanished = nextGame.grave[side].some(
              (card) => card?.instance_id === previousCard.instance_id
            ) || nextGame.banished[side].some(
              (card) => card?.instance_id === previousCard.instance_id
            );
            const canFlipFromGrave = (
              effectiveActivatedIds.has(previousCard.instance_id)
              || allowGraveTrapFlip
            );
            const resolvedCard = currentFieldCard && !currentFieldCard.faceDown
              ? currentFieldCard
              : movedToGraveOrBanished && canFlipFromGrave
                ? (
                  nextGame.grave[side].find(
                    (card) => card?.instance_id === previousCard.instance_id
                  )
                  || nextGame.banished[side].find(
                    (card) => card?.instance_id === previousCard.instance_id
                  )
                  || previousCard
                )
                : null;
            if (!resolvedCard || !isTrapCard(resolvedCard)) return;
            const fallbackImage = getDuelCardArtwork(resolvedCard).fallback;
            trapTransitions.push({
              side,
              index,
              shouldAnimate: !animatedTrapFlipIds.has(previousCard.instance_id),
              card: {
                ...resolvedCard,
                image: resolvedCard.image || fallbackImage,
                faceDown: false
              }
            });
          });
        }
        if (!trapTransitions.length) return previousGame;

        let currentStageGame = previousGame;
        for (const { side, index, card, shouldAnimate } of trapTransitions) {
          animatedTrapFlipIds.add(card.instance_id);
          let committed = false;
          const commitFlippedCard = () => {
            if (committed) return;
            committed = true;
            const nextField = {
              me: { ...currentStageGame.field.me, st: currentStageGame.field.me.st.slice() },
              opp: { ...currentStageGame.field.opp, st: currentStageGame.field.opp.st.slice() }
            };
            nextField[side].st[index] = card;
            currentStageGame = {
              ...currentStageGame,
              busy: true,
              field: nextField
            };
            dispatch({ type: 'serverSync', game: currentStageGame });
            displayedGame = currentStageGame;
          };

          const sourceZone = shouldAnimate ? findTrapZoneElement(side, index) : null;
          if (!shouldAnimate || !sourceZone) {
            commitFlippedCard();
            continue;
          }

          const flippingId = card.instance_id;
          if (flippingId) {
            setTrapFlippingIds((prev) => [...new Set([...prev, flippingId])]);
          }
          try {
            await playDuelTrapActivationMotion({
              card,
              sourceZone,
              onFlipped: commitFlippedCard
            });
          } catch (error) {
            console.error('Không thể phát hiệu ứng lật bài Bẫy:', error);
          } finally {
            commitFlippedCard();
            if (flippingId) {
              setTrapFlippingIds((prev) => prev.filter((id) => id !== flippingId));
            }
          }
        }
        return currentStageGame;
      };
      const revealNewChainLinks = async (match, knownLinkKeys) => {
        const revealGame = mapDuelMatch(match, game);
        const links = match.chain?.links || [];
        for (const link of links) {
          const linkKey = [
            link.source_instance_id,
            link.card_id,
            link.effect_id,
            link.player
          ].join(':');
          if (knownLinkKeys.has(linkKey)) continue;
          knownLinkKeys.add(linkKey);
          const sourceId = link.source_instance_id;
          let card = null;
          let sourceZone = null;
          let matchedSide = null;
          let matchedKind = null;
          let matchedIndex = -1;
          for (const side of ['me', 'opp']) {
            for (const kind of ['mon', 'st']) {
              const index = revealGame.field[side][kind].findIndex(
                (fieldCard) => fieldCard?.instance_id === sourceId
              );
              if (index < 0) continue;
              card = revealGame.field[side][kind][index];
              matchedSide = side;
              matchedKind = kind;
              matchedIndex = index;
              sourceZone = boardRef.current?.querySelector(
                `[data-zone="${side}-${kind}-${index}"]`
              )?.querySelector('.duel-field-monster-motion, .duel-field-monster, .card');
              break;
            }
            if (card) break;
          }
          if (!card) {
            card = [
              ...revealGame.hand.me,
              ...revealGame.hand.opp,
              ...revealGame.grave.me,
              ...revealGame.grave.opp,
              ...revealGame.banished.me,
              ...revealGame.banished.opp
            ].find((fieldCard) => fieldCard?.instance_id === sourceId);
          }
          if (card && sourceZone) {
            const wasFaceDownTrap = matchedKind === 'st'
              && matchedIndex >= 0
              && isTrapCard(card)
              && Boolean(game?.field?.[matchedSide]?.st?.[matchedIndex]?.faceDown);
            if (wasFaceDownTrap && !animatedTrapFlipIds.has(sourceId)) {
              animatedTrapFlipIds.add(sourceId);
              let committed = false;
              const commitRevealedTrap = () => {
                if (committed) return;
                committed = true;
                const revealedField = {
                  ...displayedGame.field,
                  [matchedSide]: {
                    ...displayedGame.field[matchedSide],
                    [matchedKind]: displayedGame.field[matchedSide][matchedKind].map(
                      (fieldCard, idx) => (
                        idx === matchedIndex
                          ? { ...card, faceDown: false }
                          : fieldCard
                      )
                    )
                  }
                };
                const revealedTrapGame = {
                  ...displayedGame,
                  busy: true,
                  field: revealedField
                };
                dispatch({ type: 'serverSync', game: revealedTrapGame });
                displayedGame = revealedTrapGame;
              };
              setTrapFlippingIds((prev) => [...new Set([...prev, sourceId])]);
              try {
                await playDuelTrapActivationMotion({
                  card,
                  sourceZone,
                  onFlipped: commitRevealedTrap
                });
              } finally {
                commitRevealedTrap();
                setTrapFlippingIds((prev) => prev.filter((id) => id !== sourceId));
              }
            }
          }
        }
      };
      await revealNewChainLinks(result.match, revealedChainLinks);
      setAiAttackArrow(null);
      const hasPendingAiStages = Array.isArray(result.ai_stages) && result.ai_stages.length > 0;
      const initialSpellTrapActivationStage = hasPendingAiStages
        ? null
        : stageSpellTrapActivation(
          game,
          result.match,
          action
        );
      const spellTrapActivationStage = reloadSourceInstanceId
        ? stageReloadActivation(
          game,
          initialSpellTrapActivationStage,
          reloadSourceInstanceId
        ) || initialSpellTrapActivationStage
        : initialSpellTrapActivationStage;
      if (spellTrapActivationStage) {
        dispatch({ type: 'serverSync', game: spellTrapActivationStage });
        displayedGame = spellTrapActivationStage;
        const activatedTrapIndex = game?.field?.me?.st?.findIndex((card) =>
          card?.faceDown
          && isTrapCard(card)
          && !animatedTrapFlipIds.has(card.instance_id)
          && spellTrapActivationStage.field?.me?.st?.some(
            (stagedCard) => stagedCard?.instance_id === card.instance_id && !stagedCard.faceDown
          )
        ) ?? -1;
        if (activatedTrapIndex >= 0) {
          const trapCard = spellTrapActivationStage.field.me.st[activatedTrapIndex];
          animatedTrapFlipIds.add(trapCard.instance_id);
          await new Promise((resolve) => {
            window.requestAnimationFrame(() => {
              window.requestAnimationFrame(resolve);
            });
          });
          const trapZone = findTrapZoneElement('me', activatedTrapIndex);
          if (trapZone) {
            setTrapFlippingIds((prev) => [
              ...new Set([...prev, trapCard.instance_id])
            ]);
            try {
              await playDuelTrapActivationMotion({
                card: trapCard,
                sourceZone: trapZone
              });
            } finally {
              setTrapFlippingIds((prev) =>
                prev.filter((id) => id !== trapCard.instance_id)
              );
            }
          }
        } else {
          await new Promise((resolve) => {
            window.setTimeout(resolve, 1000);
          });
        }
      }
      const CHAIN_SPELL_TRAP_RESPONSE_IDS = new Set([
        't-trap-jammer',
        't-seven-tools-of-the-bandit',
        't-solemn-judgment',
        't-dark-bribe',
        's-mystical-space-typhoon'
      ]);
      for (let chainPassIndex = 0; chainPassIndex < 16; chainPassIndex += 1) {
        if (
          result.match.chain?.status !== 'open'
          || result.match.chain.priority_player !== 'player'
        ) break;
        const responseOptions = result.match.chain.response_options || [];
        const chainLinks = result.match.chain.links || [];
        const latestLinkPlayer = chainLinks[chainLinks.length - 1]?.player;
        const hasAiChainLink = chainLinks.some((link) => link?.player === 'ai');
        const getPlayerChainCardId = (option) => {
          const card = [
            ...(result.match.players?.player?.spell_trap_zone || []),
            ...(result.match.players?.player?.hand || [])
          ].find((item) => item?.instance_id === option?.source_instance_id);
          return card?.card_id || card?.id || option?.card_id || '';
        };
        const spellTrapCounterOptions = hasAiChainLink
          ? responseOptions.filter((option) =>
            CHAIN_SPELL_TRAP_RESPONSE_IDS.has(getPlayerChainCardId(option))
          )
          : responseOptions;
        const distinctCounterSources = new Set(
          spellTrapCounterOptions.map((option) => option.source_instance_id).filter(Boolean)
        );
        if (
          !responseOptions.length
          || latestLinkPlayer === 'player'
          || (hasAiChainLink && distinctCounterSources.size === 0)
        ) {
          result = await postDuelAction(matchId, { type: 'pass_chain' });
        } else if (
          hasAiChainLink
          && latestLinkPlayer === 'ai'
          && distinctCounterSources.size === 1
          && spellTrapCounterOptions.length === 1
        ) {
          const singleOption = spellTrapCounterOptions[0];
          result = await postDuelAction(matchId, {
            type: 'activate_effect',
            source_instance_id: singleOption.source_instance_id,
            effect_id: singleOption.effect_id,
            ...(singleOption.target_instance_ids?.length
              ? { target_instance_ids: singleOption.target_instance_ids }
              : {})
          });
        } else {
          break;
        }
        await revealNewChainLinks(result.match, revealedChainLinks);
        setAiAttackArrow(null);
        if (result.match.chain?.status === 'closed') break;
      }
      const aiTurnStages = createAiTurnStages(
        game,
        result.match,
        result.ai_stages
      );
      const cardDestructionResolved = didResolveCardDestruction(game, result.match, action);
      const forceRedrawSides = cardDestructionResolved
        ? ['opp']
        : [];
      const animateMillTransition = async (
        previousGame,
        nextGame,
        excludedSides = []
      ) => {
        const millCounts = getMillCountsBetweenStages(
          previousGame,
          nextGame,
          excludedSides
        );
        if (!millCounts.length) return;

        try {
          await new Promise((resolve) => {
            window.requestAnimationFrame(resolve);
          });
          const millAnimations = millCounts.map(({ side, count }) => {
            const duration = playDuelMillMotion(side, count);
            return duration
              ? new Promise((resolve) => window.setTimeout(resolve, duration))
              : Promise.resolve();
          });
          const counterAnimations = ['me', 'opp'].flatMap((sourceSide) =>
            previousGame.field[sourceSide].st.flatMap((card, index) => {
              if (!card || card.faceDown || card.id !== 's-counterbalance-card') {
                return [];
              }
              const targetSide = sourceSide === 'me' ? 'opp' : 'me';
              if (!millCounts.some((mill) => mill.side === targetSide)) return [];
              const sourceZone = boardRef.current?.querySelector(
                `[data-zone="${sourceSide}-st-${index}"]`
              );
              return sourceZone
                ? [playDuelCounterbalanceMotion({
                  sourceZone,
                  board: boardRef.current
                })]
                : [];
            })
          );
          await Promise.all([...millAnimations, ...counterAnimations]);
        } catch (error) {
          console.error(
            'Không thể phát hiệu ứng gửi bài từ Bộ bài vào Mộ:',
            error
          );
        }
      };
      const playDiceRollAndStatCount = async (targetGame, currentDisplayedGame) => {
        if (
          !targetGame?.lastDiceRoll?.seq
          || targetGame.lastDiceRoll.seq <= lastHandledDiceSeqRef.current
        ) return currentDisplayedGame;
        lastHandledDiceSeqRef.current = targetGame.lastDiceRoll.seq;
        try {
          await playDuelDiceRoll(boardRef.current, targetGame.lastDiceRoll);
        } catch (error) {
          console.error('Không thể phát hiệu ứng tung xúc xắc:', error);
        }
        const diceStatStage = stageDiceStatModification(
          currentDisplayedGame,
          targetGame,
          targetGame.lastDiceRoll
        );
        if (!diceStatStage) return currentDisplayedGame;
        dispatch({ type: 'serverSync', game: diceStatStage });
        displayedGame = diceStatStage;
        await new Promise((resolve) => window.setTimeout(resolve, 740));
        return diceStatStage;
      };
      const playPendingSliferTriggers = async (targetGame, currentDisplayedGame) => {
        const triggers = (targetGame?.lastSliferTriggers || [])
          .filter((entry) => entry?.seq > lastHandledSliferSeqRef.current)
          .sort((a, b) => a.seq - b.seq);
        if (!triggers.length) return currentDisplayedGame;

        lastHandledSliferSeqRef.current = triggers[triggers.length - 1].seq;
        let workingGame = currentDisplayedGame;

        for (const trigger of triggers) {
          const sliferIndex = workingGame.field?.[trigger.sliferSide]?.mon?.findIndex(
            (card) => card?.instance_id === trigger.sliferInstanceId
          ) ?? -1;
          const sliferZoneEl = sliferIndex >= 0
            ? boardRef.current
              ?.querySelector(`[data-zone="${trigger.sliferSide}-mon-${sliferIndex}"]`)
              ?.querySelector('.duel-field-monster-motion, .duel-field-monster, .card')
            : null;
          if (sliferZoneEl) {
            try {
              await playDuelEffectActivationGlow(sliferZoneEl, 500);
            } catch (error) {
              console.error('Không thể phát sáng kích hoạt Sấm Sét Thần:', error);
            }
          }

          const targetIndex = workingGame.field?.[trigger.targetSide]?.mon?.findIndex(
            (card) => card?.instance_id === trigger.targetInstanceId
          );
          const resolvedTargetIndex = targetIndex >= 0 ? targetIndex : trigger.targetZoneIndex;
          const targetZoneWrapper = boardRef.current?.querySelector(
            `[data-zone="${trigger.targetSide}-mon-${resolvedTargetIndex}"]`
          );
          if (targetZoneWrapper) {
            try {
              await playSliferLightningMotion(boardRef.current, targetZoneWrapper, {
                duration: 880
              });
            } catch (error) {
              console.error('Không thể phát tia sét Sấm Sét Thần:', error);
            }
          }

          const statReducedGame = applySliferTriggerStatReduction(workingGame, trigger);
          if (statReducedGame) {
            dispatch({ type: 'serverSync', game: statReducedGame });
            workingGame = statReducedGame;
            displayedGame = statReducedGame;
            await new Promise((resolve) => {
              window.setTimeout(resolve, trigger.destroyed ? 480 : 720);
            });
          }

          if (trigger.destroyed && targetZoneWrapper) {
            setBurstingDestructionIds([trigger.targetInstanceId]);
            await new Promise((resolve) => {
              window.requestAnimationFrame(resolve);
            });
            try {
              await playDuelDestructionMotion({
                destroyedZones: [targetZoneWrapper],
                board: boardRef.current
              });
            } catch (error) {
              console.error('Không thể phát hiệu ứng phá hủy bởi Sấm Sét Thần:', error);
            } finally {
              const nextField = {
                ...workingGame.field,
                [trigger.targetSide]: {
                  ...workingGame.field[trigger.targetSide],
                  mon: workingGame.field[trigger.targetSide].mon.map((card) =>
                    card?.instance_id === trigger.targetInstanceId ? null : card
                  )
                }
              };
              const afterDestructionGame = {
                ...workingGame,
                busy: true,
                field: nextField
              };
              dispatch({ type: 'serverSync', game: afterDestructionGame });
              workingGame = afterDestructionGame;
              displayedGame = afterDestructionGame;
              setBurstingDestructionIds([]);
            }
          }
        }
        return workingGame;
      };
      let aiStagePreviousGame = game;
      if (aiTurnStages?.actionStages?.length) {
        const aiStageActivatedSourceIds = new Set(
          [
            action.source_instance_id,
            game?.pendingDecision?.source_instance_id,
            ...(game?.chain?.links || []).map((link) => link?.source_instance_id),
            ...(result.match?.chain?.links || []).map((link) => link?.source_instance_id),
            ...Array.from(revealedChainLinks, (linkKey) => linkKey.split(':')[0])
          ].filter((id) => typeof id === 'string' && id)
        );
        let lastRevealedBattleKey = '';
        for (const stage of aiTurnStages.actionStages) {
          const stageBeforeTrapFlip = aiStagePreviousGame;
          const isAiAttackReveal = stage.type === 'attack_reveal';
          const battleKey = stage.attackerInstanceId
            ? `${stage.attackerInstanceId}:${stage.defenderInstanceId || ''}`
            : '';
          const alreadyRevealedInStage = Boolean(
            battleKey
            && lastRevealedBattleKey === battleKey
            && !isAiAttackReveal
          );
          const isAiAttackStage = (stage.type === 'attack' || isAiAttackReveal) && !alreadyRevealedInStage;
          const isAiAttackResolution = (
            ['attack', 'attack_result'].includes(stage.type)
            && !alreadyRevealedInStage
          ) || isAiAttackReveal;
          if (isAiAttackStage && stage.attackerInstanceId) {
            await showAttackDeclarationArrow({
              attackerSide: 'opp',
              attackerInstanceId: stage.attackerInstanceId,
              defenderInstanceId: stage.defenderInstanceId,
              sourceGame: stageBeforeTrapFlip,
              durationMs: 380
            });
          }
          aiStagePreviousGame = await animateTrapFlipsBetweenGames(
            stageBeforeTrapFlip,
            stage.game,
            {
              activatedSourceIds: aiStageActivatedSourceIds,
              allowGraveTrapFlip: isAiAttackResolution
            }
          );
          if (isAiAttackStage) {
            setAiAttackArrow(null);
          }
          if (isAiAttackReveal) {
            if (stage.attackerInstanceId) {
              try {
                await playBattleMotionForAction(
                  {
                    type: 'attack',
                    attacker_instance_id: stage.attackerInstanceId,
                    defender_instance_id: stage.defenderInstanceId
                  },
                  stageBeforeTrapFlip,
                  stage.game,
                  'opp',
                  true,
                  true
                );
              } catch (error) {
                console.error('Không thể phát hiệu ứng tấn công lật bài của AI:', error);
              }
            }
            const revealedStageGame = { ...stage.game, busy: true };
            dispatch({ type: 'serverSync', game: revealedStageGame });
            displayedGame = revealedStageGame;
            await new Promise((resolve) => {
              window.requestAnimationFrame(() => {
                window.requestAnimationFrame(resolve);
              });
            });
            const revealedDefenderSide = ['me', 'opp'].find((side) =>
              revealedStageGame.field?.[side]?.mon?.some(
                (card) => card?.instance_id === stage.defenderInstanceId
              )
            );
            const revealedDefenderIndex = revealedDefenderSide
              ? revealedStageGame.field[revealedDefenderSide].mon.findIndex(
                (card) => card?.instance_id === stage.defenderInstanceId
              )
              : -1;
            const revealedDefender = revealedDefenderSide && revealedDefenderIndex >= 0
              ? revealedStageGame.field[revealedDefenderSide].mon[revealedDefenderIndex]
              : null;
            const revealedDefenderZone = revealedDefenderSide && revealedDefenderIndex >= 0
              ? boardRef.current?.querySelector(
                `[data-zone="${revealedDefenderSide}-mon-${revealedDefenderIndex}"]`
              )
              : null;
            if (
              revealedDefenderZone
              && revealedDefender
              && !revealedDefender.faceDown
              && FLIP_ACTIVATION_MONSTER_IDS.has(revealedDefender.id)
            ) {
              try {
                await playDuelEffectActivationGlow(revealedDefenderZone, 620);
              } catch (error) {
                console.error('Không thể phát sáng kích hoạt quái thú lật:', error);
              }
            } else {
              await new Promise((resolve) => {
                window.setTimeout(resolve, 480);
              });
            }
            if (battleKey) {
              lastRevealedBattleKey = battleKey;
            }
            aiStagePreviousGame = stage.game;
            continue;
          }
          const activatedCard = ['spell', 'effect'].includes(stage.type)
            ? getAiActivatedSpellTrap(aiStagePreviousGame, stage.game)
            : null;
          const isAiCardDestruction =
            activatedCard?.card?.id === 's-card-destruction';
          const equipSpellStage = ['spell', 'effect'].includes(stage.type)
            ? stageEquipSpellResolution(
              aiStagePreviousGame,
              stage.game,
              'opp'
            )
            : null;
          const aiReloadStages = stage.type === 'effect'
            && activatedCard?.source === 'hand'
            && activatedCard.card?.id === 's-reload'
            ? stageAiReloadResolution(
              aiStagePreviousGame,
              stage.game,
              activatedCard.index
            )
            : null;
          const existingAiSpellStIndex = (
            ['spell', 'effect'].includes(stage.type)
            && activatedCard?.source === 'hand'
            && activatedCard.card
            && !isTrapCard(activatedCard.card)
            && !equipSpellStage
            && !aiReloadStages
          )
            ? stage.game.field.opp.st.findIndex(
              (card) => card?.instance_id === activatedCard.card.instance_id
            )
            : -1;
          const aiHandSpellPlacementIndex = (
            ['spell', 'effect'].includes(stage.type)
            && activatedCard?.source === 'hand'
            && activatedCard.card
            && !isTrapCard(activatedCard.card)
            && !equipSpellStage
            && !aiReloadStages
          )
            ? (
              existingAiSpellStIndex >= 0
                ? existingAiSpellStIndex
                : aiStagePreviousGame.field.opp.st.findIndex((card) => !card)
            )
            : -1;
          let aiSpellActivationZone = null;
          if (aiHandSpellPlacementIndex >= 0) {
            const placedOppSt = aiStagePreviousGame.field.opp.st.slice();
            placedOppSt[aiHandSpellPlacementIndex] = {
              ...activatedCard.card,
              faceDown: false,
              _motion: `${activatedCard.card.instance_id}-${Date.now()}-summon`
            };
            const aiSpellPlacementStage = {
              ...aiStagePreviousGame,
              busy: true,
              hand: {
                ...aiStagePreviousGame.hand,
                opp: aiStagePreviousGame.hand.opp.slice(
                  0,
                  Math.max(0, aiStagePreviousGame.hand.opp.length - 1)
                )
              },
              field: {
                ...aiStagePreviousGame.field,
                opp: {
                  ...aiStagePreviousGame.field.opp,
                  st: placedOppSt
                }
              }
            };
            dispatch({ type: 'serverSync', game: aiSpellPlacementStage });
            displayedGame = aiSpellPlacementStage;
            aiStagePreviousGame = aiSpellPlacementStage;
            await new Promise((resolve) => {
              window.requestAnimationFrame(() => {
                window.requestAnimationFrame(resolve);
              });
            });
            aiSpellActivationZone = boardRef.current?.querySelector(
              `[data-zone="opp-st-${aiHandSpellPlacementIndex}"]`
            )?.querySelector('.duel-field-monster-motion, .duel-field-monster, .card');
          }
          if (['spell', 'effect'].includes(stage.type) && aiSpellActivationZone) {
            await new Promise((resolve) => {
              window.setTimeout(resolve, 900);
            });
          }
          if (
            isAiAttackResolution
            && stage.attackerInstanceId
            && stage.game.chain?.status !== 'open'
          ) {
            await playTransientNegateAttackChain({
              previousGame: stageBeforeTrapFlip,
              nextGame: stage.game,
              attackerSide: 'opp',
              attackerInstanceId: stage.attackerInstanceId
            });
          }
          aiStagePreviousGame = await playDiceRollAndStatCount(
            stage.game,
            aiStagePreviousGame
          );
          if (
            isAiAttackResolution
            && stage.attackerInstanceId
            && stage.game.chain?.status !== 'open'
          ) {
            try {
              await playBattleMotionForAction(
                {
                  type: 'attack',
                  attacker_instance_id: stage.attackerInstanceId,
                  defender_instance_id: stage.defenderInstanceId
                },
                stageBeforeTrapFlip,
                stage.game,
                'opp',
                true,
                true
              );
            } catch (error) {
              console.error('Không thể phát hiệu ứng tấn công của AI:', error);
            }
          }
          const sliferPreStage = stageSliferPreTriggerResolution(
            aiStagePreviousGame,
            stage.game,
            lastHandledSliferSeqRef.current
          );
          const stageEffectiveTarget = sliferPreStage || stage.game;
          const destroyedCards = getAiDestroyedFieldCards(
            aiStagePreviousGame,
            stageEffectiveTarget
          );
          const revivedJamCards = getRevivedJamCards(
            aiStagePreviousGame,
            stageEffectiveTarget
          );
          const destroyedZones = [
            ...destroyedCards,
            ...revivedJamCards.map(({ side, prevIndex, instanceId }) => ({
              side,
              kind: 'mon',
              index: prevIndex,
              instanceId
            }))
          ].map(({ side, kind, index }) =>
            boardRef.current?.querySelector(
              `[data-zone="${side}-${kind}-${index}"]`
            )
          ).filter(Boolean);
          const hasSummonedMonster = hasNewlySummonedMonster(
            aiStagePreviousGame,
            stageEffectiveTarget
          );
          const hasDestroyedMonster = destroyedCards.some((card) => card.kind === 'mon');
          const summonStage = hasDestroyedMonster
            ? stageMonsterSummonResolution(aiStagePreviousGame, stageEffectiveTarget)
            : null;
          const baseDestructionStage = (destroyedCards.length || revivedJamCards.length)
            ? stageFieldDestructionResolution(
              aiStagePreviousGame,
              summonStage || stageEffectiveTarget
            ) || {
              ...stageEffectiveTarget,
              busy: true,
              field: {
                ...stageEffectiveTarget.field,
                me: { ...stageEffectiveTarget.field.me, mon: stageEffectiveTarget.field.me.mon.slice() },
                opp: { ...stageEffectiveTarget.field.opp, mon: stageEffectiveTarget.field.opp.mon.slice() }
              }
            }
            : null;
          if (baseDestructionStage && revivedJamCards.length) {
            revivedJamCards.forEach(({ side, prevIndex, nextIndex }) => {
              const prevCard = aiStagePreviousGame.field[side]?.mon?.[prevIndex] || null;
              if (nextIndex !== prevIndex) {
                baseDestructionStage.field[side].mon[nextIndex] = null;
              }
              baseDestructionStage.field[side].mon[prevIndex] = prevCard;
            });
          }
          const destructionStage = baseDestructionStage;
          const stageDisplayGame = equipSpellStage
            || aiReloadStages?.activationStage
            || destructionStage
            || stageEffectiveTarget;
          if (equipSpellStage) {
            const targetInstanceId = equipSpellStage.field.opp.st.find((card) =>
              EQUIP_SPELL_CARD_IDS.has(card?.id)
              && !aiStagePreviousGame.field.opp.st.some(
                (previousCard) =>
                  previousCard?.instance_id === card.instance_id
                  && !previousCard.faceDown
              )
            )?.target_instance_id;
            const targetSide = ['me', 'opp'].find((side) =>
              equipSpellStage.field[side].mon.some(
                (card) => card?.instance_id === targetInstanceId
              )
            );
            const targetIndex = targetSide
              ? equipSpellStage.field[targetSide].mon.findIndex(
                (card) => card?.instance_id === targetInstanceId
              )
              : -1;
            setAiEquipTargetZoneKey(
              targetIndex >= 0 ? `${targetSide}-mon-${targetIndex}` : null
            );
          }
          const aiDiscardedCards = stage.type === 'discard'
            ? getAiDiscardedCards(aiStagePreviousGame, stage.game)
            : [];
          const aiDiscardElements = aiDiscardedCards.length
            ? Array.from(
              wrapRef.current?.querySelectorAll(
                '[data-js="hand-opp"] .hand__opponent-list .card'
              ) || []
            ).slice(-aiDiscardedCards.length)
            : [];
          const aiHandDiscardMotion = aiDiscardElements.length
            && aiDiscardElements.length === aiDiscardedCards.length
            ? createDuelHandDiscardMotion(
              aiDiscardElements,
              'opp',
              {
                jumpDuration: DUEL_TRICKY_DISCARD_JUMP_DURATION_MS,
                flightDuration: DUEL_TRICKY_DISCARD_FLIGHT_DURATION_MS
              }
            )
            : null;
          let animatedControlTransfer = false;
          if (aiHandDiscardMotion) {
            const discardedInstanceIds = new Set(
              aiDiscardedCards.map((card) => card.instance_id)
            );
            const discardBaseGame = destructionStage || stage.game;
            const discardStage = {
              ...discardBaseGame,
              busy: true,
              grave: {
                ...discardBaseGame.grave,
                opp: discardBaseGame.grave.opp.filter(
                  (card) => !discardedInstanceIds.has(card?.instance_id)
                )
              }
            };
            const discardAnimation = aiHandDiscardMotion();
            dispatch({ type: 'serverSync', game: discardStage });
            displayedGame = discardStage;
            try {
              await discardAnimation;
            } catch (error) {
              console.error('Không thể phát hiệu ứng bỏ bài của AI vào Mộ:', error);
            }
            const afterDiscardStage =
              destructionStage ||
              (stage.game?.exodiaWinner
                ? {
                    ...stage.game,
                    lp: {
                      ...stage.game.lp,
                      [stage.game.exodiaWinner === 'me' ? 'opp' : 'me']:
                        aiStagePreviousGame.lp[
                          stage.game.exodiaWinner === 'me' ? 'opp' : 'me'
                        ]
                    },
                    field: {
                      ...stage.game.field,
                      [stage.game.exodiaWinner === 'me' ? 'opp' : 'me']:
                        aiStagePreviousGame.field[
                          stage.game.exodiaWinner === 'me' ? 'opp' : 'me'
                        ]
                    },
                    grave:
                      stage.game.grave && aiStagePreviousGame.grave
                        ? {
                            ...stage.game.grave,
                            [stage.game.exodiaWinner === 'me' ? 'opp' : 'me']:
                              aiStagePreviousGame.grave[
                                stage.game.exodiaWinner === 'me' ? 'opp' : 'me'
                              ]
                          }
                        : stage.game.grave
                  }
                : stage.game);
            dispatch({ type: 'serverSync', game: afterDiscardStage });
            displayedGame = afterDiscardStage;
          } else {
            const visibleStageDisplayGame = stageDisplayGame?.exodiaWinner
              ? {
                  ...stageDisplayGame,
                  lp: {
                    ...stageDisplayGame.lp,
                    [stageDisplayGame.exodiaWinner === 'me' ? 'opp' : 'me']:
                      aiStagePreviousGame.lp[
                        stageDisplayGame.exodiaWinner === 'me' ? 'opp' : 'me'
                      ]
                  },
                  field: {
                    ...stageDisplayGame.field,
                    [stageDisplayGame.exodiaWinner === 'me' ? 'opp' : 'me']:
                      aiStagePreviousGame.field[
                        stageDisplayGame.exodiaWinner === 'me' ? 'opp' : 'me'
                      ]
                  },
                  grave:
                    stageDisplayGame.grave && aiStagePreviousGame.grave
                      ? {
                          ...stageDisplayGame.grave,
                          [stageDisplayGame.exodiaWinner === 'me' ? 'opp' : 'me']:
                            aiStagePreviousGame.grave[
                              stageDisplayGame.exodiaWinner === 'me' ? 'opp' : 'me'
                            ]
                        }
                      : stageDisplayGame.grave
                }
              : stageDisplayGame;
            animatedControlTransfer = await animateControlTransfers(
              aiStagePreviousGame,
              visibleStageDisplayGame
            );
            if (!animatedControlTransfer) {
              const aiOrichalcosPreBoost = (() => {
                if (!visibleStageDisplayGame?.field) return null;
                let staged = false;
                const nextField = { ...visibleStageDisplayGame.field };
                ['me', 'opp'].forEach((side) => {
                  const fieldCard = visibleStageDisplayGame.field[side]?.fieldZone?.[0];
                  if (fieldCard?.id !== 's-the-seal-of-orichalcos' || fieldCard?.faceDown) return;
                  const prevIds = new Set(
                    (aiStagePreviousGame?.field?.[side]?.mon || [])
                      .filter((card) => card && !card.faceDown)
                      .map((card) => card.instance_id)
                  );
                  const nextMon = (visibleStageDisplayGame.field[side]?.mon || []).map((card) => {
                    if (!card || card.faceDown || prevIds.has(card.instance_id)) return card;
                    const numericAtk = Number(card.atk);
                    if (!Number.isFinite(numericAtk)) return card;
                    staged = true;
                    return { ...card, atk: Math.max(0, numericAtk - 500) };
                  });
                  nextField[side] = { ...visibleStageDisplayGame.field[side], mon: nextMon };
                });
                return staged ? { ...visibleStageDisplayGame, busy: true, field: nextField } : null;
              })();
              if (aiOrichalcosPreBoost) {
                dispatch({ type: 'serverSync', game: aiOrichalcosPreBoost });
                displayedGame = aiOrichalcosPreBoost;
                await new Promise((resolve) => {
                  window.setTimeout(resolve, DUEL_SUMMON_DURATION_MS + 100);
                });
              }
              dispatch({ type: 'serverSync', game: visibleStageDisplayGame });
              displayedGame = visibleStageDisplayGame;
            }
          }
          await animateMillTransition(
            aiStagePreviousGame,
            stage.game,
            isAiCardDestruction ? ['me', 'opp'] : []
          );
          const drawnCount = Math.max(
            0,
            stage.game.hand.me.length - aiStagePreviousGame.hand.me.length,
            stage.game.hand.opp.length - aiStagePreviousGame.hand.opp.length
          );
          const stageDelay = aiReloadStages
            ? 0
            : equipSpellStage
            ? DUEL_PLACEMENT_DURATION_MS + 80
            : stage.type === 'draw'
            ? getDrawSequenceDuration(1) + 80
            : stage.type === 'summon'
              ? (summonStage ? 0 : DUEL_SUMMON_DURATION_MS + 80)
              : stage.type === 'discard'
                ? 0
                : Math.max(280, getDrawSequenceDuration(drawnCount) + 80);
          const sequencedStageDelay = Math.max(
            stageDelay,
            hasSummonedMonster && !summonStage
              ? DUEL_SUMMON_DURATION_MS + 450
              : 0
          );
          await new Promise((resolve) => {
            window.setTimeout(resolve, sequencedStageDelay);
          });
          if (aiReloadStages) {
            const returnSources = Array.from(
              wrapRef.current?.querySelectorAll(
                '[data-js="hand-opp"] .hand__opponent-list .card'
              ) || []
            );
            const returnAnimation = createDuelHandReturnMotion(
              returnSources,
              'opp'
            );
            try {
              await returnAnimation();
            } catch (error) {
              console.error('Không thể phát hiệu ứng AI đưa bài về Bộ bài:', error);
            }

            dispatch({ type: 'serverSync', game: aiReloadStages.shuffleStage });
            displayedGame = aiReloadStages.shuffleStage;
            await new Promise((resolve) => {
              window.requestAnimationFrame(resolve);
            });
            try {
              await playDuelDeckShuffleMotion('opp');
            } catch (error) {
              console.error('Không thể phát hiệu ứng AI xáo trộn Bộ bài:', error);
            }

            dispatch({ type: 'serverSync', game: aiReloadStages.drawStage });
            displayedGame = aiReloadStages.drawStage;
            await new Promise((resolve) => {
              window.setTimeout(
                resolve,
                getDrawSequenceDuration(aiReloadStages.drawnCount) + 80
              );
            });
          }
          if (equipSpellStage && !animatedControlTransfer && !destructionStage) {
            dispatch({ type: 'serverSync', game: stage.game });
            displayedGame = stage.game;
          }
          if (equipSpellStage) {
            await new Promise((resolve) => {
              window.setTimeout(resolve, 650);
            });
            setAiEquipTargetZoneKey(null);
          }
          if (destructionStage || revivedJamCards.length) {
            const visibleDestructionStage = destructionStage?.exodiaWinner
              ? {
                  ...destructionStage,
                  lp: {
                    ...destructionStage.lp,
                    [destructionStage.exodiaWinner === 'me' ? 'opp' : 'me']:
                      aiStagePreviousGame.lp[
                        destructionStage.exodiaWinner === 'me' ? 'opp' : 'me'
                      ]
                  },
                  field: {
                    ...destructionStage.field,
                    [destructionStage.exodiaWinner === 'me' ? 'opp' : 'me']:
                      aiStagePreviousGame.field[
                        destructionStage.exodiaWinner === 'me' ? 'opp' : 'me'
                      ]
                  },
                  grave:
                    destructionStage.grave && aiStagePreviousGame.grave
                      ? {
                          ...destructionStage.grave,
                          [destructionStage.exodiaWinner === 'me' ? 'opp' : 'me']:
                            aiStagePreviousGame.grave[
                              destructionStage.exodiaWinner === 'me' ? 'opp' : 'me'
                            ]
                        }
                      : destructionStage.grave
                }
              : destructionStage;
            if (
              visibleDestructionStage
              && displayedGame !== visibleDestructionStage
            ) {
              dispatch({ type: 'serverSync', game: visibleDestructionStage });
              displayedGame = visibleDestructionStage;
              await new Promise((resolve) => {
                window.requestAnimationFrame(resolve);
              });
            }
            if (!stage.game?.exodiaWinner && destroyedZones.length) {
              const destroyedInstanceIds = destroyedZones
                .map((zone) => zone?.dataset?.cardInstanceId)
                .filter(Boolean);
              if (destroyedInstanceIds.length) {
                setBurstingDestructionIds(destroyedInstanceIds);
              }
              try {
                await playDuelDestructionMotion({
                  destroyedZones,
                  board: boardRef.current
                });
              } catch (error) {
                console.error('Không thể phát hiệu ứng phá hủy bài của AI:', error);
              }
            }
            if (revivedJamCards.length) {
              const preRevivalField = {
                me: { ...stage.game.field.me, mon: stage.game.field.me.mon.slice() },
                opp: { ...stage.game.field.opp, mon: stage.game.field.opp.mon.slice() }
              };
              const revivalSummonField = {
                me: { ...stage.game.field.me, mon: stage.game.field.me.mon.slice() },
                opp: { ...stage.game.field.opp, mon: stage.game.field.opp.mon.slice() }
              };
              revivedJamCards.forEach(({ side, nextIndex, card }) => {
                preRevivalField[side].mon[nextIndex] = null;
                revivalSummonField[side].mon[nextIndex] = {
                  ...card,
                  _motion: `${card.instance_id}-revival-${Date.now()}-summon`
                };
              });
              dispatch({
                type: 'serverSync',
                game: { ...stage.game, busy: true, field: preRevivalField }
              });
              await new Promise((resolve) => {
                window.requestAnimationFrame(() => {
                  window.requestAnimationFrame(resolve);
                });
              });
              const revivedStage = { ...stage.game, field: revivalSummonField };
              dispatch({ type: 'serverSync', game: revivedStage });
              displayedGame = revivedStage;
              setTransientAttackLockChains([]);
              await new Promise((resolve) => {
                window.setTimeout(resolve, DUEL_SUMMON_DURATION_MS + 80);
              });
            } else {
              const visibleStageGame = stageEffectiveTarget?.exodiaWinner
                ? {
                    ...stageEffectiveTarget,
                    lp: {
                      ...stageEffectiveTarget.lp,
                      [stageEffectiveTarget.exodiaWinner === 'me' ? 'opp' : 'me']:
                        aiStagePreviousGame.lp[
                          stageEffectiveTarget.exodiaWinner === 'me' ? 'opp' : 'me'
                        ]
                    },
                    field: {
                      ...stageEffectiveTarget.field,
                      [stageEffectiveTarget.exodiaWinner === 'me' ? 'opp' : 'me']:
                        aiStagePreviousGame.field[
                          stageEffectiveTarget.exodiaWinner === 'me' ? 'opp' : 'me'
                        ]
                    },
                    grave:
                      stageEffectiveTarget.grave && aiStagePreviousGame.grave
                        ? {
                            ...stageEffectiveTarget.grave,
                            [stageEffectiveTarget.exodiaWinner === 'me' ? 'opp' : 'me']:
                              aiStagePreviousGame.grave[
                                stageEffectiveTarget.exodiaWinner === 'me' ? 'opp' : 'me'
                              ]
                          }
                        : stageEffectiveTarget.grave
                  }
                : stageEffectiveTarget;
              dispatch({ type: 'serverSync', game: visibleStageGame });
              displayedGame = visibleStageGame;
              setBurstingDestructionIds([]);
              setTransientAttackLockChains([]);
              if (hasSummonedMonster) {
                await new Promise((resolve) => {
                  window.setTimeout(resolve, DUEL_SUMMON_DURATION_MS + 80);
                });
              }
            }
          }
          if (sliferPreStage) {
            await playPendingSliferTriggers(stage.game, displayedGame);
            if (!stage.game?.exodiaWinner) {
              dispatch({ type: 'serverSync', game: stage.game });
              displayedGame = stage.game;
            }
          }
          aiStagePreviousGame = stage.game?.exodiaWinner
            ? {
                ...stage.game,
                lp: {
                  ...stage.game.lp,
                  [stage.game.exodiaWinner === 'me' ? 'opp' : 'me']:
                    aiStagePreviousGame.lp[
                      stage.game.exodiaWinner === 'me' ? 'opp' : 'me'
                    ]
                },
                field: {
                  ...stage.game.field,
                  [stage.game.exodiaWinner === 'me' ? 'opp' : 'me']:
                    aiStagePreviousGame.field[
                      stage.game.exodiaWinner === 'me' ? 'opp' : 'me'
                    ]
                },
                grave:
                  stage.game.grave && aiStagePreviousGame.grave
                    ? {
                        ...stage.game.grave,
                        [stage.game.exodiaWinner === 'me' ? 'opp' : 'me']:
                          aiStagePreviousGame.grave[
                            stage.game.exodiaWinner === 'me' ? 'opp' : 'me'
                          ]
                      }
                    : stage.game.grave
              }
            : stage.game;
        }
      } else if (aiTurnStages) {
        dispatch({ type: 'serverSync', game: aiTurnStages.drawStage });
        displayedGame = aiTurnStages.drawStage;
        await new Promise((resolve) => {
          window.setTimeout(resolve, getDrawSequenceDuration(1) + 80);
        });
        const animatedControlTransfer = await animateControlTransfers(
          aiTurnStages.drawStage,
          aiTurnStages.boardStage
        );
        if (!animatedControlTransfer) {
          dispatch({ type: 'serverSync', game: aiTurnStages.boardStage });
          displayedGame = aiTurnStages.boardStage;
        }
        await new Promise((resolve) => {
          window.setTimeout(
            resolve,
            (aiTurnStages.hasSummon ? DUEL_SUMMON_DURATION_MS : 350) + 80
          );
        });
      }
      const updatedGame = mapDuelMatch(
        result.match,
        aiTurnStages?.actionStages?.length
          ? aiStagePreviousGame
          : aiTurnStages?.boardStage || spellTrapActivationStage || game,
        { forceRedrawSides }
      );
      const activatedSourceIds = new Set(
        [
          action.source_instance_id,
          game?.pendingDecision?.source_instance_id,
          ...(game?.chain?.links || []).map((link) => link?.source_instance_id),
          ...(result.match?.chain?.links || []).map((link) => link?.source_instance_id),
          ...Array.from(revealedChainLinks, (linkKey) => linkKey.split(':')[0])
        ].filter((id) => typeof id === 'string' && id)
      );
      displayedGame = await animateTrapFlipsBetweenGames(
        displayedGame,
        updatedGame,
        {
          activatedSourceIds,
          allowGraveTrapFlip: action.type === 'attack'
        }
      );
      displayedGame = await playDiceRollAndStatCount(updatedGame, displayedGame);
      const sliferPreStage = stageSliferPreTriggerResolution(
        displayedGame,
        updatedGame,
        lastHandledSliferSeqRef.current
      );
      const effectiveUpdatedGame = sliferPreStage || updatedGame;
      const destructionBaseline = displayedGame;
      const genericDestroyedKinds = ['mon', 'st'];
      const targetInstanceIds = new Set(
        (action.target_instance_ids || []).filter((id) => typeof id === 'string' && id)
      );
      const effectDestroyedZones = [];
      const sourceSpellTrapDestroyedZones = [];
      for (const side of ['opp', 'me']) {
        for (const kind of genericDestroyedKinds) {
          destructionBaseline.field[side][kind].forEach((previousCard, index) => {
            if (!previousCard?.instance_id) return;
            const remainsOnField = ['me', 'opp'].some((checkSide) =>
              (effectiveUpdatedGame.field[checkSide][kind] || []).some(
                (card) => card?.instance_id === previousCard.instance_id
              )
            );
            const reachedGraveOrBanished = ['me', 'opp'].some((checkSide) =>
              (effectiveUpdatedGame.grave[checkSide] || []).some(
                (card) => card?.instance_id === previousCard.instance_id
              ) || (effectiveUpdatedGame.banished[checkSide] || []).some(
                (card) => card?.instance_id === previousCard.instance_id
              )
            );
            if (remainsOnField || !reachedGraveOrBanished) return;
            const zone = boardRef.current?.querySelector(
              `[data-zone="${side}-${kind}-${index}"]`
            );
            if (!zone) return;
            const wasPlacedFromHand = (game?.hand?.[side] || []).some(
              (card) => card?.instance_id === previousCard.instance_id
            );
            const wasFlippedFromFaceDown = kind === 'st'
              && !previousCard.faceDown
              && Boolean(game?.field?.[side]?.st?.[index]?.faceDown);
            const isActivatedSourceSpellTrap = kind === 'st'
              && !targetInstanceIds.has(previousCard.instance_id)
              && (
                activatedSourceIds.has(previousCard.instance_id)
                || wasPlacedFromHand
                || wasFlippedFromFaceDown
              );
            if (isActivatedSourceSpellTrap) {
              sourceSpellTrapDestroyedZones.push(zone);
            } else {
              effectDestroyedZones.push(zone);
            }
          });
        }
      }
      if (action.type === 'activate_effect' && typeof action.source_instance_id === 'string') {
        const activatedFromHand = destructionBaseline.hand.me.find(
          (card) => card?.instance_id === action.source_instance_id
        );
        if (
          activatedFromHand
          && !reloadSourceInstanceId
          && (
            updatedGame.grave.me.some(
              (card) => card?.instance_id === action.source_instance_id
            )
            || updatedGame.banished.me.some(
              (card) => card?.instance_id === action.source_instance_id
            )
          )
        ) {
          const activationIndex = (
            Number.isInteger(action.zone_index)
            && !destructionBaseline.field.me.st[action.zone_index]
          )
            ? action.zone_index
            : destructionBaseline.field.me.st.findIndex((card) => !card);
          if (activationIndex >= 0) {
            const zone = boardRef.current?.querySelector(
              `[data-zone="me-st-${activationIndex}"]`
            );
            if (zone) sourceSpellTrapDestroyedZones.push(zone);
          }
        }
      }
      const playerTurnRevivedJams = getRevivedJamCards(
        destructionBaseline,
        updatedGame
      );
      playerTurnRevivedJams.forEach(({ side, prevIndex }) => {
        const zone = boardRef.current?.querySelector(
          `[data-zone="${side}-mon-${prevIndex}"]`
        );
        if (zone) effectDestroyedZones.push(zone);
      });
      const genericDestroyedZones = [
        ...effectDestroyedZones,
        ...sourceSpellTrapDestroyedZones
      ];
      const lightningStormDestroyedZones = getLightningStormDestroyedZones(
        destructionBaseline,
        updatedGame,
        action
      ).map(({ side, kind, index }) =>
        boardRef.current?.querySelector(`[data-zone="${side}-${kind}-${index}"]`)
      ).filter(Boolean);
      const destructionZones = updatedGame.exodiaWinner
        ? []
        : genericDestroyedZones.length
          ? genericDestroyedZones
          : lightningStormDestroyedZones;
      const playPendingDestruction = async () => {
        if (!destructionZones.length) return;
        const destroyedInstanceIds = destructionZones
          .map((zone) => zone?.dataset?.cardInstanceId)
          .filter(Boolean);
        if (destroyedInstanceIds.length) {
          setBurstingDestructionIds(destroyedInstanceIds);
        }
        await new Promise((resolve) => {
          window.requestAnimationFrame(resolve);
        });
        try {
          await playDuelDestructionMotion({
            destroyedZones: destructionZones,
            board: boardRef.current
          });
        } catch (error) {
          console.error('Không thể phát hiệu ứng phá hủy bài:', error);
        }
      };
      const hasDestroyedMonster = effectDestroyedZones.length > 0;
      const summonStage = hasDestroyedMonster
        ? stageMonsterSummonResolution(destructionBaseline, effectiveUpdatedGame)
        : null;
      const resolvedDisplayStage = destructionZones.length
        ? stageFieldDestructionResolution(
          destructionBaseline,
          summonStage || effectiveUpdatedGame
        ) || (playerTurnRevivedJams.length ? {
          ...effectiveUpdatedGame,
          busy: true,
          field: {
            ...effectiveUpdatedGame.field,
            me: { ...effectiveUpdatedGame.field.me, mon: effectiveUpdatedGame.field.me.mon.slice() },
            opp: { ...effectiveUpdatedGame.field.opp, mon: effectiveUpdatedGame.field.opp.mon.slice() }
          }
        } : null)
        : null;
      if (resolvedDisplayStage && playerTurnRevivedJams.length) {
        playerTurnRevivedJams.forEach(({ side, prevIndex, nextIndex }) => {
          const prevCard = destructionBaseline.field[side]?.mon?.[prevIndex] || null;
          if (nextIndex !== prevIndex) {
            resolvedDisplayStage.field[side].mon[nextIndex] = null;
          }
          resolvedDisplayStage.field[side].mon[prevIndex] = prevCard;
        });
      }
      const handledAiAttackResult = Boolean(
        aiTurnStages?.actionStages?.some((stage) => stage.type === 'attack_result')
      );
      const resolvedChainBattle = Boolean(
        !handledAiAttackResult
        && game?.pendingBattle?.attackerInstanceId
        && updatedGame.chain?.status === 'closed'
        && !updatedGame.pendingBattle?.awaitingResolution
      );
      if (
        action.type === 'attack'
        || action.type === 'resolve_battle'
        || resolvedChainBattle
        || getMagicCylinderRedirect(game, updatedGame, action)
      ) {
        const battleMotionAction = (
          resolvedChainBattle
          && !['attack', 'resolve_battle'].includes(action.type)
        )
          ? { type: 'resolve_battle' }
          : action;
        const battleAttackerId = battleMotionAction.type === 'attack'
          ? battleMotionAction.attacker_instance_id
          : game?.pendingBattle?.attackerInstanceId;
        const resolvedAttackerSide = battleAttackerId
          && game?.field?.opp?.mon?.some((card) => card?.instance_id === battleAttackerId)
          ? 'opp'
          : 'me';
        if (action.type === 'attack' && action.attacker_instance_id) {
          await playTransientNegateAttackChain({
            previousGame: game,
            nextGame: updatedGame,
            attackerSide: resolvedAttackerSide,
            attackerInstanceId: action.attacker_instance_id
          });
        }
        try {
          await playBattleMotionForAction(
            battleMotionAction,
            game,
            updatedGame,
            resolvedAttackerSide
          );
          if (action.type === 'resolve_battle' && game.pendingBattle?.defenderInstanceId) {
            const flipDefenderIndex = (game.field?.opp?.mon || []).findIndex(
              (card) => card?.instance_id === game.pendingBattle.defenderInstanceId
            );
            const flipDefender = flipDefenderIndex >= 0
              ? game.field.opp.mon[flipDefenderIndex]
              : null;
            const flipDefenderZone = flipDefenderIndex >= 0
              ? boardRef.current?.querySelector(`[data-zone="opp-mon-${flipDefenderIndex}"]`)
              : null;
            if (
              flipDefender
              && !flipDefender.faceDown
              && game.pendingBattle.revealedFaceDown
              && FLIP_ACTIVATION_MONSTER_IDS.has(flipDefender.id)
              && flipDefenderZone
            ) {
              await playDuelEffectActivationGlow(flipDefenderZone, 620);
            }
          }
        } catch (error) {
          console.error('Không thể phát hiệu ứng chiến đấu:', error);
        }
      }
      const millBaseline = aiTurnStages?.actionStages?.length
        ? aiStagePreviousGame
        : game;
      await animateMillTransition(
        millBaseline,
        updatedGame,
        cardDestructionResolved ? ['me', 'opp'] : []
      );
      if (
        handDiscardMotion
        && action.instance_ids.some((instanceId) =>
          updatedGame.grave.me.some((card) => card?.instance_id === instanceId)
        )
      ) {
        const delayTrickySummon = trickySummonInstanceId
          && updatedGame.field.me.mon.some(
            (card) => card?.instance_id === trickySummonInstanceId
          );
        const discardedInstanceIds = new Set(action.instance_ids);
        const discardBaseGame = resolvedDisplayStage || updatedGame;
        const discardStage = {
          ...discardBaseGame,
          busy: true,
          ...(delayTrickySummon && !resolvedDisplayStage ? {
            field: {
              ...discardBaseGame.field,
              me: {
                ...discardBaseGame.field.me,
                mon: discardBaseGame.field.me.mon.map((card) =>
                  card?.instance_id === trickySummonInstanceId ? null : card
                )
              }
            }
          } : {}),
          grave: {
            ...discardBaseGame.grave,
            me: discardBaseGame.grave.me.filter(
              (card) => !discardedInstanceIds.has(card?.instance_id)
            )
          }
        };
        const discardAnimation = handDiscardMotion();
        dispatch({ type: 'serverSync', game: discardStage });
        displayedGame = discardStage;
        try {
          await discardAnimation;
        } catch (error) {
          console.error('Không thể phát hiệu ứng bỏ bài từ tay vào Mộ:', error);
        }
      }
      const reloadStages = stageReloadResolution(
        spellTrapActivationStage,
        updatedGame,
        activatedHandCard?.id
      );
      if (reloadStages) {
        const returnSources = spellTrapActivationStage.hand.me
          .map((_, index) => wrapRef.current?.querySelector(
            `[data-js="hand-me"] [data-hand="${index}"]`
          ))
          .filter(Boolean);
        const returnAnimation = createDuelHandReturnMotion(returnSources, 'me');
        try {
          await returnAnimation();
        } catch (error) {
          console.error('Không thể phát hiệu ứng đưa bài trên tay về Bộ bài:', error);
        }

        dispatch({ type: 'serverSync', game: reloadStages.shuffleStage });
        displayedGame = reloadStages.shuffleStage;
        await new Promise((resolve) => {
          window.requestAnimationFrame(resolve);
        });
        try {
          await playDuelDeckShuffleMotion('me');
        } catch (error) {
          console.error('Không thể phát hiệu ứng xáo trộn Bộ bài:', error);
        }

        dispatch({ type: 'serverSync', game: reloadStages.drawStage });
        displayedGame = reloadStages.drawStage;
        await new Promise((resolve) => {
          window.setTimeout(
            resolve,
            getDrawSequenceDuration(reloadStages.drawnCount) + 80
          );
        });
      }
      const exodiaBaselineGame = aiTurnStages?.actionStages?.length
        ? aiStagePreviousGame
        : game;
      const maskExodiaOutcomeForVideo = (targetGame, _baselineGame) => {
        const baselineGame = exodiaBaselineGame;
        if (!targetGame?.exodiaWinner || !baselineGame?.lp || !baselineGame?.field) {
          return targetGame;
        }
        const loserSide = targetGame.exodiaWinner === 'me' ? 'opp' : 'me';
        return {
          ...targetGame,
          lp: {
            ...targetGame.lp,
            [loserSide]: baselineGame.lp[loserSide]
          },
          field: {
            ...targetGame.field,
            [loserSide]: baselineGame.field[loserSide]
          },
          grave:
            targetGame.grave && baselineGame.grave
              ? {
                  ...targetGame.grave,
                  [loserSide]: baselineGame.grave[loserSide]
                }
              : targetGame.grave
        };
      };
      if (updatedGame?.exodiaWinner) {
        exodiaFinalGameRef.current = updatedGame;
      } else {
        exodiaFinalGameRef.current = null;
      }
      const potOfGreedStage = stagePotOfGreedResolution(game, updatedGame);
      if (potOfGreedStage) {
        const potDisplayStage = maskExodiaOutcomeForVideo(
          stageFieldDestructionResolution(destructionBaseline, potOfGreedStage) ||
            potOfGreedStage,
          game
        );
        dispatch({ type: 'serverSync', game: potDisplayStage });
        displayedGame = potDisplayStage;
        await new Promise((resolve) => {
          window.setTimeout(resolve, getDrawSequenceDuration(2) + 80);
        });
        await playPendingDestruction();
        dispatch({
          type: 'serverSync',
          game: maskExodiaOutcomeForVideo({ ...updatedGame, busy: true }, game)
        });
      } else if (cardDestructionResolved) {
        const playerDiscardSources = Array.from(
          wrapRef.current?.querySelectorAll('[data-js="hand-me"] .card') || []
        );
        const opponentDiscardSources = Array.from(
          wrapRef.current?.querySelectorAll(
            '[data-js="hand-opp"] .hand__opponent-list .card'
          ) || []
        );
        const discardAnimations = [
          createDuelHandDiscardMotion(playerDiscardSources, 'me')(),
          createDuelHandDiscardMotion(opponentDiscardSources, 'opp')()
        ];
        const discardStage = stageCardDestructionResolution(updatedGame);
        const discardDisplayStage = maskExodiaOutcomeForVideo(
          stageFieldDestructionResolution(destructionBaseline, discardStage) ||
            discardStage,
          game
        );
        dispatch({ type: 'serverSync', game: discardDisplayStage });
        displayedGame = discardDisplayStage;
        try {
          await Promise.all(discardAnimations);
        } catch (error) {
          console.error(
            'Không thể phát hiệu ứng bỏ bài trên tay của Bỏ Hết Bài Trên Tay:',
            error
          );
        }
        const resolvedDisplayStage = stageFieldDestructionResolution(
          destructionBaseline,
          updatedGame
        );
        if (resolvedDisplayStage) {
          const maskedResolvedStage = maskExodiaOutcomeForVideo(
            resolvedDisplayStage,
            game
          );
          dispatch({ type: 'serverSync', game: maskedResolvedStage });
          displayedGame = maskedResolvedStage;
        } else {
          const maskedUpdatedGame = maskExodiaOutcomeForVideo(
            { ...updatedGame, busy: true },
            game
          );
          dispatch({
            type: 'serverSync',
            game: maskedUpdatedGame
          });
          displayedGame = maskedUpdatedGame;
        }
        await new Promise((resolve) => {
          window.setTimeout(
            resolve,
            getDrawSequenceDuration(
              Math.max(updatedGame.hand.me.length, updatedGame.hand.opp.length)
            ) + 80
          );
        });
        await playPendingDestruction();
        const maskedFinalDiscardGame = maskExodiaOutcomeForVideo(
          { ...updatedGame, busy: true },
          game
        );
        dispatch({
          type: 'serverSync',
          game: maskedFinalDiscardGame
        });
        displayedGame = maskedFinalDiscardGame;
        setBurstingDestructionIds([]);
      } else {
        if (destructionZones.length && !resolvedDisplayStage)
          await playPendingDestruction();
        const nextVisibleGame = maskExodiaOutcomeForVideo(
          resolvedDisplayStage || effectiveUpdatedGame,
          game
        );
        const animatedControlTransfer = await animateControlTransfers(
          displayedGame,
          nextVisibleGame
        );
        let waitedOrichalcosSummon = false;
        if (!animatedControlTransfer) {
          const orichalcosPreBoost = (() => {
            if (!nextVisibleGame?.field) return null;
            let staged = false;
            const nextField = { ...nextVisibleGame.field };
            ['me', 'opp'].forEach((side) => {
              const fieldCard = nextVisibleGame.field[side]?.fieldZone?.[0];
              if (fieldCard?.id !== 's-the-seal-of-orichalcos' || fieldCard?.faceDown) return;
              const prevIds = new Set(
                (displayedGame?.field?.[side]?.mon || [])
                  .filter((card) => card && !card.faceDown)
                  .map((card) => card.instance_id)
              );
              const nextMon = (nextVisibleGame.field[side]?.mon || []).map((card) => {
                if (!card || card.faceDown || prevIds.has(card.instance_id)) return card;
                const numericAtk = Number(card.atk);
                if (!Number.isFinite(numericAtk)) return card;
                staged = true;
                return { ...card, atk: Math.max(0, numericAtk - 500) };
              });
              nextField[side] = { ...nextVisibleGame.field[side], mon: nextMon };
            });
            return staged ? { ...nextVisibleGame, busy: true, field: nextField } : null;
          })();
          if (orichalcosPreBoost) {
            dispatch({
              type: 'serverSync',
              game: orichalcosPreBoost
            });
            displayedGame = orichalcosPreBoost;
            waitedOrichalcosSummon = true;
            await new Promise((resolve) => {
              window.setTimeout(resolve, DUEL_SUMMON_DURATION_MS + 100);
            });
          }
          const waitForGracefulDraw = Boolean(
            !resolvedDisplayStage
            && nextVisibleGame?.pendingDecision?.type === 'discard'
          );
          const gracefulDrawnCount = waitForGracefulDraw
            ? Math.max(0, updatedGame.hand.me.length - destructionBaseline.hand.me.length)
            : 0;
          dispatch({
            type: 'serverSync',
            game: gracefulDrawnCount > 0 || sliferPreStage
              ? { ...nextVisibleGame, busy: true }
              : nextVisibleGame
          });
          displayedGame = nextVisibleGame;
          if (gracefulDrawnCount > 0) {
            await new Promise((resolve) => {
              window.setTimeout(resolve, getDrawSequenceDuration(gracefulDrawnCount) + 120);
            });
          }
        }
        if (!resolvedDisplayStage) {
          setBurstingDestructionIds([]);
          setTransientAttackLockChains([]);
          if (
            sliferPreStage
            && !waitedOrichalcosSummon
            && hasNewlySummonedMonster(destructionBaseline, effectiveUpdatedGame)
          ) {
            await new Promise((resolve) => {
              window.setTimeout(resolve, DUEL_SUMMON_DURATION_MS + 100);
            });
          }
        }
        if (resolvedDisplayStage) {
          const drawnCount = Math.max(
            0,
            updatedGame.hand.me.length - destructionBaseline.hand.me.length,
            updatedGame.hand.opp.length - destructionBaseline.hand.opp.length
          );
          const hasSummonedMonster = hasNewlySummonedMonster(
            destructionBaseline,
            effectiveUpdatedGame
          );
          const hasStatChange = ['me', 'opp'].some((side) =>
            (effectiveUpdatedGame.field?.[side]?.mon || []).some((nextMon) => {
              if (!nextMon?.instance_id || nextMon.faceDown) return false;
              const prevMon = (destructionBaseline.field?.[side]?.mon || []).find(
                (card) => card?.instance_id === nextMon.instance_id
              );
              if (!prevMon || prevMon.faceDown) return false;
              return prevMon.atk !== nextMon.atk || prevMon.def !== nextMon.def;
            })
          );
          const effectAnimationDuration = Math.max(
            getDrawSequenceDuration(drawnCount),
            hasSummonedMonster && !summonStage
              ? DUEL_SUMMON_DURATION_MS + 450
              : 0,
            hasStatChange ? 720 : 0
          );
          if (effectAnimationDuration) {
            await new Promise((resolve) => {
              window.setTimeout(resolve, effectAnimationDuration + 80);
            });
          }
          await playPendingDestruction();
          setBurstingDestructionIds([]);
          setTransientAttackLockChains([]);
          if (!playerTurnRevivedJams.length) {
            const maskedResolvedUpdated = maskExodiaOutcomeForVideo(
              { ...effectiveUpdatedGame, busy: true },
              game
            );
            dispatch({ type: 'serverSync', game: maskedResolvedUpdated });
            displayedGame = maskedResolvedUpdated;
            if (summonStage) {
              await new Promise((resolve) => {
                window.setTimeout(resolve, DUEL_SUMMON_DURATION_MS + 80);
              });
            }
          }
        }
        if (sliferPreStage) {
          await playPendingSliferTriggers(updatedGame, displayedGame);
          const afterSliferGame = maskExodiaOutcomeForVideo(
            { ...updatedGame, busy: true },
            game
          );
          dispatch({ type: 'serverSync', game: afterSliferGame });
          displayedGame = afterSliferGame;
        }
      }
      if (playerTurnRevivedJams.length) {
        const preRevivalField = {
          me: { ...updatedGame.field.me, mon: updatedGame.field.me.mon.slice() },
          opp: { ...updatedGame.field.opp, mon: updatedGame.field.opp.mon.slice() }
        };
        const revivalSummonField = {
          me: { ...updatedGame.field.me, mon: updatedGame.field.me.mon.slice() },
          opp: { ...updatedGame.field.opp, mon: updatedGame.field.opp.mon.slice() }
        };
        playerTurnRevivedJams.forEach(({ side, nextIndex, card }) => {
          preRevivalField[side].mon[nextIndex] = null;
          revivalSummonField[side].mon[nextIndex] = {
            ...card,
            _motion: `${card.instance_id}-revival-${Date.now()}-summon`
          };
        });
        dispatch({
          type: 'serverSync',
          game: { ...updatedGame, busy: true, field: preRevivalField }
        });
        await new Promise((resolve) => {
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(resolve);
          });
        });
        const revivedGame = { ...updatedGame, field: revivalSummonField };
        dispatch({ type: 'serverSync', game: revivedGame });
        displayedGame = revivedGame;
        await new Promise((resolve) => {
          window.setTimeout(resolve, DUEL_SUMMON_DURATION_MS + 80);
        });
      }
      const { instanceId: battleDefenderId, faceDown: defenderWasFaceDown } =
        getBattleDefenderState(game, action);
      if (battleDefenderId && defenderWasFaceDown) {
        const revealedCard = [
          ...updatedGame.field.opp.mon,
          ...updatedGame.grave.opp,
          ...updatedGame.banished.opp
        ].find((card) => card?.instance_id === battleDefenderId)
          || game.field.opp.mon.find(
            (card) => card?.instance_id === battleDefenderId
          );
        if (revealedCard && !revealedCard.faceDown) {
          const attackerId = action.type === 'attack'
            ? action.attacker_instance_id
            : game.pendingBattle?.attackerInstanceId;
          const attacker = game.field.me.mon.find(
            (card) => card?.instance_id === attackerId
          );
          const attackValue = attacker?.atk ?? attacker?.current_atk ?? 0;
          const defenseValue = revealedCard.def ?? revealedCard.current_def ?? 0;
          const comparison = attackValue > defenseValue
            ? '>'
            : attackValue < defenseValue ? '<' : '=';

          if (updatedGame.pendingBattle?.awaitingResolution) {
            dispatch({
              type: 'serverLog',
              message: `Quái thú úp được lật ngửa: <b>${revealedCard.name}</b> (ATK ${formatLP(revealedCard.atk ?? 0)} / DEF ${formatLP(defenseValue)}). So sánh: ATK ${formatLP(attackValue)} ${comparison} DEF ${formatLP(defenseValue)}.`
            });
          } else if (action.type === 'resolve_battle') {
            const stillOnField = updatedGame.field.opp.mon.some(
              (card) => card?.instance_id === battleDefenderId
            );
            const inGrave = updatedGame.grave.opp.some(
              (card) => card?.instance_id === battleDefenderId
            );
            const banished = updatedGame.banished.opp.some(
              (card) => card?.instance_id === battleDefenderId
            );
            const outcome = inGrave
              ? 'bị đưa vào Mộ.'
              : banished
                ? 'bị loại bỏ khỏi trận đấu.'
                : stillOnField
                  ? 'sống sót sau trận chiến.'
                  : 'rời sân sau hiệu ứng chiến đấu.';
            const playerLpLoss = Math.max(0, game.lp.me - updatedGame.lp.me);
            const damageSummary = playerLpLoss
              ? ` Bạn mất ${formatLP(playerLpLoss)} LP.`
              : '';
            dispatch({
              type: 'serverLog',
              message: `Kết quả chiến đấu với <b>${revealedCard.name}</b>: ATK ${formatLP(attackValue)} ${comparison} DEF ${formatLP(defenseValue)}; quái thú ${outcome}${damageSummary}`
            });
          }
        }
      }
    } catch (error) {
      if (
        targetFallback
        && /cần .*mục tiêu/i.test(error.message || '')
      ) {
        dispatch({
          type: 'uiBeginTarget',
          pendingEffect: targetFallback
        });
      } else {
        dispatch({
          type: 'serverError',
          message: error.message || 'Hành động không được Backend chấp nhận.',
          silent: action.type === 'advance_phase'
        });
      }
    } finally {
      actionBusyRef.current = false;
    setPendingHandPlacementId(null);
      dispatch({ type: 'serverBusy', busy: false });
    }
  }

  sendServerActionRef.current = sendServerAction;

  useEffect(() => {
    if (
      !matchId
      || !game?.authoritative
      || game.over
      || game.turn !== 'me'
      || game.busy
      || game.pendingBattle?.awaitingResolution
      || game.pendingDecision
      || game.pendingEffect
      || game.chain?.status !== 'closed'
      || ![0, 1, 5].includes(game.phaseIndex)
    ) return undefined;

    const phaseKey = `${matchId}:${game.turnCount}:${game.phaseIndex}`;
    if (autoPhaseTransitionRef.current === phaseKey) return undefined;
    const phaseDelay = game.phaseIndex === 0
      ? (game.drawnThisTurn ? getDrawSequenceDuration(1) + 80 : 0)
      : game.phaseIndex === 5
        ? 180
        : 500;
    return scheduleAutoPhaseAdvance({
      delay: phaseDelay,
      isActionBusy: () => actionBusyRef.current,
      advance: () => {
        if (autoPhaseTransitionRef.current === phaseKey) return;
        autoPhaseTransitionRef.current = phaseKey;
        sendServerActionRef.current?.({ type: 'advance_phase' });
      }
    });
  }, [
    matchId,
    game?.authoritative,
    game?.over,
    game?.turn,
    game?.busy,
    game?.pendingBattle?.awaitingResolution,
    game?.pendingDecision,
    game?.pendingEffect,
    game?.chain?.status,
    game?.phaseIndex,
    game?.turnCount
  ]);

  useEffect(() => {
    if (!game?.pendingBattle?.awaitingResolution) return undefined;
    const timeout = window.setTimeout(
      () => sendServerAction({ type: 'resolve_battle' }),
      2200
    );
    return () => window.clearTimeout(timeout);
  }, [
    matchId,
    game?.pendingBattle?.awaitingResolution,
    game?.pendingBattle?.attackerInstanceId,
    game?.pendingBattle?.defenderInstanceId
  ]);

  function getEffectTargetFallback(sourceInstanceId) {
    const card = [
      ...game.hand.me,
      ...game.field.me.st,
      ...game.field.me.mon
    ].find((candidate) => candidate?.instance_id === sourceInstanceId);
    const targetMode = getTargetMode(card);
    return {
      sourceInstanceId,
      card,
      targetMode,
      singleTarget: targetMode === 'friendly-monster'
        || (targetMode === 'field-opponent-monster' && card?.id !== 'm-lava-golem'),
      ...(card?.id === 'm-blue-eyes-alternative-white-dragon'
        ? { minTargets: 1, maxTargets: 1 }
        : {}),
      ...(card?.id === 'm-lava-golem'
        ? { minTargets: 2, maxTargets: 2 }
        : {}),
      ...(targetMode === 'friendly-monster'
        ? { minTargets: 1, maxTargets: 1 }
        : {}),
      ...(targetMode === 'field-spell-trap'
        ? { minTargets: 1, maxTargets: 2 }
        : {}),
      ...(targetMode === 'field-opponent-spell-trap'
        ? { minTargets: 1, maxTargets: 2 }
        : {})
    };
  }

  function activateEffect(sourceInstanceId, effectId = 'activate', targetInstanceIds = []) {
    const targetFallback = getEffectTargetFallback(sourceInstanceId);
    if (targetFallback.card?.id === 't-graverobber' && !targetInstanceIds.length) {
      if (!game.grave.opp.some((card) => card?.instance_id)) {
        dispatch({
          type: 'serverError',
          message: 'Mộ đối thủ không có lá bài để chọn; không thể kích hoạt Kẻ Trộm Mộ.'
        });
        return;
      }
      dispatch({
        type: 'uiBeginTarget',
        pendingEffect: targetFallback
      });
      return;
    }

    sendServerAction(
      {
        type: 'activate_effect',
        source_instance_id: sourceInstanceId,
        effect_id: effectId,
        target_instance_ids: targetInstanceIds
      },
      targetFallback
    );
  }

  function activateSpellFromHand(card, zoneIndex = null) {
    if (!card) return;
    const zonePayload = Number.isInteger(zoneIndex) ? { zone_index: zoneIndex } : {};
    if (EQUIP_SPELL_CARD_IDS.has(card.id)) {
      dispatch({
        type: 'serverError',
        message: 'Kéo lá Trang bị từ tay tới một quái thú ngửa hợp lệ.'
      });
      return;
    }
    if (HAND_TARGET_DRAG_SPELL_IDS.has(card.id)) {
      dispatch({
        type: 'serverError',
        message: 'Kéo lá bài từ tay tới một quái thú đối thủ hợp lệ.'
      });
      return;
    }
    if (['s-change-of-heart', 's-brain-control'].includes(card.id)) {
      const hasTarget = card.id === 's-brain-control'
        ? hasFaceUpOpponentMonster(game)
        : game.field.opp.mon.some(Boolean);
      if (!hasTarget) {
        dispatch({
          type: 'serverError',
          message: card.id === 's-brain-control'
            ? 'Tẩy Não chỉ có thể kích hoạt khi đối thủ có quái thú ngửa trên sân.'
            : 'Trái Tim Hoán Đổi chỉ có thể kích hoạt khi đối thủ có quái thú trên sân.'
        });
        return;
      }
      if (!game.field.me.mon.some((monster) => !monster)) {
        dispatch({
          type: 'serverError',
          message: `${card.name} cần một ô Quái thú trống trên sân của bạn.`
        });
        return;
      }
    }
    if (
      card.id === 's-twin-twisters'
      && !game.field.opp.st.some((opponentCard) => opponentCard?.instance_id)
    ) {
      dispatch({
        type: 'serverError',
        message: 'Song Bão chỉ có thể kích hoạt khi đối thủ có Lá Phép/Bẫy trên sân.'
      });
      return;
    }
    if (card.id === 's-the-seal-of-orichalcos' && orichalcosActive) {
      dispatch({
        type: 'serverError',
        message: 'Phong Ấn Orichalcos đã được kích hoạt trong trận đấu này.'
      });
      return;
    }
    if (card.id === 's-lightning-storm') {
      dispatch({ type: 'uiClearSelection' });
      setLightningStormChoiceSourceId(card.instance_id);
      return;
    }
    if (['s-spell-reproduction', 's-magical-stone-excavation'].includes(card.id)) {
      setPendingHandPlacementId(card.instance_id);
      sendServerAction({
        type: 'begin_spell_recovery',
        source_instance_id: card.instance_id,
        ...zonePayload
      });
      return;
    }
    setPendingHandPlacementId(card.instance_id);
    sendServerAction(
      {
        type: 'activate_effect',
        source_instance_id: card.instance_id,
        ...zonePayload
      },
      getEffectTargetFallback(card.instance_id)
    );
  }

  function playSelectedCard(kind, index) {
    const card = game.hand.me[game.selected];
    if (!card) return;
    if (kind === 'mon' && card.type === 'monster') {
      if (card.id === 'm-burning-dragon') {
        sendServerAction({
          type: 'activate_effect',
          source_instance_id: card.instance_id
        });
        return;
      }
      if (card.id === VALKYRION_ID) {
        dispatch({
          type: 'serverError',
          message: 'Chiến Binh Kim Loại chỉ có thể được Triệu hồi Đặc biệt bằng hiệu ứng riêng.'
        });
        return;
      }
      if (!isMainPhase(game.phaseIndex)) {
        dispatch({
          type: 'serverError',
          message: 'Chỉ có thể Triệu hồi quái thú trong Main Phase 1 hoặc Main Phase 2.'
        });
        return;
      }
      const tributeInstanceIds = getRequiredTributes(card) > 0
        ? game.selectedTributes
          .map((tributeIndex) => game.field.me.mon[tributeIndex]?.instance_id)
          .filter(Boolean)
        : [];
      const setMonster = game.selectedPosition === 'defense';
      sendServerAction({
        type: setMonster ? 'set_card' : 'summon',
        instance_id: card.instance_id,
        zone_index: index,
        ...(setMonster ? {} : { position: 'attack' }),
        tribute_instance_ids: tributeInstanceIds
      });
      return;
    }
    if (kind === 'st' && card.type === 'trap') {
      sendServerAction({
        type: 'set_card',
        instance_id: card.instance_id,
        zone_index: index
      });
      return;
    }
    if (kind === 'st' && card.type === 'spell') {
      activateSpellFromHand(card);
      return;
    }
    dispatch({
      type: 'serverError',
      message: 'Chỉ có thể đặt quái thú ở Monster Zone và Bẫy ở Spell/Trap Zone.'
    });
  }

  function handleZoneAction({ who, kind, index }) {
    if (
      !game?.authoritative
      || game.busy
      || game.over
      || game.pendingBattle?.awaitingResolution
    ) return;
    const card = game.field[who][kind][index];
    if (game.effectMode === 'targeted-effect' && game.pendingEffect) {
      if (game.pendingEffect.card?.id === 's-dicephoon') {
        const isValidTarget = (
          game.pendingEffect.targetMode === 'field-opponent-spell-trap'
          && who === 'opp'
          && kind === 'st'
          && Boolean(card?.instance_id)
        ) || (
          game.pendingEffect.targetMode === 'field-opponent-monster'
          && who === 'opp'
          && kind === 'mon'
          && Boolean(card?.instance_id)
        );
        if (!isValidTarget) return;
        const alreadySelected = game.selectedTargets.includes(card.instance_id);
        const nextTargets = alreadySelected
          ? game.selectedTargets.filter((id) => id !== card.instance_id)
          : [...game.selectedTargets, card.instance_id];
        dispatch({ type: 'uiToggleTarget', instanceId: card.instance_id });
        const maxTargets = game.pendingEffect.maxTargets ?? 1;
        if (!alreadySelected && nextTargets.length >= maxTargets) {
          handleAction({
            type: 'resolveSelectedEffect',
            targetInstanceIds: nextTargets
          });
        }
        return;
      }
      if (DRAGGABLE_EFFECT_TARGET_MODES.has(game.pendingEffect.targetMode)) return;
      if (game.pendingEffect.targetMode === 'field-opponent-spell-trap') {
        if (who !== 'opp' || kind !== 'st' || !card?.instance_id) return;
        dispatch({ type: 'uiToggleTarget', instanceId: card.instance_id });
        return;
      }
      if (game.pendingEffect.targetMode === 'field-opponent-monster') {
        if (who !== 'opp' || kind !== 'mon' || !card?.instance_id) return;
        if (
          game.pendingEffect.card?.id === 's-brain-control'
          && card.faceDown
        ) {
          dispatch({
            type: 'serverError',
            message: 'Tẩy Não chỉ có thể chọn quái thú ngửa của đối thủ.'
          });
          return;
        }
        if (
          game.pendingEffect.card?.id === 's-brain-control'
          && !game.field.me.mon.some((monster) => !monster)
        ) {
          dispatch({
            type: 'serverError',
            message: 'Tẩy Não cần một ô Quái thú trống trên sân của bạn.'
          });
          return;
        }
        dispatch({ type: 'uiToggleTarget', instanceId: card.instance_id });
        return;
      }
      if (game.pendingEffect.targetMode === 'clone-dragon-field-monster') {
        const eligibleIds = game.pendingDecision?.eligible_target_instance_ids;
        if (
          kind !== 'mon'
          || !card?.instance_id
          || card.faceDown
          || !eligibleIds?.includes(card.instance_id)
        ) return;
        dispatch({ type: 'uiToggleTarget', instanceId: card.instance_id });
        return;
      }
      if (game.pendingEffect.targetMode === 'hand-spellcaster') return;
      if (
        game.pendingEffect.targetMode === 'field-spell-trap'
        && (kind !== 'st' || !card?.instance_id)
      ) return;
      if (
        ['field-card', 'field-card-any'].includes(game.pendingEffect.targetMode)
        && (
          !['mon', 'st'].includes(kind)
          || !card?.instance_id
          || (game.pendingEffect.targetSide && who !== game.pendingEffect.targetSide)
        )
      ) return;
      if (
        game.pendingEffect.targetMode === 'friendly-monster'
        && (who !== 'me' || kind !== 'mon' || !card)
      ) return;
      if (
        game.pendingEffect.card?.id === 's-multiply'
        && (card.id !== 'm-kuriboh' || card.faceDown)
      ) return;
      const unionRule = getUnionRule(game.pendingEffect.card);
      if (
        unionRule
        && (
          who !== 'me'
          || kind !== 'mon'
          || !unionRule.targetIds.includes(card?.id)
          || card.faceDown
        )
      ) return;
      if (card?.instance_id) {
        dispatch({ type: 'uiToggleTarget', instanceId: card.instance_id });
      }
      return;
    }
    if (game.chain?.status === 'open') {
      if (who === 'me' && card?.instance_id) {
        const response = game.chain.response_options?.find(
          (option) => option.source_instance_id === card.instance_id
            && !option.target_instance_ids?.length
        );
        if (response) {
          activateEffect(
            response.source_instance_id,
            response.effect_id,
            response.target_instance_ids || []
          );
        }
      }
      return;
    }

    if (game.phaseIndex === 3) return;

    if (game.turn !== 'me') return;
    if (who === 'me' && kind === 'mon') {
      if (monsterDropChoice) {
        const requiredTributes = getRequiredTributes(monsterDropChoice.card);
        if (card && requiredTributes > 0) {
          setMonsterDropChoice((prev) => {
            if (!prev) return prev;
            const current = prev.tributeIndexes || [];
            if (current.includes(index)) {
              return {
                ...prev,
                tributeIndexes: current.filter((slotIndex) => slotIndex !== index)
              };
            }
            if (current.length >= requiredTributes) return prev;
            return {
              ...prev,
              tributeIndexes: [...current, index]
            };
          });
        }
        return;
      }
      if (card?.faceDown) {
        sendServerAction({
          type: 'flip_summon',
          instance_id: card.instance_id
        });
        return;
      }
      if (card) {
        dispatch({ type: 'uiToggleTribute', index });
        return;
      }
      if (!card && game.selected !== null && game.hand.me[game.selected]?.type !== 'monster') {
        playSelectedCard(kind, index);
      }
      return;
    }

    if (who === 'me' && kind === 'st') {
      if (
        card?.faceDown
        && (card.type === 'trap' || (card.type === 'spell' && card.spellType === 'Tức Thời'))
      ) {
        activateEffect(card.instance_id);
      } else if (!card && game.selected !== null) {
        playSelectedCard(kind, index);
      }
    }
  }

  function handleAction(action) {
    if (!game?.authoritative) return;
    if (
      game.pendingBattle?.awaitingResolution
      && !['resolveBattle', 'toggleLog'].includes(action.type)
    ) return;
    if (action.type === 'toggleLog') {
      dispatch(action);
      return;
    }
    if (action.type === 'toggleSummonPosition') {
      const card = game.hand.me[game.selected];
      if (card?.type === 'monster' && isMainPhase(game.phaseIndex)) {
        dispatch({
          type: 'uiSetSummonPosition',
          position: game.selectedPosition === 'attack' ? 'defense' : 'attack'
        });
      }
      return;
    }
    if (action.type === 'select') {
      const card = game.hand.me[action.index];
      if (!card) return;
      if (game.pendingEffect?.targetMode === 'hand-spellcaster') {
        if (
          card.type !== 'monster'
          && card.type !== 'fusion'
        ) return;
        if (!/spellcaster|phù thủy/i.test(card.race || card.monsterType || '')) return;
        dispatch({ type: 'uiToggleTarget', instanceId: card.instance_id });
        return;
      }
      if (game.effectMode === 'discard-for-effect') {
        if (
          ['tricky_discard', 'spell_recovery_discard', 'twin_twisters_discard', 'burning_dragon_discard'].includes(game.pendingDecision?.type)
          && card.instance_id === game.pendingDecision.source_instance_id
        ) return;
        if (
          game.pendingDecision?.discard_category
          && card.type !== game.pendingDecision.discard_category
        ) return;
        const nextIds = game.pendingDiscardIds.includes(card.instance_id)
          ? game.pendingDiscardIds.filter((id) => id !== card.instance_id)
          : [...game.pendingDiscardIds, card.instance_id];
        dispatch({ type: 'uiDiscardSelection', instanceId: card.instance_id });
        if (nextIds.length === game.pendingDiscardCount) {
          sendServerAction({
            type: 'complete_discard',
            instance_ids: nextIds
          });
        }
        return;
      }
      if (game.phaseIndex === 5 && game.hand.me.length > MAX_END_PHASE_HAND_SIZE) {
        sendServerAction({
          type: 'discard',
          instance_id: card.instance_id
        });
        return;
      }
      dispatch(action);
      return;
    }
    if (action.type === 'lightningStormEffect') {
      const card = game.hand.me[action.index];
      if (
        card?.id === 's-lightning-storm'
        && ['destroy_attack_monsters', 'destroy_spell_traps'].includes(action.mode)
        && !game.busy
        && !game.over
        && game.turn === 'me'
        && isMainPhase(game.phaseIndex)
        && game.chain?.status === 'closed'
        && !game.pendingEffect
      ) {
        sendServerAction({
          type: 'activate_effect',
          source_instance_id: card.instance_id,
          payload: { mode: action.mode }
        });
      }
      return;
    }
    if (action.type === 'theTrickyEffect') {
      const card = game.hand.me[action.index];
      if (
        card?.id === 'm-the-tricky'
        && !game.busy
        && !game.over
        && !game.pendingDecision
        && !game.pendingEffect
        && !game.pendingBattle?.awaitingResolution
        && game.turn === 'me'
        && isMainPhase(game.phaseIndex)
        && game.chain?.status === 'closed'
        && game.hand.me.length > 1
        && game.field.me.mon.some((fieldCard) => !fieldCard)
      ) {
        sendServerAction({
          type: 'begin_tricky_summon',
          source_instance_id: card.instance_id
        });
      }
      return;
    }
    if (action.type === 'lavaGolemEffect') {
      const card = game.hand.me[action.index];
      if (
        card?.id === 'm-lava-golem'
        && game.field.opp.mon.filter(Boolean).length >= 2
        && !game.busy
        && !game.over
        && game.turn === 'me'
        && isMainPhase(game.phaseIndex)
        && game.chain?.status === 'closed'
        && !game.pendingEffect
      ) {
        dispatch({
          type: 'uiBeginTarget',
          pendingEffect: {
            sourceInstanceId: card.instance_id,
            card,
            targetMode: 'field-opponent-monster',
            minTargets: 2,
            maxTargets: 2
          }
        });
      }
      return;
    }
    if (action.type === 'valkyrionSummon') {
      const card = game.hand.me[action.index];
      if (
        canSummonValkyrionFromHand(game, card)
        && !game.busy
        && !game.over
        && game.turn === 'me'
        && isMainPhase(game.phaseIndex)
        && game.chain?.status === 'closed'
        && !game.pendingEffect
      ) {
        dispatch({
          type: 'uiBeginTarget',
          pendingEffect: {
            sourceInstanceId: card.instance_id,
            card,
            targetMode: 'valkyrion-tributes',
            minTargets: 3,
            maxTargets: 3
          }
        });
      }
      return;
    }
    if (action.type === 'valkyrionSplitEffect') {
      const card = game.field.me.mon[action.index];
      if (
        canSplitValkyrion(game, card)
        && !game.busy
        && !game.over
        && game.turn === 'me'
        && isMainPhase(game.phaseIndex)
        && game.chain?.status === 'closed'
        && !game.pendingEffect
      ) {
        dispatch({
          type: 'uiBeginTarget',
          pendingEffect: {
            sourceInstanceId: card.instance_id,
            card,
            targetMode: 'grave-valkyrion',
            minTargets: 3,
            maxTargets: 3
          }
        });
      }
      return;
    }
    if (action.type === 'blizzardDragonEffect') {
      const card = game.field.me.mon[action.index];
      if (
        card?.id === 'm-blizzard-dragon'
        && !card.faceDown
        && !game.busy
        && !game.over
        && game.turn === 'me'
        && [2, 4].includes(game.phaseIndex)
      ) {
        const oppMonsters = (game.field.opp.mon || []).filter(Boolean);
        if (!oppMonsters.length) {
          dispatch({
            type: 'serverError',
            message: 'Đối thủ chưa có quái thú trên sân để chọn.'
          });
          return;
        }
        setBlizzardPromptSourceId(card.instance_id);
        setBlizzardTargetSelection('');
      }
      return;
    }
    if (action.type === 'zone') {
      handleZoneAction(action);
      return;
    }
    if (action.type === 'advancePhase') {
      sendServerAction({ type: 'advance_phase' });
      return;
    }
    if (action.type === 'draw') {
      sendServerAction({ type: 'draw' });
      return;
    }
    if (action.type === 'changePosition') {
      const card = game.field.me.mon[action.index];
      if (card) sendServerAction({
        type: 'change_position',
        instance_id: card.instance_id
      });
      return;
    }
    if (action.type === 'raBoost') {
      const card = game.field.me.mon[action.index];
      if (card) activateEffect(card.instance_id);
      return;
    }
    if (action.type === 'kaibamanEffect') {
      const card = game.field.me.mon[action.index];
      if (
        card?.id === 'm-kaibaman'
        && !card.faceDown
        && !game.busy
        && !game.over
        && game.turn === 'me'
        && [2, 4].includes(game.phaseIndex)
      ) {
        activateEffect(card.instance_id);
      }
      return;
    }
    if (action.type === 'catapultTurtleEffect') {
      const card = game.field.me.mon[action.index];
      if (
        card?.id === 'm-catapult-turtle'
        && !card.faceDown
        && !game.busy
        && !game.over
        && game.turn === 'me'
        && [2, 4].includes(game.phaseIndex)
      ) {
        dispatch({
          type: 'uiBeginTarget',
          pendingEffect: {
            sourceInstanceId: card.instance_id,
            card,
            targetMode: 'friendly-monster',
            minTargets: 1,
            maxTargets: 1,
            singleTarget: true
          }
        });
      }
      return;
    }
    if (action.type === 'gandoraEffect') {
      const card = game.field.me.mon[action.index];
      if (
        card?.id === 'm-gandora-the-dragon-of-destruction'
        && !card.faceDown
        && !game.busy
        && !game.over
        && game.turn === 'me'
        && [2, 4].includes(game.phaseIndex)
      ) {
        activateEffect(card.instance_id);
      }
      return;
    }
    if (action.type === 'timeWizardEffect') {
      const card = game.field.me.mon[action.index];
      if (
        card?.id === 'm-time-wizard'
        && !card.faceDown
        && !game.busy
        && !game.over
        && game.turn === 'me'
        && isMainPhase(game.phaseIndex)
        && game.chain?.status === 'closed'
        && !game.pendingEffect
      ) {
        sendServerAction({
          type: 'activate_effect',
          source_instance_id: card.instance_id
        });
      }
      return;
    }
    if (action.type === 'blueEyesAlternativeEffect') {
      const card = game.field.me.mon[action.index];
      if (
        card?.id === 'm-blue-eyes-alternative-white-dragon'
        && !card.faceDown
        && game.field.opp.mon.some(Boolean)
        && !game.busy
        && !game.over
        && game.turn === 'me'
        && isMainPhase(game.phaseIndex)
        && game.chain?.status === 'closed'
        && !game.pendingEffect
      ) {
        activateEffect(card.instance_id);
      }
      return;
    }
    if (action.type === 'maidenQuickEffect') {
      const card = game.field.me.mon.find(
        (candidate) => candidate?.instance_id === action.sourceInstanceId
      );
      const lastLink = game.chain?.links?.[game.chain.links.length - 1];
      if (
        card?.id === 'm-maiden-with-eyes-of-blue'
        && !card.faceDown
        && !game.maidenEffectUsed
        && lastLink?.player === 'ai'
        && lastLink.target_instance_ids?.includes(card.instance_id)
        && !game.busy
        && !game.over
        && game.chain?.status === 'open'
        && game.chain.priority_player === 'player'
      ) {
        sendServerAction({
          type: 'activate_effect',
          source_instance_id: card.instance_id,
          effect_id: 'quick_summon'
        });
      }
      return;
    }
    if (action.type === 'maidenAttackEffect') {
      sendServerAction({ type: 'maiden_attack_effect' });
      return;
    }
    if (action.type === 'skipMaidenAttackEffect') {
      sendServerAction({ type: 'skip_maiden_attack_effect' });
      return;
    }
    if (action.type === 'activateCloning') {
      sendServerAction({ type: 'activate_cloning' });
      return;
    }
    if (action.type === 'skipCloning') {
      sendServerAction({ type: 'skip_cloning' });
      return;
    }
    if (action.type === 'whiteStoneRecover') {
      const source = game.grave.me.find(
        (card) => card?.instance_id === action.sourceInstanceId
      );
      if (
        source?.id === 'm-the-white-stone-of-ancients'
        && game.grave.me.some((card) => card?.id === 'm-blue-eyes-white-dragon')
        && !game.whiteStoneEffectUsed
        && !game.busy
        && !game.over
        && game.turn === 'me'
        && isMainPhase(game.phaseIndex)
        && game.chain?.status === 'closed'
        && !game.pendingEffect
      ) {
        dispatch({
          type: 'uiBeginTarget',
          pendingEffect: {
            sourceInstanceId: source.instance_id,
            card: source,
            player: 'me',
            effectId: 'grave_recover',
            targetMode: 'grave-white-stone',
            minTargets: 1,
            maxTargets: 1,
            singleTarget: true
          }
        });
      }
      return;
    }
    if (action.type === 'kaiserVorseEffect') {
      const card = game.hand.me[action.index];
      if (
        card?.id === 'm-kaiser-vorse-raider'
        && !game.busy
        && !game.over
        && game.turn === 'me'
        && isMainPhase(game.phaseIndex)
        && game.chain?.status === 'closed'
        && !game.pendingEffect
        && !game.field.me.mon.some(Boolean)
      ) {
        sendServerAction({
          type: 'special_summon_kaiser_vorse',
          source_instance_id: card.instance_id
        });
      }
      return;
    }
    if (action.type === 'blueEyesAlternativeSummon') {
      const card = game.hand.me[action.index];
      if (
        card?.id === 'm-blue-eyes-alternative-white-dragon'
        && game.hand.me.some((handCard) =>
          handCard.id === 'm-blue-eyes-white-dragon'
          && handCard.instance_id !== card.instance_id
        )
        && game.field.me.mon.some((fieldCard) => !fieldCard)
        && !game.busy
        && !game.over
        && game.turn === 'me'
        && isMainPhase(game.phaseIndex)
        && game.chain?.status === 'closed'
        && !game.pendingEffect
      ) {
        sendServerAction({
          type: 'special_summon_blue_eyes_alternative',
          source_instance_id: card.instance_id
        });
      }
      return;
    }
    if (action.type === 'chaosEmperorSummon') {
      const card = game.hand.me[action.index];
      if (
        canSummonChaosEmperorFromHand(game, card)
        && !game.busy
        && !game.over
        && game.turn === 'me'
        && isMainPhase(game.phaseIndex)
        && game.chain?.status === 'closed'
        && !game.pendingEffect
      ) {
        dispatch({
          type: 'uiBeginTarget',
          pendingEffect: {
            sourceInstanceId: card.instance_id,
            card,
            targetMode: 'grave-chaos-emperor',
            minTargets: 2,
            maxTargets: 2
          }
        });
      }
      return;
    }
    if (action.type === 'unionEquip') {
      const sourceInstanceId = action.sourceInstanceId;
      const card = [...game.hand.me, ...game.field.me.mon].find(
        (candidate) => candidate?.instance_id === sourceInstanceId
      );
      if (
        canEquipUnionMonster(game, card)
        && !game.busy
        && !game.over
        && game.turn === 'me'
        && isMainPhase(game.phaseIndex)
        && game.chain?.status === 'closed'
        && !game.pendingEffect
      ) {
        dispatch({
          type: 'uiBeginTarget',
          pendingEffect: {
            sourceInstanceId,
            card,
            targetMode: 'field-card',
            targetSide: 'me',
            minTargets: 1,
            maxTargets: 1,
            unionMode: 'equip'
          }
        });
      }
      return;
    }
    if (action.type === 'unionDetach') {
      const sourceInstanceId = action.sourceInstanceId;
      const card = game.field.me.st.find(
        (candidate) => candidate?.instance_id === sourceInstanceId
      );
      if (
        canDetachUnionMonster(game, card)
        && !game.busy
        && !game.over
        && game.turn === 'me'
        && isMainPhase(game.phaseIndex)
        && game.chain?.status === 'closed'
        && !game.pendingEffect
      ) {
        sendServerAction({
          type: 'union_effect',
          mode: 'detach',
          source_instance_id: sourceInstanceId
        });
      }
      return;
    }
    if (action.type === 'levianeerSummon') {
      const card = game.hand.me[action.index];
      if (
        canSummonLevianeerFromHand(game, card)
        && !game.busy
        && !game.over
        && game.turn === 'me'
        && isMainPhase(game.phaseIndex)
        && game.chain?.status === 'closed'
        && !game.pendingEffect
      ) {
        dispatch({
          type: 'uiBeginTarget',
          pendingEffect: {
            sourceInstanceId: card.instance_id,
            card,
            targetMode: 'grave-levianeer',
            minTargets: 2,
            maxTargets: 2
          }
        });
      }
      return;
    }
    if (action.type === 'cancelEffect') {
      if (game.pendingDecision) return;
      dispatch({ type: 'uiCancelTarget' });
      return;
    }
    if (action.type === 'resolveSelectedEffect') {
      const targetInstanceIds = Array.isArray(action.targetInstanceIds)
        ? action.targetInstanceIds
        : game.selectedTargets;
      if (
        ['select_field_cards', 'select_deck_card', 'select_blue_eyes_summon'].includes(
          game.pendingDecision?.type
        )
      ) {
        sendServerAction({
          type: 'complete_card_selection',
          instance_ids: targetInstanceIds
        });
        return;
      }
      if (!game.pendingEffect?.sourceInstanceId || !targetInstanceIds.length) return;
      if (game.pendingEffect.targetMode === 'valkyrion-tributes') {
        sendServerAction({
          type: 'special_summon_valkyrion',
          source_instance_id: game.pendingEffect.sourceInstanceId,
          tribute_instance_ids: targetInstanceIds
        });
        return;
      }
      if (game.pendingEffect.targetMode === 'grave-valkyrion') {
        sendServerAction({
          type: 'split_valkyrion',
          source_instance_id: game.pendingEffect.sourceInstanceId,
          material_instance_ids: targetInstanceIds
        });
        return;
      }
      if (game.pendingEffect.targetMode === 'grave-chaos-emperor') {
        sendServerAction({
          type: 'special_summon_chaos_emperor',
          source_instance_id: game.pendingEffect.sourceInstanceId,
          tribute_instance_ids: targetInstanceIds
        });
        return;
      }
      if (game.pendingEffect.targetMode === 'grave-levianeer') {
        sendServerAction({
          type: 'special_summon_levianeer',
          source_instance_id: game.pendingEffect.sourceInstanceId,
          tribute_instance_ids: targetInstanceIds
        });
        return;
      }
      if (game.pendingEffect.unionMode === 'equip') {
        sendServerAction({
          type: 'union_effect',
          mode: 'equip',
          source_instance_id: game.pendingEffect.sourceInstanceId,
          target_instance_id: targetInstanceIds[0]
        });
        return;
      }
      if (game.pendingEffect.card?.id === 'm-lava-golem') {
        sendServerAction({
          type: 'special_summon_lava_golem',
          source_instance_id: game.pendingEffect.sourceInstanceId,
          tribute_instance_ids: targetInstanceIds
        });
        return;
      }
      sendServerAction({
        type: 'activate_effect',
        source_instance_id: game.pendingEffect.sourceInstanceId,
        ...(game.pendingEffect.effectId
          ? { effect_id: game.pendingEffect.effectId }
          : {}),
        target_instance_ids: targetInstanceIds
      });
      return;
    }
    if (action.type === 'resolveEffectChoice') {
      const { owner, index } = action.target;
      const target = game.grave[owner]?.[index];
      if (target?.instance_id && game.pendingEffect?.sourceInstanceId) {
        if (game.pendingDecision?.type === 'select_graveyard_card') {
          sendServerAction({
            type: 'complete_card_selection',
            instance_ids: [target.instance_id]
          });
          return;
        }
        sendServerAction({
          type: 'activate_effect',
          source_instance_id: game.pendingEffect.sourceInstanceId,
          ...(game.pendingEffect.effectId
            ? { effect_id: game.pendingEffect.effectId }
            : {}),
          target_instance_ids: [target.instance_id]
        });
      }
      return;
    }
    if (action.type === 'passChain') {
      sendServerAction({ type: 'pass_chain' });
      return;
    }
    if (action.type === 'resolveBattle') {
      sendServerAction({ type: 'resolve_battle' });
      return;
    }
    if (action.type === 'autoPlace') {
      dispatch({
        type: 'serverError',
        message: 'Đặt bài tự động chưa được hỗ trợ; hãy chọn bài và ô đặt cụ thể.'
      });
    }
  }

  function renderZone(who, kind, index) {
    const zoneKey = `${who}-${kind}-${index}`;
    const card = game?.field[who][kind][index];
    const category = String(card?.category || card?.type || '').toLowerCase();
    const isFaceUpMonster = Boolean(
      kind === 'mon'
      && card
      && !card.faceDown
      && ['monster', 'fusion'].includes(category)
    );
    const isAttackTarget = Boolean(
      attackDrag?.targetZoneKey === zoneKey
      || aiAttackArrow?.targetZoneKey === zoneKey
      || aiEquipTargetZoneKey === zoneKey
    );
    const isSelected = Boolean(
      card?.instance_id
      && game?.selectedTargets.includes(card.instance_id)
    ) || Boolean(
      who === 'me'
      && kind === 'mon'
      && (
        game?.selectedTributes.includes(index)
        || monsterDropChoice?.tributeIndexes?.includes(index)
      )
    );
    const isEffectSource = Boolean(
      game?.effectMode === 'targeted-effect'
      && DRAGGABLE_EFFECT_TARGET_MODES.has(game.pendingEffect?.targetMode)
      && game.pendingEffect.sourceInstanceId
      && card?.instance_id
      && card?.instance_id === game.pendingEffect.sourceInstanceId
    );
    const canDragAttack = Boolean(
      who === 'me'
      && kind === 'mon'
      && card
      && game?.turn === 'me'
      && game.phaseIndex === 3
      && !game.busy
      && !game.over
      && !game.pendingBattle?.awaitingResolution
      && !game.pendingEffect
      && game.chain?.status === 'closed'
      && !game.attacked.me.includes(card.instance_id)
      && getLegalActions(game).some((action) =>
        action.type === 'attack' && action.attackerIndex === index
      )
    );
    const actionType = card ? getFieldMonsterActionType(card) : 'changePosition';
    const canDragPositionChange = Boolean(
      isFaceUpMonster
      && who === 'me'
      && kind === 'mon'
      && canMonsterChangeBattlePosition(card)
    );
    const canChangePosition = Boolean(
      isFaceUpMonster
      && who === 'me'
      && game?.turn === 'me'
      && [2, 4].includes(game?.phaseIndex)
      && !game?.busy
      && !game?.pendingEffect
      && game?.chain?.status === 'closed'
      && card.id !== 'm-time-wizard'
      && actionType !== 'changePosition'
    );
    const handleFieldCardClick = (event) => {
      event.stopPropagation();
      const canInspect = who === 'me' || !card.faceDown;
      if (!canInspect) {
        handleZoneAction({ who, kind, index });
        return;
      }
      const isMainPhaseActive = (
        who === 'me'
        && game?.turn === 'me'
        && [2, 4].includes(game?.phaseIndex)
        && !game?.busy
        && !game?.over
        && !game?.pendingBattle?.awaitingResolution
      );
      const canFlipSummonFaceDownMonster = Boolean(
        isMainPhaseActive
        && kind === 'mon'
        && card?.faceDown
      );
      const needsGameAction = Boolean(
        game?.effectMode === 'targeted-effect'
        || game?.chain?.status === 'open'
        || canFlipSummonFaceDownMonster
      );
      if (needsGameAction) handleZoneAction({ who, kind, index });
      else openCardPreview(card);
    };
    const handleMonsterArtworkClick = (event) => {
      event.stopPropagation();
      const needsGameAction = Boolean(
        game?.effectMode === 'targeted-effect'
        || game?.chain?.status === 'open'
        || (
          who === 'me'
          && game?.turn === 'me'
          && game?.selected !== null
          && [2, 4].includes(game?.phaseIndex)
        )
      );
      if (needsGameAction) handleZoneAction({ who, kind, index });
      else openCardPreview(card);
    };
    const handleMonsterActionClick = (event) => {
      event.stopPropagation();
      handleAction({ type: actionType, index });
    };
    const isMonsterDropTarget = Boolean(
      who === 'me'
      && kind === 'mon'
      && attackDrag?.kind === 'monster-place'
      && isValidMonsterDropIndex(index, attackDrag.card)
    );
    const hasMonsterDropChoice = Boolean(
      who === 'me'
      && kind === 'mon'
      && monsterDropChoice?.zoneIndex === index
    );
    const isSpellDropTarget = Boolean(
      who === 'me'
      && kind === 'st'
      && !card
      && attackDrag?.kind === 'spell-trap-place'
      && attackDrag?.card?.id !== 's-the-seal-of-orichalcos'
    );
    const hasSpellDropChoice = Boolean(
      who === 'me'
      && kind === 'st'
      && !card
      && spellDropChoice?.zoneIndex === index
    );
    const isZoneHovered = (game?.selected != null && hoveredZone === zoneKey)
      || isSpellDropTarget
      || isMonsterDropTarget
      || hasMonsterDropChoice;
    return (
      <div
        key={zoneKey}
        className={`zone${kind === 'st' ? ' zone--st' : ' zone--mon'}${isZoneHovered ? ' is-hover' : ''}${isAttackTarget ? ' is-attack-target' : ''}${isEffectSource ? ' is-effect-source' : ''}`}
        data-zone={zoneKey}
        data-occupied={card ? '1' : '0'}
        data-card-instance-id={card?.instance_id || undefined}
        onPointerDown={(event) =>
          handleAttackPointerDown(event, who, kind, index, card)
        }
        onClick={(event) => {
          handleAction({ type: 'zone', who, kind, index });
        }}
        onDoubleClick={() => {
          if (who !== 'me' || kind !== 'mon' || !card) return;
          if (![2, 4].includes(game?.phaseIndex)) return;
          if (card.id === 'm-time-wizard' || actionType === 'changePosition') return;
          handleAction({ type: actionType, index });
        }}
        onMouseEnter={() => setHoveredZone(zoneKey)}
        onMouseLeave={() => setHoveredZone('')}
      >
        {kind === 'mon' && (
          <MonsterZoneFrame
            occupied={Boolean(card)}
            hovered={isZoneHovered}
            attackTarget={isAttackTarget}
          />
        )}
        {isFaceUpMonster ? (
          <BattlefieldMonster
            key={card.instance_id || card.id}
            card={card}
            onArtClick={handleMonsterArtworkClick}
            onPositionAction={handleMonsterActionClick}
            canChangePosition={canChangePosition}
            canDragAttack={canDragAttack || canDragPositionChange}
            actionLabel="Kích hoạt hiệu ứng"
            actionGlyph="✦"
            animation={card._motion?.endsWith('-summon') ? 'summon' : undefined}
            selected={isSelected}
          />
        ) : card ? (
          <DuelCard
            key={card.instance_id || card.id}
            card={card}
            faceDown={card.faceDown}
            selected={isSelected}
            animation={card._motion?.endsWith('-summon') ? 'summon' : undefined}
            onClick={handleFieldCardClick}
          />
        ) : hasSpellDropChoice && (
          <div
            style={{
              position: 'relative',
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              className="duel-field-monster duel-field-monster--attack"
              style={{ pointerEvents: 'none', opacity: 0.88 }}
            >
              <div className="duel-field-monster__frame" aria-hidden="true"></div>
              <div className="duel-field-monster__art">
                <img
                  src={
                    spellDropChoice.card?.image?.startsWith('assets/')
                      ? `/${spellDropChoice.card.image}`
                      : (spellDropChoice.card?.image || getDuelCardArtwork(spellDropChoice.card).fallback)
                  }
                  alt=""
                  draggable={false}
                />
              </div>
            </div>
            <div
              style={{
                position: 'absolute',
                top: '-38px',
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                gap: '6px',
                zIndex: 60,
                padding: '4px 6px',
                borderRadius: '8px',
                background: 'rgba(10, 14, 24, 0.94)',
                border: '1px solid rgba(255, 215, 112, 0.45)',
                boxShadow: '0 8px 20px rgba(0, 0, 0, 0.55)',
                whiteSpace: 'nowrap'
              }}
            >
              <button
                type="button"
                className="btn btn--sm btn--gold"
                onClick={(event) => {
                  event.stopPropagation();
                  const { card: chosenCard, zoneIndex: chosenZoneIndex } = spellDropChoice;
                  setSpellDropChoice(null);
                  activateSpellFromHand(chosenCard, chosenZoneIndex);
                }}
              >
                Kích hoạt
              </button>
              <button
                type="button"
                className="btn btn--sm"
                onClick={(event) => {
                  event.stopPropagation();
                  const { instanceId, zoneIndex } = spellDropChoice;
                  setSpellDropChoice(null);
                  setPendingHandPlacementId(instanceId);
                  sendServerAction({
                    type: 'set_card',
                    instance_id: instanceId,
                    zone_index: zoneIndex
                  });
                }}
              >
                Úp
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const attackArrowStart = attackDrag
    ? getAttackArrowStart(
      attackDrag.sourceRect,
      attackDrag.clientX,
      attackDrag.clientY
    )
    : aiAttackArrow?.start || null;
  const attackArrowEnd = attackDrag
    ? { x: attackDrag.clientX, y: attackDrag.clientY }
    : aiAttackArrow?.end || null;
  const attackArrowHead = attackArrowStart && attackArrowEnd
    ? getAttackArrowHeadPoints(attackArrowStart, {
      x: attackArrowEnd.x,
      y: attackArrowEnd.y
    })
    : '';
  const battleRevealAttacker = game?.pendingBattle?.awaitingResolution
    ? game.field.me.mon.find(
      (card) => card?.instance_id === game.pendingBattle.attackerInstanceId
    )
    : null;
  const battleRevealDefender = game?.pendingBattle?.awaitingResolution
    ? game.field.opp.mon.find(
      (card) => card?.instance_id === game.pendingBattle.defenderInstanceId
    )
    : null;
  const battleRevealAttackValue = battleRevealAttacker?.atk ?? 0;
  const battleRevealDefenseValue = battleRevealDefender?.def ?? 0;
  const battleRevealComparison = battleRevealAttackValue > battleRevealDefenseValue
    ? '>'
    : battleRevealAttackValue < battleRevealDefenseValue ? '<' : '=';
  const battleRevealInstruction = battleRevealDefender
    ? `Đã lật ${battleRevealDefender.name}: ATK ${formatLP(battleRevealDefender.atk ?? 0)} / DEF ${formatLP(battleRevealDefenseValue)} · ATK ${formatLP(battleRevealAttackValue)} ${battleRevealComparison} DEF · tự giải quyết sau 2 giây`
    : 'Quái thú đã lật ngửa; đang chờ giải quyết chiến đấu.';
  const trickyDiscardDecision = game?.pendingDecision?.type === 'tricky_discard';
  const trickyDiscardCards = trickyDiscardDecision
    ? game.hand.me.filter(
      (card) => card?.instance_id !== game.pendingDecision.source_instance_id
    )
    : [];
  const selectedTrickyDiscard = trickyDiscardCards.find(
    (card) => card?.instance_id === trickyDiscardSelection
  );
  const gracefulDiscardDecision = Boolean(
    game?.pendingDecision?.type === 'discard' && !game?.busy
  );
  const gracefulDiscardTargetCount = game?.pendingDecision?.count || 2;
  const gracefulDiscardCards = gracefulDiscardDecision ? game.hand.me : [];
  const selectedGracefulDiscardCards = gracefulDiscardSelection
    .map((id) => gracefulDiscardCards.find((card) => card?.instance_id === id))
    .filter(Boolean);
  useEffect(() => {
    if (!gracefulDiscardDecision) {
      setGracefulDiscardSelection((prev) => (prev.length ? [] : prev));
    }
  }, [gracefulDiscardDecision]);
  const trickyPromptCard = game?.hand?.me?.find(
    (card) => card?.instance_id === trickyPromptSourceId
  );
  const trickyPromptIndex = trickyPromptSourceId
    ? game?.hand?.me?.findIndex((card) => card?.instance_id === trickyPromptSourceId) ?? -1
    : -1;
  const canNormalSummonTricky = Boolean(
    game
    && trickyPromptIndex >= 0
    && getLegalActions(game).some(
      (action) => action.type === 'normalSummon' && action.handIndex === trickyPromptIndex
    )
  );
  const canSpecialSummonTricky = Boolean(
    game
    && trickyPromptIndex >= 0
    && game.turn === 'me'
    && !game.busy
    && !game.over
    && !game.pendingDecision
    && !game.pendingEffect
    && !game.pendingBattle?.awaitingResolution
    && game.chain?.status === 'closed'
    && isMainPhase(game.phaseIndex)
    && game.hand.me.length > 1
    && game.field.me.mon.some((fieldCard) => !fieldCard)
  );
  const lightningStormChoiceCard = game?.hand?.me?.find(
    (card) => card?.instance_id === lightningStormChoiceSourceId
  );
  const canChooseLightningStormMode = Boolean(
    game
    && game.turn === 'me'
    && !game.busy
    && !game.over
    && isMainPhase(game.phaseIndex)
    && game.chain?.status === 'closed'
    && !game.pendingEffect
    && (game.field.opp.mon.some(Boolean) || game.field.opp.st.some(Boolean))
  );

  if (duelInitError) {
    return (
      <main className="duel-init-error" role="alert">
        <section>
          <span>KHÔNG THỂ BẮT ĐẦU TRẬN ĐẤU</span>
          <h1>Bộ bài chưa sẵn sàng</h1>
          <p>{duelInitError}</p>
          <a href="/index.html">Quay lại sảnh để chọn hoặc chỉnh sửa bộ bài</a>
        </section>
      </main>
    );
  }

  return (
    <>
      <div className="bg-image bg-image--duel" aria-hidden="true"></div>
      <div className="bg-layer"></div>
      <div className="bg-grid"></div>

      <div className="rotate-hint" role="status" aria-live="polite">
        <div className="rotate-hint__card">
          <div className="rotate-hint__device" aria-hidden="true"></div>
          <p className="rotate-hint__eyebrow">TRẬN ĐẤU TOÀN MÀN HÌNH</p>
          <h1>Hãy xoay ngang thiết bị</h1>
          <p>Bàn đấu sẽ hiển thị đầy đủ và dễ thao tác hơn ở chế độ ngang.</p>
        </div>
      </div>

      <div
        ref={wrapRef}
        className="wrap"
        onPointerMove={handleAttackPointerMove}
        onPointerUp={handleAttackPointerUp}
        onPointerCancel={(event) => clearAttackPointer(event.pointerId)}
        onClickCapture={handleAttackClickCapture}
        onClick={handleBlankClick}
      >
        {((attackDrag && !['spell-trap-place', 'monster-place'].includes(attackDrag.kind)) || aiAttackArrow) && attackArrowStart && attackArrowEnd && (
          <AttackArrowCanvas
            start={attackArrowStart}
            end={attackArrowEnd}
            locked={Boolean(
              aiAttackArrow
              || attackDrag?.targetZoneKey
              || attackDrag?.directTarget
              || attackDrag?.positionSwitchLocked
            )}
          />
        )}
        {['spell-trap-place', 'monster-place'].includes(attackDrag?.kind) && attackDrag.card && (
          <div
            aria-hidden="true"
            style={{
              position: 'fixed',
              left: `${attackDrag.clientX}px`,
              top: `${attackDrag.clientY}px`,
              transform: 'translate(-50%, -50%) scale(1.08)',
              pointerEvents: 'none',
              zIndex: 90,
              filter: 'drop-shadow(0 12px 24px rgba(0, 0, 0, 0.65))'
            }}
          >
            <DuelCard card={attackDrag.card} size="sm" />
          </div>
        )}
        <header className="hud">
          <div className={`pinfo pinfo--me${game?.turn === 'me' ? ' is-turn' : ''}${aiAttackArrow?.directTarget && aiAttackArrow?.directTargetSide !== 'opp' ? ' is-direct-attack-target' : ''}`} data-js="pinfo-me">
            <div className="pinfo__avatar-frame">
              {DUEL_CHARACTER_AVATARS[game?.profile?.me?.selectedCharacterId]
                ? (
                  <img
                    src={DUEL_CHARACTER_AVATARS[game.profile.me.selectedCharacterId]}
                    alt=""
                  />
                )
                : (
                  <span className="pinfo__avatar-initial" aria-hidden="true">
                    {game?.profile?.me?.name?.trim().charAt(0).toLocaleUpperCase('vi-VN') || 'D'}
                  </span>
                )}
              <span className="pinfo__avatar-chip">PLAYER</span>
            </div>
            <div className="pinfo__body">
              <div className="pinfo__identity">
                <span className="pinfo__role">NGƯỜI CHƠI</span>
                <span
                  className="pinfo__name"
                  title={game?.profile?.me?.name || undefined}
                >
                  {game?.profile?.me?.name || '...'}
                </span>
              </div>
              <div className="pinfo__stats">
                <span className="pinfo__stat-label">LP</span>
                <AnimatedLifePoints
                  value={game?.lp.me ?? STARTING_LP}
                  side="me"
                  instant={Boolean(game?.exodiaWinner)}
                />
              </div>
              <div
                className="bar bar--hp pinfo__bar"
                data-js="lpbar-me"
                role="progressbar"
                aria-label={`LP người chơi: ${formatLP(game?.lp.me ?? STARTING_LP)}`}
                aria-valuemin="0"
                aria-valuemax={STARTING_LP}
                aria-valuenow={Math.max(0, Math.min(STARTING_LP, game?.lp.me ?? STARTING_LP))}
              >
                <i
                  style={{
                    width: `${Math.max(0, Math.min(100, (game?.lp.me ?? STARTING_LP) / STARTING_LP * 100))}%`,
                    ...(game?.exodiaWinner ? { transition: 'none' } : {})
                  }}
                ></i>
              </div>
            </div>
          </div>
          <div className="hud__spacer"></div>
          <div className="phases" data-js="phases">
            {PHASES.map((phase, index) => <span key={phase.id} className={`phase${(game?.phaseIndex ?? 0) === index ? ' is-active' : ''}`}>{phase.label}</span>)}
          </div>
          <div className="turnflag turnflag--canvas" data-js="turn-flag" role="status" aria-live="polite">
            <TurnBannerFrame />
            <span className="turnflag__text">
              {game?.turn === 'opp' ? '🔴 LƯỢT ĐỐI THỦ' : '🟢 LƯỢT CỦA BẠN'} &nbsp;·&nbsp; Lượt {game?.turnCount ?? 1}
            </span>
            <span className="turnflag__phase" data-js="current-phase">
              GIAI ĐOẠN: {PHASES[game?.phaseIndex]?.label ?? 'ĐANG TẢI'}
            </span>
          </div>
          <div className="hud__spacer"></div>
          <div
            className={`pinfo pinfo--opp${game?.turn === 'opp' ? ' is-turn' : ''}${attackDrag?.directTarget ? ' is-direct-attack-target' : ''}`}
            data-js="pinfo-opp"
          >
            <div className="pinfo__avatar-frame pinfo__avatar-frame--ai">
              <span className="pinfo__avatar-initial" aria-hidden="true">AI</span>
              <span className="pinfo__avatar-chip">AI</span>
            </div>
            <div className="pinfo__body">
              <div className="pinfo__identity">
                <span className="pinfo__role">ĐỐI THỦ</span>
                <span className="pinfo__name" title={game?.profile?.opp?.name || undefined}>
                  {game?.profile?.opp?.name || 'Đối thủ AI'}
                </span>
              </div>
              <div className="pinfo__stats">
                <span className="pinfo__stat-label">LP</span>
                <AnimatedLifePoints
                  value={game?.lp.opp ?? STARTING_LP}
                  side="opp"
                  instant={Boolean(game?.exodiaWinner)}
                />
              </div>
              <div
                className="bar bar--hp pinfo__bar"
                data-js="lpbar-opp"
                role="progressbar"
                aria-label={`LP đối thủ: ${formatLP(game?.lp.opp ?? STARTING_LP)}`}
                aria-valuemin="0"
                aria-valuemax={STARTING_LP}
                aria-valuenow={Math.max(0, Math.min(STARTING_LP, game?.lp.opp ?? STARTING_LP))}
              >
                <i
                  style={{
                    width: `${Math.max(0, Math.min(100, (game?.lp.opp ?? STARTING_LP) / STARTING_LP * 100))}%`,
                    ...(game?.exodiaWinner ? { transition: 'none' } : {})
                  }}
                ></i>
              </div>
            </div>
          </div>
          <div className="duel-top-left-controls">
            <div className="duel-settings-row">
              <button
                type="button"
                className={`duel-hex-btn${settingsMenuOpen ? ' is-open' : ''}`}
                data-js="btn-settings"
                title="Cài đặt"
                aria-expanded={settingsMenuOpen}
                aria-label="Cài đặt"
                onClick={() => setSettingsMenuOpen((prev) => !prev)}
              >
                <svg viewBox="0 0 24 24" className="ico" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.1 7.1 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 0 0-.61.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.83 14.52a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .61.22l2.39-.96c.49.38 1.03.7 1.62.94l.36 2.54c.05.24.25.41.48.41h3.84c.23 0 .43-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96a.5.5 0 0 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2Z"
                  />
                </svg>
              </button>
              <div
                className={`duel-settings-drawer${settingsMenuOpen ? ' is-open' : ''}`}
                role="menu"
                aria-label="Menu cài đặt"
                aria-hidden={!settingsMenuOpen}
              >
                <button
                  type="button"
                  className={`duel-hex-option${musicEnabled ? ' is-on' : ' is-off'}`}
                  role="menuitem"
                  tabIndex={settingsMenuOpen ? 0 : -1}
                  onClick={() => setMusicEnabled((prev) => !prev)}
                >
                  <span className="duel-hex-btn">
                    <span className="duel-hex-btn__state">{musicEnabled ? 'Mở' : 'Tắt'}</span>
                  </span>
                  <span className="duel-hex-option__label">Âm nhạc</span>
                </button>
                <button
                  type="button"
                  className={`duel-hex-option${sfxEnabled ? ' is-on' : ' is-off'}`}
                  role="menuitem"
                  tabIndex={settingsMenuOpen ? 0 : -1}
                  onClick={() => setSfxEnabled((prev) => !prev)}
                >
                  <span className="duel-hex-btn">
                    <span className="duel-hex-btn__state">{sfxEnabled ? 'Mở' : 'Tắt'}</span>
                  </span>
                  <span className="duel-hex-option__label">Âm thanh</span>
                </button>
                <button
                  type="button"
                  className="duel-hex-option duel-hex-option--surrender"
                  role="menuitem"
                  tabIndex={settingsMenuOpen ? 0 : -1}
                  onClick={() => {
                    setSettingsMenuOpen(false);
                    setSurrenderConfirmOpen(true);
                  }}
                >
                  <span className="duel-hex-btn">
                    <svg viewBox="0 0 24 24" className="ico" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M19 11H9.83l4.58-4.59L13 5l-7 7 7 7 1.41-1.41L9.83 13H19v-2Z"
                      />
                    </svg>
                  </span>
                  <span className="duel-hex-option__label">Chịu thua</span>
                </button>
              </div>
            </div>
            <button
              type="button"
              className="duel-hex-btn"
              data-js="btn-log"
              title="Nhật ký"
              aria-label="Nhật ký"
              onClick={() => handleAction({ type: 'toggleLog' })}
            >
              <svg viewBox="0 0 24 24" className="ico" aria-hidden="true">
                <path d="M5 4h14v16H5z" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M8 9h8M8 13h8M8 17h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </header>

        <main ref={boardRef} className={`board${cocosFallback ? ' cocos-fallback' : ''}`}>
          <canvas ref={canvasRef} id="cocosDuelCanvas" width="960" height="640" aria-label="Bàn đấu Cocos2d Canvas"></canvas>
          <div className="cocos-error" data-js="cocos-error" role="status" hidden={!cocosError}>{cocosError}</div>
          <section className="side side--opp">
            <div className="rail">
              <div className="slot slot--deck" data-js="deck-opp">
                <span className="slot__deck-art" aria-hidden="true"><CardBack /></span>
                <div>
                  BỘ BÀI
                  <AnimatedDeckCount
                    value={game?.deck?.opp?.length}
                    hand={game?.hand?.opp}
                    matchId={game?.matchId}
                  />
                </div>
              </div>
              <div className="slot slot--extra" title="Extra Deck"><div>EXTRA<b data-js="extra-opp">{game?.extraDeck?.opp.length ?? 0}</b></div></div>
              <button type="button" className="slot slot--grave" title="Mở Mộ Bài đối thủ" onClick={() => setZoneViewer({ side: 'opp', zone: 'grave' })}>
                <i className={`slot__badge${game?.grave.opp.length ? '' : ' is-zero'}`} data-js="grave-badge-opp">{game?.grave.opp.length ?? 0}</i>
                <div>MỘ<b data-js="grave-opp">{game?.grave.opp.length ?? 0}</b></div>
              </button>
            </div>
            <div className="side__playmat">
              <div className="side__field">
                <div className="row row--mon">{Array.from({ length: 5 }, (_, index) => renderZone('opp', 'mon', index))}</div>
              </div>
              <div className="side__backrow">
                <div className="row row--st">
                  {Array.from({ length: 5 }, (_, index) => renderZone('opp', 'st', index))}
                  <div
                    className={`zone zone--field field-zone--opp${game?.field?.opp?.fieldZone?.[0] ? ' is-occupied' : ''}`}
                    data-field-zone="opp"
                    data-occupied={game?.field?.opp?.fieldZone?.[0] ? '1' : '0'}
                    data-card-instance-id={game?.field?.opp?.fieldZone?.[0]?.instance_id || undefined}
                    aria-label="Ô Phép Môi Trường đối thủ"
                  >
                    {!game?.field?.opp?.fieldZone?.[0] && (
                      <span className="zone__label">Môi trường</span>
                    )}
                    {game?.field?.opp?.fieldZone?.[0] && (
                      <DuelCard
                        card={game.field.opp.fieldZone[0]}
                        size="sm"
                        animation={
                          game.field.opp.fieldZone[0]._motion?.endsWith('-summon')
                            ? 'summon'
                            : undefined
                        }
                        onClick={() => setPreviewCard(game.field.opp.fieldZone[0])}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>
          <div className="midline" aria-hidden="true">
            <MidlineExDivider />
          </div>
          <section className="side side--me">
            <div className="side__playmat">
              <div className="side__field">
                <div className="row row--mon">{Array.from({ length: 5 }, (_, index) => renderZone('me', 'mon', index))}</div>
              </div>
              <div className="side__backrow">
                <div className="row row--st">
                  {Array.from({ length: 5 }, (_, index) => renderZone('me', 'st', index))}
                  <div
                    className={`zone zone--field field-zone--me${game?.field?.me?.fieldZone?.[0] ? ' is-occupied' : ''}${
                      attackDrag?.kind === 'spell-trap-place'
                      && attackDrag?.card?.id === 's-the-seal-of-orichalcos'
                      && !orichalcosActive
                      && !game?.field?.me?.fieldZone?.[0]
                        ? ' is-hover'
                        : ''
                    }${attackDrag?.targetZoneKey === 'me-field-0' ? ' is-attack-target' : ''}`}
                    data-field-zone="me"
                    data-occupied={game?.field?.me?.fieldZone?.[0] ? '1' : '0'}
                    data-card-instance-id={game?.field?.me?.fieldZone?.[0]?.instance_id || undefined}
                    aria-label="Ô Phép Môi Trường của bạn"
                  >
                    {!game?.field?.me?.fieldZone?.[0] && (
                      <span className="zone__label">Môi trường</span>
                    )}
                    {game?.field?.me?.fieldZone?.[0] && (
                      <DuelCard
                        card={game.field.me.fieldZone[0]}
                        size="sm"
                        animation={
                          game.field.me.fieldZone[0]._motion?.endsWith('-summon')
                            ? 'summon'
                            : undefined
                        }
                        onClick={() => setPreviewCard(game.field.me.fieldZone[0])}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="rail">
              <div className="slot slot--extra" title="Extra Deck"><div>EXTRA<b data-js="extra-me">{game?.extraDeck?.me.length ?? 0}</b></div></div>
              <button type="button" className="slot slot--grave" title="Mở Mộ Bài của bạn" onClick={() => setZoneViewer({ side: 'me', zone: 'grave' })}>
                <i className={`slot__badge${game?.grave.me.length ? '' : ' is-zero'}`} data-js="grave-badge-me">{game?.grave.me.length ?? 0}</i>
                <div>MỘ<b data-js="grave-me">{game?.grave.me.length ?? 0}</b></div>
              </button>
            </div>
          </section>
          {attackLockChainLayerActive && (
            <AttackLockChainOverlay
              boardRef={boardRef}
              chains={attackLockedChains}
              onFinished={() => setAttackLockChainLayerActive(false)}
            />
          )}
        </main>

        {zoneViewer && createPortal(
          <div className="duel-zone-overlay" role="presentation" onMouseDown={(event) => {
            if (event.target === event.currentTarget) setZoneViewer(null);
          }}>
            <section
              className={`duel-zone-panel duel-zone-panel--${zoneViewer.zone}`}
              role="dialog"
              aria-modal="true"
              aria-label={zoneViewer.zone === 'grave'
                ? `Mộ Bài ${zoneViewer.side === 'me' ? 'của bạn' : 'đối thủ'}`
                : `Bài bị loại ${zoneViewer.side === 'me' ? 'của bạn' : 'đối thủ'}`}
            >
              <header>
                <div>
                  <span>{zoneViewer.side === 'me' ? 'Khu vực của bạn' : 'Khu vực đối thủ'}</span>
                  <h2>{zoneViewer.zone === 'grave' ? 'Mộ Bài' : 'Bài bị loại'}</h2>
                </div>
                <button type="button" className="duel-zone-panel__close" onClick={() => setZoneViewer(null)} aria-label="Đóng">×</button>
              </header>
              <div className="duel-zone-tabs" role="tablist" aria-label="Trạng thái khu vực Mộ">
                <button
                  type="button"
                  role="tab"
                  id="duel-grave-tab"
                  aria-controls="duel-grave-panel"
                  aria-selected={zoneViewer.zone === 'grave'}
                  className={zoneViewer.zone === 'grave' ? 'is-active' : ''}
                  onClick={() => setZoneViewer((current) => ({ ...current, zone: 'grave' }))}
                >
                  Trong Mộ <span>{game?.grave?.[zoneViewer.side]?.length ?? 0}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  id="duel-banished-tab"
                  aria-controls="duel-grave-panel"
                  aria-selected={zoneViewer.zone === 'banished'}
                  className={zoneViewer.zone === 'banished' ? 'is-active' : ''}
                  onClick={() => setZoneViewer((current) => ({ ...current, zone: 'banished' }))}
                >
                  Bài bị loại <span>{game?.banished?.[zoneViewer.side]?.length ?? 0}</span>
                </button>
              </div>
              <div className="duel-zone-panel__grid" id="duel-grave-panel" role="tabpanel" aria-labelledby={zoneViewer.zone === 'grave' ? 'duel-grave-tab' : 'duel-banished-tab'}>
                {(zoneViewer.zone === 'grave'
                  ? game?.grave?.[zoneViewer.side] || []
                  : game?.banished?.[zoneViewer.side] || []
                ).map((card, index) => (
                  <button
                    type="button"
                    key={`${card.instance_id || card.id}-${index}`}
                    className="duel-zone-panel__card"
                    onClick={() => openCardPreview(card)}
                    title={card.name}
                  >
                    <CardFace
                      card={card}
                      className="duel-zone-panel__card-face"
                      fallbackImage={getDuelCardArtwork(card).fallback}
                    />
                    <span className="duel-zone-panel__card-name">
                      {card.name || card.name_alias || card.id || card.card_id || 'Không rõ tên lá'}
                    </span>
                  </button>
                ))}
              </div>
              {(zoneViewer.zone === 'grave'
                ? game?.grave?.[zoneViewer.side]?.length
                : game?.banished?.[zoneViewer.side]?.length
              ) === 0 && (
                <div className="duel-zone-panel__empty">Không có lá bài.</div>
              )}
            </section>
          </div>,
          document.body
        )}

        <CardDetailDialog
          card={previewCard}
          onClose={() => setPreviewCard(null)}
        />

        <div className="hand hand--opponent">
          <div data-js="hand-opp">
            {!!game?.hand.opp.length && (
              <div className="hand__opponent-list" aria-label={`Đối thủ đang giữ ${game.hand.opp.length} lá bài`}>
                {game.hand.opp.map((card, index) => (
                  <DuelCard
                    key={`${card.id}-${index}`}
                    card={card}
                    size="sm"
                    faceDown
                    animation={card._motion?.endsWith('-draw') ? 'draw' : undefined}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {game?.pendingEffect?.targetMode === 'valkyrion-tributes' && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Chọn Alpha, Beta và Gamma để Triệu hồi Chiến Binh Kim Loại"
            style={{
              position: 'fixed',
              zIndex: 1000,
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              display: 'grid',
              gap: 8,
              maxHeight: '70vh',
              maxWidth: 'min(90vw, 460px)',
              overflowY: 'auto',
              padding: 16,
              color: '#fff',
              background: '#17120f',
              border: '2px solid #c9a45c',
              borderRadius: 8
            }}
          >
            <strong>Chọn đúng một Alpha, một Beta và một Gamma để Hiến tế</strong>
            <span aria-live="polite">
              Đã chọn {game.selectedTargets.length}/3.
            </span>
            {getValkyrionMaterialCandidates(game).map(({ card, zone }) => {
              const selected = game.selectedTargets.includes(card.instance_id);
              const duplicateTypeSelected = hasValkyrionMaterialTypeSelected(
                game,
                game.selectedTargets,
                card.id
              );
              return (
                <button
                  key={card.instance_id}
                  className="btn btn--sm"
                  aria-pressed={selected}
                  disabled={
                    !selected
                    && (
                      game.selectedTargets.length >= VALKYRION_MATERIAL_IDS.length
                      || duplicateTypeSelected
                    )
                  }
                  onClick={() => dispatch({
                    type: 'uiToggleTarget',
                    instanceId: card.instance_id
                  })}
                >
                  {selected ? '✓ ' : ''}
                  {zone === 'hand' ? 'Trên tay' : 'Trên sân'} — {card.name}
                </button>
              );
            })}
            <button
              className="btn btn--sm"
              disabled={
                !hasCompleteValkyrionMaterialSet(game, game.selectedTargets)
                || !hasValkyrionSummonSpaceForSelection(game, game.selectedTargets)
              }
              onClick={() => handleAction({ type: 'resolveSelectedEffect' })}
            >
              Triệu hồi Chiến Binh Kim Loại
            </button>
            <button
              className="btn btn--sm"
              onClick={() => handleAction({ type: 'cancelEffect' })}
            >
              Hủy
            </button>
          </div>
        )}

        {game?.pendingEffect?.targetMode?.startsWith('grave-') && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={
              game.pendingEffect.targetMode === 'grave-valkyrion'
                ? 'Chọn Alpha, Beta và Gamma trong Mộ của bạn'
                : game.pendingEffect.targetMode === 'grave-chaos-emperor'
                  ? 'Chọn một quái thú ÁNH SÁNG và một quái thú BÓNG TỐI trong Mộ của bạn'
                  : game.pendingEffect.targetMode === 'grave-levianeer'
                      ? 'Chọn hai quái thú ÁNH SÁNG và/hoặc BÓNG TỐI trong Mộ của bạn'
                : 'Chọn mục tiêu trong Mộ'
            }
            style={{
              position: 'fixed',
              zIndex: 1000,
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              display: 'grid',
              gap: 8,
              maxHeight: '70vh',
              maxWidth: 'min(90vw, 460px)',
              overflowY: 'auto',
              padding: 16,
              color: '#fff',
              background: '#17120f',
              border: '2px solid #c9a45c',
              borderRadius: 8
            }}
          >
            <strong>
              {game.pendingEffect.targetMode === 'grave-any'
                ? `Chọn tối đa 5 lá trong Mộ (${game.selectedTargets.length}/5)`
                : game.pendingEffect.targetMode === 'grave-valkyrion'
                  ? `Chọn một Alpha, một Beta và một Gamma trong Mộ (${game.selectedTargets.length}/3)`
                : game.pendingEffect.targetMode === 'grave-chaos-emperor'
                  ? `Chọn một quái thú ÁNH SÁNG và một quái thú BÓNG TỐI (${game.selectedTargets.length}/2)`
                  : game.pendingEffect.targetMode === 'grave-levianeer'
                      ? `Chọn hai quái thú ÁNH SÁNG và/hoặc BÓNG TỐI (${game.selectedTargets.length}/2)`
                : game.pendingEffect.targetMode === 'grave-opponent-any'
                  ? 'Chọn 1 lá trong Mộ đối thủ'
                : game.pendingEffect.targetMode === 'grave-own-spell'
                  ? 'Chọn 1 Lá Phép trong Mộ của bạn'
                  : game.pendingEffect.targetMode === 'grave-white-stone'
                    ? 'Chọn 1 Rồng Trắng Mắt Xanh trong Mộ của bạn'
                  : game.pendingEffect.targetMode === 'grave-own-any'
                    ? 'Chọn 1 lá bài trong Mộ của bạn'
                    : 'Chọn quái thú trong Mộ'}
            </strong>
            {getPendingGraveChoices(game).map(({ card, owner, index }) => {
              const selected = game.selectedTargets.includes(card.instance_id);
              const isMultiSelect = [
                'grave-any',
                'grave-valkyrion',
                'grave-chaos-emperor',
                'grave-levianeer'
              ].includes(
                game.pendingEffect.targetMode
              );
              const duplicateValkyrionMaterial = game.pendingEffect.targetMode === 'grave-valkyrion'
                && hasGraveValkyrionMaterialTypeSelected(game, game.selectedTargets, card.id);
              const duplicateChaosEmperorAttribute = game.pendingEffect.targetMode === 'grave-chaos-emperor'
                && hasChaosEmperorAttributeSelected(
                  game,
                  game.selectedTargets,
                  String(card.attribute || '').toUpperCase()
                );
              const maxTargets = game.pendingEffect.targetMode === 'grave-any'
                ? 5
                : game.pendingEffect.targetMode === 'grave-chaos-emperor'
                  ? 2
                  : game.pendingEffect.targetMode === 'grave-levianeer'
                    ? 2
                  : VALKYRION_MATERIAL_IDS.length;
              return (
                <button
                  key={`${owner}-${card.id}-${index}`}
                  className="btn btn--sm"
                  aria-pressed={isMultiSelect ? selected : undefined}
                  disabled={
                    isMultiSelect
                    && !selected
                    && (
                      game.selectedTargets.length >= maxTargets
                      || duplicateValkyrionMaterial
                      || duplicateChaosEmperorAttribute
                    )
                  }
                  onClick={() => {
                    if (isMultiSelect) {
                      dispatch({
                        type: 'uiToggleTarget',
                        instanceId: card.instance_id
                      });
                      return;
                    }
                    handleAction({
                      type: 'resolveEffectChoice',
                      target: { zone: 'grave', owner, index }
                    });
                  }}
                >
                  {isMultiSelect && selected ? '✓ ' : ''}
                  {owner === 'me' ? 'Mộ của bạn' : 'Mộ đối thủ'} — {card.name}
                </button>
              );
            })}
            {!getPendingGraveChoices(game).length && <span>Không có mục tiêu hợp lệ.</span>}
          </div>
        )}

        {[
          'deck-own-spell',
          'deck-or-hand-blue-eyes-summon',
          'hand-deck-grave-blue-eyes',
          'mana-dark-magician-girl-summon'
        ].includes(
          game?.pendingEffect?.targetMode
        ) && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={
              game.pendingEffect.targetMode === 'mana-dark-magician-girl-summon'
                ? 'Chọn Nữ Phù Thủy Bóng Đêm từ tay, Bộ bài hoặc Mộ, hoặc bỏ qua hiệu ứng Thần Quan Mana'
                : game.pendingEffect.targetMode === 'hand-deck-grave-blue-eyes'
                ? 'Chọn Rồng Trắng Mắt Xanh từ tay, Bộ bài hoặc Mộ'
                : game.pendingEffect.targetMode === 'deck-or-hand-blue-eyes-summon'
                ? 'Chọn Rồng Trắng Mắt Xanh từ Bộ bài hoặc tay, hoặc bỏ qua hiệu ứng Bạch Thạch Cổ Đại'
                : 'Chọn một Lá Phép trong Bộ bài hoặc bỏ qua hiệu ứng Mèo Ma Thuật'
            }
            style={{
              position: 'fixed',
              zIndex: 1000,
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              display: 'grid',
              gap: 8,
              maxHeight: '70vh',
              maxWidth: 'min(90vw, 460px)',
              overflowY: 'auto',
              padding: 16,
              color: '#fff',
              background: '#17120f',
              border: '2px solid #c9a45c',
              borderRadius: 8
            }}
          >
            <strong>
              {game.pendingEffect.targetMode === 'mana-dark-magician-girl-summon'
                ? 'Thần Quan Mana: bạn có thể Triệu hồi Đặc biệt 1 Nữ Phù Thủy Bóng Đêm từ tay, Bộ bài hoặc Mộ'
                : game.pendingEffect.targetMode === 'hand-deck-grave-blue-eyes'
                ? game.pendingDecision.effect_id === 'attack_summon'
                  ? 'Thiếu Nữ Mắt Xanh: có thể Triệu hồi Đặc biệt 1 Rồng Trắng Mắt Xanh từ tay, Bộ bài hoặc Mộ'
                  : 'Thiếu Nữ Mắt Xanh: Triệu hồi Đặc biệt 1 Rồng Trắng Mắt Xanh từ tay, Bộ bài hoặc Mộ'
                : game.pendingEffect.targetMode === 'deck-or-hand-blue-eyes-summon'
                ? 'Bạch Thạch Cổ Đại: bạn có thể Triệu hồi Đặc biệt 1 Rồng Trắng Mắt Xanh từ Bộ bài hoặc tay'
                : 'Mèo Ma Thuật: bạn có thể thêm 1 Lá Phép từ Bộ bài lên tay'}
            </strong>
            {game.pendingDecision?.eligible_cards?.map((card) => {
              const selected = game.selectedTargets.includes(card.instance_id);
              return (
                <button
                  key={card.instance_id}
                  className="btn btn--sm"
                  aria-pressed={selected}
                  onClick={() => dispatch({
                    type: 'uiToggleTarget',
                    instanceId: card.instance_id
                  })}
                >
                  {selected ? '✓ ' : ''}
                  {card.name}
                  {card.zone === 'hand'
                    ? ' — trên tay'
                    : card.zone === 'graveyard'
                      ? ' — trong Mộ'
                      : card.zone === 'deck'
                        ? ' — trong Bộ bài'
                        : card.zone === 'banished'
                          ? ' — bị loại bỏ'
                        : ''}
                </button>
              );
            })}
            <button
              className="btn btn--sm"
              disabled={
                !game.selectedTargets.length
                && game.pendingDecision?.min_count > 0
              }
              onClick={() => handleAction({ type: 'resolveSelectedEffect' })}
            >
              {game.selectedTargets.length
                ? ['deck-or-hand-blue-eyes-summon', 'hand-deck-grave-blue-eyes', 'mana-dark-magician-girl-summon'].includes(
                  game.pendingEffect.targetMode
                )
                  ? 'Triệu hồi Đặc biệt'
                  : 'Thêm Lá Phép lên tay'
                : game.pendingDecision?.min_count === 0
                  ? 'Bỏ qua hiệu ứng'
                  : 'Chọn một Rồng Trắng Mắt Xanh'}
            </button>
          </div>
        )}

        {game?.pendingDecision?.type === 'select_field_cards'
          && game.pendingDecision.effect_card_id === 'm-night-assailant'
          && game.pendingDecision.target_mode === 'field-opponent-monster' && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Chọn quái thú đối thủ để Kẻ Tấn Công Bóng Đêm phá hủy"
            className="duel-night-assailant-popup"
          >
            <strong>Kẻ Tấn Công Bóng Đêm — chọn 1 quái thú đối thủ để phá hủy</strong>
            <div className="duel-night-assailant-popup__cards">
              {game.field.opp.mon.map((card, index) => card ? (
                <button
                  type="button"
                  key={card.instance_id || `${card.id}-${index}`}
                  className={[
                    'duel-night-assailant-popup__card',
                    game.selectedTargets.includes(card.instance_id) ? 'is-selected' : ''
                  ].filter(Boolean).join(' ')}
                  disabled={game.busy}
                  onClick={() => dispatch({
                    type: 'uiToggleTarget',
                    instanceId: card.instance_id
                  })}
                  aria-pressed={game.selectedTargets.includes(card.instance_id)}
                >
                  <CardFace
                    card={card.monsterType ? card : { ...card, monsterType: card.monsterType || 'Thường' }}
                    className="duel-night-assailant-popup__card-face"
                    fallbackImage={getDuelCardArtwork(card).fallback}
                  />
                </button>
              ) : null)}
            </div>
            <button
              className="btn btn--sm duel-night-assailant-popup__confirm"
              disabled={game.busy || game.selectedTargets.length !== 1}
              onClick={() => handleAction({ type: 'resolveSelectedEffect' })}
            >
              Xác nhận phá hủy
            </button>
          </div>
        )}

        {game?.pendingDecision?.type === 'maiden_attack' && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Thiếu Nữ Mắt Xanh bị chọn làm mục tiêu tấn công"
            style={{
              position: 'fixed',
              zIndex: 1000,
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              display: 'grid',
              gap: 8,
              maxWidth: 'min(90vw, 460px)',
              padding: 16,
              color: '#fff',
              background: '#17120f',
              border: '2px solid #c9a45c',
              borderRadius: 8
            }}
          >
            <strong>
              Thiếu Nữ Mắt Xanh bị chọn làm mục tiêu tấn công. Bạn có thể ngăn đòn tấn công và đổi tư thế chiến đấu.
            </strong>
            <button
              className="btn btn--sm"
              disabled={game.busy}
              onClick={() => handleAction({ type: 'maidenAttackEffect' })}
            >
              Ngăn đòn tấn công và đổi tư thế
            </button>
            <button
              className="btn btn--sm"
              disabled={game.busy}
              onClick={() => handleAction({ type: 'skipMaidenAttackEffect' })}
            >
              Bỏ qua hiệu ứng
            </button>
          </div>
        )}

        {game?.pendingDecision?.type === 'ordeal_traveler_guess' && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Đoán loại bài cho Thử Thách Kẻ Du Hành"
            style={{
              position: 'fixed',
              zIndex: 1000,
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              display: 'grid',
              gap: 8,
              maxWidth: 'min(90vw, 460px)',
              padding: 16,
              color: '#fff',
              background: '#17120f',
              border: '2px solid #c9a45c',
              borderRadius: 8
            }}
          >
            <strong>Thử Thách Kẻ Du Hành</strong>
            <span>Một lá trên tay đối thủ đã được chọn ngẫu nhiên. Hãy đoán loại bài:</span>
            {[
              ['monster', 'Quái thú'],
              ['spell', 'Phép'],
              ['trap', 'Bẫy']
            ].map(([guess, label]) => (
              <button
                key={guess}
                className="btn btn--sm"
                disabled={game.busy}
                onClick={() => sendServerAction({
                  type: 'complete_ordeal_traveler_guess',
                  guess
                })}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {game?.pendingDecision?.type === 'cloning_offer' && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Kích hoạt Nhân Bản Quái Thú"
            style={{
              position: 'fixed',
              zIndex: 1000,
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              display: 'grid',
              gap: 8,
              maxWidth: 'min(90vw, 460px)',
              padding: 16,
              color: '#fff',
              background: '#17120f',
              border: '2px solid #c9a45c',
              borderRadius: 8
            }}
          >
            <strong>Đối thủ vừa Triệu hồi {game.pendingDecision.target_name} ngửa.</strong>
            <span>
              Bạn có thể kích hoạt Nhân Bản Quái Thú để Triệu hồi Clone Token có cùng Loại, Thuộc tính, Cấp, ATK và DEF ban đầu.
            </span>
            <button
              className="btn btn--sm"
              disabled={game.busy}
              onClick={() => handleAction({ type: 'activateCloning' })}
            >
              Kích hoạt Nhân Bản Quái Thú
            </button>
            <button
              className="btn btn--sm"
              disabled={game.busy}
              onClick={() => handleAction({ type: 'skipCloning' })}
            >
              Bỏ qua
            </button>
          </div>
        )}

        {['field-spell-trap', 'field-opponent-spell-trap', 'field-card', 'field-card-any', 'field-opponent-monster', 'hand-spellcaster', 'clone-dragon-field-monster'].includes(game?.pendingEffect?.targetMode)
          && !DRAGGABLE_EFFECT_TARGET_MODES.has(game.pendingEffect.targetMode)
          && game.pendingDecision?.effect_card_id !== 'm-night-assailant'
          && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={
              game.pendingEffect.targetMode === 'clone-dragon-field-monster'
                ? 'Chọn một quái thú ngửa để Rồng Vô Tính sao chép hoặc bỏ qua'
                : game.pendingEffect.targetMode === 'hand-spellcaster'
                ? 'Chọn một Phù thủy trên tay để Triệu hồi Đặc biệt'
                : game.pendingEffect.targetMode === 'field-opponent-monster'
                  ? game.pendingEffect.card?.id === 'm-night-assailant'
                    ? 'Chọn một quái thú trên sân đối thủ để Kẻ Tấn Công Bóng Đêm phá hủy'
                    : game.pendingEffect.card?.id === 's-magical-dimension'
                    ? 'Chọn một quái thú trên sân đối thủ để phá hủy'
                    : game.pendingEffect.card?.id === 'm-lava-golem'
                      ? 'Chọn hai quái thú trên sân đối thủ để Hiến tế'
                      : game.pendingEffect.card?.id === 'm-blue-eyes-alternative-white-dragon'
                        ? 'Chọn một quái thú đối thủ để Rồng Trắng Mắt Xanh Thay Thế phá hủy'
                        : 'Chọn một quái thú trên sân đối thủ'
                : game.pendingEffect.targetMode === 'field-opponent-spell-trap'
                  ? 'Chọn tối đa hai Lá Phép/Bẫy của đối thủ'
                : game.pendingEffect.targetMode === 'field-card'
                  ? game.pendingEffect.card?.id === 'm-y-dragon-head'
                    ? 'Chọn ĐẠI BÁC Cannon X ngửa bạn điều khiển'
                    : game.pendingEffect.card?.id === 'm-z-metal-tank'
                      ? 'Chọn ĐẠI BÁC Cannon X hoặc Rồng Chữ Y ngửa bạn điều khiển'
                    : 'Chọn một lá bài trên sân đối thủ'
                  : game.pendingEffect.targetMode === 'field-card-any'
                      ? game.pendingEffect.card?.id === 'm-chaos-dragon-levianeer'
                        ? 'Chọn tối đa hai lá bài trên sân cho Levianeer'
                        : 'Chọn một lá bài trên sân'
                    : 'Chọn tối đa hai lá Phép hoặc Bẫy trên sân'
            }
            style={{
              position: 'fixed',
              zIndex: 1000,
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              display: 'grid',
              gap: 8,
              maxWidth: 'min(90vw, 460px)',
              padding: 16,
              color: '#fff',
              background: '#17120f',
              border: '2px solid #c9a45c',
              borderRadius: 8
            }}
          >
            <strong>
              {game.pendingEffect.targetMode === 'clone-dragon-field-monster'
                ? 'Rồng Vô Tính: chọn quái thú ngửa có hiệu ứng được hỗ trợ để sao chép và Triệu hồi Đặc biệt, hoặc bỏ qua'
                : game.pendingEffect.targetMode === 'hand-spellcaster'
                ? 'Quan Tài Của Phù Thủy: chọn 1 Phù thủy trên tay để Triệu hồi Đặc biệt'
                : game.pendingEffect.targetMode === 'field-opponent-monster'
                  ? game.pendingEffect.card?.id === 'm-night-assailant'
                    ? 'Kẻ Tấn Công Bóng Đêm: chọn 1 quái thú đối thủ để phá hủy'
                    : game.pendingEffect.card?.id === 's-magical-dimension'
                    ? 'Quan Tài Của Phù Thủy: chọn 1 quái thú đối thủ để phá hủy'
                    : game.pendingEffect.card?.id === 'm-lava-golem'
                      ? 'Người Đá Dung Nham: chọn đúng 2 quái thú đối thủ để Hiến tế'
                      : game.pendingEffect.card?.id === 'm-blue-eyes-alternative-white-dragon'
                        ? 'Rồng Trắng Mắt Xanh Thay Thế: chọn 1 quái thú đối thủ để phá hủy'
                        : 'Chú Hề Ma Quái: chọn 1 quái thú đối thủ để trả về tay chủ sở hữu'
                : game.pendingEffect.targetMode === 'field-card'
                  ? game.pendingEffect.card?.id === 'm-y-dragon-head'
                    ? 'Rồng Chữ Y: chọn ĐẠI BÁC Cannon X ngửa bạn điều khiển'
                    : game.pendingEffect.card?.id === 'm-z-metal-tank'
                      ? 'Xe Tăng Bọc Thép Z: chọn Cannon X hoặc Rồng Chữ Y ngửa bạn điều khiển'
                      : 'Monarch Bóng Tối: chọn 1 lá của đối thủ để loại bỏ'
                  : game.pendingEffect.targetMode === 'field-card-any'
                      ? game.pendingEffect.card?.id === 'm-chaos-dragon-levianeer'
                        ? 'Levianeer: chọn tối đa 2 lá trên sân để phá hủy (có thể bỏ qua)'
                        : 'Ryko: chọn 1 lá trên sân để phá hủy'
                    : game.pendingEffect.card?.id === 't-heavy-storm-duster'
                      ? 'Cơn Bão Lớn: chọn 1 hoặc 2 Lá Phép/Bẫy trên sân'
                      : 'Chọn tối đa 2 lá Phép/Bẫy trên sân'}
            </strong>
            <span aria-live="polite">
              Đã chọn {game.selectedTargets.length}/{game.pendingEffect.maxTargets}.
              {game.pendingEffect.minTargets === 0 ? ' Có thể bỏ qua.' : ''}
            </span>
            <button
              className="btn btn--sm"
              disabled={game.selectedTargets.length < game.pendingEffect.minTargets}
              onClick={() => handleAction({ type: 'resolveSelectedEffect' })}
            >
              {game.selectedTargets.length
                ? `Xác nhận ${game.selectedTargets.length} mục tiêu`
                : 'Bỏ qua hiệu ứng'}
            </button>
            {!game.pendingDecision && (
              <button
                className="btn btn--sm"
                onClick={() => handleAction({ type: 'cancelEffect' })}
              >
                Hủy chọn mục tiêu
              </button>
            )}
          </div>
        )}

        <section className="hud hud--bottom">
          {game?.pendingEffect
            && game.effectMode === 'targeted-effect'
            && game.pendingEffect.card?.id !== 's-dicephoon'
            && DRAGGABLE_EFFECT_TARGET_MODES.has(game.pendingEffect.targetMode) && (
            <span className="hud__effect-prompt" role="status" aria-live="polite">
              Kéo lá {game.pendingEffect.card?.name || 'hiệu ứng'} đến mục tiêu.
              {' '}Đã chọn {game.selectedTargets.length}/{game.pendingEffect.maxTargets ?? 'nhiều nhất'}.
              {game.selectedTargets.length > 0
                && (
                  !Number.isInteger(game.pendingEffect.maxTargets)
                  || game.selectedTargets.length < game.pendingEffect.maxTargets
                )
                ? ' Kéo tiếp hoặc nhấn Enter để xác nhận.'
                : ''}
              {!game.pendingDecision ? ' Nhấn Esc để hủy.' : ''}
              {game.pendingEffect.minTargets === 0 && (
                <button
                  className="btn btn--sm"
                  disabled={game.busy}
                  onClick={() => handleAction({ type: 'resolveSelectedEffect' })}
                >
                  {game.selectedTargets.length
                    ? `Xác nhận ${game.selectedTargets.length} mục tiêu`
                    : 'Bỏ qua hiệu ứng'}
                </button>
              )}
            </span>
          )}
          {game?.pendingEffect
            && game.effectMode === 'targeted-effect'
            && !DRAGGABLE_EFFECT_TARGET_MODES.has(game.pendingEffect.targetMode) && (
            ['deck-own-spell', 'mana-dark-magician-girl-summon', 'field-spell-trap', 'field-opponent-spell-trap', 'field-card', 'field-card-any', 'field-opponent-monster', 'hand-spellcaster', 'clone-dragon-field-monster'].includes(game.pendingEffect.targetMode) ? (
              <span className="hud__effect-prompt" role="status">
                {game.pendingEffect.targetMode === 'clone-dragon-field-monster'
                  ? 'Chọn quái thú ngửa để Rồng Vô Tính sao chép hoặc bỏ qua'
                  : game.pendingEffect.targetMode === 'mana-dark-magician-girl-summon'
                  ? 'Thần Quan Mana: có thể Triệu hồi Nữ Phù Thủy Bóng Đêm hoặc bỏ qua'
                  : game.pendingEffect.targetMode === 'deck-own-spell'
                  ? 'Mèo Ma Thuật: bạn có thể thêm Lá Phép từ Bộ bài hoặc bỏ qua'
                  : game.pendingEffect.targetMode === 'field-opponent-monster'
                  ? game.pendingEffect.card?.id === 's-magical-dimension'
                    ? 'Chọn 1 quái thú đối thủ để phá hủy'
                    : game.pendingEffect.card?.id === 'm-lava-golem'
                      ? 'Chọn 2 quái thú đối thủ để Hiến tế'
                      : game.pendingEffect.card?.id === 'm-blue-eyes-alternative-white-dragon'
                        ? 'Chọn 1 quái thú đối thủ để phá hủy'
                        : 'Chọn 1 quái thú đối thủ'
                  : game.pendingEffect.targetMode === 'field-card'
                    ? game.pendingEffect.card?.id === 'm-y-dragon-head'
                      ? 'Chọn ĐẠI BÁC Cannon X ngửa để trang bị Rồng Chữ Y'
                      : 'Chọn 1 lá bài trên sân đối thủ'
                    : game.pendingEffect.targetMode === 'field-card-any'
                      ? 'Chọn 1 lá bài trên sân'
                      : game.pendingEffect.targetMode === 'hand-spellcaster'
                        ? 'Chọn 1 Phù thủy trên tay để Triệu hồi Đặc biệt'
                      : game.pendingEffect.targetMode === 'field-opponent-spell-trap'
                        ? 'Chọn tối đa 2 Lá Phép/Bẫy của đối thủ'
                      : `Chọn tối đa ${game.pendingEffect.maxTargets} lá Phép/Bẫy trên sân`}
              </span>
            ) : game.pendingEffect.targetMode === 'friendly-monster' ? (
              <span className="hud__effect-prompt" role="status">
                {game.pendingEffect.card?.id === 's-magical-dimension'
                  ? 'Quan Tài Của Phù Thủy: chọn quái thú bạn điều khiển để Hiến tế'
                  : 'Chọn quái thú bạn điều khiển'}
              </span>
            ) : <>
              {game.selectedTargets.length > 0 && (
                <button
                  className="btn btn--sm"
                  disabled={
                    game.pendingEffect.targetMode === 'grave-valkyrion'
                      ? !hasCompleteGraveValkyrionMaterialSet(game, game.selectedTargets)
                      : game.pendingEffect.targetMode === 'grave-chaos-emperor'
                        ? !hasCompleteChaosEmperorMaterialSet(
                          game,
                          game.selectedTargets
                        )
                        : game.pendingEffect.targetMode === 'grave-levianeer'
                          ? !hasCompleteLevianeerMaterialSet(
                            game,
                            game.selectedTargets
                          )
                      : false
                  }
                  onClick={() => handleAction({ type: 'resolveSelectedEffect' })}
                >
                  {game.pendingEffect.targetMode === 'grave-valkyrion'
                    ? `Tách hợp thể (${game.selectedTargets.length}/3)`
                    : game.pendingEffect.targetMode === 'grave-chaos-emperor'
                      ? `Triệu hồi Chúa Rồng Hùng Mạnh (${game.selectedTargets.length}/2)`
                      : game.pendingEffect.targetMode === 'grave-levianeer'
                        ? `Triệu hồi Levianeer (${game.selectedTargets.length}/2)`
                    : `Kích hoạt với ${game.selectedTargets.length} mục tiêu`}
                </button>
              )}
              {!game.pendingDecision && (
                <button className="btn btn--sm" onClick={() => handleAction({ type: 'cancelEffect' })}>
                  Hủy chọn mục tiêu
                </button>
              )}
            </>
          )}
          {game?.chain?.status === 'open'
            && game.chain.priority_player === 'player'
            && Boolean(game.chain.response_options?.length) && (
            <div className="duel-chain-notice" role="status" aria-live="polite">
              <div className="duel-chain-notice__title">Chain đang mở</div>
              {game.chain.priority_player === 'player' && (
                <div className="duel-chain-notice__hint">
                  Chọn phản hồi hoặc giải quyết.
                </div>
              )}
              {game.chain.priority_player === 'player' &&
                (game.chain.links?.some((link) => link?.player === 'ai')
                  ? game.chain.response_options?.filter((option) => new Set([
                    't-trap-jammer',
                    't-seven-tools-of-the-bandit',
                    't-solemn-judgment',
                    't-dark-bribe',
                    's-mystical-space-typhoon'
                  ]).has(option.card_id))
                  : game.chain.response_options
                )?.map((option) => {
                  const cards = [
                    ...game.hand.me,
                    ...game.field.me.mon,
                    ...game.field.me.st,
                    ...game.grave.me,
                    ...game.banished.me,
                    ...game.field.opp.mon,
                    ...game.field.opp.st,
                    ...game.grave.opp,
                    ...game.banished.opp
                  ];
                  const sourceCard = cards.find(
                    (card) => card?.instance_id === option.source_instance_id
                  );
                  const targetNames = (option.target_instance_ids || []).map((targetId) => {
                    const targetCard = cards.find((card) => card?.instance_id === targetId);
                    if (targetCard && !targetCard.faceDown && targetCard.name) {
                      return targetCard.name;
                    }
                    const oppStIndex = game.field.opp.st.findIndex(
                      (card) => card?.instance_id === targetId
                    );
                    if (oppStIndex >= 0) return `Bài úp đối thủ (Ô ${oppStIndex + 1})`;
                    const oppMonIndex = game.field.opp.mon.findIndex(
                      (card) => card?.instance_id === targetId
                    );
                    if (oppMonIndex >= 0) return `Quái úp đối thủ (Ô ${oppMonIndex + 1})`;
                    return targetCard?.name || 'Mục tiêu';
                  });
                  return (
                    <button
                      key={`${option.source_instance_id}:${option.effect_id}:${option.target_instance_ids?.join(',') || ''}`}
                      className="btn btn--sm duel-chain-notice__action"
                      disabled={game.busy}
                      onClick={() => activateEffect(
                        option.source_instance_id,
                        option.effect_id,
                        option.target_instance_ids || []
                      )}
                    >
                      {sourceCard?.name || option.card_id}
                      {targetNames.length ? ` · ${targetNames.join(', ')}` : ''}
                    </button>
                  );
                })}
              <button
                className="btn btn--sm duel-chain-notice__resolve"
                disabled={game.busy || game.chain.priority_player !== 'player'}
                onClick={() => handleAction({ type: 'passChain' })}
              >
                Giải quyết
              </button>
            </div>
          )}
          {game?.effectMode === 'discard-for-effect'
            && !trickyDiscardDecision
            && game?.pendingDecision?.type !== 'discard' && (
            <span className="hud__effect-prompt">
              {game.pendingDecision?.type === 'tricky_discard'
                ? 'Tricky: chọn 1 lá khác trên tay để bỏ'
                : game.pendingDecision?.type === 'twin_twisters_discard'
                  ? 'Song Bão: chọn 1 lá trên tay để bỏ làm chi phí'
                : game.pendingDecision?.type === 'burning_dragon_discard'
                  ? 'Rồng Hỏa Diệm: có thể bỏ 1 Lá Phép để phá hủy toàn bộ Phép/Bẫy của đối thủ'
                : game.pendingDecision?.effect_card_id === 's-spell-reproduction'
                  ? 'Sao Chép Ma Thuật: chọn 2 Lá Phép khác trên tay để bỏ'
                  : 'Đá Ma Thuật Phát Sáng: chọn 2 lá khác trên tay để bỏ'}
              {' '}({game.pendingDiscardIds.length}/{game.pendingDiscardCount})
              {game.pendingDecision?.type === 'burning_dragon_discard' && (
                <button
                  className="btn btn--sm"
                  type="button"
                  disabled={game.busy}
                  onClick={() => sendServerAction({ type: 'skip_burning_dragon_effect' })}
                >
                  Bỏ qua
                </button>
              )}
            </span>
          )}
          {game?.turn === 'me'
            && isMainPhase(game.phaseIndex)
            && !game.busy
            && !game.over
            && game.chain?.status === 'closed'
            && !game.pendingEffect
            && !game.whiteStoneEffectUsed
            && game.grave.me.some((card) => card?.id === 'm-blue-eyes-white-dragon')
            && game.grave.me.map((card, index) => (
              card?.id === 'm-the-white-stone-of-ancients' ? (
                <span key={card.instance_id} className="hud__effect-prompt">
                  Bạch Thạch Cổ Đại:
                  <button
                    className="btn btn--sm"
                    aria-label={`Loại bỏ Bạch Thạch Cổ Đại ${index + 1} khỏi Mộ để lấy Rồng Trắng Mắt Xanh`}
                    onClick={() => handleAction({
                      type: 'whiteStoneRecover',
                      sourceInstanceId: card.instance_id
                    })}
                  >
                    Loại bỏ lá này để thêm Rồng Trắng Mắt Xanh lên tay
                  </button>
                </span>
              ) : null
            ))}
          {game?.turn === 'me'
            && isMainPhase(game.phaseIndex)
            && !game.busy
            && !game.over
            && game.chain?.status === 'closed'
            && !game.pendingEffect
            && game.field.me.mon.map((card, index) => (
              card?.id === 'm-time-wizard' && !card.faceDown ? (
                <span key={card.instance_id} className="hud__effect-prompt">
                  Phù Thủy Thời Gian:
                  <button
                    className="btn btn--sm"
                    aria-label={`Tung đồng xu cho Phù Thủy Thời Gian ${index + 1}`}
                    onClick={() => handleAction({
                      type: 'timeWizardEffect',
                      index
                    })}
                  >
                    Tung đồng xu
                  </button>
                </span>
              ) : null
            ))}
          {game?.turn === 'me'
            && isMainPhase(game.phaseIndex)
            && !game.busy
            && !game.over
            && game.chain?.status === 'closed'
            && !game.pendingEffect
            && game.field.me.mon.map((card) => (
              card?.id === 'm-chaos-emperor-dragon-envoy-of-the-end'
                && !card.faceDown ? (
                  <span key={card.instance_id} className="hud__effect-prompt">
                    Chúa Rồng Hùng Mạnh:
                    <button
                      className="btn btn--sm"
                      onClick={() => activateEffect(card.instance_id)}
                    >
                      Trả 1000 LP, gửi tay và sân vào Mộ
                    </button>
                  </span>
                ) : null
            ))}
          {game?.turn === 'me'
            && isMainPhase(game.phaseIndex)
            && !game.busy
            && !game.over
            && game.chain?.status === 'closed'
            && !game.pendingEffect
            && game.field.me.mon.map((card) => (
              canEquipUnionMonster(game, card) ? (
                <span key={card.instance_id} className="hud__effect-prompt">
                  {card.id === 'm-y-dragon-head' ? 'Rồng Chữ Y' : 'Xe Tăng Bọc Thép Z'}:
                  <button
                    className="btn btn--sm"
                    onClick={() => handleAction({
                      type: 'unionEquip',
                      sourceInstanceId: card.instance_id
                    })}
                  >
                    {card.id === 'm-y-dragon-head'
                      ? 'Trang bị cho ĐẠI BÁC Cannon X'
                      : 'Trang bị cho ĐẠI BÁC Cannon X hoặc Rồng Chữ Y'}
                  </button>
                </span>
              ) : null
            ))}
          {game?.turn === 'me'
            && isMainPhase(game.phaseIndex)
            && !game.busy
            && !game.over
            && game.chain?.status === 'closed'
            && !game.pendingEffect
            && game.field.me.st.map((card) => (
              canDetachUnionMonster(game, card) ? (
                <span key={card.instance_id} className="hud__effect-prompt">
                  {card.id === 'm-y-dragon-head' ? 'Rồng Chữ Y' : 'Xe Tăng Bọc Thép Z'}:
                  <button
                    className="btn btn--sm"
                    onClick={() => handleAction({
                      type: 'unionDetach',
                      sourceInstanceId: card.instance_id
                    })}
                  >
                    Tháo trang bị và Triệu hồi Đặc biệt
                  </button>
                </span>
              ) : null
            ))}
          {game?.turn === 'me'
            && isMainPhase(game.phaseIndex)
            && !game.busy
            && !game.over
            && game.chain?.status === 'closed'
            && !game.pendingEffect
            && game.field.me.mon.map((card, index) => (
              card?.id === 'm-blue-eyes-alternative-white-dragon'
                && !card.faceDown
                && game.field.opp.mon.some(Boolean) ? (
                  <span key={card.instance_id} className="hud__effect-prompt">
                    Rồng Trắng Mắt Xanh Thay Thế:
                    <button
                      className="btn btn--sm"
                      aria-label={`Phá hủy quái thú đối thủ bằng Rồng Trắng Mắt Xanh Thay Thế ${index + 1}`}
                      onClick={() => handleAction({
                        type: 'blueEyesAlternativeEffect',
                        index
                      })}
                    >
                      Phá hủy quái thú đối thủ
                    </button>
                  </span>
                ) : null
            ))}
          {game?.turn === 'me'
            && isMainPhase(game.phaseIndex)
            && !game.busy
            && !game.over
            && game.chain?.status === 'closed'
            && !game.pendingEffect
            && game.field.me.mon.map((card, index) => (
              canSplitValkyrion(game, card) ? (
                <span key={card.instance_id} className="hud__effect-prompt">
                  Chiến Binh Kim Loại:
                  <button
                    className="btn btn--sm"
                    onClick={() => handleAction({
                      type: 'valkyrionSplitEffect',
                      index
                    })}
                  >
                    Tách hợp thể
                  </button>
                </span>
              ) : null
            ))}
          <div className="hand">
            {game?.selected != null
              && game?.hand.me[game.selected]?.id === 'm-kaiser-vorse-raider'
              && game.turn === 'me'
              && !game.busy
              && !game.over
              && isMainPhase(game.phaseIndex)
              && game.chain?.status === 'closed'
              && !game.pendingEffect
              && !game.field.me.mon.some(Boolean)
              && (
                <button
                  className="btn btn--sm"
                  onClick={() => handleAction({
                    type: 'kaiserVorseEffect',
                    index: game.selected
                  })}
                >
                  Triệu hồi Đặc biệt Hoàng Đế Raider
                </button>
              )}
            {game?.selected != null
              && game?.hand.me[game.selected]?.id === 'm-blue-eyes-alternative-white-dragon'
              && game.hand.me.some((card) =>
                card.id === 'm-blue-eyes-white-dragon'
                && card.instance_id !== game.hand.me[game.selected].instance_id
              )
              && game.field.me.mon.some((card) => !card)
              && game.turn === 'me'
              && !game.busy
              && !game.over
              && isMainPhase(game.phaseIndex)
              && game.chain?.status === 'closed'
              && !game.pendingEffect
              && (
                <button
                  className="btn btn--sm"
                  onClick={() => handleAction({
                    type: 'blueEyesAlternativeSummon',
                    index: game.selected
                  })}
                >
                  Triệu hồi Đặc biệt (lộ Rồng Trắng Mắt Xanh)
                </button>
              )}
            {game?.selected != null
              && canSummonChaosEmperorFromHand(
                game,
                game?.hand.me[game.selected]
              )
              && game.turn === 'me'
              && !game.busy
              && !game.over
              && isMainPhase(game.phaseIndex)
              && game.chain?.status === 'closed'
              && !game.pendingEffect
              && (
                <button
                  className="btn btn--sm"
                  onClick={() => handleAction({
                    type: 'chaosEmperorSummon',
                    index: game.selected
                  })}
                >
                  Triệu hồi Đặc biệt (loại bỏ 1 ÁNH SÁNG và 1 BÓNG TỐI trong Mộ)
                </button>
              )}
            {game?.selected != null
              && canEquipUnionMonster(game, game?.hand.me[game.selected])
              && game.turn === 'me'
              && !game.busy
              && !game.over
              && isMainPhase(game.phaseIndex)
              && game.chain?.status === 'closed'
              && !game.pendingEffect
              && (
                <button
                  className="btn btn--sm"
                  onClick={() => handleAction({
                    type: 'unionEquip',
                    sourceInstanceId: game.hand.me[game.selected].instance_id
                  })}
                >
                  {game.hand.me[game.selected].id === 'm-y-dragon-head'
                    ? 'Trang bị Rồng Chữ Y cho ĐẠI BÁC Cannon X'
                    : 'Trang bị Xe Tăng Bọc Thép Z cho Cannon X hoặc Rồng Chữ Y'}
                </button>
              )}
            {game?.selected != null
              && canSummonLevianeerFromHand(
                game,
                game?.hand.me[game.selected]
              )
              && game.turn === 'me'
              && !game.busy
              && !game.over
              && isMainPhase(game.phaseIndex)
              && game.chain?.status === 'closed'
              && !game.pendingEffect
              && (
                <button
                  className="btn btn--sm"
                  onClick={() => handleAction({
                    type: 'levianeerSummon',
                    index: game.selected
                  })}
                >
                  Triệu hồi Levianeer (loại bỏ 2 quái thú ÁNH SÁNG/BÓNG TỐI trong Mộ)
                </button>
              )}
            {game?.selected != null
              && game?.hand.me[game.selected]?.id === 'm-lava-golem'
              && game.field.opp.mon.filter(Boolean).length >= 2
              && game.turn === 'me'
              && !game.busy
              && !game.over
              && isMainPhase(game.phaseIndex)
              && game.chain?.status === 'closed'
              && !game.pendingEffect
              && (
                <button
                  className="btn btn--sm"
                  onClick={() => handleAction({
                    type: 'lavaGolemEffect',
                    index: game.selected
                  })}
                >
                  Triệu hồi Người Đá Dung Nham (Hiến tế 2 quái thú đối thủ)
                </button>
              )}
            {game?.selected != null
                && canSummonValkyrionFromHand(game, game?.hand.me[game.selected])
                && game.turn === 'me'
                && !game.busy
                && !game.over
                && isMainPhase(game.phaseIndex)
                && game.chain?.status === 'closed'
                && !game.pendingEffect
                && (
                  <button
                    className="btn btn--sm"
                    onClick={() => handleAction({
                      type: 'valkyrionSummon',
                      index: game.selected
                    })}
                  >
                    Triệu hồi Chiến Binh Kim Loại (Hiến tế Alpha, Beta, Gamma)
                  </button>
                )}
            {game?.turn === 'me'
              && !game.busy
              && !game.over
              && game.chain?.status === 'closed'
              && !game.pendingDecision
              && game.field.me.mon.flatMap((card) =>
                (card?.copy_effect_options || []).map((option) => {
                  const target = option.target_instance_ids?.length
                    ? [
                      ...game.hand.me,
                      ...game.field.me.mon,
                      ...game.field.me.st,
                      ...game.grave.me,
                      ...game.banished.me,
                      ...game.field.opp.mon,
                      ...game.grave.opp,
                      ...game.banished.opp
                    ].find(
                      (candidate) => candidate?.instance_id
                        === option.target_instance_ids[0]
                    )
                    : null;
                  return (
                    <span
                      key={`${option.source_instance_id}:${option.effect_id}:${option.target_instance_ids?.join(',') || ''}`}
                      className="hud__effect-prompt"
                    >
                      {card.name}:
                      <button
                        className="btn btn--sm"
                        disabled={game.busy}
                        onClick={() => activateEffect(
                          option.source_instance_id,
                          option.effect_id,
                          option.target_instance_ids || []
                        )}
                      >
                        Kích hoạt hiệu ứng đã sao chép
                        {target ? ` → ${target.name}` : ''}
                      </button>
                    </span>
                  );
                })
              )}
            <div className="hand__list" data-js="hand-me">
              {game?.ready && !game.hand.me.length && <div className="hand__empty">Tay bài trống</div>}
              {game?.hand.me.map((card, index) => (
                <DuelCard
                  key={`${card.id}-${index}`}
                  card={card}
                  size="sm"
                  handIndex={index}
                  hidden={Boolean(
                    (['spell-trap-place', 'monster-place'].includes(attackDrag?.kind)
                      && attackDrag.sourceInstanceId === card.instance_id)
                    || spellDropChoice?.instanceId === card.instance_id
                    || pendingHandPlacementId === card.instance_id
                  )}
                  selected={
                    game.selected === index
                    || game.pendingDiscardIds.includes(card.instance_id)
                    || game.selectedTargets.includes(card.instance_id)
                  }
                  animation={card._motion?.endsWith('-draw') ? 'draw' : undefined}
                  onClick={() => {
                    if (suppressAttackClickRef.current) return;
                    if (
                      EQUIP_SPELL_CARD_IDS.has(card.id)
                      || HAND_TARGET_DRAG_SPELL_IDS.has(card.id)
                    ) return;
                    if (
                      card.id === 's-lightning-storm'
                      && game.turn === 'me'
                      && !game.busy
                      && !game.over
                      && isMainPhase(game.phaseIndex)
                      && game.chain?.status === 'closed'
                      && !game.pendingEffect
                      && (game.field.opp.mon.some(Boolean) || game.field.opp.st.some(Boolean))
                    ) {
                      dispatch({ type: 'uiClearSelection' });
                      setLightningStormChoiceSourceId(card.instance_id);
                      return;
                    }
                    if (
                      game.effectMode === 'targeted-effect'
                      && DRAGGABLE_EFFECT_TARGET_MODES.has(game.pendingEffect?.targetMode)
                      && game.pendingEffect.sourceInstanceId
                      && card.instance_id === game.pendingEffect.sourceInstanceId
                    ) return;
                    if (
                      card.id === 'm-the-tricky'
                      && game.turn === 'me'
                      && !game.busy
                      && !game.over
                      && !game.pendingDecision
                      && !game.pendingEffect
                      && !game.pendingBattle?.awaitingResolution
                      && game.chain?.status === 'closed'
                      && isMainPhase(game.phaseIndex)
                    ) {
                      const canNormalSummon = getLegalActions(game).some(
                        (action) => action.type === 'normalSummon' && action.handIndex === index
                      );
                      const canSpecialSummon = game.hand.me.length > 1
                        && game.field.me.mon.some((fieldCard) => !fieldCard);
                      if (canNormalSummon || canSpecialSummon) {
                        dispatch({ type: 'uiClearSelection' });
                        setTrickyDiscardSelection('');
                        setTrickyPromptSourceId(card.instance_id);
                        return;
                      }
                    }
                    handleAction({ type: 'select', index });
                  }}
                  onPointerDown={(event) =>
                    startEquipSpellPointer(event, card, event.currentTarget)
                    || startEffectTargetPointer(event, card, event.currentTarget)
                    || startMonsterDragPointer(event, card, event.currentTarget)
                    || startSpellTrapDragPointer(event, card, event.currentTarget)
                  }
                  effectDragSource={
                    canDragEquipSpell(card)
                    || canDragTargetSpell(card)
                    || canDragMonsterCard(card)
                    || canDragSpellTrapCard(card)
                    || (
                      game?.effectMode === 'targeted-effect'
                      && DRAGGABLE_EFFECT_TARGET_MODES.has(game.pendingEffect?.targetMode)
                      && game.pendingEffect.sourceInstanceId
                      && card.instance_id === game.pendingEffect.sourceInstanceId
                    )
                  }
                />
              ))}
            </div>
          </div>
          <div className="slot slot--deck duel-bottom-deck" data-js="deck-me">
            <span className="slot__deck-art" aria-hidden="true"><CardBack /></span>
            <div>
              BỘ BÀI
              <AnimatedDeckCount
                value={game?.deck?.me?.length}
                hand={game?.hand?.me}
                matchId={game?.matchId}
              />
            </div>
          </div>
          <button
            className="btn btn--gold"
            data-js="btn-end"
            aria-label={
              game?.pendingBattle?.awaitingResolution
                ? 'Xác nhận kết quả chiến đấu'
                : game?.phaseIndex === 5
                  ? 'Kết thúc lượt'
                  : 'Chuyển sang giai đoạn tiếp theo'
            }
            title={game?.pendingBattle?.awaitingResolution ? 'Giải quyết chiến đấu ngay' : undefined}
            disabled={!game || game.turn !== 'me' || game.busy || game.over || Boolean(game.pendingEffect) || game.chain?.status === 'open'}
            onClick={() => handleAction({
              type: game?.pendingBattle?.awaitingResolution
                ? 'resolveBattle'
                : 'advancePhase'
            })}
          >
            <span className="duel-phase-button__icon" aria-hidden="true">
              {game?.pendingBattle?.awaitingResolution ? '⚔' : '⏭'}
            </span>
          </button>
        </section>
      </div>

      <audio ref={audioRef} id="duelMusic" preload="auto" aria-hidden="true"></audio>

      {surrenderConfirmOpen && createPortal(
        <div
          className="duel-surrender-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSurrenderConfirmOpen(false);
          }}
        >
          <section
            className="duel-surrender-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Xác nhận chịu thua"
          >
            <p className="duel-surrender-dialog__message">
              Chịu thua xem như chiến đấu thất bại, đồng ý không?
            </p>
            <div className="duel-surrender-dialog__actions">
              <button
                type="button"
                className="duel-surrender-btn duel-surrender-btn--cancel"
                onClick={() => setSurrenderConfirmOpen(false)}
              >
                Hủy
              </button>
              <button
                type="button"
                className="duel-surrender-btn duel-surrender-btn--confirm"
                onClick={async () => {
                  setSurrenderConfirmOpen(false);
                  resultExplosionStartedRef.current = true;
                  try {
                    await playDuelSurrenderExplosion(boardRef.current);
                  } catch (error) {
                    console.error('Không thể phát hiệu ứng nổ đầu hàng:', error);
                  }
                  if (matchId) {
                    try {
                      await fetch('/api/duel/abandon', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ match_id: matchId })
                      });
                    } catch {
                      // ignore abandon errors
                    }
                  }
                  setResultExplosionDone(true);
                  dispatch({
                    type: 'serverSync',
                    game: {
                      ...game,
                      busy: false,
                      over: true,
                      winner: 'opp',
                      lp: { ...game.lp, me: 0 }
                    }
                  });
                }}
              >
                Đồng ý
              </button>
            </div>
          </section>
        </div>,
        document.body
      )}

      <aside className={`log panel${game?.logOpen ? ' is-open' : ''}`} data-js="log">
        <div className="panel__head">📜 Nhật ký trận đấu</div>
        <div className="log__list" data-js="log-list">
          {game?.log.map((entry) => <div key={entry.id} className={`log__line is-${entry.kind}`}><LogMessage message={entry.message} /></div>)}
        </div>
      </aside>

      <DuelResultModal
        open={resultPopupOpen}
        winner={game?.winner}
        lpText={`LP còn lại: ${formatLP(game?.lp.me ?? STARTING_LP)}`}
        onRematch={() => window.location.reload()}
        onExit={() => { window.location.href = 'index.html'; }}
      />

      {trickyPromptSourceId && trickyPromptCard && createPortal(
        <div
          className="duel-tricky-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setTrickyPromptSourceId(null);
          }}
        >
          <section
            className="duel-tricky-dialog duel-tricky-dialog--prompt"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tricky-prompt-title"
          >
            <span className="duel-tricky-dialog__eyebrow">HIỆU ỨNG QUÁI THÚ</span>
            <h2 id="tricky-prompt-title">Chọn cách Triệu hồi Tricky</h2>
            <p>
              Triệu hồi thường cần hiến tế 1 quái thú. Triệu hồi Đặc biệt cần bỏ
              1 lá bài khác trên tay.
            </p>
            <div className="duel-tricky-dialog__actions duel-lightning-dialog__actions">
              <button
                type="button"
                disabled={!canNormalSummonTricky}
                className="duel-tricky-dialog__confirm"
                onClick={() => {
                  const index = game.hand.me.findIndex(
                    (card) => card?.instance_id === trickyPromptSourceId
                  );
                  if (index < 0 || !canNormalSummonTricky) return;
                  setTrickyPromptSourceId(null);
                  handleAction({ type: 'select', index });
                }}
              >
                Triệu hồi thường
              </button>
              <button
                type="button"
                disabled={!canSpecialSummonTricky}
                className="duel-tricky-dialog__confirm"
                onClick={() => {
                  const index = game.hand.me.findIndex(
                    (card) => card?.instance_id === trickyPromptSourceId
                  );
                  if (index < 0 || !canSpecialSummonTricky) return;
                  setTrickyPromptSourceId(null);
                  handleAction({ type: 'theTrickyEffect', index });
                }}
              >
                Triệu hồi đặc biệt
              </button>
            </div>
          </section>
        </div>,
        document.body
      )}

      {lightningStormChoiceSourceId
        && lightningStormChoiceCard
        && canChooseLightningStormMode
        && createPortal(
          <div
            className="duel-tricky-overlay"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setLightningStormChoiceSourceId(null);
              }
            }}
          >
            <section
              className="duel-tricky-dialog duel-lightning-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="lightning-storm-choice-title"
            >
              <span className="duel-tricky-dialog__eyebrow">CHỌN HIỆU ỨNG</span>
              <h2 id="lightning-storm-choice-title">Tia Sét Hủy Diệt</h2>
              <p>Chọn một hiệu ứng để kích hoạt.</p>
              <div className="duel-tricky-dialog__actions duel-lightning-dialog__actions">
                <button
                  type="button"
                  className="duel-tricky-dialog__confirm"
                  onClick={() => {
                    const index = game.hand.me.findIndex(
                      (card) => card?.instance_id === lightningStormChoiceSourceId
                    );
                    setLightningStormChoiceSourceId(null);
                    if (index >= 0) {
                      handleAction({
                        type: 'lightningStormEffect',
                        index,
                        mode: 'destroy_attack_monsters'
                      });
                    }
                  }}
                >
                  Phá quái thú ngửa Công kích
                </button>
                <button
                  type="button"
                  className="duel-tricky-dialog__confirm"
                  onClick={() => {
                    const index = game.hand.me.findIndex(
                      (card) => card?.instance_id === lightningStormChoiceSourceId
                    );
                    setLightningStormChoiceSourceId(null);
                    if (index >= 0) {
                      handleAction({
                        type: 'lightningStormEffect',
                        index,
                        mode: 'destroy_spell_traps'
                      });
                    }
                  }}
                >
                  Phá Lá Phép/Bẫy
                </button>
              </div>
            </section>
          </div>,
          document.body
        )}

      {blizzardPromptSourceId && game?.field?.opp?.mon && createPortal(
        <div
          className="duel-tricky-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setBlizzardPromptSourceId(null);
              setBlizzardTargetSelection('');
            }
          }}
        >
          <section
            className="duel-tricky-dialog duel-tricky-dialog--discard"
            role="dialog"
            aria-modal="true"
            aria-labelledby="blizzard-target-title"
          >
            <span className="duel-tricky-dialog__eyebrow">RỒNG BĂNG GIÁ</span>
            <h2 id="blizzard-target-title">Chọn 1 quái thú đối thủ</h2>
            <p>Chọn 1 quái thú trên sân đối thủ để đóng băng và khóa tấn công.</p>
            <div className="duel-tricky-dialog__cards">
              {(game.field.opp.mon || []).map((oppCard, index) => {
                if (!oppCard?.instance_id) return null;
                const selected = oppCard.instance_id === blizzardTargetSelection;
                const displayName = oppCard.faceDown
                  ? `Quái thú úp (Ô ${index + 1})`
                  : oppCard.name;
                return (
                  <button
                    key={oppCard.instance_id}
                    type="button"
                    className={`duel-tricky-dialog__card${selected ? ' is-selected' : ''}`}
                    aria-label={`Chọn ${displayName}`}
                    aria-pressed={selected}
                    onClick={() => setBlizzardTargetSelection(
                      selected ? '' : oppCard.instance_id
                    )}
                  >
                    <DuelCard card={oppCard} size="sm" selected={selected} />
                    <span>{displayName}</span>
                  </button>
                );
              })}
            </div>
            <div className="duel-tricky-dialog__actions">
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => {
                  setBlizzardPromptSourceId(null);
                  setBlizzardTargetSelection('');
                }}
              >
                Hủy
              </button>
              <button
                type="button"
                className="duel-tricky-dialog__confirm"
                disabled={!blizzardTargetSelection || game.busy}
                onClick={() => {
                  if (!blizzardTargetSelection || !blizzardPromptSourceId) return;
                  const sourceId = blizzardPromptSourceId;
                  const targetId = blizzardTargetSelection;
                  setBlizzardPromptSourceId(null);
                  setBlizzardTargetSelection('');
                  activateEffect(sourceId, 'activate', [targetId]);
                }}
              >
                OK
              </button>
            </div>
          </section>
        </div>,
        document.body
      )}

      {trickyDiscardDecision && createPortal(
        <div className="duel-tricky-overlay">
          <section
            className="duel-tricky-dialog duel-tricky-dialog--discard"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tricky-discard-title"
          >
            <span className="duel-tricky-dialog__eyebrow">CHI PHÍ TRIỆU HỒI</span>
            <h2 id="tricky-discard-title">Chọn 1 lá bài để bỏ</h2>
            <p>Chọn một lá trên tay, không bao gồm Tricky.</p>
            <div className="duel-tricky-dialog__cards">
              {trickyDiscardCards.map((card) => {
                const selected = card.instance_id === trickyDiscardSelection;
                return (
                  <button
                    key={card.instance_id}
                    type="button"
                    className={`duel-tricky-dialog__card${selected ? ' is-selected' : ''}`}
                    aria-label={`Chọn ${card.name} để bỏ`}
                    aria-pressed={selected}
                    onClick={() => setTrickyDiscardSelection(
                      selected ? '' : card.instance_id
                    )}
                  >
                    <DuelCard card={card} size="sm" selected={selected} />
                    <span>{card.name}</span>
                  </button>
                );
              })}
            </div>
            <div className="duel-tricky-dialog__actions">
              <span className="duel-tricky-dialog__selection" role="status">
                {selectedTrickyDiscard
                  ? `Bỏ: ${selectedTrickyDiscard.name}`
                  : 'Chưa chọn lá bài'}
              </span>
              <button
                type="button"
                className="duel-tricky-dialog__confirm"
                disabled={!selectedTrickyDiscard || game.busy}
                onClick={() => {
                  if (!selectedTrickyDiscard) return;
                  const instanceId = selectedTrickyDiscard.instance_id;
                  setTrickyDiscardSelection('');
                  sendServerAction({
                    type: 'complete_discard',
                    instance_ids: [instanceId]
                  });
                }}
              >
                OK
              </button>
            </div>
          </section>
        </div>,
        document.body
      )}

      {gracefulDiscardDecision && createPortal(
        <div className="duel-tricky-overlay">
          <section
            className="duel-tricky-dialog duel-tricky-dialog--discard"
            role="dialog"
            aria-modal="true"
            aria-labelledby="graceful-discard-title"
          >
            <span className="duel-tricky-dialog__eyebrow">MÓN QUÀ TỪ THIÊN THẦN</span>
            <h2 id="graceful-discard-title">
              Chọn {gracefulDiscardTargetCount} lá bài để bỏ
            </h2>
            <p>
              Chọn {gracefulDiscardTargetCount} lá trên tay để bỏ xuống Mộ (
              {selectedGracefulDiscardCards.length}/{gracefulDiscardTargetCount}).
            </p>
            <div className="duel-tricky-dialog__cards">
              {gracefulDiscardCards.map((card) => {
                const selected = gracefulDiscardSelection.includes(card.instance_id);
                return (
                  <button
                    key={card.instance_id}
                    type="button"
                    className={`duel-tricky-dialog__card${selected ? ' is-selected' : ''}`}
                    aria-label={`Chọn ${card.name} để bỏ`}
                    aria-pressed={selected}
                    onClick={() => setGracefulDiscardSelection((prev) => {
                      if (prev.includes(card.instance_id)) {
                        return prev.filter((id) => id !== card.instance_id);
                      }
                      if (prev.length >= gracefulDiscardTargetCount) return prev;
                      return [...prev, card.instance_id];
                    })}
                  >
                    <DuelCard card={card} size="sm" selected={selected} />
                    <span>{card.name}</span>
                  </button>
                );
              })}
            </div>
            <div className="duel-tricky-dialog__actions">
              <span className="duel-tricky-dialog__selection" role="status">
                {selectedGracefulDiscardCards.length
                  ? `Bỏ (${selectedGracefulDiscardCards.length}/${gracefulDiscardTargetCount}): ${selectedGracefulDiscardCards.map((card) => card.name).join(', ')}`
                  : `Chưa chọn đủ ${gracefulDiscardTargetCount} lá bài`}
              </span>
              <button
                type="button"
                className="duel-tricky-dialog__confirm"
                disabled={
                  selectedGracefulDiscardCards.length !== gracefulDiscardTargetCount
                  || game.busy
                }
                onClick={() => {
                  if (selectedGracefulDiscardCards.length !== gracefulDiscardTargetCount) {
                    return;
                  }
                  const instanceIds = selectedGracefulDiscardCards.map(
                    (card) => card.instance_id
                  );
                  setGracefulDiscardSelection([]);
                  sendServerAction({
                    type: 'complete_discard',
                    instance_ids: instanceIds
                  });
                }}
              >
                OK
              </button>
            </div>
          </section>
        </div>,
        document.body
      )}
      {monsterDropChoice && createPortal(
        (() => {
          const requiredTributes = getRequiredTributes(monsterDropChoice.card);
          const selectedTributeIndexes = monsterDropChoice.tributeIndexes || [];
          const tributesReady = selectedTributeIndexes.length === requiredTributes;
          const isGodCard = GOD_MONSTER_IDS.has(monsterDropChoice.card?.id);
          const isHorakhty = monsterDropChoice.card?.id === HORAKHTY_ID;
          const submitMonsterDrop = (mode) => {
            if (!tributesReady || game?.busy) return;
            const tributeInstanceIds = selectedTributeIndexes
              .map((slotIndex) => game?.field?.me?.mon?.[slotIndex]?.instance_id)
              .filter(Boolean);
            const { instanceId, zoneIndex } = monsterDropChoice;
            setMonsterDropChoice(null);
            setPendingHandPlacementId(instanceId);
            if (mode === 'set') {
              sendServerAction({
                type: 'set_card',
                instance_id: instanceId,
                zone_index: zoneIndex,
                tribute_instance_ids: tributeInstanceIds
              });
            } else {
              sendServerAction({
                type: 'summon',
                instance_id: instanceId,
                zone_index: zoneIndex,
                position: mode,
                tribute_instance_ids: tributeInstanceIds
              });
            }
          };

          return (
            <div
              className="duel-monster-drop-bar"
              role="dialog"
              aria-label={`Chọn thế triệu hồi cho ${monsterDropChoice.card?.name || 'quái thú'}`}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="duel-monster-drop-bar__header">
                <span>{monsterDropChoice.card?.name}</span>
                {requiredTributes > 0 && (
                  <span className="duel-monster-drop-bar__tribute-hint">
                    Hiến tế: {selectedTributeIndexes.length}/{requiredTributes}
                    {!tributesReady ? ' (chọn thêm quái thú trên sân)' : ''}
                  </span>
                )}
              </div>
              <div className="duel-monster-drop-bar__actions">
                <button
                  type="button"
                  className="btn btn--sm btn--gold duel-monster-drop-bar__btn"
                  disabled={!tributesReady || game?.busy}
                  onClick={() => submitMonsterDrop('attack')}
                >
                  Thế Công
                </button>
                <button
                  type="button"
                  className="btn btn--sm btn--gold duel-monster-drop-bar__btn"
                  disabled={!tributesReady || isHorakhty || game?.busy}
                  onClick={() => submitMonsterDrop('defense')}
                >
                  Thế Thủ
                </button>
                <button
                  type="button"
                  className="btn btn--sm duel-monster-drop-bar__btn"
                  disabled={!tributesReady || isGodCard || game?.busy}
                  title={isGodCard ? 'Quái thú Thần không thể đặt úp' : undefined}
                  onClick={() => submitMonsterDrop('set')}
                >
                  Thế Thủ Úp
                </button>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => setMonsterDropChoice(null)}
                >
                  Hủy
                </button>
              </div>
            </div>
          );
        })(),
        document.body
      )}

    </>
  );
}

export default DuelPage;
