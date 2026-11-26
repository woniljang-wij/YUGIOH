import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { drawCardFrame, drawCardTypeOrnament } from '../renderers/cardFrameRenderer.js';

const cardAttributes = {
  DARK: { label: '闇', className: 'dark' },
  LIGHT: { label: '光', className: 'light' },
  EARTH: { label: '地', className: 'earth' },
  WATER: { label: '水', className: 'water' },
  FIRE: { label: '炎', className: 'fire' },
  WIND: { label: '風', className: 'wind' },
  DIVINE: { label: '神', className: 'divine' }
};

const rarityAliases = {
  RARE: 'R',
  'SUPER RARE': 'SR',
  'ULTRA RARE': 'UR',
  'GOLD RARE': 'GR'
};

function normalizeRarity(rarity) {
  const value = String(rarity || '').trim().toUpperCase();
  return rarityAliases[value] || value;
}

function normalizeSubtype(subtype) {
  return String(subtype || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z]/g, '');
}

function getSubtypeIcon(card, category) {
  const subtype = normalizeSubtype(category === 'spell' ? card.spellType : card.trapType);
  if (subtype.includes('quickplay') || subtype.includes('tucthoi')) return 'quickplay';
  if (subtype.includes('continuous') || subtype.includes('lientuc')) return 'continuous';
  if (subtype.includes('equip') || subtype.includes('trangbi')) return 'equip';
  if (subtype.includes('field') || subtype.includes('moitruong')) return 'field';
  if (subtype.includes('ritual') || subtype.includes('nghile')) return 'ritual';
  if (subtype.includes('counter') || subtype.includes('phankich')) return 'counter';
  return null;
}

function resolveCardImageSource(image) {
  if (typeof image !== 'string' || !image) return image;
  return image.startsWith('assets/') ? `/${image}` : image;
}

function CardSubtypeIcon({ type }) {
  const paths = {
    continuous: <path className="card-detail__subtype-path" d="M3 12c0-6 7-8 9 0s9 6 9 0-7-8-9 0-9 6-9 0Z" />,
    equip: <path className="card-detail__subtype-path" d="M12 4v16M4 12h16" />,
    field: <><circle className="card-detail__subtype-path" cx="12" cy="12" r="8" /><path className="card-detail__subtype-path" d="M12 7v10M7 12h10" /></>,
    quickplay: <path className="card-detail__subtype-path" d="m13 2-8 12h6l-1 8 9-13h-6l1-7Z" />,
    ritual: <path className="card-detail__subtype-path" d="M12 22c-4 0-7-2.7-7-6.5 0-2.6 1.6-4.3 3.4-6.2.1 2.1 1 3 1.8 3.5C10 8.5 12 4.8 16 2c-.5 4.2 3 6.2 3 11.2 0 5-3 8.8-7 8.8Z" />,
    counter: <path className="card-detail__subtype-path" d="M19 8a8 8 0 1 0 1 7M19 3v5h-5" />
  };
  return <svg className={`card-detail__subtype-icon card-detail__subtype-icon--${type}`} viewBox="0 0 24 24" aria-hidden="true">{paths[type]}</svg>;
}

function useCardCanvas(renderer, category, monsterType) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const draw = () => renderer(canvas, category, monsterType);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(draw) : null;
    if (observer) observer.observe(canvas);
    else window.addEventListener('resize', draw);
    draw();
    return () => {
      observer?.disconnect();
      if (!observer) window.removeEventListener('resize', draw);
    };
  }, [renderer, category, monsterType]);
  return canvasRef;
}

function CardFrameCanvas({ category, monsterType, ornament = false }) {
  const renderer = ornament ? drawCardTypeOrnament : drawCardFrame;
  const canvasRef = useCardCanvas(renderer, category, monsterType);
  return <canvas ref={canvasRef} className={ornament ? 'card-detail__type-ornament' : 'card-detail__frame-canvas'} aria-hidden="true"></canvas>;
}

export function CardFace({ card, className = '', elementRef, fallbackImage, showNewBadge = false }) {
  const category = String(card.category || card.type || '').toLowerCase();
  const isMonster = category === 'monster' || category === 'fusion';
  const hasSubtypeRail = category === 'spell' || category === 'trap';
  const subtypeIcon = hasSubtypeRail ? getSubtypeIcon(card, category) : null;
  const attribute = cardAttributes[String(card.attribute || card.attr || '').toUpperCase()];
  const monsterType = card.monsterType || '';
  const level = card.level ?? card.lv ?? 0;
  const linkRating = card.linkRating ?? card.link_rating ?? card.linkValue ?? card.link_value ?? card.link;
  const isLinkMonster = isMonster && (
    linkRating != null || String(level).toUpperCase().includes('LINK')
  );
  const atkValue = Number(card.atk);
  const baseAtkValue = Number(card.baseAtk);
  const defValue = Number(card.def);
  const baseDefValue = Number(card.baseDef);
  const atkIncreased = Number.isFinite(atkValue)
    && Number.isFinite(baseAtkValue)
    && atkValue > baseAtkValue;
  const defIncreased = Number.isFinite(defValue)
    && Number.isFinite(baseDefValue)
    && defValue > baseDefValue;
  const levelCount = Number.parseInt(String(level), 10) || 0;
  const cardNameRef = useRef(null);
  const [fallbackApplied, setFallbackApplied] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const imageSource = card.image && !fallbackApplied
    ? resolveCardImageSource(card.image)
    : fallbackImage;

  useEffect(() => {
    setFallbackApplied(false);
    setImageFailed(false);
  }, [card.image, fallbackImage]);

  useLayoutEffect(() => {
    const name = cardNameRef.current;
    const header = name?.parentElement;
    if (!name || !header) return undefined;
    const context = document.createElement('canvas').getContext('2d');
    const minimumFontSize = () => {
      const cardElement = name.closest('.card-detail__card');
      if (!name.closest('.deck-builder') || !cardElement || cardElement.clientWidth > 100) {
        return 8;
      }
      return Math.max(4, cardElement.clientWidth * 0.05);
    };
    const fitName = () => {
      name.style.removeProperty('--card-name-fit-size');
      if (!name.clientWidth) return;
      const style = window.getComputedStyle(name);
      const baseFontSize = Number.parseFloat(style.fontSize);
      const availableWidth = name.getBoundingClientRect().width;
      let textWidth = name.scrollWidth;
      if (context && Number.isFinite(baseFontSize)) {
        context.font = style.font;
        textWidth = context.measureText(name.textContent || '').width;
      }
      if (textWidth > availableWidth && availableWidth > 0 && Number.isFinite(baseFontSize)) {
        const fittedSize = Math.max(
          minimumFontSize(),
          baseFontSize * Math.max(0, availableWidth - 4) / textWidth
        );
        name.style.setProperty('--card-name-fit-size', `${fittedSize}px`);
      }
    };
    fitName();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fitName) : null;
    if (observer) observer.observe(header);
    else window.addEventListener('resize', fitName);
    return () => {
      observer?.disconnect();
      if (!observer) window.removeEventListener('resize', fitName);
    };
  }, [card.name, category]);

  const cardVariant = category === 'monster' && monsterType !== 'Thường' ? 'effect' : category;
  const cardType = category === 'spell'
    ? 'Bài Phép'
    : category === 'trap'
      ? 'Bài Bẫy'
      : category === 'fusion'
        ? `[${card.race || ''} / Dung hợp / ${monsterType}]`
        : `[${card.race || ''} / ${monsterType}]`;
  const rarity = normalizeRarity(card.rarity);
  const rarityClass = {
    R: 'card-detail__rarity--r',
    SR: 'card-detail__rarity--sr',
    UR: 'card-detail__rarity--ur',
    GR: 'card-detail__rarity--gr'
  }[rarity] || '';

  return <div ref={elementRef} className={`card-detail__card${cardVariant ? ` card-detail__card--${cardVariant}` : ''}${attribute ? ' card-detail__card--has-attribute' : ' card-detail__card--no-attribute'}${className ? ` ${className}` : ''}`}>
    <CardFrameCanvas category={category} monsterType={monsterType} />
    <header className="card-detail__card-header">
      <span ref={cardNameRef} className="card-detail__card-name" title={card.name}>{card.name}</span>
      {attribute && <span className={`card-detail__attribute card-detail__attribute--${attribute.className}`} aria-label={`Thuộc tính ${attribute.label}`} title={`Thuộc tính ${attribute.label}`}>{attribute.label}</span>}
      {hasSubtypeRail && <span className={`card-detail__type-badge card-detail__type-badge--${category}`} aria-label={category === 'spell' ? 'Bài Phép' : 'Bài Bẫy'} title={category === 'spell' ? 'Bài Phép' : 'Bài Bẫy'}>
        <span className="card-detail__type-badge-label" lang="ja">{category === 'spell' ? '魔' : '罠'}</span>
      </span>}
      {(isMonster || hasSubtypeRail || rarity) && <span className="card-detail__card-stars" aria-label={isLinkMonster ? 'LINK Rating' : isMonster ? 'Cấp lá bài' : undefined}>
        {isMonster
          ? isLinkMonster
            ? <span className="card-detail__link-level">{String(linkRating ?? level).replace(/^LINK[-\s]*/i, '') || 'LINK'}</span>
            : Array.from({ length: Math.min(12, levelCount) }, (_, index) => <span className="card-detail__star" key={index}>★</span>)
          : subtypeIcon && <CardSubtypeIcon type={subtypeIcon} />}
      </span>}
    </header>
    <div className="card-detail__card-art">
      {rarity && <span className={`card-detail__rarity${rarityClass ? ` ${rarityClass}` : ''}`}>{rarity}</span>}
      {imageSource && !imageFailed
        ? <img src={imageSource} alt={card.name} draggable={false} onError={() => {
          if (card.image && fallbackImage && !fallbackApplied) setFallbackApplied(true);
          else setImageFailed(true);
        }} />
        : <div className="card-detail__art-missing" aria-hidden="true">{isMonster ? '✦' : category === 'spell' ? '魔' : '罠'}<small>Ảnh bổ sung sau</small></div>}
      {card.monster_effects_negated && (
        <span
          className="card-detail__effect-negated"
          aria-label="Hiệu ứng quái thú bị vô hiệu hóa"
          title="Hiệu ứng quái thú bị vô hiệu hóa"
        >
          VÔ HIỆU
        </span>
      )}
      {showNewBadge && <span className="card-detail__new-label" aria-label="Thẻ mới">NEW</span>}
    </div>
    <div className="card-detail__card-type">
      {hasSubtypeRail && <CardFrameCanvas category={category} monsterType={monsterType} ornament />}
      {hasSubtypeRail ? <span className="card-detail__card-type-label">{cardType}</span> : cardType}
    </div>
    {isMonster && <div className="card-detail__stats">
      <div className={atkIncreased ? 'card-detail__stat--increased' : ''}><span>ATK</span><b>{card.atk ?? '?'}</b></div>
      <div className={defIncreased ? 'card-detail__stat--increased' : ''}><span>{isLinkMonster ? 'LINK' : 'DEF'}</span><b>{isLinkMonster ? linkRating ?? level : card.def ?? '?'}</b></div>
    </div>}
  </div>;
}