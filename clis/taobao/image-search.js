import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError } from '@jackwener/opencli/errors';

async function prepareImageFile(input) {
  const target = String(input || '').trim();
  if (!target) throw new Error('请提供本地图片路径或图片 URL');
  if (/^https?:\/\//i.test(target)) {
    const tmpFile = path.join(os.tmpdir(), `tb_img_search_${Date.now()}.jpg`);
    const res = await fetch(target);
    if (!res.ok) throw new Error(`下载图片失败: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.promises.writeFile(tmpFile, buf);
    return { filePath: tmpFile, isTemp: true };
  }
  const resolved = path.resolve(process.cwd(), target);
  if (!fs.existsSync(resolved)) throw new Error(`图片文件不存在: ${resolved}`);
  return { filePath: resolved, isTemp: false };
}

export const command = cli({
  site: 'taobao',
  name: 'image-search',
  access: 'read',
  description: '淘宝拍立淘以图搜同款商品（对标 OneBound item_search_img / upload_img）',
  domain: 's.taobao.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'image', positional: true, required: true, help: '本地图片路径或网络图片 URL' },
    { name: 'limit', type: 'int', default: 20, help: '返回匹配商品上限（默认 20）' },
  ],
  columns: ['rank', 'item_id', 'title', 'price', 'sales', 'shop', 'url'],
  func: async (page, kwargs) => {
    const limit = Math.min(Math.max(Number.parseInt(String(kwargs.limit || 20), 10) || 20, 1), 60);
    const { filePath, isTemp } = await prepareImageFile(kwargs.image);

    try {
      await page.goto('https://www.taobao.com/');
      await page.wait(2.5);

      const state = await page.evaluate(`
        (() => {
          const href = location.href || '';
          const text = document.body ? (document.body.innerText || '') : '';
          if (href.includes('login.taobao.com') || text.includes('亲，请登录')) return 'login';
          if (href.includes('sec.taobao.com') || document.querySelector('#nc_1_wrapper')) return 'blocked';
          return 'ok';
        })()
      `);
      if (state === 'login') throw new AuthRequiredError('taobao.com', '淘宝拍立淘需要已登录的浏览器会话');
      if (state === 'blocked') throw new Error('CAPTCHA_REQUIRED: 触发淘宝安全验证');

      const buf = await fs.promises.readFile(filePath);
      const b64 = buf.toString('base64');
      const mime = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
      const fileName = path.basename(filePath);

      const uploaded = await page.evaluate(`
        (async () => {
          const camBtn = document.querySelector('[class*="image-search"], [class*="camera"], input[type="file"][accept*="image"]');
          if (camBtn && camBtn.tagName !== 'INPUT') {
            try { camBtn.click(); } catch {}
            await new Promise((r) => setTimeout(r, 800));
          }
          const input = document.querySelector('input[type="file"][accept*="image"], input[type="file"]');
          if (!input) return false;
          const byteChars = atob(${JSON.stringify(b64)});
          const bytes = new Uint8Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
          const blob = new Blob([bytes], { type: ${JSON.stringify(mime)} });
          const file = new File([blob], ${JSON.stringify(fileName)}, { type: ${JSON.stringify(mime)} });
          const dt = new DataTransfer();
          dt.items.add(file);
          input.files = dt.files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()
      `);

      if (!uploaded) {
        throw new Error('未在淘宝搜索栏定位到拍立淘图片上传控件，请先打开 s.taobao.com 确认页面状态');
      }

      await page.wait(5.5);

      const items = await page.evaluate(`
        (() => {
          const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
          const links = Array.from(document.querySelectorAll('a[href*="item.taobao.com/item.htm"], a[href*="detail.tmall.com/item.htm"]'));
          const seen = new Set();
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
            const titleEl = card ? card.querySelector('[class*="title"], [class*="Title"], h3, h4') : null;
            const title = clean((titleEl && titleEl.innerText) || a.innerText);
            const priceMatch = text.match(/[¥￥]\\s*(\\d+(?:\\.\\d+)?)/);
            const salesMatch = text.match(/(\\d+\\+?万?人付款|\\d+\\+?人收货)/);
            const shopEl = card ? card.querySelector('[class*="shopName"], [class*="ShopName"], a[href*="shop"]') : null;
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
    } finally {
      if (isTemp) {
        fs.promises.unlink(filePath).catch(() => {});
      }
    }
  },
});
