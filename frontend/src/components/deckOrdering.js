const MAIN_DECK_CATEGORY_ORDER = {
  monster: 0,
  spell: 1,
  trap: 2
};

export function sortMainDeckEntries(entries, cardsById) {
  return entries
    .map((entry, index) => {
      const card = cardsById.get(String(entry.card_id));
      const category = String(card?.category || '').toLowerCase();
      return {
        entry,
        index,
        order: MAIN_DECK_CATEGORY_ORDER[category] ?? 3
      };
    })
    .sort((left, right) => left.order - right.order || left.index - right.index)
    .map(({ entry }) => entry);
}

export function moveDeckEntry(entries, sourceId, targetId, insertAfter = false) {
  if (sourceId === targetId) return entries;
  const sourceIndex = entries.findIndex((entry) => entry.card_id === sourceId);
  if (sourceIndex < 0 || !entries.some((entry) => entry.card_id === targetId)) return entries;
  const reordered = entries.slice();
  const [source] = reordered.splice(sourceIndex, 1);
  const targetIndex = reordered.findIndex((entry) => entry.card_id === targetId);
  reordered.splice(targetIndex + (insertAfter ? 1 : 0), 0, source);
  return reordered;
}
