let Euler;
let Group;
let PerspectiveCamera;
let Quaternion;
let Scene;
let Vector3;
let CSS3DObject;
let CSS3DRenderer;
let threeLoadPromise;

async function ensureThreeLoaded() {
  if (!threeLoadPromise) {
    threeLoadPromise = (async () => {
      const importMapNode = document.querySelector('script[type="importmap"]');
      if (!importMapNode) throw new Error('The Three.js import map is unavailable.');
      const imports = JSON.parse(importMapNode.textContent).imports || {};
      const threeUrl = imports.three;
      const addonsUrl = imports['three/addons/'];
      if (!threeUrl || !addonsUrl) throw new Error('The Three.js import map is incomplete.');
      const three = await import(/* @vite-ignore */ threeUrl);
      const css3d = await import(/* @vite-ignore */ `${addonsUrl}renderers/CSS3DRenderer.js`);
      ({ Euler, Group, PerspectiveCamera, Quaternion, Scene, Vector3 } = three);
      ({ CSS3DObject, CSS3DRenderer } = css3d);
      LIGHT_DIRECTION = new Vector3(-0.42, 0.58, 0.7).normalize();
      VIEW_DIRECTION = new Vector3(0, 0, 1);
    })();
  }
  await threeLoadPromise;
}

export function preloadCard3DViewer() {
  return ensureThreeLoaded();
}

  const CARD_BACK_WIDTH = 265;
  const CARD_BACK_HEIGHT = 357;
  const CARD_DEPTH = 8;
  let LIGHT_DIRECTION;
  let VIEW_DIRECTION;
  const CARD_ROTATION_ORDER = 'XYZ';

  function makeFace(element, width, height) {
    element.style.width = width + 'px';
    element.style.height = height + 'px';
    element.style.boxSizing = 'border-box';
    element.style.backfaceVisibility = 'hidden';
    element.style.webkitBackfaceVisibility = 'hidden';
    element.dataset.card3dSurface = 'true';
    return new CSS3DObject(element);
  }

  function makeEdge(width, height, rotation, position, normal) {
    const element = document.createElement('div');
    element.className = 'shop-reveal__3d-edge';
    element.style.width = width + 'px';
    element.style.height = height + 'px';
    const reflection = document.createElement('span');
    reflection.className = 'shop-reveal__3d-edge-highlight';
    reflection.setAttribute('aria-hidden', 'true');
    element.appendChild(reflection);
    const edge = new CSS3DObject(element);
    edge.rotation.set(rotation.x, rotation.y, rotation.z);
    edge.position.set(position.x, position.y, position.z);
    edge.userData.reflection = reflection;
    edge.userData.normal = new Vector3(normal.x, normal.y, normal.z);
    return edge;
  }

  function makeLightReflection(parent) {
    const reflection = document.createElement('div');
    reflection.className = 'shop-reveal__3d-reflection';
    reflection.setAttribute('aria-hidden', 'true');
    const hologram = document.createElement('div');
    hologram.className = 'shop-reveal__3d-hologram';
    hologram.setAttribute('aria-hidden', 'true');
    reflection.appendChild(hologram);
    parent.appendChild(reflection);
    return reflection;
  }

  function copyCanvasContents(source, target) {
    const sourceCanvases = source.querySelectorAll('canvas');
    const targetCanvases = target.querySelectorAll('canvas');
    sourceCanvases.forEach(function (sourceCanvas, index) {
      const targetCanvas = targetCanvases[index];
      if (!targetCanvas) return;
      targetCanvas.width = sourceCanvas.width;
      targetCanvas.height = sourceCanvas.height;
      const context = targetCanvas.getContext('2d');
      if (!context) throw new Error('Canvas 2D is not available for the 3D card face.');
      context.drawImage(sourceCanvas, 0, 0);
    });
  }

  function makeBackCanvas(width, height, stage, drawCardBack) {
    const source = document.createElement('canvas');
    source.className = 'card__back-canvas';
    source.style.width = CARD_BACK_WIDTH + 'px';
    source.style.height = CARD_BACK_HEIGHT + 'px';
    source.style.position = 'absolute';
    source.style.left = '-10000px';
    stage.appendChild(source);
    try {
      drawCardBack(source);
    } finally {
      source.remove();
    }

    const canvas = document.createElement('canvas');
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(width * pixelRatio));
    canvas.height = Math.max(1, Math.round(height * pixelRatio));
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    canvas.className = 'shop-reveal__3d-back-canvas';
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is not available for the card back.');
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  export async function createCard3DViewer(options) {
    await ensureThreeLoaded();
    const stage = options.stage;
    const width = options.width;
    const height = options.height;
    if (!stage || !options.cardFace || !width || !height) {
      throw new Error('The 3D card viewer needs a visible card face and stage.');
    }
    if (typeof options.drawCardBack !== 'function') {
      throw new Error('The card-back renderer is not available.');
    }

    const scene = new Scene();
    const camera = new PerspectiveCamera(36, 1, 1, 3000);
    const card = new Group();
    const renderer = new CSS3DRenderer();
    let zoomFactor = 1;
    let frame = 0;
    let pointerId = null;
    let lastX = 0;
    let lastY = 0;
    let dragged = false;
    let downSurface = false;
    let resizeObserver = null;
    let destroyed = false;
    let reflectionDirty = true;
    let refreshedCardFace = false;

    const frontFace = options.cardFace.cloneNode(true);
    copyCanvasContents(options.cardFace, frontFace);
    frontFace.classList.add('shop-reveal__3d-front-face');
    frontFace.style.maxWidth = 'none';
    frontFace.style.aspectRatio = 'auto';
    const frontReflection = makeLightReflection(frontFace);
    const entryFlash = document.createElement('div');
    entryFlash.className = 'shop-reveal__3d-transition-flash';
    entryFlash.setAttribute('aria-hidden', 'true');
    frontFace.appendChild(entryFlash);
    const front = makeFace(frontFace, width, height);
    front.position.z = CARD_DEPTH / 2;
    card.add(front);

    const backFace = document.createElement('div');
    backFace.className = 'shop-reveal__3d-back-face';
    backFace.style.width = width + 'px';
    backFace.style.height = height + 'px';
    backFace.style.boxSizing = 'border-box';
    backFace.style.backfaceVisibility = 'hidden';
    backFace.style.webkitBackfaceVisibility = 'hidden';
    backFace.dataset.card3dSurface = 'true';
    backFace.appendChild(makeBackCanvas(width, height, stage, options.drawCardBack));
    const backReflection = makeLightReflection(backFace);
    const back = new CSS3DObject(backFace);
    back.position.z = -CARD_DEPTH / 2;
    back.rotation.y = Math.PI;
    card.add(back);

    const edgeColor = 'linear-gradient(90deg, #433516, #ebd28a 23%, #8a6c2c 51%, #f7e6ad 76%, #4a391b)';
    const edges = [
      makeEdge(CARD_DEPTH, height, { x: 0, y: Math.PI / 2, z: 0 },
        { x: width / 2, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }),
      makeEdge(CARD_DEPTH, height, { x: 0, y: -Math.PI / 2, z: 0 },
        { x: -width / 2, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }),
      makeEdge(width, CARD_DEPTH, { x: -Math.PI / 2, y: 0, z: 0 },
        { x: 0, y: height / 2, z: 0 }, { x: 0, y: 1, z: 0 }),
      makeEdge(width, CARD_DEPTH, { x: Math.PI / 2, y: 0, z: 0 },
        { x: 0, y: -height / 2, z: 0 }, { x: 0, y: -1, z: 0 })
    ];
    edges.forEach(function (edge) {
      edge.element.style.setProperty('--card-edge-color', edgeColor);
      card.add(edge);
    });

    scene.add(card);
    renderer.setSize(stage.clientWidth, stage.clientHeight);
    renderer.domElement.className = 'shop-reveal__3d-renderer';
    renderer.domElement.style.overflow = 'visible';
    stage.replaceChildren(renderer.domElement);

    function updateSize() {
      if (destroyed) return;
      const stageWidth = stage.clientWidth;
      const stageHeight = stage.clientHeight;
      if (!stageWidth || !stageHeight) return;
      camera.aspect = stageWidth / stageHeight;
      const perspectiveDistance = stageHeight / (2 * Math.tan(camera.fov * Math.PI / 360));
      camera.position.set(0, 0, perspectiveDistance * zoomFactor);
      camera.lookAt(0, 0, 0);
      card.scale.setScalar(Math.min(1, (stageWidth - 20) / width, (stageHeight - 12) / height));
      renderer.setSize(stageWidth, stageHeight);
    }

    function render() {
      if (destroyed) return;
      if (reflectionDirty) {
        updateLightReflection();
        reflectionDirty = false;
      }
      renderer.render(scene, camera);
      if (!refreshedCardFace && typeof options.refreshCardFace === 'function') {
        options.refreshCardFace(frontFace);
        refreshedCardFace = true;
      }
      frame = window.requestAnimationFrame(render);
    }

    function updateLightReflection() {
      const rotation = new Euler(card.rotation.x, card.rotation.y, card.rotation.z, CARD_ROTATION_ORDER);
      const inverseRotation = new Quaternion().setFromEuler(rotation).invert();
      const localLight = LIGHT_DIRECTION.clone().applyQuaternion(inverseRotation).normalize();
      const localView = VIEW_DIRECTION.clone().applyQuaternion(inverseRotation).normalize();
      const localHalf = localLight.clone().add(localView).normalize();
      const worldHalf = LIGHT_DIRECTION.clone().add(VIEW_DIRECTION).normalize();
      const frontNormal = new Vector3(0, 0, 1);
      const backNormal = new Vector3(0, 0, -1);

      [
        { element: frontReflection, normal: frontNormal, side: 1 },
        { element: backReflection, normal: backNormal, side: -1 }
      ].forEach(function (surface) {
        const viewDot = Math.max(-1, Math.min(1, surface.normal.dot(localView)));
        const lightDot = Math.max(0, surface.normal.dot(localLight));
        const specular = Math.pow(Math.max(0, surface.normal.dot(localHalf)), 12) * lightDot;
        const fresnel = Math.pow(1 - Math.abs(viewDot), 1.25) * lightDot;
        const strength = Math.min(0.66, specular * 0.72 + fresnel * 0.28);
        const x = 50 + surface.side * localHalf.x * 44;
        const y = 50 - surface.side * localHalf.y * 44;
        const angle = Math.atan2(localLight.y, localLight.x) * 180 / Math.PI + 90;
        const phase = (50 + Math.atan2(localLight.x, localLight.y) * 50 / Math.PI + 100) % 100;
        const holoStrength = Math.min(0.42, (specular * 0.5 + fresnel * 0.38) *
          (0.72 + Math.min(1, Math.hypot(localLight.x, localLight.y)) * 0.28));
        surface.element.style.setProperty('--shine-x', x + '%');
        surface.element.style.setProperty('--shine-y', y + '%');
        surface.element.style.setProperty('--shine-angle', angle + 'deg');
        surface.element.style.setProperty('--shine-strength', String(strength));
        surface.element.style.setProperty('--holo-phase', phase + '%');
        surface.element.style.setProperty('--holo-strength', String(holoStrength));
      });

      edges.forEach(function (edge) {
        const normal = edge.userData.normal.clone().applyEuler(rotation).normalize();
        const viewFacing = Math.max(0, normal.dot(VIEW_DIRECTION));
        const lightFacing = Math.max(0, normal.dot(LIGHT_DIRECTION));
        const specular = Math.pow(Math.max(0, normal.dot(worldHalf)), 10) * lightFacing;
        const strength = Math.min(1, viewFacing * (0.16 + specular * 0.84));
        edge.element.style.setProperty('--edge-shine-strength', String(strength));
        edge.userData.reflection.style.setProperty(
          '--edge-shine-angle',
          (Math.atan2(normal.y, normal.x) * 180 / Math.PI + 90) + 'deg'
        );
        edge.userData.reflection.style.setProperty(
          '--edge-shine-position',
          String(50 + normal.dot(VIEW_DIRECTION) * 45) + '%'
        );
      });
    }

    function zoom(amount) {
      zoomFactor = Math.max(0.68, Math.min(2, zoomFactor + amount));
      updateSize();
    }

    function resetView() {
      card.rotation.set(0, 0, 0);
      reflectionDirty = true;
      zoomFactor = 1;
      updateSize();
    }

    function onPointerDown(event) {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      pointerId = event.pointerId;
      lastX = event.clientX;
      lastY = event.clientY;
      dragged = false;
      downSurface = Boolean(event.target.closest('[data-card3d-surface]'));
      stage.classList.add('is-dragging');
      stage.setPointerCapture(pointerId);
    }

    function onPointerMove(event) {
      if (pointerId !== event.pointerId) return;
      const deltaX = event.clientX - lastX;
      const deltaY = event.clientY - lastY;
      if (Math.abs(deltaX) + Math.abs(deltaY) > 2) dragged = true;
      card.rotation.y += deltaX * 0.012;
      card.rotation.x += deltaY * 0.012;
      reflectionDirty = true;
      lastX = event.clientX;
      lastY = event.clientY;
    }

    function onPointerUp(event) {
      if (pointerId !== event.pointerId) return;
      const activate = !dragged && downSurface;
      stage.classList.remove('is-dragging');
      pointerId = null;
      downSurface = false;
      if (activate && typeof options.onActivate === 'function') options.onActivate();
    }

    function onWheel(event) {
      event.preventDefault();
      zoom(event.deltaY * 0.0015);
    }

    function onKeyDown(event) {
      const rotationStep = 0.12;
      if (event.key === 'ArrowLeft') card.rotation.y -= rotationStep;
      else if (event.key === 'ArrowRight') card.rotation.y += rotationStep;
      else if (event.key === 'ArrowUp') card.rotation.x -= rotationStep;
      else if (event.key === 'ArrowDown') card.rotation.x += rotationStep;
      else if (event.key === '+' || event.key === '=') zoom(-55);
      else if (event.key === '-') zoom(55);
      else if (event.key === '0') resetView();
      else return;
      reflectionDirty = true;
      event.preventDefault();
    }

    function onZoomIn() {
      zoom(-0.12);
    }

    function onZoomOut() {
      zoom(0.12);
    }

    function onReset() {
      resetView();
    }

    function onPointerCancel(event) {
      onPointerUp(event);
    }

    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(updateSize)
      : null;
    if (observer) {
      observer.observe(stage);
      resizeObserver = observer;
    } else {
      window.addEventListener('resize', updateSize);
    }

    stage.addEventListener('pointerdown', onPointerDown);
    stage.addEventListener('pointermove', onPointerMove);
    stage.addEventListener('pointerup', onPointerUp);
    stage.addEventListener('pointercancel', onPointerCancel);
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('keydown', onKeyDown);
    options.zoomInButton.addEventListener('click', onZoomIn);
    options.zoomOutButton.addEventListener('click', onZoomOut);
    options.resetButton.addEventListener('click', onReset);

    updateSize();
    render();

    return {
      playEntryTransition: function () {
        frontFace.classList.remove('is-transitioning');
        void frontFace.offsetWidth;
        frontFace.classList.add('is-transitioning');
      },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        window.cancelAnimationFrame(frame);
        if (resizeObserver) resizeObserver.disconnect();
        else window.removeEventListener('resize', updateSize);
        stage.removeEventListener('pointerdown', onPointerDown);
        stage.removeEventListener('pointermove', onPointerMove);
        stage.removeEventListener('pointerup', onPointerUp);
        stage.removeEventListener('pointercancel', onPointerCancel);
        stage.removeEventListener('wheel', onWheel);
        stage.removeEventListener('keydown', onKeyDown);
        options.zoomInButton.removeEventListener('click', onZoomIn);
        options.zoomOutButton.removeEventListener('click', onZoomOut);
        options.resetButton.removeEventListener('click', onReset);
        stage.classList.remove('is-dragging');
        scene.clear();
        stage.replaceChildren();
      }
    };
  }
