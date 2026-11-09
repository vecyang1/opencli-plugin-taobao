import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError } from '@jackwener/opencli/errors';

export const command = cli({
  site: 'taobao',
  name: 'market',
  access: 'read',
  description: '搜索淘宝全网在售商品进行市场调研与价格分析 (支持关键词、排序、多页翻页)',
  domain: 's.taobao.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'query', positional: true, required: true, help: '商品搜索关键词，例如: 背带裙、充电宝' },
    { name: 'pages', type: 'int', default: 1, help: '抓取页数 (默认 1 页，每页约 44 件商品)' },
    { name: 'limit', type: 'int', default: 44, help: '返回商品最大数量' },
    { name: 'all', type: 'bool', default: false, help: '是否深度翻页抓取 (最多抓取 10 页)' },
    { name: 'sort', required: false, help: '排序规则: default (综合), sale-desc (销量高到低), price-asc (价格低到高), price-desc (价格高到低)' },
    { name: 'tab', required: false, help: '频道筛选: all (所有宝贝), mall (天猫)' },
  ],
  columns: [
    'item_id',
    'title',
    'price',
    'sales',
    'shop',
    'location',
    'badges',
    'url',
  ],
  func: async (page, kwargs) => {
    const query = String(kwargs.query || '').trim();
    if (!query) {
      throw new Error('请提供搜索关键词');
    }

    const maxPages = kwargs.all ? 10 : Math.max(1, Math.min(kwargs.pages || 1, 10));
    const limit = kwargs.all ? 500 : Math.max(1, Math.min(kwargs.limit || 44, 500));

    let sortParam = '';
    if (kwargs.sort === 'sale-desc' || kwargs.sort === 'sales') {
      sortParam = '&sort=sale-desc';
    } else if (kwargs.sort === 'price-asc') {
      sortParam = '&sort=price-asc';
    } else if (kwargs.sort === 'price-desc') {
      sortParam = '&sort=price-desc';
    }

    let tabParam = '';
    if (kwargs.tab === 'mall' || kwargs.tab === 'tmall') {
      tabParam = '&tab=mall';
    }

    const searchUrl = 'https://s.taobao.com/search?q=' + encodeURIComponent(query) + sortParam + tabParam;
    await page.goto(searchUrl);
    await page.wait(4);

    const isAuth = await page.evaluate(`
      (() => {
        const text = document.body ? (document.body.innerText || '') : '';
        if (text.includes('登录') && !text.includes('所有宝贝') && !text.includes('综合')) {
          return false;
        }
        return true;
      })()
    `);

    if (!isAuth) {
      throw new AuthRequiredError('淘宝搜索市场数据需要已登录的浏览器会话');
    }

    const allItems = [];
    const seenIds = new Set();

    for (let p = 1; p <= maxPages; p++) {
      await page.evaluate(`
        (() => {
          window.scrollTo(0, document.body.scrollHeight / 2);
        })()
      `);
      await page.wait(1.5);
      await page.evaluate(`
        (() => {
          window.scrollTo(0, document.body.scrollHeight);
        })()
      `);
      await page.wait(2);

      const pageItems = await page.evaluate(`
        (() => {
          const results = [];
          const links = Array.from(document.querySelectorAll('a[href*="item.taobao.com/item.htm"], a[href*="detail.tmall.com/item.htm"]'));

          for (const a of links) {
            const href = a.getAttribute('href') || '';
            const idMatch = href.match(/[?&]id=(\\d+)/);
            if (!idMatch) continue;
            const itemId = idMatch[1];

            let card = a.closest('[class*="Card--"], [class*="item--"], [class*="doubleCardWrapper"], [class*="itemWrapper"]') || a.parentElement;
            for (let i = 0; i < 4 && card && card.innerText && card.innerText.length < 30; i++) {
              if (card.parentElement) card = card.parentElement;
            }

            const cardText = card ? card.innerText : a.innerText;
            if (!cardText || cardText.length < 10) continue;

            let title = '';
            const titleEl = card ? card.querySelector('[class*="title--"], [class*="Title--"], [class*="itemTitle"], h3, h4') : null;
            if (titleEl && titleEl.innerText.trim()) {
              title = titleEl.innerText.trim();
            } else {
              const lines = cardText.split('\\n').map(s => s.trim()).filter(Boolean);
              const textLines = lines.filter(l => !l.startsWith('¥') && !l.startsWith('￥') && !l.includes('人付款') && l.length > 5);
              title = textLines[0] || lines[0] || '';
            }

            let price = '0';
            const priceMatch = cardText.match(/[¥￥]\\s*([\\d.]+)/);
            if (priceMatch) {
              price = priceMatch[1];
            }

            let sales = '0人付款';
            const salesMatch = cardText.match(/(\\d+(?:\\.\\d+)?[万kw]?\\+?)人付款|(\\d+(?:\\.\\d+)?[万kw]?\\+?)人收货|已售\\s*(\\d+)/);
            if (salesMatch) {
              sales = salesMatch[0];
            }

            let shop = '淘宝店铺';
            const shopEl = card ? card.querySelector('[class*="ShopInfo--"], [class*="shopName--"], [class*="shop--"], a[href*="shop.taobao.com"], a[href*="store.taobao.com"]') : null;
            if (shopEl && shopEl.innerText.trim()) {
              shop = shopEl.innerText.trim();
            } else {
              const lines = cardText.split('\\n').map(s => s.trim()).filter(Boolean);
              const shopLine = lines.find(l => l.includes('旗舰店') || l.includes('专营店') || l.includes('企业店') || l.includes('达人店') || l.includes('老店') || l.includes('店'));
              if (shopLine) shop = shopLine;
            }

            let location = '';
            const locMatch = cardText.match(/(北京|上海|天津|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门)(?:\\s+[\\u4e00-\\u9fa5]+)?/);
            if (locMatch) {
              location = locMatch[0];
            }

            const badges = [];
            if (/双11/.test(cardText)) badges.push('双11');
            if (/退货宝/.test(cardText)) badges.push('退货宝');
            if (/包邮/.test(cardText)) badges.push('包邮');
            if (/官方立减/.test(cardText)) badges.push('官方立减');
            if (/ifashion/i.test(cardText)) badges.push('ifashion');
            if (/3期|免息/.test(cardText)) badges.push('分期免息');
            if (/公益宝贝/.test(cardText)) badges.push('公益宝贝');

            let detailUrl = href;
            if (detailUrl.startsWith('//')) detailUrl = 'https:' + detailUrl;
            else if (!detailUrl.startsWith('http')) detailUrl = 'https://item.taobao.com/item.htm?id=' + itemId;

            results.push({
              item_id: itemId,
              title: title.slice(0, 150),
              price: price,
              sales: sales,
              shop: shop,
              location: location,
              badges: badges.join(' | '),
              url: detailUrl,
            });
          }

          return results;
        })()
      `);

      for (const item of pageItems) {
        if (!seenIds.has(item.item_id)) {
          seenIds.add(item.item_id);
          allItems.push(item);
        }
      }

      if (allItems.length >= limit || p >= maxPages) break;

      const hasNext = await page.evaluate(`
        (() => {
          const nextBtn = document.querySelector('.ant-pagination-next button, .ant-pagination-next .ant-pagination-item-link, .next-pagination-item-link');
          const isDisabled = document.querySelector('.ant-pagination-next') ? document.querySelector('.ant-pagination-next').classList.contains('ant-pagination-disabled') : false;
          if (nextBtn && !isDisabled) {
            nextBtn.click();
            return true;
          }
          return false;
        })()
      `);

      if (!hasNext) break;
      await page.wait(3);
    }

    return allItems.slice(0, limit);
  },
});
