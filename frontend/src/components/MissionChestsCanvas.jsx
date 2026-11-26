import { useEffect, useRef } from 'react';

const CHEST_TIERS = [
  { style: 'antique', wood: '#754321', trim: 0xb8783f, darkTrim: 0x58391f, gem: 0xd7a45a },
  { style: 'ruby', wood: '#762e38', trim: 0xc27b57, darkTrim: 0x62313a, gem: 0xff315c },
  { style: 'frost', wood: '#477c91', trim: 0xc9f0f7, darkTrim: 0x3c617b, gem: 0x48d9ff },
  { style: 'dragon', wood: '#a87616', trim: 0xffd66b, darkTrim: 0x704619, gem: 0xff3d31 },
  { style: 'relic', wood: '#30283e', trim: 0xa88bd2, darkTrim: 0x161522, gem: 0xd74aff }
];

function createWoodTexture(THREE, baseColor, style) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Không thể tạo hoa văn gỗ cho rương.');

  context.fillStyle = baseColor;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const gradient = context.createLinearGradient(0, 0, 256, 256);
  gradient.addColorStop(0, 'rgba(255,235,194,0.22)');
  gradient.addColorStop(0.5, 'rgba(20,8,7,0.2)');
  gradient.addColorStop(1, 'rgba(255,220,160,0.18)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (let plank = 0; plank < 9; plank += 1) {
    const x = plank * 32 - 4;
    context.strokeStyle = plank % 2 ? 'rgba(25,11,9,0.62)' : 'rgba(255,225,171,0.34)';
    context.lineWidth = plank % 2 ? 3 : 1.25;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, 256);
    context.stroke();
    context.strokeStyle = 'rgba(255,220,164,0.25)';
    context.lineWidth = 1;
    for (let grain = 0; grain < 7; grain += 1) {
      const offset = plank * 32 + 3 + grain * 4;
      context.beginPath();
      context.moveTo(offset, 4);
      context.bezierCurveTo(offset - 5, 76, offset + 5, 172, offset - 1, 252);
      context.stroke();
    }
  }
  context.strokeStyle = 'rgba(25,12,10,0.5)';
  context.lineWidth = 2;
  for (let seam = 32; seam < 256; seam += 64) {
    context.beginPath();
    context.moveTo(0, seam);
    context.lineTo(256, seam);
    context.stroke();
  }
  if (style === 'ruby') {
    context.strokeStyle = 'rgba(255,192,159,0.19)';
    context.lineWidth = 3;
    for (let seam = 42; seam < 256; seam += 82) {
      context.beginPath();
      context.moveTo(0, seam);
      context.lineTo(256, seam - 24);
      context.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function makePlate(THREE, parent, width, height, depth, material, position, bevel = 0.025) {
  const shape = new THREE.Shape();
  const cut = Math.min(bevel * 1.4, width * 0.12, height * 0.12);
  shape.moveTo(-width / 2 + cut, -height / 2);
  shape.lineTo(width / 2 - cut, -height / 2);
  shape.lineTo(width / 2, -height / 2 + cut);
  shape.lineTo(width / 2, height / 2 - cut);
  shape.lineTo(width / 2 - cut, height / 2);
  shape.lineTo(-width / 2 + cut, height / 2);
  shape.lineTo(-width / 2, height / 2 - cut);
  shape.lineTo(-width / 2, -height / 2 + cut);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: bevel,
    bevelThickness: bevel
  });
  geometry.translate(0, 0, -depth / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addTube(THREE, parent, points, radius, material) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 28, radius, 6, false), material);
  tube.castShadow = true;
  parent.add(tube);
  return tube;
}

function addRivet(THREE, parent, x, y, z, metal, darkMetal, radius = 0.027) {
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 12, 8),
    new THREE.MeshPhysicalMaterial({
      color: metal.color,
      metalness: 0.9,
      roughness: 0.22,
      clearcoat: 0.8
    })
  );
  head.position.set(x, y, z);
  head.scale.z = 0.58;
  head.castShadow = true;
  parent.add(head);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.9, radius * 0.15, radius * 0.12), darkMetal);
  slot.position.set(x, y, z + radius * 0.48);
  parent.add(slot);
}

function addGem(THREE, parent, tier, x, y, z, scale = 1) {
  const bezel = new THREE.MeshPhysicalMaterial({
    color: tier.trim,
    metalness: 0.95,
    roughness: 0.18,
    clearcoat: 0.7
  });
  const gem = new THREE.MeshPhysicalMaterial({
    color: tier.gem,
    emissive: tier.gem,
    emissiveIntensity: tier.style === 'relic' ? 1.1 : 0.42,
    metalness: 0.18,
    roughness: 0.12,
    transmission: 0.12,
    thickness: 0.35,
    clearcoat: 1,
    clearcoatRoughness: 0.08
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12 * scale, 0.025 * scale, 8, 24), bezel);
  ring.position.set(x, y, z);
  parent.add(ring);
  const stone = new THREE.Mesh(new THREE.OctahedronGeometry(0.105 * scale, 1), gem);
  stone.position.set(x, y, z + 0.025 * scale);
  stone.scale.set(0.78, 1.05, 0.58);
  stone.rotation.z = Math.PI / 4;
  stone.castShadow = true;
  parent.add(stone);
  return stone;
}

function createLid(THREE, pivot, tier, wood, metal, darkMetal, index) {
  const shape = new THREE.Shape();
  shape.moveTo(-0.68, 0);
  shape.lineTo(-0.68, 0.1);
  shape.quadraticCurveTo(-0.66, 0.54, 0, 0.62);
  shape.quadraticCurveTo(0.66, 0.54, 0.68, 0.1);
  shape.lineTo(0.68, 0);
  shape.closePath();
  const shellGeometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.88,
    bevelEnabled: true,
    bevelSegments: 3,
    steps: 1,
    bevelSize: 0.035,
    bevelThickness: 0.035,
    curveSegments: 16
  });
  const shell = new THREE.Mesh(shellGeometry, [wood, darkMetal]);
  shell.castShadow = true;
  shell.receiveShadow = true;
  pivot.add(shell);

  for (const z of [0.09, 0.44, 0.79]) {
    const points = [];
    for (let step = 0; step <= 20; step += 1) {
      const x = -0.65 + step * 0.065;
      const t = x / 0.68;
      const y = 0.1 + 0.44 * Math.sqrt(Math.max(0, 1 - t * t));
      points.push([x, y, z]);
    }
    addTube(THREE, pivot, points, z === 0.44 ? 0.033 : 0.021, metal);
  }

  const frontEdge = [];
  for (let step = 0; step <= 24; step += 1) {
    const x = -0.66 + step * 0.055;
    const t = x / 0.68;
    frontEdge.push([x, 0.1 + 0.44 * Math.sqrt(Math.max(0, 1 - t * t)), 0.86]);
  }
  addTube(THREE, pivot, frontEdge, 0.026, metal);

  if (index === 2) {
    for (const side of [-1, 1]) {
      const ice = new THREE.MeshPhysicalMaterial({
        color: 0xd8fbff,
        metalness: 0.62,
        roughness: 0.16,
        emissive: 0x67dfff,
        emissiveIntensity: 0.28
      });
      const shard = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 5), ice);
      shard.position.set(side * 0.56, 0.53, 0.72);
      shard.rotation.z = side * -0.38;
      pivot.add(shard);
    }
  }
  if (index === 3) {
    const crest = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.025, 7, 24, Math.PI), metal);
    crest.position.set(0, 0.43, 0.77);
    pivot.add(crest);
    addGem(THREE, pivot, tier, 0, 0.43, 0.81, 0.72);
  }
  if (index === 4) {
    const spikeMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x32283f,
      metalness: 0.88,
      roughness: 0.24,
      clearcoat: 0.8
    });
    for (const side of [-1, 1]) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.28, 7), spikeMaterial);
      spike.position.set(side * 0.56, 0.35, 0.7);
      spike.rotation.z = side * -0.7;
      pivot.add(spike);
    }
  }
}

function createChest(THREE, chest, index) {
  const tier = CHEST_TIERS[Math.min(CHEST_TIERS.length - 1, index)];
  const group = new THREE.Group();
  const texture = createWoodTexture(THREE, tier.wood, tier.style);
  const wood = new THREE.MeshPhysicalMaterial({
    map: texture,
    color: 0xffffff,
    roughness: 0.39,
    metalness: tier.style === 'relic' ? 0.48 : 0.08,
    clearcoat: 0.42,
    clearcoatRoughness: 0.3
  });
  const darkWood = new THREE.MeshPhysicalMaterial({
    color: tier.darkTrim,
    roughness: 0.43,
    metalness: tier.style === 'frost' || tier.style === 'relic' ? 0.72 : 0.24,
    clearcoat: 0.5
  });
  const metal = new THREE.MeshPhysicalMaterial({
    color: tier.trim,
    metalness: 0.92,
    roughness: tier.style === 'frost' ? 0.18 : 0.24,
    clearcoat: 1,
    clearcoatRoughness: 0.12
  });
  const darkMetal = new THREE.MeshPhysicalMaterial({
    color: tier.darkTrim,
    metalness: 0.84,
    roughness: 0.28,
    clearcoat: 0.65
  });
  const frontMaterial = tier.style === 'frost' || tier.style === 'relic' ? darkWood : wood;

  const bodyShape = new THREE.Shape();
  bodyShape.moveTo(-0.58, -0.48);
  bodyShape.lineTo(0.58, -0.48);
  bodyShape.lineTo(0.68, -0.38);
  bodyShape.lineTo(0.68, 0.3);
  bodyShape.lineTo(0.58, 0.4);
  bodyShape.lineTo(-0.58, 0.4);
  bodyShape.lineTo(-0.68, 0.3);
  bodyShape.lineTo(-0.68, -0.38);
  bodyShape.closePath();
  const bodyGeometry = new THREE.ExtrudeGeometry(bodyShape, {
    depth: 0.88,
    bevelEnabled: true,
    bevelSegments: 3,
    steps: 1,
    bevelSize: 0.035,
    bevelThickness: 0.035
  });
  bodyGeometry.translate(0, 0, -0.44);
  const body = new THREE.Mesh(bodyGeometry, [frontMaterial, darkWood]);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const frontZ = 0.465;
  const frontPanel = new THREE.MeshPhysicalMaterial({
    color: tier.style === 'frost' ? 0x6396aa : tier.style === 'relic' ? 0x251d31 : tier.wood,
    map: tier.style === 'antique' || tier.style === 'ruby' || tier.style === 'dragon' ? texture : null,
    metalness: tier.style === 'frost' || tier.style === 'relic' ? 0.72 : 0.18,
    roughness: 0.34,
    clearcoat: 0.55
  });
  makePlate(THREE, group, 1.08, 0.62, 0.045, frontPanel, [0, -0.07, frontZ], 0.035);

  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, 0.39, -0.43);
  group.add(lidPivot);
  createLid(THREE, lidPivot, tier, frontMaterial, metal, darkMetal, index);

  for (const x of [-0.43, 0, 0.43]) {
    const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.2, 12), metal);
    hinge.rotation.z = Math.PI / 2;
    hinge.position.set(x, 0.38, -0.43);
    hinge.castShadow = true;
    group.add(hinge);
    const hingePin = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 10), darkMetal);
    hingePin.rotation.z = Math.PI / 2;
    hingePin.position.set(x, 0.38, -0.43);
    group.add(hingePin);
  }

  const bands = index === 0 ? [-0.56, 0, 0.56] : [-0.55, 0.55];
  for (const x of bands) {
    makePlate(THREE, group, 0.075, 0.88, 0.065, metal, [x, -0.04, 0.49], 0.012);
    for (const y of [-0.43, -0.19, 0.17, 0.32]) {
      addRivet(THREE, group, x, y, 0.53, metal, darkMetal, 0.023);
    }
  }
  makePlate(THREE, group, 1.26, 0.075, 0.07, metal, [0, -0.45, 0.48], 0.016);
  makePlate(THREE, group, 1.2, 0.06, 0.065, metal, [0, 0.35, 0.48], 0.014);

  const lockPlate = makePlate(THREE, group, 0.35, 0.42, 0.1, metal, [0, -0.05, 0.53], 0.045);
  lockPlate.rotation.z = Math.PI / 4;
  makePlate(THREE, group, 0.25, 0.3, 0.06, darkMetal, [0, -0.05, 0.59], 0.03);
  const lockRing = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.022, 10, 28), metal);
  lockRing.position.set(0, -0.04, 0.63);
  group.add(lockRing);
  addGem(THREE, group, tier, 0, -0.04, 0.65, 0.7);
  const jewelLight = new THREE.PointLight(tier.gem, tier.style === 'relic' ? 0.95 : 0.5, 1.9);
  jewelLight.position.set(0, -0.04, 0.78);
  group.add(jewelLight);

  for (const x of [-0.61, -0.39, 0.39, 0.61]) {
    for (const y of [-0.39, 0.25]) addRivet(THREE, group, x, y, 0.49, metal, darkMetal, 0.021);
  }

  if (index === 1) {
    for (const side of [-1, 1]) {
      makePlate(THREE, group, 0.14, 0.3, 0.04, metal, [side * 0.32, 0.03, 0.52], 0.025)
        .rotation.z = side * Math.PI / 4;
      addGem(THREE, group, tier, side * 0.32, 0.03, 0.56, 0.42);
    }
  }
  if (index === 2) {
    const ice = new THREE.MeshPhysicalMaterial({
      color: 0xcaf7ff,
      emissive: 0x48cfff,
      emissiveIntensity: 0.32,
      metalness: 0.68,
      roughness: 0.2,
      clearcoat: 1
    });
    for (const side of [-1, 1]) {
      const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), ice);
      shard.position.set(side * 0.43, -0.04, 0.55);
      shard.scale.set(0.6, 1.55, 0.55);
      shard.rotation.z = side * 0.32;
      group.add(shard);
    }
    const snowflake = [
      [[-0.42, 0.23, 0.55], [-0.29, 0.1, 0.55], [-0.42, -0.03, 0.55]],
      [[0.42, 0.23, 0.55], [0.29, 0.1, 0.55], [0.42, -0.03, 0.55]]
    ];
    snowflake.forEach((line) => addTube(THREE, group, line, 0.012, ice));
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.24, 5), ice);
    fin.position.set(0, 0.37, 0.54);
    group.add(fin);
  }
  if (index === 3) {
    const dragonMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffd970,
      metalness: 0.9,
      roughness: 0.2,
      clearcoat: 1
    });
    for (const side of [-1, 1]) {
      const mirror = (points) => points.map(([x, y, z]) => [x * side, y, z]);
      addTube(THREE, group, mirror([
        [0.18, 0.17, 0.56], [0.43, 0.25, 0.56], [0.49, 0.08, 0.56],
        [0.3, -0.02, 0.56], [0.22, -0.2, 0.56], [0.43, -0.3, 0.56]
      ]), 0.026, dragonMaterial);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 8), dragonMaterial);
      head.position.set(side * 0.43, -0.3, 0.56);
      head.scale.set(1.35, 0.75, 0.62);
      group.add(head);
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.12, 6), dragonMaterial);
      horn.position.set(side * 0.45, -0.22, 0.56);
      horn.rotation.z = side * -0.55;
      group.add(horn);
    }
  }
  if (index === 4) {
    const bone = new THREE.MeshPhysicalMaterial({
      color: 0xd9cce8,
      metalness: 0.72,
      roughness: 0.25,
      clearcoat: 0.8
    });
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), bone);
    skull.position.set(0, 0.18, 0.57);
    skull.scale.set(1.05, 0.82, 0.52);
    group.add(skull);
    const socket = new THREE.MeshStandardMaterial({ color: 0x120f1b, roughness: 0.36 });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), socket);
      eye.position.set(side * 0.06, 0.2, 0.64);
      eye.scale.z = 0.38;
      group.add(eye);
      const fang = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 7), bone);
      fang.position.set(side * 0.065, 0.04, 0.62);
      fang.rotation.z = Math.PI;
      group.add(fang);
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.22, 7), darkMetal);
      spike.position.set(side * 0.61, 0.27, 0.02);
      spike.rotation.z = side * -0.68;
      group.add(spike);
    }
    addGem(THREE, group, tier, 0, -0.22, 0.57, 0.42);
  }

  const footMaterial = darkMetal;
  for (const x of [-0.48, 0.48]) {
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.16, 8), footMaterial);
    foot.position.set(x, -0.52, 0.18);
    foot.castShadow = true;
    group.add(foot);
  }

  const glow = new THREE.Mesh(
    new THREE.TorusGeometry(0.74, 0.022, 7, 48),
    new THREE.MeshBasicMaterial({
      color: tier.gem,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  glow.rotation.x = Math.PI / 2;
  glow.position.y = -0.55;
  group.add(glow);
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18 * 3), 3));
  const particles = new THREE.Points(
    particleGeometry,
    new THREE.PointsMaterial({
      color: tier.gem,
      size: 0.045,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  group.add(particles);

  return {
    id: chest.id,
    threshold: chest.threshold,
    group,
    lidPivot,
    glow,
    jewelLight,
    particles,
    index,
    lidOpen: chest.claimed ? 1 : 0,
    hover: 0,
    wood,
    metal,
    darkMetal
  };
}

function disposeScene(scene) {
  const textures = new Set();
  scene.traverse((object) => {
    object.geometry?.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : object.material
        ? [object.material]
        : [];
    materials.forEach((material) => {
      if (material.map) textures.add(material.map);
      material.dispose();
    });
  });
  textures.forEach((texture) => texture.dispose());
}

function MissionChestsCanvas({ chests, hoveredChestId = '' }) {
  const canvasRef = useRef(null);
  const chestsRef = useRef(chests);
  const hoveredChestIdRef = useRef(hoveredChestId);
  const chestModelsRef = useRef([]);

  useEffect(() => {
    chestsRef.current = chests;
  }, [chests]);

  useEffect(() => {
    hoveredChestIdRef.current = hoveredChestId;
  }, [hoveredChestId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const importMap = document.querySelector('script[type="importmap"]');
    let threeUrl;
    try {
      threeUrl = JSON.parse(importMap?.textContent || '{}').imports?.three;
    } catch (error) {
      console.error('Cấu hình import map của Three.js không hợp lệ:', error);
    }
    if (!canvas || !threeUrl) {
      console.error('Không thể khởi tạo rương nhiệm vụ: thiếu canvas hoặc cấu hình Three.js.');
      return undefined;
    }

    let active = true;
    let renderer;
    let scene;
    let camera;
    let resizeObserver;
    let frameId = 0;
    let lastFrameTime = 0;
    const targetFrameInterval = 1000 / 60;
    const previousFrameInterval = 1000 / 30;

    const initialize = async () => {
      try {
        const THREE = await import(/* @vite-ignore */ threeUrl);
        if (!active) return;

        renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: true,
          antialias: true,
          powerPreference: 'low-power'
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.setClearColor(0x000000, 0);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.12;
        scene = new THREE.Scene();
        camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
        camera.position.set(0, 3.95, 10);
        camera.lookAt(0, 0.16, 0);
        scene.add(new THREE.HemisphereLight(0xd8efff, 0x261726, 1.15));
        const keyLight = new THREE.DirectionalLight(0xffe1c0, 4.1);
        keyLight.position.set(-3, 5, 6);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.set(512, 512);
        keyLight.shadow.camera.near = 1;
        keyLight.shadow.camera.far = 18;
        keyLight.shadow.camera.left = -9;
        keyLight.shadow.camera.right = 9;
        keyLight.shadow.camera.top = 4;
        keyLight.shadow.camera.bottom = -4;
        keyLight.shadow.bias = -0.0004;
        scene.add(keyLight);
        const fillLight = new THREE.PointLight(0x50caff, 18, 12);
        fillLight.position.set(1, 2, 3);
        scene.add(fillLight);
        const rimLight = new THREE.DirectionalLight(0x9874ff, 2.2);
        rimLight.position.set(2, 3, -5);
        scene.add(rimLight);

        const chestBaseY = 0.04;
        chestModelsRef.current = chestsRef.current.map((chest, index) => {
          const chestModel = createChest(THREE, chest, index);
          scene.add(chestModel.group);
          return chestModel;
        });

        const resize = () => {
          const bounds = canvas.getBoundingClientRect();
          if (!bounds.width || !bounds.height) return;
          renderer.setSize(bounds.width, bounds.height, false);
          camera.aspect = bounds.width / bounds.height;
          const originalViewHeight = 1.38;
          const halfViewHeight = originalViewHeight;
          const centerY = 0.16;
          camera.left = -halfViewHeight * camera.aspect;
          camera.right = halfViewHeight * camera.aspect;
          camera.top = halfViewHeight;
          camera.bottom = -halfViewHeight;
          camera.position.set(0, 3.95, 10);
          camera.lookAt(0, centerY, 0);
          camera.updateProjectionMatrix();
          const halfViewWidth = halfViewHeight * camera.aspect;
          chestModelsRef.current.forEach(({ group, threshold }) => {
            const position = chestModelsRef.current.length === 1
              ? 50
              : 5 + threshold / 500 * 90;
            group.position.set(
              (position / 50 - 1) * halfViewWidth,
              chestBaseY,
              0
            );
            group.scale.setScalar(1);
          });
        };
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(canvas);
        resize();

        const animate = (time) => {
          frameId = window.requestAnimationFrame(animate);
          if (!active) return;
          if (document.visibilityState === 'hidden') {
            lastFrameTime = 0;
            return;
          }
          if (lastFrameTime && time - lastFrameTime < targetFrameInterval - 1) return;
          const frameScale = lastFrameTime
            ? Math.min((time - lastFrameTime) / previousFrameInterval, 2)
            : 1;
          lastFrameTime = time;
          chestModelsRef.current.forEach((model) => {
            const { id, group, lidPivot, glow, jewelLight, particles, index } = model;
            const state = chestsRef.current.find((entry) => entry.id === id);
            if (!state) return;
            const eligible = state.unlocked && !state.claimed;
            const hovered = hoveredChestIdRef.current === id;
            const targetLidOpen = state.claimed ? 1 : 0;
            model.lidOpen += Math.sign(targetLidOpen - model.lidOpen)
              * Math.min(Math.abs(targetLidOpen - model.lidOpen), 0.035 * frameScale);
            model.hover += ((hovered ? 1 : 0) - model.hover)
              * (1 - (1 - 0.14) ** frameScale);
            group.position.y = chestBaseY
              + Math.sin(time * 0.0014 + index * 1.7) * 0.014
              + model.hover * 0.055
              + (eligible ? Math.sin(time * 0.002 + index) * 0.018 : 0);
            group.scale.setScalar(1 + model.hover * 0.035);
            model.wood.emissive.setRGB(0.035 * model.hover, 0.018 * model.hover, 0.008 * model.hover);
            model.metal.emissive.setRGB(0.025 * model.hover, 0.03 * model.hover, 0.045 * model.hover);
            lidPivot.rotation.x = -0.92 * model.lidOpen;
            glow.material.opacity = eligible
              ? 0.3 + Math.sin(time * 0.003 + index) * 0.12
              : 0;
            jewelLight.intensity = (index === 4 ? 0.95 : 0.5)
              + (eligible ? 0.55 + Math.sin(time * 0.003 + index) * 0.16 : 0);
            const positions = particles.geometry.getAttribute('position');
            for (let particleIndex = 0; particleIndex < positions.count; particleIndex += 1) {
              const angle = time * 0.0012 + particleIndex * Math.PI * 2 / positions.count + index;
              const radius = 0.7 + Math.sin(time * 0.002 + particleIndex) * 0.06;
              positions.setXYZ(
                particleIndex,
                Math.cos(angle) * radius,
                -0.05 + Math.sin(angle * 1.4) * 0.34,
                Math.sin(angle) * radius * 0.5
              );
            }
            positions.needsUpdate = true;
            particles.material.opacity = eligible ? 0.7 : 0;
            group.rotation.y = Math.sin(time * 0.0006 + index * 1.3) * 0.012
              + model.hover * 0.025;
          });
          renderer.render(scene, camera);
        };
        frameId = window.requestAnimationFrame(animate);
      } catch (error) {
        if (active) console.error('Không thể khởi tạo hiệu ứng Three.js cho rương nhiệm vụ:', error);
      }
    };

    void initialize();
    return () => {
      active = false;
      window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      if (scene) disposeScene(scene);
      renderer?.dispose();
      chestModelsRef.current = [];
    };
  }, []);

  return <canvas ref={canvasRef} className="mission-chests__canvas" aria-hidden="true" />;
}

export default MissionChestsCanvas;
