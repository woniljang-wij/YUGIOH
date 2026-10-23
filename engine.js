/* engine.js -- the cocos2d-x 3.3 Lua binding surface, on cocos2d-html5.
 *
 * The game's 413 Lua modules were written against the tolua bindings of a
 * cocos2d-x 3.3 fork. cocos2d-html5 is the same engine with the same class
 * names and nearly the same methods, so most calls need no help at all --
 * `cc.Sprite:create(path)` already resolves to `cc.Sprite.create(path)`
 * through the bridge. This file fills the gaps:
 *
 *   * the singletons the Lua API reaches through getInstance()
 *   * cc.Label, which html5 splits into LabelTTF / LabelBMFont
 *   * the fork's own classes: cc.ShaderSprite, ccui.ShaderButton,
 *     cc.DragonBonesNode, ccui.RichTextEx
 *   * the handful of renamed methods (getEventDispatcher, scheduleScriptFunc)
 */
(function (global) {
	'use strict';

	var cc = global.cc, ccui = global.ccui;
	var res = global.jdzcRes;

	/* retain()/release() are no-ops in cocos2d-html5, where nothing needed
	 * them: any Lua reference kept a node alive. lua.js now holds nodes
	 * weakly, the way the device does (a node lives while it is in the scene
	 * graph or retained), so retain has to keep a node for real -- the game
	 * retains exactly the nodes it parks off-screen: pooled IconWidgets and
	 * CardThumbnails, TopMostPanel, the guide layer. */
	var retainedNodes = global.jdzcRetainedNodes = new Set();   /* read by work/h5_mem_probe.mjs */
	cc.Node.prototype.retain = function () {
		this.__jdzcRetain = (this.__jdzcRetain || 0) + 1;
		retainedNodes.add(this);
	};
	cc.Node.prototype.release = function () {
		if (this.__jdzcRetain > 0 && --this.__jdzcRetain === 0)
			retainedNodes.delete(this);
	};

	/* Touch and click listeners outlived their nodes.
	 *
	 * On the device a node's listeners go when the node is destroyed
	 * (~Node -> removeEventListenersForTarget), and a node is destroyed the
	 * moment it leaves the scene graph unretained. JS has no destructor:
	 * html5 only drops them in cleanup(), which a node removed without
	 * cleanup, or dropped along with a whole dialog, never gets. The listener
	 * map then held every button of every screen ever opened -- and through
	 * each listener its node, the node's subtree and textures, and the Lua
	 * handler with everything it closed over. A heap snapshot after a few
	 * rounds of Deck/Shop/Card screens traced thousands of dead sprites to
	 * cc.eventManager._nodeListenersMap and nothing else.
	 *
	 * So, every few seconds, do what the destructor would have: drop the
	 * listeners of nodes that are dead by the device's rule -- not under a
	 * scene the director still holds (running, next, the push stack, either
	 * side of a transition), and neither they nor an ancestor retained. */
	function nodeIsLive(node) {
		var root = node;
		for (var n = node; n; n = n._parent) {
			if (n.__jdzcRetain) return true;
			root = n;
		}
		var d = cc.director, running = d._runningScene;
		if (root === running || root === d._nextScene || root === d._notificationNode)
			return true;
		if (running && (root === running._inScene || root === running._outScene))
			return true;
		var stack = d._scenesStack || [];
		for (var i = 0; i < stack.length; i++) if (stack[i] === root) return true;
		return false;
	}

	function sweepDeadListeners() {
		var em = cc.eventManager, map = em && em._nodeListenersMap;
		if (!map || em._inDispatch) return 0;
		var dead = [];
		for (var id in map) {
			var list = map[id];
			var node = list && list.length ? list[0]._node : null;
			if (node && !node._running && !nodeIsLive(node)) dead.push(node);
		}
		for (var j = 0; j < dead.length; j++) em.removeListeners(dead[j], false);
		return dead.length;
	}

	global.jdzcSweepDeadListeners = sweepDeadListeners;
	setInterval(function () {
		try { sweepDeadListeners(); } catch (e) { cc.log('[sweep] ' + e); }
	}, 3000);

	/* ------------------------------------------------------------------ *
	 * cc.Application -- lc.App
	 *
	 * Everything platform-specific in the game goes through here. On the
	 * web most of it is a constant; the SDK entry points (pay, facebook,
	 * yyb) have no web counterpart and stay inert.
	 * ------------------------------------------------------------------ */

	var config = global.JDZC_CONFIG || {};

	var app = {
		/* --- identity ------------------------------------------------ */
		getTargetPlatform: function () { return cc.PLATFORM_OS_WINDOWS; },
		getChannelName: function () { return config.channel || 'h5'; },
		getPackageId: function () { return config.packageId || 'com.tuoyin.jdzc.h5'; },
		getAppId: function () { return config.appId || '1'; },
		getUdid: function () { return app._udid(); },
		getIdfa: function () { return ''; },
		getDeviceModel: function () { return navigator.userAgent.slice(0, 64); },
		getSystemMemory: function () { return (navigator.deviceMemory || 4) * 1024; },
		getBinaryVersion: function () { return config.binaryVersion || '1.5.0'; },

		/* --- servers ------------------------------------------------- */
		getRedirectGameServer: function () { return config.redirectServer || ''; },
		/* ClientData.reconnectRegionServer splits this on ":" for host and
		 * port; on the device that branch is skipped and the endpoint is
		 * hardwired, so the web has to supply one. */
		getRegionServer: function () {
			if (config.regionServer) return config.regionServer;
			var region = config.region;
			return region ? region.ip + ':' + region.port : '';
		},
		getOption: function (key) { return (config.options || {})[key] || ''; },

		/* --- resources ----------------------------------------------- */
		loadRes: function (path) { return res.load(path); },
		unloadRes: function (name) {
			if (Array.isArray(name)) name.forEach(res.unloadContainer);
			else res.unloadContainer(name);
		},
		getBinData: function (name) { return name; },
		getLanString: function (id) { return ''; },

		/* --- storage ------------------------------------------------- */
		loadUserId: function () {
			return localStorage.getItem('jdzc.userId') || '';
		},
		getOpenFileName: function (name) { return name; },
		getSaveFileName: function (name) { return name; },

		/* --- inert on the web ---------------------------------------- */
		/* the game hands the player to no page but its own; the Lua is checked
		 * for link literals (tools/verify_no_external_links.py), and this stays
		 * shut for the one that would not show up there -- a URL arriving from
		 * the server as data */
		openUrl: function (url) { cc.log('[app] refusing to open ' + url); },
		openURL: function (url) { cc.log('[app] refusing to open ' + url); },
		getAppRateUrl: function () { return ''; },
		getDisplayPrice: function () { return ''; },
		pay: function () { cc.log('[app] pay is not available on the web'); },
		userLogout: function () {},
		bindAlias: function () {},
		addNotification: function () {},
		submitExtendData: function () {},
		switchToUpdateScene: function () {},
		wxShare: function () {},
		facebookLogin: function () {},
		facebookLike: function () {},
		facebookInvite: function () {},
		yybGetLoginType: function () { return 0; },
		yybOpenBbs: function () {},
		yybOpenVip: function () {},
		yybOpenVplus: function () {},

		_udid: function () {
			var id = localStorage.getItem('jdzc.udid');
			if (!id) {
				id = 'web-' + Math.random().toString(36).slice(2) +
					Date.now().toString(36);
				localStorage.setItem('jdzc.udid', id);
			}
			return id;
		},
	};

	cc.Application = cc.Application || {};
	cc.Application.getInstance = function () { return app; };
	global.jdzcApp = app;

	/* ------------------------------------------------------------------ *
	 * cc.Director
	 * ------------------------------------------------------------------ */

	cc.Director.getInstance = function () { return cc.director; };

	var director = cc.director;

	director.getEventDispatcher = function () { return cc.eventManager; };
	director.getTextureCache = function () { return cc.textureCache; };
	/* Seconds, not milliseconds: the game divides it by 3600 for the hour
	 * and compares heartbeat gaps against 30 and 60. */
	director.getCurrentTime = function () { return Date.now() / 1000; };
	director.updateTouchTimestamp = function () {};
	director.setIdleTime = function () {};
	director.setBlurParam = function () {};
	/* The fork blurs the running scene into a texture and shows it behind a
	 * panel. A plain dark layer stands in -- the panel still reads as being
	 * on top of something dimmed. Full blur would require a render-to-texture
	 * pass that cocos2d-html5 does not expose directly. */
	director.getBlurredScene = function () {
		var size = cc.director.getVisibleSize();
		var blurred = new cc.LayerColor(cc.color(0, 0, 0, 140), size.width, size.height);

		/* Native finishes its render-to-texture pass asynchronously and then
		 * notifies BasePanel.  The panel deliberately remains hidden until that
		 * event arrives, so the web stand-in must keep the same lifecycle even
		 * though it does not perform an actual blur pass. */
		setTimeout(function () {
			cc.eventManager.dispatchEvent(new cc.EventCustom('director_after_blur'));
		}, 0);

		return blurred;
	};
	director.getZEye = function () { return 1500; };
	director.popToSceneStackLevel = director.popToSceneStackLevel ||
		function () { director.popToRootScene(); };
	/* the Lua bindings call it replaceScene; html5 calls it runScene */
	director.replaceScene = function (scene) { director.runScene(scene); };

	/* One bad frame must not end the game.
	 *
	 * cocos2d-html5 runs the whole frame inside a requestAnimationFrame
	 * callback and schedules the next one from the same place, so a single
	 * throw anywhere - an action built from something that is not an action,
	 * a Lua handler that errors - stops the loop for good and freezes the
	 * canvas on its last frame, with nothing on screen to say why. */
	var mainLoop = director.mainLoop;

	director.mainLoop = function () {
		try {
			mainLoop.apply(director, arguments);
		} catch (e) {
			cc.log('[frame] ' + (e && e.stack ? e.stack : e));
		}
	};

	/* ------------------------------------------------------------------ *
	 * actions
	 *
	 * The fork's bindings shrugged off a sequence with one element, or with
	 * a nil among them; html5 builds a malformed action and throws on the
	 * next frame. Filter, and let a single action stand for itself.
	 * ------------------------------------------------------------------ */

	function actionList(args) {
		var list = (args.length === 1 && Array.isArray(args[0]))
			? args[0] : Array.prototype.slice.call(args);
		return list.filter(function (action) {
			return action && typeof action.startWithTarget === 'function';
		});
	}

	['Sequence', 'Spawn'].forEach(function (name) {
		var build = name === 'Sequence' ? cc.sequence : cc.spawn;
		cc[name].create = function () {
			var list = actionList(arguments);
			if (list.length === 0) return new cc.DelayTime(0);
			if (list.length === 1) return list[0];
			return build(list);
		};
		cc[name].new = cc[name].create;
	});

	/* ------------------------------------------------------------------ *
	 * cc.eventManager -- the Lua API calls it an event dispatcher
	 * ------------------------------------------------------------------ */

	var em = cc.eventManager;

	em.addEventListenerWithFixedPriority = function (listener, priority) {
		em.addListener(listener, priority);
		return listener;
	};
	em.addEventListenerWithSceneGraphPriority = function (listener, node) {
		em.addListener(listener, node);
		return listener;
	};
	em.removeEventListener = function (listener) { em.removeListener(listener); };

	/* A widget released inside its own touch callback is removed and re-added
	 * within that one dispatch -- every pooled list item does this, because
	 * CardThumbnail.releaseToPool detaches the node in the touch-ended handler
	 * and updateXxx then hands the same slot straight back. html5 queues both
	 * and drains the adds BEFORE the removals, so the removal splices out the
	 * listener that was just re-added. _registered survives, and addListener()
	 * refuses a registered listener for good: the list goes deaf and nothing
	 * the game does can wake it. Draining removals first makes last-op-wins. */
	var updateListeners = em._updateListeners;
	em._updateListeners = function (event) {
		if (this._inDispatch <= 1 && this._toRemovedListeners.length !== 0)
			this._cleanToRemovedListeners();
		return updateListeners.apply(this, arguments);
	};

	/* cc.EventCustom carries a string payload in this game */
	var EventCustom = cc.EventCustom;
	EventCustom.prototype.setUserString = function (s) { this._userString = s; };
	EventCustom.prototype.getUserString = function () { return this._userString || ''; };
	EventCustom.create = function (name) { return new EventCustom(name); };
	EventCustom.new = EventCustom.create;

	cc.EventListenerCustom = {
		create: function (eventName, callback) {
			return cc.EventListener.create({
				event: cc.EventListener.CUSTOM,
				eventName: eventName,
				callback: callback,
			});
		},
	};

	/* The Lua bindings build a listener, then attach callbacks to it by
	 * cc.Handler id. Same listeners here, with that registration on top. */
	function scriptListener(spec, slots) {
		var listener = cc.EventListener.create(spec(function (id) {
			return function () {
				var fn = listener.__handlers[id];
				return fn ? fn.apply(null, arguments) : true;
			};
		}));

		listener.__handlers = {};
		listener.registerScriptHandler = function (fn, id) {
			listener.__handlers[id] = fn;
		};
		return listener;
	}

	cc.EventListenerKeyboard = {
		create: function () {
			return scriptListener(function (slot) {
				return {
					event: cc.EventListener.KEYBOARD,
					onKeyPressed: slot(38),
					onKeyReleased: slot(39),
				};
			});
		},
	};

	cc.EventListenerTouchOneByOne = {
		create: function () {
			return scriptListener(function (slot) {
				return {
					event: cc.EventListener.TOUCH_ONE_BY_ONE,
					swallowTouches: false,
					onTouchBegan: slot(40),
					onTouchMoved: slot(41),
					onTouchEnded: slot(42),
					onTouchCancelled: slot(43),
				};
			});
		},
	};

	cc.EventListenerMouse = {
		create: function () {
			return scriptListener(function (slot) {
				return {
					event: cc.EventListener.MOUSE,
					onMouseDown: slot(48),
					onMouseUp: slot(49),
					onMouseMove: slot(50),
					onMouseScroll: slot(51),
				};
			});
		},
	};

	/* ------------------------------------------------------------------ *
	 * scheduler -- the Lua API schedules plain functions by id
	 * ------------------------------------------------------------------ */

	var scheduler = director.getScheduler();
	var scheduleTargets = {};
	var nextEntry = 1;

	scheduler.scheduleScriptFunc = function (fn, interval, paused) {
		var id = nextEntry++;
		var target = new cc.Node();
		scheduleTargets[id] = target;
		scheduler.scheduleUpdate ?
			scheduler.schedule(fn, target, interval || 0, cc.REPEAT_FOREVER, 0,
					   !!paused, 'jdzc' + id)
			: scheduler.schedule(fn, target, interval || 0, !!paused);
		return id;
	};

	/* unscheduleAllCallbacksForTarget only looks for a timer keyed by the
	 * target's own id, which is not the key scheduleScriptFunc used, so it
	 * silently cancels nothing. Everything the game schedules and then
	 * cancels -- the battle's own step timer above all -- would otherwise
	 * keep firing every frame forever. */
	scheduler.unscheduleScriptEntry = function (id) {
		var target = scheduleTargets[id];
		if (target) {
			scheduler.unscheduleAllForTarget(target);
			delete scheduleTargets[id];
		}
	};

	/* ------------------------------------------------------------------ *
	 * texture cache
	 * ------------------------------------------------------------------ */

	/* Two shapes, both from the fork:
	 *   addImageWithMask(path)                        -- plain image
	 *   addImageWithMask(jpg, jpgLen, mask, maskLen, name) -- from a .lcres
	 * The container form never reaches here: ClientData.loadLCRes is
	 * replaced wholesale by the JS resource layer (see lua/h5_patch.lua). */
	cc.textureCache.addImageWithMask = function (path) {
		if (typeof path !== 'string') return null;
		if (!res.exists(path)) return null;

		/* the alpha lives in <name>_mask.png beside the colour plane */
		var url = res.base + path.replace(/^res\//, '');
		return res.maskedTexture(path, url,
					 url.replace(/\.[A-Za-z]+$/, '_mask.png'));
	};

	/* Every atlas the resource layer builds is a <canvas> (a .jpm's colour
	 * and alpha merged, a .pvr.ccz decoded), and cc.Texture2D keeps that
	 * canvas as its element for as long as the texture lives -- after it has
	 * already been copied to the GPU. A 2048x2048 atlas is 16 MB, the city
	 * alone keeps ~20 of them, so the page held every atlas twice: ~320 MB of
	 * canvas on top of the same pixels in GL. On iOS, where the GPU shares the
	 * page's memory, that is what got the tab killed and reloaded a few
	 * minutes into a session.
	 *
	 * Under WebGL the element is only read to upload (handleLoadedTexture),
	 * and nothing here survives a lost context anyway, so once the upload has
	 * happened the canvas can give its backing store back: 0x0 frees it, and
	 * a later handleLoadedTexture on a 0x0 element returns before touching
	 * the GL texture. Only canvases res.js made (__jdzcOwned) are touched --
	 * an <img> the browser decoded is not ours to shrink, and the canvas
	 * renderer still draws straight from the element. */
	/* Called from boot.js's onStart: the WebGL cc.Texture2D methods are only
	 * installed when the renderer is created (cc.game.run), after this file
	 * has run, and would overwrite a patch made here. */
	global.jdzcFreeUploadedCanvases = function () {
		if (cc._renderType !== cc.game.RENDER_TYPE_WEBGL) return false;
		var baseHandleLoaded = cc.Texture2D.prototype.handleLoadedTexture;
		cc.Texture2D.prototype.handleLoadedTexture = function (premultiplied) {
			var element = this._htmlElementObj;
			var result = baseHandleLoaded.call(this, premultiplied);
			if (element && element.__jdzcOwned && element === this._htmlElementObj &&
			    cc.game._rendererInitialized && element.width && element.height &&
			    this._pixelsWide === element.width) {
				element.width = 0;
				element.height = 0;
			}
			return result;
		};
		return true;
	};

	/* the game evicts textures on scene exit (TavernScene's
	 * removeTexureByCheckInfo and friends). The resource layer must forget
	 * its "already loading/loaded" bookkeeping for the key, or the next
	 * visit would be handed an empty placeholder forever: maskedTexture
	 * early-returns on a stale inflight marker, and loadContainer
	 * early-returns while the container still says resident. */
	var baseRemoveTextureForKey = cc.textureCache.removeTextureForKey.bind(cc.textureCache);
	cc.textureCache.removeTextureForKey = function (key) {
		/* The updater's atlas is decoded once, before Lua starts
		 * (res.preloadPvr); html5 cannot read a .pvr.ccz, so once evicted
		 * it only ever comes back as an empty texture. main.lua evicts it
		 * (unloadLoadingRes) right before RegionScene re-adds it, which left
		 * the login/register tabs on a frame with no pixels -- 0x0 buttons
		 * nobody can tap. ponytail: 1 MB kept resident for the session. */
		if (typeof key === 'string' && /\.pvr\.ccz$/i.test(key)) return;
		if (typeof key === 'string') {
			if (res.maskedInflight) delete res.maskedInflight[key];
			if (res.pending) delete res.pending[key];
			if (res.containerOf) {
				var container = res.containerOf[key];
				if (container) delete res.loaded[container];
			}
		}
		return baseRemoveTextureForKey(key);
	};

	/* addImage is handed two different things by the game. One is a path
	 * into res/, which is a download and which html5 already knows how to
	 * do. The other is the name of an entry inside a .lcres container --
	 * "10001.jpm", a card's art -- which on the device was already resident
	 * and here is still in flight. That name is not a URL: fetching it 404s
	 * and the caller (`_image:setTexture(lc.TextureCache:addImage(name))`)
	 * ends up with nothing.
	 *
	 * Hand back an empty texture registered under that name instead. The
	 * resource layer fills that very object when the container lands, and
	 * every sprite holding it redraws off the texture's own "load" event. */
	var baseAddImage = cc.textureCache.addImage.bind(cc.textureCache);

	cc.textureCache.addImage = function (url, cb, target) {
		if (typeof url !== 'string')
			return baseAddImage(url, cb, target);

		var cached = cc.textureCache.getTextureForKey(url);
		if (cached) {
			if (cb) cb.call(target, cached);
			return cached;
		}

		var isPath = url.indexOf('res/') === 0 || url.indexOf(res.base) === 0;

		/* If the url ends in .jpm, it's a masked texture (jpg + _mask.png) */
		if (/\.jpm$/.test(url)) {
			var jpgPath = url.replace(/\.jpm$/, '.jpg');
			var maskPath = url.replace(/\.jpm$/, '_mask.png');
			var realJpgUrl = res.base + jpgPath.replace(/^res\//, '');
			var realMaskUrl = res.base + maskPath.replace(/^res\//, '');
			var tex = res.maskedTexture(url, realJpgUrl, realMaskUrl);
			if (cb) {
				if (tex.isLoaded()) cb.call(target, tex);
				else tex.addEventListener('load', function () { cb.call(target, tex); });
			}
			return tex;
		}

		/* a loose path into res/ that the manifest does not list is a file
		 * that is not there; LoadingScene preloads a few this tree no
		 * longer ships, and a fetch would only be a 404. A path inside a
		 * .lcres is an entry of a container, which the manifest lists
		 * under the container rather than as a file of its own. */
		if (isPath && url.indexOf('.lcres/') < 0 &&
		    !res.exists(url.replace(res.base, 'res/'))) return null;

		if (!isPath && !res.exists(url)) {
			var placeholder = res.emptyTexture(url);
			cc.textureCache._textures[url] = placeholder;
			if (cb) placeholder.addEventListener('load', function () {
				cb.call(target, placeholder);
			});
			return placeholder;
		}

		var tex = baseAddImage(url, cb, target);
		if (tex && !tex.isLoaded() && res.manifest && res.manifest.sizes) {
			var normalized = url.replace(/\.jpm$/, '.jpg');
			var sz = res.manifest.sizes[url] ||
				 res.manifest.sizes[normalized] ||
				 res.manifest.sizes[url.replace(/^res\//, '')] ||
				 res.manifest.sizes[normalized.replace(/^res\//, '')] ||
				 res.manifest.sizes['res/' + url.replace(/^res\//, '')] ||
				 res.manifest.sizes['res/' + normalized.replace(/^res\//, '')];
			if (sz && sz[0] && sz[1]) {
				tex._contentSize.width = sz[0];
				tex._contentSize.height = sz[1];
				tex._pixelsWide = sz[0];
				tex._pixelsHigh = sz[1];
			}
		}
		return tex;
	};

	/* ------------------------------------------------------------------ *
	 * sprite frame cache
	 * ------------------------------------------------------------------ */

	cc.SpriteFrameCache = cc.SpriteFrameCache || {};
	cc.SpriteFrameCache.getInstance = function () { return cc.spriteFrameCache; };
	/* The .lcres container forms are handled by the resource layer. This one
	 * is a plain TexturePacker plist handed over as text, with the texture
	 * already in hand -- RegionScene loads its atlas that way. */
	var contentSeq = 0;

	cc.spriteFrameCache.addSpriteFramesWithFileContent = function (content, texture) {
		if (!content) return;
		var dict = typeof content === 'string' ? cc.plistParser.parse(content) : content;
		if (!dict || !dict.frames) {
			cc.log('[engine] addSpriteFramesWithFileContent: no frames');
			return;
		}
		cc.spriteFrameCache._addSpriteFramesByObject(
			'jdzc-content-' + (++contentSeq), dict, texture);
		/* Frames registered from Lua at run time (card list icons) may sit on a
		 * texture that is still downloading; nodes built from them wait in
		 * res.frameWaiters, and only the .sfb loader ever resolved those. */
		var names = Object.keys(dict.frames);
		var wake = function () {
			for (var i = 0; i < names.length; i++) {
				var f = lookupFrame(names[i]);
				if (f && res.resolveFrame) res.resolveFrame(names[i], f);
			}
		};
		if (texture && texture.isLoaded && !texture.isLoaded() && texture.addEventListener)
			texture.addEventListener('load', wake);
		else
			wake();
	};

	cc.spriteFrameCache.addSpriteFramesWithData = function () {};

	/* Keep the public cache native: game code uses a missing frame as an
	 * existence test for optional skins and channel variants. The asynchronous
	 * construction paths below wait for late atlas frames themselves. */
	var lookupFrame = cc.spriteFrameCache.getSpriteFrame.bind(cc.spriteFrameCache);

	cc.spriteFrameCache.getSpriteFrame = function (name) {
		return lookupFrame(name) || null;
	};

	/* ------------------------------------------------------------------ *
	 * cc.FileUtils -- there is no filesystem, only URLs
	 * ------------------------------------------------------------------ */

	var files = {
		fullPathForFilename: function (name) { return name; },
		isFileExist: function (name) { return res.exists(name); },
		getWritablePath: function () { return '/save/'; },
		purgeCachedEntries: function () {},
		getSearchPaths: function () { return ['']; },
		getStringFromFile: function (name) { return res.textOf(name) || ''; },
		getDataFromFile: function (name) { return res.textOf(name) || ''; },
		getValueMapFromFile: function (name) {
			return files.getValueMapFromData(res.textOf(name));
		},
		getValueMapFromData: function (data) {
			if (!data) return {};
			var map = cc.plistParser.parse(data);
			return map || {};
		},
		setPopupNotify: function () {},
		isPopupNotify: function () { return false; },
		addSearchPath: function () {},
	};

	cc.FileUtils = cc.FileUtils || {};
	cc.FileUtils.getInstance = function () { return files; };

	/* Exactly one line in the game reads a touch id: BattleUiTouch.onTouchBegan
	 * turns away every touch whose id isn't 0, because cocos2d-x hands ids out
	 * from a pool that gives the finger that is down id 0. This port passed the
	 * browser's Touch.identifier through instead, and that identifier is the
	 * browser's own -- Safari counts up from 1 -- so on iPhone that gate
	 * rejected every drag while the widget buttons, which never look at an id,
	 * kept working. Hand the game native-style slots instead: first finger down
	 * 0, next 1, released when it lifts. */
	var touchSlots = {};				/* browser identifier -> the id Lua sees */
	/* set while the input manager builds touches out of a DOM event: those are
	 * the ones carrying a browser identifier to translate. The copies the
	 * dispatcher makes of them already hold a slot. */
	var fromDom = false;

	function touchIdOf(touch) {
		var raw = touch.__rawId;
		if (raw === undefined || raw === null) {
			return (touch._id === undefined || touch._id === null) ? 0 : touch._id;
		}
		if (touchSlots[raw] === undefined) {
			var taken = [], n = 0;
			for (var k in touchSlots) taken[touchSlots[k]] = 1;
			while (taken[n]) n++;
			touchSlots[raw] = n;
		}
		return touchSlots[raw];
	}

	if (cc.Touch) {
		var origSetTouchInfo = cc.Touch.prototype.setTouchInfo;
		cc.Touch.prototype.setTouchInfo = function (id, x, y) {
			origSetTouchInfo.call(this, (id === undefined || id === null) ? 0 : id, x, y);
			if (fromDom && id !== undefined && id !== null) this.__rawId = id;
		};
		cc.Touch.prototype.getId = function () { return touchIdOf(this); };
		cc.Touch.prototype.getID = function () { return touchIdOf(this); };
		cc.Touch.prototype.getStartLocation = function () {
			if (this._startPoint) {
				return { x: this._startPoint.x, y: this._startPoint.y };
			}
			return { x: this._point.x, y: this._point.y };
		};
		cc.Touch.create = function (id, x, y) {
			return new cc.Touch(x || 0, y || 0, (id === undefined || id === null) ? 0 : id);
		};
	}

	/* The slot is freed once the finger is up, so the next touch starts at 0
	 * again, and the retired touch forgets its identifier -- it stays in the
	 * pre-touch pool, and a live finger taking the freed slot must not be read
	 * as its continuation. */
	if (cc.inputManager && cc.inputManager.getTouchesByEvent) {
		var origTouchesByEvent = cc.inputManager.getTouchesByEvent;
		cc.inputManager.getTouchesByEvent = function (event, pos) {
			fromDom = true;
			try {
				return origTouchesByEvent.call(this, event, pos);
			} finally {
				fromDom = false;
			}
		};
		['handleTouchesEnd', 'handleTouchesCancel'].forEach(function (name) {
			var orig = cc.inputManager[name];
			cc.inputManager[name] = function (touches) {
				var out = orig.apply(this, arguments);
				for (var i = 0; touches && i < touches.length; i++) {
					delete touchSlots[touches[i].__rawId];
					touches[i].__rawId = null;
				}
				return out;
			};
		});
	}

	/* ------------------------------------------------------------------ *
	 * cc.UserDefault -- localStorage
	 * ------------------------------------------------------------------ */

	function key(k) { return 'jdzc.ud.' + k; }

	var userDefault = {
		getBoolForKey: function (k, def) {
			var v = localStorage.getItem(key(k));
			return v === null ? !!def : v === '1';
		},
		setBoolForKey: function (k, v) { localStorage.setItem(key(k), v ? '1' : '0'); },
		getIntegerForKey: function (k, def) {
			var v = localStorage.getItem(key(k));
			return v === null ? (def || 0) : parseInt(v, 10);
		},
		setIntegerForKey: function (k, v) { localStorage.setItem(key(k), String(v)); },
		getStringForKey: function (k, def) {
			var v = localStorage.getItem(key(k));
			return v === null ? (def || '') : v;
		},
		setStringForKey: function (k, v) { localStorage.setItem(key(k), String(v)); },
		getFloatForKey: function (k, def) {
			var v = localStorage.getItem(key(k));
			return v === null ? (def || 0) : parseFloat(v);
		},
		setFloatForKey: function (k, v) { localStorage.setItem(key(k), String(v)); },
		flush: function () {},
	};

	cc.UserDefault = cc.UserDefault || {};
	cc.UserDefault.getInstance = function () { return userDefault; };

	/* ------------------------------------------------------------------ *
	 * cc.Label -- html5 keeps TTF and BMFont apart
	 * ------------------------------------------------------------------ */

	cc.Label = {
		createWithTTF: function (text, font, size, dimensions, hAlign, vAlign) {
			var label = new cc.LabelTTF(String(text), global.jdzcFontFamily(font),
						    size || 20, dimensions, hAlign, vAlign);
			return label;
		},
		createWithSystemFont: function (text, font, size, dimensions, hAlign, vAlign) {
			return new cc.LabelTTF(String(text), font || 'Arial', size || 20,
					       dimensions, hAlign, vAlign);
		},
		createWithBMFont: function (fnt, text, hAlign, maxWidth) {
			return new cc.LabelBMFont(String(text), fnt, maxWidth, hAlign);
		},
		createWithCharMap: function (file, w, h, start) {
			return new cc.LabelAtlas('', file, w, h, start);
		},
	};

	/* The Vietnamese cache contains a few zero-width separators. Bitmap fonts
	 * have no glyph for them, so cocos2d logs once per character on every label
	 * refresh during matchmaking. They are not visible content, unlike the
	 * Vietnamese accents which are handled by ClientView's outline-font path. */
	function sanitizeBMFontText(value) {
		return typeof value === 'string' ? value.replace(/[\u200B\uFEFF]/g, '') : value;
	}

	function patchBMFontTextMethod(name) {
		if (!cc.LabelBMFont || !cc.LabelBMFont.prototype) return;
		var original = cc.LabelBMFont.prototype[name];
		if (!original || original.__jdzcSanitizesText) return;

		function patched() {
			var args = Array.prototype.slice.call(arguments);
			if (args.length > 0) args[0] = sanitizeBMFontText(args[0]);
			return original.apply(this, args);
		}

		patched.__jdzcSanitizesText = true;
		cc.LabelBMFont.prototype[name] = patched;
	}

	patchBMFontTextMethod('initWithString');
	patchBMFontTextMethod('setString');

	/* the fork's Label has a few extras over LabelTTF */
	var ttf = cc.LabelTTF.prototype;
	ttf.setAdditionalKerning = ttf.setAdditionalKerning || function () {};
	ttf.enableOutline = ttf.enableOutline || function (color, size) {
		this.enableStroke(color, size);
	};
	ttf.enableShadow = ttf.enableShadow || function () {};
	ttf.getStringLength = ttf.getStringLength || function () {
		return this.getString().length;
	};
	ttf.setOverflow = ttf.setOverflow || function () {};
	ttf.setLineHeight = ttf.setLineHeight || function () {};

	/* ------------------------------------------------------------------ *
	 * cc.ShaderSprite / ccui.ShaderButton
	 *
	 * The fork draws pressed buttons and greyed icons through small
	 * fragment shaders in res/shader. These are compiled with cc.GLProgram
	 * and applied to nodes at runtime.
	 * ------------------------------------------------------------------ */

	/* The fork put these on the node base, not on one widget: a sprite gets
	 * an effect, a button gets a pressed shader, and anything touchable gets
	 * a cancel range. Every node answers them here for the same reason. */
	/* ---------------------------------------------------------------- *
	 * 3D rotation, drawn in 2D
	 *
	 * A node keeps the scale the game asked for and the tilt is applied on
	 * top, so the two never fight: setScale from an action still wins, and
	 * the tilt survives it.
	 * ---------------------------------------------------------------- */
	/* cocos2d-html5 3.12 exposes getScale() but not the cocos2d-x
	 * getScaleX/getScaleY pair used by lcUtils. Keep the accessors on the
	 * shared node prototype so Layout, Sprite and every ccui widget agree. */
	if (!cc.Node.prototype.getScaleX) {
		cc.Node.prototype.getScaleX = function () {
			if (this.__wantScaleX != null) return this.__wantScaleX;
			return this._scaleX == null ? (this.getScale ? this.getScale() : 1) : this._scaleX;
		};
	}
	if (!cc.Node.prototype.getScaleY) {
		cc.Node.prototype.getScaleY = function () {
			if (this.__wantScaleY != null) return this.__wantScaleY;
			return this._scaleY == null ? (this.getScale ? this.getScale() : 1) : this._scaleY;
		};
	}

	function applyTilt(node) {
		var wantX = node.__wantScaleX == null ? node.getScaleX() : node.__wantScaleX;
		var wantY = node.__wantScaleY == null ? node.getScaleY() : node.__wantScaleY;
		node.__wantScaleX = wantX;
		node.__wantScaleY = wantY;
		node.__inTilt = true;
		node.setScaleX(wantX * (node.__tiltX == null ? 1 : node.__tiltX));
		node.setScaleY(wantY * (node.__tiltY == null ? 1 : node.__tiltY));
		node.__inTilt = false;
	}

	function hookTilt(node) {
		if (node.__tiltHooked) return;
		node.__tiltHooked = true;

		var setScaleX = node.setScaleX, setScaleY = node.setScaleY;
		var setScale = node.setScale;

		node.setScaleX = function (v) {
			if (!this.__inTilt) { this.__wantScaleX = v; v *= (this.__tiltX == null ? 1 : this.__tiltX); }
			return setScaleX.call(this, v);
		};
		node.setScaleY = function (v) {
			if (!this.__inTilt) { this.__wantScaleY = v; v *= (this.__tiltY == null ? 1 : this.__tiltY); }
			return setScaleY.call(this, v);
		};
		node.setScale = function (x, y) {
			if (y === undefined) y = x;
			this.setScaleX(x);
			this.setScaleY(y);
		};
	}

	/* The projection runs ~1000 times a frame on the battle board (uploadData
	 * grid). It read the window size through getWinSize(), which allocates a
	 * copy, and recomputed cos/sin of an angle that almost never changes. Same
	 * numbers, without the garbage: the live size object is only read here,
	 * and the trig is remembered for the last angle. */
	var TRIG = { rad: NaN, cos: 1, sin: 0 };
	function trigOf(rad) {
		if (TRIG.rad !== rad) {
			TRIG.rad = rad;
			TRIG.cos = Math.cos(rad);
			TRIG.sin = Math.sin(rad);
		}
		return TRIG;
	}

	var BATTLE_PERSPECTIVE = {
		projectFlat: function (x, y, root) {
			var winSize = (cc.director._winSizeInPoints || cc.director.getWinSize());
			var camX = winSize.width * 0.5;
			var camY = winSize.height * 0.5;
			var zEye = camY * Math.sqrt(3);
			var anchorX = root ? root.getPositionX() : camX;
			var anchorY = root ? root.getPositionY() : (camY + 112);
			var rotX = root && root.__rotation3D ? root.__rotation3D.x : -20;
			var rad = rotX * Math.PI / 180;
			var cosT = trigOf(rad).cos;
			var sinT = trigOf(rad).sin;
			var offsetY = anchorY - camY;

			var dx = x - anchorX;
			var dy = y - anchorY;
			var distZ = zEye - dy * sinT;
			if (distZ <= 10) distZ = 10;
			var k = zEye / distZ;
			return {
				x: camX + dx * k,
				y: camY + (offsetY + dy * cosT) * k
			};
		},

		unprojectFlat: function (sx, sy, root) {
			var winSize = (cc.director._winSizeInPoints || cc.director.getWinSize());
			var camX = winSize.width * 0.5;
			var camY = winSize.height * 0.5;
			var zEye = camY * Math.sqrt(3);
			var anchorX = root ? root.getPositionX() : camX;
			var anchorY = root ? root.getPositionY() : (camY + 112);
			var rotX = root && root.__rotation3D ? root.__rotation3D.x : -20;
			var rad = rotX * Math.PI / 180;
			var cosT = trigOf(rad).cos;
			var sinT = trigOf(rad).sin;
			var offsetY = anchorY - camY;

			var s_dy = sy - camY;
			var denom = cosT * zEye + s_dy * sinT;
			if (Math.abs(denom) < 0.001) denom = 0.001;
			var dy = (s_dy - offsetY) * zEye / denom;
			var distZ = zEye - dy * sinT;
			if (distZ <= 10) distZ = 10;
			var k = zEye / distZ;
			var dx = (sx - camX) / k;
			return {
				x: anchorX + dx,
				y: anchorY + dy
			};
		},

		projectUpright: function (vx, vy, cx, cy, root) {
			var winSize = (cc.director._winSizeInPoints || cc.director.getWinSize());
			var camX = winSize.width * 0.5;
			var camY = winSize.height * 0.5;
			var zEye = camY * Math.sqrt(3);
			var anchorX = root ? root.getPositionX() : camX;
			var anchorY = root ? root.getPositionY() : (camY + 112);
			var rotX = root && root.__rotation3D ? root.__rotation3D.x : -20;
			var rad = rotX * Math.PI / 180;
			var cosT = trigOf(rad).cos;
			var sinT = trigOf(rad).sin;
			var offsetY = anchorY - camY;

			var dy_center = cy - anchorY;
			var distZ = zEye - dy_center * sinT;
			if (distZ <= 10) distZ = 10;
			var k = zEye / distZ;
			var proj_cx = camX + (cx - anchorX) * k;
			var proj_cy = camY + (offsetY + dy_center * cosT) * k;
			return {
				x: proj_cx + (vx - cx) * k,
				y: proj_cy + (vy - cy) * k
			};
		}
	};

	window.BATTLE_PERSPECTIVE = BATTLE_PERSPECTIVE;

	function markInBattleUi(node, root) {
		if (!node) return;
		node.__inBattleUi = true;
		node.__battleUiRoot = root;
		var children = node.getChildren ? node.getChildren() : node._children;
		if (children) {
			for (var i = 0; i < children.length; i++) {
				markInBattleUi(children[i], root);
			}
		}
	}

	function getUprightCenter(uprightRoot) {
		var ucmd = uprightRoot && uprightRoot._renderCmd;
		if (ucmd && ucmd._worldTransform) {
			var uwt = ucmd._worldTransform;
			if (uprightRoot._contentSize && uprightRoot._contentSize.width > 0) {
				var hw = uprightRoot._contentSize.width * 0.5;
				var hh = uprightRoot._contentSize.height * 0.5;
				return {
					x: hw * uwt.a + hh * uwt.c + uwt.tx,
					y: hw * uwt.b + hh * uwt.d + uwt.ty
				};
			}
			return { x: uwt.tx, y: uwt.ty };
		}
		if (uprightRoot && uprightRoot.convertToWorldSpace) {
			if (uprightRoot._contentSize && uprightRoot._contentSize.width > 0) {
				return uprightRoot.convertToWorldSpace(cc.p(
					uprightRoot._contentSize.width * 0.5,
					uprightRoot._contentSize.height * 0.5
				));
			}
			return uprightRoot.convertToWorldSpace(cc.p(0, 0));
		}
		return { x: 0, y: 0 };
	}

	function getUprightRoot(node) {
		var cur = node;
		var upright = null;
		while (cur && !cur.__isBattleUi) {
			if ((cur._card !== undefined && cur._ownerUi !== undefined) || cur.__isCard) {
				upright = cur;
				break;
			}
			if (cur.__rotation3D !== undefined && cur.__rotation3D !== null) {
				if (cur.__rotation3D.x > 5) {
					upright = cur;
					break;
				}
			}
			cur = cur._parent;
		}
		return upright;
	}

	/* Which board a node is drawn into is a fact about where it IS, not about
	 * where it once was. markInBattleUi stamps the whole subtree at the moment
	 * a node claims the projection root and nothing ever unstamps it, so any
	 * node built inside the board and later handed somewhere else -- a pooled
	 * icon reused in a dialog, a card frame reparented into an EffectForm, the
	 * shared ClientData._camera3D moving between scenes -- keeps rendering
	 * through the board anchor it was born under. Node positions never
	 * changed, and a ccui widget hit-tests through plain convertToNodeSpace,
	 * so the art drifts off while the touch box stays where the node is.
	 *
	 * Resolve it from the live chain instead, and keep the stamp only as the
	 * cache it was always meant to be. Nodes that are still under the root
	 * answer exactly what they answered before; only the ones that moved get
	 * corrected. */
	function battleUiRootOf(node) {
		if (node.__isBattleUi) return node;
		var p = node._parent;
		while (p) {
			if (p.__isBattleUi) {
				node.__inBattleUi = true;
				node.__battleUiRoot = p;
				return p;
			}
			p = p._parent;
		}
		if (node.__inBattleUi) {
			node.__inBattleUi = false;
			node.__battleUiRoot = null;
		}
		return null;
	}

	var baseAddChild = cc.Node.prototype.addChild;
	cc.Node.prototype.addChild = function (child, localZOrder, tag) {
		var ret = baseAddChild.apply(this, arguments);
		if (child && (this.__isBattleUi || this.__inBattleUi)) {
			markInBattleUi(child, this.__battleUiRoot || this);
		}
		return ret;
	};

	if (cc.Sprite && cc.Sprite.WebGLRenderCmd) {
		var baseSpriteTransform = cc.Sprite.WebGLRenderCmd.prototype.transform;
		cc.Sprite.WebGLRenderCmd.prototype.transform = function (parentCmd, recursive) {
			baseSpriteTransform.call(this, parentCmd, recursive);

			var node = this._node;
			if (!node) return;

			var root = battleUiRootOf(node);
			if (!root) return;
			var verts = this._vertices;
			if (!verts || verts.length < 4) return;

			var uprightRoot = getUprightRoot(node);
			if (uprightRoot) {
				var center = getUprightCenter(uprightRoot);
				var cx = center.x, cy = center.y;
				var p0 = BATTLE_PERSPECTIVE.projectUpright(verts[0].x, verts[0].y, cx, cy, root);
				var p1 = BATTLE_PERSPECTIVE.projectUpright(verts[1].x, verts[1].y, cx, cy, root);
				var p2 = BATTLE_PERSPECTIVE.projectUpright(verts[2].x, verts[2].y, cx, cy, root);
				var p3 = BATTLE_PERSPECTIVE.projectUpright(verts[3].x, verts[3].y, cx, cy, root);
				verts[0].x = p0.x; verts[0].y = p0.y;
				verts[1].x = p1.x; verts[1].y = p1.y;
				verts[2].x = p2.x; verts[2].y = p2.y;
				verts[3].x = p3.x; verts[3].y = p3.y;
			} else {
				var p0 = BATTLE_PERSPECTIVE.projectFlat(verts[0].x, verts[0].y, root);
				var p1 = BATTLE_PERSPECTIVE.projectFlat(verts[1].x, verts[1].y, root);
				var p2 = BATTLE_PERSPECTIVE.projectFlat(verts[2].x, verts[2].y, root);
				var p3 = BATTLE_PERSPECTIVE.projectFlat(verts[3].x, verts[3].y, root);
				verts[0].x = p0.x; verts[0].y = p0.y;
				verts[1].x = p1.x; verts[1].y = p1.y;
				verts[2].x = p2.x; verts[2].y = p2.y;
				verts[3].x = p3.x; verts[3].y = p3.y;
			}
		};

		var baseSpriteUploadData = cc.Sprite.WebGLRenderCmd.prototype.uploadData;
		cc.Sprite.WebGLRenderCmd.prototype.uploadData = function (f32buffer, ui32buffer, vertexDataOffset) {
			var node = this._node;
			if (node && (node.__isBattleUi || node.__inBattleUi) && node._rect && node._rect.width > 1200 && node._rect.height > 600) {
				var locTexture = node._texture;
				if (!(locTexture && locTexture._textureLoaded && node._rect.width && node._rect.height) || !this._displayedOpacity)
					return false;

				var opacity = this._displayedOpacity;
				var r = this._displayedColor.r, g = this._displayedColor.g, b = this._displayedColor.b;
				if (node._opacityModifyRGB) {
					var a = opacity / 255;
					r *= a; g *= a; b *= a;
				}
				this._color[0] = ((opacity << 24) | (b << 16) | (g << 8) | r);
				var color = this._color[0];
				var z = node._vertexZ;

				var root = node.__battleUiRoot || (node.__isBattleUi ? node : null);
				var wt = this._worldTransform;
				var lx = node._offsetPosition.x, rx = lx + node._rect.width;
				var by = node._offsetPosition.y, ty = by + node._rect.height;

				var uvs = this._vertices;
				var u_left = uvs[1].u, u_right = uvs[3].u;
				var v_bot = uvs[1].v, v_top = uvs[0].v;

				var NX = 16, NY = 16;
				var offset = vertexDataOffset;

				for (var iy = 0; iy < NY; iy++) {
					var y0 = by + (iy / NY) * (ty - by);
					var y1 = by + ((iy + 1) / NY) * (ty - by);
					var cv0 = v_bot + (iy / NY) * (v_top - v_bot);
					var cv1 = v_bot + ((iy + 1) / NY) * (v_top - v_bot);

					for (var ix = 0; ix < NX; ix++) {
						var x0 = lx + (ix / NX) * (rx - lx);
						var x1 = lx + ((ix + 1) / NX) * (rx - lx);
						var cu0 = u_left + (ix / NX) * (u_right - u_left);
						var cu1 = u_left + ((ix + 1) / NX) * (u_right - u_left);

						var p0 = BATTLE_PERSPECTIVE.projectFlat(x0 * wt.a + y1 * wt.c + wt.tx, x0 * wt.b + y1 * wt.d + wt.ty, root);
						var p1 = BATTLE_PERSPECTIVE.projectFlat(x0 * wt.a + y0 * wt.c + wt.tx, x0 * wt.b + y0 * wt.d + wt.ty, root);
						var p2 = BATTLE_PERSPECTIVE.projectFlat(x1 * wt.a + y1 * wt.c + wt.tx, x1 * wt.b + y1 * wt.d + wt.ty, root);
						var p3 = BATTLE_PERSPECTIVE.projectFlat(x1 * wt.a + y0 * wt.c + wt.tx, x1 * wt.b + y0 * wt.d + wt.ty, root);

						f32buffer[offset] = p0.x; f32buffer[offset + 1] = p0.y; f32buffer[offset + 2] = z;
						ui32buffer[offset + 3] = color;
						f32buffer[offset + 4] = cu0; f32buffer[offset + 5] = cv1;
						offset += 6;

						f32buffer[offset] = p1.x; f32buffer[offset + 1] = p1.y; f32buffer[offset + 2] = z;
						ui32buffer[offset + 3] = color;
						f32buffer[offset + 4] = cu0; f32buffer[offset + 5] = cv0;
						offset += 6;

						f32buffer[offset] = p2.x; f32buffer[offset + 1] = p2.y; f32buffer[offset + 2] = z;
						ui32buffer[offset + 3] = color;
						f32buffer[offset + 4] = cu1; f32buffer[offset + 5] = cv1;
						offset += 6;

						f32buffer[offset] = p3.x; f32buffer[offset + 1] = p3.y; f32buffer[offset + 2] = z;
						ui32buffer[offset + 3] = color;
						f32buffer[offset + 4] = cu1; f32buffer[offset + 5] = cv0;
						offset += 6;
					}
				}

				return NX * NY * 4;
			}
			return baseSpriteUploadData.apply(this, arguments);
		};
	}

	/* A particle emitter draws the quads it has already laid out through its
	 * own world matrix, and that matrix is the one thing the sprite path
	 * above cannot reach: the particle render command descends from the node
	 * command, not from the sprite's, so transform() never runs for it. A
	 * buff or shield emitter attached to a card therefore kept the flat
	 * matrix and was drawn where the board is laid out rather than where the
	 * board is drawn -- for the far rows, most of a card away from the
	 * monster wearing it.
	 *
	 * Its quads are in the emitter's own space, so project the matrix about
	 * the emitter itself: two probes give the local scale, and about the same
	 * centre the sprites beside it use, so the two agree. */
	if (cc.ParticleSystem && cc.ParticleSystem.WebGLRenderCmd) {
		var baseParticleRendering = cc.ParticleSystem.WebGLRenderCmd.prototype.rendering;
		cc.ParticleSystem.WebGLRenderCmd.prototype.rendering = function (ctx) {
			var node = this._node;
			if (!node) return baseParticleRendering.call(this, ctx);
			/* an emitter built before its card joined the board missed the
			 * mark, the same way a sprite can (see the sprite path above) --
			 * and one carried out of the board keeps a mark it no longer
			 * earns, so ask the live chain rather than the stamp */
			var root = battleUiRootOf(node);
			if (!root) return baseParticleRendering.call(this, ctx);

			var uprightRoot = getUprightRoot(node);
			var center = uprightRoot ? getUprightCenter(uprightRoot) : null;
			var project = center
				? function (x, y) {
					return BATTLE_PERSPECTIVE.projectUpright(x, y, center.x, center.y, root);
				}
				: function (x, y) { return BATTLE_PERSPECTIVE.projectFlat(x, y, root); };

			var wt = this._worldTransform;
			var o = project(wt.tx, wt.ty);
			var ex = project(wt.tx + wt.a, wt.ty + wt.b);
			var ey = project(wt.tx + wt.c, wt.ty + wt.d);
			this._worldTransform = {
				a: ex.x - o.x, b: ex.y - o.y,
				c: ey.x - o.x, d: ey.y - o.y,
				tx: o.x, ty: o.y,
			};

			var ret = baseParticleRendering.call(this, ctx);
			this._worldTransform = wt;
			return ret;
		};
	}

	/* ------------------------------------------------------------------ *
	 * clipping a layout the game turns
	 *
	 * The battle's drag line is a clipping Layout that the game rotates to
	 * point at the finger (BattleLine.directTo). html5 clips with a scissor
	 * box built from the node's own width times t.a, so turning the line
	 * towards the left or the right narrows that box by cos(angle) -- at
	 * ninety degrees, which is a drag straight to either side, nothing of
	 * the arrow is left on screen. The device clips with a stencil over the
	 * layout's quad, which does not shrink with the turn.
	 *
	 * Take the bounds of the four corners instead. Inside the battle the
	 * vertices are drawn reprojected (see the sprite transform above), so
	 * the corners go through the same projection, or the box would sit
	 * where the layout is laid out rather than where it is drawn. The
	 * parent's clip still applies.
	 * ------------------------------------------------------------------ */
	var baseClippingRect = ccui.Layout.prototype._getClippingRect;
	ccui.Layout.prototype._getClippingRect = function () {
		if (!this._clippingRectDirty) return baseClippingRect.call(this);

		/* the base call resolves _clippingParent and hands back its cached
		 * rect object, which is the one rewritten below */
		var rect = baseClippingRect.call(this);
		var t = this.getNodeToWorldTransform();
		var w = this._contentSize.width, h = this._contentSize.height;
		var root = battleUiRootOf(this);
		var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

		for (var i = 0; i < 4; i++) {
			var lx = (i === 1 || i === 2) ? w : 0;
			var ly = i >= 2 ? h : 0;
			var x = lx * t.a + ly * t.c + t.tx;
			var y = lx * t.b + ly * t.d + t.ty;
			if (root) {
				var p = BATTLE_PERSPECTIVE.projectFlat(x, y, root);
				x = p.x;
				y = p.y;
			}
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
		}

		if (this._clippingParent) {
			var parentRect = this._clippingParent._getClippingRect();
			minX = Math.max(minX, parentRect.x);
			minY = Math.max(minY, parentRect.y);
			maxX = Math.min(maxX, parentRect.x + parentRect.width);
			maxY = Math.min(maxY, parentRect.y + parentRect.height);
		}

		rect.x = minX;
		rect.y = minY;
		rect.width = Math.max(0, maxX - minX);
		rect.height = Math.max(0, maxY - minY);
		return rect;
	};

	var SHADER_METHODS = {
		/* setEffect(nil) is how the fork takes an effect back off a node,
		 * and every card thumbnail comes out of a pool that was last used
		 * by a greyed or tinted one. Without the restore the tint sticks:
		 * the burst behind a card's art stayed dark for the rest of the
		 * session. */
		setEffect: function (effect) {
			this.__shaderEffect = effect;
			if (effect && effect.path) applyShaderToNode(this, effect.path);
			else restoreDefaultShader(this);
		},
		setShaderEffect: function (effect) {
			this.__shaderEffect = effect;
			if (effect && effect.path) applyShaderToNode(this, effect.path);
			else restoreDefaultShader(this);
		},
		setPressedShader: function (effect) {
			this.__pressedShader = effect;
			syncStateShader(this);
		},
		setNormalShader: function () {
			this.__pressedShader = null;
			syncStateShader(this);
		},
		setDisabledShader: function (effect) {
			this.__disabledShader = effect;
			syncStateShader(this);
		},
		setTouchEndCancelRange: function () {},
		/* the fork narrows a widget's hit area; html5 always uses the
		 * whole content box, which is the same for every call the game
		 * makes here */
		setTouchRect: function () {},
		setGray: function (on) {
			if (on) {
				this.__wasGray = true;
				applyShaderToNode(this, 'res/shader/gray.fsh');
			} else {
				this.__wasGray = false;
				restoreDefaultShader(this);
			}
		},

		/* The 3D side of the fork: the battle board tilts back 20 degrees
		 * about X, the city tilts its tiles, and a card flips by turning
		 * 180 degrees about Y.
		 *
		 * BattleUi uses true 3D perspective projection onto the WebGL vertices
		 * (see BATTLE_PERSPECTIVE below) rather than a simple 2D Y scale, so
		 * the battlefield displays as an authentic perspective trapezoid and
		 * cards/slots align with the perspective camera. */
		setRotation3D: function (rotation) {
			this.__rotation3D = rotation || { x: 0, y: 0, z: 0 };
			this.setRotation(this.__rotation3D.z || 0);

			/* Only a battle board ROOT may claim the projection-root role.
			 * Game nodes inside the board -- CardSprite's _pCardArea and
			 * _pShadowArea above all -- legitimately tilt past -15 degrees
			 * while a card is dragged (CardSprite.handCardMove nudges the
			 * tilt by 3 degrees per move toward -dy*2.5-10). Letting them
			 * re-root marked their whole subtree with themselves as anchor
			 * and never unmarked it, so mid-drag the card art jumped far to
			 * the right and stayed broken in hand, on board and in the grave
			 * for the rest of the session. A node already inside the board
			 * keeps the plain tilt treatment instead. */
			if (this.__rotation3D.x <= -15 && !this.__inBattleUi) {
				this.__isBattleUi = true;
				this.__battleUiRoot = this;
				markInBattleUi(this, this);
				this.__tiltX = 1;
				this.__tiltY = 1;
				if (this.__wantScaleX != null) this.setScaleX(this.__wantScaleX);
				if (this.__wantScaleY != null) this.setScaleY(this.__wantScaleY);
				return;
			}
			/* And the claim has to come back off. A node that is handed -20
			 * while it is not inside a board claims the role for itself, and
			 * the same node gets +20 again when the board is not mirrored --
			 * the reverse-side card area and the shadow under it do exactly
			 * this (PlayerUi.lua:1034, CardSprite.lua:2454), and a card's tilt
			 * action sweeps through it. Nothing ever unmarked the claim, so
			 * from the first mirror onward that node stayed a projection root:
			 * its whole subtree drew through its own anchor while the touch
			 * boxes stayed where the nodes are, which is the art drifted off
			 * with taps still landing in the old place. */
			if (this.__isBattleUi && this.__battleUiRoot === this &&
				this.__rotation3D.x > -15) {
				this.__isBattleUi = false;
				this.__battleUiRoot = null;
				this.__inBattleUi = false;
			}
			if (this.__inBattleUi) {
				this.__tiltX = 1;
				this.__tiltY = 1;
				return;
			}

			var rad = Math.PI / 180;
			this.__tiltY = Math.cos((this.__rotation3D.x || 0) * rad);
			this.__tiltX = Math.cos((this.__rotation3D.y || 0) * rad);
			hookTilt(this);
			applyTilt(this);
		},
		getRotation3D: function () {
			return this.__rotation3D || { x: 0, y: 0, z: this.getRotation() };
		},
		setPosition3D: function (p) {
			if (p) this.setPosition(p.x, p.y);
		},
		getPosition3D: function () {
			return { x: this.getPositionX(), y: this.getPositionY(), z: 0 };
		},
		setPositionZ: function () {},
		getPositionZ: function () { return 0; },
		setCameraMask: function (mask) { this.__cameraMask = mask; },
		getCameraMask: function () { return this.__cameraMask || 1; },
		convertToNodeSpace3D: function (point) {
			var root = battleUiRootOf(this);
			if (root) {
				var uprightRoot = getUprightRoot(this);
				if (uprightRoot) {
					var center = getUprightCenter(uprightRoot);
					var winSize = cc.director.getWinSize();
					var camX = winSize.width * 0.5, camY = winSize.height * 0.5;
					var zEye = camY * Math.sqrt(3);
					var anchorX = root ? root.getPositionX() : camX;
					var anchorY = root ? root.getPositionY() : (camY + 112);
					var rotX = root && root.__rotation3D ? root.__rotation3D.x : -20;
					var rad = rotX * Math.PI / 180;
					var cosT = Math.cos(rad), sinT = Math.sin(rad);
					var offsetY = anchorY - camY;
					var dy_center = center.y - anchorY;
					var distZ = zEye - dy_center * sinT;
					if (distZ <= 10) distZ = 10;
					var k = zEye / distZ;
					var proj_cx = camX + (center.x - anchorX) * k;
					var proj_cy = camY + (offsetY + dy_center * cosT) * k;
					var unproj_x = center.x + (point.x - proj_cx) / k;
					var unproj_y = center.y + (point.y - proj_cy) / k;
					return this.convertToNodeSpace(cc.p(unproj_x, unproj_y));
				}
				var unproj = BATTLE_PERSPECTIVE.unprojectFlat(point.x, point.y, root);
				return this.convertToNodeSpace(unproj);
			}
			return this.convertToNodeSpace(point);
		},
		convertToWorldSpace3D: function (point) {
			var world = this.convertToWorldSpace(point);
			var root = battleUiRootOf(this);
			if (root) {
				var uprightRoot = getUprightRoot(this);
				if (uprightRoot) {
					var center = getUprightCenter(uprightRoot);
					return BATTLE_PERSPECTIVE.projectUpright(world.x, world.y, center.x, center.y, root);
				}
				return BATTLE_PERSPECTIVE.projectFlat(world.x, world.y, root);
			}
			return world;
		},
		/* Drag helper for the Lua card patch: place this node so its own
		 * projected screen centre lands on (screenX, screenY).
		 *
		 * A node's upright and flat screen centres coincide, so inverting the
		 * flat map at the target is the exact move. Doing it instead by
		 * re-reading this.convertToNodeSpace3D uses the node's stale centre
		 * and k, so each move accumulates the previous error and a long drag
		 * drifts right (k > 1 below the horizon, k < 1 above it). */
		setPositionFromScreen3D: function (screenX, screenY) {
			var root = this.__battleUiRoot || (this.__isBattleUi ? this : null);
			var parent = this._parent;
			if (!parent) return;
			var world = BATTLE_PERSPECTIVE.unprojectFlat(screenX, screenY, root);
			if (parent.convertToNodeSpace) world = parent.convertToNodeSpace(world);
			this.setPosition(world.x, world.y);
		},
	};

	[cc.Node.prototype,
	 ccui.Widget && ccui.Widget.prototype,
	 ccui.Layout && ccui.Layout.prototype,
	 cc.Sprite && cc.Sprite.prototype].forEach(function (proto) {
		if (!proto) return;
		Object.keys(SHADER_METHODS).forEach(function (name) {
			if (!proto[name]) proto[name] = SHADER_METHODS[name];
		});
	});

	/* setEnabled and the press-state handlers already exist on the engine, so
	 * the loop above leaves them alone; they are what tells syncStateShader
	 * which look the widget is in. */
	if (ccui.Widget) {
		var baseSetEnabled = ccui.Widget.prototype.setEnabled;
		ccui.Widget.prototype.setEnabled = function (enabled) {
			if (baseSetEnabled) baseSetEnabled.call(this, enabled);
			syncStateShader(this);
		};
	}
	if (ccui.Button) {
		['_onPressStateChangedToNormal',
		 '_onPressStateChangedToPressed',
		 '_onPressStateChangedToDisabled'].forEach(function (name) {
			var base = ccui.Button.prototype[name];
			if (!base) return;
			ccui.Button.prototype[name] = function () {
				base.apply(this, arguments);
				syncStateShader(this);
			};
		});
	}

	/* The game hands the particle system the native cocos2d-x contract, a
	 * Color4F of 0..1 floats (cc.c4f builds them). cc.Color here is a
	 * Uint8Array, so every component truncated to 0: particles drew black,
	 * and they all blend additively, so nothing showed at all -- the flame on
	 * a usable initiative button, the card rebirth effect, all invisible.
	 * Scale where the units actually change. Not at cc.c4f: the game also
	 * builds colour tables at load time, before any Lua patch has run. */
	if (cc.ParticleSystem) {
		['setStartColor', 'setStartColorVar', 'setEndColor', 'setEndColorVar'].forEach(function (name) {
			var base = cc.ParticleSystem.prototype[name];
			if (!base) return;
			cc.ParticleSystem.prototype[name] = function (c) {
				if (!c) return base.call(this, c);
				return base.call(this, {
					r: (c.r || 0) * 255, g: (c.g || 0) * 255,
					b: (c.b || 0) * 255, a: (c.a || 0) * 255,
				});
			};
		});
	}

	cc.ShaderSprite = cc.Sprite.extend({});
	cc.ShaderSprite.create = function (a, b, c) {
		return new cc.ShaderSprite(a, b, c);
	};

	if (cc.RotateTo) {
		var baseRotateToInit = cc.RotateTo.prototype.initWithDuration;
		cc.RotateTo.prototype.initWithDuration = function (duration, deltaAngleX, deltaAngleY) {
			if (typeof deltaAngleX === 'object' && deltaAngleX !== null) {
				this._is3D = true;
				this._dstRotation3D = {
					x: deltaAngleX.x || 0,
					y: deltaAngleX.y || 0,
					z: deltaAngleX.z !== undefined ? deltaAngleX.z : (deltaAngleX.rotation || 0)
				};
				return cc.ActionInterval.prototype.initWithDuration.call(this, duration);
			}
			this._is3D = false;
			return baseRotateToInit.apply(this, arguments);
		};

		var baseRotateToStart = cc.RotateTo.prototype.startWithTarget;
		cc.RotateTo.prototype.startWithTarget = function (target) {
			if (this._is3D) {
				cc.ActionInterval.prototype.startWithTarget.call(this, target);
				var start = target.getRotation3D ? target.getRotation3D() : { x: 0, y: 0, z: target.getRotation() };
				this._startRotation3D = { x: start.x || 0, y: start.y || 0, z: start.z || 0 };
				this._diffRotation3D = {
					x: this._dstRotation3D.x - this._startRotation3D.x,
					y: this._dstRotation3D.y - this._startRotation3D.y,
					z: this._dstRotation3D.z - this._startRotation3D.z
				};
				return;
			}
			baseRotateToStart.apply(this, arguments);
		};

		var baseRotateToUpdate = cc.RotateTo.prototype.update;
		cc.RotateTo.prototype.update = function (dt) {
			if (this._is3D && this.target) {
				dt = this._computeEaseTime(dt);
				var rx = this._startRotation3D.x + this._diffRotation3D.x * dt;
				var ry = this._startRotation3D.y + this._diffRotation3D.y * dt;
				var rz = this._startRotation3D.z + this._diffRotation3D.z * dt;
				if (this.target.setRotation3D) {
					this.target.setRotation3D({ x: rx, y: ry, z: rz });
				} else {
					this.target.setRotation(rz);
				}
				return;
			}
			baseRotateToUpdate.apply(this, arguments);
		};
	}

	if (cc.RotateBy) {
		var baseRotateByInit = cc.RotateBy.prototype.initWithDuration;
		cc.RotateBy.prototype.initWithDuration = function (duration, deltaAngleX, deltaAngleY) {
			if (typeof deltaAngleX === 'object' && deltaAngleX !== null) {
				this._is3D = true;
				this._deltaRotation3D = {
					x: deltaAngleX.x || 0,
					y: deltaAngleX.y || 0,
					z: deltaAngleX.z !== undefined ? deltaAngleX.z : (deltaAngleX.rotation || 0)
				};
				return cc.ActionInterval.prototype.initWithDuration.call(this, duration);
			}
			this._is3D = false;
			return baseRotateByInit.apply(this, arguments);
		};

		var baseRotateByStart = cc.RotateBy.prototype.startWithTarget;
		cc.RotateBy.prototype.startWithTarget = function (target) {
			if (this._is3D) {
				cc.ActionInterval.prototype.startWithTarget.call(this, target);
				var start = target.getRotation3D ? target.getRotation3D() : { x: 0, y: 0, z: target.getRotation() };
				this._startRotation3D = { x: start.x || 0, y: start.y || 0, z: start.z || 0 };
				return;
			}
			baseRotateByStart.apply(this, arguments);
		};

		var baseRotateByUpdate = cc.RotateBy.prototype.update;
		cc.RotateBy.prototype.update = function (dt) {
			if (this._is3D && this.target) {
				dt = this._computeEaseTime(dt);
				var rx = this._startRotation3D.x + this._deltaRotation3D.x * dt;
				var ry = this._startRotation3D.y + this._deltaRotation3D.y * dt;
				var rz = this._startRotation3D.z + this._deltaRotation3D.z * dt;
				if (this.target.setRotation3D) {
					this.target.setRotation3D({ x: rx, y: ry, z: rz });
				} else {
					this.target.setRotation(rz);
				}
				return;
			}
			baseRotateByUpdate.apply(this, arguments);
		};
	}

	/* ------------------------------------------------------------------ *
	 * Real GLSL Shader Support
	 *
	 * The fork uses fragment shaders from res/shader/*.fsh for button press,
	 * gray, highlight, and color effects. We compile them with cc.GLProgram
	 * and apply them to nodes just like the native fork does.
	 * ------------------------------------------------------------------ */

	var shaderCache = {};
	var SHADER_VERT =
		'attribute vec4 a_position;\n' +
		'attribute vec2 a_texCoord;\n' +
		'attribute vec4 a_color;\n' +
		'varying vec4 v_fragmentColor;\n' +
		'varying vec2 v_texCoord;\n' +
		'void main() {\n' +
		'    gl_Position = CC_PMatrix * a_position;\n' +
		'    v_fragmentColor = a_color;\n' +
		'    v_texCoord = a_texCoord;\n' +
		'}\n';

	function loadShader(path) {
		if (shaderCache[path]) return Promise.resolve(shaderCache[path]);

		var url = (config.resBase || '/res/') + path.replace(/^res\//, '');
		return fetch(url).then(function (r) {
			if (!r.ok) throw new Error(r.status);
			return r.text();
		}).then(function (fragSrc) {
			var program = new cc.GLProgram();
			program.initWithString(SHADER_VERT, fragSrc);
			program.addAttribute(cc.ATTRIBUTE_NAME_POSITION, cc.VERTEX_ATTRIB_POSITION);
			program.addAttribute(cc.ATTRIBUTE_NAME_COLOR, cc.VERTEX_ATTRIB_COLOR);
			program.addAttribute(cc.ATTRIBUTE_NAME_TEX_COORD, cc.VERTEX_ATTRIB_TEX_COORDS);
			program.link();
			program.updateUniforms();
			shaderCache[path] = program;
			return program;
		}).catch(function (e) {
			cc.log('[shader] failed to load ' + path + ': ' + e);
			return null;
		});
	}

	/* A ccui widget does not paint itself -- it paints through a protected
	 * renderer child (UIButton's _buttonNormalRenderer, an ImageView's
	 * _imageRenderer), which getVirtualRenderer() hands back. Setting the
	 * program on the widget alone reached nothing, so every greyed button,
	 * dialog choice and card frame in the game stayed fully coloured while
	 * the same call on a plain cc.Sprite worked. */
	function shaderTarget(node) {
		if (node.getVirtualRenderer) {
			var r = node.getVirtualRenderer();
			if (r) return r;
		}
		return node;
	}

	function applyShaderToNode(node, path) {
		if (!node || !path) return;
		loadShader(path).then(function (program) {
			var t = shaderTarget(node);
			if (program && t.setShaderProgram) {
				t.setShaderProgram(program);
			}
		});
	}

	function restoreDefaultShader(node) {
		if (!node) return;
		var t = shaderTarget(node);
		if (!t.setShaderProgram) return;
		var defaultProg = cc.shaderCache.programForKey(cc.SHADER_SPRITE_POSITION_TEXTURECOLOR);
		if (defaultProg) t.setShaderProgram(defaultProg);
	}

	/* The fork takes a widget's pressed and disabled looks from shaders and
	 * applies whichever one the widget is in, so setDisabledShader on a
	 * freshly built button changes nothing until the button is disabled.
	 * This port used to apply at set time and never look again: a button
	 * wore whichever shader it was handed first, the pressed one if it had
	 * no disabled shader, and setEnabled could not bring it back. */
	function syncStateShader(widget) {
		if (!widget.setShaderProgram) return;
		var effect = widget.isEnabled && widget.isEnabled() === false
			? widget.__disabledShader
			: (widget._brightStyle === ccui.Widget.BRIGHT_STYLE_HIGH_LIGHT ? widget.__pressedShader : null);
		if (effect && effect.path) applyShaderToNode(widget, effect.path);
		else if (typeof effect === 'string') applyShaderToNode(widget, effect);
		else restoreDefaultShader(widget);
	}

	function ShaderEffect(path) {
		this.path = path;
		this._program = null;
		this._uniforms = {};
	}
	ShaderEffect.prototype.getPath = function () { return this.path; };
	ShaderEffect.prototype.setUniform = function (name, value) {
		this._uniforms[name] = value;
	};
	ShaderEffect.prototype.setFloat = function (name, value) {
		this._uniforms[name] = value;
	};
	ShaderEffect.prototype.getProgram = function () {
		if (this._program) return this._program;
		var self = this;
		loadShader(this.path).then(function (prog) {
			self._program = prog;
		});
		return null;
	};

	cc.ShaderEffect = ShaderEffect;
	cc.ShaderEffect.create = function (path) { return new ShaderEffect(path); };
	cc.ShaderEffect.new = cc.ShaderEffect.create;

	/* Preload all shaders at boot time */
	global.jdzcPreloadShaders = function () {
		var shaderFiles = [
			'res/shader/gray.fsh', 'res/shader/gray_light.fsh',
			'res/shader/highlight.fsh',
			'res/shader/colorRed.fsh', 'res/shader/colorGreen.fsh',
			'res/shader/colorBlue.fsh', 'res/shader/colorYellow.fsh',
			'res/shader/colorOrange.fsh', 'res/shader/colorPurple.fsh',
			'res/shader/colorDarkBlue.fsh', 'res/shader/colorDarkPurple.fsh',
			'res/shader/colorLightBlue.fsh', 'res/shader/colorLightWhite.fsh',
			'res/shader/colorBlack.fsh', 'res/shader/colorMagic.fsh',
			'res/shader/colorG2B.fsh', 'res/shader/colorG2Y.fsh',
			'res/shader/colorStageBronze.fsh', 'res/shader/colorStageSilver.fsh',
			'res/shader/bloom.fsh',
			'res/shader/blur_gaussian_x.fsh', 'res/shader/blur_gaussian_y.fsh'
		];
		return Promise.all(shaderFiles.map(loadShader));
	};

	ccui.ShaderButton = ccui.Button.extend({});
	/* the fork's signature is create(image, texType) -- one image, and the
	 * pressed and disabled looks come from shaders rather than from extra
	 * artwork */
	ccui.ShaderButton.create = function (image, texType) {
		var button = new ccui.ShaderButton();
		if (image)
			button.loadTextureNormal(image,
				texType === undefined ? ccui.Widget.LOCAL_TEXTURE : texType);
		return button;
	};

	/* ------------------------------------------------------------------ *
	 * cc.DragonBonesNode -- the fork's skeletal animations
	 *
	 * Each effect is a container, res/effects/<name>.lcres, holding
	 * <name>.png (the atlas), <name>_tex.bin (where each image sits in it)
	 * and <name>_ske.bin (the armature and its animations). Both .bin files
	 * are the fork's own binary form, not DragonBones' published one, and
	 * both are read here. Every string is length-prefixed, and the length
	 * counts the NUL that ends it.
	 *
	 *   _tex.bin  str name, str image, u32 count, then per region
	 *             str name, u16 x, u16 y, u16 w, u16 h.
	 *
	 *   _ske.bin  str name, u32 fps, u32 version, str armature,
	 *             u32 boneCount + per bone: str name, u32, u32,
	 *               6 f32 (x, y, skewX, skewY, scaleX, scaleY)
	 *             u32, u16,
	 *             u32 slotCount + per slot: str name, str bone, f32 z,
	 *               str skin, u32 displayCount + per display: str name,
	 *               str type, 8 f32 (transform, then width and height)
	 *             u32 animCount + per animation: str name, u32, u32,
	 *               f32 duration, f32 scale, i32 playTimes, u32,
	 *               u32 timelineCount + per timeline: str bone, f32 scale,
	 *                 f32 offset, u32 frameCount + per frame:
	 *                 f32 duration, f32 tweenEasing, f32 displayIndex,
	 *                 2 f32, then 8 flag bytes whose last one says whether
	 *                 a transform (6 f32) and two more floats follow, then
	 *                 u8, and if it is set an 8 f32 colour transform.
	 *
	 * Durations are in frames at the armature's own fps. A frame with no
	 * transform holds the previous one; otherwise the transform is tweened
	 * into the next frame's. Bones here are flat -- no parents -- so a slot
	 * is one node at its bone's transform with the display's sprite inside
	 * it, and the whole tree is built once and then only moved.
	 * ------------------------------------------------------------------ */

	function BinReader(buf) {
		this.view = new DataView(buf);
		this.u8 = new Uint8Array(buf);
		this.off = 0;
		this.dec = new TextDecoder('utf-8');
	}
	BinReader.prototype.str = function () {
		var n = this.u8[this.off++];
		var end = this.off + n, stop = this.off;
		while (stop < end && this.u8[stop] !== 0) stop++;
		var s = this.dec.decode(this.u8.subarray(this.off, stop));
		this.off = end;
		return s;
	};
	BinReader.prototype.u16 = function () {
		var v = this.view.getUint16(this.off, true); this.off += 2; return v;
	};
	BinReader.prototype.u32 = function () {
		var v = this.view.getUint32(this.off, true); this.off += 4; return v;
	};
	BinReader.prototype.i32 = function () {
		var v = this.view.getInt32(this.off, true); this.off += 4; return v;
	};
	BinReader.prototype.f32 = function () {
		var v = this.view.getFloat32(this.off, true); this.off += 4; return v;
	};
	BinReader.prototype.skip = function (n) { this.off += n; };

	function parseTexBin(buf) {
		var r = new BinReader(buf);
		var atlas = { name: r.str(), image: r.str(), regions: {} };
		var count = r.u32();
		for (var i = 0; i < count; i++) {
			var name = r.str();
			atlas.regions[name] = {
				x: r.u16(), y: r.u16(), w: r.u16(), h: r.u16(),
			};
		}
		return atlas;
	}

	function parseSkeBin(buf) {
		var r = new BinReader(buf);
		var ske = { name: r.str(), fps: r.u32() || 24, bones: {}, slots: [],
			    anims: {} };
		r.u32();                                   /* version */
		ske.armature = r.str();

		var i, n = r.u32();
		for (i = 0; i < n; i++) {
			var boneName = r.str();
			r.u32(); r.u32();
			ske.bones[boneName] = {
				x: r.f32(), y: r.f32(),
				skewX: r.f32(), skewY: r.f32(),
				scaleX: r.f32(), scaleY: r.f32(),
			};
		}

		r.u32(); r.u16();

		n = r.u32();
		for (i = 0; i < n; i++) {
			var slot = { name: r.str(), bone: r.str(), z: r.f32(),
				     displays: [] };
			r.str();                           /* skin, always "normal" */
			var d = r.u32();
			for (var j = 0; j < d; j++) {
				var display = { name: r.str() };
				r.str();                   /* type, always "image" */
				display.x = r.f32();
				display.y = r.f32();
				display.skewX = r.f32();
				display.skewY = r.f32();
				display.scaleX = r.f32();
				display.scaleY = r.f32();
				display.pivotX = r.f32();
				display.pivotY = r.f32();
				slot.displays.push(display);
			}
			ske.slots.push(slot);
		}

		n = r.u32();
		for (i = 0; i < n; i++) {
			var anim = { name: r.str() };
			r.u32(); r.u32();
			anim.duration = r.f32();           /* in frames */
			r.f32();
			anim.playTimes = r.i32();
			r.u32();
			anim.timelines = [];

			var t = r.u32();
			for (var k = 0; k < t; k++) {
				var timeline = { bone: r.str(), frames: [] };
				r.f32(); r.f32();
				var f = r.u32();
				for (var m = 0; m < f; m++) {
					var frame = { duration: r.f32() };
					frame.displayIndex = r.i32();
					frame.z = r.f32();
					r.f32(); r.f32();
					var hasTransform = r.u8[r.off + 7];
					r.skip(8);
					if (hasTransform) {
						frame.transform = {
							x: r.f32(), y: r.f32(),
							skewX: r.f32(), skewY: r.f32(),
							scaleX: r.f32(), scaleY: r.f32(),
						};
						r.f32(); r.f32();
					}
					if (r.u8[r.off++]) {
						/* Color transform: 4 offsets (r,g,b,a) then 4
						 * multipliers (r,g,b,a).  The native runtime
						 * applies both; previously only alpha was used
						 * here, which made tinted effects (red damage
						 * flash, blue shield glow, etc.) render as plain
						 * opacity changes. */
						r.f32(); r.f32(); r.f32(); r.f32(); /* offsets */
						frame.alpha = r.f32();
						frame.colorR = r.f32();
						frame.colorG = r.f32();
						frame.colorB = r.f32();
					}
					timeline.frames.push(frame);
				}
				anim.timelines.push(timeline);
			}
			ske.anims[anim.name] = anim;
		}
		return ske;
	}

	/* Effect atlases are exported at 2x texture resolution, but the native
	 * bridge uses their logical DragonBones coordinates and atlas regions at
	 * full size. Keep positions and slot art in that same point space. */
	var ARMATURE_SCALE = 1.0;

	/* One parse per effect, however many nodes ask for it. */
	var dbCache = {};

	/* The game creates an effect and asks how long it runs in the same
	 * breath -- `BattleUiView.createDragonBones` schedules the node's own
	 * removal off getAnimationDuration -- so an answer that arrives a
	 * moment later is an effect that never plays. The two .bin files are a
	 * few KB, same-origin and read once per effect, so they are read
	 * synchronously, the way the device read them off disk. The atlas
	 * behind them still downloads in the background.
	 *
	 * Sync XHR cannot ask for an ArrayBuffer, hence the byte-preserving
	 * charset and the copy out of the string. */
	function readBinSync(url) {
		var xhr = new XMLHttpRequest();
		xhr.open('GET', url, false);
		xhr.overrideMimeType('text/plain; charset=x-user-defined');
		xhr.send(null);
		if (xhr.status && xhr.status !== 200)
			throw new Error(xhr.status + ' ' + url);

		var text = xhr.responseText;
		var bytes = new Uint8Array(text.length);
		for (var i = 0; i < text.length; i++)
			bytes[i] = text.charCodeAt(i) & 0xff;
		return bytes.buffer;
	}

	function loadEffectData(dir, armatureName, textureName) {
		var key = dir + armatureName;
		if (dbCache[key] !== undefined) return dbCache[key];

		try {
			dbCache[key] = {
				atlas: parseTexBin(readBinSync(dir + textureName + '_tex.bin')),
				ske: parseSkeBin(readBinSync(dir + armatureName + '_ske.bin')),
				textureKey: textureName + '.png',
				/* <name>.png is the alpha mask for <name>_ori.jpg;
				 * cached under the bare entry name, which is where
				 * DragonBones.onCleanup looks for it */
				texture: res.maskedTexture(textureName + '.png',
							   dir + textureName + '_ori.jpg',
							   dir + textureName + '.png'),
			};
			/* The native FrameCache exposes effect-atlas regions too.  Lua's
			 * lc.animate("sd") uses those names directly (sd_01, ...), while
			 * DragonBones itself only needs the region table. Register them in
			 * the shared cache so card/effect UI can use the same frames. */
			var atlas = dbCache[key].atlas, tex = dbCache[key].texture;
			Object.keys(atlas.regions).forEach(function (name) {
				var q = atlas.regions[name];
				cc.spriteFrameCache.addSpriteFrame(
					new cc.SpriteFrame(tex, cc.rect(q.x, q.y, q.w, q.h)), name);
			});
		} catch (e) {
			cc.log('[db] ' + key + ': ' + e);
			dbCache[key] = null;
		}
		return dbCache[key];
	}
	global.jdzcRegisterEffectFrames = function (path) {
		var clean = path.replace(/^res\//, ''), name = clean.split('/').pop().replace(/\.lcres$/, '');
		var data = loadEffectData((config.resBase || 'res/') + clean + '/', name, name);
		/* sd's native atlas uses DragonBones names (sd_prats/sd1..sd4),
		 * while Lua's legacy lc.animate asks for sd_01..sd_05. */
		if (data && name === 'sd') {
			['sd1', 'sd2', 'sd3', 'sd4', 'g'].forEach(function (part, i) {
				var q = data.atlas.regions['sd_prats/' + part];
				if (!q) return;
				cc.spriteFrameCache.addSpriteFrame(
					new cc.SpriteFrame(data.texture, cc.rect(q.x, q.y, q.w, q.h)),
					'sd_' + String(i + 1).padStart(2, '0'));
			});
		}
	};

	/* A bone's rotation is its skew: the two are equal for everything the
	 * game ships, and cocos turns the other way from the armature's
	 * y-down space. */
	function setBone(node, t) {
		if (!t) return;
		node.setPosition(t.x * ARMATURE_SCALE, -t.y * ARMATURE_SCALE);
		node.setRotation(t.skewX);
		node.setScaleX(t.scaleX);
		node.setScaleY(t.scaleY);
	}

	function lerpTransform(a, b, k) {
		return {
			x: a.x + (b.x - a.x) * k,
			y: a.y + (b.y - a.y) * k,
			skewX: a.skewX + (b.skewX - a.skewX) * k,
			skewY: a.skewY + (b.skewY - a.skewY) * k,
			scaleX: a.scaleX + (b.scaleX - a.scaleX) * k,
			scaleY: a.scaleY + (b.scaleY - a.scaleY) * k,
		};
	}

	/* The frame covering `at`, with its transform tweened into the next
	 * one. Frame durations are cumulative, in frames. A frame that carries
	 * no transform is the armature's way of saying the slot is not on
	 * screen for that stretch -- a blink, or an effect that starts part-way
	 * through -- so the index comes back with it and the caller hides the
	 * slot. */
	function pickFrame(frames, at) {
		var start = 0;
		for (var i = 0; i < frames.length; i++) {
			var frame = frames[i], end = start + frame.duration;
			if (at < end || i === frames.length - 1) {
				var next = frames[i + 1];
				if (!frame.transform || !next || !next.transform ||
				    frame.duration <= 0)
					return {
						index: i,
						displayIndex: frame.displayIndex,
						alpha: frame.alpha,
						colorR: frame.colorR,
						colorG: frame.colorG,
						colorB: frame.colorB,
						transform: frame.transform
					};

				var k = Math.max(0, Math.min(1,
					(at - start) / frame.duration));
				return {
					index: i,
					displayIndex: frame.displayIndex,
					alpha: frame.alpha !== undefined && next.alpha !== undefined ?
						frame.alpha + (next.alpha - frame.alpha) * k : frame.alpha,
					colorR: frame.colorR,
					colorG: frame.colorG,
					colorB: frame.colorB,
					transform: lerpTransform(frame.transform,
								 next.transform, k),
				};
			}
			start = end;
		}
		return null;
	}

	function showDisplay(entry, displayIndex) {
		var n = entry.sprites.length;
		var want = (displayIndex !== undefined && displayIndex >= 0) ? displayIndex : 0;
		if (want >= n || !entry.sprites[want]) return;
		if (want === entry.shown && entry.sprites[want].isVisible()) return;
		if (entry.shown >= 0 && entry.sprites[entry.shown]) entry.sprites[entry.shown].setVisible(false);
		entry.sprites[want].setVisible(true);
		entry.shown = want;
	}

	cc.DragonBonesNode = cc.Node.extend({
		ctor: function () {
			this._super();
			this._data = null;
			this._slotNodes = [];      /* one per slot, in z order */
			this._anim = null;
			this._time = 0;            /* seconds into the animation */
			this._playing = false;
			this._loop = true;
			this._speed = 1;
		},

		_load: function (path, armatureName, textureName) {
			var dir = (config.resBase || 'res/') +
				path.replace(/^res\//, '') + '/';

			this._data = loadEffectData(dir, armatureName, textureName);
			if (this._data) this._build();
		},

		/* One node per slot at its bone's transform, one sprite inside it
		 * per display. Only the current display is visible. */
		_build: function () {
			var data = this._data, self = this;
			/* A concurrent loose-image request can replace the placeholder
			 * in TextureCache while this effect is being built. Follow the
			 * cache's current object so all slots share the uploaded texture. */
			var cachedTexture = cc.textureCache.getTextureForKey(data.textureKey);
			if (cachedTexture && cachedTexture !== data.texture)
				data.texture = cachedTexture;
			this.removeAllChildren();
			this._slotNodes = [];

			var slots = data.ske.slots.slice().sort(function (a, b) {
				return a.z - b.z;
			});

			slots.forEach(function (slot) {
				var holder = new cc.Node();
				var sprites = slot.displays.map(function (display) {
					var region = data.atlas.regions[display.name];
					if (!region) return null;

					var sprite = new cc.Sprite();
					var rect = cc.rect(region.x, region.y,
							   region.w, region.h);
					sprite.setTexture(data.texture);
					sprite.setTextureRect(rect);
					/* The atlas is often still downloading. html5 does not
					 * retain an unloaded Texture2D on the sprite, so rebind it
					 * when the masked image finishes uploading before restoring
					 * the atlas rect. */
					var ax = region.w ? display.pivotX / region.w : 0.5;
					var ay = region.h ? (region.h - display.pivotY) / region.h : 0.5;

					if (!data.texture.isLoaded()) {
						var bindTexture = function () {
							sprite.setTexture(data.texture);
							/* A few html5 renderer builds reject a Texture2D
							 * placeholder even after its element is uploaded. Keep
							 * the native sprite state explicit in that case. */
							if (!sprite.getTexture()) {
								sprite._texture = data.texture;
								sprite._textureLoaded = true;
								if (sprite._renderCmd && sprite._renderCmd._setTexture)
									sprite._renderCmd._setTexture(data.texture);
							}
							sprite.setTextureRect(rect);
							sprite.setAnchorPoint(ax, ay);
						};
						data.texture.addEventListener('load', bindTexture);

						/* Some canvas/WebGL texture paths can finish between the
						 * loaded check and listener registration. Poll briefly as a
						 * fallback so a missed event cannot leave a permanent hole. */
						var retries = 0;
						(function retryBind() {
							var latestTexture = cc.textureCache.getTextureForKey(data.textureKey);
							if (latestTexture && latestTexture !== data.texture)
								data.texture = latestTexture;
							if (data.texture.isLoaded()) {
								bindTexture();
								return;
							}
							if (++retries < 200) setTimeout(retryBind, 50);
						}());
					}
					sprite.setScaleX(display.scaleX);
					sprite.setScaleY(display.scaleY);
					sprite.setAnchorPoint(ax, ay);
					sprite.setPosition(display.x * ARMATURE_SCALE, -display.y * ARMATURE_SCALE);
					sprite.setRotation(display.skewX);
					sprite.setVisible(false);
					holder.addChild(sprite);
					return sprite;
				});

				if (sprites[0]) sprites[0].setVisible(true);
				self.addChild(holder);
				self._slotNodes.push({
					slot: slot, node: holder, sprites: sprites,
					shown: 0,
				});
			});

			this._applyPose();
		},

		/* the setup pose: every bone where its armature puts it */
		_applyPose: function () {
			var bones = this._data.ske.bones;
			this._slotNodes.forEach(function (entry) {
				setBone(entry.node, bones[entry.slot.bone]);
			});
		},

		_apply: function (dt) {
			var anim = this._anim;
			if (!anim || !this._data) return;

			this._time += dt * (this._speed || 1);
			var length = anim.duration / this._data.ske.fps;

			if (this._time >= length) {
				if (this._loop && length > 0) {
					this._time %= length;
				} else {
					this._time = length;
					this._playing = false;
				}
			}

			var frameAt = this._time * this._data.ske.fps;
			var bones = this._data.ske.bones;
			var self = this;

			var activeTimelines = {};
			anim.timelines.forEach(function (timeline) {
				activeTimelines[timeline.bone] = timeline;
			});

			self._slotNodes.forEach(function (entry) {
				if (!activeTimelines[entry.slot.bone]) {
					entry.node.setVisible(false);
				}
			});

			anim.timelines.forEach(function (timeline) {
				var found = pickFrame(timeline.frames, frameAt);
				if (!found) return;

				self._slotNodes.forEach(function (entry) {
					if (entry.slot.bone !== timeline.bone) return;

					var isVisible = !!found.transform && (found.displayIndex === undefined || found.displayIndex >= 0);
					entry.node.setVisible(isVisible);
					if (!isVisible) return;

					setBone(entry.node, found.transform);
					showDisplay(entry, found.displayIndex);
					var sprite = entry.sprites[entry.shown];
					if (sprite) {
						if (found.alpha !== undefined)
							sprite.setOpacity(
								Math.max(0, Math.min(255,
									Math.round(found.alpha * 255))));
						if (found.colorR !== undefined)
							sprite.setColor(cc.color(
								Math.max(0, Math.min(255,
									Math.round(found.colorR * 255))),
								Math.max(0, Math.min(255,
									Math.round(found.colorG * 255))),
								Math.max(0, Math.min(255,
									Math.round(found.colorB * 255)))));
					}
				});
			});
		},

		gotoAndPlay: function (name, loop) {
			if (!this._data) return this;

			var anim = this._data.ske.anims[name];
			if (!anim) {
				var names = Object.keys(this._data.ske.anims);
				anim = this._data.ske.anims[names[0]];
			}
			if (!anim) return this;

			this._anim = anim;
			this._time = 0;
			this._playing = true;
			this._loop = loop !== undefined ? !!loop : anim.playTimes <= 0;

			var self = this;
			this.unscheduleUpdate();
			this.update = function (dt) { if (self._playing) self._apply(dt); };
			cc.director.getScheduler().scheduleUpdate(this, 0, false);
			this._apply(0);
			return this;
		},

		play: function (name) { return this.gotoAndPlay(name); },

		stop: function () {
			this._playing = false;
			this.unscheduleUpdate();
			return this;
		},

		/* in seconds: the game schedules its removal off this */
		getAnimationDuration: function (name) {
			if (!this._data) return 0;
			var anim = this._data.ske.anims[name] || this._anim;
			if (!anim) return 0;
			return anim.duration / this._data.ske.fps;
		},

		isPlaying: function () { return this._playing; },
		setSpeed: function (speed) { this._speed = speed; return this; },
		getSpeed: function () { return this._speed; },
	});

	cc.DragonBonesNode.create = function () { return new cc.DragonBonesNode(); };
	cc.DragonBonesNode.createWithDecrypt = function (path, armatureName, textureName) {
		var node = new cc.DragonBonesNode();
		if (path) node._load(path, armatureName || '',
				     textureName || armatureName || '');
		return node;
	};
	cc.DragonBonesNode.removeTextureAtlas = function (name) {
		cc.textureCache.removeTextureForKey(name + '.png');
	};

	/* ------------------------------------------------------------------ *
	 * scroll views and lists
	 * ------------------------------------------------------------------ */

	if (ccui.ScrollView) {
		var scrollView = ccui.ScrollView.prototype;
		/* the fork's name for the scroll registration. Bound to ScrollView's
		 * own addEventListener, not this.addEventListener: ListView overrides
		 * that name for item-selected events (UIListView.js:871), so on every
		 * lc.List the scroll callback landed in _ccListViewEventCallback, the
		 * scroll events went to an empty _ccEventCallback, and onScroll never
		 * ran -- the first page drawn was the only page there ever was. */
		var baseScrollAddEventListener = scrollView.addEventListener;
		scrollView.addScrollViewEventListener =
			scrollView.addScrollViewEventListener ||
			function (callback, target) { baseScrollAddEventListener.call(this, callback, target); };
		/* padding at the two ends of the run of items; html5 has no
		 * equivalent, and the lists read the same without it */
		scrollView.setBoundMargin = function (margin) { this.__boundMargin = margin; };
		scrollView.getBoundMargin = function () { return this.__boundMargin || 0; };
		/* the fork's switch for freezing a list while a card is dragged out
		 * of it. html5 gates the drag over a list on exactly this flag, so
		 * setting it is the whole of it -- going through setTouchEnabled
		 * would also pull the listener and leave the next press on the list
		 * going to the list instead of to the card. Seven scenes call this,
		 * and the ones that go on to read a separator position leave a drag
		 * that never completes without it. */
		scrollView.setIsScrollEnabled = function (enabled) { this._touchEnabled = enabled; };
		scrollView.isScrollEnabled = function () { return this._touchEnabled; };
	}

	if (ccui.ListView) {
		var listView = ccui.ListView.prototype;
		listView.setBoundMargin = function (margin) { this.__boundMargin = margin; };
		listView.getBoundMargin = function () { return this.__boundMargin || 0; };
		/* Recycling a page of a list means dropping the items that scrolled
		 * off one end and pushing them back at the other with fresh data.
		 * lc.List does that in removeItemWithCleanup, and html5's ListView
		 * has no such name -- only removeChild, which already drops the
		 * item from _items. A missing method here is not a no-op: the
		 * bridge hands Lua nil, the call throws, and the handler dies
		 * before a single item is moved, so a list draws its first page
		 * and then never advances however far you scroll (lcList.lua:228). */
		listView.removeItemWithCleanup = listView.removeItemWithCleanup ||
			function (item, cleanup) {
				this.removeChild(item, cleanup);
				this._refreshViewDirty = true;
			};
		/* the padding at either end of the run, which is what
		 * setBoundMargin records */
		listView.getStartMargin = listView.getStartMargin ||
			function () { return this.getBoundMargin(); };
		listView.getEndMargin = listView.getEndMargin ||
			function () { return this.getBoundMargin(); };
	}

	/* the fork keeps the text field in ccui; html5 keeps it in cc */
	if (!ccui.EditBox && cc.EditBox) ccui.EditBox = cc.EditBox;

	if (cc.EditBox) {
		var editBox = cc.EditBox.prototype;
		/* the Lua bindings say getText/setText, html5 says getString/setString */
		editBox.getText = editBox.getText || function () { return this.getString(); };
		editBox.setText = editBox.setText || function (s) { this.setString(s); };
		editBox.setPlaceholderFont = editBox.setPlaceholderFont ||
			function (font, size) { this.setPlaceholderFontName(font); this.setPlaceholderFontSize(size); };
		editBox.setFont = editBox.setFont ||
			function (font, size) { this.setFontName(font); this.setFontSize(size); };
	}

	/* The fork's checkbox takes (background, cross, texType); html5 wants
	 * five images before the type, so the extra states stay empty. */
	ccui.CheckBox.create = function (background, cross, texType) {
		return new ccui.CheckBox(background, undefined, cross, undefined,
					 undefined, texType);
	};

	/* ------------------------------------------------------------------ *
	 * ccui.RichTextEx
	 *
	 * The fork's rich text: a flow of elements - runs of styled text, a
	 * forced line break, or an arbitrary node such as a currency icon -
	 * wrapped at a maximum width. html5's own RichText only takes text, so
	 * this lays the elements out directly.
	 *
	 *   ccui.RichItemText:create(tag, colour, opacity, text, font, size)
	 *   ccui.RichItemLabel:create(...)     -- same, a TTF label
	 *   ccui.RichItemCustom:create(tag, colour, opacity, node)
	 *   ccui.RichItemNewLine:create(tag)
	 * ------------------------------------------------------------------ */

	function richLabel(colour, opacity, text, font, size) {
		var label = new cc.LabelTTF(String(text === undefined ? '' : text),
					    global.jdzcFontFamily(font), size || 20);
		if (colour) label.setColor(colour);
		if (opacity !== undefined && opacity !== null) label.setOpacity(opacity);
		return label;
	}

	ccui.RichItemText = {
		create: function (tag, colour, opacity, text, font, size) {
			return { kind: 'node', node: richLabel(colour, opacity, text, font, size) };
		},
	};
	ccui.RichItemLabel = ccui.RichItemText;

	ccui.RichItemCustom = {
		create: function (tag, colour, opacity, node) {
			return { kind: 'node', node: node };
		},
	};

	ccui.RichItemNewLine = {
		create: function () { return { kind: 'newline' }; },
	};

	ccui.RichTextEx = cc.Node.extend({
		ctor: function () {
			this._super();
			/* the fork's RichTextEx is a ccui.Widget, whose default anchor is
			 * the centre -- toasts and dialogs place it at (bg.w/2, bg.h/2)
			 * and expect exactly that. A plain node would anchor at (0,0) and
			 * the text would walk off to the right of its background. */
			this.setAnchorPoint(0.5, 0.5);
			this._elements = [];
			this._maxWidth = 0;
			this._verticalSpace = 0;
		},

		setMaxWidth: function (width) { this._maxWidth = width || 0; },
		getMaxWidth: function () { return this._maxWidth; },
		setVerticalSpace: function (space) { this._verticalSpace = space || 0; },

		insertElement: function (element) {
			if (element) this._elements.push(element);
		},
		pushBackElement: function (element) { this.insertElement(element); },

		removeAllElements: function () {
			this.removeAllChildren();
			this._elements = [];
		},

		/* Lay the elements out into lines, then place them bottom-up the way
		 * cocos measures y. */
		formatText: function () {
			this.removeAllChildren();

			var lines = [[]], line = lines[0];
			var lineWidth = 0, maxWidth = this._maxWidth;

			for (var i = 0; i < this._elements.length; i++) {
				var element = this._elements[i];

				if (element.kind === 'newline') {
					line = [];
					lines.push(line);
					lineWidth = 0;
					continue;
				}
				if (!element.node) continue;

				var width = element.node.getContentSize().width;
				if (maxWidth > 0 && lineWidth === 0 && width > maxWidth &&
				    element.node.setDimensions) {
					/* A run of text wider than the box has to be told the
					 * box width before it can wrap. Left alone it stays a
					 * single long line, and the height that comes back is
					 * one line's, so every later section is laid out on
					 * top of it. */
					element.node.setDimensions(maxWidth, 0);
					width = element.node.getContentSize().width;
				}
				if (maxWidth > 0 && lineWidth > 0 && lineWidth + width > maxWidth) {
					line = [];
					lines.push(line);
					lineWidth = 0;
				}
				line.push(element.node);
				lineWidth += width;
			}

			var heights = [], widths = [], total = 0, widest = 0, j, k;
			for (j = 0; j < lines.length; j++) {
				var height = 0, width = 0;
				for (k = 0; k < lines[j].length; k++) {
					var size = lines[j][k].getContentSize();
					height = Math.max(height, size.height);
					width += size.width;
				}
				if (lines[j].length === 0) height = this._defaultLineHeight();
				heights.push(height);
				widths.push(width);
				total += height + (j > 0 ? this._verticalSpace : 0);
				widest = Math.max(widest, width);
			}

			this.setContentSize(cc.size(maxWidth > 0 ? Math.max(widest, 0) : widest,
						    total));

			var y = total;
			for (j = 0; j < lines.length; j++) {
				y -= heights[j] + (j > 0 ? this._verticalSpace : 0);
				var x = 0;
				for (k = 0; k < lines[j].length; k++) {
					var child = lines[j][k];
					var childSize = child.getContentSize();
					child.setAnchorPoint(0, 0);
					child.setPosition(x, y + (heights[j] - childSize.height) / 2);
					this.addChild(child);
					x += childSize.width;
				}
			}
		},

		_defaultLineHeight: function () { return 20; },
	});

	ccui.RichTextEx.create = function () { return new ccui.RichTextEx(); };

	/* ccui's render command rebuilds every widget's position each frame as
	 * parentSize * _positionPercent -- even for absolute positioning -- but
	 * the percent is only maintained by setPosition while the widget is
	 * running, and it is zeroed again whenever the parent size reads 0.
	 * Everything laid out before a widget enters (a whole form's init) or
	 * moved through paths that skip the bookkeeping is then dragged to the
	 * corner no matter what its position says. Sync the percent back from
	 * the actual position right before the transform runs. */
	var widgetTransform = ccui.Widget.WebGLRenderCmd.prototype.transform;
	ccui.Widget.WebGLRenderCmd.prototype.transform = function (parentCmd, recursive) {
		var node = this._node;
		if (node && node._positionPercent && !this._usingLayoutComponent &&
		    node.getWidgetParent) {
			var widgetParent = node.getWidgetParent();
			if (widgetParent) {
				var pSize = widgetParent.getContentSize();
				if (pSize.width > 0 && pSize.height > 0) {
					node._positionPercent.x = node.getPositionX() / pSize.width;
					node._positionPercent.y = node.getPositionY() / pSize.height;
				}
			}
		}
		return widgetTransform.call(this, parentCmd, recursive);
	};

	/* ------------------------------------------------------------------ *
	 * audio
	 * ------------------------------------------------------------------ */
	/* HTMLMediaElement.play() is promise-based in modern browsers. A scene
	 * transition can pause an audio element in the same turn, which rejects
	 * that promise with AbortError; native SimpleAudioEngine has no promise to
	 * surface. Consume the rejection at the H5 boundary. */
	if (global.HTMLMediaElement && !global.HTMLMediaElement.prototype._jdzcPlayCatch) {
		var mediaPlay = global.HTMLMediaElement.prototype.play;
		if (typeof mediaPlay === 'function') {
			global.HTMLMediaElement.prototype.play = function () {
				var pending = mediaPlay.apply(this, arguments);
				if (pending && typeof pending.catch === 'function') pending.catch(function () {});
				return pending;
			};
			global.HTMLMediaElement.prototype._jdzcPlayCatch = true;
		}
	}

	/* cocos2d-x's SimpleAudioEngine is cc.audioEngine here, short the two
	 * preload calls. LoadingScene preloads every battle effect before it
	 * will switch scenes, so the missing method stopped the boot dead.
	 *
	 * audioInfo.plist names sounds by res/-relative path and the page may
	 * serve res/ from somewhere else, so every name goes through res.base
	 * on the way in. */
	function audioUrl(name) {
		return res.base + String(name).replace(/^res\//, '');
	}

	var audioEngine = {
		preloadMusic: function (name) { cc.loader.load(audioUrl(name)); },
		preloadEffect: function (name) { cc.loader.load(audioUrl(name)); },
	};

	['playMusic', 'playEffect', 'unloadEffect'].forEach(function (m) {
		audioEngine[m] = function (name, loop) {
			return cc.audioEngine[m](audioUrl(name), loop);
		};
	});

	for (var audioKey in cc.audioEngine) {
		if (typeof cc.audioEngine[audioKey] === 'function' &&
		    !audioEngine[audioKey])
			audioEngine[audioKey] = cc.audioEngine[audioKey].bind(cc.audioEngine);
	}

	cc.SimpleAudioEngine = {
		getInstance: function () { return audioEngine; },
	};

	/* ------------------------------------------------------------------ *
	 * `create` / `new` statics
	 *
	 * The Lua bindings expose every class as Cls:create(...) and a few as
	 * Cls:new(...). html5 has most of them already; fill in the rest so the
	 * bridge never has to special-case a class.
	 * ------------------------------------------------------------------ */

	/* html5 folded the quad renderer into cc.ParticleSystem; the game, and
	 * the Lua bindings, still say cc.ParticleSystemQuad. Every setter the
	 * game calls on it is there under the new name. */
	if (!cc.ParticleSystemQuad) cc.ParticleSystemQuad = cc.ParticleSystem;

	/* cocos2d-x draws a filled shape through its own drawSolid* calls; html5
	 * folds them into drawPoly/drawRect/drawCircle with a fill colour and no
	 * outline. Same three shapes, so they are aliases rather than drawings of
	 * our own -- InRoomScene's speech bubbles and the battle board's
	 * highlights are all cut from them. */
	(function () {
		var proto = cc.DrawNode && cc.DrawNode.prototype;
		if (!proto || proto.drawSolidPoly) return;

		/* the x signature carries the vertex count, which the array knows */
		proto.drawSolidPoly = function (verts, count, color) {
			return this.drawPoly(verts, color, 0, color);
		};

		proto.drawSolidRect = function (origin, destination, color) {
			return this.drawRect(origin, destination, color, 0, color);
		};

		proto.drawSolidCircle = function (center, radius, angle, segments, color) {
			return this.drawCircle(center, radius, angle, segments, false, 0, color);
		};
	}());

	['Node', 'Sprite', 'Scene', 'Layer', 'LayerColor', 'LayerGradient',
	 'ClippingNode', 'DrawNode', 'ProgressTimer', 'RenderTexture',
	 'ParticleSystem', 'ParticleSystemQuad', 'LabelTTF', 'LabelBMFont', 'LabelAtlas',
	 'Sequence', 'Spawn', 'Repeat', 'RepeatForever', 'CallFunc', 'DelayTime',
	 'MoveTo', 'MoveBy', 'ScaleTo', 'ScaleBy', 'RotateTo', 'RotateBy',
	 'FadeIn', 'FadeOut', 'FadeTo', 'TintTo', 'Hide', 'Show', 'Place',
	 'RemoveSelf', 'BezierBy', 'BezierTo'].forEach(function (name) {
		var Cls = cc[name];
		if (!Cls) return;
		if (!Cls.create) {
			Cls.create = function () {
				var o = Object.create(Cls.prototype);
				Cls.apply(o, arguments);
				return o;
			};
		}
		if (!Cls.new) Cls.new = Cls.create;
	});

	Object.keys(ccui).forEach(function (name) {
		var Cls = ccui[name];
		if (typeof Cls !== 'function' || Cls.create) return;
		Cls.create = function () {
			var o = Object.create(Cls.prototype);
			Cls.apply(o, arguments);
			return o;
		};
		Cls.new = Cls.create;
	});

	/* ------------------------------------------------------------------ *
	 * cc.Node: the touch API of the Lua bindings
	 *
	 * The whole game routes input through com/lcGesture.lua, which keeps a
	 * detached cc.Layer and asks it for raw touches:
	 *
	 *     layer:setTouchEnabled(true)
	 *     layer:registerScriptTouchHandler(handler, true)
	 *     handler("began"|"moved"|"ended"|"cancelled", {x, y, id, x, y, id...})
	 *
	 * html5 has no script touch handlers, so the same thing is built out of
	 * an all-at-once listener. The layer is not in the scene graph, so the
	 * listener takes a fixed priority -- a positive one, which is dispatched
	 * after the scene graph, leaving ccui widgets first crack at a touch.
	 * ------------------------------------------------------------------ */

	var node = cc.Node.prototype;

	/* The Lua bindings rename whatever collides with a Lua keyword:
	 * cc.RenderTexture::end is bound as endToLua, and LoadingScene calls it
	 * to grab the screenshot it fades the next scene in over. */
	if (cc.RenderTexture)
		cc.RenderTexture.prototype.endToLua = cc.RenderTexture.prototype.end;

	node.getEventDispatcher = function () { return cc.eventManager; };
	node.setTouchEnabled = function (on) { this.__touchEnabled = on !== false; };
	node.isTouchEnabled = function () { return this.__touchEnabled !== false; };
	node.setKeypadEnabled = function () {};
	node.registerScriptKeypadHandler = function () {};
	node.unregisterScriptKeypadHandler = function () {};

	node.registerScriptTouchHandler = function (handler, multiTouch, priority) {
		var self = this;

		function flatten(touches) {
			var out = [];
			for (var i = 0; i < touches.length; i++) {
				var p = touches[i].getLocation();
				out.push(p.x, p.y, touches[i].getID());
			}
			return out;
		}

		function fire(name) {
			return function (touches) {
				if (self.__touchEnabled === false) return;
				handler(name, flatten(touches));
			};
		}

		this.unregisterScriptTouchHandler();

		var listener = cc.EventListener.create({
			event: cc.EventListener.TOUCH_ALL_AT_ONCE,
			onTouchesBegan: fire('began'),
			onTouchesMoved: fire('moved'),
			onTouchesEnded: fire('ended'),
			onTouchesCancelled: fire('cancelled'),
		});

		cc.eventManager.addListener(listener, priority || 1);
		this.__touchListener = listener;
	};

	node.unregisterScriptTouchHandler = function () {
		if (this.__touchListener) {
			cc.eventManager.removeListener(this.__touchListener);
			this.__touchListener = null;
		}
	};

	/* RegionScene:228 passes a size that was never assigned (`hintBgSize` is
	 * a nil global). The device bindings shrugged that off; html5 reads
	 * .width straight off it and takes the scene down with it. Ignore a
	 * sizeless call the same way. */
	var setContentSize = node.setContentSize;

	node.setContentSize = function (size, height) {
		if (size === null || size === undefined) return;
		setContentSize.call(this, size, height);
	};

	if (ccui.Widget && ccui.Widget.prototype.setContentSize) {
		var widgetSetContentSize = ccui.Widget.prototype.setContentSize;
		ccui.Widget.prototype.setContentSize = function (size, height) {
			if (size === null || size === undefined) return;
			widgetSetContentSize.call(this, size, height);
		};
	}

	/* ------------------------------------------------------------------ *
	 * node lifecycle: registerScriptHandler
	 *
	 * lc.createScene hangs the whole scene lifecycle off one callback, so
	 * every screen in the game arrives through here.
	 * ------------------------------------------------------------------ */

	var LIFECYCLE = [
		['onEnter', 'enter'],
		['onExit', 'exit'],
		['cleanup', 'cleanup'],
		['onEnterTransitionDidFinish', 'enterTransitionFinish'],
		['onExitTransitionDidStart', 'exitTransitionStart'],
	];

	/* The hooks go on the instance, not on cc.Node.prototype: cocos's own
	 * class system decides for itself how much of a parent prototype a
	 * subclass keeps, and a scene that missed the patch would never enter. */
	node.registerScriptHandler = function (handler) {
		var self = this;
		this.__scriptHandler = handler;
		if (this.__lifecycleHooked) return;
		this.__lifecycleHooked = true;

		LIFECYCLE.forEach(function (pair) {
			var base = self[pair[0]];
			self[pair[0]] = function () {
				if (base) base.apply(self, arguments);
				if (self.__scriptHandler) self.__scriptHandler(pair[1]);
			};
		});
	};

	node.unregisterScriptHandler = function () {
		this.__scriptHandler = null;
	};

	/* ------------------------------------------------------------------ *
	 * sprite frames by name
	 *
	 * html5 aliases createWithSpriteFrameName to create, which treats the
	 * argument as a file path and goes looking for it over HTTP. In the Lua
	 * bindings it is a frame name, which is the "#name" form here.
	 * ------------------------------------------------------------------ */

	/* "present" is not "drawable". res.js owns the test so a frame whose atlas
	 * was evicted is treated exactly like one that never arrived -- both mean
	 * take the placeholder path and wait for the container to come back. */
	function isBlankFrame(frame) {
		/* the guard is for a stale cached res.js: without it a page running the
		 * old one throws here and takes the whole scene build with it */
		return res.isDrawableFrame ? !res.isDrawableFrame(frame) : !frame;
	}

	/* A sprite born before its atlas reports 0x0, and the caller reads that
	 * size the instant it gets the sprite: ClientView.createTouchSpriteWithShader
	 * makes a ccui.Widget hit box out of it, so the button stays dead for the
	 * rest of the session even though the art shows up. The widget cannot be
	 * resized at the moment it is built (only the .sfb knows the frame size),
	 * so hand it over here instead. A widget that was given a size of its own
	 * keeps it. */
	function adoptLateSize(sprite) {
		var parent = sprite.getParent && sprite.getParent();
		if (!parent || !(parent instanceof ccui.Widget)) return;
		var size = parent.getContentSize();
		if (size.width || size.height) return;
		size = sprite.getContentSize();
		parent.setContentSize(size);
		/* The caller centred the sprite in the box before the box had a size,
		 * so addChildToCenter left it on the 0x0 corner. The box is real now;
		 * the art needs putting back in the middle of it, or a row of dungeon
		 * icons renders down at their bottom-left, which is exactly how low
		 * they sit on a first visit and not on the second. */
		var pos = sprite.getPosition();
		if (!pos.x && !pos.y) sprite.setPosition(cc.p(size.width / 2, size.height / 2));
	}

	/* Cocos keeps a reference to the SpriteFrame rather than looking it up
	 * again. Register an empty node with res.js and replace its frame when the
	 * .sfb index arrives. */
	function createFromFrameName(Cls, name) {
		var frame = lookupFrame(name);
		if (!isBlankFrame(frame)) return new Cls('#' + name);

		var sprite = new Cls();
		res.awaitFrame(name, function (loadedFrame) {
			if (!sprite || !sprite.setSpriteFrame) return;
			sprite.setSpriteFrame(loadedFrame);
			adoptLateSize(sprite);
			if (sprite._renderCmd && sprite._renderCmd.setDirtyFlag) {
				sprite._renderCmd.setDirtyFlag(cc.Node._dirtyFlags.transformDirty);
			}
			if (cc.renderer) cc.renderer.childrenOrderDirty = true;
		});
		return sprite;
	}

	cc.Sprite.createWithSpriteFrameName = function (name) {
		return createFromFrameName(cc.Sprite, name);
	};
	cc.Sprite.createWithSpriteFrame = function (frame) {
		return new cc.Sprite(frame);
	};
	/* Lua also builds sprites through initWithSpriteFrameName, directly and
	 * via ccui.Button / ccui.ImageView / ccui.CheckBox. cc.assert is a no-op in
	 * this build, so when the frame's atlas has not landed the base method is
	 * handed a null and throws on spriteFrame.textureLoaded(). That error
	 * unwinds out of whatever Lua was mid-way through -- at boot it kills the
	 * rest of a scene's UI build, and a button whose art never arrives is the
	 * fully transparent frame players report. Take the node now, fill the art
	 * in when the frame arrives, exactly as createFromFrameName does. */
	var baseInitWithSpriteFrameName = cc.Sprite.prototype.initWithSpriteFrameName;
	cc.Sprite.prototype.initWithSpriteFrameName = function (name) {
		if (!name) return false;
		if (!isBlankFrame(lookupFrame(name)))
			return baseInitWithSpriteFrameName.apply(this, arguments);

		var sprite = this;
		res.awaitFrame(name, function (frame) {
			if (!frame || !sprite.initWithSpriteFrame) return;
			baseInitWithSpriteFrameName.call(sprite, name);
			/* ccui.Button.loadTextureNormal listens for this and only sizes
			 * the button there (UIButton.js:244). setSpriteFrame's own async
			 * path dispatches it; this arrival does not go through that. */
			if (sprite.dispatchEvent) sprite.dispatchEvent("load");
			adoptLateSize(sprite);
		});
		return false;
	};

	/* Lua also assigns named frames after a Sprite already exists. The HTML5
	 * method resolves strings through the public cache, so retain the native
	 * null-on-miss behavior while making late atlas assignment safe. */
	var baseSpriteSetSpriteFrame = cc.Sprite.prototype.setSpriteFrame;
	cc.Sprite.prototype.setSpriteFrame = function (frame) {
		if (typeof frame !== 'string') {
			return baseSpriteSetSpriteFrame.apply(this, arguments);
		}
		var loadedFrame = lookupFrame(frame);
		if (!isBlankFrame(loadedFrame))
			return baseSpriteSetSpriteFrame.call(this, loadedFrame);

		var sprite = this;
		res.awaitFrame(frame, function (resolvedFrame) {
			baseSpriteSetSpriteFrame.call(sprite, resolvedFrame);
		});
	};
	cc.ShaderSprite.createWithSpriteFrameName = function (name) {
		return createFromFrameName(cc.ShaderSprite, name);
	};
	/* the fork's own spelling, used as often as the long one */
	cc.ShaderSprite.createWithFramename = cc.ShaderSprite.createWithSpriteFrameName;

	/* createWithFilename does not take a path: the game passes the key its
	 * texture is cached under, such as "10001.jpm" from a card's own
	 * container. That container is loading asynchronously here, so hand back
	 * an empty sprite and let the resource layer fill it in when the art
	 * arrives, rather than the nil the game reads as "no such card". */
	function createFromFile(Cls) {
		return function (key) {
			if (!key) return null;

			/* The game reads the sprite's content size the instant it is
			 * created -- ClientView.createCardPackage stacks a pack from three
			 * sprites with lc.h()/lc.w() -- so an empty sprite here collapses
			 * the layout to zero and it never recovers once the pixels land.
			 * The manifest knows every loose image's size up front, so give
			 * the sprite its true size straight away in every path. */
			var size = res.sizeOf(key);

			var texture = cc.textureCache.getTextureForKey(key);
			if (texture && texture.isLoaded()) return new Cls(texture);

			if (texture || res.exists(key)) {
				var sprite = new Cls();
				if (size) sprite.setContentSize(cc.size(size[0], size[1]));
				if (texture) {
					/* the cache is holding the key but the pixels are still
					 * in flight; the resource layer fills the sprite in */
					res.awaitTexture(key, sprite);
				} else if (/^res\//.test(key)) {
					/* nobody else asked for the load -- start it here, the
					 * res/jpg colour+mask pairs resolve through the same
					 * placeholder the rest of the cache uses. Container keys
					 * ("10001.jpm") keep the sprite's own self-loading. */
					cc.textureCache.addImageWithMask(key);
					res.awaitTexture(key, sprite);
				}
				return sprite;
			}

			return new Cls(key);
		};
	}

	cc.ShaderSprite.createWithFilename = createFromFile(cc.ShaderSprite);
	cc.Sprite.createWithFilename = createFromFile(cc.Sprite);

	/* A sprite from a path is a download here and was a file read on the
	 * device, so the game reads a content size of zero from a sprite it has
	 * just created. CityScene divides its own width by the background's to
	 * work out an anchor point, and that zero wrecks the layout for good, so
	 * the size comes from the manifest and is applied straight away; the
	 * pixels catch up on their own.
	 *
	 * The same call is also used with a texture-cache key rather than a path
	 * ("10001.jpm", a card's art), which on the device resolved through the
	 * cache. Look there first. */
	/* Give a sprite its texture after the fact.
	 *
	 * Setting the texture and the rect is not enough: the quad the renderer
	 * uploads is only rebuilt when the node's transform is marked dirty, so
	 * a sprite that got its art late keeps four vertices at the same point
	 * and draws nothing at all. We need to force a full re-render. */
	function attachTexture(sprite, texture) {
		if (!sprite || !texture) return;

		/* Not everything waiting for a texture is a cc.Sprite. A ccui widget
		 * keeps its picture in a renderer of its own and has no setTexture at
		 * all, and a Scale9Sprite is rebuilt from a frame rather than given a
		 * texture. Dispatch here, once, rather than at each of the four call
		 * sites that can hand us a widget. */
		if (sprite._imageRenderer) {
			attachTexture(sprite._imageRenderer, texture);
			sprite._imageTextureSize = cc.size(texture.getPixelsWide(),
							   texture.getPixelsHigh());
			if (sprite._updateContentSizeWithTextureSize)
				sprite._updateContentSizeWithTextureSize(sprite._imageTextureSize);
			sprite._imageRendererAdaptDirty = true;
			if (sprite._findLayout) sprite._findLayout();
			return;
		}

		if (!sprite.setTexture) {
			if (sprite.setSpriteFrame)
				sprite.setSpriteFrame(new cc.SpriteFrame(texture,
					cc.rect(0, 0, texture.getPixelsWide(),
						texture.getPixelsHigh())));
			return;
		}

		sprite.setTexture(texture);
		sprite.setTextureRect(cc.rect(0, 0,
			texture.getPixelsWide(), texture.getPixelsHigh()));
		/* Force the renderer to rebuild the quad by marking the node dirty.
		 * Multiple approaches needed because different cocos2d-html5 builds
		 * handle dirty flags differently. */
		if (sprite._renderCmd && sprite._renderCmd.setDirtyFlag) {
			sprite._renderCmd.setDirtyFlag(cc.Node._dirtyFlags.transformDirty);
		}
		/* Also try setting position to trigger transform update */
		var pos = sprite.getPosition();
		sprite.setPosition(pos.x + 0.001, pos.y);
		sprite.setPosition(pos.x, pos.y);
		/* Mark renderer order as dirty to ensure proper draw order */
		if (cc.renderer) {
			cc.renderer.childrenOrderDirty = true;
		}
		/* Force content size update if it was set from manifest */
		var size = sprite.getContentSize();
		if (size.width === 0 || size.height === 0) {
			sprite.setContentSize(cc.size(
				texture.getPixelsWide(), texture.getPixelsHigh()));
		}
	}

	global.jdzcAttachTexture = attachTexture;

	function sizedCreate(Cls, base) {
		return function (a, b, c) {
			if (typeof a !== 'string' || a.charAt(0) === '#' || b) {
				return base.call(Cls, a, b, c);
			}

			var cached = cc.textureCache.getTextureForKey(a);
			if (cached && cached.isLoaded()) return new Cls(cached);

			var sprite = new Cls();
			var size = res.sizeOf(a) || (cached && cached._contentSize && cached._contentSize.width > 0 ? [cached._contentSize.width, cached._contentSize.height] : null);
			if (size) sprite.setContentSize(cc.size(size[0], size[1]));

			if (cached) {
				res.awaitTexture(a, sprite);
				return sprite;
			}

			/* Build the sprite empty and attach the texture ourselves rather
			 * than letting the constructor start the load: its own loaded
			 * callback runs with the wrong receiver in this build and the
			 * image never reaches the sprite. */
			if (res.exists(a)) {
				cc.textureCache.addImage(a, function (texture) {
					if (!texture) return;
					attachTexture(sprite, texture);
					/* A second sprite can see the cache entry while this
					 * request is still in flight and register through
					 * awaitTexture(). Loose JPGs do not go through a container,
					 * so complete those waiters here. */
					res.resolvePending(a);
				});
				return sprite;
			}

			/* A path into res/ that the manifest does not list is a file
			 * that is not there, and cc.Sprite:create returned nil for it on
			 * the device. The game leans on that: createLoadingBg falls back
			 * to loading1.jpg only when the skinned name comes back nil, and
			 * a dozen other callers do the same. An empty sprite here is a
			 * permanently black screen. Anything else is a texture-cache key
			 * for a container still in flight -- that one does wait. */
			if (a.indexOf('res/') === 0) return null;

			res.awaitTexture(a, sprite);
			return sprite;
		};
	}

	cc.Sprite.create = sizedCreate(cc.Sprite, cc.Sprite.create);
	cc.ShaderSprite.create = sizedCreate(cc.ShaderSprite, cc.ShaderSprite.create);

	/* The per-node update hook of the Lua bindings: html5 schedules the
	 * target's own update method, so the Lua function becomes it. */
	node.scheduleUpdateWithPriorityLua = function (handler, priority) {
		this.update = function (dt) { handler(dt); };
		cc.director.getScheduler().scheduleUpdate(this, priority || 0, false);
	};

	node.unscheduleUpdate = function () {
		cc.director.getScheduler().unscheduleUpdate(this);
	};

	/* cocos2d-x has it, html5 does not */
	node.removeChildrenByTag = function (tag, cleanup) {
		var children = this.getChildren();
		for (var i = children.length - 1; i >= 0; i--) {
			if (children[i].getTag() === tag) {
				this.removeChild(children[i], cleanup !== false);
			}
		}
	};

	if (ccui.Widget) {
		ccui.Widget.prototype.setTouchSwallow = function (swallow) {
			if (this.setSwallowTouches) this.setSwallowTouches(swallow);
		};
		ccui.Widget.prototype.isTouchSwallow = function () {
			return this.isSwallowTouches ? this.isSwallowTouches() : true;
		};
	}

	if (!node.resume) {
		node.resume = function () { this.resumeSchedulerAndActions(); };
		node.pause = function () { this.pauseSchedulerAndActions(); };
	}

	/* The Lua bindings put a class's methods on the class table as well as
	 * on the instance, called with the instance first: CardSprite overrides
	 * runAction and then reaches past its own override with
	 * `cc.Node.runAction(self, action)`. html5 keeps only statics there, so
	 * mirror the prototype across. Dispatch stays dynamic, so mirroring the
	 * base class covers every subclass. */
	function mirrorPrototype(Cls) {
		if (!Cls || !Cls.prototype) return;
		/* by descriptor, not by value: html5 defines x, y and friends as
		 * accessors on the prototype, and reading one there -- with no
		 * instance behind it -- throws */
		Object.getOwnPropertyNames(Cls.prototype).forEach(function (key) {
			var d = Object.getOwnPropertyDescriptor(Cls.prototype, key);
			if (Cls[key] || !d || typeof d.value !== 'function') return;
			Cls[key] = function (self) {
				return self[key].apply(self,
					Array.prototype.slice.call(arguments, 1));
			};
		});
	}

	[cc.Node, cc.ProgressTimer, ccui.Widget].forEach(mirrorPrototype);

	/* ccui's layout managers ask every child of a list for its layout
	 * parameter. The game fills its lists with plain nodes as well as
	 * widgets, which on the device the layout simply skipped. */
	if (!node.getLayoutParameter) node.getLayoutParameter = function () { return null; };

	/* cocos2d-x takes enableShadow() bare and draws its default drop
	 * shadow; html5 reads the colour off the first argument and throws when
	 * there is none. */
	if (cc.LabelTTF) {
		var baseEnableShadow = cc.LabelTTF.prototype.enableShadow;
		cc.LabelTTF.prototype.enableShadow = function (color, offset, blur) {
			baseEnableShadow.call(this, color || cc.color(0, 0, 0, 255),
					      offset || cc.size(2, -2), blur || 0);
		};
	}

	/* ------------------------------------------------------------------ *
	 * cc.Camera
	 *
	 * The fork puts the city on a perspective camera so the map can tilt.
	 * cocos2d-html5 is a 2D engine with no 3D camera support. The Camera
	 * object exists and holds its parameters, but nothing transforms by it.
	 * The city renders flat, which is how the game looks with the tilt at
	 * rest anyway. Touch input works through the ordinary 2D path.
	 * ------------------------------------------------------------------ */

	/* It is a cc.Node, not a bare object: the game parents it into whichever
	 * scene wants 3D (`BaseScene.seenByCamera3D` reads getParent, calls
	 * removeFromParent and addChild on it), and only a real node answers
	 * those. It draws nothing. */
	var Camera = cc.Node.extend({
		ctor: function () {
			this._super();
			this.flag = 0;
			this.depth = 0;
		},
		lookAt: function (at, up) { this.target = at; this.up = up; },
		setCameraFlag: function (f) { this.flag = f; },
		getCameraFlag: function () { return this.flag; },
		setDepth: function (d) { this.depth = d; },
		getDepth: function () { return this.depth; },
		visit: function () {},
	});

	cc.Camera = Camera;
	cc.Camera.createPerspective = function (fov, aspect, near, far) {
		var c = new Camera();
		c.perspective = { fov: fov, aspect: aspect, near: near, far: far };
		return c;
	};
	cc.Camera.getVisitingCamera = function () { return null; };
	cc.Camera.getDefaultCamera = function () { return null; };

	/* ------------------------------------------------------------------ *
	 * fonts: a TTF path from the game becomes a CSS family
	 * ------------------------------------------------------------------ */

	var fontFamilies = {};

	global.jdzcFontFamily = function (path) {
		if (!path) return 'Arial';
		if (fontFamilies[path]) return fontFamilies[path];

		var family = 'jdzc_' + path.replace(/[^A-Za-z0-9]/g, '_');
		var url = (config.resBase || '/res/') + String(path).replace(/^res\//, '');
		var style = document.createElement('style');
		style.textContent = '@font-face{font-family:"' + family +
			'";src:url("' + url + '");}';
		document.head.appendChild(style);
		fontFamilies[path] = family;
		return family;
	};

	/* ------------------------------------------------------------------ *
	 * ccui.Scale9Sprite -- handle asynchronous texture loading
	 *
	 * The game creates Scale9Sprites with file paths that may not be loaded
	 * yet. We wrap the create methods to handle this gracefully.
	 * ------------------------------------------------------------------ */

	if (ccui.Scale9Sprite) {
		var baseScale9Create = ccui.Scale9Sprite.create;
		ccui.Scale9Sprite.create = function (fileOrRect, rectOrCapInsets, capInsets) {
			/* Handle different argument patterns:
			 * - create(file, rect, capInsets)
			 * - create(rect, file) - used by lc.createSprite where rect IS the capInsets
			 */
			var file, sourceRect, caps;
			if (typeof fileOrRect === 'string') {
				file = fileOrRect;
				sourceRect = rectOrCapInsets;
				caps = capInsets;
			} else if (rectOrCapInsets && typeof rectOrCapInsets === 'string') {
				/* create(capInsets, file) pattern from lc.createSprite:
				 *   ccui.Scale9Sprite:create(var_10_1, arg_10_0)
				 * where var_10_1 = _crect (the cap insets) and arg_10_0 = filename.
				 * The first arg is the capInsets rect, NOT a source rect. */
				file = rectOrCapInsets;
				sourceRect = null;
				caps = fileOrRect;
			} else {
				/* Fall back to original behavior */
				return baseScale9Create.apply(ccui.Scale9Sprite, arguments);
			}

			/* Check if texture is already cached */
			var tex = cc.textureCache.getTextureForKey(file);
			if (tex) {
				return baseScale9Create.call(ccui.Scale9Sprite, file, sourceRect, caps);
			}

			/* Create empty sprite and load texture asynchronously.
			 *
			 * Two things must survive the async gap:
			 * 1. The desired content size -- game code calls setContentSize
			 *    immediately after create(), but initWithFile resets it to
			 *    the texture's natural size when the texture arrives.
			 * 2. The cap insets -- same problem: they must be re-applied
			 *    after initWithFile so the 9-slice borders are correct. */
			var sprite = new ccui.Scale9Sprite();
			var pendingSize = null;
			var size = res.sizeOf(file);
			if (size) {
				sprite.setContentSize(cc.size(size[0], size[1]));
			}

			/* Intercept setContentSize calls while the texture is loading
			 * so we can re-apply the game's intended size afterwards. */
			var origSetContentSize = sprite.setContentSize.bind(sprite);
			sprite.setContentSize = function (w_or_size, h) {
				var s = (typeof w_or_size === 'object') ? w_or_size : cc.size(w_or_size, h || 0);
				pendingSize = s;
				origSetContentSize(s);
			};

			if (res.exists(file)) {
				cc.textureCache.addImage(file, function (texture) {
					if (!texture) return;
					/* Re-initialize with the loaded texture */
					if (sourceRect) {
						sprite.initWithFile(file, sourceRect, caps);
					} else if (caps) {
						sprite.initWithFile(file, null, caps);
					} else {
						sprite.initWithFile(file);
					}
					attachTexture(sprite, texture);
					/* Restore the game's intended content size */
					if (pendingSize) {
						sprite.setContentSize = origSetContentSize;
						sprite.setContentSize(pendingSize);
					} else {
						sprite.setContentSize = origSetContentSize;
					}
				});
			} else {
				res.awaitTexture(file, sprite);
			}
			return sprite;
		};

		/* Also handle createWithSpriteFrameName */
		var baseScale9CreateWithFrameName = ccui.Scale9Sprite.createWithSpriteFrameName;
		ccui.Scale9Sprite.createWithSpriteFrameName = function (frameName, capInsets) {
			var frame = cc.spriteFrameCache.getSpriteFrame(frameName);
			if (!isBlankFrame(frame)) {
				var built = baseScale9CreateWithFrameName.call(ccui.Scale9Sprite, frameName, capInsets);
				stampScale9(built, frameName, capInsets);
				return built;
			}
			/* Frame not loaded yet - return a placeholder that will be filled
			 * when the container loads. Its content size is the caller's
			 * business: the wrapper below has already recorded whatever size
			 * gets set on it before the art lands, and puts it back after. */
			var sprite = new ccui.Scale9Sprite();
			stampScale9(sprite, frameName, capInsets);
			var pendingCaps = capInsets || null;
			res.awaitFrame(frameName, function () {
				/* initWithSpriteFrameName, not the create* factory: the
				 * factory builds a fresh sprite and returns it, so calling it
				 * with this placeholder as `this` threw the real one away and
				 * left the placeholder empty for good -- every nine-slice
				 * born before its atlas landed on a first visit. */
				sprite.initWithSpriteFrameName(frameName, pendingCaps);
				restoreScale9Size(sprite);
			});
			return sprite;
		};

		/* The factory above covers createWithSpriteFrameName. Every button in
		 * the game goes through the instance method instead -- ccui.Button's
		 * normal/clicked/disabled renderers are Scale9Sprites and
		 * loadTextureNormal calls initWithSpriteFrameName on them. On a miss
		 * that method only logs and returns false, so the button is left with a
		 * 0x0 renderer, a 0x0 content size and no art: a dead, fully
		 * transparent button, which is what an initiative button that happens
		 * to open before `general.lcres` landed looks like. Hold it and re-run
		 * the real init when the frame arrives. */
		var baseScale9InitWithSpriteFrameName = ccui.Scale9Sprite.prototype.initWithSpriteFrameName;
		ccui.Scale9Sprite.prototype.initWithSpriteFrameName = function (frameName, capInsets) {
			stampScale9(this, frameName, capInsets);
			if (!frameName || !isBlankFrame(lookupFrame(frameName))) {
				return baseScale9InitWithSpriteFrameName.apply(this, arguments);
			}

			var node = this;
			res.awaitFrame(frameName, function (frame) {
				if (!frame) return;
				baseScale9InitWithSpriteFrameName.call(node, frameName, capInsets);
				restoreScale9Size(node);
				if (node.dispatchEvent) node.dispatchEvent("load");
				adoptLateSize(node);
			});
			return false;
		};

		/* Not every nine-slice that comes up empty comes up empty at birth. A
		 * miss inside initWithSpriteFrameName only logs and returns false, so
		 * the node keeps its size and its place on screen with nothing under it,
		 * and the loader above resolves a name exactly once -- if that one
		 * resolution is missed the node is empty for the rest of the session.
		 * That is the dialog frame box with no grey fill and no title banner,
		 * and the same shape of node behind whatever else draws as a blank.
		 * Remember what each nine-slice was built from and re-ask on the draw
		 * path, so one that is empty fills itself in on a later frame. */
		function stampScale9(node, frameName, capInsets) {
			if (!node || !frameName) return node;
			node.__frameName = frameName;
			if (capInsets) node.__frameCaps = capInsets;
			return node;
		}

		/* updateWithSprite ends by sizing the node to the frame's own atlas
		 * size (UIScale9Sprite.js:896-903), and every late arrival goes through
		 * it -- the placeholder fill below, the instance initWithSpriteFrameName
		 * above, a setSpriteFrame re-ask. So a nine-slice whose art lands after
		 * the caller sized it snaps back to the atlas: a 900x350 dialog frame
		 * came back 172x153 and its 860x310 grey fill 10x10 -- the box with no
		 * background, the fill a ten-pixel dot. That is the state an atlas
		 * unload/reload leaves behind, which is why it takes a while and a pile
		 * of effects to show up.
		 *
		 * A size set while the art was still missing is the size the caller
		 * meant. Keep it, and put it back after the frame is in. The predicate
		 * is what tells the two calls apart: by the time updateWithSprite
		 * resizes itself, _originalSize already holds the frame's size, so only
		 * the caller's earlier call is recorded. */
		var baseScale9SetContentSize = ccui.Scale9Sprite.prototype.setContentSize;
		ccui.Scale9Sprite.prototype.setContentSize = function (size, height) {
			var s = (typeof size === 'object') ? size : cc.size(size, height || 0);
			if (s && (s.width || s.height) && !(this._originalSize && this._originalSize.width)) {
				this.__wantedSize = cc.size(s.width, s.height);
			}
			return baseScale9SetContentSize.apply(this, arguments);
		};

		function restoreScale9Size(node) {
			var s = node && node.__wantedSize;
			if (!s) return;
			var now = node.getContentSize();
			if (now.width === s.width && now.height === s.height) return;
			node.setContentSize(s);
		}

		var baseScale9UpdateWithSprite = ccui.Scale9Sprite.prototype.updateWithSprite;
		ccui.Scale9Sprite.prototype.updateWithSprite = function () {
			var wasVisible = this._visible;
			var ret = baseScale9UpdateWithSprite.apply(this, arguments);
			/* "The atlas is not up yet" is answered by hiding the node and
			 * waiting on that texture object's own 'load' event
			 * (UIScale9Sprite.js:874-882). removeTextureForKey throws the
			 * texture away and the loader builds a fresh one under the same
			 * key, so for this object that event can never come: the node is
			 * hidden for the rest of the session. A hidden Scale9Sprite is not
			 * drawn at all -- its render command returns before drawing its
			 * children (UIScale9SpriteWebGLRenderCmd.js:37-40) -- so the plate
			 * takes the title label and the glow inside it down with it. An
			 * empty nine-slice draws nothing anyway; stay visible, keep the
			 * children, and let the frame arrive. */
			if (wasVisible && this._visible === false && !this._textureLoaded) {
				this.setVisible(true);
			}
			return ret;
		};

		/* An empty nine-slice needs the name asked for again, and the ask has
		 * to hang off the draw path: the loader resolves a name exactly once,
		 * and that one resolution happened while the atlas was unloaded. */
		function healEmptyScale9(node) {
			if (!node || !node.__frameName) return;
			if (node._originalSize && node._originalSize.width) return;
			var now = Date.now();
			if (node.__frameRetryAt && now - node.__frameRetryAt <= 1000) return;
			node.__frameRetryAt = now;
			/* one waiter per node, reused every retry: a new closure each second
			 * piled up in R.frameWaiters for a frame that never arrived */
			node.__healWaiter = node.__healWaiter || function () {
				if (node._originalSize && node._originalSize.width) return;
				var frame = lookupFrame(node.__frameName);
				if (isBlankFrame(frame)) return;
				/* What updateWithSprite does to a node it cannot draw yet:
				 * hide it, set _textureLoaded false, leave _originalSize at
				 * zero. Its load listener resets both; nobody re-fires that. */
				var wedged = node._visible === false && node._textureLoaded === false;
				/* setSpriteFrame ends by sizing the node to the frame's atlas
				 * size. A node the caller sized keeps that size; one nobody
				 * sized takes the frame's. */
				var keep = node.getContentSize();
				cc.log('[h5] empty nine-slice refilled: ' + node.__frameName);
				node.setSpriteFrame(frame, node.__frameCaps);
				if (keep.width || keep.height) node.setContentSize(keep);
				if (wedged) node.setVisible(true);
			};
			res.awaitFrame(node.__frameName, node.__healWaiter);
		}

		/* The renderer never calls node.visit. A parent draws its children with
		 * child._renderCmd.visit(parentCmd) (CCNodeCanvasRenderCmd.js:283), and
		 * a Scale9Sprite's command is ccui.Scale9Sprite.WebGLRenderCmd -- so a
		 * heal hung on the node method is a heal nothing ever runs, which is
		 * how the plate kept coming up empty after the last update. Hook the
		 * drawing. */
		function hookScale9Draw(cmd) {
			if (!cmd || !cmd.visit) return;
			var baseVisit = cmd.visit;
			cmd.visit = function (parentCmd) {
				healEmptyScale9(this._node);
				return baseVisit.apply(this, arguments);
			};
		}
		hookScale9Draw(ccui.Scale9Sprite.WebGLRenderCmd &&
			ccui.Scale9Sprite.WebGLRenderCmd.prototype);
		hookScale9Draw(ccui.Scale9Sprite.CanvasRenderCmd &&
			ccui.Scale9Sprite.CanvasRenderCmd.prototype);

		/* A nine-slice that moves leaves its own children behind.
		 *
		 * The WebGL command transforms the node and its nine slices, zeroes
		 * its dirty flag, and only then visits its real children
		 * (UIScale9SpriteWebGLRenderCmd.js:49-74). A child recomputes its
		 * place only while its parent's flag still says the transform is
		 * dirty (CCNodeCanvasRenderCmd.js:437), so on a frame that re-visits
		 * the whole scene the children keep the world position they had
		 * before the move. A dialog's frame box draws where it is; its grey
		 * fill, title and list draw where the box started its slide-in --
		 * off screen, or anywhere along the ease -- while touches, which
		 * recompute the chain, still land on the icons. The whole-scene visit
		 * runs on every frame that adds, removes or reorders any node, which
		 * in a battle full of skill effects is every frame: hence "fine at
		 * first, broken a few turns in". Hand the bit to the children.
		 *
		 * Only the node's own move needs this: when the parent moved, the
		 * second _syncStatus in originVisit picks that up from the parent. */
		var s9WebGL = ccui.Scale9Sprite.WebGLRenderCmd &&
			ccui.Scale9Sprite.WebGLRenderCmd.prototype;
		if (s9WebGL) {
			var TRANSFORM_DIRTY = cc.Node._dirtyFlags.transformDirty;
			var s9Visit = s9WebGL.visit, s9VisitChildren = s9WebGL.visitChildren;
			s9WebGL.visit = function (parentCmd) {
				if (this._dirtyFlag & TRANSFORM_DIRTY) this.__childrenMoved = true;
				return s9Visit.apply(this, arguments);
			};
			s9WebGL.visitChildren = function () {
				if (this.__childrenMoved) {
					this.__childrenMoved = false;
					this._dirtyFlag |= TRANSFORM_DIRTY;
				}
				return s9VisitChildren.apply(this, arguments);
			};
		}

		/* Kept for a manual visit -- and for work/_selfheal.mjs, which drives
		 * the heal through the node. The hook above is what runs in game. */
		var baseScale9Visit = ccui.Scale9Sprite.prototype.visit || cc.Node.prototype.visit;
		ccui.Scale9Sprite.prototype.visit = function () {
			healEmptyScale9(this);
			return baseScale9Visit.apply(this, arguments);
		};
	}

	/* ------------------------------------------------------------------ *
	 * ccui.ImageView -- handle asynchronous texture loading
	 *
	 * The game creates ImageViews with file paths or sprite frame names.
	 * We wrap the create method to handle asynchronous loading gracefully.
	 * ------------------------------------------------------------------ */

	/* The enum the Lua bindings expose; html5 has the same two values as
	 * loose constants on ccui.Widget and no enum table at all. */
	ccui.TextureResType = ccui.TextureResType || {
		localType: ccui.Widget.LOCAL_TEXTURE,
		plistType: ccui.Widget.PLIST_TEXTURE,
	};

	if (ccui.ImageView) {
		var baseImageViewCreate = ccui.ImageView.create;
		ccui.ImageView.create = function (fileName, texType) {
			/* texType: 0 = local file, 1 = plist/sprite frame */
			var isLocal = texType === undefined || texType === ccui.TextureResType.localType;

			if (isLocal && fileName) {
				/* Check if texture is already cached */
				var tex = cc.textureCache.getTextureForKey(fileName);
				if (tex) {
					return baseImageViewCreate.call(ccui.ImageView, fileName, texType);
				}

				/* Create empty ImageView and load texture asynchronously.
				 *
				 * The game may call setScale9Enabled(true) and setCapInsets()
				 * before the texture arrives. We intercept those calls and
				 * re-apply them after loadTexture so the 9-slice state is
				 * not silently lost. */
				var imageView = new ccui.ImageView();
				var pendingSize = null;
				var pendingScale9 = false;
				var pendingCaps = null;
				var size = res.sizeOf(fileName);
				if (size) {
					imageView.setContentSize(cc.size(size[0], size[1]));
				}

				var origSetContentSize = imageView.setContentSize.bind(imageView);
				imageView.setContentSize = function (w_or_size, h) {
					var s = (typeof w_or_size === 'object') ? w_or_size : cc.size(w_or_size, h || 0);
					pendingSize = s;
					origSetContentSize(s);
				};

				var origSetScale9 = imageView.setScale9Enabled ? imageView.setScale9Enabled.bind(imageView) : null;
				if (origSetScale9) {
					imageView.setScale9Enabled = function (enabled) {
						pendingScale9 = enabled;
						origSetScale9(enabled);
					};
				}

				var origSetCaps = imageView.setCapInsets ? imageView.setCapInsets.bind(imageView) : null;
				if (origSetCaps) {
					imageView.setCapInsets = function (caps) {
						pendingCaps = caps;
						origSetCaps(caps);
					};
				}

				var restoreState = function () {
					imageView.setContentSize = origSetContentSize;
					if (origSetScale9) imageView.setScale9Enabled = origSetScale9;
					if (origSetCaps) imageView.setCapInsets = origSetCaps;
					/* Re-apply in the correct order: scale9 first, then caps, then size */
					if (pendingScale9 && origSetScale9) origSetScale9(true);
					if (pendingCaps && origSetCaps) origSetCaps(pendingCaps);
					if (pendingSize) origSetContentSize(pendingSize);
				};

				if (res.exists(fileName)) {
					cc.textureCache.addImage(fileName, function (texture) {
						if (!texture) return;
						imageView.loadTexture(fileName, ccui.TextureResType.localType);
						restoreState();
					});
				} else {
					res.awaitTexture(fileName, imageView);
				}
				return imageView;
			} else if (!isLocal && fileName) {
				/* Sprite frame name */
				var frame = cc.spriteFrameCache.getSpriteFrame(fileName);
				if (!isBlankFrame(frame)) {
					return baseImageViewCreate.call(ccui.ImageView, fileName, texType);
				}
				/* Frame not loaded yet - rebuild the ImageView when its atlas arrives. */
				var imageView = new ccui.ImageView();
				res.awaitFrame(fileName, function () {
					imageView.loadTexture(fileName, ccui.TextureResType.plistType);
				});
				return imageView;
			}

			return baseImageViewCreate.apply(ccui.ImageView, arguments);
		};
	}

	/* LoadingBar has its own renderer and calls Sprite.initWithSpriteFrameName
	 * directly, so it bypasses the Sprite/ImageView async paths above. Keep it
	 * empty until the atlas index arrives, then restore the state callers set
	 * in the usual loadTexture → scale9 → capInsets → size sequence. */
	if (ccui.LoadingBar) {
		var baseLoadingBarLoadTexture = ccui.LoadingBar.prototype.loadTexture;
		ccui.LoadingBar.prototype.loadTexture = function (fileName, texType) {
			var isFrame = texType === ccui.TextureResType.plistType ||
				texType === ccui.Widget.PLIST_TEXTURE;
			if (!isFrame || !isBlankFrame(lookupFrame(fileName))) {
				return baseLoadingBarLoadTexture.apply(this, arguments);
			}

			var loadingBar = this;
			var baseSetScale9Enabled = loadingBar.setScale9Enabled;
			var baseSetCapInsets = loadingBar.setCapInsets;
			var baseSetContentSize = loadingBar.setContentSize;
			var baseSetPercent = loadingBar.setPercent;
			var state = {};

			loadingBar.setScale9Enabled = function (enabled) {
				state.scale9Enabled = enabled;
				return baseSetScale9Enabled.apply(loadingBar, arguments);
			};
			loadingBar.setCapInsets = function (insets) {
				state.capInsets = insets;
				return baseSetCapInsets.apply(loadingBar, arguments);
			};
			loadingBar.setContentSize = function (size, height) {
				state.contentSize = typeof size === 'object' ? size : cc.size(size, height || 0);
				return baseSetContentSize.apply(loadingBar, arguments);
			};
			loadingBar.setPercent = function (percent) {
				state.percent = percent;
				return baseSetPercent.apply(loadingBar, arguments);
			};

			res.awaitFrame(fileName, function () {
				loadingBar.setScale9Enabled = baseSetScale9Enabled;
				loadingBar.setCapInsets = baseSetCapInsets;
				loadingBar.setContentSize = baseSetContentSize;
				loadingBar.setPercent = baseSetPercent;
				baseLoadingBarLoadTexture.call(loadingBar, fileName, texType);
				if (state.scale9Enabled !== undefined) {
					baseSetScale9Enabled.call(loadingBar, state.scale9Enabled);
				}
				if (state.capInsets) baseSetCapInsets.call(loadingBar, state.capInsets);
				if (state.contentSize) baseSetContentSize.call(loadingBar, state.contentSize);
				if (state.percent !== undefined) baseSetPercent.call(loadingBar, state.percent);
			});
		};
	}

	global.jdzcEngineReady = true;
})(window);
