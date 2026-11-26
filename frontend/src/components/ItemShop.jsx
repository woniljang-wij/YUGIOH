import React, { useEffect, useRef, useState } from 'react';
import AttendanceConfirmDialog from './AttendanceConfirmDialog.jsx';
import AttendanceRewardDialog from './AttendanceRewardDialog.jsx';
import CurrencyBar from './CurrencyBar.jsx';

const ITEM_ID = 'rename_card';
const ITEM_NAME = 'Thẻ Đổi Tên';
const ITEM_IMAGE = 'assets/images/items/rename-card.png';
const UNIT_PRICE = 500;
const MAX_QUANTITY = 2147483;
const formatCurrency = (value) => new Intl.NumberFormat('vi-VN').format(value ?? 0);

async function shopRequest(url, options) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('Máy chủ không trả về dữ liệu Shop Vật Phẩm hợp lệ.');
  }
  if (!response.ok) throw new Error(result.error || 'Không thể hoàn tất giao dịch Shop Vật Phẩm.');
  return result;
}

function ItemShop({ open, wallet, inventory, onWalletChange, onInventoryChange, onClose }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [detailOpen, setDetailOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [celebration, setCelebration] = useState(null);
  const purchaseRequest = useRef(null);

  const ownedQuantity = inventory.find((item) => item.id === ITEM_ID)?.quantity || 0;
  const affordableQuantity = Math.min(
    Math.floor((Number(wallet?.gems) || 0) / UNIT_PRICE),
    MAX_QUANTITY,
    Math.max(0, 2147483647 - ownedQuantity)
  );
  const sliderMax = Math.max(1, affordableQuantity);
  const totalPrice = quantity * UNIT_PRICE;

  const closeDetail = () => {
    if (!purchasing) {
      setConfirmOpen(false);
      setDetailOpen(false);
      setError('');
    }
  };

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setLoading(true);
    setError('');
    Promise.all([shopRequest('/api/wallet'), shopRequest('/api/inventory')])
      .then(([walletResult, inventoryResult]) => {
        if (!active) return;
        if (!walletResult.wallet || !Array.isArray(inventoryResult.inventory)) {
          throw new Error('Dữ liệu cửa hàng hoặc túi đồ không đầy đủ.');
        }
        onWalletChange(walletResult.wallet);
        onInventoryChange(inventoryResult.inventory);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || 'Không thể tải Shop Vật Phẩm.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, onWalletChange, onInventoryChange]);

  useEffect(() => {
    setQuantity((current) => Math.min(Math.max(1, current), sliderMax));
  }, [sliderMax]);

  useEffect(() => {
    if (!open) {
      setDetailOpen(false);
      setConfirmOpen(false);
      setCelebration(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (celebration) setCelebration(null);
      else if (confirmOpen && !purchasing) setConfirmOpen(false);
      else if (detailOpen && !purchasing) closeDetail();
      else if (!purchasing) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, celebration, confirmOpen, detailOpen, purchasing, onClose]);

  if (!open) return null;

  const confirmPurchase = async () => {
    if (purchasing || affordableQuantity < quantity) return;
    if (!purchaseRequest.current || purchaseRequest.current.quantity !== quantity) {
      purchaseRequest.current = {
        quantity,
        requestId: window.crypto.randomUUID()
      };
    }
    setPurchasing(true);
    setError('');
    try {
      const result = await shopRequest('/api/shop/items/rename-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quantity,
          request_id: purchaseRequest.current.requestId
        })
      });
      if (!result.wallet || !Array.isArray(result.inventory)) {
        throw new Error('Máy chủ chưa xác nhận đầy đủ kết quả mua hàng.');
      }
      onWalletChange(result.wallet);
      onInventoryChange(result.inventory);
      setConfirmOpen(false);
      setDetailOpen(false);
      purchaseRequest.current = null;
      setCelebration({
        message: `Mua ${ITEM_NAME} thành công! Đã thêm ${formatCurrency(quantity)} thẻ vào Hộp Ma Thuật. Bạn còn ${formatCurrency(result.wallet.gems)} Gem.`,
        rewards: [{
          kind: ITEM_ID,
          name: ITEM_NAME,
          image: ITEM_IMAGE,
          amount: quantity
        }]
      });
    } catch (requestError) {
      setError(requestError.message || 'Không thể mua vật phẩm. Hãy kiểm tra kết nối máy chủ.');
      setConfirmOpen(false);
    } finally {
      setPurchasing(false);
    }
  };

  return (
    <>
      <section className="item-shop" role="dialog" aria-modal="true" aria-labelledby="itemShopTitle">
        <button className="item-shop__scrim" type="button" onClick={onClose} aria-label="Đóng Shop Vật Phẩm" />
        <div className="item-shop__screen">
          <header className="item-shop__header">
            <button className="item-shop__back" type="button" onClick={onClose} aria-label="Quay lại sảnh">
              <span aria-hidden="true">←</span> Quay lại
            </button>
            <h1 id="itemShopTitle">Shop Vật Phẩm</h1>
            <CurrencyBar wallet={wallet} className="item-shop__wallet" />
          </header>
          {error && <p className="item-shop__error" role="alert">{error}</p>}
          {loading
            ? <p className="item-shop__status" role="status">Đang tải dữ liệu cửa hàng…</p>
            : <main className="item-shop__products">
              <button
                className="item-shop__product"
                type="button"
                onClick={() => {
                  setQuantity(1);
                  setDetailOpen(true);
                }}
                aria-label={`Xem chi tiết ${ITEM_NAME}`}
              >
                <span className="item-shop__artwork"><img src={`/${ITEM_IMAGE}`} alt="" /></span>
                <strong>{ITEM_NAME}</strong>
                <span className="item-shop__description">Vật phẩm dùng để thay đổi tên người chơi.</span>
                <span className="item-shop__price">
                  <img src="/assets/images/currency/gem.png" alt="" />
                  {formatCurrency(UNIT_PRICE)} Gem
                </span>
                <span className="item-shop__buy">Mua</span>
              </button>
            </main>}
        </div>
      </section>

      {detailOpen && (
        <div className="item-shop__detail-layer">
          <button className="item-shop__detail-scrim" type="button" onClick={closeDetail} aria-label="Đóng chi tiết vật phẩm" />
          <section className="item-shop__detail" role="dialog" aria-modal="true" aria-labelledby="itemShopDetailTitle">
            <header className="item-shop__detail-header">
              <h2 id="itemShopDetailTitle">Chi tiết vật phẩm</h2>
              <button type="button" onClick={closeDetail} aria-label="Đóng">×</button>
            </header>
            {error && <p className="item-shop__detail-error" role="alert">{error}</p>}
            <div className="item-shop__item-info">
              <span className="item-shop__item-image"><img src={`/${ITEM_IMAGE}`} alt="" /></span>
              <div>
                <h3>{ITEM_NAME}</h3>
                <p>Thẻ dùng để thay đổi tên người chơi.</p>
              </div>
            </div>
            <div className="item-shop__quantity">
              <label htmlFor="itemShopQuantity">Số lượng: <strong>{quantity}</strong></label>
              <div className="item-shop__quantity-control">
                <button type="button" aria-label="Giảm số lượng" disabled={quantity <= 1} onClick={() => setQuantity((value) => Math.max(1, value - 1))}>−</button>
                <input
                  id="itemShopQuantity"
                  type="range"
                  min="1"
                  max={sliderMax}
                  step="1"
                  value={quantity}
                  onChange={(event) => setQuantity(Number(event.target.value))}
                  aria-valuetext={`${quantity} thẻ`}
                />
                <button type="button" aria-label="Tăng số lượng" disabled={quantity >= affordableQuantity} onClick={() => setQuantity((value) => Math.min(sliderMax, value + 1))}>+</button>
              </div>
              <small>Tối đa có thể mua: {formatCurrency(affordableQuantity)} thẻ</small>
            </div>
            <div className="item-shop__total">
              <span>Tổng thanh toán</span>
              <strong><img src="/assets/images/currency/gem.png" alt="" />{formatCurrency(totalPrice)} Gem</strong>
            </div>
            {affordableQuantity < 1 && <p className="item-shop__insufficient" role="alert">Bạn không đủ Gem để mua vật phẩm này.</p>}
            <button
              className="item-shop__purchase"
              type="button"
              disabled={affordableQuantity < quantity || purchasing}
              onClick={() => setConfirmOpen(true)}
            >
              Mua
            </button>
          </section>
        </div>
      )}

      {confirmOpen && (
        <div className="attendance-modal item-shop__confirm-host">
          <AttendanceConfirmDialog
            panelClassName="item-shop__confirm"
            eyebrow="XÁC NHẬN GIAO DỊCH"
            title="Xác nhận mua hàng"
            titleId="itemShopConfirmTitle"
            cancelLabel="Hủy"
            confirmLabel="Xác nhận"
            pending={purchasing}
            confirmDisabled={affordableQuantity < quantity}
            onCancel={() => setConfirmOpen(false)}
            onConfirm={confirmPurchase}
          >
            <div className="item-shop__confirm-item">
              <img src={`/${ITEM_IMAGE}`} alt="" />
              <div><strong>{ITEM_NAME} × {formatCurrency(quantity)}</strong><span>Bạn có chắc chắn muốn mua {formatCurrency(quantity)} {ITEM_NAME} với giá {formatCurrency(totalPrice)} Gem không?</span></div>
            </div>
            <div className="attendance-dialog__balance">
              <span>Gem hiện có <b>{formatCurrency(wallet.gems)}</b></span>
              <span>Còn lại <b>{formatCurrency(Math.max(0, Number(wallet.gems) - totalPrice))}</b></span>
            </div>
          </AttendanceConfirmDialog>
        </div>
      )}

      {celebration && (
        <div className="attendance-modal item-shop__reward-host">
          <AttendanceRewardDialog celebration={celebration} onClose={() => setCelebration(null)} />
        </div>
      )}
    </>
  );
}

export default ItemShop;
