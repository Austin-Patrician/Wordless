# @wordless/persistence

Concrete local repositories for JSONL session journals, SQLite metadata, schema migrations, and index reconciliation.

JSONL is authoritative for conversation history. SQLite stores queryable project, session, configuration, artifact, and permission metadata that can be rebuilt where applicable.
