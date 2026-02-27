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
		const redirectTo = (formData.get('redirectTo') as string) || '/';

		if (!username || !password) {
			return fail(400, { error: 'Username and password are required', username });
		}

		const [existingUser] = await db
			.select()
			.from(table.user)
			.where(eq(table.user.username, username));

		if (!existingUser) {
			return fail(400, { error: 'Invalid username or password', username });
		}

		const validPassword = await auth.verifyPassword(existingUser.passwordHash, password);
		if (!validPassword) {
			return fail(400, { error: 'Invalid username or password', username });
		}

		const sessionToken = auth.generateSessionToken();
		const session = await auth.createSession(sessionToken, existingUser.id);
		auth.setSessionTokenCookie(event, sessionToken, session.expiresAt);

		throw redirect(302, redirectTo);
	}
};
