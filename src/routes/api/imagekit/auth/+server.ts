import { json } from '@sveltejs/kit';
import { imagekit, IMAGEKIT_PUBLIC_KEY, IMAGEKIT_URL_ENDPOINT } from '$lib/server/imagekit';
import type { RequestHandler } from './$types.js';
import { requireUser, isErrorResponse, ERROR } from '$lib/server/api-utils';

export const GET: RequestHandler = async ({ locals }) => {
	const userOrError = requireUser(locals);
	if (isErrorResponse(userOrError)) return userOrError;

	const ik = imagekit();
	if (!ik) {
		return json({ error: ERROR.IMAGEKIT_UNAVAILABLE }, { status: 503 });
	}

	try {
		const authParams = ik.helper.getAuthenticationParameters();
		return json({
			success: true,
			...authParams,
			publicKey: IMAGEKIT_PUBLIC_KEY,
			urlEndpoint: IMAGEKIT_URL_ENDPOINT
		});
	} catch (error) {
		console.error('ImageKit auth param generation error:', error);
		return json({ error: '認証パラメータの生成に失敗しました' }, { status: 500 });
	}
};
