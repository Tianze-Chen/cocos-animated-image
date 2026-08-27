import { sniffMime, UNKNOWN_MIME } from './mime-sniff';

/**
 * Normalize an XHR / network response body into a Uint8Array.
 *
 * WeChat / Sud mini-game shells commonly hand back binary data as a string even
 * when `responseType` was 'arraybuffer' — typically a base64 string, sometimes a
 * raw Latin-1 binary string. `new Uint8Array(someString)` does not iterate the
 * string in V8 (it yields an empty array), which silently breaks decoding, so we
 * accept every common response shape here.
 */
export function toBytes (response: unknown): Uint8Array | null {
    if (response == null) {
        return null;
    }

    if (response instanceof ArrayBuffer) {
        return new Uint8Array(response);
    }

    if (ArrayBuffer.isView(response)) {
        const view = response as ArrayBufferView;
        return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    }

    if (typeof response === 'string') {
        return stringToBytes(response);
    }

    return null;
}

/**
 * Convert a string body into bytes. Prefers base64 when the decoded bytes look
 * like a known image format; otherwise treats the string as raw Latin-1 bytes.
 */
export function stringToBytes (str: string): Uint8Array {
    const base64 = tryBase64(str);
    if (base64 && sniffMime(base64) !== UNKNOWN_MIME) {
        return base64;
    }

    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
        out[i] = str.charCodeAt(i) & 0xff;
    }
    return out;
}

/** Short human-readable description of a response value, for diagnostics. */
export function describeResponse (response: unknown): string {
    if (response == null) {
        return String(response);
    }
    if (response instanceof ArrayBuffer) {
        return `ArrayBuffer(${response.byteLength}B)`;
    }
    if (ArrayBuffer.isView(response)) {
        return `${Object.prototype.toString.call(response)}(${response.byteLength}B)`;
    }
    if (typeof response === 'string') {
        return `string(${response.length} chars)`;
    }
    return typeof response;
}

// ---- base64 helpers ----

function tryBase64 (str: string): Uint8Array | null {
    const s = str.replace(/\s+/g, '');
    if (!s || s.length % 4 === 1) {
        return null;
    }

    const atobFn = (globalThis as { atob?: (value: string) => string }).atob;
    if (typeof atobFn === 'function') {
        try {
            const bin = atobFn(s);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) {
                bytes[i] = bin.charCodeAt(i);
            }
            return bytes;
        } catch {
            return null;
        }
    }

    return decodeBase64(s);
}

function decodeBase64 (s: string): Uint8Array | null {
    // Drop any trailing '=' padding (and anything after it).
    let input = s;
    const eq = input.indexOf('=');
    if (eq !== -1) {
        input = input.slice(0, eq);
    }

    const out = new Uint8Array(Math.ceil((input.length * 3) / 4));
    let buffer = 0;
    let bits = 0;
    let n = 0;
    for (let i = 0; i < input.length; i++) {
        const idx = b64CharIndex(input.charCodeAt(i));
        if (idx < 0) {
            return null;
        }
        buffer = (buffer << 6) | idx;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            if (n < out.length) {
                out[n++] = (buffer >> bits) & 0xff;
            }
        }
    }
    return n === 0 ? null : out.slice(0, n);
}

function b64CharIndex (c: number): number {
    if (c >= 65 && c <= 90) return c - 65;          // A-Z
    if (c >= 97 && c <= 122) return c - 97 + 26;    // a-z
    if (c >= 48 && c <= 57) return c - 48 + 52;     // 0-9
    if (c === 43 || c === 45) return 62;            // + or base64url -
    if (c === 47 || c === 95) return 63;            // / or base64url _
    return -1;
}
