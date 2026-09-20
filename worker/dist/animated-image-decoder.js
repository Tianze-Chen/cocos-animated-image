// animated-image 解码 worker —— 生成文件，勿手改。
// 源码: worker/{decoder-worker,overlay-compositor}.ts + runtime/{apng-decoder,gif-decoder,zlib.min,mime-sniff,worker-protocol}.ts
// 重建: node scripts/build-worker.mjs
(function () {
    'use strict';

    // @ts-nocheck
    /* eslint-disable */
    /** @license zlib.js 2012 - imaya [ https://github.com/imaya/zlib.js ] The MIT License */
    var _zlibWindow = {};
    (function () {
        function i(a) { throw a; }
        var r = void 0, v = !0, aa = this;
        function y(a, c) { var b = a.split("."), e = aa; !(b[0] in e) && e.execScript && e.execScript("var " + b[0]); for (var f; b.length && (f = b.shift());)
            !b.length && c !== r ? e[f] = c : e = e[f] ? e[f] : e[f] = {}; }
        var H = "undefined" !== typeof Uint8Array && "undefined" !== typeof Uint16Array && "undefined" !== typeof Uint32Array;
        function ba(a) { if ("string" === typeof a) {
            var c = a.split(""), b, e;
            b = 0;
            for (e = c.length; b < e; b++)
                c[b] = (c[b].charCodeAt(0) & 255) >>> 0;
            a = c;
        } for (var f = 1, d = 0, g = a.length, h, m = 0; 0 < g;) {
            h = 1024 < g ? 1024 : g;
            g -= h;
            do
                f += a[m++], d += f;
            while (--h);
            f %= 65521;
            d %= 65521;
        } return (d << 16 | f) >>> 0; }
        function J(a, c) { this.index = "number" === typeof c ? c : 0; this.i = 0; this.buffer = a instanceof (H ? Uint8Array : Array) ? a : new (H ? Uint8Array : Array)(32768); 2 * this.buffer.length <= this.index && i(Error("invalid index")); this.buffer.length <= this.index && this.f(); }
        J.prototype.f = function () { var a = this.buffer, c, b = a.length, e = new (H ? Uint8Array : Array)(b << 1); if (H)
            e.set(a);
        else
            for (c = 0; c < b; ++c)
                e[c] = a[c]; return this.buffer = e; };
        J.prototype.d = function (a, c, b) { var e = this.buffer, f = this.index, d = this.i, g = e[f], h; b && 1 < c && (a = 8 < c ? (N[a & 255] << 24 | N[a >>> 8 & 255] << 16 | N[a >>> 16 & 255] << 8 | N[a >>> 24 & 255]) >> 32 - c : N[a] >> 8 - c); if (8 > c + d)
            g = g << c | a, d += c;
        else
            for (h = 0; h < c; ++h)
                g = g << 1 | a >> c - h - 1 & 1, 8 === ++d && (d = 0, e[f++] = N[g], g = 0, f === e.length && (e = this.f())); e[f] = g; this.buffer = e; this.i = d; this.index = f; };
        J.prototype.finish = function () { var a = this.buffer, c = this.index, b; 0 < this.i && (a[c] <<= 8 - this.i, a[c] = N[a[c]], c++); H ? b = a.subarray(0, c) : (a.length = c, b = a); return b; };
        var ca = new (H ? Uint8Array : Array)(256), ha;
        for (ha = 0; 256 > ha; ++ha) {
            for (var R = ha, ia = R, ja = 7, R = R >>> 1; R; R >>>= 1)
                ia <<= 1, ia |= R & 1, --ja;
            ca[ha] = (ia << ja & 255) >>> 0;
        }
        var N = ca;
        function la(a) { this.buffer = new (H ? Uint16Array : Array)(2 * a); this.length = 0; }
        la.prototype.getParent = function (a) { return 2 * ((a - 2) / 4 | 0); };
        la.prototype.push = function (a, c) { var b, e, f = this.buffer, d; b = this.length; f[this.length++] = c; for (f[this.length++] = a; 0 < b;)
            if (e = this.getParent(b), f[b] > f[e])
                d = f[b], f[b] = f[e], f[e] = d, d = f[b + 1], f[b + 1] = f[e + 1], f[e + 1] = d, b = e;
            else
                break; return this.length; };
        la.prototype.pop = function () { var a, c, b = this.buffer, e, f, d; c = b[0]; a = b[1]; this.length -= 2; b[0] = b[this.length]; b[1] = b[this.length + 1]; for (d = 0;;) {
            f = 2 * d + 2;
            if (f >= this.length)
                break;
            f + 2 < this.length && b[f + 2] > b[f] && (f += 2);
            if (b[f] > b[d])
                e = b[d], b[d] = b[f], b[f] = e, e = b[d + 1], b[d + 1] = b[f + 1], b[f + 1] = e;
            else
                break;
            d = f;
        } return { index: a, value: c, length: this.length }; };
        function S(a) { var c = a.length, b = 0, e = Number.POSITIVE_INFINITY, f, d, g, h, m, j, s, n, l; for (n = 0; n < c; ++n)
            a[n] > b && (b = a[n]), a[n] < e && (e = a[n]); f = 1 << b; d = new (H ? Uint32Array : Array)(f); g = 1; h = 0; for (m = 2; g <= b;) {
            for (n = 0; n < c; ++n)
                if (a[n] === g) {
                    j = 0;
                    s = h;
                    for (l = 0; l < g; ++l)
                        j = j << 1 | s & 1, s >>= 1;
                    for (l = j; l < f; l += m)
                        d[l] = g << 16 | n;
                    ++h;
                }
            ++g;
            h <<= 1;
            m <<= 1;
        } return [d, b, e]; }
        function ma(a, c) { this.h = pa; this.w = 0; this.input = a; this.b = 0; c && (c.lazy && (this.w = c.lazy), "number" === typeof c.compressionType && (this.h = c.compressionType), c.outputBuffer && (this.a = H && c.outputBuffer instanceof Array ? new Uint8Array(c.outputBuffer) : c.outputBuffer), "number" === typeof c.outputIndex && (this.b = c.outputIndex)); this.a || (this.a = new (H ? Uint8Array : Array)(32768)); }
        var pa = 2, qa = { NONE: 0, r: 1, j: pa, N: 3 }, ra = [], T;
        for (T = 0; 288 > T; T++)
            switch (v) {
                case 143 >= T:
                    ra.push([T + 48, 8]);
                    break;
                case 255 >= T:
                    ra.push([T - 144 + 400, 9]);
                    break;
                case 279 >= T:
                    ra.push([T - 256 + 0, 7]);
                    break;
                case 287 >= T:
                    ra.push([T - 280 + 192, 8]);
                    break;
                default: i("invalid literal: " + T);
            }
        ma.prototype.n = function () {
            var a, c, b, e, f = this.input;
            switch (this.h) {
                case 0:
                    b = 0;
                    for (e = f.length; b < e;) {
                        c = H ? f.subarray(b, b + 65535) : f.slice(b, b + 65535);
                        b += c.length;
                        var d = c, g = b === e, h = r, m = r, j = r, s = r, n = r, l = this.a, q = this.b;
                        if (H) {
                            for (l = new Uint8Array(this.a.buffer); l.length <= q + d.length + 5;)
                                l = new Uint8Array(l.length << 1);
                            l.set(this.a);
                        }
                        h = g ? 1 : 0;
                        l[q++] = h | 0;
                        m = d.length;
                        j = ~m + 65536 & 65535;
                        l[q++] = m & 255;
                        l[q++] = m >>> 8 & 255;
                        l[q++] = j & 255;
                        l[q++] = j >>> 8 & 255;
                        if (H)
                            l.set(d, q), q += d.length, l = l.subarray(0, q);
                        else {
                            s = 0;
                            for (n = d.length; s < n; ++s)
                                l[q++] =
                                    d[s];
                            l.length = q;
                        }
                        this.b = q;
                        this.a = l;
                    }
                    break;
                case 1:
                    var E = new J(new Uint8Array(this.a.buffer), this.b);
                    E.d(1, 1, v);
                    E.d(1, 2, v);
                    var t = sa(this, f), z, K, A;
                    z = 0;
                    for (K = t.length; z < K; z++)
                        if (A = t[z], J.prototype.d.apply(E, ra[A]), 256 < A)
                            E.d(t[++z], t[++z], v), E.d(t[++z], 5), E.d(t[++z], t[++z], v);
                        else if (256 === A)
                            break;
                    this.a = E.finish();
                    this.b = this.a.length;
                    break;
                case pa:
                    var x = new J(new Uint8Array(this.a), this.b), B, k, p, D, C, da = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15], W, Ma, ea, Na, na, va = Array(19), Oa, $, oa, F, Pa;
                    B = pa;
                    x.d(1, 1, v);
                    x.d(B, 2, v);
                    k = sa(this, f);
                    W = ta(this.L, 15);
                    Ma = ua(W);
                    ea = ta(this.K, 7);
                    Na = ua(ea);
                    for (p = 286; 257 < p && 0 === W[p - 1]; p--)
                        ;
                    for (D = 30; 1 < D && 0 === ea[D - 1]; D--)
                        ;
                    var Qa = p, Ra = D, M = new (H ? Uint32Array : Array)(Qa + Ra), u, O, w, fa, L = new (H ? Uint32Array : Array)(316), I, G, P = new (H ? Uint8Array : Array)(19);
                    for (u = O = 0; u < Qa; u++)
                        M[O++] = W[u];
                    for (u = 0; u < Ra; u++)
                        M[O++] = ea[u];
                    if (!H) {
                        u = 0;
                        for (fa = P.length; u < fa; ++u)
                            P[u] = 0;
                    }
                    u = I = 0;
                    for (fa = M.length; u < fa; u += O) {
                        for (O = 1; u + O < fa && M[u + O] === M[u]; ++O)
                            ;
                        w = O;
                        if (0 === M[u])
                            if (3 > w)
                                for (; 0 < w--;)
                                    L[I++] = 0, P[0]++;
                            else
                                for (; 0 <
                                    w;)
                                    G = 138 > w ? w : 138, G > w - 3 && G < w && (G = w - 3), 10 >= G ? (L[I++] = 17, L[I++] = G - 3, P[17]++) : (L[I++] = 18, L[I++] = G - 11, P[18]++), w -= G;
                        else if (L[I++] = M[u], P[M[u]]++, w--, 3 > w)
                            for (; 0 < w--;)
                                L[I++] = M[u], P[M[u]]++;
                        else
                            for (; 0 < w;)
                                G = 6 > w ? w : 6, G > w - 3 && G < w && (G = w - 3), L[I++] = 16, L[I++] = G - 3, P[16]++, w -= G;
                    }
                    a = H ? L.subarray(0, I) : L.slice(0, I);
                    na = ta(P, 7);
                    for (F = 0; 19 > F; F++)
                        va[F] = na[da[F]];
                    for (C = 19; 4 < C && 0 === va[C - 1]; C--)
                        ;
                    Oa = ua(na);
                    x.d(p - 257, 5, v);
                    x.d(D - 1, 5, v);
                    x.d(C - 4, 4, v);
                    for (F = 0; F < C; F++)
                        x.d(va[F], 3, v);
                    F = 0;
                    for (Pa = a.length; F < Pa; F++)
                        if ($ = a[F], x.d(Oa[$], na[$], v), 16 <= $) {
                            F++;
                            switch ($) {
                                case 16:
                                    oa = 2;
                                    break;
                                case 17:
                                    oa = 3;
                                    break;
                                case 18:
                                    oa = 7;
                                    break;
                                default: i("invalid code: " + $);
                            }
                            x.d(a[F], oa, v);
                        }
                    var Sa = [Ma, W], Ta = [Na, ea], Q, Ua, ga, ya, Va, Wa, Xa, Ya;
                    Va = Sa[0];
                    Wa = Sa[1];
                    Xa = Ta[0];
                    Ya = Ta[1];
                    Q = 0;
                    for (Ua = k.length; Q < Ua; ++Q)
                        if (ga = k[Q], x.d(Va[ga], Wa[ga], v), 256 < ga)
                            x.d(k[++Q], k[++Q], v), ya = k[++Q], x.d(Xa[ya], Ya[ya], v), x.d(k[++Q], k[++Q], v);
                        else if (256 === ga)
                            break;
                    this.a = x.finish();
                    this.b = this.a.length;
                    break;
                default: i("invalid compression type");
            }
            return this.a;
        };
        function wa(a, c) { this.length = a; this.G = c; }
        function xa() {
            var a = za;
            switch (v) {
                case 3 === a: return [257, a - 3, 0];
                case 4 === a: return [258, a - 4, 0];
                case 5 === a: return [259, a - 5, 0];
                case 6 === a: return [260, a - 6, 0];
                case 7 === a: return [261, a - 7, 0];
                case 8 === a: return [262, a - 8, 0];
                case 9 === a: return [263, a - 9, 0];
                case 10 === a: return [264, a - 10, 0];
                case 12 >= a: return [265, a - 11, 1];
                case 14 >= a: return [266, a - 13, 1];
                case 16 >= a: return [267, a - 15, 1];
                case 18 >= a: return [268, a - 17, 1];
                case 22 >= a: return [269, a - 19, 2];
                case 26 >= a: return [270, a - 23, 2];
                case 30 >= a: return [271, a - 27, 2];
                case 34 >= a: return [272, a -
                        31, 2];
                case 42 >= a: return [273, a - 35, 3];
                case 50 >= a: return [274, a - 43, 3];
                case 58 >= a: return [275, a - 51, 3];
                case 66 >= a: return [276, a - 59, 3];
                case 82 >= a: return [277, a - 67, 4];
                case 98 >= a: return [278, a - 83, 4];
                case 114 >= a: return [279, a - 99, 4];
                case 130 >= a: return [280, a - 115, 4];
                case 162 >= a: return [281, a - 131, 5];
                case 194 >= a: return [282, a - 163, 5];
                case 226 >= a: return [283, a - 195, 5];
                case 257 >= a: return [284, a - 227, 5];
                case 258 === a: return [285, a - 258, 0];
                default: i("invalid length: " + a);
            }
        }
        var Aa = [], za, Ba;
        for (za = 3; 258 >= za; za++)
            Ba = xa(), Aa[za] = Ba[2] << 24 | Ba[1] << 16 | Ba[0];
        var Ca = H ? new Uint32Array(Aa) : Aa;
        function sa(a, c) {
            function b(a, c) {
                var b = a.G, d = [], e = 0, f;
                f = Ca[a.length];
                d[e++] = f & 65535;
                d[e++] = f >> 16 & 255;
                d[e++] = f >> 24;
                var g;
                switch (v) {
                    case 1 === b:
                        g = [0, b - 1, 0];
                        break;
                    case 2 === b:
                        g = [1, b - 2, 0];
                        break;
                    case 3 === b:
                        g = [2, b - 3, 0];
                        break;
                    case 4 === b:
                        g = [3, b - 4, 0];
                        break;
                    case 6 >= b:
                        g = [4, b - 5, 1];
                        break;
                    case 8 >= b:
                        g = [5, b - 7, 1];
                        break;
                    case 12 >= b:
                        g = [6, b - 9, 2];
                        break;
                    case 16 >= b:
                        g = [7, b - 13, 2];
                        break;
                    case 24 >= b:
                        g = [8, b - 17, 3];
                        break;
                    case 32 >= b:
                        g = [9, b - 25, 3];
                        break;
                    case 48 >= b:
                        g = [10, b - 33, 4];
                        break;
                    case 64 >= b:
                        g = [11, b - 49, 4];
                        break;
                    case 96 >= b:
                        g = [12, b -
                                65, 5];
                        break;
                    case 128 >= b:
                        g = [13, b - 97, 5];
                        break;
                    case 192 >= b:
                        g = [14, b - 129, 6];
                        break;
                    case 256 >= b:
                        g = [15, b - 193, 6];
                        break;
                    case 384 >= b:
                        g = [16, b - 257, 7];
                        break;
                    case 512 >= b:
                        g = [17, b - 385, 7];
                        break;
                    case 768 >= b:
                        g = [18, b - 513, 8];
                        break;
                    case 1024 >= b:
                        g = [19, b - 769, 8];
                        break;
                    case 1536 >= b:
                        g = [20, b - 1025, 9];
                        break;
                    case 2048 >= b:
                        g = [21, b - 1537, 9];
                        break;
                    case 3072 >= b:
                        g = [22, b - 2049, 10];
                        break;
                    case 4096 >= b:
                        g = [23, b - 3073, 10];
                        break;
                    case 6144 >= b:
                        g = [24, b - 4097, 11];
                        break;
                    case 8192 >= b:
                        g = [25, b - 6145, 11];
                        break;
                    case 12288 >= b:
                        g = [26, b - 8193, 12];
                        break;
                    case 16384 >=
                        b:
                        g = [27, b - 12289, 12];
                        break;
                    case 24576 >= b:
                        g = [28, b - 16385, 13];
                        break;
                    case 32768 >= b:
                        g = [29, b - 24577, 13];
                        break;
                    default: i("invalid distance");
                }
                f = g;
                d[e++] = f[0];
                d[e++] = f[1];
                d[e++] = f[2];
                var h, j;
                h = 0;
                for (j = d.length; h < j; ++h)
                    l[q++] = d[h];
                t[d[0]]++;
                z[d[3]]++;
                E = a.length + c - 1;
                n = null;
            }
            var e, f, d, g, h, m = {}, j, s, n, l = H ? new Uint16Array(2 * c.length) : [], q = 0, E = 0, t = new (H ? Uint32Array : Array)(286), z = new (H ? Uint32Array : Array)(30), K = a.w, A;
            if (!H) {
                for (d = 0; 285 >= d;)
                    t[d++] = 0;
                for (d = 0; 29 >= d;)
                    z[d++] = 0;
            }
            t[256] = 1;
            e = 0;
            for (f = c.length; e < f; ++e) {
                d = h = 0;
                for (g = 3; d < g && e + d !== f; ++d)
                    h = h << 8 | c[e + d];
                m[h] === r && (m[h] = []);
                j = m[h];
                if (!(0 < E--)) {
                    for (; 0 < j.length && 32768 < e - j[0];)
                        j.shift();
                    if (e + 3 >= f) {
                        n && b(n, -1);
                        d = 0;
                        for (g = f - e; d < g; ++d)
                            A = c[e + d], l[q++] = A, ++t[A];
                        break;
                    }
                    if (0 < j.length) {
                        var x = r, B = r, k = 0, p = r, D = r, C = r, da = r, W = c.length, D = 0, da = j.length;
                        a: for (; D < da; D++) {
                            x = j[da - D - 1];
                            p = 3;
                            if (3 < k) {
                                for (C = k; 3 < C; C--)
                                    if (c[x + C - 1] !== c[e + C - 1])
                                        continue a;
                                p = k;
                            }
                            for (; 258 > p && e + p < W && c[x + p] === c[e + p];)
                                ++p;
                            p > k && (B = x, k = p);
                            if (258 === p)
                                break;
                        }
                        s = new wa(k, e - B);
                        n ? n.length < s.length ? (A = c[e - 1], l[q++] = A, ++t[A], b(s, 0)) : b(n, -1) : s.length < K ? n = s : b(s, 0);
                    }
                    else
                        n ? b(n, -1) : (A = c[e], l[q++] = A, ++t[A]);
                }
                j.push(e);
            }
            l[q++] = 256;
            t[256]++;
            a.L = t;
            a.K = z;
            return H ? l.subarray(0, q) : l;
        }
        function ta(a, c) {
            function b(a) { var c = z[a][K[a]]; c === n ? (b(a + 1), b(a + 1)) : --E[c]; ++K[a]; }
            var e = a.length, f = new la(572), d = new (H ? Uint8Array : Array)(e), g, h, m, j, s;
            if (!H)
                for (j = 0; j < e; j++)
                    d[j] = 0;
            for (j = 0; j < e; ++j)
                0 < a[j] && f.push(j, a[j]);
            g = Array(f.length / 2);
            h = new (H ? Uint32Array : Array)(f.length / 2);
            if (1 === g.length)
                return d[f.pop().index] = 1, d;
            j = 0;
            for (s = f.length / 2; j < s; ++j)
                g[j] = f.pop(), h[j] = g[j].value;
            var n = h.length, l = new (H ? Uint16Array : Array)(c), q = new (H ? Uint8Array : Array)(c), E = new (H ? Uint8Array : Array)(n), t = Array(c), z = Array(c), K = Array(c), A = (1 << c) - n, x = 1 << c - 1, B, k, p, D, C;
            l[c - 1] = n;
            for (k = 0; k < c; ++k)
                A < x ? q[k] = 0 : (q[k] = 1, A -= x), A <<= 1, l[c - 2 - k] = (l[c - 1 - k] / 2 | 0) + n;
            l[0] = q[0];
            t[0] = Array(l[0]);
            z[0] = Array(l[0]);
            for (k = 1; k < c; ++k)
                l[k] > 2 * l[k - 1] + q[k] && (l[k] = 2 * l[k - 1] + q[k]), t[k] = Array(l[k]), z[k] = Array(l[k]);
            for (B = 0; B < n; ++B)
                E[B] = c;
            for (p = 0; p < l[c - 1]; ++p)
                t[c - 1][p] = h[p], z[c - 1][p] = p;
            for (B = 0; B < c; ++B)
                K[B] = 0;
            1 === q[c - 1] && (--E[0], ++K[c - 1]);
            for (k = c - 2; 0 <= k; --k) {
                D = B = 0;
                C = K[k + 1];
                for (p = 0; p < l[k]; p++)
                    D = t[k + 1][C] + t[k + 1][C + 1], D > h[B] ? (t[k][p] = D, z[k][p] = n, C += 2) :
                        (t[k][p] = h[B], z[k][p] = B, ++B);
                K[k] = 0;
                1 === q[k] && b(k);
            }
            m = E;
            j = 0;
            for (s = g.length; j < s; ++j)
                d[g[j].index] = m[j];
            return d;
        }
        function ua(a) { var c = new (H ? Uint16Array : Array)(a.length), b = [], e = [], f = 0, d, g, h, m; d = 0; for (g = a.length; d < g; d++)
            b[a[d]] = (b[a[d]] | 0) + 1; d = 1; for (g = 16; d <= g; d++)
            e[d] = f, f += b[d] | 0, f > 1 << d && i("overcommitted"), f <<= 1; 65536 > f && i("undercommitted"); d = 0; for (g = a.length; d < g; d++) {
            f = e[a[d]];
            e[a[d]] += 1;
            h = c[d] = 0;
            for (m = a[d]; h < m; h++)
                c[d] = c[d] << 1 | f & 1, f >>>= 1;
        } return c; }
        function Da(a, c) { this.input = a; this.a = new (H ? Uint8Array : Array)(32768); this.h = U.j; var b = {}, e; if ((c || !(c = {})) && "number" === typeof c.compressionType)
            this.h = c.compressionType; for (e in c)
            b[e] = c[e]; b.outputBuffer = this.a; this.z = new ma(this.input, b); }
        var U = qa;
        Da.prototype.n = function () {
            var a, c, b, e, f, d, g, h = 0;
            g = this.a;
            a = Ea;
            switch (a) {
                case Ea:
                    c = Math.LOG2E * Math.log(32768) - 8;
                    break;
                default: i(Error("invalid compression method"));
            }
            b = c << 4 | a;
            g[h++] = b;
            switch (a) {
                case Ea:
                    switch (this.h) {
                        case U.NONE:
                            f = 0;
                            break;
                        case U.r:
                            f = 1;
                            break;
                        case U.j:
                            f = 2;
                            break;
                        default: i(Error("unsupported compression type"));
                    }
                    break;
                default: i(Error("invalid compression method"));
            }
            e = f << 6 | 0;
            g[h++] = e | 31 - (256 * b + e) % 31;
            d = ba(this.input);
            this.z.b = h;
            g = this.z.n();
            h = g.length;
            H && (g = new Uint8Array(g.buffer), g.length <=
                h + 4 && (this.a = new Uint8Array(g.length + 4), this.a.set(g), g = this.a), g = g.subarray(0, h + 4));
            g[h++] = d >> 24 & 255;
            g[h++] = d >> 16 & 255;
            g[h++] = d >> 8 & 255;
            g[h++] = d & 255;
            return g;
        };
        y("Zlib.Deflate", Da);
        y("Zlib.Deflate.compress", function (a, c) { return (new Da(a, c)).n(); });
        y("Zlib.Deflate.CompressionType", U);
        y("Zlib.Deflate.CompressionType.NONE", U.NONE);
        y("Zlib.Deflate.CompressionType.FIXED", U.r);
        y("Zlib.Deflate.CompressionType.DYNAMIC", U.j);
        function V(a, c) { this.k = []; this.l = 32768; this.e = this.g = this.c = this.q = 0; this.input = H ? new Uint8Array(a) : a; this.s = !1; this.m = Fa; this.B = !1; if (c || !(c = {}))
            c.index && (this.c = c.index), c.bufferSize && (this.l = c.bufferSize), c.bufferType && (this.m = c.bufferType), c.resize && (this.B = c.resize); switch (this.m) {
            case Ga:
                this.b = 32768;
                this.a = new (H ? Uint8Array : Array)(32768 + this.l + 258);
                break;
            case Fa:
                this.b = 0;
                this.a = new (H ? Uint8Array : Array)(this.l);
                this.f = this.J;
                this.t = this.H;
                this.o = this.I;
                break;
            default: i(Error("invalid inflate mode"));
        } }
        var Ga = 0, Fa = 1, Ha = { D: Ga, C: Fa };
        V.prototype.p = function () {
            for (; !this.s;) {
                var a = X(this, 3);
                a & 1 && (this.s = v);
                a >>>= 1;
                switch (a) {
                    case 0:
                        var c = this.input, b = this.c, e = this.a, f = this.b, d = r, g = r, h = r, m = e.length, j = r;
                        this.e = this.g = 0;
                        d = c[b++];
                        d === r && i(Error("invalid uncompressed block header: LEN (first byte)"));
                        g = d;
                        d = c[b++];
                        d === r && i(Error("invalid uncompressed block header: LEN (second byte)"));
                        g |= d << 8;
                        d = c[b++];
                        d === r && i(Error("invalid uncompressed block header: NLEN (first byte)"));
                        h = d;
                        d = c[b++];
                        d === r && i(Error("invalid uncompressed block header: NLEN (second byte)"));
                        h |=
                            d << 8;
                        g === ~h && i(Error("invalid uncompressed block header: length verify"));
                        b + g > c.length && i(Error("input buffer is broken"));
                        switch (this.m) {
                            case Ga:
                                for (; f + g > e.length;) {
                                    j = m - f;
                                    g -= j;
                                    if (H)
                                        e.set(c.subarray(b, b + j), f), f += j, b += j;
                                    else
                                        for (; j--;)
                                            e[f++] = c[b++];
                                    this.b = f;
                                    e = this.f();
                                    f = this.b;
                                }
                                break;
                            case Fa:
                                for (; f + g > e.length;)
                                    e = this.f({ v: 2 });
                                break;
                            default: i(Error("invalid inflate mode"));
                        }
                        if (H)
                            e.set(c.subarray(b, b + g), f), f += g, b += g;
                        else
                            for (; g--;)
                                e[f++] = c[b++];
                        this.c = b;
                        this.b = f;
                        this.a = e;
                        break;
                    case 1:
                        this.o(Ia, Ja);
                        break;
                    case 2:
                        Ka(this);
                        break;
                    default: i(Error("unknown BTYPE: " + a));
                }
            }
            return this.t();
        };
        var La = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15], Za = H ? new Uint16Array(La) : La, $a = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258, 258, 258], ab = H ? new Uint16Array($a) : $a, bb = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0, 0, 0], cb = H ? new Uint8Array(bb) : bb, db = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577], eb = H ? new Uint16Array(db) : db, fb = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10,
            10, 11, 11, 12, 12, 13, 13], gb = H ? new Uint8Array(fb) : fb, hb = new (H ? Uint8Array : Array)(288), Y, ib;
        Y = 0;
        for (ib = hb.length; Y < ib; ++Y)
            hb[Y] = 143 >= Y ? 8 : 255 >= Y ? 9 : 279 >= Y ? 7 : 8;
        var Ia = S(hb), jb = new (H ? Uint8Array : Array)(30), kb, lb;
        kb = 0;
        for (lb = jb.length; kb < lb; ++kb)
            jb[kb] = 5;
        var Ja = S(jb);
        function X(a, c) { for (var b = a.g, e = a.e, f = a.input, d = a.c, g; e < c;)
            g = f[d++], g === r && i(Error("input buffer is broken")), b |= g << e, e += 8; g = b & (1 << c) - 1; a.g = b >>> c; a.e = e - c; a.c = d; return g; }
        function mb(a, c) { for (var b = a.g, e = a.e, f = a.input, d = a.c, g = c[0], h = c[1], m, j, s; e < h;)
            m = f[d++], m === r && i(Error("input buffer is broken")), b |= m << e, e += 8; j = g[b & (1 << h) - 1]; s = j >>> 16; a.g = b >> s; a.e = e - s; a.c = d; return j & 65535; }
        function Ka(a) { function c(a, b, c) { var d, e, f, g; for (g = 0; g < a;)
            switch (d = mb(this, b), d) {
                case 16:
                    for (f = 3 + X(this, 2); f--;)
                        c[g++] = e;
                    break;
                case 17:
                    for (f = 3 + X(this, 3); f--;)
                        c[g++] = 0;
                    e = 0;
                    break;
                case 18:
                    for (f = 11 + X(this, 7); f--;)
                        c[g++] = 0;
                    e = 0;
                    break;
                default: e = c[g++] = d;
            } return c; } var b = X(a, 5) + 257, e = X(a, 5) + 1, f = X(a, 4) + 4, d = new (H ? Uint8Array : Array)(Za.length), g, h, m, j; for (j = 0; j < f; ++j)
            d[Za[j]] = X(a, 3); g = S(d); h = new (H ? Uint8Array : Array)(b); m = new (H ? Uint8Array : Array)(e); a.o(S(c.call(a, b, g, h)), S(c.call(a, e, g, m))); }
        V.prototype.o = function (a, c) { var b = this.a, e = this.b; this.u = a; for (var f = b.length - 258, d, g, h, m; 256 !== (d = mb(this, a));)
            if (256 > d)
                e >= f && (this.b = e, b = this.f(), e = this.b), b[e++] = d;
            else {
                g = d - 257;
                m = ab[g];
                0 < cb[g] && (m += X(this, cb[g]));
                d = mb(this, c);
                h = eb[d];
                0 < gb[d] && (h += X(this, gb[d]));
                e >= f && (this.b = e, b = this.f(), e = this.b);
                for (; m--;)
                    b[e] = b[e++ - h];
            } for (; 8 <= this.e;)
            this.e -= 8, this.c--; this.b = e; };
        V.prototype.I = function (a, c) { var b = this.a, e = this.b; this.u = a; for (var f = b.length, d, g, h, m; 256 !== (d = mb(this, a));)
            if (256 > d)
                e >= f && (b = this.f(), f = b.length), b[e++] = d;
            else {
                g = d - 257;
                m = ab[g];
                0 < cb[g] && (m += X(this, cb[g]));
                d = mb(this, c);
                h = eb[d];
                0 < gb[d] && (h += X(this, gb[d]));
                e + m > f && (b = this.f(), f = b.length);
                for (; m--;)
                    b[e] = b[e++ - h];
            } for (; 8 <= this.e;)
            this.e -= 8, this.c--; this.b = e; };
        V.prototype.f = function () { var a = new (H ? Uint8Array : Array)(this.b - 32768), c = this.b - 32768, b, e, f = this.a; if (H)
            a.set(f.subarray(32768, a.length));
        else {
            b = 0;
            for (e = a.length; b < e; ++b)
                a[b] = f[b + 32768];
        } this.k.push(a); this.q += a.length; if (H)
            f.set(f.subarray(c, c + 32768));
        else
            for (b = 0; 32768 > b; ++b)
                f[b] = f[c + b]; this.b = 32768; return f; };
        V.prototype.J = function (a) { var c, b = this.input.length / this.c + 1 | 0, e, f, d, g = this.input, h = this.a; a && ("number" === typeof a.v && (b = a.v), "number" === typeof a.F && (b += a.F)); 2 > b ? (e = (g.length - this.c) / this.u[2], d = 258 * (e / 2) | 0, f = d < h.length ? h.length + d : h.length << 1) : f = h.length * b; H ? (c = new Uint8Array(f), c.set(h)) : c = h; return this.a = c; };
        V.prototype.t = function () { var a = 0, c = this.a, b = this.k, e, f = new (H ? Uint8Array : Array)(this.q + (this.b - 32768)), d, g, h, m; if (0 === b.length)
            return H ? this.a.subarray(32768, this.b) : this.a.slice(32768, this.b); d = 0; for (g = b.length; d < g; ++d) {
            e = b[d];
            h = 0;
            for (m = e.length; h < m; ++h)
                f[a++] = e[h];
        } d = 32768; for (g = this.b; d < g; ++d)
            f[a++] = c[d]; this.k = []; return this.buffer = f; };
        V.prototype.H = function () { var a, c = this.b; H ? this.B ? (a = new Uint8Array(c), a.set(this.a.subarray(0, c))) : a = this.a.subarray(0, c) : (this.a.length > c && (this.a.length = c), a = this.a); return this.buffer = a; };
        function nb(a, c) { var b, e; this.input = a; this.c = 0; if (c || !(c = {}))
            c.index && (this.c = c.index), c.verify && (this.M = c.verify); b = a[this.c++]; e = a[this.c++]; switch (b & 15) {
            case Ea:
                this.method = Ea;
                break;
            default: i(Error("unsupported compression method"));
        } 0 !== ((b << 8) + e) % 31 && i(Error("invalid fcheck flag:" + ((b << 8) + e) % 31)); e & 32 && i(Error("fdict flag is not supported")); this.A = new V(a, { index: this.c, bufferSize: c.bufferSize, bufferType: c.bufferType, resize: c.resize }); }
        nb.prototype.p = function () { var a = this.input, c, b; c = this.A.p(); this.c = this.A.c; this.M && (b = (a[this.c++] << 24 | a[this.c++] << 16 | a[this.c++] << 8 | a[this.c++]) >>> 0, b !== ba(c) && i(Error("invalid adler-32 checksum"))); return c; };
        y("Zlib.Inflate", nb);
        y("Zlib.Inflate.BufferType", Ha);
        Ha.ADAPTIVE = Ha.C;
        Ha.BLOCK = Ha.D;
        y("Zlib.Inflate.prototype.decompress", nb.prototype.p);
        var tb = new (H ? Uint8Array : Array)(288), Z, ub;
        Z = 0;
        for (ub = tb.length; Z < ub; ++Z)
            tb[Z] = 143 >= Z ? 8 : 255 >= Z ? 9 : 279 >= Z ? 7 : 8;
        S(tb);
        var vb = new (H ? Uint8Array : Array)(30), wb, xb;
        wb = 0;
        for (xb = vb.length; wb < xb; ++wb)
            vb[wb] = 5;
        S(vb);
        var Ea = 8;
    }).call(_zlibWindow);
    var _p = _zlibWindow.Zlib;
    _p.Deflate = _p["Deflate"];
    _p.Deflate.compress = _p.Deflate["compress"];
    _p.Inflate = _p["Inflate"];
    _p.Inflate.BufferType = _p.Inflate["BufferType"];
    _p.Inflate.prototype.decompress = _p.Inflate.prototype["decompress"];

    const DISPOSE_BACKGROUND$1 = 1;
    const DISPOSE_PREVIOUS$1 = 2;
    const BLEND_SOURCE = 0;
    const COLOR_GRAYSCALE = 0;
    const COLOR_RGB = 2;
    const COLOR_INDEXED = 3;
    const COLOR_GRAYSCALE_ALPHA = 4;
    const COLOR_RGBA = 6;
    class ApngDecoder {
        constructor(ihdr, rawFrames, palette, transparency, loopCount) {
            this._decodedUpTo = -1;
            this.width = ihdr.width;
            this.height = ihdr.height;
            this.frameCount = rawFrames.length;
            this.loopCount = loopCount;
            this._ihdr = ihdr;
            this._rawFrames = rawFrames;
            this._palette = palette;
            this._transparency = transparency;
            this._frames = new Array(rawFrames.length);
            this._state = { canvas: new Uint8Array(ihdr.width * ihdr.height * 4), previousCanvas: null };
        }
        decodeFrame(index) {
            if (index < 0 || index >= this._frames.length) {
                return Promise.reject(new Error(`frame index ${index} out of range [0, ${this._frames.length})`));
            }
            if (this._frames[index] !== undefined) {
                return Promise.resolve(this._frames[index]);
            }
            // Composite frames strictly in order; later frames reuse the canvas state.
            for (let f = this._decodedUpTo + 1; f <= index; f++) {
                const raw = this._rawFrames[f];
                this._frames[f] = compositeOneFrame(this._state, raw.fcTL, raw.data, this.width, this.height, this._ihdr, this._palette, this._transparency);
            }
            this._decodedUpTo = index;
            return Promise.resolve(this._frames[index]);
        }
        destroy() {
            this._frames = [];
            this._rawFrames = [];
        }
    }
    function createApngDecoder(bytes) {
        const parsed = parsePng(bytes);
        return new ApngDecoder(parsed.ihdr, parsed.rawFrames, parsed.palette, parsed.transparency, parsed.loopCount);
    }
    function parsePng(data) {
        let pos = 8;
        let ihdr = null;
        let loopCount = 0;
        let palette = null;
        let transparency = null;
        const rawFrames = [];
        let currentFcTL = null;
        let currentDataChunks = [];
        let idatChunks = [];
        let seenFcTLBeforeIDAT = false;
        while (pos + 8 <= data.length) {
            const chunkLen = readU32(data, pos);
            const chunkType = readChunkType(data, pos + 4);
            const chunkDataStart = pos + 8;
            switch (chunkType) {
                case 'IHDR':
                    ihdr = {
                        width: readU32(data, chunkDataStart),
                        height: readU32(data, chunkDataStart + 4),
                        bitDepth: data[chunkDataStart + 8],
                        colorType: data[chunkDataStart + 9],
                    };
                    break;
                case 'acTL':
                    loopCount = readU32(data, chunkDataStart + 4);
                    break;
                case 'fcTL': {
                    if (currentFcTL && currentDataChunks.length > 0) {
                        rawFrames.push({ fcTL: currentFcTL, data: concatBytes(currentDataChunks) });
                        currentDataChunks = [];
                    }
                    const off = chunkDataStart + 4;
                    currentFcTL = {
                        width: readU32(data, off),
                        height: readU32(data, off + 4),
                        xOffset: readU32(data, off + 8),
                        yOffset: readU32(data, off + 12),
                        delayNum: readU16(data, off + 16),
                        delayDen: readU16(data, off + 18),
                        disposeOp: data[off + 20],
                        blendOp: data[off + 21],
                    };
                    if (idatChunks.length === 0) {
                        seenFcTLBeforeIDAT = true;
                    }
                    break;
                }
                case 'IDAT':
                    idatChunks.push(data.subarray(chunkDataStart, chunkDataStart + chunkLen));
                    if (seenFcTLBeforeIDAT) {
                        currentDataChunks.push(data.subarray(chunkDataStart, chunkDataStart + chunkLen));
                    }
                    break;
                case 'fdAT':
                    currentDataChunks.push(data.subarray(chunkDataStart + 4, chunkDataStart + chunkLen));
                    break;
                case 'PLTE':
                    palette = new Uint8Array(data.subarray(chunkDataStart, chunkDataStart + chunkLen));
                    break;
                case 'tRNS':
                    transparency = new Uint8Array(data.subarray(chunkDataStart, chunkDataStart + chunkLen));
                    break;
                case 'IEND':
                    if (currentFcTL && currentDataChunks.length > 0) {
                        rawFrames.push({ fcTL: currentFcTL, data: concatBytes(currentDataChunks) });
                    }
                    break;
            }
            pos += 12 + chunkLen;
        }
        if (!ihdr) {
            throw new Error('APNG: missing IHDR chunk');
        }
        return { ihdr, loopCount, rawFrames, palette, transparency };
    }
    function inflateData(compressed) {
        const inflate = new _p.Inflate(compressed, { index: 0, verify: false });
        return inflate.decompress();
    }
    function decodePixels(compressed, width, height, ihdr, palette, transparency) {
        const raw = inflateData(compressed);
        const bpp = bytesPerPixel(ihdr);
        const scanlineBytes = width * bpp;
        const filtered = new Uint8Array(scanlineBytes * height);
        let srcPos = 0;
        let dstPos = 0;
        for (let row = 0; row < height; row++) {
            const filter = raw[srcPos++];
            for (let i = 0; i < scanlineBytes; i++) {
                const curByte = raw[srcPos++];
                const left = i < bpp ? 0 : filtered[dstPos - bpp];
                const up = row === 0 ? 0 : filtered[dstPos - scanlineBytes];
                const upLeft = (row === 0 || i < bpp) ? 0 : filtered[dstPos - scanlineBytes - bpp];
                switch (filter) {
                    case 0:
                        filtered[dstPos] = curByte;
                        break;
                    case 1:
                        filtered[dstPos] = (curByte + left) & 0xFF;
                        break;
                    case 2:
                        filtered[dstPos] = (curByte + up) & 0xFF;
                        break;
                    case 3:
                        filtered[dstPos] = (curByte + ((left + up) >>> 1)) & 0xFF;
                        break;
                    case 4:
                        filtered[dstPos] = (curByte + paethPredictor(left, up, upLeft)) & 0xFF;
                        break;
                }
                dstPos++;
            }
        }
        return toRGBA(filtered, width, height, ihdr, palette, transparency);
    }
    function bytesPerPixel(ihdr) {
        switch (ihdr.colorType) {
            case COLOR_GRAYSCALE: return Math.max(1, ihdr.bitDepth / 8);
            case COLOR_RGB: return 3 * (ihdr.bitDepth / 8);
            case COLOR_INDEXED: return 1;
            case COLOR_GRAYSCALE_ALPHA: return 2 * (ihdr.bitDepth / 8);
            case COLOR_RGBA: return 4 * (ihdr.bitDepth / 8);
            default: return 4;
        }
    }
    function paethPredictor(a, b, c) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        if (pa <= pb && pa <= pc)
            return a;
        if (pb <= pc)
            return b;
        return c;
    }
    function toRGBA(pixels, width, height, ihdr, palette, transparency) {
        const total = width * height;
        const rgba = new Uint8Array(total * 4);
        switch (ihdr.colorType) {
            case COLOR_GRAYSCALE: {
                const transGray = transparency && transparency.length >= 2
                    ? ((transparency[0] << 8) | transparency[1]) : -1;
                for (let i = 0; i < total; i++) {
                    const v = pixels[i];
                    rgba[i * 4] = v;
                    rgba[i * 4 + 1] = v;
                    rgba[i * 4 + 2] = v;
                    rgba[i * 4 + 3] = v === transGray ? 0 : 255;
                }
                break;
            }
            case COLOR_RGB: {
                let transR = -1;
                let transG = -1;
                let transB = -1;
                if (transparency && transparency.length >= 6) {
                    transR = (transparency[0] << 8) | transparency[1];
                    transG = (transparency[2] << 8) | transparency[3];
                    transB = (transparency[4] << 8) | transparency[5];
                }
                for (let i = 0; i < total; i++) {
                    const r = pixels[i * 3];
                    const g = pixels[i * 3 + 1];
                    const b = pixels[i * 3 + 2];
                    rgba[i * 4] = r;
                    rgba[i * 4 + 1] = g;
                    rgba[i * 4 + 2] = b;
                    rgba[i * 4 + 3] = (r === transR && g === transG && b === transB) ? 0 : 255;
                }
                break;
            }
            case COLOR_INDEXED: {
                if (!palette) {
                    throw new Error('APNG: indexed color but no PLTE chunk');
                }
                for (let i = 0; i < total; i++) {
                    const idx = pixels[i];
                    rgba[i * 4] = palette[idx * 3];
                    rgba[i * 4 + 1] = palette[idx * 3 + 1];
                    rgba[i * 4 + 2] = palette[idx * 3 + 2];
                    rgba[i * 4 + 3] = (transparency && idx < transparency.length) ? transparency[idx] : 255;
                }
                break;
            }
            case COLOR_GRAYSCALE_ALPHA:
                for (let i = 0; i < total; i++) {
                    const v = pixels[i * 2];
                    rgba[i * 4] = v;
                    rgba[i * 4 + 1] = v;
                    rgba[i * 4 + 2] = v;
                    rgba[i * 4 + 3] = pixels[i * 2 + 1];
                }
                break;
            case COLOR_RGBA:
                rgba.set(pixels);
                break;
        }
        return rgba;
    }
    function compositeOneFrame(state, fcTL, data, canvasWidth, canvasHeight, ihdr, palette, transparency) {
        const canvas = state.canvas;
        if (fcTL.disposeOp === DISPOSE_PREVIOUS$1) {
            state.previousCanvas = new Uint8Array(canvas);
        }
        const framePixels = decodePixels(data, fcTL.width, fcTL.height, ihdr, palette, transparency);
        // Per APNG spec, blend_op is honored even for full-canvas frames; forcing
        // SOURCE on full-canvas OVER frames corrupts semi-transparent frames.
        const blendOp = fcTL.blendOp;
        for (let y = 0; y < fcTL.height; y++) {
            for (let x = 0; x < fcTL.width; x++) {
                const cx = fcTL.xOffset + x;
                const cy = fcTL.yOffset + y;
                if (cx >= canvasWidth || cy >= canvasHeight)
                    continue;
                const srcIdx = (y * fcTL.width + x) * 4;
                const dstIdx = (cy * canvasWidth + cx) * 4;
                if (blendOp === BLEND_SOURCE) {
                    canvas[dstIdx] = framePixels[srcIdx];
                    canvas[dstIdx + 1] = framePixels[srcIdx + 1];
                    canvas[dstIdx + 2] = framePixels[srcIdx + 2];
                    canvas[dstIdx + 3] = framePixels[srcIdx + 3];
                }
                else {
                    const srcA = framePixels[srcIdx + 3];
                    if (srcA === 255) {
                        canvas[dstIdx] = framePixels[srcIdx];
                        canvas[dstIdx + 1] = framePixels[srcIdx + 1];
                        canvas[dstIdx + 2] = framePixels[srcIdx + 2];
                        canvas[dstIdx + 3] = 255;
                    }
                    else if (srcA > 0) {
                        const dstA = canvas[dstIdx + 3];
                        const outA = srcA + dstA * (255 - srcA) / 255;
                        if (outA > 0) {
                            canvas[dstIdx] = (framePixels[srcIdx] * srcA + canvas[dstIdx] * dstA * (255 - srcA) / 255) / outA;
                            canvas[dstIdx + 1] = (framePixels[srcIdx + 1] * srcA + canvas[dstIdx + 1] * dstA * (255 - srcA) / 255) / outA;
                            canvas[dstIdx + 2] = (framePixels[srcIdx + 2] * srcA + canvas[dstIdx + 2] * dstA * (255 - srcA) / 255) / outA;
                            canvas[dstIdx + 3] = outA;
                        }
                    }
                }
            }
        }
        const delayDen = fcTL.delayDen || 100;
        const duration = (fcTL.delayNum * 1000) / delayDen;
        const frame = {
            data: new Uint8Array(canvas),
            duration: duration || 100,
        };
        switch (fcTL.disposeOp) {
            case DISPOSE_BACKGROUND$1:
                for (let y = 0; y < fcTL.height; y++) {
                    for (let x = 0; x < fcTL.width; x++) {
                        const cx = fcTL.xOffset + x;
                        const cy = fcTL.yOffset + y;
                        if (cx >= canvasWidth || cy >= canvasHeight)
                            continue;
                        const dstIdx = (cy * canvasWidth + cx) * 4;
                        canvas[dstIdx] = 0;
                        canvas[dstIdx + 1] = 0;
                        canvas[dstIdx + 2] = 0;
                        canvas[dstIdx + 3] = 0;
                    }
                }
                break;
            case DISPOSE_PREVIOUS$1:
                if (state.previousCanvas) {
                    canvas.set(state.previousCanvas);
                }
                break;
        }
        return frame;
    }
    function readU32(data, offset) {
        return ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
    }
    function readU16(data, offset) {
        return (data[offset] << 8) | data[offset + 1];
    }
    function readChunkType(data, offset) {
        return String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
    }
    function concatBytes(chunks) {
        let totalLen = 0;
        for (let i = 0; i < chunks.length; i++) {
            totalLen += chunks[i].length;
        }
        const result = new Uint8Array(totalLen);
        let offset = 0;
        for (let i = 0; i < chunks.length; i++) {
            result.set(chunks[i], offset);
            offset += chunks[i].length;
        }
        return result;
    }

    const DISPOSE_BACKGROUND = 2;
    const DISPOSE_PREVIOUS = 3;
    class GifDecoder {
        constructor(width, height, loopCount, frames, globalColorTable) {
            this._decodedUpTo = -1;
            this.width = width;
            this.height = height;
            this.frameCount = frames.length;
            this.loopCount = loopCount;
            this._frames = frames;
            this._globalColorTable = globalColorTable;
            this._results = new Array(frames.length);
            this._state = { canvas: new Uint8Array(width * height * 4), previousCanvas: null };
        }
        decodeFrame(index) {
            if (index < 0 || index >= this._results.length) {
                return Promise.reject(new Error(`frame index ${index} out of range [0, ${this._results.length})`));
            }
            if (this._results[index] !== undefined) {
                return Promise.resolve(this._results[index]);
            }
            // Composite frames strictly in order; later frames reuse the canvas state.
            for (let f = this._decodedUpTo + 1; f <= index; f++) {
                this._results[f] = compositeOneGifFrame(this._state, this._frames[f], this.width, this.height, this._globalColorTable);
            }
            this._decodedUpTo = index;
            return Promise.resolve(this._results[index]);
        }
        destroy() {
            this._results = [];
            this._frames = [];
        }
    }
    function createGifDecoder(bytes) {
        const parser = new GifParser(bytes);
        parser.parse();
        return new GifDecoder(parser.width, parser.height, parser.loopCount, parser.frames, parser.globalColorTable);
    }
    class GifParser {
        constructor(data) {
            this.width = 0;
            this.height = 0;
            this.loopCount = 0;
            this.globalColorTable = null;
            this.bgColorIndex = 0;
            this.frames = [];
            this._pos = 0;
            this._gceDisposal = 0;
            this._gceTransparent = -1;
            this._gceDelay = 0;
            this._data = data;
        }
        parse() {
            this._parseHeader();
            this._parseLogicalScreenDescriptor();
            this._parseBlocks();
        }
        _parseHeader() {
            this._pos = 6;
        }
        _parseLogicalScreenDescriptor() {
            this.width = this._readU16();
            this.height = this._readU16();
            const packed = this._data[this._pos++];
            this.bgColorIndex = this._data[this._pos++];
            this._pos++;
            const hasGCT = (packed & 0x80) !== 0;
            const gctSize = 1 << ((packed & 0x07) + 1);
            if (hasGCT) {
                this.globalColorTable = this._readBytes(gctSize * 3);
            }
        }
        _parseBlocks() {
            const data = this._data;
            while (this._pos < data.length) {
                const introducer = data[this._pos++];
                switch (introducer) {
                    case 0x2C:
                        this._parseImageDescriptor();
                        break;
                    case 0x21:
                        this._parseExtension();
                        break;
                    case 0x3B:
                        return;
                    default:
                        return;
                }
            }
        }
        _parseExtension() {
            const label = this._data[this._pos++];
            switch (label) {
                case 0xF9:
                    this._parseGCE();
                    break;
                case 0xFF:
                    this._parseApplicationExtension();
                    break;
                default:
                    this._skipSubBlocks();
                    break;
            }
        }
        _parseGCE() {
            this._pos++;
            const packed = this._data[this._pos++];
            this._gceDisposal = (packed >>> 2) & 0x07;
            const hasTransparency = (packed & 0x01) !== 0;
            this._gceDelay = this._readU16() * 10;
            const transparentIndex = this._data[this._pos++];
            this._gceTransparent = hasTransparency ? transparentIndex : -1;
            this._pos++;
        }
        _parseApplicationExtension() {
            const blockSize = this._data[this._pos++];
            if (blockSize === 11) {
                const id = String.fromCharCode(this._data[this._pos], this._data[this._pos + 1], this._data[this._pos + 2], this._data[this._pos + 3], this._data[this._pos + 4], this._data[this._pos + 5], this._data[this._pos + 6], this._data[this._pos + 7], this._data[this._pos + 8], this._data[this._pos + 9], this._data[this._pos + 10]);
                this._pos += 11;
                if (id === 'NETSCAPE2.0') {
                    const subBlockSize = this._data[this._pos++];
                    if (subBlockSize === 3 && this._data[this._pos] === 1) {
                        this._pos++;
                        this.loopCount = this._readU16();
                        this._pos++;
                        return;
                    }
                    this._pos--;
                }
            }
            else {
                this._pos += blockSize;
            }
            this._skipSubBlocks();
        }
        _parseImageDescriptor() {
            const left = this._readU16();
            const top = this._readU16();
            const width = this._readU16();
            const height = this._readU16();
            const packed = this._data[this._pos++];
            const hasLocalCT = (packed & 0x80) !== 0;
            const interlaced = (packed & 0x40) !== 0;
            const lctSize = 1 << ((packed & 0x07) + 1);
            let localColorTable = null;
            if (hasLocalCT) {
                localColorTable = this._readBytes(lctSize * 3);
            }
            const lzwMinCodeSize = this._data[this._pos++];
            const dataBlocks = this._collectSubBlocks();
            const frame = {
                left,
                top,
                width,
                height,
                localColorTable,
                interlaced,
                disposalMethod: this._gceDisposal,
                transparentIndex: this._gceTransparent,
                delay: this._gceDelay || 100,
                lzwMinCodeSize,
                dataBlocks,
            };
            this.frames.push(frame);
            this._gceDisposal = 0;
            this._gceTransparent = -1;
            this._gceDelay = 0;
        }
        _collectSubBlocks() {
            const blocks = [];
            while (true) {
                const size = this._data[this._pos++];
                if (size === 0)
                    break;
                blocks.push(this._data.subarray(this._pos, this._pos + size));
                this._pos += size;
            }
            return blocks;
        }
        _skipSubBlocks() {
            while (true) {
                const size = this._data[this._pos++];
                if (size === 0)
                    break;
                this._pos += size;
            }
        }
        _readU16() {
            const val = this._data[this._pos] | (this._data[this._pos + 1] << 8);
            this._pos += 2;
            return val;
        }
        _readBytes(count) {
            const result = new Uint8Array(count);
            result.set(this._data.subarray(this._pos, this._pos + count));
            this._pos += count;
            return result;
        }
    }
    function lzwDecode(minCodeSize, blocks, pixelCount) {
        const clearCode = 1 << minCodeSize;
        const eoiCode = clearCode + 1;
        const maxTableSize = 4096;
        let codeSize = minCodeSize + 1;
        let codeMask = (1 << codeSize) - 1;
        let nextCode = eoiCode + 1;
        // Flatten sub-blocks into a single buffer for faster bit reading.
        let totalLen = 0;
        for (let i = 0; i < blocks.length; i++) {
            totalLen += blocks[i].length;
        }
        const flat = new Uint8Array(totalLen);
        let fo = 0;
        for (let i = 0; i < blocks.length; i++) {
            flat.set(blocks[i], fo);
            fo += blocks[i].length;
        }
        const flatLen = flat.length;
        // Prefix/suffix table: O(1) dictionary insertion (no per-entry array copies).
        const prefix = new Int32Array(maxTableSize);
        const suffix = new Uint8Array(maxTableSize);
        const first = new Uint8Array(maxTableSize);
        for (let i = 0; i < clearCode; i++) {
            prefix[i] = -1;
            suffix[i] = i;
            first[i] = i;
        }
        const output = new Uint8Array(pixelCount);
        const stack = new Uint8Array(maxTableSize);
        let outPos = 0;
        let bytePos = 0;
        let bitBuf = 0;
        let bitsAvail = 0;
        function readCode() {
            while (bitsAvail < codeSize) {
                if (bytePos < flatLen) {
                    bitBuf |= flat[bytePos++] << bitsAvail;
                    bitsAvail += 8;
                }
                else {
                    return eoiCode;
                }
            }
            const code = bitBuf & codeMask;
            bitBuf >>>= codeSize;
            bitsAvail -= codeSize;
            return code;
        }
        function resetTable() {
            codeSize = minCodeSize + 1;
            codeMask = (1 << codeSize) - 1;
            nextCode = eoiCode + 1;
        }
        // Reconstruct the string for `code` by walking the prefix chain onto a stack,
        // then popping it in order. `tail` (optional) appends one extra byte at the end
        // and is used for the KwKwK case (code === nextCode).
        function emit(code, tail = -1) {
            let sp = 0;
            if (tail >= 0) {
                stack[sp++] = tail;
            }
            let cur = code;
            while (cur >= 0 && prefix[cur] >= 0) {
                stack[sp++] = suffix[cur];
                cur = prefix[cur];
            }
            if (cur >= 0) {
                stack[sp++] = suffix[cur];
            }
            while (sp > 0 && outPos < pixelCount) {
                output[outPos++] = stack[--sp];
            }
        }
        let code = readCode();
        if (code === clearCode) {
            resetTable();
            code = readCode();
        }
        if (code === eoiCode || code >= nextCode) {
            return output;
        }
        let prev = code;
        emit(code);
        while (outPos < pixelCount) {
            code = readCode();
            if (code === eoiCode)
                break;
            if (code === clearCode) {
                resetTable();
                code = readCode();
                if (code === eoiCode)
                    break;
                prev = code;
                emit(code);
                continue;
            }
            let entryCode;
            let firstChar;
            if (code < nextCode) {
                entryCode = code;
                firstChar = first[code];
                emit(code);
            }
            else if (code === nextCode) {
                entryCode = code;
                firstChar = first[prev];
                emit(prev, first[prev]);
            }
            else {
                break;
            }
            if (nextCode < maxTableSize) {
                prefix[nextCode] = prev;
                suffix[nextCode] = firstChar;
                first[nextCode] = first[prev];
                nextCode++;
                if (nextCode > codeMask && codeSize < 12) {
                    codeSize++;
                    codeMask = (1 << codeSize) - 1;
                }
            }
            prev = entryCode;
        }
        return output;
    }
    function deinterlace(pixels, width, height) {
        const result = new Uint8Array(pixels.length);
        const offsets = [0, 4, 2, 1];
        const steps = [8, 8, 4, 2];
        let srcRow = 0;
        for (let pass = 0; pass < 4; pass++) {
            for (let y = offsets[pass]; y < height; y += steps[pass]) {
                const srcOff = srcRow * width;
                const dstOff = y * width;
                result.set(pixels.subarray(srcOff, srcOff + width), dstOff);
                srcRow++;
            }
        }
        return result;
    }
    function compositeOneGifFrame(state, frame, canvasWidth, canvasHeight, globalColorTable) {
        const canvas = state.canvas;
        if (frame.disposalMethod === DISPOSE_PREVIOUS) {
            state.previousCanvas = new Uint8Array(canvas);
        }
        const colorTable = frame.localColorTable || globalColorTable;
        if (!colorTable) {
            throw new Error('GIF frame has no color table');
        }
        let indexedPixels = lzwDecode(frame.lzwMinCodeSize, frame.dataBlocks, frame.width * frame.height);
        if (frame.interlaced) {
            indexedPixels = deinterlace(indexedPixels, frame.width, frame.height);
        }
        // 预计算 调色板 → 打包 RGBA（Uint32 小端 0xRRGGBBAA），合成用单次 4 字节写入
        const tableSize = colorTable.length / 3;
        const table32 = new Uint32Array(256);
        for (let i = 0; i < tableSize; i++) {
            const r = colorTable[i * 3];
            const g = colorTable[i * 3 + 1];
            const b = colorTable[i * 3 + 2];
            const a = (i === frame.transparentIndex) ? 0 : 255;
            table32[i] = r | (g << 8) | (b << 16) | (a << 24);
        }
        const canvas32 = new Uint32Array(canvas.buffer, canvas.byteOffset, canvas.byteLength >> 2);
        const trans = frame.transparentIndex;
        const isFullCanvas = frame.left === 0 && frame.top === 0
            && frame.width === canvasWidth && frame.height === canvasHeight;
        if (isFullCanvas) {
            const n = frame.width * frame.height;
            if (trans < 0) {
                for (let p = 0; p < n; p++) {
                    canvas32[p] = table32[indexedPixels[p]];
                }
            }
            else {
                for (let p = 0; p < n; p++) {
                    const c = indexedPixels[p];
                    if (c !== trans) {
                        canvas32[p] = table32[c];
                    }
                }
            }
        }
        else {
            for (let y = 0; y < frame.height; y++) {
                for (let x = 0; x < frame.width; x++) {
                    const c = indexedPixels[y * frame.width + x];
                    if (c === trans)
                        continue;
                    const cx = frame.left + x;
                    const cy = frame.top + y;
                    if (cx >= canvasWidth || cy >= canvasHeight)
                        continue;
                    canvas32[cy * canvasWidth + cx] = table32[c];
                }
            }
        }
        const frameData = {
            data: new Uint8Array(canvas),
            duration: frame.delay,
        };
        switch (frame.disposalMethod) {
            case DISPOSE_BACKGROUND:
                for (let y = 0; y < frame.height; y++) {
                    for (let x = 0; x < frame.width; x++) {
                        const cx = frame.left + x;
                        const cy = frame.top + y;
                        if (cx >= canvasWidth || cy >= canvasHeight)
                            continue;
                        const dstIdx = (cy * canvasWidth + cx) * 4;
                        canvas[dstIdx] = 0;
                        canvas[dstIdx + 1] = 0;
                        canvas[dstIdx + 2] = 0;
                        canvas[dstIdx + 3] = 0;
                    }
                }
                break;
            case DISPOSE_PREVIOUS:
                if (state.previousCanvas) {
                    canvas.set(state.previousCanvas);
                }
                break;
        }
        return frameData;
    }

    // overlay 合成器（worker 侧）—— worker-offscreen 变体的渲染后端。
    //
    // 被 decoder-worker.ts 引用（rollup 自动并入 bundle），**零顶层副作用**：模块加载只有
    // 函数与类型定义，所有状态都在 createOverlayCompositor() 的闭包里，而工厂本身也要等到
    // 主线程第一条 overlay-canvas 请求到达才被调用；宿主能力探测（requestAnimationFrame /
    // setTimeout / createImageBitmap / ImageData / OffscreenCanvas / performance.now）全部
    // 推迟到 bind/绘制内部 —— 未启用变体时这个文件对既有四档解码路径的行为零影响。
    //
    // 职责：持有 transfer 过线的 OffscreenCanvas，自驱时钟推进每个动图的帧号（推进语义与
    // runtime/AnimatedImagePlayer.tick 同构：时长未知先解码学时长、单飞解码、guard 防零时长
    // 死循环、非循环播完停末帧），按需解码 + ImageData → createImageBitmap 位图化（全缓存
    // 不淘汰，对齐 copy 档主线程帧缓存口径），脏检测后整帧 clearRect + 全员 drawImage。
    // 主线程每帧成本归零：没有每帧 postMessage、没有纹理上传，动图不进引擎渲染。
    //
    // worker 上下文没有 DOM lib：宿主全局一律 globalThis 探测 + 下列结构化最小类型。
    function nowMs() {
        const perf = globalThis.performance;
        return typeof (perf === null || perf === void 0 ? void 0 : perf.now) === 'function' ? perf.now() : Date.now();
    }
    /** 像素 → 位图源。首选 ImageData → createImageBitmap（GPU 位图）；缺任一则临时
     *  OffscreenCanvas putImageData 后持 canvas 当位图源；全缺则拒绝（条目记一次错误）。 */
    function bitmapFromPixels(data, width, height) {
        const g = globalThis;
        const clamped = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
        if (typeof g.ImageData === 'function' && typeof g.createImageBitmap === 'function') {
            return g.createImageBitmap(new g.ImageData(clamped, width, height));
        }
        if (typeof g.OffscreenCanvas === 'function') {
            const tmp = new g.OffscreenCanvas(width, height);
            const ctx = tmp.getContext('2d');
            const make = () => {
                if (typeof g.ImageData === 'function') {
                    return new g.ImageData(clamped, width, height);
                }
                if (ctx && typeof ctx.createImageData === 'function') {
                    const img = ctx.createImageData(width, height);
                    img.data.set(clamped);
                    return img;
                }
                return null;
            };
            const img = ctx ? make() : null;
            if (ctx && img) {
                ctx.putImageData(img, 0, 0);
                return Promise.resolve(tmp);
            }
        }
        return Promise.reject(new Error('worker 里没有 ImageData/createImageBitmap/OffscreenCanvas 任一可用的位图化途径'));
    }
    function createOverlayCompositor() {
        // 全部状态闭包持有：模块顶层零副作用，工厂调用前一行合成代码都不执行。
        let bound = false;
        let surface = null;
        let ctx = null;
        let width = 1;
        let height = 1;
        let ticker = 'raf';
        let notify = null;
        const items = new Map();
        let running = false;
        let lastTs = -1;
        let forceDirty = false;
        // stats 累积器：每 ~500ms 一条 overlay-stats；零帧窗口（三者全 0）不推。
        let statFrames = 0;
        let statDecodeMs = [];
        let statCompositeMs = 0;
        let statErrors = 0;
        let lastEmitMs = 0;
        const host = () => globalThis;
        function needsClock() {
            if (forceDirty) {
                return true;
            }
            for (const item of items.values()) {
                if (item.playing && item.decoder.frameCount > 1) {
                    return true;
                }
                if (item.lastDrawn !== item.currentFrame) {
                    return true;
                }
            }
            return false;
        }
        function scheduleNext() {
            const g = host();
            if (ticker === 'raf' && typeof g.requestAnimationFrame === 'function') {
                g.requestAnimationFrame((ts) => { tick(ts); });
            }
            else if (typeof g.setTimeout === 'function') {
                g.setTimeout(() => { tick(nowMs()); }, Math.max(4, Math.round(1000 / 60)));
            }
            else {
                running = false;
            }
        }
        function startClock() {
            if (!bound || running || !needsClock()) {
                return;
            }
            running = true;
            lastTs = -1; // 重启后首拍 dt=0（上次停钟距今的空窗不计入帧时长）
            scheduleNext();
        }
        function emitStats() {
            if (!notify) {
                return;
            }
            if (statFrames === 0 && statDecodeMs.length === 0 && statErrors === 0) {
                lastEmitMs = nowMs();
                return;
            }
            const framesByHandle = {};
            for (const item of items.values()) {
                framesByHandle[item.handle] = item.currentFrame;
            }
            notify({
                t: 'overlay-stats',
                frames: statFrames,
                decodeMs: statDecodeMs,
                compositeMs: statCompositeMs,
                errors: statErrors,
                framesByHandle,
            });
            statFrames = 0;
            statDecodeMs = [];
            statCompositeMs = 0;
            statErrors = 0;
            lastEmitMs = nowMs();
        }
        /** 帧号推进 —— 与 AnimatedImagePlayer.tick(L184-214) 同构。 */
        function advance(item, dtMs) {
            const frameCount = item.decoder.frameCount;
            if (frameCount <= 1) {
                return;
            }
            item.accumMs += dtMs;
            let guard = frameCount;
            while (guard-- > 0) {
                const frameDur = item.durations[item.currentFrame];
                if (frameDur < 0) {
                    // 时长未知：先解码学时长，下个 tick 再推。
                    ensureFrame(item, item.currentFrame);
                    return;
                }
                if (item.accumMs < frameDur) {
                    return;
                }
                item.accumMs -= frameDur;
                const next = item.currentFrame + 1;
                if (next >= frameCount) {
                    if (item.loop) {
                        item.currentFrame = 0;
                    }
                    else {
                        item.currentFrame = frameCount - 1;
                        item.playing = false;
                        return;
                    }
                }
                else {
                    item.currentFrame = next;
                }
                ensureFrame(item, item.currentFrame);
            }
        }
        /** 全量重画：清屏 + 按各条目当前帧位图上屏（未就绪者跳过）。tick 的脏路径与
         *  解码完成路径共用 —— 后者是关键：Player 语义是「解码完成且仍为当前帧就立刻上屏」，
         *  不能等下一拍（下一拍帧号往往已推进，当前帧位图永远来不及就绪 → 一张都画不上）。 */
        function presentAll() {
            const t0 = nowMs();
            ctx.clearRect(0, 0, width, height); // 透明清屏（动图可能移动/移除，不能留残影）
            for (const item of items.values()) {
                const bitmap = item.bitmaps.get(item.currentFrame);
                if (!bitmap) {
                    continue;
                }
                ctx.drawImage(bitmap, item.rect.x, item.rect.y, item.rect.w, item.rect.h);
                item.lastDrawn = item.currentFrame;
                statFrames++;
            }
            forceDirty = false;
            statCompositeMs += nowMs() - t0;
        }
        function ensureFrame(item, index) {
            if (item.bitmaps.has(index) || item.pending !== null) {
                return;
            }
            if (index < 0 || index >= item.decoder.frameCount) {
                return;
            }
            item.pending = index;
            const t0 = nowMs();
            item.decoder.decodeFrame(index).then((frame) => bitmapFromPixels(frame.data, item.decoder.width, item.decoder.height)
                .then((bitmap) => ({ bitmap, duration: frame.duration }))).then(({ bitmap, duration }) => {
                // decodeMs 口径：decodeFrame → ImageData → createImageBitmap 的 worker 侧墙钟
                //（offscreen 档 taskMs = 解码+位图化，见 tools/PERF.md；copy 档的 computeMs
                // 只含解码 —— 两侧绝对值不可直接比，主线程扇出时再加 compositeMs/frames 摊销）。
                statDecodeMs.push(nowMs() - t0);
                item.pending = null;
                if (items.get(item.handle) !== item) {
                    return;
                } // 解码期间已 detach
                if (item.durations[index] < 0) {
                    item.durations[index] = duration;
                }
                item.bitmaps.set(index, bitmap);
                if (index === item.currentFrame) {
                    presentAll();
                } // 同 Player：解码完成即上屏
                startClock(); // 时钟可能需要重启（暂停态首帧解码完成即上屏后自然停钟）
            })
                .catch(() => {
                item.pending = null;
                statErrors++;
                item.consecutiveErrors++;
                if (item.consecutiveErrors >= 8) {
                    // 连续 8 次失败：坏条目，移除后其余照跑（lastDrawn !== currentFrame 的
                    // 重试需求随之消失，避免坏条目把时钟拖成无限重试）。
                    items.delete(item.handle);
                    forceDirty = true;
                }
                startClock(); // 未达移除阈值靠时钟重试（lastDrawn !== currentFrame 保持时钟需求）
            });
        }
        function tick(ts) {
            if (!running) {
                return;
            } // 停钟后残余的回调直接作废
            const dtMs = lastTs < 0 ? 0 : Math.min(250, ts - lastTs);
            lastTs = ts;
            for (const item of items.values()) {
                if (item.playing && item.decoder.frameCount > 1) {
                    advance(item, dtMs);
                }
                ensureFrame(item, item.currentFrame);
            }
            // 脏检测：任意条目「当前帧 ≠ 已画帧 且位图就绪」，或全局强制（resize/update/detach）。
            let dirty = forceDirty;
            if (!dirty) {
                for (const item of items.values()) {
                    if (item.lastDrawn !== item.currentFrame && item.bitmaps.has(item.currentFrame)) {
                        dirty = true;
                        break;
                    }
                }
            }
            if (dirty) {
                presentAll();
            }
            if (nowMs() - lastEmitMs >= 500) {
                emitStats();
            }
            if (!needsClock()) {
                // 全暂停/全空：停钟并冲刷最后一条 stats（有内容才发）。
                running = false;
                lastTs = -1;
                emitStats();
                return;
            }
            scheduleNext();
        }
        return {
            bind(canvas, w, h, sink) {
                if (bound) {
                    throw new Error('overlay canvas 已 bind（transferControlToOffscreen 是一次性的）');
                }
                const target = canvas;
                if (typeof target.getContext !== 'function') {
                    throw new Error('overlay canvas 过线后没有 getContext（transfer 未生效？）');
                }
                const context = target.getContext('2d');
                if (!context) {
                    throw new Error('overlay canvas 拿不到 2d 上下文');
                }
                const g = host();
                if (typeof g.requestAnimationFrame === 'function') {
                    ticker = 'raf'; // Chrome 69+：dedicated worker 顶层 rAF，须 OffscreenCanvas 已 bind
                }
                else if (typeof g.setTimeout === 'function') {
                    ticker = 'timeout'; // Firefox/Safari 兜底：setTimeout 自循环 ~60fps
                }
                else {
                    throw new Error('worker 里既没有 requestAnimationFrame 也没有 setTimeout，无法自驱时钟');
                }
                surface = target;
                ctx = context;
                width = Math.max(1, Math.floor(w));
                height = Math.max(1, Math.floor(h));
                // 权威尺寸：主线程传来的 width/height（物理像素），不用过线时 canvas 身上的旧值。
                target.width = width;
                target.height = height;
                notify = sink;
                bound = true;
                lastEmitMs = nowMs();
                return ticker;
            },
            attach(handle, decoder, rect, playing, loop) {
                if (!bound) {
                    throw new Error('overlay 未 bind canvas 就 attach');
                }
                if (items.has(handle)) {
                    throw new Error(`handle ${handle} 已在 overlay 上`);
                }
                const item = {
                    handle,
                    decoder,
                    rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
                    playing,
                    loop,
                    currentFrame: 0,
                    accumMs: 0,
                    durations: new Array(decoder.frameCount).fill(-1),
                    bitmaps: new Map(),
                    pending: null,
                    lastDrawn: -1,
                    consecutiveErrors: 0,
                };
                items.set(handle, item);
                ensureFrame(item, 0); // 同 Player 构造：进场即解码第 0 帧（暂停态也要显示首帧）
                startClock();
            },
            resize(w, h) {
                if (!bound) {
                    return;
                }
                const nw = Math.max(1, Math.floor(w));
                const nh = Math.max(1, Math.floor(h));
                if (nw === width && nh === height) {
                    return;
                }
                width = nw;
                height = nh;
                // 设置 width/height 会清空画布位图（标准 resize 模式）；ImageBitmap 缓存与画布
                // 尺寸无关，保留 —— 只需强制全量重画。
                surface.width = nw;
                surface.height = nh;
                forceDirty = true;
                startClock();
            },
            update(placements) {
                if (!bound) {
                    return;
                }
                for (const placement of placements) {
                    const item = items.get(placement.handle);
                    if (!item) {
                        continue;
                    }
                    item.rect = { x: placement.rect.x, y: placement.rect.y, w: placement.rect.w, h: placement.rect.h };
                }
                forceDirty = true;
                startClock();
            },
            setState(handle, playing, loop) {
                const item = items.get(handle);
                if (!item) {
                    return;
                }
                item.playing = playing;
                if (loop !== undefined) {
                    item.loop = loop;
                }
                if (playing) {
                    startClock();
                }
            },
            detach(handle) {
                if (!items.delete(handle)) {
                    return;
                }
                forceDirty = true; // 擦掉原矩形区域的残影（重画时 clearRect 覆盖全画布）
                startClock();
            },
        };
    }

    // Worker 消息协议 —— 主线程侧（worker-transport.ts / worker-decoder.ts）与 worker 侧
    // （worker/decoder-worker.ts，经 scripts/build-worker.mjs 打成单文件 bundle）共享的唯一事实来源。
    // 纯类型与常量、零依赖：这个文件同时进游戏包（runtime 挂载）和 worker bundle，两边都不能 import 'cc'。
    //
    // 说明：SharedArrayBuffer 的类型声明属于 ES2017 lib，部分编译目标（ES2015）没有它，
    // 所以这里一律用结构化的 ArrayBufferLike —— 主线程只建 Uint8Array 视图，够用且处处可编译。
    // bundle 文件名。预览：load() 把它拷进引擎 native/external/，从 /engine_external/ 下发
    // （与 animated-webp.wasm 同一条链路）；web 构建：hooks 拷进产物 cocos-js/。
    // SharedArrayBuffer 帧缓冲的头部保留区（Int32Array 字 0..5，小端），像素从偏移 24 开始：
    //   word 0（byte 0）   共享性探针 token（既有约定：主线程写、probe 回读）
    //   word 1             frameIndex —— 当前像素区里是第几帧
    //   word 2             frameSeq —— 发布序号：worker 每完成一次「写像素 + 更新元数据」+1，
    //                      主线程轮询它，变了才上传（Atomics add/load，官方任务槽范式）
    //   word 3             durationMs —— 当前帧时长（worker 时钟学习值，主线程只读展示）
    //   word 4/5           帧指纹（非零字节数 / 字节和）—— 每帧一次的串台探针，主线程同口径比对
    // 2026-09 拉模型时代是 4 字节；自驱变体（worker-auto）需要跨线程帧信箱才扩到 24。
    const SHARED_HEADER_BYTES = 24;
    /** 宿主 Atomics（微信 V2 灰度两端都有；没有的宿主普通读写实践上也可用：对齐 u32 无撕裂）。 */
    function getAtomics() {
        const a = globalThis.Atomics;
        return a && typeof a.load === 'function' && typeof a.store === 'function' && typeof a.add === 'function'
            ? a : null;
    }
    // --- JSON-safe 字节编解码（旧版微信 worker 专用） ---
    // 旧版（非 V2）worker 的 postMessage 走 JSON 拷贝：Uint8Array/ArrayBuffer 过线后变成普通
    // 对象（实测 worker 侧拿到空壳，报 "APNG: missing IHDR chunk"）；SharedArrayBuffer 同样被
    // 序列化成 {} —— 真 SAB 只存在于 V2 / structured-clone 宿主。transfers=false 的宿主上跨线
    // 字节一律 b64 字符串（字符串对任何序列化器无损），浏览器宿主仍走原生 typed array + transfer，
    // 零编码开销。两侧共用 normalizeBytes 自动识别形态，不需要协商开关。
    const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    function bytesToB64(bytes) {
        let out = '';
        for (let i = 0; i < bytes.length; i += 3) {
            const b0 = bytes[i];
            const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
            const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
            const v = (b0 << 16) | (b1 << 8) | b2;
            out += B64_ALPHABET[(v >> 18) & 63] + B64_ALPHABET[(v >> 12) & 63]
                + (i + 1 < bytes.length ? B64_ALPHABET[(v >> 6) & 63] : '=')
                + (i + 2 < bytes.length ? B64_ALPHABET[v & 63] : '=');
        }
        return out;
    }
    function b64ToBytes(text) {
        const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
        // 尾组：剩 2 字符 = 1 字节，剩 3 字符 = 2 字节（'=' 已被过滤；剩 1 字符是非法输入，忽略）。
        const rem = clean.length % 4;
        const full = clean.length - rem;
        const out = new Uint8Array(full / 4 * 3 + (rem === 2 ? 1 : rem === 3 ? 2 : 0));
        const idx = (i) => B64_ALPHABET.indexOf(clean[i]);
        let p = 0;
        for (let i = 0; i < full; i += 4) {
            const v = (idx(i) << 18) | (idx(i + 1) << 12) | (idx(i + 2) << 6) | idx(i + 3);
            out[p++] = (v >> 16) & 0xff;
            out[p++] = (v >> 8) & 0xff;
            out[p++] = v & 0xff;
        }
        if (rem === 2) {
            const v = (idx(full) << 18) | (idx(full + 1) << 12);
            out[p++] = (v >> 16) & 0xff;
        }
        else if (rem === 3) {
            const v = (idx(full) << 18) | (idx(full + 1) << 12) | (idx(full + 2) << 6);
            out[p++] = (v >> 16) & 0xff;
            out[p++] = (v >> 8) & 0xff;
        }
        return out.subarray(0, p);
    }
    /** 收方归一化：Uint8Array（浏览器直传）/ b64 字符串（旧版微信）/ number[]（兜底）→ Uint8Array；不可识别返回 null。 */
    function normalizeBytes(value) {
        if (value instanceof Uint8Array) {
            return value;
        }
        if (typeof value === 'string') {
            return b64ToBytes(value);
        }
        if (Array.isArray(value)) {
            const out = new Uint8Array(value.length);
            for (let i = 0; i < value.length; i++) {
                out[i] = value[i] & 0xff;
            }
            return out;
        }
        return null;
    }

    // worker 侧入口 —— 由 scripts/build-worker.mjs 打成单文件 bundle（worker/dist/animated-image-decoder.js）。
    // 复用 runtime/ 里的纯 TS 解码器（apng-decoder / gif-decoder / zlib.min），零 cc 依赖。
    //
    // 宿主适配（进 worker 后没有 DOM 也没有引擎，可用的全局随宿主不同）：
    //   微信：全局 worker 对象（worker.onMessage / worker.postMessage，postMessage 无 transfer 列表）。
    //   浏览器：self.onmessage / self.postMessage（支持 transfer 列表）。
    //
    // 协议见 runtime/worker-protocol.ts。帧传输两模式：
    //   copy：postMessage 携带像素（浏览器宿主会先 slice 一份再 transfer —— 直接 transfer 解码器
    //         内部缓存的帧会把那份缓存 detach 掉，后续 seek 回读该帧就变零长数组）。
    //   SAB：open 带 shared 时尝试分配 SharedArrayBuffer（失败/未请求则 sharedBuffer 回 null，
    //        主线程自动落回 copy 模式）；每帧写进共享内存像素区，回小消息。
    //         帧数据不离开 worker（写的是共享内存的视图），解码器内部缓存原样保留。
    function resolveHost() {
        // 微信：worker 文件作用域里的全局 worker 对象。
        try {
            if (typeof worker !== 'undefined' && worker && typeof worker.onMessage === 'function') {
                const wxWorker = worker;
                return {
                    register: (handler) => { wxWorker.onMessage(handler); },
                    send: (message) => { wxWorker.postMessage(message); },
                    transfers: false,
                };
            }
        }
        catch (e) {
            // typeof 已守卫，这里只防个别宿主对全局访问本身抛错。
        }
        // 浏览器：self.postMessage / self.onmessage。
        const scope = typeof self !== 'undefined' ? self : undefined;
        if (scope && typeof scope.postMessage === 'function') {
            const post = scope.postMessage.bind(scope);
            return {
                register: (handler) => {
                    scope.onmessage = (event) => { handler(event.data); };
                },
                send: (message, transfer) => {
                    if (transfer) {
                        post(message, Array.isArray(transfer) ? transfer : [transfer]);
                    }
                    else {
                        post(message);
                    }
                },
                transfers: true,
            };
        }
        return null;
    }
    const host = resolveHost();
    if (!host) {
        throw new Error('animated-image worker 无法识别宿主（既没有微信 worker 全局，也没有 self.postMessage）');
    }
    const entries = new Map();
    // --- arena 形态（2026-09 单变量实验：全进程单块 SAB） ---
    // 检验「多块 SAB 是否为通道丢消息触发因子」：主线程只建一块大 SAB 按 slot 分区，
    // 首次 attach-shared 带引用（缓存在这里），后续只带 offset —— worker 侧 SAB 对象
    // 数从每实例一块降为全进程一块。
    let arenaBuffer = null;
    // --- 响应缓存（ARQ 可靠性层的 worker 半边，2026-09 真机实证通道丢消息后的根治缓解） ---
    // 主线程超时后**同 id 重传**请求：若原请求其实只是迟到（worker 已处理、响应在途中丢了），
    // 这里按 id 重发历史响应，不重复执行 —— open 重建解码器（全量 inflate）和 attach-shared
    // 的「已绑定」误报都靠这道门挡住。decode / decode-batch **不查不存**：解码天然幂等
    //（已合成帧 O(1)），且缓存 decoded 响应会让 SAB 指纹失去时序自洽（重发的是旧 fp，
    // 共享内存却可能已被后续帧覆盖）——重执行天然带回当前内存的指纹。error 响应不缓存
    //（错误路径重执行便宜，且失败不该被固化）。LRU 上限防长会话增长。
    const RESPONSE_CACHE_MAX = 128;
    const responseCache = new Map();
    function rememberResponse(id, message) {
        if (responseCache.has(id)) {
            responseCache.delete(id);
            responseCache.set(id, message);
            return;
        }
        if (responseCache.size >= RESPONSE_CACHE_MAX) {
            const oldest = responseCache.keys().next().value;
            if (oldest !== undefined) {
                responseCache.delete(oldest);
            }
        }
        responseCache.set(id, message);
    }
    // --- 源字节去重缓存（2026-09 真机实证大 b64 并发过线丢消息后的规避） ---
    // key = FNV-1a hash:字节数（主线程算好随 open 带来）。同源多实例（x38 heavy 同 4 源重复
    // 9.5 次）只有第一次全量过线，后续 open 带 key、bytes 为空 —— 大消息从 38 条降到 4 条，
    // 并发丢消息窗口随之收缩。FIFO 上限防长会话无限增长（测试池场景 64 源封顶足够）。
    const SOURCE_CACHE_MAX = 64;
    const sourceCache = new Map();
    function rememberSource(key, bytes) {
        if (sourceCache.has(key)) {
            sourceCache.delete(key); // 重插到队尾，维持 FIFO 新鲜度
            sourceCache.set(key, bytes);
            return;
        }
        if (sourceCache.size >= SOURCE_CACHE_MAX) {
            const oldest = sourceCache.keys().next().value;
            if (oldest !== undefined) {
                sourceCache.delete(oldest);
            }
        }
        sourceCache.set(key, bytes);
    }
    // overlay 合成器（worker-offscreen 变体）。惰性：第一条 overlay-canvas 请求到达才创建 ——
    // 未启用变体时 overlay-compositor 一行都不执行（「不破坏现有四档」的 worker 侧核心保险）。
    let overlay = null;
    // --- 通道诊断计数（定位丢消息方向：主线程侧同样逐类型计数，两侧对差 = 到达缺口） ---
    // 2026-09 真机实证链：ARQ 同 id 重传可恢复（消息真丢而非处理失败）、闸门 8 并发仍丢
    //（与瞬时并发弱相关）、arena 单块 SAB 仍丢（多 SAB 假设否定）—— 触发因子是持续吞吐下
    // 通道自身劣化。这对计数回答「丢在哪一步」：主→工 gap = 请求方向丢；工→主 gap = 响应
    // 方向丢；两侧 gap 都小但超时仍发生 = 消息没丢只是极慢（卡队列，看 lastReceivedMs）。
    const channelReceived = {};
    const channelSent = {};
    let channelLastReceivedMs = 0;
    function workerNow() {
        const perf = globalThis.performance;
        return typeof (perf === null || perf === void 0 ? void 0 : perf.now) === 'function' ? perf.now() : Date.now();
    }
    function createDecoder(bytes, mime) {
        if (mime === 'image/apng') {
            return createApngDecoder(bytes);
        }
        if (mime === 'image/gif') {
            return createGifDecoder(bytes);
        }
        throw new Error(`worker 不支持的格式: ${mime}`);
    }
    /** 分配 SAB 帧缓冲；宿主不支持（无构造器 / 构造失败）返回 null。 */
    function allocateShared(byteLength) {
        try {
            const Ctor = globalThis.SharedArrayBuffer;
            if (typeof Ctor !== 'function') {
                return null;
            }
            return new Ctor(byteLength);
        }
        catch (e) {
            return null;
        }
    }
    function errorMessage(e) {
        return e instanceof Error ? e.message : String(e);
    }
    const autoItems = new Map();
    let autoRunning = false;
    /** 一拍在途守卫：连续 auto-start / 恢复不得重复排拍（否则每拍翻倍、时钟越跑越快）。 */
    let autoPending = false;
    let autoLastMs = 0;
    // rAF 活性状态机：2026-09 真机实证 wx V2 worker 暴露 requestAnimationFrame 却从不回调
    //（无渲染面），盲信它时钟第一拍即死 —— autoPending 永真、动图全静止在首帧（vConsole
    // postCount 只有 open+seek 各 20，一帧时钟样本都没有）。首拍 rAF 与 setTimeout 看门狗
    // 双排：250ms 内 rAF 没回调 → 会话级判死（rafDead）换 setTimeout 链自愈；回调过一次 →
    // 会话级信任（rafProven），此后直排 rAF 零额外开销。沙箱两种宿主（手动泵 rAF / 无 rAF）
    // 都复现不了这个第四组合 —— rAF 在但永不调，只能靠看门狗防御。
    let autoRafProven = false;
    let autoRafDead = false;
    /** 当前时钟 ticker（诊断快照用；raf 判死后为 'timeout'）。 */
    let autoTickerKind = 'none';
    /** 自驱时钟累计拍数（诊断快照用 —— 真机上时钟死没死、死多久，一行日志读出）。 */
    let autoTickCount = 0;
    const AUTO_RAF_PROBE_MS = 250;
    const atomics = getAtomics();
    /** 取/建自驱条目；handle 未 open 或没有 SAB（copy 条目）抛错 —— 自驱的前提是共享内存。 */
    function ensureAutoItem(handle) {
        const entry = entries.get(handle);
        if (!entry) {
            throw new Error(`unknown handle ${handle}`);
        }
        if (!entry.sharedView || !entry.sharedHeaderInt32) {
            throw new Error(`handle ${handle} 没有共享内存（自驱模式需 SAB）`);
        }
        let item = autoItems.get(handle);
        if (!item) {
            item = {
                handle,
                playing: false,
                loop: false,
                currentFrame: 0,
                accumMs: 0,
                durations: new Array(Math.max(1, entry.decoder.frameCount)).fill(-1),
                pending: false,
                lastWritten: -1,
                errors: 0,
            };
            autoItems.set(handle, item);
        }
        return item;
    }
    /** setTimeout 兜底链排一拍；宿主连 setTimeout 都没有返回 false（调用方停钟）。 */
    function autoScheduleTimeout() {
        const g = globalThis;
        if (typeof g.setTimeout !== 'function') {
            return false;
        }
        autoTickerKind = 'timeout';
        autoPending = true;
        g.setTimeout(() => { autoPending = false; autoTick(); }, Math.max(4, Math.round(1000 / 60)));
        return true;
    }
    /** 自驱时钟排下一拍：rAF 可用走 rAF（与画面节奏对齐），否则 setTimeout ~60Hz 兜底
     *  （旧版微信 worker 无 rAF —— 与 overlay compositor 同款宿主探测与 running 停钟模式）。
     *  「rAF 函数存在」不等于「会回调」（见 autoRafProven 注释）—— 首拍必须过看门狗验证。 */
    function autoScheduleNext() {
        if (!autoRunning || autoPending) {
            return;
        }
        const g = globalThis;
        if (autoRafDead || typeof g.requestAnimationFrame !== 'function') {
            if (!autoScheduleTimeout()) {
                autoRunning = false;
            } // 无任何定时器宿主：停钟
            return;
        }
        if (autoRafProven || typeof g.setTimeout !== 'function') {
            // 已验证过 / 无 setTimeout 可挂看门狗：直排 rAF（浏览器宿主老行为）
            autoTickerKind = 'raf';
            autoPending = true;
            g.requestAnimationFrame(() => { autoPending = false; autoTick(); });
            return;
        }
        // 首拍：rAF + 看门狗双排，谁先到听谁的
        autoTickerKind = 'raf';
        autoPending = true;
        let fired = false;
        g.requestAnimationFrame(() => {
            if (autoRafDead || fired) {
                return;
            } // 判死后的僵尸回调：链已归 setTimeout，忽略
            fired = true;
            autoRafProven = true;
            autoPending = false;
            autoTick();
        });
        g.setTimeout(() => {
            if (fired || autoRafProven) {
                return;
            } // rAF 活着：看门狗静默退役
            autoRafDead = true; // rAF 没回调：会话级判死
            if (!autoRunning || !autoPending) {
                return;
            }
            autoPending = false; // 那一拍永不会来：交还 setTimeout 链接管
            autoScheduleTimeout();
        }, AUTO_RAF_PROBE_MS);
    }
    function autoTick() {
        if (!autoRunning) {
            return;
        }
        autoTickCount++;
        const now = workerNow();
        const dt = Math.min(250, now - autoLastMs);
        autoLastMs = now;
        let active = false;
        for (const item of autoItems.values()) {
            if (!item.playing) {
                continue;
            }
            active = true;
            autoAdvance(item, dt);
        }
        if (!active) {
            autoRunning = false;
            return;
        } // 全暂停/无条目 → 停钟（auto-start 重启）
        autoScheduleNext();
    }
    function autoAdvance(item, dtMs) {
        const entry = entries.get(item.handle);
        if (!entry || !entry.sharedView || !entry.sharedHeaderInt32) {
            autoItems.delete(item.handle); // 条目已死（close 单向通知丢失），别让僵尸项吊着时钟
            return;
        }
        const frameCount = entry.decoder.frameCount;
        if (frameCount <= 1) {
            return;
        }
        item.accumMs += dtMs;
        let guard = frameCount; // 一拍最多跨全部帧（超长 dt 钳 250ms 后的极端连续短帧）
        while (guard-- > 0) {
            const frameDur = item.durations[item.currentFrame];
            if (frameDur < 0) {
                autoEnsureFrame(item, item.currentFrame);
                return;
            }
            if (item.accumMs < frameDur) {
                break;
            }
            item.accumMs -= frameDur;
            let next = item.currentFrame + 1;
            if (next >= frameCount) {
                if (item.loop) {
                    next = 0;
                }
                else {
                    item.currentFrame = frameCount - 1; // 非循环：保持末帧（Player.tick 同构）
                    item.accumMs = 0;
                    item.playing = false;
                    break;
                }
            }
            item.currentFrame = next;
        }
        autoEnsureFrame(item, item.currentFrame);
    }
    /** 解码目标帧并发布进 SAB：像素 → 元数据（帧号/时长/指纹）→ 序号 +1 的顺序发布，
     *  轮询侧看到序号变化时数据已就位（单写者 seqlock）。单飞 + 同帧去重写。 */
    function autoEnsureFrame(item, index) {
        const entry = entries.get(item.handle);
        if (!entry || !entry.sharedView || !entry.sharedHeaderInt32) {
            return;
        }
        if (item.lastWritten === index || item.pending) {
            return;
        }
        item.pending = true;
        entry.decoder.decodeFrame(index).then((frame) => {
            item.pending = false;
            item.errors = 0;
            if (item.durations[index] < 0) {
                item.durations[index] = frame.duration;
            }
            // 时钟已走远（本帧解码期间 currentFrame 又变了）：不写共享内存、不推序号 ——
            // 避免「写旧帧 + 推序号」让轮询侧上屏一帧过时画面；下一拍补当前帧。
            if (item.currentFrame !== index) {
                return;
            }
            const view = entry.sharedView;
            view.set(frame.data);
            // 帧指纹（P0-2 串台探针的自驱等价物）：非零字节数 + 字节和（≤ ~6.5M < 2^31，
            // int32 无损），主线程轮询侧对自家视图同口径比对。
            const m = Math.min(view.length, frame.data.byteLength);
            let nonZero = 0;
            let sum = 0;
            for (let i = 0; i < m; i++) {
                const b = view[i];
                if (b !== 0) {
                    nonZero++;
                }
                sum += b;
            }
            const hdr = entry.sharedHeaderInt32;
            if (atomics) {
                atomics.store(hdr, 1, index);
                atomics.store(hdr, 3, frame.duration);
                atomics.store(hdr, 4, nonZero);
                atomics.store(hdr, 5, sum);
            }
            else {
                hdr[1] = index;
                hdr[3] = frame.duration;
                hdr[4] = nonZero;
                hdr[5] = sum;
            }
            item.lastWritten = index;
            if (atomics) {
                atomics.add(hdr, 2, 1);
            }
            else {
                hdr[2] = (hdr[2] + 1) | 0;
            }
        }, () => {
            item.pending = false;
            item.errors++;
            if (item.errors >= 8) {
                item.playing = false;
            }
        });
    }
    // 响应入缓存：包住 host.send，带 id 的成功响应按类型过滤自动入缓存
    //（decoded/decoded-batch/error 不存 —— 见上方注释；channel-stats-reply 也不存 ——
    // 重传必须拿到新计数，回旧快照会让诊断自欺）。
    const wireSend = host.send.bind(host);
    host.send = (message, transfer) => {
        const msg = message;
        if (typeof msg.t === 'string') {
            channelSent[msg.t] = (channelSent[msg.t] || 0) + 1;
        }
        if (typeof msg.id === 'number' && typeof msg.t === 'string'
            && msg.t !== 'error' && msg.t !== 'decoded' && msg.t !== 'decoded-batch'
            && msg.t !== 'overlay-stats' && msg.t !== 'channel-stats-reply' && msg.t !== 'auto-state') {
            // auto-state 不缓存：重传须重新执行取新状态（seek/start 幂等，重执行无副作用；
            // 回旧快照会让主线程拿到过时的播放态 —— 与 channel-stats-reply 同款理由）。
            // id 为 number 的只可能是带 id 的请求响应（overlay-stats 无 id，上面已排除）。
            rememberResponse(msg.id, message);
        }
        wireSend(message, transfer);
    };
    host.register((raw) => {
        const request = raw;
        if (!request || typeof request !== 'object' || typeof request.t !== 'string') {
            return;
        }
        // 诊断计数在 ARQ 门之前：计「到达 handler 的原始消息」，与主线程发送侧对差。
        channelReceived[request.t] = (channelReceived[request.t] || 0) + 1;
        channelLastReceivedMs = workerNow();
        // ARQ 重传幂等门：非 decode 类请求按 id 查缓存 —— 命中说明是重传（原响应在途中
        // 丢失），直接重发历史响应、不重复执行。decode/decode-batch 天然幂等走重执行。
        const reqId = request.id;
        if (typeof reqId === 'number' && request.t !== 'decode' && request.t !== 'decode-batch') {
            const cached = responseCache.get(reqId);
            if (cached !== undefined) {
                responseCache.delete(reqId);
                responseCache.set(reqId, cached); // 重插队尾，维持 LRU 新鲜度
                host.send(cached);
                return;
            }
        }
        switch (request.t) {
            case 'open': {
                try {
                    const perf = globalThis.performance;
                    const t0 = typeof (perf === null || perf === void 0 ? void 0 : perf.now) === 'function' ? perf.now() : Date.now();
                    // 旧版微信 worker 的 postMessage 是 JSON 拷贝：typed array 过线会被序列化器
                    // 弄坏（实测拿到空壳，报 "APNG: missing IHDR chunk"）。发送侧对 transfers=false
                    // 的宿主一律改发 b64 字符串；这里 normalizeBytes 把 Uint8Array / b64 / number[]
                    // 三种形态统一还原，认不出则走既有 error 回复。
                    const cached = request.sourceKey !== undefined
                        ? sourceCache.get(request.sourceKey) : undefined;
                    const bytes = cached || normalizeBytes(request.bytes);
                    if (!bytes || bytes.byteLength === 0) {
                        // 引用 open（bytes 空 + sourceKey）未命中 —— 注意 normalizeBytes('')
                        // 是空 Uint8Array（truthy），必须按 byteLength 判。回 sourceMiss，
                        // 主线程 service 层自动全量重发。
                        if (request.sourceKey !== undefined) {
                            host.send({
                                t: 'opened',
                                id: request.id,
                                handle: request.handle,
                                width: 0,
                                height: 0,
                                frameCount: 0,
                                loopCount: 0,
                                sharedBuffer: null,
                                sourceMiss: true,
                                computeMs: 0,
                            });
                            break;
                        }
                        throw new Error('open bytes 过线后无法识别（宿主序列化损坏了载荷）');
                    }
                    if (request.sourceKey !== undefined) {
                        rememberSource(request.sourceKey, bytes);
                    }
                    const decoder = createDecoder(bytes, request.mime);
                    let sharedBuffer = null;
                    let sharedRequestBytes;
                    if (request.shared && decoder.width > 0 && decoder.height > 0) {
                        const wanted = SHARED_HEADER_BYTES + decoder.width * decoder.height * 4;
                        sharedBuffer = allocateShared(wanted);
                        // worker 侧无 SAB 构造器（2026-09 真机实证的微信 V2 灰度形态：通道真共享、
                        // 构造器只在主线程）时不直接放弃 —— 回报建议字节数，主线程分配后经
                        // attach-shared 送回绑定；通道假共享由主线程写-读探针照旧筛出。
                        if (!sharedBuffer) {
                            sharedRequestBytes = wanted;
                        }
                    }
                    const computeMs = (typeof (perf === null || perf === void 0 ? void 0 : perf.now) === 'function' ? perf.now() : Date.now()) - t0;
                    entries.set(request.handle, {
                        decoder,
                        sharedBuffer,
                        sharedView: sharedBuffer ? new Uint8Array(sharedBuffer, SHARED_HEADER_BYTES) : null,
                        sharedHeader: sharedBuffer ? new Uint8Array(sharedBuffer, 0, SHARED_HEADER_BYTES) : null,
                        sharedHeaderInt32: sharedBuffer ? new Int32Array(sharedBuffer, 0, SHARED_HEADER_BYTES / 4) : null,
                    });
                    // 注意：SAB 不进 transfer 列表（它「可共享」而非「可转移」，放进去浏览器直接
                    // DataCloneError）。它随消息体 structured clone 即可完成共享；克隆型宿主会拿到
                    // 一份不共享的副本 —— 主线程的写-读探针负责把这种情况筛出来。
                    host.send({
                        t: 'opened',
                        id: request.id,
                        handle: request.handle,
                        width: decoder.width,
                        height: decoder.height,
                        frameCount: decoder.frameCount,
                        loopCount: decoder.loopCount,
                        sharedBuffer,
                        sharedRequestBytes,
                        computeMs,
                    });
                    // 注：sourceMiss 分支在上面 bytes 判空处提前 break，带字节的 open 走到这里
                    // 一定是命中/全量路径。
                }
                catch (e) {
                    host.send({ t: 'error', id: request.id, handle: request.handle, message: errorMessage(e) });
                }
                break;
            }
            case 'probe': {
                const entry = entries.get(request.handle);
                if (!entry || !entry.sharedBuffer) {
                    host.send({ t: 'error', id: request.id, handle: request.handle, message: `handle ${request.handle} 没有共享内存` });
                    break;
                }
                // header 视图用 entry.sharedHeader：整块形态 = buffer 偏移 0，arena 形态 = 本实例
                // slot 头（arena 偏移 0 是别的实例的地盘，现场建视图会探错对象）。
                const header = entry.sharedHeader
                    || new Uint8Array(entry.sharedBuffer, 0, SHARED_HEADER_BYTES);
                // 多点探针：像素区逐点回读（单字节 header 探针探不出大面积映射错乱）。
                if (Array.isArray(request.positions) && entry.sharedView) {
                    const seenValues = [];
                    for (const p of request.positions) {
                        seenValues.push(typeof p === 'number' && p >= 0 && p < entry.sharedView.length
                            ? entry.sharedView[p] : -1);
                    }
                    host.send({ t: 'probed', id: request.id, handle: request.handle, seen: header[0], seenValues });
                    break;
                }
                host.send({ t: 'probed', id: request.id, handle: request.handle, seen: header[0] });
                break;
            }
            case 'attach-shared': {
                // 主线程分配回退：worker 侧分配不了 SAB 时，主线程 new 完经这条消息送回。
                // 收方形态校验是第一道门 —— JSON 拷贝宿主会把 SAB 序列化成无 byteLength 的
                // 空壳，直接建视图必抛；回 error 让主线程落既有 copy 降级出口（同探针失败）。
                try {
                    const entry = entries.get(request.handle);
                    if (!entry) {
                        throw new Error(`unknown handle ${request.handle}`);
                    }
                    if (entry.sharedBuffer) {
                        throw new Error(`handle ${request.handle} 已绑定共享内存`);
                    }
                    const expected = SHARED_HEADER_BYTES + entry.decoder.width * entry.decoder.height * 4;
                    if (request.offset !== undefined) {
                        // arena 形态：单块大 SAB 按 slot 分区。首次带 buffer（缓存引用），
                        // 后续只带 offset/length —— SAB 对象过线从 N 次降为 1 次。
                        if (request.buffer) {
                            const alen = request.buffer.byteLength;
                            if (typeof alen !== 'number' || alen <= 0) {
                                throw new Error('attach-shared 的 arena 引用过线后不可用（宿主序列化损坏了载荷）');
                            }
                            arenaBuffer = request.buffer;
                        }
                        if (!arenaBuffer) {
                            throw new Error('attach-shared arena 引用缺失（首次 attach 必须带 buffer）');
                        }
                        const off = request.offset;
                        const len = request.length;
                        if (typeof len !== 'number' || len !== expected) {
                            throw new Error(`attach-shared slot 长度不符（收到 ${len}，期望 ${expected}）`);
                        }
                        if (off < 0 || off + len > arenaBuffer.byteLength) {
                            throw new Error(`attach-shared slot 越界（offset=${off} + length=${len} > arena ${arenaBuffer.byteLength}）`);
                        }
                        entry.sharedBuffer = arenaBuffer;
                        entry.sharedHeader = new Uint8Array(arenaBuffer, off, SHARED_HEADER_BYTES);
                        entry.sharedView = new Uint8Array(arenaBuffer, off + SHARED_HEADER_BYTES, len - SHARED_HEADER_BYTES);
                        entry.sharedHeaderInt32 = new Int32Array(arenaBuffer, off, SHARED_HEADER_BYTES / 4);
                        host.send({ t: 'attached-shared', id: request.id, handle: request.handle });
                        break;
                    }
                    const len = request.buffer ? request.buffer.byteLength : undefined;
                    if (typeof len !== 'number' || len <= 0) {
                        throw new Error('attach-shared 的 buffer 过线后不可用（宿主序列化损坏了载荷）');
                    }
                    if (len !== expected) {
                        throw new Error(`attach-shared 字节数不符（收到 ${len}，期望 ${expected}）`);
                    }
                    entry.sharedBuffer = request.buffer;
                    entry.sharedHeader = new Uint8Array(request.buffer, 0, SHARED_HEADER_BYTES);
                    entry.sharedView = new Uint8Array(request.buffer, SHARED_HEADER_BYTES);
                    entry.sharedHeaderInt32 = new Int32Array(request.buffer, 0, SHARED_HEADER_BYTES / 4);
                    host.send({ t: 'attached-shared', id: request.id, handle: request.handle });
                }
                catch (e) {
                    host.send({ t: 'error', id: request.id, handle: request.handle, message: errorMessage(e) });
                }
                break;
            }
            case 'decode': {
                const entry = entries.get(request.handle);
                if (!entry) {
                    host.send({ t: 'error', id: request.id, handle: request.handle, message: `unknown handle ${request.handle}` });
                    break;
                }
                const perf = globalThis.performance;
                const t0 = typeof (perf === null || perf === void 0 ? void 0 : perf.now) === 'function' ? perf.now() : Date.now();
                entry.decoder.decodeFrame(request.index).then((frame) => {
                    const t1 = typeof (perf === null || perf === void 0 ? void 0 : perf.now) === 'function' ? perf.now() : Date.now();
                    const computeMs = t1 - t0;
                    if (entry.sharedView) {
                        // SAB 模式：像素写进共享内存，消息只带元数据 + 帧指纹（首/中/尾采样 +
                        // 非零计数 + 字节和；主线程对自家视图同口径比对 —— 每帧一次数据正确性
                        // 探针，串台发生的第一帧即暴露。一次遍历 ~0.05ms/帧，对比省下的跨线
                        // 序列化成本可忽略）。
                        entry.sharedView.set(frame.data);
                        const view = entry.sharedView;
                        const n = frame.data.byteLength;
                        const m = Math.min(view.length, n);
                        let nonZero = 0;
                        let sum = 0;
                        for (let i = 0; i < m; i++) {
                            const b = view[i];
                            if (b !== 0) {
                                nonZero++;
                            }
                            sum = (sum + b) & 0xFFFF;
                        }
                        const fp = m > 0
                            ? [view[0], view[m >> 1], view[m - 1], n, nonZero, sum]
                            : [0, 0, 0, n, nonZero, sum];
                        host.send({
                            t: 'decoded',
                            id: request.id,
                            handle: request.handle,
                            index: request.index,
                            duration: frame.duration,
                            fp,
                            computeMs,
                        });
                    }
                    else if (host.transfers) {
                        // 浏览器 copy 模式：slice 出独立副本再 transfer。直接 transfer frame.data
                        // 会 detach 解码器内部缓存的那份（同一个 buffer），seek 回读会拿到零长数组。
                        const payload = frame.data.slice();
                        host.send({
                            t: 'decoded',
                            id: request.id,
                            handle: request.handle,
                            index: request.index,
                            duration: frame.duration,
                            data: payload,
                            computeMs,
                        }, payload.buffer);
                    }
                    else {
                        // 旧版微信 copy 模式：postMessage 是 JSON 拷贝，typed array 过线同样会被
                        // 弄坏 —— 一律 b64 字符串（主线程 decode() 里 normalizeBytes 还原）。
                        host.send({
                            t: 'decoded',
                            id: request.id,
                            handle: request.handle,
                            index: request.index,
                            duration: frame.duration,
                            data: bytesToB64(frame.data),
                            computeMs,
                        });
                    }
                }, (e) => {
                    host.send({ t: 'error', id: request.id, handle: request.handle, message: errorMessage(e) });
                });
                break;
            }
            case 'decode-batch': {
                const entry = entries.get(request.handle);
                if (!entry) {
                    host.send({ t: 'error', id: request.id, handle: request.handle, message: `unknown handle ${request.handle}` });
                    break;
                }
                if (entry.sharedView) {
                    // SAB 模式主线程不会发批量请求（消息本就只有元数据）；发来也算协议误用。
                    host.send({ t: 'error', id: request.id, handle: request.handle, message: 'decode-batch 仅 copy 模式' });
                    break;
                }
                // 顺序解码 [from, end)：APNG 顺序合成状态依赖帧序，不得乱序/并发。
                const perf = globalThis.performance;
                const total = entry.decoder.frameCount;
                const from = Math.max(0, request.from | 0);
                const end = Math.min(total, from + Math.max(1, request.count | 0));
                const frames = [];
                const transferBuffers = [];
                const step = (index) => {
                    if (index >= end) {
                        return Promise.resolve();
                    }
                    const t0 = typeof (perf === null || perf === void 0 ? void 0 : perf.now) === 'function' ? perf.now() : Date.now();
                    return entry.decoder.decodeFrame(index).then((frame) => {
                        const computeMs = (typeof (perf === null || perf === void 0 ? void 0 : perf.now) === 'function' ? perf.now() : Date.now()) - t0;
                        if (host.transfers) {
                            // 浏览器：slice 独立副本再 transfer（同单帧路径，防 detach 解码器内部缓存）。
                            const payload = frame.data.slice();
                            transferBuffers.push(payload.buffer);
                            frames.push({ index, duration: frame.duration, data: payload, computeMs });
                        }
                        else {
                            // 旧版微信 copy：一帧一条 b64，K 条合在同一响应里 = 消息数砍到 1/K。
                            frames.push({ index, duration: frame.duration, data: bytesToB64(frame.data), computeMs });
                        }
                        return step(index + 1);
                    });
                };
                step(from).then(() => {
                    host.send({ t: 'decoded-batch', id: request.id, handle: request.handle, from, frames }, transferBuffers.length ? transferBuffers : undefined);
                }, (e) => {
                    host.send({ t: 'error', id: request.id, handle: request.handle, message: errorMessage(e) });
                });
                break;
            }
            case 'close': {
                const entry = entries.get(request.handle);
                if (entry) {
                    entries.delete(request.handle);
                    try {
                        entry.decoder.destroy();
                    }
                    catch (e) {
                        // destroy 失败无需上报：条目已删除，主线程也不会再用这个 handle。
                    }
                }
                // 防御：close 打到已 attach 的 handle 时同步注销合成条目（幂等），避免 worker
                // 侧时钟继续画一个解码器已销毁的条目。自驱条目同理注销。
                if (overlay) {
                    overlay.detach(request.handle);
                }
                autoItems.delete(request.handle);
                host.send({ t: 'closed', id: request.id, handle: request.handle });
                break;
            }
            // 通道诊断快照（见 channelReceived 注释）：spread 拷贝防后续计数串进已发出的快照。
            case 'channel-stats': {
                let autoPlaying = 0;
                let autoErrors = 0;
                for (const it of autoItems.values()) {
                    if (it.playing) {
                        autoPlaying++;
                    }
                    autoErrors += it.errors;
                }
                host.send({
                    t: 'channel-stats-reply',
                    id: request.id,
                    receivedByType: { ...channelReceived },
                    sentByType: { ...channelSent },
                    lastReceivedMs: channelLastReceivedMs,
                    nowMs: workerNow(),
                    // 自驱引擎健康快照：真机上时钟死没死、死在哪（ticker/拍数/播放条目），
                    // 主线程 [channel] 行直接打出 —— 不用再猜（worker console 不透传 vConsole）。
                    auto: {
                        ticker: autoTickerKind,
                        rafDead: autoRafDead,
                        rafProven: autoRafProven,
                        running: autoRunning,
                        pending: autoPending,
                        ticks: autoTickCount,
                        items: autoItems.size,
                        playing: autoPlaying,
                        errors: autoErrors,
                    },
                });
                break;
            }
            // --- overlay 合成（worker-offscreen 变体）。请求带 id 有回执；通知无 id 单向。 ---
            case 'overlay-canvas': {
                try {
                    if (!overlay) {
                        overlay = createOverlayCompositor();
                    }
                    const ticker = overlay.bind(request.canvas, request.width, request.height, (note) => { host.send(note); });
                    host.send({ t: 'overlay-canvas-bound', id: request.id, ticker });
                }
                catch (e) {
                    host.send({ t: 'error', id: request.id, message: errorMessage(e) });
                }
                break;
            }
            case 'overlay-attach': {
                try {
                    if (!overlay) {
                        throw new Error('overlay 未 bind canvas 就 attach');
                    }
                    const entry = entries.get(request.handle);
                    if (!entry) {
                        throw new Error(`unknown handle ${request.handle}`);
                    }
                    overlay.attach(request.handle, entry.decoder, request.rect, request.playing, request.loop);
                    host.send({ t: 'overlay-attached', id: request.id, handle: request.handle });
                }
                catch (e) {
                    host.send({ t: 'error', id: request.id, handle: request.handle, message: errorMessage(e) });
                }
                break;
            }
            case 'overlay-resize': {
                if (overlay) {
                    overlay.resize(request.width, request.height);
                }
                break;
            }
            case 'overlay-update': {
                if (overlay) {
                    overlay.update(request.rects);
                }
                break;
            }
            case 'overlay-set-state': {
                if (overlay) {
                    overlay.setState(request.handle, request.playing, request.loop);
                }
                break;
            }
            case 'overlay-detach': {
                if (overlay) {
                    overlay.detach(request.handle);
                }
                const entry = entries.get(request.handle);
                if (entry) {
                    entries.delete(request.handle);
                    try {
                        entry.decoder.destroy();
                    }
                    catch (e) {
                        // 同 close：条目已删，destroy 失败无需上报。
                    }
                }
                autoItems.delete(request.handle);
                break;
            }
            // --- 自驱解码（worker-auto 变体）：每帧零消息，只有起停/跳帧控制往返。
            //     响应 auto-state 不入缓存（见 wireSend），重传走重执行 —— start/seek 幂等。 ---
            case 'auto-start': {
                try {
                    const item = ensureAutoItem(request.handle);
                    item.loop = request.loop;
                    item.playing = request.playing;
                    if (request.playing) {
                        if (!autoRunning) {
                            autoRunning = true;
                            autoLastMs = workerNow();
                        }
                        autoScheduleNext();
                    }
                    else if (item.lastWritten < 0) {
                        autoEnsureFrame(item, item.currentFrame); // 停止态也要有首帧可看
                    }
                    host.send({ t: 'auto-state', id: request.id, handle: request.handle,
                        playing: item.playing, index: item.currentFrame });
                }
                catch (e) {
                    host.send({ t: 'error', id: request.id, handle: request.handle, message: errorMessage(e) });
                }
                break;
            }
            case 'auto-seek': {
                try {
                    const item = ensureAutoItem(request.handle);
                    const total = entries.get(request.handle).decoder.frameCount;
                    item.currentFrame = Math.max(0, Math.min(request.index | 0, Math.max(0, total - 1)));
                    item.accumMs = 0;
                    item.errors = 0;
                    autoEnsureFrame(item, item.currentFrame); // 播放/暂停态都要把目标帧写上屏
                    host.send({ t: 'auto-state', id: request.id, handle: request.handle,
                        playing: item.playing, index: item.currentFrame });
                }
                catch (e) {
                    host.send({ t: 'error', id: request.id, handle: request.handle, message: errorMessage(e) });
                }
                break;
            }
        }
    });

})();
