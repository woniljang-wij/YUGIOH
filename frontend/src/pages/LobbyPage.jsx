import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ArenaModeCanvas from '../components/ArenaModeCanvas.jsx';
import { CardFace } from '../components/CardFace.jsx';
import AttendanceConfirmDialog from '../components/AttendanceConfirmDialog.jsx';
import AttendanceModal from '../components/AttendanceModal.jsx';
import AttendanceRewardDialog from '../components/AttendanceRewardDialog.jsx';
import CardDetailDialog from '../components/CardDetailDialog.jsx';
import CardDismantleDialog from '../components/CardDismantleDialog.jsx';
import DeckBuilder from '../components/DeckBuilder.jsx';
import CurrencyBar from '../components/CurrencyBar.jsx';
import FragmentFusion from '../components/FragmentFusion.jsx';
import ItemShop from '../components/ItemShop.jsx';
import LibraryBackdrop from '../components/LibraryBackdrop.jsx';
import MagicBoxCanvas from '../components/MagicBoxCanvas.jsx';
import MissionModal from '../components/MissionModal.jsx';
import { redrawCardFaceCanvases } from '../renderers/cardFrameRenderer.js';
import { useOnlinePresence } from '../useOnlinePresence.js';

const characters = {
  'kaiba-seto': { name: 'Kaiba Seto', image: 'assets/images/hero/kaiba-seto.png' },
  'muto-yugi': { name: 'Muto Yugi', image: 'assets/images/hero/muto-yugi.png' },
  'jonouchi-katsuya': {
    name: 'Jonouchi Katsuya',
    image: 'assets/images/hero/jonouchi-katsuya.png'
  }
};

const packArtwork = {
  kaiba: '/assets/images/packs/pack-dragon.png',
  yugi: '/assets/images/packs/pack-magician.png',
  jonouchi: '/assets/images/packs/pack-knight.png',
  god: '/assets/images/packs/pack-divine.png'
};
const imageOnlyPackIds = new Set(['kaiba', 'yugi', 'jonouchi']);
const asideImageOnlyPackIds = new Set([...imageOnlyPackIds, 'god']);
const voidPacks = [
  { id: 'god', name: 'Gói bài Thần', symbol: '✦' },
  { id: 'raiya', name: 'Gói bài Lôi Nhã', symbol: '⚡' }
];
const godPackMaterials = [
  { id: 'ur_fragment', name: 'Mảnh UR', image: '/assets/images/items/ur-fragment.png' },
  { id: 'gr_fragment', name: 'Mảnh GR', image: '/assets/images/items/gr-fragment.png' }
];

const formatCurrency = (value) => new Intl.NumberFormat('vi-VN').format(value ?? 0);
const LIBRARY_PAGE_SIZE = 24;
const normalizeCardSearch = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('vi');
const GOLD_PER_PACK = 500;
const GEMS_PER_PACK = 700;
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

  context.setTransform(pixelWidth / 265, 0, 0, pixelHeight / 357, 0, 0);

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
  const [userName, setUserName] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameInfo, setRenameInfo] = useState(null);
  const [renameInfoLoading, setRenameInfoLoading] = useState(false);
  const [wallet, setWallet] = useState({ gold: 0, gems: 0 });
  const [walletLoaded, setWalletLoaded] = useState(false);
  const [walletLoadError, setWalletLoadError] = useState('');
  const [onlinePresence, setOnlinePresence] = useState(null);
  const [activeCharacter, setActiveCharacter] = useState('jonouchi-katsuya');
  const [pendingCharacter, setPendingCharacter] = useState('');
  const [savingCharacter, setSavingCharacter] = useState(false);
  const [needsCharacterSelection, setNeedsCharacterSelection] = useState(false);
  const [progress, setProgress] = useState(null);
  const [unlockedCharacters, setUnlockedCharacters] = useState([]);
  const [characterUnlockLevels, setCharacterUnlockLevels] = useState({});
  const [inventory, setInventory] = useState([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState('');
  const [hoveredInventoryItem, setHoveredInventoryItem] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [useQuantity, setUseQuantity] = useState(1);
  const [usingItem, setUsingItem] = useState(false);
  const [duelistEmpty, setDuelistEmpty] = useState(false);
  const [panel, setPanel] = useState('');
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  const [fragmentFusionOpen, setFragmentFusionOpen] = useState(false);
  const [fragmentMergePending, setFragmentMergePending] = useState(false);
  const [missionOpen, setMissionOpen] = useState(false);
  const [missionSnapshot, setMissionSnapshot] = useState(null);
  const [deckOpen, setDeckOpen] = useState(false);
  const [deckSnapshot, setDeckSnapshot] = useState(null);
  const [deckSelectionMode, setDeckSelectionMode] = useState(false);
  const [arenaView, setArenaView] = useState('closed');
  const [selectingDuelDeck, setSelectingDuelDeck] = useState(false);
  const [startingDuel, setStartingDuel] = useState(false);
  const [toast, setToast] = useState('');
  const [libraryCards, setLibraryCards] = useState([]);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [libraryError, setLibraryError] = useState('');
  const [libraryCategory, setLibraryCategory] = useState('monster');
  const [libraryQuery, setLibraryQuery] = useState('');
  const [librarySort, setLibrarySort] = useState('name');
  const [libraryFilterOpen, setLibraryFilterOpen] = useState(false);
  const [libraryPage, setLibraryPage] = useState(0);
  const [detailCard, setDetailCard] = useState(null);
  const [dismantleConfirmCard, setDismantleConfirmCard] = useState(null);
  const [dismantleCelebration, setDismantleCelebration] = useState(null);
  const [deckRefreshKey, setDeckRefreshKey] = useState(0);
  const [shopState, setShopState] = useState(null);
  const [shopCategory, setShopCategory] = useState('character');
  const [activePackId, setActivePackId] = useState('');
  const [activeVoidPackId, setActiveVoidPackId] = useState('');
  const [cardPage, setCardPage] = useState(0);
  const [pageSize, setPageSize] = useState(getShopPageSize);
  const previousPageSize = useRef(pageSize);
  const [resetOpen, setResetOpen] = useState(false);
  const [buying, setBuying] = useState(false);
  const [godPackCardPending, setGodPackCardPending] = useState(null);
  const [godPackCelebration, setGodPackCelebration] = useState(null);
  const [revealRewards, setRevealRewards] = useState([]);
  const [revealBulkPage, setRevealBulkPage] = useState(0);
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
  const lobbyVideoRef = useRef(null);
  const toastTimer = useRef(0);
  const previousFocus = useRef(null);
  const exchangeReturnPanel = useRef('');
  const detailReturnPanel = useRef('');
  const revealCardFace = useRef(null);
  const revealTimers = useRef({});
  const stateRef = useRef(null);
  const renameRequest = useRef(null);

  useOnlinePresence(setOnlinePresence);

  useEffect(() => {
    const video = lobbyVideoRef.current;
    if (!video) return undefined;

    let active = true;
    let waitingForGesture = false;

    const removeGestureListeners = () => {
      document.removeEventListener('pointerdown', enableAudio);
      document.removeEventListener('keydown', enableAudio);
      waitingForGesture = false;
    };

    const enableAudio = async () => {
      if (!active) return;
      video.volume = 0.45;
      video.muted = false;
      try {
        await video.play();
        removeGestureListeners();
      } catch {
        video.muted = true;
        try {
          await video.play();
        } catch (error) {
          console.error('Không thể phát video nền sảnh:', error);
        }
        if (!waitingForGesture) {
          waitingForGesture = true;
          document.addEventListener('pointerdown', enableAudio);
          document.addEventListener('keydown', enableAudio);
        }
      }
    };

    void enableAudio();
    return () => {
      active = false;
      removeGestureListeners();
    };
  }, []);

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

  const syncWallet = (nextWallet) => {
    if (!nextWallet) return;
    setWallet(nextWallet);
    setWalletLoaded(true);
    setWalletLoadError('');
  };

  const refreshDeckSnapshot = async () => {
    try {
      const result = await requestJson('/api/decks');
      if (!result.snapshot || !Array.isArray(result.snapshot.decks)) {
        throw new Error('Dữ liệu bộ bài bị thiếu.');
      }
      setDeckSnapshot(result.snapshot);
      syncWallet(result.snapshot.wallet);
    } catch (error) {
      console.error('Deck state synchronization failed:', error);
      notify(error.message || 'Không thể đồng bộ dữ liệu bộ bài.');
    }
  };

  const updateDeckNewCount = (count) => {
    setDeckSnapshot((current) => current
      ? { ...current, new_cards_count: count }
      : current);
  };

  const refreshMissionSnapshot = async () => {
    try {
      const result = await requestJson('/api/missions');
      if (!result.snapshot) throw new Error('Dữ liệu nhiệm vụ bị thiếu.');
      setMissionSnapshot(result.snapshot);
    } catch (error) {
      console.error('Mission progress synchronization failed:', error);
      notify('Thao tác đã hoàn tất nhưng chưa đồng bộ được dữ liệu nhiệm vụ. Hãy mở lại Nhiệm Vụ.');
    }
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
        setProgress(result.user.progress);
        setUnlockedCharacters(result.user.unlocked_characters || []);
        setCharacterUnlockLevels(result.user.character_unlock_levels || {});
        const characterId = result.user.selected_character_id;
        setNeedsCharacterSelection(Boolean(result.user.needs_character_selection));
        if (result.user.needs_character_selection) {
          setPendingCharacter('');
          setPanel('characters');
        }
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
      .then((result) => {
        if (cancelled) return;
        setWallet(result.wallet);
        setWalletLoaded(true);
        setWalletLoadError('');
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Wallet loading failed:', error);
        setWalletLoadError(error.message || 'Không thể tải số dư tài khoản.');
      });
    requestJson('/api/missions')
      .then((result) => {
        if (!result.snapshot) throw new Error('Dữ liệu nhiệm vụ bị thiếu.');
        if (!cancelled) setMissionSnapshot(result.snapshot);
      })
      .catch((error) => {
        if (!cancelled) console.error('Mission progress loading failed:', error);
      });
    requestJson('/api/decks')
      .then((result) => {
        if (!result.snapshot || !Array.isArray(result.snapshot.decks)) {
          throw new Error('Dữ liệu bộ bài bị thiếu.');
        }
        if (!cancelled) {
          setDeckSnapshot(result.snapshot);
          syncWallet(result.snapshot.wallet);
        }
      })
      .catch((error) => {
        if (!cancelled) console.error('Deck state loading failed:', error);
      });
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
      .then((result) => {
        if (!cancelled) {
          setShopState(result);
          setInventory(result.inventory || []);
        }
      })
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
      ? document.getElementById('profileNicknameButton')
      : panel === 'item-shop'
        ? document.querySelector('.item-shop__back')
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

  const closeAttendance = () => {
    setAttendanceOpen(false);
    const opener = previousFocus.current;
    if (opener && document.contains(opener)) opener.focus();
  };

  const closeMissions = () => {
    setMissionOpen(false);
    const opener = previousFocus.current;
    if (opener && document.contains(opener)) opener.focus();
  };

  const closeDeck = () => {
    setDeckOpen(false);
    setDeckSelectionMode(false);
    const opener = previousFocus.current;
    if (opener && document.contains(opener)) opener.focus();
  };

  const openArenaDeckBuilder = () => {
    previousFocus.current = document.activeElement;
    setDeckSelectionMode(true);
    setDeckOpen(true);
  };

  const selectArenaDeck = async (deckNumber) => {
    if (selectingDuelDeck) return;
    setSelectingDuelDeck(true);
    try {
      const result = await requestJson('/api/decks/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deck_number: deckNumber })
      });
      if (!result.snapshot
        || !Array.isArray(result.snapshot.decks)
        || result.snapshot.selected_deck_number !== deckNumber) {
        throw new Error('Máy chủ chưa xác nhận được bộ bài đã chọn.');
      }
      setDeckSnapshot(result.snapshot);
      syncWallet(result.snapshot.wallet);
      setDeckOpen(false);
      setDeckSelectionMode(false);
      const deckName = result.snapshot.decks.find((deck) => deck.number === deckNumber)?.name || `Bộ Bài ${deckNumber}`;
      notify(`${deckName} đã được chọn.`);
      window.requestAnimationFrame(() => previousFocus.current?.focus());
    } catch (error) {
      console.error('Duel deck selection failed:', error);
      notify(error.message || 'Không thể lưu bộ bài đã chọn.', 'error');
    } finally {
      setSelectingDuelDeck(false);
    }
  };

  const startArenaDuel = async () => {
    if (startingDuel) return;
    setStartingDuel(true);
    try {
      const result = await requestJson('/api/decks');
      const snapshot = result.snapshot;
      if (!snapshot || !Array.isArray(snapshot.decks)) {
        throw new Error('Dữ liệu bộ bài chưa được đồng bộ đầy đủ.');
      }
      setDeckSnapshot(snapshot);
      syncWallet(snapshot.wallet);
      const selectedNumber = snapshot.selected_deck_number;
      if (!selectedNumber) {
        notify('Vui lòng chọn bộ bài trước khi bắt đầu trận đấu!', 'error');
        openArenaDeckBuilder();
        return;
      }
      const selectedDeck = snapshot.decks.find((deck) => deck.number === selectedNumber);
      if (!selectedDeck) {
        notify('Bộ bài đã chọn không còn tồn tại. Vui lòng chọn lại bộ bài.', 'error');
        openArenaDeckBuilder();
        return;
      }
      if (selectedDeck.duel_error) {
        notify(`Bộ bài chưa hợp lệ: ${selectedDeck.duel_error}`, 'error');
        openArenaDeckBuilder();
        return;
      }
      window.location.href = `/duel.html?mode=ai&deck=${encodeURIComponent(selectedNumber)}`;
    } catch (error) {
      console.error('Could not validate the duel deck:', error);
      notify(error.message || 'Không thể kiểm tra bộ bài trước trận đấu.', 'error');
    } finally {
      setStartingDuel(false);
    }
  };

  const closeRename = () => {
    setRenameOpen(false);
    window.requestAnimationFrame(() => document.getElementById('profileNicknameButton')?.focus());
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

    if (match('[data-js="btn-attendance"]')) {
      previousFocus.current = button;
      setAttendanceOpen(true);
      return;
    }
    if (match('[data-js="btn-missions"]')) {
      previousFocus.current = button;
      setMissionOpen(true);
      return;
    }
    if (match('[data-js="btn-deck"]')) {
      previousFocus.current = button;
      setDeckSelectionMode(false);
      setDeckOpen(true);
      return;
    }
    if (match('[data-js="btn-fragments"]')) {
      previousFocus.current = button;
      setFragmentFusionOpen(true);
      return;
    }
    if (match('[data-soon]')) {
      notify(`🚧 ${match('[data-soon]').dataset.soon} – sắp ra mắt!`);
      return;
    }
    if (match('[data-js="btn-duel"]')) {
      setArenaView('modes');
      return;
    }
    if (match('[data-js="btn-item-shop"]')) {
      previousFocus.current = button;
      setPanel('item-shop');
      return;
    }
    if (match('[data-js="profile-open"]')) {
      previousFocus.current = button;
      setPanel('profile');
      try {
        const result = await requestJson('/api/session');
        if (result.user?.progress) {
          setProgress(result.user.progress);
          setUserName(result.user.player_name || result.user.username || 'Duelist');
        }
      } catch (error) {
        console.error('Could not refresh player progression:', error);
        notify(error.message || 'Không thể tải tiến trình EXP mới nhất.');
      }
      return;
    }
    if (match('[data-profile-close]')) { closePanel(); return; }
    if (match('[data-profile-action="nickname"]')) {
      setNameDraft('');
      setRenameOpen(true);
      setRenameInfoLoading(true);
      requestJson('/api/profile/rename-info')
        .then((result) => {
          setRenameInfo(result);
          setUserName(result.player_name);
        })
        .catch((error) => {
          notify(error.message || 'Không thể tải thông tin đổi tên.', 'error');
          setRenameOpen(false);
        })
        .finally(() => setRenameInfoLoading(false));
      window.requestAnimationFrame(() => document.getElementById('renamePlayerNameInput')?.focus());
      return;
    }
    if (match('[data-rename-close]')) {
      closeRename();
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
    if (match('[data-js="btn-inventory"]')) {
      previousFocus.current = button;
      setSelectedItem(null);
      setInventoryError('');
      setInventoryLoading(true);
      setPanel('inventory');
      try {
        const result = await requestJson('/api/inventory');
        setInventory(result.inventory);
        setProgress(result.progress);
      } catch (error) {
        setInventoryError(error.message || 'Không thể tải Hộp ma thuật.');
      } finally {
        setInventoryLoading(false);
      }
      return;
    }
    if (match('[data-inventory-close]')) {
      if (selectedItem) setSelectedItem(null);
      else closePanel();
      return;
    }
    if (match('[data-inventory-item]')) {
      const item = inventory.find(
        (ownedItem) => ownedItem.id === match('[data-inventory-item]').dataset.inventoryItem
      );
      if (item) {
        setUseQuantity(1);
        setSelectedItem(item);
      }
      return;
    }
    if (match('[data-item-use]')) {
      if (!selectedItem || usingItem) return;
      setUsingItem(true);
      try {
        const result = await requestJson('/api/inventory/use', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            item_id: selectedItem.id,
            quantity: useQuantity,
            request_id: window.crypto.randomUUID()
          })
        });
        const previousLevel = progress?.level || 1;
        setInventory(result.inventory);
        setSelectedItem(result.inventory.find((item) => item.id === selectedItem.id) || null);
        setProgress(result.progress);
        setUnlockedCharacters((current) => [...new Set([...current, ...result.unlocked_characters])]);
        const unlockedNames = result.unlocked_characters
          .map((characterId) => characters[characterId]?.name || characterId);
        const levelMessage = result.progress.level > previousLevel
          ? ` Lên cấp ${result.progress.level}!${unlockedNames.length ? ` Đã mở khóa: ${unlockedNames.join(', ')}.` : ''}`
          : '';
        notify(`${result.message}${levelMessage}`, 'success');
      } catch (error) {
        notify(error.message || 'Không thể sử dụng vật phẩm.', 'error');
      } finally {
        setUsingItem(false);
      }
      return;
    }
    if (match('[data-library-close]')) { setDetailCard(null); closePanel(); return; }
    if (match('[data-library-tab]')) {
      setLibraryCategory(match('[data-library-tab]').dataset.libraryTab);
      setDetailCard(null);
      setLibraryPage(0);
      return;
    }
    if (match('[data-library-filter-toggle]')) {
      setLibraryFilterOpen((current) => !current);
      return;
    }
    if (match('[data-library-filter-reset]')) {
      setLibraryQuery('');
      setLibrarySort('name');
      setLibraryPage(0);
      return;
    }
    if (match('[data-library-page-prev]')) {
      setLibraryPage((page) => Math.max(0, page - 1));
      return;
    }
    if (match('[data-library-page-next]')) {
      setLibraryPage((page) => page + 1);
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
    if (match('[data-js="characters-back"]')) {
      if (!needsCharacterSelection) closePanel();
      return;
    }
    if (match('[data-character-choice]')) {
      setPendingCharacter(match('[data-character-choice]').dataset.characterChoice);
      return;
    }
    if (match('[data-js="characters-confirm"]')) {
      if (!pendingCharacter) {
        notify('Vui lòng chọn một nhân vật khởi đầu.');
        return;
      }
      setSavingCharacter(true);
      try {
        const result = await requestJson('/api/profile/character', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ character_id: pendingCharacter })
        });
        setActiveCharacter(pendingCharacter);
        setUnlockedCharacters(result.unlocked_characters || []);
        setCharacterUnlockLevels(result.character_unlock_levels || {});
        setNeedsCharacterSelection(false);
        closePanel();
        notify(`Đã chọn ${characters[pendingCharacter].name}`);
      } catch (error) { notify(error.message || 'Không thể lưu nhân vật đã chọn.'); }
      finally { setSavingCharacter(false); }
      return;
    }
    if (match('[data-gem-exchange-open]')) {
      previousFocus.current = button;
      exchangeReturnPanel.current = panel === 'shop' || panel === 'inventory' || panel === 'item-shop' ? panel : '';
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
      setShopCategory('character');
      setActivePackId('');
      setActiveVoidPackId('');
      setCardPage(0);
      setPanel('shop');
      return;
    }
    if (match('[data-js="shop-back"]')) {
      if (activePackId) { setActivePackId(''); setCardPage(0); }
      else if (activeVoidPackId) setActiveVoidPackId('');
      else closePanel();
      return;
    }
    if (match('[data-shop-category]')) {
      setShopCategory(match('[data-shop-category]').dataset.shopCategory);
      setActivePackId('');
      setActiveVoidPackId('');
      setCardPage(0);
      return;
    }
    if (match('[data-pack-select]')) {
      setActivePackId(match('[data-pack-select]').dataset.packSelect);
      setActiveVoidPackId('');
      setCardPage(0);
      return;
    }
    if (match('[data-void-pack-select]')) {
      const packId = match('[data-void-pack-select]').dataset.voidPackSelect;
      if (packId === 'god') {
        setActivePackId(packId);
        setActiveVoidPackId('');
      } else {
        setActivePackId('');
        setActiveVoidPackId(packId);
      }
      setCardPage(0);
      return;
    }
    if (match('[data-void-pack-back]')) {
      setActiveVoidPackId('');
      return;
    }
    if (match('[data-shop-page-prev]')) { setCardPage((page) => Math.max(0, page - 1)); return; }
    if (match('[data-shop-page-next]')) {
      const pack = getActivePack();
      if (pack) setCardPage((page) => Math.min(Math.ceil(pack.cards.length / pageSize) - 1, page + 1));
      return;
    }
    if (match('[data-god-card-redeem]')) {
      const pack = getActivePack();
      const cardId = match('[data-god-card-redeem]').dataset.godCardRedeem;
      if (pack?.id !== 'god' || !cardId) return;
      const card = pack.cards.find((item) => String(item.id) === cardId);
      if (!card || Number(card.ownedQuantity) >= (Number(card.maxCopies) || 1)) return;
      setGodPackCardPending(card);
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
    if (match('[data-reveal-bulk-page-prev]')) {
      setRevealBulkPage((page) => Math.max(0, page - 1));
      return;
    }
    if (match('[data-reveal-bulk-page-next]')) {
      setRevealBulkPage((page) => Math.min(revealBulkPageCount - 1, page + 1));
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
          body: JSON.stringify({
            pack_id: pack.id,
            pack_count: packCount,
            request_id: window.crypto.randomUUID()
          })
        });
        setShopState(result);
        setWallet(result.wallet);
        setInventory(result.inventory || []);
        void refreshMissionSnapshot();
        void refreshDeckSnapshot();
        setRevealPack(result.packs.find((item) => item.id === pack.id));
        setRevealRewards(result.rewards || []);
        setRevealBulkPage(0);
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
        setInventory(result.inventory || []);
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
      setRevealBulkPage(0);
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
    if (event.target.id !== 'renamePlayerForm') return;
    event.preventDefault();
    const nextName = nameDraft.trim();
    if (!nextName || savingName || renameInfoLoading) return;
    setSavingName(true);
    if (!renameRequest.current || renameRequest.current.playerName !== nextName) {
      renameRequest.current = {
        playerName: nextName,
        requestId: window.crypto.randomUUID()
      };
    }
    try {
      const result = await requestJson('/api/profile/player-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player_name: nextName,
          request_id: renameRequest.current.requestId
        })
      });
      setUserName(result.player_name);
      setNameDraft(result.player_name);
      setInventory(result.inventory || []);
      setRenameInfo({
        successful_rename_count: result.successful_rename_count,
        required_cards: result.required_cards,
        rename_card_count: result.rename_card_count,
        player_name: result.player_name
      });
      setRenameOpen(false);
      renameRequest.current = null;
      notify(result.message, 'success');
    } catch (error) { notify(error.message || 'Không thể đổi tên người chơi. Lỗi kết nối máy chủ hoặc cập nhật dữ liệu.', 'error'); }
    finally { setSavingName(false); }
  };

  stateRef.current = { handleClick, handleSubmit, revealStage };
  useEffect(() => {
    const click = (event) => stateRef.current.handleClick(event);
    const submit = (event) => stateRef.current.handleSubmit(event);
    const keydown = (event) => {
      if (event.key !== 'Escape') return;
      if (godPackCelebration) {
        setGodPackCelebration(null);
      } else if (godPackCardPending) {
        if (buying) return;
        setGodPackCardPending(null);
      } else if (fragmentFusionOpen) {
        if (fragmentMergePending) return;
        setFragmentFusionOpen(false);
        window.requestAnimationFrame(() => previousFocus.current?.focus());
      } else if (dismantleConfirmCard) {
        return;
      } else if (missionOpen) {
        closeMissions();
      } else if (attendanceOpen) {
        closeAttendance();
      } else if (renameOpen) {
        closeRename();
      } else if (selectedItem) {
        setSelectedItem(null);
      } else if (detailCard) {
        setDetailCard(null);
        if (detailReturnPanel.current === 'shop' || detailReturnPanel.current === 'reveal') {
          setPanel(detailReturnPanel.current);
        }
        detailReturnPanel.current = '';
      } else if (deckOpen) {
        closeDeck();
      } else if (arenaView === 'ai') {
        setArenaView('modes');
      } else if (arenaView === 'modes') {
        setArenaView('closed');
      } else if (resetOpen) setResetOpen(false);
      else if (panel === 'reveal') {
        clearRevealTimers();
        setPanel('shop');
        setRevealStage('closed');
      }
      else if (panel === 'item-shop') return;
      else if (panel && !(panel === 'characters' && needsCharacterSelection)) closePanel();
    };
    document.addEventListener('click', click);
    document.addEventListener('submit', submit);
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('click', click);
      document.removeEventListener('submit', submit);
      document.removeEventListener('keydown', keydown);
    };
  }, [attendanceOpen, fragmentFusionOpen, fragmentMergePending, missionOpen, detailCard, deckOpen, arenaView, resetOpen, panel, needsCharacterSelection, selectedItem, renameOpen, dismantleConfirmCard, godPackCardPending, godPackCelebration, buying]);

  const selectedCharacter = characters[activeCharacter] || characters['jonouchi-katsuya'];
  const previewCharacter = characters[pendingCharacter] || selectedCharacter;
  const selectedDuelDeckNumber = Number(deckSnapshot?.selected_deck_number) || null;
  const selectedDuelDeck = deckSnapshot?.decks?.find((deck) => deck.number === selectedDuelDeckNumber) || null;
  const selectedDuelDeckError = selectedDuelDeck
    ? selectedDuelDeck.duel_error
    : selectedDuelDeckNumber
      ? 'Bộ bài đã chọn không còn tồn tại.'
      : 'Vui lòng chọn bộ bài trước khi bắt đầu trận đấu.';
  const activePack = getActivePack();
  const activeVoidPack = voidPacks.find((pack) => pack.id === activeVoidPackId) || null;
  const isPackUnlocked = (packId) => shopState?.packs?.find((pack) => pack.id === packId)?.unlocked === true;
  const shopPricingReady = shopState?.purchase_options?.gold_per_pack === GOLD_PER_PACK
    && shopState?.purchase_options?.gem_per_pack === GEMS_PER_PACK
    && shopState?.purchase_options?.pack_counts?.join(',') === '1,10,50';
  const getPackPayment = (count) => {
    const tokens = Number(shopState?.character_cards) || 0;
    const tokensUsed = Math.min(count, tokens);
    const remaining = count - tokensUsed;
    const goldCost = remaining * GOLD_PER_PACK;
    const gemCost = remaining * GEMS_PER_PACK;
    if (!remaining) return { tokensUsed, currency: null, cost: 0, canAfford: true };
    if (Number(wallet.gold) >= goldCost) {
      return { tokensUsed, currency: 'gold', cost: goldCost, canAfford: true };
    }
    return {
      tokensUsed,
      currency: 'gems',
      cost: gemCost,
      canAfford: Number(wallet.gems) >= gemCost
    };
  };
  const canBuyPack = (count) => {
    const payment = getPackPayment(count);
    const remainingCopies = activePack?.cards.reduce(
      (total, card) => total + Math.max(
        0,
        (Number(card.maxCopies) || 3) - (Number(card.ownedQuantity) || 0)
      ),
      0
    ) || 0;
    return Boolean(
      shopPricingReady
      && activePack?.unlocked
      && !buying
      && payment.canAfford
      && remainingCopies >= count
    );
  };
  const getInventoryQuantity = (itemId) => (
    Number(inventory.find((item) => item.id === itemId)?.quantity) || 0
  );
  const getGodPackPriceItem = (card) => (
    card?.price_item_id || activePack?.price_item_id || 'ur_fragment'
  );
  const getGodPackCardPrice = (card) => (
    Number(card?.price_per_card ?? activePack?.price_per_card) || 0
  );
  const getGodPackPriceName = (itemId) => (
    godPackMaterials.find((item) => item.id === itemId)?.name || 'Mảnh'
  );
  const getRemainingShopCopies = (card) => {
    const maxCopies = Number(card.maxCopies) || 3;
    const remaining = Number(card.remainingQuantity);
    return Number.isFinite(remaining)
      ? Math.min(maxCopies, Math.max(0, remaining))
      : Math.max(0, maxCopies - (Number(card.ownedQuantity) || 0));
  };
  const confirmGodPackRedemption = async () => {
    if (!godPackCardPending || buying) return;
    setBuying(true);
    try {
      const result = await requestJson('/api/shop/redeem-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card_id: godPackCardPending.id,
          request_id: window.crypto.randomUUID()
        })
      });
      setShopState(result);
      setWallet(result.wallet);
      setInventory(result.inventory || []);
      void refreshDeckSnapshot();
      const redeemedCard = result.packs
        ?.find((pack) => pack.id === 'god')
        ?.cards.find((card) => card.id === godPackCardPending.id) || godPackCardPending;
      setGodPackCardPending(null);
      setGodPackCelebration({
        title: 'Chúc mừng bạn đã nhận được lá bài!',
        eyebrow: 'ĐỔI BÀI THÀNH CÔNG',
        message: `Bạn đã nhận được ${redeemedCard.name}.`,
        rewards: [{
          kind: 'card',
          amount: 1,
          name: redeemedCard.name,
          card: redeemedCard
        }]
      });
    } catch (error) {
      notify(error.message || 'Không thể đổi lá bài.');
    } finally {
      setBuying(false);
    }
  };
  const godPackCardPrice = getGodPackCardPrice(godPackCardPending);
  const godPackPriceItem = getGodPackPriceItem(godPackCardPending);
  const canRedeemGodPackCard = (card) => (
    activePack?.id === 'god'
    && Number(card.ownedQuantity) < (Number(card.maxCopies) || 3)
    && !buying
    && getInventoryQuantity(getGodPackPriceItem(card)) >= getGodPackCardPrice(card)
  );
  const visibleShopCards = activePack?.cards.slice(cardPage * pageSize, (cardPage + 1) * pageSize) || [];
  const filteredLibraryCards = libraryCards
    .filter((card) => (
      card.category === libraryCategory
      && normalizeCardSearch(card.name).includes(normalizeCardSearch(libraryQuery).trim())
    ))
    .sort((left, right) => {
      if (librarySort === 'atk') return (Number(right.atk) || 0) - (Number(left.atk) || 0);
      if (librarySort === 'level') return (Number(right.level) || 0) - (Number(left.level) || 0);
      return left.name.localeCompare(right.name, 'vi');
    });
  const libraryPageCount = Math.max(1, Math.ceil(filteredLibraryCards.length / LIBRARY_PAGE_SIZE));
  const visibleLibraryCards = filteredLibraryCards.slice(
    libraryPage * LIBRARY_PAGE_SIZE,
    (libraryPage + 1) * LIBRARY_PAGE_SIZE
  );
  const currentReward = revealRewards[revealIndex];
  const revealBulkPageCount = Math.max(1, Math.ceil(revealRewards.length / 10));
  const visibleRevealRewards = revealRewards.slice(revealBulkPage * 10, (revealBulkPage + 1) * 10);
  const shopPageCount = activePack ? Math.max(1, Math.ceil(activePack.cards.length / pageSize)) : 1;
  const ownedShopKinds = activePack?.cards.filter((card) => Number(card.ownedQuantity) > 0).length || 0;
  const ownedShopCopies = activePack?.cards.reduce((total, card) => total + (Number(card.ownedQuantity) || 0), 0) || 0;
  const currentProgress = progress || {
    level: 1,
    experience: 0,
    current_level_experience: 0,
    next_level_experience: 100,
    progress_experience: 0,
    progress_required: 100,
    level_thresholds: { 1: 0, 2: 100 },
    max_level: false
  };
  const currentLevel = Number(currentProgress.level) || 1;
  const levelThresholds = currentProgress.level_thresholds || {};
  const currentLevelThreshold = Number(
    levelThresholds[currentLevel] ?? currentProgress.current_level_experience ?? 0
  );
  const nextLevelThreshold = Number(
    levelThresholds[currentLevel + 1] ?? currentProgress.next_level_experience ?? currentProgress.experience
  );
  const nextLevelExperience = currentProgress.max_level
    ? currentLevelThreshold
    : nextLevelThreshold;
  const progressRequired = currentProgress.max_level
    ? 0
    : Math.max(0, nextLevelExperience - currentLevelThreshold);
  const progressExperience = currentProgress.max_level
    ? currentLevelThreshold
    : Math.max(0, Math.min(progressRequired, Number(currentProgress.experience) - currentLevelThreshold));
  const experienceToNextLevel = currentProgress.max_level
    ? 0
    : Math.max(0, nextLevelExperience - Number(currentProgress.experience));
  const progressPercent = currentProgress.max_level
    ? 100
    : Math.min(100, 100 * Number(currentProgress.experience) / Math.max(1, nextLevelExperience));
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
<video ref={lobbyVideoRef} className="lobby-video" autoPlay loop playsInline preload="metadata"
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
      <i style={{ width: `${progressPercent}%` }}></i>
      <span className="pcard__lv">{currentProgress.level}</span>
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
<CurrencyBar wallet={wallet} />

{/* ============================================================
     HÀNG ICON TRÒN (Vương miện · Nhiệm vụ · Thư viện · Xếp hạng · Thư · Điểm danh)
     ============================================================ */}
<nav className="roundbar">
  <button
    className="rbtn rbtn--item-shop"
    type="button"
    data-js="btn-item-shop"
    data-label="Shop Vật Phẩm"
    aria-haspopup="dialog"
    aria-controls="itemShopTitle"
    aria-label="Mở Shop Vật Phẩm"
    title="Shop Vật Phẩm"
  ><span>🛍️</span></button>
  <button
    className="rbtn rbtn--missions"
    type="button"
    data-js="btn-missions"
    aria-haspopup="dialog"
    aria-controls="missionModal"
    aria-label="Mở nhiệm vụ"
    title="Nhiệm Vụ"
  >
    <span>📋</span>
    {missionSnapshot?.pending_rewards > 0 && (
      <i className="rbtn__dot" aria-label={`${missionSnapshot.pending_rewards} phần thưởng đang chờ`}>
        {missionSnapshot.pending_rewards > 99 ? '99+' : missionSnapshot.pending_rewards}
      </i>
    )}
  </button>
  <button className="rbtn" type="button" data-js="btn-library" aria-haspopup="dialog" aria-controls="libraryModal" aria-label="Mở thư viện bài"><span>📖</span></button>
  <button className="rbtn" data-soon="Hạng"><span>📊</span></button>
  <button className="rbtn" data-soon="Thư"><span>✉️</span><i className="rbtn__dot">4</i></button>
  <button className="rbtn rbtn--attendance" type="button" data-js="btn-attendance" data-label="Điểm danh" aria-haspopup="dialog" aria-controls="attendanceModal" aria-label="Điểm danh" title="Điểm danh"><span>🖊️</span></button>
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
  <button className="hex hex--1" type="button" data-js="btn-deck" aria-haspopup="dialog" aria-label="Mở bộ bài">
    <span className="hex__art" aria-hidden="true">
      <svg className="hex__icon" viewBox="0 0 48 48" fill="none"><path d="M14 7h24a3 3 0 0 1 3 3v29a3 3 0 0 1-3 3H14a3 3 0 0 1-3-3V10a3 3 0 0 1 3-3Z"/><path d="M7 13v25a3 3 0 0 0 3 3h24M18 16h18M18 22h18M18 28h13"/></svg>
    </span>
    <span className="hex__label">Bộ Bài</span>
    {deckSnapshot?.new_cards_count > 0 && (
      <i className="hex__badge" aria-label={`${deckSnapshot.new_cards_count} thẻ mới chưa xem`}>
        {deckSnapshot.new_cards_count > 99 ? '99+' : deckSnapshot.new_cards_count}
      </i>
    )}
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

  <button className="hex hex--3" type="button" data-js="btn-inventory" aria-haspopup="dialog" aria-controls="inventoryModal">
    <span className="hex__art" aria-hidden="true">
      <svg className="hex__icon" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="19" r="12"/><path d="m24 10 2.4 6.6L33 19l-6.6 2.4L24 28l-2.4-6.6L15 19l6.6-2.4L24 10ZM17 34h14m-11 4h8m-4-5v-5"/><path d="m9 10 1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Zm30 6 1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Z"/></svg>
    </span>
    <span className="hex__label">Hộp Ma Thuật</span>
    {inventory.length > 0 && <i className="hex__badge">{inventory.reduce((total, item) => total + item.quantity, 0)}</i>}
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

  <button className="bbtn bbtn--scroll" type="button" data-js="btn-fragments" aria-haspopup="dialog" aria-controls="fragmentFusionTitle">
    <span className="bbtn__art">✦</span><span className="bbtn__label">Ghép Mảnh</span>
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
        <div className="profile-name-display">
          <span>Tên người chơi</span>
          <strong>{userName || 'Duelist'}</strong>
        </div>
      </div>
      <div className="profile-modal__level">
        <div>
          <span>CẤP</span><b>{currentProgress.level}</b>
          <img className="profile-modal__exp-icon" src="assets/images/items/exp.png" alt="EXP" />
          <strong>
            {currentProgress.max_level
              ? `${formatCurrency(currentProgress.experience)} / ${formatCurrency(nextLevelExperience)} EXP · Tối đa`
              : `${formatCurrency(currentProgress.experience)} / ${formatCurrency(nextLevelExperience)} EXP`}
          </strong>
        </div>
        <div
          className="profile-modal__xp"
          role="progressbar"
          aria-label="Tiến trình EXP lên cấp"
          aria-valuemin={0}
          aria-valuemax={currentProgress.max_level ? 100 : nextLevelExperience}
          aria-valuenow={currentProgress.max_level ? 100 : Math.min(nextLevelExperience, Number(currentProgress.experience))}
        >
          <i style={{ width: `${progressPercent}%` }}></i>
        </div>
        <small className="profile-modal__xp-remaining">
          {currentProgress.max_level
            ? 'Đã đạt cấp tối đa'
            : `Còn ${formatCurrency(experienceToNextLevel)} EXP để lên cấp ${currentLevel + 1}`}
        </small>
      </div>
    </div>

    <div className="profile-modal__actions" aria-label="Tùy chọn hồ sơ">
      <button className="profile-action" id="profileNicknameButton" type="button" data-profile-action="nickname"><span>✎</span>Đổi nickname</button>
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

<section className={`rename-modal${renameOpen ? ' is-open' : ''}`} hidden={!renameOpen} aria-labelledby="renamePlayerTitle">
  <button className="rename-modal__scrim" type="button" data-rename-close aria-label="Đóng đổi tên"></button>
  <form className="rename-modal__panel" id="renamePlayerForm" role="dialog" aria-modal="true" aria-labelledby="renamePlayerTitle">
    <header className="rename-modal__header">
      <div>
        <span className="rename-modal__eyebrow">DUELIST ACCOUNT</span>
        <h2 id="renamePlayerTitle">Đổi tên người chơi</h2>
      </div>
      <button className="rename-modal__close" type="button" data-rename-close aria-label="Đóng">×</button>
    </header>
    <p className="rename-modal__cost" aria-live="polite">
      {renameInfoLoading
        ? 'Đang kiểm tra Thẻ Đổi Tên…'
        : renameInfo?.required_cards === 0
          ? 'Đổi tên miễn phí'
          : `Cần sử dụng ${formatCurrency(renameInfo?.required_cards)} Thẻ Đổi Tên`}
    </p>
    {!renameInfoLoading && renameInfo?.required_cards > 0 && (
      <p className={`rename-modal__balance${renameInfo.rename_card_count < renameInfo.required_cards ? ' is-insufficient' : ''}`}>
        Bạn đang có {formatCurrency(renameInfo.rename_card_count)} / {formatCurrency(renameInfo.required_cards)} thẻ
      </p>
    )}
    <label className="rename-modal__label" htmlFor="renamePlayerNameInput">Tên mới</label>
    <input
      className="rename-modal__input"
      id="renamePlayerNameInput"
      name="player_name"
      type="text"
      maxLength="24"
      autoComplete="nickname"
      placeholder="Tên mới"
      required
      value={nameDraft}
      onChange={(event) => setNameDraft(event.target.value)}
    />
    <p className="rename-modal__hint">Từ 1 đến 24 ký tự; cho phép chữ, số, dấu cách, dấu chấm, gạch dưới và gạch ngang.</p>
    <button
      className="rename-modal__confirm"
      type="submit"
      disabled={renameInfoLoading || savingName || !renameInfo || renameInfo.rename_card_count < renameInfo.required_cards}
    >
      {savingName ? 'Đang đổi tên…' : 'OK'}
    </button>
  </form>
</section>

<section className="inventory-modal" id="inventoryModal" hidden={panel !== 'inventory'} aria-label="Hộp ma thuật">
  <MagicBoxCanvas
    items={inventory}
    hoveredItemId={hoveredInventoryItem}
    selectedItemId={selectedItem?.id}
    visible={panel === 'inventory'}
  />
  <header className="inventory-screen__topbar">
    <button className="inventory-screen__back" type="button" data-inventory-close aria-label="Quay về sảnh">
      <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M14 4 2 16l12 12v-7h16V11H14z" fill="currentColor"/></svg>
      <span>Quay lại</span>
    </button>
    <h1 id="inventoryTitle">Hộp Ma Thuật</h1>
    <div className="inventory-screen__currencies" aria-label="Số dư tài khoản">
      <div className="currency__item currency__item--gold">
        <img className="currency__icon" src="assets/images/currency/gold.png" alt="" aria-hidden="true" />
        <span>{formatCurrency(wallet.gold)}</span>
        <button className="currency__plus" type="button" data-gem-exchange-open aria-label="Mở đổi gem sang vàng">+</button>
      </div>
      <div className="currency__item currency__item--gem">
        <img className="currency__icon" src="assets/images/currency/gem.png" alt="" aria-hidden="true" />
        <span>{formatCurrency(wallet.gems)}</span>
        <button className="currency__plus" type="button" data-gem-exchange-open aria-label="Mở đổi gem sang vàng">+</button>
      </div>
    </div>
  </header>
  <div className="inventory-screen__body">
    <aside className="inventory-screen__sidebar" aria-label="Loại vật phẩm">
      <h2>Danh mục</h2>
      <div className="inventory-screen__category is-selected">
        <span aria-hidden="true">▣</span>
        <b>Vật phẩm</b>
        <small>{inventory.length} loại</small>
      </div>
    </aside>
    <main className="inventory-screen__content">
      <div className="inventory-screen__heading">
        <div>
          <span>KHO VẬT PHẨM</span>
          <h2>Vật phẩm của bạn</h2>
        </div>
        <small>{inventory.reduce((total, item) => total + item.quantity, 0)} vật phẩm</small>
      </div>
      {inventoryLoading
        ? <p className="inventory-modal__status" role="status">Đang tải túi đồ…</p>
        : inventoryError
          ? <p className="inventory-modal__status is-error" role="alert">{inventoryError}</p>
          : inventory.length === 0
            ? <p className="inventory-modal__status">Chưa có vật phẩm nào</p>
            : <div className="inventory-grid">
              {inventory.map((item) => (
                <button
                  className="inventory-item"
                  type="button"
                  data-inventory-item={item.id}
                  key={item.id}
                  aria-label={`${item.name}, số lượng ${item.quantity}`}
                  onMouseEnter={() => setHoveredInventoryItem(item.id)}
                  onMouseLeave={() => setHoveredInventoryItem(null)}
                  onFocus={() => setHoveredInventoryItem(item.id)}
                  onBlur={() => setHoveredInventoryItem(null)}
                >
                  <img src={item.image} alt="" />
                  <strong>{item.name}</strong>
                  <span>Số lượng: {formatCurrency(item.quantity)}</span>
                </button>
              ))}
            </div>}
    </main>
  </div>
  {selectedItem && (
    <div className="inventory-detail">
      <button className="inventory-detail__scrim" type="button" data-inventory-close aria-label="Đóng thông tin vật phẩm"></button>
      <section className="inventory-detail__panel" role="dialog" aria-modal="true" aria-labelledby="inventoryItemTitle">
        <button className="inventory-modal__close" type="button" data-inventory-close aria-label="Đóng">×</button>
        <img className="inventory-detail__image" src={selectedItem.image} alt="" />
        <h3 id="inventoryItemTitle">{selectedItem.name}</h3>
        <p><b>Số lượng:</b> {formatCurrency(selectedItem.quantity)}</p>
        <p>{selectedItem.description}</p>
        <p><b>Nguồn nhận:</b> {selectedItem.source}</p>
        {selectedItem.usable && (
          <div className="inventory-detail__actions">
            <label>
              Số lượng sử dụng
              <input
                type="number"
                min="1"
                max={selectedItem.quantity}
                value={useQuantity}
                onChange={(event) => {
                  const quantity = Number(event.target.value);
                  setUseQuantity(Number.isInteger(quantity) ? Math.min(selectedItem.quantity, Math.max(1, quantity)) : 1);
                }}
              />
            </label>
            <button
              type="button"
              data-item-use
              disabled={usingItem || currentProgress.max_level || selectedItem.quantity < 1}
            >
              {usingItem ? 'Đang sử dụng…' : currentProgress.max_level ? 'Đã đạt cấp tối đa' : 'Sử dụng'}
            </button>
          </div>
        )}
      </section>
    </div>
  )}
</section>

<section className="library-screen" id="libraryModal" aria-label="Thư viện bài" hidden={panel !== 'library'}>
  <LibraryBackdrop active={panel === 'library'} />
  <header className="library-screen__topbar">
    <button className="library-screen__back" type="button" data-library-close aria-label="Quay về sảnh">
      <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M14 4 2 16l12 12v-7h16V11H14z" fill="currentColor"/></svg>
      <span>Về sảnh</span>
    </button>
    <h1 id="libraryTitle">Thư Viện</h1>
    <span className="library-screen__eye" aria-hidden="true">
      <svg viewBox="0 0 100 72" focusable="false">
        <path d="M5 36 25 8h50l20 28-20 28H25L5 36Z" />
        <path d="M15 36 30 16h40l15 20-15 20H30L15 36Z" />
        <circle cx="50" cy="36" r="17" />
        <circle cx="50" cy="36" r="8" />
        <path d="M50 3v9M50 60v9M3 36h9M88 36h9" />
      </svg>
    </span>
    <span className="library-screen__topbar-caption" aria-hidden="true">DUELIST ARCHIVE</span>
  </header>

  <aside className="library-screen__sidebar" aria-label="Phân loại bài">
    <h2>Danh mục</h2>
    <div className="library-screen__categories">
      <button className={`library-category${libraryCategory === 'monster' ? ' is-selected' : ''}`} type="button" data-library-tab="monster" aria-pressed={libraryCategory === 'monster'}>
        <span aria-hidden="true">★</span><b>Quái thú</b>
      </button>
      <button className={`library-category${libraryCategory === 'spell' ? ' is-selected' : ''}`} type="button" data-library-tab="spell" aria-pressed={libraryCategory === 'spell'}>
        <span aria-hidden="true">✣</span><b>Phép</b>
      </button>
      <button className={`library-category${libraryCategory === 'trap' ? ' is-selected' : ''}`} type="button" data-library-tab="trap" aria-pressed={libraryCategory === 'trap'}>
        <span aria-hidden="true">◇</span><b>Bẫy</b>
      </button>
      <button className={`library-category${libraryCategory === 'fusion' ? ' is-selected' : ''}`} type="button" data-library-tab="fusion" aria-pressed={libraryCategory === 'fusion'}>
        <span aria-hidden="true">▤</span><b>Dung hợp</b>
      </button>
    </div>
    <div className="library-screen__sidebar-mark" aria-hidden="true">
      <svg viewBox="0 0 140 140"><circle cx="70" cy="70" r="57"/><circle cx="70" cy="70" r="44"/><path d="M18 70h22m60 0h22M70 18v22m0 60v22M30 30l16 16m48 48 16 16m0-80L94 46m-48 48-16 16"/><path d="M30 70q40-43 80 0-40 43-80 0Z"/><circle cx="70" cy="70" r="14"/><circle cx="70" cy="70" r="5"/></svg>
    </div>
  </aside>

  <main className="library-screen__stage" role="region" aria-label="Bộ sưu tập bài">
    <div className="library-screen__toolbar">
      <div className="library-screen__count" aria-live="polite">
        <strong>{Math.min(libraryPage + 1, libraryPageCount)}</strong>
        <span>/</span>
        <strong>{libraryPageCount}</strong>
        <small>{filteredLibraryCards.length} lá bài</small>
      </div>
      <button
        className={`library-screen__filter${libraryFilterOpen ? ' is-open' : ''}`}
        type="button"
        data-library-filter-toggle
        aria-expanded={libraryFilterOpen}
        aria-controls="libraryFilterPanel"
      >
        Chọn lọc <span className="library-screen__filter-chevron" aria-hidden="true">⌄</span>
      </button>
    </div>
    {libraryFilterOpen && (
      <form className="library-screen__filter-panel" id="libraryFilterPanel" role="search" onSubmit={(event) => event.preventDefault()}>
        <label className="library-screen__search">
          <span>Tìm tên thẻ</span>
          <input
            type="search"
            value={libraryQuery}
            onChange={(event) => {
              setLibraryQuery(event.target.value);
              setLibraryPage(0);
            }}
            placeholder="Nhập tên thẻ..."
            aria-label="Tìm thẻ theo tên"
          />
        </label>
        <label className="library-screen__sort">
          <span>Sắp xếp</span>
          <select
            value={librarySort}
            onChange={(event) => {
              setLibrarySort(event.target.value);
              setLibraryPage(0);
            }}
          >
            <option value="name">Tên A–Z</option>
            <option value="atk">ATK cao nhất</option>
            <option value="level">Cấp cao nhất</option>
          </select>
        </label>
        <button className="library-screen__filter-reset" type="button" data-library-filter-reset>Đặt lại</button>
      </form>
    )}
    <div className="library-screen__grid" aria-live="polite" aria-label="Danh sách lá bài">
      {libraryError
        ? <p className="library-screen__empty library-screen__empty--error">{libraryError}</p>
        : !libraryLoaded
          ? <p className="library-screen__empty">Đang tải thư viện bài…</p>
          : visibleLibraryCards.length
            ? visibleLibraryCards.map((card) => (
            <button key={card.id} type="button" className={`library-card library-card--${card.category}`} data-card-id={card.id} aria-label={`Xem thông tin lá ${card.name}`}>
              <LibraryArtwork card={card} />
              <span className="library-card__name">{card.name}</span>
            </button>
            ))
            : <p className="library-screen__empty">Không tìm thấy thẻ phù hợp.</p>}
    </div>
    <nav className="library-screen__pagination" aria-label="Phân trang thư viện">
      <button type="button" data-library-page-prev aria-label="Trang trước" disabled={libraryPage <= 0}>‹</button>
      <span>Trang <b>{Math.min(libraryPage + 1, libraryPageCount)}</b> / {libraryPageCount}</span>
      <button type="button" data-library-page-next aria-label="Trang sau" disabled={libraryPage + 1 >= libraryPageCount}>›</button>
    </nav>
  </main>
  <CardDetailDialog
    card={detailCard}
    position={detailCard?.position}
    onClose={() => {
      setDetailCard(null);
      if (detailReturnPanel.current === 'shop' || detailReturnPanel.current === 'reveal') {
        setPanel(detailReturnPanel.current);
      }
    }}
    showInventoryDetails
    quantity={detailCard?.quantity || detailCard?.ownedQuantity || 0}
    availableQuantity={detailCard?.availableQuantity || 0}
    showDismantle={detailReturnPanel.current === 'deck'}
    onDismantle={() => setDismantleConfirmCard(detailCard)}
    showCollectionAction
  />
  {dismantleConfirmCard && createPortal(
    <CardDismantleDialog
      card={dismantleConfirmCard}
      onCancel={() => setDismantleConfirmCard(null)}
      onSuccess={(result) => {
        setInventory(result.inventory);
        setDetailCard((current) => current && current.id === result.card_id
          ? {
            ...current,
            quantity: result.owned_quantity,
            ownedQuantity: result.owned_quantity,
            deckQuantity: result.deck_quantity,
            availableQuantity: result.available_quantity
          }
          : current);
        setDismantleConfirmCard(null);
        setDeckRefreshKey((current) => current + 1);
        setDismantleCelebration({
          title: 'Chúc mừng bạn nhận được vật phẩm!',
          eyebrow: 'TÁCH BÀI THÀNH CÔNG',
          message: result.message,
          rewards: [result.reward]
        });
      }}
    />,
    document.body
  )}
  {dismantleCelebration && createPortal(
    <div className="attendance-modal card-dismantle__reward-host">
      <AttendanceRewardDialog
        celebration={dismantleCelebration}
        onClose={() => setDismantleCelebration(null)}
        showEyebrow={false}
        showMessage={false}
      />
    </div>,
    document.body
  )}
  {godPackCardPending && createPortal(
    <div className="attendance-modal god-pack-redemption__confirm-host">
      <AttendanceConfirmDialog
        panelClassName="god-pack-redemption__confirm"
        eyebrow="XÁC NHẬN ĐỔI BÀI"
        title="Xác nhận đổi lá bài?"
        titleId="godPackRedeemConfirmTitle"
        cancelLabel="Hủy"
        confirmLabel="Xác nhận đổi"
        pending={buying}
        confirmDisabled={getInventoryQuantity(godPackPriceItem) < godPackCardPrice}
        onCancel={() => setGodPackCardPending(null)}
        onConfirm={confirmGodPackRedemption}
      >
        <div className="god-pack-redemption__confirm-copy">
          <strong>{godPackCardPending.name}</strong>
          <span>Bạn sẽ dùng {formatCurrency(godPackCardPrice)} {getGodPackPriceName(godPackPriceItem)} để đổi lá bài này.</span>
        </div>
        <div className="attendance-dialog__balance">
          <span>{getGodPackPriceName(godPackPriceItem)} hiện có <b>{formatCurrency(getInventoryQuantity(godPackPriceItem))}</b></span>
          <span>Sau khi đổi <b>{formatCurrency(Math.max(0, getInventoryQuantity(godPackPriceItem) - godPackCardPrice))}</b></span>
        </div>
      </AttendanceConfirmDialog>
    </div>,
    document.body
  )}
  {godPackCelebration && createPortal(
    <div className="attendance-modal god-pack-redemption__reward-host">
      <AttendanceRewardDialog
        celebration={godPackCelebration}
        onClose={() => setGodPackCelebration(null)}
      />
    </div>,
    document.body
  )}
</section>

<section className={`card-shop${activePack || activeVoidPack ? ' has-pack-detail' : ''}`} id="cardShop" aria-label="Tiệm Bài" hidden={panel !== 'shop' && panel !== 'reveal'} inert={panel === 'reveal'}>
  <header className="card-shop__topbar">
    <button className="card-shop__back" type="button" data-js="shop-back" aria-label="Quay lại">
      <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M14 4 2 16l12 12v-7h16V11H14z" fill="currentColor"/></svg>
      <span>Quay lại</span>
    </button>
    <h1 className="card-shop__title">Tiệm Bài</h1>
    {activePack?.id === 'god' ? (
      <div className="card-shop__wallet card-shop__material-bar" aria-label="Mảnh vật phẩm">
        {godPackMaterials.map((item) => (
          <div
            className="card-shop__material-entry"
            key={item.id}
            title={item.name}
            aria-label={`${item.name}: ${formatCurrency(getInventoryQuantity(item.id))}`}
          >
            <img src={item.image} alt="" aria-hidden="true" />
            <b>{formatCurrency(getInventoryQuantity(item.id))}</b>
          </div>
        ))}
      </div>
    ) : (
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
    )}
  </header>

  <aside className={`card-shop__sidebar${activePack || activeVoidPack ? ' is-pack-detail' : ''}`}>
    <button
      className="card-shop__category"
      type="button"
      data-shop-category="character"
      aria-current={shopCategory === 'character' ? 'page' : undefined}
    >
      <span aria-hidden="true">✦</span>
      <span>Nhân vật<br /><small>Gói bài</small></span>
    </button>
    <button
      className="card-shop__category"
      type="button"
      data-shop-category="void"
      aria-current={shopCategory === 'void' ? 'page' : undefined}
    >
      <span aria-hidden="true">✧</span>
      <span>Hư Vô<br /><small>Gói bài</small></span>
    </button>
    <div className={`card-shop__aside-pack${asideImageOnlyPackIds.has(activePack?.id) ? ' is-image-only' : ''}${activePack?.id === 'god' ? ' is-god-pack' : ''}`} data-shop-aside-pack hidden={!activePack && !activeVoidPack}>
      <div className="card-shop__aside-pack-art">
        {activePack && packArtwork[activePack.id] ? (
          <img
            data-shop-aside-image
            src={packArtwork[activePack.id]}
            alt={`Gói bài ${activePack.owner}`}
          />
        ) : (
          <span className={`void-pack-aside-mark void-pack-aside-mark--${activePack?.id || activeVoidPack?.id}`} aria-hidden="true">
            {activePack?.id === 'god' ? '✦' : activeVoidPack?.symbol}
          </span>
        )}
      </div>
      {activePack && !asideImageOnlyPackIds.has(activePack.id) && (
        <>
          <span data-shop-aside-owner>{activePack.owner}</span>
          <strong data-shop-aside-title>{activePack.name}</strong>
        </>
      )}
      {activeVoidPack && (
        <>
          <span>GÓI BÀI HƯ VÔ</span>
          <strong>{activeVoidPack.name}</strong>
        </>
      )}
    </div>
  </aside>

  <main className={`card-shop__content${activePack || activeVoidPack ? ' is-detail' : ''}`}>
    <div className="card-shop__heading">
      <span>{shopCategory === 'void' ? 'TIỆM BÀI · GÓI BÀI HƯ VÔ' : 'TIỆM BÀI · GÓI NHÂN VẬT'}</span>
      <h2>{shopCategory === 'void' ? 'Chọn gói bài Hư Vô' : 'Chọn gói bài'}</h2>
    </div>
    <div className={`card-shop__packs${shopCategory === 'void' ? ' is-void-category' : ''}`} hidden={Boolean(activePack || activeVoidPack)}>
      {shopCategory === 'void' ? voidPacks.map((pack) => (
        pack.id === 'god' ? (
          <article className="shop-pack shop-pack--god shop-pack--image-only" key={pack.id}>
            <button
              className="shop-pack__image-select"
              type="button"
              data-void-pack-select={pack.id}
              disabled={!isPackUnlocked(pack.id)}
              aria-label={isPackUnlocked(pack.id) ? `Xem ${pack.name}` : `${pack.name} đang tải`}
            >
              <img src={packArtwork[pack.id]} alt="" aria-hidden="true" />
            </button>
          </article>
        ) : (
          <article className={`shop-pack void-pack-card void-pack-card--${pack.id}`} key={pack.id}>
            <button
              className="void-pack-card__select"
              type="button"
              data-void-pack-select={pack.id}
              aria-label={`Xem ${pack.name}`}
            >
              <span className="void-pack-card__art" aria-hidden="true">
                <span className="void-pack-card__symbol">{pack.symbol}</span>
                <span className="void-pack-card__image-note">Ảnh gói bài sẽ được thêm sau</span>
              </span>
              <strong>{pack.name}</strong>
              <span className="void-pack-card__action">Xem gói bài <b aria-hidden="true">›</b></span>
            </button>
          </article>
        )
      )) : (
        <>
          <article className="shop-pack shop-pack--kaiba shop-pack--image-only">
            <button
              className="shop-pack__image-select"
              type="button"
              data-pack-select="kaiba"
              disabled={!isPackUnlocked('kaiba')}
              aria-label={isPackUnlocked('kaiba') ? 'Xem các lá bài trong gói Kaiba' : 'Gói bài Kaiba chưa mở khóa'}
            >
              <img src="/assets/images/packs/pack-dragon.png" alt="" aria-hidden="true" />
            </button>
          </article>
          <article className="shop-pack shop-pack--yugi shop-pack--image-only">
            <button
              className="shop-pack__image-select"
              type="button"
              data-pack-select="yugi"
              disabled={!isPackUnlocked('yugi')}
              aria-label={isPackUnlocked('yugi') ? 'Xem các lá bài trong gói Yugi' : 'Gói bài Yugi chưa mở khóa'}
            >
              <img src="/assets/images/packs/pack-magician.png" alt="" aria-hidden="true" />
            </button>
          </article>
          <article className="shop-pack shop-pack--jonouchi shop-pack--image-only">
            <button
              className="shop-pack__image-select"
              type="button"
              data-pack-select="jonouchi"
              disabled={!isPackUnlocked('jonouchi')}
              aria-label={isPackUnlocked('jonouchi') ? 'Xem các lá bài trong gói Jonouchi' : 'Gói bài Jonouchi chưa mở khóa'}
            >
              <img src="/assets/images/packs/pack-knight.png" alt="" aria-hidden="true" />
            </button>
          </article>
        </>
      )}
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
        <div className={`shop-detail__cards${activePack?.id === 'god' ? ' is-god-pack' : ''}`} data-shop-card-grid aria-live="polite" aria-label={activePack ? `Lá bài ${cardPage * pageSize + 1} đến ${Math.min((cardPage + 1) * pageSize, activePack.cards.length)} trên ${activePack.cards.length}` : 'Danh sách lá bài'}>
          {visibleShopCards.map((card) => {
            const maxCopies = Number(card.maxCopies) || 3;
            const remainingCopies = getRemainingShopCopies(card);
            if (activePack?.id === 'god') {
              const priceItemId = getGodPackPriceItem(card);
              const cardPrice = getGodPackCardPrice(card);
              const priceName = getGodPackPriceName(priceItemId);
              const priceImage = godPackMaterials.find((item) => item.id === priceItemId)?.image;
              return (
                <div className="god-pack-card" key={card.id}>
                  <button
                    type="button"
                    className={`shop-card${remainingCopies === 0 ? ' shop-card--exhausted' : ''}`}
                    data-card-id={card.id}
                    aria-label={`Xem ${card.name}, còn ${remainingCopies} trên ${maxCopies}`}
                  >
                    <CardFace card={card} className="shop-card__face" />
                    <span className="shop-card__quantity">{remainingCopies}/{maxCopies}</span>
                  </button>
                  <button
                    type="button"
                    className="god-pack-card__redeem"
                    data-god-card-redeem={card.id}
                    disabled={!canRedeemGodPackCard(card)}
                    title={remainingCopies === 0 ? 'Mỗi lá chỉ được sở hữu một bản.' : `Cần ${cardPrice} ${priceName} để đổi.`}
                    aria-label={`Đổi ${card.name} bằng ${cardPrice} ${priceName}`}
                  >
                    {priceImage && <img src={priceImage} alt="" aria-hidden="true" />}
                    <b>{formatCurrency(cardPrice)}</b>
                    <span>{priceName}</span>
                  </button>
                </div>
              );
            }
            return <button
              key={card.id}
              type="button"
              className={`shop-card${remainingCopies === 0 ? ' shop-card--exhausted' : ''}`}
              data-card-id={card.id}
              aria-label={`Xem ${card.name}, còn ${remainingCopies} trên ${maxCopies}`}
            >
              <CardFace card={card} className="shop-card__face" />
              <span className="shop-card__quantity" title={`Còn ${remainingCopies} bản trong gói`}>{remainingCopies}/{maxCopies}</span>
            </button>;
          })}
        </div>
        <button className="shop-detail__page-button" type="button" data-shop-page-next aria-label={`${pageSize} lá tiếp theo`} disabled={!activePack || cardPage >= shopPageCount - 1}>›</button>
      </div>
      {activePack?.id !== 'god' && (
        <footer className="shop-detail__purchase">
          <span data-shop-collection-count>
            {activePack ? `Đã sở hữu ${ownedShopKinds}/${activePack.cards.length} loại · ${ownedShopCopies} bản` : ''}
            {!shopPricingReady && ' · Khởi động lại máy chủ để áp dụng giá 500 vàng / 700 gem mỗi gói'}
          </span>
          <div className="shop-detail__buy-buttons" aria-label="Mua gói bài">
            {[1, 10, 50].map((packCount) => {
              const payment = getPackPayment(packCount);
              return (
                <button
                  type="button"
                  data-shop-buy={packCount}
                  key={packCount}
                  disabled={!canBuyPack(packCount)}
                >
                  Mua {packCount} gói
                  <b>
                    {payment.tokensUsed > 0 && (
                      <span className="shop-detail__payment-part">
                        <img src="assets/images/items/character-card.png" alt="" aria-hidden="true" />
                        {formatCurrency(payment.tokensUsed)}
                      </span>
                    )}
                    {payment.tokensUsed > 0 && payment.currency && <i aria-hidden="true">+</i>}
                    {payment.currency && (
                      <span className="shop-detail__payment-part">
                        <img src={`assets/images/currency/${payment.currency === 'gold' ? 'gold' : 'gem'}.png`} alt="" aria-hidden="true" />
                        {formatCurrency(payment.cost)}
                      </span>
                    )}
                  </b>
                </button>
              );
            })}
          </div>
          <button type="button" className="shop-detail__reset" data-shop-reset>Tạo lại</button>
        </footer>
      )}
    </section>
    <section className="void-pack-detail" hidden={!activeVoidPack} aria-labelledby="voidPackDetailTitle">
      <header className="void-pack-detail__header">
        <span>GÓI BÀI HƯ VÔ</span>
        <h2 id="voidPackDetailTitle">{activeVoidPack?.name}</h2>
        <p>Danh sách lá bài và hình ảnh của gói sẽ được bổ sung sau.</p>
      </header>
      <div className={`void-pack-detail__preview void-pack-detail__preview--${activeVoidPack?.id}`} aria-hidden="true">
        <span>{activeVoidPack?.symbol}</span>
        <small>Ảnh gói bài sẽ được thêm sau</small>
      </div>
      <footer className="void-pack-detail__footer">
        <span>Gói bài đang được chuẩn bị.</span>
        <button type="button" data-void-pack-back>Quay lại danh sách</button>
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
  <button
    type="button"
    className={`shop-reveal__pack${revealPack ? ` shop-pack--${revealPack.id}` : ''}${imageOnlyPackIds.has(revealPack?.id) ? ' is-image-only' : ''}${revealStage === 'opening' ? ' is-opening' : ''}`}
    style={imageOnlyPackIds.has(revealPack?.id) ? { '--reveal-pack-art': `url("${packArtwork[revealPack.id]}")` } : undefined}
    data-reveal-pack
    aria-label="Mở gói bài"
    hidden={!['cover', 'opening'].includes(revealStage)}
    disabled={revealStage !== 'cover'}
  >
    <img className="shop-reveal__pack-art" data-reveal-pack-art src={imageOnlyPackIds.has(revealPack?.id) ? packArtwork[revealPack.id] : undefined} alt="" aria-hidden="true" />
    {!imageOnlyPackIds.has(revealPack?.id) && (
      <>
        <span className="shop-reveal__pack-sigil" data-reveal-sigil>{revealPack?.id === 'yugi' ? '千' : '城'}</span>
        <b data-reveal-pack-title>{revealPack?.name}</b>
        <small>NHẤN ĐỂ MỞ</small>
      </>
    )}
  </button>
  <button type="button" className="shop-reveal__quick-open" data-reveal-quick-open hidden={revealRewards.length <= 1 || !['cover', 'opening', 'back'].includes(revealStage)}>Mở nhanh {revealRewards.length} lá</button>
  <button type="button" className={`shop-reveal__card${revealPack?.id === 'kaiba' ? ' is-kaiba' : ''}${revealStage === 'flipping' ? ' is-flipping' : ''}${['flipping', 'front', '3d'].includes(revealStage) ? ' is-revealed' : ''}`} data-reveal-card hidden={!['back', 'flipping', 'front'].includes(revealStage) && !(revealStage === '3d' && !reveal3DReady)} aria-label={currentReward ? `Xem thông tin lá ${currentReward.name}` : 'Lật lá bài'}>
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
    <div className="shop-reveal__bulk-grid" data-reveal-bulk-grid>{visibleRevealRewards.map((card, index) => {
      const rewardIndex = revealBulkPage * 10 + index;
      return <button type="button" className="shop-reveal__bulk-item" data-reveal-bulk-card={rewardIndex} aria-label={`Xem thông tin lá ${card.name}, nhận ${card.quantity || 1} lá`} key={`${card.id}-${rewardIndex}`}><CardFace card={card} className="shop-reveal__bulk-card-face" /><span className="shop-reveal__bulk-quantity">{card.quantity || 1}</span></button>;
    })}</div>
    <nav className="shop-reveal__bulk-pagination" aria-label="Phân trang lá bài nhận được" hidden={revealBulkPageCount <= 1}>
      <button type="button" data-reveal-bulk-page-prev aria-label="Trang trước" disabled={revealBulkPage === 0}>‹</button>
      <span>Trang <b>{revealBulkPage + 1}</b> / {revealBulkPageCount}</span>
      <button type="button" data-reveal-bulk-page-next aria-label="Trang sau" disabled={revealBulkPage + 1 >= revealBulkPageCount}>›</button>
    </nav>
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
  <button type="button" className="shop-reveal__return" data-reveal-next hidden={!['front', 'bulk', '3d'].includes(revealStage)}>{revealStage === 'bulk' || revealIndex + 1 >= revealRewards.length ? 'Trở về' : 'Tiếp theo'}</button>
</section>

<section className="character-select" id="characterSelect" aria-label="Đổi nhân vật" hidden={panel !== 'characters'}>
  <header className="character-select__topbar">
    <button className="character-select__back" type="button" data-js="characters-back" aria-label="Quay về sảnh" hidden={needsCharacterSelection}>
      <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M14 4 2 16l12 12v-7h16V11H14z" fill="currentColor"/></svg>
    </button>
    <h1>{needsCharacterSelection ? 'Chọn nhân vật khởi đầu' : 'Đổi nhân vật'}</h1>
  </header>

  <aside className="character-select__sidebar" aria-label="Chọn nhân vật">
    <h2>Chọn</h2>
    <div className="character-select__list">
      {Object.entries(characters).map(([characterId, character]) => {
        const locked = !needsCharacterSelection && !unlockedCharacters.includes(characterId);
        return <button
          className={`character-option${pendingCharacter === characterId ? ' is-selected' : ''}${locked ? ' is-locked' : ''}`}
          type="button"
          data-character-choice={characterId}
          aria-pressed={pendingCharacter === characterId}
          disabled={locked}
          key={characterId}
        >
          <img src={character.image} alt="" loading="lazy" />
          <span>{character.name}</span>
          {locked && <small>Mở khóa cấp {characterUnlockLevels[characterId] || 10}</small>}
        </button>;
      })}
    </div>
  </aside>

  <main className="character-select__stage" aria-label="Nhân vật đang chọn">
    <div className="character-select__floor" aria-hidden="true"></div>
    <img className="character-select__preview" id="characterPreview" src={previewCharacter.image} alt={previewCharacter.name} />
    <div className="character-select__actions">
      <p id="characterPreviewName">{previewCharacter.name}</p>
      <button className="character-select__confirm" type="button" data-js="characters-confirm" disabled={savingCharacter || (needsCharacterSelection && !pendingCharacter)}>
        {savingCharacter ? 'Đang lưu…' : needsCharacterSelection ? 'Xác nhận nhân vật' : 'Đồng ý'}
      </button>
    </div>
  </main>
</section>

<AttendanceModal
  open={attendanceOpen}
  onClose={closeAttendance}
  onWalletChange={setWallet}
  onMissionsChange={refreshMissionSnapshot}
  presence={onlinePresence}
/>
<FragmentFusion
  open={fragmentFusionOpen}
  inventory={inventory}
  wallet={wallet}
  onClose={() => {
    setFragmentFusionOpen(false);
    window.requestAnimationFrame(() => previousFocus.current?.focus());
  }}
  onInventoryChange={setInventory}
  onWalletChange={setWallet}
  onPendingChange={setFragmentMergePending}
/>
<DeckBuilder
  open={deckOpen}
  refreshKey={deckRefreshKey}
  selectionMode={deckSelectionMode}
  selectedDuelDeckNumber={selectedDuelDeckNumber || 0}
  selectionBusy={selectingDuelDeck}
  onSelectDeck={selectArenaDeck}
  onSnapshotChange={setDeckSnapshot}
  onClose={closeDeck}
  onOpenCard={(card) => {
    detailReturnPanel.current = 'deck';
    setDetailCard(card);
  }}
  onNewCardsCount={updateDeckNewCount}
  wallet={wallet}
  onWalletChange={syncWallet}
/>
{arenaView === 'modes' && (
  <section className="arena-screen arena-screen--modes" aria-labelledby="arenaModeTitle">
    <ArenaModeCanvas variant="screen" className="arena-screen__canvas" />
    <header className="arena-screen__header">
      <button className="arena-back" type="button" onClick={() => setArenaView('closed')}>← <span>QUAY LẠI</span></button>
      <h1 id="arenaModeTitle">CHỌN CHẾ ĐỘ ĐẤU</h1>
      <span className="arena-screen__header-space" aria-hidden="true"></span>
    </header>
    <div className="arena-mode-grid">
      <button className="arena-mode-card arena-mode-card--pvp" type="button" disabled aria-disabled="true">
        <ArenaModeCanvas variant="pvp" className="arena-mode-card__canvas" />
        <span className="arena-mode-card__art" aria-hidden="true">
          <ArenaModeCanvas variant="pvp-icon" className="arena-mode-card__icon" />
        </span>
        <span className="arena-mode-card__eyebrow">ĐẤU TRỰC TUYẾN</span>
        <strong>ĐẤU NGƯỜI VỚI NGƯỜI</strong>
        <span className="arena-mode-card__divider" aria-hidden="true"></span>
        <span className="arena-mode-card__description">Đấu trực tiếp với các pháp sư bài khác.</span>
        <span className="arena-mode-card__status">CHƯA KHẢ DỤNG</span>
      </button>
      <button className="arena-mode-card arena-mode-card--ai" type="button" onClick={() => setArenaView('ai')}>
        <ArenaModeCanvas variant="ai" className="arena-mode-card__canvas" />
        <span className="arena-mode-card__art" aria-hidden="true">
          <ArenaModeCanvas variant="ai-icon" className="arena-mode-card__icon" />
        </span>
        <span className="arena-mode-card__eyebrow">ĐỐI THỦ ĐIỀU KHIỂN BỞI AI</span>
        <strong>ĐẤU NGƯỜI VỚI MÁY</strong>
        <span className="arena-mode-card__divider" aria-hidden="true"></span>
        <span className="arena-mode-card__description">Chọn bộ bài của bạn và bước vào trận đấu.</span>
        <span className="arena-mode-card__action">VÀO ĐẤU TRƯỜNG <b aria-hidden="true">→</b></span>
      </button>
    </div>
    <p className="arena-mode-note">Chế độ đấu trực tuyến chưa được triển khai.</p>
  </section>
)}
{arenaView === 'ai' && (
  <section className="arena-screen arena-screen--ai" aria-labelledby="arenaTitle">
    <header className="arena-screen__header arena-screen__header--ai">
      <button className="arena-back" type="button" onClick={() => setArenaView('modes')}>← <span>CHỌN CHẾ ĐỘ</span></button>
      <h1 id="arenaTitle">ĐẤU TRƯỜNG</h1>
      {walletLoaded
        ? <CurrencyBar wallet={wallet} className="currency arena-currency" />
        : <span className="arena-currency-state" role="status">{walletLoadError || 'ĐANG TẢI SỐ DƯ…'}</span>}
    </header>
    <main className="arena-ai-stage">
      <ArenaModeCanvas variant="ai-stage" className="arena-ai-stage__canvas" />
      <div className="arena-ai-stage__eyebrow">THỬ THÁCH ĐẤU MÁY</div>
      <div className="arena-ai-stage__duelists" aria-hidden="true">
        <div className="arena-ai-stage__duelist arena-ai-stage__duelist--player">
          <span>DUELIST</span>
          <ArenaModeCanvas variant="duelist-portrait" className="arena-ai-stage__portrait" />
        </div>
        <div className="arena-ai-stage__versus">VS</div>
        <div className="arena-ai-stage__duelist arena-ai-stage__duelist--cpu">
          <span>CPU</span>
          <ArenaModeCanvas variant="cpu-portrait" className="arena-ai-stage__portrait" />
        </div>
      </div>
      <p className="arena-ai-stage__caption">Sẵn sàng triệu hồi bộ bài và bước vào trận đấu?</p>
    </main>
    <footer className="arena-controls">
      <ArenaModeCanvas variant="controls" className="arena-controls__canvas" />
      <div className="arena-controls__deck">
        <span className="arena-controls__label">BỘ BÀI ĐANG CHỌN</span>
        <button className="arena-controls__deck-button" type="button" onClick={openArenaDeckBuilder}>
          {selectedDuelDeck ? selectedDuelDeck.name.toUpperCase() : 'CHỌN BỘ BÀI'}
          <span aria-hidden="true">⌄</span>
        </button>
        <span className={`arena-controls__deck-status${selectedDuelDeckError ? ' is-error' : ''}`} role="status">
          {selectedDuelDeckError || 'Bộ bài hợp lệ · Dữ liệu đã đồng bộ'}
        </span>
      </div>
      <div className="arena-controls__actions">
        <button className="arena-controls__edit" type="button" onClick={openArenaDeckBuilder}>CHỈNH SỬA BỘ BÀI</button>
        <button className="arena-controls__start" type="button" disabled={startingDuel} onClick={() => void startArenaDuel()}>
          {startingDuel ? 'ĐANG KIỂM TRA…' : 'BẮT ĐẦU ĐẤU'}
        </button>
      </div>
    </footer>
  </section>
)}
<MissionModal
  open={missionOpen}
  initialSnapshot={missionSnapshot}
  onClose={closeMissions}
  onSnapshotChange={setMissionSnapshot}
  onWalletChange={setWallet}
  onInventoryChange={setInventory}
  onOpenAttendance={() => {
    previousFocus.current = document.querySelector('[data-js="btn-missions"]');
    setAttendanceOpen(true);
  }}
  onOpenShop={() => {
    previousFocus.current = document.querySelector('[data-js="btn-missions"]');
    setPanel('shop');
  }}
/>
<ItemShop
  open={panel === 'item-shop'}
  wallet={wallet}
  inventory={inventory}
  onWalletChange={setWallet}
  onInventoryChange={setInventory}
  onClose={closePanel}
/>

    </>
  );
}

export default LobbyPage;
