// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			locale: import('$lib/i18n/locales').Locale;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

declare module 'pdfjs-dist/build/pdf.min.mjs' {
	const content: any;
	export default content;
	export * from 'pdfjs-dist';
}

export {};
