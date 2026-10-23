/* boot.js -- brings up the web client.
 *
 * cocos2d-html5 loads this last (see project.json), calls cc.game.run(), and
 * hands control to onStart. From there:
 *
 *   1. fetch the resource manifest, the Lua sources and the data dumps
 *   2. start the wasm Lua 5.1 VM and wire the JS bridge to it
 *   3. write the game's modules into the VM's filesystem
 *   4. run lua/h5_boot.lua, which requires the game's own main.lua
 *
 * Nothing about the game's Lua is modified on the way in: the sources are the
 * same files the Android build packs.
 */
(function (global) {
	'use strict';

	/* The native client uses FIXED_HEIGHT with a 768px design height.  The
	 * authored scene coordinates (including FindClashArea's field at y=244)
	 * are in this logical surface; the browser viewport supplies only the
	 * scale and aspect-ratio-derived width. */
	var DESIGN_H = 768;
	var viewportW = Math.max(1, global.innerWidth || 1024);
	var viewportH = Math.max(1, global.innerHeight || 768);
	/* Replaced in onStart by what the view actually resolved to. */
	var DESIGN_W = Math.round(DESIGN_H * viewportW / viewportH);
	/* The bar's scale is the game's own. main.lua's boot chain announces its
	 * milestones as INIT_PROGRESS_40/50/60/80/100, and 100 lands immediately
	 * before it replaces the scene with RegionScene -- so the browser-side
	 * fetches fill only 0..40 and the game's numbers carry the rest. The
	 * overlay comes down on 100, which makes "bar full" and "game up" the
	 * same moment instead of leaving the player on a full bar. */
	var JS_PHASE = 0.4;
	var Boot = {
		lua: null,
		loaded: 0,
		total: 1,
		shown: 0,
		/* monotonic: a milestone never drags the bar backwards */
		progress: function (value) {
			if (!isFinite(value)) return;
			value = Math.max(0, Math.min(1, value));
			if (value <= Boot.shown) return;
			Boot.shown = value;
			var el = document.getElementById('bootProgress');
			if (el) el.value = value;
		},
		/* the fetch phase is only a fraction of the whole boot */
		fetchProgress: function (value) { Boot.progress(value * JS_PHASE); },
		takeOverlayDown: function () {
			if (Boot.done) return;
			Boot.done = true;
			status('running');
			var el = document.getElementById('bootOverlay');
			if (el) el.style.display = 'none';
		},
	};

	/* The caller already puts ?v=<version> on the URL, and the server answers
	   with an ETag, so the browser may keep the body and revalidate it -- a
	   304 instead of re-sending 3.4 MB of gzipped JSON and re-parsing it.
	   This used to append ?_t=<now> and pass cache:'no-store', which defeated
	   both: on a phone the boot that follows a killed tab paid the whole
	   download and parse again, so a device that ran out of memory once never
	   got past the overlay. */
	function fetchJson(url) {
		return fetch(url).then(function (r) {
			if (!r.ok) throw new Error(r.status + ' ' + url);
			var len = Number(r.headers.get('content-length')) || 0;
			if (!r.body || !len) return r.json();
			var reader = r.body.getReader(), chunks = [], received = 0;
			function read() { return reader.read().then(function (part) {
				if (part.done) { var all = new Uint8Array(received), p = 0;
					chunks.forEach(function (c) { all.set(c, p); p += c.length; });
					return JSON.parse(new TextDecoder().decode(all)); }
				chunks.push(part.value); received += part.value.length;
			Boot.fetchProgress((Boot.loaded + received / Math.max(1, len)) / Math.max(1, Boot.total));
				return read();
			}); }
			return read();
		});
	}

	function status(text) {
		var el = document.getElementById('bootStatus');
		if (el) el.textContent = text;
		cc.log('[boot] ' + text);
	}

	Boot.start = function () {
		var config = global.JDZC_CONFIG;

		status('loading manifest');

		/* Four bootstrap resources plus each configured preload are real work
		 * units.  The bar advances only when a fetch/decoder promise resolves;
		 * there is no timer-based fake progress. */
		Boot.loaded = 0;
		Boot.total = 9 + ((global.JDZC_CONFIG && global.JDZC_CONFIG.preload) || []).length;
		Boot.progress(0);
		function done(p) { return p.then(function (v) { Boot.loaded++; Boot.fetchProgress(Boot.loaded / Boot.total); return v; }); }
		var ver = (global.JDZC_CONFIG && global.JDZC_CONFIG.version) || '20260909e';
		return Promise.all([
			done(fetchJson('res_manifest.json?v=' + ver)),
			done(fetchJson('lua_src.json?v=' + ver)),
			done(fetchJson('data_dumps.json?v=' + ver)),
			/* emscripten fetches lua51.wasm with no cache-buster of its own, so
			 * a CDN that still holds an older wasm (without the decrypt hook)
			 * would be paired with the new encrypted bundle. Version the wasm URL
			 * to the same token as everything else. */
			done(global.LuaVM({ locateFile: function (p, dir) {
				return (dir || '') + p + (p === 'lua51.wasm' ? '?v=' + ver : '');
			} })),
		]).then(function (all) {
			var manifest = all[0], sources = all[1], dumps = all[2],
			    Module = all[3];

			jdzcRes.init(manifest, config.resBase);
			jdzcRes.setDumps(dumps);

			/* RegionScene, the first screen, builds its UI the moment it is
			 * created and cannot wait for a container to arrive, so the few
			 * it needs are resident before Lua starts. Everything after it
			 * goes through LoadingScene, which is event-driven and happy to
			 * wait.
			 *
			 * The language table is in the same class of problem, only worse:
			 * main.lua loads it and then reads Str() from it on the next
			 * line, which is safe on the device because loadRes is
			 * synchronous there. It is fetched first here so the parser can
			 * be handed a complete table before Lua runs. */
			status('loading text resources');
				return Promise.all([
					done(jdzcRes.preloadLanguage()),
					done(jdzcRes.preloadTexts()),
					done(jdzcRes.preloadPvr()),
					done(jdzcRes.preloadFonts()),
					done(global.jdzcPreloadShaders ? global.jdzcPreloadShaders() : Promise.resolve()),
				].concat((config.preload || []).map(function (p) { return done(jdzcRes.loadContainer(p)); })))
				.then(function () {
					return [sources, dumps, Module];
				});
		}).then(function (all) {
			var sources = all[0], Module = all[2];

			status('starting lua');

			var lua = new global.JdzcLua(Module);
			Boot.lua = lua;
			global.jdzcLua = lua;

			/* the game's modules, flat: basenames are unique tree-wide.
			 * A module the bundler encrypted arrives as a 0x01 marker byte
			 * followed by base64 ciphertext; it is written as /src/<name>.lcx
			 * and loaded through the decrypting package loader below. Plain
			 * modules (only `bridge`, which runs before that loader exists) are
			 * written as ordinary /src/<name>.lua. */
			Module.FS.mkdir('/src');
			Module.FS.mkdir('/save');
			Object.keys(sources).forEach(function (name) {
				var v = sources[name];
				if (v.charCodeAt(0) === 1) {
					var bin = atob(v.slice(1));
					var bytes = new Uint8Array(bin.length);
					for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
					Module.FS.writeFile('/src/' + name + '.lcx', bytes);
				} else {
					Module.FS.writeFile('/src/' + name + '.lua', v);
				}
			});

			/* Install a package loader that reads /src/<name>.lcx and decrypts
			 * it in wasm (__jdzc_loaddecrypt, key baked into glue.c) right before
			 * loadbuffer. Inserted at position 2 -- AFTER package.preload so
			 * h5_patch's preloaded stubs (socket, ...) still win over a module of
			 * the same basename on disk -- and before the /src/?.lua path loader,
			 * so a module with no .lcx falls through to plain .lua (only `bridge`).
			 * Installed before anything is required, so every game and h5_* engine
			 * module loads through it. */
			lua.run(
				'local ld = __jdzc_loaddecrypt\n' +
				'table.insert(package.loaders, 2, function(n)\n' +
				'  local f = io.open("/src/" .. n .. ".lcx", "rb")\n' +
				'  if not f then return nil end\n' +
				'  local d = f:read("*a"); f:close()\n' +
				'  local chunk, err = ld(d, "@" .. n .. ".lua")\n' +
				'  if not chunk then return "\\n\\t[jdzc] " .. tostring(err) end\n' +
				'  return chunk\n' +
				'end)', 'jdzc_loader');

			lua.run(sources.bridge, 'bridge.lua');
			lua.newproxyRef = lua.getGlobalRef('__jsb_newproxy');

			lua.run('package.path = "/src/?.lua"', 'package.path');

			/* the fork registers these as native constants, and the game
			 * does arithmetic on them while modules are still loading */
			lua.setGlobal('JDZC_TRACE', !!config.trace);
			lua.setGlobal('JDZC_VERSION', config.version || '1.0.0.1089');
			lua.setGlobal('JDZC_REGION', config.region || null);
			lua.setGlobal('SCR_W', DESIGN_W);
			lua.setGlobal('SCR_H', DESIGN_H);

			global.jdzcOnLuaError = function (msg) {
				cc.log('[lua error] ' + msg);
			};

			/* main.lua reports where its boot chain is through
			 * Data.Event.application ("event_application", Data.lua), one
			 * INIT_PROGRESS_<n> event per milestone. Left registered on
			 * purpose: ClientData listens on the same event, and removing a
			 * listener from inside its own dispatch splices the vector being
			 * iterated. `Boot.done` makes it a no-op after boot. */
			cc.eventManager.addCustomListener('event_application', function (e) {
				if (Boot.done) return;
				var m = /^INIT_PROGRESS_(\d+)$/.exec(e.getUserString() || '');
				if (!m) return;
				var pct = parseInt(m[1], 10);
				Boot.progress(pct / 100);
				if (pct >= 100) Boot.takeOverlayDown();
			});

			status('booting game');
			lua.run('require("h5_boot")', 'h5_boot');

			/* Safety net: a boot chain that dies before 100 would leave the
			 * player on a bar that never finishes. */
			setTimeout(Boot.takeOverlayDown, 60000);
		});
	};

	global.JdzcBoot = Boot;

	/* Fullscreen is the difference between a phone game and a web page, and
	 * the browser only grants it from a gesture -- so it rides the first tap,
	 * which the player makes anyway. The orientation is left alone on purpose:
	 * locking landscape would flip the page under a player still holding the
	 * phone upright, and #rotateHint already asks them to turn it. */
	function enterFullscreen() {
		var el = document.documentElement;
		if (document.fullscreenElement || !el.requestFullscreen) return;
		var req = el.requestFullscreen({ navigationUI: 'hide' });
		if (req && req.catch) req.catch(function () {});
	}

	cc.game.onStart = function () {
		/* before anything uploads a texture: free each atlas canvas once it
		 * is on the GPU (engine.js) -- the page otherwise holds every atlas
		 * twice and iOS kills the tab */
		if (global.jdzcFreeUploadedCanvases) global.jdzcFreeUploadedCanvases();
		cc.view.adjustViewPort(true);
		/* The phone hands cocos CSS pixels and cocos only turns retina on for
		 * iOS/mac, so on Android the whole game rendered at ~400x860 and the
		 * panel upscaled it -- soft art, soft text. This makes the canvas
		 * backing store the real screen, capped at 2x: past that it is fill
		 * rate for nothing. Has to come first, because the design size reads
		 * it when it sizes the canvas. */
		cc.view.enableRetina(true);
		/* Match the native Director: a fixed logical height with the width
		 * expanded to the browser aspect ratio. Fixed height in portrait too
		 * -- SHOW_ALL would frame a 1024-wide surface and leave black bars
		 * beside it for good once the player rotates into landscape. */
		cc.view.setDesignResolutionSize(DESIGN_W, DESIGN_H, cc.ResolutionPolicy.FIXED_HEIGHT);
		cc.view.resizeWithBrowserSize(true);
		/* what fixed-height actually handed us, rather than the aspect guessed
		 * from window.inner* above -- they agree, but only one is the truth */
		DESIGN_W = Math.round(cc.view.getVisibleSize().width);

		/* Entering fullscreen and rotating both change the frame, and mobile
		 * browsers report the old one for a beat -- so re-run the resize once
		 * it has settled. cocos binds its own handler to the same events. */
		['fullscreenchange', 'webkitfullscreenchange', 'orientationchange'].forEach(function (name) {
			document.addEventListener(name, function () {
				setTimeout(function () { cc.view._resizeEvent(); }, 300);
			});
		});
		document.addEventListener('touchend', function onFirstTap() {
			document.removeEventListener('touchend', onFirstTap);
			enterFullscreen();
		}, { passive: true });

		/* the game's boot chain schedules its first step on the running
		 * scene, so one has to exist before main.lua runs */
		cc.director.runScene(new cc.Scene());

		Boot.start().catch(function (e) {
			status('boot failed: ' + (e && e.stack ? e.stack : e));
			cc.error(e);
		});
	};

	cc.game.run();
})(window);
