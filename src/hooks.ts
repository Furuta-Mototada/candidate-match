import { deLocalizeUrl } from '$lib/paraglide/runtime';

export const reroute = (request) => {
	try {
		return deLocalizeUrl(request.url).pathname;
	} catch {
		return request.url.pathname;
	}
};
