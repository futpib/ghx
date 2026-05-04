import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test, { type ExecutionContext } from 'ava';
import { lock } from 'proper-lockfile';
import { acquire } from './fs-group-mutex.js';

function makeTemporaryDir(t: ExecutionContext): { metaLockPath: string; holdersDir: string } {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-group-mutex-test-'));
	t.teardown(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});
	const metaLockPath = path.join(dir, 'lock');
	fs.mkdirSync(metaLockPath);
	const holdersDir = path.join(dir, 'holders');
	return { metaLockPath, holdersDir };
}

const fastOptions = {
	retries: 5,
	retryMinTimeout: 10,
	retryMaxTimeout: 50,
	staleMs: 5000,
};

test('acquire and release for a single key', async t => {
	const { metaLockPath, holdersDir } = makeTemporaryDir(t);

	const handle = await acquire(metaLockPath, holdersDir, 'A', fastOptions);
	t.pass('acquired lock for A');

	await handle.release();
	t.pass('released lock for A');
});

test('multiple acquires for the same key', async t => {
	const { metaLockPath, holdersDir } = makeTemporaryDir(t);

	const h1 = await acquire(metaLockPath, holdersDir, 'A', fastOptions);
	const h2 = await acquire(metaLockPath, holdersDir, 'A', fastOptions);
	const h3 = await acquire(metaLockPath, holdersDir, 'A', fastOptions);
	t.pass('acquired lock 3 times for A');

	await h1.release();
	await h2.release();
	await h3.release();
	t.pass('released lock 3 times');
});

test('different key blocks until previous key is released', async t => {
	const { metaLockPath, holdersDir } = makeTemporaryDir(t);

	const a = await acquire(metaLockPath, holdersDir, 'A', fastOptions);

	const tryB = acquire(metaLockPath, holdersDir, 'B', {
		...fastOptions,
		retries: 2,
		retryMinTimeout: 10,
		retryMaxTimeout: 20,
	});

	await t.throwsAsync(tryB, { message: /Failed to acquire group mutex for key "B"/ });

	await a.release();
});

test('different key succeeds after previous key is fully released', async t => {
	const { metaLockPath, holdersDir } = makeTemporaryDir(t);

	const a = await acquire(metaLockPath, holdersDir, 'A', fastOptions);
	await a.release();

	const b = await acquire(metaLockPath, holdersDir, 'B', fastOptions);
	t.pass('acquired B after A was released');

	await b.release();
});

test('handle.release throws when called twice', async t => {
	const { metaLockPath, holdersDir } = makeTemporaryDir(t);

	const handle = await acquire(metaLockPath, holdersDir, 'A', fastOptions);
	await handle.release();

	await t.throwsAsync(handle.release(), { message: /already released/ });
});

test('concurrent acquires for the same key all succeed', async t => {
	const { metaLockPath, holdersDir } = makeTemporaryDir(t);

	const handles = await Promise.all([
		acquire(metaLockPath, holdersDir, 'A', fastOptions),
		acquire(metaLockPath, holdersDir, 'A', fastOptions),
		acquire(metaLockPath, holdersDir, 'A', fastOptions),
	]);

	t.pass('all 3 concurrent acquires succeeded');

	for (const handle of handles) {
		// eslint-disable-next-line no-await-in-loop
		await handle.release();
	}
});

test('different key waits and succeeds when first key is released concurrently', async t => {
	const { metaLockPath, holdersDir } = makeTemporaryDir(t);

	const a = await acquire(metaLockPath, holdersDir, 'A', fastOptions);

	const bPromise = acquire(metaLockPath, holdersDir, 'B', {
		...fastOptions,
		retries: 20,
		retryMinTimeout: 10,
		retryMaxTimeout: 50,
	});

	setTimeout(async () => {
		await a.release();
	}, 30);

	const b = await bPromise;
	t.pass('B acquired after A was released');

	await b.release();
});

test('stale holder from a dead process is reaped, allowing different key to acquire', async t => {
	const { metaLockPath, holdersDir } = makeTemporaryDir(t);

	// Simulate a holder that crashed: create the holder file and lock it,
	// but skip the heartbeat so the lock will appear stale.
	fs.mkdirSync(holdersDir, { recursive: true });
	const orphanPath = path.join(holdersDir, 'orphan');
	fs.writeFileSync(orphanPath, 'A');
	await lock(orphanPath, { stale: 2000, update: 2000, realpath: false });

	// Force the orphan's mtime into the past so it's considered stale.
	const past = new Date(Date.now() - 60_000);
	fs.utimesSync(`${orphanPath}.lock`, past, past);

	const b = await acquire(metaLockPath, holdersDir, 'B', {
		...fastOptions,
		staleMs: 2000,
	});
	t.pass('B acquired despite stale orphan holder for A');

	await b.release();
});
