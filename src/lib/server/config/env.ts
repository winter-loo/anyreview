export function firstEnv(names: string[], fallback?: string) {
	for (const name of names) {
		const value = process.env[name];
		if (value && value.trim()) return value;
	}
	return fallback;
}

export function reviewPlatformBaseUrl() {
	return firstEnv(['REVIEW_PLATFORM_BASE_URL'], 'http://localhost:5173')!;
}

export function reviewPlatformPublicUrl() {
	return firstEnv(['REVIEW_PLATFORM_PUBLIC_URL']);
}

export function reviewPlatformGatewayNotifyUrl() {
	return firstEnv([
		'REVIEW_PLATFORM_GATEWAY_NOTIFY_URL',
		'REVIEW_PLATFORM_HERMES_GATEWAY_NOTIFY_URL'
	]);
}

export function reviewPlatformGatewayToken() {
	return firstEnv([
		'REVIEW_PLATFORM_GATEWAY_TOKEN',
		'REVIEW_PLATFORM_HERMES_GATEWAY_TOKEN'
	]);
}

export function reviewPlatformDiscordTargetEnv() {
	return {
		channelId: firstEnv(['REVIEW_PLATFORM_DISCORD_CHANNEL_ID']),
		threadId: firstEnv(['REVIEW_PLATFORM_DISCORD_THREAD_ID']),
		executorMention: firstEnv(['REVIEW_PLATFORM_EXECUTOR_MENTION'])
	};
}
