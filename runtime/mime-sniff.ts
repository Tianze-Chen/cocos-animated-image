export const UNKNOWN_MIME = 'application/octet-stream';

export function sniffMime (bytes: Uint8Array, fallback = UNKNOWN_MIME): string {
    if (bytes.length < 8) {
        return fallback;
    }

    // JPEG SOI marker: FF D8
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
        return 'image/jpeg';
    }

    // GIF87a / GIF89a: 47 49 46 38 (37|39) 61
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
        return 'image/gif';
    }

    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47
        && bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A) {
        return hasAcTL(bytes) ? 'image/apng' : 'image/png';
    }

    // WebP container: RIFF at 0-3, WEBP at 8-11
    if (bytes.length >= 12
        && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
        && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
        return 'image/webp';
    }

    return fallback;
}

function hasAcTL (bytes: Uint8Array): boolean {
    const len = bytes.length;
    let pos = 8;
    while (pos + 8 <= len) {
        const chunkLen = readU32(bytes, pos);
        const type = readU32(bytes, pos + 4);
        if (type === 0x6163544C) {
            return true;
        }
        if (type === 0x49444154 || type === 0x49454E44) {
            return false;
        }
        pos += 12 + chunkLen;
    }
    return false;
}

function readU32 (bytes: Uint8Array, offset: number): number {
    return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}
