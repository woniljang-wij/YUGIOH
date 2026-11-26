import { useEffect, useRef } from 'react';

export function useOnlinePresence(onSnapshot) {
  const onSnapshotRef = useRef(onSnapshot);

  useEffect(() => {
    onSnapshotRef.current = onSnapshot;
  }, [onSnapshot]);

  useEffect(() => {
    let active = true;
    let requestInFlight = false;
    let failureReported = false;

    const sendHeartbeat = async () => {
      if (!active || document.visibilityState === 'hidden' || requestInFlight) return;
      requestInFlight = true;
      try {
        const response = await fetch('/api/attendance/heartbeat', {
          method: 'POST',
          credentials: 'same-origin'
        });
        let result;
        try {
          result = await response.json();
        } catch {
          throw new Error('Máy chủ không trả về dữ liệu điểm danh online hợp lệ.');
        }
        if (!response.ok) {
          throw new Error(result.error || 'Không thể cập nhật thời gian online.');
        }
        if (!result.snapshot) throw new Error('Dữ liệu thời gian online bị thiếu.');
        if (!active) return;
        failureReported = false;
        onSnapshotRef.current?.(result.snapshot);
      } catch (error) {
        if (!failureReported) {
          console.warn('Không thể đồng bộ thời gian online:', error);
          failureReported = true;
        }
      } finally {
        requestInFlight = false;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') sendHeartbeat();
    };
    sendHeartbeat();
    const intervalId = window.setInterval(sendHeartbeat, 30_000);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', sendHeartbeat);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', sendHeartbeat);
    };
  }, []);
}
