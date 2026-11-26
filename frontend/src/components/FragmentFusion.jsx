import { useEffect, useMemo, useRef, useState } from 'react';
import AttendanceRewardDialog from './AttendanceRewardDialog.jsx';
import FragmentCanvas from './FragmentCanvas.jsx';

const FRAGMENT_ROWS = [
  { itemId: 'r_fragment', name: 'Mảnh R', quantity: 40, gold: 1000, rewardId: 'sr_fragment', rewardName: 'Mảnh SR' },
  { itemId: 'sr_fragment', name: 'Mảnh SR', quantity: 20, gold: 2000, rewardId: 'ur_fragment', rewardName: 'Mảnh UR' },
  { itemId: 'ur_fragment', name: 'Mảnh UR', quantity: 10, gold: 3000, rewardId: 'gr_fragment', rewardName: 'Mảnh GR' }
];

const ITEM_IMAGES = {
  r_fragment: '/assets/images/items/r-fragment.png',
  sr_fragment: '/assets/images/items/sr-fragment.png',
  ur_fragment: '/assets/images/items/ur-fragment.png',
  gr_fragment: '/assets/images/items/gr-fragment.png'
};

const formatNumber = (value) => new Intl.NumberFormat('vi-VN').format(value ?? 0);

async function fragmentRequest(url, options) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('Máy chủ không trả về dữ liệu ghép mảnh hợp lệ.');
  }
  if (!response.ok) throw new Error(result.error || 'Không thể hoàn tất yêu cầu ghép mảnh.');
  return result;
}

export default function FragmentFusion({
  open,
  inventory,
  wallet,
  onClose,
  onInventoryChange,
  onWalletChange,
  onPendingChange
}) {
  const [loading, setLoading] = useState(false);
  const [snapshotLoaded, setSnapshotLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [celebration, setCelebration] = useState(null);
  const pendingRef = useRef(false);
  const requestRef = useRef(null);
  const ownedItems = useMemo(
    () => new Map((inventory || []).map((item) => [item.id, item.quantity])),
    [inventory]
  );
  const rows = useMemo(
    () => FRAGMENT_ROWS.map((row) => {
      const quantity = ownedItems.get(row.itemId) || 0;
      return {
        ...row,
        owned: quantity,
        ready: snapshotLoaded
          && quantity >= row.quantity
          && (wallet?.gold || 0) >= row.gold
      };
    }),
    [ownedItems, snapshotLoaded, wallet?.gold]
  );

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setLoading(true);
    setSnapshotLoaded(false);
    setError('');
    setCelebration(null);
    Promise.all([
      fragmentRequest('/api/inventory'),
      fragmentRequest('/api/wallet')
    ])
      .then(([inventoryResult, walletResult]) => {
        if (!Array.isArray(inventoryResult.inventory) || !walletResult.wallet) {
          throw new Error('Dữ liệu Hộp Ma Thuật hoặc Gold bị thiếu.');
        }
        if (!active) return;
        onInventoryChange(inventoryResult.inventory);
        onWalletChange(walletResult.wallet);
        setSnapshotLoaded(true);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || 'Không thể tải dữ liệu ghép mảnh.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, onInventoryChange, onWalletChange]);

  if (!open) return null;

  const merge = async (row) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    onPendingChange(true);
    setError('');
    if (requestRef.current?.itemId !== row.itemId) {
      requestRef.current = {
        itemId: row.itemId,
        requestId: window.crypto.randomUUID()
      };
    }
    try {
      const result = await fragmentRequest('/api/fragments/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: row.itemId,
          request_id: requestRef.current.requestId
        })
      });
      if (!result.wallet || !Array.isArray(result.inventory) || !result.reward) {
        throw new Error('Máy chủ chưa xác nhận đầy đủ kết quả ghép mảnh.');
      }
      onInventoryChange(result.inventory);
      onWalletChange(result.wallet);
      requestRef.current = null;
      setCelebration({
        title: 'Chúc mừng bạn nhận được vật phẩm!',
        eyebrow: 'GHÉP MẢNH THÀNH CÔNG',
        message: result.message,
        rewards: [result.reward]
      });
    } catch (requestError) {
      setError(requestError.message || 'Không thể ghép mảnh. Hãy thử lại.');
    } finally {
      pendingRef.current = false;
      setPending(false);
      onPendingChange(false);
    }
  };

  return (
    <>
      <section className="fragment-modal" role="dialog" aria-modal="true" aria-labelledby="fragmentFusionTitle">
        <button className="fragment-modal__scrim" type="button" onClick={onClose} disabled={pending} aria-label="Đóng Ghép Mảnh" />
        <div className="fragment-modal__panel">
          <FragmentCanvas rows={rows} loading={loading} />
          <header className="fragment-modal__header">
            <div>
              <h2 id="fragmentFusionTitle">Ghép Mảnh</h2>
            </div>
            <button className="fragment-modal__close" type="button" onClick={onClose} disabled={pending} aria-label="Đóng">×</button>
          </header>

          {loading
            ? <p className="fragment-modal__status" role="status">Đang tải Hộp Ma Thuật…</p>
            : !snapshotLoaded
              ? <p className="fragment-modal__error" role="alert">{error || 'Không thể tải dữ liệu ghép mảnh.'}</p>
              : (
              <div className="fragment-modal__rows">
                {rows.map((row) => (
                    <article
                      className={`fragment-row${row.ready ? ' is-ready' : ''}`}
                      data-fragment-row={row.itemId}
                      key={row.itemId}
                    >
                      <div className="fragment-row__item">
                        <img src={ITEM_IMAGES[row.itemId]} alt="" />
                        <span><strong>{row.name}</strong><small>{formatNumber(row.owned)} / {row.quantity} mảnh</small></span>
                      </div>
                      <div className="fragment-row__cost">
                        <img src="/assets/images/currency/gold.png" alt="" />
                        <span>{formatNumber(row.gold)} Gold</span>
                      </div>
                      <button
                        className="fragment-row__merge"
                        type="button"
                        disabled={pending || loading || !row.ready}
                        onClick={() => merge(row)}
                      >
                        {pending ? 'Đang ghép…' : 'Ghép Mảnh'}
                      </button>
                      <div className="fragment-row__reward">
                        <img src={ITEM_IMAGES[row.rewardId]} alt="" />
                        <span>{row.rewardName}<small>×1</small></span>
                      </div>
                    </article>
                  ))}
              </div>
            )}

          {snapshotLoaded && error && <p className="fragment-modal__error" role="alert">{error}</p>}
          <footer className="fragment-modal__footer">
            <span><img src="/assets/images/currency/gold.png" alt="" />Gold hiện có: <b>{formatNumber(wallet?.gold)}</b></span>
          </footer>
        </div>
      </section>
      {celebration && (
        <div className="attendance-modal fragment-fusion__reward-host">
          <AttendanceRewardDialog
            celebration={celebration}
            onClose={() => setCelebration(null)}
            showEyebrow={false}
            showMessage={false}
          />
        </div>
      )}
    </>
  );
}
