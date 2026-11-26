import { useEffect, useRef, useState } from 'react';

async function dismantleRequest(cardId, requestId) {
  const response = await fetch('/api/cards/dismantle', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ card_id: cardId, request_id: requestId })
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('Máy chủ không trả về kết quả tách bài hợp lệ.');
  }
  if (!response.ok) throw new Error(result.error || 'Không thể tách bài.');
  if (!result.reward || !Array.isArray(result.inventory)) {
    throw new Error('Máy chủ chưa xác nhận đầy đủ kết quả tách bài.');
  }
  return result;
}

export default function CardDismantleDialog({ card, onCancel, onSuccess }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const pendingRef = useRef(false);
  const requestIdRef = useRef(window.crypto.randomUUID());
  const rewardItemId = {
    R: 'r_fragment',
    RARE: 'r_fragment',
    SR: 'sr_fragment',
    'SUPER RARE': 'sr_fragment',
    UR: 'ur_fragment',
    'ULTRA RARE': 'ur_fragment',
    GR: 'gr_fragment',
    'GOLD RARE': 'gr_fragment'
  }[String(card.rarity || '').trim().toUpperCase()];
  const rewardName = {
    r_fragment: 'Mảnh R',
    sr_fragment: 'Mảnh SR',
    ur_fragment: 'Mảnh UR',
    gr_fragment: 'Mảnh GR'
  }[rewardItemId];
  const cardImage = card.image?.startsWith('/')
    ? card.image
    : `/${card.image || ''}`;

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !pendingRef.current) onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const confirm = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError('');
    try {
      const result = await dismantleRequest(card.id, requestIdRef.current);
      onSuccess(result);
    } catch (requestError) {
      setError(requestError.message || 'Không thể tách bài. Hãy thử lại.');
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <div className="card-dismantle" role="presentation">
      <button
        className="card-dismantle__scrim"
        type="button"
        onClick={onCancel}
        disabled={pending}
        aria-label="Hủy xác nhận tách bài"
      />
      <section
        className="card-dismantle__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cardDismantleTitle"
      >
        <h2 id="cardDismantleTitle">Xác Nhận Tách Bài</h2>
        <div className="card-dismantle__card">
          <img src={cardImage} alt={card.name} />
          <div>
            <strong>{card.name}</strong>
            <span>Độ hiếm: {card.rarity}</span>
            <span>Đang sở hữu: {card.ownedQuantity} · Có thể tách: {card.availableQuantity}</span>
          </div>
        </div>
        <div className="card-dismantle__exchange">
          <span>Tiêu hao <b>3 lá</b></span>
          <span aria-hidden="true">→</span>
          <span>
            <img src={`/assets/images/items/${rewardItemId?.replace('_', '-')}.png`} alt="" />
            <b>1 {rewardName}</b>
          </span>
        </div>
        {error && <p className="card-dismantle__error" role="alert">{error}</p>}
        <div className="card-dismantle__actions">
          <button type="button" onClick={onCancel} disabled={pending}>Hủy</button>
          <button type="button" onClick={confirm} disabled={pending}>
            {pending ? 'Đang tách…' : 'Xác Nhận Tách'}
          </button>
        </div>
      </section>
    </div>
  );
}
