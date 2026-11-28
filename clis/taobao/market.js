import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError } from '@jackwener/opencli/errors';

function extractItemIdFromAttrs({ id = '', spmActId = '', dataNid = '', href = '' } = {}) {
  const candidates = [id, spmActId, dataNid];
  for (const raw of candidates) {
    const s = String(raw || '').trim();
    const m = s.match(/^(?:item_id_)?(\d{8,16})$/);
    if (m) return m[1];
  }
  const h = String(href || '');
  const hm = h.match(/[?&](?:id|item_id|itemId|nid)=(\d{8,16})/);
  return hm ? hm[1] : null;
}

function normalizeMarketItemUrl(rawHref, itemId) {
  const id = String(itemId || '').trim();
  const h = String(rawHref || '').trim();
  const normalized = h.startsWith('//') ? 'https:' + h : h;
  if (/^https?:\/\/(?:item\.taobao\.com|detail\.tmall\.com|detail\.tmall\.hk|chaoshi\.detail\.tmall\.com)\/item\.htm/i.test(normalized)) {
    try {
      const u = new URL(normalized);
      return `https://${u.hostname.toLowerCase()}/item.htm?id=${encodeURIComponent(id)}`;
    } catch {
      // fall through
    }
  }
  return `https://item.taobao.com/item.htm?id=${encodeURIComponent(id)}`;
}

export const command = cli({
  site: 'taobao',
  name: 'market',
  access: 'read',
  description: '搜索淘宝全网在售商品进行市场调研与价格分析 (默认多页翻页抓取，覆盖热卖榜与自然商品卡片，支持排序、价格区间与频道筛选)',
  domain: 's.taobao.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'query', positional: true, required: true, help: '商品搜索关键词，例如: 背带裙、充电宝' },
    { name: 'pages', type: 'int', required: false, help: '抓取页数 (默认按 limit 自动翻页，每页约 44-50 件商品)' },
    { name: 'limit', type: 'int', required: false, help: '返回商品最大数量 (默认 80，自动翻页)' },
    { name: 'max-pages', type: 'int', required: false, help: '最大翻页上限 (默认 10，支持 1-20)' },
    { name: 'all', type: 'bool', default: false, help: '是否深度翻页抓取 (最多抓取 10 页)' },
    { name: 'sort', required: false, help: '排序规则: default (综合), sale-desc (销量高到低), price-asc (价格低到高), price-desc (价格高到低)' },
    { name: 'tab', required: false, help: '频道筛选: all (所有宝贝), mall (天猫)' },
    { name: 'min-price', type: 'float', required: false, help: '最低价格筛选 (元)' },
    { name: 'max-price', type: 'float', required: false, help: '最高价格筛选 (元)' },
  ],
  columns: [
    'item_id',
    'title',
    'price',
    'sales',
    'shop',
    'location',
    'badges',
    'page',
    'url',
    'image_url',
  ],
  func: async (page, kwargs) => {
    const query = String(kwargs.query || '').trim();
    if (!query) {
      throw new Error('请提供搜索关键词');
    }

    const isAll = Boolean(kwargs.all);
    const rawLimit = (kwargs.limit !== undefined && kwargs.limit !== null && kwargs.limit !== '') ? Number(kwargs.limit) : NaN;
    const hasExplicitLimit = Number.isFinite(rawLimit) && rawLimit > 0;

    const rawPages = (kwargs.pages !== undefined && kwargs.pages !== null && kwargs.pages !== '') ? Number(kwargs.pages) : NaN;
    const hasExplicitPages = Number.isFinite(rawPages) && rawPages > 0;

    const rawMaxPages = (kwargs['max-pages'] !== undefined && kwargs['max-pages'] !== null && kwargs['max-pages'] !== '')
      ? Number(kwargs['max-pages'])
      : ((kwargs.maxPages !== undefined && kwargs.maxPages !== null && kwargs.maxPages !== '') ? Number(kwargs.maxPages) : NaN);
    const hasExplicitMaxPages = Number.isFinite(rawMaxPages) && rawMaxPages > 0;
    const maxPagesCap = hasExplicitMaxPages
      ? Math.max(1, Math.min(20, Math.floor(rawMaxPages)))
      : Math.min(20, Math.max(10, hasExplicitLimit ? Math.ceil(rawLimit / 25) : 10));

    let limit;
    let maxPages;

    if (isAll) {
      limit = Math.min(500, maxPagesCap * 50);
      maxPages = maxPagesCap;
    } else if (hasExplicitPages) {
      const p = Math.max(1, Math.min(Math.floor(rawPages), maxPagesCap));
      maxPages = p;
      limit = hasExplicitLimit ? Math.max(1, Math.floor(rawLimit)) : p * 48;
    } else if (hasExplicitLimit) {
      limit = Math.max(1, Math.floor(rawLimit));
      maxPages = maxPagesCap;
    } else {
      limit = 80;
      maxPages = Math.min(3, maxPagesCap);
    }

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

    const minPriceRaw = kwargs['min-price'] ?? kwargs.minPrice;
    const maxPriceRaw = kwargs['max-price'] ?? kwargs.maxPrice;
    const minPrice = (minPriceRaw !== undefined && minPriceRaw !== null && minPriceRaw !== '' && Number.isFinite(Number(minPriceRaw))) ? Number(minPriceRaw) : null;
    const maxPrice = (maxPriceRaw !== undefined && maxPriceRaw !== null && maxPriceRaw !== '' && Number.isFinite(Number(maxPriceRaw))) ? Number(maxPriceRaw) : null;

    let priceParam = '';
    if (minPrice !== null || maxPrice !== null) {
      priceParam = '&filter=reserve_price%5B' + (minPrice !== null ? minPrice : '') + '%2C' + (maxPrice !== null ? maxPrice : '') + '%5D';
    }

    const searchUrl = 'https://s.taobao.com/search?q=' + encodeURIComponent(query) + sortParam + tabParam + priceParam;
    await page.goto(searchUrl);
    await page.wait(3.5);

    const allItems = [];
    const seenIds = new Set();
    let consecutiveZeroNewPages = 0;

    for (let p = 1; p <= maxPages; p++) {
      const pageSecurityStatus = await page.evaluate(`
        (() => {
          const href = window.location.href || '';
          if (href.includes('login.taobao.com') || window.location.hostname.includes('login')) {
            return { error: 'AUTH_REQUIRED', message: '淘宝搜索市场数据需要已登录的浏览器会话' };
          }
          const text = document.body ? (document.body.innerText || '') : '';
          if (text.includes('亲，请登录') || (text.includes('登录') && !text.includes('所有宝贝') && !text.includes('综合'))) {
            return { error: 'AUTH_REQUIRED', message: '淘宝搜索市场数据需要已登录的浏览器会话' };
          }
          if (href.includes('sec.taobao.com') || text.includes('按住滑块') || text.includes('RGV587') || document.querySelector('#nc_1_wrapper, .nc-container')) {
            return { error: 'CAPTCHA_REQUIRED', message: '触发淘宝人机验证滑块，请在浏览器中滑动完成验证后重试' };
          }
          return null;
        })()
      `);

      if (pageSecurityStatus) {
        if (pageSecurityStatus.error === 'AUTH_REQUIRED') {
          throw new AuthRequiredError(pageSecurityStatus.message);
        }
        throw new Error('CAPTCHA_REQUIRED: ' + pageSecurityStatus.message);
      }

      for (const ratio of [0.25, 0.5, 0.75, 1.0]) {
        await page.evaluate(`
          (() => {
            window.scrollTo(0, Math.floor(document.body.scrollHeight * ${ratio}));
          })()
        `);
        await page.wait(0.55);
      }

      const pageItems = await page.evaluate(`
        (() => {
          const results = [];
          const seenInPage = new Set();

          function extractCard(node, explicitItemId, rawHref) {
            const itemId = explicitItemId;
            if (!itemId || seenInPage.has(itemId)) return;

            let card = node.matches && node.matches('[id^="item_id_"], [class*="doubleCardWrapper"], [class*="Card--"]')
              ? node
              : (node.closest('[id^="item_id_"], [class*="doubleCardWrapper"], [class*="Card--"], [class*="item--"], [class*="itemWrapper"]') || node.parentElement);
            for (let i = 0; i < 4 && card && card.innerText && card.innerText.length < 30; i++) {
              if (card.parentElement) card = card.parentElement;
            }

            const cardText = card ? card.innerText : (node.innerText || '');
            if (!cardText || cardText.length < 10) return;

            let title = '';
            const titleEl = card ? card.querySelector('[class*="title--"], [class*="Title--"], [class*="itemTitle"], h3, h4') : null;
            if (titleEl && titleEl.innerText.trim()) {
              title = titleEl.innerText.trim();
            } else {
              const lines = cardText.split('\\n').map(s => s.trim()).filter(Boolean);
              const textLines = lines.filter(l => !l.startsWith('¥') && !l.startsWith('￥') && !l.includes('人付款') && l.length > 5);
              title = textLines[0] || lines[0] || '';
            }
            if (!title) return;

            let price = '0';
            const intEl = card ? card.querySelector('[class*="priceInt--"], [class*="PriceInt--"]') : null;
            const floatEl = card ? card.querySelector('[class*="priceFloat--"], [class*="PriceFloat--"]') : null;
            if (intEl && intEl.innerText.trim()) {
              price = intEl.innerText.trim() + (floatEl ? floatEl.innerText.trim() : '');
            } else {
              const priceEl = card ? card.querySelector('[class*="priceWrapper--"], [class*="price--"], [class*="Price--"], [class*="mainPrice"]') : null;
              const textToMatch = priceEl ? priceEl.innerText : cardText;
              const priceMatch = textToMatch.match(/[¥￥]\\s*([\\d.]+)/);
              if (priceMatch) {
                price = priceMatch[1];
              }
            }

            let sales = '0人付款';
            const salesMatch = cardText.match(/(\\d+(?:\\.\\d+)?[万kw]?\\+?)\\s*人付款|(\\d+(?:\\.\\d+)?[万kw]?\\+?)\\s*人收货|已售\\s*(\\d+(?:\\.\\d+)?[万kw]?\\+?)/);
            if (salesMatch) {
              sales = salesMatch[0];
            }

            let shop = '淘宝店铺';
            const shopEl = card ? card.querySelector('[class*="shopNameText--"], [class*="ShopInfo--"], [class*="shopName--"], [class*="shop--"], a[href*="shop.taobao.com"], a[href*="store.taobao.com"]') : null;
            if (shopEl && shopEl.innerText.trim()) {
              shop = shopEl.innerText.trim();
            } else {
              const lines = cardText.split('\\n').map(s => s.trim()).filter(Boolean);
              const shopLine = lines.find(l => l.includes('旗舰店') || l.includes('专营店') || l.includes('企业店') || l.includes('达人店') || l.includes('老店') || l.includes('店'));
              if (shopLine) shop = shopLine;
            }
            shop = shop.replace(/^买过的店\\s*/, '').replace(/[\\r\\n]+/g, ' ').trim();

            let location = '';
            const locMatch = cardText.match(/(北京|上海|天津|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门)(?:[ \\t]+[\\u4e00-\\u9fa5]+)?/);
            if (locMatch) {
              location = locMatch[0].replace(/[\\r\\n]+/g, ' ').replace(/\\s*(包邮|官方立减|退货宝|双11|公益宝贝).*/g, '').trim();
            }

            const badges = [];
            if (/热卖|榜/.test(cardText)) badges.push('热卖榜');
            if (/百亿补贴/.test(cardText)) badges.push('百亿补贴');
            if (/双11/.test(cardText)) badges.push('双11');
            if (/退货宝/.test(cardText)) badges.push('退货宝');
            if (/包邮/.test(cardText)) badges.push('包邮');
            if (/官方立减/.test(cardText)) badges.push('官方立减');
            if (/ifashion/i.test(cardText)) badges.push('ifashion');
            if (/3期|免息/.test(cardText)) badges.push('分期免息');
            if (/公益宝贝/.test(cardText)) badges.push('公益宝贝');

            let detailUrl = String(rawHref || '');
            if (detailUrl.startsWith('//')) detailUrl = 'https:' + detailUrl;
            const isDirectItem = /^https?:\\/\\/(?:item\\.taobao\\.com|detail\\.tmall\\.com|detail\\.tmall\\.hk|chaoshi\\.detail\\.tmall\\.com)\\/item\\.htm/i.test(detailUrl);
            if (!isDirectItem) {
              const isTmallCard = /天猫|旗舰店|官方旗舰/.test(shop) && /tmall/i.test(card?.innerHTML || '');
              detailUrl = (isTmallCard ? 'https://detail.tmall.com/item.htm?id=' : 'https://item.taobao.com/item.htm?id=') + itemId;
            }

            let imageUrl = '';
            const imgEl = card ? card.querySelector('img[src*="alicdn"], img[src*="taobaocdn"], img[data-src*="alicdn"], img[class*="mainPic"], img[class*="pic"], img') : null;
            if (imgEl) {
              let src = imgEl.getAttribute('data-src') || imgEl.getAttribute('data-ks-lazyload') || imgEl.getAttribute('data-lazyload-src') || imgEl.getAttribute('src') || '';
              if (src.startsWith('data:image') || src.includes('clear.png') || src.includes('blank.gif')) {
                src = imgEl.getAttribute('data-src') || imgEl.getAttribute('data-ks-lazyload') || imgEl.getAttribute('data-lazyload-src') || '';
              }
              if (src) {
                let cleanSrc = src.startsWith('//') ? 'https:' + src : src;
                cleanSrc = cleanSrc.replace(/(\\.(?:jpe?g|png|gif))_.+$/i, '$1');
                imageUrl = cleanSrc;
              }
            }

            seenInPage.add(itemId);
            results.push({
              item_id: itemId,
              title: title.slice(0, 150),
              price: price,
              sales: sales,
              shop: shop,
              location: location,
              badges: badges.join(' | '),
              url: detailUrl,
              image_url: imageUrl,
            });
          }

          // Pass 1: Unified Taobao 2025/2026 search cards carrying id="item_id_<id>" (covers hot-ranked & simba-wrapped listings as well as organic cards)
          const idCards = Array.from(document.querySelectorAll('[id^="item_id_"], [data-spm-act-id]'));
          for (const el of idCards) {
            const idAttr = (el.getAttribute('id') || '').trim();
            const spmAttr = (el.getAttribute('data-spm-act-id') || '').trim();
            const m = idAttr.match(/^item_id_(\\d{8,16})$/) || spmAttr.match(/^(\\d{8,16})$/);
            if (!m) continue;
            const href = el.getAttribute('href') || (el.querySelector('a[href]') ? el.querySelector('a[href]').getAttribute('href') : '') || '';
            extractCard(el, m[1], href);
          }

          // Pass 2: Direct item.taobao.com / detail.tmall.com links fallback
          const links = Array.from(document.querySelectorAll('a[href*="item.taobao.com/item.htm"], a[href*="detail.tmall.com/item.htm"], a[href*="detail.tmall.hk/"], a[href*="chaoshi.detail.tmall.com/item.htm"], a[href*="yao.95095.com/"]'));
          for (const a of links) {
            const href = a.getAttribute('href') || '';
            const idMatch = href.match(/[?&]id=(\\d{8,16})/);
            if (!idMatch) continue;
            extractCard(a, idMatch[1], href);
          }

          return results;
        })()
      `);

      const prevTotal = allItems.length;
      const prevFingerprint = pageItems.slice(0, 3).map(it => it.item_id).join(',');
      for (const item of pageItems) {
        if (!seenIds.has(item.item_id)) {
          seenIds.add(item.item_id);
          allItems.push({
            ...item,
            page: p,
            url: normalizeMarketItemUrl(item.url, item.item_id),
          });
        }
      }
      const addedThisPage = allItems.length - prevTotal;
      if (p > 1 && addedThisPage === 0) consecutiveZeroNewPages += 1;
      else consecutiveZeroNewPages = 0;

      if (allItems.length >= limit || p >= maxPages || pageItems.length === 0 || consecutiveZeroNewPages >= 2) break;

      const hasNext = await page.evaluate(`
        (() => {
          const selectors = [
            'button.next-pagination-item.next-next',
            '.next-pagination-item.next-next button',
            '.next-pagination-item.next-next a',
            '.next-pagination-item.next-next',
            'button.next-next',
            'button.next-btn',
            'a.next-btn',
            '.next-pagination-item-next',
            'button[aria-label="下一页"]',
            'button[aria-label="Next Page"]',
            '.ant-pagination-next button',
          ];
          let nextBtn = null;
          for (const s of selectors) {
            const el = document.querySelector(s);
            if (el) {
              nextBtn = el;
              break;
            }
          }
          if (!nextBtn) {
            const allBtns = Array.from(document.querySelectorAll('button, a, div[role="button"], span.next'));
            nextBtn = allBtns.find(el => el.innerText && (el.innerText.trim() === '下一页' || (el.innerText.trim().includes('下一页') && el.innerText.trim().length <= 6)));
          }
          if (nextBtn) {
            const container = nextBtn.closest('.next-pagination-item, .ant-pagination-next') || nextBtn;
            const isDisabled = nextBtn.disabled ||
              nextBtn.classList.contains('disabled') ||
              (nextBtn.getAttribute('aria-disabled') === 'true') ||
              container.classList.contains('disabled') ||
              (container.getAttribute('aria-disabled') === 'true');
            if (!isDisabled) {
              nextBtn.scrollIntoView({ block: 'center' });
              nextBtn.click();
              return true;
            }
          }
          return false;
        })()
      `);

      if (hasNext) {
        let flipped = false;
        const targetPage = p + 1;
        for (let waitStep = 0; waitStep < 12; waitStep++) {
          await page.wait(0.6);
          const flipCheck = await page.evaluate(`
            (() => {
              const cur = document.querySelector('.next-pagination-item.next-current, .ant-pagination-item-active');
              const curNum = cur && cur.innerText ? parseInt(cur.innerText.trim(), 10) : null;
              const topIds = Array.from(document.querySelectorAll('[id^="item_id_"]')).slice(0, 3).map(el => (el.id || '').replace(/^item_id_/, ''));
              return {
                curNum: Number.isFinite(curNum) ? curNum : null,
                fp: topIds.join(','),
              };
            })()
          `);
          if (flipCheck?.curNum === targetPage || (flipCheck?.fp && prevFingerprint && flipCheck.fp !== prevFingerprint)) {
            flipped = true;
            await page.wait(0.8);
            break;
          }
        }
        if (!flipped) {
          const nextPageUrl = searchUrl + (searchUrl.includes('?') ? '&' : '?') + 's=' + (p * 44) + '&page=' + (p + 1);
          await page.goto(nextPageUrl);
          await page.wait(2.5);
        }
      } else {
        const nextPageUrl = searchUrl + (searchUrl.includes('?') ? '&' : '?') + 's=' + (p * 44) + '&page=' + (p + 1);
        await page.goto(nextPageUrl);
        await page.wait(2.5);
      }
    }

    return allItems.slice(0, limit);
  },
});

export const __test__ = {
  extractItemIdFromAttrs,
  normalizeMarketItemUrl,
};
