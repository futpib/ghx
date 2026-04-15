import fs from 'node:fs';
import { lock, unlock } from 'proper-lockfile';

export type GroupMutexOptions = {
	staleMs?: number;
	retries?: number;
	retryMinTimeout?: number;
	retryMaxTimeout?: number;
};

type State = {
	key: string;
	refcount: number;
};

function readState(statePath: string): State {
	try {
		const content = fs.readFileSync(statePath, 'utf8');
		return JSON.parse(content) as State;
	} catch {
		return { key: '', refcount: 0 };
	}
}

function writeState(statePath: string, state: State): void {
	fs.writeFileSync(statePath, JSON.stringify(state));
}

async function withMetaLock<T>(
	lockDirPath: string,
	options: GroupMutexOptions,
	fn: () => T | Promise<T>,
): Promise<T> {
	await lock(lockDirPath, {
		retries: {
			retries: options.retries ?? 10,
			minTimeout: options.retryMinTimeout ?? 100,
			maxTimeout: options.retryMaxTimeout ?? 5000,
		},
		stale: options.staleMs ?? 10_000,
	});
	try {
		return await fn();
	} finally {
		await unlock(lockDirPath);
	}
}

export async function acquire(
	lockDirPath: string,
	statePath: string,
	key: string,
	options: GroupMutexOptions = {},
): Promise<void> {
	const retries = options.retries ?? 10;
	const retryMinTimeout = options.retryMinTimeout ?? 100;
	const retryMaxTimeout = options.retryMaxTimeout ?? 5000;

	for (let attempt = 0; ; attempt++) {
		// eslint-disable-next-line no-await-in-loop
		const acquired = await withMetaLock(lockDirPath, options, () => {
			const state = readState(statePath);

			if (state.refcount === 0 || state.key === key) {
				writeState(statePath, { key, refcount: state.refcount + 1 });
				return true;
			}

			return false;
		});

		if (acquired) {
			return;
		}

		if (attempt >= retries) {
			throw new Error(`Failed to acquire group mutex for key "${key}" after ${retries} retries`);
		}

		const timeout = Math.min(
			retryMaxTimeout,
			retryMinTimeout * (2 ** attempt),
		);
		// eslint-disable-next-line no-await-in-loop
		await new Promise(resolve => {
			setTimeout(resolve, timeout);
		});
	}
}

export async function release(
	lockDirPath: string,
	statePath: string,
	options: GroupMutexOptions = {},
): Promise<void> {
	await withMetaLock(lockDirPath, options, () => {
		const state = readState(statePath);

		if (state.refcount <= 0) {
			throw new Error('Cannot release: refcount is already 0');
		}

		writeState(statePath, {
			key: state.key,
			refcount: state.refcount - 1,
		});
	});
}
