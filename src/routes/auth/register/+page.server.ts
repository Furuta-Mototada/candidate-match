import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import * as auth from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) {
		throw redirect(302, '/');
	}
	return {
		redirectTo: url.searchParams.get('redirect') || ''
	};
};

export const actions: Actions = {
	default: async (event) => {
		const { request, cookies } = event;
		const formData = await request.formData();
		const username = formData.get('username') as string;
		const password = formData.get('password') as string;
		const confirmPassword = formData.get('confirmPassword') as string;
		const redirectTo = (formData.get('redirectTo') as string) || '/';

		if (!username || !password || !confirmPassword) {
			return fail(400, { error: 'All fields are required', username });
		}

		if (username.length < 3 || username.length > 32) {
			return fail(400, { error: 'Username must be 3-32 characters', username });
		}

		if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
			return fail(400, {
				error: 'Username can only contain letters, numbers, hyphens and underscores',
				username
			});
		}

		if (password.length < 8 || password.length > 128) {
			return fail(400, { error: 'Password must be 8-128 characters', username });
		}

		if (password !== confirmPassword) {
			return fail(400, { error: 'Passwords do not match', username });
		}

		// Check if username already exists
		const [existing] = await db
			.select({ id: table.user.id })
			.from(table.user)
			.where(eq(table.user.username, username));

		if (existing) {
			return fail(400, { error: 'Username already taken', username });
		}

		const userId = auth.generateUserId();
		const passwordHash = await auth.hashPassword(password);

		await db.insert(table.user).values({
			id: userId,
			username,
			passwordHash,
			role: 'user'
		});

		const sessionToken = auth.generateSessionToken();
		const session = await auth.createSession(sessionToken, userId);
		auth.setSessionTokenCookie(event, sessionToken, session.expiresAt);

		throw redirect(302, redirectTo);
	}
};
