/**
 * Page cache for scraping scripts.
 *
 * Saves raw HTTP response bodies to disk so scraping can be re-run
 * against cached pages without hitting the live servers.
 *
 * Usage:
 *   const cache = new PageCache('scrape_sangiin');
 *   const body = await cache.fetchText(url);           // UTF-8 HTML
 *   const data = await cache.fetchJson<T>(url);         // JSON API
 *   const html = await cache.fetchShiftJIS(url);        // Shift-JIS HTML
 *
 * Cache location: data/raw/{scraperName}/{YYYY-MM-DD}/
 *
 * Pass --no-cache to disable caching (always fetch live).
 * Pass --from-cache to only read from cache (never fetch live).
 */

import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fetch } from 'undici';
import { fetchWithRetry, sleep, type FetchOptions } from './fetch';

const DEFAULT_CACHE_DIR = 'data/raw';

export interface PageCacheOptions {
	/** Base directory for cache storage (default: 'data/raw') */
	baseDir?: string;
	/** Override the date folder name (default: today YYYY-MM-DD) */
	dateLabel?: string;
	/** Disable caching entirely — always fetch live */
	disabled?: boolean;
	/** Only read from cache — never fetch live */
	fromCacheOnly?: boolean;
}

export class PageCache {
	private cacheDir: string;
	private disabled: boolean;
	private fromCacheOnly: boolean;

	constructor(scraperName: string, options: PageCacheOptions = {}) {
		const baseDir = options.baseDir ?? DEFAULT_CACHE_DIR;
		const dateLabel = options.dateLabel ?? new Date().toISOString().split('T')[0];
		this.cacheDir = join(baseDir, scraperName, dateLabel);
		this.disabled = options.disabled ?? false;
		this.fromCacheOnly = options.fromCacheOnly ?? false;
	}

	/**
	 * Convert a URL to a filesystem-safe filename.
	 * Uses a readable prefix + short hash for uniqueness.
	 */
	private urlToFilename(url: string): string {
		const parsed = new URL(url);
		const safePath = (parsed.hostname + parsed.pathname + parsed.search)
			.replace(/[^a-zA-Z0-9_\-.]/g, '_')
			.replace(/_+/g, '_')
			.slice(0, 150);
		const hash = createHash('md5').update(url).digest('hex').slice(0, 8);
		return `${safePath}_${hash}`;
	}

	private filePath(url: string): string {
		return join(this.cacheDir, this.urlToFilename(url));
	}

	/** Check if a URL is cached */
	async has(url: string): Promise<boolean> {
		if (this.disabled) return false;
		try {
			await access(this.filePath(url));
			return true;
		} catch {
			return false;
		}
	}

	/** Read cached raw bytes for a URL, or null if not cached */
	async get(url: string): Promise<Buffer | null> {
		if (this.disabled) return null;
		try {
			return await readFile(this.filePath(url));
		} catch {
			return null;
		}
	}

	/** Save raw bytes for a URL */
	async put(url: string, data: Buffer): Promise<void> {
		if (this.disabled) return;
		await mkdir(this.cacheDir, { recursive: true });
		const fp = this.filePath(url);
		await writeFile(fp, data);
		await writeFile(
			fp + '.meta.json',
			JSON.stringify({ url, cachedAt: new Date().toISOString(), size: data.length })
		);
	}

	/**
	 * Core method: get from cache or fetch and cache.
	 * The fetcher should return raw bytes (Buffer) or null on failure.
	 */
	async getOrFetch(url: string, fetcher: () => Promise<Buffer | null>): Promise<Buffer | null> {
		const cached = await this.get(url);
		if (cached !== null) {
			console.log(`  [cache hit] ${url.slice(0, 100)}`);
			return cached;
		}

		if (this.fromCacheOnly) {
			console.warn(`  [cache only] Not in cache, skipping: ${url.slice(0, 100)}`);
			return null;
		}

		const data = await fetcher();
		if (data) {
			await this.put(url, data);
		}
		return data;
	}

	// ── Convenience wrappers ────────────────────────────────────────

	/**
	 * Fetch a URL using fetchWithRetry, return the UTF-8 text body.
	 * Caches the raw bytes on success (status 200).
	 */
	async fetchText(url: string, fetchOptions?: FetchOptions): Promise<string | null> {
		const buf = await this.getOrFetch(url, async () => {
			const res = await fetchWithRetry(url, fetchOptions);
			if (res.status !== 200) {
				console.warn(`  HTTP ${res.status} for ${url}`);
				return null;
			}
			return Buffer.from(await res.arrayBuffer());
		});
		return buf ? buf.toString('utf-8') : null;
	}

	/**
	 * Fetch a URL using fetchWithRetry, return parsed JSON.
	 * Caches the raw bytes on success (status 200).
	 */
	async fetchJson<T = unknown>(url: string, fetchOptions?: FetchOptions): Promise<T | null> {
		const buf = await this.getOrFetch(url, async () => {
			const res = await fetchWithRetry(url, fetchOptions);
			if (res.status !== 200) {
				console.warn(`  HTTP ${res.status} for ${url}`);
				return null;
			}
			return Buffer.from(await res.arrayBuffer());
		});
		return buf ? (JSON.parse(buf.toString('utf-8')) as T) : null;
	}

	/**
	 * Fetch a Shift-JIS encoded page with retry logic.
	 * Caches raw bytes; decodes Shift-JIS on read.
	 */
	async fetchShiftJIS(
		url: string,
		options: { maxRetries?: number; baseDelayMs?: number; rateLimitMs?: number } = {}
	): Promise<string | null> {
		const { maxRetries = 3, baseDelayMs = 1000, rateLimitMs = 500 } = options;

		const buf = await this.getOrFetch(url, async () => {
			let lastError: Error | null = null;

			for (let attempt = 0; attempt < maxRetries; attempt++) {
				try {
					await sleep(rateLimitMs);
					const res = await fetch(url);
					if (res.status !== 200) {
						console.warn(`  HTTP ${res.status} for ${url}`);
						return null;
					}
					return Buffer.from(await res.arrayBuffer());
				} catch (err) {
					lastError = err as Error;
					const delay = baseDelayMs * Math.pow(2, attempt);
					console.warn(
						`  Attempt ${attempt + 1}/${maxRetries} failed for ${url}, retrying in ${delay}ms...`
					);
					await sleep(delay);
				}
			}

			console.error(`  All ${maxRetries} attempts failed for ${url}:`, lastError);
			return null;
		});

		if (!buf) return null;
		const decoder = new TextDecoder('shift-jis');
		return decoder.decode(buf);
	}

	/**
	 * Fetch a UTF-8 page with retry logic (no fetchWithRetry dependency).
	 * Useful for scripts that don't use the shared fetchWithRetry.
	 */
	async fetchPage(
		url: string,
		options: { maxRetries?: number; baseDelayMs?: number; rateLimitMs?: number } = {}
	): Promise<string | null> {
		const { maxRetries = 3, baseDelayMs = 1000, rateLimitMs = 500 } = options;

		const buf = await this.getOrFetch(url, async () => {
			let lastError: Error | null = null;

			for (let attempt = 0; attempt < maxRetries; attempt++) {
				try {
					await sleep(rateLimitMs);
					const res = await fetch(url);
					if (res.status !== 200) {
						console.warn(`  HTTP ${res.status} for ${url}`);
						return null;
					}
					return Buffer.from(await res.arrayBuffer());
				} catch (err) {
					lastError = err as Error;
					const delay = baseDelayMs * Math.pow(2, attempt);
					console.warn(
						`  Attempt ${attempt + 1}/${maxRetries} failed for ${url}, retrying in ${delay}ms...`
					);
					await sleep(delay);
				}
			}

			console.error(`  All ${maxRetries} attempts failed for ${url}:`, lastError);
			return null;
		});

		return buf ? buf.toString('utf-8') : null;
	}
}

/**
 * Create a PageCache from CLI args.
 * Supports --no-cache and --from-cache flags.
 */
export function createPageCache(scraperName: string, args: string[]): PageCache {
	const noCache = args.includes('--no-cache');
	const fromCache = args.includes('--from-cache');

	if (noCache) {
		console.log('Cache disabled (--no-cache)');
	} else if (fromCache) {
		console.log('Cache-only mode (--from-cache) — will not fetch live');
	}

	return new PageCache(scraperName, {
		disabled: noCache,
		fromCacheOnly: fromCache
	});
}
