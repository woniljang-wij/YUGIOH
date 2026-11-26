const TAU = Math.PI * 2;
export const SLIFER_LIGHTNING_IMPACT_PROGRESS = 0.16;

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function buildBoltPath(x1, y1, x2, y2, displacement, depth = 4) {
  let points = [
    [x1, y1],
    [x2, y2]
  ];
  let disp = displacement;
  for (let d = 0; d < depth; d += 1) {
    const next = [points[0]];
    for (let i = 0; i < points.length - 1; i += 1) {
      const [ax, ay] = points[i];
      const [bx, by] = points[i + 1];
      const mx = (ax + bx) * 0.5 + (Math.random() - 0.5) * disp;
      const my = (ay + by) * 0.5 + (Math.random() - 0.5) * disp * 0.16;
      next.push([mx, my], [bx, by]);
    }
    points = next;
    disp *= 0.54;
  }
  return points;
}

function createLightningData(width, height, targetX, targetY) {
  const startX = targetX + (Math.random() - 0.5) * Math.min(90, width * 0.08);
  const startY = -12;
  const mainBolt = buildBoltPath(startX, startY, targetX, targetY, Math.min(82, width * 0.07), 4);
  const secondaryBolt = buildBoltPath(
    startX + (Math.random() - 0.5) * 44,
    startY,
    targetX + (Math.random() - 0.5) * 14,
    targetY,
    Math.min(60, width * 0.055),
    4
  );
  const branches = [];
  for (let i = 3; i < mainBolt.length - 3; i += 2) {
    if (branches.length >= 6) break;
    const [bx, by] = mainBolt[i];
    const side = i % 4 === 1 ? 1 : -1;
    const ex = bx + side * (28 + Math.random() * 68);
    const ey = Math.min(targetY + 34, by + 38 + Math.random() * 78);
    branches.push({
      startRatio: i / (mainBolt.length - 1),
      points: buildBoltPath(bx, by, ex, ey, 26, 3)
    });
  }
  const sparks = Array.from({ length: 16 }, (_, idx) => {
    const angle = (idx / 16) * TAU + (Math.random() - 0.5) * 0.3;
    const speed = 36 + Math.random() * 64;
    return { angle, speed, size: 1.5 + Math.random() * 2.2 };
  });
  return { mainBolt, secondaryBolt, branches, sparks };
}

function strokePolyline(ctx, points, maxRatio = 1) {
  if (points.length < 2 || maxRatio <= 0) return;
  const totalSegs = points.length - 1;
  const exactSeg = Math.min(totalSegs, Math.max(0, maxRatio * totalSegs));
  const fullSegs = Math.floor(exactSeg);
  const frac = exactSeg - fullSegs;

  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i <= fullSegs; i += 1) {
    ctx.lineTo(points[i][0], points[i][1]);
  }
  if (fullSegs < totalSegs && frac > 0) {
    const [ax, ay] = points[fullSegs];
    const [bx, by] = points[fullSegs + 1];
    ctx.lineTo(ax + (bx - ax) * frac, ay + (by - ay) * frac);
  }
  ctx.stroke();
}

function drawLightningFrame(ctx, width, height, targetX, targetY, boltData, progress) {
  ctx.clearRect(0, 0, width, height);

  const strikeProgress = Math.min(1, progress / SLIFER_LIGHTNING_IMPACT_PROGRESS);
  const impactT = Math.max(
    0,
    (progress - SLIFER_LIGHTNING_IMPACT_PROGRESS) / (1 - SLIFER_LIGHTNING_IMPACT_PROGRESS)
  );
  const fadeOut = progress > 0.72 ? 1 - easeOutCubic((progress - 0.72) / 0.28) : 1;
  const flicker = progress < 0.72 ? 0.82 + 0.18 * Math.sin(progress * 74) : 1;
  const alpha = Math.max(0, Math.min(1, fadeOut * flicker));
  if (alpha <= 0.01) return;

  // Overhead sky discharge glow
  ctx.save();
  const topGlow = ctx.createRadialGradient(targetX, 0, 8, targetX, targetY * 0.35, Math.max(160, height * 0.45));
  topGlow.addColorStop(0, `rgba(255, 246, 178, ${0.42 * alpha})`);
  topGlow.addColorStop(0.45, `rgba(255, 198, 66, ${0.18 * alpha})`);
  topGlow.addColorStop(1, 'rgba(255, 140, 20, 0)');
  ctx.fillStyle = topGlow;
  ctx.fillRect(0, 0, width, height);

  // Subtle vertical beam column behind the bolt
  const beamGrad = ctx.createLinearGradient(targetX - 48, 0, targetX + 48, 0);
  beamGrad.addColorStop(0, 'rgba(255, 188, 56, 0)');
  beamGrad.addColorStop(0.5, `rgba(255, 224, 118, ${0.22 * alpha * strikeProgress})`);
  beamGrad.addColorStop(1, 'rgba(255, 188, 56, 0)');
  ctx.fillStyle = beamGrad;
  ctx.fillRect(targetX - 48, 0, 96, targetY + 20);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Secondary electric arc
  ctx.shadowColor = `rgba(255, 182, 48, ${0.8 * alpha})`;
  ctx.shadowBlur = 14;
  ctx.strokeStyle = `rgba(255, 212, 102, ${0.58 * alpha})`;
  ctx.lineWidth = 3.2;
  strokePolyline(ctx, boltData.secondaryBolt, strikeProgress);

  // Branches
  for (const branch of boltData.branches) {
    if (strikeProgress <= branch.startRatio) continue;
    const localProgress = Math.min(1, (strikeProgress - branch.startRatio) / 0.2);
    ctx.shadowColor = `rgba(255, 196, 72, ${0.85 * alpha})`;
    ctx.shadowBlur = 10;
    ctx.strokeStyle = `rgba(255, 232, 138, ${0.75 * alpha})`;
    ctx.lineWidth = 2.6;
    strokePolyline(ctx, branch.points, localProgress);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.88 * alpha})`;
    ctx.lineWidth = 1.1;
    strokePolyline(ctx, branch.points, localProgress);
  }

  // Main Thunderforce bolt: outer golden aura -> bright amber -> pure white core
  ctx.shadowColor = `rgba(255, 190, 46, ${0.98 * alpha})`;
  ctx.shadowBlur = 24;
  ctx.strokeStyle = `rgba(255, 196, 54, ${0.88 * alpha})`;
  ctx.lineWidth = 10.5;
  strokePolyline(ctx, boltData.mainBolt, strikeProgress);

  ctx.shadowBlur = 10;
  ctx.strokeStyle = `rgba(255, 240, 150, ${0.95 * alpha})`;
  ctx.lineWidth = 5.4;
  strokePolyline(ctx, boltData.mainBolt, strikeProgress);

  ctx.shadowBlur = 0;
  ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
  ctx.lineWidth = 2.6;
  strokePolyline(ctx, boltData.mainBolt, strikeProgress);

  // Impact flash, shockwave ring & electric sparks on target monster zone
  if (impactT > 0) {
    const impactAlpha = Math.max(0, (1 - easeOutCubic(impactT)) * (progress < 0.72 ? 1 : fadeOut));
    const impactRadius = 26 + easeOutCubic(impactT) * 78;

    const flash = ctx.createRadialGradient(targetX, targetY, 2, targetX, targetY, impactRadius);
    flash.addColorStop(0, `rgba(255, 255, 255, ${0.96 * impactAlpha})`);
    flash.addColorStop(0.28, `rgba(255, 234, 128, ${0.82 * impactAlpha})`);
    flash.addColorStop(0.62, `rgba(255, 152, 32, ${0.38 * impactAlpha})`);
    flash.addColorStop(1, 'rgba(255, 120, 0, 0)');
    ctx.fillStyle = flash;
    ctx.beginPath();
    ctx.arc(targetX, targetY, impactRadius, 0, TAU);
    ctx.fill();

    // Expanding shockwave ring
    const ringRadius = 14 + easeOutCubic(impactT) * 68;
    ctx.strokeStyle = `rgba(255, 242, 166, ${0.9 * impactAlpha})`;
    ctx.lineWidth = 3 * (1 - impactT * 0.7);
    ctx.beginPath();
    ctx.arc(targetX, targetY, ringRadius, 0, TAU);
    ctx.stroke();

    // Electric discharge sparks
    for (const sp of boltData.sparks) {
      const dist = 8 + easeOutCubic(impactT) * sp.speed;
      const sx = targetX + Math.cos(sp.angle) * dist;
      const sy = targetY + Math.sin(sp.angle) * dist * 0.75;
      ctx.fillStyle = `rgba(255, 248, 196, ${impactAlpha})`;
      ctx.beginPath();
      ctx.arc(sx, sy, sp.size, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

export async function playSliferLightningMotion(board, targetZone, { duration = 880 } = {}) {
  if (!board || !targetZone) return;
  const reduceMotion = Boolean(
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  if (reduceMotion) return;

  const boardRect = board.getBoundingClientRect();
  const targetRect = targetZone.getBoundingClientRect();
  if (!boardRect.width || !boardRect.height || !targetRect.width || !targetRect.height) return;

  const width = Math.max(1, Math.round(boardRect.width));
  const height = Math.max(1, Math.round(boardRect.height));
  const targetX = targetRect.left - boardRect.left + targetRect.width * 0.5;
  const targetY = targetRect.top - boardRect.top + targetRect.height * 0.5;

  const layer = document.createElement('div');
  layer.className = 'duel-slifer-lightning-layer';
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, {
    position: 'absolute',
    inset: '0',
    zIndex: '1205',
    pointerEvents: 'none',
    overflow: 'hidden'
  });

  const displayCanvas = document.createElement('canvas');
  Object.assign(displayCanvas.style, {
    width: '100%',
    height: '100%',
    display: 'block',
    pointerEvents: 'none'
  });
  layer.appendChild(displayCanvas);
  board.appendChild(layer);

  const boltCanvas = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  boltCanvas.width = Math.round(width * dpr);
  boltCanvas.height = Math.round(height * dpr);
  const boltCtx = boltCanvas.getContext('2d');
  if (boltCtx) boltCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  let boltData = createLightningData(width, height, targetX, targetY);
  let lastJitterStep = 0;
  let impactShakeTriggered = false;
  let shakeAnim = null;

  let THREE = null;
  const importMap = document.querySelector('script[type="importmap"]');
  const threeUrl = importMap
    ? JSON.parse(importMap.textContent || '{}').imports?.three
    : null;
  if (threeUrl) {
    try {
      THREE = await import(/* @vite-ignore */ threeUrl);
    } catch (_error) {
      THREE = null;
    }
  }

  let renderer = null;
  let scene = null;
  let camera = null;
  let texture = null;
  let impactUniforms = null;
  const disposables = [];

  if (THREE) {
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: displayCanvas,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance'
      });
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);
      scene = new THREE.Scene();
      camera = new THREE.OrthographicCamera(0, width, height, 0, 0.1, 10);
      camera.position.z = 5;

      texture = new THREE.CanvasTexture(boltCanvas);
      texture.colorSpace = THREE.SRGBColorSpace || undefined;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      disposables.push(texture);

      const planeGeo = new THREE.PlaneGeometry(width, height);
      const planeMat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const boltMesh = new THREE.Mesh(planeGeo, planeMat);
      boltMesh.position.set(width * 0.5, height * 0.5, 0.5);
      scene.add(boltMesh);
      disposables.push(planeGeo, planeMat);

      // Additive Three.js shader halo at the impact point
      impactUniforms = {
        uIntensity: { value: 0 },
        uTime: { value: 0 }
      };
      const haloGeo = new THREE.PlaneGeometry(240, 240);
      const haloMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: impactUniforms,
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec2 vUv;
          uniform float uIntensity;
          uniform float uTime;
          void main() {
            vec2 c = (vUv - 0.5) * 2.0;
            float dist = length(c);
            float ang = atan(c.y, c.x);
            float rays = pow(max(0.0, sin(ang * 12.0 + uTime * 18.0) * 0.5 + 0.5), 3.0);
            float core = 1.0 - smoothstep(0.0, 0.75, dist);
            float glow = (core * 0.65 + rays * (1.0 - smoothstep(0.1, 0.95, dist)) * 0.5) * uIntensity;
            vec3 col = mix(vec3(1.0, 0.72, 0.14), vec3(1.0, 1.0, 0.92), core);
            gl_FragColor = vec4(col, clamp(glow, 0.0, 0.95));
          }
        `
      });
      const haloMesh = new THREE.Mesh(haloGeo, haloMat);
      haloMesh.position.set(targetX, height - targetY, 0.3);
      scene.add(haloMesh);
      disposables.push(haloGeo, haloMat);
    } catch (_error) {
      renderer = null;
    }
  }

  if (!renderer) {
    displayCanvas.width = boltCanvas.width;
    displayCanvas.height = boltCanvas.height;
  }

  await new Promise((resolve) => {
    const startTime = performance.now();
    const tick = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);

      // Trigger board impact shake only when the descending bolt reaches the target zone.
      if (!impactShakeTriggered && progress >= SLIFER_LIGHTNING_IMPACT_PROGRESS) {
        impactShakeTriggered = true;
        const shakeDuration = Math.min(
          420,
          Math.max(180, Math.round(duration * (1 - SLIFER_LIGHTNING_IMPACT_PROGRESS) * 0.62))
        );
        shakeAnim = board?.animate?.(
          [
            { transform: 'translate3d(0, 0, 0)' },
            { transform: 'translate3d(-7px, 5px, 0)', offset: 0.14 },
            { transform: 'translate3d(7px, -5px, 0)', offset: 0.28 },
            { transform: 'translate3d(-5px, -3px, 0)', offset: 0.44 },
            { transform: 'translate3d(4px, 3px, 0)', offset: 0.62 },
            { transform: 'translate3d(-2px, 1px, 0)', offset: 0.8 },
            { transform: 'translate3d(0, 0, 0)' }
          ],
          { duration: shakeDuration, easing: 'ease-out' }
        );
      }

      // Re-jitter lightning silhouette every ~70ms while active for crisp electric crackle.
      const jitterStep = Math.floor(elapsed / 70);
      if (jitterStep !== lastJitterStep && progress >= SLIFER_LIGHTNING_IMPACT_PROGRESS && progress < 0.72) {
        lastJitterStep = jitterStep;
        boltData = createLightningData(width, height, targetX, targetY);
      }

      if (boltCtx) {
        drawLightningFrame(boltCtx, width, height, targetX, targetY, boltData, progress);
      }

      if (renderer && scene && camera && texture) {
        texture.needsUpdate = true;
        if (impactUniforms) {
          const hitActive = progress >= SLIFER_LIGHTNING_IMPACT_PROGRESS
            ? Math.max(
              0,
              1 - (progress - SLIFER_LIGHTNING_IMPACT_PROGRESS) / (1 - SLIFER_LIGHTNING_IMPACT_PROGRESS)
            )
            : 0;
          impactUniforms.uIntensity.value = hitActive;
          impactUniforms.uTime.value = elapsed / 1000;
        }
        renderer.render(scene, camera);
      } else {
        const ctx2d = displayCanvas.getContext('2d');
        if (ctx2d) {
          ctx2d.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
          ctx2d.drawImage(boltCanvas, 0, 0);
        }
      }

      if (progress < 1) {
        window.requestAnimationFrame(tick);
      } else {
        resolve();
      }
    };
    window.requestAnimationFrame(tick);
  });

  shakeAnim?.cancel?.();
  disposables.forEach((item) => item?.dispose?.());
  renderer?.dispose?.();
  layer.remove();
}
