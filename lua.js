/* lua.js -- the Lua 5.1 (wasm) <-> JavaScript bridge.
 *
 * The game is 413 untouched Lua modules that expect the cocos2d-x 3.3 Lua
 * bindings. Here the engine is cocos2d-html5 instead, so every engine call
 * has to cross into JS. The crossing happens in one place: the Lua global
 * `__jsb(op, ...)`, a C function that hands the lua_State straight to
 * `Module.jsbDispatch`, which reads and writes the Lua stack through the
 * exported lua_* API. All marshalling therefore lives here, in JS.
 *
 * Lua sees a JS object as a proxy *table* (see lua/bridge.lua):
 * `{__h = handle, __cls = "Sprite"}` with an __index that turns an unknown
 * key into a bound method -- but only when JS confirms the key really is a
 * method, so `if node._foo then` still reads nil the way the game expects.
 */
(function (global) {
	'use strict';

	var T_NIL = 0, T_BOOLEAN = 1, T_LIGHTUSERDATA = 2, T_NUMBER = 3,
	    T_STRING = 4, T_TABLE = 5, T_FUNCTION = 6, T_USERDATA = 7;
	var GLOBALSINDEX = -10002;

	/* op codes, mirrored in lua/bridge.lua */
	var OP_STATIC   = 1,  /* __jsb(1, "cc.Sprite", "create", ...)    */
	    OP_CALL     = 2,  /* __jsb(2, handle, "setPosition", ...)    */
	    OP_MEMBER   = 3,  /* __jsb(3, handle, "key") -> "f" | nil    */
	    OP_RELEASE  = 4,  /* __jsb(4, handle)                        */
	    OP_GET      = 5,  /* __jsb(5, "cc.PLATFORM_OS_WINDOWS")      */
	    OP_INDEX    = 6,  /* __jsb(6, handle, "key") -> value        */
	    OP_SETINDEX = 7,  /* __jsb(7, handle, "key", value)          */
	    OP_BINCALL  = 8,  /* like OP_CALL, but strings are raw bytes */
	    OP_ALIVE    = 9;  /* __jsb(9, handle) -> is the object still there */

	/* Methods whose Lua binding returns a pair of numbers where html5
	 * returns a point object. */
	var PAIR_RETURNS = { getPosition: true };

	/* The scene lifecycle is not part of the Lua binding surface: the game
	 * reaches it through registerScriptHandler, and its handlers test
	 * `if widget.onEnter then widget:onEnter() end` meaning a method the Lua
	 * class defined. If the engine's own onEnter answered that test, the
	 * handler would call the method that called it -- straight into a stack
	 * overflow the first time any widget enters. */
	var HIDDEN_MEMBERS = {
		onEnter: true,
		onExit: true,
		onEnterTransitionDidFinish: true,
		onExitTransitionDidStart: true,
		cleanup: true,
	};

	function Lua(Module) {
		this.M = Module;
		this.L = Module._jdzc_open();

		this.objects = new Map();      /* handle -> js value (a node: WeakRef) */
		this.handles = new WeakMap();  /* js object -> handle       */
		this.nextHandle = 1;
		this.classSeq = 0;
		this.reportedMembers = {};
		/* A Lua function handed to JS is pinned in the Lua registry. It used
		 * to stay pinned for good (a Map kept every wrapper), and with it
		 * every node its upvalues reached: a button's handler holds the
		 * button, JS holds the handler, so no scene the player ever opened
		 * was freed -- the heap grew with every screen until iOS killed the
		 * tab. Now the ref goes back when the JS wrapper is collected. */
		var M0 = Module, self0 = this;
		this.dropRef = typeof FinalizationRegistry === 'function'
			? new FinalizationRegistry(function (ref) { M0._jdzc_unref(self0.L, ref); })
			: null;
		this.callbacks = this.dropRef ? null : new Map();
		/* The Lua proxy of a live node is pinned in the registry until the
		 * node itself is collected. The game hangs fields off engine objects
		 * (`layout._item = thumbnail`) and they live on the proxy table; with
		 * the proxy weak, a Lua GC dropped them while the node lived on, the
		 * next lookup handed back a fresh empty proxy, and code reading the
		 * field got nil -- the deck screen's releaseToopList then returned
		 * nothing to the CardThumbnail pool, which grew by 80 thumbnails
		 * (~21 MB) every few visits. tolua keeps a userdata and its peer for
		 * exactly as long as the C++ object, which is what this does. Nodes
		 * are weak on the JS side, so the pin is no cycle. */
		this.pinProxy = this.dropRef
			? new FinalizationRegistry(function (ref) { M0._jdzc_unref(self0.L, ref); })
			: null;
		this.deadCalls = 0;
		this.newproxyRef = 0;          /* lua ref of __jsb_newproxy */
		this.utf8 = new TextDecoder('utf-8');
		this._cstrs = {};

		var self = this;
		Module.jsbDispatch = function (L) { return self.dispatch(L); };
	}

	/* ------------------------------------------------------------------ *
	 * raw stack helpers
	 * ------------------------------------------------------------------ */

	Lua.prototype.type = function (i) { return this.M._lua_type(this.L, i); };
	Lua.prototype.top = function () { return this.M._lua_gettop(this.L); };
	Lua.prototype.pop = function (n) { this.M._lua_settop(this.L, -n - 1); };

	/* a cache of C strings for literal keys, so hot paths do not malloc */
	Lua.prototype.cstr = function (s) {
		if (this._cstrs[s] === undefined) {
			var M = this.M;
			var n = M.lengthBytesUTF8(s);
			var p = M._malloc(n + 1);
			M.stringToUTF8(s, p, n + 1);
			this._cstrs[s] = p;
		}
		return this._cstrs[s];
	};

	Lua.prototype.toBytes = function (i) {
		var M = this.M;
		var lenPtr = M._malloc(4);
		var p = M._jdzc_tostring(this.L, i, lenPtr);
		var len = M.HEAPU32[lenPtr >> 2];
		M._free(lenPtr);
		if (!p) return null;
		return M.HEAPU8.slice(p, p + len);
	};

	Lua.prototype.toStr = function (i) {
		var b = this.toBytes(i);
		return b === null ? null : this.utf8.decode(b);
	};

	Lua.prototype.pushBytes = function (bytes) {
		var M = this.M;
		var p = M._malloc(bytes.length || 1);
		M.HEAPU8.set(bytes, p);
		M._jdzc_pushlstring(this.L, p, bytes.length);
		M._free(p);
	};

	Lua.prototype.pushStr = function (s) {
		var M = this.M;
		var n = M.lengthBytesUTF8(s);
		var p = M._malloc(n + 1);
		M.stringToUTF8(s, p, n + 1);
		M._jdzc_pushlstring(this.L, p, n);
		M._free(p);
	};

	/* ------------------------------------------------------------------ *
	 * handles: a JS object as seen from Lua
	 * ------------------------------------------------------------------ */

	/* A cocos node is held weakly. On the device a node lives while it is in
	 * the scene graph or retained, whatever Lua still points at (tolua does
	 * not retain); html5 kept it alive for as long as any Lua table did, and
	 * the game keeps dead widgets in module locals and fields everywhere,
	 * because natively that costs nothing. Here the scene graph (children
	 * arrays) and retain() (engine.js) are what keep a node, as on the
	 * device; everything else -- actions, listeners, textures -- stays held. */
	var WEAK = typeof WeakRef === 'function';
	function isNode(obj) {
		return WEAK && global.cc && global.cc.Node && obj instanceof global.cc.Node;
	}

	Lua.prototype.handleOf = function (obj) {
		var h = this.handles.get(obj);
		if (h === undefined) {
			h = this.nextHandle++;
			this.handles.set(obj, h);
			this.objects.set(h, isNode(obj) ? new WeakRef(obj) : obj);
		}
		return h;
	};

	Lua.prototype.get = function (h) {
		var v = this.objects.get(h);
		return (WEAK && v instanceof WeakRef) ? v.deref() : v;
	};

	/* The name is the key of the per-class method cache in bridge.lua, so it
	 * has to be unique per class. It cannot come from constructor.name:
	 * every class cocos2d-html5 builds with cc.Class.extend is called
	 * "Class", and every class object seen from Lua is a "Function", so the
	 * cache would answer for cc.Sprite with what it learned about cc.Node.
	 * Stamp each constructor with an id of its own instead -- as an own
	 * property, since a subclass inherits its parent's statics. */
	Lua.prototype.classNameOf = function (obj) {
		var owner = typeof obj === 'function' ? obj : obj.constructor;
		if (!owner) return 'Object';

		if (!Object.prototype.hasOwnProperty.call(owner, '__jsbName')) {
			owner.__jsbName = (owner.name || 'Class') + '#' + (++this.classSeq);
		}
		return owner.__jsbName;
	};

	/* push the Lua proxy table for a JS object, reusing the live one */
	Lua.prototype.pushProxy = function (obj) {
		var M = this.M, L = this.L;
		var fresh = this.pinProxy && isNode(obj) && this.handles.get(obj) === undefined;
		M._jdzc_getref(L, this.newproxyRef);
		M._lua_pushnumber(L, this.handleOf(obj));
		this.pushStr(this.classNameOf(obj));
		if (M._lua_pcall(L, 2, 1, 0) !== 0) {
			var err = this.toStr(-1);
			this.pop(1);
			throw new Error('newproxy failed: ' + err);
		}
		if (fresh) {
			M._lua_pushvalue(L, -1);
			this.pinProxy.register(obj, M._jdzc_ref(L));
		}
	};

	/* ------------------------------------------------------------------ *
	 * marshalling
	 * ------------------------------------------------------------------ */

	Lua.prototype.toJS = function (i, binary) {
		var M = this.M, L = this.L, t = this.type(i);

		switch (t) {
		case T_NIL: return null;
		case T_BOOLEAN: return !!M._lua_toboolean(L, i);
		case T_NUMBER: return M._lua_tonumber(L, i);
		case T_STRING: return binary ? this.toBytes(i) : this.toStr(i);
		case T_FUNCTION: return this.wrapLuaFunction(i);
		case T_TABLE: return this.tableToJS(i, binary);
		case T_LIGHTUSERDATA:
		case T_USERDATA: return M._lua_touserdata(L, i);
		default: return null;
		}
	};

	Lua.prototype.tableToJS = function (i, binary) {
		var M = this.M, L = this.L;

		if (i < 0) i = this.top() + i + 1;

		/* a proxy table stands for the JS object it wraps */
		M._lua_pushstring(L, this.cstr('__h'));
		M._lua_rawget(L, i);
		if (this.type(-1) === T_NUMBER) {
			var h = M._lua_tonumber(L, -1);
			this.pop(1);
			return this.get(h);
		}
		this.pop(1);

		/* plain table: an array when 1..n is dense, an object otherwise */
		var n = M._lua_objlen(L, i);
		var out, k;
		if (n > 0) {
			out = [];
			for (k = 1; k <= n; k++) {
				M._lua_rawgeti(L, i, k);
				out.push(this.toJS(-1, binary));
				this.pop(1);
			}
			return out;
		}

		out = {};
		M._lua_pushnil(L);
		while (M._lua_next(L, i) !== 0) {
			/* key at -2, value at -1; never coerce the key in place, that
			 * would confuse lua_next */
			var kt = this.type(-2);
			var key = kt === T_NUMBER ? M._lua_tonumber(L, -2)
				: (kt === T_STRING ? this.toStr(-2) : null);
			if (key !== null) out[key] = this.toJS(-1, binary);
			this.pop(1);
		}
		return out;
	};

	/* Does this JS object stand for data or for a live object? cc.p,
	 * cc.size, cc.rect and cc.color are object literals of numbers and the
	 * game reads .x / .width straight off them, so they cross as tables.
	 * Anything carrying a method -- a namespace, a singleton, a node --
	 * crosses as a handle instead. */
	function isPlainData(v) {
		var isLiteral = v.constructor === Object ||
			(global.cc && global.cc.Color && v instanceof global.cc.Color);
		if (!isLiteral && !v.__plain) return false;

		var keys = Object.keys(v);
		for (var i = 0; i < keys.length; i++)
			if (typeof v[keys[i]] === 'function') return false;
		return true;
	}

	Lua.prototype.push = function (v) {
		var M = this.M, L = this.L, i;

		if (v === null || v === undefined) { M._lua_pushnil(L); return; }

		switch (typeof v) {
		case 'number': M._lua_pushnumber(L, v); return;
		case 'boolean': M._lua_pushboolean(L, v ? 1 : 0); return;
		case 'string': this.pushStr(v); return;
		}

		if (v instanceof Uint8Array) { this.pushBytes(v); return; }

		if (v.__luaRef !== undefined) {   /* a Lua function coming home */
			M._jdzc_getref(L, v.__luaRef);
			return;
		}
		if (typeof v === 'function') { this.pushProxy(v); return; }

		if (Array.isArray(v)) {
			M._lua_createtable(L, v.length, 0);
			for (i = 0; i < v.length; i++) {
				this.push(v[i]);
				M._lua_rawseti(L, -2, i + 1);
			}
			return;
		}
		/* cc.p / cc.size / cc.rect are plain object literals in html5 and
		 * plain tables in the Lua bindings -- the game reads .x / .width
		 * off them constantly, so they must cross as data, not as a
		 * handle. cc.Color is the same idea with a constructor. */
		if (isPlainData(v)) {
			var keys = Object.keys(v);
			M._lua_createtable(L, 0, keys.length);
			for (i = 0; i < keys.length; i++) {
				if (keys[i] === '__plain') continue;
				this.pushStr(keys[i]);
				this.push(v[keys[i]]);
				M._lua_rawset(L, -3);
			}
			return;
		}
		this.pushProxy(v);
	};

	/* ------------------------------------------------------------------ *
	 * Lua functions called from JS (touch handlers, scheduler, ...)
	 * ------------------------------------------------------------------ */

	Lua.prototype.wrapLuaFunction = function (i) {
		var M = this.M, L = this.L, self = this;

		M._lua_pushvalue(L, i);
		var ref = M._jdzc_ref(L);

		var fn = function () {
			return self.callRef(ref, Array.prototype.slice.call(arguments));
		};
		fn.__luaRef = ref;
		if (this.dropRef) this.dropRef.register(fn, ref);
		else this.callbacks.set(ref, fn);
		return fn;
	};

	Lua.prototype.callRef = function (ref, args) {
		var M = this.M, L = this.L;
		var base = this.top();
		var errIdx = M._jdzc_push_traceback(L);

		M._jdzc_getref(L, ref);
		for (var i = 0; i < args.length; i++) this.push(args[i]);

		if (M._lua_pcall(L, args.length, 1, errIdx) !== 0) {
			var msg = this.toStr(-1);
			M._lua_settop(L, base);
			if (global.jdzcOnLuaError) global.jdzcOnLuaError(msg);
			else console.error('[lua] ' + msg);
			return null;
		}
		var out = this.toJS(-1);
		M._lua_settop(L, base);
		return out;
	};

	/* ------------------------------------------------------------------ *
	 * __jsb dispatch
	 * ------------------------------------------------------------------ */

	Lua.prototype.args = function (from, binary) {
		var out = [], n = this.top();
		for (var i = from; i <= n; i++) out.push(this.toJS(i, binary));
		return out;
	};

	Lua.prototype.resolve = function (path) {
		var parts = path.split('.'), o = global;
		for (var i = 0; i < parts.length && o != null; i++) o = o[parts[i]];
		return o;
	};

	Lua.prototype.dispatch = function () {
		var M = this.M, L = this.L;
		var op = M._lua_tonumber(L, 1);

		try {
			switch (op) {
			case OP_STATIC: {
				var path = this.toStr(2), name = this.toStr(3);
				var cls = this.resolve(path);
				if (!cls) throw new Error('no such class: ' + path);
				var fn = cls[name];
				if (typeof fn !== 'function')
					throw new Error(path + '.' + name + ' is not a function');
				/* a static call arrives as cls:create(...): arg 4 is the
				 * class table itself, so the real arguments start at 5 */
				var r = fn.apply(cls, this.args(5));
				if (r === undefined) return 0;
				this.push(r);
				return 1;
			}
			case OP_CALL:
			case OP_BINCALL: {
				var bin = op === OP_BINCALL;
				var h = M._lua_tonumber(L, 2), mname = this.toStr(3);
				var obj = this.get(h);
				if (!obj) {
					/* a node the device would already have freed: natively
					 * a release build crashes here, tolua.isnull is how the
					 * game is meant to avoid it. Answer nil instead. */
					if (this.deadCalls++ < 20)
						console.warn('[jsb] call on a freed node: ' + mname);
					return 0;
				}
				var m = obj[mname];
				if (typeof m !== 'function')
					throw new Error(this.classNameOf(obj) + ':' + mname +
							' is not a function');
				var res = m.apply(obj, this.args(5, bin));
				if (res === undefined) return 0;

				/* node:getPosition() is one of the few bindings that hands
				 * back two numbers instead of a point, and the game reads it
				 * as `local x, y = node:getPosition()`. */
				if (PAIR_RETURNS[mname] && res !== null &&
				    typeof res === 'object' && 'x' in res && 'y' in res) {
					M._lua_pushnumber(L, res.x);
					M._lua_pushnumber(L, res.y);
					return 2;
				}

				this.push(res);
				return 1;
			}
			case OP_MEMBER: {
				var oh = M._lua_tonumber(L, 2), key = this.toStr(3);
				var o = this.get(oh);
				if (!o) return 0;
				if (HIDDEN_MEMBERS[key]) return 0;
				if (typeof o[key] === 'function') { this.pushStr('f'); return 1; }

				/* A name shaped like a method that no class here has is a
				 * gap in the port, not a field the game is testing for.
				 * Report each one once so a single run lists them all
				 * instead of failing on one per run. */
				if (global.JDZC_TRACE_MEMBERS && /^[a-z][A-Za-z0-9]*$/.test(key) &&
				    !this.reportedMembers[key]) {
					this.reportedMembers[key] = true;
					console.log('[jsb] no such method: ' +
						this.classNameOf(o) + ':' + key);
				}
				return 0;
			}
			case OP_RELEASE: {
				var rh = M._lua_tonumber(L, 2);
				var ro = this.get(rh);
				if (ro) this.handles.delete(ro);
				this.objects.delete(rh);
				return 0;
			}
			case OP_ALIVE: {
				M._lua_pushboolean(L, this.get(M._lua_tonumber(L, 2)) ? 1 : 0);
				return 1;
			}
			case OP_GET: {
				var v = this.resolve(this.toStr(2));
				if (v === undefined) return 0;
				this.push(v);
				return 1;
			}
			case OP_INDEX: {
				var ih = M._lua_tonumber(L, 2);
				var io = this.get(ih);
				if (!io) return 0;
				this.push(io[this.toStr(3)]);
				return 1;
			}
			case OP_SETINDEX: {
				var sh = M._lua_tonumber(L, 2);
				var so = this.get(sh);
				if (so) so[this.toStr(3)] = this.toJS(4);
				return 0;
			}
			}
			throw new Error('unknown jsb op ' + op);
		} catch (e) {
			/* surface it as a Lua error so __G__TRACKBACK__ reports it */
			this.pushStr('[jsb] ' + (e && e.stack ? e.stack : e));
			return M._lua_error(L);
		}
	};

	/* ------------------------------------------------------------------ *
	 * running code
	 * ------------------------------------------------------------------ */

	Lua.prototype.run = function (src, name) {
		var M = this.M, L = this.L;
		var base = this.top();
		var errIdx = M._jdzc_push_traceback(L);

		var n = M.lengthBytesUTF8(src);
		var p = M._malloc(n + 1);
		M.stringToUTF8(src, p, n + 1);
		var rc = M._jdzc_loadbuffer(L, p, n, this.cstr('@' + (name || 'chunk')));
		M._free(p);

		if (rc !== 0) {
			var e = this.toStr(-1);
			M._lua_settop(L, base);
			throw new Error(e);
		}
		if (M._lua_pcall(L, 0, 1, errIdx) !== 0) {
			var e2 = this.toStr(-1);
			M._lua_settop(L, base);
			throw new Error(e2);
		}
		var out = this.toJS(-1);
		M._lua_settop(L, base);
		return out;
	};

	Lua.prototype.setGlobal = function (name, value) {
		this.push(value);
		this.M._lua_setfield(this.L, GLOBALSINDEX, this.cstr(name));
	};

	Lua.prototype.getGlobalRef = function (name) {
		this.M._lua_getfield(this.L, GLOBALSINDEX, this.cstr(name));
		return this.M._jdzc_ref(this.L);
	};

	global.JdzcLua = Lua;
})(typeof window !== 'undefined' ? window : globalThis);
