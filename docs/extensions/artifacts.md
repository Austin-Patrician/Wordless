# Artifacts

Artifacts are durable outputs that can be referenced by sessions and rendered by profile-specific workbench views without embedding UI components in the Agent Runtime.

Each artifact has a stable ID, project and session ownership, `kind`, version, media type, filesystem location or structured payload reference, creation metadata, and revision state.

An Artifact Handler validates, stores, previews, exports, and optionally contributes model context for one artifact kind. Handlers do not render React components. Renderer registers a view factory by artifact kind and receives only protocol DTOs or approved local resource URLs.

Initial kind families are code/file changes, presentations, workbooks, datasets, reports/charts, images, and UI previews. Unknown kinds use a metadata/download fallback rather than failing the session.
