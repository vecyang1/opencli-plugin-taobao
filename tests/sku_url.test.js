import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DETAIL_PATH = path.resolve(__dirname, '../clis/taobao/detail.js');
const RESOLVE_LINK_PATH = path.resolve(__dirname, '../clis/taobao/resolve-link.js');

// Load an OpenCLI adapter in plain Node/CI without requiring @jackwener/opencli installed.
async function importAdapterWithStubs(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const stubbed = raw
    .replace(
      /import\s+\{[^}]*\}\s+from\s+['"]@jackwener\/opencli\/registry['"];?/g,
      'const Strategy = { COOKIE: "cookie", PUBLIC: "public" }; const cli = (cfg) => cfg;'
    )
    .replace(
      /import\s+\{[^}]*\}\s+from\s+['"]@jackwener\/opencli\/errors['"];?/g,
      'class AuthRequiredError extends Error {} class CliError extends Error {}'
    );
  const dataUrl = `data:text/javascript;base64,${Buffer.from(stubbed, 'utf-8').toString('base64')}`;
  return await import(dataUrl);
}

describe('Taobao/Tmall SKU-Pinned URL Contract (default skuId inclusion)', () => {
  test('detail.js source wires SKU-pinned URL enrichment into both top-level url and sku_variants', () => {
    const src = fs.readFileSync(DETAIL_PATH, 'utf-8');
    assert.match(src, /skuId=/, 'detail.js must construct SKU-pinned URLs with skuId=');
    assert.match(src, /selected_sku_id/, 'detail.js must expose selected_sku_id');
    assert.match(src, /base_url/, 'detail.js must expose base_url alongside SKU-pinned url');
  });

  test('detail.js __test__.enrichDetailWithSkuUrls pins skuId on every real variant and top-level url by default', async () => {
    const mod = await importAdapterWithStubs(DETAIL_PATH);
    assert.ok(mod.__test__?.enrichDetailWithSkuUrls, 'detail.js must export __test__.enrichDetailWithSkuUrls');

    const rawDetail = {
      item_id: '1087715941693',
      title: '测试主机 2026款',
      price: 6800,
      page_url: 'https://item.taobao.com/item.htm?id=1087715941693',
      sku_variants: [
        { index: 0, sku_id: '6141804324430', name: '标配 16G+512G', price: 6800, quantity: 5, is_accessory: false, is_core_product: true, disabled: false, has_real_sku_id: true },
        { index: 1, sku_id: '6141804324446', name: '高配 48G+1T', price: 19200, quantity: 4, is_accessory: false, is_core_product: true, disabled: false, has_real_sku_id: true },
        { index: 2, sku_id: '6141804324447', name: '缺货 64G+1T', price: 21500, quantity: 0, is_accessory: false, is_core_product: true, disabled: true, has_real_sku_id: true },
      ],
    };

    // 1. Default (no explicit skuId): pins default in-stock core SKU and gives every variant its exact SKU URL
    const enriched = mod.__test__.enrichDetailWithSkuUrls(rawDetail, { itemId: '1087715941693' });
    assert.equal(enriched.base_url, 'https://item.taobao.com/item.htm?id=1087715941693');
    assert.equal(enriched.selected_sku_id, '6141804324430');
    assert.equal(enriched.url, 'https://item.taobao.com/item.htm?id=1087715941693&skuId=6141804324430');
    assert.equal(enriched.sku_variants[1].url, 'https://item.taobao.com/item.htm?id=1087715941693&skuId=6141804324446');
    assert.equal('has_real_sku_id' in enriched.sku_variants[0], false, 'internal flag must be stripped from output');

    // 2. Explicit skuId (from URL or --sku): top-level url pins requested SKU
    const pinned = mod.__test__.enrichDetailWithSkuUrls(rawDetail, {
      itemId: '1087715941693',
      requestedUrl: 'https://item.taobao.com/item.htm?id=1087715941693&skuId=6141804324446',
    });
    assert.equal(pinned.selected_sku_id, '6141804324446');
    assert.equal(pinned.url, 'https://item.taobao.com/item.htm?id=1087715941693&skuId=6141804324446');

    // 3. Tmall host preservation
    const tmallRaw = {
      item_id: '1077385258123',
      title: '测试天猫旗舰主机',
      price: 18499,
      page_url: 'https://detail.tmall.com/item.htm?id=1077385258123&skuId=6129668936690',
      sku_variants: [
        { index: 0, sku_id: '6129668936690', name: '银色', price: 18499, quantity: 200, is_accessory: false, is_core_product: true, disabled: false, has_real_sku_id: true },
      ],
    };
    const tmallEnriched = mod.__test__.enrichDetailWithSkuUrls(tmallRaw, { itemId: '1077385258123' });
    assert.equal(tmallEnriched.base_url, 'https://detail.tmall.com/item.htm?id=1077385258123');
    assert.equal(tmallEnriched.url, 'https://detail.tmall.com/item.htm?id=1077385258123&skuId=6129668936690');
    assert.equal(tmallEnriched.sku_variants[0].url, 'https://detail.tmall.com/item.htm?id=1077385258123&skuId=6129668936690');

    // 4. Non-SKU prop fallback (has_real_sku_id: false) must NOT fabricate bogus skuId from vid
    const fallbackRaw = {
      item_id: '998877665544',
      title: '测试无skuBase商品',
      price: 199,
      page_url: 'https://item.taobao.com/item.htm?id=998877665544',
      sku_variants: [
        { index: 0, sku_id: '123', name: '白色', price: 199, is_accessory: false, is_core_product: true, disabled: false, has_real_sku_id: false },
      ],
    };
    const fallbackEnriched = mod.__test__.enrichDetailWithSkuUrls(fallbackRaw, { itemId: '998877665544' });
    assert.equal(fallbackEnriched.selected_sku_id, null);
    assert.equal(fallbackEnriched.url, 'https://item.taobao.com/item.htm?id=998877665544');
    assert.equal(fallbackEnriched.sku_variants[0].url, 'https://item.taobao.com/item.htm?id=998877665544');
  });

  test('resolve-link.js preserves skuId and Tmall host when present in resolved URL', async () => {
    const mod = await importAdapterWithStubs(RESOLVE_LINK_PATH);
    const tb = mod.__test__.extractCanonicalItem('https://item.taobao.com/item.htm?id=1087715941693&skuId=6141804324446&spm=a21n57');
    assert.equal(tb.item_id, '1087715941693');
    assert.equal(tb.sku_id, '6141804324446');
    assert.equal(tb.canonical_url, 'https://item.taobao.com/item.htm?id=1087715941693&skuId=6141804324446');

    const tmall = mod.__test__.extractCanonicalItem('https://detail.tmall.com/item.htm?id=1077385258123&skuId=6129668936690');
    assert.equal(tmall.canonical_url, 'https://detail.tmall.com/item.htm?id=1077385258123&skuId=6129668936690');
    assert.equal(tmall.sku_id, '6129668936690');

    const bare = mod.__test__.extractCanonicalItem('https://item.taobao.com/item.htm?id=1087715941693');
    assert.equal(bare.canonical_url, 'https://item.taobao.com/item.htm?id=1087715941693');
    assert.equal(bare.sku_id, null);
  });
});
