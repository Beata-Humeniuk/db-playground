# Changelog

This file lists user-visible changes to DB Playground. The project follows
[Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-09-20

First public release.

### Added

- Describe a database schema from a SQL dump (`pg_dump`, `mysqldump` or
  generic DDL), a CSV/TSV file or a JSON/NDJSON export such as a
  `mongoexport` collection dump: a Markdown document with one section per
  table or collection, a relations table and a Mermaid ER diagram. Nested
  documents get a diagram of their subdocuments and a table per
  subdocument.
- Schema designer with a database picker (PostgreSQL, MySQL/MariaDB,
  Oracle, SQL Server, MongoDB): edit tables, columns, indexes and
  relations; the preview shows only the required changes as `ALTER`
  statements or a mongosh script, or the full `CREATE` script on request.
  Fields can be viewed as a tree, a flat list or a diagram.
- Click-assembled `SELECT` queries with joins suggested from foreign keys,
  rendered in the dialect of the chosen database or as a MongoDB `find()`
  call.
- Compare a fresh dump with the schema stored in the workspace and get a
  report of what changed before anything is written.
- A machine-readable `.schema.json` beside the description, and an
  optional hand-off of a composed query to the Logic Spec extension when it
  is installed.
- Streaming input: multi-hundred-megabyte dumps and CSV files are read
  chunk by chunk, and `INSERT`/`COPY` payloads are skipped without being
  buffered.
- Settings for the model folder and the migration folder, defaulting to
  `<project>-spec/db/model` and `<project>-spec/db/migration`.
