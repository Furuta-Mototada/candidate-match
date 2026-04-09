import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { sql } from 'drizzle-orm';
import { imagekit } from '$lib/server/imagekit';
import type { RequestHandler } from './$types.js';
import { requireUser, isErrorResponse } from '$lib/server/api-utils';

async function deleteOldAvatar(userId: string) {
	const [existing] = await db
		.select({ avatarFileId: table.user.avatarFileId })
		.from(table.user)
		.where(eq(table.user.id, userId));

	if (existing?.avatarFileId) {
		try {
			await imagekit.deleteFile(existing.avatarFileId);
		} catch {
			// Best-effort: don't fail the request if ImageKit delete fails
			console.warn(`Failed to delete old avatar from ImageKit: ${existing.avatarFileId}`);
		}
	}
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const userOrError = requireUser(locals);
	if (isErrorResponse(userOrError)) return userOrError;

	const body = await request.json();
	const { url, fileId } = body;

	if (!url || typeof url !== 'string') {
		return json({ error: '画像URLが必要です' }, { status: 400 });
	}

	if (!fileId || typeof fileId !== 'string') {
		return json({ error: 'ファイルIDが必要です' }, { status: 400 });
	}

	// Basic URL validation - must be from ImageKit
	if (!url.startsWith('https://ik.imagekit.io/')) {
		return json({ error: '無効な画像URLです' }, { status: 400 });
	}

	// Delete the old avatar from ImageKit before saving the new one
	await deleteOldAvatar(userOrError.id);

	await db
		.update(table.user)
		.set({ avatarUrl: url, avatarFileId: fileId, updatedAt: sql`now()` })
		.where(eq(table.user.id, userOrError.id));

	return json({ success: true, avatarUrl: url });
};

export const DELETE: RequestHandler = async ({ locals }) => {
	const userOrError = requireUser(locals);
	if (isErrorResponse(userOrError)) return userOrError;

	// Delete the avatar from ImageKit
	await deleteOldAvatar(userOrError.id);

	await db
		.update(table.user)
		.set({ avatarUrl: null, avatarFileId: null, updatedAt: sql`now()` })
		.where(eq(table.user.id, userOrError.id));

	return json({ success: true });
};
