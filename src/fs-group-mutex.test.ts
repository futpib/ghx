import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test, { type ExecutionContext } from 'ava';
import { acquire, release } from './fs-group-mutex.js';

function makeTemporaryDir(t: ExecutionContext): { lockDirPath: string; statePath: string } {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-group-mutex-test-'));
	t.teardown(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});
	const lockDirPath = path.join(dir, 'lock');
	fs.mkdirSync(lockDirPath);
	const statePath = path.join(dir, 'state.json');
	return { lockDirPath, statePath };
}

const fastOptions = {
	retries: 5,
	retryMinTimeout: 10,
	retryMaxTimeout: 50,
	staleMs: 5000,
};

test('acquire and release for a single key', async t => {
	const { lockDirPath, statePath } = makeTemporaryDir(t);

	await acquire(lockDirPath, statePath, 'A', fastOptions);
	t.pass('acquired lock for A');

	await release(lockDirPath, statePath, fastOptions);
	t.pass('released lock for A');
});

test('multiple acquires for the same key', async t => {
	const { lockDirPath, statePath } = makeTemporaryDir(t);

	await acquire(lockDirPath, statePath, 'A', fastOptions);
	await acquire(lockDirPath, statePath, 'A', fastOptions);
	await acquire(lockDirPath, statePath, 'A', fastOptions);
	t.pass('acquired lock 3 times for A');

	await release(lockDirPath, statePath, fastOptions);
	await release(lockDirPath, statePath, fastOptions);
	await release(lockDirPath, statePath, fastOptions);
	t.pass('released lock 3 times');
});

test('different key blocks until previous key is released', async t => {
	const { lockDirPath, statePath } = makeTemporaryDir(t);

	await acquire(lockDirPath, statePath, 'A', fastOptions);

	const tryB = acquire(lockDirPath, statePath, 'B', {
		...fastOptions,
		retries: 2,
		retryMinTimeout: 10,
		retryMaxTimeout: 20,
	});

	await t.throwsAsync(tryB, { message: /Failed to acquire group mutex for key "B"/ });

	await release(lockDirPath, statePath, fastOptions);
});

test('different key succeeds after previous key is fully released', async t => {
	const { lockDirPath, statePath } = makeTemporaryDir(t);

	await acquire(lockDirPath, statePath, 'A', fastOptions);
	await release(lockDirPath, statePath, fastOptions);

	await acquire(lockDirPath, statePath, 'B', fastOptions);
	t.pass('acquired B after A was released');

	await release(lockDirPath, statePath, fastOptions);
});

test('release with zero refcount throws', async t => {
	const { lockDirPath, statePath } = makeTemporaryDir(t);

	await t.throwsAsync(
		release(lockDirPath, statePath, fastOptions),
		{ message: /refcount is already 0/ },
	);
});

test('concurrent acquires for the same key all succeed', async t => {
	const { lockDirPath, statePath } = makeTemporaryDir(t);

	await Promise.all([
		acquire(lockDirPath, statePath, 'A', fastOptions),
		acquire(lockDirPath, statePath, 'A', fastOptions),
		acquire(lockDirPath, statePath, 'A', fastOptions),
	]);

	t.pass('all 3 concurrent acquires succeeded');

	await release(lockDirPath, statePath, fastOptions);
	await release(lockDirPath, statePath, fastOptions);
	await release(lockDirPath, statePath, fastOptions);
});

test('different key waits and succeeds when first key is released concurrently', async t => {
	const { lockDirPath, statePath } = makeTemporaryDir(t);

	await acquire(lockDirPath, statePath, 'A', fastOptions);

	const bPromise = acquire(lockDirPath, statePath, 'B', {
		...fastOptions,
		retries: 20,
		retryMinTimeout: 10,
		retryMaxTimeout: 50,
	});

	setTimeout(async () => {
		await release(lockDirPath, statePath, fastOptions);
	}, 30);

	await bPromise;
	t.pass('B acquired after A was released');

	await release(lockDirPath, statePath, fastOptions);
});
