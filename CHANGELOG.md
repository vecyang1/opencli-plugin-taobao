# Changelog - OpenCLI Plugin Taobao

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-11-13

### Features
- **OneBound & JustOneAPI 淘宝轮子全量对标补齐**：
  - `market.js` 新增 `--min-price` 与 `--max-price` 价格区间筛选参数。
  - 新增 `shop.js`：淘宝/天猫店铺档案与全店商品多页抓取（支持销量/上新/价格排序及店内搜索）。
  - 新增 `questions.js`：商品「问大家」买家真实问答提取。
  - 新增 `image-search.js`：淘宝拍立淘以图搜同款。
  - 新增 `similar.js`：同款、相似款与看了又看推荐提取。
  - 新增 `suggest.js`：零登录极速搜索下拉联想词推荐。
  - 新增 `resolve-link.js`：淘宝/天猫/1688 分享短链（`m.tb.cn`）规范链接与商品 ID 解析。
  - 新增 `tests/adapter_scripts.test.js`：全量 16 个适配器语法、`cli()` 契约与注入脚本编译校验。

## [2026-11-13] - 2026-11-13

### Features
- Add safe visual detail extractor, SKU unmasking, and review photo inspection (`2ddc8b7`)

### Fixes
- Progressive 4-step scroll, tmall.hk selector, adaptive max-pages and 2-page zero-yield guard (`69d0323`)
- Smart pagination polling, dynamic ceiling and ad attrition compensation (`43bf0fe`)
- Dynamic multi-page calculation from limit and auto-expanded limit from pages (`7e3eb8b`)

### Maintenance
- Auto-sanitize privacy files and local paths (`cab6834`)

## [1.3.2] - 2026-11-10

### Added
- **Direct Page Jumping (`--page`)**: Added `--page <N>` argument in `opencli taobao orders` to jump directly to any arbitrary historical page.
- **Deep Order History Traversal (`--all`)**: Expanded `--all` traversal boundary up to 200 pages (10,000 orders).
- **Enriched Order Fields**: Added unit price, quantity, and payment method extraction in order records.

### Fixed
- **Smart Pagination Polling**: Replaced fixed sleep wait in order pagination with smart DOM polling that detects order ID state transitions.
- **Market Scraper Cleaning**: Stripped repeated shop prefix markers and cleaned location field pollution in `opencli taobao market`.

## [1.3.1] - 2026-11-10

### Fixed
- Enhanced Fusion pagination selector matching and fallback URL query parameters (`&s=${page*44}&page=${page+1}`).
- Added human captcha challenge detection (`sec.taobao.com` and `#nc_1_wrapper`) with fail-safe error envelopes.
- High-precision price extraction combining `priceInt` and `priceFloat` DOM selectors.

## [1.3.0] - 2026-11-09

### Added
- **Market Research Command (`market`)**: Added `opencli taobao market` adapter for extracting active marketplace listings by keyword with multi-page pagination, item IDs, live prices, sales volumes, shop names, and service tags.
- Added typed `AUTH_REQUIRED` contract handling for market search redirects to login.

## [1.1.1] - 2026-09-02

### Fixed
- Fixed injected script parsing in `sync` and `chat` commands after role sanitization.
- Cleaned empty custom payload formatting to prevent rendering empty `{}` brackets in message logs.
- Sanitized hardcoded usernames and contact identifiers across examples and help documentation.

## [1.1.0] - 2026-08-30

### Added
- **Time Offset Synchronization (`sync --offset`)**: Added backward-offset time cursor pagination to extract historical chat threads.
- **Typed Auth Error Contracts**: Added explicit `AUTH_REQUIRED` status code and guidance when redirected to Taobao login pages.

## [1.0.0] - 2026-08-29

### Added
- Initial release of `opencli-plugin-taobao`.
- Browser-bridge integration accessing buyer chat histories, 10-year historical order ledgers, purchased shop directories, and saved favorites without triggering bot detection.
