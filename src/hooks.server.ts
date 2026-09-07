import type { Handle } from '@sveltejs/kit';
import { normalizeLocale } from '$lib/i18n/locales';

export const handle: Handle = async ({ event, resolve }) => {
	const queryLocale = event.url.searchParams.get('lang');
	const cookieLocale = event.cookies.get('reviewloop_locale');
	const acceptLanguage = event.request.headers.get('accept-language');
	const locale = normalizeLocale(queryLocale ?? cookieLocale ?? acceptLanguage);

	event.locals.locale = locale;

	if (queryLocale) {
		event.cookies.set('reviewloop_locale', locale, {
			path: '/',
			sameSite: 'lax',
			httpOnly: false,
			maxAge: 60 * 60 * 24 * 365
		});
	}

	return resolve(event, {
		transformPageChunk: ({ html }) => html.replace('<html', `<html lang="${locale}"`)
	});
};
