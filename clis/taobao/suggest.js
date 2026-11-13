import { cli, Strategy } from '@jackwener/opencli/registry';

function parseTaobaoSuggestPayload(payload, query, limit = 10) {
  const rawList = Array.isArray(payload?.result) ? payload.result : [];
  const rows = [];
  for (let i = 0; i < rawList.length && rows.length < limit; i += 1) {
    const entry = rawList[i];
    const word = Array.isArray(entry) ? String(entry[0] || '') : String(entry?.word || entry || '');
    const cleaned = word.replace(/<[^>]+>/g, '').trim();
    if (!cleaned) continue;
    rows.push({
      rank: rows.length + 1,
      query,
      suggestion: cleaned,
      count: Array.isArray(entry) ? (entry[1] ?? null) : null,
      source: 'suggest.taobao.com',
    });
  }
  return rows;
}

export const command = cli({
  site: 'taobao',
  name: 'suggest',
  access: 'read',
  description: '获取淘宝搜索热词与下拉联想词推荐（零登录极速，对标 OneBound item_search_suggest）',
  domain: 'suggest.taobao.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'query', positional: true, required: true, help: '起始关键词，例如: 折叠椅' },
    { name: 'limit', type: 'int', default: 10, help: '返回联想词数量上限（默认 10）' },
  ],
  columns: ['rank', 'query', 'suggestion', 'count'],
  func: async (args) => {
    const query = String(args?.query || '').trim();
    if (!query) throw new Error('搜索关键词不能为空');
    const limit = Math.min(Math.max(Number.parseInt(String(args?.limit || 10), 10) || 10, 1), 30);

    const url = `https://suggest.taobao.com/sug?code=utf-8&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Referer: 'https://www.taobao.com/',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new Error(`Taobao suggest HTTP ${res.status}`);
    }
    const payload = await res.json();
    return parseTaobaoSuggestPayload(payload, query, limit);
  },
});

export const __test__ = {
  parseTaobaoSuggestPayload,
};
