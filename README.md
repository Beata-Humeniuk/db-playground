# DB Playground

A VS Code extension for describing database schemas, editing their structure
and building queries from local files. It generates Markdown, SQL and MongoDB
scripts. It does not connect to databases or run the generated code.

## Installation

Requires VS Code 1.80 or later. To install a `.vsix` package, choose
**Extensions → … → Install from VSIX…**. The interface is in English.

## Input files

| Format | What it reads |
|---|---|
| `.sql` | Tables, columns, keys, indexes and comments from supported SQL statements, including common PostgreSQL and MySQL dump syntax. |
| `.csv`, `.tsv` | Column names from the first non-empty row; inferred types, fill rates and example values from the data. CSV delimiters are detected automatically. |
| `.json`, `.ndjson`, `.jsonl` | Field types, nested objects and arrays, field presence and examples, including MongoDB Extended JSON values. |

SQL import does not cover all SQL syntax. CSV and JSON schemas are inferred
from data. JSON profiling examines the first 100,000 documents and the first
20 elements of each array; regular `.json` files have a 512 MiB size limit.

## Usage

Right-click a supported file and choose **DB Playground**, or use the commands
in the Command Palette.

### Describe a database schema

Opens a Markdown description in an unsaved editor tab. Choose **Save** in the
notification to write `<name>-schema.md` and `<name>.schema.json` to the model
folder. `<name>` is the source filename without its extension.

The description includes tables or collections, their fields and available
metadata. Foreign-key relations and nested document structures include Mermaid
diagrams.

### Schema designer (changes and queries)

- Edit tables or collections, fields, indexes and SQL foreign keys. Use the
  list or diagram view, or the tree view for nested fields.
- Choose PostgreSQL, MySQL/MariaDB, Oracle, SQL Server or MongoDB as the output
  database.
- Preview changes against the loaded schema, or select **full CREATE** to
  generate creation statements.
- In **Queries**, choose result fields, filters, sorting and a row limit.
  SQL queries support joins suggested from foreign keys; MongoDB generates
  `find()` queries without joins.

Changing the output database does not convert existing field types. Some
changes require manual edits to the script. For MongoDB, **full CREATE** creates
empty collections without indexes or validation rules.

The designer automatically saves edits and queries to
`<name>.db-playground.json` beside the source. Reopening restores that state
instead of rereading the source. To reload the source, close the designer and
move the state file aside.

### Compare schema with the tree version (impact report)

Compares the source file with `<name>.schema.json` in its workspace's model
folder. Save that schema first using **Describe a database schema** or the
designer's script export.

The report covers added, removed or renamed tables and columns, changed types
and whether fields are required. It does not compare indexes, keys, defaults
or relations. Suggested renames need confirmation. The stored schema is updated
only after you choose **Save**.

## Saving files

In the designer, **Open as file** saves schema scripts and updates
`<name>.schema.json`. Saving again replaces the script with the same name.
Query previews open as unsaved files.

| Setting | Default folder | Contents |
|---|---|---|
| `dbPlayground.modelFolder` | `<project>-spec/db/model` | Markdown descriptions, `.schema.json` files and full creation scripts. |
| `dbPlayground.migrationFolder` | `<project>-spec/db/migration` | Change scripts. |

Paths are relative to the workspace folder; `<project>` is its name. Empty
settings use the defaults.

For sources outside the workspace, descriptions are saved beside the source;
designer scripts use the first open workspace folder. With no folder open,
scripts open as unsaved files.

## Privacy and links

No telemetry or network requests. Generated descriptions may contain example
values from your data.

[Issues](https://github.com/Beata-Humeniuk/db-playground/issues) ·
[Security policy](SECURITY.md) · [Changelog](CHANGELOG.md) · [MIT license](LICENSE)
