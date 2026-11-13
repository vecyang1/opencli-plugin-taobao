import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError } from '@jackwener/opencli/errors';

export const command = cli({
  site: 'taobao',
  name: 'similar',
  access: 'read',
  description: '获取淘宝/天猫同款商品、相似款与看了又看推荐（对标 OneBound item_search_samestyle / similar / recommend）',
  domain: 'item.taobao.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'id', positional: true, required: true, help: '商品 ID 或淘宝/天猫商品链接' },
    { name: 'limit', type: 'int', default: 20, help: '返回推荐数量上限（默认 20）' },
  ],
  columns: ['rank', 'item_id', 'title', 'price', 'sales', 'shop', 'url'],
  func: async (page, kwargs) => {
    const rawId = String(kwargs.id || '').trim();
    const idMatch = rawId.match(/(\d{8,16})/);
    if (!idMatch) throw new Error('无效的商品 ID: ' + rawId);
    const sourceId = idMatch[1];
    const limit = Math.min(Math.max(Number.parseInt(String(kwargs.limit || 20), 10) || 20, 1), 60);

    await page.goto(`https://item.taobao.com/item.htm?id=${sourceId}`);
    await page.wait(3.0);

    const state = await page.evaluate(`
      (() => {
        const href = location.href || '';
        const text = document.body ? (document.body.innerText || '') : '';
        if (href.includes('login.taobao.com') || text.includes('亲，请登录')) return 'login';
        if (href.includes('sec.taobao.com') || document.querySelector('#nc_1_wrapper')) return 'blocked';
        return 'ok';
      })()
    `);
    if (state === 'login') throw new AuthRequiredError('taobao.com', '查看同款与相似推荐需要已登录的淘宝会话');
    if (state === 'blocked') throw new Error('CAPTCHA_REQUIRED: 触发淘宝安全验证');

    await page.evaluate(`
      (async () => {
        window.scrollTo(0, Math.min(3400, document.body.scrollHeight * 0.72));
        await new Promise((r) => setTimeout(r, 1000));
      })()
    `);
    await page.wait(1.0);

    const items = await page.evaluate(`
      (() => {
        const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
        const links = Array.from(document.querySelectorAll('a[href*="item.taobao.com/item.htm"], a[href*="detail.tmall.com/item.htm"]'));
        const seen = new Set([${JSON.stringify(sourceId)}]);
        const rows = [];
        for (const a of links) {
          const href = a.href || a.getAttribute('href') || '';
          const m = href.match(/[?&]id=(\\d+)/);
          if (!m) continue;
          const id = m[1];
          if (seen.has(id)) continue;
          seen.add(id);
          const card = a.closest('[class*="Card"], [class*="item"], li, div') || a.parentElement;
          const text = clean(card ? card.innerText : a.innerText);
          const title = clean(a.getAttribute('title') || a.innerText || (card ? card.innerText : ''));
          if (!title || title.length < 3) continue;
          const priceMatch = text.match(/[¥￥]\\s*(\\d+(?:\\.\\d+)?)/);
          const salesMatch = text.match(/(\\d+\\+?万?人付款|\\d+\\+?人收货)/);
          const shopEl = card ? card.querySelector('[class*="shop"], a[href*="shop"]') : null;
          rows.push({
            rank: rows.length + 1,
            item_id: id,
            title: title.slice(0, 140),
            price: priceMatch ? priceMatch[1] : '',
            sales: salesMatch ? salesMatch[1] : '',
            shop: clean(shopEl ? shopEl.innerText : ''),
            url: 'https://item.taobao.com/item.htm?id=' + id,
          });
          if (rows.length >= ${limit}) break;
        }
        return rows;
      })()
    `);

    return Array.isArray(items) ? items : [];
  },
});
