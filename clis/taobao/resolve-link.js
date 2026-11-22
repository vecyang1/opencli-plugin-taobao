import { cli, Strategy } from '@jackwener/opencli/registry';

function extractUrlFromShareText(input) {
  const raw = String(input || '').trim();
  const urlMatch = raw.match(/https?:\/\/[^\s"'<>]+/i);
  return urlMatch ? urlMatch[0] : null;
}

const CANONICAL_TAOBAO_HOSTS = new Set([
  'item.taobao.com',
  'detail.tmall.com',
  'detail.tmall.hk',
  'chaoshi.detail.tmall.com',
]);

function extractCanonicalItem(urlStr) {
  try {
    const u = new URL(urlStr);
    const id = u.searchParams.get('id') || u.searchParams.get('offerId') || urlStr.match(/\/offer\/(\d{6,})\.html/i)?.[1] || null;
    const rawSku = u.searchParams.get('skuId') || u.searchParams.get('skuid') || '';
    const skuId = /^\d{6,20}$/.test(rawSku.trim()) ? rawSku.trim() : null;
    const is1688 = u.hostname.includes('1688.com');
    const host = CANONICAL_TAOBAO_HOSTS.has(u.hostname.toLowerCase()) ? u.hostname.toLowerCase() : 'item.taobao.com';
    const canonicalUrl = id
      ? (is1688
        ? `https://detail.1688.com/offer/${id}.html`
        : `https://${host}/item.htm?id=${id}${skuId ? `&skuId=${skuId}` : ''}`)
      : urlStr;
    return { item_id: id, sku_id: is1688 ? null : skuId, platform: is1688 ? '1688' : (host.includes('tmall') ? 'tmall' : 'taobao'), canonical_url: canonicalUrl };
  } catch {
    return { item_id: null, sku_id: null, platform: 'unknown', canonical_url: urlStr };
  }
}

export const command = cli({
  site: 'taobao',
  name: 'resolve-link',
  access: 'read',
  description: '解析淘宝/天猫/1688 分享短链（m.tb.cn / e.tb.cn）或分享文案，提取真实商品 ID 与规范链接（对标 OneBound item_password / item_link）',
  domain: 'm.tb.cn',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'input', positional: true, required: true, help: '短链接或包含分享口令与短链的完整分享文本' },
  ],
  columns: ['item_id', 'sku_id', 'platform', 'canonical_url', 'resolved_url'],
  func: async (args) => {
    const raw = String(args?.input || '').trim();
    const candidateUrl = extractUrlFromShareText(raw);
    if (!candidateUrl) {
      throw new Error('未在输入中检测到可解析的 http/https 短链；若为纯口令文本请先在手机淘宝复制带短链分享文案');
    }

    let finalUrl = candidateUrl;
    const res = await fetch(candidateUrl, { redirect: 'follow', signal: AbortSignal.timeout(10000) });
    finalUrl = res.url || candidateUrl;
    const html = await res.text();
    const bodyUrlMatch = html.match(/var\s+url\s*=\s*['"](https?:\/\/[^'"]+)['"]/) || html.match(/https?:\/\/(?:item\.taobao\.com|detail\.tmall\.com|detail\.1688\.com)\/[^\s"'<>]+/i);
    if (bodyUrlMatch) {
      finalUrl = bodyUrlMatch[1] || bodyUrlMatch[0];
    }

    const parsed = extractCanonicalItem(finalUrl);
    return [{
      ...parsed,
      resolved_url: finalUrl,
      input_url: candidateUrl,
    }];
  },
});

export const __test__ = {
  extractUrlFromShareText,
  extractCanonicalItem,
};
