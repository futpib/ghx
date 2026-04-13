import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test, { type ExecutionContext } from 'ava';
import { acquireShared, releaseShared } from './fs-rwlock.js';

function makeTemporaryDir(t: ExecutionContext): { lockDirPath: string; statePath: string } {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-rwlock-test-'));
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

	await acquireShared(lockDirPath, statePath, 'A', fastOptions);
	t.pass('acquired lock for A');

	await releaseShared(lockDirPath, statePath, fastOptions);
	t.pass('released lock for A');
});

test('multiple acquires for the same key', async t => {
	const { lockDirPath, statePath } = makeTemporaryDir(t);

	await acquireShared(lockDirPath, statePath, 'A', fastOptions);
	await acquireShared(lockDirPath, statePath, 'A', fastOptions);
	await acquireShared(lockDirPath, statePath, 'A', fastOptions);
	t.pass('acquired lock 3 times for A');

	await releaseShared(lockDirPath, statePath, fastOptions);
	await releaseShared(lockDirPath, statePath, fastOptions);
	await releaseShared(lockDirPath, statePath, fastOptions);
	t.pass('released lock 3 times');
});

test('different key blocks until previous key is released', async t => {
	const { lockDirPath, statePath } = makeTemporaryDir(t);

	await acquireShared(lockDirPath, statePath, 'A', fastOptions);

	const tryB = acquireShared(lockDirPath, statePath, 'B', {
		...fastOptions,
		retries: 2,
		retryMinTimeout: 10,
		retryMaxTimeout: 20,
	});

	await t.throwsAsync(tryB, { message: /Failed to acquire shared lock for key "B"/ });

	await releaseShared(lockDirPath, statePath, fastOptions);
});

test('different key succeeds after previous key is fully released', async t => {
	const { lockDirPath, statePath } = makeTemporaryDir(t);

	await acquireShared(lockDirPath, statePath, 'A', fastOptions);
	await releaseShared(lockDirPath, statePath, fastOptions);

	await acquireShared(lockDirPath, statePath, 'B', fastOptions);
	t.pass('acquired B after A was released');

	await releaseShared(lockDirPath, statePath, fastOptions);
});

test('release with zero refcount throws', async t => {
	const { lockDirPath, statePath } = makeTemporaryDir(t);

	await t.throwsAsync(
		releaseShared(lockDirPath, statePath, fastOptions),
		{ message: /refcount is already 0/ },
	);
});

test('concurrent acquires for the same key all succeed', async t => {
	const { lockDirPath, statePath } = makeTemporaryDir(t);

	await Promise.all([
		acquireShared(lockDirPath, statePath, 'A', fastOptions),
		acquireShared(lockDirPath, statePath, 'A', fastOptions),
		acquireShared(lockDirPath, statePath, 'A', fastOptions),
	]);

	t.pass('all 3 concurrent acquires succeeded');

	await releaseShared(lockDirPath, statePath, fastOptions);
	await releaseShared(lockDirPath, statePath, fastOptions);
	await releaseShared(lockDirPath, statePath, fastOptions);
});

test('different key waits and succeeds when first key is released concurrently', async t => {
	const { lockDirPath, statePath } = makeTemporaryDir(t);

	await acquireShared(lockDirPath, statePath, 'A', fastOptions);

	const bPromise = acquireShared(lockDirPath, statePath, 'B', {
		...fastOptions,
		retries: 20,
		retryMinTimeout: 10,
		retryMaxTimeout: 50,
	});

	setTimeout(async () => {
		await releaseShared(lockDirPath, statePath, fastOptions);
	}, 30);

	await bPromise;
	t.pass('B acquired after A was released');

	await releaseShared(lockDirPath, statePath, fastOptions);
});
