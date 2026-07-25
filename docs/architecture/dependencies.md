# Dependency Rules

## Package Direction

```text
@wordless/ai <- @wordless/agent

domain <- protocol <- ui-kit <- desktop renderer
domain + agent + ai <- profile-sdk
domain + agent <- persistence / platform-node
profile-sdk + platform ports <- capabilities <- profiles
domain + protocol + profile-sdk + agent + ai <- runtime
runtime + persistence + platform-node + profiles <- desktop main
protocol <- desktop preload
```

## Allowed Dependencies

| Package | May depend on | Must not depend on |
|---|---|---|
| domain | none | Electron, React, pi forks, database |
| protocol | domain, schema library | Electron, provider SDKs, runtime implementations |
| runtime | domain, protocol, profile-sdk, ai, agent | Electron, React, concrete profiles or repositories |
| profile-sdk | domain, ai, agent | runtime, Electron, concrete capabilities |
| capabilities | domain, profile-sdk, agent, explicit platform ports | profiles, Electron, persistence |
| profiles | profile-sdk and capabilities | other profiles, Electron, persistence |
| persistence | domain and agent session contracts | React, profiles, Electron UI |
| platform-node | domain and agent execution contracts | Electron, React, profiles |
| ui-kit | domain, protocol, React when introduced | runtime, Node, ai, agent, persistence |

Electron Main is the only module allowed to import concrete profiles and concrete infrastructure together. Cross-package imports must use package exports rather than another package's internal source paths.

## Fork Boundary

Application-specific behavior must not be added to `packages/ai` or `packages/agent`. Extend Wordless through Runtime, Profile SDK, Capability, persistence adapters, or protocol adapters first. Fork edits require a generic lower-level justification and an entry in `WORDLESS_CHANGES.md`.
