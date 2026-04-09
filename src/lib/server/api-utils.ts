import { json } from '@sveltejs/kit';

/**
 * Standard error messages used across API routes.
 */
export const ERROR = {
	AUTH_REQUIRED: '認証が必要です',
	ADMIN_REQUIRED: '管理者権限が必要です',
	INVALID_ACTION: '無効なアクションです',
	NOT_FOUND: '見つかりません',
	INVALID_REQUEST: '無効なリクエストです'
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
