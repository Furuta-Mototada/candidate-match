/**
 * Shared fetch utilities with retry logic and rate limiting
 */

import { fetch } from 'undici';

const DEFAULT_RATE_LIMIT_MS = 500;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Rate limiter that tracks the last request time
 */
class RateLimiter {
	private lastRequestTime = 0;

	constructor(private minDelayMs: number) {}

	async wait(): Promise<void> {
		const now = Date.now();
		const elapsed = now - this.lastRequestTime;
		if (elapsed < this.minDelayMs) {
			await sleep(this.minDelayMs - elapsed);
		}
		this.lastRequestTime = Date.now();
	}
}

// Global rate limiters for different domains
const rateLimiters = new Map<string, RateLimiter>();

function getRateLimiter(domain: string, delayMs: number): RateLimiter {
	const key = `${domain}:${delayMs}`;
	if (!rateLimiters.has(key)) {
		rateLimiters.set(key, new RateLimiter(delayMs));
	}
	return rateLimiters.get(key)!;
}

export interface FetchOptions {
	/** Maximum number of retry attempts (default: 3) */
	maxRetries?: number;
	/** Base delay in ms for exponential backoff (default: 1000) */
	baseDelayMs?: number;
	/** Rate limit delay in ms between requests to same domain (default: 500) */
	rateLimitMs?: number;
	/** Request timeout in ms (default: 30000) */
	timeoutMs?: number;
	/** Whether to apply rate limiting (default: true) */
	rateLimit?: boolean;
}

/**
 * Fetch with retry logic and exponential backoff
 */
export async function fetchWithRetry(url: string, options: FetchOptions = {}): Promise<Response> {
	const {
		maxRetries = DEFAULT_MAX_RETRIES,
		baseDelayMs = DEFAULT_BASE_DELAY_MS,
		rateLimitMs = DEFAULT_RATE_LIMIT_MS,
		timeoutMs = DEFAULT_TIMEOUT_MS,
		rateLimit = true
	} = options;

	// Extract domain for rate limiting
	const domain = new URL(url).hostname;

	// Apply rate limiting if enabled
	if (rateLimit) {
		const limiter = getRateLimiter(domain, rateLimitMs);
		await limiter.wait();
	}

	let lastError: Error | null = null;

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			// Create abort controller for timeout
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

			try {
				const response = await fetch(url, {
					signal: controller.signal
				});

				// Handle rate limiting response
				if (response.status === 429) {
					const retryAfter = response.headers.get('Retry-After');
					const delay = retryAfter
						? parseInt(retryAfter) * 1000
						: baseDelayMs * Math.pow(2, attempt);
					console.warn(`Rate limited (429), waiting ${delay}ms before retry...`);
					await sleep(delay);
					continue;
				}

				// Return successful response
				return response as unknown as Response;
			} finally {
				clearTimeout(timeoutId);
			}
		} catch (err) {
			lastError = err as Error;

			// Don't retry on abort (timeout)
			if ((err as Error).name === 'AbortError') {
				console.error(`Request timeout after ${timeoutMs}ms: ${url}`);
			}

			// Last attempt, throw the error
			if (attempt === maxRetries - 1) {
				break;
			}

			// Calculate delay with exponential backoff
			const delay = baseDelayMs * Math.pow(2, attempt);
			console.warn(
				`Request failed (attempt ${attempt + 1}/${maxRetries}), retrying in ${delay}ms...`,
				(err as Error).message
			);
			await sleep(delay);
		}
	}

	throw lastError || new Error(`Failed to fetch ${url} after ${maxRetries} attempts`);
}

/**
 * Resolve a relative URL against a base URL
 */
export function resolveUrl(base: string, href: string): string {
	try {
		return new URL(href, base).toString();
	} catch {
		return href;
	}
}
