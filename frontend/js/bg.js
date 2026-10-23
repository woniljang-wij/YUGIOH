/* ============================================================
  bg.js – Nền sảnh video và nền ảnh dự phòng
   ------------------------------------------------------------
  Video sảnh: assets/videos/battle city.mp4
  Ảnh dự phòng: assets/images/backgrounds/bg-lobby.jpg

   Cách hoạt động:
  - Video phát hoặc ảnh tải được -> thêm class "has-bg" để ẩn SVG dự phòng.
  - Video/ảnh không tải được -> giữ SVG phong cảnh, trang vẫn hiển thị.
   ============================================================ */

(function () {
  'use strict';

  function init() {
    const video = document.querySelector('.lobby-video');
    if (video) {
      const markVideoReady = function () {
        document.body.classList.add('has-bg');
      };
      video.muted = true;
      video.playsInline = true;
      video.addEventListener('loadeddata', markVideoReady, { once: true });
      video.addEventListener('playing', markVideoReady, { once: true });
      const playRequest = video.play();
      if (playRequest && typeof playRequest.catch === 'function') {
        playRequest.catch(function () {});
      }
    }

    const layer = document.querySelector('.bg-image');
    if (!layer) return;

    // Lấy đúng đường dẫn ảnh đang dùng trong CSS (chỉ sửa 1 chỗ trong theme.css)
    const raw = getComputedStyle(layer).backgroundImage || '';
    const found = raw.match(/url\((['"]?)(.*?)\1\)/);
    if (!found || !found[2]) return;   // chưa cấu hình ảnh -> dùng nền dự phòng

    const probe = new Image();         // thử tải trước, không gắn vào DOM
    probe.addEventListener('load', function () {
      document.body.classList.add('has-bg');
    });
    probe.src = found[2];
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();