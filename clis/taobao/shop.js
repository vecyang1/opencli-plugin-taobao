import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError } from '@jackwener/opencli/errors';

function resolveShopTargetUrl(input, options = {}) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('请提供淘宝店铺 URL、shopId 或 sellerId');
  let baseUrl = '';
  if (/^https?:\/\//i.test(raw)) {
    const parsed = new URL(raw);
    if (!/(?:^|\.)(?:taobao|tmall)\.com$/i.test(parsed.hostname)) {
      throw new Error('仅支持淘宝或天猫店铺链接: ' + parsed.hostname);
    }
    baseUrl = `${parsed.origin}`;
  } else if (/^shop\d+/i.test(raw)) {
    baseUrl = `https://${raw.toLowerCase()}.taobao.com`;
  } else if (/^\d{5,16}$/.test(raw)) {
    baseUrl = `https://shop${raw}.taobao.com`;
  } else if (/^[a-z0-9-]+$/i.test(raw)) {
    baseUrl = `https://${raw}.tmall.com`;
  } else {
    throw new Error('无法解析的店铺标识: ' + raw);
  }

  const u = new URL(`${baseUrl}/search.htm`);
  const sort = String(options.sort || 'default').toLowerCase();
  if (sort === 'sales' || sort === 'sale-desc') u.searchParams.set('orderType', 'hotsell_desc');
  else if (sort === 'new') u.searchParams.set('orderType', 'newOn_desc');
  else if (sort === 'price_asc' || sort === 'price-asc') u.searchParams.set('orderType', 'price_asc');
  else if (sort === 'price_desc' || sort === 'price-desc') u.searchParams.set('orderType', 'price_desc');
  if (options.keyword) u.searchParams.set('keyword', String(options.keyword));
  const pageNum = Number.parseInt(String(options.page || 1), 10);
  if (Number.isFinite(pageNum) && pageNum > 1) u.searchParams.set('pageNo', String(pageNum));
  return u.toString();
}

export const command = cli({
  site: 'taobao',
  name: 'shop',
  access: 'read',
  description: '获取淘宝/天猫店铺信息与全店商品列表（对标 OneBound seller_info / item_search_shop 与 JustOneAPI Shop Detail / Product List）',
  domain: 'shop.taobao.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'input', positional: true, required: true, help: '店铺 URL、shopId（如 shop123456）或店铺子域名（如 anker）' },
    { name: 'keyword', required: false, help: '店内搜索关键词' },
    { name: 'sort', default: 'default', help: '排序: default (综合), sales (销量), new (上新), price-asc (价格升序), price-desc (价格降序)' },
    { name: 'pages', type: 'int', default: 1, help: '抓取页数（默认 1，最多 10）' },
    { name: 'limit', type: 'int', default: 24, help: '返回商品数量上限（默认 24）' },
  ],
  columns: ['item_id', 'title', 'price', 'sales', 'shop_name', 'shop_fans', 'url'],
  func: async (page, kwargs) => {
    const maxPages = Math.min(Math.max(Number.parseInt(String(kwargs.pages || 1), 10) || 1, 1), 10);
    const limit = Math.min(Math.max(Number.parseInt(String(kwargs.limit || 24), 10) || 24, 1), 200);
    const seenIds = new Set();
    const rows = [];

    for (let p = 1; p <= maxPages && rows.length < limit; p += 1) {
      const targetUrl = resolveShopTargetUrl(kwargs.input, {
        sort: kwargs.sort || 'default',
        keyword: kwargs.keyword || '',
        page: p,
      });

      await page.goto(targetUrl);
      await page.wait(4.0);
      await page.evaluate(`window.scrollTo(0, 1000)`);
      await page.wait(1.5);

      const status = await page.evaluate(`
        (() => {
          const href = location.href || '';
          const text = document.body ? (document.body.innerText || '') : '';
          if (href.includes('login.taobao.com') || text.includes('亲，请登录')) return 'login';
          if (href.includes('sec.taobao.com') || document.querySelector('#nc_1_wrapper')) return 'blocked';
          return 'ok';
        })()
      `);
      if (status === 'login') throw new AuthRequiredError('taobao.com', '查看店铺商品列表需要已登录的淘宝会话');
      if (status === 'blocked') throw new Error('CAPTCHA_REQUIRED: 触发淘宝安全滑块验证，请先在浏览器完成验证');

      const payload = await page.evaluate(`
        (() => {
          const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
          const bodyText = document.body ? (document.body.innerText || '') : '';
          const titleClean = clean(document.title.replace(/^首页[-_—]?/, '').replace(/[-_—](?:天猫Tmall\\.com|淘宝网).*$/, ''));
          const shopName = clean((document.querySelector('.shop-name, .slogo-shopname, [class*="shopName"]') || {}).innerText || '') || titleClean;
          const fansMatch = bodyText.match(/([0-9.]+\\s*万?粉丝)/);
          const shopFans = fansMatch ? clean(fansMatch[1]) : '';
          const links = Array.from(document.querySelectorAll('a[href*="item.htm?id="], a[href*="item.taobao.com/item.htm"], a[href*="detail.tmall.com/item.htm"]'));
          const items = [];
          const seen = new Set();
          for (const a of links) {
            const href = a.href || a.getAttribute('href') || '';
            const m = href.match(/[?&]id=(\\d+)/);
            if (!m) continue;
            const id = m[1];
            if (seen.has(id)) continue;
            seen.add(id);
            const card = a.closest('dl, li, .item, [class*="item"], [class*="card"]') || a.parentElement;
            const rawText = card ? card.innerText : a.innerText;
            const text = clean(rawText).replace(/([¥￥])\\s+(\\d+)\\s*\\.\\s*(\\d+)/g, '$1$2.$3').replace(/([¥￥])\\s+(\\d+)/g, '$1$2');
            const titleEl = card ? card.querySelector('.item-name, [class*="title"], a[title]') : null;
            const title = clean((titleEl && (titleEl.getAttribute('title') || titleEl.innerText)) || a.getAttribute('title') || a.innerText);
            const priceMatch = text.match(/[¥￥](\\d+(?:\\.\\d+)?)/);
            const salesMatch = text.match(/(?:已售|月销|付款)?\\s*(\\d+(?:\\.\\d+)?\\s*万?\\+?\\s*(?:人付款|笔|件)?)/);
            items.push({
              item_id: id,
              title: title.slice(0, 140),
              price: priceMatch ? priceMatch[1] : '',
              sales: salesMatch ? clean(salesMatch[0]) : '',
              shop_name: shopName,
              shop_fans: shopFans,
              url: 'https://item.taobao.com/item.htm?id=' + id,
            });
          }
          return { shopName, items };
        })()
      `);

      const pageItems = Array.isArray(payload?.items) ? payload.items : [];
      if (pageItems.length === 0) break;
      let added = 0;
      for (const it of pageItems) {
        if (!seenIds.has(it.item_id)) {
          seenIds.add(it.item_id);
          rows.push(it);
          added += 1;
          if (rows.length >= limit) break;
        }
      }
      if (added === 0) break;
    }

    return rows.slice(0, limit);
  },
});

export const __test__ = {
  resolveShopTargetUrl,
};
