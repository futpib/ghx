import fs from 'node:fs/promises';
import path from 'node:path';
import envPaths from 'env-paths';
import { z } from 'zod';

const paths = envPaths('ghx', { suffix: '' });

const configSchema = z.object({
	accounts: z.record(z.string(), z.string()),
});

export type Config = z.infer<typeof configSchema>;

export const configPath = path.join(paths.config, 'config.json');

export async function loadConfig(): Promise<Config> {
	let content: string;
	try {
		content = await fs.readFile(configPath, 'utf8');
	} catch {
		return { accounts: {} };
	}

	return configSchema.parse(JSON.parse(content));
}

export function getAccountForHost(config: Config, host: string): string | undefined {
	return config.accounts[host] ?? config.accounts['*'];
}
