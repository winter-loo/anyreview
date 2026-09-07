import { DEFAULT_LOCALE, type Locale } from './locales';
import { messages } from './messages';

export type MessageKey = keyof typeof messages.en;

type MessageVars = Record<string, string | number>;

export function createTranslator(locale: Locale) {
	return function t(key: MessageKey, vars: MessageVars = {}) {
		const template = messages[locale][key] ?? messages[DEFAULT_LOCALE][key] ?? key;
		return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
	};
}
