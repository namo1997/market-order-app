import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

// Local Mac tooling only; Production server does not import this module.
export const storage = await import(pathToFileURL(path.join(os.homedir(), '.solao-tools', 'ssd-workspace.mjs')).href);
export const paths = storage.projectPaths('line-bill-capture');
