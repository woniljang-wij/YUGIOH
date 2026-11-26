import { useEffect, useMemo, useRef, useState } from 'react';
import AttendanceCanvas from './AttendanceCanvas.jsx';
import AttendanceConfirmDialog from './AttendanceConfirmDialog.jsx';
import AttendanceRewardDialog from './AttendanceRewardDialog.jsx';

const formatNumber = (value) => new Intl.NumberFormat('vi-VN').format(value ?? 0);

function formatReceivedDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('vi-VN', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh'
  }).format(date).replace(',', '');
}

function formatOnlineTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;
  return hours
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

async function attendanceRequest(url, options) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('Máy chủ không trả về dữ liệu điểm danh hợp lệ.');
  }
  if (!response.ok) throw new Error(result.error || 'Không thể hoàn tất yêu cầu điểm danh.');
  return result;
}

function RewardIcon({ reward, claimed = false }) {
  return (
    <span className={`attendance-reward__icon attendance-reward__icon--${reward.kind}${claimed ? ' is-claimed' : ''}`}>
      <img src={`/${reward.image}`} alt="" aria-hidden="true" />
    </span>
  );
}

function AttendanceModal({ open, onClose, onWalletChange, onMissionsChange, presence }) {
  const panelRef = useRef(null);
  const [snapshot, setSnapshot] = useState(null);
  const [activeTab, setActiveTab] = useState('monthly');
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState('');
  const [error, setError] = useState('');
  const [makeupDay, setMakeupDay] = useState(null);
  const [celebration, setCelebration] = useState(null);
  const [clientNow, setClientNow] = useState(Date.now);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setLoading(true);
    setError('');
    attendanceRequest('/api/attendance')
      .then((result) => {
        if (!active) return;
        if (!result.snapshot) throw new Error('Dữ liệu điểm danh bị thiếu.');
        setSnapshot(result.snapshot);
        onWalletChange(result.snapshot.wallet);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || 'Không thể tải dữ liệu điểm danh.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const timer = window.setInterval(() => setClientNow(Date.now()), 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [open, onWalletChange]);

  useEffect(() => {
    if (!open || !presence || !snapshot) return;
    if (presence.business_date !== snapshot.business_date) {
      if (presence.business_date > snapshot.business_date) {
        setSnapshot(presence);
        onWalletChange(presence.wallet);
      }
      return;
    }
    const incomingTime = Date.parse(presence.server_now);
    const currentTime = Date.parse(snapshot.server_now);
    if (Number.isFinite(incomingTime) && incomingTime >= currentTime) {
      setSnapshot(presence);
    }
  }, [open, presence, snapshot, onWalletChange]);

  const claimsByDay = useMemo(
    () => new Map((snapshot?.monthly_claims || []).map((claim) => [claim.day, claim])),
    [snapshot?.monthly_claims]
  );
  const rewardsByDay = useMemo(
    () => new Map((snapshot?.monthly_rewards || []).map((entry) => [entry.day, entry.reward])),
    [snapshot?.monthly_rewards]
  );
  const dayNumber = snapshot ? Number(snapshot.business_date.slice(-2)) : 0;
  const firstWeekday = snapshot
    ? (new Date(Date.UTC(snapshot.year, snapshot.month - 1, 1)).getUTCDay() + 6) % 7
    : 0;
  const currentPresenceBase = snapshot && presence?.business_date === snapshot.business_date
    && Date.parse(presence.server_now) >= Date.parse(snapshot.server_now)
    ? presence
    : snapshot;
  const onlineElapsed = currentPresenceBase
    ? Math.max(0, Math.floor((clientNow - Date.parse(currentPresenceBase.server_now)) / 1000))
    : 0;
  const onlineSeconds = (currentPresenceBase?.online_seconds || 0) + onlineElapsed;
  const nextMilestone = snapshot?.online_milestones.find((milestone) => !milestone.claimed);
  const nextMilestoneSeconds = nextMilestone?.required_seconds || 3600;
  const onlineProgress = Math.min(100, onlineSeconds * 100 / nextMilestoneSeconds);

  const claimReward = async (claimType, values = {}) => {
    if (pendingAction) return;
    setPendingAction(claimType);
    setError('');
    try {
      const result = await attendanceRequest('/api/attendance/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          claim_type: claimType,
          request_id: window.crypto.randomUUID(),
          ...values
        })
      });
      if (!result.snapshot || !Array.isArray(result.rewards)) {
        throw new Error('Máy chủ trả về kết quả nhận thưởng không đầy đủ.');
      }
      setSnapshot(result.snapshot);
      onWalletChange(result.wallet);
      setMakeupDay(null);
      setCelebration(result);
      if (claimType === 'monthly' || claimType === 'makeup') {
        void onMissionsChange?.();
      }
    } catch (requestError) {
      setError(requestError.message || 'Không thể nhận phần thưởng.');
    } finally {
      setPendingAction('');
    }
  };

  if (!open) return null;

  const dayLabel = snapshot
    ? new Intl.DateTimeFormat('vi-VN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Ho_Chi_Minh'
    }).format(new Date(`${snapshot.business_date}T12:00:00+07:00`))
    : '';
  const todayClaimed = claimsByDay.has(dayNumber);
  const makeupCost = snapshot?.makeup_cost || 100;
  const canAffordMakeup = (snapshot?.wallet.gems || 0) >= makeupCost;

  return (
    <section
      className="attendance-modal"
      id="attendanceModal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="attendanceTitle"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        if (celebration) {
          event.preventDefault();
          event.stopPropagation();
          setCelebration(null);
        } else if (makeupDay !== null) {
          event.preventDefault();
          event.stopPropagation();
          setMakeupDay(null);
        }
      }}
    >
      <button className="attendance-modal__scrim" type="button" onClick={onClose} aria-label="Đóng điểm danh" />
      <div className="attendance-modal__panel" ref={panelRef}>
        <AttendanceCanvas activeTab={activeTab} panelRef={panelRef} />
        <header className="attendance-modal__header">
          <div className="attendance-modal__heading">
            <span className="attendance-modal__eyebrow">TRUNG TÂM PHẦN THƯỞNG</span>
            <h2 id="attendanceTitle">ĐIỂM DANH</h2>
            <p><span aria-hidden="true">◷</span> {snapshot ? dayLabel : 'Nhận thưởng mỗi ngày bạn trở lại đấu trường'}</p>
          </div>
          <div className="attendance-modal__wallet" aria-label="Số dư hiện tại">
            <span><img src="/assets/images/currency/gold.png" alt="" />{formatNumber(snapshot?.wallet.gold)}</span>
            <span><img src="/assets/images/currency/gem.png" alt="" />{formatNumber(snapshot?.wallet.gems)}</span>
          </div>
          <button className="attendance-modal__close" type="button" onClick={onClose} aria-label="Đóng">×</button>
        </header>

        <div className="attendance-modal__tabs" role="tablist" aria-label="Chức năng điểm danh">
          <button
            type="button"
            role="tab"
            id="attendanceMonthlyTab"
            aria-selected={activeTab === 'monthly'}
            aria-controls="attendanceMonthlyPanel"
            className={activeTab === 'monthly' ? 'is-active' : ''}
            onClick={() => setActiveTab('monthly')}
          >
            <span className="attendance-tab__ornament" aria-hidden="true">✦</span>
            <span>Điểm danh tháng</span>
            <span className="attendance-tab__ornament" aria-hidden="true">✦</span>
          </button>
          <button
            type="button"
            role="tab"
            id="attendanceOnlineTab"
            aria-selected={activeTab === 'online'}
            aria-controls="attendanceOnlinePanel"
            className={activeTab === 'online' ? 'is-active' : ''}
            onClick={() => setActiveTab('online')}
          >
            <svg className="attendance-tab__wifi" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M2.5 8.8a14.2 14.2 0 0 1 19 0M5.7 12a9.4 9.4 0 0 1 12.6 0m-9.2 3.2a4.6 4.6 0 0 1 5.8 0M12 19h.01" />
            </svg>
            <span>Điểm danh online</span>
            <span className="attendance-tab__ornament" aria-hidden="true">✦</span>
          </button>
        </div>

        {loading && !snapshot
          ? <p className="attendance-modal__status" role="status">Đang tải dữ liệu điểm danh…</p>
          : error && !snapshot
            ? <div className="attendance-modal__status is-error" role="alert">{error}</div>
            : snapshot && activeTab === 'monthly'
              ? <div className="attendance-modal__content" id="attendanceMonthlyPanel" role="tabpanel" aria-labelledby="attendanceMonthlyTab">
                <div className="attendance-monthly__summary">
                  <div>
                    <span>LỊCH ĐIỂM DANH</span>
                    <strong>Tháng {snapshot.month} - {snapshot.year}</strong>
                  </div>
                  <div className="attendance-monthly__count">
                    <strong>{snapshot.monthly_claimed_count}<small>/{snapshot.days_in_month}</small></strong>
                    <span>ngày đã nhận</span>
                    <i
                      className="attendance-monthly__count-progress"
                      style={{ '--attendance-progress': `${Math.min(100, snapshot.monthly_claimed_count * 100 / snapshot.days_in_month)}%` }}
                      aria-hidden="true"
                    />
                  </div>
                </div>
                <div
                  className="attendance-calendar"
                  role="grid"
                  aria-label={`Lịch điểm danh tháng ${snapshot.month}`}
                  style={{ '--calendar-weeks': Math.ceil((firstWeekday + snapshot.days_in_month) / 7) }}
                >
                  {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((weekday) => (
                    <span className="attendance-calendar__weekday" role="columnheader" key={weekday}>{weekday}</span>
                  ))}
                  {Array.from({ length: firstWeekday }, (_, index) => (
                    <span className="attendance-calendar__empty" aria-hidden="true" key={`empty-${index}`} />
                  ))}
                  {Array.from({ length: snapshot.days_in_month }, (_, index) => {
                    const day = index + 1;
                    const reward = rewardsByDay.get(day);
                    const claim = claimsByDay.get(day);
                    const receivedDate = claim?.is_makeup ? formatReceivedDate(claim.received_at) : '';
                    const isToday = day === dayNumber;
                    const isPast = day < dayNumber;
                    const missed = isPast && !claim;
                    const classNames = [
                      'attendance-day',
                      `attendance-day--${reward.kind}`,
                      claim ? 'is-claimed' : '',
                      isToday && !claim ? 'is-today' : '',
                      missed ? 'is-missed' : '',
                      day > dayNumber ? 'is-future' : ''
                    ].filter(Boolean).join(' ');
                    return (
                      <button
                        type="button"
                        role="gridcell"
                        className={classNames}
                        key={day}
                        disabled={!missed || Boolean(pendingAction)}
                        onClick={() => setMakeupDay(day)}
                        aria-label={`Ngày ${day}: ${reward.name} ${formatNumber(reward.amount)}${claim?.is_makeup ? `, đã nhận bù vào ${receivedDate}` : claim ? ', đã nhận' : missed ? ', bỏ lỡ, chọn để điểm danh bù' : isToday ? ', hôm nay' : ', chưa đến'}`}
                      >
                        <span className="attendance-day__meta">
                          <span className="attendance-day__number">{day}</span>
                          {claim?.is_makeup && <span className="attendance-day__makeup">BÙ</span>}
                        </span>
                        <span className="attendance-day__content">
                          <RewardIcon reward={reward} claimed={Boolean(claim)} />
                          <span className="attendance-day__reward">
                            <b>{formatNumber(reward.amount)}</b>
                            <small>{reward.name}</small>
                          </span>
                        </span>
                        {claim
                          ? <span
                            className="attendance-day__status attendance-day__status--claimed"
                            title={claim.is_makeup ? `Đã nhận bù ngày ${day} vào ${receivedDate}` : 'Đã nhận phần thưởng'}
                            data-mobile-label={receivedDate}
                          >
                            <i aria-hidden="true">✓</i>
                            <span>{claim.is_makeup ? `Đã bù ${receivedDate}` : 'Đã nhận'}</span>
                          </span>
                          : missed
                            ? <span className="attendance-day__status attendance-day__status--missed" data-hover-label="Điểm danh bù">Bỏ lỡ</span>
                            : isToday
                              ? <span className="attendance-day__status attendance-day__status--today">Hôm nay</span>
                              : null}
                      </button>
                    );
                  })}
                </div>
                <footer className="attendance-monthly__footer">
                  <span>{todayClaimed ? 'Bạn đã nhận phần thưởng hôm nay.' : 'Điểm danh hôm nay để nhận đúng phần thưởng của ngày.'}</span>
                  <button
                    className="attendance-button attendance-button--gold"
                    type="button"
                    disabled={todayClaimed || Boolean(pendingAction)}
                    onClick={() => claimReward('monthly')}
                  >
                    {pendingAction === 'monthly' ? 'Đang xử lý…' : todayClaimed ? 'Đã điểm danh' : 'Điểm danh hôm nay'}
                  </button>
                </footer>
              </div>
              : snapshot
                ? <div className="attendance-modal__content attendance-online" id="attendanceOnlinePanel" role="tabpanel" aria-labelledby="attendanceOnlineTab">
                  <section className="attendance-online__progress" aria-label="Tiến trình online hôm nay">
                    <div className="attendance-online__progress-heading">
                      <div><span>THỜI GIAN ONLINE HỢP LỆ</span><strong>{formatOnlineTime(onlineSeconds)}</strong></div>
                      <div><span>MỐC TIẾP THEO</span><strong>{nextMilestone ? formatOnlineTime(nextMilestone.required_seconds) : 'Đã hoàn thành'}</strong></div>
                      <small>{nextMilestone ? `Còn ${formatOnlineTime(Math.max(0, nextMilestone.required_seconds - onlineSeconds))}` : 'Bạn đã nhận đủ các mốc hôm nay'}</small>
                    </div>
                    <div className="attendance-online__bar" role="progressbar" aria-label="Tiến trình mốc online tiếp theo" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.floor(onlineProgress)}>
                      <i style={{ width: `${onlineProgress}%` }} />
                    </div>
                    <p>Thời gian được máy chủ ghi nhận và tự đặt lại theo ngày mới.</p>
                  </section>
                  <div className="attendance-online__milestones" aria-label="Lộ trình phần thưởng online">
                    <div className="attendance-online__milestones-rail" aria-hidden="true">
                      <i style={{ width: `${Math.min(100, onlineSeconds * 100 / 3600)}%` }} />
                    </div>
                    {snapshot.online_milestones.map((milestone, index) => {
                      const ready = onlineSeconds >= milestone.required_seconds;
                      return (
                        <article
                          className={`attendance-milestone${milestone.minutes === 60 ? ' attendance-milestone--grand' : ''}${milestone.claimed ? ' is-claimed' : ''}${ready && !milestone.claimed ? ' is-ready' : ''}`}
                          key={milestone.minutes}
                        >
                          <div className="attendance-milestone__node" aria-hidden="true">
                            <span>{String(index + 1).padStart(2, '0')}</span>
                          </div>
                          <div className="attendance-milestone__heading">
                            <span className="attendance-milestone__time">{String(milestone.minutes).padStart(2, '0')} phút</span>
                            {milestone.minutes === 60 && <span className="attendance-milestone__special">Đặc biệt</span>}
                          </div>
                          <div className="attendance-milestone__rewards">
                            {milestone.rewards.map((reward) => (
                              <span className={`attendance-milestone__reward attendance-milestone__reward--${reward.kind}`} key={reward.kind}>
                                <RewardIcon reward={reward} claimed={milestone.claimed} />
                                <b>{formatNumber(reward.amount)}</b>
                                <small>{reward.name}</small>
                              </span>
                            ))}
                          </div>
                          <div className="attendance-milestone__bar" aria-hidden="true">
                            <i style={{ width: `${Math.min(100, onlineSeconds * 100 / milestone.required_seconds)}%` }} />
                          </div>
                          <button
                            className={`attendance-button${milestone.claimed ? ' attendance-button--muted' : ' attendance-button--blue'}`}
                            type="button"
                            disabled={!ready || milestone.claimed || Boolean(pendingAction)}
                            onClick={() => claimReward('online', { milestone_minutes: milestone.minutes })}
                          >
                            {pendingAction === 'online' ? 'Đang nhận…' : milestone.claimed ? 'Đã nhận ✓' : ready ? 'Nhận thưởng' : formatOnlineTime(Math.max(0, milestone.required_seconds - onlineSeconds))}
                          </button>
                          {milestone.claimed && <span className="attendance-milestone__check" aria-label="Đã nhận">✓</span>}
                        </article>
                      );
                    })}
                  </div>
                </div>
                : null}

        {error && snapshot && <p className="attendance-modal__error" role="alert">{error}</p>}

        {makeupDay !== null && snapshot && (
          <AttendanceConfirmDialog
            eyebrow="ĐIỂM DANH BÙ"
            title={`Ngày ${makeupDay} tháng ${snapshot.month}`}
            titleId="attendanceMakeupTitle"
            onCancel={() => setMakeupDay(null)}
            confirmLabel="Xác nhận điểm danh bù"
            confirmDisabled={!canAffordMakeup}
            pending={Boolean(pendingAction)}
            onConfirm={() => claimReward('makeup', { day: makeupDay })}
          >
            <div className="attendance-dialog__reward-showcase">
              <RewardIcon reward={rewardsByDay.get(makeupDay)} />
              <span>Phần thưởng</span>
              <strong>{formatNumber(rewardsByDay.get(makeupDay).amount)} {rewardsByDay.get(makeupDay).name}</strong>
            </div>
            <p>Chi phí điểm danh bù <strong className="attendance-dialog__cost">{formatNumber(makeupCost)} Gem</strong></p>
            <div className="attendance-dialog__balance">
              <span>Gem hiện có <b>{formatNumber(snapshot.wallet.gems)}</b></span>
              <span>Còn lại <b>{formatNumber(Math.max(0, snapshot.wallet.gems - makeupCost))}</b></span>
            </div>
            {!canAffordMakeup && <p className="attendance-dialog__warning" role="alert">Bạn không đủ gem để điểm danh bù.</p>}
          </AttendanceConfirmDialog>
        )}

      </div>
      {celebration && (
        <AttendanceRewardDialog
          celebration={celebration}
          onClose={() => setCelebration(null)}
        />
      )}
    </section>
  );
}

export default AttendanceModal;
