(function () {
  "use strict";

  const KEY = "yugioh.music"; // 'on' | 'off'
  const POS_KEY = "yugioh.music.pos"; // vị trí đang nghe (sessionStorage)
  const MAX_VOL = 0.55; // âm lượng tối đa
  const RAMP_MS = 1500; // thời gian tăng/giảm âm lượng

  function init() {
    const tracks = (document.body.dataset.bgm || '')
      .split(',')
      .map(function (src) { return src.trim(); })
      .filter(Boolean);
    const btn = document.getElementById("musicBtn");
    if (!tracks.length || !btn) return;

    const icon = btn.querySelector(".music-btn__icon");

    let trackIndex = tracks.length > 1 ? Math.floor(Math.random() * tracks.length) : 0;
    const audio = new Audio(tracks[trackIndex]);
    audio.loop = false;
    audio.preload = "auto";
    audio.volume = 0;

    let wantPlay = localStorage.getItem(KEY) !== "off";
    let fadeTimer = null;
    let hintTimer = null;
    let hinted = false; // đã nhắc "bấm để bật nhạc" chưa

    /* ---------- nhớ vị trí đang nghe giữa các lần điều hướng ---------- */
    function readPos() {
      try {
        return parseFloat(sessionStorage.getItem(POS_KEY) || "0") || 0;
      } catch (e) {
        return 0;
      }
    }
    function savePos() {
      try {
        sessionStorage.setItem(POS_KEY, audio.currentTime || 0);
      } catch (e) {}
    }
    (function restorePos() {
      // Reload trang → luôn phát nhạc từ đầu
      try {
        sessionStorage.removeItem(POS_KEY);
      } catch (e) {}
    })();

    /* ---------- hiệu ứng âm lượng ---------- */
    function fadeTo(target, ms, done) {
      clearInterval(fadeTimer);
      const time = ms || RAMP_MS;
      const from = audio.volume;
      const steps = Math.max(1, Math.round(time / 40));
      let i = 0;
      fadeTimer = setInterval(function () {
        i++;
        const v = from + (target - from) * (i / steps);
        audio.volume = Math.min(1, Math.max(0, v));
        if (i >= steps) {
          clearInterval(fadeTimer);
          if (typeof done === "function") done();
        }
      }, 40);
    }

    /* ---------- nhắc nhẹ khi bị trình duyệt chặn ---------- */
    function hint() {
      if (hinted) return;
      const el = document.getElementById("toast");
      if (!el) return;
      hinted = true;
      el.textContent = "🔊 Bấm vào màn hình để bật nhạc nền";
      el.classList.add("is-show");
      clearTimeout(hintTimer);
      hintTimer = setTimeout(function () {
        el.classList.remove("is-show");
      }, 2600);
    }

    /* ---------- giao diện nút ---------- */
    function updateBtn() {
      const playing = !audio.paused;
      btn.classList.toggle("is-off", !wantPlay);
      btn.classList.toggle("is-playing", wantPlay && playing);
      btn.setAttribute("aria-pressed", String(wantPlay));
      const state = btn.querySelector("[data-music-state]");
      if (state) state.textContent = wantPlay ? "Đang bật" : "Đang tắt";
      if (!wantPlay) btn.title = "Bật nhạc nền";
      else if (!playing) btn.title = "Bấm vào trang để bật nhạc nền";
      else btn.title = "Tắt nhạc nền";
      if (icon) icon.textContent = wantPlay ? (playing ? "♪" : "🔈") : "🔇";
    }

    /* ---------- phát / dừng ---------- */
    function play() {
      const p = audio.play();
      if (p && typeof p.catch === "function") {
        p.then(function () {
          fadeTo(MAX_VOL);
          updateBtn();
          stopWatch();
        }).catch(function () {
          updateBtn();
          hint(); /* bị chặn -> chờ tương tác */
        });
      } else {
        fadeTo(MAX_VOL);
      }
      updateBtn();
    }

    function pause() {
      fadeTo(0, 400, function () {
        audio.pause();
        updateBtn();
      });
      updateBtn();
    }

    audio.addEventListener("ended", function () {
      trackIndex = (trackIndex + 1) % tracks.length;
      audio.src = tracks[trackIndex];
      if (wantPlay) play();
    });

    /* ---------- nút bấm ---------- */
    btn.addEventListener("click", function () {
      wantPlay = !wantPlay;
      localStorage.setItem(KEY, wantPlay ? "on" : "off");
      if (wantPlay) play();
      else pause();
      updateBtn();
    });

    const GESTURES = ["pointerdown", "keydown", "touchstart", "click"];

    function tryResume() {
      if (!wantPlay || !audio.paused) return;
      play();
    }

    function onGesture() {
      tryResume();
    }

    function watchGestures() {
      GESTURES.forEach(function (ev) {
        window.addEventListener(ev, onGesture, true);
      });
    }

    function stopWatch() {
      GESTURES.forEach(function (ev) {
        window.removeEventListener(ev, onGesture, true);
      });
    }

    /* giữ listener, chỉ gỡ khi nhạc đã phát được */
    watchGestures();
    if (!audio.paused) stopWatch();

    window.addEventListener("pageshow", function () {
      watchGestures();
      tryResume();
      updateBtn();
    });

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        watchGestures();
        tryResume();
        updateBtn();
      }
    });

    window.addEventListener("focus", function () {
      watchGestures();
      tryResume();
    });

    window.addEventListener("pagehide", savePos);
    window.addEventListener("beforeunload", savePos);

    /* ---------- tự phát ---------- */
    if (wantPlay) play();

    updateBtn();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
