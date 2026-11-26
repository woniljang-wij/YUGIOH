export const DUEL_PHASES = Object.freeze([
  'draw',
  'standby',
  'main1',
  'battle',
  'main2',
  'end'
]);

export const STARTING_LP = 8000;
export const MAX_FIELD_ZONES = 5;
export const MAX_END_PHASE_HAND_SIZE = 6;

const GOD_IDS = new Set([
  'm-slifer-the-sky-dragon',
  'm-obelisk-the-tormentor',
  'm-the-winged-dragon-of-ra'
]);
const HORAKHTY_ID = 'm-the-creator-god-of-light-horakhty';
const GOD_TRIBUTE_IDS = new Set(GOD_IDS);

function cardCategory(card) {
  return String(card?.category || card?.type || '').toLowerCase();
}

function isDragon(card) {
  const race = String(card?.race || card?.monsterType || '').toLowerCase();
  return race.includes('rồng') || race.includes('dragon');
}

function numericStat(value, statName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new TypeError(`${statName} must be a non-negative number.`);
  }
  return parsed;
}

export function getRequiredTributes(card) {
  if (GOD_IDS.has(String(card?.id))) return 3;
  const level = Number(card?.level ?? card?.lv);
  if (!Number.isFinite(level) || level < 1) return 0;
  if (level <= 4) return 0;
  if (level <= 6) return 1;
  if (level <= 9) return 2;
  return 3;
}

export function getTributeValue(card, summonTarget, required = getRequiredTributes(summonTarget)) {
  if (cardCategory(card) === 'fusion') return 2;
  if (required < 2) return 1;
  const targetAttribute = String(summonTarget?.attribute || '').toUpperCase();
  // Hoàng Đế Hải Mã: tính là 2 vật tế cho quái thú LIGHT.
  if (card?.id === 'm-kaiser-seahorse' && targetAttribute === 'LIGHT') return 2;
  // Thây Ma Song Sinh: tính là 2 vật tế cho quái thú DARK.
  if (card?.id === 'm-double-coston' && targetAttribute === 'DARK') return 2;
  return 1;
}

export function canBeTargetedByEffects(card) {
  return card?.id !== 'm-obelisk-the-tormentor';
}

export function hasFaceUpOpponentMonster(game) {
  return Boolean(game?.field?.opp?.mon?.some((monster) => monster && !monster.faceDown));
}

export function validateTributes(cards, required, summonTarget) {
  if (!Array.isArray(cards) || !Number.isInteger(required) || required < 0) {
    return { valid: false, value: 0 };
  }
  const validCards = cards.filter(Boolean);
  const value = validCards.reduce(
    (sum, card) => sum + getTributeValue(card, summonTarget, required),
    0
  );
  return { valid: value === required, value };
}

function getTributeCombinations(fieldMonsters, required, summonTarget) {
  const combinations = [];
  function collect(start, selected, value) {
    if (value === required) {
      combinations.push(selected);
      return;
    }
    if (value > required) return;
    for (let index = start; index < fieldMonsters.length; index += 1) {
      const card = fieldMonsters[index];
      if (!card) continue;
      collect(
        index + 1,
        [...selected, index],
        value + getTributeValue(card, summonTarget, required)
      );
    }
  }
  collect(0, [], 0);
  return combinations;
}

function horakhtyTributes(fieldMonsters) {
  const selected = fieldMonsters
    .map((card, index) => GOD_TRIBUTE_IDS.has(card?.id) ? { card, index } : null)
    .filter(Boolean);
  if (selected.length !== 3 || new Set(selected.map(({ card }) => card.id)).size !== 3) return [];
  return [selected.map(({ index }) => index)];
}

export function getLegalActions(state, player = state?.turn) {
  if (
    !state
    || !state.ready
    || state.over
    || state.busy
    || !state.lp
    || !['me', 'opp'].includes(player)
    || state.turn !== player
  ) return [];

  const phase = DUEL_PHASES[state.phaseIndex];
  if (!phase) return [];
  const firstPlayer = state.firstPlayer || 'me';
  const hand = state.hand[player] || [];
  const field = state.field[player];
  const opponent = state.field[player === 'me' ? 'opp' : 'me'];
  const dragonCaptureJarActive = ['me', 'opp'].some((owner) =>
    state.field[owner].st.some((card) => card?.id === 't-dragon-capture-jar' && !card.faceDown)
  );
  const legal = [];

  if (phase === 'draw') {
    if (player === firstPlayer && state.turnCount === 1) {
      legal.push({ type: 'advancePhase' });
    } else if (state.drawnThisTurn) {
      legal.push({ type: 'advancePhase' });
    } else if (state.deck[player]?.length) {
      legal.push({ type: 'draw' });
    }
    return legal;
  }

  if (phase === 'standby') return [{ type: 'advancePhase' }];

  if (phase === 'end') {
    if (hand.length > MAX_END_PHASE_HAND_SIZE) {
      hand.forEach((card, index) => legal.push({ type: 'discard', handIndex: index, cardId: card.id }));
    } else {
      legal.push({ type: 'endTurn' });
    }
    return legal;
  }

  if (phase === 'main1' || phase === 'main2') {
    legal.push({ type: 'advancePhase' });
    const freeZones = field.mon
      .map((card, index) => card ? -1 : index)
      .filter((index) => index >= 0);

    hand.forEach((card, handIndex) => {
      if (card.type !== 'monster' || card.category === 'fusion') return;
      const isHorakhty = card.id === HORAKHTY_ID;
      if (!isHorakhty && state.normalSummonUsed[player]) return;

      const tributeSets = isHorakhty
        ? horakhtyTributes(field.mon)
        : getTributeCombinations(
          field.mon,
          getRequiredTributes(card),
          card
        );
      for (const tributeIndexes of tributeSets) {
        const remainingMonsterCount = field.mon.filter(Boolean).length - tributeIndexes.length;
        if (remainingMonsterCount >= MAX_FIELD_ZONES) continue;
        const summonZones = [...new Set([...freeZones, ...tributeIndexes])];
        if (!summonZones.length) continue;
        if (isHorakhty) {
          for (const zoneIndex of summonZones) {
            legal.push({
              type: 'specialSummon',
              handIndex,
              cardId: card.id,
              tributeIndexes: tributeIndexes.slice(),
              zoneIndex
            });
          }
          continue;
        }
        for (const zoneIndex of summonZones) {
          legal.push({
            type: 'normalSummon',
            handIndex,
            cardId: card.id,
            tributeIndexes: tributeIndexes.slice(),
            zoneIndex,
            position: 'attack'
          });
          if (!GOD_IDS.has(card.id)) {
            legal.push({
              type: 'setMonster',
              handIndex,
              cardId: card.id,
              tributeIndexes: tributeIndexes.slice(),
              zoneIndex,
              position: 'defense'
            });
          }
        }
      }
    });

    field.mon.forEach((card, index) => {
      if (
        card
        && !card.faceDown
        && (card.summonedTurn !== state.turnCount || card.allowPositionChangeOnSummonTurn)
        && card.flipSummonedTurn !== state.turnCount
        && card.positionChangedTurn !== state.turnCount
        && !card.cannotChangePosition
        && !(dragonCaptureJarActive && isDragon(card))
      ) {
        legal.push({ type: 'changePosition', monsterIndex: index });
      }
      if (card?.id === 'm-obelisk-the-tormentor') {
        const tributableIndexes = field.mon
          .map((monster, tributeIndex) => monster ? tributeIndex : -1)
          .filter((tributeIndex) => tributeIndex >= 0);
        for (let first = 0; first < tributableIndexes.length; first += 1) {
          for (let second = first + 1; second < tributableIndexes.length; second += 1) {
            legal.push({
              type: 'activateObelisk',
              sourceIndex: index,
              tributeIndexes: [tributableIndexes[first], tributableIndexes[second]]
            });
          }
        }
      }
      if (card?.id === 'm-the-winged-dragon-of-ra') {
        if (
          card.summonMethod === 'tribute'
          && card.summonedTurn === state.turnCount
          && !card.raBoostUsed
          && state.lp[player] > 100
        ) {
          legal.push({ type: 'activateRaBoost', sourceIndex: index });
        }
        if (state.lp[player] >= 1000) {
          opponent.mon.forEach((target, targetIndex) => {
            if (target && canBeTargetedByEffects(target)) {
              legal.push({ type: 'activateRaDestruction', sourceIndex: index, targetIndex });
            }
          });
        }
      }
    });
    return legal;
  }

  if (phase === 'battle') {
    if (player === firstPlayer && state.turnCount === 1) {
      legal.push({ type: 'advancePhase' });
      return legal;
    }
    const opposingMonsters = opponent.mon.filter(Boolean);
    const opponentHasSwords = opponent.st.some(
      (card) => card?.id === 's-swords-of-revealing-light' && !card.faceDown
    );
    const opponentHasGravityBind = opponent.st.some(
      (card) => card?.id === 't-gravity-bind' && !card.faceDown
    );
    field.mon.forEach((card, attackerIndex) => {
      if (
        !card
        || (player === 'opp' && opponentHasSwords)
        || card.faceDown
        || card.position === 'defense'
        || card.cannotAttack
        || (opponentHasGravityBind && Number(card.level ?? card.lv) >= 4)
        || card.cannotAttackTurn === state.turnCount
        || card.flipSummonedTurn === state.turnCount
        || (state.attacked[player] || []).includes(attackerIndex)
      ) return;
      if (opposingMonsters.length) {
        opponent.mon.forEach((target, targetIndex) => {
          if (target) legal.push({ type: 'attack', attackerIndex, targetIndex });
        });
      } else {
        legal.push({ type: 'attack', attackerIndex, targetIndex: null, direct: true });
      }
    });
    legal.push({ type: 'advancePhase' });
  }
  return legal;
}

export function calculateBattle(attacker, defender, defenderPosition) {
  const attack = numericStat(attacker?.atk, 'ATK');
  const defensePosition = defenderPosition === 'defense'
    || defenderPosition === 'def'
    || defender?.faceDown
    || defender?.position === 'defense';
  const opponentStat = numericStat(
    defensePosition ? defender?.def : defender?.atk,
    defensePosition ? 'DEF' : 'ATK'
  );
  // m-marshmallon and m-celtic-guardian — apply their battle-destruction immunity.
  const attackerProtected = attacker?.id === 'm-marshmallon'
    || (attacker?.id === 'm-celtic-guardian' && numericStat(defender?.atk, 'ATK') >= 1900);
  const defenderProtected = defender?.id === 'm-marshmallon'
    || (defender?.id === 'm-celtic-guardian' && attack >= 1900);
  // m-lancer-lindwurm — inflicts piercing damage when it attacks Defense Position.
  const piercing = attacker?.id === 'm-lancer-lindwurm';

  if (defensePosition) {
    if (attack > opponentStat) {
      return {
        destroyed: defenderProtected ? [] : ['defender'],
        damage: { attacker: 0, defender: piercing ? attack - opponentStat : 0 }
      };
    }
    if (attack < opponentStat) {
      return { destroyed: [], damage: { attacker: opponentStat - attack, defender: 0 } };
    }
    return { destroyed: [], damage: { attacker: 0, defender: 0 } };
  }

  if (attack > opponentStat) {
    return {
      destroyed: defenderProtected ? [] : ['defender'],
      damage: { attacker: 0, defender: attack - opponentStat }
    };
  }
  if (attack < opponentStat) {
    return {
      destroyed: attackerProtected ? [] : ['attacker'],
      damage: { attacker: opponentStat - attack, defender: 0 }
    };
  }
  return {
    destroyed: [
      ...(attackerProtected ? [] : ['attacker']),
      ...(defenderProtected ? [] : ['defender'])
    ],
    damage: { attacker: 0, defender: 0 }
  };
}

export function calculateDirectAttack(attacker, opposingMonsters) {
  if (opposingMonsters.some(Boolean)) {
    return { legal: false, damage: 0 };
  }
  return { legal: true, damage: numericStat(attacker?.atk, 'ATK') };
}

export function getSliferStats(card, handSize) {
  if (card?.id !== 'm-slifer-the-sky-dragon') return null;
  if (!Number.isInteger(handSize) || handSize < 0) {
    throw new TypeError('handSize must be a non-negative integer.');
  }
  return { atk: handSize * 1000, def: handSize * 1000 };
}

export function applySliferSummonEffect(monster, position) {
  const defensePosition = position === 'defense' || position === 'def' || monster?.faceDown;
  const stat = defensePosition ? 'def' : 'atk';
  const current = numericStat(monster?.[stat], stat.toUpperCase());
  const reduced = Math.max(0, current - 2000);
  return {
    monster: { ...monster, [stat]: reduced },
    destroyed: reduced === 0,
    stat
  };
}

export function calculateRaTributeStats(tributes) {
  if (!Array.isArray(tributes) || tributes.length !== 3) {
    throw new TypeError('Ra requires exactly three tribute monsters.');
  }
  return tributes.reduce((stats, card) => ({
    atk: stats.atk + numericStat(card?.atk, 'ATK'),
    def: stats.def + numericStat(card?.def, 'DEF')
  }), { atk: 0, def: 0 });
}

export function calculateRaLifePointBoost(currentLP) {
  if (!Number.isInteger(currentLP) || currentLP <= 100) {
    throw new RangeError('Ra requires more than 100 LP to pay for the boost.');
  }
  const paid = currentLP - 100;
  return { remainingLP: 100, atkBoost: paid, defBoost: paid };
}

export function applyLifePointChange(state, player, amount) {
  if (!state?.lp || !Object.prototype.hasOwnProperty.call(state.lp, player)) {
    throw new TypeError('A valid duel state and player are required.');
  }
  if (!Number.isInteger(amount) || amount < 0) {
    throw new TypeError('LP damage must be a non-negative integer.');
  }
  const nextLP = Math.max(0, state.lp[player] - amount);
  const lp = { ...state.lp, [player]: nextLP };
  return {
    ...state,
    lp,
    over: nextLP === 0,
    winner: nextLP === 0 ? (player === 'me' ? 'opp' : 'me') : state.winner
  };
}
