import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import * as auth from '$lib/server/auth';
import { sql } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(302, '/auth/login');
	}

	const [userData] = await db
		.select({
			id: table.user.id,
			username: table.user.username,
			role: table.user.role,
			createdAt: table.user.createdAt
		})
		.from(table.user)
		.where(eq(table.user.id, locals.user.id));

	return {
		profile: userData
	};
};

export const actions: Actions = {
	updateUsername: async (event) => {
		if (!event.locals.user) {
			return fail(401, { error: '認証が必要です' });
		}

		const formData = await event.request.formData();
		const username = formData.get('username') as string;

		if (!username || username.length < 3 || username.length > 32) {
			return fail(400, { usernameError: 'ユーザー名は3〜32文字にしてください' });
		}

		if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
			return fail(400, {
				usernameError: 'ユーザー名には英数字、ハイフン、アンダースコアのみ使用できます'
			});
		}

		// Check if already taken (by another user)
		const [existing] = await db
			.select({ id: table.user.id })
			.from(table.user)
			.where(eq(table.user.username, username));

		if (existing && existing.id !== event.locals.user.id) {
			return fail(400, { usernameError: 'このユーザー名は既に使われています' });
		}

		await db
			.update(table.user)
			.set({ username, updatedAt: sql`now()` })
			.where(eq(table.user.id, event.locals.user.id));

		return { usernameSuccess: true };
	},

	updatePassword: async (event) => {
		if (!event.locals.user) {
			return fail(401, { error: '認証が必要です' });
		}

		const formData = await event.request.formData();
		const currentPassword = formData.get('currentPassword') as string;
		const newPassword = formData.get('newPassword') as string;
		const confirmPassword = formData.get('confirmPassword') as string;

		if (!currentPassword || !newPassword || !confirmPassword) {
			return fail(400, { passwordError: 'すべてのフィールドを入力してください' });
		}

		if (newPassword.length < 8 || newPassword.length > 128) {
			return fail(400, { passwordError: 'パスワードは8〜128文字にしてください' });
		}

		if (newPassword !== confirmPassword) {
			return fail(400, { passwordError: 'パスワードが一致しません' });
		}

		// Verify current password
		const [userData] = await db
			.select({ passwordHash: table.user.passwordHash })
			.from(table.user)
			.where(eq(table.user.id, event.locals.user.id));

		const validPassword = await auth.verifyPassword(userData.passwordHash, currentPassword);
		if (!validPassword) {
			return fail(400, { passwordError: '現在のパスワードが正しくありません' });
		}

		const newPasswordHash = await auth.hashPassword(newPassword);
		await db
			.update(table.user)
			.set({ passwordHash: newPasswordHash, updatedAt: sql`now()` })
			.where(eq(table.user.id, event.locals.user.id));

		return { passwordSuccess: true };
	}
};
