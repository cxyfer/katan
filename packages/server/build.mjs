/** Bundles the service into a single ESM file for the runtime image. */
import { build } from 'esbuild';
import { serverBuildOptions } from './build-options.mjs';

await build(serverBuildOptions);
process.stdout.write(`built ${serverBuildOptions.outfile}\n`);
