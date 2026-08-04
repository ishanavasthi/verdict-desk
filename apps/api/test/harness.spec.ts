import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const HARNESS_PATH = path.join(__dirname, '..', 'src', 'sandbox', 'harness', 'harness.js');

describe('harness.js (trusted in-container entrypoint)', () => {
  it('exists at the expected path', () => {
    expect(fs.existsSync(HARNESS_PATH)).toBe(true);
  });

  it('is syntactically valid JS (node --check)', () => {
    // Throws if the syntax is invalid; the DB/Docker-free CI runner still has `node`.
    expect(() => execFileSync('node', ['--check', HARNESS_PATH], { stdio: 'pipe' })).not.toThrow();
  });

  it('is dependency-free CommonJS: only requires Node core modules', () => {
    const src = fs.readFileSync(HARNESS_PATH, 'utf8');
    const requireCalls = [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    expect(requireCalls.length).toBeGreaterThan(0);
    const CORE_MODULES = new Set(['child_process', 'fs', 'path']);
    for (const mod of requireCalls) {
      expect(CORE_MODULES.has(mod)).toBe(true);
    }
  });

  it('never imports anything outside Node core (no relative or npm-package requires)', () => {
    const src = fs.readFileSync(HARNESS_PATH, 'utf8');
    expect(src).not.toMatch(/require\(\s*['"]\./);
    expect(src).not.toContain('import ');
  });
});
