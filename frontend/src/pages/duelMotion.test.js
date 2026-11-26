import assert from 'node:assert/strict';
import test from 'node:test';
import {
  playDuelDestructionMotion,
  playDuelCardMotion,
  playDuelSurrenderExplosion,
  playSequentialDestructionTargets
} from './duelMotion.js';
import {
  playSliferLightningMotion,
  SLIFER_LIGHTNING_IMPACT_PROGRESS
} from '../renderers/sliferLightningRenderer.js';

test('keeps a destroyed field card hidden after its fragments finish', async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const animations = [];
  const bounds = {
    left: 100,
    top: 200,
    width: 100,
    height: 140
  };
  const createAnimation = () => {
    const animation = {
      finished: Promise.resolve(),
      cancel() {}
    };
    animations.push(animation);
    return animation;
  };
  const createElement = () => ({
    style: {},
    setAttribute() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    getBoundingClientRect() {
      return bounds;
    },
    cloneNode() {
      return createElement();
    },
    appendChild() {},
    animate: createAnimation,
    remove() {}
  });
  const visual = createElement();
  const zone = {
    querySelector() {
      return visual;
    }
  };
  globalThis.window = {
    matchMedia: () => ({ matches: false })
  };
  globalThis.document = {
    body: { appendChild() {} },
    createElement
  };

  try {
    await playDuelDestructionMotion({ destroyedZones: [zone] });
    assert.equal(visual.style.visibility, 'hidden');
    assert.ok(animations.length > 0);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('preloads summon artwork and reveals the field card while the impact glow remains', async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousGetComputedStyle = globalThis.getComputedStyle;
  const createdElements = [];
  const animations = [];
  const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

  const createImage = () => ({
    complete: true,
    naturalWidth: 120,
    decoded: false,
    decode() {
      this.decoded = true;
      return Promise.resolve();
    },
    removeEventListener() {},
    addEventListener() {}
  });
  const createElement = (tagName, images = []) => ({
    tagName,
    style: {
      setProperty() {}
    },
    classList: {
      contains: (className) => className === 'duel-field-monster-motion',
      add() {}
    },
    isConnected: true,
    querySelectorAll(selector) {
      if (selector === 'img') return images;
      return [];
    },
    setAttribute() {},
    getBoundingClientRect: () => ({
      left: 100,
      top: 200,
      width: 100,
      height: 140
    }),
    cloneNode() {
      this.clone = createElement('flyer', [createImage()]);
      return this.clone;
    },
    animate(keyframes, options) {
      let resolveFinished;
      const animation = {
        keyframes,
        options,
        cancelled: false,
        finished: new Promise((resolve) => {
          resolveFinished = resolve;
        }),
        finish() {
          this.onfinish?.();
          resolveFinished();
        },
        cancel() {
          this.cancelled = true;
          this.oncancel?.();
          resolveFinished();
        },
        remove: () => {
          this.removed = true;
        }
      };
      animations.push(animation);
      return animation;
    },
    remove() {
      this.removed = true;
    }
  });

  const sourceImage = createImage();
  const monster = createElement('monster', [sourceImage]);
  monster.style = { visibility: '' };
  monster.parentElement = {
    style: { getPropertyValue: () => '100px' }
  };
  globalThis.window = {
    innerWidth: 1000,
    innerHeight: 800,
    matchMedia: () => ({ matches: false }),
    setTimeout,
    clearTimeout
  };
  globalThis.document = {
    body: {
      appendChild(element) {
        createdElements.push(element);
      }
    },
    createElement: (tagName) => createElement(tagName)
  };
  globalThis.getComputedStyle = () => ({
    getPropertyValue: () => '100px'
  });

  try {
    playDuelCardMotion(monster, 'summon', { duration: 100 });
    assert.equal(monster.style.visibility, 'hidden');
    assert.ok(monster.clone);
    assert.equal(monster.clone.style.visibility, 'visible');
    assert.equal(animations.length, 0);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(monster.clone.querySelectorAll('img')[0].decoded, true);
    assert.equal(monster.style.visibility, 'hidden');

    const flyerAnimation = animations.find(
      (animation) => animation.options.duration === 100
    );
    const flareAnimation = animations.find(
      (animation) => animation.options.duration === 360
    );
    assert.ok(flyerAnimation);
    assert.ok(flareAnimation);
    assert.equal(flyerAnimation.keyframes[0].opacity, 1);
    assert.equal(
      flyerAnimation.keyframes[0].transform,
      'translate3d(0, 0, 0) scale(1)'
    );

    await wait(110);
    assert.equal(monster.style.visibility, '');
    assert.equal(monster.clone.removed, undefined);
    assert.equal(createdElements.some(
      (element) => element.className === 'duel-monster-summon__flare'
        && element.removed
    ), false);

    flyerAnimation.finish();
    assert.equal(monster.clone.removed, true);
    assert.equal(monster.style.visibility, '');
    assert.equal(flareAnimation.cancelled, false);

    animations
      .filter((animation) => animation !== flyerAnimation)
      .forEach((animation) => animation.finish());
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousGetComputedStyle === undefined) delete globalThis.getComputedStyle;
    else globalThis.getComputedStyle = previousGetComputedStyle;
  }
});

test('plays multiple destruction effects in order without overlapping them', async () => {
  const active = new Set();
  const maximumActive = { value: 0 };
  const sequence = [];

  await playSequentialDestructionTargets(
    ['first tribute', 'second tribute', 'destroyed trap'],
    async (target) => {
      active.add(target);
      maximumActive.value = Math.max(maximumActive.value, active.size);
      sequence.push(`start:${target}`);
      await new Promise((resolve) => setImmediate(resolve));
      sequence.push(`end:${target}`);
      active.delete(target);
    }
  );

  assert.equal(maximumActive.value, 1);
  assert.deepEqual(sequence, [
    'start:first tribute',
    'end:first tribute',
    'start:second tribute',
    'end:second tribute',
    'start:destroyed trap',
    'end:destroyed trap'
  ]);
});

test('board explosion plays explosion.mp3 and uses fixed default duration 1850ms', async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousAudio = globalThis.Audio;

  let playedExplosionSrc = null;
  let simulatedNow = 0;

  class FakeAudio {
    constructor(src = '') {
      this.src = src;
      this.duration = 1.4; // 1400ms -> explosion should last 1900ms
      this.readyState = 4;
      this.preload = 'auto';
      this.volume = 1;
    }

    addEventListener() {}

    removeEventListener() {}

    cloneNode() {
      const clone = new FakeAudio(this.src);
      return clone;
    }

    play() {
      playedExplosionSrc = this.src;
      return Promise.resolve();
    }
  }

  const make2dCtx = () => ({
    setTransform() {},
    clearRect() {},
    save() {},
    restore() {},
    translate() {},
    scale() {},
    drawImage() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    arc() {},
    fill() {},
    stroke() {},
    fillRect() {},
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} })
  });

  globalThis.Audio = FakeAudio;
  const previousPerformanceNow = performance.now;
  performance.now = () => simulatedNow;

  globalThis.window = {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    localStorage: { getItem: () => 'on' },
    matchMedia: () => ({ matches: false }),
    setTimeout,
    clearTimeout,
    requestAnimationFrame(cb) {
      simulatedNow += 100;
      setImmediate(() => cb(simulatedNow));
      return 1;
    }
  };
  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { appendChild() {} },
    createElement: () => ({
      style: {},
      setAttribute() {},
      getContext: make2dCtx,
      remove() {}
    })
  };

  try {
    await playDuelSurrenderExplosion({
      parentElement: { appendChild() {} },
      getBoundingClientRect: () => ({ left: 100, top: 80, width: 800, height: 500 })
    });
    assert.equal(playedExplosionSrc, '/assets/music/sfx/explosion.mp3');
    assert.equal(simulatedNow, 1900);
  } finally {
    performance.now = previousPerformanceNow;
    if (previousAudio === undefined) delete globalThis.Audio;
    else globalThis.Audio = previousAudio;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('Slifer lightning triggers screen shake only once the bolt reaches the target', async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousPerformanceNow = performance.now;
  let simulatedNow = 0;
  performance.now = () => simulatedNow;

  const shakeCalls = [];
  let frameIndex = 0;
  const duration = 500;
  const impactMs = duration * SLIFER_LIGHTNING_IMPACT_PROGRESS;

  const make2dCtx = () => ({
    setTransform() {},
    clearRect() {},
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fill() {},
    arc() {},
    fillRect() {},
    drawImage() {},
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} })
  });

  globalThis.window = {
    devicePixelRatio: 1,
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame(cb) {
      frameIndex += 1;
      // Frame 1: before impact (< 0.16); Frame 2: right at impact (>= 0.16); Frame 3: end
      simulatedNow = frameIndex === 1 ? impactMs - 20 : frameIndex === 2 ? impactMs : duration;
      setImmediate(() => cb(simulatedNow));
      return frameIndex;
    }
  };
  globalThis.document = {
    querySelector: () => null,
    createElement: () => ({
      style: {},
      setAttribute() {},
      appendChild() {},
      getContext: make2dCtx,
      remove() {}
    })
  };

  const board = {
    appendChild() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 600 }),
    animate(keyframes, options) {
      shakeCalls.push({ at: simulatedNow, keyframes, options });
      return { finished: Promise.resolve(), cancel() {} };
    }
  };
  const targetZone = {
    getBoundingClientRect: () => ({ left: 380, top: 140, width: 90, height: 130 })
  };

  try {
    await playSliferLightningMotion(board, targetZone, { duration });
    assert.equal(shakeCalls.length, 1);
    assert.equal(shakeCalls[0].at >= impactMs, true);
    assert.equal(shakeCalls[0].at < duration, true);
  } finally {
    performance.now = previousPerformanceNow;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
