import { json } from '@sveltejs/kit';

/**
 * Standard error messages used across API routes.
 */
export const ERROR = {
	AUTH_REQUIRED: '認証が必要です',
	ADMIN_REQUIRED: '管理者権限が必要です',
	INVALID_ACTION: '無効なアクションです',
	NOT_FOUND: '見つかりません',
	INVALID_REQUEST: '無効なリクエストです',
	USER_NOT_FOUND: 'ユーザーが見つかりません',
	USER_ID_REQUIRED: 'ユーザーIDが必要です',
	SELF_ACTION: '自分に対してこの操作はできません',
	FRIENDS_ONLY: 'フレンドのみに実行できます',
	DELEGATION_CYCLE: '委任の循環が検出されました。この委任先には委任できません。',
	DELEGATION_ID_REQUIRED: '委任IDが必要です',
	DELEGATION_NOT_FOUND: '委任が見つかりません',
	REQUEST_NOT_FOUND: 'リクエストが見つかりません',
	NOTIFICATION_ID_REQUIRED: '通知IDが必要です',
	IMAGE_URL_REQUIRED: '画像URLが必要です',
	FILE_ID_REQUIRED: 'ファイルIDが必要です',
	INVALID_IMAGE_URL: '無効な画像URLです',
	BILL_ID_REQUIRED: '法案IDが必要です',
	IMAGEKIT_UNAVAILABLE: '画像アップロード機能は現在利用できません'
} as const;

/**
 * Buffer size constants for child process execution.
 */
export const BUFFER_SIZE = {
	/** 50MB — for large script outputs (cluster vectors, matching) */
	LARGE: 50 * 1024 * 1024,
	/** 10MB — for smaller script outputs (generate clustering) */
	MEDIUM: 10 * 1024 * 1024
} as const;

/**
 * Require an authenticated user from request locals.
 * Returns the user object, or a JSON 401 error response.
 */
export function requireUser(locals: App.Locals) {
	if (!locals.user) {
		return json({ error: ERROR.AUTH_REQUIRED }, { status: 401 });
	}
	return locals.user;
}

/**
 * Require an authenticated admin user from request locals.
 * Returns the user object, or a JSON 401/403 error response.
 */
export function requireAdmin(locals: App.Locals) {
	if (!locals.user) {
		return json({ error: ERROR.AUTH_REQUIRED }, { status: 401 });
	}
	if (locals.user.role !== 'admin') {
		return json({ error: ERROR.ADMIN_REQUIRED }, { status: 403 });
	}
	return locals.user;
}

/**
 * Type guard: checks if the result of requireUser/requireAdmin is an error Response.
 */
export function isErrorResponse(
	result: Response | { id: string; [key: string]: unknown }
): result is Response {
	return result instanceof Response;
}

/**
 * Parse a URL search param as a positive integer.
 * Returns the parsed number or null if the param is missing/invalid.
 */
export function parseIntParam(value: string | null): number | null {
	if (!value) return null;
	const parsed = parseInt(value, 10);
	if (isNaN(parsed) || !Number.isSafeInteger(parsed)) return null;
	return parsed;
}

/**
 * Parse a required URL search param as a positive integer.
 * Returns the parsed number or a JSON 400 error response.
 */
export function requireIntParam(value: string | null, paramName: string): number | Response {
	const parsed = parseIntParam(value);
	if (parsed === null) {
		return json({ error: `${paramName}が無効です` }, { status: 400 });
	}
	return parsed;
}

/**
 * Standard error handler for API route catch blocks.
 * Logs the error and returns a JSON 500 response.
 */
export function handleApiError(error: unknown, context: string): Response {
	console.error(`${context}:`, error);
	return json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
}

/**
 * Parse cursor-based pagination params from URL search params.
 * Returns `{ limit, beforeId }` with a clamped limit.
 */
export function parsePaginationParams(
	url: URL,
	defaultLimit = 20,
	maxLimit = 50
): { limit: number; beforeId: number | null } {
	const limit = Math.min(parseIntParam(url.searchParams.get('limit')) ?? defaultLimit, maxLimit);
	const beforeId = parseIntParam(url.searchParams.get('before'));
	return { limit, beforeId };
}

/**
 * Slice a query result for cursor pagination and determine if more results exist.
 */
export function paginateResults<T>(items: T[], limit: number): { items: T[]; hasMore: boolean } {
	const hasMore = items.length > limit;
	return { items: hasMore ? items.slice(0, limit) : items, hasMore };
}
