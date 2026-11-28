import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MARKET_PATH = path.resolve(__dirname, '../clis/taobao/market.js');
const DETAIL_PATH = path.resolve(__dirname, '../clis/taobao/detail.js');

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

describe('Taobao Market Multi-Page Card Extraction & Structured Reviews', () => {
  test('market.js extracts item_id from id="item_id_..." and simba-wrapped cards without losing top sellers', async () => {
    const mod = await importAdapterWithStubs(MARKET_PATH);
    assert.ok(mod.__test__?.extractItemIdFromAttrs, 'market.js must export __test__.extractItemIdFromAttrs');

    assert.equal(
      mod.__test__.extractItemIdFromAttrs({
        id: 'item_id_877299695054',
        href: 'https://click.simba.taobao.com/cc_im?p=test&k=2849',
      }),
      '877299695054'
    );
    assert.equal(
      mod.__test__.extractItemIdFromAttrs({
        spmActId: '1064203964361',
        href: 'https://click.simba.taobao.com/cc_im?p=test',
      }),
      '1064203964361'
    );
    assert.equal(
      mod.__test__.extractItemIdFromAttrs({
        href: 'https://detail.tmall.com/item.htm?id=998877665544&ns=1',
      }),
      '998877665544'
    );

    assert.equal(
      mod.__test__.normalizeMarketItemUrl('https://click.simba.taobao.com/cc_im?foo=bar', '877299695054'),
      'https://item.taobao.com/item.htm?id=877299695054'
    );
    assert.equal(
      mod.__test__.normalizeMarketItemUrl('https://detail.tmall.com/item.htm?id=998877665544&ns=1', '998877665544'),
      'https://detail.tmall.com/item.htm?id=998877665544'
    );

    const src = fs.readFileSync(MARKET_PATH, 'utf-8');
    assert.match(src, /\[id\^="item_id_"\]/, 'market.js must scan id^="item_id_" cards');
    assert.match(src, /button\.next-pagination-item\.next-next/, 'market.js must target real Taobao next-page button');
  });

  test('detail.js parses structured rateVO.group.items cleanly without leaking date strings as content', async () => {
    const mod = await importAdapterWithStubs(DETAIL_PATH);
    assert.ok(mod.__test__?.parseRateVoReviews, 'detail.js must export __test__.parseRateVoReviews');

    const reviews = mod.__test__.parseRateVoReviews({
      totalCount: '53',
      group: {
        items: [
          {
            dateTime: '2026-09-08',
            userName: 'mock_buyer_a',
            content: '音质清晰，耳返无延迟',
            skuInfo: '已购 黑色 Type-C 标配',
            images: ['//img.alicdn.com/imgextra/mock_pic.jpg_400x400.jpg'],
          },
          {
            dateTime: '2026-03-28',
            userName: 'mock_buyer_b',
            content: '挺好的',
            skuInfo: '已购 白色 Type-C',
          },
        ],
      },
    });

    assert.equal(reviews.length, 2);
    assert.equal(reviews[0].content, '音质清晰，耳返无延迟');
    assert.equal(reviews[0].sku, '黑色 Type-C 标配');
    assert.equal(reviews[0].photos[0], 'https://img.alicdn.com/imgextra/mock_pic.jpg');
    assert.equal(reviews[1].content, '挺好的');
  });
});
