import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import '../../css/card-detail.css';
import { CardFace } from './CardFace.jsx';

export default function CardDetailDialog({
  card,
  onClose,
  showInventoryDetails = false,
  quantity = 0,
  availableQuantity = 0,
  showDismantle = false,
  onDismantle,
  showCollectionAction = false
}) {
  useEffect(() => {
    if (!card) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [card, onClose]);

  if (!card) return null;

  const category = card.category || card.type;
  const isMonster = category === 'monster' || category === 'fusion';
  const typeDescription = isMonster
    ? `${card.race || ''} - ${category === 'fusion' ? 'Dung hợp - ' : ''}${card.monsterType || ''}`
    : `${category === 'spell' ? 'Phép' : 'Bẫy'} - ${card[`${category}Type`] || ''}`;

  const closeDialog = (event) => {
    event.stopPropagation();
    onClose();
  };

  return createPortal(
    <div className="card-detail" id="cardDetail">
      <button
        type="button"
        className="card-detail__backdrop"
        data-card-detail-close
        onClick={closeDialog}
        aria-label="Đóng thông tin lá bài"
      />
      <section
        className="card-detail__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cardDetailTitle"
        tabIndex="-1"
      >
        <button
          className="card-detail__close"
          type="button"
          data-card-detail-close
          onClick={closeDialog}
          aria-label="Đóng thông tin lá bài"
        >
          ×
        </button>
        <div className="card-detail__info">
          <h2 id="cardDetailTitle">{card.name || 'Thông tin'}</h2>
          <section className="card-detail__section">
            <h3>Loại</h3>
            <p data-card-detail-type>{typeDescription}</p>
          </section>
          <section className="card-detail__section">
            <h3>Từ khóa</h3>
            <p data-card-detail-keyword>{card.keyword || '—'}</p>
          </section>
          <section className="card-detail__section" hidden={category === 'spell' || category === 'trap'}>
            <h3>Miêu tả</h3>
            <p data-card-detail-description>{card.description || ''}</p>
          </section>
          <section className="card-detail__section">
            <h3>Hạn chế</h3>
            <p data-card-detail-limit>{`Trong cùng bộ bài được có tối đa ${card.maxCopies || 3} lá`}</p>
          </section>
          <section className="card-detail__section card-detail__skills" data-card-detail-skills-section hidden={!card.skills?.length}>
            <h3>Kỹ năng</h3>
            <div data-card-detail-skills>
              {(card.skills || []).map((skill, index) => (
                <article className="card-detail__skill" key={`${skill.name || 'skill'}-${index}`}>
                  <span className="card-detail__skill-icon">✦</span>
                  <div className="card-detail__skill-copy">
                    <h4>{skill.name || 'Kỹ năng'}</h4>
                    {skill.description && <p>{skill.description}</p>}
                    {Array.isArray(skill.effects) && (
                      <ol className="card-detail__effect-options">
                        {skill.effects.map((effect, effectIndex) => (
                          <li className="card-detail__effect-option" key={`${effect.name}-${effectIndex}`}>
                            <h5>{effect.name}</h5>
                            {effect.condition && <p className="card-detail__effect-condition">{effect.condition}</p>}
                            {effect.description && <p>{effect.description}</p>}
                            {effect.restriction && <p className="card-detail__effect-restriction">{effect.restriction}</p>}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
          {isMonster && (
            <section className="card-detail__section card-detail__fusion">
              <h3>Dung hợp</h3>
              <div data-card-detail-fusion>
                {card.fusion?.length
                  ? card.fusion.map((recipe, index) => (
                    <div className="card-detail__recipe" key={`fusion-${index}`}>
                      {(recipe.materials || []).map((name, materialIndex) => (
                        <React.Fragment key={`${name}-${materialIndex}`}>
                          {materialIndex > 0 && <span className="card-detail__operator">+</span>}
                          <span className="card-detail__fusion-card">{name}</span>
                        </React.Fragment>
                      ))}
                      <span className="card-detail__operator">=</span>
                      <span className="card-detail__fusion-card">{recipe.result}</span>
                    </div>
                  ))
                  : <span className="card-detail__no-fusion">Chưa có công thức dung hợp.</span>}
              </div>
            </section>
          )}
        </div>
        <aside className="card-detail__preview">
          <CardFace card={card} />
          {showInventoryDetails && (
            <>
              <p>Số lượng: <b data-card-detail-quantity>{quantity}</b></p>
              <p>Bản sao chưa dùng trong bộ bài: <b>{availableQuantity}</b></p>
              <p>Phiên bản: bản thử nghiệm</p>
            </>
          )}
          {(showDismantle || showCollectionAction) && (
            <div className="card-detail__actions">
              {showDismantle && (
                <button
                  type="button"
                  className="card-detail__action card-detail__action--dismantle"
                  disabled={Number(availableQuantity) < 3}
                  title={Number(availableQuantity) < 3 ? 'Cần ít nhất 3 lá chưa dùng trong bộ bài để tách' : undefined}
                  onClick={onDismantle}
                >
                  Tách bài
                </button>
              )}
              {showCollectionAction && (
                <button type="button" className="card-detail__action card-detail__action--collect" disabled>
                  Bộ sưu tập
                </button>
              )}
            </div>
          )}
        </aside>
      </section>
    </div>,
    document.body
  );
}
