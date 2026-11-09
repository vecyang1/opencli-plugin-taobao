# Changelog - OpenCLI Plugin Taobao

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
