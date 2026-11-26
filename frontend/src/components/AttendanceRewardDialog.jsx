import AttendanceRewardEffects from './AttendanceRewardEffects.jsx';
import { CardFace } from './CardFace.jsx';

const formatNumber = (value) => new Intl.NumberFormat('vi-VN').format(value ?? 0);

function RewardIcon({ reward }) {
  return (
    <span className={`attendance-reward__icon attendance-reward__icon--${reward.kind}`}>
      <img src={`/${reward.image}`} alt="" aria-hidden="true" />
    </span>
  );
}

export default function AttendanceRewardDialog({
  celebration,
  onClose,
  showEyebrow = true,
  showMessage = true
}) {
  const isMakeup = Boolean(celebration.claim?.is_makeup);
  const title = celebration.title || 'Chúc mừng!';
  const eyebrow = celebration.eyebrow || (isMakeup ? 'ĐIỂM DANH BÙ THÀNH CÔNG' : 'PHẦN THƯỞNG ĐÃ ĐƯỢC NHẬN');
  const claimDay = celebration.claim?.business_date
    ? Number(celebration.claim.business_date.slice(-2))
    : null;
  const message = celebration.claim?.type === 'online'
    ? `Bạn đã hoàn thành mốc ${celebration.claim.milestone_minutes} phút online.`
    : isMakeup
      ? `Bạn đã điểm danh bù ngày ${claimDay}.`
      : claimDay
        ? `Bạn đã điểm danh ngày ${claimDay}.`
        : celebration.message || 'Phần thưởng đã được thêm vào túi đồ của bạn.';

  return (
    <div className="attendance-dialog attendance-dialog--success">
      <button className="attendance-dialog__scrim" type="button" onClick={onClose} aria-label="Đóng thông báo nhận thưởng" />
      <section className="attendance-dialog__panel attendance-success" role="dialog" aria-modal="true" aria-labelledby="attendanceSuccessTitle">
        <span className="attendance-success__burst" aria-hidden="true">
          <span className="attendance-success__burst-ring" />
        </span>
        <button className="attendance-success__close" type="button" onClick={onClose} aria-label="Đóng">×</button>
        <span className="attendance-success__sigil" aria-hidden="true">
          <svg viewBox="0 0 64 64" focusable="false">
            <path d="M5 32 Q32 4 59 32 Q32 60 5 32Z" />
            <circle cx="32" cy="32" r="13" />
            <circle cx="32" cy="32" r="5" />
            <path d="M32 2v9M32 53v9M2 32h9M53 32h9" />
          </svg>
        </span>
        <div className="attendance-success__heading">
          {showEyebrow && <span className="attendance-dialog__eyebrow">{eyebrow}</span>}
          <h3 id="attendanceSuccessTitle">{title}</h3>
          {showMessage && <p>{message}</p>}
        </div>
        <div className="attendance-success__showcase">
          <AttendanceRewardEffects />
          <div className="attendance-success__rewards">
            {celebration.rewards.map((reward, index) => (
              reward.kind === 'card' && reward.card
                ? (
                  <div className="attendance-success__reward attendance-success__reward--card" key={`${reward.kind}-${index}`}>
                    <CardFace card={reward.card} className="attendance-success__card-face" />
                    <b>×{formatNumber(reward.amount)}</b>
                    <small>{reward.name}</small>
                  </div>
                )
                : (
                  <span className={`attendance-success__reward attendance-success__reward--${reward.kind}`} key={`${reward.kind}-${index}`}>
                    <RewardIcon reward={reward} />
                    <b>{formatNumber(reward.amount)}</b>
                    <small>{reward.name}</small>
                  </span>
                )
            ))}
          </div>
        </div>
        <button className="attendance-button attendance-success__continue" type="button" onClick={onClose} autoFocus>
          Tiếp tục
        </button>
      </section>
    </div>
  );
}
