# Changelog

## [1.0.2] - 2026-11-10

- The 1.0.1 changes below, published to the Marketplace (1.0.1 was released on
  GitHub only).

## [1.0.1] - 2026-11-10

- **Describe a database schema** writes the description and
  `<name>.schema.json` at once. Before, both waited for **Save** in a
  notification, and a description saved from its unsaved tab had no JSON.
- Describing again when the description already exists writes the JSON even
  if you keep your description.
- The description is titled with the database schema the SQL names
  (`offer.ACCOUNT` → `offer`), or the file's name — no longer its folder path.

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
