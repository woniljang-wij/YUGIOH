  const activeAnimations = new WeakMap();
  const STEPS = 24;

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
      duration: 440,
      curve: easing.backOut,
      from: { y: 42, scale: 0.78, rotateY: -55, rotateZ: -9, opacity: 0 },
      to: { y: 0, scale: 1, rotateY: 0, rotateZ: 0, opacity: 1 }
    },
    summon: {
      duration: 520,
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

  function play(element, presetName, options) {
    const preset = presets[presetName];
    if (!element || !preset) return null;

    const settings = options || {};
    const reduceMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || typeof element.animate !== 'function') return null;

    const previous = activeAnimations.get(element);
    if (previous) previous.cancel();

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


export { play as playDuelCardMotion };
