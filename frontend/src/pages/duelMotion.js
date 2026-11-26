  const activeAnimations = new WeakMap();
  const STEPS = 24;
  const DUEL_DRAW_DURATION_MS = 480;
  const DUEL_DRAW_STAGGER_MS = 300;
  const DUEL_SUMMON_DURATION_MS = 1000;
  const DUEL_PLACEMENT_DURATION_MS = 520;
  const DUEL_SUMMON_REVEAL_DURATION_MS = 300;
  const DUEL_MILL_DURATION_MS = 420;
  const DUEL_MILL_STAGGER_MS = 220;
  const DUEL_TRICKY_DISCARD_JUMP_DURATION_MS = 1000;
  const DUEL_TRICKY_DISCARD_FLIGHT_DURATION_MS = 700;
  const DUEL_BATTLE_DURATION_MS = 440;
  const DUEL_DESTRUCTION_DURATION_MS = 820;
  const DUEL_CONTROL_TRANSFER_DURATION_MS = 1100;
  const sfxAudioCache = new Map();
  const sfxGainConnected = new WeakSet();
  let sfxAudioCtx = null;
  let sfxMasterGain = null;

  function ensureSfxGainNode() {
    if (typeof window === 'undefined') return null;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!sfxAudioCtx) {
      sfxAudioCtx = new Ctx();
      sfxMasterGain = sfxAudioCtx.createGain();
      sfxMasterGain.gain.value = 2.0;
      if (typeof sfxAudioCtx.createDynamicsCompressor === 'function') {
        const compressor = sfxAudioCtx.createDynamicsCompressor();
        compressor.threshold.value = -6;
        compressor.knee.value = 12;
        compressor.ratio.value = 4;
        sfxMasterGain.connect(compressor);
        compressor.connect(sfxAudioCtx.destination);
      } else {
        sfxMasterGain.connect(sfxAudioCtx.destination);
      }
    }
    if (sfxAudioCtx.state === 'suspended') {
      sfxAudioCtx.resume().catch(() => {});
    }
    return sfxMasterGain;
  }

  function isDuelSfxEnabled() {
    try {
      return typeof window !== 'undefined' && window.localStorage?.getItem('yugioh.sfx') !== 'off';
    } catch {
      return true;
    }
  }

  function playDuelSfx(filename, volume = 1.0) {
    if (!isDuelSfxEnabled() || typeof Audio !== 'function') return;
    try {
      const src = `/assets/music/sfx/${filename}`;
      let base = sfxAudioCache.get(src);
      if (!base) {
        base = new Audio(src);
        base.preload = 'auto';
        sfxAudioCache.set(src, base);
      }
      const clip = base.paused ? base : base.cloneNode();
      clip.volume = Math.min(1, Math.max(0, volume));
      clip.currentTime = 0;
      const gainNode = ensureSfxGainNode();
      if (gainNode && sfxAudioCtx && !sfxGainConnected.has(clip)) {
        try {
          const sourceNode = sfxAudioCtx.createMediaElementSource(clip);
          sourceNode.connect(gainNode);
          sfxGainConnected.add(clip);
        } catch {
          // fallback to native HTMLAudioElement volume
        }
      }
      const req = clip.play();
      if (req && typeof req.catch === 'function') req.catch(() => {});
    } catch {
      // ignore audio playback errors
    }
  }
  function buildShatterShards(cols = 4, rows = 5) {
    const vertices = [];
    for (let r = 0; r <= rows; r += 1) {
      const row = [];
      for (let c = 0; c <= cols; c += 1) {
        let x = (c / cols) * 100;
        let y = (r / rows) * 100;
        if (c > 0 && c < cols) {
          x += Math.sin(r * 7.3 + c * 3.1) * (100 / cols) * 0.34;
        }
        if (r > 0 && r < rows) {
          y += Math.cos(c * 5.7 + r * 4.3) * (100 / rows) * 0.34;
        }
        row.push([Number(x.toFixed(2)), Number(y.toFixed(2))]);
      }
      vertices.push(row);
    }
    const shards = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const tl = vertices[r][c];
        const tr = vertices[r][c + 1];
        const bl = vertices[r + 1][c];
        const br = vertices[r + 1][c + 1];
        const tris = (r + c) % 2 === 0
          ? [[tl, tr, br], [tl, br, bl]]
          : [[tl, tr, bl], [tr, br, bl]];
        tris.forEach(([p1, p2, p3]) => {
          const cx = (p1[0] + p2[0] + p3[0]) / 3;
          const cy = (p1[1] + p2[1] + p3[1]) / 3;
          shards.push({ points: [p1, p2, p3], cx, cy });
        });
      }
    }
    return shards;
  }
  const SHATTER_SHARDS = buildShatterShards(4, 5);

  const easing = {
    sineInOut(time) {
      return time === 0 || time === 1
        ? time
        : -0.5 * (Math.cos(Math.PI * time) - 1);
    },
    backOut(time) {
      const shifted = time - 1;
      const overshoot = 1.70158;
      return shifted * shifted * ((overshoot + 1) * shifted + overshoot) + 1;
    }
  };

  const presets = {
    draw: {
      duration: DUEL_DRAW_DURATION_MS,
      curve: easing.backOut,
      from: { y: 42, scale: 0.78, rotateY: -55, rotateZ: -9, opacity: 1 },
      to: { y: 0, scale: 1, rotateY: 0, rotateZ: 0, opacity: 1 }
    },
    summon: {
      duration: DUEL_SUMMON_DURATION_MS,
      curve: easing.backOut,
      from: { y: 30, scale: 0.72, rotateY: -78, rotateZ: -5, opacity: 0 },
      to: { y: 0, scale: 1, rotateY: 0, rotateZ: 0, opacity: 1 }
    }
  };

  function interpolate(from, to, amount) {
    return from + (to - from) * amount;
  }

  function keyframe(from, to, amount) {
    const value = {};
    Object.keys(from).forEach((property) => {
      value[property] = interpolate(from[property], to[property], amount);
    });
    value.transform =
      `translate3d(0, ${value.y}px, 0) ` +
      `rotateY(${value.rotateY}deg) rotateZ(${value.rotateZ}deg) ` +
      `scale(${value.scale})`;
    delete value.y;
    delete value.rotateY;
    delete value.rotateZ;
    return value;
  }

  function waitForArtworkImages(element) {
    const images = Array.from(element.querySelectorAll('img'));
    if (!images.length) return Promise.resolve(true);

    return Promise.all(images.map((image) => new Promise((resolve) => {
      const finish = async (loaded) => {
        image.removeEventListener('load', onLoad);
        image.removeEventListener('error', onError);
        if (!loaded || !image.naturalWidth) {
          resolve(false);
          return;
        }
        if (typeof image.decode === 'function') {
          try {
            await image.decode();
          } catch {
            if (!image.naturalWidth) {
              resolve(false);
              return;
            }
          }
        }
        resolve(image.naturalWidth > 0);
      };
      const onLoad = () => finish(true);
      const onError = () => finish(false);

      if (image.complete) {
        finish(image.naturalWidth > 0);
      } else {
        image.addEventListener('load', onLoad, { once: true });
        image.addEventListener('error', onError, { once: true });
      }
    }))).then((results) => results.every(Boolean));
  }

  function playMonsterSummonMotion(element, options) {
    const settings = options || {};
    const originalVisibility = element.style.visibility;
    let flyer = null;
    let flyerAnimation = null;
    let revealTimer = null;
    let effectAnimations = [];
    let cleaned = false;
    const handle = {
      cancelled: false,
      cancel() {
        this.cancelled = true;
        if (flyerAnimation) flyerAnimation.cancel();
        else cleanup(true);
      }
    };
    const cleanup = (cancelEffects = false) => {
      if (cleaned) return;
      cleaned = true;
      const ownsElementAnimation = activeAnimations.get(element) === handle;
      if (revealTimer !== null) window.clearTimeout(revealTimer);
      flyer?.remove();
      if (ownsElementAnimation) element.style.visibility = originalVisibility;
      if (cancelEffects) {
        effectAnimations.forEach((animation) => animation.cancel());
      }
      if (ownsElementAnimation) {
        activeAnimations.delete(element);
      }
    };

    activeAnimations.set(element, handle);
    const startAnimation = async () => {
      if (
        handle.cancelled
        || activeAnimations.get(element) !== handle
        || !element.isConnected
      ) return cleanup();

      const bounds = element.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return cleanup();

      playDuelSfx('monster_summon.mp3', 1.0);

      flyer = element.cloneNode(true);
      flyer.classList.add('duel-monster-summon__card');
      flyer.setAttribute('aria-hidden', 'true');
      flyer.querySelectorAll('button').forEach((button) => button.remove());
      flyer.querySelectorAll('*').forEach((child) => {
        child.setAttribute('aria-hidden', 'true');
        child.style.pointerEvents = 'none';
      });
      const cardWidth = getComputedStyle(element.parentElement)
        .getPropertyValue('--duel-monster-card-width');
      if (cardWidth) flyer.style.setProperty('--duel-monster-card-width', cardWidth);
      Object.assign(flyer.style, {
        position: 'fixed',
        inset: 'auto',
        left: `${bounds.left}px`,
        top: `${bounds.top}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
        margin: '0',
        visibility: 'visible',
        transformOrigin: 'center center'
      });
      document.body.appendChild(flyer);
      element.style.visibility = 'hidden';
      if (!(await waitForArtworkImages(flyer))) {
        console.error('Không thể giải mã artwork bản sao trước animation triệu hồi.');
        cleanup();
        return;
      }
      if (
        handle.cancelled
        || activeAnimations.get(element) !== handle
        || !element.isConnected
      ) return cleanup();

      const currentBounds = element.getBoundingClientRect();
      Object.assign(flyer.style, {
        left: `${currentBounds.left}px`,
        top: `${currentBounds.top}px`,
        width: `${currentBounds.width}px`,
        height: `${currentBounds.height}px`,
        visibility: 'visible'
      });
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      const deltaX = centerX - (currentBounds.left + currentBounds.width / 2);
      const deltaY = centerY - (currentBounds.top + currentBounds.height / 2);
      const scale = Math.min(
        2.1,
        window.innerWidth / (currentBounds.width * 1.3),
        window.innerHeight / (currentBounds.height * 1.3)
      );
      const duration = settings.duration
        || DUEL_SUMMON_DURATION_MS - DUEL_SUMMON_REVEAL_DURATION_MS;
      const centerTransform = `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scale})`;
      const flyerFrames = [
        { transform: 'translate3d(0, 0, 0) scale(1)', opacity: 1, filter: 'brightness(1)' },
        { transform: `translate3d(${deltaX}px, ${deltaY + 34}px, 0) scale(1.05)`, opacity: 1, offset: 0.14 },
        { transform: centerTransform, opacity: 1, filter: 'brightness(1.18)', offset: 0.32 },
        { transform: `${centerTransform} scale(1.04)`, opacity: 1, filter: 'brightness(1.45)', offset: 0.6 },
        { transform: `translate3d(${deltaX * 0.18}px, ${deltaY * 0.18}px, 0) scale(1.5)`, opacity: 1, filter: 'brightness(1.65)', offset: 0.8 },
        { transform: 'translate3d(0, -3px, 0) scale(1.02)', opacity: 1, filter: 'brightness(1.2)', offset: 0.92 },
        { transform: 'translate3d(0, 0, 0) scale(1)', opacity: 0, filter: 'brightness(1)' }
      ];

      const flare = document.createElement('div');
      flare.className = 'duel-monster-summon__flare';
      flare.setAttribute('aria-hidden', 'true');
      Object.assign(flare.style, {
        left: `${currentBounds.left + currentBounds.width / 2}px`,
        top: `${currentBounds.top + currentBounds.height / 2}px`
      });
      document.body.appendChild(flare);
      const impactDelay = (settings.delay || 0) + duration * 0.84;
      const flareAnimation = flare.animate([
        { transform: 'translate(-50%, -50%) scale(.18)', opacity: 0 },
        { transform: 'translate(-50%, -50%) scale(1.05)', opacity: .96, offset: 0.28 },
        { transform: 'translate(-50%, -50%) scale(1.42)', opacity: .76, offset: 0.56 },
        { transform: 'translate(-50%, -50%) scale(2)', opacity: 0 }
      ], {
        duration: DUEL_SUMMON_REVEAL_DURATION_MS + 60,
        delay: impactDelay,
        easing: 'ease-out',
        fill: 'forwards'
      });
      flareAnimation.finished.then(
        () => flare.remove(),
        () => flare.remove()
      );
      effectAnimations = [flareAnimation];

      const sparkAnimations = Array.from({ length: 8 }, (_, index) => {
        const spark = document.createElement('span');
        spark.className = 'duel-monster-summon__spark';
        spark.setAttribute('aria-hidden', 'true');
        Object.assign(spark.style, {
          left: `${currentBounds.left + currentBounds.width / 2}px`,
          top: `${currentBounds.top + currentBounds.height / 2}px`
        });
        document.body.appendChild(spark);
        const angle = (index / 8) * Math.PI * 2;
        const distance = Math.max(currentBounds.width, currentBounds.height) * 0.8;
        const animation = spark.animate([
          { transform: 'translate(-50%, -50%) scale(.2)', opacity: 0 },
          { transform: 'translate(-50%, -50%) scale(1.2)', opacity: 1, offset: 0.18 },
          {
            transform: `translate(calc(-50% + ${Math.cos(angle) * distance}px), calc(-50% + ${Math.sin(angle) * distance}px)) scale(.1)`,
            opacity: 0
          }
        ], {
          duration: DUEL_SUMMON_REVEAL_DURATION_MS + 60,
          delay: impactDelay + 30,
          easing: 'ease-out',
          fill: 'forwards'
        });
        animation.finished.then(
          () => spark.remove(),
          () => spark.remove()
        );
        return animation;
      });
      effectAnimations.push(...sparkAnimations);

      flyerAnimation = flyer.animate(flyerFrames, {
        duration,
        delay: settings.delay || 0,
        easing: 'cubic-bezier(.18,.72,.24,1)',
        fill: 'both'
      });
      handle.animation = flyerAnimation;
      element.style.visibility = 'hidden';
      revealTimer = window.setTimeout(() => {
        if (activeAnimations.get(element) === handle)
          element.style.visibility = originalVisibility;
      }, (settings.delay || 0) + duration * 0.92);
      flyerAnimation.onfinish = () => cleanup();
      flyerAnimation.oncancel = () => cleanup(true);
    };

    startAnimation().catch((error) => {
      console.error('Không thể chuẩn bị animation triệu hồi quái thú:', error);
      cleanup(true);
    });
    return handle;
  }

  function playCardGoldenGlow(element, { duration = 750, delay = 0 } = {}) {
    if (!element) return null;
    const glowOverlay = document.createElement('div');
    glowOverlay.setAttribute('aria-hidden', 'true');
    Object.assign(glowOverlay.style, {
      position: 'absolute',
      inset: '0',
      borderRadius: 'inherit',
      pointerEvents: 'none',
      zIndex: '6',
      background: 'radial-gradient(circle at 50% 50%, rgba(255, 252, 214, 0.98) 0%, rgba(255, 220, 96, 0.92) 58%, rgba(255, 186, 48, 0.85) 100%)',
      boxShadow: '0 0 24px rgba(255, 220, 96, 0.95)',
      mixBlendMode: 'screen'
    });
    element.appendChild(glowOverlay);

    const overlayAnimation = typeof glowOverlay.animate === 'function'
      ? glowOverlay.animate(
        [
          { opacity: 0.92 },
          { opacity: 1, offset: 0.25 },
          { opacity: 0, offset: 1 }
        ],
        {
          duration,
          delay,
          easing: 'ease-out',
          fill: 'forwards'
        }
      )
      : null;

    const animation = typeof element.animate === 'function'
      ? element.animate(
        [
          {
            filter: 'sepia(0.55) saturate(2) brightness(1.65) drop-shadow(0 0 18px rgba(255, 218, 92, 0.95))'
          },
          {
            filter: 'sepia(0.65) saturate(2.3) brightness(1.9) drop-shadow(0 0 26px rgba(255, 226, 112, 1))',
            offset: 0.28
          },
          {
            filter: 'none',
            offset: 1
          }
        ],
        {
          duration,
          delay,
          easing: 'ease-out',
          fill: 'none'
        }
      )
      : null;

    if (animation) activeAnimations.set(element, animation);
    const completion = Promise.all([
      ...(animation?.finished ? [animation.finished] : []),
      ...(overlayAnimation?.finished ? [overlayAnimation.finished] : [])
    ]).finally(() => {
      glowOverlay.remove();
      if (animation && activeAnimations.get(element) === animation) {
        activeAnimations.delete(element);
      }
    }).catch(() => {});

    return { animation, completion };
  }

  async function playDuelEffectActivationGlow(zoneElement, duration = 750) {
    const cardElement = findBattleCardElement(zoneElement) || zoneElement;
    if (!cardElement) return;
    const reduceMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;
    const glow = playCardGoldenGlow(cardElement, { duration });
    if (glow) await glow.completion;
  }

  function play(element, presetName, options) {
    const preset = presets[presetName];
    if (!element || !preset) return null;

    const settings = options || {};
    const reduceMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || typeof element.animate !== 'function') return null;

    const previous = activeAnimations.get(element);
    if (previous) previous.cancel();

    if (
      presetName === 'summon'
      && element.classList.contains('duel-field-monster-motion')
    ) {
      return playMonsterSummonMotion(element, settings);
    }

    if (
      presetName === 'summon'
      && element.classList.contains('card--back')
      && element.classList.contains('card--defense')
    ) {
      const glow = playCardGoldenGlow(element, {
        duration: 750,
        delay: settings.delay || 0
      });
      return glow?.animation || null;
    }

    if (presetName === 'draw') {
      const opponentHand = element.closest('.hand--opponent');
      const deck = opponentHand
        ? document.querySelector('[data-js="deck-opp"]')
        : document.querySelector('[data-js="deck-me"]');
      const source = deck && deck.getBoundingClientRect();
      const destination = element.getBoundingClientRect();
      if (source && destination) {
        const x = source.left + source.width / 2 - destination.left - destination.width / 2;
        const y = source.top + source.height / 2 - destination.top - destination.height / 2;
        const scale = Math.min(
          source.width / destination.width,
          source.height / destination.height,
          1
        );
        const originalVisibility = element.style.visibility;
        element.style.visibility = 'hidden';

        const frames = opponentHand ? [
          {
            transform: `translate3d(${x}px, ${y}px, 0) scale(${scale}) rotateY(150deg)`,
            opacity: 1
          },
          {
            transform: `translate3d(${x * 0.95}px, ${y * 0.95}px, 0) scale(${scale + (1 - scale) * 0.05}) rotateY(145deg)`,
            opacity: 1,
            offset: 0.05
          },
          {
            transform: `translate3d(${x * 0.94}px, ${y * 0.94}px, 0) scale(${scale + (1 - scale) * 0.06}) rotateY(144deg)`,
            opacity: 1,
            offset: 0.06
          },
          {
            transform: 'translate3d(0, 0, 0) scale(1) rotateY(0)',
            opacity: 1,
            offset: 1
          }
        ] : [
          {
            transform: `translate3d(${x}px, ${y}px, 0) scale(${scale})`,
            opacity: 1,
          },
          {
            transform: `translate3d(${x * 0.95}px, ${y * 0.95}px, 0) scale(${scale + (1 - scale) * 0.05})`,
            opacity: 1,
            offset: 0.05
          },
          {
            transform: `translate3d(${x * 0.94}px, ${y * 0.94}px, 0) scale(${scale + (1 - scale) * 0.06})`,
            opacity: 1,
            offset: 0.06
          },
          {
            transform: 'translate3d(0, 0, 0) scale(1)',
            opacity: 1,
            offset: 1
          }
        ];
        const animation = element.animate(frames, {
          duration: settings.duration || (
            presetName === 'summon' ? DUEL_PLACEMENT_DURATION_MS : preset.duration
          ),
          delay: settings.delay || 0,
          easing: 'cubic-bezier(.2,.8,.2,1)',
          fill: 'both'
        });
        activeAnimations.set(element, animation);
        const revealDrawnCard = () => {
          if (activeAnimations.get(element) === animation)
            element.style.visibility = originalVisibility;
        };
        if (settings.delay > 0)
          window.setTimeout(revealDrawnCard, settings.delay);
        else
          revealDrawnCard();
        animation.onfinish = function () {
          if (activeAnimations.get(element) !== animation) return;
          activeAnimations.delete(element);
          element.style.visibility = originalVisibility;
          animation.cancel();
        };
        animation.oncancel = function () {
          const ownsElementAnimation = activeAnimations.get(element) === animation;
          if (ownsElementAnimation)
            activeAnimations.delete(element);
          if (ownsElementAnimation)
            element.style.visibility = originalVisibility;
        };
        return animation;
      }
    }

    const frames = [];
    for (let index = 0; index <= STEPS; index++) {
      const progress = index / STEPS;
      frames.push(keyframe(
        preset.from,
        preset.to,
        preset.curve(progress)
      ));
    }

    const animation = element.animate(frames, {
      duration: settings.duration || preset.duration,
      delay: settings.delay || 0,
      easing: 'linear',
      fill: 'both'
    });
    activeAnimations.set(element, animation);
    animation.onfinish = function () {
      if (activeAnimations.get(element) !== animation) return;
      activeAnimations.delete(element);
      animation.cancel();
    };
    animation.oncancel = function () {
      if (activeAnimations.get(element) === animation)
        activeAnimations.delete(element);
    };
    return animation;
  }

  function getDrawSequenceDuration(cardCount) {
    if (!cardCount || (window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return 0;
    return DUEL_DRAW_DURATION_MS + (cardCount - 1) * DUEL_DRAW_STAGGER_MS;
  }

  function getAttackArrowStart(sourceRect, pointerX, pointerY) {
    const centerX = sourceRect.left + sourceRect.width / 2;
    const centerY = sourceRect.top + sourceRect.height / 2;
    const deltaX = pointerX - centerX;
    const deltaY = pointerY - centerY;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    if (!absX && !absY) return { x: centerX, y: centerY };

    const scale = Math.min(
      absX ? sourceRect.width / 2 / absX : Number.POSITIVE_INFINITY,
      absY ? sourceRect.height / 2 / absY : Number.POSITIVE_INFINITY
    );
    return {
      x: centerX + deltaX * scale,
      y: centerY + deltaY * scale
    };
  }

  function getAttackArrowHeadPoints(start, end) {
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (!distance) return '';

    const unitX = deltaX / distance;
    const unitY = deltaY / distance;
    const headLength = Math.min(20, distance * 0.75);
    const halfWidth = Math.min(10, headLength * 0.55);
    const baseX = end.x - unitX * headLength;
    const baseY = end.y - unitY * headLength;
    const perpendicularX = -unitY;
    const perpendicularY = unitX;

    return [
      `${end.x},${end.y}`,
      `${baseX + perpendicularX * halfWidth},${baseY + perpendicularY * halfWidth}`,
      `${baseX - perpendicularX * halfWidth},${baseY - perpendicularY * halfWidth}`
    ].join(' ');
  }

  function findBattleCardElement(zone) {
    return zone?.querySelector(
      '.duel-field-monster-motion, .duel-field-monster, .card'
    ) || null;
  }

  function makeImpact(target) {
    if (!target) return null;
    const visual = target.matches?.('.pinfo')
      ? target
      : (target.querySelector?.('.duel-field-monster, .card') || target);
    const bounds = visual.getBoundingClientRect();
    const impact = document.createElement('div');
    impact.className = 'duel-battle-impact';
    impact.setAttribute('aria-hidden', 'true');
    impact.style.left = `${bounds.left + bounds.width / 2}px`;
    impact.style.top = `${bounds.top + bounds.height / 2}px`;
    impact.style.width = `${Math.max(180, Math.max(bounds.width, bounds.height) * 1.25)}px`;
    impact.style.height = `${Math.max(180, Math.max(bounds.width, bounds.height) * 1.25)}px`;
    document.body.appendChild(impact);
    return impact;
  }

  function makeDestructionFragments(target, duration = DUEL_DESTRUCTION_DURATION_MS) {
    const visual = target?.querySelector(
      '.duel-field-monster, .card'
    ) || target;
    if (!visual) return null;
    const bounds = visual.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    const originalVisibility = visual.style.visibility;
    const originalOpacity = visual.style.opacity;
    visual.style.visibility = 'hidden';

    const canvas = document.createElement('canvas');
    canvas.className = 'duel-destruction-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, {
      position: 'fixed',
      inset: '0',
      width: '100vw',
      height: '100vh',
      zIndex: '1105',
      pointerEvents: 'none'
    });
    document.body.appendChild(canvas);

    const ctx = typeof canvas.getContext === 'function'
      ? canvas.getContext('2d')
      : null;
    if (!ctx || typeof window.requestAnimationFrame !== 'function') {
      const fallbackAnim = typeof canvas.animate === 'function'
        ? canvas.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 16 })
        : null;
      return (fallbackAnim ? fallbackAnim.finished : Promise.resolve()).then(() => {
        visual.style.visibility = 'hidden';
      }, (error) => {
        visual.style.visibility = originalVisibility;
        throw error;
      }).finally(() => {
        canvas.remove();
        visual.style.opacity = originalOpacity;
      });
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);

    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;

    // Build 4x6 = 48 crisp golden triangular shards across the card bounds
    const shards = SHATTER_SHARDS.map((shard, index) => {
      const localPts = shard.points.map(([px, py]) => [
        ((px - shard.cx) / 100) * bounds.width,
        ((py - shard.cy) / 100) * bounds.height
      ]);
      const startX = bounds.left + (shard.cx / 100) * bounds.width;
      const startY = bounds.top + (shard.cy / 100) * bounds.height;
      const dx = startX - centerX;
      const dy = startY - centerY;
      const baseAngle = Math.atan2(dy, dx) + Math.sin(index * 5.3) * 0.28;
      const distNorm = Math.hypot(dx, dy) / Math.max(1, Math.hypot(bounds.width * 0.5, bounds.height * 0.5));
      const speed = (155 + distNorm * 145 + (index % 5) * 28);
      return {
        localPts,
        startX,
        startY,
        vx: Math.cos(baseAngle) * speed,
        vy: Math.sin(baseAngle) * speed - 18,
        rot: 0,
        rotSpeed: (index % 2 ? 1 : -1) * (4.5 + (index % 6) * 1.4),
        tiltPhase: index * 0.9,
        tiltSpeed: 6 + (index % 4) * 2.2,
        tone: index % 3
      };
    });

    const sparks = Array.from({ length: 28 }, (_, index) => {
      const angle = (index / 28) * Math.PI * 2 + Math.sin(index * 3.7) * 0.18;
      const speed = 210 + (index % 6) * 52;
      return {
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 2.2 + (index % 4) * 1.1,
        delay: (index % 3) * 0.03
      };
    });

    const startTime = performance.now();
    let frameId = 0;

    return new Promise((resolve) => {
      const renderFrame = (now) => {
        const rawT = Math.min(1, (now - startTime) / duration);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, viewW, viewH);

        // 1. Bright golden-white burst + expanding shockwave ring (0 -> 0.44)
        if (rawT < 0.45) {
          const burstT = rawT / 0.45;
          const flashAlpha = rawT < 0.08
            ? 1
            : Math.max(0, 1 - (rawT - 0.08) / 0.34);
          const radius = bounds.width * (0.55 + burstT * 1.25);

          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          const grad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
          grad.addColorStop(0, `rgba(255, 255, 255, ${0.98 * flashAlpha})`);
          grad.addColorStop(0.28, `rgba(255, 244, 168, ${0.92 * flashAlpha})`);
          grad.addColorStop(0.62, `rgba(255, 194, 62, ${0.48 * flashAlpha})`);
          grad.addColorStop(1, 'rgba(255, 148, 24, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
          ctx.fill();

          // Crisp shockwave ring
          const ringRadius = bounds.width * (0.35 + burstT * 1.55);
          ctx.strokeStyle = `rgba(255, 245, 185, ${0.82 * (1 - burstT)})`;
          ctx.lineWidth = Math.max(1, 4.5 * (1 - burstT));
          ctx.beginPath();
          ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        // 2. Golden polygonal shards blasting outward and tumbling
        const easeOut = 1 - Math.pow(1 - rawT, 2.35);
        const shardAlpha = rawT > 0.65
          ? Math.max(0, 1 - (rawT - 0.65) / 0.35)
          : 1;

        if (shardAlpha > 0) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.shadowColor = 'rgba(255, 196, 56, 0.95)';
          ctx.shadowBlur = 10;

          for (const shard of shards) {
            const x = shard.startX + shard.vx * easeOut * (duration / 1000);
            const y = shard.startY + shard.vy * easeOut * (duration / 1000) + 22 * rawT * rawT;
            const rot = shard.rotSpeed * rawT * 1.3;
            const flipX = Math.cos(shard.tiltPhase + rawT * shard.tiltSpeed);
            const scale = (1 - rawT * 0.58);

            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(rot);
            ctx.scale(Math.max(0.22, Math.abs(flipX)) * scale, scale);
            ctx.globalAlpha = shardAlpha;

            ctx.beginPath();
            ctx.moveTo(shard.localPts[0][0], shard.localPts[0][1]);
            ctx.lineTo(shard.localPts[1][0], shard.localPts[1][1]);
            ctx.lineTo(shard.localPts[2][0], shard.localPts[2][1]);
            ctx.closePath();

            if (rawT < 0.14) {
              ctx.fillStyle = '#fffce0';
            } else if (shard.tone === 0) {
              ctx.fillStyle = '#ffe56b';
            } else if (shard.tone === 1) {
              ctx.fillStyle = '#ffbf38';
            } else {
              ctx.fillStyle = '#fff3ad';
            }
            ctx.fill();

            ctx.lineWidth = 1.1;
            ctx.strokeStyle = 'rgba(255, 252, 224, 0.95)';
            ctx.stroke();
            ctx.restore();
          }
          ctx.restore();
        }

        // 3. Bright golden-white spark embers
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const spark of sparks) {
          const st = Math.max(0, Math.min(1, (rawT - spark.delay) / (1 - spark.delay)));
          if (st <= 0 || st >= 1) continue;
          const sparkEase = 1 - Math.pow(1 - st, 2.2);
          const sx = centerX + spark.vx * sparkEase * (duration / 1000);
          const sy = centerY + spark.vy * sparkEase * (duration / 1000);
          const alpha = st < 0.15 ? st / 0.15 : Math.max(0, 1 - (st - 0.15) / 0.85);
          ctx.fillStyle = `rgba(255, 246, 178, ${alpha})`;
          ctx.shadowColor = 'rgba(255, 205, 72, 0.95)';
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(sx, sy, spark.size * (1 - st * 0.5), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();

        if (rawT < 1) {
          frameId = window.requestAnimationFrame(renderFrame);
        } else {
          resolve();
        }
      };

      renderFrame(startTime);
    }).then(() => {
      visual.style.visibility = 'hidden';
    }, (error) => {
      visual.style.visibility = originalVisibility;
      throw error;
    }).finally(() => {
      if (frameId) window.cancelAnimationFrame(frameId);
      canvas.remove();
      visual.style.opacity = originalOpacity;
    });
  }

  async function playDuelBattleMotion({
    attackerZone,
    targetZone,
    targetProfile,
    board
  }) {
    const attacker = findBattleCardElement(attackerZone);
    const target = targetProfile || findBattleCardElement(targetZone);
    if (!attacker || !target) return;

    const reduceMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;

    const attackerBounds = attacker.getBoundingClientRect();
    const targetBounds = target.getBoundingClientRect();
    const deltaX = targetBounds.left + targetBounds.width / 2
      - attackerBounds.left - attackerBounds.width / 2;
    const deltaY = targetBounds.top + targetBounds.height / 2
      - attackerBounds.top - attackerBounds.height / 2;
    const lunge = attacker.animate([
      { transform: 'translate3d(0, 0, 0) scale(1)', offset: 0 },
      {
        transform: `translate3d(${deltaX * 0.78}px, ${deltaY * 0.78}px, 0) scale(1.08)`,
        offset: 0.72
      },
      {
        transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(1.12)`,
        offset: 0.8
      },
      { transform: 'translate3d(0, 0, 0) scale(1)', offset: 1 }
    ], {
      duration: DUEL_BATTLE_DURATION_MS,
      easing: 'cubic-bezier(.2,.8,.25,1)'
    });

    const impactDelay = Math.round(DUEL_BATTLE_DURATION_MS * 0.56);
    const impactSfxTimer = window.setTimeout(() => {
      playDuelSfx('attack_impact.mp3', 1.0);
    }, impactDelay);

    const impact = makeImpact(target);
    const impactAnimation = impact?.animate([
      { transform: 'translate(-50%, -50%) scale(.25)', opacity: 0 },
      { transform: 'translate(-50%, -50%) scale(1.15)', opacity: 1, offset: 0.45 },
      { transform: 'translate(-50%, -50%) scale(1.8)', opacity: 0 }
    ], {
      duration: 360,
      delay: impactDelay,
      easing: 'ease-out',
      fill: 'both'
    });
    const targetVisual = targetProfile
      ? targetProfile
      : target.querySelector('.duel-field-monster, .card');
    const targetHit = targetVisual && targetVisual.animate([
      { filter: 'brightness(1)' },
      { filter: 'brightness(2.2)' },
      { filter: 'brightness(1.2)' },
      { filter: 'brightness(1)' }
    ], {
      duration: 280,
      delay: impactDelay,
      easing: 'ease-out'
    });
    const screenShake = board?.animate([
      { transform: 'translate3d(0, 0, 0)' },
      { transform: 'translate3d(-2px, 1px, 0)' },
      { transform: 'translate3d(2px, -1px, 0)' },
      { transform: 'translate3d(0, 0, 0)' }
    ], {
      duration: 180,
      delay: impactDelay,
      easing: 'ease-out'
    });
    await Promise.all([
      lunge.finished,
      ...(impactAnimation ? [impactAnimation.finished] : []),
      ...(targetHit ? [targetHit.finished] : []),
      ...(screenShake ? [screenShake.finished] : [])
    ]).finally(() => {
      window.clearTimeout(impactSfxTimer);
    });
    impact?.remove();
  }

  async function playDuelDestructionMotion({
    destroyedZones = [],
    board,
    duration = DUEL_DESTRUCTION_DURATION_MS
  }) {
    const reduceMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;

    const destroyed = [...new Set(destroyedZones
      .map(findBattleCardElement)
      .filter(Boolean))];
    if (!destroyed.length) return;

    await playSequentialDestructionTargets(destroyed, async (target) => {
      playDuelSfx('monster_destroyed.mp3', 1.0);
      const impact = makeImpact(target);
      const impactAnimation = impact?.animate([
        { transform: 'translate(-50%, -50%) scale(.72)', opacity: 1 },
        { transform: 'translate(-50%, -50%) scale(1.18)', opacity: 1, offset: 0.12 },
        { transform: 'translate(-50%, -50%) scale(1.55)', opacity: .76, offset: 0.44 },
        { transform: 'translate(-50%, -50%) scale(1.8)', opacity: 0, offset: 1 }
      ], {
        duration,
        easing: 'ease-out'
      });
      const screenShake = board?.animate([
        { transform: 'translate3d(0, 0, 0)' },
        { transform: 'translate3d(-2px, 1px, 0)' },
        { transform: 'translate3d(2px, -1px, 0)' },
        { transform: 'translate3d(0, 0, 0)' }
      ], {
        duration: 180,
        easing: 'ease-out'
      });

      await Promise.all([
        makeDestructionFragments(target, duration),
        ...(impactAnimation ? [impactAnimation.finished] : []),
        ...(screenShake ? [screenShake.finished] : [])
      ]);
      impact?.remove();
    });
  }

  async function playSequentialDestructionTargets(targets, playTarget) {
    for (const target of targets) {
      await playTarget(target);
    }
  }

  async function playDuelCounterbalanceMotion({
    sourceZone,
    board,
    duration = 1100
  }) {
    const reduceMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || !sourceZone) return;

    const visual = sourceZone.querySelector(
      '.duel-field-monster-motion, .duel-field-monster, .card'
    );
    if (!visual) return;
    const aura = document.createElement('div');
    aura.className = 'duel-counterbalance-aura';
    const bounds = visual.getBoundingClientRect();
    Object.assign(aura.style, {
      left: `${bounds.left - 12}px`,
      top: `${bounds.top - 12}px`,
      width: `${bounds.width + 24}px`,
      height: `${bounds.height + 24}px`
    });
    document.body.appendChild(aura);

    const visualAnimation = visual.animate([
      { transform: 'scale(1)', filter: 'brightness(1)' },
      { transform: 'scale(1.08)', filter: 'brightness(2.15) saturate(1.25)', offset: 0.42 },
      { transform: 'scale(1)', filter: 'brightness(1)', offset: 1 }
    ], {
      duration,
      easing: 'ease-in-out',
      fill: 'forwards'
    });
    const auraAnimation = aura.animate([
      { transform: 'scale(.78)', opacity: 0 },
      { transform: 'scale(1)', opacity: 1, offset: 0.35 },
      { transform: 'scale(1.18)', opacity: 0, offset: 1 }
    ], {
      duration,
      easing: 'ease-out',
      fill: 'forwards'
    });
    await Promise.all([visualAnimation.finished, auraAnimation.finished]);
    aura.remove();
  }

  async function playDuelChainActivationMotion({
    card,
    sourceZone,
    board,
    duration = 2200
  }) {
    if (!card || !sourceZone) return;
    const reduceMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;

    const sourceRect = sourceZone.getBoundingClientRect();
    if (!sourceRect.width || !sourceRect.height) return;
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight * 0.46;
    const sourceX = sourceRect.left + sourceRect.width / 2;
    const sourceY = sourceRect.top + sourceRect.height / 2;
    const targetWidth = Math.min(260, window.innerWidth * 0.34);
    const targetHeight = targetWidth * 1.44;
    const scaleX = targetWidth / sourceRect.width;
    const scaleY = targetHeight / sourceRect.height;

    const scrim = document.createElement('div');
    scrim.className = 'duel-chain-reveal__scrim';
    scrim.setAttribute('aria-hidden', 'true');
    document.body.appendChild(scrim);

    const visual = document.createElement('div');
    visual.className = 'duel-chain-reveal';
    visual.setAttribute('aria-hidden', 'true');
    Object.assign(visual.style, {
      left: `${centerX}px`,
      top: `${centerY}px`,
      width: `${targetWidth}px`,
      height: `${targetHeight}px`
    });

    const back = document.createElement('div');
    back.className = 'duel-chain-reveal__back';
    back.textContent = 'YU-GI-OH!';

    const front = document.createElement('div');
    front.className = 'duel-chain-reveal__front';
    const art = document.createElement('img');
    art.className = 'duel-chain-reveal__art';
    art.draggable = false;
    if (card.image) {
      art.src = card.image.startsWith('assets/')
        ? `/${card.image}`
        : card.image;
    }
    const name = document.createElement('div');
    name.className = 'duel-chain-reveal__name';
    name.textContent = card.name || card.id || 'Hiệu ứng';
    const effect = document.createElement('div');
    effect.className = 'duel-chain-reveal__effect';
    effect.textContent = 'HIỆU ỨNG KÍCH HOẠT';
    front.append(art, name);
    visual.append(back, front, effect);
    document.body.appendChild(visual);

    const scrimAnimation = scrim.animate([
      { opacity: 0 },
      { opacity: 1, offset: 0.14 },
      { opacity: 1, offset: 0.82 },
      { opacity: 0 }
    ], {
      duration,
      easing: 'ease-out',
      fill: 'forwards'
    });
    const revealAnimation = visual.animate([
      {
        transform: `translate(${sourceX - centerX}px, ${sourceY - centerY}px) scale(${sourceRect.width / targetWidth}) rotateY(0deg)`,
        filter: 'brightness(1)'
      },
      {
        transform: 'translate(0, 0) scale(.82) rotateY(82deg)',
        filter: 'brightness(1.45)',
        offset: 0.28
      },
      {
        transform: 'translate(0, 0) scale(1) rotateY(180deg)',
        filter: 'brightness(1.8)',
        offset: 0.42
      },
      {
        transform: 'translate(0, 0) scale(1) rotateY(180deg)',
        filter: 'brightness(1)',
        offset: 0.82
      },
      {
        transform: `translate(${sourceX - centerX}px, ${sourceY - centerY}px) scale(${sourceRect.width / targetWidth}) rotateY(180deg)`,
        filter: 'brightness(1)'
      }
    ], {
      duration,
      easing: 'cubic-bezier(.16,.72,.22,1)',
      fill: 'forwards'
    });

    await new Promise((resolve) => {
      window.setTimeout(() => {
        back.style.opacity = '0';
        front.style.opacity = '1';
        effect.style.opacity = '1';
        window.setTimeout(resolve, 950);
      }, duration * 0.3);
    });
    await Promise.all([revealAnimation.finished, scrimAnimation.finished]);
    visual.remove();
    scrim.remove();
  }

  async function playDuelTrapActivationMotion({
    card,
    sourceZone,
    flipDuration = 500,
    glowDuration = 420,
    onFlipped = null
  }) {
    if (!card || !sourceZone) {
      onFlipped?.();
      return;
    }
    const reduceMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      onFlipped?.();
      return;
    }

    const sourceRect = sourceZone.getBoundingClientRect();
    if (!sourceRect.width || !sourceRect.height) {
      onFlipped?.();
      return;
    }

    const visual = document.createElement('div');
    visual.className = 'duel-trap-flip';
    visual.setAttribute('aria-hidden', 'true');
    Object.assign(visual.style, {
      left: `${sourceRect.left}px`,
      top: `${sourceRect.top}px`,
      width: `${sourceRect.width}px`,
      height: `${sourceRect.height}px`
    });

    const back = document.createElement('div');
    back.className = 'duel-trap-flip__back';

    const front = document.createElement('div');
    front.className = 'duel-trap-flip__front';
    const art = document.createElement('img');
    art.className = 'duel-trap-flip__art';
    art.draggable = false;
    if (card.image) {
      art.src = card.image.startsWith('assets/')
        ? `/${card.image}`
        : card.image;
    }
    front.appendChild(art);

    const glow = document.createElement('div');
    glow.className = 'duel-trap-flip__glow';

    visual.append(back, front, glow);
    document.body.appendChild(visual);

    const previousOpacity = sourceZone.style.opacity;
    sourceZone.style.opacity = '0';

    try {
      const flipAnimation = visual.animate([
        { transform: 'perspective(700px) rotateY(0deg) scale(1)' },
        { transform: 'perspective(700px) rotateY(90deg) scale(1.08)', offset: 0.5 },
        { transform: 'perspective(700px) rotateY(180deg) scale(1.06)' }
      ], {
        duration: flipDuration,
        easing: 'cubic-bezier(0.22, 0.72, 0.25, 1)',
        fill: 'forwards'
      });
      await flipAnimation.finished;
      back.style.display = 'none';
      onFlipped?.();

      const glowVisualAnimation = visual.animate([
        { transform: 'perspective(700px) rotateY(180deg) scale(1.06)' },
        { transform: 'perspective(700px) rotateY(180deg) scale(1.13)', offset: 0.35 },
        { transform: 'perspective(700px) rotateY(180deg) scale(1)' }
      ], {
        duration: glowDuration,
        easing: 'ease-out',
        fill: 'forwards'
      });
      const artBrightnessAnimation = art.animate([
        { filter: 'brightness(1)' },
        { filter: 'brightness(1.45)', offset: 0.35 },
        { filter: 'brightness(1)' }
      ], {
        duration: glowDuration,
        easing: 'ease-out',
        fill: 'forwards'
      });
      const glowPulseAnimation = glow.animate([
        { opacity: 0, transform: 'rotateY(180deg) scale(0.92)' },
        { opacity: 1, transform: 'rotateY(180deg) scale(1.12)', offset: 0.35 },
        { opacity: 0, transform: 'rotateY(180deg) scale(1.28)' }
      ], {
        duration: glowDuration,
        easing: 'ease-out',
        fill: 'forwards'
      });
      await Promise.all([
        glowVisualAnimation.finished,
        artBrightnessAnimation.finished,
        glowPulseAnimation.finished
      ]);
    } finally {
      sourceZone.style.opacity = previousOpacity;
      visual.remove();
    }
  }

  async function playDuelControlTransferMotion({
    sourceRect,
    targetZone,
    duration = DUEL_CONTROL_TRANSFER_DURATION_MS
  }) {
    const reduceMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || !sourceRect || !targetZone) return;

    const target = findBattleCardElement(targetZone);
    if (!target || typeof target.animate !== 'function') return;

    const destinationRect = target.getBoundingClientRect();
    if (!destinationRect.width || !destinationRect.height) return;

    const offsetX = sourceRect.left + sourceRect.width / 2
      - destinationRect.left - destinationRect.width / 2;
    const offsetY = sourceRect.top + sourceRect.height / 2
      - destinationRect.top - destinationRect.height / 2;
    const scale = Math.min(
      sourceRect.width / destinationRect.width,
      sourceRect.height / destinationRect.height,
      1
    );
    const animation = target.animate([
      {
        transform: `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${scale})`,
        opacity: 0.88
      },
      {
        transform: 'translate3d(0, 0, 0) scale(1)',
        opacity: 1
      }
    ], {
      duration,
      easing: 'cubic-bezier(.2,.7,.25,1)'
    });
    await animation.finished;
  }

  function playMill(side, cardCount) {
    if (!cardCount || (window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return 0;
    const deck = document.querySelector(`[data-js="deck-${side}"]`);
    const grave = document.querySelector(`[data-js="grave-${side}"]`);
    if (!deck || !grave) return 0;
    const source = deck.getBoundingClientRect();
    const destination = grave.getBoundingClientRect();
    if (!source.width || !destination.width) return 0;

    for (let index = 0; index < cardCount; index += 1) {
      const flyer = document.createElement('div');
      flyer.className = 'duel-mill-flyer';
      flyer.style.left = `${source.left + source.width / 2}px`;
      flyer.style.top = `${source.top + source.height / 2}px`;
      document.body.appendChild(flyer);
      const x = destination.left + destination.width / 2 - source.left - source.width / 2;
      const y = destination.top + destination.height / 2 - source.top - source.height / 2;
      flyer.animate([
        {
          transform: `translate3d(0, 0, 0) scale(${Math.max(0.7, Math.min(1, source.width / 86))})`,
          opacity: 1
        },
        {
          transform: `translate3d(${x * 0.55}px, ${y * 0.55}px, 0) scale(.82)`,
          opacity: 1,
          offset: 0.7
        },
        {
          transform: `translate3d(${x}px, ${y}px, 0) scale(.38)`,
          opacity: 0
        }
      ], {
        duration: DUEL_MILL_DURATION_MS,
        delay: index * DUEL_MILL_STAGGER_MS,
        easing: 'cubic-bezier(.22,.72,.22,1)',
        fill: 'both'
      }).onfinish = () => flyer.remove();
    }
    return DUEL_MILL_DURATION_MS + (cardCount - 1) * DUEL_MILL_STAGGER_MS;
  }

  function createDuelHandDiscardMotion(
    sourceElements,
    side,
    { jumpDuration = 0, flightDuration = DUEL_MILL_DURATION_MS } = {}
  ) {
    const grave = document.querySelector(`[data-js="grave-${side}"]`);
    const cards = sourceElements.flatMap((sourceElement) => {
      if (!sourceElement) return [];
      const sourceRect = sourceElement.getBoundingClientRect();
      if (!sourceRect.width || !sourceRect.height) return [];
      const flyer = sourceElement.cloneNode(true);
      flyer.removeAttribute('data-hand');
      flyer.removeAttribute('data-id');
      flyer.setAttribute('aria-hidden', 'true');
      return [{ flyer, sourceElement, sourceRect }];
    });

    return async function animateHandDiscard() {
      const reduceMotion = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const destinationRect = grave?.getBoundingClientRect();
      if (
        reduceMotion
        || !destinationRect?.width
        || !destinationRect.height
        || !cards.length
      ) return;

      const animations = cards.flatMap(({ flyer, sourceRect }, index) => {
        if (typeof flyer.animate !== 'function') return [];
        Object.assign(flyer.style, {
          position: 'fixed',
          left: `${sourceRect.left}px`,
          top: `${sourceRect.top}px`,
          width: `${sourceRect.width}px`,
          height: `${sourceRect.height}px`,
          margin: '0',
          zIndex: '1200',
          pointerEvents: 'none',
          transform: 'none',
          transformOrigin: 'center'
        });
        document.body.appendChild(flyer);

        const x = destinationRect.left + destinationRect.width / 2
          - sourceRect.left - sourceRect.width / 2;
        const y = destinationRect.top + destinationRect.height / 2
          - sourceRect.top - sourceRect.height / 2;
        return [(async () => {
          if (jumpDuration > 0) {
            const jump = flyer.animate([
              { transform: 'translate3d(0, 0, 0) scale(1)' },
              {
                transform: 'translate3d(0, -72px, 0) scale(1.08)',
                offset: 0.18
              },
              {
                transform: 'translate3d(0, -72px, 0) scale(1.08)',
                offset: 0.82
              },
              { transform: 'translate3d(0, -62px, 0) scale(1.04)' }
            ], {
              duration: jumpDuration,
              easing: 'cubic-bezier(.2,.7,.25,1)',
              fill: 'both'
            });
            await jump.finished;
            jump.cancel();
          }

          const animation = flyer.animate([
            {
              transform: jumpDuration > 0
                ? 'translate3d(0, -62px, 0) scale(1.04)'
                : 'translate3d(0, 0, 0) scale(1)',
              opacity: 1
            },
            {
              transform: `translate3d(${x}px, ${y}px, 0) rotateY(360deg) scale(.35)`,
              opacity: 0
            }
          ], {
            duration: flightDuration,
            delay: index * 90,
            easing: 'cubic-bezier(.22,.72,.22,1)',
            fill: 'both'
          });
          await animation.finished;
        })().finally(() => flyer.remove())];
      });

      await Promise.all(animations);
    };
  }

  function createDuelHandReturnMotion(sourceElements, side) {
    const deck = document.querySelector(`[data-js="deck-${side}"]`);
    const cards = sourceElements.flatMap((sourceElement) => {
      if (!sourceElement) return [];
      const sourceRect = sourceElement.getBoundingClientRect();
      if (!sourceRect.width || !sourceRect.height) return [];
      const flyer = sourceElement.cloneNode(true);
      flyer.removeAttribute('data-hand');
      flyer.removeAttribute('data-id');
      flyer.setAttribute('aria-hidden', 'true');
      return [{ flyer, sourceElement, sourceRect }];
    });

    return async function animateHandReturn() {
      const reduceMotion = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const destinationRect = deck?.getBoundingClientRect();
      if (
        reduceMotion
        || !destinationRect?.width
        || !destinationRect.height
        || !cards.length
      ) return;

      for (const { flyer, sourceElement, sourceRect } of cards) {
        if (typeof flyer.animate !== 'function') {
          flyer.remove();
          continue;
        }
        Object.assign(flyer.style, {
          position: 'fixed',
          left: `${sourceRect.left}px`,
          top: `${sourceRect.top}px`,
          width: `${sourceRect.width}px`,
          height: `${sourceRect.height}px`,
          margin: '0',
          zIndex: '1200',
          pointerEvents: 'none',
          transform: 'none',
          transformOrigin: 'center'
        });
        document.body.appendChild(flyer);
        sourceElement.style.opacity = '0';

        const x = destinationRect.left + destinationRect.width / 2
          - sourceRect.left - sourceRect.width / 2;
        const y = destinationRect.top + destinationRect.height / 2
          - sourceRect.top - sourceRect.height / 2;
        const animation = flyer.animate([
          {
            transform: 'translate3d(0, 0, 0) scale(1)',
            opacity: 1
          },
          {
            transform: `translate3d(${x * 0.62}px, ${y * 0.62}px, 0) rotateY(180deg) scale(.72)`,
            opacity: 1,
            offset: 0.68
          },
          {
            transform: `translate3d(${x}px, ${y}px, 0) rotateY(360deg) scale(.28)`,
            opacity: 0
          }
        ], {
          duration: 360,
          easing: 'cubic-bezier(.22,.72,.22,1)',
          fill: 'both'
        });
        await animation.finished.finally(() => flyer.remove());
      }
    };
  }

  async function playDuelDeckShuffleMotion(side) {
    const deck = document.querySelector(`[data-js="deck-${side}"]`);
    if (
      !deck
      || (window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      || typeof deck.animate !== 'function'
    ) return;

    const baseTransform = getComputedStyle(deck).transform;
    const rest = baseTransform === 'none' ? 'translate3d(0, 0, 0)' : baseTransform;
    const animation = deck.animate([
      { transform: rest, filter: 'brightness(1)' },
      {
        transform: `${rest} translate3d(-4px, -2px, 0) rotate(-3deg)`,
        filter: 'brightness(1.24)',
        offset: 0.25
      },
      {
        transform: `${rest} translate3d(4px, 1px, 0) rotate(3deg)`,
        filter: 'brightness(1.16)',
        offset: 0.58
      },
      {
        transform: `${rest} translate3d(-2px, 0, 0) rotate(-1.5deg)`,
        filter: 'brightness(1.1)',
        offset: 0.82
      },
      { transform: rest, filter: 'brightness(1)' }
    ], {
      duration: 720,
      easing: 'ease-in-out'
    });
    await animation.finished;
    animation.cancel();
  }

  async function resolveExplosionSfxAndPlay(fallbackMs = 1850) {
    if (typeof Audio !== 'function') return fallbackMs;
    try {
      const src = '/assets/music/sfx/explosion.mp3';
      let base = sfxAudioCache.get(src);
      if (!base) {
        base = new Audio(src);
        base.preload = 'auto';
        sfxAudioCache.set(src, base);
      }
      if (!(Number.isFinite(base.duration) && base.duration > 0)) {
        await new Promise((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            base.removeEventListener('loadedmetadata', finish);
            base.removeEventListener('error', finish);
            resolve();
          };
          base.addEventListener('loadedmetadata', finish, { once: true });
          base.addEventListener('error', finish, { once: true });
          if (typeof base.load === 'function' && base.readyState === 0) {
            try { base.load(); } catch { /* ignore */ }
          }
          window.setTimeout(finish, 260);
        });
      }
      const audioMs = Number.isFinite(base.duration) && base.duration > 0
        ? Math.round(base.duration * 1000)
        : 0;
      if (isDuelSfxEnabled()) {
        playDuelSfx('explosion.mp3', 1.0);
      }
      return audioMs > 0 ? audioMs + 500 : fallbackMs;
    } catch {
      return fallbackMs;
    }
  }

  // Helper: realistic fine hairline glass/board fracture texture
  function createFractureCanvas(texWidth = 1024, texHeight = 1024) {
    const c = document.createElement('canvas');
    c.width = texWidth;
    c.height = texHeight;
    const fctx = c.getContext('2d');
    const ox = texWidth / 2;
    const oy = texHeight / 2;

    const facetAngles = Array.from({ length: 14 }, (_, i) => (i / 14) * Math.PI * 2 + Math.sin(i * 2.1) * 0.14);
    facetAngles.forEach((a0, i) => {
      const a1 = facetAngles[(i + 1) % facetAngles.length];
      const r1 = 55 + (i % 3) * 35;
      const r2 = 135 + ((i + 1) % 4) * 42;
      fctx.beginPath();
      fctx.moveTo(ox + Math.cos(a0) * 14, oy + Math.sin(a0) * 14);
      fctx.lineTo(ox + Math.cos(a0) * r1, oy + Math.sin(a0) * r1);
      fctx.lineTo(ox + Math.cos((a0 + a1) * 0.5) * r2, oy + Math.sin((a0 + a1) * 0.5) * r2);
      fctx.lineTo(ox + Math.cos(a1) * r1, oy + Math.sin(a1) * r1);
      fctx.closePath();
      const fGrad = fctx.createLinearGradient(ox, oy, ox + Math.cos(a0) * r2, oy + Math.sin(a0) * r2);
      fGrad.addColorStop(0, 'rgba(170, 228, 255, 0.11)');
      fGrad.addColorStop(0.6, 'rgba(95, 175, 245, 0.04)');
      fGrad.addColorStop(1, 'rgba(10, 22, 48, 0)');
      fctx.fillStyle = fGrad;
      fctx.fill();
    });

    const rays = [];
    const primaryCount = 16;
    for (let i = 0; i < primaryCount; i += 1) {
      const baseAngle = (i / primaryCount) * Math.PI * 2 + Math.sin(i * 3.7) * 0.12;
      const pts = [{ x: ox, y: oy }];
      let x = ox;
      let y = oy;
      const steps = 11;
      const totalLen = 210 + (i % 4) * 68;
      const stepLen = totalLen / steps;
      for (let s = 1; s <= steps; s += 1) {
        const jitter = Math.sin(i * 6.1 + s * 4.3) * 0.34;
        const a = baseAngle + jitter;
        x += Math.cos(a) * stepLen;
        y += Math.sin(a) * stepLen;
        pts.push({ x, y });

        if (s >= 2 && s <= 8 && (s + i) % 2 === 0) {
          const subPts = [{ x, y }];
          let sx = x;
          let sy = y;
          const subAngle = a + ((s + i) % 4 === 0 ? 0.58 : -0.58);
          const subSteps = 4;
          const subLen = 18 + (s % 3) * 10;
          for (let k = 1; k <= subSteps; k += 1) {
            const sa = subAngle + Math.cos(k * 2.7 + i) * 0.25;
            sx += Math.cos(sa) * subLen;
            sy += Math.sin(sa) * subLen;
            subPts.push({ x: sx, y: sy });
          }
          rays.push({ pts: subPts, width: 1.15, alpha: 0.72 });
        }
      }
      rays.push({ pts, width: i % 2 === 0 ? 2.1 : 1.5, alpha: 0.94 });
    }

    [44, 88, 145].forEach((radius, ringIdx) => {
      const arcCount = 10 + ringIdx * 4;
      for (let i = 0; i < arcCount; i += 1) {
        if ((i + ringIdx) % 3 === 0) continue;
        const a0 = (i / arcCount) * Math.PI * 2 + 0.08;
        const a1 = ((i + 0.72) / arcCount) * Math.PI * 2;
        const r0 = radius + Math.sin(i * 2.9) * 7;
        const r1 = radius + Math.cos(i * 3.1) * 7;
        rays.push({
          pts: [
            { x: ox + Math.cos(a0) * r0, y: oy + Math.sin(a0) * r0 },
            { x: ox + Math.cos((a0 + a1) * 0.5) * ((r0 + r1) * 0.5 + 4), y: oy + Math.sin((a0 + a1) * 0.5) * ((r0 + r1) * 0.5 + 4) },
            { x: ox + Math.cos(a1) * r1, y: oy + Math.sin(a1) * r1 }
          ],
          width: 1.0,
          alpha: 0.55 - ringIdx * 0.1
        });
      }
    });

    fctx.lineCap = 'round';
    fctx.lineJoin = 'round';
    rays.forEach(({ pts, width: lw, alpha }) => {
      fctx.beginPath();
      fctx.moveTo(pts[0].x + 1.2, pts[0].y + 1.5);
      for (let i = 1; i < pts.length; i += 1) {
        fctx.lineTo(pts[i].x + 1.2, pts[i].y + 1.5);
      }
      fctx.strokeStyle = `rgba(2, 6, 16, ${0.72 * alpha})`;
      fctx.lineWidth = lw + 1.4;
      fctx.stroke();

      fctx.save();
      fctx.shadowColor = `rgba(120, 222, 255, ${0.75 * alpha})`;
      fctx.shadowBlur = 6;
      fctx.beginPath();
      fctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i += 1) {
        fctx.lineTo(pts[i].x, pts[i].y);
      }
      fctx.strokeStyle = `rgba(230, 248, 255, ${0.92 * alpha})`;
      fctx.lineWidth = lw;
      fctx.stroke();
      fctx.restore();
    });

    return c;
  }

  function mountStaticBoardCracks(board) {
    document.querySelectorAll('.duel-surrender-cracks').forEach((el) => el.remove());
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (!width || !height) return;
    const boardRect = board?.getBoundingClientRect?.();
    const cx = boardRect ? boardRect.left + boardRect.width / 2 : width / 2;
    const cy = boardRect ? boardRect.top + boardRect.height * 0.48 : height * 0.48;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const crackCanvas = document.createElement('canvas');
    crackCanvas.className = 'duel-surrender-cracks';
    crackCanvas.width = Math.max(1, Math.round(width * dpr));
    crackCanvas.height = Math.max(1, Math.round(height * dpr));
    crackCanvas.setAttribute('aria-hidden', 'true');
    Object.assign(crackCanvas.style, {
      position: 'fixed',
      inset: '0',
      width: '100vw',
      height: '100vh',
      pointerEvents: 'none',
      zIndex: '5'
    });
    (board?.parentElement || document.body).appendChild(crackCanvas);
    const crackCtx = crackCanvas.getContext('2d');
    if (!crackCtx) return;
    const fractureTex = createFractureCanvas(960, 960);
    crackCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    crackCtx.clearRect(0, 0, width, height);
    crackCtx.save();
    crackCtx.translate(cx, cy);
    crackCtx.scale(1, 0.56);
    crackCtx.drawImage(fractureTex, -480, -480);
    crackCtx.restore();
  }

  async function playDuelExodiaFinish(board, { onVideoCovered } = {}) {
    const reduceMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      onVideoCovered?.();
      mountStaticBoardCracks(board);
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      return;
    }

    const overlay = document.createElement('div');
    overlay.setAttribute('aria-hidden', 'true');
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '1300',
      background: '#000',
      pointerEvents: 'auto'
    });

    const video = document.createElement('video');
    video.src = '/assets/videos/amination%20exodia.mp4';
    video.playsInline = true;
    video.preload = 'auto';
    Object.assign(video.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      display: 'block'
    });

    const flash = document.createElement('div');
    Object.assign(flash.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      opacity: '0',
      background: 'radial-gradient(circle at 50% 50%, #ffffff 0%, #fffef2 55%, #fff6cc 100%)'
    });

    overlay.appendChild(video);
    overlay.appendChild(flash);
    document.body.appendChild(overlay);

    let rafId = 0;
    const syncEndFlash = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        const remaining = video.duration - video.currentTime;
        if (remaining <= 0.28) {
          const p = Math.min(1, Math.max(0, (0.28 - remaining) / 0.22));
          flash.style.opacity = String(p);
        }
      }
      if (!video.ended && !video.error) {
        rafId = window.requestAnimationFrame(syncEndFlash);
      }
    };

    try {
      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          if (rafId) window.cancelAnimationFrame(rafId);
          video.removeEventListener('ended', finish);
          video.removeEventListener('error', finish);
          resolve();
        };
        video.addEventListener('ended', finish, { once: true });
        video.addEventListener('error', finish, { once: true });
        rafId = window.requestAnimationFrame(syncEndFlash);
        const playAttempt = video.play();
        if (playAttempt && typeof playAttempt.catch === 'function') {
          playAttempt.catch(() => {
            video.muted = true;
            const mutedAttempt = video.play();
            if (mutedAttempt && typeof mutedAttempt.catch === 'function') {
              mutedAttempt.catch(finish);
            }
          });
        }
      });

      // Ensure flash reaches full white seamlessly while video last frame is still underneath
      if (Number(flash.style.opacity) < 1) {
        flash.style.opacity = '1';
        if (typeof flash.animate === 'function') {
          await flash.animate(
            [{ opacity: Number(flash.style.opacity) || 0 }, { opacity: 1 }],
            { duration: 110, easing: 'ease-out', fill: 'forwards' }
          ).finished.catch(() => {});
        }
      }

      // Mount cracked board & commit post-Exodia board state underneath while flash is solid white
      onVideoCovered?.();
      mountStaticBoardCracks(board);
      video.remove();
      overlay.style.background = 'transparent';
      overlay.style.pointerEvents = 'none';

      if (typeof flash.animate === 'function') {
        await flash.animate(
          [{ opacity: 1 }, { opacity: 0 }],
          { duration: 750, easing: 'ease-out', fill: 'forwards' }
        ).finished.catch(() => {});
      } else {
        flash.style.opacity = '0';
      }
    } finally {
      if (rafId) window.cancelAnimationFrame(rafId);
      overlay.remove();
    }

    // Hold 1s showing the pre-cracked duel board before opening the result modal
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }

  async function playDuelSurrenderExplosion(board, requestedDuration = 1850) {
    const reduceMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    document.querySelectorAll('.duel-surrender-cracks').forEach((el) => el.remove());

    const width = window.innerWidth;
    const height = window.innerHeight;
    if (!width || !height) return;

    if (isDuelSfxEnabled()) {
      playDuelSfx('explosion.mp3', 1.0);
    }
    const duration = Number.isFinite(requestedDuration) && requestedDuration > 0
      ? requestedDuration
      : 1850;

    const boardRect = board?.getBoundingClientRect?.();
    const cx = boardRect
      ? boardRect.left + boardRect.width / 2
      : width / 2;
    const cy = boardRect
      ? boardRect.top + boardRect.height * 0.48
      : height * 0.48;

    const importMap = document.querySelector('script[type="importmap"]');
    const threeUrl = importMap
      ? JSON.parse(importMap.textContent || '{}').imports?.three
      : null;

    let THREE = null;
    if (threeUrl) {
      try {
        THREE = await import(/* @vite-ignore */ threeUrl);
      } catch (error) {
        console.warn('Không tải được Three.js cho hiệu ứng nổ bàn đấu, dùng Canvas 2D:', error);
      }
    }

    // Helper: soft radial plasma glow texture
    function createGlowTexture(stops, size = 256) {
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const gctx = c.getContext('2d');
      const half = size / 2;
      const grad = gctx.createRadialGradient(half, half, 0, half, half, half);
      stops.forEach(([offset, color]) => grad.addColorStop(offset, color));
      gctx.fillStyle = grad;
      gctx.fillRect(0, 0, size, size);
      return c;
    }

    // Helper: realistic fine hairline glass/board fracture texture
    function createFractureCanvas(texWidth = 1024, texHeight = 1024) {
      const c = document.createElement('canvas');
      c.width = texWidth;
      c.height = texHeight;
      const fctx = c.getContext('2d');
      const ox = texWidth / 2;
      const oy = texHeight / 2;

      // Subtle translucent shattered facets around impact center
      const facetAngles = Array.from({ length: 14 }, (_, i) => (i / 14) * Math.PI * 2 + Math.sin(i * 2.1) * 0.14);
      facetAngles.forEach((a0, i) => {
        const a1 = facetAngles[(i + 1) % facetAngles.length];
        const r1 = 55 + (i % 3) * 35;
        const r2 = 135 + ((i + 1) % 4) * 42;
        fctx.beginPath();
        fctx.moveTo(ox + Math.cos(a0) * 14, oy + Math.sin(a0) * 14);
        fctx.lineTo(ox + Math.cos(a0) * r1, oy + Math.sin(a0) * r1);
        fctx.lineTo(ox + Math.cos((a0 + a1) * 0.5) * r2, oy + Math.sin((a0 + a1) * 0.5) * r2);
        fctx.lineTo(ox + Math.cos(a1) * r1, oy + Math.sin(a1) * r1);
        fctx.closePath();
        const fGrad = fctx.createLinearGradient(
          ox,
          oy,
          ox + Math.cos(a0) * r2,
          oy + Math.sin(a0) * r2
        );
        fGrad.addColorStop(0, 'rgba(170, 228, 255, 0.11)');
        fGrad.addColorStop(0.6, 'rgba(95, 175, 245, 0.04)');
        fGrad.addColorStop(1, 'rgba(10, 22, 48, 0)');
        fctx.fillStyle = fGrad;
        fctx.fill();
      });

      // Fine, sharp branching hairline fractures (shadow + crisp glowing ice-white core)
      const rays = [];
      const primaryCount = 16;
      for (let i = 0; i < primaryCount; i += 1) {
        const baseAngle = (i / primaryCount) * Math.PI * 2 + Math.sin(i * 3.7) * 0.12;
        const pts = [{ x: ox, y: oy }];
        let x = ox;
        let y = oy;
        const steps = 11;
        const totalLen = 210 + (i % 4) * 68;
        const stepLen = totalLen / steps;
        for (let s = 1; s <= steps; s += 1) {
          const jitter = Math.sin(i * 6.1 + s * 4.3) * 0.34;
          const a = baseAngle + jitter;
          x += Math.cos(a) * stepLen;
          y += Math.sin(a) * stepLen;
          pts.push({ x, y });

          if (s >= 2 && s <= 8 && (s + i) % 2 === 0) {
            const subPts = [{ x, y }];
            let sx = x;
            let sy = y;
            const subAngle = a + ((s + i) % 4 === 0 ? 0.58 : -0.58);
            const subSteps = 4;
            const subLen = (18 + (s % 3) * 10);
            for (let k = 1; k <= subSteps; k += 1) {
              const sa = subAngle + Math.cos(k * 2.7 + i) * 0.25;
              sx += Math.cos(sa) * subLen;
              sy += Math.sin(sa) * subLen;
              subPts.push({ x: sx, y: sy });
            }
            rays.push({ pts: subPts, width: 1.15, alpha: 0.72 });
          }
        }
        rays.push({ pts, width: i % 2 === 0 ? 2.1 : 1.5, alpha: 0.94 });
      }

      // Concentric stress rings near impact center (like real shattered glass)
      [44, 88, 145].forEach((radius, ringIdx) => {
        const arcCount = 10 + ringIdx * 4;
        for (let i = 0; i < arcCount; i += 1) {
          if ((i + ringIdx) % 3 === 0) continue;
          const a0 = (i / arcCount) * Math.PI * 2 + 0.08;
          const a1 = ((i + 0.72) / arcCount) * Math.PI * 2;
          const r0 = radius + Math.sin(i * 2.9) * 7;
          const r1 = radius + Math.cos(i * 3.1) * 7;
          rays.push({
            pts: [
              { x: ox + Math.cos(a0) * r0, y: oy + Math.sin(a0) * r0 },
              { x: ox + Math.cos((a0 + a1) * 0.5) * ((r0 + r1) * 0.5 + 4), y: oy + Math.sin((a0 + a1) * 0.5) * ((r0 + r1) * 0.5 + 4) },
              { x: ox + Math.cos(a1) * r1, y: oy + Math.sin(a1) * r1 }
            ],
            width: 1.0,
            alpha: 0.55 - ringIdx * 0.1
          });
        }
      });

      // Draw crisp shadow edge + fine luminous crack core
      fctx.lineCap = 'round';
      fctx.lineJoin = 'round';
      rays.forEach(({ pts, width: lw, alpha }) => {
        fctx.beginPath();
        fctx.moveTo(pts[0].x + 1.2, pts[0].y + 1.5);
        for (let i = 1; i < pts.length; i += 1) {
          fctx.lineTo(pts[i].x + 1.2, pts[i].y + 1.5);
        }
        fctx.strokeStyle = `rgba(2, 6, 16, ${0.72 * alpha})`;
        fctx.lineWidth = lw + 1.4;
        fctx.stroke();

        fctx.save();
        fctx.shadowColor = `rgba(120, 222, 255, ${0.75 * alpha})`;
        fctx.shadowBlur = 6;
        fctx.beginPath();
        fctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i += 1) {
          fctx.lineTo(pts[i].x, pts[i].y);
        }
        fctx.strokeStyle = `rgba(230, 248, 255, ${0.92 * alpha})`;
        fctx.lineWidth = lw;
        fctx.stroke();
        fctx.restore();
      });

      return c;
    }

    if (!THREE) {
      const crackCanvas = document.createElement('canvas');
      crackCanvas.className = 'duel-surrender-cracks';
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      crackCanvas.width = Math.max(1, Math.round(width * dpr));
      crackCanvas.height = Math.max(1, Math.round(height * dpr));
      crackCanvas.setAttribute('aria-hidden', 'true');
      Object.assign(crackCanvas.style, {
        position: 'fixed',
        inset: '0',
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: '5'
      });
      (board?.parentElement || document.body).appendChild(crackCanvas);
      const crackCtx = crackCanvas.getContext('2d');
      if (!crackCtx) return;

      const fractureTex = createFractureCanvas(900, 900);
      const drawPersistentCracks = (scale = 1, alpha = 1) => {
        crackCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        crackCtx.clearRect(0, 0, width, height);
        crackCtx.save();
        crackCtx.translate(cx, cy);
        crackCtx.scale(scale, scale * 0.54);
        crackCtx.globalAlpha = alpha;
        crackCtx.drawImage(fractureTex, -450, -450);
        crackCtx.restore();
      };

      if (reduceMotion) {
        drawPersistentCracks(1, 1);
        await wait(duration);
        return;
      }

      const burstCanvas = document.createElement('canvas');
      burstCanvas.width = Math.max(1, Math.round(width * dpr));
      burstCanvas.height = Math.max(1, Math.round(height * dpr));
      burstCanvas.setAttribute('aria-hidden', 'true');
      Object.assign(burstCanvas.style, {
        position: 'fixed',
        inset: '0',
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: '70'
      });
      document.body.appendChild(burstCanvas);
      const bctx = burstCanvas.getContext('2d');

      const startTime = performance.now();
      await new Promise((resolve) => {
        function frame(now) {
          const t = Math.min((now - startTime) / duration, 1);
          if (t >= 0.18) {
            const p = Math.min((t - 0.18) / 0.28, 1);
            drawPersistentCracks(0.45 + 0.55 * (1 - (1 - p) ** 3), p);
          }
          if (bctx) {
            bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            bctx.clearRect(0, 0, width, height);
            if (t < 0.55) {
              const fade = t < 0.28 ? 1 : Math.max(0, 1 - (t - 0.28) / 0.27);
              const r = 36 + Math.min(t / 0.34, 1) * 165;
              const g = bctx.createRadialGradient(cx, cy, 0, cx, cy, r);
              g.addColorStop(0, `rgba(255, 255, 232, ${0.98 * fade})`);
              g.addColorStop(0.42, `rgba(255, 214, 62, ${0.95 * fade})`);
              g.addColorStop(0.74, `rgba(255, 134, 20, ${0.65 * fade})`);
              g.addColorStop(1, 'rgba(255, 100, 0, 0)');
              bctx.fillStyle = g;
              bctx.beginPath();
              bctx.arc(cx, cy, r, 0, Math.PI * 2);
              bctx.fill();
            }
          }
          if (t < 1) window.requestAnimationFrame(frame);
          else {
            burstCanvas.remove();
            resolve();
          }
        }
        window.requestAnimationFrame(frame);
      });
      return;
    }

    // === Layer 1 (z-index: 5, UNDER hand cards & result modal): Persistent 3D Board Fractures ===
    const crackRenderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance'
    });
    crackRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    crackRenderer.setSize(width, height, false);
    const crackCanvas = crackRenderer.domElement;
    crackCanvas.className = 'duel-surrender-cracks';
    crackCanvas.setAttribute('aria-hidden', 'true');
    Object.assign(crackCanvas.style, {
      position: 'fixed',
      inset: '0',
      width: '100vw',
      height: '100vh',
      pointerEvents: 'none',
      zIndex: '5'
    });
    (board?.parentElement || document.body).appendChild(crackCanvas);

    const crackScene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(44, width / height, 0.1, 100);
    camera.position.set(0, 0, 6.2);

    const ndcX = (cx / width) * 2 - 1;
    const ndcY = -(cy / height) * 2 + 1;
    const viewHeight = 2 * Math.tan((44 * Math.PI) / 360) * 6.2;
    const viewWidth = viewHeight * (width / height);
    const impactWorld = new THREE.Vector3(
      (ndcX * viewWidth) / 2,
      (ndcY * viewHeight) / 2,
      0
    );

    const crackRoot = new THREE.Group();
    crackRoot.position.copy(impactWorld);
    crackRoot.rotation.x = -0.42;
    crackScene.add(crackRoot);

    const fractureTex = new THREE.CanvasTexture(createFractureCanvas(1024, 1024));
    fractureTex.anisotropy = crackRenderer.capabilities.getMaxAnisotropy?.() || 1;
    const fractureMat = new THREE.MeshBasicMaterial({
      map: fractureTex,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const fractureMesh = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 7.2), fractureMat);
    crackRoot.add(fractureMesh);

    if (reduceMotion) {
      fractureMat.opacity = 0.95;
      crackRenderer.render(crackScene, camera);
      await wait(duration);
      return;
    }

    // === Layer 2 (z-index: 70, temporary): 3D Plasma Fireball + Sparks + Shockwave ===
    const burstRenderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance'
    });
    burstRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    burstRenderer.setSize(width, height, false);
    const burstCanvas = burstRenderer.domElement;
    burstCanvas.setAttribute('aria-hidden', 'true');
    Object.assign(burstCanvas.style, {
      position: 'fixed',
      inset: '0',
      width: '100vw',
      height: '100vh',
      pointerEvents: 'none',
      zIndex: '70'
    });
    document.body.appendChild(burstCanvas);

    const burstScene = new THREE.Scene();
    const burstRoot = new THREE.Group();
    burstRoot.position.copy(impactWorld);
    burstScene.add(burstRoot);

    // Vivid golden-orange fireball orb (dense core + soft outer bloom)
    const coreGlowTex = new THREE.CanvasTexture(
      createGlowTexture([
        [0, 'rgba(255, 255, 232, 1)'],
        [0.36, 'rgba(255, 218, 68, 0.98)'],
        [0.62, 'rgba(255, 146, 20, 0.86)'],
        [0.84, 'rgba(255, 88, 0, 0.28)'],
        [1, 'rgba(255, 65, 0, 0)']
      ])
    );
    const coreSpriteMat = new THREE.SpriteMaterial({
      map: coreGlowTex,
      transparent: true,
      opacity: 0,
      depthWrite: false
    });
    const coreSprite = new THREE.Sprite(coreSpriteMat);

    const bloomTex = new THREE.CanvasTexture(
      createGlowTexture([
        [0, 'rgba(255, 240, 160, 0.95)'],
        [0.45, 'rgba(255, 175, 40, 0.55)'],
        [1, 'rgba(255, 90, 0, 0)']
      ])
    );
    const bloomSpriteMat = new THREE.SpriteMaterial({
      map: bloomTex,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const bloomSprite = new THREE.Sprite(bloomSpriteMat);
    burstRoot.add(bloomSprite, coreSprite);

    const sparkTex = new THREE.CanvasTexture(
      createGlowTexture([
        [0, 'rgba(255, 255, 235, 1)'],
        [0.35, 'rgba(255, 216, 80, 0.95)'],
        [0.75, 'rgba(255, 138, 24, 0.4)'],
        [1, 'rgba(255, 100, 0, 0)']
      ], 128)
    );
    const sparks = Array.from({ length: 22 }, (_, i) => {
      const angle = (i / 22) * Math.PI * 2 + Math.sin(i * 3.1) * 0.15;
      const mat = new THREE.SpriteMaterial({
        map: sparkTex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const sprite = new THREE.Sprite(mat);
      const len = 0.34 + (i % 4) * 0.14;
      sprite.scale.set(len, 0.08, 1);
      mat.rotation = angle;
      burstRoot.add(sprite);
      return {
        sprite,
        mat,
        dir: new THREE.Vector3(Math.cos(angle), Math.sin(angle), (i % 3 - 1) * 0.18).normalize(),
        speed: 1.9 + (i % 5) * 0.45
      };
    });

    const ringCanvas = document.createElement('canvas');
    ringCanvas.width = 512;
    ringCanvas.height = 512;
    const rctx = ringCanvas.getContext('2d');
    const rGrad = rctx.createRadialGradient(256, 256, 150, 256, 256, 256);
    rGrad.addColorStop(0, 'rgba(100, 215, 255, 0)');
    rGrad.addColorStop(0.55, 'rgba(110, 220, 255, 0.48)');
    rGrad.addColorStop(0.82, 'rgba(255, 222, 120, 0.94)');
    rGrad.addColorStop(0.94, 'rgba(255, 255, 235, 0.72)');
    rGrad.addColorStop(1, 'rgba(255, 200, 90, 0)');
    rctx.fillStyle = rGrad;
    rctx.fillRect(0, 0, 512, 512);
    const ringTex = new THREE.CanvasTexture(ringCanvas);

    const shockwaveMat = new THREE.MeshBasicMaterial({
      map: ringTex,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const shockwave = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), shockwaveMat);
    shockwave.rotation.x = -0.42;
    burstRoot.add(shockwave);

    const shakeAnim = board?.animate?.(
      [
        { transform: 'translate3d(0, 0, 0)' },
        { transform: 'translate3d(-7px, 4px, 0)', offset: 0.14 },
        { transform: 'translate3d(8px, -4px, 0)', offset: 0.28 },
        { transform: 'translate3d(-5px, -3px, 0)', offset: 0.44 },
        { transform: 'translate3d(4px, 2px, 0)', offset: 0.62 },
        { transform: 'translate3d(0, 0, 0)' }
      ],
      { duration: Math.min(duration, 850), easing: 'ease-out' }
    );

    const startTime = performance.now();
    await new Promise((resolve) => {
      function frame(now) {
        const t = Math.min((now - startTime) / duration, 1);

        if (t < 0.54) {
          const orbT = Math.min(t / 0.28, 1);
          const orbFade = t < 0.3 ? 1 : Math.max(0, 1 - (t - 0.3) / 0.24);
          const scale = 0.7 + (1 - (1 - orbT) ** 3) * 2.2;
          coreSprite.scale.set(scale, scale, 1);
          bloomSprite.scale.set(scale * 1.45, scale * 1.45, 1);
          coreSpriteMat.opacity = 0.98 * orbFade;
          bloomSpriteMat.opacity = 0.85 * orbFade;

          const spT = Math.min(t / 0.48, 1);
          const spEased = 1 - (1 - spT) ** 2;
          sparks.forEach((s) => {
            s.sprite.position.copy(s.dir).multiplyScalar(0.25 + spEased * s.speed);
            s.mat.opacity = 0.98 * orbFade;
          });
        } else {
          coreSprite.visible = false;
          bloomSprite.visible = false;
          sparks.forEach((s) => { s.sprite.visible = false; });
        }

        if (t >= 0.16) {
          const wT = (t - 0.16) / 0.84;
          const wEased = 1 - (1 - wT) ** 3;
          shockwave.scale.setScalar(0.35 + wEased * 4.4);
          shockwaveMat.opacity = Math.max(0, (1 - wT) * 0.95);

          const crackT = Math.min(wT / 0.24, 1);
          const crackEased = 1 - (1 - crackT) ** 3;
          fractureMesh.scale.setScalar(0.42 + 0.58 * crackEased);
          fractureMat.opacity = crackEased * 0.95;
        }

        burstRenderer.render(burstScene, camera);
        crackRenderer.render(crackScene, camera);
        if (t < 1) {
          window.requestAnimationFrame(frame);
        } else {
          shakeAnim?.cancel?.();
          burstCanvas.remove();
          coreGlowTex.dispose();
          bloomTex.dispose();
          sparkTex.dispose();
          ringTex.dispose();
          burstRenderer.dispose();
          resolve();
        }
      }
      window.requestAnimationFrame(frame);
    });

    // Keep subtle breathing pulse on persistent duel-board fractures behind hand cards & defeat popup
    function keepCracksAlive(now) {
      if (!crackCanvas.isConnected) {
        fractureTex.dispose();
        crackRenderer.dispose();
        return;
      }
      fractureMat.opacity = 0.82 + 0.13 * Math.sin(now * 0.0035);
      crackRenderer.render(crackScene, camera);
      window.requestAnimationFrame(keepCracksAlive);
    }
    window.requestAnimationFrame(keepCracksAlive);
  }

  function createDiceFaceTexture(THREE, value) {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const bgGrad = ctx.createRadialGradient(
      size * 0.5, size * 0.5, size * 0.14,
      size * 0.5, size * 0.5, size * 0.72
    );
    bgGrad.addColorStop(0, '#ffffff');
    bgGrad.addColorStop(0.76, '#f6f8fc');
    bgGrad.addColorStop(1, '#dfe5ef');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, size, size);

    const isRed = value === 1 || value === 4;
    const mainColor = isRed ? '#dc2026' : '#1658c8';
    const rimColor = isRed ? '#8d0e14' : '#0b327d';
    const pipsMap = {
      1: [[0.5, 0.5, 0.145]],
      2: [[0.28, 0.28, 0.09], [0.72, 0.72, 0.09]],
      3: [[0.26, 0.26, 0.088], [0.5, 0.5, 0.088], [0.74, 0.74, 0.088]],
      4: [[0.28, 0.28, 0.09], [0.72, 0.28, 0.09], [0.28, 0.72, 0.09], [0.72, 0.72, 0.09]],
      5: [[0.26, 0.26, 0.086], [0.74, 0.26, 0.086], [0.5, 0.5, 0.086], [0.26, 0.74, 0.086], [0.74, 0.74, 0.086]],
      6: [
        [0.29, 0.24, 0.084], [0.71, 0.24, 0.084],
        [0.29, 0.5, 0.084], [0.71, 0.5, 0.084],
        [0.29, 0.76, 0.084], [0.71, 0.76, 0.084]
      ]
    };

    (pipsMap[value] || pipsMap[1]).forEach(([nx, ny, nr]) => {
      const px = nx * size;
      const py = ny * size;
      const pr = nr * size;

      // Subtle recessed rim
      ctx.beginPath();
      ctx.arc(px, py, pr + 2.5, 0, Math.PI * 2);
      ctx.fillStyle = rimColor;
      ctx.fill();

      // Main colored pip with subtle glossy sheen
      const pipGrad = ctx.createRadialGradient(
        px - pr * 0.28, py - pr * 0.28, pr * 0.1,
        px, py, pr
      );
      pipGrad.addColorStop(0, isRed ? '#ff595e' : '#4a8dff');
      pipGrad.addColorStop(0.55, mainColor);
      pipGrad.addColorStop(1, rimColor);
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fillStyle = pipGrad;
      ctx.fill();
    });

    const texture = new THREE.CanvasTexture(canvas);
    if ('colorSpace' in texture && THREE.SRGBColorSpace) {
      texture.colorSpace = THREE.SRGBColorSpace;
    }
    texture.anisotropy = 4;
    return texture;
  }

  function createRoundedDiceGeometry(THREE, size = 1.15, radius = 0.17) {
    const geom = new THREE.BoxGeometry(size, size, size, 12, 12, 12);
    const pos = geom.attributes.position;
    const norm = geom.attributes.normal;
    const inner = size * 0.5 - radius;
    const v = new THREE.Vector3();
    const clamped = new THREE.Vector3();
    const dir = new THREE.Vector3();

    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i);
      clamped.set(
        Math.max(-inner, Math.min(inner, v.x)),
        Math.max(-inner, Math.min(inner, v.y)),
        Math.max(-inner, Math.min(inner, v.z))
      );
      dir.subVectors(v, clamped);
      if (dir.lengthSq() > 1e-8) {
        dir.normalize();
        v.copy(clamped).addScaledVector(dir, radius);
        pos.setXYZ(i, v.x, v.y, v.z);
        norm.setXYZ(i, dir.x, dir.y, dir.z);
      }
    }
    pos.needsUpdate = true;
    norm.needsUpdate = true;
    return geom;
  }

  async function playDuelDiceRoll(board, { value = 1, player = 'me' } = {}) {
    const rolledValue = Math.max(1, Math.min(6, Math.round(Number(value) || 1)));
    const reduceMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;

    const width = Math.max(320, Math.round(window.innerWidth || 1280));
    const height = Math.max(240, Math.round(window.innerHeight || 720));
    const duration = 2000;

    let THREE = null;
    try {
      const importMap = document.querySelector('script[type="importmap"]');
      const threeUrl = importMap
        ? JSON.parse(importMap.textContent || '{}').imports?.three
        : null;
      if (threeUrl) {
        THREE = await import(/* @vite-ignore */ threeUrl);
      }
    } catch {
      THREE = null;
    }

    if (THREE) {
      const canvas3d = document.createElement('canvas');
      canvas3d.setAttribute('aria-hidden', 'true');
      Object.assign(canvas3d.style, {
        position: 'fixed',
        inset: '0',
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: '1160'
      });
      document.body.appendChild(canvas3d);
      let renderer = null;
      const disposables = [];
      try {
        renderer = new THREE.WebGLRenderer({
          canvas: canvas3d,
          alpha: true,
          antialias: true,
          powerPreference: 'high-performance'
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(width, height, false);
        if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) {
          renderer.outputColorSpace = THREE.SRGBColorSpace;
        }

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 50);
        camera.position.set(0, 4.8, 4.0);
        camera.lookAt(0, 0.25, 0);

        const ambient = new THREE.AmbientLight(0xffffff, 0.88);
        scene.add(ambient);

        const keyLight = new THREE.DirectionalLight(0xfff8eb, 1.35);
        keyLight.position.set(3.5, 7.5, 4.5);
        scene.add(keyLight);

        const rimLight = new THREE.DirectionalLight(0x9bd8ff, 0.65);
        rimLight.position.set(-4.0, 3.8, -3.2);
        scene.add(rimLight);

        // BoxGeometry face order: +X(3), -X(4), +Y(1), -Y(6), +Z(2), -Z(5)
        const faceValues = [3, 4, 1, 6, 2, 5];
        const materials = faceValues.map((faceVal) => {
          const tex = createDiceFaceTexture(THREE, faceVal);
          disposables.push(tex);
          const mat = new THREE.MeshStandardMaterial({
            map: tex,
            roughness: 0.22,
            metalness: 0.04,
            transparent: true,
            opacity: 1
          });
          disposables.push(mat);
          return mat;
        });

        const dieSize = 0.62;
        const halfSize = dieSize * 0.5;
        const diceGeom = createRoundedDiceGeometry(THREE, dieSize, 0.09);
        disposables.push(diceGeom);
        const diceMesh = new THREE.Mesh(diceGeom, materials);
        scene.add(diceMesh);

        // Soft ground shadow beneath the die
        const shadowCanvas = document.createElement('canvas');
        shadowCanvas.width = 256;
        shadowCanvas.height = 256;
        const sctx = shadowCanvas.getContext('2d');
        const sGrad = sctx.createRadialGradient(128, 128, 12, 128, 128, 124);
        sGrad.addColorStop(0, 'rgba(0, 8, 24, 0.58)');
        sGrad.addColorStop(0.55, 'rgba(0, 8, 24, 0.24)');
        sGrad.addColorStop(1, 'rgba(0, 8, 24, 0)');
        sctx.fillStyle = sGrad;
        sctx.fillRect(0, 0, 256, 256);
        const shadowTex = new THREE.CanvasTexture(shadowCanvas);
        disposables.push(shadowTex);
        const shadowMat = new THREE.MeshBasicMaterial({
          map: shadowTex,
          transparent: true,
          opacity: 0.9,
          depthWrite: false
        });
        disposables.push(shadowMat);
        const shadowPlaneGeom = new THREE.PlaneGeometry(1.05, 1.05);
        disposables.push(shadowPlaneGeom);
        const shadowMesh = new THREE.Mesh(shadowPlaneGeom, shadowMat);
        shadowMesh.rotation.x = -Math.PI / 2;
        shadowMesh.position.y = 0.01;
        scene.add(shadowMesh);

        // Exact face-up orientation for rolledValue (1..6)
        const faceEulerMap = {
          1: new THREE.Euler(0, 0, 0),
          2: new THREE.Euler(-Math.PI / 2, 0, 0),
          3: new THREE.Euler(0, 0, Math.PI / 2),
          4: new THREE.Euler(0, 0, -Math.PI / 2),
          5: new THREE.Euler(Math.PI / 2, 0, 0),
          6: new THREE.Euler(Math.PI, 0, 0)
        };
        const faceQuat = new THREE.Quaternion().setFromEuler(
          faceEulerMap[rolledValue] || faceEulerMap[1]
        );
        const yawQuat = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          0.18
        );
        const targetQuat = yawQuat.multiply(faceQuat);

        const startX = player === 'opp' ? -0.9 : 0.9;
        const startZ = player === 'opp' ? -1.8 : 1.8;
        const spinAxis = new THREE.Vector3(1.4, 0.9, -1.1).normalize();
        const spinQuat = new THREE.Quaternion();
        const startTime = performance.now();

        await new Promise((resolve) => {
          function frame(now) {
            const t = Math.min((now - startTime) / duration, 1);

            if (t < 0.72) {
              const moveT = t / 0.72;
              const easedMove = 1 - (1 - moveT) ** 2.2;
              const px = startX * (1 - easedMove);
              const pz = startZ * (1 - easedMove);
              // 3 realistic damped bounces on the board floor
              const bounceAmp = Math.pow(1 - moveT, 1.45) * 1.95;
              const bounceY = Math.abs(Math.sin(moveT * Math.PI * 2.5)) * bounceAmp;
              const py = halfSize + bounceY;
              diceMesh.position.set(px, py, pz);

              const spinAmount = (1 - easedMove) * Math.PI * 6.5;
              spinQuat.setFromAxisAngle(spinAxis, spinAmount);
              diceMesh.quaternion.copy(targetQuat).multiply(spinQuat);

              shadowMesh.position.set(px, 0.01, pz);
              const shadowScale = Math.max(0.55, 1.05 - bounceY * 0.16);
              shadowMesh.scale.setScalar(shadowScale);
              shadowMat.opacity = Math.max(0.28, 0.92 - bounceY * 0.25);
            } else {
              diceMesh.position.set(0, halfSize, 0);
              diceMesh.quaternion.copy(targetQuat);
              shadowMesh.position.set(0, 0.01, 0);
              shadowMesh.scale.setScalar(1.02);
              shadowMat.opacity = 0.9;
            }

            if (t > 0.9) {
              const fade = Math.max(0, 1 - (t - 0.9) / 0.1);
              materials.forEach((mat) => { mat.opacity = fade; });
              shadowMat.opacity *= fade;
            }

            renderer.render(scene, camera);
            if (t < 1) {
              window.requestAnimationFrame(frame);
            } else {
              resolve();
            }
          }
          window.requestAnimationFrame(frame);
        });
        return;
      } catch (error) {
        console.warn('Three.js dice roll fallback to 2D:', error);
      } finally {
        disposables.forEach((item) => item?.dispose?.());
        renderer?.dispose?.();
        canvas3d.remove();
      }
    }

    // 2D Canvas fallback if Three.js/WebGL is unavailable
    const canvas2d = document.createElement('canvas');
    canvas2d.setAttribute('aria-hidden', 'true');
    Object.assign(canvas2d.style, {
      position: 'fixed',
      inset: '0',
      width: '100vw',
      height: '100vh',
      pointerEvents: 'none',
      zIndex: '1160'
    });
    canvas2d.width = width;
    canvas2d.height = height;
    document.body.appendChild(canvas2d);
    const ctx = canvas2d.getContext('2d');
    if (!ctx) {
      canvas2d.remove();
      return;
    }
    const startTime = performance.now();
    await new Promise((resolve) => {
      function draw2d(now) {
        const t = Math.min((now - startTime) / duration, 1);
        ctx.clearRect(0, 0, width, height);
        const cx = width / 2;
        const bounce = t < 0.72
          ? Math.abs(Math.sin((t / 0.72) * Math.PI * 2.5)) * (1 - t / 0.72) * 90
          : 0;
        const cy = height * 0.5 - bounce;
        const shown = t < 0.72 ? (Math.floor(t * 24) % 6) + 1 : rolledValue;
        const isRed = shown === 1 || shown === 4;
        const size = 48;

        ctx.save();
        ctx.globalAlpha = t > 0.9 ? Math.max(0, 1 - (t - 0.9) / 0.1) : 1;
        ctx.translate(cx, cy);
        if (t < 0.72) ctx.rotate((1 - t / 0.72) * Math.PI * 4);
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(-size / 2, -size / 2, size, size, 16);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = isRed ? '#dc2026' : '#1658c8';
        ctx.font = '900 40px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(shown), 0, 2);
        ctx.restore();

        if (t < 1) window.requestAnimationFrame(draw2d);
        else resolve();
      }
      window.requestAnimationFrame(draw2d);
    });
    canvas2d.remove();
  }

export {
  DUEL_DRAW_STAGGER_MS,
  DUEL_SUMMON_DURATION_MS,
  DUEL_PLACEMENT_DURATION_MS,
  DUEL_MILL_DURATION_MS,
  DUEL_MILL_STAGGER_MS,
  DUEL_TRICKY_DISCARD_JUMP_DURATION_MS,
  DUEL_TRICKY_DISCARD_FLIGHT_DURATION_MS,
  DUEL_CONTROL_TRANSFER_DURATION_MS,
  getAttackArrowStart,
  getAttackArrowHeadPoints,
  getDrawSequenceDuration,
  playMill as playDuelMillMotion,
  playDuelDestructionMotion,
  playSequentialDestructionTargets,
  playDuelBattleMotion,
  playDuelCounterbalanceMotion,
  playDuelChainActivationMotion,
  playDuelTrapActivationMotion,
  playDuelEffectActivationGlow,
  playDuelControlTransferMotion,
  playDuelExodiaFinish,
  playDuelSurrenderExplosion,
  playDuelDiceRoll,
  createDuelHandDiscardMotion,
  createDuelHandReturnMotion,
  playDuelDeckShuffleMotion,
  playDuelSfx,
  play as playDuelCardMotion
};
