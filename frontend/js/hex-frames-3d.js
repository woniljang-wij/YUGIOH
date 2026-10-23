import {
  AmbientLight,
  DirectionalLight,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  OrthographicCamera,
  Path,
  Scene,
  Shape,
  WebGLRenderer,
} from 'three';

(function () {
  'use strict';

  const FRAME_DEPTH = 7;

  function makeHexagon(radius) {
    const shape = new Shape();
    for (let index = 0; index < 6; index += 1) {
      const angle = (index * Math.PI) / 3;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius * Math.sqrt(3) / 2;
      if (index === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    return shape;
  }

  function makeBeveledGeometry(shape, depth, bevelSize, bevelThickness) {
    return new ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelSegments: 3,
      bevelSize,
      bevelThickness,
      curveSegments: 1,
      steps: 1,
    });
  }

  function makeRing(
    radius,
    innerRadius,
    depth,
    bevel,
    frontColor,
    sideColor,
    emissiveColor,
    metalness,
    emissiveIntensity
  ) {
    const frameShape = makeHexagon(radius);
    const innerCutout = makeHexagon(innerRadius);
    frameShape.holes.push(new Path(innerCutout.getPoints(6)));

    return new Mesh(
      makeBeveledGeometry(frameShape, depth, bevel, bevel),
      [
        new MeshPhysicalMaterial({
          color: frontColor,
          metalness,
          roughness: 0.3,
          clearcoat: 1,
          clearcoatRoughness: 0.14,
          emissive: emissiveColor,
          emissiveIntensity,
        }),
        new MeshPhysicalMaterial({
          color: sideColor,
          metalness: 0.4,
          roughness: 0.28,
          clearcoat: 0.8,
        }),
      ]
    );
  }

  function makeMetalFrame(radius) {
    const frame = new Group();
    const body = makeRing(radius, radius * 0.78, 5.4, 1.8, 0x244660, 0x071a30, 0x061729, 0.18, 0.2);
    const silverLip = makeRing(radius * 0.995, radius * 0.87, 2.8, 2.2, 0xdce9ed, 0x607a89, 0x8aa0aa, 0.04, 0.42);
    const graphiteBand = makeRing(radius * 0.9, radius * 0.81, 2, 1.5, 0x43586a, 0x1b3043, 0x102538, 0.22, 0.16);
    const cyanInset = makeRing(radius * 0.84, radius * 0.77, 1.1, 0.7, 0x2cecff, 0x08718d, 0x06bde0, 0.04, 1.15);
    silverLip.position.z = 4.1;
    graphiteBand.position.z = 5.35;
    cyanInset.position.z = 7;
    frame.add(body, silverLip, graphiteBand, cyanInset);
    return frame;
  }

  function makeInsetFace(radius, isDuel) {
    const faceMaterial = new MeshPhysicalMaterial({
      color: isDuel ? 0x0d5c7e : 0x094364,
      metalness: 0.16,
      roughness: 0.38,
      clearcoat: 0.72,
      clearcoatRoughness: 0.18,
      emissive: isDuel ? 0x04506d : 0x03364d,
      emissiveIntensity: isDuel ? 0.2 : 0.16,
    });
    const face = new Mesh(
      makeBeveledGeometry(makeHexagon(radius), 0.8, 0.45, 0.35),
      faceMaterial
    );
    face.position.z = FRAME_DEPTH - 1.5;
    return face;
  }

  function createHexButton(button, group, groupWidth, groupHeight) {
    const groupBounds = group.getBoundingClientRect();
    const bounds = button.getBoundingClientRect();
    const buttonSize = bounds.width;
    const radius = buttonSize * 0.49;
    const isDuel = button.classList.contains('hex--vs');
    const frame = new Group();
    frame.add(makeMetalFrame(radius));
    frame.add(makeInsetFace(radius * 0.79, isDuel));
    frame.position.set(
      bounds.left - groupBounds.left + bounds.width / 2 - groupWidth / 2,
      groupHeight / 2 - (bounds.top - groupBounds.top + bounds.height / 2),
      0
    );
    return frame;
  }

  function removeFrame(scene, frame) {
    scene.remove(frame);
    frame.traverse(function (object) {
      if (!object.isMesh) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(function (material) {
        material.dispose();
      });
    });
  }

  function initialize() {
    const group = document.querySelector('.hexes');
    const canvas = group && group.querySelector('.hexes__3d-frame');
    const buttons = group && Array.from(group.querySelectorAll('.hex'));
    if (!group || !canvas || !buttons || !buttons.length) return;

    let renderer;
    try {
      renderer = new WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'low-power',
      });
    } catch (error) {
      console.error('Could not initialize 3D hex frames:', error);
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);

    const scene = new Scene();
    scene.add(new AmbientLight(0xa8cbe0, 1.6));

    const keyLight = new DirectionalLight(0xffffff, 4.5);
    keyLight.position.set(-240, 300, 500);
    scene.add(keyLight);
    const rimLight = new DirectionalLight(0x8deaff, 2);
    rimLight.position.set(300, -220, 260);
    scene.add(rimLight);

    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
    camera.position.set(0, 0, 1100);
    camera.lookAt(0, 0, 0);

    let frames = [];
    let resizeFrame = 0;

    function renderFrames() {
      resizeFrame = 0;
      const bounds = group.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;

      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(bounds.width, bounds.height, false);
      camera.left = -bounds.width / 2;
      camera.right = bounds.width / 2;
      camera.top = bounds.height / 2;
      camera.bottom = -bounds.height / 2;
      camera.updateProjectionMatrix();

      frames.forEach(function (frame) {
        removeFrame(scene, frame);
      });
      frames = buttons.map(function (button) {
        const frame = createHexButton(button, group, bounds.width, bounds.height);
        scene.add(frame);
        return frame;
      });

      renderer.render(scene, camera);
      group.classList.add('has-3d-frames');
    }

    function scheduleRender() {
      if (!resizeFrame) resizeFrame = window.requestAnimationFrame(renderFrames);
    }

    const observer = new ResizeObserver(scheduleRender);
    observer.observe(group);
    buttons.forEach(function (button) {
      observer.observe(button);
    });
    window.addEventListener('resize', scheduleRender);
    renderFrames();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
