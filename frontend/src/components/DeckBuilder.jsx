import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CardFace } from './CardFace.jsx';
import { moveDeckEntry, sortMainDeckEntries } from './deckOrdering.js';

const PAGE_SIZE = 10;
const CATEGORY_LABELS = {
  monster: 'Quái',
  spell: 'Phép',
  trap: 'Bẫy',
  fusion: 'Dung Hợp'
};
const ATTRIBUTE_LABELS = {
  LIGHT: 'Quang',
  DARK: 'Ám',
  EARTH: 'Địa',
  FIRE: 'Hỏa',
  WATER: 'Thủy',
  WIND: 'Phong',
  DIVINE: 'Thần'
};
const STANDARD_RARITIES = ['R', 'SR', 'UR', 'GR'];
const normalize = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/gi, 'd')
  .toLocaleLowerCase('vi');

function normalizeRarity(value) {
  const rarity = String(value || '').trim().toUpperCase();
  const aliases = {
    RARE: 'R',
    'SUPER RARE': 'SR',
    'ULTRA RARE': 'UR',
    'GOLD RARE': 'GR'
  };
  return aliases[rarity] || rarity || 'Chưa phân loại';
}

function cardLevelFilterValue(card) {
  const level = card.level ?? card.lv;
  const linkRating = card.linkRating ?? card.link_rating ?? card.linkValue ?? card.link_value ?? card.link;
  if (linkRating != null || /^LINK(?:\b|-)/i.test(String(level || ''))) return 'LINK';
  return level == null || level === '' ? 'Chưa phân loại' : String(level);
}

async function deckRequest(url, options) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('Máy chủ không trả về dữ liệu bộ bài hợp lệ.');
  }
  if (!response.ok) throw new Error(result.error || 'Không thể hoàn tất thao tác bộ bài.');
  return result;
}

function emptyFilters() {
  return { rarity: [], level: [], attribute: [], race: [] };
}

function totalCards(entries) {
  return entries.reduce((sum, entry) => sum + entry.quantity, 0);
}

function cardMaxCopies(card) {
  const maxCopies = Number(card?.maxCopies);
  return Number.isInteger(maxCopies) && maxCopies > 0 ? Math.min(3, maxCopies) : 3;
}

function duelDeckError(deck, cards, limits) {
  if (!deck?.unlocked) return 'Đang tải....';
  const mainCards = deck.main_cards;
  const extraCards = deck.extra_cards;
  if (!Array.isArray(mainCards) || !Array.isArray(extraCards)) {
    return 'Dữ liệu bộ bài không hợp lệ.';
  }
  for (const entry of [...mainCards, ...extraCards]) {
    if (!entry || !Number.isInteger(entry.quantity) || entry.quantity < 1) {
      return 'Số lượng thẻ trong bộ bài không hợp lệ.';
    }
  }

  const mainTotal = totalCards(mainCards);
  const extraTotal = totalCards(extraCards);
  const mainLimit = Number(limits?.main) || 60;
  const extraLimit = Number(limits?.extra) || 20;
  if (mainTotal < 40) return `Main Deck cần ít nhất 40 lá (hiện có ${mainTotal}).`;
  if (mainTotal > mainLimit) return `Main Deck không được vượt quá ${mainLimit} lá.`;
  if (extraTotal > extraLimit) return `Extra Deck không được vượt quá ${extraLimit} lá.`;

  const cardsById = new Map(cards.map((card) => [String(card.id), card]));
  for (const [location, entries] of [['main', mainCards], ['extra', extraCards]]) {
    const seenIds = new Set();
    for (const entry of entries) {
      if (seenIds.has(entry.card_id)) {
        return 'Mỗi loại thẻ chỉ được xuất hiện một dòng trong bộ bài.';
      }
      seenIds.add(entry.card_id);
      const card = cardsById.get(String(entry.card_id));
      if (!card) return 'Bộ bài có thẻ bạn không sở hữu hoặc không còn trong danh mục.';
      const isExtraCard = String(card.category || '').toLowerCase() === 'fusion';
      if ((location === 'extra') !== isExtraCard) {
        return 'Thẻ Dung Hợp chỉ được đặt trong Extra Deck.';
      }
      const maxCopies = cardMaxCopies(card);
      if (entry.quantity > maxCopies) {
        return `Không thể sử dụng quá ${maxCopies} bản sao của ${card.name}.`;
      }
      if (entry.quantity > Number(card.ownedQuantity || 0)) {
        return `Số lượng sở hữu của ${card.name} không đủ cho bộ bài.`;
      }
    }
  }
  return '';
}

function FilterChoices({
  title,
  values,
  selected,
  onToggle,
  format = (value) => value,
  allSelected,
  onSelectAll
}) {
  return (
    <fieldset className="deck-filter__group">
      <legend>{title}</legend>
      <div className="deck-filter__choices">
        {onSelectAll && (
          <label>
            <input type="checkbox" checked={allSelected} onChange={onSelectAll} />
            <span>Tất cả</span>
          </label>
        )}
        {values.map((value) => (
          <label key={String(value)}>
            <input
              type="checkbox"
              checked={selected.includes(value)}
              onChange={() => onToggle(value)}
            />
            <span>{format(value)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function DeckBuilder({
  open,
  onClose,
  onOpenCard,
  onNewCardsCount,
  onWalletChange,
  onSnapshotChange,
  onSelectDeck,
  selectionMode = false,
  selectedDuelDeckNumber = 1,
  selectionBusy = false,
  refreshKey,
  wallet
}) {
  const [snapshot, setSnapshot] = useState(null);
  const [decks, setDecks] = useState([]);
  const [cards, setCards] = useState([]);
  const [selectedDeckNumber, setSelectedDeckNumber] = useState(1);
  const [category, setCategory] = useState('monster');
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(emptyFilters);
  const [draftFilters, setDraftFilters] = useState(emptyFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [deckManagerOpen, setDeckManagerOpen] = useState(false);
  const [unlockConfirmDeck, setUnlockConfirmDeck] = useState(null);
  const [dirtyDecks, setDirtyDecks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dialogRef = useRef(null);
  const dragSuppressionTimer = useRef(0);
  const draggedRef = useRef(false);
  const dirtyRef = useRef([]);
  const deckScrollDrag = useRef(null);
  const scrollMomentumRef = useRef(null);
  const scrollMotionElementRef = useRef(null);
  const dragPreviewRef = useRef(null);
  const settlingPreviewRef = useRef(null);
  const reflowAnimationsRef = useRef(new WeakMap());
  const cancelDragRef = useRef(() => {});

  useEffect(() => {
    dirtyRef.current = dirtyDecks;
  }, [dirtyDecks]);

  const mergeSnapshot = (nextSnapshot) => {
    const snapshotCards = nextSnapshot.cards || [];
    const cardsById = new Map(snapshotCards.map((card) => [String(card.id), card]));
    const snapshotDecks = (nextSnapshot.decks || []).map((deck) => ({
      ...deck,
      main_cards: sortMainDeckEntries(deck.main_cards || [], cardsById)
    }));
    const normalizedSnapshot = { ...nextSnapshot, decks: snapshotDecks };
    setSnapshot(normalizedSnapshot);
    setCards(snapshotCards);
    setDecks((current) => {
      return snapshotDecks.map((serverDeck) => {
        const deck = dirtyRef.current.includes(serverDeck.number)
          ? current.find((currentDeck) => currentDeck.number === serverDeck.number) || serverDeck
          : serverDeck;
        return {
          ...deck,
          main_cards: sortMainDeckEntries(deck.main_cards || [], cardsById)
        };
      });
    });
    onNewCardsCount?.(nextSnapshot.new_cards_count || 0);
    onWalletChange?.(nextSnapshot.wallet);
    onSnapshotChange?.(normalizedSnapshot);
  };

  const loadSnapshot = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await deckRequest('/api/decks');
      if (!result.snapshot || !Array.isArray(result.snapshot.cards) || !Array.isArray(result.snapshot.decks)) {
        throw new Error('Dữ liệu bộ bài từ máy chủ không đầy đủ.');
      }
      mergeSnapshot(result.snapshot);
    } catch (requestError) {
      setError(requestError.message || 'Không thể tải dữ liệu bộ bài.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    if (selectionMode) {
      setSelectedDeckNumber(Number(selectedDuelDeckNumber) || 1);
    }
    void loadSnapshot();
  }, [open, refreshKey, selectionMode, selectedDuelDeckNumber]);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => dialogRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (open || scrollMomentumRef.current === null) return;
    window.cancelAnimationFrame(scrollMomentumRef.current);
    scrollMomentumRef.current = null;
    scrollMotionElementRef.current?.style.removeProperty('--deck-overdrag-x');
    scrollMotionElementRef.current = null;
  }, [open]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') cancelDragRef.current();
    };
    const handleBlur = () => cancelDragRef.current();
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') cancelDragRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearTimeout(dragSuppressionTimer.current);
      if (scrollMomentumRef.current !== null) {
        window.cancelAnimationFrame(scrollMomentumRef.current);
        scrollMomentumRef.current = null;
      }
      scrollMotionElementRef.current?.style.removeProperty('--deck-overdrag-x');
      scrollMotionElementRef.current = null;
      const session = deckScrollDrag.current;
      session?.removeListeners?.();
      session?.scrollElement?.classList.remove('is-dragging');
      session?.cardElement?.classList.remove('is-pointer-dragging');
      deckScrollDrag.current = null;
      dragPreviewRef.current?.element.remove();
      dragPreviewRef.current?.sourceElement.classList.remove('is-drag-source');
      dragPreviewRef.current = null;
      settlingPreviewRef.current?.animation?.cancel();
      settlingPreviewRef.current?.element.remove();
      settlingPreviewRef.current = null;
      document.querySelector('.deck-builder.is-card-dragging')?.classList.remove('is-card-dragging');
      document.querySelector('.deck-builder__inventory.is-drop-target')?.classList.remove('is-drop-target');
      document.querySelectorAll('.deck-zone.is-drop-target').forEach((zone) => zone.classList.remove('is-drop-target'));
    };
  }, []);

  useEffect(() => {
    if (!unlockConfirmDeck || unlocking) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setUnlockConfirmDeck(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [unlockConfirmDeck, unlocking]);

  const selectedDeck = decks.find((deck) => deck.number === selectedDeckNumber);
  const ownedCardsById = useMemo(
    () => new Map(cards.map((card) => [String(card.id), card])),
    [cards]
  );
  const filteredCards = useMemo(() => {
    const query = normalize(search);
    return cards
      .filter((card) => String(card.category || '').toLowerCase() === category)
      .filter((card) => !query || normalize(card.name).includes(query))
      .filter((card) => !filters.rarity.length || filters.rarity.includes(normalizeRarity(card.rarity)))
      .filter((card) => !filters.level.length || filters.level.includes(cardLevelFilterValue(card)))
      .filter((card) => !filters.attribute.length || filters.attribute.includes(card.attribute || 'Chưa phân loại'))
      .filter((card) => !filters.race.length || filters.race.includes(card.race || 'Chưa phân loại'))
      .sort((left, right) => left.name.localeCompare(right.name, 'vi'));
  }, [cards, category, filters, search]);
  const pageCount = Math.max(1, Math.ceil(filteredCards.length / PAGE_SIZE));
  const pageCards = filteredCards.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  useEffect(() => {
    setPage((current) => Math.min(current, pageCount - 1));
  }, [pageCount]);
  const usedCounts = useMemo(() => {
    const counts = new Map();
    for (const entry of [...(selectedDeck?.main_cards || []), ...(selectedDeck?.extra_cards || [])]) {
      counts.set(entry.card_id, (counts.get(entry.card_id) || 0) + entry.quantity);
    }
    return counts;
  }, [selectedDeck]);
  const rarityOptions = useMemo(
    () => snapshot?.filter_options?.rarities || [...new Set([
      ...STANDARD_RARITIES,
      ...cards.map((card) => normalizeRarity(card.rarity))
    ])].sort((left, right) => {
      const leftRank = STANDARD_RARITIES.indexOf(left);
      const rightRank = STANDARD_RARITIES.indexOf(right);
      if (leftRank !== -1 || rightRank !== -1) {
        return (leftRank === -1 ? STANDARD_RARITIES.length : leftRank)
          - (rightRank === -1 ? STANDARD_RARITIES.length : rightRank);
      }
      return left.localeCompare(right, 'vi');
    }),
    [cards, snapshot]
  );
  const levelOptions = useMemo(
    () => snapshot?.filter_options?.levels || [...new Set(cards.map(cardLevelFilterValue))]
      .sort((left, right) => left === 'LINK' || left === 'Chưa phân loại'
        ? 1
        : right === 'LINK' || right === 'Chưa phân loại'
          ? -1
          : Number(left) - Number(right)),
    [cards, snapshot]
  );
  const attributeOptions = useMemo(
    () => snapshot?.filter_options?.attributes || [...new Set(cards.map((card) => card.attribute || 'Chưa phân loại'))].sort(),
    [cards, snapshot]
  );
  const raceOptions = useMemo(
    () => snapshot?.filter_options?.races || [...new Set(cards.map((card) => card.race || 'Chưa phân loại'))].sort((left, right) => left.localeCompare(right, 'vi')),
    [cards, snapshot]
  );

  const updateDirty = (deckNumber) => {
    setDirtyDecks((current) => current.includes(deckNumber) ? current : [...current, deckNumber]);
  };

  const updateSelectedDeck = (transform) => {
    if (!selectedDeck) return;
    setDecks((current) => current.map((deck) => (
      deck.number === selectedDeckNumber ? transform(deck) : deck
    )));
    updateDirty(selectedDeckNumber);
    setNotice('');
  };

  const showNotice = (message) => {
    setNotice(message);
    setError('');
  };

  const captureDeckLayout = (location) => {
    const zone = document.querySelector(
      `.deck-zone.is-active[data-drop-zone="${location}"] .deck-zone__cards`
    );
    if (!zone) return new Map();
    const positions = new Map();
    for (const card of zone.querySelectorAll('.deck-zone__card')) {
      reflowAnimationsRef.current.get(card)?.cancel();
      const rect = card.getBoundingClientRect();
      positions.set(card.dataset.cardId, { left: rect.left, top: rect.top });
    }
    return positions;
  };

  const animateDeckLayout = (location, previousPositions) => {
    if (!previousPositions.size || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    window.requestAnimationFrame(() => {
      const zone = document.querySelector(
        `.deck-zone.is-active[data-drop-zone="${location}"] .deck-zone__cards`
      );
      if (!zone) return;
      for (const card of zone.querySelectorAll('.deck-zone__card')) {
        if (card.classList.contains('is-pointer-dragging')) continue;
        const previous = previousPositions.get(card.dataset.cardId);
        if (!previous) continue;
        const rect = card.getBoundingClientRect();
        const deltaX = previous.left - rect.left;
        const deltaY = previous.top - rect.top;
        if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) continue;
        const animation = card.animate(
          [
            { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
            { transform: 'translate3d(0, 0, 0)' }
          ],
          { duration: 360, easing: 'cubic-bezier(0.2, 1.25, 0.3, 1)' }
        );
        reflowAnimationsRef.current.set(card, animation);
        const clearAnimation = () => {
          if (reflowAnimationsRef.current.get(card) === animation) {
            reflowAnimationsRef.current.delete(card);
          }
        };
        animation.onfinish = clearAnimation;
        animation.oncancel = clearAnimation;
      }
    });
  };

  const changeQuantity = (location, card, amount) => {
    if (!selectedDeck || !amount) return false;
    const targetKey = `${location}_cards`;
    const currentEntries = selectedDeck[targetKey] || [];
    const existing = currentEntries.find((entry) => entry.card_id === String(card.id));
    const currentQuantity = existing?.quantity || 0;
    const nextQuantity = currentQuantity + amount;
    const isExtra = String(card.category || '').toLowerCase() === 'fusion';
    const expectedLocation = isExtra ? 'extra' : 'main';
    if (amount > 0 && expectedLocation !== location) {
      showNotice('Thẻ Dung Hợp chỉ được đưa vào Extra Deck.');
      return false;
    }
    const maxCopies = cardMaxCopies(card);
    if (nextQuantity < 0 || nextQuantity > maxCopies) {
      showNotice(`Mỗi bộ bài chỉ được sử dụng tối đa ${maxCopies} bản sao của thẻ này.`);
      return false;
    }
    const ownedQuantity = Math.max(0, Number(card.ownedQuantity) || 0);
    if (amount > 0 && nextQuantity > ownedQuantity) {
      showNotice('Số lượng thẻ sở hữu không đủ để thêm vào bộ bài.');
      return false;
    }
    const limit = location === 'main'
      ? snapshot?.deck_limits?.main || 60
      : snapshot?.deck_limits?.extra || 20;
    if (amount > 0 && totalCards(currentEntries) + amount > limit) {
      showNotice(`${location === 'main' ? 'Main Deck' : 'Extra Deck'} đã đủ ${limit} lá.`);
      return false;
    }
    if (amount > 0 && ownedQuantity < 1) {
      showNotice('Bạn chưa sở hữu thẻ này.');
      return false;
    }
    const previousPositions = captureDeckLayout(location);
    updateSelectedDeck((deck) => {
      const entries = deck[targetKey] || [];
      const current = entries.find((entry) => entry.card_id === String(card.id));
      const quantity = (current?.quantity || 0) + amount;
      const nextEntries = quantity === 0
        ? entries.filter((entry) => entry.card_id !== String(card.id))
        : current
          ? entries.map((entry) => entry.card_id === String(card.id) ? { ...entry, quantity } : entry)
          : [...entries, { card_id: String(card.id), quantity }];
      return {
        ...deck,
        [targetKey]: location === 'main'
          ? sortMainDeckEntries(nextEntries, ownedCardsById)
          : nextEntries
      };
    });
    animateDeckLayout(location, previousPositions);
    return true;
  };

  const moveDeckCard = (fromLocation, toLocation, card) => {
    if (fromLocation === toLocation) return false;
    if (String(card.category || '').toLowerCase() === 'fusion' && toLocation !== 'extra') {
      showNotice('Thẻ Dung Hợp không thể đưa vào Main Deck.');
      return false;
    }
    if (String(card.category || '').toLowerCase() !== 'fusion' && toLocation !== 'main') {
      showNotice('Main Deck chỉ nhận thẻ Quái, Phép và Bẫy.');
      return false;
    }
    const current = selectedDeck?.[`${fromLocation}_cards`]?.find((entry) => entry.card_id === String(card.id));
    if (!current) return false;
    const added = changeQuantity(toLocation, card, 1);
    if (added) changeQuantity(fromLocation, card, -1);
    return added;
  };

  const sameDeckOrder = (left, right) => (
    left.length === right.length
    && left.every((entry, index) => entry.card_id === right[index]?.card_id)
  );

  const previewDeckReorder = (session, targetId, insertAfter) => {
    const positionKey = `${targetId}:${insertAfter ? 'after' : 'before'}`;
    if (session.lastReorderPosition === positionKey) return false;
    session.lastReorderPosition = positionKey;
    const moved = moveDeckEntry(
      session.previewEntries,
      session.cardId,
      targetId,
      insertAfter
    );
    const nextEntries = session.location === 'main'
      ? sortMainDeckEntries(moved, ownedCardsById)
      : moved;
    if (sameDeckOrder(session.previewEntries, nextEntries)) return false;

    const previousPositions = captureDeckLayout(session.location);
    session.previewEntries = nextEntries;
    session.previewChanged = !sameDeckOrder(session.originalEntries, nextEntries);
    setDecks((current) => current.map((deck) => (
      deck.number === selectedDeckNumber
        ? { ...deck, [`${session.location}_cards`]: nextEntries }
        : deck
    )));
    animateDeckLayout(session.location, previousPositions);
    return true;
  };

  const restoreDeckPreview = (session) => {
    if (!session.previewEntries || sameDeckOrder(session.previewEntries, session.originalEntries)) return;
    const previousPositions = captureDeckLayout(session.location);
    session.previewEntries = session.originalEntries;
    session.previewChanged = false;
    setDecks((current) => current.map((deck) => (
      deck.number === selectedDeckNumber
        ? { ...deck, [`${session.location}_cards`]: session.originalEntries }
        : deck
    )));
    animateDeckLayout(session.location, previousPositions);
  };

  const createDragPreview = (sourceElement, clientX, clientY) => {
    dragPreviewRef.current?.element.remove();
    const previousSettlingPreview = settlingPreviewRef.current;
    previousSettlingPreview?.animation?.cancel();
    previousSettlingPreview?.element.remove();
    previousSettlingPreview?.restoreSource?.();
    settlingPreviewRef.current = null;
    const sourceFace = sourceElement.matches('.card-detail__card')
      ? sourceElement
      : sourceElement.querySelector('.card-detail__card');
    if (!sourceFace) return;
    const rect = sourceFace.getBoundingClientRect();
    const sourceStyle = window.getComputedStyle(sourceFace);
    const preview = sourceFace.cloneNode(true);
    const sourceCanvases = sourceFace.querySelectorAll('canvas');
    const previewCanvases = preview.querySelectorAll('canvas');
    sourceCanvases.forEach((canvas, index) => {
      const previewCanvas = previewCanvases[index];
      if (!previewCanvas) return;
      previewCanvas.width = canvas.width;
      previewCanvas.height = canvas.height;
      previewCanvas.getContext('2d')?.drawImage(canvas, 0, 0);
    });
    preview.classList.add('deck-builder__drag-preview');
    preview.setAttribute('aria-hidden', 'true');
    preview.removeAttribute('draggable');
    Object.assign(preview.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      padding: sourceStyle.padding,
      filter: sourceStyle.filter,
      margin: '0',
      zIndex: '10000',
      pointerEvents: 'none',
      transformOrigin: 'center',
      transform: 'translate3d(0, 0, 0)',
      willChange: 'transform, width, height, opacity'
    });
    document.body.appendChild(preview);
    dragPreviewRef.current = {
      element: preview,
      sourceElement: sourceFace,
      originLeft: rect.left,
      originTop: rect.top,
      offsetX: clientX - rect.left,
      offsetY: clientY - rect.top,
      destination: null
    };
  };

  const moveDragPreview = (clientX, clientY) => {
    const currentPreview = dragPreviewRef.current;
    if (!currentPreview) return;
    const deltaX = clientX - currentPreview.offsetX - currentPreview.originLeft;
    const deltaY = clientY - currentPreview.offsetY - currentPreview.originTop;
    currentPreview.element.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
  };

  const finishDragPreview = (destination) => {
    const currentPreview = dragPreviewRef.current;
    if (!currentPreview) return;
    dragPreviewRef.current = null;
    const { element, sourceElement } = currentPreview;
    const settlingPreview = { element, animation: null, restoreSource: null };
    settlingPreviewRef.current = settlingPreview;
    const restoreSource = () => {
      sourceElement.classList.remove('is-drag-source');
      sourceElement.closest('.deck-zone__card')?.classList.remove('is-pointer-dragging');
      if (settlingPreviewRef.current === settlingPreview) settlingPreviewRef.current = null;
    };
    settlingPreview.restoreSource = restoreSource;
    const targetSelector = destination?.type === 'deck'
      ? '.deck-zone__card'
      : destination?.type === 'inventory' ? '.deck-card' : null;

    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (settlingPreviewRef.current !== settlingPreview) {
        element.remove();
        return;
      }
      const start = element.getBoundingClientRect();
      if (!destination) {
        element.remove();
        restoreSource();
        return;
      }
      element.style.left = `${start.left}px`;
      element.style.top = `${start.top}px`;
      element.style.width = `${start.width}px`;
      element.style.height = `${start.height}px`;
      element.style.transform = 'none';

      let targetElement = null;
      if (targetSelector && destination.cardId) {
        const targetCard = [...document.querySelectorAll(targetSelector)]
          .find((candidate) => candidate.dataset.cardId === String(destination.cardId));
        targetElement = targetCard?.querySelector('.card-detail__card') || null;
      }
      if (!targetElement && destination?.type === 'deck') {
        targetElement = document.querySelector(`.deck-zone[aria-label="${destination.location === 'extra' ? 'Extra Deck' : 'Bộ Bài Chính'}"].is-active`);
      }
      if (!targetElement && destination?.type === 'inventory') {
        targetElement = document.querySelector('.deck-builder__inventory');
      }
      if (!targetElement) targetElement = sourceElement.isConnected ? sourceElement : null;

      const end = targetElement?.getBoundingClientRect();
      if (!end || typeof element.animate !== 'function') {
        element.remove();
        restoreSource();
        return;
      }
      if (destination && targetElement !== sourceElement) {
        const arrivalCard = targetElement.matches('.card-detail__card')
          ? targetElement
          : targetElement.querySelector('.card-detail__card');
        arrivalCard?.classList.add('is-drop-arriving');
        window.setTimeout(() => arrivalCard?.classList.remove('is-drop-arriving'), 520);
      }
      const animation = element.animate([
        {
          left: `${start.left}px`,
          top: `${start.top}px`,
          width: `${start.width}px`,
          height: `${start.height}px`,
          opacity: 1,
          transform: 'scale(1.04) rotate(-2deg)'
        },
        {
          left: `${end.left + (end.width - start.width) / 2}px`,
          top: `${end.top + (end.height - start.height) / 2}px`,
          width: `${end.width}px`,
          height: `${end.height}px`,
          opacity: 1,
          transform: 'scale(1) rotate(0deg)'
        }
      ], { duration: 380, easing: 'cubic-bezier(0.2, 0.75, 0.25, 1)' });
      settlingPreview.animation = animation;
      const cleanUp = () => {
        element.remove();
        restoreSource();
      };
      animation.onfinish = cleanUp;
      animation.oncancel = cleanUp;
    }));
  };

  const stopScrollMomentum = () => {
    if (scrollMomentumRef.current !== null) {
      window.cancelAnimationFrame(scrollMomentumRef.current);
    }
    scrollMomentumRef.current = null;
    scrollMotionElementRef.current?.style.removeProperty('--deck-overdrag-x');
    scrollMotionElementRef.current = null;
  };

  const startScrollMomentum = (session) => {
    const element = session.scrollElement;
    let velocity = session.scrollVelocity || 0;
    let overdrag = session.overdragX || 0;
    let overdragVelocity = 0;
    if (!element || (Math.abs(velocity) < 0.035 && Math.abs(overdrag) < 0.3)) return;

    scrollMotionElementRef.current = element;
    let previousTime = performance.now();
    const animate = (time) => {
      const elapsed = Math.min(time - previousTime, 32);
      previousTime = time;
      const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
      if (Math.abs(velocity) >= 0.035) {
        const nextScrollLeft = Math.min(
          maxScrollLeft,
          Math.max(0, element.scrollLeft + velocity * elapsed)
        );
        const blockedAtEdge = (
          (nextScrollLeft === 0 && velocity < 0)
          || (nextScrollLeft === maxScrollLeft && velocity > 0)
        );
        element.scrollLeft = nextScrollLeft;
        if (blockedAtEdge) velocity = 0;
        else velocity *= Math.pow(0.94, elapsed / 16.667);
      }

      if (Math.abs(overdrag) >= 0.3 || Math.abs(overdragVelocity) >= 0.03) {
        overdragVelocity += (-0.00045 * overdrag - 0.04 * overdragVelocity) * elapsed;
        overdrag += overdragVelocity * elapsed;
        if (Math.abs(overdrag) < 0.3 && Math.abs(overdragVelocity) < 0.03) {
          overdrag = 0;
          overdragVelocity = 0;
          element.style.removeProperty('--deck-overdrag-x');
        } else {
          element.style.setProperty('--deck-overdrag-x', `${overdrag}px`);
        }
      }

      const hasMomentum = Math.abs(velocity) >= 0.035;
      const hasOverdrag = Math.abs(overdrag) >= 0.3 || Math.abs(overdragVelocity) >= 0.03;
      if (!hasMomentum && !hasOverdrag) {
        scrollMomentumRef.current = null;
        scrollMotionElementRef.current = null;
        return;
      }
      scrollMomentumRef.current = window.requestAnimationFrame(animate);
    };
    scrollMomentumRef.current = window.requestAnimationFrame(animate);
  };

  const startPointerDrag = (event, source) => {
    if (event.pointerType !== 'mouse' || event.button !== 0 || deckScrollDrag.current) return;
    stopScrollMomentum();
    const sourceCard = source === 'deck'
      ? event.target.closest?.('.deck-zone__card')
      : event.target.closest?.('.deck-card');
    const scrollSurface = source === 'deck' && !sourceCard;
    if (!sourceCard && !scrollSurface) return;
    const cardId = sourceCard?.dataset.cardId;
    const location = source === 'deck' ? event.currentTarget.dataset.dropZone : null;
    if ((!cardId && !scrollSurface) || (source === 'deck' && !location)) return;
    if (source === 'inventory') {
      const card = ownedCardsById.get(cardId);
      const maxCopies = cardMaxCopies(card);
      const ownedQuantity = Math.max(0, Number(card?.ownedQuantity) || 0);
      const deckCount = usedCounts.get(cardId) || 0;
      const remainingCount = Math.max(0, ownedQuantity - deckCount);
      if (!card || remainingCount === 0 || deckCount >= maxCopies) return;
      const deckLocation = String(card.category || '').toLowerCase() === 'fusion' ? 'extra' : 'main';
      const entries = selectedDeck?.[`${deckLocation}_cards`] || [];
      const limit = deckLocation === 'extra'
        ? snapshot?.deck_limits?.extra || 20
        : snapshot?.deck_limits?.main || 60;
      if (totalCards(entries) >= limit) {
        showNotice(`${deckLocation === 'main' ? 'Main Deck' : 'Extra Deck'} đã đủ ${limit} lá.`);
        return;
      }
    }
    const session = {
      pointerId: event.pointerId,
      source: scrollSurface ? 'scroll' : source,
      cardId,
      location,
      cardElement: sourceCard,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: source === 'deck' ? event.currentTarget.scrollLeft : 0,
      lastScrollLeft: source === 'deck' ? event.currentTarget.scrollLeft : 0,
      lastScrollTime: performance.now(),
      scrollVelocity: 0,
      overdragX: 0,
      scrollElement: source === 'deck' ? event.currentTarget : null,
      mode: scrollSurface ? 'pending-scroll' : source === 'inventory' ? 'pending-card' : null,
      originalEntries: source === 'deck'
        ? (selectedDeck?.[`${location}_cards`] || []).slice()
        : null,
      previewEntries: source === 'deck'
        ? (selectedDeck?.[`${location}_cards`] || []).slice()
        : null,
      previewChanged: false,
      lastReorderPosition: null,
      targetCard: null
    };
    const handleMove = (pointerEvent) => movePointerDrag(pointerEvent);
    const handleUp = (pointerEvent) => dropPointerDrag(pointerEvent);
    const handleCancel = (pointerEvent) => handlePointerCancel(pointerEvent);
    const handleOut = (pointerEvent) => {
      if (
        pointerEvent.pointerId === session.pointerId
        && (pointerEvent.clientX < 0 || pointerEvent.clientY < 0
          || pointerEvent.clientX > window.innerWidth || pointerEvent.clientY > window.innerHeight)
      ) handlePointerCancel(pointerEvent);
    };
    session.removeListeners = () => {
      window.removeEventListener('pointermove', handleMove, true);
      window.removeEventListener('pointerup', handleUp, true);
      window.removeEventListener('pointercancel', handleCancel, true);
      window.removeEventListener('pointerout', handleOut, true);
    };
    deckScrollDrag.current = session;
    window.addEventListener('pointermove', handleMove, true);
    window.addEventListener('pointerup', handleUp, true);
    window.addEventListener('pointercancel', handleCancel, true);
    window.addEventListener('pointerout', handleOut, true);
  };

  const clearPointerDrag = (session) => {
    session.removeListeners?.();
    if (session.scrollElement) session.scrollElement.classList.remove('is-dragging');
    session.targetCard?.classList.remove('is-reorder-target');
    if (session.source !== 'deck' || session.mode !== 'card' || !dragPreviewRef.current) {
      session.cardElement?.classList.remove('is-pointer-dragging');
    }
    document.querySelector('.deck-builder.is-card-dragging')?.classList.remove('is-card-dragging');
    document.querySelector('.deck-builder__inventory.is-drop-target')?.classList.remove('is-drop-target');
    document.querySelectorAll('.deck-zone.is-drop-target').forEach((zone) => zone.classList.remove('is-drop-target'));
    window.clearTimeout(dragSuppressionTimer.current);
    if (session.didDrag) {
      draggedRef.current = true;
      dragSuppressionTimer.current = window.setTimeout(() => { draggedRef.current = false; }, 250);
    }
  };

  const finishPointerDrag = (destination) => {
    const session = deckScrollDrag.current;
    if (!session) return;
    deckScrollDrag.current = null;
    if (
      session.source === 'deck'
      && session.mode === 'card'
      && !session.keepPreview
    ) {
      restoreDeckPreview(session);
    }
    clearPointerDrag(session);
    if (session.mode === 'card') finishDragPreview(destination);
    else if (dragPreviewRef.current) {
      dragPreviewRef.current.sourceElement.classList.remove('is-drag-source');
      dragPreviewRef.current.element.remove();
      dragPreviewRef.current = null;
    }
    if (session.mode === 'scroll' && session.allowMomentum) startScrollMomentum(session);
  };

  const cancelPointerDrag = () => {
    const session = deckScrollDrag.current;
    if (!session) return;
    finishPointerDrag(null);
  };
  cancelDragRef.current = cancelPointerDrag;

  const movePointerDrag = (event) => {
    const session = deckScrollDrag.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - session.startX;
    const deltaY = event.clientY - session.startY;
    if (session.mode === 'pending-scroll') {
      if (Math.abs(deltaX) < 6 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
      session.mode = 'scroll';
      session.didDrag = true;
      draggedRef.current = true;
      session.scrollElement?.classList.add('is-dragging');
    }
    if (session.mode === 'pending-card' || !session.mode) {
      if (Math.hypot(deltaX, deltaY) < 6) return;
      if (session.source === 'deck' && Math.abs(deltaX) > Math.abs(deltaY)) {
        session.mode = 'scroll';
        session.didDrag = true;
        draggedRef.current = true;
        session.scrollElement?.classList.add('is-dragging');
      } else {
        session.mode = 'card';
        session.didDrag = true;
        createDragPreview(session.cardElement, event.clientX, event.clientY);
        session.cardElement.classList.add('is-pointer-dragging');
        document.querySelector('.deck-builder')?.classList.add('is-card-dragging');
        draggedRef.current = true;
      }
    }
    if (session.mode === 'scroll') {
      event.preventDefault();
      const element = session.scrollElement;
      const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
      const requestedScrollLeft = session.startScrollLeft - deltaX;
      const nextScrollLeft = Math.min(maxScrollLeft, Math.max(0, requestedScrollLeft));
      const maxOverdrag = Math.min(element.clientWidth * 0.5, 360);
      session.overdragX = requestedScrollLeft < 0
        ? Math.min(maxOverdrag, -requestedScrollLeft * 0.55)
        : requestedScrollLeft > maxScrollLeft
          ? -Math.min(maxOverdrag, (requestedScrollLeft - maxScrollLeft) * 0.55)
          : 0;
      if (Math.abs(session.overdragX) > 0.3) {
        element.style.setProperty('--deck-overdrag-x', `${session.overdragX}px`);
      } else {
        element.style.removeProperty('--deck-overdrag-x');
      }
      const now = performance.now();
      const elapsed = now - session.lastScrollTime;
      if (elapsed > 0) {
        const instantVelocity = (nextScrollLeft - session.lastScrollLeft) / elapsed;
        const previousVelocity = elapsed > 120 ? 0 : session.scrollVelocity;
        session.scrollVelocity = Math.max(
          -1.8,
          Math.min(1.8, previousVelocity * 0.35 + instantVelocity * 0.65)
        );
      }
      session.lastScrollLeft = nextScrollLeft;
      session.lastScrollTime = now;
      element.scrollLeft = nextScrollLeft;
      return;
    }
    if (session.mode !== 'card') return;
    event.preventDefault();
    moveDragPreview(event.clientX, event.clientY);
    const inventory = document.querySelector('.deck-builder__inventory');
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const overInventory = target?.closest('.deck-builder__inventory');
    const overDeckZone = target?.closest('.deck-zone.is-active');
    inventory?.classList.toggle(
      'is-drop-target',
      session.source === 'deck' && Boolean(overInventory)
    );
    document.querySelectorAll('.deck-zone.is-active').forEach((zone) => {
      zone.classList.toggle('is-drop-target', session.source === 'inventory' && zone === overDeckZone);
    });
    const overDeckCard = session.source === 'deck'
      && overDeckZone?.dataset.dropZone === session.location
      ? target?.closest('.deck-zone__card')
      : null;
    if (session.targetCard !== overDeckCard) {
      session.targetCard?.classList.remove('is-reorder-target');
      session.targetCard = overDeckCard || null;
      session.targetCard?.classList.add('is-reorder-target');
      session.lastReorderPosition = null;
    }
    if (overDeckCard && overDeckCard.dataset.cardId !== session.cardId) {
      const rect = overDeckCard.getBoundingClientRect();
      previewDeckReorder(
        session,
        overDeckCard.dataset.cardId,
        event.clientX >= rect.left + rect.width / 2
      );
    }
  };

  const dropPointerDrag = (event) => {
    const session = deckScrollDrag.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (session.mode !== 'card') {
      const recentMovement = performance.now() - session.lastScrollTime <= 90;
      session.allowMomentum = session.mode === 'scroll'
        && (recentMovement || Math.abs(session.overdragX) >= 0.3);
      if (!recentMovement) session.scrollVelocity = 0;
      finishPointerDrag(null);
      return;
    }
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const targetInventory = target?.closest('.deck-builder__inventory');
    const targetZone = target?.closest('.deck-zone.is-active');
    const targetCard = target?.closest('.deck-zone__card');
    let destination = null;
    const card = ownedCardsById.get(session.cardId);

    if (card && session.source === 'inventory' && targetZone) {
      const location = targetZone.dataset.dropZone;
      if (changeQuantity(location, card, 1)) {
        destination = { type: 'deck', location, cardId: session.cardId };
      }
    } else if (card && session.source === 'deck' && targetInventory) {
      restoreDeckPreview(session);
      if (changeQuantity(session.location, card, -1)) {
        destination = { type: 'inventory', cardId: session.cardId };
      }
    } else if (card && session.source === 'deck' && targetZone) {
      const location = targetZone.dataset.dropZone;
      if (location === session.location && targetCard) {
        const targetId = targetCard.dataset.cardId;
        if (targetId === session.cardId) {
          restoreDeckPreview(session);
        } else {
          const rect = targetCard.getBoundingClientRect();
          previewDeckReorder(
            session,
            targetId,
            event.clientX >= rect.left + rect.width / 2
          );
        }
        session.keepPreview = session.previewChanged;
        if (session.keepPreview) {
          updateDirty(selectedDeckNumber);
          setNotice('');
        }
        if (targetId !== session.cardId) {
          destination = { type: 'deck', location, cardId: targetCard.dataset.cardId };
        }
      } else if (location !== session.location) {
        restoreDeckPreview(session);
        if (moveDeckCard(session.location, location, card)) {
          destination = { type: 'deck', location, cardId: session.cardId };
        }
      }
    }
    finishPointerDrag(destination);
  };

  const handlePointerCancel = (event) => {
    if (deckScrollDrag.current?.pointerId === event.pointerId) cancelPointerDrag();
  };

  const openCard = async (card) => {
    if (draggedRef.current) return;
    onOpenCard?.({ ...card, quantity: card.ownedQuantity || 0 });
    if (!card.isNew) return;
    try {
      const result = await deckRequest('/api/decks/cards/seen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_id: card.id })
      });
      setCards((current) => current.map((entry) => (
        entry.id === card.id ? { ...entry, isNew: false } : entry
      )));
      onNewCardsCount?.(result.new_cards_count || 0);
    } catch (requestError) {
      setError(requestError.message || 'Không thể cập nhật trạng thái thẻ mới đã xem.');
    }
  };

  const saveDeck = async () => {
    if (!selectedDeck || saving || !dirtyDecks.includes(selectedDeckNumber)) return;
    setSaving(true);
    setError('');
    try {
      const result = await deckRequest('/api/decks/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deck_number: selectedDeck.number,
          version: selectedDeck.version,
          name: selectedDeck.name,
          notes: selectedDeck.notes,
          main_cards: selectedDeck.main_cards,
          extra_cards: selectedDeck.extra_cards
        })
      });
      const dirtyOthers = dirtyRef.current.filter((number) => number !== selectedDeckNumber);
      dirtyRef.current = dirtyOthers;
      setDirtyDecks(dirtyOthers);
      mergeSnapshot(result.snapshot);
      showNotice('Đã lưu bộ bài thành công.');
    } catch (requestError) {
      setError(requestError.message || 'Không thể lưu bộ bài.');
    } finally {
      setSaving(false);
    }
  };

  const unlockDeck = async (deck) => {
    if (!deck?.unlock_gems || unlocking) return;
    setUnlocking(true);
    setError('');
    try {
      const result = await deckRequest('/api/decks/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deck_number: deck.number,
          request_id: window.crypto.randomUUID()
        })
      });
      mergeSnapshot(result.snapshot);
      showNotice(result.message || 'Đã mở khóa bộ bài.');
      setUnlockConfirmDeck(null);
      setSelectedDeckNumber(deck.number);
      setDeckManagerOpen(false);
    } catch (requestError) {
      setError(requestError.message || 'Không thể mở khóa bộ bài.');
    } finally {
      setUnlocking(false);
    }
  };

  const toggleFilterChoice = (key, value) => {
    setDraftFilters((current) => ({
      ...current,
      [key]: current[key].includes(value)
        ? current[key].filter((entry) => entry !== value)
        : [...current[key], value]
    }));
  };

  if (!open) return null;

  const savedMainCards = selectedDeck?.main_cards || [];
  const savedExtraCards = selectedDeck?.extra_cards || [];
  const availableMainCards = savedMainCards.filter((entry) => (
    ownedCardsById.has(String(entry.card_id))
  ));
  const availableExtraCards = savedExtraCards.filter((entry) => (
    ownedCardsById.has(String(entry.card_id))
  ));
  const unavailableCardCount = totalCards(savedMainCards) + totalCards(savedExtraCards)
    - totalCards(availableMainCards) - totalCards(availableExtraCards);
  const mainTotal = totalCards(availableMainCards);
  const extraTotal = totalCards(availableExtraCards);
  const monsterTotal = availableMainCards.reduce((total, entry) => (
    total + (String(ownedCardsById.get(entry.card_id)?.category || '').toLowerCase() === 'monster'
      ? entry.quantity
      : 0)
  ), 0);
  const spellTrapTotal = mainTotal - monsterTotal;
  const extraMode = category === 'fusion';
  const activeLocation = extraMode ? 'extra' : 'main';
  const activeEntries = selectedDeck?.[`${activeLocation}_cards`] || [];
  const activeTotal = extraMode ? extraTotal : mainTotal;
  const activeLimit = extraMode
    ? snapshot?.deck_limits?.extra || 20
    : snapshot?.deck_limits?.main || 60;
  const activeDeckIsDirty = dirtyDecks.includes(selectedDeckNumber);
  const nextLockedDeck = decks.find((deck) => !deck.unlocked);
  const selectedDuelDeckError = duelDeckError(selectedDeck, cards, snapshot?.deck_limits);
  const cleanUnavailableCards = () => {
    if (!unavailableCardCount) return;
    updateSelectedDeck((deck) => ({
      ...deck,
      main_cards: (deck.main_cards || []).filter((entry) => (
        ownedCardsById.has(String(entry.card_id))
      )),
      extra_cards: (deck.extra_cards || []).filter((entry) => (
        ownedCardsById.has(String(entry.card_id))
      ))
    }));
    showNotice(`Đã dọn ${unavailableCardCount} lá không còn trong kho khỏi bản nháp. Nhấn LƯU để xác nhận.`);
  };

  return createPortal(
    <div
      className="deck-builder"
      role="presentation"
      onDragStart={(event) => event.preventDefault()}
    >
      <section
        className="deck-builder__window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="deckBuilderTitle"
        tabIndex="-1"
        ref={dialogRef}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            if (deckScrollDrag.current) {
              cancelPointerDrag();
              event.stopPropagation();
            } else if (filterOpen) setFilterOpen(false);
            else if (deckManagerOpen) setDeckManagerOpen(false);
            else onClose?.();
          }
        }}
      >
        <header className="deck-builder__header">
          <button className="deck-builder__back" type="button" onClick={onClose} aria-label="Quay lại sảnh">← <span>Quay lại</span></button>
          <div className="deck-builder__heading">
            <h1 id="deckBuilderTitle">{selectionMode ? 'CHỌN BỘ BÀI' : 'BỘ BÀI'}</h1>
          </div>
          <div className="deck-builder__wallet" aria-label="Số dư tài khoản">
            {['gold', 'gem'].map((currency) => {
              const isGold = currency === 'gold';
              const amount = isGold ? wallet?.gold : wallet?.gems;
              return (
                <div className={`currency__item currency__item--${currency}`} key={currency}>
                  <img className="currency__icon" src={`/assets/images/currency/${currency}.png`} alt="" aria-hidden="true" />
                  <span>{Number(amount || 0).toLocaleString('vi-VN')}</span>
                  <button
                    className="currency__plus"
                    type="button"
                    data-gem-exchange-open
                    aria-label={isGold ? 'Mở đổi gem sang vàng' : 'Mở cửa hàng gem'}
                  >+</button>
                </div>
              );
            })}
          </div>
        </header>

        {error && <p className="deck-builder__message is-error" role="alert">{error}</p>}
        {notice && <p className="deck-builder__message" role="status">{notice}</p>}

        {!selectedDeck?.unlocked ? (
          <div className="deck-builder__locked">
            <h2>{selectedDeck?.name || 'Bộ bài'} đang khóa</h2>
            {selectedDeck?.unlock_gems
              ? <button type="button" className="deck-builder__primary" disabled={unlocking} onClick={() => void unlockDeck(selectedDeck)}>
                {unlocking ? 'ĐANG MỞ…' : `MỞ KHÓA · ${selectedDeck.unlock_gems.toLocaleString('vi-VN')} GEM`}
              </button>
              : <p>Giá mở khóa chưa được cấu hình.</p>}
          </div>
        ) : (
          <div className="deck-builder__body">
            <aside className="deck-builder__categories" aria-label="Phân loại thẻ">
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                <button
                  type="button"
                  key={key}
                  className={category === key ? 'is-selected' : ''}
                  aria-pressed={category === key}
                  onClick={() => { setCategory(key); setPage(0); }}
                >
                  {label}
                  <small>{cards.filter((card) => String(card.category || '').toLowerCase() === key).length}</small>
                </button>
              ))}
              <span className="deck-builder__inventory-position" aria-live="polite">
                {filteredCards.length ? `${Math.min(page + 1, pageCount)} / ${filteredCards.length}` : '0 / 0'}
              </span>
            </aside>

            <main className="deck-builder__workspace">
              <section className="deck-builder__inventory">
                {loading ? <p className="deck-builder__empty">Đang tải kho thẻ…</p> : null}
                {!loading && !cards.length && <p className="deck-builder__empty">Bạn chưa sở hữu thẻ nào. Hãy nhận thẻ trong Tiệm Bài.</p>}
                {!loading && cards.length > 0 && !pageCards.length && <p className="deck-builder__empty">Không tìm thấy thẻ phù hợp.</p>}
                <div className="deck-builder__card-grid">
                  {pageCards.map((card) => {
                    const ownedCount = Math.max(0, Number(card.ownedQuantity) || 0);
                    const deckCount = usedCounts.get(String(card.id)) || 0;
                    const remainingCount = Math.max(0, ownedCount - deckCount);
                    const maxCopies = cardMaxCopies(card);
                    return (
                      <article
                        key={card.id}
                        data-card-id={card.id}
                        className={`deck-card${card.isNew ? ' is-new' : ''}${remainingCount === 0 ? ' is-capped' : ''}`}
                        draggable={false}
                        onPointerDown={(event) => startPointerDrag(event, 'inventory')}
                      >
                        <button className="deck-card__face" type="button" onClick={() => void openCard(card)} aria-label={`Xem ${card.name}, còn ${remainingCount} lá khả dụng, sở hữu ${ownedCount}, giới hạn ${maxCopies} lá`}>
                          <CardFace card={card} showNewBadge={card.isNew} />
                        </button>
                        <footer>
                          <span>{remainingCount}/{maxCopies}</span>
                        </footer>
                      </article>
                    );
                  })}
                </div>
                <nav className="deck-builder__inventory-pagination" aria-label="Phân trang kho thẻ">
                  <button
                    type="button"
                    aria-label="Trang trước"
                    disabled={page <= 0}
                    onClick={() => setPage((current) => Math.max(0, current - 1))}
                  >‹</button>
                  <button
                    type="button"
                    aria-label="Trang sau"
                    disabled={page + 1 >= pageCount}
                    onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
                  >›</button>
                </nav>
              </section>

              <aside className="deck-builder__tools" aria-label="Tìm kiếm và lọc thẻ">
                <label className="deck-builder__search">
                  <span>Tìm thẻ</span>
                  <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Tìm tên thẻ…" />
                </label>
                <button
                  className={`deck-builder__filter-button${filterOpen ? ' is-open' : ''}`}
                  type="button"
                  onClick={() => { setDraftFilters(filters); setFilterOpen(true); }}
                >
                  Chọn lọc
                </button>
                <label className="deck-builder__rarity-select">
                  <span>Phẩm chất</span>
                  <select
                    value={filters.rarity[0] || ''}
                    onChange={(event) => {
                      const rarity = event.target.value;
                      setFilters((current) => ({ ...current, rarity: rarity ? [rarity] : [] }));
                      setPage(0);
                    }}
                  >
                    <option value="">Tất cả</option>
                    {rarityOptions.map((rarity) => <option key={rarity} value={rarity}>{rarity}</option>)}
                  </select>
                </label>
              </aside>

              <section className={`deck-builder__decks${extraMode ? ' is-extra-mode' : ''}`} aria-label={extraMode ? 'Extra Deck' : 'Bộ Bài Chính'}>
                <section
                  className={`deck-zone${extraMode ? ' is-hidden' : ' is-active'}`}
                  aria-label="Bộ Bài Chính"
                  data-drop-zone="main"
                >
                  <div
                    className="deck-zone__cards"
                    data-drop-zone="main"
                    onPointerDown={(event) => startPointerDrag(event, 'deck')}
                  >
                    {(selectedDeck.main_cards || []).map((entry) => {
                      const card = ownedCardsById.get(entry.card_id);
                      if (!card) return null;
                      return (
                        <article
                          className="deck-zone__card"
                          key={entry.card_id}
                          data-card-id={entry.card_id}
                          draggable={false}
                        >
                          <button type="button" className="deck-zone__face" onClick={() => void openCard(card)}>
                            <CardFace card={card} />
                          </button>
                          <span className="deck-zone__quantity">×{entry.quantity}</span>
                        </article>
                      );
                    })}
                  </div>
                </section>

                <section
                  className={`deck-zone${extraMode ? ' is-active' : ' is-hidden'}`}
                  aria-label="Extra Deck"
                  data-drop-zone="extra"
                >
                  <div
                    className="deck-zone__cards"
                    data-drop-zone="extra"
                    onPointerDown={(event) => startPointerDrag(event, 'deck')}
                  >
                    {(selectedDeck.extra_cards || []).map((entry) => {
                      const card = ownedCardsById.get(entry.card_id);
                      if (!card) return null;
                      return (
                        <article
                          className="deck-zone__card"
                          key={entry.card_id}
                          data-card-id={entry.card_id}
                          draggable={false}
                        >
                          <button type="button" className="deck-zone__face" onClick={() => void openCard(card)}>
                            <CardFace card={card} />
                          </button>
                          <span className="deck-zone__quantity">×{entry.quantity}</span>
                        </article>
                      );
                    })}
                  </div>
                </section>

                <aside className="deck-builder__summary">
                  <div className="deck-builder__summary-heading">
                    <span>{extraMode ? 'EXTRA DECK' : 'BỘ BÀI CHÍNH'}</span>
                    <strong className={activeTotal >= activeLimit ? 'is-full' : ''}>{activeTotal}/{activeLimit}</strong>
                  </div>
                  {!extraMode && (
                    <dl>
                      <div><dt>Quái thú</dt><dd>{monsterTotal}</dd></div>
                      <div><dt>Phép / Bẫy</dt><dd>{spellTrapTotal}</dd></div>
                    </dl>
                  )}
                  {extraMode && <p>{activeTotal} lá Dung Hợp</p>}
                  <strong className="deck-builder__summary-name">{selectedDeck.name}</strong>
                  {unavailableCardCount > 0 && (
                    <>
                      <p className="deck-builder__duel-status is-error" role="status">
                        Có {unavailableCardCount} lá cũ không còn trong kho nên không thể hiển thị.
                      </p>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={cleanUnavailableCards}
                      >
                        DỌN LÁ CŨ
                      </button>
                    </>
                  )}
                  {selectionMode && (
                    <p className={`deck-builder__duel-status${selectedDuelDeckError || activeDeckIsDirty ? ' is-error' : ''}`} role="status">
                      {activeDeckIsDirty
                        ? 'Hãy lưu thay đổi trước khi chọn bộ bài.'
                        : selectedDuelDeckError || 'Bộ bài đủ điều kiện đấu.'}
                    </p>
                  )}
                  <div className="deck-builder__summary-actions">
                    <button type="button" onClick={() => setDeckManagerOpen(true)}>Quản lý bộ bài</button>
                    {selectionMode && (
                      <button
                        type="button"
                        className="deck-builder__select-button"
                        disabled={Boolean(selectedDuelDeckError) || activeDeckIsDirty || saving || selectionBusy}
                        onClick={() => void onSelectDeck?.(selectedDeck.number)}
                      >
                        {selectionBusy ? 'ĐANG CHỌN…' : 'CHỌN BỘ NÀY'}
                      </button>
                    )}
                    <button type="button" className="deck-builder__save-button" disabled={!activeDeckIsDirty || saving} onClick={() => void saveDeck()}>
                      {saving ? 'ĐANG LƯU…' : activeDeckIsDirty ? 'LƯU' : 'ĐÃ LƯU'}
                    </button>
                  </div>
                </aside>
              </section>
            </main>
          </div>
        )}
      </section>

      {deckManagerOpen && (
        <div className="deck-manager">
          <button className="deck-manager__scrim" type="button" onClick={() => setDeckManagerOpen(false)} aria-label="Đóng quản lý bộ bài" />
          <section className="deck-manager__dialog" role="dialog" aria-modal="true" aria-labelledby="deckManagerTitle">
            <header>
              <div>
                <span>QUẢN LÝ DANH SÁCH</span>
                <h2 id="deckManagerTitle">Các Bộ Bài</h2>
              </div>
              <button type="button" onClick={() => setDeckManagerOpen(false)} aria-label="Đóng">×</button>
            </header>
            <div className="deck-manager__deck-selection">
              <div className="deck-manager__list">
                {(selectionMode ? decks : decks.filter((deck) => deck.unlocked)).map((deck) => {
                  const deckError = duelDeckError(deck, cards, snapshot?.deck_limits);
                  const isDirty = dirtyDecks.includes(deck.number);
                  const deckName = deck.name || `Bộ Bài ${deck.number}`;
                  const previewCards = (deck.main_cards || [])
                    .slice(0, 3)
                    .map((entry) => ownedCardsById.get(String(entry.card_id)))
                    .filter(Boolean);
                  return (
                    <article
                      key={deck.number}
                      className={`deck-manager__entry${selectionMode ? ' is-selection-mode' : ''}${deck.number === selectedDeckNumber ? ' is-selected' : ''}${!deck.unlocked ? ' is-locked' : ''}`}
                    >
                      <button
                        type="button"
                        className={`deck-manager__item${deck.number === selectedDeckNumber ? ' is-selected' : ''}${!deck.unlocked ? ' is-locked' : ''}`}
                        disabled={!deck.unlocked}
                        onClick={() => {
                          setSelectedDeckNumber(deck.number);
                          setDeckManagerOpen(false);
                          setNotice('');
                        }}
                      >
                        <span className="deck-manager__item-heading">
                          <span>{deckName}</span>
                          {deck.number === selectedDuelDeckNumber && selectionMode && <b aria-label="Bộ bài đang được chọn">✓</b>}
                        </span>
                        {selectionMode && (
                          <span className="deck-manager__preview" aria-hidden="true">
                            {previewCards.map((card) => (
                              <span className="deck-manager__preview-card" key={card.id}><CardFace card={card} /></span>
                            ))}
                            {!previewCards.length && <span className="deck-manager__preview-empty">Chưa có thẻ</span>}
                          </span>
                        )}
                        <small>{selectionMode
                          ? `${totalCards(deck.main_cards || [])} lá chính · ${totalCards(deck.extra_cards || [])} lá Extra`
                          : `${totalCards(deck.main_cards || [])} lá chính`}
                        </small>
                        {selectionMode && (
                          <small className={!deck.unlocked || deckError ? 'is-error' : 'is-ready'}>
                            {!deck.unlocked ? 'Chưa mở khóa' : deckError || 'Sẵn sàng đấu'}
                          </small>
                        )}
                      </button>
                      {selectionMode && (
                        <button
                          type="button"
                          className="deck-manager__item-select"
                          disabled={!deck.unlocked || Boolean(deckError) || isDirty || selectionBusy}
                          onClick={() => {
                            setSelectedDeckNumber(deck.number);
                            setDeckManagerOpen(false);
                            void onSelectDeck?.(deck.number);
                          }}
                        >
                          {selectionBusy ? 'ĐANG CHỌN…' : 'CHỌN'}
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>
              <button
                type="button"
                className="deck-manager__unlock"
                disabled={!nextLockedDeck?.unlock_gems || unlocking}
                onClick={() => {
                  if (nextLockedDeck?.unlock_gems) {
                    setError('');
                    setUnlockConfirmDeck(nextLockedDeck);
                  }
                }}
              >
                {unlocking
                  ? 'ĐANG MỞ KHÓA…'
                  : nextLockedDeck?.unlock_gems
                    ? `MỞ KHÓA BỘ BÀI · ${nextLockedDeck.unlock_gems.toLocaleString('vi-VN')} GEM`
                    : nextLockedDeck
                      ? `MỞ KHÓA ${nextLockedDeck.name.toUpperCase()} · CHƯA CẤU HÌNH`
                      : 'ĐÃ MỞ KHÓA ĐỦ 10 BỘ BÀI'}
              </button>
            </div>
            <div className="deck-manager__details">
              <label>
                <span>Tên bộ bài</span>
                <input
                  maxLength="32"
                  value={selectedDeck?.name || ''}
                  onChange={(event) => updateSelectedDeck((deck) => ({ ...deck, name: event.target.value }))}
                />
              </label>
              <label>
                <span>Ghi chú</span>
                <input
                  maxLength="240"
                  value={selectedDeck?.notes || ''}
                  onChange={(event) => updateSelectedDeck((deck) => ({ ...deck, notes: event.target.value }))}
                  placeholder="Ghi chú cho bộ bài…"
                />
              </label>
              <button
                type="button"
                className="deck-builder__primary"
                disabled={!activeDeckIsDirty || saving}
                onClick={() => void saveDeck()}
              >
                {saving ? 'ĐANG LƯU…' : activeDeckIsDirty ? 'LƯU THAY ĐỔI' : 'ĐÃ LƯU'}
              </button>
            </div>
          </section>
        </div>
      )}

      {unlockConfirmDeck && (
        <div className="deck-unlock-confirm">
          <button
            className="deck-unlock-confirm__scrim"
            type="button"
            disabled={unlocking}
            onClick={() => setUnlockConfirmDeck(null)}
            aria-label="Hủy mở khóa bộ bài"
          />
          <section
            className="deck-unlock-confirm__dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="deckUnlockConfirmTitle"
            aria-describedby="deckUnlockConfirmDescription"
          >
            <div className="deck-unlock-confirm__emblem" aria-hidden="true">✦</div>
            <span className="deck-unlock-confirm__eyebrow">MỞ RỘNG BỘ SƯU TẬP</span>
            <h2 id="deckUnlockConfirmTitle">Mở khóa {unlockConfirmDeck.name}?</h2>
            <p id="deckUnlockConfirmDescription">
              Mở khóa thêm một không gian lưu trữ bộ bài để sẵn sàng cho những chiến thuật mới.
            </p>
            <div className="deck-unlock-confirm__cost">
              <span>Chi phí</span>
              <strong><span aria-hidden="true">♦</span> {unlockConfirmDeck.unlock_gems.toLocaleString('vi-VN')} GEM</strong>
            </div>
            {error && <p className="deck-unlock-confirm__error" role="alert">{error}</p>}
            <div className="deck-unlock-confirm__actions">
              <button
                type="button"
                className="deck-unlock-confirm__cancel"
                disabled={unlocking}
                onClick={() => setUnlockConfirmDeck(null)}
              >
                ĐỂ SAU
              </button>
              <button
                type="button"
                className="deck-unlock-confirm__accept"
                autoFocus
                disabled={unlocking}
                onClick={() => void unlockDeck(unlockConfirmDeck)}
              >
                {unlocking ? 'ĐANG MỞ KHÓA…' : 'XÁC NHẬN MỞ KHÓA'}
              </button>
            </div>
          </section>
        </div>
      )}

      {filterOpen && (
        <div className="deck-filter">
          <button className="deck-filter__scrim" type="button" onClick={() => setFilterOpen(false)} aria-label="Đóng bộ lọc" />
          <section className="deck-filter__dialog" role="dialog" aria-modal="true" aria-labelledby="deckFilterTitle">
            <header>
              <h2 id="deckFilterTitle">CHỌN LỌC THẺ</h2>
              <button type="button" onClick={() => setFilterOpen(false)} aria-label="Đóng bộ lọc">×</button>
            </header>
            <div className="deck-filter__body">
              <FilterChoices
                title="Phẩm chất"
                values={rarityOptions}
                selected={draftFilters.rarity}
                onToggle={(value) => toggleFilterChoice('rarity', value)}
                allSelected={!draftFilters.rarity.length}
                onSelectAll={() => setDraftFilters((current) => ({ ...current, rarity: [] }))}
              />
              <FilterChoices title="Sao / Cấp" values={levelOptions} selected={draftFilters.level} onToggle={(value) => toggleFilterChoice('level', value)} />
              <FilterChoices title="Thuộc tính" values={attributeOptions} selected={draftFilters.attribute} onToggle={(value) => toggleFilterChoice('attribute', value)} format={(value) => ATTRIBUTE_LABELS[value] || value} />
              <FilterChoices title="Tộc" values={raceOptions} selected={draftFilters.race} onToggle={(value) => toggleFilterChoice('race', value)} />
            </div>
            <footer>
              <button type="button" onClick={() => setDraftFilters(emptyFilters())}>XÓA LỌC</button>
              <button type="button" className="deck-builder__primary" onClick={() => { setFilters(draftFilters); setPage(0); setFilterOpen(false); }}>ÁP DỤNG</button>
            </footer>
          </section>
        </div>
      )}
    </div>,
    document.body
  );
}

export default DeckBuilder;
