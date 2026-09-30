# Changelog

## [1.8.4](https://github.com/orochibraru/svelte-smol/compare/v1.8.3...v1.8.4) (2026-09-30)

### Bug Fixes

* **kit3:** honour Range on static assets (206/416, If-Range, Accept-Ranges), compiled builds answered 200 with the full body ([54a4332](https://github.com/orochibraru/svelte-smol/commit/54a4332d80e3e151c4e2a7072c9294a59e1f7739))

## Unreleased

### Bug Fixes

* **kit3:** honour `Range` on static assets and prerendered pages (`206`, `416`, `If-Range`, `Accept-Ranges`): a compiled build answered every range request with `200` and the full body, because Bun only applies ranges to on-disk files

## [1.8.3](https://github.com/orochibraru/svelte-smol/compare/v1.8.2...v1.8.3) (2026-09-29)

### Bug Fixes

* **kit3:** honour runtime ORIGIN (regression in 1.8.0: form actions failed CSRF on plain-HTTP deployments) ([857ce39](https://github.com/orochibraru/svelte-smol/commit/857ce3923362cd686d0602b73eb498ea89ececdc))

## [1.8.2](https://github.com/orochibraru/svelte-smol/compare/v1.8.1...v1.8.2) (2026-09-29)

### Code Refactoring

* kit3 support in main instead of maintaining next branch ([e14696e](https://github.com/orochibraru/svelte-smol/commit/e14696e0b3fbe01029118bfdc8c565174ff03b8b))

## [1.8.1](https://github.com/orochibraru/svelte-smol/compare/v1.8.0...v1.8.1) (2026-09-19)

### Bug Fixes

* docs code parsing ([c175405](https://github.com/orochibraru/svelte-smol/commit/c175405082e418a34994db657fbb32806adac2a7))
* release system ([43f3de7](https://github.com/orochibraru/svelte-smol/commit/43f3de70b0f7697f110283724a1b6863dddbc0e8))

## [1.3.1](https://git.ombrage.space/orochibraru/svelte-bun-adapter/compare/v1.3.0...v1.3.1) (2026-08-29)


### Bug Fixes

* build ([e14cc19](https://git.ombrage.space/orochibraru/svelte-bun-adapter/commit/e14cc19dd5666090eff3fe7cc8fc03b7369ffffd))

# [1.3.0](https://git.ombrage.space/orochibraru/svelte-bun-adapter/compare/v1.2.0...v1.3.0) (2026-08-29)


### Features

* binary ([9bbda12](https://git.ombrage.space/orochibraru/svelte-bun-adapter/commit/9bbda12c13adf2d6ec4410b4deec4f3fc6794198))

# [1.2.0](https://git.ombrage.space/orochibraru/svelte-bun-adapter/compare/v1.1.1...v1.2.0) (2026-08-29)


### Features

* works ([5bec6ad](https://git.ombrage.space/orochibraru/svelte-bun-adapter/commit/5bec6ad0735a316aae760d0db60057ad42a11f4c))

## [1.1.1](https://git.ombrage.space/orochibraru/svelte-bun-adapter/compare/v1.1.0...v1.1.1) (2026-08-28)


### Bug Fixes

* secret name ([94a2e39](https://git.ombrage.space/orochibraru/svelte-bun-adapter/commit/94a2e39d4cc4b27943e461ce1939597de66ab518))

# [1.1.0](https://git.ombrage.space/orochibraru/svelte-bun-adapter/compare/v1.0.0...v1.1.0) (2026-08-28)


### Features

* publishing ([e5d1cc0](https://git.ombrage.space/orochibraru/svelte-bun-adapter/commit/e5d1cc0ec9c44f6f38782954831ce9dc23a67869))

# 1.0.0 (2026-08-28)


### Features

* base ([b9a207e](https://git.ombrage.space/orochibraru/svelte-bun-adapter/commit/b9a207efb08a61149677bbe9106cb121af35e9c9))
* husky ([ac1dc22](https://git.ombrage.space/orochibraru/svelte-bun-adapter/commit/ac1dc22269fd7363250ce0339d2b2096ca21daa1))
* release flow ([8cf1b0e](https://git.ombrage.space/orochibraru/svelte-bun-adapter/commit/8cf1b0e08e6cfdcc432b4164eab11b0ec3cfb24b))

# Changelog

All notable changes are documented here. This file is maintained by [semantic-release](https://semantic-release.gitbook.io/) from Conventional Commit messages.
