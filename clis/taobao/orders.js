import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError } from '@jackwener/opencli/errors';

export const command = cli({
  site: 'taobao',
  name: 'orders',
  access: 'read',
  description: '获取淘宝已买到的宝贝 / 历史订单列表 (支持跨页翻页拉取、关键词搜索、状态过滤)',
  domain: 'buyertrade.taobao.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'query', positional: true, required: false, help: '按商品名称、店铺名或订单号搜索筛选' },
    { name: 'pages', type: 'int', default: 1, help: '翻页抓取的总页数 (默认 1 页 = 30条, 设为 5 可拉取 150条)' },
    { name: 'limit', type: 'int', default: 50, help: '返回的最大订单数量' },
    { name: 'all', type: 'bool', default: false, help: '是否全量翻页拉取全部历史订单 (最多翻 50 页)' },
    { name: 'status', required: false, help: '按订单状态筛选 (如: 交易成功, 待发货, 待收货, 待付款)' },
  ],
  columns: [
    'order_date',
    'shop',
    'status',
    'title',
    'spec',
    'price',
    'quantity',
    'total_paid',
    'payment_method',
    'order_id'
  ],
  func: async (page, kwargs) => {
    const maxPages = kwargs.all ? 50 : (kwargs.pages || 1);
    const query = (kwargs.query || '').trim().toLowerCase();
    const statusFilter = (kwargs.status || '').trim();
    const limit = kwargs.all ? 2000 : (kwargs.limit || 50);
    
    await page.goto('https://buyertrade.taobao.com/trade/itemlist/list_bought_items.htm');
    await page.wait(4);
    
    const isAuth = await page.evaluate(`
      (() => {
        const text = document.body?.innerText || '';
        return text.includes('已买到的宝贝') || text.includes('所有订单');
      })()
    `);
    
    if (!isAuth) {
      throw new AuthRequiredError('淘宝已买到的宝贝需要已登录的浏览器会话');
    }
    
    const allOrders = [];
    
    for (let p = 1; p <= maxPages; p++) {
      const pageOrders = await page.evaluate(`
        (() => {
          const text = document.body?.innerText || '';
          const parts = text.split(/(?=\\d{4}-\\d{2}-\\d{2}\\s*\\n\\s*订单号:)/);
          
          const parsedOrders = [];
          for (const p of parts) {
            const lines = p.split('\\n').map(s => s.trim()).filter(Boolean);
            const orderMatch = p.match(/订单号:\\s*(\\d+)/);
            const dateMatch = p.match(/(\\d{4}-\\d{2}-\\d{2})/);
            if (!orderMatch) continue;
            
            const orderId = orderMatch[1];
            const orderDate = dateMatch ? dateMatch[1] : '';
            
            // Shop name
            let shopName = '';
            const orderIdx = lines.findIndex(l => l.includes('订单号:'));
            if (orderIdx >= 0 && lines[orderIdx + 1] && !lines[orderIdx + 1].includes('订单详情')) {
              shopName = lines[orderIdx + 1];
            }
            
            // Status
            let status = '交易成功';
            if (p.includes('退款成功') || p.includes('交易关闭')) status = '交易关闭/已退款';
            else if (p.includes('买家已付款')) status = '买家已付款';
            else if (p.includes('待发货')) status = '待发货';
            else if (p.includes('卖家已发货')) status = '卖家已发货';
            else if (p.includes('待付款')) status = '待付款';
            else if (p.includes('待收货')) status = '待收货';
            else if (p.includes('交易成功')) status = '交易成功';
            
            // Payment method
            let paymentMethod = '其他/未注明';
            if (p.includes('该订单使用信用卡支付') || p.includes('信用卡支付')) {
              paymentMethod = '信用卡支付';
            } else if (p.includes('支付宝') || p.includes('Alipay')) {
              paymentMethod = '支付宝';
            } else if (p.includes('微信支付') || p.includes('WeChat')) {
              paymentMethod = '微信支付';
            } else if (p.includes('花呗')) {
              paymentMethod = '花呗';
            } else if (p.includes('手机订单')) {
              paymentMethod = '手机支付(支付宝/免密)';
            }
            
            // Total paid
            let total = '';
            const totalMatch = p.match(/实付款\\s*[¥￥]\\s*([\\d.]+)/);
            if (totalMatch) {
              total = totalMatch[1];
            }
            
            // Title & Spec
            let title = '';
            let spec = '';
            let detailIdx = lines.findIndex(l => l === '订单详情');
            if (detailIdx >= 0) {
              let cur = detailIdx + 1;
              while (cur < lines.length && (
                lines[cur] === '买家已付款' ||
                lines[cur] === '交易成功' ||
                lines[cur] === '交易关闭' ||
                lines[cur] === '卖家已发货' ||
                lines[cur] === '采购订单' ||
                lines[cur].startsWith('待发货') ||
                lines[cur].startsWith('待收货')
              )) {
                cur++;
              }
              if (cur < lines.length) {
                title = lines[cur].replace(/\\[交易快照\\]/g, '').trim();
                cur++;
                if (cur < lines.length && !lines[cur].match(/^(不支持|申请售后|退货宝|极速退款|退款|加入购物车|[¥￥]|x\\d|实付款|待发货)/)) {
                  spec = lines[cur].replace(/\\[交易快照\\]/g, '').trim();
                }
              }
            }
            
            // Quantity & Price
            let quantity = 1;
            const qtyMatch = p.match(/x(\\d+)/);
            if (qtyMatch) quantity = parseInt(qtyMatch[1], 10);
            
            const priceMatches = Array.from(p.matchAll(/[¥￥]([\\d.]+)/g)).map(m => m[1]);
            let price = priceMatches.length > 0 ? priceMatches[0] : (total || '0');
            
            parsedOrders.push({
              order_id: orderId,
              order_date: orderDate,
              shop: shopName,
              status: status,
              title: title.slice(0, 150),
              spec: spec.slice(0, 150),
              price: '￥' + price,
              quantity: quantity,
              total_paid: total ? '￥' + total : ('￥' + price),
              payment_method: paymentMethod
            });
          }
          
          return parsedOrders;
        })()
      `);
      
      for (const ord of pageOrders) {
        if (!allOrders.some(existing => existing.order_id === ord.order_id)) {
          allOrders.push(ord);
        }
      }
      
      if (allOrders.length >= limit || p >= maxPages) break;
      
      // Attempt click next page
      const hasNext = await page.evaluate(`
        (() => {
          const nextBtn = document.querySelector('.ant-pagination-next button, .ant-pagination-next .ant-pagination-item-link, .next-pagination-item-link');
          const isDisabled = document.querySelector('.ant-pagination-next')?.classList.contains('ant-pagination-disabled');
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
    
    let filtered = allOrders;
    if (query) {
      filtered = filtered.filter(o => 
        o.title.toLowerCase().includes(query) || 
        o.shop.toLowerCase().includes(query) || 
        o.order_id.includes(query) ||
        o.spec.toLowerCase().includes(query)
      );
    }
    
    if (statusFilter) {
      filtered = filtered.filter(o => o.status.includes(statusFilter));
    }
    
    return filtered.slice(0, limit);
  }
});
