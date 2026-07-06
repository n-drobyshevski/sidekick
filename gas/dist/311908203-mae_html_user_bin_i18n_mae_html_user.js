(function() {
    /*

 Copyright The Closure Library Authors.
 SPDX-License-Identifier: Apache-2.0
*/
    /*

 Copyright Google LLC
 SPDX-License-Identifier: Apache-2.0
*/
    var aa = " cannot be cast to "
      , ca = "%s did not call super.disposeInternal()"
      , da = ", Size: "
      , ea = "Can't find variable: nc"
      , fa = "Edge"
      , ha = "Error in protected function: "
      , ia = "Failed due to circular reference."
      , ja = "Failed due to illegal value in property: "
      , ka = "Missing error cause."
      , la = "Not available"
      , na = "Not encoded with embedJspb."
      , oa = "Object"
      , pa = "SEVERE"
      , qa = "Symbol.dispose"
      , ra = "Symbol.iterator"
      , ta = "Unhandled "
      , ua = "WorkerGlobalScope"
      , va = "about:invalid#zClosurez"
      , wa = "apps_telemetry.cross_origin_scripts"
      , xa = "apps_telemetry.handling_error"
      , ya = "apps_telemetry.incoming_severity"
      , za = "apps_telemetry.native_function_tampering."
      , Aa = "apps_telemetry.outgoing_severity"
      , Ba = "apps_telemetry.processed"
      , Ca = "awesomium"
      , Da = "bigint"
      , Ea = "boolean"
      , Fa = "complete"
      , Ga = "destroyedStructure"
      , Ha = "error"
      , Ia = "fatal"
      , Ja = "fromIndex: "
      , k = "function"
      , La = "goog.Promise.then"
      , Ma = "incident"
      , Na = "injection-failed"
      , Oa = "jsaction"
      , Pa = "kaspersky-labs"
      , Qa = "knownMessageType"
      , Sa = "message"
      , Ta = "neurosurgeonundergo"
      , Ua = "non_function_type"
      , Va = "null"
      , n = "number"
      , q = "object"
      , Wa = "opt_onFulfilled should be a function."
      , Xa = "opt_onRejected should be a function. Did you pass opt_context as the second argument instead of the third?"
      , Za = "postmortem"
      , $a = "select-multiple"
      , ab = "severity"
      , bb = "severity-unprefixed"
      , u = "state is only maintained on arrays."
      , v = "string"
      , cb = "symbol"
      , db = "true"
      , eb = "uncaught error"
      , fb = "unhandledrejection"
      , gb = "unknown"
      , hb = "unknown type name"
      , ib = "warning"
      , jb = "warningafterdeath";
    function kb() {
        return function(a) {
            return a
        }
    }
    function lb() {
        return function() {}
    }
    function mb(a) {
        return function() {
            return this[a]
        }
    }
    function pb(a) {
        return function() {
            return a
        }
    }
    var x, qb = typeof Object.create == k ? Object.create : function(a) {
        function b() {}
        b.prototype = a;
        return new b
    }
    , rb = typeof Object.defineProperties == k ? Object.defineProperty : function(a, b, c) {
        if (a == Array.prototype || a == Object.prototype)
            return a;
        a[b] = c.value;
        return a
    }
    ;
    function sb(a) {
        a = [q == typeof globalThis && globalThis, a, q == typeof window && window, q == typeof self && self, q == typeof global && global];
        for (var b = 0; b < a.length; ++b) {
            var c = a[b];
            if (c && c.Math == Math)
                return c
        }
        throw Error("Cannot find global object");
    }
    var tb = sb(this);
    function y(a, b) {
        if (b)
            a: {
                var c = tb;
                a = a.split(".");
                for (var d = 0; d < a.length - 1; d++) {
                    var e = a[d];
                    if (!(e in c))
                        break a;
                    c = c[e]
                }
                a = a[a.length - 1];
                d = c[a];
                b = b(d);
                b != d && b != null && rb(c, a, {
                    configurable: !0,
                    writable: !0,
                    value: b
                })
            }
    }
    var ub;
    if (typeof Object.setPrototypeOf == k)
        ub = Object.setPrototypeOf;
    else {
        var vb;
        a: {
            var wb = {
                a: !0
            }
              , xb = {};
            try {
                xb.__proto__ = wb;
                vb = xb.a;
                break a
            } catch (a) {}
            vb = !1
        }
        ub = vb ? function(a, b) {
            a.__proto__ = b;
            if (a.__proto__ !== b)
                throw new TypeError(a + " is not extensible");
            return a
        }
        : null
    }
    var yb = ub;
    function z(a, b) {
        a.prototype = qb(b.prototype);
        a.prototype.constructor = a;
        if (yb)
            yb(a, b);
        else
            for (var c in b)
                if (c != "prototype")
                    if (Object.defineProperties) {
                        var d = Object.getOwnPropertyDescriptor(b, c);
                        d && Object.defineProperty(a, c, d)
                    } else
                        a[c] = b[c];
        a.da = b.prototype
    }
    function zb(a) {
        var b = 0;
        return function() {
            return b < a.length ? {
                done: !1,
                value: a[b++]
            } : {
                done: !0
            }
        }
    }
    function A(a) {
        var b = typeof Symbol != "undefined" && Symbol.iterator && a[Symbol.iterator];
        if (b)
            return b.call(a);
        if (typeof a.length == n)
            return {
                next: zb(a)
            };
        throw Error(String(a) + " is not an iterable or ArrayLike");
    }
    function Ab(a) {
        if (!(a instanceof Array)) {
            a = A(a);
            for (var b, c = []; !(b = a.next()).done; )
                c.push(b.value);
            a = c
        }
        return a
    }
    function Bb(a) {
        return Db(a, a)
    }
    function Db(a, b) {
        a.raw = b;
        Object.freeze && (Object.freeze(a),
        Object.freeze(b));
        return a
    }
    function Eb(a) {
        if (!(a instanceof Object))
            throw new TypeError("Iterator result " + a + " is not an object");
    }
    function B() {
        this.C = !1;
        this.o = null;
        this.B = void 0;
        this.g = 1;
        this.l = this.v = 0;
        this.D = this.j = null
    }
    function Fb(a) {
        if (a.C)
            throw new TypeError("Generator is already running");
        a.C = !0
    }
    B.prototype.I = function(a) {
        this.B = a
    }
    ;
    function Gb(a, b) {
        a.j = {
            wb: b,
            Ab: !0
        };
        a.g = a.v || a.l
    }
    B.prototype.getNextAddressJsc = mb("g");
    B.prototype.getYieldResultJsc = mb("B");
    B.prototype.return = function(a) {
        this.j = {
            return: a
        };
        this.g = this.l
    }
    ;
    B.prototype["return"] = B.prototype.return;
    B.prototype.ka = function(a) {
        this.j = {
            wa: a
        };
        this.g = this.l
    }
    ;
    B.prototype.jumpThroughFinallyBlocks = B.prototype.ka;
    B.prototype.H = function(a, b) {
        this.g = b;
        return {
            value: a
        }
    }
    ;
    B.prototype.yield = B.prototype.H;
    B.prototype.oa = function(a, b) {
        a = A(a);
        var c = a.next();
        Eb(c);
        if (c.done)
            this.B = c.value,
            this.g = b;
        else
            return this.o = a,
            this.H(c.value, b)
    }
    ;
    B.prototype.yieldAll = B.prototype.oa;
    B.prototype.wa = function(a) {
        this.g = a
    }
    ;
    B.prototype.jumpTo = B.prototype.wa;
    B.prototype.ea = function() {
        this.g = 0
    }
    ;
    B.prototype.jumpToEnd = B.prototype.ea;
    B.prototype.U = function(a, b) {
        this.v = a;
        b != void 0 && (this.l = b)
    }
    ;
    B.prototype.setCatchFinallyBlocks = B.prototype.U;
    B.prototype.ga = function(a) {
        this.v = 0;
        this.l = a || 0
    }
    ;
    B.prototype.setFinallyBlock = B.prototype.ga;
    B.prototype.fa = function(a, b) {
        this.g = a;
        this.v = b || 0
    }
    ;
    B.prototype.leaveTryBlock = B.prototype.fa;
    B.prototype.O = function(a) {
        this.v = a || 0;
        a = this.j.wb;
        this.j = null;
        return a
    }
    ;
    B.prototype.enterCatchBlock = B.prototype.O;
    B.prototype.R = function(a, b, c) {
        c ? this.D[c] = this.j : this.D = [this.j];
        this.v = a || 0;
        this.l = b || 0
    }
    ;
    B.prototype.enterFinallyBlock = B.prototype.R;
    B.prototype.T = function(a, b) {
        b = this.D.splice(b || 0)[0];
        (b = this.j = this.j || b) ? b.Ab ? this.g = this.v || this.l : b.wa != void 0 && this.l < b.wa ? (this.g = b.wa,
        this.j = null) : this.g = this.l : this.g = a
    }
    ;
    B.prototype.leaveFinallyBlock = B.prototype.T;
    B.prototype.aa = function(a) {
        return new Hb(a)
    }
    ;
    B.prototype.forIn = B.prototype.aa;
    function Hb(a) {
        this.l = a;
        this.g = [];
        for (var b in a)
            this.g.push(b);
        this.g.reverse()
    }
    Hb.prototype.j = function() {
        for (; this.g.length > 0; ) {
            var a = this.g.pop();
            if (a in this.l)
                return a
        }
        return null
    }
    ;
    Hb.prototype.getNext = Hb.prototype.j;
    function Ib(a) {
        this.g = new B;
        this.j = a
    }
    function Jb(a, b) {
        Fb(a.g);
        var c = a.g.o;
        if (c)
            return Kb(a, "return"in c ? c["return"] : function(d) {
                return {
                    value: d,
                    done: !0
                }
            }
            , b, a.g.return);
        a.g.return(b);
        return Lb(a)
    }
    function Kb(a, b, c, d) {
        try {
            var e = b.call(a.g.o, c);
            Eb(e);
            if (!e.done)
                return a.g.C = !1,
                e;
            var f = e.value
        } catch (g) {
            return a.g.o = null,
            Gb(a.g, g),
            Lb(a)
        }
        a.g.o = null;
        d.call(a.g, f);
        return Lb(a)
    }
    function Lb(a) {
        for (; a.g.g; )
            try {
                var b = a.j(a.g);
                if (b)
                    return a.g.C = !1,
                    {
                        value: b.value,
                        done: !1
                    }
            } catch (c) {
                a.g.B = void 0,
                Gb(a.g, c)
            }
        a.g.C = !1;
        if (a.g.j) {
            b = a.g.j;
            a.g.j = null;
            if (b.Ab)
                throw b.wb;
            return {
                value: b.return,
                done: !0
            }
        }
        return {
            value: void 0,
            done: !0
        }
    }
    function Mb(a) {
        this.next = function(b) {
            Fb(a.g);
            a.g.o ? b = Kb(a, a.g.o.next, b, a.g.I) : (a.g.I(b),
            b = Lb(a));
            return b
        }
        ;
        this.throw = function(b) {
            Fb(a.g);
            a.g.o ? b = Kb(a, a.g.o["throw"], b, a.g.I) : (Gb(a.g, b),
            b = Lb(a));
            return b
        }
        ;
        this.return = function(b) {
            return Jb(a, b)
        }
        ;
        this[Symbol.iterator] = function() {
            return this
        }
    }
    function Nb(a) {
        function b(d) {
            return a.next(d)
        }
        function c(d) {
            return a.throw(d)
        }
        return new Promise(function(d, e) {
            function f(g) {
                g.done ? d(g.value) : Promise.resolve(g.value).then(b, c).then(f, e)
            }
            f(a.next())
        }
        )
    }
    function Ob() {
        for (var a = Number(this), b = [], c = a; c < arguments.length; c++)
            b[c - a] = arguments[c];
        return b
    }
    y("globalThis", function(a) {
        return a || tb
    });
    y("Reflect.setPrototypeOf", function(a) {
        return a ? a : yb ? function(b, c) {
            try {
                return yb(b, c),
                !0
            } catch (d) {
                return !1
            }
        }
        : null
    });
    y("Symbol", function(a) {
        function b(f) {
            if (this instanceof b)
                throw new TypeError("Symbol is not a constructor");
            return new c(d + (f || "") + "_" + e++,f)
        }
        function c(f, g) {
            this.g = f;
            rb(this, "description", {
                configurable: !0,
                writable: !0,
                value: g
            })
        }
        if (a)
            return a;
        c.prototype.toString = mb("g");
        var d = "jscomp_symbol_" + (Math.random() * 1E9 >>> 0) + "_"
          , e = 0;
        return b
    });
    y(ra, function(a) {
        if (a)
            return a;
        a = Symbol(ra);
        rb(Array.prototype, a, {
            configurable: !0,
            writable: !0,
            value: function() {
                return Pb(zb(this))
            }
        });
        return a
    });
    function Pb(a) {
        a = {
            next: a
        };
        a[Symbol.iterator] = function() {
            return this
        }
        ;
        return a
    }
    y("Promise", function(a) {
        function b(g) {
            this.g = 0;
            this.l = void 0;
            this.j = [];
            this.B = !1;
            var h = this.o();
            try {
                g(h.resolve, h.reject)
            } catch (l) {
                h.reject(l)
            }
        }
        function c() {
            this.g = null
        }
        function d(g) {
            return g instanceof b ? g : new b(function(h) {
                h(g)
            }
            )
        }
        if (a)
            return a;
        c.prototype.j = function(g) {
            if (this.g == null) {
                this.g = [];
                var h = this;
                this.l(function() {
                    h.v()
                })
            }
            this.g.push(g)
        }
        ;
        var e = tb.setTimeout;
        c.prototype.l = function(g) {
            e(g, 0)
        }
        ;
        c.prototype.v = function() {
            for (; this.g && this.g.length; ) {
                var g = this.g;
                this.g = [];
                for (var h = 0; h < g.length; ++h) {
                    var l = g[h];
                    g[h] = null;
                    try {
                        l()
                    } catch (m) {
                        this.o(m)
                    }
                }
            }
            this.g = null
        }
        ;
        c.prototype.o = function(g) {
            this.l(function() {
                throw g;
            })
        }
        ;
        b.prototype.o = function() {
            function g(m) {
                return function(p) {
                    l || (l = !0,
                    m.call(h, p))
                }
            }
            var h = this
              , l = !1;
            return {
                resolve: g(this.R),
                reject: g(this.v)
            }
        }
        ;
        b.prototype.R = function(g) {
            if (g === this)
                this.v(new TypeError("A Promise cannot resolve to itself"));
            else if (g instanceof b)
                this.U(g);
            else {
                a: switch (typeof g) {
                case q:
                    var h = g != null;
                    break a;
                case k:
                    h = !0;
                    break a;
                default:
                    h = !1
                }
                h ? this.O(g) : this.C(g)
            }
        }
        ;
        b.prototype.O = function(g) {
            var h = void 0;
            try {
                h = g.then
            } catch (l) {
                this.v(l);
                return
            }
            typeof h == k ? this.aa(h, g) : this.C(g)
        }
        ;
        b.prototype.v = function(g) {
            this.I(2, g)
        }
        ;
        b.prototype.C = function(g) {
            this.I(1, g)
        }
        ;
        b.prototype.I = function(g, h) {
            if (this.g != 0)
                throw Error("Cannot settle(" + g + ", " + h + "): Promise already settled in state" + this.g);
            this.g = g;
            this.l = h;
            this.g === 2 && this.T();
            this.D()
        }
        ;
        b.prototype.T = function() {
            var g = this;
            e(function() {
                if (g.H()) {
                    var h = tb.console;
                    typeof h !== "undefined" && h.error(g.l)
                }
            }, 1)
        }
        ;
        b.prototype.H = function() {
            if (this.B)
                return !1;
            var g = tb.CustomEvent
              , h = tb.Event
              , l = tb.dispatchEvent;
            if (typeof l === "undefined")
                return !0;
            typeof g === k ? g = new g(fb,{
                cancelable: !0
            }) : typeof h === k ? g = new h(fb,{
                cancelable: !0
            }) : (g = tb.document.createEvent("CustomEvent"),
            g.initCustomEvent(fb, !1, !0, g));
            g.promise = this;
            g.reason = this.l;
            return l(g)
        }
        ;
        b.prototype.D = function() {
            if (this.j != null) {
                for (var g = 0; g < this.j.length; ++g)
                    f.j(this.j[g]);
                this.j = null
            }
        }
        ;
        var f = new c;
        b.prototype.U = function(g) {
            var h = this.o();
            g.Fa(h.resolve, h.reject)
        }
        ;
        b.prototype.aa = function(g, h) {
            var l = this.o();
            try {
                g.call(h, l.resolve, l.reject)
            } catch (m) {
                l.reject(m)
            }
        }
        ;
        b.prototype.then = function(g, h) {
            function l(t, w) {
                return typeof t == k ? function(K) {
                    try {
                        m(t(K))
                    } catch (ba) {
                        p(ba)
                    }
                }
                : w
            }
            var m, p, r = new b(function(t, w) {
                m = t;
                p = w
            }
            );
            this.Fa(l(g, m), l(h, p));
            return r
        }
        ;
        b.prototype.catch = function(g) {
            return this.then(void 0, g)
        }
        ;
        b.prototype.Fa = function(g, h) {
            function l() {
                switch (m.g) {
                case 1:
                    g(m.l);
                    break;
                case 2:
                    h(m.l);
                    break;
                default:
                    throw Error("Unexpected state: " + m.g);
                }
            }
            var m = this;
            this.j == null ? f.j(l) : this.j.push(l);
            this.B = !0
        }
        ;
        b.resolve = d;
        b.reject = function(g) {
            return new b(function(h, l) {
                l(g)
            }
            )
        }
        ;
        b.race = function(g) {
            return new b(function(h, l) {
                for (var m = A(g), p = m.next(); !p.done; p = m.next())
                    d(p.value).Fa(h, l)
            }
            )
        }
        ;
        b.all = function(g) {
            var h = A(g)
              , l = h.next();
            return l.done ? d([]) : new b(function(m, p) {
                function r(K) {
                    return function(ba) {
                        t[K] = ba;
                        w--;
                        w == 0 && m(t)
                    }
                }
                var t = []
                  , w = 0;
                do
                    t.push(void 0),
                    w++,
                    d(l.value).Fa(r(t.length - 1), p),
                    l = h.next();
                while (!l.done)
            }
            )
        }
        ;
        return b
    });
    y("Object.setPrototypeOf", function(a) {
        return a || yb
    });
    function Qb(a, b) {
        return Object.prototype.hasOwnProperty.call(a, b)
    }
    var Rb = typeof Object.assign == k ? Object.assign : function(a, b) {
        if (a == null)
            throw new TypeError("No nullish arg");
        a = Object(a);
        for (var c = 1; c < arguments.length; c++) {
            var d = arguments[c];
            if (d)
                for (var e in d)
                    Qb(d, e) && (a[e] = d[e])
        }
        return a
    }
    ;
    y("Object.assign", function(a) {
        return a || Rb
    });
    y(qa, function(a) {
        return a ? a : Symbol(qa)
    });
    y("Array.prototype.find", function(a) {
        return a ? a : function(b, c) {
            a: {
                var d = this;
                d instanceof String && (d = String(d));
                for (var e = d.length, f = 0; f < e; f++) {
                    var g = d[f];
                    if (b.call(c, g, f, d)) {
                        b = g;
                        break a
                    }
                }
                b = void 0
            }
            return b
        }
    });
    y("WeakMap", function(a) {
        function b(l) {
            this.g = (h += Math.random() + 1).toString();
            if (l) {
                l = A(l);
                for (var m; !(m = l.next()).done; )
                    m = m.value,
                    this.set(m[0], m[1])
            }
        }
        function c() {}
        function d(l) {
            var m = typeof l;
            return m === q && l !== null || m === k
        }
        function e(l) {
            if (!Qb(l, g)) {
                var m = new c;
                rb(l, g, {
                    value: m
                })
            }
        }
        function f(l) {
            var m = Object[l];
            m && (Object[l] = function(p) {
                if (p instanceof c)
                    return p;
                Object.isExtensible(p) && e(p);
                return m(p)
            }
            )
        }
        if (function() {
            if (!a || !Object.seal)
                return !1;
            try {
                var l = Object.seal({})
                  , m = Object.seal({})
                  , p = new a([[l, 2], [m, 3]]);
                if (p.get(l) != 2 || p.get(m) != 3)
                    return !1;
                p.delete(l);
                p.set(m, 4);
                return !p.has(l) && p.get(m) == 4
            } catch (r) {
                return !1
            }
        }())
            return a;
        var g = "$jscomp_hidden_" + Math.random();
        f("freeze");
        f("preventExtensions");
        f("seal");
        var h = 0;
        b.prototype.set = function(l, m) {
            if (!d(l))
                throw Error("Invalid WeakMap key");
            e(l);
            if (!Qb(l, g))
                throw Error("WeakMap key fail: " + l);
            l[g][this.g] = m;
            return this
        }
        ;
        b.prototype.get = function(l) {
            return d(l) && Qb(l, g) ? l[g][this.g] : void 0
        }
        ;
        b.prototype.has = function(l) {
            return d(l) && Qb(l, g) && Qb(l[g], this.g)
        }
        ;
        b.prototype.delete = function(l) {
            return d(l) && Qb(l, g) && Qb(l[g], this.g) ? delete l[g][this.g] : !1
        }
        ;
        return b
    });
    y("Map", function(a) {
        function b() {
            var h = {};
            return h.ja = h.next = h.head = h
        }
        function c(h, l) {
            var m = h[1];
            return Pb(function() {
                if (m) {
                    for (; m.head != h[1]; )
                        m = m.ja;
                    for (; m.next != m.head; )
                        return m = m.next,
                        {
                            done: !1,
                            value: l(m)
                        };
                    m = null
                }
                return {
                    done: !0,
                    value: void 0
                }
            })
        }
        function d(h, l) {
            var m = l && typeof l;
            m == q || m == k ? f.has(l) ? m = f.get(l) : (m = "" + ++g,
            f.set(l, m)) : m = "p_" + l;
            var p = h[0][m];
            if (p && Qb(h[0], m))
                for (h = 0; h < p.length; h++) {
                    var r = p[h];
                    if (l !== l && r.key !== r.key || l === r.key)
                        return {
                            id: m,
                            list: p,
                            index: h,
                            entry: r
                        }
                }
            return {
                id: m,
                list: p,
                index: -1,
                entry: void 0
            }
        }
        function e(h) {
            this[0] = {};
            this[1] = b();
            this.size = 0;
            if (h) {
                h = A(h);
                for (var l; !(l = h.next()).done; )
                    l = l.value,
                    this.set(l[0], l[1])
            }
        }
        if (function() {
            if (!a || typeof a != k || !a.prototype.entries || typeof Object.seal != k)
                return !1;
            try {
                var h = Object.seal({
                    x: 4
                })
                  , l = new a(A([[h, "s"]]));
                if (l.get(h) != "s" || l.size != 1 || l.get({
                    x: 4
                }) || l.set({
                    x: 4
                }, "t") != l || l.size != 2)
                    return !1;
                var m = l.entries()
                  , p = m.next();
                if (p.done || p.value[0] != h || p.value[1] != "s")
                    return !1;
                p = m.next();
                return p.done || p.value[0].x != 4 || p.value[1] != "t" || !m.next().done ? !1 : !0
            } catch (r) {
                return !1
            }
        }())
            return a;
        var f = new WeakMap;
        e.prototype.set = function(h, l) {
            h = h === 0 ? 0 : h;
            var m = d(this, h);
            m.list || (m.list = this[0][m.id] = []);
            m.entry ? m.entry.value = l : (m.entry = {
                next: this[1],
                ja: this[1].ja,
                head: this[1],
                key: h,
                value: l
            },
            m.list.push(m.entry),
            this[1].ja.next = m.entry,
            this[1].ja = m.entry,
            this.size++);
            return this
        }
        ;
        e.prototype.delete = function(h) {
            h = d(this, h);
            return h.entry && h.list ? (h.list.splice(h.index, 1),
            h.list.length || delete this[0][h.id],
            h.entry.ja.next = h.entry.next,
            h.entry.next.ja = h.entry.ja,
            h.entry.head = null,
            this.size--,
            !0) : !1
        }
        ;
        e.prototype.clear = function() {
            this[0] = {};
            this[1] = this[1].ja = b();
            this.size = 0
        }
        ;
        e.prototype.has = function(h) {
            return !!d(this, h).entry
        }
        ;
        e.prototype.get = function(h) {
            return (h = d(this, h).entry) && h.value
        }
        ;
        e.prototype.entries = function() {
            return c(this, function(h) {
                return [h.key, h.value]
            })
        }
        ;
        e.prototype.keys = function() {
            return c(this, function(h) {
                return h.key
            })
        }
        ;
        e.prototype.values = function() {
            return c(this, function(h) {
                return h.value
            })
        }
        ;
        e.prototype.forEach = function(h, l) {
            for (var m = this.entries(), p; !(p = m.next()).done; )
                p = p.value,
                h.call(l, p[1], p[0], this)
        }
        ;
        e.prototype[Symbol.iterator] = e.prototype.entries;
        var g = 0;
        return e
    });
    y("Set", function(a) {
        function b(c) {
            this.g = new Map;
            if (c) {
                c = A(c);
                for (var d; !(d = c.next()).done; )
                    this.add(d.value)
            }
            this.size = this.g.size
        }
        if (function() {
            if (!a || typeof a != k || !a.prototype.entries || typeof Object.seal != k)
                return !1;
            try {
                var c = Object.seal({
                    x: 4
                })
                  , d = new a(A([c]));
                if (!d.has(c) || d.size != 1 || d.add(c) != d || d.size != 1 || d.add({
                    x: 4
                }) != d || d.size != 2)
                    return !1;
                var e = d.entries()
                  , f = e.next();
                if (f.done || f.value[0] != c || f.value[1] != c)
                    return !1;
                f = e.next();
                return f.done || f.value[0] == c || f.value[0].x != 4 || f.value[1] != f.value[0] ? !1 : e.next().done
            } catch (g) {
                return !1
            }
        }())
            return a;
        b.prototype.add = function(c) {
            c = c === 0 ? 0 : c;
            this.g.set(c, c);
            this.size = this.g.size;
            return this
        }
        ;
        b.prototype.delete = function(c) {
            c = this.g.delete(c);
            this.size = this.g.size;
            return c
        }
        ;
        b.prototype.clear = function() {
            this.g.clear();
            this.size = 0
        }
        ;
        b.prototype.has = function(c) {
            return this.g.has(c)
        }
        ;
        b.prototype.entries = function() {
            return this.g.entries()
        }
        ;
        b.prototype.values = function() {
            return this.g.values()
        }
        ;
        b.prototype.keys = b.prototype.values;
        b.prototype[Symbol.iterator] = b.prototype.values;
        b.prototype.forEach = function(c, d) {
            var e = this;
            this.g.forEach(function(f) {
                return c.call(d, f, f, e)
            })
        }
        ;
        return b
    });
    y("Math.log2", function(a) {
        return a ? a : function(b) {
            return Math.log(b) / Math.LN2
        }
    });
    y("Object.values", function(a) {
        return a ? a : function(b) {
            var c = [], d;
            for (d in b)
                Qb(b, d) && c.push(b[d]);
            return c
        }
    });
    y("Object.is", function(a) {
        return a ? a : function(b, c) {
            return b === c ? b !== 0 || 1 / b === 1 / c : b !== b && c !== c
        }
    });
    y("Array.prototype.includes", function(a) {
        return a ? a : function(b, c) {
            var d = this;
            d instanceof String && (d = String(d));
            var e = d.length;
            c = c || 0;
            for (c < 0 && (c = Math.max(c + e, 0)); c < e; c++) {
                var f = d[c];
                if (f === b || Object.is(f, b))
                    return !0
            }
            return !1
        }
    });
    function Sb(a, b, c) {
        if (a == null)
            throw new TypeError("The 'this' value for String.prototype." + c + " must not be null or undefined");
        if (b instanceof RegExp)
            throw new TypeError("First argument to String.prototype." + c + " must not be a regular expression");
        return a + ""
    }
    y("String.prototype.includes", function(a) {
        return a ? a : function(b, c) {
            return Sb(this, b, "includes").indexOf(b, c || 0) !== -1
        }
    });
    y("Array.from", function(a) {
        return a ? a : function(b, c, d) {
            c = c != null ? c : kb();
            var e = []
              , f = typeof Symbol != "undefined" && Symbol.iterator && b[Symbol.iterator];
            if (typeof f == k) {
                b = f.call(b);
                for (var g = 0; !(f = b.next()).done; )
                    e.push(c.call(d, f.value, g++))
            } else
                for (f = b.length,
                g = 0; g < f; g++)
                    e.push(c.call(d, b[g], g));
            return e
        }
    });
    y("Object.entries", function(a) {
        return a ? a : function(b) {
            var c = [], d;
            for (d in b)
                Qb(b, d) && c.push([d, b[d]]);
            return c
        }
    });
    y("Number.isFinite", function(a) {
        return a ? a : function(b) {
            return typeof b !== n ? !1 : !isNaN(b) && b !== Infinity && b !== -Infinity
        }
    });
    y("Number.MAX_SAFE_INTEGER", pb(9007199254740991));
    y("Number.MIN_SAFE_INTEGER", pb(-9007199254740991));
    y("Number.isInteger", function(a) {
        return a ? a : function(b) {
            return Number.isFinite(b) ? b === Math.floor(b) : !1
        }
    });
    y("Number.isSafeInteger", function(a) {
        return a ? a : function(b) {
            return Number.isInteger(b) && Math.abs(b) <= Number.MAX_SAFE_INTEGER
        }
    });
    y("String.prototype.startsWith", function(a) {
        return a ? a : function(b, c) {
            var d = Sb(this, b, "startsWith");
            b += "";
            var e = d.length
              , f = b.length;
            c = Math.max(0, Math.min(c | 0, d.length));
            for (var g = 0; g < f && c < e; )
                if (d[c++] != b[g++])
                    return !1;
            return g >= f
        }
    });
    function Tb(a, b) {
        a instanceof String && (a += "");
        var c = 0
          , d = !1
          , e = {
            next: function() {
                if (!d && c < a.length) {
                    var f = c++;
                    return {
                        value: b(f, a[f]),
                        done: !1
                    }
                }
                d = !0;
                return {
                    done: !0,
                    value: void 0
                }
            }
        };
        e[Symbol.iterator] = function() {
            return e
        }
        ;
        return e
    }
    y("Array.prototype.entries", function(a) {
        return a ? a : function() {
            return Tb(this, function(b, c) {
                return [b, c]
            })
        }
    });
    y("Math.trunc", function(a) {
        return a ? a : function(b) {
            b = Number(b);
            if (isNaN(b) || b === Infinity || b === -Infinity || b === 0)
                return b;
            var c = Math.floor(Math.abs(b));
            return b < 0 ? -c : c
        }
    });
    y("Number.isNaN", function(a) {
        return a ? a : function(b) {
            return typeof b === n && isNaN(b)
        }
    });
    y("Array.prototype.keys", function(a) {
        return a ? a : function() {
            return Tb(this, kb())
        }
    });
    y("Array.prototype.values", function(a) {
        return a ? a : function() {
            return Tb(this, function(b, c) {
                return c
            })
        }
    });
    y("WeakSet", function(a) {
        function b(c) {
            this.g = new WeakMap;
            if (c) {
                c = A(c);
                for (var d; !(d = c.next()).done; )
                    this.add(d.value)
            }
        }
        if (function() {
            if (!a || !Object.seal)
                return !1;
            try {
                var c = Object.seal({})
                  , d = Object.seal({})
                  , e = new a([c]);
                if (!e.has(c) || e.has(d))
                    return !1;
                e.delete(c);
                e.add(d);
                return !e.has(c) && e.has(d)
            } catch (f) {
                return !1
            }
        }())
            return a;
        b.prototype.add = function(c) {
            this.g.set(c, !0);
            return this
        }
        ;
        b.prototype.has = function(c) {
            return this.g.has(c)
        }
        ;
        b.prototype.delete = function(c) {
            return this.g.delete(c)
        }
        ;
        return b
    });
    y("Math.imul", function(a) {
        return a ? a : function(b, c) {
            b = Number(b);
            c = Number(c);
            var d = b & 65535
              , e = c & 65535;
            return d * e + ((b >>> 16 & 65535) * e + d * (c >>> 16 & 65535) << 16 >>> 0) | 0
        }
    });
    y("String.fromCodePoint", function(a) {
        return a ? a : function(b) {
            for (var c = "", d = 0; d < arguments.length; d++) {
                var e = Number(arguments[d]);
                if (e < 0 || e > 1114111 || e !== Math.floor(e))
                    throw new RangeError("invalid_code_point " + e);
                e <= 65535 ? c += String.fromCharCode(e) : (e -= 65536,
                c += String.fromCharCode(e >>> 10 & 1023 | 55296),
                c += String.fromCharCode(e & 1023 | 56320))
            }
            return c
        }
    });
    y("String.prototype.matchAll", function(a) {
        return a ? a : function(b) {
            if (b instanceof RegExp && !b.global)
                throw new TypeError("RegExp passed into String.prototype.matchAll() must have global tag.");
            var c = new RegExp(b,b instanceof RegExp ? void 0 : "g")
              , d = this
              , e = !1
              , f = {
                next: function() {
                    if (e)
                        return {
                            value: void 0,
                            done: !0
                        };
                    var g = c.exec(d);
                    if (!g)
                        return e = !0,
                        {
                            value: void 0,
                            done: !0
                        };
                    g[0] === "" && (c.lastIndex += 1);
                    return {
                        value: g,
                        done: !1
                    }
                }
            };
            f[Symbol.iterator] = function() {
                return f
            }
            ;
            return f
        }
    });
    var Ub = Ub || {}
      , C = this || self;
    function Vb(a, b, c) {
        a = a.split(".");
        c = c || C;
        for (var d; a.length && (d = a.shift()); )
            a.length || b === void 0 ? c[d] && c[d] !== Object.prototype[d] ? c = c[d] : c = c[d] = {} : c[d] = b
    }
    function Wb(a, b) {
        var c = Xb("CLOSURE_FLAGS");
        a = c && c[a];
        return a != null ? a : b
    }
    function Xb(a) {
        a = a.split(".");
        for (var b = C, c = 0; c < a.length; c++)
            if (b = b[a[c]],
            b == null)
                return null;
        return b
    }
    function Zb(a) {
        var b = typeof a;
        return b != q ? b : a ? Array.isArray(a) ? "array" : b : Va
    }
    function $b(a) {
        var b = Zb(a);
        return b == "array" || b == q && typeof a.length == n
    }
    function ac(a) {
        var b = typeof a;
        return b == q && a != null || b == k
    }
    var bc = "closure_uid_" + (Math.random() * 1E9 >>> 0)
      , cc = 0;
    function dc(a, b, c) {
        return a.call.apply(a.bind, arguments)
    }
    function ec(a, b, c) {
        if (!a)
            throw Error();
        if (arguments.length > 2) {
            var d = Array.prototype.slice.call(arguments, 2);
            return function() {
                var e = Array.prototype.slice.call(arguments);
                Array.prototype.unshift.apply(e, d);
                return a.apply(b, e)
            }
        }
        return function() {
            return a.apply(b, arguments)
        }
    }
    function fc(a, b, c) {
        fc = Function.prototype.bind && Function.prototype.bind.toString().indexOf("native code") != -1 ? dc : ec;
        return fc.apply(null, arguments)
    }
    function D(a, b) {
        var c = Array.prototype.slice.call(arguments, 1);
        return function() {
            var d = c.slice();
            d.push.apply(d, arguments);
            return a.apply(this, d)
        }
    }
    function hc(a) {
        (0,
        eval)(a)
    }
    function ic(a) {
        return a
    }
    function jc(a, b) {
        function c() {}
        c.prototype = b.prototype;
        a.da = b.prototype;
        a.prototype = new c;
        a.prototype.constructor = a;
        a.Kd = function(d, e, f) {
            for (var g = Array(arguments.length - 2), h = 2; h < arguments.length; h++)
                g[h - 2] = arguments[h];
            return b.prototype[e].apply(d, g)
        }
    }
    ;function kc(a, b) {
        if (Error.captureStackTrace)
            Error.captureStackTrace(this, kc);
        else {
            var c = Error().stack;
            c && (this.stack = c)
        }
        a && (this.message = String(a));
        b !== void 0 && (this.cause = b);
        this.g = !0
    }
    jc(kc, Error);
    kc.prototype.name = "CustomError";
    var lc;
    function mc(a, b) {
        a = a.split("%s");
        for (var c = "", d = a.length - 1, e = 0; e < d; e++)
            c += a[e] + (e < b.length ? b[e] : "%s");
        kc.call(this, c + a[d])
    }
    jc(mc, kc);
    mc.prototype.name = "AssertionError";
    function nc(a, b, c, d) {
        var e = "Assertion failed";
        if (c) {
            e += ": " + c;
            var f = d
        } else
            a && (e += ": " + a,
            f = b);
        throw new mc("" + e,f || []);
    }
    function E(a, b, c) {
        a || nc("", null, b, Array.prototype.slice.call(arguments, 2));
        return a
    }
    function F(a, b, c) {
        a == null && nc("Expected to exist: %s.", [a], b, Array.prototype.slice.call(arguments, 2));
        return a
    }
    function oc(a, b) {
        throw new mc("Failure" + (a ? ": " + a : ""),Array.prototype.slice.call(arguments, 1));
    }
    function pc(a, b, c) {
        typeof a !== n && nc("Expected number but got %s: %s.", [Zb(a), a], b, Array.prototype.slice.call(arguments, 2));
        return a
    }
    function qc(a, b, c) {
        typeof a !== v && nc("Expected string but got %s: %s.", [Zb(a), a], b, Array.prototype.slice.call(arguments, 2))
    }
    function rc(a, b, c) {
        typeof a !== k && nc("Expected function but got %s: %s.", [Zb(a), a], b, Array.prototype.slice.call(arguments, 2));
        return a
    }
    function sc(a, b, c) {
        ac(a) || nc("Expected object but got %s: %s.", [Zb(a), a], b, Array.prototype.slice.call(arguments, 2))
    }
    function G(a, b, c) {
        Array.isArray(a) || nc("Expected array but got %s: %s.", [Zb(a), a], b, Array.prototype.slice.call(arguments, 2));
        return a
    }
    function tc(a, b, c, d) {
        a instanceof b || nc("Expected instanceof %s but got %s.", [uc(b), uc(a)], c, Array.prototype.slice.call(arguments, 3));
        return a
    }
    function uc(a) {
        return a instanceof Function ? a.displayName || a.name || hb : a instanceof Object ? a.constructor.displayName || a.constructor.name || Object.prototype.toString.call(a) : a === null ? Va : typeof a
    }
    ;function vc(a) {
        C.setTimeout(function() {
            throw a;
        }, 0)
    }
    ;var wc = String.prototype.trim ? function(a) {
        return a.trim()
    }
    : function(a) {
        return /^[\s\xa0]*([\s\S]*?)[\s\xa0]*$/.exec(a)[1]
    }
      , xc = /&/g
      , yc = /</g
      , zc = />/g
      , Ac = /"/g
      , Bc = /'/g
      , Cc = /\x00/g
      , Dc = /[\x00&<>"']/;
    var Ec = Wb(610401301, !1)
      , Fc = Wb(748402147, !0);
    function Gc() {
        var a = C.navigator;
        return a && (a = a.userAgent) ? a : ""
    }
    var Hc, Ic = C.navigator;
    Hc = Ic ? Ic.userAgentData || null : null;
    function Jc(a) {
        if (!Ec || !Hc)
            return !1;
        for (var b = 0; b < Hc.brands.length; b++) {
            var c = Hc.brands[b].brand;
            if (c && c.indexOf(a) != -1)
                return !0
        }
        return !1
    }
    function H(a) {
        return Gc().indexOf(a) != -1
    }
    ;function Kc() {
        return Ec ? !!Hc && Hc.brands.length > 0 : !1
    }
    function Lc() {
        return Kc() ? !1 : H("Opera")
    }
    function Mc() {
        return H("Firefox") || H("FxiOS")
    }
    function Nc() {
        return Kc() ? Jc("Chromium") : (H("Chrome") || H("CriOS")) && !(Kc() ? 0 : H(fa)) || H("Silk")
    }
    ;function Oc() {
        return Ec ? !!Hc && !!Hc.platform : !1
    }
    function Pc() {
        return H("iPhone") && !H("iPod") && !H("iPad")
    }
    ;var Qc = Array.prototype.indexOf ? function(a, b) {
        E(a.length != null);
        return Array.prototype.indexOf.call(a, b, void 0)
    }
    : function(a, b) {
        if (typeof a === v)
            return typeof b !== v || b.length != 1 ? -1 : a.indexOf(b, 0);
        for (var c = 0; c < a.length; c++)
            if (c in a && a[c] === b)
                return c;
        return -1
    }
      , Rc = Array.prototype.forEach ? function(a, b) {
        E(a.length != null);
        Array.prototype.forEach.call(a, b, void 0)
    }
    : function(a, b) {
        for (var c = a.length, d = typeof a === v ? a.split("") : a, e = 0; e < c; e++)
            e in d && b.call(void 0, d[e], e, a)
    }
      , Sc = Array.prototype.some ? function(a, b) {
        E(a.length != null);
        return Array.prototype.some.call(a, b, void 0)
    }
    : function(a, b) {
        for (var c = a.length, d = typeof a === v ? a.split("") : a, e = 0; e < c; e++)
            if (e in d && b.call(void 0, d[e], e, a))
                return !0;
        return !1
    }
    ;
    function Tc(a, b) {
        b = Qc(a, b);
        var c;
        if (c = b >= 0)
            E(a.length != null),
            Array.prototype.splice.call(a, b, 1);
        return c
    }
    function Wc(a) {
        var b = a.length;
        if (b > 0) {
            for (var c = Array(b), d = 0; d < b; d++)
                c[d] = a[d];
            return c
        }
        return []
    }
    function Xc(a, b) {
        for (var c = 1; c < arguments.length; c++) {
            var d = arguments[c];
            if ($b(d)) {
                var e = a.length || 0
                  , f = d.length || 0;
                a.length = e + f;
                for (var g = 0; g < f; g++)
                    a[e + g] = d[g]
            } else
                a.push(d)
        }
    }
    function Yc(a, b, c) {
        E(a.length != null);
        return arguments.length <= 2 ? Array.prototype.slice.call(a, b) : Array.prototype.slice.call(a, b, c)
    }
    ;function Zc(a) {
        Zc[" "](a);
        return a
    }
    Zc[" "] = lb();
    Lc();
    var $c = Kc() ? !1 : H("Trident") || H("MSIE");
    H(fa);
    var ad = H("Gecko") && !(Gc().toLowerCase().indexOf("webkit") != -1 && !H(fa)) && !(H("Trident") || H("MSIE")) && !H(fa)
      , bd = Gc().toLowerCase().indexOf("webkit") != -1 && !H(fa);
    bd && H("Mobile");
    Oc() || H("Macintosh");
    Oc() || H("Windows");
    (Oc() ? Hc.platform === "Linux" : H("Linux")) || Oc() || H("CrOS");
    Oc() || H("Android");
    Pc();
    H("iPad");
    H("iPod");
    Pc() || H("iPad") || H("iPod");
    Gc().toLowerCase().indexOf("kaios");
    var cd = Mc();
    Pc() || H("iPod");
    H("iPad");
    !H("Android") || Nc() || Mc() || Lc() || H("Silk");
    Nc();
    var dd = H("Safari") && !(Nc() || (Kc() ? 0 : H("Coast")) || Lc() || (Kc() ? 0 : H(fa)) || (Kc() ? Jc("Microsoft Edge") : H("Edg/")) || (Kc() ? Jc("Opera") : H("OPR")) || Mc() || H("Silk") || H("Android")) && !(Pc() || H("iPad") || H("iPod"));
    var ed = {}
      , fd = null;
    var gd = typeof Uint8Array !== "undefined"
      , hd = !$c && typeof btoa === k
      , id = {}
      , jd = typeof structuredClone != "undefined";
    function kd(a, b) {
        if (b !== id)
            throw Error("illegal external caller");
        this.g = a;
        if (a != null && a.length === 0)
            throw Error("ByteString should be constructed with non-empty values");
        this.dontPassByteStringToStructuredClone = ld
    }
    function md() {
        return nd || (nd = new kd(null,id))
    }
    var nd;
    kd.prototype.ub = 1;
    function ld() {}
    ;function od(a, b, c) {
        a.__closure__error__context__984382 || (a.__closure__error__context__984382 = {});
        a.__closure__error__context__984382[b] = c
    }
    function pd(a) {
        return a.__closure__error__context__984382 || {}
    }
    ;var qd = {};
    function rd(a) {
        a = Error(a);
        od(a, ab, ib);
        return a
    }
    ;function sd() {
        return typeof BigInt === k
    }
    function td() {
        var a, b;
        return typeof window === "undefined" || ((a = globalThis) == null ? void 0 : (b = a.g) == null ? void 0 : b["jspb.DISABLE_RANDOMIZE_SERIALIZATION"])
    }
    ;var ud = typeof Symbol === k && typeof Symbol() === cb;
    function vd(a, b, c) {
        return typeof Symbol === k && typeof Symbol() === cb ? (c === void 0 ? 0 : c) && Symbol.for && a ? Symbol.for(a) : a != null ? Symbol(a) : Symbol() : b
    }
    var wd = vd("jas", void 0, !0)
      , xd = vd("defaultInstance", "0di")
      , yd = vd("oneofCases", "1oa")
      , zd = vd("unknownBinaryFields", Symbol())
      , Ad = vd("unknownBinaryThrottleKey", "0ubs")
      , Bd = vd("m_m", "Nd", !0)
      , Cd = vd("validPivotSelector", "vps")
      , Dd = vd(Qa, Qa)
      , Ed = vd(Ga, Ga);
    E(Math.round(Math.log2(Math.max.apply(Math, Ab(Object.values({
        Tc: 1,
        Rc: 2,
        Oc: 4,
        fd: 8,
        Bd: 16,
        Zc: 32,
        xc: 64,
        Mc: 128,
        Kc: 256,
        xd: 512,
        Lc: 1024,
        Nc: 2048,
        ad: 4096,
        Uc: 8192
    }))))) === 13);
    var Fd = {
        dc: {
            value: 0,
            configurable: !0,
            writable: !0,
            enumerable: !1
        }
    }, Gd = Object.defineProperties, I = ud ? F(wd) : "dc", Hd, Id = [];
    Jd(Id, 7);
    Hd = Object.freeze(Id);
    function Kd(a) {
        return G(a, u)[I] | 0
    }
    function Ld(a, b) {
        E((b & 16777215) === b);
        G(a, u);
        ud || I in a || Gd(a, Fd);
        a[I] |= b
    }
    function Jd(a, b) {
        E((b & 16777215) === b);
        G(a, u);
        ud || I in a || Gd(a, Fd);
        a[I] = b
    }
    function J(a, b, c) {
        (c === void 0 || !c || b & 2048) && E(b & 64, "state for messages must be constructed");
        E((b & 5) === 0, "state for messages should not contain repeated field state");
        E((b & 8192) === 0, "state for messages should not contain map field state");
        if (b & 64) {
            E(b & 64);
            c = b >> 14 & 1023 || 536870912;
            var d = a.length;
            E(b & 64);
            E(c + (b & 128 ? 0 : -1) >= d - 1, "pivot %s is pointing at an index earlier than the last index of the array, length: %s", c, d);
            b & 128 && E(typeof a[0] === v, "arrays with a message_id bit must have a string in the first position, got: %s", a[0])
        }
    }
    function Md(a) {
        var b = G(a, u)[I] | 0;
        J(a, b);
        return b
    }
    function Nd(a) {
        return !!((G(a, u)[I] | 0) & 2)
    }
    function Od(a) {
        Ld(a, 34);
        return a
    }
    function Pd(a, b) {
        pc(b);
        E(b > 0 && b <= 1023 || 536870912 === b, "pivot must be in the range [1, 1024) or NO_PIVOT got %s", b);
        return a & -16760833 | (b & 1023) << 14
    }
    function Qd(a) {
        E(a & 64);
        return a & 128 ? 0 : -1
    }
    var Rd = Object.getOwnPropertyDescriptor(Array.prototype, "fc");
    Object.defineProperties(Array.prototype, {
        fc: {
            get: function() {
                var a = Sd(this);
                return Rd ? Rd.get.call(this) + "|" + a : a
            },
            configurable: !0,
            enumerable: !1
        }
    });
    function Sd(a) {
        function b(e, f) {
            e & c && d.push(f)
        }
        var c = G(a, u)[I] | 0
          , d = [];
        b(1, "IS_REPEATED_FIELD");
        b(2, "IS_IMMUTABLE_ARRAY");
        b(4, "IS_API_FORMATTED");
        b(512, "STRING_FORMATTED");
        b(1024, "GBIGINT_FORMATTED");
        b(1024, "BINARY");
        b(8, "ONLY_MUTABLE_VALUES");
        b(16, "UNFROZEN_SHARED");
        b(32, "MUTABLE_REFERENCES_ARE_OWNED");
        b(64, "CONSTRUCTED");
        b(128, "HAS_MESSAGE_ID");
        b(256, "FROZEN_ARRAY");
        b(2048, "HAS_WRAPPER");
        b(4096, "MUTABLE_SUBSTRUCTURES");
        b(8192, "KNOWN_MAP_ARRAY");
        c & 64 && (E(c & 64),
        a = c >> 14 & 1023 || 536870912,
        a !== 536870912 && d.push("pivot: " + a));
        return d.join(",")
    }
    ;var L = ud && Math.random() < .5
      , M = L ? Symbol() : void 0;
    function Td(a) {
        E(N(a));
        return L ? a[F(M)] : a.G
    }
    var Ud, Vd = typeof Bd === cb, Wd = {};
    function N(a) {
        var b = a[Bd]
          , c = b === Wd;
        E(!Ud || c === a instanceof Ud);
        if (Vd && b && !c)
            throw Error("multiple jspb runtimes detected");
        return c
    }
    function Xd(a) {
        return a != null && N(a)
    }
    function Yd(a, b) {
        pc(a);
        E(a > 0);
        E(b === 0 || b === -1);
        return a + b
    }
    function Zd(a, b) {
        E(b === $d || b === void 0);
        return a + (b ? 0 : -1)
    }
    function ae(a, b) {
        pc(a);
        E(a >= 0);
        E(b === 0 || b === -1);
        return a - b
    }
    function be(a, b) {
        if (b === void 0) {
            if (b = !ce(a))
                E(N(a)),
                a = L ? a[F(M)] : a.G,
                b = G(a, u)[I] | 0,
                J(a, b),
                b = !!(2 & b);
            return b
        }
        E(N(a));
        var c = L ? a[F(M)] : a.G;
        var d = G(c, u)[I] | 0;
        J(c, d);
        E(b === d);
        return !!(2 & b) && !ce(a)
    }
    var de = {};
    function ce(a) {
        var b = a.j, c;
        (c = !b) || (E(N(a)),
        a = L ? a[F(M)] : a.G,
        c = G(a, u)[I] | 0,
        J(a, c),
        c = !!(2 & c));
        E(c);
        E(b === void 0 || b === de);
        return b === de
    }
    function ee(a, b) {
        E(N(a));
        var c = L ? a[F(M)] : a.G;
        var d = G(c, u)[I] | 0;
        J(c, d);
        E(b === !!(2 & d));
        a.j = b ? de : void 0
    }
    var fe = Symbol("exempted jspb subclass")
      , ge = typeof Symbol != "undefined" && typeof Symbol.hasInstance != "undefined";
    function he() {}
    function ie(a, b) {
        var c = Kd(G(a));
        b || E(!(c & 2 && c & 4 || c & 256) || Object.isFrozen(a));
        je(a)
    }
    function je(a) {
        a = G(a, u)[I] | 0;
        var b = a & 4
          , c = (512 & a ? 1 : 0) + (1024 & a ? 1 : 0);
        E(b && c <= 1 || !b && c === 0, "Expected at most 1 type-specific formatting bit, but got " + c + " with state: " + a)
    }
    var ke = Object.freeze({})
      , me = Object.freeze({})
      , ne = Symbol("debugExtensions")
      , $d = {};
    function oe(a, b) {
        a = G(a, u)[I] | 0;
        E(a & 64);
        a & 128 ? E(b === $d) : E(b === void 0)
    }
    ;function pe(a, b) {
        b = b === void 0 ? new Set : b;
        if (b.has(a))
            return "(Recursive reference)";
        switch (typeof a) {
        case q:
            if (a) {
                var c = Object.getPrototypeOf(a);
                switch (c) {
                case Map.prototype:
                case Set.prototype:
                case Array.prototype:
                    b.add(a);
                    var d = "[" + Array.from(a, function(e) {
                        return pe(e, b)
                    }).join(", ") + "]";
                    b.delete(a);
                    c !== Array.prototype && (d = qe(c.constructor) + "(" + d + ")");
                    return d;
                case Object.prototype:
                    return b.add(a),
                    c = "{" + Object.entries(a).map(function(e) {
                        var f = A(e);
                        e = f.next().value;
                        f = f.next().value;
                        return e + ": " + pe(f, b)
                    }).join(", ") + "}",
                    b.delete(a),
                    c;
                default:
                    return d = oa,
                    c && c.constructor && (d = qe(c.constructor)),
                    typeof a.toString === k && a.toString !== Object.prototype.toString ? d + "(" + String(a) + ")" : "(object " + d + ")"
                }
            }
            break;
        case k:
            return "function " + qe(a);
        case n:
            if (!Number.isFinite(a))
                return String(a);
            break;
        case Da:
            return a.toString(10) + "n";
        case cb:
            return a.toString()
        }
        return JSON.stringify(a)
    }
    function qe(a) {
        var b = a.displayName;
        return b && typeof b === v || (b = a.name) && typeof b === v ? b : (a = /function\s+([^\(]+)/m.exec(String(a))) ? a[1] : "(Anonymous)"
    }
    ;function re(a, b) {
        var c = se
          , d = [];
        te(b, a, d) || ue.apply(null, [void 0, c, "Guard " + b.bb().trim() + " failed:"].concat(Ab(d.reverse())))
    }
    function ve(a, b) {
        re(a, b);
        return a
    }
    function O(a, b) {
        var c = se;
        a || ue("Guard truthy failed:", b || c || "Expected truthy, got " + pe(a))
    }
    function we(a, b) {
        a.Md = !0;
        a.bb = typeof b === k ? b : function() {
            return b
        }
        ;
        return a
    }
    function te(a, b, c) {
        var d = a(b, c);
        d || xe(c, function() {
            var e = "";
            e.length > 0 && (e += ": ");
            return e + "Expected " + a.bb().trim() + ", got " + pe(b)
        });
        return d
    }
    function xe(a, b) {
        a == null || a.push((typeof b === k ? b() : b).trim())
    }
    var se = void 0;
    function ye(a) {
        return typeof a === k ? a() : a
    }
    function ue() {
        throw Error(Ob.apply(0, arguments).map(ye).filter(Boolean).join("\n").trim().replace(/:$/, ""));
    }
    ;var ze = we(function(a) {
        return typeof a === n
    }, n)
      , Ae = we(function(a) {
        return typeof a === v
    }, v)
      , Be = we(function(a) {
        return typeof a === Ea
    }, Ea)
      , Ce = we(function(a) {
        return typeof a === Da
    }, Da);
    function De() {
        var a = Ob.apply(0, arguments);
        return we(function(b) {
            return a.some(function(c) {
                return c(b)
            })
        }, function() {
            return "" + a.map(function(b) {
                return b.bb().trim()
            }).join(" | ")
        })
    }
    ;var Ee = typeof C.BigInt === k && typeof C.BigInt(0) === Da;
    function Fe(a) {
        var b = a;
        if (Ae(b)) {
            if (!/^\s*(?:-?[1-9]\d*|0)?\s*$/.test(b))
                throw Error("Invalid string for toGbigint: " + b);
        } else if (ze(b) && !Number.isSafeInteger(b))
            throw Error("Invalid number for toGbigint: " + b);
        return Ee ? (Ce(a) || (re(a, De(Ae, Be, ze)),
        a = BigInt(a)),
        a % BigInt(2) === BigInt(Ge()) ? a.toString() : a) : a = Be(a) ? a ? "1" : "0" : Ae(a) ? a.trim() || "0" : String(a)
    }
    var Ie = we(function(a) {
        return Ee ? He(a) : Ae(a) && /^(?:-?[1-9]\d*|0)$/.test(a)
    }, "gbigint")
      , Oe = we(function(a) {
        if (Ee)
            return re(Je, Ce),
            re(Ke, Ce),
            a = BigInt(a),
            a >= Je && a <= Ke;
        a = ve(a, Ae);
        return a[0] === "-" ? Le(a, Me) : Le(a, Ne)
    }, "isSafeInt52")
      , Me = Number.MIN_SAFE_INTEGER.toString()
      , Je = Ee ? BigInt(Number.MIN_SAFE_INTEGER) : void 0
      , Ne = Number.MAX_SAFE_INTEGER.toString()
      , Ke = Ee ? BigInt(Number.MAX_SAFE_INTEGER) : void 0;
    function Le(a, b) {
        if (a.length > b.length)
            return !1;
        if (a.length < b.length || a === b)
            return !0;
        for (var c = 0; c < a.length; c++) {
            var d = a[c]
              , e = b[c];
            if (d > e)
                return !1;
            if (d < e)
                return !0
        }
        c = se;
        ue("Assertion fail:", "isInRange weird case. Value was: " + a + ". Boundary was: " + b + "." || c)
    }
    function He(a) {
        if (typeof a === Da)
            return a % BigInt(2) === BigInt(Ge()) ? (console.error("isGbigint: got a `bigint` when we were expecting a `string`. Make sure to call `toGbigint()` when creating `gbigint` instances!"),
            !1) : !0;
        if (Ae(a)) {
            if (!/^(?:-?[1-9]\d*|0)$/.test(a))
                return !1;
            if (Number(a[a.length - 1]) % 2 === Ge())
                return !0;
            console.error("isGbigint: got a `string` when we were expecting a `bigint`. Make sure to call `toGbigint()` when creating `gbigint` instances!")
        }
        return !1
    }
    function Ge() {
        O(!0);
        var a = typeof Window === k && globalThis.top instanceof Window ? globalThis.top : globalThis;
        a.gbigintUseStrInDebugToggleVal == null && Object.defineProperties(a, {
            gbigintUseStrInDebugToggleVal: {
                value: Math.round(Math.random())
            }
        });
        return a.gbigintUseStrInDebugToggleVal
    }
    ;var Pe = 0
      , Qe = 0;
    function Re(a) {
        var b = a >>> 0;
        Pe = b;
        Qe = (a - b) / 4294967296 >>> 0
    }
    function Se(a) {
        if (a < 0) {
            Re(0 - a);
            var b = A(Te(Pe, Qe));
            a = b.next().value;
            b = b.next().value;
            Pe = a >>> 0;
            Qe = b >>> 0
        } else
            Re(a)
    }
    function Ue(a, b) {
        b >>>= 0;
        a >>>= 0;
        if (b <= 2097151)
            var c = "" + (4294967296 * b + a);
        else
            sd() ? c = "" + (BigInt(b) << BigInt(32) | BigInt(a)) : (c = (a >>> 24 | b << 8) & 16777215,
            b = b >> 16 & 65535,
            a = (a & 16777215) + c * 6777216 + b * 6710656,
            c += b * 8147497,
            b *= 2,
            a >= 1E7 && (c += a / 1E7 >>> 0,
            a %= 1E7),
            c >= 1E7 && (b += c / 1E7 >>> 0,
            c %= 1E7),
            E(b),
            c = b + Ve(c) + Ve(a));
        return c
    }
    function Ve(a) {
        a = String(a);
        return "0000000".slice(a.length) + a
    }
    function We() {
        var a = Pe
          , b = Qe;
        b & 2147483648 ? sd() ? a = "" + (BigInt(b | 0) << BigInt(32) | BigInt(a >>> 0)) : (b = A(Te(a, b)),
        a = b.next().value,
        b = b.next().value,
        a = "-" + Ue(a, b)) : a = Ue(a, b);
        return a
    }
    function Te(a, b) {
        b = ~b;
        a ? a = ~a + 1 : b += 1;
        return [a, b]
    }
    ;function Xe(a) {
        return Array.prototype.slice.call(a)
    }
    ;var Ye = typeof BigInt === k ? BigInt.asIntN : void 0
      , Ze = Number.isSafeInteger
      , $e = Number.isFinite
      , af = Math.trunc;
    function bf(a) {
        if (a == null || typeof a === n)
            return a;
        if (a === "NaN" || a === "Infinity" || a === "-Infinity")
            return Number(a)
    }
    function cf(a) {
        return a.displayName || a.name || hb
    }
    var df = /^-?([1-9][0-9]*|0)(\.[0-9]+)?$/;
    function ef(a) {
        switch (typeof a) {
        case Da:
            return !0;
        case n:
            return $e(a);
        case v:
            return df.test(a);
        default:
            return !1
        }
    }
    function ff(a) {
        if (!$e(a))
            throw rd("Expected enum as finite number but got " + Zb(a) + ": " + a);
        return a | 0
    }
    function gf(a) {
        if (a == null)
            return a;
        if (typeof a === v && a)
            a = +a;
        else if (typeof a !== n)
            return;
        return $e(a) ? a | 0 : void 0
    }
    function hf(a) {
        E(a.indexOf(".") === -1);
        var b = a.length;
        if (a[0] === "-" ? b < 20 || b === 20 && a <= "-9223372036854775808" : b < 19 || b === 19 && a <= "9223372036854775807")
            return a;
        E(a.length > 0);
        if (a.length < 16)
            Se(Number(a));
        else if (sd())
            a = BigInt(a),
            Pe = Number(a & BigInt(4294967295)) >>> 0,
            Qe = Number(a >> BigInt(32) & BigInt(4294967295));
        else {
            E(a.length > 0);
            b = +(a[0] === "-");
            Qe = Pe = 0;
            for (var c = a.length, d = 0 + b, e = (c - b) % 6 + b; e <= c; d = e,
            e += 6)
                d = Number(a.slice(d, e)),
                Qe *= 1E6,
                Pe = Pe * 1E6 + d,
                Pe >= 4294967296 && (Qe += Math.trunc(Pe / 4294967296),
                Qe >>>= 0,
                Pe >>>= 0);
            b && (b = A(Te(Pe, Qe)),
            a = b.next().value,
            b = b.next().value,
            Pe = a,
            Qe = b)
        }
        return We()
    }
    function jf(a, b) {
        E(ef(a));
        E(b || !0);
        a = af(a);
        Ze(a) ? a = String(a) : (E(!Ze(a)),
        E(Number.isInteger(a)),
        Se(a),
        a = We());
        return a
    }
    function kf(a) {
        E(typeof a === Da);
        return Fe(Ye(64, a))
    }
    function lf(a, b) {
        b = b === void 0 ? !1 : b;
        var c = typeof a;
        if (a == null)
            return a;
        if (c === Da)
            return String(Ye(64, a));
        if (ef(a)) {
            if (c === v)
                return E(ef(a)),
                E(b || !0),
                b = af(Number(a)),
                Ze(b) ? b = String(b) : (b = a.indexOf("."),
                b !== -1 && (a = a.substring(0, b)),
                b = hf(a)),
                b;
            a = ve(a, ze);
            return jf(a, b)
        }
    }
    function mf(a) {
        var b = typeof a;
        if (a == null)
            return a;
        if (b === Da)
            return kf(a);
        if (ef(a)) {
            if (b === v)
                return b = af(Number(a)),
                Ze(b) ? a = Fe(b) : (b = a.indexOf("."),
                b !== -1 && (a = a.substring(0, b)),
                a = sd() ? kf(BigInt(a)) : Fe(hf(a))),
                a;
            a = ve(a, ze);
            if (Ze(a)) {
                E(ef(a));
                E(!0);
                a = af(a);
                if (!Ze(a)) {
                    E(!Ze(a));
                    E(Number.isInteger(a));
                    Se(a);
                    b = Pe;
                    var c = Qe;
                    if (a = c & 2147483648)
                        b = ~b + 1 >>> 0,
                        c = ~c >>> 0,
                        b == 0 && (c = c + 1 >>> 0);
                    var d = c * 4294967296 + (b >>> 0);
                    b = Number.isSafeInteger(d) ? d : Ue(b, c);
                    a = typeof b === n ? a ? -b : b : a ? "-" + b : b
                }
                a = Fe(a)
            } else
                a = Fe(jf(a, !0));
            return a
        }
    }
    function nf(a) {
        return a == null || typeof a === v ? a : void 0
    }
    function of(a, b, c, d) {
        if (Xd(a))
            return a;
        if (!Array.isArray(a))
            return c ? d & 2 ? b[xd] || (b[xd] = pf(b)) : new b : void 0;
        c = Kd(a);
        d = c | d & 32 | d & 2;
        d !== c && Jd(a, d);
        return new b(a)
    }
    function pf(a) {
        a = new a;
        E(N(a));
        var b = L ? a[F(M)] : a.G;
        Od(b);
        return a
    }
    ;function qf(a) {
        return a
    }
    qf[Cd] = {};
    function rf(a) {
        return a
    }
    ;function sf() {
        throw Error("please construct maps as mutable then call toImmutable");
    }
    if (ge) {
        var tf = function() {
            throw Error("Cannot perform instanceof checks on ImmutableMap: please use isImmutableMap or isMutableMap to assert on the mutability of a map. See go/jspb-api-gotchas#immutable-classes for more information");
        }
          , uf = {};
        Object.defineProperties(sf, (uf[Symbol.hasInstance] = {
            value: tf,
            configurable: !1,
            writable: !1,
            enumerable: !1
        },
        uf));
        E(sf[Symbol.hasInstance] === tf, "defineProperties did not work: was it monkey-patched?")
    }
    ;function vf() {}
    function wf(a, b) {
        for (var c in a)
            !isNaN(c) && b(a, +c, G(a[c]))
    }
    function xf(a) {
        var b = new vf;
        wf(a, function(c, d, e) {
            b[d] = Xe(e)
        });
        b.g = a.g;
        return b
    }
    function yf(a, b) {
        if (!(b < 100) && Ad != null) {
            var c;
            a = (c = qd) != null ? c : qd = {};
            c = a[Ad] || 0;
            c >= 1 || (a[Ad] = c + 1,
            b = Error("0ubs:" + b),
            od(b, ab, Ma),
            vc(b))
        }
    }
    ;function zf(a, b, c, d, e) {
        var f = d !== void 0;
        d = !!d;
        var g = ic(zd), h;
        !f && ud && g && (h = a[g]) && wf(h, yf);
        g = [];
        var l = a.length;
        h = 4294967295;
        var m = !1
          , p = !!(b & 64);
        if (p) {
            E(b & 64);
            var r = b & 128 ? 0 : -1
        } else
            r = void 0;
        if (!(b & 1)) {
            var t = l && a[l - 1];
            t == null || typeof t !== q || t[Ed] || t.constructor !== Object ? t = void 0 : (l--,
            h = l);
            if (p && !(b & 128) && !f) {
                m = !0;
                var w;
                b = (w = Af) != null ? w : qf;
                h = Yd(b(ae(h, F(r)), F(r), a, t, e), F(r))
            }
        }
        e = void 0;
        for (w = 0; w < l; w++)
            if (b = a[w],
            b != null && (b = c(b, d)) != null)
                if (p && w >= h) {
                    Bf();
                    var K = ae(w, F(r))
                      , ba = void 0;
                    ((ba = e) != null ? ba : e = {})[K] = b
                } else
                    g[w] = b;
        if (t)
            for (var X in t)
                l = t[X],
                l != null && (l = c(l, d)) != null && (w = +X,
                b = void 0,
                p && !Number.isNaN(w) && (b = Yd(w, F(r))) < h ? (Bf(),
                g[F(b)] = l) : (w = void 0,
                ((w = e) != null ? w : e = {})[X] = l));
        e && (m ? g.push(e) : (E(h < 4294967295),
        g[h] = e));
        f && ic(zd) && (G(g),
        G(a),
        E(g[zd] === void 0),
        (a = (c = ic(zd)) ? G(a)[c] : void 0) && a instanceof vf && (g[zd] = xf(a)));
        return g
    }
    function Cf(a) {
        F(a);
        switch (typeof a) {
        case n:
            return Number.isFinite(a) ? a : "" + a;
        case Da:
            return Oe(a) ? Number(a) : "" + a;
        case Ea:
            return a ? 1 : 0;
        case q:
            if (Array.isArray(a)) {
                ie(a);
                var b = G(a, u)[I] | 0;
                return a.length === 0 && b & 1 ? void 0 : zf(a, b, Cf)
            }
            if (Xd(a))
                return Df(a);
            if (a instanceof kd) {
                b = a.g;
                if (b == null)
                    a = "";
                else if (typeof b === v)
                    a = b;
                else {
                    if (hd) {
                        for (var c = "", d = 0, e = b.length - 10240; d < e; )
                            c += String.fromCharCode.apply(null, b.subarray(d, d += 10240));
                        c += String.fromCharCode.apply(null, d ? b.subarray(d) : b);
                        b = btoa(c)
                    } else {
                        E($b(b), "encodeByteArray takes an array as a parameter");
                        c === void 0 && (c = 0);
                        if (!fd) {
                            fd = {};
                            d = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".split("");
                            e = ["+/=", "+/", "-_=", "-_.", "-_"];
                            for (var f = 0; f < 5; f++) {
                                var g = d.concat(e[f].split(""));
                                ed[f] = g;
                                for (var h = 0; h < g.length; h++) {
                                    var l = g[h]
                                      , m = fd[l];
                                    m === void 0 ? fd[l] = h : E(m === h)
                                }
                            }
                        }
                        c = ed[c];
                        d = Array(Math.floor(b.length / 3));
                        e = c[64] || "";
                        for (f = g = 0; g < b.length - 2; g += 3) {
                            m = b[g];
                            var p = b[g + 1];
                            l = b[g + 2];
                            h = c[m >> 2];
                            m = c[(m & 3) << 4 | p >> 4];
                            p = c[(p & 15) << 2 | l >> 6];
                            l = c[l & 63];
                            d[f++] = "" + h + m + p + l
                        }
                        h = 0;
                        l = e;
                        switch (b.length - g) {
                        case 2:
                            h = b[g + 1],
                            l = c[(h & 15) << 2] || e;
                        case 1:
                            b = b[g],
                            d[f] = "" + c[b >> 2] + c[(b & 3) << 4 | h >> 4] + l + e
                        }
                        b = d.join("")
                    }
                    a = a.g = b
                }
                return a
            }
            E(!(a instanceof Uint8Array));
            return
        }
        return a
    }
    var Ef = jd ? structuredClone : function(a) {
        G(a);
        return zf(a, 0, Cf)
    }
    , Af;
    function Ff(a) {
        E(!Af);
        return Df(a)
    }
    function Df(a) {
        E(N(a));
        var b = L ? a[F(M)] : a.G;
        var c = G(b, u)[I] | 0;
        J(b, c);
        return zf(b, c, Cf, void 0, a.constructor)
    }
    function Bf() {
        var a, b = (a = Af) != null ? a : qf;
        E(b !== rf)
    }
    ;var Gf = new WeakMap
      , Hf = new WeakSet;
    function If(a) {
        if (a != null)
            if (Array.isArray(a))
                Jf(a);
            else if (!(typeof a !== q || a instanceof kd)) {
                for (var b in a) {
                    var c = a[b];
                    a.hasOwnProperty(b) && (delete a[b],
                    If(c))
                }
                Object.defineProperty(a, "dontUseThisItBelongsToJspb", {
                    enumerable: !0,
                    get: Kf
                });
                a.toJSON = Kf;
                Lf && Object.setPrototypeOf(a, Lf);
                Object.freeze(a)
            }
    }
    var Lf;
    if (typeof Proxy !== "undefined") {
        var Mf = Kf;
        Lf = new Proxy({},{
            getPrototypeOf: Mf,
            setPrototypeOf: Mf,
            isExtensible: Mf,
            preventExtensions: Mf,
            getOwnPropertyDescriptor: Mf,
            defineProperty: Mf,
            has: Mf,
            get: Mf,
            set: Mf,
            deleteProperty: Mf,
            apply: Mf,
            construct: Mf
        })
    }
    function Jf(a) {
        if (!Hf.has(a)) {
            Hf.add(a);
            for (var b = 0; b < a.length; b++)
                If(a[b]);
            if (!Object.isExtensible(a))
                throw Error("cannot transfer a frozen or sealed array");
            a.length = 1;
            a[0] = Kf;
            a.toJSON = Kf;
            Lf && Object.setPrototypeOf(a, Lf);
            Object.freeze(a)
        }
    }
    function Kf(a, b) {
        if (b === Ed)
            return !0;
        throw Error("this array or object is owned by JSPB and should not be reused, did you mean to copy it with copyJspbArray? See go/jspb-api-gotchas#construct_from_array");
    }
    function Nf(a) {
        if (Gf.has(a))
            return Gf.get(a);
        var b = zf(a, 0, function(c) {
            var d = Gf.get(c);
            if (d)
                return d;
            if (c != null && typeof c === q && Hf.has(c))
                throw Error("already transferred");
            return Array.isArray(c) ? Nf(c) : c
        });
        Gf.set(a, b);
        return b
    }
    ;function Of(a, b, c, d) {
        d = d === void 0 ? 0 : d;
        if (a != null)
            for (var e = 0; e < a.length; e++) {
                var f = a[e];
                Array.isArray(f) && ie(f)
            }
        if (a == null)
            e = 32,
            c ? (a = [c],
            e |= 128) : a = [],
            b && (e = Pd(e, b));
        else {
            if (!Array.isArray(a))
                throw Error("data passed to JSPB constructors must be an Array, got '" + JSON.stringify(a) + "' a " + Zb(a));
            e = G(a, u)[I] | 0;
            if (Fc && 1 & e)
                throw Error("Array passed to JSPB constructor is a repeated field array that belongs to another proto instance.");
            2048 & e && !(2 & e) && Pf();
            if (Object.isFrozen(a) || !Object.isExtensible(a) || Object.isSealed(a))
                throw Error("data passed to JSPB constructors must be mutable");
            if (e & 256)
                throw Error("farr");
            if (e & 64)
                return (e | d) !== e && Jd(a, e |= d),
                J(a, e),
                a;
            if (c && (e |= 128,
            c !== a[0]))
                throw Error('Expected message to have a message id: "' + c + '" in the array, got: ' + JSON.stringify(a[0]) + " a " + Zb(a[0]) + ", are you parsing with the wrong proto?");
            a: {
                c = a;
                e |= 64;
                var g = c.length;
                if (g) {
                    var h = g - 1;
                    f = c[h];
                    if (f != null && typeof f === q && !f[Ed] && f.constructor === Object) {
                        b = Qd(e);
                        g = ae(h, b);
                        if (g >= 1024)
                            throw Error("Found a message with a sparse object at fieldNumber " + g + " is >= the limit 1024");
                        for (var l in f)
                            h = +l,
                            h < g && (h = Yd(h, b),
                            E(c[h] == null),
                            c[h] = f[l],
                            delete f[l]);
                        e = Pd(e, g);
                        break a
                    }
                }
                if (b) {
                    l = Math.max(b, ae(g, Qd(e)));
                    if (l > 1024)
                        throw Error("a message was constructed with an array of length " + g + " which is longer than 1024, are you using a supported serializer?");
                    e = Pd(e, l)
                }
            }
        }
        Jd(a, e | 64 | d);
        return a
    }
    function Pf() {
        if (Fc)
            throw Error("Array passed to JSPB constructor already belongs to another JSPB proto instance");
    }
    ;function Qf(a) {
        E(!(2 & a));
        E(!(2048 & a));
        return !(4096 & a) && !(16 & a)
    }
    function Rf(a, b) {
        F(a);
        if (typeof a !== q)
            return a;
        if (Array.isArray(a)) {
            ie(a);
            var c = G(a, u)[I] | 0;
            a.length === 0 && c & 1 ? a = void 0 : c & 2 || (b && Qf(c) ? (Ld(a, 34),
            c & 4 && Object.freeze(a)) : a = Sf(a, c, !1, b && !(c & 16)));
            return a
        }
        if (Xd(a))
            return E(Xd(a)),
            b = Td(a),
            c = Md(b),
            be(a, c) ? a : Tf(a, b, c) ? Uf(a, b) : Sf(b, c);
        if (a instanceof kd)
            return a;
        E(!(a instanceof Uint8Array))
    }
    function Uf(a, b, c) {
        a = new a.constructor(b);
        c && ee(a, !0);
        a.g = de;
        return a
    }
    function Sf(a, b, c, d) {
        E(b === (G(a, u)[I] | 0));
        d != null || (d = !!(34 & b));
        a = zf(a, b, Rf, d);
        d = 32;
        c && (d |= 2);
        b = b & 16769217 | d;
        Jd(a, b);
        return a
    }
    function Vf(a) {
        E(N(a));
        var b = L ? a[F(M)] : a.G;
        var c = G(b, u)[I] | 0;
        J(b, c);
        return be(a, c) ? Tf(a, b, c) ? Uf(a, b, !0) : new a.constructor(Sf(b, c, !1)) : a
    }
    function Wf(a) {
        if (!ce(a))
            return !1;
        var b;
        E(N(a));
        var c = b = L ? a[F(M)] : a.G
          , d = G(c, u)[I] | 0;
        J(c, d);
        E(d & 2);
        b = Sf(b, d);
        Ld(b, 2048);
        E(N(a));
        G(b);
        L ? a[F(M)] = b : a.G = b;
        ee(a, !1);
        a.g = void 0;
        return !0
    }
    function Xf(a) {
        var b;
        if (b = !Wf(a)) {
            E(N(a));
            b = L ? a[F(M)] : a.G;
            var c = G(b, u)[I] | 0;
            J(b, c);
            b = be(a, c)
        }
        if (b)
            throw Error("Cannot mutate an immutable Message");
    }
    function Yf(a, b) {
        if (b === void 0)
            b = G(a, u)[I] | 0,
            J(a, b, !0);
        else {
            var c = G(a, u)[I] | 0;
            J(a, c, !0);
            E(b === c)
        }
        E(!(b & 2));
        b & 32 && !(b & 4096) && Jd(a, b | 4096)
    }
    function Tf(a, b, c) {
        return fe && a[fe] ? !1 : c & 2 ? !0 : c & 32 && !(c & 4096) ? (Jd(b, c | 2),
        ee(a, !0),
        !0) : !1
    }
    ;var Zf = Fe(0)
      , $f = {};
    function ag(a, b, c, d, e) {
        E(Object.isExtensible(a));
        E(N(a));
        var f = L ? a[F(M)] : a.G;
        b = bg(f, b, c, e);
        (c = b !== null) || (d && (a = a.g,
        E(a === void 0 || a === de),
        d = a !== de),
        c = d);
        if (c)
            return b
    }
    function bg(a, b, c, d) {
        oe(a, c);
        if (b === -1)
            return null;
        var e = Zd(b, c);
        E(e === Yd(b, Qd(G(a, u)[I] | 0)));
        E(e >= 0);
        var f = a.length - 1;
        if (!(f < Zd(1, c))) {
            if (e >= f) {
                var g = a[f];
                if (g == null || typeof g !== q || g[Ed] || g.constructor !== Object)
                    if (e === f)
                        c = g;
                    else
                        return;
                else {
                    c = g[b];
                    var h = !0
                }
            } else
                c = a[e];
            if (d && c != null) {
                d = d(c);
                if (d == null)
                    return d;
                if (!Object.is(d, c))
                    return h ? g[b] = d : a[e] = d,
                    d
            }
            return c
        }
    }
    function cg(a, b, c) {
        Xf(a);
        E(N(a));
        var d = L ? a[F(M)] : a.G;
        var e = G(d, u)[I] | 0;
        J(d, e);
        dg(d, e, b, c);
        return a
    }
    function dg(a, b, c, d, e) {
        oe(a, e);
        var f = Zd(c, e);
        E(f === Yd(c, Qd(G(a, u)[I] | 0)));
        E(f >= 0);
        var g = a.length - 1;
        if (g >= Zd(1, e) && f >= g) {
            var h = a[g];
            if (h != null && typeof h === q && !h[Ed] && h.constructor === Object)
                return h[c] = d,
                b
        }
        if (f <= g)
            return a[f] = d,
            b;
        d !== void 0 && ((g = b) == null && (b = G(a, u)[I] | 0,
        J(a, b),
        g = b),
        E(g & 64),
        g = g >> 14 & 1023 || 536870912,
        c >= g ? (E(g !== 536870912),
        d != null && (f = {},
        a[Zd(g, e)] = (f[c] = d,
        f))) : a[f] = d);
        return b
    }
    function eg(a, b) {
        if (!a)
            return a;
        E(Nd(b) ? be(a) : !0);
        return a
    }
    function fg(a, b, c) {
        c = c === void 0 ? !1 : c;
        ie(a, c);
        var d = G(a, u)[I] | 0;
        E(d & 1);
        c || (E(Object.isFrozen(a) || d & 16),
        E(Nd(b) ? Object.isFrozen(a) : !0))
    }
    function gg(a, b, c, d, e, f, g, h) {
        var l = b;
        f === 1 || (f !== 4 ? 0 : 2 & b || !(16 & b) && 32 & d) ? hg(b) || (e = !a.length || g && !(4096 & b) || !!(32 & d) && Qf(b),
        b |= e ? 2 : 256,
        b !== l && Jd(a, b),
        Object.freeze(a)) : (f === 2 && hg(b) && (a = Xe(a),
        l = 0,
        b = ig(b, d),
        d = F(dg(c, d, e, a))),
        hg(b) || (h || (b |= 16),
        b !== l && Jd(a, b)));
        2 & b || Qf(b) || Yf(c, d);
        return a
    }
    function jg(a, b) {
        a = bg(a, b);
        return Array.isArray(a) ? a : Hd
    }
    function kg(a, b) {
        2 & b && (a |= 2);
        return a | 1
    }
    function hg(a) {
        return !!(2 & a) && !!(4 & a) || !!(256 & a)
    }
    function lg(a) {
        a != null && (typeof a === v ? (qc(a),
        a = a ? new kd(a,id) : md()) : a.constructor !== kd && (gd && a != null && a instanceof Uint8Array ? (E(a instanceof Uint8Array || Array.isArray(a)),
        a = a.length ? new kd(new Uint8Array(a),id) : md()) : a = void 0));
        return a
    }
    function mg(a, b, c) {
        return ng(a, b) === c ? c : -1
    }
    function ng(a, b) {
        E(N(a));
        a = L ? a[F(M)] : a.G;
        return og(pg(a), a, b)
    }
    function pg(a) {
        if (ud) {
            var b;
            return (b = a[yd]) != null ? b : a[yd] = new Map
        }
        if (yd in a)
            return tc(a[yd], Map);
        b = new Map;
        Object.defineProperty(a, yd, {
            value: b
        });
        return b
    }
    function og(a, b, c) {
        var d = void 0;
        oe(b);
        var e = a.get(c);
        if (e != null)
            return e;
        for (var f = e = 0; f < c.length; f++) {
            var g = c[f];
            bg(b, g) != null && (e !== 0 && (d = dg(b, d, e)),
            e = g)
        }
        a.set(c, e);
        return e
    }
    function qg(a, b, c) {
        Xf(a);
        E(N(a));
        a = L ? a[F(M)] : a.G;
        var d = G(a, u)[I] | 0;
        J(a, d);
        var e = bg(a, c)
          , f = void 0 === me;
        b = of(e, b, !f, d);
        if (!f || b)
            return b = Vf(b),
            e !== b && (d = dg(a, d, c, b),
            Yf(a, d)),
            b
    }
    function sg(a, b, c, d, e) {
        var f = !1;
        d = bg(a, d, e, function(g) {
            var h = of(g, c, !1, b);
            f = h !== g && h != null;
            return h
        });
        if (d != null)
            return f && !be(d) && Yf(a, b),
            eg(d, a)
    }
    function tg(a, b, c) {
        E(N(a));
        a = L ? a[F(M)] : a.G;
        var d = G(a, u)[I] | 0;
        J(a, d);
        return sg(a, d, b, c) || b[xd] || (b[xd] = pf(b))
    }
    function ug(a, b, c, d) {
        E(N(a));
        var e = L ? a[F(M)] : a.G;
        var f = G(e, u)[I] | 0;
        J(e, f);
        b = sg(e, f, b, c, d);
        if (b == null)
            return b;
        f = G(e, u)[I] | 0;
        J(e, f);
        var g = f;
        be(a, g) || (f = Vf(b),
        f !== b && (Wf(a) && (E(N(a)),
        e = L ? a[F(M)] : a.G,
        a = G(e, u)[I] | 0,
        J(e, a),
        g = a),
        b = f,
        g = dg(e, g, c, b, d),
        Yf(e, g)));
        return eg(b, e)
    }
    function vg(a, b, c) {
        var d = void 0 === ke ? 2 : 4;
        E(N(a));
        var e = L ? a[F(M)] : a.G;
        var f = G(e, u)[I] | 0;
        J(e, f);
        var g = f;
        f = !1;
        var h = be(a, g);
        d = h ? 1 : d;
        f = !!f || d === 3;
        var l = !h;
        (d === 2 || l) && Wf(a) && (E(N(a)),
        a = e = L ? a[F(M)] : a.G,
        g = G(a, u)[I] | 0,
        J(a, g));
        a = jg(e, c);
        var m = a === Hd ? 7 : G(a, u)[I] | 0
          , p = kg(m, g);
        if (h = !(4 & p)) {
            var r = a
              , t = g
              , w = !!(2 & p);
            w && (t |= 2);
            for (var K = !w, ba = !0, X = 0, Ka = 0; X < r.length; X++) {
                var ma = of(r[X], b, !1, t);
                if (ma instanceof b) {
                    if (!w) {
                        var Ra = be(ma);
                        K && (K = !Ra);
                        ba && (ba = Ra)
                    }
                    r[Ka++] = ma
                }
            }
            Ka < X && (r.length = Ka);
            p |= 4;
            p = ba ? p & -4097 : p | 4096;
            p = K ? p | 8 : p & -9
        }
        p !== m && (Jd(a, p),
        2 & p && Object.freeze(a));
        if (l && !(8 & p || !a.length && (d === 1 || (d !== 4 ? 0 : 2 & p || !(16 & p) && 32 & g)))) {
            hg(p) && (a = Xe(a),
            p = ig(p, g),
            g = F(dg(e, g, c, a)));
            b = a;
            l = p;
            for (m = 0; m < b.length; m++)
                r = b[m],
                p = Vf(r),
                r !== p && (b[m] = p);
            l |= 8;
            p = l = b.length ? l | 4096 : l & -4097;
            Jd(a, p)
        }
        a = gg(a, p, e, g, c, d, h, f);
        if (!f) {
            c = a;
            d = d === 2;
            d = d === void 0 ? !1 : d;
            f = Nd(e);
            g = Nd(c);
            b = Object.isFrozen(c) && g;
            fg(c, e, d);
            if (f || g)
                d ? E(g) : E(b);
            E(!!((G(c, u)[I] | 0) & 4));
            if (g && c.length)
                for (d = 0; d < 1; d++)
                    eg(c[d], e)
        }
        return a
    }
    function ig(a, b) {
        return a = (2 & b ? a | 2 : a & -3) & -273
    }
    function wg(a, b, c) {
        a = ag(a, b, void 0, c);
        return a == null ? a : $e(a) ? a | 0 : void 0
    }
    function xg(a, b) {
        var c = c === void 0 ? !1 : c;
        a = ag(a, b);
        a = a == null || typeof a === Ea ? a : typeof a === n ? !!a : void 0;
        return a != null ? a : c
    }
    function yg(a, b, c) {
        c = c === void 0 ? 0 : c;
        var d;
        return (d = gf(ag(a, b))) != null ? d : c
    }
    function zg(a, b) {
        var c = c === void 0 ? Zf : c;
        a = td() ? mf(ag(a, b)) : ag(a, b, void 0, void 0, mf);
        return a != null ? a : c
    }
    function P(a, b) {
        var c = c === void 0 ? "" : c;
        var d;
        return (d = nf(ag(a, b))) != null ? d : c
    }
    function Ag(a, b) {
        var c = c === void 0 ? 0 : c;
        var d;
        return (d = wg(a, b)) != null ? d : c
    }
    function Bg(a, b) {
        return nf(ag(a, b, void 0, $f))
    }
    function Cg(a, b, c) {
        if (c != null && typeof c !== v)
            throw Error("Expected a string or null or undefined but got " + c + " a " + Zb(c));
        return cg(a, b, c)
    }
    function Dg(a, b, c) {
        return cg(a, b, c == null ? c : ff(c))
    }
    ;E(!0);
    function Eg(a, b, c) {
        this.preventPassingToStructuredClone = he;
        tc(this, Eg, "The message constructor should only be used by subclasses");
        E(this.constructor !== Eg, "Message is an abstract class and cannot be directly constructed");
        var d = this.constructor, e;
        if (a && ((e = a[Dd]) != null ? e : a[Dd] = d) !== d)
            throw Error("data must only be constructed with one message type");
        a = Of(a, b, c, 2048);
        E(N(this));
        G(a);
        L ? this[F(M)] = a : this.G = a;
        E(N(this));
        a = L ? this[F(M)] : this.G;
        b = G(a, u)[I] | 0;
        J(a, b);
        E(b & 64);
        E(b & 2048)
    }
    Eg.prototype.toJSON = function() {
        return Ff(this)
    }
    ;
    function Fg(a, b) {
        rc(a);
        if (b == null || b == "")
            return tc(new a, Eg);
        qc(b);
        b = JSON.parse(b);
        if (!Array.isArray(b))
            throw Error("Expected to deserialize an Array but got " + Zb(b) + ": " + b);
        Ld(b, 32);
        return new a(b)
    }
    Eg.prototype.clone = function() {
        var a = tc(this, Eg);
        E(Xd(a));
        var b = Td(a)
          , c = Md(b);
        return Tf(a, b, c) ? Uf(a, b, !0) : new a.constructor(Sf(b, c, !1))
    }
    ;
    function Gg() {
        var a = C;
        a = a === void 0 ? window : a;
        var b = new Hg(Ig("K1cgmc", a));
        a = Jg;
        var c = new Jg;
        b = Kg(b);
        b === null ? a = c : (E(b.startsWith("%.@."), na),
        a = Fg(a, "[" + b.substring(4)));
        E(N(a));
        c = L ? a[F(M)] : a.G;
        b = G(c, u)[I] | 0;
        J(c, b);
        return be(a, b) ? a : Tf(a, c, b) ? Uf(a, c) : new a.constructor(Sf(c, b, !0))
    }
    Ud = Eg;
    Eg.prototype.ub = 1;
    Eg.prototype[Bd] = Wd;
    Eg.prototype.toString = function() {
        E(N(this));
        return (L ? this[F(M)] : this.G).toString()
    }
    ;
    function Lg(a, b) {
        tc(a, Eg);
        E(be(a));
        if (b == null)
            b = a.constructor,
            b = b[xd] || (b[xd] = pf(b));
        else {
            a = a.constructor;
            if (Gf == null ? 0 : Gf.has(b))
                b = Gf.get(b);
            else {
                if (Hf == null ? 0 : Hf.has(b))
                    throw Error("this array was already transferred");
                if (!Array.isArray(b))
                    throw Error("must be an array");
                if (Object.isFrozen(b) || Object.isSealed(b) || !Object.isExtensible(b))
                    throw Error("arrays passed to jspb constructors must be mutable");
                var c = Nf(b);
                Jf(b);
                b = c
            }
            b = new a(Od(b))
        }
        tc(b, Eg);
        return b
    }
    ;function Mg(a) {
        var b = Jg;
        E(a > 0);
        this.ctor = b;
        this.defaultValue = void 0;
        E(!0, "lazyParse must be undefined or LAZILY_PARSE_LATE_LOADED_EXTENSIONS_SYMBOL")
    }
    Mg.prototype.register = function() {
        Zc(this)
    }
    ;
    function Ng(a) {
        if (a instanceof Eg)
            return a.constructor.L
    }
    ;(function() {
        var a = C.jspbGetTypeName;
        C.jspbGetTypeName = a ? function(b) {
            return a(b) || Ng(b)
        }
        : Ng
    }
    )();
    var Q = Eg;
    function Og(a) {
        return function(b) {
            return Fg(a, b)
        }
    }
    function Pg(a) {
        var b = {};
        return a[ne] = b
    }
    ;function Qg(a) {
        Q.call(this, a)
    }
    z(Qg, Q);
    Qg.prototype.getTypeName = function() {
        return P(this, 1).split("/").pop()
    }
    ;
    var Rg = function(a) {
        return we(function(b) {
            return b instanceof a && !be(b)
        }, function() {
            var b = a.L;
            b || (b = (b = a.displayName) ? b : a.name || "");
            return "MutableMessage:" + b
        })
    }(Qg);
    Qg.L = "google.protobuf.Any";
    function Sg(a, b) {
        this.key = a;
        this.defaultValue = !1;
        this.flagNameForDebugging = b;
        this.phase = 2
    }
    Sg.prototype.ctor = function(a) {
        return typeof a === Ea ? a : this.defaultValue
    }
    ;
    function Tg() {
        var a = Ug('[["feature named `pageObserver` was not found","feature named `hover` was not found"]]')
          , b = Vg;
        this.key = "45696263";
        this.defaultValue = a;
        this.g = b;
        this.flagNameForDebugging = "AppsTelemetryRapidDowngradesFeature__errors_to_downgrade";
        this.phase = 2
    }
    Tg.prototype.ctor = function(a) {
        if (typeof a === v && a)
            return Fg(this.g, a);
        if (!Rg(a))
            return this.defaultValue.clone();
        var b;
        try {
            var c, d = this.g, e = (c = a.getTypeName()) != null ? c : "";
            if (P(a, 1).split("/").pop() != e)
                var f = null;
            else {
                var g = typeof d === k ? d : d.constructor
                  , h = g.L;
                if (h !== e)
                    throw Error("tried to unpack type " + h + " out of an Any with type label " + e);
                E(N(a));
                var l = L ? a[F(M)] : a.G;
                c = l;
                var m = G(c, u)[I] | 0;
                J(c, m);
                var p = m;
                var r = bg(l, 2);
                if (Wf(a)) {
                    E(N(a));
                    m = l = L ? a[F(M)] : a.G;
                    var t = G(m, u)[I] | 0;
                    J(m, t);
                    p = t
                }
                if (r != null && !Array.isArray(r) && !Xd(r))
                    throw Error("saw an invalid value of type '" + Zb(r) + "' in the Any.value field");
                var w = of(r, g, !0, p);
                if (!(w instanceof g))
                    throw Error("incorrect type in any value: got " + w.constructor.displayName + ", expected " + g.displayName);
                (g = !!(2 & p)) || (w = Vf(w));
                r !== w && (dg(l, p, 2, w),
                g || Yf(l));
                var K = w;
                E(be(K) === be(a));
                f = K
            }
        } catch (ba) {
            f = null
        }
        return (b = f) != null ? b : this.defaultValue.clone()
    }
    ;
    function Wg(a) {
        Q.call(this, a)
    }
    z(Wg, Q);
    Wg.L = "experiments.proto.ClientFlag.SerializedProtoValue";
    var Xg = [1, 2];
    function Yg(a) {
        Q.call(this, a)
    }
    z(Yg, Q);
    Yg.L = "experiments.proto.ClientFlag";
    var Zg = [2, 3, 4, 5, 6, 8];
    function $g(a) {
        Q.call(this, a)
    }
    z($g, Q);
    $g.prototype.zb = function() {
        var a = ag(this, 3, void 0, void 0, lg);
        return a == null ? md() : a
    }
    ;
    $g.L = "experiments.proto.ClientExperimentState";
    function ah(a) {
        Q.call(this, a)
    }
    z(ah, Q);
    var bh = Og(ah);
    ah.L = "experiments.proto.ClientExperimentPayload";
    function Vg(a) {
        Q.call(this, a)
    }
    z(Vg, Q);
    var Ug = Og(Vg);
    Vg.L = "experiments.proto.StringListParam";
    function ch(a, b) {
        this.J = a | 0;
        this.F = b | 0
    }
    function dh(a) {
        return a.F * 4294967296 + (a.J >>> 0)
    }
    x = ch.prototype;
    x.isSafeInteger = function() {
        var a = this.F >> 21;
        return a == 0 || a == -1 && !(this.J == 0 && this.F == -2097152)
    }
    ;
    x.toString = function(a) {
        a = a || 10;
        if (a < 2 || 36 < a)
            throw Error("radix out of range: " + a);
        if (this.isSafeInteger()) {
            var b = dh(this);
            return a == 10 ? "" + b : b.toString(a)
        }
        b = 14 - (a >> 2);
        var c = Math.pow(a, b)
          , d = eh(c, c / 4294967296);
        c = this.div(d);
        var e = Math
          , f = e.abs;
        d = c.multiply(d);
        d = this.add(fh(d));
        e = f.call(e, dh(d));
        f = a == 10 ? "" + e : e.toString(a);
        f.length < b && (f = "0000000000000".slice(f.length - b) + f);
        e = dh(c);
        return (a == 10 ? e : e.toString(a)) + f
    }
    ;
    function gh(a) {
        return a.J == 0 && a.F == 0
    }
    x.ha = function() {
        return this.J ^ this.F
    }
    ;
    x.equals = function(a) {
        return a == null ? !1 : this.J == a.J && this.F == a.F
    }
    ;
    x.compare = function(a) {
        return this.F == a.F ? this.J == a.J ? 0 : this.J >>> 0 > a.J >>> 0 ? 1 : -1 : this.F > a.F ? 1 : -1
    }
    ;
    function fh(a) {
        var b = ~a.J + 1 | 0;
        return eh(b, ~a.F + !b | 0)
    }
    x.add = function(a) {
        var b = this.F >>> 16
          , c = this.F & 65535
          , d = this.J >>> 16
          , e = a.F >>> 16
          , f = a.F & 65535
          , g = a.J >>> 16;
        a = (this.J & 65535) + (a.J & 65535);
        g = (a >>> 16) + (d + g);
        d = g >>> 16;
        d += c + f;
        return eh((g & 65535) << 16 | a & 65535, ((d >>> 16) + (b + e) & 65535) << 16 | d & 65535)
    }
    ;
    x.multiply = function(a) {
        if (gh(this))
            return this;
        if (gh(a))
            return a;
        var b = this.F >>> 16
          , c = this.F & 65535
          , d = this.J >>> 16
          , e = this.J & 65535
          , f = a.F >>> 16
          , g = a.F & 65535
          , h = a.J >>> 16;
        a = a.J & 65535;
        var l = e * a;
        var m = (l >>> 16) + d * a;
        var p = m >>> 16;
        m = (m & 65535) + e * h;
        p += m >>> 16;
        p += c * a;
        var r = p >>> 16;
        p = (p & 65535) + d * h;
        r += p >>> 16;
        p = (p & 65535) + e * g;
        r = r + (p >>> 16) + (b * a + c * h + d * g + e * f) & 65535;
        return eh((m & 65535) << 16 | l & 65535, r << 16 | p & 65535)
    }
    ;
    x.div = function(a) {
        if (gh(a))
            throw Error("division by zero");
        if (this.F < 0) {
            if (this.equals(hh)) {
                if (a.equals(ih) || a.equals(jh))
                    return hh;
                if (a.equals(hh))
                    return ih;
                var b = this.F;
                b = eh(this.J >>> 1 | b << 31, b >> 1);
                b = b.div(a).shiftLeft(1);
                if (b.equals(kh))
                    return a.F < 0 ? ih : jh;
                var c = a.multiply(b);
                c = this.add(fh(c));
                return b.add(c.div(a))
            }
            return a.F < 0 ? fh(this).div(fh(a)) : fh(fh(this).div(a))
        }
        if (gh(this))
            return kh;
        if (a.F < 0)
            return a.equals(hh) ? kh : fh(this.div(fh(a)));
        b = kh;
        for (c = this; c.compare(a) >= 0; ) {
            var d = Math.max(1, Math.floor(dh(c) / dh(a)))
              , e = Math.ceil(Math.log(d) / Math.LN2);
            e = e <= 48 ? 1 : Math.pow(2, e - 48);
            for (var f = lh(d), g = f.multiply(a); g.F < 0 || g.compare(c) > 0; )
                d -= e,
                f = lh(d),
                g = f.multiply(a);
            gh(f) && (f = ih);
            b = b.add(f);
            c = c.add(fh(g))
        }
        return b
    }
    ;
    x.and = function(a) {
        return eh(this.J & a.J, this.F & a.F)
    }
    ;
    x.or = function(a) {
        return eh(this.J | a.J, this.F | a.F)
    }
    ;
    x.xor = function(a) {
        return eh(this.J ^ a.J, this.F ^ a.F)
    }
    ;
    x.shiftLeft = function(a) {
        a &= 63;
        if (a == 0)
            return this;
        var b = this.J;
        return a < 32 ? eh(b << a, this.F << a | b >>> 32 - a) : eh(0, b << a - 32)
    }
    ;
    function lh(a) {
        return a > 0 ? a >= 0x7fffffffffffffff ? mh : new ch(a,a / 4294967296) : a < 0 ? a <= -0x7fffffffffffffff ? hh : fh(new ch(-a,-a / 4294967296)) : kh
    }
    function eh(a, b) {
        return new ch(a,b)
    }
    var kh = eh(0, 0)
      , ih = eh(1, 0)
      , jh = eh(-1, -1)
      , mh = eh(4294967295, 2147483647)
      , hh = eh(0, 2147483648);
    function nh(a) {
        E(Ie(a), "Expected a gbigint, got " + a + " of type " + typeof a);
        E(Oe(a), "Expected a safe int52, got " + a);
        return Oe(a) ? Number(a) : String(a)
    }
    ;function Ig(a, b) {
        b = b === void 0 ? window : b;
        b = b === void 0 ? window : b;
        return (b = b.WIZ_global_data) && a in b ? b[a] : null
    }
    ;var oh;
    function ph() {
        return oh = oh || new qh
    }
    function qh() {
        var a = null;
        this.l = !0;
        var b = Ig("TSDtV", window);
        if (b = typeof b !== v ? null : b)
            E(b.startsWith("%.@."), na),
            a = bh("[" + b.substring(4)),
            a = vg(a, $g, 1)[0];
        if (a) {
            b = A(vg(a, Yg, 2));
            for (var c = b.next(); !c.done; c = b.next()) {
                c = c.value;
                var d = Qg
                  , e = Zg;
                E(N(c));
                var f = L ? c[F(M)] : c.G;
                var g = G(f, u)[I] | 0;
                J(f, g);
                if (sg(f, g, d, mg(c, e, 6)) !== void 0)
                    throw Error("Any-serialized proto flag " + zg(c, 1) + " is not supported in TS.");
            }
        }
        if (a)
            for (b = {},
            c = A(vg(a, Yg, 2)),
            f = c.next(); !f.done; f = c.next())
                switch (g = f.value,
                f = zg(g, 1).toString(),
                ng(g, Zg)) {
                case 3:
                    b[f] = xg(g, mg(g, Zg, 3));
                    break;
                case 2:
                    b[f] = nh(zg(g, mg(g, Zg, 2)));
                    break;
                case 4:
                    d = void 0;
                    e = g;
                    var h = mg(g, Zg, 4);
                    g = void 0;
                    g = g === void 0 ? 0 : g;
                    e = (d = ag(e, h, void 0, void 0, bf)) != null ? d : g;
                    b[f] = e;
                    break;
                case 5:
                    b[f] = P(g, mg(g, Zg, 5));
                    break;
                case 6:
                    b[f] = ug(g, Qg, mg(g, Zg, 6));
                    break;
                case 8:
                    d = tg(g, Wg, mg(g, Zg, 8));
                    switch (ng(d, Xg)) {
                    case 1:
                        b[f] = P(d, mg(d, Xg, 1));
                        break;
                    default:
                        throw Error("Unrecognized serialized proto value case: " + ng(d, Xg));
                    }
                    break;
                default:
                    throw Error("Unrecognized value case: " + ng(g, Zg));
                }
        else
            b = {};
        this.g = b;
        this.j = a ? a.zb() : null
    }
    function rh(a, b) {
        return b.phase === 1 || a.l && !(b.key in a.g) ? b.defaultValue : b.ctor(a.g[b.key])
    }
    qh.prototype.zb = mb("j");
    function sh(a) {
        Q.call(this, a)
    }
    z(sh, Q);
    sh.L = "google.protobuf.Timestamp";
    var th = new Tg;
    var uh = new Sg("45723104","ChromeCrashStorageOtFeature__enable_crash_storage_ot_client");
    var vh = new Sg("45765314","UnsupportedSevereFeature__use_unsupported_severe_client");
    function wh(a) {
        Q.call(this, a)
    }
    z(wh, Q);
    wh.L = "docs.experiments.ClientExperimentFlagSetting";
    var xh = function(a) {
        return function() {
            return a[xd] || (a[xd] = pf(a))
        }
    }(wh);
    Object.create(null);
    globalThis.$J2CL_PRESERVE$ = lb();
    function R() {}
    R.prototype.equals = function(a) {
        return yh(this, a)
    }
    ;
    R.prototype.ha = function() {
        return zh(this)
    }
    ;
    R.prototype.toString = function() {
        var a = S(Ah(Bh(Ch(this)))) + "@"
          , b = this.ha();
        return a + S((b >>> 0).toString(16))
    }
    ;
    R.prototype.A = ["java.lang.Object", 0];
    function Dh() {}
    z(Dh, R);
    function Eh(a, b) {
        a.l = b;
        Fh(a)
    }
    function T(a, b) {
        a.g = b;
        Gh(b, a)
    }
    function Fh(a) {
        Hh(a.g) && (Error.captureStackTrace ? Error.captureStackTrace(U(a.g, Hh, Ih)) : U(a.g, Hh, Ih).stack = Error().stack)
    }
    Dh.prototype.toString = function() {
        var a = Ah(Bh(Ch(this)))
          , b = this.l;
        return b == null ? a : S(a) + ": " + S(b)
    }
    ;
    function Jh(a) {
        if (a != null) {
            var b = a.Qb;
            if (b != null)
                return b
        }
        a instanceof TypeError ? b = Kh() : (b = new Lh,
        Fh(b),
        T(b, Error(b)));
        b.l = a == null ? Va : a.toString();
        T(b, a);
        return b
    }
    function Mh(a) {
        return a instanceof Dh
    }
    Dh.prototype.A = ["java.lang.Throwable", 0];
    function Nh() {}
    z(Nh, Dh);
    Nh.prototype.A = ["java.lang.Exception", 0];
    function Oh() {}
    z(Oh, Nh);
    Oh.prototype.A = ["java.lang.RuntimeException", 0];
    function Ph() {}
    z(Ph, Oh);
    function Qh(a) {
        var b = new Ph;
        Eh(b, a);
        T(b, Error(b));
        return b
    }
    Ph.prototype.A = ["com.google.apps.docs.xplat.base.AssertionException", 0];
    function Rh() {}
    z(Rh, Oh);
    function Sh(a) {
        var b = new Rh;
        Eh(b, a);
        T(b, Error(b));
        return b
    }
    Rh.prototype.A = ["java.lang.IndexOutOfBoundsException", 0];
    function Th(a) {
        var b;
        a.M() ? b = {
            value: a.N(),
            done: !1
        } : b = {
            value: null,
            done: !0
        };
        return b
    }
    ;var Uh;
    function Vh() {
        Vh = lb();
        for (var a = Wh([256], Xh, Yh), b = 0; b < 256; b = b + 1 | 0)
            Zh(a, b, $h(b - 128 | 0));
        Uh = a
    }
    ;function ai() {}
    z(ai, Oh);
    ai.prototype.A = ["java.lang.ArithmeticException", 0];
    function bi() {}
    z(bi, Oh);
    bi.prototype.A = ["java.lang.ArrayStoreException", 0];
    function ci() {}
    z(ci, Dh);
    ci.prototype.A = ["java.lang.Error", 0];
    function di() {}
    z(di, ci);
    di.prototype.A = ["java.lang.AssertionError", 0];
    function ei() {}
    z(ei, Oh);
    function fi(a) {
        var b = new ei;
        Eh(b, a);
        T(b, Error(b));
        return b
    }
    ei.prototype.A = ["java.lang.ClassCastException", 0];
    function gi() {}
    z(gi, Oh);
    function hi(a) {
        var b = new gi;
        Eh(b, a);
        T(b, Error(b));
        return b
    }
    gi.prototype.A = ["java.lang.IllegalArgumentException", 0];
    function ii() {}
    z(ii, Oh);
    function ji(a) {
        var b = new ii;
        Eh(b, a);
        T(b, Error(b));
        return b
    }
    ii.prototype.A = ["java.lang.IllegalStateException", 0];
    function Lh() {}
    z(Lh, Oh);
    Lh.prototype.A = ["java.lang.JsException", 0];
    function ki() {}
    z(ki, Lh);
    function Kh() {
        var a = new ki;
        Fh(a);
        T(a, new TypeError(a));
        return a
    }
    ki.prototype.A = ["java.lang.NullPointerException", 0];
    function li() {}
    z(li, Rh);
    function mi(a) {
        var b = new li;
        Eh(b, a);
        T(b, Error(b));
        return b
    }
    li.prototype.A = ["java.lang.StringIndexOutOfBoundsException", 0];
    function ni() {}
    z(ni, Oh);
    function oi() {
        var a = new ni;
        Fh(a);
        T(a, Error(a));
        return a
    }
    ni.prototype.A = ["java.util.ConcurrentModificationException", 0];
    function pi() {}
    z(pi, Oh);
    pi.prototype.A = ["java.util.NoSuchElementException", 0];
    function qi() {}
    var ri;
    z(qi, R);
    qi.prototype.A = ["java.lang.Number", 0];
    function si() {}
    z(si, qi);
    function ti(a) {
        return n === typeof a
    }
    si.prototype.A = ["java.lang.Double", 0];
    function ui(a) {
        return lh(a)
    }
    function vi(a) {
        if (!isFinite(a))
            throw a = new ai,
            Fh(a),
            T(a, Error(a)),
            a.g;
        return a | 0
    }
    ;function wi() {}
    z(wi, R);
    wi.prototype.A = ["java.lang.Boolean", 0];
    function U(a, b, c) {
        if (a != null && !b(a))
            throw a = S(Ah(xi(a))) + aa + S(Ah(Bh(c))),
            fi(a).g;
        return a
    }
    ;function Ch(a) {
        return a.constructor
    }
    function yi(a, b, c) {
        if (Object.prototype.hasOwnProperty.call(a.prototype, b))
            return a.prototype[b];
        c = c();
        return a.prototype[b] = c
    }
    ;function yh(a, b) {
        return Object.is(a, b) || a == null && b == null
    }
    ;function zi(a) {
        switch (V(typeof a)) {
        case v:
            for (var b = 0, c = 0; c < a.length; c = c + 1 | 0) {
                b = (b << 5) - b;
                var d = a
                  , e = c;
                Ai(e, d.length);
                b = b + d.charCodeAt(e) | 0
            }
            return b;
        case n:
            return a = V(a),
            Math.max(Math.min(a, 2147483647), -2147483648) | 0;
        case Ea:
            return V(a) ? 1231 : 1237;
        default:
            return a == null ? 0 : zh(a)
        }
    }
    var Bi = 0;
    function zh(a) {
        return a.nb || (Object.defineProperties(a, {
            nb: {
                value: Bi = Bi + 1 | 0,
                enumerable: !1
            }
        }),
        a.nb)
    }
    ;function Ci(a) {
        if (a.ha)
            return a.ha();
        Di(a);
        return zi(a)
    }
    function xi(a) {
        switch (V(typeof a)) {
        case n:
            return Bh(si);
        case Ea:
            return Bh(wi);
        case v:
            return Bh(Ei);
        case k:
            return Bh(Fi)
        }
        if (a instanceof ch)
            a = Bh(Gi);
        else if (a instanceof R)
            a = Bh(Ch(a));
        else if (Array.isArray(a))
            a = (a = a.ma) ? Bh(a.ra, a.pa) : Bh(R, 1);
        else if (a != null)
            a = Bh(Hi);
        else
            throw new TypeError("null.getClass()");
        return a
    }
    function Di(a) {
        if (a.ub)
            throw Error("equals and hashcode expected but not defined.");
    }
    ;function Fi() {}
    Fi.prototype.A = ["<native function>", 1];
    function Hi() {}
    z(Hi, R);
    Hi.prototype.A = ["<native object>", 0];
    function Ii() {}
    z(Ii, Oh);
    function Ji() {
        var a = new Ii;
        Fh(a);
        T(a, Error(a));
        return a
    }
    Ii.prototype.A = ["java.lang.UnsupportedOperationException", 0];
    function Ki(a, b) {
        var c;
        !(c = yh(a, b)) && (c = a != null) && (a.equals ? c = a.equals(b) : (Di(a),
        c = Object.is(a, b)));
        return c
    }
    function Li(a) {
        return a != null ? Ci(a) : 0
    }
    ;function Xh() {
        this.g = 0
    }
    z(Xh, qi);
    function Mi(a) {
        a > -129 && a < 128 ? (Vh(),
        a = Uh[a + 128 | 0]) : a = $h(a);
        return a
    }
    function $h(a) {
        var b = new Xh;
        b.g = a;
        return b
    }
    x = Xh.prototype;
    x.equals = function(a) {
        return Yh(a) && U(a, Yh, Xh).g == this.g
    }
    ;
    x.ha = mb("g");
    x.toString = function() {
        return "" + this.g
    }
    ;
    x.Z = mb("g");
    function Yh(a) {
        return a instanceof Xh
    }
    x.A = ["java.lang.Integer", 0];
    function Gi() {}
    z(Gi, qi);
    Gi.prototype.A = ["java.lang.Long", 0];
    function Ni() {}
    z(Ni, R);
    x = Ni.prototype;
    x.add = function() {
        throw Ji().g;
    }
    ;
    x.clear = function() {
        for (var a = this.P(); a.M(); )
            a.N(),
            a.ca()
    }
    ;
    x.xa = function(a) {
        return Oi(this, a, !1)
    }
    ;
    x.remove = function(a) {
        return Oi(this, a, !0)
    }
    ;
    x.eb = function(a) {
        var b = this.size();
        if (a.length < b) {
            var c = Array(b);
            c.ma = a.ma;
            a = c
        }
        c = a;
        for (var d = this.P(), e = 0; e < b; e = e + 1 | 0)
            Zh(c, e, d.N());
        a.length > b && Zh(a, b, null);
        return a
    }
    ;
    x.toString = function() {
        for (var a = Pi("[", "]"), b = this.P(); b.M(); ) {
            var c = b.N();
            Qi(a, yh(c, this) ? "(this Collection)" : S(c))
        }
        return a.toString()
    }
    ;
    function Oi(a, b, c) {
        for (a = a.P(); a.M(); ) {
            var d = a.N();
            if (Ki(b, d))
                return c && a.ca(),
                !0
        }
        return !1
    }
    x.A = ["java.util.AbstractCollection", 0];
    function Ri() {}
    function Si(a) {
        return a != null && !!a.Ua
    }
    Ri.prototype.Ua = !0;
    Ri.prototype.A = ["java.util.List", 1];
    function Ti() {}
    z(Ti, Ni);
    x = Ti.prototype;
    x.add = function(a) {
        this.sb(this.size(), a);
        return !0
    }
    ;
    x.sb = function() {
        throw Ji().g;
    }
    ;
    x.clear = function() {
        this.Bb(0, this.size())
    }
    ;
    x.equals = function(a) {
        if (yh(a, this))
            return !0;
        if (!Si(a))
            return !1;
        a = U(a, Si, Ri);
        if (this.size() != a.size())
            return !1;
        a = a.P();
        for (var b = this.P(); b.M(); ) {
            var c = b.N()
              , d = a.N();
            if (!Ki(c, d))
                return !1
        }
        return !0
    }
    ;
    x.ha = function() {
        for (var a = 1, b = this.P(); b.M(); ) {
            var c = b.N();
            a = Math.imul(31, a) + Li(c) | 0
        }
        return a
    }
    ;
    x.indexOf = function(a) {
        for (var b = 0, c = this.size(); b < c; b = b + 1 | 0)
            if (Ki(a, this.Ja(b)))
                return b;
        return -1
    }
    ;
    x.P = function() {
        var a = new Ui;
        a.l = this;
        a.g = 0;
        a.j = -1;
        return a
    }
    ;
    x.lastIndexOf = function(a) {
        for (var b = this.size() - 1 | 0; b > -1; b = b - 1 | 0)
            if (Ki(a, this.Ja(b)))
                return b;
        return -1
    }
    ;
    x.Eb = function() {
        throw Ji().g;
    }
    ;
    x.Bb = function(a, b) {
        var c = new Vi;
        c.l = this;
        c.g = 0;
        c.j = -1;
        var d = this.size();
        Wi(a, d);
        for (c.g = a; a < b; a = a + 1 | 0)
            c.N(),
            c.ca()
    }
    ;
    x.Ua = !0;
    x.A = ["java.util.AbstractList", 0];
    function Xi() {}
    z(Xi, Ti);
    x = Xi.prototype;
    x.xa = function(a) {
        return this.indexOf(a) != -1
    }
    ;
    x.Ja = function(a) {
        var b = this.g.length;
        if (a < 0 || a >= b)
            throw Sh("Index: " + a + da + b).g;
        return this.g[a]
    }
    ;
    x.indexOf = function(a) {
        a: {
            for (var b = 0, c = this.g.length; b < c; b = b + 1 | 0)
                if (Ki(a, this.g[b])) {
                    a = b;
                    break a
                }
            a = -1
        }
        return a
    }
    ;
    x.P = function() {
        var a = new Yi;
        a.l = this;
        a.g = 0;
        a.j = -1;
        return a
    }
    ;
    x.lastIndexOf = function(a) {
        a: {
            for (var b = this.g.length - 1 | 0; b >= 0; b = b - 1 | 0)
                if (Ki(a, this.g[b])) {
                    a = b;
                    break a
                }
            a = -1
        }
        return a
    }
    ;
    x.Eb = function(a) {
        this.Ja(a);
        this.g.splice(a, 1)
    }
    ;
    x.remove = function(a) {
        a = this.indexOf(a);
        if (a == -1)
            return !1;
        this.g.splice(a, 1);
        return !0
    }
    ;
    x.size = function() {
        return this.g.length
    }
    ;
    x.eb = function(a) {
        var b = this.g.length;
        if (a.length < b) {
            var c = Array(b);
            c.ma = a.ma;
            a = c
        }
        for (c = 0; c < b; c = c + 1 | 0)
            Zh(a, c, this.g[c]);
        a.length > b && Zh(a, b, null);
        return a
    }
    ;
    x.Ua = !0;
    x.A = ["java.util.ArrayListBase", 0];
    function Zi() {}
    z(Zi, Xi);
    Zi.prototype.add = function(a) {
        this.g.push(a);
        return !0
    }
    ;
    Zi.prototype.sb = function(a, b) {
        Wi(a, this.g.length);
        this.g.splice(a, 0, b)
    }
    ;
    Zi.prototype.Bb = function(a, b) {
        var c = this.g.length;
        if (a < 0 || b > c)
            throw Sh(Ja + a + ", toIndex: " + b + ", size: " + c).g;
        if (a > b)
            throw hi(Ja + a + " > toIndex: " + b).g;
        this.g.splice(a, b - a | 0)
    }
    ;
    Zi.prototype.A = ["java.util.ArrayList", 0];
    function Yi() {
        this.j = this.g = 0
    }
    z(Yi, R);
    x = Yi.prototype;
    x.M = function() {
        return this.g < this.l.g.length
    }
    ;
    x.N = function() {
        $i(this.M());
        var a;
        this.j = (a = this.g,
        this.g = this.g + 1 | 0,
        a);
        return this.l.g[this.j]
    }
    ;
    x.ca = function() {
        aj(this.j != -1);
        var a = this.l
          , b = this.g = this.j;
        a.g.splice(b, 1);
        this.j = -1
    }
    ;
    x.next = function() {
        return Th(this)
    }
    ;
    x.A = ["java.util.ArrayListBase$1", 0];
    function bj() {}
    function cj(a) {
        return a != null && !!a.Va
    }
    bj.prototype.Va = !0;
    bj.prototype.A = ["java.util.Map$Entry", 1];
    function dj() {}
    function ej(a) {
        return a != null && !!a.lb
    }
    dj.prototype.lb = !0;
    dj.prototype.A = ["java.util.Set", 1];
    function fj() {}
    z(fj, Ni);
    fj.prototype.equals = function(a) {
        if (yh(a, this))
            return !0;
        if (!ej(a))
            return !1;
        a = U(a, ej, dj);
        if (a.size() != this.size())
            a = !1;
        else
            a: {
                V(a);
                for (a = a.P(); a.M(); ) {
                    var b = a.N();
                    if (!this.xa(b)) {
                        a = !1;
                        break a
                    }
                }
                a = !0
            }
        return a
    }
    ;
    fj.prototype.ha = function() {
        return gj(this)
    }
    ;
    fj.prototype.lb = !0;
    fj.prototype.A = ["java.util.AbstractSet", 0];
    function hj() {}
    z(hj, R);
    x = hj.prototype;
    x.M = function() {
        return this.g.M()
    }
    ;
    x.N = function() {
        return U(this.g.N(), cj, bj).Y()
    }
    ;
    x.ca = function() {
        this.g.ca()
    }
    ;
    x.next = function() {
        return Th(this)
    }
    ;
    x.A = ["java.util.AbstractMap$2$1", 0];
    function ij() {}
    z(ij, Ni);
    x = ij.prototype;
    x.clear = function() {
        this.g.clear()
    }
    ;
    x.xa = function(a) {
        return this.g.rb(a)
    }
    ;
    x.P = function() {
        var a = this.g.la().P()
          , b = new hj;
        b.g = a;
        return b
    }
    ;
    x.size = function() {
        return this.g.size()
    }
    ;
    x.A = ["java.util.AbstractMap$2", 0];
    function jj() {}
    z(jj, R);
    x = jj.prototype;
    x.X = mb("j");
    x.Y = mb("g");
    x.qb = function(a) {
        this.g = a
    }
    ;
    x.equals = function(a) {
        if (!cj(a))
            return !1;
        a = U(a, cj, bj);
        return Ki(this.j, a.X()) && Ki(this.g, a.Y())
    }
    ;
    x.ha = function() {
        return Li(this.j) ^ Li(this.g)
    }
    ;
    x.toString = function() {
        return S(this.j) + "=" + S(this.g)
    }
    ;
    x.Va = !0;
    x.A = ["java.util.AbstractMap$AbstractEntry", 0];
    function kj() {}
    z(kj, jj);
    function lj(a, b) {
        var c = new kj;
        c.j = a;
        c.g = b;
        return c
    }
    kj.prototype.A = ["java.util.AbstractMap$SimpleEntry", 0];
    function mj() {}
    function nj(a) {
        return a != null && !!a.kb
    }
    mj.prototype.kb = !0;
    mj.prototype.A = ["java.util.Map", 1];
    function oj() {}
    z(oj, R);
    x = oj.prototype;
    x.clear = function() {
        this.la().clear()
    }
    ;
    x.ob = function(a) {
        return pj(this, a, !1) != null
    }
    ;
    x.rb = function(a) {
        for (var b = this.la().P(); b.M(); ) {
            var c = U(b.N(), cj, bj).Y();
            if (Ki(a, c))
                return !0
        }
        return !1
    }
    ;
    function qj(a, b) {
        var c = b.X();
        b = b.Y();
        var d = a.get(c);
        return !Ki(b, d) || d == null && !a.ob(c) ? !1 : !0
    }
    x.equals = function(a) {
        if (yh(a, this))
            return !0;
        if (!nj(a))
            return !1;
        a = U(a, nj, mj);
        if (this.size() != a.size())
            return !1;
        for (a = a.la().P(); a.M(); ) {
            var b = U(a.N(), cj, bj);
            if (!qj(this, b))
                return !1
        }
        return !0
    }
    ;
    x.get = function(a) {
        return rj(pj(this, a, !1))
    }
    ;
    x.ha = function() {
        return gj(this.la())
    }
    ;
    x.pb = function() {
        throw Ji().g;
    }
    ;
    x.remove = function(a) {
        return rj(pj(this, a, !0))
    }
    ;
    x.size = function() {
        return this.la().size()
    }
    ;
    x.toString = function() {
        for (var a = Pi("{", "}"), b = this.la().P(); b.M(); ) {
            var c = U(b.N(), cj, bj);
            c = S(sj(this, c.X())) + "=" + S(sj(this, c.Y()));
            Qi(a, c)
        }
        return a.toString()
    }
    ;
    function sj(a, b) {
        return yh(b, a) ? "(this Map)" : S(b)
    }
    x.values = function() {
        var a = new ij;
        a.g = this;
        return a
    }
    ;
    function rj(a) {
        return a == null ? null : a.Y()
    }
    function pj(a, b, c) {
        for (a = a.la().P(); a.M(); ) {
            var d = U(a.N(), cj, bj);
            if (Ki(b, d.X()))
                return c && (d = lj(d.X(), d.Y()),
                a.ca()),
                d
        }
        return null
    }
    x.kb = !0;
    x.A = ["java.util.AbstractMap", 0];
    function tj() {}
    z(tj, R);
    tj.prototype.toString = mb("g");
    tj.prototype.A = ["java.lang.AbstractStringBuilder", 0];
    function uj() {}
    z(uj, tj);
    function vj(a, b) {
        a.g = S(a.g) + S(b)
    }
    uj.prototype.A = ["java.lang.StringBuilder", 0];
    function wj() {}
    z(wj, R);
    function Pi(a, b) {
        var c = new wj;
        c.o = ", ".toString();
        c.l = a.toString();
        c.j = b.toString();
        c.v = S(c.l) + S(c.j);
        return c
    }
    function Qi(a, b) {
        if (a.g == null) {
            var c = new uj
              , d = U(V(a.l), xj, Ei);
            c.g = d;
            a.g = c
        } else
            vj(a.g, a.o);
        a = a.g;
        a.g = S(a.g) + S(b)
    }
    wj.prototype.toString = function() {
        return this.g == null ? this.v : this.j.length == 0 ? this.g.toString() : S(this.g.toString()) + S(this.j)
    }
    ;
    wj.prototype.A = ["java.util.StringJoiner", 0];
    function gj(a) {
        var b = 0;
        for (a = a.P(); a.M(); ) {
            var c = a.N();
            b = b + Li(c) | 0
        }
        return b
    }
    ;function yj() {}
    z(yj, fj);
    x = yj.prototype;
    x.clear = function() {
        this.g.clear()
    }
    ;
    x.xa = function(a) {
        return cj(a) ? qj(this.g, U(a, cj, bj)) : !1
    }
    ;
    x.P = function() {
        var a = new zj;
        a.g = this.g;
        a.C = a.g.l.P();
        a.j = a.C;
        a.l = Aj(a);
        a.o = a.g.j;
        return a
    }
    ;
    x.remove = function(a) {
        return this.xa(a) ? (a = U(a, cj, bj).X(),
        this.g.remove(a),
        !0) : !1
    }
    ;
    x.size = function() {
        return this.g.size()
    }
    ;
    x.A = ["java.util.AbstractHashMap$EntrySet", 0];
    function zj() {
        this.l = !1;
        this.o = 0
    }
    z(zj, R);
    x = zj.prototype;
    x.M = mb("l");
    function Aj(a) {
        if (a.j.M())
            return !0;
        if (!yh(a.j, a.C))
            return !1;
        a.j = a.g.g.P();
        return a.j.M()
    }
    x.ca = function() {
        aj(this.v != null);
        if (this.g.j != this.o)
            throw oi().g;
        this.v.ca();
        this.v = null;
        this.l = Aj(this);
        this.o = this.g.j
    }
    ;
    x.next = function() {
        return Th(this)
    }
    ;
    x.N = function() {
        if (this.g.j != this.o)
            throw oi().g;
        $i(this.M());
        this.v = this.j;
        var a = U(this.j.N(), cj, bj);
        this.l = Aj(this);
        return a
    }
    ;
    x.A = ["java.util.AbstractHashMap$EntrySetIterator", 0];
    function Bj() {
        this.j = 0
    }
    z(Bj, oj);
    x = Bj.prototype;
    x.clear = function() {
        Cj(this)
    }
    ;
    function Cj(a) {
        var b = new Dj;
        b.j = new Map;
        b.l = a;
        a.g = b;
        b = new Ej;
        b.g = new Map;
        b.o = a;
        a.l = b;
        Fj(a)
    }
    function Fj(a) {
        a.j = a.j + 1 | 0
    }
    x.ob = function(a) {
        return xj(a) ? this.l.g.has(a) : Gj(a, Hj(this.g, a == null ? 0 : Ci(a))) != null
    }
    ;
    x.rb = function(a) {
        return Ij(a, this.l) || Ij(a, this.g)
    }
    ;
    function Ij(a, b) {
        for (b = b.P(); b.M(); ) {
            var c = U(b.N(), cj, bj)
              , d = a;
            c = c.Y();
            if (Ki(d, c))
                return !0
        }
        return !1
    }
    x.la = function() {
        var a = new yj;
        a.g = this;
        return a
    }
    ;
    x.get = function(a) {
        return xj(a) ? this.l.g.get(a) : rj(Gj(a, Hj(this.g, a == null ? 0 : Ci(a))))
    }
    ;
    x.pb = function(a, b) {
        if (xj(a))
            Jj(this.l, a, b);
        else
            a: {
                var c = this.g
                  , d = a == null ? 0 : Ci(a)
                  , e = Hj(c, d);
                if (e.length == 0)
                    c.j.set(d, e);
                else if (d = Gj(a, e),
                d != null) {
                    d.qb(b);
                    break a
                }
                Zh(e, e.length, lj(a, b));
                c.g = c.g + 1 | 0;
                Fj(c.l)
            }
    }
    ;
    x.remove = function(a) {
        return xj(a) ? Kj(this.l, a) : Lj(this.g, a)
    }
    ;
    x.size = function() {
        return this.g.g + this.l.l | 0
    }
    ;
    x.A = ["java.util.AbstractHashMap", 0];
    function Mj() {
        this.g = 0
    }
    z(Mj, R);
    x = Mj.prototype;
    x.M = function() {
        if (this.g < this.j.length)
            return !0;
        var a = this.v.next();
        return a.done ? !1 : (this.j = a.value[1],
        this.g = 0,
        !0)
    }
    ;
    x.ca = function() {
        Lj(this.o, this.l.X());
        this.g != 0 && (this.g = this.g - 1 | 0)
    }
    ;
    x.next = function() {
        return Th(this)
    }
    ;
    x.N = function() {
        var a;
        return this.l = this.j[a = this.g,
        this.g = this.g + 1 | 0,
        a]
    }
    ;
    x.A = ["java.util.InternalHashCodeMap$1", 0];
    function Dj() {
        this.g = 0
    }
    z(Dj, R);
    function Lj(a, b) {
        for (var c = b == null ? 0 : Ci(b), d = Hj(a, c), e = 0; e < d.length; e = e + 1 | 0) {
            var f = d[e];
            if (Ki(b, f.X()))
                return d.length == 1 ? (d.length = 0,
                a.j.delete(c)) : d.splice(e, 1),
                a.g = a.g - 1 | 0,
                Fj(a.l),
                f.Y()
        }
        return null
    }
    function Gj(a, b) {
        for (var c = 0; c < b.length; c++) {
            var d = b[c];
            if (Ki(a, d.X()))
                return d
        }
        return null
    }
    Dj.prototype.P = function() {
        var a = new Mj;
        a.o = this;
        a.v = a.o.j.entries();
        a.g = 0;
        a.j = [];
        a.l = null;
        return a
    }
    ;
    function Hj(a, b) {
        a = a.j.get(b);
        return a == null ? [] : a
    }
    Dj.prototype.A = ["java.util.InternalHashCodeMap", 0];
    function Nj() {}
    z(Nj, R);
    x = Nj.prototype;
    x.M = function() {
        return !this.j.done
    }
    ;
    x.ca = function() {
        Kj(this.g, this.o.value[0])
    }
    ;
    x.next = function() {
        return Th(this)
    }
    ;
    x.N = function() {
        this.o = this.j;
        this.j = this.l.next();
        var a = new Oj
          , b = this.o
          , c = this.g.j;
        a.j = this.g;
        a.g = b;
        a.l = c;
        return a
    }
    ;
    x.A = ["java.util.InternalStringMap$1", 0];
    function Pj() {}
    z(Pj, R);
    x = Pj.prototype;
    x.equals = function(a) {
        if (!cj(a))
            return !1;
        a = U(a, cj, bj);
        return Ki(this.X(), a.X()) && Ki(this.Y(), a.Y())
    }
    ;
    x.ha = function() {
        return Li(this.X()) ^ Li(this.Y())
    }
    ;
    x.toString = function() {
        return S(this.X()) + "=" + S(this.Y())
    }
    ;
    x.Va = !0;
    x.A = ["java.util.AbstractMapEntry", 0];
    function Oj() {
        this.l = 0
    }
    z(Oj, Pj);
    Oj.prototype.X = function() {
        return this.g.value[0]
    }
    ;
    Oj.prototype.Y = function() {
        return this.j.j != this.l ? this.j.g.get(this.g.value[0]) : this.g.value[1]
    }
    ;
    Oj.prototype.qb = function(a) {
        Jj(this.j, this.g.value[0], a)
    }
    ;
    Oj.prototype.A = ["java.util.InternalStringMap$2", 0];
    function Ej() {
        this.j = this.l = 0
    }
    z(Ej, R);
    function Jj(a, b, c) {
        var d = a.g.get(b);
        a.g.set(b, c === void 0 ? null : c);
        d === void 0 ? (a.l = a.l + 1 | 0,
        Fj(a.o)) : a.j = a.j + 1 | 0
    }
    function Kj(a, b) {
        var c = a.g.get(b);
        c === void 0 ? a.j = a.j + 1 | 0 : (a.g.delete(b),
        a.l = a.l - 1 | 0,
        Fj(a.o));
        return c
    }
    Ej.prototype.P = function() {
        var a = new Nj;
        a.g = this;
        a.l = a.g.g.entries();
        a.j = a.l.next();
        return a
    }
    ;
    Ej.prototype.A = ["java.util.InternalStringMap", 0];
    function Qj() {
        this.j = 0
    }
    z(Qj, Bj);
    Qj.prototype.A = ["java.util.HashMap", 0];
    function Ui() {
        this.j = this.g = 0
    }
    z(Ui, R);
    x = Ui.prototype;
    x.M = function() {
        return this.g < this.l.size()
    }
    ;
    x.N = function() {
        $i(this.M());
        var a;
        return this.l.Ja(this.j = (a = this.g,
        this.g = this.g + 1 | 0,
        a))
    }
    ;
    x.ca = function() {
        aj(this.j != -1);
        this.l.Eb(this.j);
        this.g = this.j;
        this.j = -1
    }
    ;
    x.next = function() {
        return Th(this)
    }
    ;
    x.A = ["java.util.AbstractList$IteratorImpl", 0];
    function Vi() {
        Ui.call(this)
    }
    z(Vi, Ui);
    Vi.prototype.A = ["java.util.AbstractList$ListIteratorImpl", 0];
    function Rj() {}
    z(Rj, gi);
    Rj.prototype.A = ["java.lang.NumberFormatException", 0];
    function $i(a) {
        if (!a)
            throw a = new pi,
            Fh(a),
            T(a, Error(a)),
            a.g;
    }
    function aj(a) {
        if (!a)
            throw a = new ii,
            Fh(a),
            T(a, Error(a)),
            a.g;
    }
    function V(a) {
        if (a == null)
            throw Kh().g;
        return a
    }
    function Ai(a, b) {
        if (a < 0 || a >= b)
            throw mi("Index: " + a + da + b).g;
    }
    function Wi(a, b) {
        if (a < 0 || a > b)
            throw Sh("Index: " + a + da + b).g;
    }
    ;function Wh(a, b, c) {
        return Sj(a, {
            ra: b,
            Pa: c,
            pa: a.length
        })
    }
    function Sj(a, b) {
        var c = a[0];
        if (c == null)
            return null;
        var d = new globalThis.Array(c);
        b && (d.ma = b);
        if (a.length > 1) {
            a = a.slice(1);
            b = b && {
                ra: b.ra,
                Pa: b.Pa,
                pa: b.pa - 1
            };
            for (var e = 0; e < c; e++)
                d[e] = Sj(a, b)
        } else if (b && (a = b.ra.tc,
        a !== void 0))
            for (b = 0; b < c; b++)
                d[b] = a;
        return d
    }
    function Zh(a, b, c) {
        var d;
        if (!(d = c == null))
            a: {
                if (d = a.ma)
                    if (d.pa > 1) {
                        if (!Tj(c, d.ra, d.Pa, d.pa - 1)) {
                            d = !1;
                            break a
                        }
                    } else if (c != null && !d.Pa(c)) {
                        d = !1;
                        break a
                    }
                d = !0
            }
        if (!d)
            throw a = new bi,
            Fh(a),
            T(a, Error(a)),
            a.g;
        a[b] = c
    }
    function Tj(a, b, c, d) {
        if (a == null || !Array.isArray(a))
            return !1;
        a = a.ma || {
            ra: R,
            pa: 1
        };
        var e = a.pa;
        return e == d ? (d = a.ra,
        d === b ? !0 : b && b.prototype.Hb || d && d.prototype.Hb ? !1 : c(d.prototype)) : e > d ? R == b : !1
    }
    function Uj(a, b, c) {
        if (a != null && !Tj(a, b, c, 1))
            throw b = Bh(b, 1),
            a = Ah(xi(a)) + aa + Ah(b),
            fi(a).g;
        return a
    }
    ;function Ei() {}
    z(Ei, R);
    function S(a) {
        return a == null ? Va : a.toString()
    }
    function Vj(a, b, c) {
        var d = a.length;
        if (b < 0 || c > d || c < b)
            throw mi(Ja + b + ", toIndex: " + c + ", length: " + d).g;
        return a.substr(b, c - b | 0)
    }
    function xj(a) {
        return v === typeof a
    }
    Ei.prototype.A = ["java.lang.String", 0];
    function Wj(a, b) {
        this.g = a;
        this.j = b
    }
    z(Wj, R);
    function Bh(a, b) {
        var c = b || 0;
        return yi(a, "$$class/" + c, function() {
            return new Wj(a,c)
        })
    }
    function Ah(a) {
        return a.j != 0 ? S(Xj("[", a.j)) + S(a.g.prototype.A[1] == 3 ? a.g.prototype.A[2] : "L" + S(a.g.prototype.A[0]) + ";") : a.g.prototype.A[0]
    }
    function Yj(a, b) {
        b = a.lastIndexOf(b) + 1 | 0;
        Ai(b, a.length + 1 | 0);
        return a.substr(b)
    }
    Wj.prototype.toString = function() {
        return String(this.j == 0 && this.g.prototype.A[1] == 1 ? "interface " : this.j == 0 && this.g.prototype.A[1] == 3 ? "" : "class ") + S(Ah(this))
    }
    ;
    function Xj(a, b) {
        for (var c = "", d = 0; d < b; d = d + 1 | 0)
            c = S(c) + S(a);
        return c
    }
    Wj.prototype.A = ["java.lang.Class", 0];
    function Ih() {}
    function Hh(a) {
        return a instanceof Error
    }
    Ih.prototype.A = ["Error", 0];
    function Gh(a, b) {
        if (a instanceof Object)
            try {
                a.Qb = b,
                Object.defineProperties(a, {
                    cause: {
                        get: function() {
                            return b.j && b.j.g
                        }
                    }
                })
            } catch (c) {}
    }
    ;function Zj(a) {
        if (a == null)
            return Va;
        try {
            return a.toString()
        } catch (f) {
            var b = Jh(f);
            if (b instanceof Nh) {
                var c = S(Ah(xi(a))) + String.fromCharCode(64);
                a = zi(a);
                c += S((a >>> 0).toString(16));
                a = ak("com.google.common.base.Strings");
                var d = (bk(),
                ck)
                  , e = "Exception during lenientFormat for " + S(c);
                dk(a, d) && (d = ek(d, e),
                d.g = b,
                fk(a, d));
                return "<" + S(c) + " threw " + S(Ah(xi(b))) + ">"
            }
            throw b.g;
        }
    }
    ;function gk() {}
    var hk, ik, jk, ck;
    z(gk, R);
    gk.prototype.g = pb("DUMMY");
    gk.prototype.Z = pb(-1);
    gk.prototype.toString = function() {
        return this.g()
    }
    ;
    function bk() {
        bk = lb();
        hk = new kk;
        ik = new lk;
        jk = new mk;
        ck = new nk
    }
    gk.prototype.A = ["java.util.logging.Level", 0];
    function kk() {}
    z(kk, gk);
    kk.prototype.g = pb("ALL");
    kk.prototype.Z = pb(-2147483648);
    kk.prototype.A = ["java.util.logging.Level$LevelAll", 0];
    function lk() {}
    z(lk, gk);
    lk.prototype.g = pb("INFO");
    lk.prototype.Z = pb(800);
    lk.prototype.A = ["java.util.logging.Level$LevelInfo", 0];
    function mk() {}
    z(mk, gk);
    mk.prototype.g = pb(pa);
    mk.prototype.Z = pb(1E3);
    mk.prototype.A = ["java.util.logging.Level$LevelSevere", 0];
    function nk() {}
    z(nk, gk);
    nk.prototype.g = pb("WARNING");
    nk.prototype.Z = pb(900);
    nk.prototype.A = ["java.util.logging.Level$LevelWarning", 0];
    function ok() {}
    z(ok, R);
    function ek(a, b) {
        var c = new ok;
        c.g = null;
        c.j = a;
        c.l = b;
        return c
    }
    ok.prototype.A = ["java.util.logging.LogRecord", 0];
    function pk() {}
    z(pk, R);
    function qk(a) {
        return a instanceof pk
    }
    pk.prototype.A = ["java.util.logging.Handler", 0];
    function rk() {}
    var sk;
    z(rk, R);
    function tk(a, b) {
        if (b.l.length == 0) {
            var c = new uk;
            vk = !0;
            b.g.add(c)
        }
        a.g.pb(b.l, b)
    }
    function wk(a, b) {
        var c = U(a.g.get(b), xk, Ak);
        if (c == null) {
            b = Bk(b);
            c = b.l;
            var d = Math
              , e = d.max;
            var f = String.fromCodePoint(46);
            f = c.lastIndexOf(f);
            c = Vj(c, 0, e.call(d, 0, f));
            c = wk(a, c);
            c != null && (b.o = c);
            tk(a, b);
            return b
        }
        return c
    }
    rk.prototype.A = ["java.util.logging.LogManager", 0];
    function uk() {}
    z(uk, pk);
    uk.prototype.A = ["java.util.logging.SimpleConsoleLogHandler", 0];
    function Ck() {}
    z(Ck, R);
    function Dk(a, b, c, d, e) {
        (e || console.groupCollapsed == null ? console.group != null ? console.group : console.log : console.groupCollapsed).call(console, S(d) + S(c.toString()));
        d = c.g;
        console[b].call(console, d && d.stack || "");
        d = c.j;
        d != null && Dk(a, b, d, "Caused by: ", !1);
        c = c.o == null ? Wh([0], Dh, Mh) : Uj(c.o.eb(Wh([0], Dh, Mh)), Dh, Mh);
        for (d = 0; d < c.length; d++)
            Dk(a, b, c[d], "Suppressed: ", !1);
        console.groupEnd != null && console.groupEnd.call(console)
    }
    Ck.prototype.A = ["javaemul.internal.ConsoleLogger", 0];
    function Ak() {
        this.v = !1
    }
    z(Ak, R);
    function ak(a) {
        if (sk == null) {
            var b = new rk
              , c = new Qj;
            Cj(c);
            b.g = c;
            sk = b;
            b = Bk("");
            c = (bk(),
            ik);
            b.j = c;
            tk(sk, b)
        }
        return wk(sk, a)
    }
    function Bk(a) {
        var b = new Ak;
        b.l = a;
        b.v = !0;
        a = new Zi;
        a.g = [];
        b.g = a;
        return b
    }
    function dk(a, b) {
        if (vk) {
            b = b.Z();
            a: if (a.j != null)
                a = a.j;
            else {
                for (a = a.o; a != null; ) {
                    var c = a.j;
                    if (c != null) {
                        a = c;
                        break a
                    }
                    a = a.o
                }
                a = (bk(),
                ik)
            }
            b = b >= a.Z()
        } else
            b = !1;
        return b
    }
    function fk(a, b) {
        for (; a != null; ) {
            for (var c = Uj(a.g.eb(Wh([a.g.size()], pk, qk)), pk, qk), d = 0; d < c.length; d++) {
                var e = c[d], f = b, g = typeof console === "undefined" ? null : new Ck, h;
                if (h = g != null)
                    h = f,
                    h = (e.g != null ? e.g : (bk(),
                    hk)).Z() <= h.j.Z();
                h && (e = f.j.Z(),
                e = e >= (bk(),
                jk).Z() ? Ha : e >= (bk(),
                ck).Z() ? "warn" : e >= (bk(),
                ik).Z() ? "info" : "log",
                console[e].call(console, f.l),
                f.g != null && Dk(g, e, f.g, "Exception: ", !0))
            }
            a = a.v ? a.o : null
        }
    }
    function xk(a) {
        return a instanceof Ak
    }
    var vk = !1;
    Ak.prototype.A = ["java.util.logging.Logger", 0];
    function Ek(a, b) {
        this.j = b;
        this.l = a;
        Fh(this);
        T(this, Error(this))
    }
    z(Ek, Oh);
    tb.Object.defineProperties(Ek.prototype, {
        error: {
            configurable: !0,
            enumerable: !0,
            get: function() {
                var a = Error()
                  , b = this.g;
                a.fileName = b.fileName;
                a.lineNumber = b.lineNumber;
                a.columnNumber = b.columnNumber;
                a.message = b.message;
                a.name = b.name;
                a.stack = b.stack;
                a.toSource = b.toSource;
                a.cause = b.cause;
                for (var c in b)
                    c.indexOf("__java$") != 0 && (a[c] = b[c]);
                return a
            }
        }
    });
    Ek.prototype.A = ["com.google.apps.docs.xplat.base.XplatException", 0];
    function Fk() {}
    function Gk(a) {
        return a instanceof Error
    }
    Fk.prototype.A = ["Error", 0];
    function Hk() {}
    function Ik(a) {
        return a instanceof Array
    }
    Hk.prototype.A = ["Array", 0];
    function Jk() {}
    function Kk(a) {
        return a instanceof Object
    }
    Jk.prototype.A = [oa, 0];
    function Lk() {}
    function Mk(a) {
        return a instanceof Object
    }
    Lk.prototype.A = [oa, 0];
    var Nk = {
        Vc: "build-label",
        vc: "buildLabel",
        wc: "clientLog",
        Cc: "docId",
        Xc: "mobile-app-version",
        nd: ab,
        ld: "reportSeverity",
        Cd: bb,
        Pc: "isArrayPrototypeIntact",
        Qc: "isEditorElementAttached",
        Hc: "documentCharacterSet",
        Sc: "isModuleLoadFailure",
        kd: "reportName",
        Wc: "locale",
        yc: "createdOnServer",
        ed: "numUnsavedCommands",
        zc: "cspViolationContext",
        jd: "relatedToBrowserExtension",
        Gd: "workerError",
        Dc: "docosPostLimitExceeded",
        Ec: "docosPostLimitType",
        Fc: "docosReactionLimitExceeded",
        Gc: "docosReactionLimitType",
        gd: "origin",
        md: "saveTakingTooLongOnClient",
        zd: "truncatedCommentNotificationsCount",
        Ad: "truncatedCommentNotificationsFromPayload",
        dd: "nonfatalReason",
        Dd: "usesModuleSetsServing"
    };
    function Ok() {
        this.g = this.j = !1
    }
    var Pk;
    z(Ok, R);
    x = Ok.prototype;
    x.dispose = function() {
        if (this.j)
            var a = null;
        else
            this.j = !0,
            a = this.v == null ? Pk : this.v,
            this.v = null;
        if (a != null) {
            this.Wa();
            if (a.length != 0)
                for (var b = 0; b < a.length; b++)
                    a[b].dispose();
            a = this.g;
            b = Bh(Ch(this));
            b = Yj(Yj(S(b.g.prototype.A[0]) + S(Xj("[]", b.j)), "."), "$");
            if (!a) {
                a = [b];
                a == null && (a = ["(Object[])null"]);
                b = new uj;
                b.g = "";
                for (var c = 0, d = 0; d < a.length; ) {
                    var e = ca.indexOf("%s", c);
                    if (e == -1)
                        break;
                    b.g = S(b.g) + S(Vj(ca, c, e));
                    c = void 0;
                    vj(b, Zj(a[c = d,
                    d = d + 1 | 0,
                    c]));
                    c = e + 2 | 0
                }
                b.g = S(b.g) + S(Vj(ca, c, 39));
                if (d < a.length) {
                    for (e = " ["; d < a.length; d = d + 1 | 0)
                        vj(b, e),
                        vj(b, Zj(a[d])),
                        e = ", ";
                    b.g = S(b.g) + String.fromCharCode(93)
                }
                throw Qh(b.toString()).g;
            }
        }
    }
    ;
    x.Oa = mb("j");
    x.Wa = function() {
        if (this.g)
            throw Qh("disposeInternal() called multiple times").g;
        this.g = !0
    }
    ;
    x.toString = function() {
        return R.prototype.toString.call(this) || ""
    }
    ;
    function Qk() {
        Qk = lb();
        Pk = U([], Ik, Hk)
    }
    x.A = ["com.google.apps.xplat.disposable.Disposable", 0];
    function Rk(a) {
        if (a == null)
            return a = new Dh,
            Fh(a),
            T(a, Error(a)),
            a;
        if (Mh(a))
            return U(a, Mh, Dh);
        if (Gk(a))
            return a = U(a, Gk, Fk),
            Jh(a);
        throw hi("Unsupported type cannot be used to create a Throwable.").g;
    }
    ;var Sk = {};
    function Tk() {
        if (Sk !== Sk)
            throw Error("Bad secret");
    }
    ;var Uk = globalThis.trustedTypes, Vk;
    function Wk() {
        var a = null;
        if (!Uk)
            return a;
        try {
            var b = kb();
            a = Uk.createPolicy("goog#html", {
                createHTML: b,
                createScript: b,
                createScriptURL: b
            })
        } catch (c) {
            throw c;
        }
        return a
    }
    ;var Xk = Bb([""])
      , Yk = Db(["\x00"], ["\\0"])
      , Zk = Db(["\n"], ["\\n"])
      , $k = Db(["\x00"], ["\\u0000"]);
    function al(a) {
        return a.toString().indexOf("`") === -1
    }
    al(function(a) {
        return a(Xk)
    }) || al(function(a) {
        return a(Yk)
    }) || al(function(a) {
        return a(Zk)
    }) || al(function(a) {
        return a($k)
    });
    function bl(a) {
        Tk();
        this.g = a
    }
    bl.prototype.toString = mb("g");
    new bl("about:blank");
    var cl = new bl(va);
    function dl(a) {
        if (a instanceof bl)
            return a.g;
        throw Error("Unexpected type when unwrapping SafeUrl, got '" + a + "' of type '" + typeof a + "'");
    }
    ;function el(a) {
        this.ec = a
    }
    function fl(a) {
        return new el(function(b) {
            return b.substr(0, a.length + 1).toLowerCase() === a + ":"
        }
        )
    }
    var gl = [fl("data"), fl("http"), fl("https"), fl("mailto"), fl("ftp"), new el(function(a) {
        return /^[^:]*([/?#]|$)/.test(a)
    }
    )];
    function hl(a) {
        var b = b === void 0 ? gl : b;
        a: if (b = b === void 0 ? gl : b,
        a instanceof bl)
            b = a;
        else {
            for (var c = 0; c < b.length; ++c) {
                var d = b[c];
                if (d instanceof el && d.ec(a)) {
                    b = new bl(a);
                    break a
                }
            }
            b = void 0
        }
        b === void 0 && il(a.toString());
        return b || cl
    }
    var jl = /^\s*(?!javascript:)(?:[\w+.-]+:|[^:/?#]*(?:[/?#]|$))/i;
    function kl(a) {
        var b = !jl.test(a);
        b && il(a);
        if (!b)
            return a
    }
    function ll(a) {
        return a instanceof bl ? dl(a) : kl(a)
    }
    var ml = [];
    function il() {}
    nl(function(a) {
        console.warn("A URL with content '" + a + "' was sanitized away.")
    });
    function nl(a) {
        ml.indexOf(a) === -1 && ml.push(a);
        il = function(b) {
            ml.forEach(function(c) {
                c(b)
            })
        }
    }
    ;function ol(a) {
        Tk();
        this.g = a
    }
    ol.prototype.toString = function() {
        return this.g + ""
    }
    ;
    function pl(a) {
        var b;
        Vk === void 0 && (Vk = Wk());
        a = (b = Vk) ? b.createHTML(a) : a;
        return new ol(a)
    }
    function ql(a) {
        if (a instanceof ol)
            return a.g;
        throw Error("Unexpected type when unwrapping SafeHtml");
    }
    ;function rl(a, b, c) {
        b = ll(b);
        return b !== void 0 ? a.open(b, "_blank", c) : null
    }
    ;function sl(a) {
        var b = C.onerror;
        C.onerror = function(c, d, e, f, g) {
            b && b(c, d, e, f, g);
            a({
                message: c,
                fileName: d,
                line: e,
                lineNumber: e,
                Ld: f,
                error: g
            });
            return !1
        }
    }
    function tl(a) {
        var b = Xb("window.location.href");
        a == null && (a = 'Unknown Error of type "null/undefined"');
        if (typeof a === v)
            return {
                message: a,
                name: "Unknown error",
                lineNumber: la,
                fileName: b,
                stack: la
            };
        var c = !1;
        try {
            var d = a.lineNumber || a.line || la
        } catch (f) {
            d = la,
            c = !0
        }
        try {
            var e = a.fileName || a.filename || a.sourceURL || C.$googDebugFname || b
        } catch (f) {
            e = la,
            c = !0
        }
        b = ul(a);
        return !c && a.lineNumber && a.fileName && a.stack && a.message && a.name ? {
            message: a.message,
            name: a.name,
            lineNumber: a.lineNumber,
            fileName: a.fileName,
            stack: b
        } : (c = a.message,
        c == null && (c = a.constructor && a.constructor instanceof Function ? 'Unknown Error of type "' + (a.constructor.name ? a.constructor.name : vl(a.constructor)) + '"' : "Unknown Error of unknown type",
        typeof a.toString === k && Object.prototype.toString !== a.toString && (c += ": " + a.toString())),
        {
            message: c,
            name: a.name || "UnknownError",
            lineNumber: d,
            fileName: e,
            stack: b || la
        })
    }
    function ul(a, b) {
        b || (b = {});
        b[wl(a)] = !0;
        var c = a.stack || ""
          , d = a.cause;
        d && !b[wl(d)] && (c += "\nCaused by: ",
        d.stack && d.stack.indexOf(d.toString()) == 0 || (c += typeof d === v ? d : d.message + "\n"),
        c += ul(d, b));
        a = a.errors;
        if (Array.isArray(a)) {
            d = 1;
            var e;
            for (e = 0; e < a.length && !(d > 4); e++)
                b[wl(a[e])] || (c += "\nInner error " + d++ + ": ",
                a[e].stack && a[e].stack.indexOf(a[e].toString()) == 0 || (c += typeof a[e] === v ? a[e] : a[e].message + "\n"),
                c += ul(a[e], b));
            e < a.length && (c += "\n... " + (a.length - e) + " more inner errors")
        }
        return c
    }
    function wl(a) {
        var b = "";
        typeof a.toString === k && (b = "" + a);
        return b + a.stack
    }
    function xl(a, b) {
        a instanceof Error || (a = Error(a),
        Error.captureStackTrace && Error.captureStackTrace(a, xl));
        a.stack || (a.stack = yl(xl));
        if (b) {
            for (var c = 0; a[Sa + c]; )
                ++c;
            a[Sa + c] = String(b)
        }
        return a
    }
    function zl(a, b) {
        a = xl(a);
        if (b)
            for (var c in b)
                od(a, c, b[c]);
        return a
    }
    function yl(a) {
        var b = Error();
        if (Error.captureStackTrace)
            Error.captureStackTrace(b, a || yl),
            b = String(b.stack);
        else {
            try {
                throw b;
            } catch (c) {
                b = c
            }
            b = (b = b.stack) ? String(b) : null
        }
        b || (b = Al(a || arguments.callee.caller, []));
        return b
    }
    function Al(a, b) {
        var c = [];
        if (Qc(b, a) >= 0)
            c.push("[...circular reference...]");
        else if (a && b.length < 50) {
            c.push(vl(a) + "(");
            for (var d = a.arguments, e = 0; d && e < d.length; e++) {
                e > 0 && c.push(", ");
                var f = d[e];
                switch (typeof f) {
                case q:
                    f = f ? q : Va;
                    break;
                case v:
                    break;
                case n:
                    f = String(f);
                    break;
                case Ea:
                    f = f ? db : "false";
                    break;
                case k:
                    f = (f = vl(f)) ? f : "[fn]";
                    break;
                default:
                    f = typeof f
                }
                f.length > 40 && (f = f.slice(0, 40) + "...");
                c.push(f)
            }
            b.push(a);
            c.push(")\n");
            try {
                c.push(Al(a.caller, b))
            } catch (g) {
                c.push("[exception trying to get caller]\n")
            }
        } else
            a ? c.push("[...long stack...]") : c.push("[end]");
        return c.join("")
    }
    function vl(a) {
        if (Bl[a])
            return Bl[a];
        a = String(a);
        if (!Bl[a]) {
            var b = /function\s+([^\(]+)/m.exec(a);
            Bl[a] = b ? b[1] : "[Anonymous]"
        }
        return Bl[a]
    }
    var Bl = {}
      , Cl = Object.freeze || kb();
    function Dl(a, b) {
        this.name = a;
        this.value = b
    }
    Dl.prototype.toString = mb("name");
    var El = new Dl("OFF",Infinity)
      , Fl = new Dl(pa,1E3)
      , Gl = new Dl("WARNING",900)
      , Hl = new Dl("INFO",800)
      , Il = new Dl("CONFIG",700)
      , Jl = new Dl("FINE",500)
      , Kl = new Dl("FINER",400);
    function Ll() {
        this.clear()
    }
    var Ml;
    Ll.prototype.clear = lb();
    function Nl(a, b, c) {
        this.g = void 0;
        this.reset(a || El, b, c, void 0, void 0)
    }
    Nl.prototype.reset = function() {
        this.g = void 0
    }
    ;
    function Ol(a, b) {
        this.g = null;
        this.l = [];
        this.j = (b === void 0 ? null : b) || null;
        this.children = [];
        this.o = {
            g: function() {
                return a
            }
        }
    }
    function Pl(a) {
        if (a.g)
            return a.g;
        if (a.j)
            return Pl(a.j);
        oc("Root logger has no level set.");
        return El
    }
    function Ql(a, b) {
        for (; a; )
            a.l.forEach(function(c) {
                c(b)
            }),
            a = a.j
    }
    function Rl() {
        this.entries = {};
        var a = new Ol("");
        a.g = Il;
        this.entries[""] = a
    }
    var Sl;
    function Tl(a, b) {
        var c = a.entries[b];
        if (c)
            return c;
        c = b.lastIndexOf(".");
        c = Tl(a, b.slice(0, Math.max(c, 0)));
        var d = new Ol(b,c);
        a.entries[b] = d;
        c.children.push(d);
        return d
    }
    function Ul() {
        Sl || (Sl = new Rl);
        return Sl
    }
    function Vl(a) {
        return Tl(Ul(), a).o
    }
    function Wl(a, b, c) {
        var d;
        if (d = a)
            if (d = a && b) {
                d = b.value;
                var e = a ? Pl(Tl(Ul(), a.g())) : El;
                d = d >= e.value
            }
        d && (b = b || El,
        d = Tl(Ul(), a.g()),
        typeof c === k && (c = c()),
        Ml || (Ml = new Ll),
        a = new Nl(b,c,a.g()),
        a.g = void 0,
        Ql(d, a))
    }
    function Xl(a, b) {
        a && Wl(a, Jl, b)
    }
    ;function Yl(a) {
        if (typeof a !== v || a.trim() === "")
            throw Error("Calls to uncheckedconversion functions must go through security review. A justification must be provided to capture what security assumptions are being made. See go/unchecked-conversions");
    }
    ;function Zl(a) {
        Dc.test(a) && (a.indexOf("&") != -1 && (a = a.replace(xc, "&amp;")),
        a.indexOf("<") != -1 && (a = a.replace(yc, "&lt;")),
        a.indexOf(">") != -1 && (a = a.replace(zc, "&gt;")),
        a.indexOf('"') != -1 && (a = a.replace(Ac, "&quot;")),
        a.indexOf("'") != -1 && (a = a.replace(Bc, "&#39;")),
        a.indexOf("\x00") != -1 && (a = a.replace(Cc, "&#0;")));
        return a
    }
    var $l = String.prototype.repeat ? function(a, b) {
        return a.repeat(b)
    }
    : function(a, b) {
        return Array(b + 1).join(a)
    }
    ;
    function am(a, b) {
        if (!Number.isFinite(a))
            return String(a);
        a = String(a);
        var c = a.indexOf(".");
        c === -1 && (c = a.length);
        var d = a[0] === "-" ? "-" : "";
        d && (a = a.substring(1));
        return d + $l("0", Math.max(0, b - c)) + a
    }
    ;function bm(a, b, c, d, e, f, g) {
        var h = "";
        a && (h += a + ":");
        c && (h += "//",
        b && (h += b + "@"),
        h += c,
        d && (h += ":" + d));
        e && (h += e);
        f && (h += "?" + f);
        g && (h += "#" + g);
        return h
    }
    var cm = RegExp("^(?:([^:/?#.]+):)?(?://(?:([^\\\\/?#]*)@)?([^\\\\/?#]*?)(?::([0-9]+))?(?=[\\\\/?#]|$))?([^?#]+)?(?:\\?([^#]*))?(?:#([\\s\\S]*))?$");
    function dm(a, b) {
        if (a) {
            a = a.split("&");
            for (var c = 0; c < a.length; c++) {
                var d = a[c].indexOf("=")
                  , e = null;
                if (d >= 0) {
                    var f = a[c].substring(0, d);
                    e = a[c].substring(d + 1)
                } else
                    f = a[c];
                b(f, e ? decodeURIComponent(e.replace(/\+/g, " ")) : "")
            }
        }
    }
    function em(a, b) {
        if (!b)
            return a;
        var c = a.indexOf("#");
        c < 0 && (c = a.length);
        var d = a.indexOf("?");
        if (d < 0 || d > c) {
            d = c;
            var e = ""
        } else
            e = a.substring(d + 1, c);
        a = [a.slice(0, d), e, a.slice(c)];
        c = a[1];
        a[1] = b ? c ? c + "&" + b : b : c;
        return a[0] + (a[1] ? "?" + a[1] : "") + a[2]
    }
    function fm(a, b, c) {
        qc(a);
        if (Array.isArray(b)) {
            G(b);
            for (var d = 0; d < b.length; d++)
                fm(a, String(b[d]), c)
        } else
            b != null && c.push(a + (b === "" ? "" : "=" + encodeURIComponent(String(b))))
    }
    function gm(a, b) {
        E(Math.max(a.length - (b || 0), 0) % 2 == 0, "goog.uri.utils: Key/value lists must be even in length.");
        var c = [];
        for (b = b || 0; b < a.length; b += 2)
            fm(a[b], a[b + 1], c);
        return c.join("&")
    }
    function hm(a) {
        var b = [], c;
        for (c in a)
            fm(c, a[c], b);
        return b.join("&")
    }
    function im(a, b) {
        var c = arguments.length == 2 ? gm(arguments[1], 0) : gm(arguments, 1);
        return em(a, c)
    }
    ;var jm;
    jm = function(a) {
        if (!a)
            return a;
        a = (typeof a === q ? a.href : a).match(cm);
        var b = a[1];
        return b !== "http" && b !== "https" ? b || "" : bm(a[1], "", a[3], a[4], a[5], a[6], "")
    }
    ;
    function km(a) {
        a && typeof a.dispose == k && a.dispose()
    }
    ;function lm(a) {
        for (var b = 0, c = arguments.length; b < c; ++b) {
            var d = arguments[b];
            $b(d) ? lm.apply(null, d) : km(d)
        }
    }
    ;function W() {
        this.I = this.I;
        this.C = this.C
    }
    W.prototype.I = !1;
    W.prototype.Oa = mb("I");
    W.prototype.dispose = function() {
        this.I || (this.I = !0,
        this.K())
    }
    ;
    W.prototype[Symbol.dispose] = function() {
        this.dispose()
    }
    ;
    function mm(a, b) {
        a.I ? b() : (a.C || (a.C = []),
        a.C.push(b))
    }
    W.prototype.K = function() {
        if (this.C)
            for (; this.C.length; )
                this.C.shift()()
    }
    ;
    var nm = typeof AsyncContext !== "undefined" && typeof AsyncContext.Snapshot === k ? function(a) {
        return a && AsyncContext.Snapshot.wrap(a)
    }
    : kb();
    function om(a, b) {
        this.l = a;
        this.o = b;
        this.j = 0;
        this.g = null
    }
    om.prototype.get = function() {
        if (this.j > 0) {
            this.j--;
            var a = this.g;
            this.g = a.next;
            a.next = null
        } else
            a = this.l();
        return a
    }
    ;
    function pm(a, b) {
        a.o(b);
        a.j < 100 && (a.j++,
        b.next = a.g,
        a.g = b)
    }
    ;var qm = []
      , rm = []
      , sm = !1;
    function tm(a) {
        qm[qm.length] = a;
        if (sm)
            for (var b = 0; b < rm.length; b++)
                a(fc(rm[b].g, rm[b]))
    }
    ;tm(lb());
    function um() {
        this.j = this.g = null
    }
    um.prototype.add = function(a, b) {
        var c = vm.get();
        c.set(a, b);
        this.j ? this.j.next = c : (E(!this.g),
        this.g = c);
        this.j = c
    }
    ;
    um.prototype.remove = function() {
        var a = null;
        this.g && (a = this.g,
        this.g = this.g.next,
        this.g || (this.j = null),
        a.next = null);
        return a
    }
    ;
    var vm = new om(function() {
        return new wm
    }
    ,function(a) {
        return a.reset()
    }
    );
    function wm() {
        this.next = this.g = this.j = null
    }
    wm.prototype.set = function(a, b) {
        this.j = a;
        this.g = b;
        this.next = null
    }
    ;
    wm.prototype.reset = function() {
        this.next = this.g = this.j = null
    }
    ;
    var xm = C.console && C.console.createTask ? C.console.createTask.bind(C.console) : void 0
      , ym = xm ? Symbol("consoleTask") : void 0;
    function zm(a, b) {
        function c() {
            var h = Ob.apply(0, arguments)
              , l = this;
            return g.run(function() {
                return a.call.apply(a, [l].concat(Ab(h)))
            })
        }
        b = b === void 0 ? "anonymous" : b;
        if (ym && a[ym])
            return a;
        var d = a, e, f = (e = Am) == null ? void 0 : e();
        a = function() {
            var h = Ob.apply(0, arguments), l, m = (l = Am) == null ? void 0 : l();
            if (f !== m)
                throw Error(b + " was scheduled in '" + f + "' but called in '" + m + "'.\nMake sure your test awaits all async calls.\n\nTIP: To help investigate, debug the test in Chrome and look at the async portion\nof the call stack to see what originally scheduled the callback.  Then, make the\ntest wait for the relevant asynchronous work to finish.");
            return d.call.apply(d, [this].concat(Ab(h)))
        }
        ;
        if (!xm)
            return a;
        var g = xm(a.name || b);
        c[F(ym)] = g;
        return c
    }
    var Am;
    var Bm, Cm = !1, Dm = new um;
    function Em(a, b) {
        a = zm(a, "goog.async.run");
        Bm || Fm();
        Cm || (Bm(),
        Cm = !0);
        Dm.add(a, b)
    }
    function Fm() {
        var a = Promise.resolve(void 0);
        Bm = function() {
            a.then(Gm)
        }
    }
    function Gm() {
        for (var a; a = Dm.remove(); ) {
            try {
                a.j.call(a.g)
            } catch (b) {
                vc(b)
            }
            pm(vm, a)
        }
        Cm = !1
    }
    ;function Hm() {}
    function Im(a) {
        return a
    }
    function Jm(a, b) {
        var c = arguments
          , d = c.length;
        return function() {
            var e;
            d && (e = c[d - 1].apply(this, arguments));
            for (var f = d - 2; f >= 0; f--)
                e = c[f].call(this, e);
            return e
        }
    }
    ;function Km(a) {
        if (!a)
            return !1;
        try {
            return !!a.$goog_Thenable
        } catch (b) {
            return !1
        }
    }
    ;function Lm(a) {
        this.g = 0;
        this.B = void 0;
        this.o = this.j = this.l = null;
        this.v = this.C = !1;
        if (a != Hm)
            try {
                var b = this;
                a.call(void 0, function(c) {
                    Mm(b, 2, c)
                }, function(c) {
                    if (!(c instanceof Nm))
                        try {
                            if (c instanceof Error)
                                throw c;
                            throw Error("Promise rejected.");
                        } catch (d) {}
                    Mm(b, 3, c)
                })
            } catch (c) {
                Mm(this, 3, c)
            }
    }
    function Om() {
        this.next = this.o = this.l = this.j = this.g = null;
        this.v = !1
    }
    Om.prototype.reset = function() {
        this.o = this.l = this.j = this.g = null;
        this.v = !1
    }
    ;
    var Pm = new om(function() {
        return new Om
    }
    ,function(a) {
        a.reset()
    }
    );
    function Qm(a, b, c) {
        var d = Pm.get();
        d.j = a;
        d.l = b;
        d.o = c;
        return d
    }
    Lm.prototype.then = function(a, b, c) {
        a != null && rc(a, Wa);
        b != null && rc(b, Xa);
        return Rm(this, nm(typeof a === k ? a : null), nm(typeof b === k ? b : null), c)
    }
    ;
    Lm.prototype.$goog_Thenable = !0;
    Lm.prototype.cancel = function(a) {
        if (this.g == 0) {
            var b = new Nm(a);
            Em(function() {
                Sm(this, b)
            }, this)
        }
    }
    ;
    function Sm(a, b) {
        if (a.g == 0)
            if (a.l) {
                var c = a.l;
                if (c.j) {
                    for (var d = 0, e = null, f = null, g = c.j; g && (g.v || (d++,
                    g.g == a && (e = g),
                    !(e && d > 1))); g = g.next)
                        e || (f = g);
                    e && (c.g == 0 && d == 1 ? Sm(c, b) : (f ? (d = f,
                    E(c.j),
                    E(d != null),
                    d.next == c.o && (c.o = d),
                    d.next = d.next.next) : Tm(c),
                    Um(c, e, 3, b)))
                }
                a.l = null
            } else
                Mm(a, 3, b)
    }
    function Vm(a, b) {
        a.j || a.g != 2 && a.g != 3 || Wm(a);
        E(b.j != null);
        a.o ? a.o.next = b : a.j = b;
        a.o = b
    }
    function Rm(a, b, c, d) {
        b && (b = zm(b, La));
        c && (c = zm(c, La));
        var e = Qm(null, null, null);
        e.g = new Lm(function(f, g) {
            e.j = b ? function(h) {
                try {
                    var l = b.call(d, h);
                    f(l)
                } catch (m) {
                    g(m)
                }
            }
            : f;
            e.l = c ? function(h) {
                try {
                    var l = c.call(d, h);
                    l === void 0 && h instanceof Nm ? g(h) : f(l)
                } catch (m) {
                    g(m)
                }
            }
            : g
        }
        );
        e.g.l = a;
        Vm(a, e);
        return e.g
    }
    Lm.prototype.D = function(a) {
        E(this.g == 1);
        this.g = 0;
        Mm(this, 2, a)
    }
    ;
    Lm.prototype.H = function(a) {
        E(this.g == 1);
        this.g = 0;
        Mm(this, 3, a)
    }
    ;
    function Mm(a, b, c) {
        if (a.g == 0) {
            a === c && (b = 3,
            c = new TypeError("Promise cannot resolve to itself"));
            a.g = 1;
            a: {
                var d = c
                  , e = a.D
                  , f = a.H;
                if (d instanceof Lm) {
                    e != null && rc(e, Wa);
                    f != null && rc(f, Xa);
                    Vm(d, Qm(e || Hm, f || null, a));
                    var g = !0
                } else if (Km(d))
                    d.then(e, f, a),
                    g = !0;
                else {
                    if (ac(d))
                        try {
                            var h = d.then;
                            if (typeof h === k) {
                                Xm(d, h, e, f, a);
                                g = !0;
                                break a
                            }
                        } catch (l) {
                            f.call(a, l);
                            g = !0;
                            break a
                        }
                    g = !1
                }
            }
            g || (a.B = c,
            a.g = b,
            a.l = null,
            Wm(a),
            b != 3 || c instanceof Nm || Ym(a, c))
        }
    }
    function Xm(a, b, c, d, e) {
        function f(l) {
            h || (h = !0,
            d.call(e, l))
        }
        function g(l) {
            h || (h = !0,
            c.call(e, l))
        }
        var h = !1;
        try {
            b.call(a, g, f)
        } catch (l) {
            f(l)
        }
    }
    function Wm(a) {
        a.C || (a.C = !0,
        Em(a.I, a))
    }
    function Tm(a) {
        var b = null;
        a.j && (b = a.j,
        a.j = b.next,
        b.next = null);
        a.j || (a.o = null);
        b != null && E(b.j != null);
        return b
    }
    Lm.prototype.I = function() {
        for (var a; a = Tm(this); )
            Um(this, a, this.g, this.B);
        this.C = !1
    }
    ;
    function Um(a, b, c, d) {
        if (c == 3 && b.l && !b.v)
            for (; a && a.v; a = a.l)
                a.v = !1;
        if (b.g)
            b.g.l = null,
            Zm(b, c, d);
        else
            try {
                b.v ? b.j.call(b.o) : Zm(b, c, d)
            } catch (e) {
                $m.call(null, e)
            }
        pm(Pm, b)
    }
    function Zm(a, b, c) {
        b == 2 ? a.j.call(a.o, c) : a.l && a.l.call(a.o, c)
    }
    function Ym(a, b) {
        a.v = !0;
        Em(function() {
            a.v && $m.call(null, b)
        })
    }
    var $m = vc;
    function Nm(a) {
        kc.call(this, a);
        this.g = !1
    }
    jc(Nm, kc);
    Nm.prototype.name = "cancel";
    /*

 Copyright 2005, 2007 Bob Ippolito. All Rights Reserved.
 Copyright The Closure Library Authors.
 SPDX-License-Identifier: MIT
*/
    function an() {
        this.v = [];
        this.o = this.l = !1;
        this.j = void 0;
        this.D = this.H = this.B = !1;
        this.C = 0;
        this.g = null;
        this.I = 0
    }
    an.prototype.cancel = function(a) {
        if (this.l)
            this.j instanceof an && this.j.cancel();
        else {
            if (this.g) {
                var b = this.g;
                delete this.g;
                a ? b.cancel(a) : (b.I--,
                b.I <= 0 && b.cancel())
            }
            this.D = !0;
            this.l || (a = new bn(this),
            cn(this),
            dn(a),
            en(this, !1, a))
        }
    }
    ;
    an.prototype.O = function(a, b) {
        this.B = !1;
        en(this, a, b)
    }
    ;
    function en(a, b, c) {
        a.l = !0;
        a.j = c;
        a.o = !b;
        fn(a)
    }
    function cn(a) {
        if (a.l) {
            if (!a.D)
                throw new gn(a);
            a.D = !1
        }
    }
    function hn(a, b) {
        cn(a);
        dn(b);
        en(a, !0, b)
    }
    function jn(a) {
        throw a;
    }
    function dn(a) {
        E(!(a instanceof an), "An execution sequence may not be initiated with a blocking Deferred.")
    }
    function kn(a, b, c) {
        return ln(a, b, null, c)
    }
    function mn(a, b, c) {
        ln(a, b, function(d) {
            var e = b.call(this, d);
            if (e === void 0)
                throw d;
            return e
        }, c)
    }
    function ln(a, b, c, d) {
        E(!a.H, "Blocking Deferreds can not be re-used");
        var e = a.l;
        e || (b === c ? b = c = nm(b) : (b = nm(b),
        c = nm(c)));
        a.v.push([b, c, d]);
        e && fn(a);
        return a
    }
    an.prototype.then = function(a, b, c) {
        var d, e, f = new Lm(function(g, h) {
            e = g;
            d = h
        }
        );
        ln(this, e, function(g) {
            g instanceof bn ? f.cancel() : d(g);
            return nn
        }, this);
        return f.then(a, b, c)
    }
    ;
    an.prototype.$goog_Thenable = !0;
    function on(a) {
        return Sc(a.v, function(b) {
            return typeof b[1] === k
        })
    }
    var nn = {};
    function fn(a) {
        if (a.C && a.l && on(a)) {
            var b = a.C
              , c = pn[b];
            c && (C.clearTimeout(c.g),
            delete pn[b]);
            a.C = 0
        }
        a.g && (a.g.I--,
        delete a.g);
        b = a.j;
        for (var d = c = !1; a.v.length && !a.B; ) {
            var e = a.v.shift()
              , f = e[0]
              , g = e[1];
            e = e[2];
            if (f = a.o ? g : f)
                try {
                    var h = f.call(e || null, b);
                    h === nn && (h = void 0);
                    h !== void 0 && (a.o = a.o && (h == b || h instanceof Error),
                    a.j = b = h);
                    if (Km(b) || typeof C.Promise === k && b instanceof C.Promise)
                        d = !0,
                        a.B = !0
                } catch (l) {
                    b = l,
                    a.o = !0,
                    on(a) || (c = !0)
                }
        }
        a.j = b;
        d && (h = fc(a.O, a, !0),
        d = fc(a.O, a, !1),
        b instanceof an ? (ln(b, h, d),
        b.H = !0) : b.then(h, d));
        c && (b = new qn(b),
        pn[b.g] = b,
        a.C = b.g)
    }
    function rn(a) {
        var b = new an;
        hn(b, a);
        return b
    }
    function gn() {
        kc.call(this)
    }
    jc(gn, kc);
    gn.prototype.message = "Deferred has already fired";
    gn.prototype.name = "AlreadyCalledError";
    function bn() {
        kc.call(this)
    }
    jc(bn, kc);
    bn.prototype.message = "Deferred was canceled";
    bn.prototype.name = "CanceledError";
    function qn(a) {
        this.g = C.setTimeout(fc(this.l, this), 0);
        this.j = a
    }
    qn.prototype.l = function() {
        E(pn[this.g], "Cannot throw an error that is not scheduled.");
        delete pn[this.g];
        jn(this.j)
    }
    ;
    var pn = {};
    Vl("fava.debug.ErrorReporter");
    function sn() {}
    function tn(a) {
        return a != null && !!a.mb
    }
    sn.prototype.mb = !0;
    sn.prototype.A = ["javax.inject.Provider", 1];
    function un() {}
    function vn(a) {
        return a != null && !!a.jb
    }
    un.prototype.jb = !0;
    un.prototype.A = ["com.google.apps.docs.xplat.flag.FlagService", 1];
    var wn;
    function xn() {}
    z(xn, R);
    xn.prototype.get = function() {
        if (this.j == null) {
            var a = U(C._docs_flag_initialData, Kk, Jk);
            this.j = a != null ? a : U({}, Kk, Jk)
        }
        return this.j
    }
    ;
    xn.prototype.g = function() {
        return this.get()
    }
    ;
    xn.prototype.mb = !0;
    xn.prototype.A = ["com.google.apps.docs.xplat.flag.FlagServiceHelper", 0];
    function yn(a) {
        return typeof a == v ? a == db || a == "1" : !!a
    }
    ;function zn(a) {
        this.g = new xn;
        this.j = null;
        if (a != null)
            for (var b in a) {
                var c = b
                  , d = a[b];
                if (this.j != null)
                    throw ji("Cannot use setClientFlag when comparison is enabled.").g;
                var e = U(this.g.g(), Kk, Jk), f;
                var g = d;
                (f = g == null || Yh(g) || ti(g) || xj(g) || Ea === typeof g || Array.isArray(g)) || (g == null ? g = Va : (f = typeof g,
                g = V(f) === q ? Array.isArray(g) ? "array" : f : f),
                f = q === g);
                if (!f)
                    throw hi("Invalid value type: " + S(d)).g;
                Yh(d) ? (d = U(d, Yh, Xh).g,
                e[c] = d) : e[c] = d != null ? d : null
            }
    }
    z(zn, R);
    zn.prototype.clear = function() {
        this.g = new xn;
        this.j = null
    }
    ;
    zn.prototype.get = function(a) {
        An(this, a);
        return U(this.g.g(), Kk, Jk)[a]
    }
    ;
    function Bn(a, b) {
        a = U(a.g.g(), Kk, Jk);
        return b in a
    }
    function Cn(a, b) {
        An(a, b);
        if (!Bn(a, b) || a.get(b) == null)
            return NaN;
        try {
            var c = S(a.get(b));
            ri == null && (ri = RegExp("^\\s*[+-]?(NaN|Infinity|((\\d+\\.?\\d*)|(\\.\\d+))([eE][+-]?\\d+)?[dDfF]?)\\s*$"));
            if (!ri.test(c)) {
                var d = new Rj;
                Eh(d, 'For input string: "' + S(c) + '"');
                T(d, Error(d));
                throw d.g;
            }
            return parseFloat(c)
        } catch (f) {
            var e = Jh(f);
            if (e instanceof Rj)
                return NaN;
            throw e.g;
        }
    }
    function Dn(a, b) {
        An(a, b);
        if (!Bn(a, b))
            return "";
        a = a.get(b);
        if (a == null)
            return "";
        var c;
        if (b = ti(a) && (c = U(a, ti, si),
        !0)) {
            b = ui(V(c));
            var d = ui(V(c));
            b = b.equals(d)
        }
        return b ? "" + ui(V(c)) : S(a)
    }
    function An(a, b) {
        if (a.j != null) {
            try {
                var c = U(a.g.g(), Kk, Jk)[b]
            } catch (h) {
                var d = Jh(h);
                if (d instanceof Oh)
                    c = Na;
                else
                    throw d.g;
            }
            try {
                var e = a.j;
                if (e == null)
                    throw Kh().g;
                var f = U(U(e, tn, sn).g(), Kk, Jk)[b]
            } catch (h) {
                var g = Jh(h);
                if (g instanceof Oh)
                    f = Na;
                else
                    throw g.g;
            }
            if (!Ki(c, f))
                throw ji("Logging is not supported.").g;
        }
    }
    zn.prototype.jb = !0;
    zn.prototype.A = ["com.google.apps.docs.xplat.flag.FlagServiceImpl", 0];
    function En(a) {
        Ek.call(this, a, null);
        T(this, Error(this))
    }
    z(En, Ek);
    En.prototype.A = ["com.google.apps.docs.xplat.net.LimitException", 0];
    function Fn(a, b, c, d) {
        Qk();
        Ok.call(this);
        this.g = this.j = !1;
        this.C = a;
        this.o = b;
        this.l = new Gn(Math.imul(c, 1E3),d)
    }
    z(Fn, Ok);
    function Hn(a) {
        if (!((a.l.get(null) + 1 | 0) / V(a.l.l / 1E3) <= a.o))
            throw (new En("Query would cause " + S(a.C) + " to exceed " + a.o + " qps.")).g;
        a = a.l;
        var b = dh(lh(Date.now()));
        In(a, b);
        var c = U(Jn(a.g), Kn, Ln);
        if (c == null || V(b) >= V(c.j))
            b = Mn(a, V(b)),
            c = new Ln,
            c.j = b,
            c.g = 0,
            c.o = 2147483647,
            c.l = -2147483648,
            a.g.add(c);
        c.g = c.g + 1 | 0;
        c.o = Math.min(1, c.o);
        c.l = Math.max(1, c.l)
    }
    Fn.prototype.A = ["com.google.apps.docs.xplat.net.QpsLimiter", 0];
    function Ln() {
        this.l = this.o = this.g = 0
    }
    z(Ln, R);
    function Kn(a) {
        return a instanceof Ln
    }
    Ln.prototype.A = ["com.google.apps.docs.xplat.util.BasicStat$Slot", 0];
    function Gn(a) {
        this.j = this.l = 0;
        this.o = ak("BasicStat");
        if (!(a > 50))
            throw a = new Ph,
            Fh(a),
            T(a, Error(a)),
            a.g;
        this.l = a;
        this.j = vi(a / 50);
        this.g = new Nn(Mi(50))
    }
    z(Gn, R);
    Gn.prototype.get = function(a) {
        return On(this, a, function(b, c) {
            b = U(b, Yh, Xh);
            c = U(c, Kn, Ln);
            return Mi(b.g + c.g | 0)
        })
    }
    ;
    function On(a, b, c) {
        b = b != null ? V(b) : dh(lh(Date.now()));
        In(a, b);
        var d = 0;
        b = Mn(a, V(b));
        b = V(b) - a.l;
        for (var e = a.g.g.length - 1 | 0; e >= 0; e = e - 1 | 0) {
            var f = U(a.g.get(e), Kn, Ln);
            if (V(f.j) <= b)
                break;
            d = U(c(Mi(d), f), Yh, Xh).g
        }
        return d
    }
    function Mn(a, b) {
        return a.j * Math.floor(b / a.j + 1)
    }
    function In(a, b) {
        var c = U(Jn(a.g), Kn, Ln);
        if (c != null && (c = V(c.j) - a.j,
        V(b) < V(c))) {
            c = "Went backwards in time: now=" + S(b) + ", slotStart=" + S(c) + "%d.  Resetting state.";
            b = a.o;
            var d = (bk(),
            ck);
            dk(b, d) && (c = ek(d, c),
            c.g = null,
            fk(b, c));
            a.g.clear()
        }
    }
    Gn.prototype.A = ["com.google.apps.docs.xplat.util.BasicStat", 0];
    function Nn(a) {
        this.j = this.l = 0;
        a != null ? ti(a) ? (a = V(a),
        a = Math.max(Math.min(a, 2147483647), -2147483648) | 0) : a = a instanceof ch ? V(a).J : a.Z() : a = 100;
        this.l = a;
        this.g = U([], Ik, Hk)
    }
    z(Nn, R);
    x = Nn.prototype;
    x.add = function(a) {
        var b = this.g[this.j];
        this.g[this.j] = a;
        this.j = vi((this.j + 1 | 0) % this.l);
        return b
    }
    ;
    x.get = function(a) {
        a = Pn(this, a);
        return this.g[a]
    }
    ;
    x.set = function(a, b) {
        a = Pn(this, a);
        this.g[a] = b
    }
    ;
    x.clear = function() {
        this.j = this.g.length = 0
    }
    ;
    x.La = function() {
        for (var a = this.g.length, b = this.g.length - this.g.length | 0, c = U([], Ik, Hk); b < a; b = b + 1 | 0) {
            var d = c
              , e = this.get(b);
            d.push(e)
        }
        return c
    }
    ;
    x.Ka = function() {
        for (var a = [], b = this.g.length, c = 0; c < b; c = c + 1 | 0) {
            var d = a
              , e = c
              , f = c;
            try {
                if (d != null && (typeof d != q || typeof d.length != n)) {
                    var g = new ei;
                    Fh(g);
                    T(g, Error(g));
                    throw g.g;
                }
            } catch (h) {
                a = Jh(h);
                if (a instanceof Nh)
                    throw c = b = new di,
                    d = S(a),
                    c.j = Mh(a) ? a : null,
                    c.l = d,
                    Fh(c),
                    T(b, Error(b)),
                    b.g;
                throw a.g;
            }
            d[e] = f
        }
        return a
    }
    ;
    function Jn(a) {
        return a.g.length == 0 ? null : a.get(a.g.length - 1 | 0)
    }
    function Pn(a, b) {
        if (b >= a.g.length)
            throw a = new Rh,
            Fh(a),
            T(a, Error(a)),
            a.g;
        return a.g.length < a.l ? b : vi((a.j + b | 0) % a.l)
    }
    x.A = ["com.google.apps.docs.xplat.util.CircularBuffer", 0];
    function Qn() {
        this.g = 0
    }
    var Rn, Sn;
    z(Qn, R);
    function Y(a, b) {
        var c = new Qn;
        c.j = a;
        c.g = b;
        if (a in Rn)
            throw Qh("docs.xplat.net.Status.State instances should be uniquely named.").g;
        Rn[a] = c !== void 0 ? c : null;
        return c
    }
    Qn.prototype.toString = mb("j");
    function Tn() {
        Tn = lb();
        Rn = U({}, Mk, Lk);
        Y("IDLE", 1);
        Y("BUSY", 1);
        Y("RECOVERING", 2);
        Sn = Y("OFFLINE", 3);
        Y("SERVER_DOWN", 3);
        Y("FORBIDDEN", 4);
        Y("AUTH_REQUIRED", 4);
        Y("DELTA_STALE_CLIENT", 4);
        Y("SESSION_LIMIT_EXCEEDED", 5);
        Y("LOCKED", 5);
        Y("INCOMPATIBLE_SERVER", 5);
        Y("CLIENT_ERROR", 5);
        Y("CLIENT_FATAL_ERROR", 5);
        Y("CLIENT_FATAL_ERROR_PENDING_CHANGES", 5);
        Y("BATCH_CLIENT_ERROR", 3);
        Y("SAVE_ERROR", 5);
        Y("DOCUMENT_TOO_LARGE", 5);
        Y("BATCH_SAVE_ERROR", 3);
        Y("DOCS_EVERYWHERE_IMPORT_ERROR", 5);
        Y("POST_LIMIT_EXCEEDED_ERROR", 5);
        Y("DOCS_QUOTA_EXCEEDED_ERROR", 5)
    }
    Qn.prototype.A = ["com.google.apps.docs.xplat.net.Status$State", 0];
    function Un() {}
    z(Un, R);
    function Vn(a) {
        return a instanceof Un
    }
    Un.prototype.A = ["com.google.apps.docsshared.xplat.observable.EventObserverTracker$ObservableObserverPair", 0];
    function Wn() {
        Qk();
        Ok.call(this);
        this.g = this.j = !1;
        this.l = U([], Ik, Hk)
    }
    z(Wn, Ok);
    function Xn(a, b, c) {
        var d;
        a: {
            for (d = 0; d < a.l.length; d = d + 1 | 0) {
                var e = U(a.l[d], Vn, Un);
                if (yh(e.j, c) && yh(e.g, b)) {
                    d = !0;
                    break a
                }
            }
            d = !1
        }
        d || (a = a.l,
        c = b.g(c),
        d = new Un,
        d.g = b,
        d.j = c,
        a.push(d))
    }
    Wn.prototype.Wa = function() {
        for (var a = U(this.l.pop(), Vn, Un); a != null; )
            a.g.j(a.j),
            a = U(this.l.pop(), Vn, Un);
        Ok.prototype.Wa.call(this)
    }
    ;
    Wn.prototype.A = ["com.google.apps.docsshared.xplat.observable.EventObserverTracker", 0];
    function Yn(a, b, c) {
        b = Error.call(this, b);
        this.message = b.message;
        "stack"in b && (this.stack = b.stack);
        this.name = a;
        this.authUrl = c
    }
    z(Yn, Error);
    Vb("AuthRequiredError", Yn);
    function Zn(a, b) {
        b = Error.call(this, b);
        this.message = b.message;
        "stack"in b && (this.stack = b.stack);
        this.name = a
    }
    z(Zn, Error);
    function $n(a) {
        return ao("InvalidArgumentError", a)
    }
    function ao(a, b) {
        b = Error(b);
        b.name = a;
        return b
    }
    ;function bo(a, b) {
        this.width = a;
        this.height = b
    }
    x = bo.prototype;
    x.clone = function() {
        return new bo(this.width,this.height)
    }
    ;
    x.toString = function() {
        return "(" + this.width + " x " + this.height + ")"
    }
    ;
    x.aspectRatio = function() {
        return this.width / this.height
    }
    ;
    x.ceil = function() {
        this.width = Math.ceil(this.width);
        this.height = Math.ceil(this.height);
        return this
    }
    ;
    x.floor = function() {
        this.width = Math.floor(this.width);
        this.height = Math.floor(this.height);
        return this
    }
    ;
    x.round = function() {
        this.width = Math.round(this.width);
        this.height = Math.round(this.height);
        return this
    }
    ;
    function co(a, b, c) {
        for (var d in a)
            b.call(c, a[d], d, a)
    }
    function eo(a, b) {
        return a !== null && b in a ? a[b] : void 0
    }
    function fo(a) {
        var b = {}, c;
        for (c in a)
            b[c] = a[c];
        return b
    }
    var go = "constructor hasOwnProperty isPrototypeOf propertyIsEnumerable toLocaleString toString valueOf".split(" ");
    function ho(a, b) {
        for (var c, d, e = 1; e < arguments.length; e++) {
            d = arguments[e];
            for (c in d)
                a[c] = d[c];
            for (var f = 0; f < go.length; f++)
                c = go[f],
                Object.prototype.hasOwnProperty.call(d, c) && (a[c] = d[c])
        }
    }
    ;function io(a, b) {
        if (a instanceof ol)
            return a;
        a = String(a).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
        if (b == null ? 0 : b.hb)
            a = a.replace(/(^|[\r\n\t ]) /g, "$1&#160;");
        if (b == null ? 0 : b.gb)
            a = a.replace(/(\r\n|\n|\r)/g, "<br>");
        if (b == null ? 0 : b.Od)
            a = a.replace(/(\t+)/g, '<span style="white-space:pre">$1</span>');
        return pl(a)
    }
    function jo(a) {
        return ko(a)
    }
    function ko(a) {
        var b = io("");
        return pl(a.map(function(c) {
            return ql(io(c))
        }).join(ql(b).toString()))
    }
    var lo = /^[a-z][a-z\d-]*$/i
      , mo = "APPLET BASE EMBED IFRAME LINK MATH META OBJECT SCRIPT STYLE SVG TEMPLATE".split(" ")
      , no = "AREA BR COL COMMAND HR IMG INPUT KEYGEN PARAM SOURCE TRACK WBR".split(" ")
      , oo = ["action", "formaction", "href"];
    function po(a, b) {
        if (!lo.test("a"))
            throw Error("Invalid tag name <a>.");
        if (mo.indexOf("A") !== -1)
            throw Error("Tag name <a> is not allowed for createHtml.");
        var c = "<a";
        a && (c += qo(a));
        Array.isArray(b) || (b = b === void 0 ? [] : [b]);
        if (no.indexOf("A") !== -1) {
            if (b.length > 0)
                throw Error("Void tag <a> does not allow content.");
            c += ">"
        } else
            a = jo(b.map(function(d) {
                return d instanceof ol ? d : io(String(d))
            })),
            c += ">" + a.toString() + "</a>";
        return pl(c)
    }
    function qo(a) {
        for (var b = "", c = Object.keys(a), d = 0; d < c.length; d++) {
            var e = c[d]
              , f = a[e];
            if (!lo.test(e))
                throw Error('Invalid attribute name "' + e + '".');
            if (f !== void 0 && f !== null) {
                if (/^on./i.test(e))
                    throw Error('Attribute "' + e + " is forbidden. Inline event handlers can lead to XSS. Please use the 'addEventListener' API instead.");
                oo.indexOf(e.toLowerCase()) !== -1 && (f = f instanceof bl ? f.toString() : kl(String(f)) || va);
                if (!(f instanceof bl || f instanceof ol) && typeof f !== v && typeof f !== n)
                    throw Error("String or number value expected, got " + typeof f + " with value '" + f + "' given.");
                f = e + '="' + io(String(f)) + '"';
                b += " " + f
            }
        }
        return b
    }
    ;function ro(a) {
        return a ? new so(to(a)) : lc || (lc = new so)
    }
    function uo(a) {
        var b = document;
        return typeof a === v ? b.getElementById(a) : a
    }
    function vo(a, b) {
        return (b || document).getElementsByTagName(String(a))
    }
    function wo(a, b) {
        co(b, function(c, d) {
            d == "style" ? a.style.cssText = c : d == "class" ? a.className = c : d == "for" ? a.htmlFor = c : xo.hasOwnProperty(d) ? a.setAttribute(xo[d], c) : d.lastIndexOf("aria-", 0) == 0 || d.lastIndexOf("data-", 0) == 0 ? a.setAttribute(d, c) : a[d] = c
        })
    }
    var xo = {
        cellpadding: "cellPadding",
        cellspacing: "cellSpacing",
        colspan: "colSpan",
        frameborder: "frameBorder",
        height: "height",
        maxlength: "maxLength",
        nonce: "nonce",
        role: "role",
        rowspan: "rowSpan",
        type: "type",
        usemap: "useMap",
        valign: "vAlign",
        width: "width"
    };
    function yo(a, b, c) {
        function d(h) {
            h && b.appendChild(typeof h === v ? a.createTextNode(h) : h)
        }
        for (var e = 2; e < c.length; e++) {
            var f = c[e];
            if (!$b(f) || ac(f) && f.nodeType > 0)
                d(f);
            else {
                a: {
                    if (f && typeof f.length == n) {
                        if (ac(f)) {
                            var g = typeof f.item == k || typeof f.item == v;
                            break a
                        }
                        if (typeof f === k) {
                            g = typeof f.item == k;
                            break a
                        }
                    }
                    g = !1
                }
                Rc(g ? Wc(f) : f, d)
            }
        }
    }
    function zo(a, b) {
        b = String(b);
        a.contentType === "application/xhtml+xml" && (b = b.toLowerCase());
        return a.createElement(b)
    }
    function Ao(a) {
        for (var b; b = a.firstChild; )
            a.removeChild(b)
    }
    function to(a) {
        E(a, "Node cannot be null or undefined.");
        return a.nodeType == 9 ? a : a.ownerDocument || a.document
    }
    function Bo(a) {
        return a.contentDocument || a.contentWindow.document
    }
    var Co = {
        SCRIPT: 1,
        STYLE: 1,
        HEAD: 1,
        IFRAME: 1,
        OBJECT: 1
    }
      , Do = {
        IMG: " ",
        BR: "\n"
    };
    function Eo(a, b, c) {
        if (!(a.nodeName in Co))
            if (a.nodeType == 3)
                c ? b.push(String(a.nodeValue).replace(/(\r\n|\r|\n)/g, "")) : b.push(a.nodeValue);
            else if (a.nodeName in Do)
                b.push(Do[a.nodeName]);
            else
                for (a = a.firstChild; a; )
                    Eo(a, b, c),
                    a = a.nextSibling
    }
    function so(a) {
        this.g = a || C.document || document
    }
    so.prototype.j = function(a, b, c) {
        var d = this.g
          , e = arguments
          , f = e[1]
          , g = zo(d, String(e[0]));
        f && (typeof f === v ? g.className = f : Array.isArray(f) ? g.className = f.join(" ") : wo(g, f));
        e.length > 2 && yo(d, g, e);
        return g
    }
    ;
    function Fo(a, b) {
        this.g = a[C.Symbol.iterator]();
        this.j = b
    }
    Fo.prototype[Symbol.iterator] = function() {
        return this
    }
    ;
    Fo.prototype.next = function() {
        var a = this.g.next();
        return {
            value: a.done ? void 0 : this.j.call(void 0, a.value),
            done: a.done
        }
    }
    ;
    function Go(a, b) {
        return new Fo(a,b)
    }
    ;function Ho() {}
    Ho.prototype.next = function() {
        return Io
    }
    ;
    var Io = Cl({
        done: !0,
        value: void 0
    });
    Ho.prototype.ta = function() {
        return this
    }
    ;
    function Jo(a) {
        if (a instanceof Ko || a instanceof Lo || a instanceof Mo)
            return a;
        if (typeof a.next == k)
            return new Ko(function() {
                return a
            }
            );
        if (typeof a[Symbol.iterator] == k)
            return new Ko(function() {
                return a[Symbol.iterator]()
            }
            );
        if (typeof a.ta == k)
            return new Ko(function() {
                return a.ta()
            }
            );
        throw Error("Not an iterator or iterable.");
    }
    function Ko(a) {
        this.g = a
    }
    Ko.prototype.ta = function() {
        return new Lo(this.g())
    }
    ;
    Ko.prototype[Symbol.iterator] = function() {
        return new Mo(this.g())
    }
    ;
    Ko.prototype.j = function() {
        return new Mo(this.g())
    }
    ;
    function Lo(a) {
        this.g = a
    }
    z(Lo, Ho);
    Lo.prototype.next = function() {
        return this.g.next()
    }
    ;
    Lo.prototype[Symbol.iterator] = function() {
        return new Mo(this.g)
    }
    ;
    Lo.prototype.j = function() {
        return new Mo(this.g)
    }
    ;
    function Mo(a) {
        Ko.call(this, function() {
            return a
        });
        this.l = a
    }
    z(Mo, Ko);
    Mo.prototype.next = function() {
        return this.l.next()
    }
    ;
    function No(a, b) {
        this.j = {};
        this.g = [];
        this.l = this.size = 0;
        var c = arguments.length;
        if (c > 1) {
            if (c % 2)
                throw Error("Uneven number of arguments");
            for (var d = 0; d < c; d += 2)
                this.set(arguments[d], arguments[d + 1])
        } else if (a)
            if (a instanceof No)
                for (c = a.Ka(),
                d = 0; d < c.length; d++)
                    this.set(c[d], a.get(c[d]));
            else
                for (d in a)
                    this.set(d, a[d])
    }
    x = No.prototype;
    x.La = function() {
        Oo(this);
        for (var a = [], b = 0; b < this.g.length; b++)
            a.push(this.j[this.g[b]]);
        return a
    }
    ;
    x.Ka = function() {
        Oo(this);
        return this.g.concat()
    }
    ;
    x.has = function(a) {
        return Po(this.j, a)
    }
    ;
    x.equals = function(a, b) {
        if (this === a)
            return !0;
        if (this.size != a.size)
            return !1;
        b = b || Qo;
        Oo(this);
        for (var c, d = 0; c = this.g[d]; d++)
            if (!b(this.get(c), a.get(c)))
                return !1;
        return !0
    }
    ;
    function Qo(a, b) {
        return a === b
    }
    x.clear = function() {
        this.j = {};
        this.l = this.size = this.g.length = 0
    }
    ;
    x.remove = function(a) {
        return this.delete(a)
    }
    ;
    x.delete = function(a) {
        return Po(this.j, a) ? (delete this.j[a],
        --this.size,
        this.l++,
        this.g.length > 2 * this.size && Oo(this),
        !0) : !1
    }
    ;
    function Oo(a) {
        if (a.size != a.g.length) {
            for (var b = 0, c = 0; b < a.g.length; ) {
                var d = a.g[b];
                Po(a.j, d) && (a.g[c++] = d);
                b++
            }
            a.g.length = c
        }
        if (a.size != a.g.length) {
            b = {};
            for (d = c = 0; c < a.g.length; ) {
                var e = a.g[c];
                Po(b, e) || (a.g[d++] = e,
                b[e] = 1);
                c++
            }
            a.g.length = d
        }
    }
    x.get = function(a, b) {
        return Po(this.j, a) ? this.j[a] : b
    }
    ;
    x.set = function(a, b) {
        Po(this.j, a) || (this.size += 1,
        this.g.push(a),
        this.l++);
        this.j[a] = b
    }
    ;
    x.forEach = function(a, b) {
        for (var c = this.Ka(), d = 0; d < c.length; d++) {
            var e = c[d]
              , f = this.get(e);
            a.call(b, f, e, this)
        }
    }
    ;
    x.clone = function() {
        return new No(this)
    }
    ;
    x.keys = function() {
        return Jo(this.ta(!0)).j()
    }
    ;
    x.values = function() {
        return Jo(this.ta(!1)).j()
    }
    ;
    x.entries = function() {
        var a = this;
        return Go(this.keys(), function(b) {
            return [b, a.get(b)]
        })
    }
    ;
    x.ta = function(a) {
        Oo(this);
        var b = 0
          , c = this.l
          , d = this
          , e = new Ho;
        e.next = function() {
            if (c != d.l)
                throw Error("The map has changed since the iterator was created");
            if (b >= d.g.length)
                return Io;
            var f = d.g[b++];
            return {
                value: a ? f : d.j[f],
                done: !1
            }
        }
        ;
        return e
    }
    ;
    function Po(a, b) {
        return Object.prototype.hasOwnProperty.call(a, b)
    }
    ;function Ro(a, b, c) {
        var d = a.get(b);
        d || (d = [],
        a.set(b, d));
        d.push(c)
    }
    function So(a) {
        var b = a.type;
        if (typeof b === v)
            switch (b.toLowerCase()) {
            case "checkbox":
            case "radio":
                return a.checked ? a.value : null;
            case "select-one":
                return b = a.selectedIndex,
                b >= 0 ? a.options[b].value : null;
            case $a:
                b = [];
                for (var c, d = 0; c = a.options[d]; d++)
                    c.selected && b.push(c.value);
                return b.length ? b : null
            }
        return a.value != null ? a.value : null
    }
    ;function To(a) {
        this.g = a
    }
    function Uo(a, b, c) {
        if (b == null)
            c.push(Va);
        else {
            if (typeof b == q) {
                if (Array.isArray(b)) {
                    var d = b;
                    b = d.length;
                    c.push("[");
                    for (var e = "", f = 0; f < b; f++)
                        c.push(e),
                        e = d[f],
                        Uo(a, a.g ? a.g.call(d, String(f), e) : e, c),
                        e = ",";
                    c.push("]");
                    return
                }
                if (b instanceof String || b instanceof Number || b instanceof Boolean)
                    b = b.valueOf();
                else {
                    c.push("{");
                    f = "";
                    for (d in b)
                        Object.prototype.hasOwnProperty.call(b, d) && (e = b[d],
                        typeof e != k && (c.push(f),
                        Vo(d, c),
                        c.push(":"),
                        Uo(a, a.g ? a.g.call(b, d, e) : e, c),
                        f = ","));
                    c.push("}");
                    return
                }
            }
            switch (typeof b) {
            case v:
                Vo(b, c);
                break;
            case n:
                c.push(isFinite(b) && !isNaN(b) ? String(b) : Va);
                break;
            case Ea:
                c.push(String(b));
                break;
            case k:
                c.push(Va);
                break;
            default:
                throw Error("Unknown type: " + typeof b);
            }
        }
    }
    var Wo = {
        '"': '\\"',
        "\\": "\\\\",
        "/": "\\/",
        "\b": "\\b",
        "\f": "\\f",
        "\n": "\\n",
        "\r": "\\r",
        "\t": "\\t",
        "\v": "\\u000b"
    }
      , Xo = /\uffff/.test("\uffff") ? /[\\"\x00-\x1f\x7f-\uffff]/g : /[\\"\x00-\x1f\x7f-\xff]/g;
    function Vo(a, b) {
        b.push('"', a.replace(Xo, function(c) {
            var d = Wo[c];
            d || (d = "\\u" + (c.charCodeAt(0) | 65536).toString(16).slice(1),
            Wo[c] = d);
            return d
        }), '"')
    }
    ;function Yo(a, b) {
        this.type = a;
        this.currentTarget = this.target = b;
        this.defaultPrevented = this.j = !1
    }
    Yo.prototype.stopPropagation = function() {
        this.j = !0
    }
    ;
    Yo.prototype.preventDefault = function() {
        this.defaultPrevented = !0
    }
    ;
    var Zo = function() {
        if (!C.addEventListener || !Object.defineProperty)
            return !1;
        var a = !1
          , b = Object.defineProperty({}, "passive", {
            get: function() {
                a = !0
            }
        });
        try {
            var c = lb();
            C.addEventListener("test", c, b);
            C.removeEventListener("test", c, b)
        } catch (d) {}
        return a
    }();
    function $o(a, b) {
        Yo.call(this, a ? a.type : "");
        this.relatedTarget = this.currentTarget = this.target = null;
        this.button = this.screenY = this.screenX = this.clientY = this.clientX = this.offsetY = this.offsetX = 0;
        this.key = "";
        this.charCode = this.keyCode = 0;
        this.metaKey = this.shiftKey = this.altKey = this.ctrlKey = !1;
        this.state = null;
        this.pointerId = 0;
        this.pointerType = "";
        this.timeStamp = 0;
        this.g = null;
        a && this.init(a, b)
    }
    jc($o, Yo);
    $o.prototype.init = function(a, b) {
        var c = this.type = a.type
          , d = a.changedTouches && a.changedTouches.length ? a.changedTouches[0] : null;
        this.target = a.target || a.srcElement;
        this.currentTarget = b;
        b = a.relatedTarget;
        b || (c == "mouseover" ? b = a.fromElement : c == "mouseout" && (b = a.toElement));
        this.relatedTarget = b;
        d ? (this.clientX = d.clientX !== void 0 ? d.clientX : d.pageX,
        this.clientY = d.clientY !== void 0 ? d.clientY : d.pageY,
        this.screenX = d.screenX || 0,
        this.screenY = d.screenY || 0) : (this.offsetX = bd || a.offsetX !== void 0 ? a.offsetX : a.layerX,
        this.offsetY = bd || a.offsetY !== void 0 ? a.offsetY : a.layerY,
        this.clientX = a.clientX !== void 0 ? a.clientX : a.pageX,
        this.clientY = a.clientY !== void 0 ? a.clientY : a.pageY,
        this.screenX = a.screenX || 0,
        this.screenY = a.screenY || 0);
        this.button = a.button;
        this.keyCode = a.keyCode || 0;
        this.key = a.key || "";
        this.charCode = a.charCode || (c == "keypress" ? a.keyCode : 0);
        this.ctrlKey = a.ctrlKey;
        this.altKey = a.altKey;
        this.shiftKey = a.shiftKey;
        this.metaKey = a.metaKey;
        this.pointerId = a.pointerId || 0;
        this.pointerType = a.pointerType;
        this.state = a.state;
        this.timeStamp = a.timeStamp;
        this.g = a;
        a.defaultPrevented && $o.da.preventDefault.call(this)
    }
    ;
    $o.prototype.stopPropagation = function() {
        $o.da.stopPropagation.call(this);
        this.g.stopPropagation ? this.g.stopPropagation() : this.g.cancelBubble = !0
    }
    ;
    $o.prototype.preventDefault = function() {
        $o.da.preventDefault.call(this);
        var a = this.g;
        a.preventDefault ? a.preventDefault() : a.returnValue = !1
    }
    ;
    var ap = "closure_listenable_" + (Math.random() * 1E6 | 0);
    function bp(a) {
        return !(!a || !a[ap])
    }
    ;var cp = 0;
    function dp(a, b, c, d, e) {
        this.listener = a;
        this.proxy = null;
        this.src = b;
        this.type = c;
        this.capture = !!d;
        this.Ma = e;
        this.key = ++cp;
        this.Ba = this.Ea = !1
    }
    function ep(a) {
        a.Ba = !0;
        a.listener = null;
        a.proxy = null;
        a.src = null;
        a.Ma = null
    }
    ;function fp(a) {
        this.src = a;
        this.g = {};
        this.j = 0
    }
    fp.prototype.add = function(a, b, c, d, e) {
        var f = a.toString();
        a = this.g[f];
        a || (a = this.g[f] = [],
        this.j++);
        var g = gp(a, b, d, e);
        g > -1 ? (b = a[g],
        c || (b.Ea = !1)) : (b = new dp(b,this.src,f,!!d,e),
        b.Ea = c,
        a.push(b));
        return b
    }
    ;
    fp.prototype.remove = function(a, b, c, d) {
        a = a.toString();
        if (!(a in this.g))
            return !1;
        var e = this.g[a];
        b = gp(e, b, c, d);
        return b > -1 ? (ep(e[b]),
        E(e.length != null),
        Array.prototype.splice.call(e, b, 1),
        e.length == 0 && (delete this.g[a],
        this.j--),
        !0) : !1
    }
    ;
    function hp(a, b) {
        var c = b.type;
        if (!(c in a.g))
            return !1;
        var d = Tc(a.g[c], b);
        d && (ep(b),
        a.g[c].length == 0 && (delete a.g[c],
        a.j--));
        return d
    }
    function ip(a) {
        var b = 0, c;
        for (c in a.g) {
            for (var d = a.g[c], e = 0; e < d.length; e++)
                ++b,
                ep(d[e]);
            delete a.g[c];
            a.j--
        }
    }
    function gp(a, b, c, d) {
        for (var e = 0; e < a.length; ++e) {
            var f = a[e];
            if (!f.Ba && f.listener == b && f.capture == !!c && f.Ma == d)
                return e
        }
        return -1
    }
    ;var jp = "closure_lm_" + (Math.random() * 1E6 | 0)
      , kp = {}
      , lp = 0;
    function mp(a, b, c, d, e) {
        if (d && d.once)
            return np(a, b, c, d, e);
        if (Array.isArray(b)) {
            for (var f = 0; f < b.length; f++)
                mp(a, b[f], c, d, e);
            return null
        }
        c = op(c);
        bp(a) ? (d = ac(d) ? !!d.capture : !!d,
        pp(a),
        a = a.j.add(String(b), c, !1, d, e)) : a = qp(a, b, c, !1, d, e);
        return a
    }
    function qp(a, b, c, d, e, f) {
        if (!b)
            throw Error("Invalid event type");
        var g = ac(e) ? !!e.capture : !!e
          , h = rp(a);
        h || (a[jp] = h = new fp(a));
        c = h.add(b, c, d, g, f);
        if (c.proxy)
            return c;
        d = sp();
        c.proxy = d;
        d.src = a;
        d.listener = c;
        if (a.addEventListener)
            Zo || (e = g),
            e === void 0 && (e = !1),
            a.addEventListener(b.toString(), d, e);
        else if (a.attachEvent)
            a.attachEvent(yp(b.toString()), d);
        else if (a.addListener && a.removeListener)
            E(b === "change", "MediaQueryList only has a change event"),
            a.addListener(d);
        else
            throw Error("addEventListener and attachEvent are unavailable.");
        lp++;
        return c
    }
    function sp() {
        function a(c) {
            return b.call(a.src, a.listener, c)
        }
        var b = zp;
        return a
    }
    function np(a, b, c, d, e) {
        if (Array.isArray(b)) {
            for (var f = 0; f < b.length; f++)
                np(a, b[f], c, d, e);
            return null
        }
        c = op(c);
        return bp(a) ? a.j.add(String(b), c, !0, ac(d) ? !!d.capture : !!d, e) : qp(a, b, c, !0, d, e)
    }
    function Ap(a, b, c, d, e) {
        if (Array.isArray(b))
            for (var f = 0; f < b.length; f++)
                Ap(a, b[f], c, d, e);
        else
            (d = ac(d) ? !!d.capture : !!d,
            c = op(c),
            bp(a)) ? a.j.remove(String(b), c, d, e) : a && (a = rp(a)) && (b = a.g[b.toString()],
            a = -1,
            b && (a = gp(b, c, d, e)),
            (c = a > -1 ? b[a] : null) && Bp(c))
    }
    function Bp(a) {
        if (typeof a === n || !a || a.Ba)
            return !1;
        var b = a.src;
        if (bp(b))
            return hp(b.j, a);
        var c = a.type
          , d = a.proxy;
        b.removeEventListener ? b.removeEventListener(c, d, a.capture) : b.detachEvent ? b.detachEvent(yp(c), d) : b.addListener && b.removeListener && b.removeListener(d);
        lp--;
        (c = rp(b)) ? (hp(c, a),
        c.j == 0 && (c.src = null,
        b[jp] = null)) : ep(a);
        return !0
    }
    function yp(a) {
        return a in kp ? kp[a] : kp[a] = "on" + a
    }
    function zp(a, b) {
        if (a.Ba)
            a = !0;
        else {
            b = new $o(b,this);
            var c = a.listener
              , d = a.Ma || a.src;
            a.Ea && Bp(a);
            a = c.call(d, b)
        }
        return a
    }
    function rp(a) {
        a = a[jp];
        return a instanceof fp ? a : null
    }
    var Cp = "__closure_events_fn_" + (Math.random() * 1E9 >>> 0);
    function op(a) {
        E(a, "Listener can not be null.");
        if (typeof a === k)
            return a;
        E(a.handleEvent, "An object listener must have handleEvent method.");
        a[Cp] || (a[Cp] = function(b) {
            return a.handleEvent(b)
        }
        );
        return a[Cp]
    }
    tm(function(a) {
        zp = a(zp)
    });
    function Dp() {
        W.call(this);
        this.j = new fp(this);
        this.Kb = this;
        this.ka = null
    }
    jc(Dp, W);
    Dp.prototype[ap] = !0;
    Dp.prototype.addEventListener = function(a, b, c, d) {
        mp(this, a, b, c, d)
    }
    ;
    Dp.prototype.removeEventListener = function(a, b, c, d) {
        Ap(this, a, b, c, d)
    }
    ;
    function Ep(a, b) {
        pp(a);
        var c = a.ka;
        if (c) {
            var d = [];
            for (var e = 1; c; c = c.ka)
                d.push(c),
                E(++e < 1E3, "infinite loop")
        }
        a = a.Kb;
        c = b.type || b;
        typeof b === v ? b = new Yo(b,a) : b instanceof Yo ? b.target = b.target || a : (e = b,
        b = new Yo(c,a),
        ho(b, e));
        e = !0;
        var f;
        if (d)
            for (f = d.length - 1; !b.j && f >= 0; f--) {
                var g = b.currentTarget = d[f];
                e = Fp(g, c, !0, b) && e
            }
        b.j || (g = b.currentTarget = a,
        e = Fp(g, c, !0, b) && e,
        b.j || (e = Fp(g, c, !1, b) && e));
        if (d)
            for (f = 0; !b.j && f < d.length; f++)
                g = b.currentTarget = d[f],
                e = Fp(g, c, !1, b) && e
    }
    Dp.prototype.K = function() {
        Dp.da.K.call(this);
        this.j && ip(this.j);
        this.ka = null
    }
    ;
    function Fp(a, b, c, d) {
        b = a.j.g[String(b)];
        if (!b)
            return !0;
        b = b.concat();
        for (var e = !0, f = 0; f < b.length; ++f) {
            var g = b[f];
            if (g && !g.Ba && g.capture == c) {
                var h = g.listener
                  , l = g.Ma || g.src;
                g.Ea && hp(a.j, g);
                e = h.call(l, d) !== !1 && e
            }
        }
        return e && !d.defaultPrevented
    }
    function pp(a) {
        E(a.j, "Event target is not initialized. Did you call the superclass (goog.events.EventTarget) constructor?")
    }
    ;function Gp(a, b) {
        if (typeof a !== k)
            if (a && typeof a.handleEvent == k)
                a = fc(a.handleEvent, a);
            else
                throw Error("Invalid listener argument");
        return Number(b) > 2147483647 ? -1 : C.setTimeout(a, b || 0)
    }
    ;function Hp(a, b) {
        if (/__$/.test(a))
            throw $n('User properties cannot end with "__". Failed on property: ' + a);
        return b
    }
    function Ip(a, b) {
        if (ac(b) && b.nodeType == 1)
            throw $n(ja + a);
        return b
    }
    function Jp(a) {
        Uo(new To(Hp), a, [])
    }
    function Kp(a) {
        return a.source !== window.parent ? (console.log("dropping postMessage.. was from unexpected window"),
        !1) : !0
    }
    ;function Lp(a, b) {
        var c = [];
        if (a === void 0)
            return a;
        var d = []
          , e = [];
        b & 1 && d.push(D(Mp, c.length));
        b & 2 ? d.push(D(Np, !1)) : b & 64 && d.push(D(Np, !0));
        b & 4 && d.push(Op);
        b & 8 && e.push(Jp);
        for (var f = 0; f < c.length; ++f)
            c[f] & 1 && d.push(D(Pp, f, Np)),
            c[f] & 2 && d.push(D(Pp, f, Op)),
            c[f] & 4 && d.push(D(Pp, f, Qp));
        var g = b & 16 ? {} : void 0
          , h = d.length == 0 ? Im : Jm.apply(C, d)
          , l = e.length == 0 ? Im : Jm.apply(C, e);
        return function() {
            var m = h(Array.from(arguments));
            if (b & 32)
                Gp(function() {
                    a.apply(g || this, m)
                });
            else
                return l(a.apply(g || this, m))
        }
    }
    function Mp(a, b) {
        return Yc(b, 0, a)
    }
    function Pp(a, b, c) {
        var d = Wc(c);
        d[a] = b([c[a]])[0];
        return d
    }
    function Rp(a, b, c) {
        var d = Array.isArray(a) ? [] : {}, e;
        for (e in a)
            if (!/__$/.test(e)) {
                var f = a[e];
                if (!ac(f) || ac(f) && f.nodeType == 1 && !b)
                    d[e] = f;
                else {
                    var g = Sp
                      , h = Object.prototype.toString.call(f);
                    if (Qc(g, h) >= 0)
                        d[e] = Rp(f, b, c);
                    else if (c && f && f.constructor && f.call && f.apply)
                        d[e] = f;
                    else
                        throw new TypeError(ja + e);
                }
            }
        return d
    }
    function Np(a, b) {
        try {
            return Rp(b, !1, a)
        } catch (c) {
            throw c instanceof TypeError ? c : new TypeError(ia);
        }
    }
    function Op(a) {
        try {
            return Rp(a, !0, !1)
        } catch (b) {
            throw b instanceof TypeError ? b : new TypeError(ia);
        }
    }
    function Qp(a) {
        for (var b = [], c = 0; c < a.length; ++c) {
            var d = a[c];
            b[c] = ac(d) ? (new String(d)).toString() : d
        }
        return b
    }
    var Sp = ["[object Array]", "[object Object]"];
    function Tp(a, b, c, d, e, f, g, h) {
        W.call(this);
        this.D = b;
        this.B = c;
        this.o = d;
        this.l = e;
        this.j = f;
        this.g = g;
        this.v = h
    }
    z(Tp, W);
    function Up() {}
    Up.prototype.g = lb();
    function Vp(a) {
        Q.call(this, a)
    }
    z(Vp, Q);
    Vp.L = "maestro.published.shared.proto.UserSafeExecutionRequest";
    function Wp(a) {
        Q.call(this, a)
    }
    z(Wp, Q);
    Wp.L = "maestro.published.shared.proto.UserSafeExecutionResult.UserSafeLogEntry";
    function Xp(a) {
        Q.call(this, a)
    }
    z(Xp, Q);
    Xp.L = "maestro.published.shared.proto.UserSafeExecutionResult.AbridgedLogs";
    function Yp(a) {
        Q.call(this, a)
    }
    z(Yp, Q);
    Yp.L = "maestro.published.shared.proto.UserSafeExecutionResult.ScriptStackElement";
    function Zp(a) {
        Q.call(this, a)
    }
    z(Zp, Q);
    Zp.L = "maestro.published.shared.proto.UserSafeExecutionResult.Failure";
    function $p(a) {
        Q.call(this, a)
    }
    z($p, Q);
    $p.L = "maestro.published.shared.proto.UserSafeExecutionResult.Success";
    function aq(a) {
        Q.call(this, a, 0, "op.exec")
    }
    z(aq, Q);
    aq.L = "maestro.published.shared.proto.UserSafeExecutionResult";
    var bq = {
        Jc: ["BC", "AD"],
        Ic: ["Before Christ", "Anno Domini"],
        bd: "JFMAMJJASOND".split(""),
        sd: "JFMAMJJASOND".split(""),
        Yc: "January February March April May June July August September October November December".split(" "),
        rd: "January February March April May June July August September October November December".split(" "),
        od: "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" "),
        ud: "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" "),
        Ed: "Sunday Monday Tuesday Wednesday Thursday Friday Saturday".split(" "),
        wd: "Sunday Monday Tuesday Wednesday Thursday Friday Saturday".split(" "),
        qd: "Sun Mon Tue Wed Thu Fri Sat".split(" "),
        vd: "Sun Mon Tue Wed Thu Fri Sat".split(" "),
        cd: "SMTWTFS".split(""),
        td: "SMTWTFS".split(""),
        pd: ["Q1", "Q2", "Q3", "Q4"],
        hd: ["1st quarter", "2nd quarter", "3rd quarter", "4th quarter"],
        uc: ["AM", "PM"],
        Ac: ["EEEE, MMMM d, y", "MMMM d, y", "MMM d, y", "M/d/yy"],
        yd: ["h:mm:ss\u202fa zzzz", "h:mm:ss\u202fa z", "h:mm:ss\u202fa", "h:mm\u202fa"],
        Bc: ["{1} 'at' {0}", "{1} 'at' {0}", "{1}, {0}", "{1}, {0}"],
        Ib: 6,
        Fd: [5, 6],
        Jb: 5
    }
      , cq = bq;
    cq = bq;
    function dq(a, b, c) {
        typeof a === n ? (this.g = eq(a, b || 0, c || 1),
        fq(this, c || 1)) : ac(a) ? (this.g = eq(a.getFullYear(), a.getMonth(), a.getDate()),
        fq(this, a.getDate())) : (this.g = new Date(Date.now()),
        a = this.g.getDate(),
        this.g.setHours(0),
        this.g.setMinutes(0),
        this.g.setSeconds(0),
        this.g.setMilliseconds(0),
        fq(this, a))
    }
    function eq(a, b, c) {
        b = new Date(a,b,c);
        a >= 0 && a < 100 && b.setFullYear(b.getFullYear() - 1900);
        return b
    }
    x = dq.prototype;
    x.Ha = cq.Ib;
    x.Ia = cq.Jb;
    x.clone = function() {
        var a = new dq(this.g);
        a.Ha = this.Ha;
        a.Ia = this.Ia;
        return a
    }
    ;
    x.getFullYear = function() {
        return this.g.getFullYear()
    }
    ;
    x.getMonth = function() {
        return this.g.getMonth()
    }
    ;
    x.getDate = function() {
        return this.g.getDate()
    }
    ;
    x.getTime = function() {
        return this.g.getTime()
    }
    ;
    x.set = function(a) {
        this.g = new Date(a.getFullYear(),a.getMonth(),a.getDate())
    }
    ;
    x.add = function(a) {
        if (a.C || a.o) {
            var b = this.getMonth() + a.o + a.C * 12
              , c = this.getFullYear() + Math.floor(b / 12);
            b %= 12;
            b < 0 && (b += 12);
            a: {
                switch (b) {
                case 1:
                    var d = c % 4 != 0 || c % 100 == 0 && c % 400 != 0 ? 28 : 29;
                    break a;
                case 5:
                case 8:
                case 10:
                case 3:
                    d = 30;
                    break a
                }
                d = 31
            }
            d = Math.min(d, this.getDate());
            this.g.setDate(1);
            this.g.setFullYear(c);
            this.g.setMonth(b);
            this.g.setDate(d)
        }
        a.g && (c = this.getFullYear(),
        b = c >= 0 && c <= 99 ? -1900 : 0,
        a = new Date((new Date(c,this.getMonth(),this.getDate(),12)).getTime() + a.g * 864E5),
        this.g.setDate(1),
        this.g.setFullYear(a.getFullYear() + b),
        this.g.setMonth(a.getMonth()),
        this.g.setDate(a.getDate()),
        fq(this, a.getDate()))
    }
    ;
    x.ya = function(a) {
        var b = this.getFullYear()
          , c = b < 0 ? "-" : b >= 1E4 ? "+" : "";
        return [c + am(Math.abs(b), c ? 6 : 4), am(this.getMonth() + 1, 2), am(this.getDate(), 2)].join(a ? "-" : "") + ""
    }
    ;
    x.equals = function(a) {
        return !(!a || this.getFullYear() != a.getFullYear() || this.getMonth() != a.getMonth() || this.getDate() != a.getDate())
    }
    ;
    x.toString = function() {
        return this.ya()
    }
    ;
    function fq(a, b) {
        a.getDate() != b && a.g.setUTCHours(a.g.getUTCHours() + (a.getDate() < b ? 1 : -1))
    }
    x.valueOf = function() {
        return this.g.valueOf()
    }
    ;
    function gq(a, b, c, d, e, f, g) {
        this.g = typeof a === n ? new Date(a,b || 0,c || 1,d || 0,e || 0,f || 0,g || 0) : new Date(a && a.getTime ? a.getTime() : Date.now())
    }
    jc(gq, dq);
    x = gq.prototype;
    x.add = function(a) {
        dq.prototype.add.call(this, a);
        a.j && this.g.setUTCHours(this.g.getUTCHours() + a.j);
        a.l && this.g.setUTCMinutes(this.g.getUTCMinutes() + a.l);
        a.v && this.g.setUTCSeconds(this.g.getUTCSeconds() + a.v)
    }
    ;
    x.ya = function(a) {
        var b = dq.prototype.ya.call(this, a);
        return a ? b + "T" + am(this.g.getHours(), 2) + ":" + am(this.g.getMinutes(), 2) + ":" + am(this.g.getSeconds(), 2) : b + "T" + am(this.g.getHours(), 2) + am(this.g.getMinutes(), 2) + am(this.g.getSeconds(), 2)
    }
    ;
    x.equals = function(a) {
        return this.getTime() == a.getTime()
    }
    ;
    x.toString = function() {
        return this.ya()
    }
    ;
    x.clone = function() {
        var a = new gq(this.g);
        a.Ha = this.Ha;
        a.Ia = this.Ia;
        return a
    }
    ;
    function hq(a, b, c, d, e, f) {
        this.g = a;
        this.o = b;
        this.C = c;
        this.l = d;
        this.j = e;
        this.v = f
    }
    function iq(a, b, c, d, e, f) {
        function g(h) {
            throw h;
        }
        return new hq(a,b,c || Hm,d || g,e || Hm,f)
    }
    x = hq.prototype;
    x.oc = function(a, b) {
        var c = D(jq, this.C, this.l, this.j, this.v)
          , d = D(kq, this.l, this.v)
          , e = Array.prototype.slice.call(arguments, 1);
        if (e.length != 0 && Object.prototype.toString.call(e[0]) === "[object HTMLFormElement]") {
            if (e.length > 1)
                throw $n("Forms with file inputs must be the only parameter.");
            e = e[0];
            a: {
                var f = e.elements;
                for (var g, h = 0; g = f[h]; h++)
                    if (!g.disabled && g.type && g.type.toLowerCase() == "file") {
                        f = !0;
                        break a
                    }
                f = !1
            }
            if (f) {
                var l = this.g;
                c = fc(this.cc, this, a, e, c, d);
                e = {
                    rq: "post"
                };
                f = "" + ++l.j;
                l.g[f] = new lq(c || Hm,d || Hm);
                e.eid = f;
                d = JSON.stringify(e);
                mq(l, d);
                return
            }
            f = new No;
            h = e.elements;
            for (var m, p = 0; m = h.item(p); p++)
                if (m.form == e && !m.disabled && m.tagName != "FIELDSET")
                    switch (g = m.name,
                    m.type.toLowerCase()) {
                    case "file":
                    case "submit":
                    case "reset":
                    case "button":
                        break;
                    case $a:
                        m = So(m);
                        if (m != null)
                            for (var r, t = 0; r = m[t]; t++)
                                Ro(f, g, r);
                        break;
                    default:
                        m = So(m),
                        m != null && Ro(f, g, m)
                    }
            h = e.getElementsByTagName("INPUT");
            for (m = 0; p = h[m]; m++)
                p.form == e && p.type.toLowerCase() == "image" && (g = p.name,
                Ro(f, g, p.value),
                Ro(f, g + ".x", "0"),
                Ro(f, g + ".y", "0"));
            e = {};
            g = A(f.keys());
            for (h = g.next(); !h.done; h = g.next())
                h = h.value,
                e[h] = f.get(h);
            for (l in e)
                e[l].length == 1 && (e[l] = e[l][0]);
            e = [e]
        }
        Uo(new To(Ip), e, []);
        l = new Vp;
        l = Cg(l, 1, a);
        e = JSON.stringify(e);
        l = Cg(l, 2, e);
        l = cg(l, 7, !0);
        e = [0];
        Xf(l);
        E(N(l));
        f = L ? l[F(M)] : l.G;
        g = G(f, u)[I] | 0;
        J(f, g);
        if (e == null)
            dg(f, g, 4);
        else {
            if (!Array.isArray(e))
                throw rd("Expected array but got " + Zb(e) + ": " + e);
            p = h = e === Hd ? 7 : G(e, u)[I] | 0;
            m = (r = hg(h)) || Object.isFrozen(e);
            r || (h = 0);
            m || (e = Xe(e),
            p = 0,
            h = ig(h, g),
            m = !1);
            h |= 5;
            r = 4 & h ? 512 & h ? 512 : 1024 & h ? 1024 : 0 : void 0;
            h |= r != null ? r : td() ? 0 : 1024;
            for (r = 0; r < e.length; r++) {
                t = e[r];
                var w = ff(t);
                Object.is(t, w) || (m && (e = Xe(e),
                p = 0,
                h = ig(h, g),
                m = !1),
                e[r] = w)
            }
            h !== p && (m && (e = Xe(e),
            h = ig(h, g)),
            Jd(e, h));
            ie(e);
            dg(f, g, 4, e)
        }
        l = Dg(l, 8, this.j != Hm ? 1 : 0);
        e = gm(["request", JSON.stringify(Ff(l))]);
        l = this.g;
        e = {
            rq: "xhr",
            cn: e || ""
        };
        f = "" + ++l.j;
        l.g[f] = new lq(c || Hm,d || Hm);
        e.eid = f;
        d = JSON.stringify(e);
        mq(l, d)
    }
    ;
    x.cc = function(a, b, c, d, e) {
        var f = this.o;
        c = fc(this.bc, this, e, c, d);
        f.l.call(f, b, a, e, c)
    }
    ;
    x.bc = function(a, b, c) {
        var d = this.g
          , e = {
            rq: "fpr"
        };
        e.cn = a;
        a = "" + ++d.j;
        d.g[a] = new lq(b || Hm,c || Hm);
        e.eid = a;
        b = JSON.stringify(e);
        mq(d, b)
    }
    ;
    function nq(a) {
        switch (a) {
        case 0:
            return "DEBUG";
        case 1:
            return "INFO";
        case 2:
            return "WARNING";
        case 3:
            return "ERROR";
        default:
            throw $n("Unknown Log Severity");
        }
    }
    function jq(a, b, c, d, e) {
        e = new aq(e[0]);
        var f = ug(e, Xp, 3, $d);
        if (c && c != Hm && f) {
            var g = vg(f, Wp, 1);
            for (var h = 0; h < g.length; ++h) {
                var l = "[Apps Script server";
                P(f, 2) && (l += " " + P(f, 2));
                if (nh(zg(g[h], 2))) {
                    var m = nh(zg(g[h], 2))
                      , p = new gq;
                    p.g.setTime(m);
                    l += " " + p.ya(!0)
                }
                l += "] ";
                l += nq(wg(g[h], 1, $f)) + ": " + Bg(g[h], 3);
                c(l)
            }
        }
        if (ug(e, Zp, 2, $d) !== void 0) {
            c = ug(e, Zp, 2, $d);
            var r = P(c, 4) || ""
              , t = P(c, 3) || "";
            a = ao(r, t);
            P(c, 5) ? (a = new Yn(r,t,P(c, 5)),
            oq(P(c, 5))) : Ag(c, 1) === 1 && (a = new Zn(r,t));
            a.stack = "";
            c = vg(c, Yp, 2);
            for (r = 0; r < c.length; ++r)
                if (t = c[r],
                P(t, 1) || P(t, 3))
                    a.stack += " at ",
                    P(t, 1) ? (a.stack += P(t, 1),
                    P(t, 3) && (a.stack += " (" + P(t, 3) + ":" + (yg(t, 2) || gb) + ")")) : a.stack += Bg(t, 3) + ":" + (yg(t, 2) || gb),
                    P(t, 5) && (a.stack += " (" + P(t, 5),
                    P(t, 6) && (a.stack += ":" + P(t, 6)),
                    a.stack += ")"),
                    P(t, 4) && (a.stack += " " + P(t, 4)),
                    a.stack += "\n";
            b(a, d)
        } else {
            try {
                var w = ug(e, $p, 1, $d);
                r = (t = Bg(w, 2)) && JSON.parse(t);
                Jp(r)
            } catch (K) {
                b(K, d);
                return
            }
            a(r, d)
        }
    }
    function kq(a, b, c) {
        a(c, b)
    }
    x.nc = function(a, b, c) {
        var d = Array.prototype.slice.call(arguments, 2);
        Uo(new To(Ip), d, []);
        d = JSON.stringify({
            hfp: a,
            hfarg: d
        });
        pq(this.g, d, b)
    }
    ;
    function oq(a) {
        var b = b === void 0 ? lb() : b;
        var c = document.getElementById("oauth-dialog");
        c && (c.showModal(),
        document.getElementById("cancel-button").onclick = function() {
            return c.close()
        }
        ,
        document.getElementById("review-permissions-button").onclick = function() {
            c.close();
            var d = Math.round(window.screenY + (window.outerHeight - 725) / 2)
              , e = Math.round(window.screenX + (window.outerWidth - 650) / 2)
              , f = rl(window, hl(a), "width=650,height=725,top=" + d + ",left=" + e);
            f.onload = function() {
                return b(f)
            }
        }
        )
    }
    x.qc = function(a, b) {
        var c = JSON.stringify({
            hfp: a
        })
          , d = this.g;
        c = {
            rq: "xhh",
            cn: c || ""
        };
        d.l[a] = new lq(b || Hm,Hm);
        c.eid = a;
        a = JSON.stringify(c);
        mq(d, a)
    }
    ;
    x.mc = function(a, b) {
        var c = Array.prototype.slice.call(arguments, 1);
        Uo(new To(Ip), c, []);
        c = JSON.stringify({
            hfp: a,
            hfarg: c
        });
        pq(this.g, c, Hm)
    }
    ;
    function qq(a, b) {
        for (var c = {
            withSuccessHandler: function(f) {
                return qq(iq(a.g, a.o, f, a.l, a.j, a.v), b)
            },
            withFailureHandler: function(f) {
                return qq(iq(a.g, a.o, a.C, f, a.j, a.v), b)
            },
            withLogger: function(f) {
                return qq(iq(a.g, a.o, a.C, a.l, f, a.v), b)
            },
            withUserObject: function(f) {
                return qq(iq(a.g, a.o, a.C, a.l, a.j, f), b)
            }
        }, d = 0; d < b.length; ++d) {
            var e = fc(D(a.oc, b[d]), a);
            e = Lp(e, 2);
            c[b[d]] = e
        }
        return c
    }
    ;function rq(a) {
        this.j = this.B = this.l = "";
        this.I = null;
        this.v = this.g = "";
        this.o = !1;
        var b;
        a instanceof rq ? (this.o = a.o,
        sq(this, a.l),
        this.B = a.B,
        this.j = a.j,
        tq(this, a.I),
        this.g = a.g,
        uq(this, a.C.clone()),
        this.v = a.v) : a && (b = String(a).match(cm)) ? (this.o = !1,
        sq(this, b[1] || "", !0),
        this.B = vq(b[2] || ""),
        this.j = vq(b[3] || "", !0),
        tq(this, b[4]),
        this.g = vq(b[5] || "", !0),
        uq(this, b[6] || "", !0),
        this.v = vq(b[7] || "")) : (this.o = !1,
        this.C = new wq(null,this.o))
    }
    rq.prototype.toString = function() {
        var a = []
          , b = this.l;
        b && a.push(xq(b, yq, !0), ":");
        var c = this.j;
        if (c || b == "file")
            a.push("//"),
            (b = this.B) && a.push(xq(b, yq, !0), "@"),
            a.push(encodeURIComponent(String(c)).replace(/%25([0-9a-fA-F]{2})/g, "%$1")),
            c = this.I,
            c != null && a.push(":", String(c));
        if (c = this.g)
            this.j && c.charAt(0) != "/" && a.push("/"),
            a.push(xq(c, c.charAt(0) == "/" ? zq : Aq, !0));
        (c = this.C.toString()) && a.push("?", c);
        (c = this.v) && a.push("#", xq(c, Bq));
        return a.join("")
    }
    ;
    rq.prototype.resolve = function(a) {
        var b = this.clone()
          , c = !!a.l;
        c ? sq(b, a.l) : c = !!a.B;
        c ? b.B = a.B : c = !!a.j;
        c ? b.j = a.j : c = a.I != null;
        var d = a.g;
        if (c)
            tq(b, a.I);
        else if (c = !!a.g) {
            if (d.charAt(0) != "/")
                if (this.j && !this.g)
                    d = "/" + d;
                else {
                    var e = b.g.lastIndexOf("/");
                    e != -1 && (d = b.g.slice(0, e + 1) + d)
                }
            e = d;
            if (e == ".." || e == ".")
                d = "";
            else if (e.indexOf("./") != -1 || e.indexOf("/.") != -1) {
                d = e.lastIndexOf("/", 0) == 0;
                e = e.split("/");
                for (var f = [], g = 0; g < e.length; ) {
                    var h = e[g++];
                    h == "." ? d && g == e.length && f.push("") : h == ".." ? ((f.length > 1 || f.length == 1 && f[0] != "") && f.pop(),
                    d && g == e.length && f.push("")) : (f.push(h),
                    d = !0)
                }
                d = f.join("/")
            } else
                d = e
        }
        c ? b.g = d : c = a.C.toString() !== "";
        c ? uq(b, a.C.clone()) : c = !!a.v;
        c && (b.v = a.v);
        return b
    }
    ;
    rq.prototype.clone = function() {
        return new rq(this)
    }
    ;
    function sq(a, b, c) {
        a.l = c ? vq(b, !0) : b;
        a.l && (a.l = a.l.replace(/:$/, ""))
    }
    function tq(a, b) {
        if (b) {
            b = Number(b);
            if (isNaN(b) || b < 0)
                throw Error("Bad port number " + b);
            a.I = b
        } else
            a.I = null
    }
    function uq(a, b, c) {
        b instanceof wq ? (a.C = b,
        Cq(a.C, a.o)) : (c || (b = xq(b, Dq)),
        a.C = new wq(b,a.o))
    }
    function vq(a, b) {
        return a ? b ? decodeURI(a.replace(/%25/g, "%2525")) : decodeURIComponent(a) : ""
    }
    function xq(a, b, c) {
        return typeof a === v ? (a = encodeURI(a).replace(b, Eq),
        c && (a = a.replace(/%25([0-9a-fA-F]{2})/g, "%$1")),
        a) : null
    }
    function Eq(a) {
        a = a.charCodeAt(0);
        return "%" + (a >> 4 & 15).toString(16) + (a & 15).toString(16)
    }
    var yq = /[#\/\?@]/g
      , Aq = /[#\?:]/g
      , zq = /[#\?]/g
      , Dq = /[#\?@]/g
      , Bq = /#/g;
    function wq(a, b) {
        this.j = this.g = null;
        this.l = a || null;
        this.o = !!b
    }
    function Fq(a) {
        a.g || (a.g = new Map,
        a.j = 0,
        a.l && dm(a.l, function(b, c) {
            a.add(decodeURIComponent(b.replace(/\+/g, " ")), c)
        }))
    }
    x = wq.prototype;
    x.add = function(a, b) {
        Fq(this);
        this.l = null;
        a = Gq(this, a);
        var c = this.g.get(a);
        c || this.g.set(a, c = []);
        c.push(b);
        this.j = pc(this.j) + 1;
        return this
    }
    ;
    x.remove = function(a) {
        Fq(this);
        a = Gq(this, a);
        return this.g.has(a) ? (this.l = null,
        this.j = pc(this.j) - this.g.get(a).length,
        this.g.delete(a)) : !1
    }
    ;
    x.clear = function() {
        this.g = this.l = null;
        this.j = 0
    }
    ;
    function Hq(a, b) {
        Fq(a);
        b = Gq(a, b);
        return a.g.has(b)
    }
    x.forEach = function(a, b) {
        Fq(this);
        this.g.forEach(function(c, d) {
            c.forEach(function(e) {
                a.call(b, e, d, this)
            }, this)
        }, this)
    }
    ;
    x.Ka = function() {
        Fq(this);
        for (var a = Array.from(this.g.values()), b = Array.from(this.g.keys()), c = [], d = 0; d < b.length; d++)
            for (var e = a[d], f = 0; f < e.length; f++)
                c.push(b[d]);
        return c
    }
    ;
    x.La = function(a) {
        Fq(this);
        var b = [];
        if (typeof a === v)
            Hq(this, a) && (b = b.concat(this.g.get(Gq(this, a))));
        else {
            a = Array.from(this.g.values());
            for (var c = 0; c < a.length; c++)
                b = b.concat(a[c])
        }
        return b
    }
    ;
    x.set = function(a, b) {
        Fq(this);
        this.l = null;
        a = Gq(this, a);
        Hq(this, a) && (this.j = pc(this.j) - this.g.get(a).length);
        this.g.set(a, [b]);
        this.j = pc(this.j) + 1;
        return this
    }
    ;
    x.get = function(a, b) {
        if (!a)
            return b;
        a = this.La(a);
        return a.length > 0 ? String(a[0]) : b
    }
    ;
    x.toString = function() {
        if (this.l)
            return this.l;
        if (!this.g)
            return "";
        for (var a = [], b = Array.from(this.g.keys()), c = 0; c < b.length; c++) {
            var d = b[c]
              , e = encodeURIComponent(String(d));
            d = this.La(d);
            for (var f = 0; f < d.length; f++) {
                var g = e;
                d[f] !== "" && (g += "=" + encodeURIComponent(String(d[f])));
                a.push(g)
            }
        }
        return this.l = a.join("&")
    }
    ;
    x.clone = function() {
        var a = new wq;
        a.l = this.l;
        this.g && (a.g = new Map(this.g),
        a.j = this.j);
        return a
    }
    ;
    function Gq(a, b) {
        b = String(b);
        a.o && (b = b.toLowerCase());
        return b
    }
    function Cq(a, b) {
        b && !a.o && (Fq(a),
        a.l = null,
        a.g.forEach(function(c, d) {
            var e = d.toLowerCase();
            d != e && (this.remove(d),
            this.remove(e),
            c.length > 0 && (this.l = null,
            this.g.set(Gq(this, e), Wc(c)),
            this.j = pc(this.j) + c.length))
        }, a));
        a.o = b
    }
    ;function Iq() {
        Dp.call(this);
        this.l = "closure_frame" + Jq++;
        this.g = [];
        Kq[this.l] = this
    }
    jc(Iq, Dp);
    var Kq = {}
      , Jq = 0;
    x = Iq.prototype;
    x.S = Vl("goog.net.IframeIo");
    x.V = null;
    x.ba = null;
    x.va = null;
    x.hc = 0;
    x.ia = !1;
    x.Xa = null;
    x.cb = null;
    x.qa = null;
    x.Na = !1;
    x.abort = function() {
        if (this.ia) {
            var a = this.S;
            a && Wl(a, Hl, "Request aborted");
            a = Lq(this);
            E(a);
            if (a)
                if (bp(a))
                    a.j && ip(a.j);
                else if (a = rp(a)) {
                    var b = 0, c;
                    for (c in a.g)
                        for (var d = a.g[c].concat(), e = 0; e < d.length; ++e)
                            Bp(d[e]) && ++b
                }
            this.ia = !1;
            Ep(this, "abort");
            Mq(this)
        }
    }
    ;
    x.K = function() {
        Xl(this.S, "Disposing iframeIo instance");
        this.ia && (Xl(this.S, "Aborting active request"),
        this.abort());
        Iq.da.K.call(this);
        this.ba && Nq(this);
        Oq(this);
        delete this.o;
        this.Xa = this.cb = this.V = null;
        delete Kq[this.l]
    }
    ;
    x.isActive = mb("ia");
    x.Qa = function() {
        Ap(Lq(this), "load", this.Qa, !1, this);
        try {
            var a = this.ba ? Bo(Lq(this)) : null;
            Xl(this.S, "Iframe loaded");
            this.ia = !1;
            try {
                var b = a.body;
                this.cb = b.textContent || b.innerText
            } catch (e) {
                var c = 1
            }
            var d;
            c || typeof this.o != k || (d = this.o(a)) && (c = 4);
            Wl(this.S, Kl, "Last content: " + this.cb);
            Wl(this.S, Kl, "Last uri: " + this.Xa);
            c ? (Xl(this.S, "Load event occurred but failed"),
            Pq(this, c, d)) : (Xl(this.S, "Load succeeded"),
            Ep(this, Fa),
            Ep(this, "success"),
            Mq(this))
        } catch (e) {
            Pq(this, 1)
        }
    }
    ;
    function Pq(a, b, c) {
        a.v || (a.ia = !1,
        b == 4 && E(c !== void 0),
        Ep(a, Fa),
        Ep(a, Ha),
        Mq(a),
        a.v = !0)
    }
    function Mq(a) {
        var b = a.S;
        b && Wl(b, Hl, "Ready for new requests");
        Nq(a);
        Oq(a);
        a.V = null;
        Ep(a, "ready")
    }
    function Nq(a) {
        var b = a.ba;
        b && (b.onreadystatechange = null,
        b.onload = null,
        b.onerror = null,
        a.g.push(b));
        a.qa && (clearTimeout(a.qa),
        a.qa = null);
        ad ? a.qa = setTimeout(a.tb.bind(a), 2E3) : a.tb();
        a.ba = null;
        a.va = null
    }
    x.tb = function() {
        this.qa && (clearTimeout(this.qa),
        this.qa = null);
        for (; this.g.length != 0; ) {
            var a = this.g.pop()
              , b = this.S;
            b && Wl(b, Hl, "Disposing iframe");
            a && a.parentNode && a.parentNode.removeChild(a)
        }
    }
    ;
    function Oq(a) {
        a.V && a.V == void 0 && Ao(a.V)
    }
    function Lq(a) {
        return a.ba ? Bo(a.ba).getElementById(a.va + "_inner") : null
    }
    x.Gb = function() {
        if (this.ia) {
            var a = this.ba ? Bo(Lq(this)) : null, b;
            if (b = a) {
                a: {
                    try {
                        Zc(a.documentUri);
                        var c = !0;
                        break a
                    } catch (d) {}
                    c = !1
                }
                b = !c
            }
            b ? (this.Na || Ap(Lq(this), "load", this.Qa, !1, this),
            navigator.onLine ? ((a = this.S) && Wl(a, Gl, "Silent Firefox error detected"),
            Pq(this, 3)) : ((a = this.S) && Wl(a, Gl, "Firefox is offline so report offline error instead of silent error"),
            Pq(this, 9))) : setTimeout(this.Gb.bind(this), 250)
        }
    }
    ;
    function Qq(a, b, c) {
        W.call(this);
        this.o = a;
        this.j = b;
        this.g = c || new Up;
        this.v = fc(this.g.g, this.g)
    }
    z(Qq, W);
    Qq.prototype.l = function(a, b, c, d) {
        for (var e, f = a.action, g = a.method, h = a.enctype, l = a.target, m = a.onsubmit, p = a.submit, r = a.elements, t = 0; t < r.length; ++t)
            r[t].name = "_" + t + "_" + r[t].name;
        t = this.j.slice(0);
        if (c !== void 0)
            for (var w in c)
                Xc(t, [w, c[w]]);
        b != null && b != "" && Xc(t, ["func", b]);
        b = im(this.o + "/postform", t);
        a.action = b;
        a.method = "post";
        a.enctype = "multipart/form-data";
        a.onsubmit = null;
        b = E(uo("example_form"));
        a.submit = b.submit;
        try {
            e = e || new Iq;
            e.Na = !0;
            if (e.ia)
                throw Error("[goog.net.IframeIo] Unable to send, already active.");
            var K = new rq(a.action)
              , ba = e.S;
            ba && Wl(ba, Hl, "Sending iframe request from form: " + K);
            e.Xa = K;
            e.V = a;
            var X = E(e.V)
              , Ka = ll(K.toString());
            Ka !== void 0 && (X.action = Ka);
            e.ia = !0;
            Xl(e.S, "Creating iframe");
            e.va = e.l + "_" + (e.hc++).toString(36);
            e.ba = ro(e.V).j("IFRAME", {
                name: e.va,
                id: e.va
            });
            var ma = e.ba.style;
            ma.visibility = "hidden";
            ma.width = ma.height = "10px";
            ma.display = "none";
            bd ? ma.marginTop = ma.marginLeft = "-10px" : (ma.position = "absolute",
            ma.top = ma.left = "-10px");
            Xl(e.S, "Setting up iframes and cloning form");
            ro(e.V).g.body.appendChild(e.ba);
            var Ra = e.va + "_inner"
              , Yb = Bo(e.ba);
            if (document.baseURI) {
                var tp = Zl(Ra)
                  , $s = '<head><base href="' + Zl(document.baseURI) + '"></head><body><iframe id="' + tp + '" name="' + tp + '"></iframe>';
                Yl("Short HTML snippet, input escaped, safe URL, for performance");
                var nb = pl($s)
            } else {
                var up = Zl(Ra);
                K = '<body><iframe id="' + up + '" name="' + up + '"></iframe>';
                Yl("Short HTML snippet, input escaped, for performance");
                nb = pl(K)
            }
            Yb.write(ql(nb));
            e.Na || mp(Yb.getElementById(Ra), "load", e.Qa, !1, e);
            var Ya = vo("TEXTAREA", E(e.V));
            nb = 0;
            for (var Uc = Ya.length; nb < Uc; nb++) {
                var Vc = Ya[nb].value;
                K = [];
                Eo(Ya[nb], K, !1);
                if (K.join("") != Vc) {
                    var sa = Ya[nb];
                    E(sa != null, "goog.dom.setTextContent expects a non-null value for node");
                    if ("textContent"in sa)
                        sa.textContent = Vc;
                    else if (sa.nodeType == 3)
                        sa.data = String(Vc);
                    else if (sa.firstChild && sa.firstChild.nodeType == 3) {
                        for (; sa.lastChild != sa.firstChild; )
                            sa.removeChild(E(sa.lastChild));
                        sa.firstChild.data = String(Vc)
                    } else {
                        Ao(sa);
                        var at = to(sa);
                        sa.appendChild(at.createTextNode(String(Vc)))
                    }
                    Ya[nb].value = Vc
                }
            }
            var ob = Yb.importNode(E(e.V), !0);
            ob.target = Ra;
            ob.action = e.V.action;
            Yb.body.appendChild(ob);
            var Cb = vo("SELECT", E(e.V))
              , bt = vo("SELECT", ob);
            Ya = 0;
            for (var ct = Cb.length; Ya < ct; Ya++) {
                var vp = vo("OPTION", Cb[Ya])
                  , dt = vo("OPTION", bt[Ya]);
                Uc = 0;
                for (var et = vp.length; Uc < et; Uc++)
                    dt[Uc].selected = vp[Uc].selected
            }
            var yk = vo("INPUT", E(e.V))
              , ft = vo("INPUT", ob);
            Cb = 0;
            for (var gt = yk.length; Cb < gt; Cb++)
                if (yk[Cb].type == "file" && yk[Cb].value != ft[Cb].value) {
                    Xl(e.S, "File input value not cloned properly.  Will submit using original form.");
                    e.V.target = Ra;
                    ob = e.V;
                    break
                }
            Xl(e.S, "Submitting form");
            try {
                e.v = !1,
                ob.submit(),
                Yb.close(),
                ad && setTimeout(e.Gb.bind(e), 250)
            } catch (ht) {
                var wp = e.S;
                a: {
                    try {
                        var le = tl(ht);
                        var rg = le.fileName;
                        rg == null && (rg = "");
                        if (/^https?:\/\//i.test(rg)) {
                            var it = hl(rg)
                              , jt = "view-source:" + dl(it);
                            Yl("view-source scheme plus HTTP/HTTPS URL");
                            var xp = new bl(jt)
                        } else
                            xp = hl("sanitizedviewsrc");
                        ob = xp;
                        var zk = jo([io("Message: " + le.message + "\nUrl: ", {
                            gb: !0,
                            hb: !0
                        }), po({
                            href: ob,
                            target: "_new"
                        }, le.fileName), io("\nLine: " + le.lineNumber + "\n\nBrowser stack:\n" + le.stack + "-> [end]\n\nJS stack traversal:\n" + yl(void 0) + "-> ", {
                            gb: !0,
                            hb: !0
                        })]);
                        break a
                    } catch (kt) {
                        zk = io("Exception trying to expose exception! You win, we lose. " + kt, {
                            gb: !0,
                            hb: !0
                        });
                        break a
                    }
                    zk = void 0
                }
                var lt = ql(zk).toString();
                wp && Wl(wp, Fl, "Error when submitting form: " + lt);
                e.Na || Ap(Yb.getElementById(Ra), "load", e.Qa, !1, e);
                Yb.close();
                Pq(e, 2)
            }
            np(Lq(e), "load", D(Rq, this.v, d, e))
        } finally {
            for (a.action = f,
            a.method = g,
            a.enctype = h,
            a.target = l,
            a.onsubmit = m,
            a.submit = p,
            a = 0; a < r.length; ++a)
                r[a].name = r[a].name.replace("_" + a + "_", "")
        }
    }
    ;
    function Rq(a, b, c) {
        a();
        b();
        c.dispose()
    }
    ;function Sq(a) {
        W.call(this);
        this.j = a;
        this.g = {}
    }
    jc(Sq, W);
    var Tq = [];
    function Uq(a, b, c, d) {
        Array.isArray(c) || (c && (Tq[0] = c.toString()),
        c = Tq);
        for (var e = 0; e < c.length; e++) {
            var f = mp(b, c[e], d || a.handleEvent, !1, a.j || a);
            if (!f)
                break;
            a.g[f.key] = f
        }
    }
    function Vq(a) {
        co(a.g, function(b, c) {
            this.g.hasOwnProperty(c) && Bp(b)
        }, a);
        a.g = {}
    }
    Sq.prototype.K = function() {
        Sq.da.K.call(this);
        Vq(this)
    }
    ;
    Sq.prototype.handleEvent = function() {
        throw Error("EventHandler.handleEvent not implemented");
    }
    ;
    function Wq(a, b, c) {
        W.call(this);
        this.v = b;
        this.o = c;
        this.j = 0;
        this.g = {};
        this.l = {};
        b = new Sq(this);
        mm(this, D(km, b));
        Uq(b, a, Sa, this.D)
    }
    z(Wq, W);
    function pq(a, b, c) {
        var d = {
            rq: "xhh"
        };
        d.cn = b || "";
        b = "" + ++a.j;
        a.g[b] = new lq(c || Hm,Hm);
        d.eid = b;
        c = JSON.stringify(d);
        mq(a, c)
    }
    function mq(a, b) {
        a.v.postMessage(b, a.o)
    }
    Wq.prototype.D = function(a) {
        a = a.g;
        var b;
        if (b = Kp(a)) {
            b = this.o;
            var c = a.origin;
            c != b ? (console.log("dropping postMessage.. was from host " + c + " but expected host " + b),
            b = !1) : b = !0
        }
        if (b) {
            a = a.data;
            b = null;
            try {
                b = JSON.parse(a)
            } catch (e) {
                return
            }
            if (["xhrr", "postr", "fprr", "xhhr"].indexOf(b.rq) >= 0) {
                a = b;
                b = a.eid;
                c = (c = eo(this.g, b)) ? c : eo(this.l, b);
                var d = this.g;
                b in d && delete d[b];
                a.sucr ? (0,
                c.Fb)(a.sucr) : a.failr && (0,
                c.xb)(a.failr)
            }
        }
    }
    ;
    Wq.prototype.K = function() {
        W.prototype.K.call(this);
        delete this.v;
        co(this.g, this.B, this);
        delete this.g
    }
    ;
    Wq.prototype.B = function(a) {
        a.dispose()
    }
    ;
    function lq(a, b) {
        W.call(this);
        this.Fb = a;
        this.xb = b
    }
    z(lq, W);
    lq.prototype.K = function() {
        W.prototype.K.call(this);
        delete this.Fb;
        delete this.xb
    }
    ;
    function Xq() {
        var a = C.window;
        a.onbeforeunload = lb();
        a.location.reload()
    }
    ;function Yq() {
        this.g = function() {
            Xq()
        }
    }
    Yq.prototype.notify = function() {
        window.confirm("This error has been reported to Google and we'll look into it as soon as possible. Please reload this page to continue.") && this.g()
    }
    ;
    function Zq(a, b) {
        Yo.call(this, a);
        this.error = b
    }
    z(Zq, Yo);
    var $q = /\/d\/([^\/]+)/
      , ar = /\/r\/([^\/]+)/;
    function br(a) {
        a = a.match(cm)[5] || null;
        return $q.test(a)
    }
    function cr(a, b) {
        if (br(a)) {
            E(br(a), a + " is not canonical");
            a = a.match(cm);
            var c = a[5];
            c = c.replace(b, "");
            b = bm(a[1], a[2], a[3], a[4], c, a[6], a[7])
        } else
            b = a;
        return b
    }
    ;function dr(a, b, c) {
        W.call(this);
        this.g = a;
        this.l = b || 0;
        this.j = c;
        this.o = fc(this.Yb, this)
    }
    jc(dr, W);
    x = dr.prototype;
    x.za = 0;
    x.K = function() {
        dr.da.K.call(this);
        er(this);
        delete this.g;
        delete this.j
    }
    ;
    x.start = function(a) {
        er(this);
        this.za = Gp(this.o, a !== void 0 ? a : this.l)
    }
    ;
    function er(a) {
        a.isActive() && C.clearTimeout(a.za);
        a.za = 0
    }
    x.isActive = function() {
        return this.za != 0
    }
    ;
    x.Yb = function() {
        this.za = 0;
        this.g && this.g.call(this.j)
    }
    ;
    function fr(a, b, c, d) {
        W.call(this);
        this.j = d != null ? d : .15;
        E(this.j >= 0 && this.j <= 1);
        this.v = a;
        this.o = b;
        this.D = c;
        this.g = new dr(this.H,void 0,this);
        this.B = Number.NEGATIVE_INFINITY;
        this.l = 0
    }
    z(fr, W);
    fr.prototype.isActive = function() {
        return this.g.isActive()
    }
    ;
    fr.prototype.start = function() {
        gr(this, !1, !1)
    }
    ;
    function gr(a, b, c) {
        b && (er(a.g),
        hr(a, a.o));
        a.isActive() || (b = Math.max(0, a.B + a.l - Date.now()),
        b == 0 && (c ? b = hr(a, a.o) : a.l = 0),
        a.g.start(b))
    }
    function hr(a, b) {
        b > 0 && a.j != 0 && (b = Math.floor(b * (1 - a.j + Math.random() * a.j * 2)));
        return a.l = b
    }
    fr.prototype.H = function() {
        this.B = Date.now();
        hr(this, Math.min(Math.max(this.l * 2, this.o), this.D));
        this.v()
    }
    ;
    fr.prototype.K = function() {
        this.g.dispose();
        delete this.g;
        delete this.v;
        W.prototype.K.call(this)
    }
    ;
    function ir(a, b, c, d, e, f, g) {
        g = g === void 0 ? !0 : g;
        W.call(this);
        var h = this;
        this.g = a;
        this.g.H = 1E4;
        this.Ca = b;
        this.l = f;
        this.j = new fr(function() {
            return h.R()
        }
        ,3E4,36E5);
        this.v = 0;
        this.B = null;
        this.fa = new Fn("errorsender",1,8,d);
        mm(this, D(km, this.fa));
        this.U = !1;
        this.H = null;
        this.T = new Set;
        this.D = new Sq(this);
        E(c == null || c > 0);
        this.Ya = c || 10;
        this.ga = e || null;
        Uq(this.D, this.g, Fa, this.Da);
        Uq(this.D, this.g, "ready", this.R);
        this.ea = null;
        this.O = new Wn;
        mm(this, D(km, this.O));
        this.l && Xn(this.O, this.l.o(), function() {
            E(h.l);
            h.l.l().g >= 3 && (h.ea = (Tn(),
            Sn));
            h.l.l().g >= 3 || h.ea !== (Tn(),
            Sn) || jr(h)
        });
        this.aa = g;
        this.oa = {}
    }
    z(ir, W);
    function kr(a, b, c, d, e) {
        yn(a.Ca.get("docs-dafjera")) && (b = cr(cr(b, ar), $q));
        var f = kn(kn(rn(a.o.length), function(g) {
            if (!(g >= this.Ya))
                return this.aa && (b = im(b, "errorSender_enqueueTimeMs", Date.now().toString())),
                g = {},
                g.u = b,
                g.m = c,
                g.c = d,
                g.h = e,
                this.o.push(g),
                rn()
        }, a), a.R, a);
        mn(f, function() {
            this.T.delete(f)
        }, a);
        a.T.add(f)
    }
    ir.prototype.R = function() {
        var a = this.l && this.l.l().g >= 3
          , b = this.Oa() || this.g.isActive() || this.j.isActive() || this.U;
        return a || b ? rn() : lr(this)
    }
    ;
    function lr(a) {
        return function() {
            return kn(rn(a.o[0] !== void 0 ? a.o[0] : null), function(b) {
                return mr(a, b)
            })
        }()
    }
    function mr(a, b) {
        if (a.j.isActive() || a.g.isActive() || a.U)
            return rn();
        if (!b)
            return er(a.j.g),
            rn();
        if (b.u.length > 4E3)
            return nr(a);
        try {
            Hn(a.fa);
            a.H = new an;
            var c = b.u;
            a.ga != null && (c = im(c, "reportingSessionId", a.ga));
            a.v > 0 && (c = im(c, "retryCount", a.v));
            a.B != null && (c = im(c, "previousErrorSendStatus", a.B));
            a.aa && (c = im(c, "errorSenderType", a.ka()),
            b.errorSender_frontIndex && (c = im(c, "errorSender_frontIndex", b.errorSender_frontIndex)),
            b.errorSender_nextIndex && (c = im(c, "errorSender_nextIndex", b.errorSender_nextIndex)),
            b.errorSender_queueSize && (c = im(c, "errorSender_queueSize", b.errorSender_queueSize)));
            a.oa = b;
            var d = b.m
              , e = b.c
              , f = b.h;
            return kn(kn(nr(a), function() {
                or(a.g, c, d, e, f)
            }), function() {
                return a.H
            })
        } catch (g) {
            if (Rk(g)instanceof En)
                a.U = !0;
            else
                throw zl(g, {
                    "docs-origin-class": "docs.debug.ErrorSender"
                });
        }
        return rn()
    }
    ir.prototype.Da = function() {
        var a = pr(this.g)
          , b = E(this.H)
          , c = qr(this.g) || a >= 400 && a <= 500
          , d = this.v > 3;
        c || d ? (this.v = 0,
        this.B = null,
        er(this.j.g),
        kn(rn(), function() {
            hn(b)
        })) : (this.v++,
        this.B = a === -1 ? this.g.B : a,
        jr(this),
        this.o.push(this.oa),
        rn(),
        hn(b))
    }
    ;
    function jr(a) {
        a.v != 1 || a.j.isActive() ? a.j.start() : gr(a.j, !0, !0)
    }
    ir.prototype.K = function() {
        lm(this.D, this.j, this.g, this.O);
        this.T.clear();
        W.prototype.K.call(this)
    }
    ;
    ir.prototype.ka = pb("BaseErrorSender");
    function rr(a, b, c, d, e) {
        ir.call(this, a, b, c, void 0, d, e, void 0);
        this.o = []
    }
    z(rr, ir);
    function nr(a) {
        a.o.shift();
        return rn()
    }
    rr.prototype.ka = pb("MemoryErrorSender");
    rr.prototype.K = function() {
        delete this.o;
        ir.prototype.K.call(this)
    }
    ;
    function sr() {
        var a = a === void 0 ? !1 : a;
        E("a", "Invalid service id + a");
        var b = b || [];
        for (var c = 0; c < b.length; c++)
            E(b[c], "Invalid dependency " + b[c] + " (index in dependency array: " + c + ") for service a");
        b = a;
        b = b === void 0 ? !1 : b;
        E(!0, "Error while adding dependencies. The dependencies cannot be changed after they were read.");
        if (b)
            throw Error("A module ID must be set on the Fava ServiceId a in order to modify extra edges.");
    }
    sr.prototype.toString = pb("a");
    new sr;
    function tr(a) {
        this.g = Lg(xh(), Ef(a));
        a = yg(this.g, 1);
        this.j = Math.floor(Math.random() * 100) < a
    }
    tr.prototype.toString = function() {
        var a = "{bool=" + !(this.j ? !xg(this.g, 5) : !xg(this.g, 2)) + ', string="'
          , b = this.j ? Bg(this.g, 6) : P(this.g, 3);
        a = a + (b != null ? String(b) : "") + '", int=';
        b = this.j ? gf(ag(this.g, 7, void 0, $f)) : yg(this.g, 4, -1);
        return a + (b != null ? Number(b) : -1) + "}"
    }
    ;
    function ur(a) {
        this.g = new Map;
        this.j = [];
        if (a = a.get("docs-cei")) {
            sc(a);
            var b = a.i;
            b && Xc(this.j, b);
            a = a.cf || {};
            for (var c in a)
                this.g.set(c, new tr(a[c]))
        }
    }
    ur.prototype.get = function(a) {
        return this.g.get(a) || null
    }
    ;
    function vr() {
        for (var a in Array.prototype)
            return !1;
        return !0
    }
    ;function Hg(a) {
        this.g = a
    }
    function Kg(a) {
        var b = a.g;
        if (b == null)
            return null;
        if (typeof b === v)
            return b;
        throw new TypeError("Invalid string data <K1cgmc>: " + a.g + " (typeof " + typeof a.g + ")");
    }
    Hg.prototype.toString = function() {
        var a = Kg(this);
        if (a === null) {
            if ("K1cgmc".includes("-"))
                throw Error("Data K1cgmc not defined. Most likely because you need to replace - with camelcase. More information http://go/wiz-errors#data-not-found");
            throw Error("Data K1cgmc not defined.");
        }
        return a
    }
    ;
    function wr(a) {
        Q.call(this, a, 10)
    }
    z(wr, Q);
    wr.L = "apps.framework.logging.AppsFrameworkExtension.WebReports.WebReportInfo";
    var xr = Pg(wr);
    function yr(a) {
        Q.call(this, a)
    }
    z(yr, Q);
    yr.prototype.Sa = function(a) {
        Cg(this, 7, a)
    }
    ;
    yr.L = "apps.telemetry.proto.AppsTelemetryExtension.WebDimensions";
    function zr(a) {
        Q.call(this, a)
    }
    z(zr, Q);
    function Ar(a) {
        return tg(a, yr, mg(a, Br, 4))
    }
    zr.L = "apps.telemetry.proto.AppsTelemetryExtension.AppsTelemetryDimensions";
    var Br = [4, 5];
    function Cr(a) {
        Q.call(this, a)
    }
    z(Cr, Q);
    Cr.L = "apps.telemetry.proto.AppsTelemetryExtension.CrashReportInfo";
    function Dr(a) {
        Q.call(this, a)
    }
    z(Dr, Q);
    Dr.L = "apps.telemetry.proto.AppsTelemetryExtension.JsError";
    function Jg(a) {
        Q.call(this, a)
    }
    z(Jg, Q);
    function Er(a) {
        return tg(a, zr, 1)
    }
    Jg.L = "apps.telemetry.proto.AppsTelemetryExtension";
    function Fr(a) {
        Q.call(this, a, 1)
    }
    z(Fr, Q);
    Fr.L = "logs.proto.wireless.performance.mobile.MetricExtension";
    var Gr = Pg(Fr);
    function Hr(a) {
        Q.call(this, a, 1)
    }
    z(Hr, Q);
    Hr.L = "logs.proto.wireless.performance.mobile.ios.MetricExtension";
    var Ir = Pg(Hr);
    xr[1001] = {
        Hd: new Mg(1001)
    };
    Gr[29] = {
        Jd: new Mg(29)
    };
    Ir[9] = {
        Id: new Mg(9)
    };
    function Jr() {
        this.g = Gg()
    }
    Jr.prototype.ua = function() {
        var a = new Map, b, c = (b = this.g) == null ? void 0 : Ar(Er(b));
        if (c == null ? 0 : wg(c, 2) != null) {
            var d;
            (b = (d = Ag(c, 2)) == null ? void 0 : d.toString()) && a.set("canaryanalysisservertestgroup", b);
            if (c == null)
                var e = void 0;
            else if ((c = ug(c, sh, 3)) == null)
                e = void 0;
            else {
                d = Number;
                e = e === void 0 ? "0" : e;
                var f;
                b = (f = td() ? lf(ag(c, 1), !0) : lf(ag(c, 1, void 0, void 0, mf))) != null ? f : e;
                e = d(b);
                f = yg(c, 2);
                e = (new Date(e * 1E3 + f / 1E6)).valueOf().toString()
            }
            e && a.set("serverstarttimemillis", e)
        }
        var g, h;
        (e = (g = this.g) == null ? void 0 : (h = ug(g, zr, 1)) == null ? void 0 : Ag(h, 6)) && a.set("clientApp", String(e));
        return a
    }
    ;
    function Kr() {
        function a() {}
        this.g = a.call.bind(a.toString)
    }
    Kr.prototype.ua = function() {
        var a = new Map;
        Lr() && a.set("apps_telemetry.screen_tampered", db);
        a: {
            var b = A(Array.prototype);
            for (b = b.next(); !b.done; b = b.next()) {
                b = !0;
                break a
            }
            b = !1
        }
        b && a.set("apps_telemetry.array_prototype_tampered", db);
        Mr() || a.set("apps_telemetry.canvas_creation_broken", db);
        !Nr() && C.navigator && C.navigator.webdriver && a.set("apps_telemetry.webdriver", db);
        b = !1;
        for (var c = A(Or), d = c.next(); !d.done; d = c.next()) {
            d = d.value;
            var e = Pr(d.key);
            e === 0 ? (a.set("apps_telemetry.automation_property_present." + d.W, db),
            b = !0) : e === 2 && a.set("apps_telemetry.automation_property_check_failed." + d.W, db)
        }
        b && a.set("apps_telemetry.automation_detected", db);
        c = !1;
        b = A(Qr);
        for (d = b.next(); !d.done; d = b.next())
            e = d.value,
            d = e.W,
            e = Rr(this, e.name, e.yb),
            e.sa || (c = e.reason,
            a.set(za + d + ".reason", c),
            c === Ua && a.set(za + d + ".type", e.type),
            c = !0);
        c && a.set("apps_telemetry.native_function_tampering_detected", db);
        return a
    }
    ;
    function Lr() {
        if (Nr())
            return !1;
        var a = C.screen
          , b = !(a instanceof Screen);
        if (dd || cd)
            return b;
        try {
            var c = lb();
            a.addEventListener("change", c);
            a.removeEventListener("change", c)
        } catch (d) {
            b = !0
        }
        return b
    }
    function Mr() {
        function a(b) {
            try {
                var c = new bo(1,500), d;
                b ? d = zo(document, "CANVAS") : d = new OffscreenCanvas(c.width,c.height);
                return d.getContext("2d") != null
            } catch (e) {
                return !1
            }
        }
        return a(!1) && (Nr() || a(!0))
    }
    function Nr() {
        return ua in C && typeof C.WorkerGlobalScope === k && self instanceof C.WorkerGlobalScope
    }
    function Pr(a) {
        if (Nr() || !C)
            return 1;
        try {
            if (a in C || C.document && a in C.document)
                return 0
        } catch (b) {
            return 2
        }
        return 1
    }
    function Rr(a, b, c) {
        try {
            var d = c()
        } catch (f) {
            return {
                sa: !1,
                reason: "not_reachable"
            }
        }
        c = Sr(d);
        if (c !== k)
            return {
                sa: !1,
                reason: Ua,
                type: c
            };
        try {
            var e = a.g(d)
        } catch (f) {
            return {
                sa: !1,
                reason: "to_string_failed"
            }
        }
        a = Tr.exec(e);
        return a ? (a = a[1]) ? a !== b ? {
            sa: !1,
            reason: "likely_wrong_native_function"
        } : {
            sa: !0
        } : {
            sa: !1,
            reason: "likely_bound_function"
        } : {
            sa: !1,
            reason: "likely_non_native_source"
        }
    }
    function Sr(a) {
        switch (typeof a) {
        case k:
            return k;
        case "undefined":
            return "undefined";
        case Ea:
            return Ea;
        case n:
            return n;
        case v:
            return v;
        case q:
            return a === null ? Va : q;
        case cb:
            return cb;
        case Da:
            return Da;
        default:
            return gb
        }
    }
    var Or = [{
        key: "Cypress",
        W: "cypress"
    }, {
        key: "$cdc_asdjflasutopfhvcZLmcfl_",
        W: "selenium"
    }, {
        key: "$wdc_",
        W: "chrome_driver"
    }, {
        key: "domAutomationController",
        W: "chromium_automation"
    }, {
        key: "callPhantom",
        W: "phantomjs"
    }, {
        key: "windmill",
        W: "windmill"
    }, {
        key: "____LocationIntercept",
        W: Ca
    }, {
        key: Ca,
        W: Ca
    }, {
        key: "ubot",
        W: "ubot"
    }, {
        key: "cefsharp_CreatePromise",
        W: "cefsharp"
    }, {
        key: "__nightmare",
        W: "nightmare"
    }]
      , Qr = [{
        name: "getOwnPropertyDescriptor",
        yb: function() {
            return Object.getOwnPropertyDescriptor
        },
        W: "Object.getOwnPropertyDescriptor"
    }, {
        name: "addEventListener",
        yb: function() {
            return C.addEventListener
        },
        W: "global.addEventListener"
    }]
      , Tr = /^function\s*(?:\s([a-zA-Z_$][\w$]+))?\(\) \{\s+\[native code\]\s+\}$/;
    var Ur = []
      , Vr = []
      , Wr = [RegExp("^_0x[a-f0-9]{6} is not defined$"), RegExp("[Zz]otero"), RegExp('^Not found$|^Unknown Error of type "string": Not found$')]
      , Xr = "egfdjlfmgnehecnclamagfafdccgfndp mndnfokpggljbaajbnioimlmbfngpief mlkejohendkgipaomdopolhpbihbhfnf kgonammgkackdilhodbgbmodpepjocdp klbcgckkldhdhonijdbnhhaiedfkllef pmehocpgjmkenlokgjfkaichfjdhpeol cjlaeehoipngghikfjogbdkpbdgebppb ghbmnnjooekpmoecnnnilnnbdlolhkhi lmjegmlicamnimmfhcmpkclmigmmcbeh gmbmikajjgmnabiglmofipeabaddhgne lpcaedmchfhocbbapmcbpinfpgnhiddi gbkeegbaiigmenfmjfclcdgdpimamgkj adokjfanaflbkibffcbhihgihpgijcei".split(" ")
      , Yr = [RegExp("chrome-extension://([^/]+)", "g"), RegExp("moz-extension://([^/]+)", "g"), RegExp("ms-browser-extension://([^/]+)", "g"), RegExp("webkit-masked-url://([^/]+)", "g"), RegExp("safari-web-extension://([^/]+)", "g")]
      , Zr = [RegExp("^Permission denied$"), RegExp("index out of range: \\d+ \\+ \\d+ > \\d+"), RegExp("getReadMode(Config|Render|Extract)")]
      , $r = [RegExp("at file:///|@file:///|phantomjs|node:electron|py-scrap|eval code|Program Files"), RegExp("_0x[a-f0-9]+.*anonymous")]
      , as = [RegExp("Script https://meet\\.google\\.com/.*meetsw.*load failed"), RegExp("A bad HTTP response code \\(\\d+\\) was received when fetching the script")]
      , bs = [RegExp("Error loading.*Consecutive load failures"), RegExp("Failed to load module.*Consecutive load failures")];
    function cs(a, b) {
        this.Za = a;
        this.Ga = b
    }
    function ds(a, b) {
        return (b = a.g(b)) ? {
            Za: a.Za,
            Ga: a.Ga,
            ib: b.toUpperCase()
        } : null
    }
    ;function es() {
        cs.call(this, 1, 1)
    }
    z(es, cs);
    es.prototype.g = function(a) {
        a: {
            a = fs(a);
            for (var b = !1, c = A(Yr), d = c.next(); !d.done; d = c.next()) {
                d = a.matchAll(d.value);
                d = A(d);
                for (var e = d.next(); !e.done; e = d.next())
                    if (e = e.value[1]) {
                        if (Xr.includes(e)) {
                            a = !1;
                            break a
                        }
                        b = !0
                    }
            }
            a = b
        }
        return a ? ib : null
    }
    ;
    function gs(a, b, c) {
        c = c === void 0 ? hs : c;
        cs.call(this, a, b);
        this.j = c
    }
    z(gs, cs);
    gs.prototype.g = function(a) {
        var b = a.l.get(wa);
        if (typeof b !== v)
            return null;
        for (var c = fs(a), d = c.includes("blob:"), e = A(this.j), f = e.next(); !f.done; f = e.next()) {
            var g = f.value
              , h = g.Ra === void 0 ? [] : g.Ra
              , l = g.Ta === void 0 ? [] : g.Ta;
            f = g.Aa === void 0 ? !1 : g.Aa;
            if (c.includes(g.errorMessage) && (g = h.some(function(m) {
                return b.includes(m)
            }),
            l = l.some(function(m) {
                return a.g.includes(m)
            }),
            f = f && d,
            g || l || f))
                return ib
        }
        return null
    }
    ;
    var hs = [{
        errorMessage: "Cannot read properties of undefined (reading 'addListener')",
        Aa: !0,
        Ra: ["infird.com"]
    }, {
        errorMessage: "browser_polyfill_default(...).runtime.getManifest is not a function",
        Aa: !0,
        Ra: ["infird.com"]
    }, {
        errorMessage: 'fileName":',
        Ra: ["walkme.com"]
    }, {
        errorMessage: "] is not a function",
        Aa: !0
    }, {
        errorMessage: "Cannot read properties of null (reading 'toLowerCase')",
        Aa: !0,
        Ta: ["__aiNetCmd__"]
    }];
    function is(a, b, c, d, e) {
        e = e === void 0 ? new Map : e;
        this.message = a;
        this.g = b;
        this.cause = c;
        this.j = d;
        this.l = e
    }
    function js(a) {
        return (a = a.cause) ? a.message + "\n" + a.g + "\n" + js(a) : ""
    }
    function fs(a) {
        return a.message + "\n" + a.g + "\n" + js(a)
    }
    function ks() {
        this.l = this.g = this.message = "";
        this.j = new Map
    }
    function ls(a, b) {
        a.message = b;
        return a
    }
    function ms(a) {
        return new is(a.message,a.g,a.cause,a.l,a.j)
    }
    ;function ns(a) {
        return a instanceof Error || a && a.message !== void 0 ? a.message : os(a)
    }
    function ps(a) {
        return a instanceof Error || a && a.stack !== void 0 ? a.stack || "" : ""
    }
    function qs(a, b) {
        var c = a && a.cause !== void 0;
        if (b >= 3 || !c)
            return null;
        c = new ks;
        a = a.cause;
        if (rs(a)) {
            if (ls(c, ns(a)),
            c.g = ps(a),
            b = qs(a, b + 1))
                c.cause = b
        } else
            ls(c, os(a));
        return ms(c)
    }
    function rs(a) {
        return a instanceof Error || !!a && a.message !== void 0 && a.stack !== void 0
    }
    function os(a) {
        try {
            return rs(a) ? a.message + "\n" + a.stack : a && a instanceof Object ? JSON.stringify(a) : String(a)
        } catch (b) {
            return String(a)
        }
    }
    function ss(a, b, c) {
        c = c === void 0 ? new Map : c;
        var d = ls(new ks, ns(a));
        d.g = ps(a);
        d.j = c;
        if (a = qs(a, 0))
            d.cause = a;
        b && (d.l = b);
        return ms(d)
    }
    ;function ts(a, b, c, d) {
        cs.call(this, c, d);
        this.j = a;
        this.l = b
    }
    z(ts, cs);
    ts.prototype.g = function(a) {
        var b = js(a);
        return us(a.message, this.j) || us(a.g, this.l) || us(b, this.j) || us(b, this.l) ? ib : null
    }
    ;
    function us(a, b) {
        b = A(b);
        for (var c = b.next(); !c.done; c = b.next())
            if (c.value.test(a))
                return !0;
        return !1
    }
    ;function vs(a, b, c, d, e) {
        cs.call(this, c, d);
        this.j = a;
        this.Ta = b;
        this.matchType = e
    }
    z(vs, cs);
    vs.prototype.g = function(a) {
        switch (this.matchType) {
        case 0:
            a: {
                a = a.message;
                for (var b = A(this.j), c = b.next(); !c.done; c = b.next())
                    if (a === c.value) {
                        a = !0;
                        break a
                    }
                a = !1
            }
            return a ? ib : null;
        case 1:
            a: {
                a = a.message;
                b = A(this.j);
                for (c = b.next(); !c.done; c = b.next())
                    if (a.startsWith(c.value)) {
                        a = !0;
                        break a
                    }
                a = !1
            }
            return a ? ib : null;
        case 2:
            return a = fs(a),
            ws(a, this.j) || ws(a, this.Ta) ? ib : null;
        default:
            return null
        }
    }
    ;
    function ws(a, b) {
        b = A(b);
        for (var c = b.next(); !c.done; c = b.next())
            if (a.includes(c.value))
                return !0;
        return !1
    }
    function xs(a, b, c) {
        return new vs(a,b,c,0,2)
    }
    ;function ys(a, b, c) {
        cs.call(this, a, b);
        this.j = c()
    }
    z(ys, cs);
    ys.prototype.g = function() {
        return this.j ? null : "unsupported_severe"
    }
    ;
    var zs = [new es, xs(["Trusted Type", "TrustedHTML", "TrustedScript", "cannot communicate with background", "zaloJSV2", Pa, "@user-script", "Object Not Found Matching Id", "contextChanged", "Not implemented on this platform", "Extension context invalidated", Ta, "realTimeClData", "Failed to execute 'querySelectorAll' on 'Document'", "Promise.all(...).then(...).catch(...).finally is not a function", "Error executing Chrome API, chrome.tabs", "Identifier 'originalPrompt' has already been declared", "User rejected the request", "Could not inject ethereum provider because it's not your default extension", "Cannot redefine property: googletag", "Can't find variable: HTMLDialogElement", "Identifier 'listenerName' has already been declared", "Cannot read properties of undefined (reading 'info')", 'Permission denied to access property "type"', "Error: Promise timed out", "Request timeout ToolbarStatus", ea, "imtgo", "ton is not a function", "__renderMessageNode is not defined", "Cannot redefine property: ethereum", "unknown action:", "Receiving end does not exist", "get-frame-manager-configuration", "Key not found", "'isAWS'", "Identifier 'contentScriptListenerRegistered' has already been declared", "window.ethereum.selectedAddress", "extDomain is not defined"], ["puppeteer-core", Pa, "@user-script", "jsQuilting", "linkbolic", Ta, "tlscdn", "https://cdnjs.cloudflare.com/ajax/libs/mathjax/", "secured-pixel.com", ea, "imtgo", "_simulateEvent", "goguardian"], 1), new ts(Wr,Vr,1,0), xs("status is 0, navigator.onLine =;Network sync is disabled. Aborting a network request of int type;The service is currently unavailable.;Internal error encountered.;data does not exist in AF cache;There was an error during the transport or processing of this request;Failed to load gapi;Rpc failed due to xhr error. error code: 6, error:  [0];An interceptor has requested that the request be retried;8,\"generic\";A network error occurred;NetworkError: Connection failure due to HTTP 401;NetworkError: Failed to execute 'importScripts' on 'WorkerGlobalScope'".split(";"), Ur, 2), new ts([],Vr,2,0), new ts(Zr,$r,3,0), xs(["Kg is not defined", eb, "The play method is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.", "Illegal invocation", "Script error", "zCommon", "can't access dead object", "Java exception was raised during method invocation", "pauseVideo is not a function", "ResizeObserver loop", "wallet must has at least one account", "xbrowser is not defined", "jQuery is not defined", "Cannot read properties of null (reading 'requestAnimationFrame')", "Class extends value undefined is not a constructor or null", "GM3TooltipService: No tooltip with id", "Mole was disposed", "getInitialTopicListResponse is missing for stream rendering", "getPeopleById call preempted", "The operation is insecure", "class heritage", "The play() request was interrupted", "args.site.enabledFeatures is undefined", "frappe is not defined", "Cannot set properties of undefined (setting 'hidden')", "Identifier 'checkOngoingMeeting' has already been declared", "AutofillCallbackHandler", "invalid wire type", "zp_token", "isReCreate", "HTMLOUT is not defined", "Shopify root is null", "CanvasMaskingStrategy_Redact", "_chromeNamespace", "feature named `performanceMetrics`", "feature named `webCompat`", "Cannot redefine property: webdriver", "reCAPTCHA Timeout", "feature named `pageObserver` was not found", "feature named `hover` was not found", "Request timeout appSettingsDistributor.getValue", "TimeoutError: operation timed out", "Sink type mismatch violation blocked by CSP", "window.__firefox__.reader", ": Java object is gone", "Cannot read properties of undefined (reading 'domInteractive')", ": t is not defined"], ["postUserData", "inline.cdn.mcas.ms"], 3), new ts(as,Vr,5,0), xs("Service worker registration is disabled by MDA;An unknown error occurred when fetching the script;Operation has been aborted;Timed out while trying to start the Service Worker;The Service Worker system has shutdown;The user denied permission to use Service Worker;The script resource is behind a redirect, which is disallowed;The document is in an invalid state;ServiceWorker script evaluation failed;ServiceWorker cannot be started;Failed to access storage;Worker disallowed;encountered an error during installation".split(";"), Ur, 5), new ts(bs,bs,4,0), xs(["Timeout reached for loading script https://www.gstatic.com/_/apps-fileview/_/js/", "Error while loading script https://www.gstatic.com/_/apps-fileview/_/js/"], Ur, 4)]
      , As = new Set([pa, "SEVERE_AFTER_INITIAL", "UNKNOWN", "FATAL", ""]);
    function Bs(a) {
        this.j = a;
        this.g = !1
    }
    function Cs(a, b, c, d) {
        var e = [Error(eb).message];
        c = c === void 0 ? !1 : c;
        d = d === void 0 ? pb(!0) : d;
        var f = [];
        b.length > 0 && f.push(Ds(b));
        f.push.apply(f, Ab(zs));
        a = A(a);
        for (b = a.next(); !b.done; b = a.next())
            f.push(b.value);
        e.length > 0 && f.push(new vs(e,[],3,5,0));
        f.push(new gs(3,0));
        c && f.push(new ys(8,0,d));
        return new Bs(f)
    }
    function Es(a, b) {
        var c = "missing"
          , d = new Map
          , e = !0;
        try {
            c = b.j;
            a.g && d.set("apps_telemetry.after_downgraded_severe", db);
            for (var f = A(a.j), g = f.next(); !g.done; g = f.next()) {
                var h = g.value;
                try {
                    var l = ds(h, b);
                    if (l) {
                        var m = c
                          , p = Fs(a, c) ? l.ib : c;
                        Gs(l, m, p).forEach(function(t, w) {
                            d.set(w, t)
                        });
                        c = p;
                        break
                    }
                } catch (t) {
                    e = !1;
                    var r = ss(t, c);
                    d.set(xa, fs(r) + "\n\nclassifier: " + h.constructor.name)
                }
            }
        } catch (t) {
            e = !1,
            a = ss(t, c),
            d.set(xa, fs(a))
        }
        d.set(Ba, String(e));
        return {
            ib: c,
            ab: d
        }
    }
    function Gs(a, b, c) {
        var d = new Map;
        d.set("apps_telemetry.classification", a.Za.toString());
        d.set("apps_telemetry.classification_code", a.Ga ? a.Ga.toString() : "");
        d.set(ya, b);
        d.set(Aa, c);
        return d
    }
    function Fs(a, b) {
        return As.has(b.toUpperCase()) ? a.g = !0 : !1
    }
    function Ds(a) {
        var b = [];
        a = A(a);
        for (var c = a.next(); !c.done; c = a.next())
            b.push(new RegExp(c.value));
        return new ts(b,b,7,0)
    }
    ;function Hs() {}
    Hs.prototype.ua = function() {
        if (ua in C && typeof C.WorkerGlobalScope === k && self instanceof C.WorkerGlobalScope)
            return new Map;
        try {
            var a = Array.from(document.querySelectorAll("script")).filter(this.j).slice(0, 30).map(this.g).join("\n")
        } catch (b) {
            a = "Error getting cross-origin scripts"
        }
        return (new Map).set(wa, a)
    }
    ;
    Hs.prototype.j = function(a) {
        var b = new RegExp(/^(?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)*google\.com(?:$|[\/#?])/);
        return (a = a.getAttribute("src")) ? !(a.startsWith("/") || b.test(a)) : !1
    }
    ;
    Hs.prototype.g = function(a) {
        return a.innerHTML ? a.outerHTML.slice(0, a.outerHTML.indexOf(a.innerHTML)) : a.outerHTML
    }
    ;
    function Is() {}
    Is.prototype.ua = function() {
        try {
            var a = performance.getEntriesByType("resource").slice(-5).map(function(b) {
                return jm(b.name)
            }).join("\n")
        } catch (b) {
            a = "Error getting last 5 resources"
        }
        return (new Map).set("apps_telemetry.resources", a)
    }
    ;
    /*

Math.uuid.js (v1.4)
http://www.broofa.com
mailto:robert@broofa.com
Copyright (c) 2010 Robert Kieffer
Dual licensed under the MIT and GPL licenses.
*/
    var Js = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".split("");
    function Ks() {
        var a = [], b;
        a[8] = a[13] = a[18] = a[23] = "-";
        a[14] = "4";
        for (b = 0; b < 36; b++)
            if (!a[b]) {
                var c = 0 | Math.random() * 16;
                a[b] = Js[b == 19 ? c & 3 | 8 : c]
            }
        return a.join("")
    }
    ;function Ls(a, b, c, d, e) {
        var f = Ms;
        b = b === void 0 ? [] : b;
        c = c === void 0 ? [] : c;
        d = d === void 0 ? [] : d;
        this.o = Cs(b, c, e === void 0 ? !1 : e, f === void 0 ? pb(!0) : f);
        this.g = [new Kr, new Hs, new Is];
        this.g.push.apply(this.g, Ab(d));
        this.j = Ks();
        this.l = a;
        this.l.Sa(this.j)
    }
    function Ns(a, b, c, d) {
        d["apps_telemetry.session_id"] = a.j;
        Ba in d && (d["apps_telemetry.multi_processed"] = db);
        var e = a.ua();
        (a = Os(a, b, c, e)) && Ps(e, a.ab);
        e.forEach(function(g, h) {
            d[h] = g
        });
        var f;
        return (f = a == null ? void 0 : a.ib) != null ? f : c
    }
    function Os(a, b, c, d) {
        var e = null
          , f = null;
        try {
            e = ss(b, c, d),
            f = Es(a.o, e)
        } catch (g) {
            return Qs(d, g, Ba),
            null
        }
        a.l.Cb(e, f);
        return f
    }
    Ls.prototype.ua = function() {
        var a = new Map;
        try {
            for (var b = A(this.g), c = b.next(); !c.done; c = b.next())
                c.value.ua().forEach(function(d, e) {
                    a.set(e, d)
                })
        } catch (d) {
            Qs(a, d, "apps_telemetry.annotated")
        }
        return a
    }
    ;
    function Ps(a, b) {
        b.forEach(function(c, d) {
            a.set(d, c)
        })
    }
    function Qs(a, b, c) {
        a.set(c, "false");
        a.set(xa, os(b))
    }
    ;var Rs = new Set([1, 6, 7, 2, 0]);
    function Ms() {
        var a = Ar(Er(Gg()))
          , b = Ag(a, 1)
          , c = Ag(a, 5);
        return [b, c].every(function(d) {
            return Rs.has(d)
        })
    }
    ;function Ss(a) {
        try {
            return rh(ph(), a)
        } catch (b) {
            return !1
        }
    }
    ;function Ts(a, b) {
        var c = a = a === void 0 ? {} : a;
        a = c.Wb === void 0 ? [] : c.Wb;
        var d = c.rc === void 0 ? [] : c.rc
          , e = c.lc === void 0 ? [] : c.lc
          , f = c.jc === void 0 ? [] : c.jc;
        c = c.kc === void 0 ? [] : c.kc;
        try {
            var g = rh(ph(), th)
              , h = void 0 === ke ? 2 : 4
              , l = void 0;
            E(N(g));
            var m = L ? g[F(M)] : g.G;
            var p = G(m, u)[I] | 0;
            J(m, p);
            var r = p;
            var t = be(g, r) ? 1 : h;
            l = !!l || t === 3;
            if (t === 2 && Wf(g)) {
                E(N(g));
                m = L ? g[F(M)] : g.G;
                var w = G(m, u)[I] | 0;
                J(m, w);
                r = w
            }
            var K = jg(m, 1)
              , ba = K === Hd ? 7 : G(K, u)[I] | 0
              , X = kg(ba, r);
            je(K);
            if (g = 4 & X ? !1 : !0) {
                4 & X && (K = Xe(K),
                ba = 0,
                X = ig(X, r),
                r = F(dg(m, r, 1, K)));
                for (w = p = 0; p < K.length; p++) {
                    var Ka = nf(K[p]);
                    Ka != null && (K[w++] = Ka)
                }
                w < p && (K.length = w);
                Ka = X |= 4;
                Ka &= -513;
                X = Ka & -1025;
                X &= -4097
            }
            X !== ba && (Jd(K, X),
            2 & X && Object.freeze(K));
            K = gg(K, X, m, r, 1, t, g, l);
            je(K);
            l || fg(K, m);
            var ma = K
        } catch (Ra) {
            ma = []
        }
        m = Ss(vh);
        r = [];
        d.length > 0 && r.push(xs(d, [], 6));
        e.length > 0 && r.push(new ts(e,[],6,0));
        f.length > 0 && r.push(new vs(f,[],6,5,0));
        c.length > 0 && r.push(new vs(c,[],6,5,1));
        return new Ls(b,r,ma,[new Jr].concat(Ab(a)),m)
    }
    ;function Us() {}
    Us.prototype.Cb = lb();
    Us.prototype.Sa = lb();
    function Vs() {
        var a = a === void 0 ? {} : a;
        return Ts(a, new Us)
    }
    ;var Z = new Set;
    O(!0, "Event name <wZVHld> may not contain ':' or ';'");
    if (Z.has("wZVHld"))
        throw Error("Event <wZVHld> has already been declared.");
    Z.add("wZVHld");
    O(!0, "Event name <nDa8ic> may not contain ':' or ';'");
    if (Z.has("nDa8ic"))
        throw Error("Event <nDa8ic> has already been declared.");
    Z.add("nDa8ic");
    O(!0, "Event name <o07HZc> may not contain ':' or ';'");
    if (Z.has("o07HZc"))
        throw Error("Event <o07HZc> has already been declared.");
    Z.add("o07HZc");
    O(!0, "Event name <UjQMac> may not contain ':' or ';'");
    if (Z.has("UjQMac"))
        throw Error("Event <UjQMac> has already been declared.");
    Z.add("UjQMac");
    O(!0, "Event name <ti6hGc> may not contain ':' or ';'");
    if (Z.has("ti6hGc"))
        throw Error("Event <ti6hGc> has already been declared.");
    Z.add("ti6hGc");
    O(!0, "Event name <ZYIfFd> may not contain ':' or ';'");
    if (Z.has("ZYIfFd"))
        throw Error("Event <ZYIfFd> has already been declared.");
    Z.add("ZYIfFd");
    O(!0, "Event name <TGB85e> may not contain ':' or ';'");
    if (Z.has("TGB85e"))
        throw Error("Event <TGB85e> has already been declared.");
    Z.add("TGB85e");
    O(!0, "Event name <RXQi4b> may not contain ':' or ';'");
    if (Z.has("RXQi4b"))
        throw Error("Event <RXQi4b> has already been declared.");
    Z.add("RXQi4b");
    O(!0, "Event name <sn54Q> may not contain ':' or ';'");
    if (Z.has("sn54Q"))
        throw Error("Event <sn54Q> has already been declared.");
    Z.add("sn54Q");
    O(!0, "Event name <eQsQB> may not contain ':' or ';'");
    if (Z.has("eQsQB"))
        throw Error("Event <eQsQB> has already been declared.");
    Z.add("eQsQB");
    O(!0, "Event name <CGLD0d> may not contain ':' or ';'");
    if (Z.has("CGLD0d"))
        throw Error("Event <CGLD0d> has already been declared.");
    Z.add("CGLD0d");
    O(!0, "Event name <ZpywWb> may not contain ':' or ';'");
    if (Z.has("ZpywWb"))
        throw Error("Event <ZpywWb> has already been declared.");
    Z.add("ZpywWb");
    O(!0, "Event name <O1htCb> may not contain ':' or ';'");
    if (Z.has("O1htCb"))
        throw Error("Event <O1htCb> has already been declared.");
    Z.add("O1htCb");
    O(!0, "Event name <k9KYye> may not contain ':' or ';'");
    if (Z.has("k9KYye"))
        throw Error("Event <k9KYye> has already been declared.");
    Z.add("k9KYye");
    O(!0, "Event name <g6cJHd> may not contain ':' or ';'");
    if (Z.has("g6cJHd"))
        throw Error("Event <g6cJHd> has already been declared.");
    Z.add("g6cJHd");
    O(!0, "Event name <otb29e> may not contain ':' or ';'");
    if (Z.has("otb29e"))
        throw Error("Event <otb29e> has already been declared.");
    Z.add("otb29e");
    O(!0, "Event name <FNFY6c> may not contain ':' or ';'");
    if (Z.has("FNFY6c"))
        throw Error("Event <FNFY6c> has already been declared.");
    Z.add("FNFY6c");
    O(!0, "Event name <TvD9Pc> may not contain ':' or ';'");
    if (Z.has("TvD9Pc"))
        throw Error("Event <TvD9Pc> has already been declared.");
    Z.add("TvD9Pc");
    O(!0, "Event name <AHmuwe> may not contain ':' or ';'");
    if (Z.has("AHmuwe"))
        throw Error("Event <AHmuwe> has already been declared.");
    Z.add("AHmuwe");
    O(!0, "Event name <O22p3e> may not contain ':' or ';'");
    if (Z.has("O22p3e"))
        throw Error("Event <O22p3e> has already been declared.");
    Z.add("O22p3e");
    O(!0, "Event name <JIbuQc> may not contain ':' or ';'");
    if (Z.has("JIbuQc"))
        throw Error("Event <JIbuQc> has already been declared.");
    Z.add("JIbuQc");
    O(!0, "Event name <ih4XEb> may not contain ':' or ';'");
    if (Z.has("ih4XEb"))
        throw Error("Event <ih4XEb> has already been declared.");
    Z.add("ih4XEb");
    O(!0, "Event name <sPvj8e> may not contain ':' or ';'");
    if (Z.has("sPvj8e"))
        throw Error("Event <sPvj8e> has already been declared.");
    Z.add("sPvj8e");
    O(!0, "Event name <GvneHb> may not contain ':' or ';'");
    if (Z.has("GvneHb"))
        throw Error("Event <GvneHb> has already been declared.");
    Z.add("GvneHb");
    O(!0, "Event name <rcuQ6b> may not contain ':' or ';'");
    if (Z.has("rcuQ6b"))
        throw Error("Event <rcuQ6b> has already been declared.");
    Z.add("rcuQ6b");
    O(!0, "Event name <dyRcpb> may not contain ':' or ';'");
    if (Z.has("dyRcpb"))
        throw Error("Event <dyRcpb> has already been declared.");
    Z.add("dyRcpb");
    O(!0, "Event name <u0pjoe> may not contain ':' or ';'");
    if (Z.has("u0pjoe"))
        throw Error("Event <u0pjoe> has already been declared.");
    Z.add("u0pjoe");
    try {
        var Ws, Xs, Ys = (Xs = (Ws = window) == null ? void 0 : Ws.top) != null ? Xs : C;
        Ys.U3bHHf != null || (Ys.U3bHHf = 0);
        Ys.U3bHHf++
    } catch (a) {
        C.U3bHHf != null || (C.U3bHHf = 0),
        C.U3bHHf++
    }
    ;var Zs;
    if (C == null ? 0 : (Zs = C.Symbol) == null ? 0 : Zs.for) {
        var mt = Symbol.for("google.goem");
        C[mt] || (C[mt] = new WeakMap)
    }
    ;"#".replace(/([-()\[\]{}+?*.$\^|,:#<!\\])/g, "\\$1").replace(/\x08/g, "\\x08");
    function nt(a, b) {
        var c = a.__wiz;
        c || (c = a.__wiz = {});
        return c[b.toString()]
    }
    ;/*

 Copyright 2024 Google, Inc
 SPDX-License-Identifier: MIT
*/
    var ot = {};
    var pt = {};
    function qt(a) {
        var b = document.body;
        O(b === b.ownerDocument.body);
        O(b, "The element must not be null.");
        var c = wc(b.getAttribute(Oa) || "");
        var d = ["u0pjoe"];
        for (var e = A(d), f = e.next(); !f.done; f = e.next()) {
            f = f.value;
            var g;
            if (g = c) {
                var h = ot[g];
                h ? g = !!h[f.toString()] : (h = pt[f.toString()],
                h || (h = new RegExp("(^\\s*" + f + "\\s*:|[\\s;]" + f + "\\s*:)"),
                pt[f.toString()] = h),
                g = h.test(g))
            } else
                g = !1;
            g || (c && !/;$/.test(c) && (c += ";"),
            c += f + ":.CLIENT",
            rt(b, c));
            (g = nt(b, f)) ? g.push(a) : b.__wiz[f.toString()] = [a]
        }
        return {
            et: d,
            Ub: a,
            el: b
        }
    }
    function rt(a, b) {
        a.setAttribute(Oa, b);
        "__jsaction"in a && delete a.__jsaction
    }
    ;function st(a) {
        W.call(this);
        this.j = a
    }
    jc(st, W);
    st.prototype.g = function(a) {
        return tt(this, rc(a))
    }
    ;
    function ut(a, b) {
        rc(b);
        return b[vt(a, !1)] || b
    }
    function vt(a, b) {
        a = Object.prototype.hasOwnProperty.call(a, bc) && a[bc] || (a[bc] = ++cc);
        return (b ? "__wrapper_" : "__protected_") + a + "__"
    }
    function tt(a, b) {
        var c = vt(a, !0);
        b[c] || ((b[c] = wt(a, b))[vt(a, !1)] = b);
        return b[c]
    }
    function wt(a, b) {
        function c() {
            if (a.Oa())
                return b.apply(this, arguments);
            try {
                return b.apply(this, arguments)
            } catch (d) {
                xt(a, d)
            }
        }
        c[vt(a, !1)] = b;
        return c
    }
    function xt(a, b) {
        if (!(b && typeof b === q && typeof b.message === v && b.message.indexOf(ha) == 0 || typeof b === v && b.indexOf(ha) == 0))
            throw a.j(b),
            new yt(b);
    }
    function zt(a) {
        var b = b || C.window || C.globalThis;
        "onunhandledrejection"in b && (b.onunhandledrejection = function(c) {
            xt(a, c && c.reason ? c.reason : Error(eb))
        }
        )
    }
    function At(a, b) {
        var c = C.window || C.globalThis
          , d = c[b];
        if (!d)
            throw Error(b + " not on global?");
        c[b] = function(e, f) {
            typeof e === v && (e = D(hc, e));
            e && (arguments[0] = e = tt(a, e));
            if (d.apply)
                return d.apply(this, arguments);
            var g = e;
            if (arguments.length > 2) {
                var h = Array.prototype.slice.call(arguments, 2);
                g = function() {
                    e.apply(this, h)
                }
            }
            return d(g, f)
        }
        ;
        c[b][vt(a, !1)] = d
    }
    st.prototype.K = function() {
        var a = C.window || C.globalThis;
        a.setTimeout = ut(this, a.setTimeout);
        a.setInterval = ut(this, a.setInterval);
        st.da.K.call(this)
    }
    ;
    function yt(a) {
        kc.call(this, ha + (a && a.message ? String(a.message) : String(a)), a);
        (a = a && a.stack) && typeof a === v && (this.stack = a)
    }
    jc(yt, kc);
    function Bt() {
        Dp.call(this);
        this.headers = new Map;
        this.o = !1;
        this.g = null;
        this.ea = this.O = "";
        this.B = 0;
        this.D = "";
        this.v = this.aa = this.R = this.U = !1;
        this.H = 0;
        this.T = null;
        this.fa = "";
        this.ga = !1
    }
    jc(Bt, Dp);
    Bt.prototype.l = Vl("goog.net.XhrIo");
    var Ct = /^https?$/i
      , Dt = ["POST", "PUT"]
      , Et = [];
    x = Bt.prototype;
    x.Vb = function() {
        this.dispose();
        Tc(Et, this)
    }
    ;
    function or(a, b, c, d, e) {
        if (a.g)
            throw Error("[goog.net.XhrIo] Object is active with another request=" + a.O + "; newUri=" + b);
        c = c ? c.toUpperCase() : "GET";
        a.O = b;
        a.D = "";
        a.B = 0;
        a.ea = c;
        a.U = !1;
        a.o = !0;
        a.g = new XMLHttpRequest;
        a.g.onreadystatechange = nm(fc(a.Db, a));
        try {
            Xl(a.l, Ft(a, "Opening Xhr")),
            a.aa = !0,
            a.g.open(c, String(b), !0),
            a.aa = !1
        } catch (h) {
            Xl(a.l, Ft(a, "Error opening Xhr: " + h.message));
            Gt(a, h);
            return
        }
        b = d || "";
        d = new Map(a.headers);
        if (e)
            if (Object.getPrototypeOf(e) === Object.prototype)
                for (var f in e)
                    d.set(f, e[f]);
            else if (typeof e.keys === k && typeof e.get === k) {
                f = A(e.keys());
                for (var g = f.next(); !g.done; g = f.next())
                    g = g.value,
                    d.set(g, e.get(g))
            } else
                throw Error("Unknown input type for opt_headers: " + String(e));
        e = Array.from(d.keys()).find(function(h) {
            return "content-type" == h.toLowerCase()
        });
        f = C.FormData && b instanceof C.FormData;
        !(Qc(Dt, c) >= 0) || e || f || d.set("Content-Type", "application/x-www-form-urlencoded;charset=utf-8");
        c = A(d);
        for (e = c.next(); !e.done; e = c.next())
            d = A(e.value),
            e = d.next().value,
            d = d.next().value,
            a.g.setRequestHeader(e, d);
        a.fa && (a.g.responseType = a.fa);
        "withCredentials"in a.g && a.g.withCredentials !== a.ga && (a.g.withCredentials = a.ga);
        try {
            Ht(a),
            a.H > 0 && (Xl(a.l, Ft(a, "Will abort after " + a.H + "ms if incomplete")),
            a.T = setTimeout(a.sc.bind(a), a.H)),
            Xl(a.l, Ft(a, "Sending request")),
            a.R = !0,
            a.g.send(b),
            a.R = !1
        } catch (h) {
            Xl(a.l, Ft(a, "Send error: " + h.message)),
            Gt(a, h)
        }
    }
    x.sc = function() {
        typeof Ub != "undefined" && this.g && (this.D = "Timed out after " + this.H + "ms, aborting",
        this.B = 8,
        Xl(this.l, Ft(this, this.D)),
        Ep(this, "timeout"),
        this.abort(8))
    }
    ;
    function Gt(a, b) {
        a.o = !1;
        a.g && (a.v = !0,
        a.g.abort(),
        a.v = !1);
        a.D = b;
        a.B = 5;
        It(a);
        Jt(a)
    }
    function It(a) {
        a.U || (a.U = !0,
        Ep(a, Fa),
        Ep(a, Ha))
    }
    x.abort = function(a) {
        this.g && this.o && (Xl(this.l, Ft(this, "Aborting")),
        this.o = !1,
        this.v = !0,
        this.g.abort(),
        this.v = !1,
        this.B = a || 7,
        Ep(this, Fa),
        Ep(this, "abort"),
        Jt(this))
    }
    ;
    x.K = function() {
        this.g && (this.o && (this.o = !1,
        this.v = !0,
        this.g.abort(),
        this.v = !1),
        Jt(this, !0));
        Bt.da.K.call(this)
    }
    ;
    x.Db = function() {
        this.Oa() || (this.aa || this.R || this.v ? Kt(this) : this.fb())
    }
    ;
    x.fb = function() {
        Kt(this)
    }
    ;
    function Kt(a) {
        if (a.o && typeof Ub != "undefined")
            if (a.R && (a.g ? a.g.readyState : 0) == 4)
                setTimeout(a.Db.bind(a), 0);
            else if (Ep(a, "readystatechange"),
            (a.g ? a.g.readyState : 0) == 4) {
                Xl(a.l, Ft(a, "Request complete"));
                a.o = !1;
                try {
                    if (qr(a))
                        Ep(a, Fa),
                        Ep(a, "success");
                    else {
                        a.B = 6;
                        try {
                            var b = (a.g ? a.g.readyState : 0) > 2 ? a.g.statusText : ""
                        } catch (c) {
                            Xl(a.l, "Can not get status: " + c.message),
                            b = ""
                        }
                        a.D = b + " [" + pr(a) + "]";
                        It(a)
                    }
                } finally {
                    Jt(a)
                }
            }
    }
    function Jt(a, b) {
        if (a.g) {
            Ht(a);
            var c = a.g;
            a.g = null;
            b || Ep(a, "ready");
            try {
                c.onreadystatechange = null
            } catch (d) {
                (a = a.l) && Wl(a, Fl, "Problem encountered resetting onreadystatechange: " + d.message)
            }
        }
    }
    function Ht(a) {
        a.T && (clearTimeout(a.T),
        a.T = null)
    }
    x.isActive = function() {
        return !!this.g
    }
    ;
    function qr(a) {
        var b = pr(a);
        a: switch (b) {
        case 200:
        case 201:
        case 202:
        case 204:
        case 206:
        case 304:
        case 1223:
            var c = !0;
            break a;
        default:
            c = !1
        }
        if (!c) {
            if (b = b === 0)
                a = String(a.O).match(cm)[1] || null,
                !a && C.self && C.self.location && (a = C.self.location.protocol.slice(0, -1)),
                b = !Ct.test(a ? a.toLowerCase() : "");
            c = b
        }
        return c
    }
    function pr(a) {
        try {
            return (a.g ? a.g.readyState : 0) > 2 ? a.g.status : -1
        } catch (b) {
            return -1
        }
    }
    function Ft(a, b) {
        return b + " [" + a.ea + " " + a.O + " " + pr(a) + "]"
    }
    tm(function(a) {
        Bt.prototype.fb = a(Bt.prototype.fb)
    });
    function Lt(a, b, c) {
        Dp.call(this);
        this.v = b || null;
        this.o = {};
        this.B = Mt;
        this.H = a;
        if (!c) {
            this.g = null;
            this.g = new st(fc(this.l, this));
            At(this.g, "setTimeout");
            At(this.g, "setInterval");
            a = this.g;
            b = C.window || C.globalThis;
            c = ["requestAnimationFrame", "mozRequestAnimationFrame", "webkitAnimationFrame", "msRequestAnimationFrame"];
            for (var d = 0; d < c.length; d++) {
                var e = c[d];
                c[d]in b && At(a, e)
            }
            a = this.g;
            sm = !0;
            b = fc(a.g, a);
            for (c = 0; c < qm.length; c++)
                qm[c](b);
            rm.push(a)
        }
    }
    jc(Lt, Dp);
    function Nt(a, b) {
        Yo.call(this, "c");
        this.error = a;
        this.na = b
    }
    jc(Nt, Yo);
    var Ot = Vl("goog.debug.ErrorReporter");
    function Pt(a, b) {
        return new Lt(a,b,void 0)
    }
    function Mt(a, b, c, d) {
        if (d instanceof Map) {
            var e = {};
            d = A(d);
            for (var f = d.next(); !f.done; f = d.next()) {
                var g = A(f.value);
                f = g.next().value;
                g = g.next().value;
                e[f] = g
            }
        } else
            e = d;
        d = new Bt;
        Et.push(d);
        d.j.add("ready", d.Vb, !0, void 0, void 0);
        or(d, a, b, c, e)
    }
    function Qt(a, b) {
        a.B = b
    }
    Lt.prototype.l = function(a, b) {
        a = a.error || a;
        b = b ? fo(b) : {};
        a instanceof Error && ho(b, pd(a));
        var c = tl(a);
        if (this.v)
            try {
                this.v(c, b)
            } catch (t) {
                Ot && Wl(Ot, Fl, "Context provider threw an exception: " + t.message)
            }
        var d = c.message.substring(0, 1900);
        if (!(a instanceof kc) || a.g) {
            a = c.fileName;
            var e = c.lineNumber
              , f = c.stack;
            try {
                var g = im(this.H, "script", a, Ha, d, "line", e);
                a: {
                    for (var h in this.o) {
                        var l = !1;
                        break a
                    }
                    l = !0
                }
                if (!l) {
                    l = g;
                    var m = hm(this.o);
                    g = em(l, m)
                }
                m = {};
                m.trace = f;
                if (b)
                    for (var p in b)
                        m["context." + p] = b[p];
                var r = hm(m);
                this.B(g, "POST", r, this.D)
            } catch (t) {
                Ot && Wl(Ot, Hl, "Error occurred in sending an error report.\n\nscript:" + a + "\nline:" + e + "\nerror:" + d + "\ntrace:" + f)
            }
        }
        try {
            Ep(this, new Nt(c,b))
        } catch (t) {}
    }
    ;
    Lt.prototype.K = function() {
        km(this.g);
        Lt.da.K.call(this)
    }
    ;
    function Rt(a) {
        a = a === void 0 ? new St : a;
        Dp.call(this);
        var b = this;
        this.ea = {};
        this.g = null;
        this.T = {};
        this.aa = new Sq(this);
        this.ac = a.C;
        this.fa = a.H;
        this.Ob = a.D;
        var c;
        this.Rb = (c = a.o) != null ? c : !1;
        this.Da = a.v;
        this.Pb = a.O;
        c = E(a.g);
        this.Mb = a.l || Vs();
        this.Zb = a.R;
        this.ga = new Yq;
        var d = new Bt;
        Tt(this, c);
        this.O = new rr(d,c,void 0,void 0,void 0);
        mm(this, D(km, this.O));
        this.l = Dn(c, "docs-sup") + Dn(c, "docs-jepp") + "/jserror";
        if (d = Dn(c, "jobset"))
            this.l = im(this.l, "jobset", d);
        if (d = Dn(c, "docs-ci"))
            this.l = im(this.l, "id", d);
        d = Dn(c, "docs-pid");
        yn(c.get("docs-eaotx")) && d && (this.l = im(this.l, "ouid", d));
        this.B = Cn(c, "docs-srmoe") || 0;
        E(this.B >= 0 && this.B <= 1);
        this.Tb = yn(c.get("docs-oesf"));
        this.D = Cn(c, "docs-srmour") || 0;
        E(this.D >= 0 && this.D <= 1);
        this.Xb = yn(c.get("docs-oursf"));
        d = this.D > 0 && Math.random() < this.D;
        this.Sb = yn(c.get("docs-wesf"));
        this.Rb && Ut(this);
        $m = function(g) {
            return Vt(b, g, "promise rejection")
        }
        ;
        var e = Cn(c, "docs-srmdue") || 0;
        E(e >= 0 && e <= 1);
        if (e > 0 && Math.random() < e) {
            var f = yn(c.get("docs-duesf"));
            jn = function(g) {
                Vt(b, g, "deferred error", f, "isDeferredUnhandledErrback")
            }
        } else
            jn = lb();
        e = Cn(c, "docs-srmxue") || 0;
        E(e >= 0 && e <= 1);
        e = e > 0 && Math.random() < e;
        c.get("docs-xduesf");
        e && Qk();
        d && (d = new st(function(g) {
            var h = {};
            h = (h.isUnhandledRejection = db,
            h);
            b.Xb ? Wt(b, g, h) : b.info(g, h)
        }
        ),
        zt(d),
        mm(this, D(km, d)));
        this.U = null;
        typeof document !== "undefined" && document.body && (this.U = qt(function(g) {
            var h = {};
            h = (h.isWizError = db,
            h);
            g = A(g.data.errors);
            for (var l = g.next(); !l.done; l = g.next())
                l = l.value.error,
                b.Sb ? Wt(b, l, h) : b.info(l, h)
        }));
        this.Ya = Vl("docs.debug.ErrorReporter");
        (this.H = a.j) && E(this.Da);
        this.v = !1;
        this.R = !0;
        this.o = !1;
        this.Ca = Dn(c, "docs-jern");
        this.Nb = a.I;
        this.Lb = a.B.concat(Object.values(Nk))
    }
    z(Rt, Dp);
    function Ut(a) {
        var b = b === void 0 ? !1 : b;
        if (Xt) {
            if (Yt != null)
                throw Error('ErrorReporter already installed. at "' + Yt.stack + '"');
            throw Error("ErrorReporter already installed.");
        }
        Xt = !0;
        Yt = Error();
        a.g = Pt(a.l, function(e, f) {
            return Zt(a, e, f)
        });
        var c = {};
        a.Ob && (c["X-No-Abort"] = "1");
        a.g.D = c;
        Qt(a.g, function(e, f, g, h) {
            a.R && kr(a.O, e, f, g, h)
        });
        if (a.B > 0 && Math.random() < a.B) {
            c = {};
            var d = (c.isWindowOnError = db,
            c);
            a.Tb ? sl(function(e) {
                Wt(a, e.error instanceof Error ? e.error : Error(e.message), d)
            }) : sl(function(e) {
                a.log(e.error instanceof Error ? e.error : Error(e.message), d)
            })
        }
        Uq(a.aa, a.g, "c", function(e) {
            e.na.severity = e.na[bb] || e.na.severity;
            var f = e.na.severity;
            (f = f == Ia || f == Za) && !a.Da && (!a.ac || (b === void 0 ? 0 : b) ? a.ga.notify(void 0, e.na) : a.ga.notify(e, e.na));
            Ep(a, new Zq(f ? "a" : "b",e.error,e.na))
        })
    }
    function Tt(a, b) {
        b = new ur(b);
        var c = b.g, d;
        for (d in c) {
            var e = c[d];
            e && (a.T["expflag-" + d] = e.toString())
        }
        a.T.experimentIds = b.j.join(",")
    }
    function Wt(a, b, c) {
        a.o = !1;
        $t(b, Ia);
        au(a, b);
        if (!a.g) {
            if (b instanceof Ek)
                throw b.g;
            throw zl(b);
        }
        a.g.l(b, bu(a, b, c));
        if (a.Pb) {
            c = bu(a, b, c);
            c.is_forceFatal = 1;
            var d = b instanceof Ek ? b.g : b;
            Zt(a, d, c);
            b = zl(d);
            a = ", context:" + JSON.stringify(bu(a, d, c));
            b.message += a;
            throw b;
        }
    }
    function cu(a, b) {
        var c = du;
        c.o = !1;
        $t(a, ib);
        au(c, a, b);
        c.g && c.g.l(a, bu(c, a, b))
    }
    Rt.prototype.info = function(a, b, c) {
        this.o = c || !1;
        $t(a, Ma);
        au(this, a, b);
        this.g && this.g.l(a, bu(this, a, b))
    }
    ;
    Rt.prototype.log = function(a, b, c) {
        this.o = !!c;
        $t(a, Ma);
        au(this, a, b);
        this.g && this.g.l(a, bu(this, a, b))
    }
    ;
    function Vt(a, b, c, d, e) {
        d = d === void 0 ? !0 : d;
        if (b && typeof b === q && b.type === Ha) {
            var f = b.error;
            b = JSON.stringify({
                error: f && f.message ? f.message : ka,
                stack: f && f.stack ? f.stack : ka,
                message: b.message,
                filename: b.filename,
                lineno: b.lineno,
                colno: b.colno,
                type: b.type
            });
            c = Error(ta + c + " with ErrorEvent: " + b)
        } else
            c = typeof b === v ? Error(ta + c + " with: " + b) : typeof b === n ? Error(ta + c + " with number: " + b) : b == null ? Error(ta + c + ' with "null/undefined"') : b;
        b = {};
        e && (b[e] = db);
        d ? Wt(a, c, b) : a.info(c, b)
    }
    function bu(a, b, c) {
        b instanceof Ek && (b = b.g);
        c = c ? fo(c) : {};
        c.severity = pd(b).severity;
        var d = b && b.reportSeverity;
        d && (c.reportSeverity = d);
        a.fa && (c.errorGroupId = a.fa);
        if (b && !b.message && b.constructor && b.constructor instanceof Function && (b.constructor.name ? b.constructor.name : vl(b.constructor)) === oa) {
            c.unknownErrorToStringResult = Object.prototype.toString.call(b);
            a = c;
            d = JSON;
            for (var e = d.stringify, f = {}, g = Object.keys(b), h = 0, l = 0; l < g.length && h < 10; l++) {
                var m = g[l];
                try {
                    typeof b[m] !== k && (f[m] = String(b[m]).substring(0, 100),
                    h++)
                } catch (p) {}
            }
            a.unknownErrorContent = e.call(d, f)
        }
        return c
    }
    function Zt(a, b, c) {
        var d = a.v;
        try {
            a.oa(b, c)
        } catch (f) {
            throw d && !a.H && (a.R = !1),
            a.v = !0,
            c.provideLogDataError = f.message,
            c.severity || (c.severity = Ia),
            zl(f);
        } finally {
            if (c[bb] = c.severity || Ia,
            c.severity = "" + c[bb],
            !a.Nb)
                for (var e in c)
                    typeof c[e] === n || c[e]instanceof Number || typeof c[e] === Ea || c[e]instanceof Boolean || a.Lb.includes(e) || e in c && delete c[e]
        }
    }
    Rt.prototype.oa = function(a, b) {
        for (var c in this.ea)
            try {
                b[c] = this.ea[c](a)
            } catch (f) {}
        Object.assign(b, this.T);
        Ml || (Ml = new Ll);
        c = b.severity || Ia;
        var d = b.reportSeverity || a && a.reportSeverity;
        d && (d = eu(d.toLowerCase())) && (c = d);
        this.Zb || (c = Ns(this.Mb, a, c, b));
        this.Ca && (b.reportName = this.Ca + "_" + c);
        b.isArrayPrototypeIntact = vr().toString();
        if (!(ua in C && self instanceof C.WorkerGlobalScope)) {
            try {
                var e = !!document.getElementById("docs-editor")
            } catch (f) {
                e = !1
            }
            b.isEditorElementAttached = e.toString()
        }
        b.documentCharacterSet = document.characterSet;
        b.origin = String(C.origin);
        e = a.stack || "";
        if (e.trim().length == 0 || e == la)
            b["stacklessError-reportingStack"] = yl(Rt.prototype.oa),
            [a.message].concat(Ab(Object.keys(b)), Ab(Object.values(b))).some(function(f) {
                return f && f.includes("<eye3")
            }) || (b.eye3Hint = "<eye3-stackless title='Stackless JS Error - " + a.name + "'/>");
        this.v && !this.H ? (this.R = this.o,
        c == Ia ? c = Za : c == Ma && (c = jb)) : c == Ia && (this.v = !0);
        this.o = !1;
        b.severity = c
    }
    ;
    function au(a, b, c) {
        b = tl(b instanceof Ek ? b.g : b);
        a = a.Ya;
        c = b.message + " at " + b.fileName + ":" + b.lineNumber + "\n" + b.stack + (typeof c === "undefined" ? "" : "\ncontext: " + JSON.stringify(c));
        a && Wl(a, Gl, c)
    }
    Rt.prototype.K = function() {
        Xt = !1;
        if (this.U)
            for (var a = this.U, b = A(a.et), c = b.next(); !c.done; c = b.next()) {
                c = c.value;
                var d = nt(a.el, c);
                if (d && (Tc(d, a.Ub),
                !d.length)) {
                    d = a.el;
                    var e = wc(d.getAttribute(Oa) || "");
                    c += ":.CLIENT";
                    e = e.replace(c + ";", "");
                    e = e.replace(c, "");
                    rt(d, e)
                }
            }
        lm(this.aa, this.g, this.O);
        Dp.prototype.K.call(this)
    }
    ;
    var Xt = !1
      , Yt = null;
    function St() {
        this.H = this.g = void 0;
        this.O = this.C = !1;
        this.o = void 0;
        this.D = this.j = this.v = !1;
        this.I = !0;
        this.B = [];
        this.R = !1;
        this.l = void 0
    }
    function $t(a, b) {
        a instanceof Ek && (a = a.g);
        od(a, ab, b)
    }
    function eu(a) {
        if (!a)
            return null;
        switch (a) {
        case "severe":
        case Ia:
            return Ia;
        case ib:
            return ib;
        case "info":
        case gb:
        case Ma:
            return Ma;
        case Za:
            return Za;
        case jb:
            return jb;
        default:
            return null
        }
    }
    ;function fu() {
        var a = this;
        this.promise = new Promise(function(b, c) {
            a.resolve = b;
            a.reject = c
        }
        )
    }
    ;function gu() {
        this.l = window.crashReport;
        this.o = new fu;
        this.g = 0;
        this.j = new Map
    }
    gu.prototype.initialize = function(a) {
        a = a === void 0 ? 10240 : a;
        var b = this, c, d, e, f, g, h, l, m, p, r, t;
        return Nb(new Mb(new Ib(function(w) {
            switch (w.g) {
            case 1:
                if (b.g !== 0)
                    return w.return(b.o.promise);
                b.g = 1;
                w.U(2, 3);
                return w.H(b.l.initialize(a), 5);
            case 5:
                for (b.o.resolve(),
                b.g = 2,
                c = A(b.j),
                d = c.next(); !d.done; d = c.next())
                    e = d.value,
                    f = A(e),
                    g = f.next().value,
                    h = f.next().value,
                    l = g,
                    m = h,
                    p = void 0,
                    b.set(l, (p = m) != null ? p : "");
            case 3:
                w.R();
                b.j.clear();
                w.T(4);
                break;
            case 2:
                r = w.O();
                b.g = 3;
                t = Error("Failed to initialize crash storage", {
                    cause: r
                });
                b.o.reject(t);
                w.wa(3);
                break;
            case 4:
                return w.return(b.o.promise)
            }
        }
        )))
    }
    ;
    gu.prototype.set = function(a, b) {
        if (this.g !== 3)
            if (this.g !== 2)
                this.j.size < 100 || this.j.has(a) ? this.j.set(a, b) : this.j.set("cache_full", db);
            else
                try {
                    this.l.set(a, b)
                } catch (c) {}
    }
    ;
    gu.prototype.delete = function(a) {
        if (this.g !== 3)
            if (this.g !== 2)
                this.j.delete(a);
            else
                try {
                    typeof this.l.delete === k ? this.l.delete(a) : this.l.remove(a)
                } catch (b) {}
    }
    ;
    function hu() {}
    hu.prototype.initialize = function() {
        return Promise.resolve()
    }
    ;
    hu.prototype.set = lb();
    hu.prototype.delete = lb();
    var iu = null;
    var ju = [pa, "FATAL"];
    function ku() {
        this.j = this.l = 1;
        this.g = new Jg
    }
    ku.prototype.Cb = function(a, b) {
        var c = b == null ? void 0 : b.ab.get(Aa);
        a = c != null ? c : a.j;
        if (a = this.l === 1 && !!a && ju.includes(a.toUpperCase()))
            this.l = 2;
        b = b == null ? void 0 : b.ab.get(ya);
        if (c = this.j === 1 && !!b && !!c && b.toUpperCase() !== c.toUpperCase())
            this.j = 2;
        if (a || c) {
            c = qg(this.g, Dr, 3);
            b = new Cr;
            b = Dg(b, 1, this.l);
            b = Dg(b, 2, this.j);
            if (b != null) {
                a = b;
                var d = F(Cr);
                if (!(a instanceof d))
                    throw Error("Expected instanceof " + cf(d) + " but got " + (a && cf(a.constructor)));
            } else
                b = void 0;
            cg(c, 5, b);
            b && !be(b) && (E(N(c)),
            c = L ? c[F(M)] : c.G,
            Yf(c));
            lu(this)
        }
    }
    ;
    ku.prototype.Sa = function(a) {
        a: {
            var b = qg(this.g, zr, 1);
            var c = Br;
            Xf(b);
            if (void 0 === me) {
                if (mg(b, c, 4) !== 4) {
                    b = void 0;
                    break a
                }
            } else {
                E(N(b));
                var d = L ? b[F(M)] : b.G;
                E(c.includes(4));
                var e = pg(d)
                  , f = og(e, d, c);
                f !== 4 && (f && dg(d, void 0, f),
                e.set(c, 4))
            }
            b = qg(b, yr, 4)
        }
        b.Sa(a);
        lu(this)
    }
    ;
    function lu(a) {
        if (!iu) {
            try {
                var b = Ss(uh)
            } catch (c) {
                b = !1
            }
            iu = b && window.crashReport ? new gu : new hu;
            iu.initialize()
        }
        b = iu;
        b.set("appsTelemetryCrashReportData", JSON.stringify(Ff(a.g)))
    }
    ;var mu = new St;
    mu.o = !0;
    mu.C = !1;
    mu.j = !0;
    mu.v = !0;
    var nu = function() {
        if (wn == null) {
            var a = new zn(null);
            wn = function() {
                return a
            }
        }
        var b;
        return U((b = wn,
        b()), vn, un)
    }();
    mu.g = nu;
    var ou, pu = void 0;
    pu = pu === void 0 ? {} : pu;
    ou = Ts(pu, new ku);
    mu.l = ou;
    var qu;
    qu = new Rt(mu);
    var ru = !1, du;
    function su(a, b) {
        var c = b.g;
        if (Kp(c)) {
            b = c.origin;
            var d = (d = b.match(cm)[3] || null) ? decodeURI(d) : d;
            var e;
            if (e = !!d)
                d = d.toLowerCase(),
                e = d.length - 11,
                e = e >= 0 && d.indexOf(".google.com", e) == e;
            if (d = e)
                (a = !a) || (a = b.match(cm)[1] || null,
                a = !!a && a.toLowerCase() == "https"),
                d = a;
            if (d) {
                a = c.data;
                try {
                    var f = JSON.parse(a);
                    var g = f ? new Tp(eo(f, "sh"),eo(f, "uh"),eo(f, "sfns"),eo(f, "hfns"),eo(f, "cspns"),eo(f, "apre"),eo(f, "aparm"),eo(f, "ift")) : null
                } catch (p) {
                    console.log("dropping postMessage.. deserialize threw error.");
                    cu(p, {
                        message: "Deserialize Error in postMessage handler while deserializing the data."
                    });
                    return
                }
                if (!g)
                    console.log("dropping postMessage.. data was missing."),
                    Wt(du, Error("Missing data"), {
                        message: "Missing data received in postMessage handler.",
                        data: a
                    });
                else if (!ru) {
                    ru = !0;
                    f = E(uo("userHtmlFrame"));
                    a = f.contentWindow;
                    var h = E(c.source);
                    d = g.D;
                    c = g.v;
                    e = g.B;
                    var l = g.o
                      , m = g.l;
                    g = new Qq(g.j,g.g);
                    b = new Wq(window,h,b);
                    Vb("maeExportApis_", D(tu, iq(b, g), e, l, m, a));
                    a.document.open();
                    b = a.document;
                    g = '<!doctype html><script src="//www.google.com/jsapi">\x3c/script><script>window.parent.maeExportApis_();\x3c/script>' + d;
                    g = g === null ? Va : g === void 0 ? "undefined" : g;
                    if (typeof g !== v)
                        throw Error("Expected a string");
                    g = pl(g);
                    b.write(ql(g));
                    a.document.close();
                    f.title = c
                }
            } else
                console.log("posting uri is not valid: " + b),
                cu(Error("Invalid URI in postMessage handler."), {
                    uri: b
                })
        } else
            cu(Error("Invalid window in postMessage handler."), {
                message: "Invalid window as we expect the message to be from the parent window.",
                origin: c.origin
            })
    }
    function tu(a, b, c, d, e) {
        b = qq(a, b);
        Vb("google.script.run", b, e);
        for (b = 0; b < c.length; ++b) {
            var f = c[b]
              , g = f.hfp;
            f = f.hft;
            var h = fc(D(a.mc, g), a);
            h = Lp(h, 2);
            f === "hftr" ? (h = fc(D(a.nc, g), a),
            h = Lp(h, 64)) : f === "hftc" && (h = fc(D(a.qc, g), a),
            h = Lp(h, 64));
            Vb(g, h, e)
        }
        for (var l in d)
            Vb(l, d[l], e)
    }
    Vb("maeInit_", function(a, b) {
        du = b = b === void 0 ? qu : b;
        mp(window, Sa, D(su, a))
    });
}
)()
