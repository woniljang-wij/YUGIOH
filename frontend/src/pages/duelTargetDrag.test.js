import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EQUIP_SPELL_CARD_IDS,
  getEquipSpellTarget,
  getFieldEffectTarget
} from './duelTargetDrag.js';

function createGame(targetMode, meMonster = null, oppMonster = null, oppSpellTrap = null) {
  return {
    effectMode: 'targeted-effect',
    pendingEffect: { targetMode, card: { id: 's-targeting-card' } },
    field: {
      me: { mon: [meMonster], st: [null] },
      opp: { mon: [oppMonster], st: [oppSpellTrap] }
    }
  };
}

test('allows only occupied opponent Spell/Trap zones for opponent backrow targeting', () => {
  const target = { instance_id: 'trap-1' };
  const game = createGame('field-opponent-spell-trap', null, null, target);

  assert.equal(getFieldEffectTarget(game, 'opp', 'st', 0)?.instanceId, 'trap-1');
  assert.equal(getFieldEffectTarget(game, 'me', 'st', 0), null);
  assert.equal(getFieldEffectTarget(game, 'opp', 'mon', 0), null);
  assert.equal(getFieldEffectTarget(game, 'opp', 'st', 1), null);
});

test('honors target-side and server-provided eligible target restrictions', () => {
  const target = { instance_id: 'monster-1' };
  const game = createGame('field-card-any', target);
  game.pendingEffect.targetSide = 'me';
  game.pendingDecision = { eligible_target_instance_ids: ['other-monster'] };

  assert.equal(getFieldEffectTarget(game, 'me', 'mon', 0), null);
  game.pendingDecision.eligible_target_instance_ids = ['monster-1'];
  assert.equal(getFieldEffectTarget(game, 'me', 'mon', 0)?.instanceId, 'monster-1');
  assert.equal(getFieldEffectTarget(game, 'opp', 'mon', 0), null);
});

test('rejects invalid face-down or Union targets', () => {
  const faceDownMonster = { instance_id: 'monster-1', faceDown: true };
  const multiplyGame = createGame('field-opponent-monster', null, faceDownMonster);
  multiplyGame.pendingEffect.card = { id: 's-multiply' };
  assert.equal(getFieldEffectTarget(multiplyGame, 'opp', 'mon', 0), null);

  const unionGame = createGame('friendly-monster', { instance_id: 'monster-2', id: 'm-other-monster' });
  unionGame.pendingEffect.card = { id: 'm-y-dragon-head' };
  assert.equal(getFieldEffectTarget(unionGame, 'me', 'mon', 0), null);
});

test('allows Change of Heart to drag any opposing monster but Brain Control only face-up targets', () => {
  const faceDownMonster = { instance_id: 'monster-1', faceDown: true };
  const changeOfHeartGame = createGame('field-opponent-monster', null, faceDownMonster);
  changeOfHeartGame.pendingEffect.card = { id: 's-change-of-heart' };
  assert.equal(
    getFieldEffectTarget(changeOfHeartGame, 'opp', 'mon', 0)?.instanceId,
    'monster-1'
  );
  changeOfHeartGame.field.me.mon[0] = { instance_id: 'occupied-zone' };
  assert.equal(getFieldEffectTarget(changeOfHeartGame, 'opp', 'mon', 0), null);

  const brainControlGame = createGame(
    'field-opponent-monster',
    null,
    { instance_id: 'monster-2', faceDown: false }
  );
  brainControlGame.pendingEffect.card = { id: 's-brain-control' };
  assert.equal(getFieldEffectTarget(brainControlGame, 'opp', 'mon', 0)?.instanceId, 'monster-2');
  brainControlGame.field.opp.mon[0].faceDown = true;
  assert.equal(getFieldEffectTarget(brainControlGame, 'opp', 'mon', 0), null);
  brainControlGame.field.opp.mon[0].faceDown = false;
  brainControlGame.field.me.mon[0] = { instance_id: 'occupied-zone' };
  assert.equal(getFieldEffectTarget(brainControlGame, 'opp', 'mon', 0), null);
});

test('requires a server-approved face-up monster for Clone Dragon', () => {
  const game = createGame('clone-dragon-field-monster', { instance_id: 'monster-1' });
  game.pendingDecision = { eligible_target_instance_ids: ['monster-1'] };

  assert.equal(getFieldEffectTarget(game, 'me', 'mon', 0)?.instanceId, 'monster-1');
  game.pendingDecision.eligible_target_instance_ids = [];
  assert.equal(getFieldEffectTarget(game, 'me', 'mon', 0), null);
});

test('allows Equip Spells to target face-up monsters and preserves Magic Formula restrictions', () => {
  const game = {
    field: {
      me: {
        mon: [
          { instance_id: 'player-monster', id: 'm-generic', category: 'monster' },
          {
            instance_id: 'dark-magician',
            id: 'm-dark-magician',
            category: 'monster'
          },
          {
            instance_id: 'dark-magician-girl',
            id: 'm-dark-magician-girl',
            category: 'monster'
          },
          {
            instance_id: 'face-down-monster',
            id: 'm-hidden',
            category: 'monster',
            faceDown: true
          }
        ]
      },
      opp: {
        mon: [{ instance_id: 'opponent-monster', id: 'm-opponent', category: 'fusion' }]
      }
    }
  };
  for (const id of EQUIP_SPELL_CARD_IDS) {
    if (id === 's-magic-formula') {
      assert.equal(getEquipSpellTarget(game, { id }, 'opp', 'mon', 0), null);
      continue;
    }
    assert.equal(getEquipSpellTarget(game, { id }, 'opp', 'mon', 0)?.instanceId, 'opponent-monster');
    assert.equal(getEquipSpellTarget(game, { id }, 'me', 'mon', 3), null);
    assert.equal(getEquipSpellTarget(game, { id }, 'me', 'st', 0), null);
  }
  assert.equal(
    getEquipSpellTarget(
      game,
      { id: 's-magic-formula' },
      'me',
      'mon',
      1
    )?.instanceId,
    'dark-magician'
  );
  assert.equal(
    getEquipSpellTarget(game, { id: 's-magic-formula' }, 'me', 'mon', 0),
    null
  );
});
