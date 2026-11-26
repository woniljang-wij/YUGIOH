import { useCallback, useEffect, useRef, useState } from 'react';
import MissionChestsCanvas from './MissionChestsCanvas.jsx';

const ACTIVITY_ICON = '/assets/images/progression/activity-points.png';
const formatNumber = (value) => new Intl.NumberFormat('vi-VN').format(value ?? 0);

async function missionRequest(url, options) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('Máy chủ không trả về dữ liệu nhiệm vụ hợp lệ.');
  }
  if (!response.ok) throw new Error(result.error || 'Không thể hoàn tất yêu cầu nhiệm vụ.');
  return result;
}

function RewardList({ rewards, compact = false }) {
  return (
    <div className={`mission-rewards${compact ? ' mission-rewards--compact' : ''}`}>
      {rewards.map((reward) => (
        <div className="mission-reward" key={reward.kind}>
          <span className="mission-reward__frame">
            <img src={`/${reward.image}`} alt="" aria-hidden="true" />
          </span>
          <span className="mission-reward__name">{reward.name}</span>
          <strong>×{formatNumber(reward.amount)}</strong>
        </div>
      ))}
    </div>
  );
}

function MissionModal({
  open,
  initialSnapshot,
  onClose,
  onSnapshotChange,
  onWalletChange,
  onInventoryChange,
  onOpenAttendance,
  onOpenShop
}) {
  const panelRef = useRef(null);
  const closeTimerRef = useRef(0);
  const closingRef = useRef(false);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState('');
  const [error, setError] = useState('');
  const [detailChestId, setDetailChestId] = useState('');
  const [hoveredChestId, setHoveredChestId] = useState('');
  const [celebration, setCelebration] = useState(null);
  const [closing, setClosing] = useState(false);

  const applySnapshot = useCallback((nextSnapshot) => {
    setSnapshot(nextSnapshot);
    onSnapshotChange?.(nextSnapshot);
  }, [onSnapshotChange]);

  const loadSnapshot = useCallback(async () => {
    const result = await missionRequest('/api/missions');
    if (!result.snapshot || !Array.isArray(result.snapshot.missions) || !Array.isArray(result.snapshot.chests)) {
      throw new Error('Dữ liệu nhiệm vụ từ máy chủ không đầy đủ.');
    }
    applySnapshot(result.snapshot);
    return result.snapshot;
  }, [applySnapshot]);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    window.clearTimeout(closeTimerRef.current);
    closingRef.current = false;
    setClosing(false);
    setLoading(true);
    setError('');
    loadSnapshot()
      .catch((requestError) => {
        if (active) setError(requestError.message || 'Không thể tải dữ liệu nhiệm vụ.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    window.requestAnimationFrame(() => panelRef.current?.focus());
    return () => {
      active = false;
      window.clearTimeout(closeTimerRef.current);
    };
  }, [open, loadSnapshot]);

  useEffect(() => () => window.clearTimeout(closeTimerRef.current), []);

  const close = (afterClose = onClose) => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => afterClose?.(), 190);
  };

  const applyClaimResult = (result) => {
    if (!result.snapshot || !Array.isArray(result.rewards) || !result.wallet) {
      throw new Error('Kết quả nhận thưởng từ máy chủ không đầy đủ.');
    }
    applySnapshot(result.snapshot);
    onWalletChange?.(result.wallet);
    if (Array.isArray(result.inventory)) onInventoryChange?.(result.inventory);
    setCelebration(result);
  };

  const claimMission = async (mission) => {
    if (pendingAction || !mission.claimable) return;
    setPendingAction(mission.id);
    setError('');
    try {
      const result = await missionRequest('/api/missions/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mission_id: mission.id,
          request_id: window.crypto.randomUUID()
        })
      });
      applyClaimResult(result);
    } catch (requestError) {
      setError(requestError.message || 'Không thể nhận thưởng nhiệm vụ.');
      loadSnapshot().catch((refreshError) => {
        console.error('Không thể làm mới nhiệm vụ sau lỗi nhận thưởng:', refreshError);
      });
    } finally {
      setPendingAction('');
    }
  };

  const claimChest = async (chest) => {
    if (pendingAction || !chest.unlocked || chest.claimed) return;
    setPendingAction(chest.id);
    setError('');
    try {
      const result = await missionRequest('/api/missions/chests/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chest_id: chest.id,
          request_id: window.crypto.randomUUID()
        })
      });
      if (!result.snapshot || !Array.isArray(result.rewards) || !result.wallet) {
        throw new Error('Kết quả nhận rương từ máy chủ không đầy đủ.');
      }
      applySnapshot(result.snapshot);
      onWalletChange?.(result.wallet);
      if (Array.isArray(result.inventory)) onInventoryChange?.(result.inventory);
      setDetailChestId('');
      setCelebration(result);
    } catch (requestError) {
      setError(requestError.message || 'Không thể nhận phần thưởng rương.');
      loadSnapshot().catch((refreshError) => {
        console.error('Không thể làm mới nhiệm vụ sau lỗi nhận rương:', refreshError);
      });
    } finally {
      setPendingAction('');
    }
  };

  const openAction = (action) => {
    close(() => {
      onClose?.();
      action?.();
    });
  };

  if (!open) return null;

  const currentChest = snapshot?.chests.find((chest) => chest.id === detailChestId);
  const activityPoints = snapshot?.activity_points ?? 0;
  const progressPercent = Math.min(100, activityPoints * 100 / 500);
  const chestMilestones = snapshot?.chests || [];
  const missionRows = snapshot?.missions || [];
  const badgeCount = snapshot?.pending_rewards || 0;

  return (
    <section
      className={`mission-modal${closing ? ' is-closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="missionTitle"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        event.preventDefault();
        if (celebration) setCelebration(null);
        else if (detailChestId) setDetailChestId('');
        else close();
      }}
    >
      <button className="mission-modal__scrim" type="button" onClick={() => close()} aria-label="Đóng nền nhiệm vụ" />
      <div className="mission-panel" ref={panelRef} tabIndex="-1">
        <header className="mission-panel__header">
          <div className="mission-panel__title">
            <span>TRUNG TÂM NHIỆM VỤ</span>
            <h2 id="missionTitle">NHIỆM VỤ</h2>
          </div>
          <button className="mission-close" type="button" onClick={() => close()} aria-label="Đóng nhiệm vụ">×</button>
        </header>

        <div className="mission-panel__scroll">
          {error && <p className="mission-error" role="alert">{error}</p>}
          <section className="activity-section" aria-labelledby="activityTitle">
            <div className="activity-section__heading">
              <img src={ACTIVITY_ICON} alt="" aria-hidden="true" />
              <div>
                <h3 id="activityTitle">ĐIỂM NĂNG ĐỘNG</h3>
                <p>Chu kỳ tuần · {snapshot?.week_start || 'Đang tải'} – {snapshot?.week_end || ''}</p>
                <p className="activity-current-progress">
                  Tiến trình hiện tại: {formatNumber(activityPoints)}
                </p>
              </div>
            </div>

            <div className="mission-chests" aria-label="Rương mốc điểm năng động">
              {snapshot && (
                <MissionChestsCanvas
                  chests={chestMilestones}
                  hoveredChestId={hoveredChestId}
                />
              )}
              <div className="mission-chests__buttons">
                {chestMilestones.map((chest, index) => {
                  const chestStatus = chest.claimed ? 'Đã nhận' : chest.unlocked ? 'Nhận thưởng' : 'Chưa đủ điểm';
                  const chestPosition = 5 + chest.threshold / 500 * 90;
                  return (
                    <button
                      className={`mission-chest${chest.unlocked && !chest.claimed ? ' is-unlocked' : ''}${chest.claimed ? ' is-claimed' : ''}`}
                      type="button"
                      key={chest.id}
                      disabled={Boolean(pendingAction)}
                      onClick={() => setDetailChestId(chest.id)}
                      onMouseEnter={() => setHoveredChestId(chest.id)}
                      onMouseLeave={() => setHoveredChestId('')}
                      onFocus={() => setHoveredChestId(chest.id)}
                      onBlur={() => setHoveredChestId('')}
                      style={{ left: `${chestPosition}%` }}
                      aria-label={`Xem phần thưởng rương ${index + 1}, mốc ${chest.threshold} điểm, ${chestStatus}`}
                    >
                      <span className="mission-chest__status">{chest.claimed ? '✓ ĐÃ NHẬN' : chest.unlocked ? 'NHẬN THƯỞNG' : 'KHÓA'}</span>
                      <strong>{formatNumber(chest.threshold)}</strong>
                      <small>{chest.claimed ? 'Đã nhận' : chest.unlocked ? 'Sẵn sàng' : 'Xem phần thưởng'}</small>
                    </button>
                  );
                })}
              </div>
            </div>

            <div
              className="activity-progress"
              role="progressbar"
              aria-label="Tiến trình điểm năng động tuần"
              aria-valuemin="0"
              aria-valuemax="500"
              aria-valuenow={Math.min(activityPoints, 500)}
            >
              <div className="activity-progress__track">
                <i style={{ width: `${progressPercent}%` }} />
              </div>
              {chestMilestones.map((chest) => (
                <span
                  className={`activity-progress__marker${chest.unlocked ? ' is-active' : ''}`}
                  key={chest.id}
                  style={{ left: `${5 + chest.threshold / 500 * 90}%` }}
                >
                  <i />
                  <b>{chest.threshold}</b>
                </span>
              ))}
            </div>
          </section>

          <section className="mission-list" aria-label="Danh sách nhiệm vụ">
            {loading && !snapshot ? (
              <p className="mission-status" role="status">Đang tải nhiệm vụ…</p>
            ) : missionRows.map((mission, index) => {
              const isComplete = mission.progress >= mission.target;
              const action = mission.id === 'daily_attendance' || mission.id === 'weekly_attendance'
                ? onOpenAttendance
                : mission.id === 'daily_pack' || mission.id === 'daily_packs_10'
                  ? onOpenShop
                  : null;
              const actionLabel = mission.id === 'daily_attendance' || mission.id === 'weekly_attendance'
                ? 'Mở điểm danh'
                : 'Mở cửa hàng';
              return (
                <article
                  className={`mission-card${isComplete ? ' is-complete' : ''}${mission.claimed ? ' is-claimed' : ''}`}
                  key={mission.id}
                  style={{ '--mission-index': index }}
                >
                  <header className="mission-card__heading">
                    <span className="mission-card__number">{String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <h3>{mission.name}</h3>
                      <small>{mission.cycle === 'weekly' ? 'NHIỆM VỤ TUẦN' : 'NHIỆM VỤ NGÀY'}</small>
                    </div>
                    {mission.claimed && <span className="mission-card__check" aria-label="Đã nhận">✓</span>}
                  </header>
                  <p className="mission-card__description">{mission.description}</p>
                  <RewardList rewards={mission.rewards} compact />
                  <div className="mission-card__progress" aria-label={`Tiến độ ${mission.progress} trên ${mission.target}`}>
                    <div><i style={{ width: `${Math.min(100, mission.progress * 100 / mission.target)}%` }} /></div>
                    <strong>{mission.progress}/{mission.target}</strong>
                  </div>
                  {!mission.claimed && mission.claimable ? (
                    <button
                      className="mission-action mission-action--claim"
                      type="button"
                      disabled={Boolean(pendingAction)}
                      onClick={() => claimMission(mission)}
                    >
                      {pendingAction === mission.id ? 'ĐANG NHẬN…' : 'NHẬN THƯỞNG'}
                    </button>
                  ) : mission.claimed ? (
                    <button className="mission-action mission-action--done" type="button" disabled>ĐÃ NHẬN ✓</button>
                  ) : action ? (
                    <button
                      className="mission-action mission-action--visit"
                      type="button"
                      disabled={Boolean(pendingAction)}
                      onClick={() => openAction(action)}
                    >
                      {actionLabel}
                    </button>
                  ) : (
                    <span className="mission-action mission-action--progress">ĐANG THỰC HIỆN</span>
                  )}
                </article>
              );
            })}
          </section>
        </div>
      </div>

      {currentChest && (
        <div className="mission-dialog-layer">
          <button className="mission-dialog__scrim" type="button" onClick={() => setDetailChestId('')} aria-label="Đóng chi tiết rương" />
          <section className="mission-dialog mission-chest-detail" role="dialog" aria-modal="true" aria-labelledby="chestDetailTitle">
            <header className="mission-dialog__header">
              <div>
                <span>PHẦN THƯỞNG ĐIỂM NĂNG ĐỘNG</span>
                <h2 id="chestDetailTitle">THƯỞNG NĂNG ĐỘNG</h2>
              </div>
              <button className="mission-close mission-close--small" type="button" onClick={() => setDetailChestId('')} aria-label="Đóng chi tiết rương">×</button>
            </header>
            <div className="mission-chest-detail__summary">
              <span className="mission-chest-detail__art" aria-hidden="true">
                <MissionChestsCanvas chests={[currentChest]} />
              </span>
              <div>
                <strong>Năng động đạt {formatNumber(currentChest.threshold)}</strong>
                <span>{currentChest.claimed ? 'Rương đã được nhận trong tuần này.' : 'Phần thưởng của mốc này'}</span>
              </div>
            </div>
            <div className="mission-chest-detail__rewards">
              <h3>NHẬN ĐƯỢC THƯỞNG</h3>
              <RewardList rewards={currentChest.rewards} />
            </div>
            <div className="mission-dialog__actions">
              {currentChest.claimed ? (
                <button className="mission-action mission-action--done" type="button" disabled>ĐÃ NHẬN ✓</button>
              ) : (
                <button
                  className="mission-action mission-action--claim"
                  type="button"
                  disabled={!currentChest.unlocked || Boolean(pendingAction)}
                  onClick={() => claimChest(currentChest)}
                >
                  {pendingAction === currentChest.id ? 'ĐANG NHẬN…' : 'NHẬN THƯỞNG'}
                </button>
              )}
            </div>
          </section>
        </div>
      )}

      {celebration && (
        <div className="mission-dialog-layer mission-celebration-layer">
          <button className="mission-dialog__scrim" type="button" onClick={() => setCelebration(null)} aria-label="Đóng thông báo phần thưởng" />
          <section className="mission-dialog mission-celebration" role="dialog" aria-modal="true" aria-labelledby="missionCelebrationTitle">
            <button className="mission-close mission-close--small" type="button" onClick={() => setCelebration(null)} aria-label="Đóng">×</button>
            <span className="mission-celebration__seal" aria-hidden="true">✦</span>
            <h2 id="missionCelebrationTitle">CHÚC MỪNG!</h2>
            <p>{celebration.message}</p>
            <RewardList rewards={celebration.rewards} />
            <button className="mission-action mission-action--claim" type="button" onClick={() => setCelebration(null)}>ĐÓNG</button>
          </section>
        </div>
      )}
    </section>
  );
}

export default MissionModal;
