const TAU = Math.PI * 2;

// 10 distinct Orichalcos glyphs matching the artwork, repeated twice around the 20-slot ring.
const ORICHALCOS_GLYPH_PATTERN = [
  'doubleArch',
  'crossedSeven',
  'crescent',
  'doubleB',
  'lambda',
  'softSeven',
  'sharpSeven',
  'spiralThree',
  'hookL',
  'doubleB'
];

function drawOrichalcosGlyph(ctx, kind) {
  ctx.beginPath();
  switch (kind) {
    case 'doubleArch':
      ctx.moveTo(0, 14);
      ctx.bezierCurveTo(-18, 8, -19, -15, -6, -15);
      ctx.bezierCurveTo(-1, -15, 0, -6, 0, -2);
      ctx.bezierCurveTo(0, -6, 1, -15, 6, -15);
      ctx.bezierCurveTo(19, -15, 18, 8, 0, 14);
      ctx.moveTo(-8, -6);
      ctx.lineTo(-5, -1);
      ctx.moveTo(8, -6);
      ctx.lineTo(5, -1);
      break;
    case 'crossedSeven':
      ctx.moveTo(-11, -13);
      ctx.lineTo(10, -13);
      ctx.lineTo(-5, 14);
      ctx.moveTo(-7, 2);
      ctx.lineTo(7, -1);
      break;
    case 'crescent':
      ctx.moveTo(8, -12);
      ctx.bezierCurveTo(-11, -12, -11, 12, 8, 12);
      ctx.moveTo(0, -14);
      ctx.lineTo(0, 14);
      ctx.moveTo(-8, -4);
      ctx.lineTo(9, 4);
      break;
    case 'doubleB':
      ctx.moveTo(-9, -14);
      ctx.lineTo(-9, 14);
      ctx.moveTo(-12, -14);
      ctx.lineTo(3, -14);
      ctx.bezierCurveTo(13, -14, 13, -1, 2, -1);
      ctx.lineTo(-9, -1);
      ctx.moveTo(2, -1);
      ctx.bezierCurveTo(14, -1, 14, 14, 2, 14);
      ctx.lineTo(-12, 14);
      break;
    case 'lambda':
      ctx.moveTo(-11, 13);
      ctx.quadraticCurveTo(0, -3, 1, -14);
      ctx.moveTo(-2, -3);
      ctx.quadraticCurveTo(4, 6, 12, 13);
      ctx.moveTo(-7, -9);
      ctx.lineTo(7, -12);
      break;
    case 'softSeven':
      ctx.moveTo(-10, -10);
      ctx.quadraticCurveTo(0, -15, 9, -8);
      ctx.quadraticCurveTo(2, 2, -3, 14);
      ctx.moveTo(-7, 13);
      ctx.lineTo(4, 13);
      break;
    case 'sharpSeven':
      ctx.moveTo(-10, -13);
      ctx.lineTo(9, -11);
      ctx.lineTo(-4, 14);
      ctx.moveTo(-12, -8);
      ctx.lineTo(-8, -14);
      break;
    case 'spiralThree':
      ctx.moveTo(-9, -12);
      ctx.bezierCurveTo(12, -15, 12, -2, -2, -1);
      ctx.bezierCurveTo(13, 0, 13, 14, -9, 13);
      break;
    case 'hookL':
    default:
      ctx.moveTo(-8, -14);
      ctx.lineTo(-8, 12);
      ctx.lineTo(10, 12);
      ctx.moveTo(-12, -11);
      ctx.lineTo(-5, -14);
      break;
  }
  ctx.stroke();
}

function drawNeonStroke(ctx, drawFn, width) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.shadowColor = 'rgba(18, 255, 136, 0.9)';
  ctx.shadowBlur = 12;
  ctx.strokeStyle = 'rgba(22, 245, 130, 0.8)';
  ctx.lineWidth = width * 1.85;
  drawFn();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#7affbf';
  ctx.lineWidth = width * 1.15;
  drawFn();

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(2, width * 0.7);
  drawFn();
  ctx.restore();
}

function lerpPoint(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function drawSegmentProgress(ctx, p1, p2, progress, fromMidpoint = false) {
  const clamped = Math.max(0, Math.min(1, progress));
  if (clamped <= 0) return;
  if (fromMidpoint) {
    const mid = lerpPoint(p1, p2, 0.5);
    const start = lerpPoint(mid, p1, clamped);
    const end = lerpPoint(mid, p2, clamped);
    ctx.beginPath();
    ctx.moveTo(start[0], start[1]);
    ctx.lineTo(end[0], end[1]);
    ctx.stroke();
    return;
  }
  const end = lerpPoint(p1, p2, clamped);
  ctx.beginPath();
  ctx.moveTo(p1[0], p1[1]);
  ctx.lineTo(end[0], end[1]);
  ctx.stroke();
}

function createStaticRingCache(size) {
  const cache = document.createElement('canvas');
  cache.width = size;
  cache.height = size;
  const ctx = cache.getContext('2d');
  if (!ctx) return cache;

  const cx = size / 2;
  const cy = size / 2;
  const outerR = size * 0.455;
  const innerR = size * 0.376;
  const glyphR = (outerR + innerR) / 2;

  drawNeonStroke(
    ctx,
    () => {
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, innerR, 0, TAU);
      ctx.stroke();
    },
    size * 0.0085
  );

  const glyphScale = (outerR - innerR) * 0.0235;
  for (let i = 0; i < 20; i += 1) {
    const angle = -Math.PI / 2 + (i / 20) * TAU;
    const gx = cx + Math.cos(angle) * glyphR;
    const gy = cy + Math.sin(angle) * glyphR;
    const kind = ORICHALCOS_GLYPH_PATTERN[i % ORICHALCOS_GLYPH_PATTERN.length];
    ctx.save();
    ctx.translate(gx, gy);
    ctx.rotate(angle + Math.PI / 2);
    ctx.scale(glyphScale, glyphScale);
    drawNeonStroke(
      ctx,
      () => drawOrichalcosGlyph(ctx, kind),
      (2.6 / glyphScale) * (size / 1024)
    );
    ctx.restore();
  }

  return cache;
}

function drawOrichalcosSealCanvas(canvas, ringCache, progress) {
  const size = canvas.width;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const cx = size / 2;
  const cy = size / 2;
  const innerR = size * 0.376;

  ctx.clearRect(0, 0, size, size);

  // Subtle emerald inner aura once hexagram completes.
  if (progress.hexComplete > 0) {
    const aura = ctx.createRadialGradient(cx, cy, innerR * 0.06, cx, cy, innerR);
    aura.addColorStop(0, 'rgba(170, 255, 215, 0.22)');
    aura.addColorStop(0.55, 'rgba(24, 214, 118, 0.12)');
    aura.addColorStop(1, 'rgba(0, 60, 30, 0)');
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, TAU);
    ctx.fill();
  }

  // Blit pre-rendered static outer rings + 20 glyphs (zero per-frame shadowBlur cost).
  ctx.drawImage(ringCache, 0, 0);

  const vertices = Array.from({ length: 6 }, (_, idx) => {
    const ang = -Math.PI / 2 + (idx * Math.PI) / 3;
    return [cx + Math.cos(ang) * innerR, cy + Math.sin(ang) * innerR];
  });

  const { p1, p2, p3 } = progress;
  if (p1 > 0 || p2 > 0 || p3 > 0) {
    const center = [cx, cy];
    drawNeonStroke(
      ctx,
      () => {
        if (p1 > 0) {
          // Stage 1: V0 (12h) -> V2 (4h) and V3 (6h) -> V5 (10h).
          drawSegmentProgress(ctx, vertices[0], vertices[2], p1, false);
          drawSegmentProgress(ctx, vertices[3], vertices[5], p1, false);
        }
        if (p2 > 0) {
          // Stage 2a: Two symmetric strokes from V5 (10h) and V2 (4h) converge at center.
          const inwardT = Math.min(1, p2 / 0.52);
          drawSegmentProgress(ctx, vertices[5], center, inwardT, false);
          drawSegmentProgress(ctx, vertices[2], center, inwardT, false);

          // Stage 2b: From center, cross stroke expands symmetrically out to V4 (8h) and V1 (2h).
          const centerCrossProgress = Math.max(0, Math.min(1, (p2 - 0.44) / 0.56));
          if (centerCrossProgress > 0) {
            drawSegmentProgress(ctx, vertices[4], vertices[1], centerCrossProgress, true);
          }
        }
        if (p3 > 0) {
          // Stage 3: Closing strokes continue directly from V1 -> V3 (2h -> 6h) and V4 -> V0 (8h -> 12h).
          drawSegmentProgress(ctx, vertices[1], vertices[3], p3, false);
          drawSegmentProgress(ctx, vertices[4], vertices[0], p3, false);
        }
      },
      size * 0.0085
    );
  }
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

export async function mountOrichalcosBoardEffect(board) {
  if (!board) return { destroy() {} };

  board.querySelectorAll('.duel-orichalcos-layer, .duel-orichalcos-bg-layer').forEach((el) => el.remove());
  board.classList.add('has-orichalcos');

  const reduceMotion = Boolean(
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  const layer = document.createElement('div');
  layer.className = 'duel-orichalcos-layer';
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, {
    position: 'absolute',
    inset: '0',
    zIndex: '1',
    pointerEvents: 'none',
    overflow: 'hidden'
  });

  const glCanvas = document.createElement('canvas');
  Object.assign(glCanvas.style, {
    width: '100%',
    height: '100%',
    display: 'block',
    pointerEvents: 'none'
  });
  layer.appendChild(glCanvas);
  board.appendChild(layer);

  const sealCanvas = document.createElement('canvas');
  sealCanvas.width = 1024;
  sealCanvas.height = 1024;
  const ringCache = createStaticRingCache(1024);

  const importMap = document.querySelector('script[type="importmap"]');
  const threeUrl = importMap
    ? JSON.parse(importMap.textContent || '{}').imports?.three
    : null;

  let THREE = null;
  if (threeUrl) {
    try {
      THREE = await import(/* @vite-ignore */ threeUrl);
    } catch (error) {
      console.warn('Không tải được Three.js cho Phong Ấn Orichalcos, dùng Canvas 2D:', error);
    }
  }

  let destroyed = false;
  let rafId = 0;

  const computeTimeline = (elapsedSec) => {
    if (reduceMotion) {
      return {
        scale: 1,
        rotation: 0,
        p1: 1,
        p2: 1,
        p3: 1,
        hexComplete: 1,
        burstIntensity: 0,
        veilOpacity: 0,
        sealOpacity: 0.9,
        underBoard: true
      };
    }

    // 0.0 -> 2.8s: Zoom in from oversized rotating ring into centered board ring (stops upright at V0=12h).
    // 2.8 -> 5.15s: Draw the 3 continuous symmetric stages of the unicursal hexagram.
    // 5.15 -> 7.5s: Volumetric emerald god-rays burst + smooth fade of veil.
    // 5.65s+: Single crisp Orichalcos seal stays on the board & rotates gently.
    const ringZoomProgress = Math.min(1, elapsedSec / 2.2);
    const scale = 1.8 - 0.8 * easeOutCubic(ringZoomProgress);

    let rotation = 0;
    if (elapsedSec < 2.8) {
      const spinProgress = easeOutCubic(elapsedSec / 2.8);
      rotation = -Math.PI * 1.15 * (1 - spinProgress);
    } else if (elapsedSec >= 5.65) {
      // Smooth quadratic velocity ramp so rotation starts seamlessly with zero jerk.
      const dt = elapsedSec - 5.65;
      const ramp = Math.min(1, dt / 1.2);
      const effectiveT = dt < 1.2 ? 0.5 * ramp * dt : dt - 0.6;
      rotation = -effectiveT * 0.06;
    }

    const p1 = Math.max(0, Math.min(1, (elapsedSec - 2.8) / 0.78));
    const p2 = Math.max(0, Math.min(1, (elapsedSec - 3.58) / 0.85));
    const p3 = Math.max(0, Math.min(1, (elapsedSec - 4.43) / 0.72));
    const hexComplete = p3 >= 1 ? 1 : 0;

    let burstIntensity = 0;
    if (elapsedSec >= 5.2 && elapsedSec < 7.5) {
      if (elapsedSec < 5.6) {
        burstIntensity = easeOutCubic((elapsedSec - 5.2) / 0.4);
      } else {
        burstIntensity = 1 - easeInOutQuad((elapsedSec - 5.6) / 1.9);
      }
    }

    const veilFadeT = Math.max(0, Math.min(1, (elapsedSec - 5.6) / 1.45));
    const veilSmooth = easeInOutQuad(veilFadeT);
    const veilOpacity = Math.max(0, 0.45 * (1 - veilSmooth) + burstIntensity * 0.14);

    const settled = elapsedSec >= 5.65;
    const pulse = settled ? 0.04 * Math.sin((elapsedSec - 5.65) * 2.1) : 0;
    const sealOpacity = settled ? 0.92 + pulse : 0.98;

    return {
      scale,
      rotation,
      p1,
      p2,
      p3,
      hexComplete,
      burstIntensity,
      veilOpacity,
      sealOpacity,
      underBoard: settled
    };
  };

  let renderer = null;
  let scene = null;
  let camera = null;
  let sealTexture = null;
  let sealMesh = null;
  let veilMesh = null;
  let rayMesh = null;
  let rayUniforms = null;
  let sparksPoints = null;
  let sparksGeo = null;
  let resizeObserver = null;
  const disposables = [];

  const SEAL_Y_OFFSET = 0.05;
  const SEAL_SIZE_MULTIPLIER = 1.02;

  const updateViewportSize = () => {
    const w = Math.max(1, board.clientWidth || window.innerWidth || 960);
    const h = Math.max(1, board.clientHeight || window.innerHeight || 640);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const aspect = w / h;
    const halfH = 1;
    const halfW = halfH * aspect;
    const baseDiameter = Math.min(halfW * 2, halfH * 2) * SEAL_SIZE_MULTIPLIER;

    if (renderer && camera) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      camera.left = -halfW;
      camera.right = halfW;
      camera.top = halfH;
      camera.bottom = -halfH;
      camera.updateProjectionMatrix();
      if (sealMesh) sealMesh.scale.set(baseDiameter, baseDiameter, 1);
      if (rayMesh) rayMesh.scale.set(baseDiameter * 1.48, baseDiameter * 1.48, 1);
      if (veilMesh) veilMesh.scale.set(halfW * 2.2, halfH * 2.2, 1);
    } else {
      glCanvas.width = Math.round(w * dpr);
      glCanvas.height = Math.round(h * dpr);
    }
  };

  if (THREE) {
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: glCanvas,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance'
      });
      scene = new THREE.Scene();
      camera = new THREE.OrthographicCamera(-1.5, 1.5, 1, -1, 0.1, 10);
      camera.position.z = 5;

      const planeGeo = new THREE.PlaneGeometry(1, 1);
      disposables.push(planeGeo);

      const veilMat = new THREE.MeshBasicMaterial({
        color: 0x02140a,
        transparent: true,
        opacity: 0.45,
        depthWrite: false
      });
      veilMesh = new THREE.Mesh(planeGeo, veilMat);
      veilMesh.position.z = 0.1;
      scene.add(veilMesh);
      disposables.push(veilMat);

      drawOrichalcosSealCanvas(sealCanvas, ringCache, {
        p1: 0,
        p2: 0,
        p3: 0,
        hexComplete: 0
      });
      sealTexture = new THREE.CanvasTexture(sealCanvas);
      sealTexture.colorSpace = THREE.SRGBColorSpace || undefined;
      sealTexture.minFilter = THREE.LinearFilter;
      sealTexture.magFilter = THREE.LinearFilter;
      disposables.push(sealTexture);

      // Additive Volumetric Radial God-Rays shader (matches frames 14-18 in video)
      rayUniforms = {
        uIntensity: { value: 0 },
        uTime: { value: 0 }
      };
      const rayMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: rayUniforms,
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
            vec2 centered = (vUv - 0.5) * 2.0;
            float dist = length(centered);
            float angle = atan(centered.y, centered.x);
            float rayA = pow(max(0.0, sin(angle * 24.0 + uTime * 0.8) * 0.5 + 0.5), 3.0);
            float rayB = pow(max(0.0, cos(angle * 16.0 - uTime * 0.5) * 0.5 + 0.5), 4.0);
            float rays = mix(0.25, 1.0, rayA * 0.65 + rayB * 0.35);
            float ringZone = smoothstep(0.25, 0.56, dist) * (1.0 - smoothstep(0.62, 0.98, dist));
            float coreGlow = (1.0 - smoothstep(0.0, 0.72, dist)) * 0.38;
            float alpha = (ringZone * rays + coreGlow) * uIntensity;
            vec3 col = mix(vec3(0.06, 0.92, 0.45), vec3(0.82, 1.0, 0.9), ringZone * rayA * 0.7 + coreGlow);
            gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.95));
          }
        `
      });
      rayMesh = new THREE.Mesh(planeGeo, rayMat);
      rayMesh.position.set(0, SEAL_Y_OFFSET, 0.25);
      scene.add(rayMesh);
      disposables.push(rayMat);

      const sealMat = new THREE.MeshBasicMaterial({
        map: sealTexture,
        transparent: true,
        opacity: 0.98,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      sealMesh = new THREE.Mesh(planeGeo, sealMat);
      sealMesh.position.set(0, SEAL_Y_OFFSET, 0.5);
      scene.add(sealMesh);
      disposables.push(sealMat);

      // Ambient emerald mana particles
      const sparkCount = 36;
      const positions = new Float32Array(sparkCount * 3);
      for (let i = 0; i < sparkCount; i += 1) {
        positions[i * 3] = (Math.random() - 0.5) * 2.6;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 1.9;
        positions[i * 3 + 2] = 0.6;
      }
      sparksGeo = new THREE.BufferGeometry();
      sparksGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const sparksMat = new THREE.PointsMaterial({
        color: 0x6dffb4,
        size: 6,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      sparksPoints = new THREE.Points(sparksGeo, sparksMat);
      scene.add(sparksPoints);
      disposables.push(sparksGeo, sparksMat);
    } catch (error) {
      console.warn('WebGL không khả dụng cho Phong Ấn Orichalcos, chuyển sang Canvas 2D:', error);
      renderer = null;
    }
  }

  updateViewportSize();
  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(updateViewportSize);
    resizeObserver.observe(board);
  } else {
    window.addEventListener('resize', updateViewportSize);
  }

  const startTime = performance.now();
  let lastCanvasKey = '';

  const renderLoop = (now) => {
    if (destroyed) return;
    const elapsedSec = Math.max(0, (now - startTime) / 1000);
    const tl = computeTimeline(elapsedSec);

    const canvasKey = `${tl.p1.toFixed(3)}|${tl.p2.toFixed(3)}|${tl.p3.toFixed(3)}|${tl.hexComplete}`;
    if (canvasKey !== lastCanvasKey) {
      lastCanvasKey = canvasKey;
      drawOrichalcosSealCanvas(sealCanvas, ringCache, tl);
      if (sealTexture) sealTexture.needsUpdate = true;
    }

    if (renderer && scene && camera) {
      const w = Math.max(1, board.clientWidth || 960);
      const h = Math.max(1, board.clientHeight || 640);
      const halfH = 1;
      const halfW = halfH * (w / h);
      const baseDiameter = Math.min(halfW * 2, halfH * 2) * SEAL_SIZE_MULTIPLIER;
      const scaledSize = baseDiameter * tl.scale;

      if (veilMesh) veilMesh.material.opacity = tl.veilOpacity;
      if (sealMesh) {
        sealMesh.scale.set(scaledSize, scaledSize, 1);
        sealMesh.rotation.z = tl.rotation;
        sealMesh.material.opacity = tl.sealOpacity;
      }
      if (rayMesh && rayUniforms) {
        rayMesh.scale.set(scaledSize * 1.48, scaledSize * 1.48, 1);
        rayUniforms.uIntensity.value = tl.burstIntensity + (tl.underBoard ? 0.05 : 0);
        rayUniforms.uTime.value = elapsedSec;
      }
      if (sparksPoints && sparksGeo) {
        const pos = sparksGeo.attributes.position.array;
        for (let i = 1; i < pos.length; i += 3) {
          pos[i] += 0.0022;
          if (pos[i] > 1.05) pos[i] = -1.05;
        }
        sparksGeo.attributes.position.needsUpdate = true;
        sparksPoints.material.opacity = tl.underBoard ? 0.28 : 0.48;
      }
      renderer.render(scene, camera);
    } else {
      const ctx2d = glCanvas.getContext('2d');
      if (ctx2d) {
        const cw = glCanvas.width;
        const ch = glCanvas.height;
        ctx2d.clearRect(0, 0, cw, ch);
        if (tl.veilOpacity > 0.001) {
          ctx2d.fillStyle = `rgba(2, 20, 10, ${tl.veilOpacity})`;
          ctx2d.fillRect(0, 0, cw, ch);
        }
        const drawDiameter = Math.min(cw, ch) * SEAL_SIZE_MULTIPLIER * tl.scale;
        ctx2d.save();
        ctx2d.globalAlpha = tl.sealOpacity;
        ctx2d.translate(cw / 2, ch * (0.5 - SEAL_Y_OFFSET * 0.5));
        ctx2d.rotate(-tl.rotation);
        ctx2d.drawImage(
          sealCanvas,
          -drawDiameter / 2,
          -drawDiameter / 2,
          drawDiameter,
          drawDiameter
        );
        ctx2d.restore();
      }
    }

    rafId = window.requestAnimationFrame(renderLoop);
  };

  rafId = window.requestAnimationFrame(renderLoop);

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (rafId) window.cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      if (!resizeObserver) window.removeEventListener('resize', updateViewportSize);
      disposables.forEach((item) => item?.dispose?.());
      renderer?.dispose?.();
      layer.remove();
      board.classList.remove('has-orichalcos');
    }
  };
}
