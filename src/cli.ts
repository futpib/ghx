#!/usr/bin/env node

import process from 'node:process';
import { program } from 'commander';
import { execa } from 'execa';
import { loadConfig, getAccountForHost } from './config.js';

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
	await execa({
		reject: false,
		stdin: 'inherit',
		stdout: 'inherit',
		stderr: 'inherit',
	})`gh auth switch --user ${account}`;
}

program
	.name('ghx')
	.description('gh wrapper')
	.allowUnknownOption()
	.allowExcessArguments()
	.enablePositionalOptions()
	.passThroughOptions()
	.argument('[args...]')
	.action(async (args: string[]) => {
		const config = await loadConfig();
		const host = await getRemoteHost();

		if (host) {
			const account = getAccountForHost(config, host);
			if (account) {
				await ensureAccount(account);
			}
		}

		const result = await execa({
			reject: false,
			stdin: 'inherit',
			stdout: 'inherit',
			stderr: 'inherit',
		})`gh ${args}`;

		process.exitCode = result.exitCode;
	});

program.parse();
