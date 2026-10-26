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

export function CardFace({ card, className = '', elementRef, fallbackImage }) {
  const category = String(card.category || card.type || '').toLowerCase();
  const isMonster = category === 'monster' || category === 'fusion';
  const hasSubtypeRail = category === 'spell' || category === 'trap';
  const subtypeIcon = hasSubtypeRail ? getSubtypeIcon(card, category) : null;
  const attribute = cardAttributes[String(card.attribute || card.attr || '').toUpperCase()];
  const monsterType = card.monsterType || '';
  const level = card.level ?? card.lv ?? 0;
  const cardNameRef = useRef(null);
  const [fallbackApplied, setFallbackApplied] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const imageSource = card.image && !fallbackApplied ? card.image : fallbackImage;

  useEffect(() => {
    setFallbackApplied(false);
    setImageFailed(false);
  }, [card.image, fallbackImage]);

  useLayoutEffect(() => {
    const name = cardNameRef.current;
    const header = name?.parentElement;
    if (!name || !header) return undefined;
    const context = document.createElement('canvas').getContext('2d');
    const minimumFontSize = 8;
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
        const fittedSize = Math.max(minimumFontSize, baseFontSize * Math.max(0, availableWidth - 4) / textWidth);
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

  return <div ref={elementRef} className={`card-detail__card${cardVariant ? ` card-detail__card--${cardVariant}` : ''}${attribute ? ' card-detail__card--has-attribute' : ' card-detail__card--no-attribute'}${className ? ` ${className}` : ''}`}>
    <CardFrameCanvas category={category} monsterType={monsterType} />
    <header className="card-detail__card-header">
      <span ref={cardNameRef} className="card-detail__card-name" title={card.name}>{card.name}</span>
      {attribute && <span className={`card-detail__attribute card-detail__attribute--${attribute.className}`} aria-label={`Thuộc tính ${attribute.label}`} title={`Thuộc tính ${attribute.label}`}>{attribute.label}</span>}
      {hasSubtypeRail && <span className={`card-detail__type-badge card-detail__type-badge--${category}`} aria-label={category === 'spell' ? 'Bài Phép' : 'Bài Bẫy'} title={category === 'spell' ? 'Bài Phép' : 'Bài Bẫy'}>
        <span className="card-detail__type-badge-label" lang="ja">{category === 'spell' ? '魔' : '罠'}</span>
      </span>}
      {(isMonster || hasSubtypeRail) && <span className="card-detail__card-stars" aria-label={isMonster ? 'Cấp lá bài' : undefined}>
        {isMonster
          ? Array.from({ length: Math.min(12, Number(level) || 0) }, (_, index) => <span className="card-detail__star" key={index}>★</span>)
          : subtypeIcon && <CardSubtypeIcon type={subtypeIcon} />}
      </span>}
    </header>
    <div className="card-detail__card-art">
      {card.rarity && <span className="card-detail__rarity">{card.rarity === 'ULTRA RARE' ? 'UR' : card.rarity}</span>}
      {imageSource && !imageFailed
        ? <img src={imageSource} alt={card.name} onError={() => {
          if (card.image && fallbackImage && !fallbackApplied) setFallbackApplied(true);
          else setImageFailed(true);
        }} />
        : <div className="card-detail__art-missing" aria-hidden="true">{isMonster ? '✦' : category === 'spell' ? '魔' : '罠'}<small>Ảnh bổ sung sau</small></div>}
    </div>
    <div className="card-detail__card-type">
      {hasSubtypeRail && <CardFrameCanvas category={category} monsterType={monsterType} ornament />}
      {hasSubtypeRail ? <span className="card-detail__card-type-label">{cardType}</span> : cardType}
    </div>
    {isMonster && <div className="card-detail__stats">
      <div><span>ATK</span><b>{card.atk ?? 0}</b></div>
      <div><span>DEF</span><b>{card.def ?? 0}</b></div>
    </div>}
  </div>;
}