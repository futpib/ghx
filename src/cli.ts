#!/usr/bin/env node

import fs from 'node:fs';
import process from 'node:process';
import { program } from 'commander';
import { execa } from 'execa';
import { lock, unlock } from 'proper-lockfile';
import { paths, loadConfig, getAccountForHost } from './config.js';
import { getActiveAccount } from './gh-auth.js';

const lockFilePath = paths.data;

async function getRemoteHost(): Promise<string | undefined> {
	try {
		const result = await execa({ reject: false })`git remote get-url origin`;
		if (result.exitCode !== 0) {
			return undefined;
		}

		const url = result.stdout.trim();

		// Git@github.com-archive:org/repo.git → github.com-archive
		const sshMatch = /^[^@]+@([^:]+):/.exec(url);
		if (sshMatch) {
			return sshMatch[1];
		}

		// https://github.com/org/repo.git → github.com
		try {
			const parsed = new URL(url);
			return parsed.hostname;
		} catch {}

		return undefined;
	} catch {
		return undefined;
	}
}

async function ensureAccount(account: string): Promise<void> {
	const active = await getActiveAccount('github.com');
	if (active === account) {
		return;
	}

	await execa({
		reject: false,
		stdin: 'inherit',
		stdout: 'inherit',
		stderr: 'inherit',
	})`gh auth switch --user ${account}`;
}

program
	.name('ghx')
	.description('gh wrapper that automatically switches GitHub accounts based on the current repository\'s remote')
	.helpOption(false)
	.allowUnknownOption()
	.allowExcessArguments()
	.enablePositionalOptions()
	.passThroughOptions()
	.argument('[args...]')
	.action(async (args: string[]) => {
		if (args.includes('--help') || args.includes('-h')) {
			program.outputHelp();
			console.log();
		}
		const config = await loadConfig();
		const host = await getRemoteHost();
		const account = host ? getAccountForHost(config, host) : undefined;

		if (account) {
			fs.mkdirSync(lockFilePath, { recursive: true });
			await lock(lockFilePath, { retries: { retries: 10, minTimeout: 100, maxTimeout: 5000 } });
			try {
				await ensureAccount(account);

				const result = await execa({
					reject: false,
					stdin: 'inherit',
					stdout: 'inherit',
					stderr: 'inherit',
				})`gh ${args}`;

				process.exitCode = result.exitCode;
			} finally {
				await unlock(lockFilePath);
			}
		} else {
			const result = await execa({
				reject: false,
				stdin: 'inherit',
				stdout: 'inherit',
				stderr: 'inherit',
			})`gh ${args}`;

			process.exitCode = result.exitCode;
		}
	});

program.parse();
