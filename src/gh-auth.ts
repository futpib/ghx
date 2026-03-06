import fs from 'node:fs/promises';
import path from 'node:path';
import envPaths from 'env-paths';
import YAML from 'yaml';
import { z } from 'zod';

const ghPaths = envPaths('gh', { suffix: '' });

const hostsSchema = z.record(z.string(), z.object({
	user: z.string(),
}).passthrough());

export async function getActiveAccount(host: string): Promise<string | undefined> {
	try {
		const hostsPath = path.join(ghPaths.config, 'hosts.yml');
		const content = await fs.readFile(hostsPath, 'utf8');
		const hosts = hostsSchema.parse(YAML.parse(content));
		return hosts[host]?.user;
	} catch {
		return undefined;
	}
}
