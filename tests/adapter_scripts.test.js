import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADAPTERS_DIR = path.resolve(__dirname, '../clis/taobao');
const INSTALLED_DIR = process.env.TAOBAO_ADAPTER_DEST || path.join(os.homedir(), '.opencli/clis/taobao');

function fileHash(fp) {
  if (!fs.existsSync(fp)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex');
}

describe('opencli-plugin-taobao Adapter Contracts & Injected Script Syntax', () => {
  const files = fs.readdirSync(ADAPTERS_DIR).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));

  test('has all expected Taobao adapters including new parity commands', () => {
    const expected = [
      'bought-shops.js',
      'chat.js',
      'detail.js',
      'export.js',
      'favorites.js',
      'image-search.js',
      'market.js',
      'orders.js',
      'questions.js',
      'reason.js',
      'resolve-link.js',
      'sessions.js',
      'shop.js',
      'similar.js',
      'suggest.js',
      'sync.js',
    ];
    for (const f of expected) {
      assert.ok(files.includes(f), `Missing Taobao adapter: ${f}`);
    }
  });

  test('every adapter exports valid JS syntax, cli() contract, and parseable page.evaluate scripts', () => {
    for (const file of files) {
      const fullPath = path.join(ADAPTERS_DIR, file);
      execFileSync(process.execPath, ['--check', fullPath]);

      const code = fs.readFileSync(fullPath, 'utf-8');
      assert.match(code, /cli\(\s*\{/, `${file} must declare cli({...})`);
      assert.match(code, /site:\s*['"]taobao['"]/, `${file} must declare site: 'taobao'`);

      const staticEvalRegex = /page\.evaluate\(\s*`([^`$]+)`\s*\)/g;
      let m;
      while ((m = staticEvalRegex.exec(code)) !== null) {
        assert.doesNotThrow(() => new vm.Script(m[1]), `Syntax error in static page.evaluate inside ${file}`);
      }
    }
  });

  test('installed runtime adapters match source byte-for-byte when ~/.opencli/clis/taobao exists', (t) => {
    if (!fs.existsSync(INSTALLED_DIR)) {
      t.skip(`Runtime adapter dir absent (CI/clean env): ${INSTALLED_DIR}`);
      return;
    }
    for (const file of files) {
      const srcHash = fileHash(path.join(ADAPTERS_DIR, file));
      const destHash = fileHash(path.join(INSTALLED_DIR, file));
      assert.equal(
        destHash,
        srcHash,
        `Taobao adapter drift detected in ${file}! Reconcile clis/taobao/${file} and ${INSTALLED_DIR}/${file}`
      );
    }
  });
});
