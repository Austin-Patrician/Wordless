# Wordless Changes

- Forked from pi `packages/ai` at commit `0e6909f050eeb15e8f6c05185511f3788357ddb3`.
- Renamed the private package to `@wordless/ai` with version `0.80.6-wordless.0`.
- Rewrote package self-references to the Wordless namespace.
- Synchronized the model generator from Pi commit `c5de2cc67f04d2e700617f9452a22a4242aaa1a4`, including strict failure handling, staged generation, model-data validation, and catalog support.
- Kept Wordless runtime dependency versions and namespace-specific package exports unchanged.
