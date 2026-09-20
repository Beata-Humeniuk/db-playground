# Changelog

## [1.0.0] - 2026-09-20

First public release.

- Markdown schema descriptions from SQL, CSV/TSV and JSON/NDJSON/JSONL files,
  with diagrams for foreign-key relations and nested documents.
- Schema designer with list, tree and diagram views, and script generation
  for PostgreSQL, MySQL/MariaDB, Oracle, SQL Server and MongoDB.
- Visual query builder for SQL `SELECT` and MongoDB `find()` queries.
- Comparison with a saved schema: table and column additions, removals and
  renames, plus type and required-field changes.
- Automatic saving of designer state and queries, `.schema.json` export,
  and configurable model and migration folders.
