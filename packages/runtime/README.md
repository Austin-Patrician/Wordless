# @wordless/runtime

Application orchestration for models, agents, sessions, runs, profiles, approvals, artifacts, and event delivery.

The runtime consumes abstract repositories and platform ports. It must not import Electron, React, concrete persistence implementations, or concrete profiles. Electron Main supplies those implementations at the composition root.
