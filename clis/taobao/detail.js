import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CliError } from '@jackwener/opencli/errors';

function detectTaobaoPageState() {
  const url = new URL(location.href);
  const title = (document.title || '').trim();
  const bodyText = document.body ? (document.body.innerText || '') : '';
  const challengeVisible = Array.from(
    document.querySelectorAll('#nocaptcha, #nc_1_wrapper, #baxia-dialog-content, #punish')
  ).some(node => {
    if (node.closest('[hidden], [aria-hidden="true"]')) return false;
    for (let parent = node; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) {
        return false;
      }
    }
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });

  if (
    /(?:^|\/)(?:punish|captcha|verify)(?:\/|$)/i.test(url.pathname) ||
    /^(?:sec|verify)\.(?:taobao|tmall)\.com$/i.test(url.hostname) ||
    url.searchParams.has('_____tmd_____') ||
    url.searchParams.has('x5sec') ||
    /安全验证|滑块验证|访问受限|账号异常|账户异常|captcha|security verification/i.test(title) ||
    challengeVisible
  ) {
    return 'blocked';
  }

  if (
    /^(?:login|passport)\.(?:taobao|tmall|alibaba)\.com$/i.test(url.hostname) ||
    /^(?:登录|登入)(?:\s|[-_—]|$)/.test(title) ||
    /\/member\/login\.jhtml$/.test(url.pathname) ||
    (bodyText.includes('亲，请登录') && !bodyText.includes('商品详情') && !bodyText.includes('宝贝详情') && !window.__ICE_APP_CONTEXT__)
  ) {
    return 'login';
  }

  return 'ok';
}

const CANONICAL_TAOBAO_HOSTS = new Set([
  'item.taobao.com',
  'detail.tmall.com',
  'detail.tmall.hk',
  'chaoshi.detail.tmall.com',
]);

function isValidSkuId(skuId) {
  return /^\d{6,20}$/.test(String(skuId ?? '').trim());
}

function extractSkuIdFromUrl(rawUrl) {
  if (!rawUrl || !/^https?:\/\//i.test(String(rawUrl).trim())) return null;
  try {
    const u = new URL(String(rawUrl).trim());
    const val = u.searchParams.get('skuId') || u.searchParams.get('skuid') || '';
    return isValidSkuId(val) ? val.trim() : null;
  } catch {
    return null;
  }
}

function resolveCanonicalBaseUrl(itemId, ...candidateUrls) {
  let host = 'item.taobao.com';
  for (const raw of candidateUrls) {
    if (!raw || !/^https?:\/\//i.test(String(raw).trim())) continue;
    try {
      const h = new URL(String(raw).trim()).hostname.toLowerCase();
      if (CANONICAL_TAOBAO_HOSTS.has(h)) {
        host = h;
        break;
      }
    } catch {
      // ignore invalid URL candidates
    }
  }
  return `https://${host}/item.htm?id=${encodeURIComponent(String(itemId))}`;
}

function buildTaobaoSkuUrl(baseUrl, skuId) {
  if (!isValidSkuId(skuId)) return baseUrl;
  const sep = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${sep}skuId=${encodeURIComponent(String(skuId).trim())}`;
}

function pickDefaultSkuId(variants, { basePrice = 0, requestedSkuId = null, pageSkuId = null } = {}) {
  const realVariants = variants.filter((v) => v._realSkuId && isValidSkuId(v.sku_id));
  if (isValidSkuId(requestedSkuId)) return String(requestedSkuId).trim();
  if (isValidSkuId(pageSkuId)) {
    const pSku = String(pageSkuId).trim();
    if (realVariants.length === 0 || realVariants.some((v) => v.sku_id === pSku)) {
      return pSku;
    }
  }
  if (realVariants.length === 0) return null;

  const inStockCore = realVariants.filter((v) => !v.disabled && !v.is_accessory);
  const priceMatch = basePrice > 0
    ? inStockCore.find((v) => Number(v.price) > 0 && Math.abs(Number(v.price) - Number(basePrice)) < 0.01)
    : null;
  if (priceMatch) return priceMatch.sku_id;

  const pricedCore = inStockCore
    .filter((v) => Number(v.price) > 0)
    .sort((a, b) => Number(a.price) - Number(b.price));
  if (pricedCore.length > 0) return pricedCore[0].sku_id;
  if (inStockCore.length > 0) return inStockCore[0].sku_id;

  const inStockAny = realVariants.find((v) => !v.disabled);
  return inStockAny ? inStockAny.sku_id : realVariants[0].sku_id;
}

function enrichDetailWithSkuUrls(detailData, { itemId, requestedUrl = '', requestedSkuId = null } = {}) {
  if (!detailData || typeof detailData !== 'object') return detailData;
  const resolvedItemId = String(itemId || detailData.item_id || '').trim();
  const baseUrl = resolveCanonicalBaseUrl(
    resolvedItemId,
    detailData.page_url,
    detailData.base_url,
    detailData.url,
    requestedUrl
  );
  const rawVariants = Array.isArray(detailData.sku_variants) ? detailData.sku_variants : [];
  const taggedVariants = rawVariants.map((variant) => {
    const skuStr = variant?.sku_id != null ? String(variant.sku_id).trim() : '';
    const isReal = variant?.has_real_sku_id !== false && isValidSkuId(skuStr);
    return { ...variant, sku_id: skuStr || variant?.sku_id, _realSkuId: isReal };
  });

  const explicitSku = isValidSkuId(requestedSkuId)
    ? String(requestedSkuId).trim()
    : extractSkuIdFromUrl(requestedUrl);
  const pageSku = extractSkuIdFromUrl(detailData.page_url);
  const selectedSkuId = pickDefaultSkuId(taggedVariants, {
    basePrice: Number(detailData.price) || 0,
    requestedSkuId: explicitSku,
    pageSkuId: pageSku,
  });

  const skuVariants = taggedVariants.map((variant) => {
    const { has_real_sku_id: _h, _realSkuId, ...clean } = variant;
    return {
      ...clean,
      url: _realSkuId ? buildTaobaoSkuUrl(baseUrl, clean.sku_id) : baseUrl,
    };
  });

  const { page_url: _pageUrl, ...rest } = detailData;
  return {
    ...rest,
    item_id: resolvedItemId,
    base_url: baseUrl,
    selected_sku_id: selectedSkuId,
    url: buildTaobaoSkuUrl(baseUrl, selectedSkuId),
    sku_variants: skuVariants,
  };
}

function parseRateVoReviews(rateVO) {
  if (!rateVO || typeof rateVO !== 'object') return [];
  const rawItems = Array.isArray(rateVO?.group?.items)
    ? rateVO.group.items
    : (Array.isArray(rateVO?.rateList) ? rateVO.rateList : []);
  const out = [];
  for (const item of rawItems.slice(0, 20)) {
    const content = String(item?.content || item?.rateContent || item?.feedback || '').replace(/[\r\n]+/g, ' ').trim();
    if (!content) continue;
    const rawPics = Array.isArray(item?.images)
      ? item.images
      : (Array.isArray(item?.feedPicList) ? item.feedPicList : (Array.isArray(item?.pics) ? item.pics : []));
    const photos = rawPics
      .map((p) => {
        const raw = typeof p === 'string' ? p : (p?.url || p?.thumbnail || '');
        let s = String(raw || '').trim();
        if (!s || s.startsWith('data:')) return '';
        if (s.startsWith('//')) s = 'https:' + s;
        if (s.startsWith('http://')) s = 'https://' + s.slice(7);
        return s.replace(/(\.(?:jpe?g|png|gif))_.+$/i, '$1');
      })
      .filter((u) => /^https:\/\//i.test(u));
    out.push({
      user: String(item?.userName || item?.displayUserNick || item?.userNick || '淘友').slice(0, 15),
      date: String(item?.dateTime || item?.rateDate || item?.createTime || '').slice(0, 12),
      sku: String(item?.skuInfo || item?.auctionSku || '').replace(/^已购\s*/, '').replace(/[\r\n]+/g, ' ').slice(0, 60),
      content: content.slice(0, 260),
      photos: Array.from(new Set(photos)),
    });
  }
  return out;
}

export const command = cli({
  site: 'taobao',
  name: 'detail',
  access: 'read',
  description: '获取淘宝商品详情 (程序化提取落地页图片、SKU变体矩阵与直达SKU链接、真实到手价、参数规格、详情长图与评价晒单)',
  domain: 'item.taobao.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'id', positional: true, required: true, help: '商品 ID 或淘宝/天猫商品链接（支持带 skuId=），例如: 818133532091' },
    { name: 'sku', type: 'str', help: '指定优先选中的 SKU ID（不传时默认定位到主商品在售 SKU 并在 url 中带上 skuId）' },
    { name: 'reviews', type: 'bool', default: false, help: '是否抓取买家评价与实拍晒图' },
    { name: 'desc', type: 'bool', default: false, help: '是否抓取详情页图文长图与规格参数' },
  ],
  columns: [
    'item_id',
    'title',
    'price',
    'original_price',
    'shop',
    'shop_rating',
    'location',
    'sales',
    'sku_count',
    'selected_sku_id',
    'images_count',
    'url',
  ],
  func: async (page, kwargs) => {
    const rawId = String(kwargs.id || '').trim();
    const idMatch = rawId.match(/(\d{8,16})/);
    if (!idMatch) {
      throw new Error('无效的商品 ID: ' + rawId);
    }
    const itemId = idMatch[1];
    const requestedSkuId = isValidSkuId(kwargs.sku) ? String(kwargs.sku).trim() : extractSkuIdFromUrl(rawId);
    const fetchReviews = Boolean(kwargs.reviews);
    const fetchDesc = Boolean(kwargs.desc);

    let targetUrl = 'https://item.taobao.com/item.htm?id=' + itemId;
    if (/^https?:\/\//i.test(rawId)) {
      let parsed;
      try {
        parsed = new URL(rawId);
      } catch {
        throw new Error('无效的商品链接: ' + rawId);
      }
      if (!/(?:^|\.)(?:taobao|tmall)\.com$/i.test(parsed.hostname)) {
        throw new Error('仅支持淘宝或天猫商品链接: ' + parsed.hostname);
      }
      parsed.protocol = 'https:';
      if (requestedSkuId && !parsed.searchParams.get('skuId')) {
        parsed.searchParams.set('skuId', requestedSkuId);
      }
      targetUrl = parsed.toString();
    } else if (requestedSkuId) {
      targetUrl += '&skuId=' + encodeURIComponent(requestedSkuId);
    }

    // Establish same-site Taobao referer before entering item LP to avoid cold-hit WAF slider
    const currentHref = await page.evaluate(`location.href`).catch(() => '');
    const onHealthyTaobao = /^https:\/\/(?:[a-z0-9-]+\.)*(?:taobao|tmall)\.com\//i.test(String(currentHref || ''))
      && !/login|passport|sec\.|punish|captcha|verify/i.test(String(currentHref || ''));

    if (!onHealthyTaobao) {
      await page.goto('https://www.taobao.com');
      await page.wait(2.0);
    }

    await page.evaluate(`location.href = ${JSON.stringify(targetUrl)}`);
    await page.wait(4.5);

    const state = await page.evaluate(`(${detectTaobaoPageState.toString()})()`);
    if (state === 'blocked') {
      throw new CliError(
        'SECURITY_BLOCK',
        '触发淘宝人机安全验证，请先在浏览器中手动完成验证后重试',
        '命令已安全中止并停止后续请求，未自动重试。'
      );
    }
    if (state === 'login') {
      throw new AuthRequiredError('taobao.com', '淘宝商品详情需要已登录的浏览器会话，请先登录');
    }

    if (fetchDesc || fetchReviews) {
      await page.evaluate(`
        (async () => {
          window.scrollTo(0, Math.min(1200, document.body.scrollHeight * 0.4));
          await new Promise(r => setTimeout(r, 700));
          window.scrollTo(0, Math.min(2800, document.body.scrollHeight * 0.75));
          await new Promise(r => setTimeout(r, 800));
        })()
      `);
    }

    const detailData = await page.evaluate(`
      (async () => {
        function cleanImageUrl(src) {
          if (!src || typeof src !== 'string') return '';
          let s = src.trim();
          if (!s || s.startsWith('data:') || s.includes('clear.png') || s.includes('blank.gif')) return '';
          if (s.startsWith('//')) s = 'https:' + s;
          if (!/^https?:\\/\\//i.test(s)) return '';
          if (s.startsWith('http://')) s = 'https://' + s.slice(7);
          s = s.replace(/(\\.(?:jpe?g|png|gif))_.+$/i, '$1');
          return s;
        }

        function parsePrice(val) {
          if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
          const m = String(val || '').replace(/,/g, '').match(/(\\d+(?:\\.\\d+)?)/);
          return m ? parseFloat(m[1]) : 0;
        }

        function isAccessorySkuName(text, parsedPrice) {
          const t = String(text || '');
          const isBaitToken = /(?:定金|预付款|补差价|专拍|邮费|运费|链接|勿拍)/i.test(t);
          if (isBaitToken && parsedPrice < 500) return true;
          const hasExplicitTargetPrefix = /^(?:适用|专用|兼容|配赠|赠品|单买|单独购买|加购)/i.test(t);
          const hasAccessoryNoun = /(?:类纸膜|防蓝光膜|钢化膜|保护膜|贴膜|保护套|保护壳|折叠支架|支架|转接线|转接头|独立笔|手写笔单买|原装笔|数字笔|电磁笔|笔尖|笔芯|毛毡笔芯|替换笔芯|收纳包|内胆包|电源线|数据线|手套)/i.test(t);
          const hasDeviceBundleToken = /(?:套餐|标配|标准版|豪华版|尊享版|专业版|全套|单机|主机)/i.test(t);
          if (parsedPrice >= 500 && !isBaitToken) return false;
          if (hasExplicitTargetPrefix && hasAccessoryNoun) return true;
          if (hasAccessoryNoun && !hasDeviceBundleToken && parsedPrice < 500) return true;
          return false;
        }

        const ctx = window.__ICE_APP_CONTEXT__ || null;
        const res = ctx?.loaderData?.home?.data?.res || null;
        const bodyText = document.body ? (document.body.innerText || '') : '';

        // 1. Title
        const titleEl = document.querySelector('[class*="mainTitle--"], [class*="ItemTitle--"], [class*="itemTitle--"], [class*="Title--title--"], [class*="header--title--"], h1, .tb-main-title, #J_Title h3, #J_DetailMeta h1');
        let rawTitle = '';
        const tvTitle = res?.componentsVO?.titleVO?.title;
        if (typeof tvTitle === 'string' && tvTitle.trim()) {
          rawTitle = tvTitle.trim();
        } else if (tvTitle && typeof tvTitle === 'object' && tvTitle.title) {
          rawTitle = String(tvTitle.title).trim();
        } else if (typeof res?.item?.title === 'string' && res.item.title.trim()) {
          rawTitle = res.item.title.trim();
        } else if (titleEl && titleEl.innerText) {
          rawTitle = titleEl.innerText.trim();
        } else {
          rawTitle = document.title.replace(/-(?:淘宝网|天猫).*$/, '').trim();
        }
        if (/Captcha Interception|安全验证|滑块|访问受限/i.test(rawTitle)) rawTitle = '';
        const title = String(rawTitle || '').replace(/[\\r\\n]+/g, ' ').replace(/^【[^】]+】/, '').trim();

        // 2. Shop Info & Seller
        let shopName = res?.componentsVO?.storeCardVO?.shopName || res?.seller?.shopName || res?.seller?.sellerNick || '淘宝店铺';
        let shopRating = '4.8';
        let shopService = [];
        const evaluates = res?.componentsVO?.storeCardVO?.evaluates || res?.seller?.evaluates || [];
        if (Array.isArray(evaluates) && evaluates.length > 0) {
          const scores = evaluates.map(e => parseFloat(e.score)).filter(n => Number.isFinite(n) && n > 0 && n <= 5);
          if (scores.length > 0) {
            shopRating = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2);
          }
          shopService = evaluates.map(e => (e.title || '') + (e.score || '')).filter(Boolean);
        }
        const shopLabels = res?.componentsVO?.storeCardVO?.labels || [];
        if (Array.isArray(shopLabels)) {
          for (const lb of shopLabels) {
            if (lb?.text) shopService.push(lb.text);
          }
        }
        if (shopName === '淘宝店铺') {
          const shopHeaderEl = document.querySelector('[class*="shopHeader--"], [class*="ShopInfo--"], a[href*="shop.taobao.com"], a[href*="store.taobao.com"]');
          if (shopHeaderEl && shopHeaderEl.innerText) {
            const firstLine = shopHeaderEl.innerText.split('\\n').map(s => s.trim()).filter(Boolean)[0];
            if (firstLine) shopName = firstLine;
          }
        }

        // 3. Location & Logistics
        let location = res?.componentsVO?.deliveryVO?.deliveryFromAddr || res?.componentsVO?.deliveryVO?.from || '';
        if (!location) {
          const locMatch = bodyText.match(/(?:发货地[：:]*\\s*|配送至[\\s\\S]*?从\\s*)([\\u4e00-\\u9fa5]{2,10}(?:省|市)?)/);
          if (locMatch) location = locMatch[1].trim();
        }
        const freight = String(res?.componentsVO?.deliveryVO?.freight || '').trim();
        const agingDesc = String(res?.componentsVO?.deliveryVO?.agingDesc || '').trim();
        let salesText = res?.componentsVO?.titleVO?.salesDesc || '';
        if (!salesText) {
          const salesMatch = bodyText.match(/月销\\s*(\\d+(?:\\.\\d+)?[万kw]?\\+?)|已售\\s*(\\d+(?:\\.\\d+)?[万kw]?\\+?)|(\\d+(?:\\.\\d+)?[万kw]?\\+?)\\s*人付款/);
          if (salesMatch) salesText = salesMatch[0];
        }

        // 4. Gallery Images (ICE structured first, DOM fallback)
        const gallerySet = new Set();
        const iceImgs = [
          ...(Array.isArray(res?.componentsVO?.headImageVO?.images) ? res.componentsVO.headImageVO.images : []),
          ...(Array.isArray(res?.item?.images) ? res.item.images : []),
        ];
        for (const src of iceImgs) {
          const clean = cleanImageUrl(src);
          if (clean) gallerySet.add(clean);
        }
        if (gallerySet.size === 0) {
          const imgElements = Array.from(document.querySelectorAll('[class*="thumbnailPic--"], [class*="mainPic--"], [class*="PicGallery--"] img, #J_UlThumb img, .tb-gallery img'));
          for (const el of imgElements) {
            const clean = cleanImageUrl(el.src || el.getAttribute('data-src') || '');
            if (clean) gallerySet.add(clean);
          }
        }
        const galleryImages = Array.from(gallerySet);

        // 5. Base Price & Original Price
        const sku2info = res?.skuCore?.sku2info || {};
        const defaultInfo = sku2info['0'] || null;
        let basePrice = 0;
        let originalPrice = 0;

        if (defaultInfo) {
          const mainP = parsePrice(defaultInfo.price?.priceText || defaultInfo.price?.priceMoney / 100);
          const subP = parsePrice(defaultInfo.subPrice?.priceText || defaultInfo.subPrice?.priceMoney / 100);
          const candidates = [mainP, subP].filter(n => n > 0);
          if (candidates.length > 0) {
            basePrice = Math.min(...candidates);
            const maxP = Math.max(...candidates);
            if (maxP > basePrice) originalPrice = maxP;
          }
        }
        if (basePrice <= 0 && res?.componentsVO?.priceVO) {
          const pv = res.componentsVO.priceVO;
          const p1 = parsePrice(pv.price?.priceText);
          const p2 = parsePrice(pv.subPrice?.priceText || pv.extraPrice?.priceText);
          const candidates = [p1, p2].filter(n => n > 0);
          if (candidates.length > 0) {
            basePrice = Math.min(...candidates);
            const maxP = Math.max(...candidates);
            if (maxP > basePrice) originalPrice = maxP;
          }
        }
        if (basePrice <= 0) {
          const priceBlock = document.querySelector('[class*="block2--"], [class*="priceWrap--"], [class*="Price--priceText--"], [class*="Price--"], .tm-price, .tb-rmb-num');
          if (priceBlock && priceBlock.innerText) {
            basePrice = parsePrice(priceBlock.innerText);
          } else {
            const m2 = bodyText.match(/[¥￥]\\s*(\\d+(?:\\.\\d+)?)/);
            if (m2) basePrice = parseFloat(m2[1]);
          }
        }

        // 6. Programmatic SKU Matrix (ZERO sequential clicks!)
        const skuVariants = [];
        const skuBase = res?.skuBase;
        if (skuBase && Array.isArray(skuBase.props)) {
          const propMap = new Map();
          for (const prop of skuBase.props) {
            const pName = prop.name || '';
            for (const val of (prop.values || [])) {
              propMap.set(prop.pid + ':' + val.vid, {
                propName: pName,
                valueName: val.name || '',
                image: cleanImageUrl(val.image || ''),
              });
            }
          }

          if (Array.isArray(skuBase.skus) && skuBase.skus.length > 0) {
            skuBase.skus.forEach((sku, idx) => {
              const parts = String(sku.propPath || '').split(';').filter(Boolean);
              const names = [];
              let skuImg = '';
              for (const part of parts) {
                const entry = propMap.get(part);
                if (entry) {
                  names.push(entry.valueName);
                  if (!skuImg && entry.image) skuImg = entry.image;
                }
              }
              const name = names.join(' / ') || ('SKU-' + sku.skuId);
              const info = sku2info[String(sku.skuId)] || {};
              const p1 = parsePrice(info.price?.priceText || (info.price?.priceMoney ? info.price.priceMoney / 100 : 0));
              const p2 = parsePrice(info.subPrice?.priceText || (info.subPrice?.priceMoney ? info.subPrice.priceMoney / 100 : 0));
              const priceNums = [p1, p2].filter(n => n > 0);
              const skuPrice = priceNums.length > 0 ? Math.min(...priceNums) : basePrice;
              const skuOrigPrice = priceNums.length > 1 ? Math.max(...priceNums) : null;
              const qty = info.quantity !== undefined ? Number(info.quantity) : 1;
              const isAccessory = isAccessorySkuName(name, skuPrice);

              skuVariants.push({
                index: idx,
                sku_id: String(sku.skuId),
                has_real_sku_id: true,
                name,
                price: skuPrice,
                original_price: skuOrigPrice && skuOrigPrice > skuPrice ? skuOrigPrice : null,
                quantity: Number.isFinite(qty) ? qty : null,
                image_url: skuImg,
                is_accessory: isAccessory,
                is_core_product: !isAccessory,
                disabled: Number.isFinite(qty) ? qty <= 0 : false,
              });
            });
          } else {
            // Fallback to prop values without clicking
            let idx = 0;
            for (const prop of skuBase.props) {
              for (const val of (prop.values || [])) {
                const name = val.name || '';
                if (!name) continue;
                skuVariants.push({
                  index: idx++,
                  sku_id: String(val.vid || idx),
                  has_real_sku_id: false,
                  name,
                  price: basePrice,
                  original_price: originalPrice || null,
                  quantity: null,
                  image_url: cleanImageUrl(val.image || ''),
                  is_accessory: isAccessorySkuName(name, basePrice),
                  is_core_product: !isAccessorySkuName(name, basePrice),
                  disabled: false,
                });
              }
            }
          }
        } else {
          // Non-clicking DOM fallback for legacy pages without __ICE_APP_CONTEXT__
          const skuEls = Array.from(document.querySelectorAll('[class*="valueItem--"], [class*="skuItem--"] [role="button"], .tb-sku li, .J_TSaleProp li'));
          skuEls.forEach((el, idx) => {
            const text = (el.innerText || '').trim().replace(/[\\r\\n]+/g, ' ');
            if (!text) return;
            const img = el.querySelector('img');
            const skuImg = img ? cleanImageUrl(img.src || img.getAttribute('data-src') || '') : '';
            const isDisabled = String(el.className || '').includes('disabled');
            const isAccessory = isAccessorySkuName(text, basePrice);
            skuVariants.push({
              index: idx,
              has_real_sku_id: false,
              name: text,
              price: basePrice,
              image_url: skuImg,
              is_accessory: isAccessory,
              is_core_product: !isAccessory,
              disabled: isDisabled,
            });
          });
        }

        // 7. Promotional & Guarantee Tags
        const promoSet = new Set();
        if (freight) promoSet.add(freight);
        if (agingDesc) promoSet.add(agingDesc);

        const extInfos = res?.componentsVO?.extensionInfoVO?.infos || [];
        for (const inf of extInfos) {
          if (inf?.type === 'GUARANTEE' && Array.isArray(inf?.items)) {
            for (const sub of inf.items) {
              if (Array.isArray(sub?.text)) {
                for (const t of sub.text) if (typeof t === 'string' && t.trim().length <= 20) promoSet.add(t.trim());
              } else if (typeof sub?.text === 'string' && sub.text.trim().length <= 20) {
                promoSet.add(sub.text.trim());
              }
            }
          } else if (inf?.type === 'GUARANTEE_NEW' && Array.isArray(inf?.items)) {
            for (const sub of inf.items) {
              if (sub?.title && typeof sub.title === 'string' && sub.title.trim().length <= 20) {
                promoSet.add(sub.title.trim());
              }
            }
          } else if (inf?.title && typeof inf.title === 'string' && inf.title.trim().length <= 15) {
            if (!/保障/.test(inf.title)) promoSet.add(inf.title.trim());
          }
        }
        const tagPatterns = ['退货宝', '顺丰包邮', '顺丰速运', '全国联保', '质保2年', '官方立减', '分期免息', '7天无理由', '极速退款', '大促', '消费券'];
        for (const p of tagPatterns) {
          if (bodyText.includes(p)) promoSet.add(p);
        }
        const promoTags = Array.from(promoSet).filter(Boolean);

        // 8. Specifications Table (skuBase.props + extensionInfoVO + DOM)
        const specs = {};
        if (skuBase && Array.isArray(skuBase.props)) {
          for (const prop of skuBase.props) {
            const pName = (prop.name || '').trim();
            if (pName && Array.isArray(prop.values) && prop.values.length > 0) {
              const valStr = prop.values.map(v => (v.name || '').trim()).filter(Boolean).join('、');
              if (valStr && !specs[pName]) {
                specs[pName] = valStr;
              }
            }
          }
        }
        if (Array.isArray(extInfos)) {
          for (const inf of extInfos) {
            if (inf?.type === 'BASE_PROPS' || /参数|规格/.test(inf?.title || '')) {
              for (const row of (inf.items || [])) {
                if (row?.title && row?.text) specs[String(row.title).trim()] = String(row.text).trim();
              }
            }
          }
        }
        const specItems = Array.from(document.querySelectorAll('[class*="parameter--"] li, [class*="attrs--"] li, [class*="props--"] li, [class*="infoItem--"], #J_AttrUL li'));
        for (const s of specItems) {
          const t = (s.innerText || '').trim();
          const parts = t.split(/[:：\\n]/).map(x => x.trim()).filter(Boolean);
          if (parts.length >= 2) {
            const k = parts[0];
            const v = parts.slice(1).join(' ');
            if (k && v && k.length <= 24 && !specs[k]) specs[k] = v;
          }
        }

        // 9. Long-Scroll Description Images (if requested)
        const descImages = [];
        if (${fetchDesc}) {
          window.scrollTo(0, 1200);
          await new Promise(r => setTimeout(r, 600));
          window.scrollTo(0, 2400);
          await new Promise(r => setTimeout(r, 600));

          const descTab = Array.from(document.querySelectorAll('[class*="tabItem"], [role="tab"], a, button, div'))
            .find(el => /^(?:图文详情|商品详情|宝贝详情)$/.test((el.innerText || '').trim()));
          if (descTab) {
            try { descTab.click(); } catch {}
            await new Promise(r => setTimeout(r, 800));
          }

          const descEls = Array.from(document.querySelectorAll('#J_DivItemDesc img, [class*="desc--"] img, [class*="detailDesc--"] img, [class*="descImg"] img, [class*="desc-"] img, .descV8 img, #description img, [class*="content--"] img'));
          for (const d of descEls) {
            const raw = d.getAttribute('data-ks-lazyload') || d.getAttribute('data-src') || d.src || '';
            const dSrc = cleanImageUrl(raw);
            if (dSrc && !descImages.includes(dSrc) && !galleryImages.includes(dSrc) && !dSrc.includes('tps/TB1') && !dSrc.includes('spacer') && !dSrc.includes('avatar') && !dSrc.includes('icon')) {
              descImages.push(dSrc);
            }
          }
        }

        // 10. Customer Reviews & Rate Summary (always harvest zero-cost structured rateVO.group.items; expand on --reviews)
        const rateVO = res?.componentsVO?.rateVO || null;
        const favorableRate = (typeof rateVO?.favorableRate === 'string' || typeof rateVO?.favorableRate === 'number') ? String(rateVO.favorableRate) : null;
        const rateKeywords = Array.isArray(rateVO?.keywords)
          ? rateVO.keywords.map(k => (typeof k === 'object' && k.title ? (k.count ? (k.title + '(' + k.count + ')') : k.title) : String(k))).filter(Boolean)
          : [];

        const structuredRateItems = [];
        const rawRateList = Array.isArray(rateVO?.group?.items)
          ? rateVO.group.items
          : (Array.isArray(rateVO?.rateList) ? rateVO.rateList : []);
        for (const item of rawRateList.slice(0, 20)) {
          const content = String(item?.content || item?.rateContent || item?.feedback || '').replace(/[\\r\\n]+/g, ' ').trim();
          if (!content) continue;
          const rawPics = Array.isArray(item?.images)
            ? item.images
            : (Array.isArray(item?.feedPicList) ? item.feedPicList : (Array.isArray(item?.pics) ? item.pics : []));
          const photos = rawPics.map(p => cleanImageUrl(typeof p === 'string' ? p : (p?.url || p?.thumbnail || ''))).filter(Boolean);
          structuredRateItems.push({
            user: String(item?.userName || item?.displayUserNick || item?.userNick || '淘友').slice(0, 15),
            date: String(item?.dateTime || item?.rateDate || item?.createTime || '').slice(0, 12),
            sku: String(item?.skuInfo || item?.auctionSku || '').replace(/^已购\\s*/, '').replace(/[\\r\\n]+/g, ' ').slice(0, 60),
            content: content.slice(0, 260),
            photos: Array.from(new Set(photos)),
          });
        }

        let reviewData = {
          review_count: parseInt(String(rateVO?.totalCount || '0').replace(/\\D/g, ''), 10) || structuredRateItems.length || 0,
          favorable_rate: favorableRate,
          rate_keywords: rateKeywords,
          reviews: structuredRateItems
        };

        if (${fetchReviews}) {
          const seenReviewKeys = new Set(structuredRateItems.map(r => (r.date + '|' + r.content.slice(0, 30))));

          // 10a. Extract rendered DOM review cards (filtering out pure date/meta lines)
          const domReviews = [];
          const domCards = Array.from(document.querySelectorAll('[class*="Comment--"], [class*="commentItem--"], [class*="rateItem--"], [class*="RateItem--"]'));
          for (const card of domCards.slice(0, 20)) {
            const cardText = (card.innerText || '').trim();
            if (cardText.length < 8) continue;
            const pics = Array.from(card.querySelectorAll('img')).map(im => cleanImageUrl(im.getAttribute('data-src') || im.src || '')).filter(u => u && !u.includes('avatar') && !u.includes('star') && !u.includes('icon'));
            const lines = cardText.split('\\n').map(l => l.trim()).filter(Boolean);
            const contentCandidates = lines.filter(l => !/^\\d{4}[-./年]\\d{1,2}[-./月]\\d{1,2}/.test(l) && !/^(?:已购|颜色分类|规格|赞|评论|有用|\\d+天前|\\d+个月前)/.test(l) && l.length >= 2);
            const contentLine = contentCandidates.slice().sort((a, b) => b.length - a.length)[0] || '';
            if (!contentLine || /^\\d{4}[-./年]\\d{1,2}/.test(contentLine)) continue;
            const dateStr = (cardText.match(/\\d{4}[-./年]\\d{1,2}[-./月]\\d{1,2}/)?.[0] || '').slice(0, 12);
            const key = dateStr + '|' + contentLine.slice(0, 30);
            if (seenReviewKeys.has(key)) continue;
            seenReviewKeys.add(key);
            domReviews.push({
              user: (lines[0] || '淘友').slice(0, 15),
              date: dateStr,
              sku: (lines.find(l => /规格|颜色|套餐|版本|已购/.test(l)) || '').replace(/^已购\\s*/, '').slice(0, 60),
              content: contentLine.replace(/[\\r\\n]+/g, ' ').slice(0, 260),
              photos: Array.from(new Set(pics)),
            });
          }

          if (domReviews.length > 0) {
            reviewData.reviews = [...reviewData.reviews, ...domReviews].slice(0, 20);
          }

          // 10b. Try rate.tmall.com JSONP fallback if reviews still sparse
          if (reviewData.reviews.length < 3) {
            let sellerId = String(res?.seller?.userId || res?.seller?.sellerId || '');
            if (!sellerId) {
              const pageHtml = document.documentElement.innerHTML || '';
              const sm = pageHtml.match(/sellerId['":\\s]+['"]?(\\d+)/) || pageHtml.match(/userId['":\\s]+['"]?(\\d+)/);
              if (sm) sellerId = sm[1];
            }

            const fetched = await new Promise((resolve) => {
              const cb = '_ocli_rate_' + Date.now();
              let resolved = false;
              const cleanup = (val) => {
                if (resolved) return;
                resolved = true;
                delete window[cb];
                script.remove();
                resolve(val);
              };
              window[cb] = (payload) => {
                const list = payload?.rateDetail?.rateList || payload?.comments || [];
                const parsed = list.slice(0, 15).map(item => {
                  const photos = Array.isArray(item.pics) ? item.pics : (Array.isArray(item.photos) ? item.photos.map(p => p.url) : []);
                  return {
                    user: (item.displayUserNick || item.userNick || item.user?.nick || '淘友').slice(0, 15),
                    date: (item.rateDate || item.date || '').slice(0, 12),
                    sku: (item.auctionSku || item.auction?.sku || '').replace(/[\\r\\n]+/g, ' ').slice(0, 60),
                    content: (item.rateContent || item.content || '').replace(/[\\r\\n]+/g, ' ').slice(0, 260),
                    photos: photos.map(p => cleanImageUrl(p)).filter(Boolean),
                  };
                });
                cleanup({
                  review_count: payload?.rateDetail?.rateCount?.total || list.length || reviewData.review_count,
                  reviews: parsed
                });
              };
              const script = document.createElement('script');
              script.src = 'https://rate.tmall.com/list_detail_rate.htm?itemId=' + ${JSON.stringify(itemId)} + (sellerId ? '&sellerId=' + sellerId : '') + '&order=3&currentPage=1&content=1&callback=' + cb;
              script.onerror = () => cleanup({ review_count: reviewData.review_count, reviews: [] });
              document.head.appendChild(script);
              setTimeout(() => cleanup({ review_count: reviewData.review_count, reviews: [] }), 6000);
            });
            reviewData.review_count = fetched.review_count || reviewData.review_count;
            for (const r of (fetched.reviews || [])) {
              const key = (r.date || '') + '|' + (r.content || '').slice(0, 30);
              if (r.content && !seenReviewKeys.has(key)) {
                seenReviewKeys.add(key);
                reviewData.reviews.push(r);
              }
            }
            reviewData.reviews = reviewData.reviews.slice(0, 20);
          }
        }

        // Capture top SKU/real base price when basePrice is 0
        if (basePrice <= 0 && skuVariants.length > 0) {
          const corePrices = skuVariants.filter(s => !s.is_accessory && !s.disabled && s.price > 0).map(s => s.price);
          if (corePrices.length > 0) basePrice = Math.min(...corePrices);
        }

        return {
          item_id: ${JSON.stringify(itemId)},
          title,
          price: basePrice,
          original_price: originalPrice > basePrice ? originalPrice : null,
          shop: String(shopName || '').trim(),
          shop_rating: String(shopRating || '4.8'),
          shop_service: shopService,
          location,
          sales: salesText,
          sku_count: skuVariants.length,
          images_count: galleryImages.length,
          promo_tags: promoTags,
          gallery_images: galleryImages,
          sku_variants: skuVariants,
          specifications: specs,
          desc_images: descImages,
          reviews: reviewData,
          page_url: location.href,
          url: 'https://item.taobao.com/item.htm?id=' + ${JSON.stringify(itemId)},
          extraction_mode: res ? 'ice_app_context' : 'dom_fallback',
        };
      })()
    `);

    return enrichDetailWithSkuUrls(detailData, {
      itemId,
      requestedUrl: rawId,
      requestedSkuId,
    });
  }
});

export const __test__ = {
  isValidSkuId,
  extractSkuIdFromUrl,
  resolveCanonicalBaseUrl,
  buildTaobaoSkuUrl,
  pickDefaultSkuId,
  enrichDetailWithSkuUrls,
  parseRateVoReviews,
};
