/**
 * Client-side encryption for sensitive sessionStorage data.
 * Uses Web Crypto API (AES-GCM) to encrypt data before storing.
 *
 * The encryption key is ephemeral (generated per store, discarded after read)
 * so the ciphertext cannot be decrypted after the session ends.
 */

const KEY_STORAGE_KEY = '__ek';
const ALGORITHM = 'AES-GCM';
const IV_LENGTH = 12;

/** Chunk size for converting Uint8Array → string (avoids call-stack overflow) */
const CHUNK_SIZE = 8192;

function isWebCryptoAvailable(): boolean {
	return typeof globalThis.crypto?.subtle !== 'undefined';
}

/** Convert a Uint8Array to a base64 string in chunks (safe for large buffers). */
function uint8ToBase64(bytes: Uint8Array): string {
	const chunks: string[] = [];
	for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
		const slice = bytes.subarray(i, i + CHUNK_SIZE);
		chunks.push(String.fromCharCode.apply(null, slice as unknown as number[]));
	}
	return btoa(chunks.join(''));
}

/** Convert a base64 string to a Uint8Array. */
function base64ToUint8(b64: string): Uint8Array {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) {
		bytes[i] = bin.charCodeAt(i);
	}
	return bytes;
}

async function generateKey(): Promise<CryptoKey> {
	return crypto.subtle.generateKey({ name: ALGORITHM, length: 256 }, true, ['encrypt', 'decrypt']);
}

async function exportKey(key: CryptoKey): Promise<string> {
	const raw = await crypto.subtle.exportKey('raw', key);
	return uint8ToBase64(new Uint8Array(raw));
}

async function importKey(encoded: string): Promise<CryptoKey> {
	const raw = base64ToUint8(encoded);
	return crypto.subtle.importKey('raw', raw.buffer as ArrayBuffer, { name: ALGORITHM }, false, [
		'decrypt'
	]);
}

/**
 * Encrypt data and store in sessionStorage.
 * Stores ciphertext under `storageKey` and the encryption key under a separate key.
 */
export async function encryptAndStore(storageKey: string, data: unknown): Promise<void> {
	if (!isWebCryptoAvailable()) {
		// Fallback: store as-is (e.g., in SSR or very old browsers)
		sessionStorage.setItem(storageKey, JSON.stringify(data));
		return;
	}

	const key = await generateKey();
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
	const plaintext = new TextEncoder().encode(JSON.stringify(data));

	const ciphertext = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, plaintext);

	// Combine IV + ciphertext for storage
	const combined = new Uint8Array(iv.length + ciphertext.byteLength);
	combined.set(iv, 0);
	combined.set(new Uint8Array(ciphertext), iv.length);

	sessionStorage.setItem(storageKey, uint8ToBase64(combined));
	sessionStorage.setItem(KEY_STORAGE_KEY, await exportKey(key));
}

/**
 * Read and decrypt data from sessionStorage.
 * Returns null if the data is missing, corrupt, or decryption fails.
 * Always removes both the data and key from sessionStorage after reading.
 */
export async function readAndDecrypt<T = unknown>(storageKey: string): Promise<T | null> {
	const stored = sessionStorage.getItem(storageKey);
	if (!stored) return null;

	const keyData = sessionStorage.getItem(KEY_STORAGE_KEY);

	// Clean up immediately
	sessionStorage.removeItem(storageKey);
	sessionStorage.removeItem(KEY_STORAGE_KEY);

	if (!keyData || !isWebCryptoAvailable()) {
		// Fallback: try parsing as plain JSON (for data stored before encryption was added)
		try {
			return JSON.parse(stored) as T;
		} catch {
			return null;
		}
	}

	try {
		const combined = base64ToUint8(stored);
		const iv = combined.slice(0, IV_LENGTH);
		const ciphertext = combined.slice(IV_LENGTH);

		const key = await importKey(keyData);
		const plaintext = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, ciphertext);

		return JSON.parse(new TextDecoder().decode(plaintext)) as T;
	} catch {
		// If decryption fails, try plain JSON fallback (migration path)
		try {
			return JSON.parse(stored) as T;
		} catch {
			return null;
		}
	}
}
