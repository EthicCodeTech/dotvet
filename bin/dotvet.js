#!/usr/bin/env node

import { run } from '../src/cli.js';

const exitCode = run(process.argv.slice(2), process.cwd());
process.exit(exitCode);
