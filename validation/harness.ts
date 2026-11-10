/**
 * Minimal test harness (no external test framework needed).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Injected by Vite at build time; defined here for the Node tests.
(globalThis as Record<string, unknown>).__APP_VERSION__ = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

type Fn = () => void | Promise<void>;
const tests: { name: string; fn: Fn }[] = [];

export function test(name: string, fn: Fn): void {
  tests.push({ name, fn });
}

/** Asserts that `fn` throws an error whose message carries `MRM_ERR:<code>`. */
export function throwsCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (e: unknown) => e instanceof Error && e.message.startsWith(`MRM_ERR:${code}`), `expected MRM_ERR:${code}`);
}

export function close(a: number, b: number, tol: number, msg?: string): void {
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} != ${b} (tol ${tol})`);
}

export async function run(): Promise<void> {
  let failed = 0;
  for (const t of tests) {
    const t0 = Date.now();
    try {
      await t.fn();
      console.log(`  ok   ${t.name} (${Date.now() - t0} ms)`);
    } catch (e) {
      failed++;
      console.log(`  FAIL ${t.name}\n       ${e instanceof Error ? e.message.split('\n').join('\n       ') : e}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} tests passed`);
  if (failed) process.exitCode = 1;
}

export { assert };
