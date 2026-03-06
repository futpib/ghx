#!/usr/bin/env node

import process from 'node:process';
import {program} from 'commander';
import {execa} from 'execa';

program
	.name('ghx')
	.description('gh wrapper')
	.allowUnknownOption()
	.allowExcessArguments()
	.enablePositionalOptions()
	.passThroughOptions()
	.argument('[args...]')
	.action(async (args: string[]) => {
		const result = await execa({
			reject: false,
			stdin: 'inherit',
			stdout: 'inherit',
			stderr: 'inherit',
		})`gh ${args}`;

		process.exitCode = result.exitCode;
	});

program.parse();
