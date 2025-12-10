/**
 * Progress tracking and checkpointing utilities
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { dirname } from 'path';

export interface Checkpoint<T = unknown> {
	lastProcessedId: string | number | null;
	processedIds: Set<string | number>;
	metadata: T;
	updatedAt: string;
}

/**
 * Progress tracker with file-based checkpointing
 */
export class ProgressTracker<T = unknown> {
	private checkpoint: Checkpoint<T>;
	private dirty = false;

	constructor(
		private checkpointPath: string,
		private defaultMetadata: T
	) {
		this.checkpoint = this.load();
	}

	/**
	 * Check if an ID has already been processed
	 */
	isProcessed(id: string | number): boolean {
		return this.checkpoint.processedIds.has(id);
	}

	/**
	 * Mark an ID as processed
	 */
	markProcessed(id: string | number): void {
		this.checkpoint.processedIds.add(id);
		this.checkpoint.lastProcessedId = id;
		this.checkpoint.updatedAt = new Date().toISOString();
		this.dirty = true;
	}

	/**
	 * Get the last processed ID
	 */
	getLastProcessedId(): string | number | null {
		return this.checkpoint.lastProcessedId;
	}

	/**
	 * Get current metadata
	 */
	getMetadata(): T {
		return this.checkpoint.metadata;
	}

	/**
	 * Update metadata
	 */
	updateMetadata(metadata: Partial<T>): void {
		this.checkpoint.metadata = { ...this.checkpoint.metadata, ...metadata };
		this.dirty = true;
	}

	/**
	 * Get count of processed items
	 */
	getProcessedCount(): number {
		return this.checkpoint.processedIds.size;
	}

	/**
	 * Save checkpoint to file (only if dirty)
	 */
	save(): void {
		if (!this.dirty) return;

		const data = {
			lastProcessedId: this.checkpoint.lastProcessedId,
			processedIds: [...this.checkpoint.processedIds],
			metadata: this.checkpoint.metadata,
			updatedAt: this.checkpoint.updatedAt
		};

		// Ensure directory exists
		const dir = dirname(this.checkpointPath);
		if (dir && !existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		writeFileSync(this.checkpointPath, JSON.stringify(data, null, 2));
		this.dirty = false;
	}

	/**
	 * Load checkpoint from file
	 */
	private load(): Checkpoint<T> {
		if (existsSync(this.checkpointPath)) {
			try {
				const data = JSON.parse(readFileSync(this.checkpointPath, 'utf-8'));
				return {
					lastProcessedId: data.lastProcessedId ?? null,
					processedIds: new Set(data.processedIds ?? []),
					metadata: data.metadata ?? this.defaultMetadata,
					updatedAt: data.updatedAt ?? new Date().toISOString()
				};
			} catch (err) {
				console.warn(`Failed to load checkpoint from ${this.checkpointPath}:`, err);
			}
		}

		return {
			lastProcessedId: null,
			processedIds: new Set(),
			metadata: this.defaultMetadata,
			updatedAt: new Date().toISOString()
		};
	}

	/**
	 * Clear all progress and delete checkpoint file
	 */
	clear(): void {
		this.checkpoint = {
			lastProcessedId: null,
			processedIds: new Set(),
			metadata: this.defaultMetadata,
			updatedAt: new Date().toISOString()
		};
		this.dirty = false;

		if (existsSync(this.checkpointPath)) {
			unlinkSync(this.checkpointPath);
		}
	}
}

/**
 * Simple in-memory cache with optional TTL
 */
export class Cache<K, V> {
	private cache = new Map<K, { value: V; expiresAt: number | null }>();

	constructor(private defaultTtlMs: number | null = null) {}

	/**
	 * Get a value from cache
	 */
	get(key: K): V | undefined {
		const entry = this.cache.get(key);
		if (!entry) return undefined;

		if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
			this.cache.delete(key);
			return undefined;
		}

		return entry.value;
	}

	/**
	 * Set a value in cache
	 */
	set(key: K, value: V, ttlMs?: number): void {
		const ttl = ttlMs ?? this.defaultTtlMs;
		this.cache.set(key, {
			value,
			expiresAt: ttl !== null ? Date.now() + ttl : null
		});
	}

	/**
	 * Check if key exists (and is not expired)
	 */
	has(key: K): boolean {
		return this.get(key) !== undefined;
	}

	/**
	 * Delete a key from cache
	 */
	delete(key: K): boolean {
		return this.cache.delete(key);
	}

	/**
	 * Clear all cache entries
	 */
	clear(): void {
		this.cache.clear();
	}

	/**
	 * Get cache size
	 */
	get size(): number {
		return this.cache.size;
	}
}
