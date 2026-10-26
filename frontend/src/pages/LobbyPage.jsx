import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CardFace } from '../components/CardFace.jsx';
import { redrawCardFaceCanvases } from '../renderers/cardFrameRenderer.js';

const characters = {
  'kaiba-seto': { name: 'Kaiba Seto', image: 'assets/images/hero/kaiba-seto.png' },
  'muto-yugi': { name: 'Muto Yugi', image: 'assets/images/hero/muto-yugi.png' },
  'jonouchi-katsuya': {
    name: 'Jonouchi Katsuya',
    image: 'assets/images/hero/jonouchi-katsuya.png'
  }
};

const packArtwork = {
  kaiba: 'assets/images/hero/kaiba-seto.png',
  yugi: 'assets/images/hero/muto-yugi.png',
  jonouchi: 'assets/images/hero/jonouchi-katsuya.png'
};

const formatCurrency = (value) => new Intl.NumberFormat('vi-VN').format(value ?? 0);
const getShopPageSize = () => (
  window.matchMedia('(max-width: 940px) and (max-height: 500px)').matches
    ? 4
    : window.matchMedia('(min-width: 941px) and (max-width: 1024px) and (max-height: 500px)').matches
      ? 5
      : 10
);

async function requestJson(url, options) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Không thể hoàn tất yêu cầu.');
  return result;
}

function LibraryArtwork({ card }) {
  const [imageFailed, setImageFailed] = useState(false);
  const placeholder = card.category === 'spell' ? '魔' : card.category === 'trap' ? '罠' : '✦';

  return card.image && !imageFailed
    ? <img className="library-card__artwork" src={card.image} alt={card.name} loading="lazy" onError={() => setImageFailed(true)} />
    : <span className="library-card__placeholder" aria-hidden="true">{placeholder}</span>;
}

function drawCardBackCanvas(canvas) {
  const size = window.getComputedStyle(canvas);
  const width = Number.parseFloat(size.width);
  const height = Number.parseFloat(size.height);
  if (!width || !height) return;

  const pixelRatio = window.devicePixelRatio || 1;
  const pixelWidth = Math.max(1, Math.round(width * pixelRatio));
  const pixelHeight = Math.max(1, Math.round(height * pixelRatio));
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, pixelWidth, pixelHeight);

  const scale = Math.min(pixelWidth / 265, pixelHeight / 357);
  const offsetX = (pixelWidth - 265 * scale) / 2;
  const offsetY = (pixelHeight - 357 * scale) / 2;
  context.setTransform(scale, 0, 0, scale, offsetX, offsetY);

  context.fillStyle = '#d6ae7a';
  context.fillRect(0, 0, 265, 357);
  context.strokeStyle = '#21120d';
  context.lineWidth = 1.5;
  context.strokeRect(0.75, 0.75, 263.5, 355.5);

  context.fillStyle = '#28150f';
  context.fillRect(9.5, 8.5, 246, 340);

  context.save();
  context.beginPath();
  context.rect(12, 11, 241, 335);
  context.clip();
  context.fillStyle = '#764131';
  context.fillRect(12, 11, 241, 335);
  context.restore();

  context.beginPath();
  context.ellipse(132.5, 178.5, 50, 88, 0, 0, Math.PI * 2);
  context.fillStyle = '#4b4c46';
  context.fill();

  context.beginPath();
  context.ellipse(132.5, 178.5, 50, 88, 0, 0, Math.PI * 2);
  context.strokeStyle = '#100c09';
  context.lineWidth = 2.5;
  context.stroke();
}

function CardBack() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const draw = () => drawCardBackCanvas(canvas);
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    draw();
    return () => observer.disconnect();
  }, []);
  return <canvas ref={canvasRef} className="shop-reveal__card-back card__back-canvas" aria-hidden="true"></canvas>;
}

function Card3DViewer({ visible, cardFaceRef, cardId, onActivate, onUnavailable, onReady }) {
  const stageRef = useRef(null);
  const zoomInRef = useRef(null);
  const zoomOutRef = useRef(null);
  const resetRef = useRef(null);
  const onActivateRef = useRef(onActivate);
  const onUnavailableRef = useRef(onUnavailable);
  const onReadyRef = useRef(onReady);

  useEffect(() => {
    onActivateRef.current = onActivate;
    onUnavailableRef.current = onUnavailable;
    onReadyRef.current = onReady;
  }, [onActivate, onUnavailable, onReady]);

  useEffect(() => {
    if (!cardId) return undefined;
    let cancelled = false;
    import('../renderers/card3dViewer.js')
      .then(({ preloadCard3DViewer }) => preloadCard3DViewer())
      .catch((error) => {
        if (!cancelled) console.error('Could not preload the 3D card viewer:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  useEffect(() => {
    if (!visible || !stageRef.current || !cardFaceRef.current) return undefined;
    let cancelled = false;
    let viewer = null;
    const face = cardFaceRef.current;
    const width = face.offsetWidth || 265;
    const height = face.offsetHeight || Math.round(width * 357 / 265);
    import('../renderers/card3dViewer.js')
      .then(async ({ createCard3DViewer }) => {
        const nextViewer = await createCard3DViewer({
          stage: stageRef.current,
          cardFace: face,
          width,
          height,
          zoomInButton: zoomInRef.current,
          zoomOutButton: zoomOutRef.current,
          resetButton: resetRef.current,
          drawCardBack: drawCardBackCanvas,
          refreshCardFace: redrawCardFaceCanvases,
          onActivate: () => onActivateRef.current?.()
        });
        if (cancelled) {
          nextViewer.destroy();
          return;
        }
        viewer = nextViewer;
        viewer.playEntryTransition();
        onReadyRef.current?.();
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Could not initialize the 3D card viewer:', error);
          onUnavailableRef.current?.();
        }
      });
    return () => {
      cancelled = true;
      viewer?.destroy();
    };
  }, [visible, cardFaceRef, cardId]);

  return (
    <div className={`shop-reveal__3d-viewer${visible ? ' is-entering' : ''}`} hidden={!visible}>
      <div ref={stageRef} className="shop-reveal__3d-stage" tabIndex="0"
        aria-label="Lá bài 3D. Kéo để xoay, dùng phím mũi tên để quan sát."></div>
      <div className="shop-reveal__3d-controls" aria-label="Điều khiển góc nhìn lá bài">
        <button ref={zoomOutRef} type="button" aria-label="Thu nhỏ lá bài">−</button>
        <button ref={resetRef} type="button">Đặt lại góc</button>
        <button ref={zoomInRef} type="button" aria-label="Phóng to lá bài">+</button>
      </div>
    </div>
  );
}

function LobbyPage() {
  const [userName, setUserName] = useState('CốtNgoàiChg');
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [wallet, setWallet] = useState({ gold: 103000, gems: 3500 });
  const [activeCharacter, setActiveCharacter] = useState('jonouchi-katsuya');
  const [pendingCharacter, setPendingCharacter] = useState('jonouchi-katsuya');
  const [savingCharacter, setSavingCharacter] = useState(false);
  const [duelistEmpty, setDuelistEmpty] = useState(false);
  const [panel, setPanel] = useState('');
  const [toast, setToast] = useState('');
  const [libraryCards, setLibraryCards] = useState([]);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [libraryError, setLibraryError] = useState('');
  const [libraryCategory, setLibraryCategory] = useState('monster');
  const [detailCard, setDetailCard] = useState(null);
  const [shopState, setShopState] = useState(null);
  const [activePackId, setActivePackId] = useState('');
  const [cardPage, setCardPage] = useState(0);
  const [pageSize, setPageSize] = useState(getShopPageSize);
  const previousPageSize = useRef(pageSize);
  const [resetOpen, setResetOpen] = useState(false);
  const [buying, setBuying] = useState(false);
  const [revealRewards, setRevealRewards] = useState([]);
  const [revealPack, setRevealPack] = useState(null);
  const [revealStage, setRevealStage] = useState('closed');
  const [revealIndex, setRevealIndex] = useState(0);
  const [reveal3DReady, setReveal3DReady] = useState(false);
  const [quickConfirm, setQuickConfirm] = useState(false);
  const [exchangeMessage, setExchangeMessage] = useState('');
  const [exchangeState, setExchangeState] = useState('');
  const [exchanging, setExchanging] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try { return localStorage.getItem('yugioh.sfx') !== 'off'; } catch { return true; }
  });
  const toastTimer = useRef(0);
  const previousFocus = useRef(null);
  const exchangeReturnPanel = useRef('');
  const detailReturnPanel = useRef('');
  const revealCardFace = useRef(null);
  const revealTimers = useRef({});
  const stateRef = useRef(null);

  const clearRevealTimers = () => {
    Object.values(revealTimers.current).forEach((timer) => window.clearTimeout(timer));
    revealTimers.current = {};
  };

  const scheduleRevealTimer = (name, callback, delay) => {
    window.clearTimeout(revealTimers.current[name]);
    revealTimers.current[name] = window.setTimeout(() => {
      delete revealTimers.current[name];
      callback();
    }, delay);
  };

  useEffect(() => () => clearRevealTimers(), []);

  const notify = (message, state) => {
    setToast(message);
    setExchangeState(state || '');
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2400);
  };

  useEffect(() => {
    const updatePageSize = () => setPageSize((current) => {
      const next = getShopPageSize();
      return current === next ? current : next;
    });
    window.addEventListener('resize', updatePageSize);
    window.addEventListener('orientationchange', updatePageSize);
    return () => {
      window.removeEventListener('resize', updatePageSize);
      window.removeEventListener('orientationchange', updatePageSize);
    };
  }, []);

  useEffect(() => {
    const previous = previousPageSize.current;
    if (previous === pageSize) return;
    previousPageSize.current = pageSize;
    setCardPage((page) => {
      const next = Math.floor((page * previous) / pageSize);
      const last = activePack?.cards.length
        ? Math.max(0, Math.ceil(activePack.cards.length / pageSize) - 1)
        : next;
      return Math.min(next, last);
    });
  }, [pageSize, shopState?.packs?.find((pack) => pack.id === activePackId)?.cards.length]);

  useEffect(() => {
    let cancelled = false;
    requestJson('/api/session')
      .then((result) => {
        if (cancelled) return;
        if (!result.user) {
          window.location.replace('/');
          return;
        }
        setUserName(result.user.player_name || result.user.username || 'Duelist');
        const characterId = result.user.selected_character_id;
        if (characters[characterId]) {
          setActiveCharacter(characterId);
          setPendingCharacter(characterId);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Session validation failed:', error);
          window.location.replace('/');
        }
      });
    requestJson('/api/wallet')
      .then((result) => { if (!cancelled) setWallet(result.wallet); })
      .catch((error) => console.error('Wallet loading failed:', error));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (panel !== 'library' || libraryLoaded) return;
    let cancelled = false;
    requestJson('/api/cards')
      .then((result) => {
        if (!Array.isArray(result.cards)) throw new Error('Dữ liệu thư viện không hợp lệ.');
        if (!cancelled) {
          setLibraryCards(result.cards);
          setLibraryLoaded(true);
        }
      })
      .catch((error) => {
        console.error('Could not load library cards:', error);
        if (!cancelled) setLibraryError('Không tải được dữ liệu bài. Hãy kiểm tra máy chủ rồi mở lại thư viện.');
      });
    return () => { cancelled = true; };
  }, [panel, libraryLoaded]);

  useEffect(() => {
    if (panel !== 'shop') return;
    let cancelled = false;
    requestJson('/api/shop')
      .then((result) => { if (!cancelled) setShopState(result); })
      .catch((error) => { if (!cancelled) notify(error.message); });
    return () => { cancelled = true; };
  }, [panel]);

  useEffect(() => {
    const layer = document.querySelector('.bg-image--lobby');
    const imageSource = layer && getComputedStyle(layer).backgroundImage.match(/url\((['"]?)(.*?)\1\)/)?.[2];
    if (!imageSource) return undefined;
    const image = new Image();
    const onLoad = () => document.body.classList.add('has-bg');
    image.addEventListener('load', onLoad);
    image.src = imageSource;
    return () => {
      image.removeEventListener('load', onLoad);
      document.body.classList.remove('has-bg');
    };
  }, []);

  useEffect(() => {
    const group = document.querySelector('.hexes');
    const canvas = group?.querySelector('.hexes__3d-frame');
    const buttons = group ? Array.from(group.querySelectorAll('.hex')) : [];
    if (!group || !canvas || !buttons.length) return undefined;
    let disposed = false;
    let observer;
    let renderer;
    let frames = [];
    let animationFrame = 0;
    let removeFrame;

    const initialize = async () => {
      try {
        const importMap = document.querySelector('script[type="importmap"]');
        const threeUrl = JSON.parse(importMap?.textContent || '{}').imports?.three;
        if (!threeUrl) throw new Error('Three.js is not configured in the page import map.');
        const THREE = await import(/* @vite-ignore */ threeUrl);
        if (disposed) return;
        renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: true,
          antialias: true,
          powerPreference: 'low-power'
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setClearColor(0x000000, 0);
        const scene = new THREE.Scene();
        scene.add(new THREE.AmbientLight(0xa8cbe0, 1.6));
        const keyLight = new THREE.DirectionalLight(0xffffff, 4.5);
        keyLight.position.set(-240, 300, 500);
        scene.add(keyLight);
        const rimLight = new THREE.DirectionalLight(0x8deaff, 2);
        rimLight.position.set(300, -220, 260);
        scene.add(rimLight);
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
        camera.position.set(0, 0, 1100);
        camera.lookAt(0, 0, 0);

        const hexagon = (radius) => {
          const shape = new THREE.Shape();
          for (let index = 0; index < 6; index += 1) {
            const angle = index * Math.PI / 3;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius * Math.sqrt(3) / 2;
            if (index === 0) shape.moveTo(x, y);
            else shape.lineTo(x, y);
          }
          shape.closePath();
          return shape;
        };
        const ring = (radius, innerRadius, depth, bevel, front, side, emissive, metalness, intensity) => {
          const shape = hexagon(radius);
          shape.holes.push(new THREE.Path(hexagon(innerRadius).getPoints(6)));
          const geometry = new THREE.ExtrudeGeometry(shape, {
            depth, bevelEnabled: true, bevelSegments: 3, bevelSize: bevel,
            bevelThickness: bevel, curveSegments: 1, steps: 1
          });
          const materials = [
            new THREE.MeshPhysicalMaterial({
              color: front, metalness, roughness: 0.3, clearcoat: 1,
              clearcoatRoughness: 0.14, emissive, emissiveIntensity: intensity
            }),
            new THREE.MeshPhysicalMaterial({
              color: side, metalness: 0.4, roughness: 0.28, clearcoat: 0.8
            })
          ];
          return new THREE.Mesh(geometry, materials);
        };
        const frameFor = (button, bounds) => {
          const buttonBounds = button.getBoundingClientRect();
          const radius = buttonBounds.width * 0.49;
          const frame = new THREE.Group();
          const body = ring(radius, radius * 0.78, 5.4, 1.8, 0x244660, 0x071a30, 0x061729, 0.18, 0.2);
          const lip = ring(radius * 0.995, radius * 0.87, 2.8, 2.2, 0xdce9ed, 0x607a89, 0x8aa0aa, 0.04, 0.42);
          const band = ring(radius * 0.9, radius * 0.81, 2, 1.5, 0x43586a, 0x1b3043, 0x102538, 0.22, 0.16);
          const inset = ring(radius * 0.84, radius * 0.77, 1.1, 0.7, 0x2cecff, 0x08718d, 0x06bde0, 0.04, 1.15);
          lip.position.z = 4.1;
          band.position.z = 5.35;
          inset.position.z = 7;
          frame.add(body, lip, band, inset);
          const face = new THREE.Mesh(
            new THREE.ExtrudeGeometry(hexagon(radius * 0.79), {
              depth: 0.8, bevelEnabled: true, bevelSegments: 3,
              bevelSize: 0.45, bevelThickness: 0.35, curveSegments: 1, steps: 1
            }),
            new THREE.MeshPhysicalMaterial({
              color: button.classList.contains('hex--vs') ? 0x0d5c7e : 0x094364,
              metalness: 0.16, roughness: 0.38, clearcoat: 0.72,
              clearcoatRoughness: 0.18,
              emissive: button.classList.contains('hex--vs') ? 0x04506d : 0x03364d,
              emissiveIntensity: button.classList.contains('hex--vs') ? 0.2 : 0.16
            })
          );
          face.position.z = 5.5;
          frame.add(face);
          frame.position.set(
            buttonBounds.left - bounds.left + buttonBounds.width / 2 - bounds.width / 2,
            bounds.height / 2 - (buttonBounds.top - bounds.top + buttonBounds.height / 2),
            0
          );
          return frame;
        };
        removeFrame = (frame) => {
          scene.remove(frame);
          frame.traverse((object) => {
            if (!object.isMesh) return;
            object.geometry.dispose();
            (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => material.dispose());
          });
        };
        const draw = () => {
          animationFrame = 0;
          if (disposed) return;
          const bounds = group.getBoundingClientRect();
          if (!bounds.width || !bounds.height) return;
          renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
          renderer.setSize(bounds.width, bounds.height, false);
          camera.left = -bounds.width / 2;
          camera.right = bounds.width / 2;
          camera.top = bounds.height / 2;
          camera.bottom = -bounds.height / 2;
          camera.updateProjectionMatrix();
          frames.forEach(removeFrame);
          frames = buttons.map((button) => frameFor(button, bounds));
          frames.forEach((frame) => scene.add(frame));
          renderer.render(scene, camera);
          group.classList.add('has-3d-frames');
        };
        const schedule = () => {
          if (!animationFrame) animationFrame = window.requestAnimationFrame(draw);
        };
        observer = new ResizeObserver(schedule);
        observer.observe(group);
        buttons.forEach((button) => observer.observe(button));
        window.addEventListener('resize', schedule);
        draw();
        return () => window.removeEventListener('resize', schedule);
      } catch (error) {
        if (!disposed) console.error('Could not initialize React lobby hex frames:', error);
      }
    };
    let removeResizeListener;
    initialize().then((cleanup) => { removeResizeListener = cleanup; });
    return () => {
      disposed = true;
      observer?.disconnect();
      window.cancelAnimationFrame(animationFrame);
      removeResizeListener?.();
      frames.forEach((frame) => removeFrame?.(frame));
      renderer?.dispose();
      group.classList.remove('has-3d-frames');
    };
  }, []);

  useEffect(() => {
    if (!panel) return;
    const focusTarget = panel === 'profile'
      ? document.getElementById('profileNameInput')
      : panel === 'library'
        ? document.querySelector('[data-library-tab].is-selected')
        : panel === 'characters'
          ? document.querySelector('[data-js="characters-back"]')
          : panel === 'exchange'
            ? document.querySelector('.gem-exchange__close')
            : panel === 'shop'
              ? document.querySelector('[data-js="shop-back"]')
              : document.querySelector('[data-reveal-pack]');
    window.requestAnimationFrame(() => focusTarget?.focus());
  }, [panel]);

  const closePanel = () => {
    const opener = previousFocus.current;
    setPanel((current) => current === 'exchange' ? exchangeReturnPanel.current : '');
    if (opener && document.contains(opener)) opener.focus();
  };

  const getActivePack = () => shopState?.packs?.find((pack) => pack.id === activePackId) || null;
  const handleClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('button');
    if (button && !button.disabled && soundEnabled) {
      const clickSound = new Audio('assets/music/sfx/click.mp3');
      clickSound.volume = 0.65;
      clickSound.play().catch(() => {});
    }
    const match = (selector) => target?.closest(selector);

    if (match('[data-soon]')) {
      notify(`🚧 ${match('[data-soon]').dataset.soon} – sắp ra mắt!`);
      return;
    }
    if (match('[data-js="btn-duel"]')) {
      window.location.href = 'duel.html';
      return;
    }
    if (match('[data-js="profile-open"]')) {
      previousFocus.current = button;
      setNameDraft(userName);
      setPanel('profile');
      return;
    }
    if (match('[data-profile-close]')) { closePanel(); return; }
    if (match('[data-profile-action="nickname"]')) {
      document.getElementById('profileNameInput')?.focus();
      return;
    }
    if (match('[data-profile-action]')) {
      notify(`${button.textContent.trim()} – sắp ra mắt`);
      return;
    }
    if (match('#soundEffectsBtn')) {
      const next = !soundEnabled;
      setSoundEnabled(next);
      try { localStorage.setItem('yugioh.sfx', next ? 'on' : 'off'); } catch {}
      return;
    }
    if (match('#profileLogout')) {
      if (!window.confirm('Đăng xuất khỏi tài khoản này?')) return;
      try {
        await requestJson('/api/logout', { method: 'POST' });
        try { sessionStorage.removeItem('yugioh.authenticatedTab'); } catch {}
        window.location.replace('/');
      } catch (error) { notify(error.message || 'Không thể đăng xuất. Hãy kiểm tra kết nối máy chủ.'); }
      return;
    }
    if (match('[data-js="btn-library"]')) {
      previousFocus.current = button;
      setPanel('library');
      return;
    }
    if (match('[data-library-close]')) { setDetailCard(null); closePanel(); return; }
    if (match('[data-library-tab]')) {
      setLibraryCategory(match('[data-library-tab]').dataset.libraryTab);
      setDetailCard(null);
      return;
    }
    if (match('.library-card[data-card-id]')) {
      const card = libraryCards.find((item) => String(item.id) === match('.library-card[data-card-id]').dataset.cardId);
      if (card) {
        detailReturnPanel.current = 'library';
        setDetailCard(card);
      }
      return;
    }
    if (match('[data-card-detail-close]')) {
      setDetailCard(null);
      if (detailReturnPanel.current === 'shop' || detailReturnPanel.current === 'reveal') {
        setPanel(detailReturnPanel.current === 'reveal' ? 'reveal' : 'shop');
      }
      detailReturnPanel.current = '';
      return;
    }
    if (match('[data-js="btn-characters"]')) {
      previousFocus.current = button;
      setPendingCharacter(activeCharacter);
      setPanel('characters');
      return;
    }
    if (match('[data-js="characters-back"]')) { closePanel(); return; }
    if (match('[data-character-choice]')) {
      setPendingCharacter(match('[data-character-choice]').dataset.characterChoice);
      return;
    }
    if (match('[data-js="characters-confirm"]')) {
      setSavingCharacter(true);
      try {
        await requestJson('/api/profile/character', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ character_id: pendingCharacter })
        });
        setActiveCharacter(pendingCharacter);
        closePanel();
        notify(`Đã chọn ${characters[pendingCharacter].name}`);
      } catch (error) { notify(error.message || 'Không thể lưu nhân vật đã chọn.'); }
      finally { setSavingCharacter(false); }
      return;
    }
    if (match('[data-gem-exchange-open]')) {
      previousFocus.current = button;
      exchangeReturnPanel.current = panel === 'shop' ? 'shop' : '';
      setExchangeMessage('Đang tải số dư…');
      setPanel('exchange');
      try {
        const result = await requestJson('/api/wallet');
        setWallet(result.wallet);
        setExchangeMessage('');
      } catch (error) {
        setExchangeMessage(error.message);
        setExchangeState('error');
      }
      return;
    }
    if (match('[data-gem-exchange-close]')) { closePanel(); return; }
    if (match('[data-exchange-gems]')) {
      const gems = Number(match('[data-exchange-gems]').dataset.exchangeGems);
      setExchanging(true);
      setExchangeMessage('Đang xử lý giao dịch…');
      setExchangeState('');
      try {
        const result = await requestJson('/api/wallet/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gems })
        });
        setWallet(result.wallet);
        const success = `Đổi thành công! Bạn nhận được ${formatCurrency(result.exchange.gold)} vàng.`;
        setExchangeMessage(success);
        setExchangeState('success');
        notify(success, 'success');
      } catch (error) {
        setExchangeMessage(error.message || 'Không thể đổi gem.');
        setExchangeState('error');
        notify(error.message || 'Không thể đổi gem.', 'error');
      } finally { setExchanging(false); }
      return;
    }
    if (match('[data-js="btn-store"]')) {
      previousFocus.current = button;
      setActivePackId('');
      setCardPage(0);
      setPanel('shop');
      return;
    }
    if (match('[data-js="shop-back"]')) {
      if (activePackId) { setActivePackId(''); setCardPage(0); }
      else closePanel();
      return;
    }
    if (match('[data-pack-select]')) {
      setActivePackId(match('[data-pack-select]').dataset.packSelect);
      setCardPage(0);
      return;
    }
    if (match('[data-shop-page-prev]')) { setCardPage((page) => Math.max(0, page - 1)); return; }
    if (match('[data-shop-page-next]')) {
      const pack = getActivePack();
      if (pack) setCardPage((page) => Math.min(Math.ceil(pack.cards.length / pageSize) - 1, page + 1));
      return;
    }
    if (match('.shop-card[data-card-id]')) {
      const card = getActivePack()?.cards.find((item) => String(item.id) === match('.shop-card[data-card-id]').dataset.cardId);
      if (card) {
        detailReturnPanel.current = 'shop';
        setDetailCard(card);
      }
      return;
    }
    if (match('[data-reveal-bulk-card]')) {
      const reward = revealRewards[Number(match('[data-reveal-bulk-card]').dataset.revealBulkCard)];
      if (reward) {
        detailReturnPanel.current = 'reveal';
        setDetailCard(reward);
      }
      return;
    }
    if (match('[data-shop-buy]')) {
      const pack = getActivePack();
      if (!pack) return;
      const packCount = Number(match('[data-shop-buy]').dataset.shopBuy);
      clearRevealTimers();
      setBuying(true);
      try {
        const result = await requestJson('/api/shop/purchase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pack_id: pack.id, pack_count: packCount })
        });
        setShopState(result);
        setWallet(result.wallet);
        setRevealPack(result.packs.find((item) => item.id === pack.id));
        setRevealRewards(result.rewards || []);
        setRevealIndex(0);
        setReveal3DReady(false);
        setRevealStage('cover');
        setPanel('reveal');
      } catch (error) { notify(error.message || 'Không mua được gói bài.'); }
      finally { setBuying(false); }
      return;
    }
    if (match('[data-shop-reset]')) { setResetOpen(true); return; }
    if (match('[data-shop-reset-cancel]')) { setResetOpen(false); return; }
    if (match('[data-shop-reset-confirm]')) {
      const pack = getActivePack();
      if (!pack) return;
      try {
        const result = await requestJson('/api/shop/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pack_id: pack.id })
        });
        setShopState(result);
        setWallet(result.wallet);
        setResetOpen(false);
        notify('Đã tạo lại gói bài. Các lá bài đã trở về trạng thái ban đầu.');
      } catch (error) { notify(error.message || 'Không thể tạo lại gói bài.'); }
      return;
    }
    if (match('[data-reveal-pack]')) {
      if (revealStage === 'cover') {
        setRevealStage('opening');
        scheduleRevealTimer('open', () => {
          if (stateRef.current.revealStage === 'opening') setRevealStage('back');
        }, 1250);
      }
      return;
    }
    if (match('[data-reveal-quick-open]')) {
      clearRevealTimers();
      setQuickConfirm(true);
      return;
    }
    if (match('[data-reveal-quick-cancel]')) { setQuickConfirm(false); return; }
    if (match('[data-reveal-quick-confirm]')) {
      setQuickConfirm(false);
      clearRevealTimers();
      setRevealStage('bulk');
      return;
    }
    if (match('[data-reveal-card]')) {
      if (revealStage === 'back') {
        clearRevealTimers();
        setRevealStage('flipping');
        scheduleRevealTimer('flip-front', () => {
          if (stateRef.current.revealStage === 'flipping') setRevealStage('front');
        }, 900);
        scheduleRevealTimer('enter-3d', () => {
          if (stateRef.current.revealStage === 'front') {
            setReveal3DReady(false);
            setRevealStage('3d');
          }
        }, 1450);
      }
      return;
    }
    if (match('[data-reveal-next]')) {
      clearRevealTimers();
      if (revealStage === 'bulk' || revealIndex + 1 >= revealRewards.length) {
        setPanel('shop');
        setRevealStage('closed');
      } else {
        setRevealIndex((index) => index + 1);
        setReveal3DReady(false);
        setRevealStage('back');
      }
    }
  };

  const handleSubmit = async (event) => {
    if (event.target.id !== 'profileNameForm') return;
    event.preventDefault();
    const nextName = nameDraft.trim();
    if (!nextName) return;
    setSavingName(true);
    try {
      const result = await requestJson('/api/profile/player-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_name: nextName })
      });
      setUserName(result.player_name);
      setNameDraft(result.player_name);
      notify('Đã cập nhật tên người chơi.');
    } catch (error) { notify(error.message || 'Không thể cập nhật tên người chơi.'); }
    finally { setSavingName(false); }
  };

  stateRef.current = { handleClick, handleSubmit, revealStage };
  useEffect(() => {
    const click = (event) => stateRef.current.handleClick(event);
    const submit = (event) => stateRef.current.handleSubmit(event);
    const keydown = (event) => {
      if (event.key !== 'Escape') return;
      if (detailCard) {
        setDetailCard(null);
        if (detailReturnPanel.current === 'shop' || detailReturnPanel.current === 'reveal') {
          setPanel(detailReturnPanel.current);
        }
        detailReturnPanel.current = '';
      } else if (resetOpen) setResetOpen(false);
      else if (panel === 'reveal') {
        clearRevealTimers();
        setPanel('shop');
        setRevealStage('closed');
      }
      else if (panel) closePanel();
    };
    document.addEventListener('click', click);
    document.addEventListener('submit', submit);
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('click', click);
      document.removeEventListener('submit', submit);
      document.removeEventListener('keydown', keydown);
    };
  }, [detailCard, resetOpen, panel]);

  const selectedCharacter = characters[activeCharacter] || characters['jonouchi-katsuya'];
  const previewCharacter = characters[pendingCharacter] || selectedCharacter;
  const activePack = getActivePack();
  const visibleShopCards = activePack?.cards.slice(cardPage * pageSize, (cardPage + 1) * pageSize) || [];
  const filteredLibraryCards = libraryCards.filter((card) => card.category === libraryCategory);
  const currentReward = revealRewards[revealIndex];
  const shopPageCount = activePack ? Math.max(1, Math.ceil(activePack.cards.length / pageSize)) : 1;
  const ownedShopKinds = activePack?.cards.filter((card) => Number(card.ownedQuantity) > 0).length || 0;
  const ownedShopCopies = activePack?.cards.reduce((total, card) => total + (Number(card.ownedQuantity) || 0), 0) || 0;
  const remainingShopCopies = activePack?.cards.reduce((total, card) => total + Math.max(0, (Number(card.maxCopies) || 3) - (Number(card.ownedQuantity) || 0)), 0) || 0;
  return (
    <>


<div className="orientation-lock" role="status" aria-live="polite">
  <div className="orientation-lock__panel">
    <svg className="orientation-lock__icon" viewBox="0 0 64 64" aria-hidden="true">
      <rect x="20" y="7" width="24" height="42" rx="4"></rect>
      <path d="M28 42h8M12 23a22 22 0 0 1 39-10M51 13v8h-8M52 41a22 22 0 0 1-39 10M13 51v-8h8"></path>
    </svg>
    <h1>Xoay ngang thiết bị</h1>
    <p>Vui lòng xoay ngang màn hình để tiếp tục chơi.</p>
  </div>
</div>

{/* Nền video sảnh; ảnh poster và SVG bên dưới làm phương án dự phòng. */}
<video className="lobby-video" autoPlay loop playsInline preload="metadata"
    onLoadedData={() => document.body.classList.add('has-bg')}
    onPlaying={() => document.body.classList.add('has-bg')}
    onError={(event) => console.error('Lobby background video failed to load:', event.currentTarget.error)}
    poster="/assets/images/backgrounds/background.png" aria-hidden="true">
  <source src="/assets/videos/Background.mp4" type="video/mp4" />
</video>
<div className="bg-image bg-image--lobby" aria-hidden="true"></div>

{/* ============================================================
     NỀN PHONG CẢNH DỰ PHÒNG (SVG – tự ẩn khi đã có ảnh nền)
     ============================================================ */}
<svg className="scene" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <linearGradient id="gSky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#4f9ed6"/>
      <stop offset=".42" stopColor="#a6d4ec"/>
      <stop offset=".68" stopColor="#e6f4fa"/>
      <stop offset="1" stopColor="#c2dbe6"/>
    </linearGradient>
    <radialGradient id="gSun" cx=".68" cy=".2" r=".5">
      <stop offset="0" stopColor="#fffbe8" stopOpacity=".95"/>
      <stop offset="1" stopColor="#fffbe8" stopOpacity="0"/>
    </radialGradient>
    <linearGradient id="gFar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#4d7ba0"/><stop offset="1" stopColor="#9dc0d6"/>
    </linearGradient>
    <linearGradient id="gMid" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#6b9ab8"/><stop offset="1" stopColor="#b7d2e0"/>
    </linearGradient>
    <linearGradient id="gRock" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#a7b6b3"/><stop offset="1" stopColor="#46565a"/>
    </linearGradient>
    <filter id="b1"><feGaussianBlur stdDeviation="14"/></filter>
    <filter id="b2"><feGaussianBlur stdDeviation="30"/></filter>

    {/* ngôi chùa dùng lại nhiều lần */}
    <g id="pg">
      <rect x="-46" y="-34" width="92" height="36" fill="#8d5f42"/>
      <path d="M-76 -34 Q0 -84 76 -34 L62 -4 L-62 -4 Z" fill="#5d3d2c"/>
      <rect x="-58" y="-118" width="116" height="36" fill="#8d5f42"/>
      <path d="M-94 -118 Q0 -172 94 -118 L78 -86 L-78 -86 Z" fill="#5d3d2c"/>
      <rect x="-70" y="-206" width="140" height="38" fill="#8d5f42"/>
      <path d="M-110 -206 Q0 -264 110 -206 L92 -172 L-92 -172 Z" fill="#5d3d2c"/>
      <rect x="-3" y="-272" width="6" height="70" fill="#d9b25f"/>
      <path d="M0 -300 L7 -272 L-7 -272 Z" fill="#f0d48a"/>
    </g>
  </defs>

  <rect width="1600" height="900" fill="url(#gSky)"/>
  <rect width="1600" height="900" fill="url(#gSun)"/>

  <g className="clouds" fill="#ffffff" opacity=".62" filter="url(#b2)">
    <ellipse cx="300" cy="196" rx="240" ry="46"/>
    <ellipse cx="600" cy="140" rx="180" ry="34"/>
    <ellipse cx="1130" cy="182" rx="270" ry="46"/>
    <ellipse cx="1470" cy="250" rx="190" ry="36"/>
  </g>

  <path d="M0 520 L120 430 L230 486 L340 356 L470 468 L580 398 L700 500 L820 428 L950 512 L1080 420 L1200 502 L1330 396 L1460 490 L1600 430 L1600 900 L0 900 Z" fill="url(#gFar)" opacity=".7"/>
  <path d="M0 606 L150 520 L280 572 L420 466 L560 562 L700 498 L860 592 L1000 518 L1150 602 L1300 520 L1450 592 L1600 540 L1600 900 L0 900 Z" fill="url(#gMid)" opacity=".92"/>

  <rect x="1036" y="470" width="84" height="330" fill="#eef9ff" opacity=".5" filter="url(#b1)"/>
  <rect x="1206" y="520" width="52" height="270" fill="#eef9ff" opacity=".34" filter="url(#b1)"/>

  <use href="#pg" transform="translate(980,586) scale(1.12)"/>
  <use href="#pg" transform="translate(226,520) scale(.62)" opacity=".85"/>
  <use href="#pg" transform="translate(1436,556) scale(.72)" opacity=".9"/>

  <g fill="#ffffff" opacity=".42" filter="url(#b2)">
    <ellipse cx="820" cy="682" rx="720" ry="58"/>
    <ellipse cx="380" cy="742" rx="430" ry="42"/>
    <ellipse cx="1280" cy="726" rx="360" ry="38"/>
  </g>

  <path d="M0 764 L170 726 L430 706 L660 744 L910 704 L1180 734 L1420 706 L1600 744 L1600 900 L0 900 Z" fill="url(#gRock)"/>
  <path d="M0 764 L170 726 L430 706 L660 744 L910 704 L1180 734 L1420 706 L1600 744" fill="none" stroke="#d8ece2" strokeWidth="3" opacity=".45"/>
</svg>

{/* ============================================================
     NHÂN VẬT
    👉 Bỏ ảnh nhân vật vào backend/assets/images/hero/
        (nên dùng ảnh PNG nền trong suốt, cao ~900–1200px)
     ============================================================ */}
<div className={`duelist${duelistEmpty ? ' is-empty' : ''}`} id="duelist">
  <img className="duelist__img" id="duelistImg"
      src={selectedCharacter.image} alt={selectedCharacter.name} onError={() => setDuelistEmpty(true)} onLoad={() => setDuelistEmpty(false)} />
  <span className="duelist__wind" id="duelistWind" aria-hidden="true"></span>

  {/* Khung này tự hiện lên khi chưa có ảnh */}
  <div className="duelist__ph" aria-hidden="true">
    <span className="duelist__ph-icon">🖼️</span>
    <b>Chưa có ảnh nhân vật</b>
    <small>Thêm ảnh vào thư mục: backend/assets/images/hero/</small>
  </div>
</div>

{/* ============================================================
     THẺ NGƯỜI CHƠI  (VIP · avatar · tên · cấp)
     ============================================================ */}
<button className="pcard" type="button" data-js="profile-open" aria-haspopup="dialog" aria-controls="profileModal" aria-label="Mở hồ sơ người chơi">
  <span className="pcard__vip">VIP<b>1</b></span>
  <span className="pcard__avatar">
    <img id="profileCardAvatar" src={selectedCharacter.image} alt="" />
  </span>
  <span className="pcard__body">
    <span className="pcard__name">{userName}</span>
    <span className="pcard__bar">
      <i style={{ width: '78%' }}></i>
      <span className="pcard__lv">4</span>
    </span>
  </span>
</button>

{/* badge thư bên trái */}
<button className="side-badge" data-soon="Thư">
  <span className="side-badge__num">40</span>
  <svg viewBox="0 0 24 24" className="ico"><path d="M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zm0 2v12h16V6H4zm8 6L5.5 7.5h13L12 12z" fill="currentColor"/></svg>
</button>

{/* ============================================================
     TIỀN TỆ (góc trên phải)
     ============================================================ */}
<div className="currency">
  <div className="currency__item currency__item--gold">
    <img className="currency__icon" src="assets/images/currency/gold.png" alt="" aria-hidden="true" />
    <span data-wallet-gold>{formatCurrency(wallet.gold)}</span>
    <button className="currency__plus" type="button" data-gem-exchange-open aria-label="Mở đổi gem sang vàng">+</button>
  </div>
  <div className="currency__item currency__item--gem">
    <img className="currency__icon" src="assets/images/currency/gem.png" alt="" aria-hidden="true" />
    <span data-wallet-gems>{formatCurrency(wallet.gems)}</span>
    <button className="currency__plus" type="button" data-gem-exchange-open aria-label="Mở đổi gem sang vàng">+</button>
  </div>
</div>

{/* ============================================================
     HÀNG ICON TRÒN (Vương miện · Nhiệm vụ · Thư viện · Xếp hạng · Thư · Biên tập)
     ============================================================ */}
<nav className="roundbar">
  <button className="rbtn" data-soon="Thần Bái"><span>👑</span></button>
  <button className="rbtn" data-soon="Nhiệm Vụ"><span>📋</span></button>
  <button className="rbtn" type="button" data-js="btn-library" aria-haspopup="dialog" aria-controls="libraryModal" aria-label="Mở thư viện bài"><span>📖</span></button>
  <button className="rbtn" data-soon="Hạng"><span>📊</span></button>
  <button className="rbtn" data-soon="Thư"><span>✉️</span><i className="rbtn__dot">4</i></button>
  <button className="rbtn" data-soon="Biên Danh"><span>🖊️</span><i className="rbtn__dot">1</i></button>
</nav>

{/* ============================================================
     ICON TRÁI
     ============================================================ */}
<div className="left-icons">
  <button className="bigicon" data-soon="Hoạt Động">
    <span className="bigicon__art">🎁</span><span className="bigicon__label">Hoạt Động</span>
  </button>
  <button className="bigicon" data-soon="Quà Nạp Lần Đầu">
    <span className="bigicon__art">🎀</span><span className="bigicon__label">Quà Nạp Lần Đầu</span>
  </button>
</div>

{/* ============================================================
     CỤM LỤC GIÁC (menu chính giữa-phải)
     ============================================================ */}
<div className="hexes">
  <canvas className="hexes__3d-frame" aria-hidden="true"></canvas>
  <button className="hex hex--1" data-soon="Bộ Bài">
    <span className="hex__art" aria-hidden="true">
      <svg className="hex__icon" viewBox="0 0 48 48" fill="none"><path d="M14 7h24a3 3 0 0 1 3 3v29a3 3 0 0 1-3 3H14a3 3 0 0 1-3-3V10a3 3 0 0 1 3-3Z"/><path d="M7 13v25a3 3 0 0 0 3 3h24M18 16h18M18 22h18M18 28h13"/></svg>
    </span>
    <span className="hex__label">Bộ Bài</span>
    <i className="hex__badge">513</i>
  </button>

  <button className="hex hex--2" data-js="btn-store">
    <span className="hex__art" aria-hidden="true">
      <svg className="hex__icon" viewBox="0 0 48 48" fill="none"><path d="m7 18 4-10h26l4 10v4H7v-4ZM10 22v19h28V22M18 41V28h9v13M31 29h4v6h-4"/><path d="m11 8-2 10m10-10-1 10m10-10 1 10m9-10 2 10"/></svg>
    </span>
    <span className="hex__label">Tiệm Bài</span>
  </button>

  <button className="hex hex--vs" data-js="btn-duel">
    <span className="hex__art hex__art--vs">VS</span>
    <span className="hex__label">Đấu Trường</span>
  </button>

  <button className="hex hex--3" data-soon="Hộp Ma Thuật">
    <span className="hex__art" aria-hidden="true">
      <svg className="hex__icon" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="19" r="12"/><path d="m24 10 2.4 6.6L33 19l-6.6 2.4L24 28l-2.4-6.6L15 19l6.6-2.4L24 10ZM17 34h14m-11 4h8m-4-5v-5"/><path d="m9 10 1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Zm30 6 1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Z"/></svg>
    </span>
    <span className="hex__label">Hộp Ma Thuật</span>
  </button>

  <button className="hex hex--4" data-soon="Thời Trang">
    <span className="hex__art" aria-hidden="true">
      <svg className="hex__icon" viewBox="0 0 48 48" fill="none"><path d="m16 8 8 4 8-4 10 6-5 9-5-3v20H16V20l-5 3-5-9 10-6Z"/><path d="M19 9c0 4 2 7 5 7s5-3 5-7M16 20h16"/></svg>
    </span>
    <span className="hex__label">Thời Trang</span>
  </button>
</div>

{/* ============================================================
     THANH DƯỚI (Thành Tựu · Nhân Vật · Hướng Dẫn · Thám Hiểm · Phiêu Lưu)
     ============================================================ */}
<nav className="bottombar">
  <button className="bbtn bbtn--chest" data-soon="Thành Tựu">
    <span className="bbtn__art">🗄️</span><span className="bbtn__label">Thành Tựu</span>
  </button>

  <button className="bbtn bbtn--face" type="button" data-js="btn-characters">
    <span className="bbtn__art">🧑</span><span className="bbtn__label">Nhân Vật</span>
  </button>

  <div className="bottombar__gap"></div>

  <button className="bbtn bbtn--scroll" data-soon="Hướng Dẫn Tân Thủ">
    <i className="bbtn__badge">14</i>
    <span className="bbtn__art">📜</span><span className="bbtn__label">Hướng Dẫn Tân Thủ</span>
  </button>

  <button className="bbtn bbtn--map" data-soon="Thám Hiểm">
    <span className="bbtn__art">🗺️</span><span className="bbtn__label">Thám Hiểm</span>
  </button>

  <button className="bbtn bbtn--wheel" data-soon="Phiêu Lưu">
    <span className="bbtn__art">⚙️</span><span className="bbtn__label">Phiêu Lưu</span>
  </button>
</nav>

<div className={`toast${toast ? ' is-show' : ''}${exchangeState ? ` gem-exchange-toast--${exchangeState}` : ''}`} id="toast" role="status" aria-live="polite">{toast}</div>

<section className={`gem-exchange${panel === 'exchange' ? ' is-open' : ''}`} id="gemExchange" hidden={panel !== 'exchange'}>
  <button className="gem-exchange__scrim" type="button" data-gem-exchange-close aria-label="Đóng đổi gem"></button>
  <div className="gem-exchange__panel" role="dialog" aria-modal="true" aria-labelledby="gemExchangeTitle" tabIndex="-1">
    <header className="gem-exchange__header">
      <div className="gem-exchange__emblem" aria-hidden="true">
        <img src="assets/images/currency/gold.png" alt="" />
      </div>
      <div>
        <span className="gem-exchange__eyebrow">KHO BÁU DUELIST</span>
        <h2 id="gemExchangeTitle">Đổi Gem</h2>
      </div>
      <button className="gem-exchange__close" type="button" data-gem-exchange-close aria-label="Đóng">×</button>
    </header>
    <p className="gem-exchange__balance">
      <span>Gem hiện có</span>
      <span className="gem-exchange__balance-value">
        <img src="assets/images/currency/gem.png" alt="" aria-hidden="true" />
        <strong data-exchange-balance>{panel === 'exchange' ? formatCurrency(wallet.gems) : '—'}</strong>
      </span>
    </p>
    <div className="gem-exchange__options" aria-label="Chọn mức đổi">
      <div className="gem-exchange__row">
        <span className="gem-exchange__rate"><img className="gem-exchange__gem" src="assets/images/currency/gem.png" alt="Gem" /><strong>100</strong><i>➜</i><img className="gem-exchange__gold" src="assets/images/currency/gold.png" alt="Vàng" /><strong>1.000</strong></span>
        <button className="gem-exchange__button" type="button" data-exchange-gems="100" disabled={exchanging || wallet.gems < 100}>Đổi</button>
      </div>
      <div className="gem-exchange__row">
        <span className="gem-exchange__rate"><img className="gem-exchange__gem" src="assets/images/currency/gem.png" alt="Gem" /><strong>1.000</strong><i>➜</i><img className="gem-exchange__gold" src="assets/images/currency/gold.png" alt="Vàng" /><strong>10.000</strong></span>
        <button className="gem-exchange__button" type="button" data-exchange-gems="1000" disabled={exchanging || wallet.gems < 1000}>Đổi</button>
      </div>
      <div className="gem-exchange__row">
        <span className="gem-exchange__rate"><img className="gem-exchange__gem" src="assets/images/currency/gem.png" alt="Gem" /><strong>6.000</strong><i>➜</i><img className="gem-exchange__gold" src="assets/images/currency/gold.png" alt="Vàng" /><strong>60.000</strong></span>
        <button className="gem-exchange__button" type="button" data-exchange-gems="6000" disabled={exchanging || wallet.gems < 6000}>Đổi</button>
      </div>
    </div>
    <p className={`gem-exchange__message${exchangeMessage ? ' is-visible' : ''}${exchangeState ? ` is-${exchangeState}` : ''}`} data-exchange-message aria-live="polite">{exchangeMessage}</p>
  </div>
</section>

<section className="profile-modal" id="profileModal" hidden={panel !== 'profile'} aria-labelledby="profileTitle">
  <button className="profile-modal__scrim" type="button" data-profile-close aria-label="Đóng hồ sơ"></button>
  <div className="profile-modal__panel" role="dialog" aria-modal="true">
    <header className="profile-modal__header">
      <div>
        <span className="profile-modal__eyebrow">DUELIST ACCOUNT</span>
        <h2 id="profileTitle">Hồ sơ người chơi</h2>
      </div>
      <button className="profile-modal__close" type="button" data-profile-close aria-label="Đóng">×</button>
    </header>

    <div className="profile-modal__identity">
      <div className="profile-modal__portrait">
        <img id="profileAvatar" src={selectedCharacter.image} alt="Nhân vật đại diện" />
        <span>VIP 1</span>
      </div>
      <div className="profile-modal__identity-info">
        <span className="profile-modal__section-label">PLAYER NAME</span>
        <form className="profile-name-form" id="profileNameForm">
          <label htmlFor="profileNameInput">Tên người chơi</label>
          <div className="profile-name-form__row">
            <input id="profileNameInput" name="player_name" type="text" maxLength="24" autoComplete="nickname" required value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} />
            <button type="submit" disabled={savingName}>Lưu tên</button>
          </div>
        </form>
      </div>
      <div className="profile-modal__level">
        <div><span>CẤP</span><b>4</b><strong>100 <small>/ 550 XP</small></strong></div>
        <div className="profile-modal__xp"><i></i></div>
      </div>
    </div>

    <div className="profile-modal__actions" aria-label="Tùy chọn hồ sơ">
      <button className="profile-action" type="button" data-profile-action="nickname"><span>✎</span>Đổi nickname</button>
      <button className="profile-action" type="button" data-profile-action="avatar"><span>◉</span>Đổi hình đại diện</button>
      <button className="profile-action" type="button" data-profile-action="frame"><span>▣</span>Đổi khung đại diện</button>
      <button className="profile-action" type="button" data-profile-action="cardback"><span>▤</span>Đổi mặt sau bài</button>
    </div>

    <div className="profile-modal__settings">
      <span className="profile-modal__section-label">CÀI ĐẶT ÂM THANH</span>
      <div className="profile-modal__toggles">
        <button className={`profile-toggle${soundEnabled ? '' : ' is-off'}`} id="soundEffectsBtn" type="button" aria-pressed={soundEnabled}>
          <span className="profile-toggle__symbol">♫</span>
          <span className="profile-toggle__text"><strong>Âm thanh</strong><small data-sound-state>{soundEnabled ? 'Đang bật' : 'Đang tắt'}</small></span>
          <span className="profile-toggle__switch" aria-hidden="true"></span>
        </button>
      </div>
    </div>

    <footer className="profile-modal__footer">
      <span>Tài khoản đăng nhập · thông tin tài khoản lưu trên máy chủ</span>
      <button className="profile-modal__logout" id="profileLogout" type="button"><span>↪</span> Đăng xuất</button>
    </footer>
  </div>
</section>

<section className="library-screen" id="libraryModal" aria-label="Thư viện bài" hidden={panel !== 'library'}>
  <header className="library-screen__topbar">
    <button className="library-screen__back" type="button" data-library-close aria-label="Quay về sảnh">
      <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M14 4 2 16l12 12v-7h16V11H14z" fill="currentColor"/></svg>
      <span>Về sảnh</span>
    </button>
    <h1 id="libraryTitle">Thư Viện</h1>
  </header>

  <aside className="library-screen__sidebar" aria-label="Phân loại bài">
    <h2>Danh mục</h2>
    <div className="library-screen__categories">
      <button className={`library-category${libraryCategory === 'monster' ? ' is-selected' : ''}`} type="button" data-library-tab="monster" aria-pressed={libraryCategory === 'monster'}>
        <span aria-hidden="true">✦</span><b>Quái thú</b>
      </button>
      <button className={`library-category${libraryCategory === 'spell' ? ' is-selected' : ''}`} type="button" data-library-tab="spell" aria-pressed={libraryCategory === 'spell'}>
        <span aria-hidden="true">✧</span><b>Phép</b>
      </button>
      <button className={`library-category${libraryCategory === 'trap' ? ' is-selected' : ''}`} type="button" data-library-tab="trap" aria-pressed={libraryCategory === 'trap'}>
        <span aria-hidden="true">◇</span><b>Bẫy</b>
      </button>
      <button className={`library-category${libraryCategory === 'fusion' ? ' is-selected' : ''}`} type="button" data-library-tab="fusion" aria-pressed={libraryCategory === 'fusion'}>
        <span aria-hidden="true">⬡</span><b>Dung hợp</b>
      </button>
    </div>
  </aside>

  <main className="library-screen__stage" role="region" aria-label="Bộ sưu tập bài">
    <div className="library-screen__toolbar">
      <div className="library-screen__count" aria-live="polite">{filteredLibraryCards.length} <span>/</span> {filteredLibraryCards.length} <small>lá bài</small></div>
      <button className="library-screen__filter" type="button" disabled>Chọn lọc</button>
    </div>
    <div className="library-screen__grid" aria-live="polite" aria-label="Danh sách lá bài">
      {libraryError
        ? <p className="library-screen__empty library-screen__empty--error">{libraryError}</p>
        : !libraryLoaded
          ? <p className="library-screen__empty">Đang tải thư viện bài…</p>
          : filteredLibraryCards.map((card) => (
            <button key={card.id} type="button" className={`library-card library-card--${card.category}`} data-card-id={card.id} aria-label={`Xem thông tin lá ${card.name}`}>
            <LibraryArtwork card={card} />
            </button>
          ))}
    </div>
  </main>
  {detailCard && createPortal(<div className="card-detail" id="cardDetail">
    <div className="card-detail__backdrop" data-card-detail-close></div>
    <section className="card-detail__dialog" role="dialog" aria-modal="true" aria-labelledby="cardDetailTitle" tabIndex="-1">
      <button className="card-detail__close" type="button" data-card-detail-close aria-label="Đóng thông tin lá bài">×</button>
      <div className="card-detail__info">
        <h2 id="cardDetailTitle">{detailCard?.name || 'Thông tin'}</h2>
        <section className="card-detail__section">
          <h3>Loại</h3>
          <p data-card-detail-type>{detailCard ? (detailCard.category === 'monster' || detailCard.category === 'fusion' ? `${detailCard.race || ''} - ${detailCard.category === 'fusion' ? 'Dung hợp - ' : ''}${detailCard.monsterType || ''}` : `${detailCard.category === 'spell' ? 'Phép' : 'Bẫy'} - ${detailCard[`${detailCard.category}Type`] || ''}`) : ''}</p>
        </section>
        <section className="card-detail__section">
          <h3>Từ khóa</h3>
          <p data-card-detail-keyword>{detailCard?.keyword || '—'}</p>
        </section>
        <section className="card-detail__section" hidden={detailCard?.category === 'spell' || detailCard?.category === 'trap'}>
          <h3>Miêu tả</h3>
          <p data-card-detail-description>{detailCard?.description || ''}</p>
        </section>
        <section className="card-detail__section">
          <h3>Hạn chế</h3>
          <p data-card-detail-limit>{detailCard ? `Trong cùng bộ bài được có tối đa ${detailCard.maxCopies || 3} lá` : ''}</p>
        </section>
        <section className="card-detail__section card-detail__skills" data-card-detail-skills-section hidden={!detailCard?.skills?.length}>
          <h3>Kỹ năng</h3>
          <div data-card-detail-skills>{(detailCard?.skills || []).map((skill, index) => (
            <article className="card-detail__skill" key={`${skill.name || 'skill'}-${index}`}>
              <span className="card-detail__skill-icon">✦</span>
              <div className="card-detail__skill-copy">
                <h4>{skill.name || 'Kỹ năng'}</h4>
                {skill.description && <p>{skill.description}</p>}
                {Array.isArray(skill.effects) && <ol className="card-detail__effect-options">{skill.effects.map((effect, effectIndex) => (
                  <li className="card-detail__effect-option" key={`${effect.name}-${effectIndex}`}>
                    <h5>{effect.name}</h5>
                    {effect.condition && <p className="card-detail__effect-condition">{effect.condition}</p>}
                    {effect.description && <p>{effect.description}</p>}
                    {effect.restriction && <p className="card-detail__effect-restriction">{effect.restriction}</p>}
                  </li>
                ))}</ol>}
              </div>
            </article>
          ))}</div>
        </section>
        <section className="card-detail__section card-detail__fusion" hidden={!detailCard || !(detailCard.category === 'monster' || detailCard.category === 'fusion')}>
          <h3>Dung hợp</h3>
          <div data-card-detail-fusion>{detailCard?.fusion?.length
            ? detailCard.fusion.map((recipe, index) => <div className="card-detail__recipe" key={`fusion-${index}`}>{recipe.materials.map((name, materialIndex) => <React.Fragment key={name}>{materialIndex > 0 && <span className="card-detail__operator">+</span>}<span className="card-detail__fusion-card">{name}</span></React.Fragment>)}<span className="card-detail__operator">=</span><span className="card-detail__fusion-card">{recipe.result}</span></div>)
            : <span className="card-detail__no-fusion">Chưa có công thức dung hợp.</span>}</div>
        </section>
      </div>
      <aside className="card-detail__preview">
        {detailCard && <CardFace card={detailCard} />}
        {!detailCard && <div className="card-detail__card">
          <header className="card-detail__card-header">
            <span data-card-detail-card-name></span>
            <span className="card-detail__attribute" data-card-detail-attribute></span>
            <span data-card-detail-stars aria-label="Cấp lá bài"></span>
          </header>
          <div className="card-detail__card-art">
            <span className="card-detail__rarity" data-card-detail-rarity></span>
            <img data-card-detail-image alt="" />
          </div>
          <div className="card-detail__card-type" data-card-detail-card-type></div>
          <div className="card-detail__stats">
            <div><span>ATK</span><b data-card-detail-atk></b></div>
            <div><span>DEF</span><b data-card-detail-def></b></div>
          </div>
        </div>}
        <p>Số lượng: <b data-card-detail-quantity>{detailCard?.quantity || detailCard?.ownedQuantity || 0}</b></p>
        <p>Phiên bản: bản thử nghiệm</p>
        <button type="button" className="card-detail__collect" disabled>Bộ sưu tập</button>
      </aside>
    </section>
  </div>, document.body)}
</section>

<section className={`card-shop${activePack ? ' has-pack-detail' : ''}`} id="cardShop" aria-label="Tiệm Bài" hidden={panel !== 'shop' && panel !== 'reveal'} inert={panel === 'reveal'}>
  <header className="card-shop__topbar">
    <button className="card-shop__back" type="button" data-js="shop-back" aria-label="Quay lại">
      <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M14 4 2 16l12 12v-7h16V11H14z" fill="currentColor"/></svg>
      <span>Quay lại</span>
    </button>
    <h1 className="card-shop__title">Tiệm Bài</h1>
    <div className="card-shop__wallet" aria-label="Tài nguyên">
      <div className="currency__item currency__item--gold">
        <img className="currency__icon" src="assets/images/currency/gold.png" alt="" aria-hidden="true" />
        <b data-wallet-gold>{formatCurrency(wallet.gold)}</b>
        <button className="currency__plus" type="button" data-gem-exchange-open aria-label="Mở đổi gem sang vàng">+</button>
      </div>
      <div className="currency__item currency__item--gem">
        <img className="currency__icon" src="assets/images/currency/gem.png" alt="" aria-hidden="true" />
        <b data-wallet-gems>{formatCurrency(wallet.gems)}</b>
        <button className="currency__plus" type="button" data-gem-exchange-open aria-label="Mở đổi gem sang vàng">+</button>
      </div>
    </div>
  </header>

  <aside className={`card-shop__sidebar${activePack ? ' is-pack-detail' : ''}`}>
    <button className="card-shop__category" type="button" aria-current="page">
      <span aria-hidden="true">✦</span>
      <span>Nhân vật<br /><small>Gói bài</small></span>
    </button>
    <div className="card-shop__aside-pack" data-shop-aside-pack hidden={!activePack}>
      <div className="card-shop__aside-pack-art">
        <img data-shop-aside-image src={activePack ? packArtwork[activePack.id] : undefined} alt={activePack?.owner || ''} />
      </div>
      <span data-shop-aside-owner>{activePack?.owner}</span>
      <strong data-shop-aside-title>{activePack?.name}</strong>
    </div>
  </aside>

  <main className={`card-shop__content${activePack ? ' is-detail' : ''}`}>
    <div className="card-shop__heading">
      <span>TIỆM BÀI · GÓI NHÂN VẬT</span>
      <h2>Chọn gói bài</h2>
    </div>
    <div className="card-shop__packs" hidden={Boolean(activePack)}>
      <article className="shop-pack shop-pack--kaiba">
        <div className="shop-pack__art" aria-hidden="true">
          <img className="shop-pack__portrait" src="assets/images/hero/kaiba-seto.png" alt="" />
          <span className="shop-pack__sigil">KC</span><i>白</i>
        </div>
        <div className="shop-pack__info">
          <span className="shop-pack__owner">SET0 KAIBA</span>
          <h3>Rồng Trắng</h3>
          <p>Sức mạnh của rồng xanh mắt trắng</p>
          <button className="shop-pack__select" type="button" data-pack-select="kaiba">Xem gói bài</button>
        </div>
      </article>
      <article className="shop-pack shop-pack--yugi">
        <div className="shop-pack__art" aria-hidden="true">
          <img className="shop-pack__portrait" src="assets/images/hero/muto-yugi.png" alt="" />
          <span className="shop-pack__sigil">千</span><i>✧</i>
        </div>
        <div className="shop-pack__info">
          <span className="shop-pack__owner">YAMI YUGI</span>
          <h3>Vua Trò Chơi</h3>
          <p>Đánh thức sức mạnh ngàn năm</p>
          <button className="shop-pack__select" type="button" data-pack-select="yugi">Xem gói bài</button>
        </div>
      </article>
      <article className="shop-pack shop-pack--jonouchi">
        <div className="shop-pack__art" aria-hidden="true">
          <img className="shop-pack__portrait" src="assets/images/hero/jonouchi-katsuya.png" alt="" />
          <span className="shop-pack__sigil">城</span><i>炎</i>
        </div>
        <div className="shop-pack__info">
          <span className="shop-pack__owner">JONOUCHI KATSUYA</span>
          <h3>Chiến Binh</h3>
          <p>Những lá bài gắn với Jonouchi Katsuya</p>
          <button className="shop-pack__select" type="button" data-pack-select="jonouchi">Xem gói bài</button>
        </div>
      </article>
    </div>
    <section className="shop-detail" id="shopPackDetail" hidden={!activePack} aria-labelledby="shopDetailTitle">
      <header className="shop-detail__header">
        <div>
          <span className="shop-detail__owner" data-shop-pack-owner>{activePack?.owner}</span>
          <h2 id="shopDetailTitle" data-shop-pack-title>{activePack?.name}</h2>
          <p data-shop-pack-description>{activePack?.description}</p>
        </div>
        <div className="shop-detail__count">
          <span data-shop-pack-count>{activePack ? `${activePack.cards.length} lá trong gói` : ''}</span>
          <small className="shop-detail__page-status" data-shop-page-status>{activePack ? `Trang ${cardPage + 1} / ${shopPageCount} · Lá ${cardPage * pageSize + 1}–${Math.min((cardPage + 1) * pageSize, activePack.cards.length)}` : ''}</small>
        </div>
      </header>
      <div className="shop-detail__carousel">
        <button className="shop-detail__page-button" type="button" data-shop-page-prev aria-label={`${pageSize} lá trước`} disabled={!activePack || cardPage === 0}>‹</button>
        <div className="shop-detail__cards" data-shop-card-grid aria-live="polite" aria-label={activePack ? `Lá bài ${cardPage * pageSize + 1} đến ${Math.min((cardPage + 1) * pageSize, activePack.cards.length)} trên ${activePack.cards.length}` : 'Danh sách lá bài'}>
          {visibleShopCards.map((card) => {
            const maxCopies = Number(card.maxCopies) || 3;
            const quantity = Number(card.ownedQuantity) || 0;
            const copiesRemaining = Math.max(0, maxCopies - quantity);
            return <button key={card.id} type="button" className={`shop-card${copiesRemaining === 0 ? ' shop-card--exhausted' : ''}`} data-card-id={card.id} aria-label={`Xem thông tin lá ${card.name}, còn ${copiesRemaining} trên ${maxCopies} bản`}>
              <CardFace card={card} className="shop-card__face" />
              <span className="shop-card__quantity">{copiesRemaining}/{maxCopies}</span>
            </button>;
          })}
        </div>
        <button className="shop-detail__page-button" type="button" data-shop-page-next aria-label={`${pageSize} lá tiếp theo`} disabled={!activePack || cardPage >= shopPageCount - 1}>›</button>
      </div>
      <footer className="shop-detail__purchase">
        <span data-shop-collection-count>{activePack ? `Đã sở hữu ${ownedShopKinds}/${activePack.cards.length} loại · ${ownedShopCopies} bản · Còn ${remainingShopCopies} bản` : ''}</span>
        <div className="shop-detail__buy-buttons" aria-label="Mua gói bài">
          <button type="button" data-shop-buy="1" disabled={!activePack || buying || remainingShopCopies < 1 || wallet.gems < 1}>Mua 1 gói <b><img src="assets/images/currency/gem.png" alt="" aria-hidden="true" />1</b></button>
          <button type="button" data-shop-buy="10" disabled={!activePack || buying || remainingShopCopies < 10 || wallet.gems < 10}>Mua 10 gói <b><img src="assets/images/currency/gem.png" alt="" aria-hidden="true" />10</b></button>
          <button type="button" data-shop-buy="50" disabled={!activePack || buying || remainingShopCopies < 50 || wallet.gold < 30000}>Mua 50 gói <b><img src="assets/images/currency/gold.png" alt="" aria-hidden="true" />30.000</b></button>
        </div>
        <button type="button" className="shop-detail__reset" data-shop-reset>Tạo lại</button>
      </footer>
    </section>
  </main>
</section>

<section className={`shop-reset-confirm${resetOpen ? '' : ''}`} id="shopResetConfirm" hidden={!resetOpen} role="dialog" aria-modal="true" aria-labelledby="shopResetTitle">
  <div className="shop-reset-confirm__scrim" data-shop-reset-cancel></div>
  <div className="shop-reset-confirm__panel">
    <h2 id="shopResetTitle">Đồng ý tạo lại toàn bộ gói bài?</h2>
    <div className="shop-reset-confirm__actions">
      <button type="button" data-shop-reset-cancel>Hủy</button>
      <button type="button" data-shop-reset-confirm disabled={!activePack}>Đồng ý</button>
    </div>
  </div>
</section>

<section className={`shop-reveal${revealStage === 'opening' ? ' is-bursting' : ''}${revealStage === 'bulk' ? ' is-bulk' : ''}${revealStage === '3d' ? ' has-3d-view' : ''}`} id="shopReveal" hidden={panel !== 'reveal'} role="dialog" aria-modal="true" aria-label="Mở gói bài">
  <div className="shop-reveal__scrim"></div>
  <p className="shop-reveal__message" data-reveal-message>{revealStage === 'bulk' ? 'Các lá bài bạn nhận được' : ''}</p>
  <button type="button" className={`shop-reveal__pack${revealPack ? ` shop-pack--${revealPack.id}` : ''}${revealStage === 'opening' ? ' is-opening' : ''}`} data-reveal-pack aria-label="Mở gói bài" hidden={!['cover', 'opening'].includes(revealStage)} disabled={revealStage !== 'cover'}>
    <img className="shop-reveal__pack-art" data-reveal-pack-art src={revealPack ? packArtwork[revealPack.id] : undefined} alt="" aria-hidden="true" />
    <span className="shop-reveal__pack-sigil" data-reveal-sigil>{revealPack?.id === 'kaiba' ? 'KC' : revealPack?.id === 'yugi' ? '千' : '城'}</span>
    <b data-reveal-pack-title>{revealPack?.name}</b>
    <small>NHẤN ĐỂ MỞ</small>
  </button>
  <button type="button" className="shop-reveal__quick-open" data-reveal-quick-open hidden={revealRewards.length <= 1 || !['cover', 'opening', 'back'].includes(revealStage)}>Mở nhanh {revealRewards.length} lá</button>
  <button type="button" className={`shop-reveal__card${revealStage === 'flipping' ? ' is-flipping' : ''}${['flipping', 'front', '3d'].includes(revealStage) ? ' is-revealed' : ''}`} data-reveal-card hidden={!['back', 'flipping', 'front'].includes(revealStage) && !(revealStage === '3d' && !reveal3DReady)} aria-label={currentReward ? `Xem thông tin lá ${currentReward.name}` : 'Lật lá bài'}>
    <span className="shop-reveal__card-inner">
      <CardBack />
      <div className="shop-reveal__card-front" data-reveal-front>{currentReward && <CardFace card={currentReward} className="shop-reveal__card-face" elementRef={revealCardFace} />}</div>
      <span className="shop-reveal__card-flash" aria-hidden="true"></span>
    </span>
  </button>
  <Card3DViewer
    visible={revealStage === '3d'}
    cardFaceRef={revealCardFace}
    cardId={currentReward?.id}
    onReady={() => scheduleRevealTimer('3d-ready', () => setReveal3DReady(true), 520)}
    onActivate={() => {
      if (!currentReward) return;
      detailReturnPanel.current = 'reveal';
      setDetailCard(currentReward);
    }}
    onUnavailable={() => {
      setRevealStage('front');
    }}
  />
  <section className="shop-reveal__bulk" data-reveal-bulk hidden={revealStage !== 'bulk'} aria-label="Các lá bài nhận được">
    <h2 data-reveal-bulk-title>{revealRewards.length} lá bài nhận được</h2>
    <div className="shop-reveal__bulk-grid" data-reveal-bulk-grid>{revealRewards.map((card, index) => <button type="button" className="shop-reveal__bulk-item" data-reveal-bulk-card={index} aria-label={`Xem thông tin lá ${card.name}, nhận ${card.quantity || 1} lá`} key={`${card.id}-${index}`}><CardFace card={card} className="shop-reveal__bulk-card-face" /><span className="shop-reveal__bulk-quantity">{card.quantity || 1}</span></button>)}</div>
  </section>
  <section className="shop-reveal__confirm" data-reveal-confirm hidden={!quickConfirm} role="dialog" aria-modal="true" aria-labelledby="shopRevealConfirmTitle">
    <div className="shop-reveal__confirm-panel">
      <h2 id="shopRevealConfirmTitle">Mở nhanh sẽ bỏ qua trải nghiệm mở bài. Bạn có muốn tiếp tục?</h2>
      <div className="shop-reveal__confirm-actions">
        <button type="button" data-reveal-quick-cancel>Hủy</button>
        <button type="button" data-reveal-quick-confirm>Đồng ý</button>
      </div>
    </div>
  </section>
  <div className={`shop-reveal__magic${revealStage === 'opening' ? ' is-active' : ''}`} data-reveal-magic aria-hidden="true">
    <span className="shop-reveal__magic-core"></span>
    <span className="shop-reveal__magic-sparks"></span>
  </div>
  <button type="button" className="shop-reveal__return" data-reveal-next hidden={!['back', 'front', 'bulk', '3d'].includes(revealStage)}>{revealStage === 'bulk' || revealIndex + 1 >= revealRewards.length ? 'Trở về' : 'Tiếp theo'}</button>
</section>

<section className="character-select" id="characterSelect" aria-label="Đổi nhân vật" hidden={panel !== 'characters'}>
  <header className="character-select__topbar">
    <button className="character-select__back" type="button" data-js="characters-back" aria-label="Quay về sảnh">
      <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M14 4 2 16l12 12v-7h16V11H14z" fill="currentColor"/></svg>
    </button>
    <h1>Đổi nhân vật</h1>
  </header>

  <aside className="character-select__sidebar" aria-label="Chọn nhân vật">
    <h2>Chọn</h2>
    <div className="character-select__list">
      <button className={`character-option${pendingCharacter === 'kaiba-seto' ? ' is-selected' : ''}`} type="button" data-character-choice="kaiba-seto" aria-pressed={pendingCharacter === 'kaiba-seto'}>
        <img src="assets/images/hero/kaiba-seto.png" alt="" loading="lazy" />
        <span>Kaiba Seto</span>
      </button>
      <button className={`character-option${pendingCharacter === 'muto-yugi' ? ' is-selected' : ''}`} type="button" data-character-choice="muto-yugi" aria-pressed={pendingCharacter === 'muto-yugi'}>
        <img src="assets/images/hero/muto-yugi.png" alt="" loading="lazy" />
        <span>Muto Yugi</span>
      </button>
      <button className={`character-option${pendingCharacter === 'jonouchi-katsuya' ? ' is-selected' : ''}`} type="button" data-character-choice="jonouchi-katsuya" aria-pressed={pendingCharacter === 'jonouchi-katsuya'}>
        <img src="assets/images/hero/jonouchi-katsuya.png" alt="" loading="lazy" />
        <span>Jonouchi Katsuya</span>
      </button>
    </div>
  </aside>

  <main className="character-select__stage" aria-label="Nhân vật đang chọn">
    <div className="character-select__floor" aria-hidden="true"></div>
    <img className="character-select__preview" id="characterPreview" src={previewCharacter.image} alt={previewCharacter.name} />
    <div className="character-select__actions">
      <p id="characterPreviewName">{previewCharacter.name}</p>
      <button className="character-select__confirm" type="button" data-js="characters-confirm" disabled={savingCharacter}>Đồng ý</button>
    </div>
  </main>
</section>


    </>
  );
}

export default LobbyPage;
