import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError } from '@jackwener/opencli/errors';

export const command = cli({
  site: 'taobao',
  name: 'questions',
  access: 'read',
  description: '获取淘宝/天猫商品「问大家」买家真实问答（对标 OneBound item_question_answer / JustOneAPI Product Questions V1）',
  domain: 'item.taobao.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'id', positional: true, required: true, help: '商品 ID 或淘宝/天猫商品链接' },
    { name: 'limit', type: 'int', default: 20, help: '返回问答数量上限（默认 20）' },
  ],
  columns: ['item_id', 'question', 'answer_count', 'top_answer'],
  func: async (page, kwargs) => {
    const rawId = String(kwargs.id || '').trim();
    const idMatch = rawId.match(/(\d{8,16})/);
    if (!idMatch) throw new Error('无效的商品 ID: ' + rawId);
    const itemId = idMatch[1];
    const limit = Math.min(Math.max(Number.parseInt(String(kwargs.limit || 20), 10) || 20, 1), 50);

    const targetUrl = `https://item.taobao.com/item.htm?id=${itemId}`;
    await page.goto(targetUrl);
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
    if (state === 'login') throw new AuthRequiredError('taobao.com', '查看问大家问答需要已登录的淘宝会话');
    if (state === 'blocked') throw new Error('CAPTCHA_REQUIRED: 触发安全滑块，请先在浏览器完成验证');

    await page.evaluate(`
      (async () => {
        window.scrollTo(0, Math.min(2600, document.body.scrollHeight * 0.6));
        await new Promise((r) => setTimeout(r, 900));
        const qaTrigger = Array.from(document.querySelectorAll('a, button, div, span'))
          .find((el) => /问大家|查看全部.*问题/.test((el.innerText || '').trim()) && (el.innerText || '').trim().length <= 16);
        if (qaTrigger) {
          try { qaTrigger.click(); } catch {}
          await new Promise((r) => setTimeout(r, 1000));
        }
      })()
    `);
    await page.wait(1.0);

    const items = await page.evaluate(`
      (() => {
        const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
        const cards = Array.from(document.querySelectorAll('[class*="ask"], [class*="question"], [class*="qaItem"], [class*="AskItem"]'));
        const rows = [];
        const seen = new Set();
        for (const card of cards) {
          const text = (card.innerText || '').trim();
          if (text.length < 4) continue;
          const lines = text.split('\\n').map(clean).filter(Boolean);
          const qLine = lines.find((l) => l.endsWith('？') || l.endsWith('?') || l.startsWith('问')) || lines[0] || '';
          if (!qLine || seen.has(qLine) || qLine.length < 4) continue;
          seen.add(qLine);
          const ansMatch = text.match(/(\\d+)\\s*个?回答/);
          const topAnswer = lines.find((l) => l !== qLine && !/个?回答/.test(l) && l.length >= 2) || '';
          rows.push({
            item_id: ${JSON.stringify(itemId)},
            question: qLine.replace(/^问[：:\\s]*/, ''),
            answer_count: ansMatch ? Number.parseInt(ansMatch[1], 10) : (topAnswer ? 1 : 0),
            top_answer: topAnswer.replace(/^答[：:\\s]*/, ''),
          });
          if (rows.length >= ${limit}) break;
        }
        return rows;
      })()
    `);

    return Array.isArray(items) ? items : [];
  },
});
