import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { lock, unlock, check } from 'proper-lockfile';

export type GroupMutexOptions = {
	staleMs?: number;
	retries?: number;
	retryMinTimeout?: number;
	retryMaxTimeout?: number;
};

export type GroupMutexHandle = {
	release: () => Promise<void>;
};

const defaults = {
	staleMs: 10_000,
	retries: 10,
	retryMinTimeout: 100,
	retryMaxTimeout: 5000,
};

async function withMetaLock<T>(
	metaLockPath: string,
	options: GroupMutexOptions,
	fn: () => T | Promise<T>,
): Promise<T> {
	await lock(metaLockPath, {
		retries: {
			retries: options.retries ?? defaults.retries,
			minTimeout: options.retryMinTimeout ?? defaults.retryMinTimeout,
			maxTimeout: options.retryMaxTimeout ?? defaults.retryMaxTimeout,
		},
		stale: options.staleMs ?? defaults.staleMs,
		realpath: false,
	});
	try {
		return await fn();
	} finally {
		await unlock(metaLockPath, { realpath: false });
	}
}

async function reapAndListLiveHolders(
	holdersDir: string,
	staleMs: number,
): Promise<Map<string, string>> {
	const live = new Map<string, string>();

	let entries: string[];
	try {
		entries = fs.readdirSync(holdersDir);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return live;
		}

		throw error;
	}

	for (const entry of entries) {
		// Skip proper-lockfile lock dirs; we list them via their owning file.
		if (entry.endsWith('.lock')) {
			continue;
		}

		const holderPath = path.join(holdersDir, entry);

		let isLocked: boolean;
		try {
			// eslint-disable-next-line no-await-in-loop
			isLocked = await check(holderPath, {
				stale: staleMs,
				realpath: false,
			});
		} catch {
			continue;
		}

		if (isLocked) {
			let key: string;
			try {
				key = fs.readFileSync(holderPath, 'utf8');
			} catch {
				continue;
			}

			live.set(holderPath, key);
		} else {
			fs.rmSync(`${holderPath}.lock`, { recursive: true, force: true });
			try {
				fs.unlinkSync(holderPath);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
					throw error;
				}
			}
		}
	}

	return live;
}

export async function acquire(
	metaLockPath: string,
	holdersDir: string,
	key: string,
	options: GroupMutexOptions = {},
): Promise<GroupMutexHandle> {
	const retries = options.retries ?? defaults.retries;
	const retryMinTimeout = options.retryMinTimeout ?? defaults.retryMinTimeout;
	const retryMaxTimeout = options.retryMaxTimeout ?? defaults.retryMaxTimeout;
	const staleMs = options.staleMs ?? defaults.staleMs;

	fs.mkdirSync(holdersDir, { recursive: true });

	for (let attempt = 0; ; attempt++) {
		// eslint-disable-next-line no-await-in-loop
		const holderPath = await withMetaLock(metaLockPath, options, async () => {
			const live = await reapAndListLiveHolders(holdersDir, staleMs);

			for (const liveKey of live.values()) {
				if (liveKey !== key) {
					return undefined;
				}
			}

			const myPath = path.join(holdersDir, randomUUID());
			fs.writeFileSync(myPath, key);
			try {
				await lock(myPath, { stale: staleMs, realpath: false });
			} catch (error) {
				try {
					fs.unlinkSync(myPath);
				} catch {}

				throw error;
			}

			return myPath;
		});

		if (holderPath) {
			let released = false;
			return {
				async release() {
					if (released) {
						throw new Error('Group mutex handle already released');
					}

					released = true;
					await withMetaLock(metaLockPath, options, async () => {
						try {
							await unlock(holderPath, { realpath: false });
						} catch {}

						try {
							fs.unlinkSync(holderPath);
						} catch (error) {
							if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
								throw error;
							}
						}
					});
				},
			};
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
