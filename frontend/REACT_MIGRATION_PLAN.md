# React migration inventory and parity checklist

The application pages are served by React. First-party page scripts formerly under
`frontend/js/` have been ported to React and removed; the old page URLs are React entry
points or redirects, never a legacy fallback. First-party JavaScript outside `frontend/`
is intentionally out of scope and remains untouched. Third-party runtimes such as Cocos
and Three.js remain dependencies rather than being rewritten as application code.

## Existing application inventory

### Pages and source

- [x] Login/register: `login.html`, `css/theme.css`, `css/auth.css`, former `js/auth.js`,
  and click sound behavior converted to React in `src/pages/AuthPage.jsx` and
  `src/useButtonSound.js`.
  - Login and registration forms, native validation, password visibility, API status/errors,
    post-registration switch to login, authenticated-tab `sessionStorage`, redirect to `/start`.
- [x] Start/loading: `start.html`, `css/theme.css`, `css/start.css`, and former `js/start.js`
  converted to React in `src/pages/StartPage.jsx`.
  - Session validation, greeting, start music, progress UI, `/api/game/load-progress` SSE,
    progress animation, navigation to `/index.html`, and error feedback.
- [x] Lobby: `index.html`, `css/theme.css`, `css/lobby.css`, `css/card-frame.css`,
  and former lobby/shop/session/music/card-frame/card-viewer/hex-frame scripts converted
  into `src/pages/LobbyPage.jsx`, `src/renderers/cardFrameRenderer.js`,
  `src/renderers/card3dViewer.js`, and React hooks.
  - Player profile/name and wallet; character selection and saved selection; lobby navigation;
    card catalog, filters, card detail and art; shop pack selection, pagination, purchases,
    reveal animation, collection counts and reset confirmation; wallet exchange; settings,
    music/SFX and logout; video fallback; card canvas/3D and Three.js effects.
- [x] Duel: `duel.html`, `css/theme.css`, `css/card-frame.css`, `css/duel.css`,
  and former card/deck/motion/scheduler/engine/music scripts converted into
  `src/pages/DuelPage.jsx`, `src/pages/duelCardArt.js`,
  `src/pages/duelCardFrame.js`, `src/pages/duelMotion.js`, and
  `src/pages/useDuelCanvasEngine.js`. `cocos/` remains the third-party game engine runtime.
  - Deck/card catalog and shuffle, hand and zones, card selection/placement, opponent turn,
    scheduler/animations, sound/music, game log, rematch and exit. Some opponent play is local
    demo logic; no duel result persistence is present in the current frontend.

### Styles and resources

- [x] Shared/design: `css/theme.css`, `css/card-frame.css`.
- [x] Page styles: `css/auth.css`, `css/start.css`, `css/lobby.css`, `css/duel.css`.
- [x] Existing game resources: 117 PNG, 2 JPG, 6 MP3, 1 MP4; card data in
  `backend/data/cards.json`; Three.js vendor modules and Cocos engine under
  `backend/assets/vendor/` and `frontend/cocos/`.
- [x] Keep existing CSS selectors, `/assets/...` resources, fonts and image/video/audio
  behavior; import the existing page stylesheets from the React entry modules.

### Backend, APIs and persistence

- Flask serves the frontend and preserves same-origin cookie authentication.
- SQL Server `YUGIOHDB` stores users, selected character, player name, wallets and card
  ownership. Do not replace it with client-side/mock data.
- Preserve API contracts: `/api/register`, `/api/login`, `/api/logout`, `/api/session`,
  `/api/profile/character`, `/api/profile/player-name`, `/api/wallet`,
  `/api/wallet/exchange`, `/api/cards`, `/api/shop`, `/api/shop/purchase`,
  `/api/shop/reset`, `/api/game/load-progress` (SSE).
- Preserve `sessionStorage` auth-tab marker and music settings/position storage. Keep
  authenticated requests same-origin and cookie-compatible.

## Migration sequence and acceptance checks

- [x] Add isolated React/Vite toolchain and development proxy.
- [x] Convert login/register UI with existing field constraints, tab semantics and password
  toggles; verified page rendering, form visibility and native validation in the Flask-served
  build. The existing click-sound behavior is wired to React click capture.
- [ ] Verify successful/error auth API responses, authenticated-tab storage and post-login
  redirect against the real backend without creating or changing a player account.
- [x] Convert start/loading; verified the authenticated session, progress stream, loading
  state, five-second wait and transition to the React lobby; navigated away during loading
  once to exercise request cleanup.
- [x] Convert lobby in React feature slices; the first-party legacy scripts were retired.
  Verify API-backed profile, character, wallet, library,
  shop, exchange, overlays, keyboard/focus handling, media, canvases, WebGL and resize cleanup.
- [x] Convert duel into React-managed behavior; first-party legacy duel scripts were retired.
  Verify required engine loading and cleanup, all controls, turn/scheduler
  behavior, audio, responsive/landscape behavior and navigation.
- [ ] Complete end-to-end parity checks for auth/session, lobby API flows, duel, audio and
  responsive layouts at desktop and mobile sizes. Avoid purchasing/resetting live player data.
- [x] Normal Flask routes serve the React production build and return an explicit 503 if it
  has not been built; they do not silently fall back to legacy pages. Former first-party
  `frontend/js/` scripts and backup legacy pages have been retired. Never alter first-party
  JavaScript files outside `frontend/`.

## Current conversion status

- [x] Inventory completed for the four frontend pages, scripts/styles, resource groups,
  API surface, storage, and server/persistence boundaries.
- [x] React/Vite setup; login/register and start/loading first slices converted with existing CSS.
- [x] React implementations exist for login/register, loading, lobby and duel; Flask routes
  serve built React entries. App-authored runtime helpers are implemented in React modules.
- [ ] Full behavior parity and live-backend verification remain pending; do not claim the
  migration is fully verified until these checks pass.

## Current verification and known limits

- `npm --prefix frontend run build`, `node --check frontend\vite.config.js`, and
  `python -m py_compile backend\app.py` pass.
- The first-party `frontend/js/` directory no longer contains app scripts. A production bundle
  scan found no imports of the retired scripts; the React lobby/duel use React-owned card
  renderers and duel helpers. The remaining standalone JavaScript under `frontend/` is React
  source and the 62-file vendored Cocos engine; third-party runtime code is not application
  code to rewrite.
- A Flask test client confirmed that authenticated `/start`, `/start.html`, `/index.html`,
  `/react-start.html`, and `/duel.html` return React bundle HTML, while unauthenticated
  protected routes redirect. `/`, `/login`, `/login.html`, and `/react.html` return React
  login HTML without loading the legacy auth script.
- Browser checks verified lobby rendering with API data, shop navigation, five-column desktop
  cards, responsive pagination (4 cards at 904×430 and 900×430; 10 at 960×540), and
  nonzero card heights. Duel canvas loaded without failed resources; draw and end-turn updated
  the game state. React login/register tab switching and password visibility were also checked
  in Vite; the authenticated duel test used deterministic mocked card data.
- The local browser session became unauthenticated after Flask restarted, so live browser
  verification of API-backed flows was not possible in the latest pass. No purchase, reset,
  exchange, account creation, or persistent account changes were performed for verification.
- Old login/start markup now mounts the React entries; old lobby/duel backup URLs redirect
  to the protected React routes. Flask blocks requests for retired `/js/` app scripts and
  does not silently serve legacy page fallbacks.
- Cocos and Three.js remain external rendering engines. The duel still reflects the prior
  frontend's simplified/demo duel behavior; combat damage/result persistence were not present
  in the old behavior and are not newly implemented by this migration.

## Developer commands

Run these commands from the project root:

```powershell
npm --prefix frontend install
npm --prefix frontend run dev
npm --prefix frontend run build
```

The Vite development server proxies `/api`, `/assets`, and Flask page routes to
`http://127.0.0.1:5000`. Use `/react.html`, `/react-start.html`, `/index.html`, and
`/duel.html` on the Vite server to inspect converted pages; the production build is emitted
to `frontend/react-build/` and served by the corresponding Flask routes.
