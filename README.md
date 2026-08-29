# 🛍️ opencli-plugin-taobao

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![OpenCLI](https://img.shields.io/badge/OpenCLI->=1.8.6-orange.svg)](https://github.com/jackwener/OpenCLI)

> **Taobao Buyer Chat History, 10-Year Historical Orders, Bought Shops, Collected Favorites, and AI Semantic Reasoning Suite for OpenCLI.**

淘宝买家旺旺聊天记录、已买到的宝贝（跨年订单流水）、购买过的店铺与宝贝收藏夹全域智能套件插件。

---

## 🌟 Highlights

1. **👑 Zero-Risk & No Captchas**: Directly reuses logged-in Chrome browser sessions via OpenCLI's Browser Bridge — zero credential storage, zero risk of tripping WUA/x-sign anti-bot gates.
2. **⚡ Deep Backward Time Cursor Pagination**: Automatically pages backwards through `_imsdk` time cursors (`listPrevMsgs`) to pull complete historical chat logs across years.
3. **📦 10-Year Multi-Tier Retrieval**:
   - `opencli taobao orders`: Multi-page order extraction (order ID, date, shop, SKU spec, paid amount, status).
   - `opencli taobao bought-shops`: Multi-category shop inventory (24+ categories like Digital, Home, Apparel).
   - `opencli taobao favorites`: Virtual scroll extractor for collected items, prices, and discounts.
   - `opencli taobao cart`: Live shopping cart items.
4. **🧠 AI Semantic Reasoning**: Structured extraction of seller warranty commitments (保修/包邮), customized product specifications, dispute evidence chains, and out-of-platform payment risks.

---

## 🚀 Installation

```bash
opencli plugin install github:vecyang1/opencli-plugin-taobao
```

Or manually link:
```bash
cp -r clis/taobao ~/.opencli/clis/
```

---

## 📖 Available Commands

```bash
# 1. List seller conversations
opencli taobao sessions --limit 20 -f table

# 2. Extract full chat history with a seller (auto backward pagination)
opencli taobao chat "某数码专营店" --limit 50 -f table

# 3. Extract 10-year historical orders (bought items)
opencli taobao orders --pages 3 -f table

# 4. Extract bought shops
opencli taobao bought-shops --category "数码" -f table

# 5. Extract favorites
opencli taobao favorites --limit 20 -f table

# 6. Check shopping cart
opencli taobao cart -f table

# 7. AI Semantic Reasoning on seller commitments & dispute evidence
opencli taobao reason "某官方旗舰店" -f yaml

# 8. Export chat history to Markdown / HTML
opencli taobao export "某品牌专卖店" --format html --output ./chat.html

# 9. High-speed batch sync
opencli taobao sync --limit 30 -f json
```

---

## 📄 License

This project is licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0-or-later)](./LICENSE).
