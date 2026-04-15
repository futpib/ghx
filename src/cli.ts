#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { program } from 'commander';
import { execa } from 'execa';
import { paths, loadConfig, getAccountForHost } from './config.js';
import { acquire, release } from './fs-group-mutex.js';
import { getActiveAccount } from './gh-auth.js';

const lockDirPath = paths.data;
const statePath = path.join(lockDirPath, 'group-mutex-state.json');

type Remote = {
	host: string;
	repo: string;
};

async function getRemote(): Promise<Remote | undefined> {
	try {
		const result = await execa({ reject: false })`git remote get-url origin`;
		if (result.exitCode !== 0) {
			return undefined;
		}

		const url = result.stdout.trim();

		// Git@github.com-archive:org/repo.git → host=github.com-archive, repo=org/repo
		const sshMatch = /^[^@]+@([^:]+):(.+?)(?:\.git)?$/.exec(url);
		if (sshMatch) {
			return { host: sshMatch[1], repo: sshMatch[2] };
		}

		// https://github.com/org/repo.git → host=github.com, repo=org/repo
		try {
			const parsed = new URL(url);
			const repo = parsed.pathname.replace(/^\//, '').replace(/\.git$/, '');
			return { host: parsed.hostname, repo };
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
		const remote = await getRemote();
		const account = getAccountForHost(config, remote?.host);

		const env: Record<string, string> = {};
		if (remote && remote.host !== 'github.com') {
			env.GH_REPO = remote.repo;
		}

		if (account) {
			fs.mkdirSync(lockDirPath, { recursive: true });
			await acquire(lockDirPath, statePath, account);
			try {
				await ensureAccount(account);

				const result = await execa({
					reject: false,
					stdin: 'inherit',
					stdout: 'inherit',
					stderr: 'inherit',
					env,
				})`gh ${args}`;

				process.exitCode = result.exitCode;
			} finally {
				await release(lockDirPath, statePath);
			}
		} else {
			const result = await execa({
				reject: false,
				stdin: 'inherit',
				stdout: 'inherit',
				stderr: 'inherit',
				env,
			})`gh ${args}`;

			process.exitCode = result.exitCode;
		}
	});

program.parse();
