import { useEffect, useRef } from 'react';

const LINKS_PER_STRAND = 12;
const BIND_DURATION_MS = 760;
const BURST_DURATION_MS = 680;

function createLinkTransforms(THREE, meshes, aspect) {
  const links = [];
  const halfWidth = Math.min(aspect * 0.45, 0.36);
  const halfHeight = 0.45;
  const strands = [
    { start: [-halfWidth, -halfHeight, 0.035], end: [halfWidth, halfHeight, 0.035] },
    { start: [-halfWidth, halfHeight, -0.035], end: [halfWidth, -halfHeight, -0.035] }
  ];
  const helper = new THREE.Object3D();
  const localAxis = new THREE.Vector3(1, 0, 0);

  strands.forEach(({ start, end }, strandIndex) => {
    const from = new THREE.Vector3(...start);
    const to = new THREE.Vector3(...end);
    const tangent = to.clone().sub(from).normalize();
    const align = new THREE.Quaternion().setFromUnitVectors(localAxis, tangent);

    for (let index = 0; index < LINKS_PER_STRAND; index += 1) {
      const progress = (index + 0.5) / LINKS_PER_STRAND;
      const position = from.clone().lerp(to, progress);
      const twist = new THREE.Quaternion().setFromAxisAngle(
        tangent,
        index % 2 === 0 ? 0 : Math.PI / 2
      );
      const quaternion = twist.multiply(align.clone());
      const size = 0.94 + ((index + strandIndex) % 3) * 0.035;

      helper.position.copy(position);
      helper.quaternion.copy(quaternion);
      helper.scale.set(size, size, size);
      helper.updateMatrix();
      meshes.forEach((mesh) => {
        mesh.setMatrixAt(strandIndex * LINKS_PER_STRAND + index, helper.matrix);
      });
      links.push({
        position,
        quaternion,
        direction: position.clone().normalize(),
        spin: (index % 2 === 0 ? 1 : -1) * (0.8 + (index % 4) * 0.16),
        size
      });
    }
  });

  meshes.forEach((mesh) => {
    mesh.instanceMatrix.needsUpdate = true;
  });
  return links;
}

function createChainModel(
  THREE,
  geometry,
  outlineGeometry,
  glowGeometry,
  scene,
  aspect,
  now
) {
  const group = new THREE.Group();
  const outlineMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x252c35,
    metalness: 0.86,
    roughness: 0.3,
    transparent: true,
    opacity: 0,
    depthWrite: false
  });
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xa9b8c8,
    metalness: 0.78,
    roughness: 0.2,
    clearcoat: 0.9,
    clearcoatRoughness: 0.14,
    emissive: 0x123c50,
    emissiveIntensity: 0.2,
    transparent: true,
    opacity: 0,
    depthWrite: false
  });
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0x63c9e8,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false
  });
  const outlineMesh = new THREE.InstancedMesh(
    outlineGeometry,
    outlineMaterial,
    LINKS_PER_STRAND * 2
  );
  const mesh = new THREE.InstancedMesh(
    geometry,
    material,
    LINKS_PER_STRAND * 2
  );
  const glowMesh = new THREE.InstancedMesh(
    glowGeometry,
    glowMaterial,
    LINKS_PER_STRAND * 2
  );
  outlineMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  glowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  outlineMesh.frustumCulled = false;
  mesh.frustumCulled = false;
  glowMesh.frustumCulled = false;
  outlineMesh.renderOrder = 0;
  mesh.renderOrder = 1;
  glowMesh.renderOrder = 2;
  const meshes = [outlineMesh, mesh, glowMesh];
  const links = createLinkTransforms(THREE, meshes, aspect);
  group.add(outlineMesh);
  group.add(mesh);
  group.add(glowMesh);
  scene.add(group);

  return {
    group,
    meshes,
    mesh,
    material,
    glowMaterial,
    materials: [outlineMaterial, material, glowMaterial],
    links,
    phase: 'binding',
    startedAt: now,
    aspect
  };
}

export default function AttackLockChainOverlay({ boardRef, chains, onFinished }) {
  const canvasRef = useRef(null);
  const chainsRef = useRef(chains);
  const onFinishedRef = useRef(onFinished);

  chainsRef.current = chains;
  onFinishedRef.current = onFinished;

  useEffect(() => {
    const canvas = canvasRef.current;
    const board = boardRef.current;
    if (!canvas || !board) return undefined;

    let disposed = false;
    let frame = 0;
    let observer;
    let renderer;
    let scene;
    let camera;
    let linkGeometry;
    let outlineGeometry;
    let glowGeometry;
    let three;
    let lastFrameTime = 0;
    let finishNotified = false;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const models = new Map();

    const resize = () => {
      if (!renderer || !camera) return;
      const bounds = board.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      renderer.setSize(bounds.width, bounds.height, false);
      camera.left = -bounds.width / 2;
      camera.right = bounds.width / 2;
      camera.top = bounds.height / 2;
      camera.bottom = -bounds.height / 2;
      camera.updateProjectionMatrix();
    };

    const updateModel = (model, now, cardElement, chain) => {
      const bounds = cardElement.getBoundingClientRect();
      const boardBounds = board.getBoundingClientRect();
      const cardHeight = cardElement.offsetHeight || bounds.height;
      if (!bounds.width || !bounds.height || !cardHeight) return false;

      const aspect = (cardElement.offsetWidth || bounds.width) / cardHeight;
      if (Math.abs(aspect - model.aspect) > 0.015) {
        model.links = createLinkTransforms(three, model.meshes, aspect);
        model.aspect = aspect;
      }

      model.group.position.set(
        bounds.left + bounds.width / 2 - boardBounds.left - boardBounds.width / 2,
        boardBounds.height / 2 - (bounds.top + bounds.height / 2 - boardBounds.top),
        12
      );
      model.group.rotation.z = chain.position === 'defense' ? -Math.PI / 2 : 0;

      const elapsed = now - model.startedAt;
      const duration = model.phase === 'bursting'
        ? reducedMotion ? 120 : BURST_DURATION_MS
        : reducedMotion ? 1 : BIND_DURATION_MS;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - (1 - progress) ** 3;
      const positionScale = chain.position === 'defense' ? 0.8 : 1;
      const pulse = reducedMotion ? 1 : 0.5 + 0.5 * Math.sin(now * 0.004);

      if (model.phase === 'binding') {
        model.group.scale.setScalar(cardHeight * positionScale);
        const fade = Math.min(1, eased * 1.2);
        model.materials.forEach((material) => {
          material.opacity = fade;
        });
        const helper = new three.Object3D();
        model.links.forEach((link, index) => {
          const idxInStrand = index % LINKS_PER_STRAND;
          const strandDelay = index >= LINKS_PER_STRAND ? 0.14 : 0;
          const linkStart = strandDelay + (idxInStrand / LINKS_PER_STRAND) * 0.56;
          const linkProgress = Math.max(0, Math.min((progress - linkStart) / 0.3, 1));
          const linkEased = 1 - (1 - linkProgress) ** 3;
          helper.position.copy(link.position).multiplyScalar(0.88 + 0.12 * linkEased);
          helper.quaternion.copy(link.quaternion);
          helper.scale.setScalar(link.size * linkEased);
          helper.updateMatrix();
          model.meshes.forEach((mesh) => {
            mesh.setMatrixAt(index, helper.matrix);
          });
        });
        model.meshes.forEach((mesh) => {
          mesh.instanceMatrix.needsUpdate = true;
        });
        if (progress === 1) model.phase = 'bound';
      } else if (model.phase === 'bursting') {
        model.group.scale.setScalar(cardHeight * positionScale);
        model.materials.forEach((material) => {
          material.opacity = 1 - progress;
        });
        const helper = new three.Object3D();
        const spinAxis = new three.Vector3(1, 0, 0);

        model.links.forEach((link, index) => {
          const scatter = eased * (0.24 + (index % 3) * 0.035);
          helper.position.copy(link.position)
            .addScaledVector(link.direction, scatter)
            .add(new three.Vector3(
              Math.sin(index * 9.17) * scatter * 0.36,
              Math.cos(index * 4.31) * scatter * 0.36,
              eased * (0.08 + (index % 4) * 0.025)
            ));
          helper.quaternion.copy(link.quaternion).multiply(
            new three.Quaternion().setFromAxisAngle(spinAxis, link.spin * eased)
          );
          helper.scale.setScalar(link.size * (1 - eased * 0.22));
          helper.updateMatrix();
          model.meshes.forEach((mesh) => {
            mesh.setMatrixAt(index, helper.matrix);
          });
        });
        model.meshes.forEach((mesh) => {
          mesh.instanceMatrix.needsUpdate = true;
        });
        if (progress === 1) return false;
      } else {
        model.group.scale.setScalar(cardHeight * positionScale);
        model.materials.forEach((material) => {
          material.opacity = 1;
        });
      }

      const phaseOpacity = model.phase === 'bursting'
        ? 1 - progress
        : model.phase === 'binding' ? Math.min(1, eased * 1.2) : 1;
      model.glowMaterial.opacity = phaseOpacity * (0.06 + pulse * 0.24);
      model.material.emissiveIntensity = 0.04 + pulse * 0.18;
      return true;
    };

    const initialize = async () => {
      try {
        const importMap = document.querySelector('script[type="importmap"]');
        const threeUrl = JSON.parse(importMap?.textContent || '{}').imports?.three;
        if (!threeUrl) throw new Error('Three.js is missing from the duel page import map.');
        three = await import(/* @vite-ignore */ threeUrl);
        if (disposed) return;

        renderer = new three.WebGLRenderer({
          canvas,
          alpha: true,
          antialias: true,
          powerPreference: 'low-power'
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
        renderer.setClearColor(0x000000, 0);

        scene = new three.Scene();
        camera = new three.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
        camera.position.z = 1000;
        scene.add(new three.HemisphereLight(0xe9f3ff, 0x202a38, 1.8));

        const keyLight = new three.DirectionalLight(0xfff2d5, 3.5);
        keyLight.position.set(-180, 210, 260);
        scene.add(keyLight);

        const fillLight = new three.DirectionalLight(0x8edaff, 2.3);
        fillLight.position.set(170, -130, 180);
        scene.add(fillLight);

        linkGeometry = new three.TorusGeometry(0.035, 0.012, 10, 22);
        linkGeometry.scale(1.18, 0.86, 1);
        outlineGeometry = new three.TorusGeometry(0.035, 0.02, 10, 22);
        outlineGeometry.scale(1.18, 0.86, 1);
        glowGeometry = new three.TorusGeometry(0.035, 0.022, 10, 22);
        glowGeometry.scale(1.18, 0.86, 1);
        resize();
        observer = new ResizeObserver(resize);
        observer.observe(board);

        const animate = (now) => {
          frame = window.requestAnimationFrame(animate);
          if (disposed || now - lastFrameTime < 32) return;
          lastFrameTime = now;

          const targets = new Map(
            chainsRef.current.map((chain) => [chain.instanceId, chain])
          );

          targets.forEach((chain, instanceId) => {
            let model = models.get(instanceId);
            if (!model) {
              const zone = board.querySelector(`[data-zone="${chain.zoneKey}"]`);
              const cardElement = zone?.querySelector('.duel-field-monster');
              if (!cardElement) return;
              const bounds = cardElement.getBoundingClientRect();
              const aspect = (cardElement.offsetWidth || bounds.width)
                / (cardElement.offsetHeight || bounds.height);
              model = createChainModel(
                three,
                linkGeometry,
                outlineGeometry,
                glowGeometry,
                scene,
                aspect,
                now
              );
              models.set(instanceId, model);
            } else if (model.phase === 'bursting') {
              model.phase = 'binding';
              model.startedAt = now;
              model.links = createLinkTransforms(three, model.meshes, model.aspect);
              model.materials.forEach((material) => {
                material.opacity = 1;
              });
            }
          });

          models.forEach((model, instanceId) => {
            if (!targets.has(instanceId) && model.phase !== 'bursting') {
              model.phase = 'bursting';
              model.startedAt = now;
            }

            const chain = targets.get(instanceId) || model.chain;
            if (targets.has(instanceId)) model.chain = chain;
            const zone = chain && board.querySelector(`[data-zone="${chain.zoneKey}"]`);
            const cardElement = zone?.querySelector('.duel-field-monster');
            if (!cardElement || !updateModel(model, now, cardElement, chain)) {
              scene.remove(model.group);
              model.materials.forEach((material) => material.dispose());
              models.delete(instanceId);
            }
          });

          if (!models.size && !chainsRef.current.length) {
            if (!finishNotified) {
              finishNotified = true;
              onFinishedRef.current?.();
            }
          } else {
            finishNotified = false;
          }

          renderer.render(scene, camera);
        };
        frame = window.requestAnimationFrame(animate);
      } catch (error) {
        if (!disposed) {
          console.error('Unable to initialize the 3D attack-lock chain:', error);
        }
      }
    };

    initialize();
    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      models.forEach((model) => {
        model.materials.forEach((material) => material.dispose());
      });
      models.clear();
      linkGeometry?.dispose();
      outlineGeometry?.dispose();
      glowGeometry?.dispose();
      renderer?.dispose();
    };
  }, [boardRef]);

  return (
    <div className="duel-attack-lock-chain-layer" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
