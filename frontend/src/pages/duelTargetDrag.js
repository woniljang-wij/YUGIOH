export const DRAGGABLE_EFFECT_TARGET_MODES = new Set([
  'field-spell-trap',
  'field-opponent-spell-trap',
  'field-card',
  'field-card-any',
  'field-opponent-monster',
  'friendly-monster',
  'clone-dragon-field-monster'
]);

export const EQUIP_SPELL_CARD_IDS = new Set([
  's-horn-of-the-unicorn',
  's-magic-formula',
  's-butterfly-dagger-elma',
  's-mask-of-the-accursed',
  's-sword-of-deep-seated'
]);

export function getEquipSpellTarget(game, sourceCard, who, kind, index) {
  if (
    !EQUIP_SPELL_CARD_IDS.has(sourceCard?.id)
    || !['me', 'opp'].includes(who)
    || kind !== 'mon'
  ) return null;
  const card = game?.field?.[who]?.mon?.[index];
  if (
    !card?.instance_id
    || card.faceDown
    || !['monster', 'fusion'].includes(
      String(card.category || card.type || '').toLowerCase()
    )
  ) return null;
  if (
    sourceCard.id === 's-magic-formula'
    && !['m-dark-magician', 'm-dark-magician-girl'].includes(card.id)
  ) return null;

  return {
    card,
    instanceId: card.instance_id,
    zoneKey: `${who}-${kind}-${index}`
  };
}

export function getFieldEffectTarget(game, who, kind, index) {
  const pendingEffect = game?.pendingEffect;
  const targetMode = pendingEffect?.targetMode;
  if (
    game?.effectMode !== 'targeted-effect'
    || !DRAGGABLE_EFFECT_TARGET_MODES.has(targetMode)
    || !['me', 'opp'].includes(who)
    || !['mon', 'st'].includes(kind)
  ) return null;

  const card = game.field[who][kind][index];
  if (!card?.instance_id || (pendingEffect.targetSide && who !== pendingEffect.targetSide)) {
    return null;
  }

  const eligibleIds = game.pendingDecision?.eligible_target_instance_ids;
  if (Array.isArray(eligibleIds) && !eligibleIds.includes(card.instance_id)) return null;
  if (
    targetMode === 'clone-dragon-field-monster'
    && (!Array.isArray(eligibleIds) || !eligibleIds.includes(card.instance_id))
  ) return null;

  if (targetMode === 'field-opponent-spell-trap' && (who !== 'opp' || kind !== 'st')) {
    return null;
  }
  if (targetMode === 'field-opponent-monster' && (who !== 'opp' || kind !== 'mon')) {
    return null;
  }
  if (
    targetMode === 'field-opponent-monster'
    && ['s-change-of-heart', 's-brain-control'].includes(pendingEffect.card?.id)
    && !game.field.me.mon.some((monster) => !monster)
  ) return null;
  if (
    targetMode === 'field-opponent-monster'
    && pendingEffect.card?.id === 's-brain-control'
    && card.faceDown
  ) return null;
  if (targetMode === 'field-spell-trap' && kind !== 'st') return null;
  if (
    ['field-card', 'field-card-any'].includes(targetMode)
    && !card.instance_id
  ) return null;
  if (targetMode === 'friendly-monster' && (who !== 'me' || kind !== 'mon')) {
    return null;
  }
  if (
    targetMode === 'clone-dragon-field-monster'
    && (kind !== 'mon' || card.faceDown)
  ) return null;

  if (
    pendingEffect.card?.id === 's-multiply'
    && (card.id !== 'm-kuriboh' || card.faceDown)
  ) return null;

  const unionTargets = pendingEffect.card?.id === 'm-y-dragon-head'
    ? ['m-x-head-cannon']
    : pendingEffect.card?.id === 'm-z-metal-tank'
      ? ['m-x-head-cannon', 'm-y-dragon-head']
      : null;
  if (
    unionTargets
    && (
      who !== 'me'
      || kind !== 'mon'
      || !unionTargets.includes(card.id)
      || card.faceDown
    )
  ) return null;

  return {
    card,
    instanceId: card.instance_id,
    zoneKey: `${who}-${kind}-${index}`
  };
}
