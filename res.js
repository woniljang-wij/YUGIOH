/* res.js -- the H5 client's resource layer.
 *
 * The Android build packs the art into `.lcres` containers; the source tree
 * keeps those containers unpacked as directories, and the web client fetches
 * the loose files straight out of them. Nothing is converted offline:
 *
 *   .jpm      "JPM\1" + two lengths + a JPEG (colour) + a PNG (alpha mask).
 *             Composited into a canvas and cached as a cc.Texture2D.
 *   .png.sfb  the binary sprite-frame index for the atlas of the same name;
 *             turned into cc.SpriteFrames and put in cc.spriteFrameCache.
 *   .lan      the language table, handed back to ClientData.addLanguage.
 *   .bin      game data -- never read here, the tables come from the dumps.
 *
 * Loading is asynchronous, which the game already copes with: LoadingScene
 * drives the whole boot sequence off Data.Event.resource, loading the next
 * container each time one arrives. Every finished entry is reported back to
 * Lua through onEntry, which dispatches that event.
 */
(function (global) {
	'use strict';

	var R = {
		manifest: null,
		base: 'res/',
		/* Everything under res/ is served with cache-control: max-age=604800,
		 * which is right for the 495 MB of art that never changes and wrong
		 * for the one file that does: the language table. It is fetched below
		 * by name, with nothing to distinguish one revision from the next, so
		 * a player who booted before a translation went up keeps reading the
		 * old one for a week. Keyed to the release version, which
		 * tools/release.py bumps in index.html every time it ships a new
		 * lan.lcres -- a hand-kept date here was forgotten once already. */
		langVersion: '20260918b-' + ((global.JDZC_CONFIG && global.JDZC_CONFIG.version) || ''),
		onEntry: null,          /* lua: dispatches Data.Event.resource     */
		loaded: {},             /* container path -> true                  */
		inflight: {},           /* container path -> true                  */
		frameOwner: {},         /* sfb entry name -> texture key           */
		frameWaiters: {},       /* frame name -> callbacks while atlas loads */
		framesOf: {},           /* sfb entry name -> the frames it registered */
		frameContainer: {},     /* frame name -> the container that registers it */
	};

	/* Is this container's art actually still in the sprite-frame cache?
	 *
	 * R.loaded is set once, when a container's entries land, and until now
	 * nothing ever took it back -- so anything that drops frames without
	 * going through unloadContainer left it lying. Two of those are routine:
	 * Lua's FrameCache:removeSpriteFrames() wipes the whole cache while every
	 * container that is not in the same unload list stays "loaded", and a
	 * .sfb whose fetch fails is swallowed by its own catch, so the container
	 * is marked complete with no frames at all.
	 *
	 * A container that is only re-announced hands back a container with no
	 * art: every nine-slice built from it has no sprite frame and draws
	 * nothing, which is what turns a dialog's frame box transparent with
	 * nothing inside it. Checking costs one hash lookup per frame, only on
	 * the already-loaded path.
	 */
	R.framesMissing = function (path) {
		var entries = R.entriesOf(path) || [];
		for (var i = 0; i < entries.length; i++) {
			if (!/\.sfb$/.test(entries[i])) continue;
			var names = R.framesOf[entries[i]];
			if (!names || !names.length) return true;
			for (var j = 0; j < names.length; j++) {
				/* registered-but-undrawable counts as missing too: a frame
				 * whose texture was evicted is no more use to a node than one
				 * that was never registered, and the refetch below is what puts
				 * the texture back under it (see frameDrawable). */
				if (!frameDrawable(cc.spriteFrameCache.getSpriteFrame(names[j])))
					return true;   /* one miss is enough, and keeps the log quiet */
			}
		}
		return false;
	};

	/* ------------------------------------------------------------------ *
	 * container listing
	 * ------------------------------------------------------------------ */

	R.init = function (manifest, base) {
		R.manifest = manifest;
		if (base) R.base = base;
	};

	/* entry name -> container path, filled in by loadContainer */
	R.containerOf = {};

	R.entriesOf = function (path) {
		var direct = R.manifest.containers[path];
		if (direct) return direct;

		/* thumbnails follow one convention: <dir>/<id>.lcres/<id>.jpg */
		var m = /^res\/([a-z_]+)\/([0-9_]+)\.lcres$/.exec(path);
		if (m) {
			var ids = R.manifest.thumbs[m[1]];
			if (ids && ids.indexOf(m[2]) >= 0) return [m[2] + '.jpg'];
		}
		return null;
	};

	/* ------------------------------------------------------------------ *
	 * .jpm -- JPEG colour plane + PNG alpha plane
	 * ------------------------------------------------------------------ */

	function splitJpm(buf) {
		var v = new DataView(buf);
		if (v.getUint8(0) !== 0x4a || v.getUint8(1) !== 0x50 ||
		    v.getUint8(2) !== 0x4d)
			throw new Error('not a .jpm');
		var jpegLen = v.getUint32(4, true), maskLen = v.getUint32(8, true);
		return [
			new Blob([new Uint8Array(buf, 12, jpegLen)], { type: 'image/jpeg' }),
			new Blob([new Uint8Array(buf, 12 + jpegLen, maskLen)], { type: 'image/png' }),
		];
	}

	/* At most two atlases decoding and compositing at once.
	 *
	 * One 2048x2048 .jpm costs ~80 MB while it is being built -- the decoded
	 * JPEG and PNG, the canvas, and the two getImageData copies composite()
	 * reads -- and the game asks for a whole batch of containers in one go
	 * (every cards_img_N at login). Run in parallel, that transient peak alone
	 * got past what iOS lets a tab have, and the page was killed and reloaded
	 * mid-load. Queued, the peak is two atlases, and the total time is the
	 * same: compositing is main-thread work either way. */
	var atlasSlots = 2, atlasQueue = [];
	function withAtlasSlot(task) {
		return new Promise(function (resolve, reject) {
			function run() {
				atlasSlots--;
				var done = function () {
					atlasSlots++;
					if (atlasQueue.length) atlasQueue.shift()();
				};
				Promise.resolve().then(task).then(function (v) { done(); resolve(v); },
								 function (e) { done(); reject(e); });
			}
			if (atlasSlots > 0) run(); else atlasQueue.push(run);
		});
	}

	/* A decoded <img> keeps its pixels until the element is collected; drop
	 * them as soon as composite() has copied what it needs. */
	function forget(imgs) {
		for (var i = 0; i < imgs.length; i++) {
			if (imgs[i]) { imgs[i].onload = imgs[i].onerror = null; imgs[i].src = ''; }
		}
	}

	function loadBlob(blob) {
		return new Promise(function (resolve, reject) {
			var url = URL.createObjectURL(blob);
			var img = new Image();
			img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
			img.onerror = function (e) { URL.revokeObjectURL(url); reject(e); };
			img.src = url;
		});
	}

	/* The mask carries its coverage in luminance, not in alpha, so the two
	 * planes have to be merged per pixel. ponytail: a plain JS loop, ~15ms
	 * for a 2048x2048 atlas; move it to a GL pass if atlas loads ever show
	 * up as a hitch. */
	function composite(colour, mask) {
		var w = colour.width, h = colour.height;
		var canvas = document.createElement('canvas');
		canvas.__jdzcOwned = true;   /* freed once on the GPU, see engine.js */
		canvas.width = w;
		canvas.height = h;

		var ctx = canvas.getContext('2d', { willReadFrequently: true });
		ctx.drawImage(colour, 0, 0);
		var out = ctx.getImageData(0, 0, w, h);

		ctx.clearRect(0, 0, w, h);
		ctx.drawImage(mask, 0, 0, w, h);
		var alpha = ctx.getImageData(0, 0, w, h);

		var d = out.data, a = alpha.data;
		for (var i = 0, n = d.length; i < n; i += 4) {
			var alphaVal = a[i];
			d[i] = (d[i] * alphaVal) / 255;
			d[i + 1] = (d[i + 1] * alphaVal) / 255;
			d[i + 2] = (d[i + 2] * alphaVal) / 255;
			d[i + 3] = alphaVal;
		}

		ctx.putImageData(out, 0, 0);
		return canvas;
	}

	/* ------------------------------------------------------------------ *
	 * .sfb -- the binary sprite frame index
	 *
	 *   uint32 count, then per frame:
	 *     uint8 name length (with the NUL), name bytes,
	 *     uint16 x, y, w, h; uint8 rotated; int16 offX, offY;
	 *     uint16 originalW, originalH
	 * ------------------------------------------------------------------ */

	function parseSfb(buf) {
		var v = new DataView(buf), u8 = new Uint8Array(buf);
		var count = v.getUint32(0, true), off = 4, frames = [];
		var dec = new TextDecoder('utf-8');

		for (var i = 0; i < count; i++) {
			var n = v.getUint8(off);
			var name = dec.decode(u8.subarray(off + 1, off + n));
			off += 1 + n;
			frames.push({
				name: name,
				x: v.getUint16(off, true),
				y: v.getUint16(off + 2, true),
				w: v.getUint16(off + 4, true),
				h: v.getUint16(off + 6, true),
				rotated: v.getUint8(off + 8) !== 0,
				ox: v.getInt16(off + 9, true),
				oy: v.getInt16(off + 11, true),
				ow: v.getUint16(off + 13, true),
				oh: v.getUint16(off + 15, true),
			});
			off += 17;
		}
		return frames;
	}

	function addFrames(frames, texture, owner) {
		for (var i = 0; i < frames.length; i++) {
			var f = frames[i];
			/* Keep the packed atlas footprint as recorded in the SFB. Cocos'
			 * WebGL sprite path uses the rotated flag to swap the UV axes; doing
			 * that here as well samples the adjacent atlas entry. Canvas' own
			 * rotated-frame path performs the same conversion when needed. */
			var rect = cc.rect(f.x, f.y, f.w, f.h);
			var frame = new cc.SpriteFrame(texture, rect, f.rotated,
						       cc.p(f.ox, f.oy),
						       cc.size(f.ow, f.oh));
			cc.spriteFrameCache.addSpriteFrame(frame, f.name);
			if (owner) {
				(R.framesOf[owner] || (R.framesOf[owner] = [])).push(f.name);
				/* Which container would have this frame, kept even after the
				 * container is unloaded -- see awaitFrame. */
				var belongs = R.containerOf[owner];
				if (belongs) R.frameContainer[f.name] = belongs;
			}
			R.resolveFrame(f.name, frame);
		}
	}

	/* Frames are the one resource type that cannot share the texture's
	 * asynchronous update path. A Sprite created from a frame name holds a
	 * SpriteFrame object, not the atlas texture, so replacing a temporary
	 * texture never changes that sprite. Keep the short-lived wait list here
	 * and hand each already-created node the actual frame as soon as its .sfb
	 * index is registered. */
	/* A frame is usable only once its atlas pixels are actually there.
	 *
	 * Every "is it loaded?" test here used to ask whether the frame *object*
	 * was registered, and a frame outlives its pixels: an atlas a scene evicted
	 * (unloadLCRes), a container re-loaded while its .jpm fetch failed, a
	 * masked texture whose planes never landed -- each leaves a full set of
	 * frames in cc.spriteFrameCache pointing at a texture whose isLoaded() is
	 * false. Handed one of those, ccui.Scale9Sprite takes the not-loaded branch
	 * of updateWithSprite (UIScale9Sprite.js:866): it hides itself, returns
	 * early and never sets _originalSize. The node is invisible for the rest of
	 * the session -- the dialog frame box and its grey fill that go transparent
	 * some turns in, with the content still laid out and still tappable.
	 *
	 * A frame whose pixels are gone is as good as absent, so answer the same
	 * way for both and let the caller's wait path refetch the container. */
	function frameDrawable(frame) {
		if (!frame) return false;
		if (typeof frame.isJdzcBlank === 'function' &&
		    frame.isJdzcBlank()) return false;
		var tex = frame.getTexture ? frame.getTexture() : null;
		/* not a cocos frame: nothing to check, assume present */
		if (!tex || typeof tex.isLoaded !== 'function') return true;
		return tex.isLoaded();
	}

	R.isDrawableFrame = frameDrawable;

	function isBlankFrame(frame) {
		return !frameDrawable(frame);
	}

	R.awaitFrame = function (name, callback) {
		var frame = cc.spriteFrameCache.getSpriteFrame(name);
		if (!isBlankFrame(frame)) {
			callback(frame);
			return;
		}
		var waiters = R.frameWaiters[name] || (R.frameWaiters[name] = []);
		if (waiters.indexOf(callback) < 0) waiters.push(callback);
		/* Nothing wants this frame, but something may be lying: a container
		 * marked loaded whose frames were dropped under it. Reload whatever
		 * is, so the node waiting here fills in now instead of at the next
		 * scene that happens to ask for that container again. Cheap -- the
		 * sweep only runs on a frame that really is missing. */
		/* The sweep only sees containers still in R.loaded. One that was
		 * unloaded outright is gone from it, and Lua's own bookkeeping still
		 * says its art is there, so nobody ever asks again and the node waits
		 * for a frame no one will fetch -- a frame box with no background
		 * for the rest of the session. Go straight to the container that
		 * registers this frame. */
		var source = R.frameContainer[name];
		/* loadContainer hands back the load already in flight, so asking again
		 * costs nothing -- and gating on R.inflight here was the only thing
		 * standing between a stalled load and its waiters: a container whose
		 * fetch never settled stayed "in flight", the sweep below never saw it
		 * (R.loaded is false, so framesMissing is never consulted) and every
		 * node waiting on its frames waited for the rest of the session. */
		if (source) R.loadContainer(source);
		for (var path in R.loaded) {
			if (R.framesMissing(path)) R.loadContainer(path);
		}
	};

	R.resolveFrame = function (name, frame) {
		var waiters = R.frameWaiters[name];
		if (!waiters) return;
		delete R.frameWaiters[name];
		for (var i = 0; i < waiters.length; i++) waiters[i](frame);
	};

	/* Register a decoded image under a container-entry name.
	 *
	 * The game asks for an entry's texture in the same breath as it asks for
	 * the container, so engine.js will already have handed out an empty
	 * cc.Texture2D under this name. Fill that object rather than replace it:
	 * whoever is holding it -- a CardSprite's frame, say -- gets the pixels
	 * and the "load" event that makes it redraw. */
	function cacheUnder(key, source) {
		var tex = cc.textureCache.getTextureForKey(key);
		var element = (source instanceof cc.Texture2D)
			? source.getHtmlElementObj() : source;

		if (!tex || tex.isLoaded() || !element) {
			cc.textureCache.cacheImage(key, source);
			return cc.textureCache.getTextureForKey(key);
		}

		tex.initWithElement(element);
		tex._textureLoaded = true;
		/* webgl uploads and dispatches; canvas sees itself as loaded and
		 * returns early, so nudge the listeners either way -- dispatchEvent
		 * clears them, so the second call is a no-op */
		tex.handleLoadedTexture();
		tex.dispatchEvent('load');
		R.resolvePending(key);
		return tex;
	}

	/* A texture that is standing in for one still downloading.
	 *
	 * No url: the renderer treats a rect wider than its texture as an error,
	 * and an empty one is zero by zero until the pixels land. Premultiplied,
	 * because that is what initWithElement will say once they do -- a sprite
	 * picks its blend function from the texture it is given and never looks
	 * again, so a placeholder that claims otherwise leaves every late-loading
	 * sprite blending the wrong way for the rest of the session. */
	function emptyTexture(key) {
		var tex = new cc.Texture2D();
		tex._hasPremultipliedAlpha = true;
		if (key && R.manifest && R.manifest.sizes) {
			var normalized = key.replace(/\.jpm$/, '.jpg');
			var size = R.manifest.sizes[key] ||
				   R.manifest.sizes[normalized] ||
				   R.manifest.sizes[key.replace(/^res\//, '')] ||
				   R.manifest.sizes[normalized.replace(/^res\//, '')] ||
				   R.manifest.sizes['res/' + key.replace(/^res\//, '')] ||
				   R.manifest.sizes['res/' + normalized.replace(/^res\//, '')];
			cc.log('[EMPTY_TEX]', key, 'size:', JSON.stringify(size));
			if (size && size[0] && size[1]) {
				tex._contentSize.width = size[0];
				tex._contentSize.height = size[1];
				tex._pixelsWide = size[0];
				tex._pixelsHigh = size[1];
				// Do NOT set _textureLoaded = true here, because when real pixels land,
				// cc.Texture2D needs to upload to WebGL and fire 'load' event.
			}
		}
		return tex;
	}

	R.emptyTexture = emptyTexture;

	function loadImage(url) {
		return new Promise(function (resolve, reject) {
			var img = new Image();
			img.onload = function () { resolve(img); };
			img.onerror = function () { reject(new Error('404 ' + url)); };
			img.src = url;
		});
	}

	/* A colour plane and an alpha mask kept as two files -- the .jpm split
	 * in two. The tree ships res/jpg/<n>.jpg beside <n>_mask.png, and a
	 * DragonBones atlas the same way: <n>.png is the mask for the colour in
	 * <n>_ori.jpg. Drawn without the merge the mask is a white silhouette
	 * across the screen, which is what the battle used to look like.
	 *
	 * The texture comes back straight away and empty, the way the device
	 * answered from memory; the pixels land in that same object. */
	var maskedInflight = {};

	/* Exposed so cache evictions (removeTextureForKey) can drop the stale
	 * marker -- a removed-then-re-requested key must fetch again, or it
	 * would answer an empty placeholder forever. */
	R.maskedInflight = maskedInflight;

	R.maskedTexture = function (key, colourUrl, maskUrl) {
		var tex = cc.textureCache.getTextureForKey(key);
		if (!tex) {
			tex = emptyTexture(key);
			cc.textureCache._textures[key] = tex;
		}
		if (tex.isLoaded() || maskedInflight[key]) return tex;

		maskedInflight[key] = withAtlasSlot(function () {
			return Promise.all([loadImage(colourUrl), loadImage(maskUrl)])
				.then(function (imgs) {
					var canvas = composite(imgs[0], imgs[1]);
					forget(imgs);
					return canvas;
				});
		})
			.then(function (canvas) {
				delete maskedInflight[key];
				cacheUnder(key, canvas);
			})
			.catch(function () {
				/* nothing beside it: the colour plane on its own */
				return loadImage(colourUrl).then(function (img) {
					delete maskedInflight[key];
					cacheUnder(key, img);
				}).catch(function (e) {
					delete maskedInflight[key];
					cc.log('[res] ' + key + ': ' + e);
				});
			});
		return tex;
	};

	/* ------------------------------------------------------------------ *
	 * fetching
	 * ------------------------------------------------------------------ */

	function fetchBuffer(url) {
		return fetch(url).then(function (r) {
			if (!r.ok) throw new Error(r.status + ' ' + url);
			return r.arrayBuffer();
		});
	}

	R.loadTexture = function (path) {
		/* a loose image: res/jpg/foo.jpg, res/particle/bar.png, ... */
		var tex = cc.textureCache.getTextureForKey(path);
		if (tex) return Promise.resolve(tex);
		return new Promise(function (resolve) {
			cc.textureCache.addImage(R.base + path.replace(/^res\//, ''),
						 function (t) { resolve(t); });
		});
	};

	/* Load one container. Resolves once every entry is in the caches; each
	 * entry is announced to Lua as it lands, which is what drives
	 * LoadingScene's chain. */
	R.loadContainer = function (path) {
		if (R.loaded[path] && !R.framesMissing(path)) {
			/* already resident: the game still expects the events */
			var names = R.entriesOf(path) || [];
			names.forEach(function (n) { R.announce(n); });
			return Promise.resolve(names);
		}
		/* loaded but empty-handed: fall through and load it again rather than
		 * re-announce a container whose frames are gone (see framesMissing). */
		delete R.loaded[path];
		if (R.inflight[path]) return R.inflight[path];

		var entries = R.entriesOf(path);
		if (!entries) {
			cc.log('[res] unknown container ' + path);
			return Promise.resolve([]);
		}
		/* remember which container owns each entry: unloadContainer needs it
		 * to mark this path stale, or a scene that unloads its art on exit
		 * would never see it again (the next load would only re-announce). */
		for (var ei = 0; ei < entries.length; ei++) R.containerOf[entries[ei]] = path;

		var dir = R.base + path.replace(/^res\//, '') + '/';
		var atlases = {};   /* base name -> texture */

		/* atlases first: the .sfb of a container needs its texture */
		var jpms = entries.filter(function (e) { return /\.jpm$/.test(e); });
		var rest = entries.filter(function (e) { return !/\.jpm$/.test(e); });

		var p = Promise.all(jpms.map(function (name) {
			return withAtlasSlot(function () {
				return fetchBuffer(dir + name).then(function (buf) {
					var parts = splitJpm(buf);
					return Promise.all([loadBlob(parts[0]), loadBlob(parts[1])]);
				}).then(function (imgs) {
					var canvas = composite(imgs[0], imgs[1]);
					forget(imgs);
					atlases[name.replace(/\.jpm$/, '')] = cacheUnder(name, canvas);
					R.resolvePending(name);
					R.announce(name);
				});
			}).catch(function (e) {
				cc.log('[res] ' + name + ': ' + e);
			});
		}));

		p = p.then(function () {
			return Promise.all(rest.map(function (name) {
				if (/\.sfb$/.test(name)) {
					var base = name.replace(/\.png\.sfb$/, '')
							.replace(/\.sfb$/, '');
					return fetchBuffer(dir + name).then(function (buf) {
						var tex = atlases[base]
							|| cc.textureCache.getTextureForKey(base + '.jpm');
						if (!tex) throw new Error('no atlas for ' + name);
						R.framesOf[name] = [];   /* a reload must not stack onto the old list */
						addFrames(parseSfb(buf), tex, name);
						R.frameOwner[name] = base + '.jpm';
						R.announce(name);
					}).catch(function (e) { cc.log('[res] ' + name + ': ' + e); });
				}
				if (/\.lan$/.test(name)) {
					/* Versioned like preloadLanguage above, and for the same
					 * reason: a browser holds res/** for a week, and this one
					 * runs later than the preload -- Lua asks for the
					 * container at boot -- so an unversioned URL here would
					 * put the table the player already had back on top of the
					 * new one (ClientData.addLanguage resets the table). */
					return fetch(dir + name + '?v=' + R.langVersion).then(function (r) { return r.text(); })
						.then(function (text) {
							/* ClientData.addLanguage splits the file on LF
							 * and then walks a quoted field until it finds
							 * the closing quote. With CRLF endings the last
							 * character of such a field is the CR, so that
							 * walk never terminates and the client hangs.
							 * The tree's extend.lan is CRLF: normalise it
							 * before handing it over. */
							text = text.split('\r').join('');
							if (R.onLanguage) R.onLanguage(text);
							R.announce(name);
						}).catch(function (e) { cc.log('[res] ' + name + ': ' + e); });
				}
				if (/\.(jpg|png)$/.test(name)) {
					return new Promise(function (resolve) {
						cc.textureCache.addImage(dir + name, function (tex) {
							/* the game addresses a container's images by
							 * entry name, not by URL */
							if (tex) cacheUnder(name, tex);
							R.resolvePending(name);
							R.announce(name);
							resolve();
						});
					});
				}
				return Promise.resolve();   /* .bin and friends: not used here */
			}));
		});

		R.inflight[path] = p.then(function () {
			/* Effect containers carry their atlas index in *_tex.bin rather
			 * than a normal .sfb. Let the engine expose those regions to the
			 * shared FrameCache as soon as the container is resident. */
			if (/^res\/effects\/[^/]+\.lcres$/.test(path) &&
				global.jdzcRegisterEffectFrames) {
				global.jdzcRegisterEffectFrames(path);
			}
			R.loaded[path] = true;
			delete R.inflight[path];
			return entries;
		});
		return R.inflight[path];
	};

	R.unloadContainer = function (name) {
		/* name is an entry name, the way ClientData.unloadLCRes passes it */
		if (/\.sfb$/.test(name)) {
			var key = R.frameOwner[name];
			var tex = key && cc.textureCache.getTextureForKey(key);
			if (tex) cc.spriteFrameCache.removeSpriteFramesFromTexture(tex);
			delete R.frameOwner[name];
		} else {
			cc.textureCache.removeTextureForKey(name);
		}
		/* The owning container must load again from scratch: its textures
		 * were just evicted, and a load that only re-announces would leave
		 * every sprite of the next visit on an empty placeholder. */
		var container = R.containerOf[name];
		if (container) delete R.loaded[container];
		delete maskedInflight[name];
		delete R.pending[name];
	};

	/* Bitmap fonts. cc.LabelBMFont wants the .fnt already parsed in
	 * cc.loader's cache and fails outright if it is not, and the game builds
	 * labels the moment a screen appears. There are seven of them; load them
	 * all before Lua starts, under the same paths the game names. */
	R.preloadFonts = function () {
		var fonts = R.manifest.files
			.filter(function (f) { return /\.fnt$/i.test(f); })
			.map(function (f) { return R.base + f.replace(/^res\//, ''); });

		return new Promise(function (resolve) {
			cc.loader.load(fonts, function () { resolve(fonts.length); });
		});
	};

	/* ------------------------------------------------------------------ *
	 * .pvr.ccz -- the updater's atlas
	 *
	 * RegionScene, the first screen, gets its art from res/updater: a
	 * TexturePacker plist over a .pvr.ccz. cocos2d-html5 knows neither
	 * format. The file turns out to be the easy case -- a zlib'd PVR v2
	 * holding plain RGBA8888 -- so it is decoded here and cached under the
	 * exact path the game asks for, before Lua starts, which also keeps
	 * cc.textureCache:addImage synchronous the way the game expects.
	 * ------------------------------------------------------------------ */

	function inflate(buf) {
		var stream = new Blob([buf]).stream()
			.pipeThrough(new DecompressionStream('deflate'));
		return new Response(stream).arrayBuffer();
	}

	function pvrToCanvas(raw) {
		var v = new DataView(raw);
		var headerLen = v.getUint32(0, true);
		var height = v.getUint32(4, true), width = v.getUint32(8, true);
		var bpp = v.getUint32(24, true);
		var tag = new Uint8Array(raw, 44, 4);

		if (String.fromCharCode.apply(null, tag) !== 'PVR!')
			throw new Error('not a PVR v2 container');
		if (bpp !== 32)
			throw new Error('unsupported PVR depth ' + bpp);

		var canvas = document.createElement('canvas');
		canvas.__jdzcOwned = true;   /* freed once on the GPU, see engine.js */
		canvas.width = width;
		canvas.height = height;

		var image = new ImageData(
			new Uint8ClampedArray(raw, headerLen, width * height * 4),
			width, height);
		canvas.getContext('2d').putImageData(image, 0, 0);
		return canvas;
	}

	R.preloadPvr = function () {
		var wanted = R.manifest.files.filter(function (f) {
			return /\.pvr\.ccz$/i.test(f);
		});

		return Promise.all(wanted.map(function (path) {
			return fetchBuffer(R.base + path.replace(/^res\//, ''))
				.then(function (ccz) { return inflate(ccz.slice(16)); })
				.then(function (raw) {
					cacheUnder(path, pvrToCanvas(raw));
				})
				.catch(function (e) { cc.log('[res] ' + path + ': ' + e); });
		})).then(function () { return wanted.length; });
	};

	/* ------------------------------------------------------------------ *
	 * data dumps and loose files
	 * ------------------------------------------------------------------ */

	R.setDumps = function (dumps) { R.dumps = dumps; };

	R.dump = function (name) {
		return (R.dumps && R.dumps[name]) || null;
	};

	R.exists = function (path) {
		if (!R.manifest) return false;
		/* a Set built once per manifest: indexOf scanned ~1900 names per call */
		if (R.manifest.__fileSet === undefined) R.manifest.__fileSet = new Set(R.manifest.files);
		if (R.manifest.__fileSet.has(path)) return true;
		var jpgPath = path.replace(/\.jpm$/, '.jpg');
		if (jpgPath !== path && R.manifest.__fileSet.has(jpgPath)) return true;
		return !!R.entriesOf(path);
	};

	R.textOf = function (path) {
		return R.texts ? (R.texts[path] || null) : null;
	};

	/* [width, height] of a loose image, known before it downloads */
	R.sizeOf = function (path) {
		if (!R.manifest || !R.manifest.sizes) return null;
		var norm = path.replace(/\.jpm$/, '.jpg');
		return R.manifest.sizes[path] || R.manifest.sizes[norm] ||
		       R.manifest.sizes[path.replace(/^res\//, '')] ||
		       R.manifest.sizes[norm.replace(/^res\//, '')] || null;
	};

	/* Small text resources the game reads synchronously (plists, bitmap font
	 * descriptors). There is no synchronous file IO in a browser, so they are
	 * fetched once at boot and answered from memory afterwards. */
	R.preloadTexts = function () {
		var wanted = R.manifest.files.filter(function (f) {
			return /\.(plist|fnt|csv|txt)$/i.test(f);
		});

		R.texts = {};
		return Promise.all(wanted.map(function (path) {
			return fetch(R.base + path.replace(/^res\//, ''))
				.then(function (r) { return r.ok ? r.text() : null; })
				.then(function (text) {
					/* the plists ship with a BOM, which the XML parser
					 * refuses */
					if (text) R.texts[path] = text.replace(/^\uFEFF/, '');
				})
				.catch(function () { /* optional */ });
		})).then(function () { return wanted.length; });
	};

	/* The language table.
	 *
	 * main.lua calls lc.App:loadRes("res/lan.lcres") as its very first act and
	 * then builds RegionScene, which reads Str(STR.VERSION) while doing it. On
	 * the device that load is synchronous -- the table is complete before the
	 * next line runs. Here it is a 4 MB fetch, so the first screen used to be
	 * built against an empty table: Str() returned nil, the version label threw
	 * "attempt to concatenate a nil value" out of RegionScene.init, and the
	 * scene came up with no children at all -- a black screen.
	 *
	 * So fetch it before Lua starts and hand it over the moment Lua registers
	 * its parser, which reproduces the device's ordering. */
	R.preloadLanguage = function () {
		var entries = (R.manifest.containers['res/lan.lcres'] || [])
			.filter(function (e) { return /\.lan$/i.test(e); });

		R.languageTexts = [];
		return Promise.all(entries.map(function (name) {
			return fetch(R.base + 'lan.lcres/' + name + '?v=' + R.langVersion)
				.then(function (r) { return r.ok ? r.text() : null; })
				.then(function (text) {
					if (!text) return;
					/* addLanguage splits on LF and then walks a quoted field
					 * to its closing quote; with CRLF the last character of
					 * such a field is the CR and the walk never ends. */
					R.languageTexts.push(text.split('\r').join(''));
				})
				.catch(function () { /* optional */ });
		})).then(function () { return entries.length; });
	};

	R.announce = function (name) {
		if (R.onEntry) R.onEntry(name);
	};

	/* ------------------------------------------------------------------ *
	 * sprites waiting for their art
	 *
	 * Each card thumbnail is its own container, and the game asks for the
	 * texture in the same breath as it asks for the load -- on the device
	 * that was one synchronous call. Here the sprite comes back empty and is
	 * filled in when its container lands, a moment later.
	 * ------------------------------------------------------------------ */

	R.pending = {};

	R.awaitTexture = function (key, sprite) {
		(R.pending[key] || (R.pending[key] = [])).push(sprite);
	};

	R.resolvePending = function (key) {
		var waiting = R.pending[key];
		if (!waiting) return;
		delete R.pending[key];

		var texture = cc.textureCache.getTextureForKey(key);
		if (!texture) return;

		for (var i = 0; i < waiting.length; i++) {
			global.jdzcAttachTexture(waiting[i], texture);
		}
	};

	/* called once from Lua: R.onEntry dispatches Data.Event.resource */
	R.setCallbacks = function (onEntry, onLanguage) {
		R.onEntry = onEntry;
		R.onLanguage = onLanguage;

		/* The language table was fetched before Lua existed. Give it to the
		 * parser now, in the order the device would have read it. */
		(R.languageTexts || []).forEach(function (text) { onLanguage(text); });
	};

	/* Lua asks for a container. The bytes arrive later, through onEntry,
	 * but the entry list itself is known from the manifest and some
	 * callers (main.lua's data.lcres pass) use it right away. */
	R.load = function (path) {
		var entries = R.entriesOf(path) || [];

		/* The device read a container off disk and had every texture in
		 * hand on the next line. Here the bytes are still on their way, so
		 * register an empty one per image now and let loadContainer fill
		 * it: ClientView.getCardImageName asks the cache for a card's art
		 * the moment it asks for the container, and falls back to card
		 * 10001's picture for anything the cache does not know -- which
		 * left every card in the game showing the same dragon. */
		entries.forEach(function (name) {
			if (/\.(jpg|png|jpm)$/.test(name) &&
			    !cc.textureCache.getTextureForKey(name)) {
				cc.textureCache._textures[name] = emptyTexture();
			}
		});

		R.loadContainer(path);
		return entries;
	};

	global.jdzcRes = R;
})(window);
