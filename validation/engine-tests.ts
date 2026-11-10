/**
 * Automated tests of the MRM engine and file formats (`npm test`).
 * They need no data files and run in a few seconds.
 */
import { run } from './harness';
import './tests-parsers';
import './tests-classify';
import './tests-pipeline';
import './tests-files';
import './tests-main';

console.log('MRM Analysis Tool: engine tests\n');
await run();
