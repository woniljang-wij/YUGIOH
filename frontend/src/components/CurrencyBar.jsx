import React from 'react';

const formatCurrency = (value) => new Intl.NumberFormat('vi-VN').format(value ?? 0);

export default function CurrencyBar({ wallet, className = 'currency' }) {
  return (
    <div className={className} aria-label="Số dư tài khoản">
      <div className="currency__item currency__item--gold">
        <img className="currency__icon" src="/assets/images/currency/gold.png" alt="" aria-hidden="true" />
        <span>{formatCurrency(wallet?.gold)}</span>
        <button className="currency__plus" type="button" data-gem-exchange-open aria-label="Mở đổi gem sang vàng">+</button>
      </div>
      <div className="currency__item currency__item--gem">
        <img className="currency__icon" src="/assets/images/currency/gem.png" alt="" aria-hidden="true" />
        <span>{formatCurrency(wallet?.gems)}</span>
        <button className="currency__plus" type="button" data-gem-exchange-open aria-label="Mở đổi gem sang vàng">+</button>
      </div>
    </div>
  );
}
