# Built-In Profiles

First-party scenario assemblies. Each child is an independent private workspace package and may depend only on `@wordless/profile-sdk` plus reusable capability packages.

Profiles must not depend on one another or access Electron, persistence, credentials, or global runtime state.
