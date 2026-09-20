# DB Playground

DB Playground turns a data source into a readable Markdown description of its
database schema, lets you edit that schema in a designer that generates only
the required changes, and assembles `SELECT` queries by clicking. It reads a
SQL dump, a CSV/TSV file or a JSON export and writes Markdown, SQL and JSON
into your workspace.

Everything runs on your machine. No telemetry, no network requests, nothing
is sent anywhere. See [SECURITY.md](SECURITY.md) for the policy and how to
report a problem.

## What it reads

| Input | What is extracted |
|---|---|
| `.sql` — a dump from `pg_dump`, `mysqldump` or generic DDL | Tables, columns (type, `NOT NULL`, defaults, comments), primary and foreign keys, unique constraints, indexes, `COMMENT ON` texts, row counts from `COPY` blocks, relations and a Mermaid ER diagram |
| `.csv` / `.tsv` | Columns with inferred types (integer, number, boolean, date, datetime, text), fill rate, uniqueness, example values; the delimiter (`,` `;` tab `\|`) is detected |
| `.json` / `.ndjson` / `.jsonl` — for example a `mongoexport` collection dump | The document shape: every subdocument and list as its own object (`address`, `items[]`), the fields inside it with types (including Mongo Extended JSON: `$oid`, `$date`, `$numberLong`, …), presence percentages and example values, plus a Mermaid diagram of what nests in what |

SQL dumps and CSV files are streamed chunk by chunk, and `INSERT`/`COPY`
payloads are skipped without being buffered, so multi-hundred-megabyte files
stay cheap to scan.

## Installation

Install **DB Playground** from the Visual Studio Marketplace, or download the
`.vsix` from a [release](https://github.com/Beata-Humeniuk/db-playground/releases)
and use **Extensions → … → Install from VSIX…**.

## Usage

Right-click a `.sql`, `.csv`, `.tsv`, `.json`, `.ndjson` or `.jsonl` file in
the explorer or in the editor and pick one of the **DB Playground** commands.
The same commands are in the Command Palette.

### Describe a database schema

The Markdown description opens as an untitled preview. A notification then
offers to save it as `<source>-schema.md` into the model folder (see
[Settings](#settings)), together with `<source>.schema.json`, the same schema
as machine-readable JSON.

The document starts with YAML frontmatter (`type`, `generator`, `generated`,
`source`, `sourceFormat`, `dialect`, `tables`, `managed`), followed by a
summary, one section per table or collection and, for SQL sources, a
relations table with a Mermaid ER diagram. A collection whose documents nest
gets a `Document structure` section: a diagram of its subdocuments and one
table per subdocument, keyed by the field names as they appear inside it.

### Schema designer (changes and queries)

The designer opens the schema in an editor panel with three columns: the
list of tables or queries on the left, the selected element in the middle
with a live code preview below, and a properties panel on the right where
the selected table, column, index or join is edited. Rows added since the
source was loaded carry a `new` badge.

- **Database picker** — PostgreSQL, MySQL/MariaDB, Oracle, SQL Server or
  MongoDB. The database is detected from the source (backticks or
  `ENGINE=` mean MySQL, `COPY` or dollar quoting mean PostgreSQL, JSON means
  MongoDB) and can be changed at any time. Generated syntax follows the
  choice.
- **Schema view** — edit tables, columns (name, type, required, primary
  key, default, description), indexes and foreign-key relations. The fields
  are shown in one of three ways, switched in the section header:
  - **Tree** — for a collection whose documents nest, each subdocument is
    one collapsed row that opens into its own fields, named as they are
    inside it. A list of scalars is one row; a list of subdocuments opens
    like an object.
  - **List** — the flat list of every path, which is what the change
    script is written in terms of.
  - **Diagram** — one box per subdocument, or per table for a SQL schema,
    joined by what nests in what or by the foreign keys. Zoom with the
    buttons or `Ctrl`+wheel, pan by dragging, `Fit` fits the whole
    drawing. Clicking a box selects it for the properties panel.

  The bottom panel previews the change script: only the differences against
  the schema as loaded, with renames emitted as `RENAME` rather than
  drop-and-add. For MongoDB the script is a mongosh script (`$rename`,
  `$set`, `$unset`, `createIndex`, …). The `full CREATE` mode emits the whole
  schema instead, which is handy when the source was a CSV or JSON profile
  and the database does not exist yet.
- **Queries view** — assemble `SELECT` queries by clicking: base table,
  joins prefilled from foreign keys, result columns, `WHERE` conditions,
  ordering and a row limit. The preview renders SQL in the dialect of the
  chosen database (`LIMIT`, `FETCH FIRST`, `TOP`) or a MongoDB `find()`
  call. Copy it or open it as a file.

Opening a script as a file saves it into the model folder (full `CREATE`) or
the migration folder (changes only) and refreshes `<source>.schema.json`.

The designer state (database, baseline, edited schema, queries) is saved
automatically to `<source>.db-playground.json` beside the source file, so
work survives closing the panel. Opening the designer on the source again
picks it up.

### Compare schema with the tree version

Run on a fresh dump, this command compares it with the `.schema.json` stored
in the model folder and opens a report of what changed. Tables and columns
that vanished are matched to candidates by similarity and confirmed by you,
never guessed. The stored schema is replaced only after you approve.

### Working with Logic Spec

When the [Logic Spec](https://github.com/Beata-Humeniuk) extension is
installed, the queries view shows **To flow step**, which hands the composed
`SELECT` to a database step of a chosen package. Saving a migration script
also opens an impact report that crosses the changes with every package
referencing this schema, and after an explicit approval substitutes renamed
tables and columns in those packages. Without Logic Spec the button is hidden
and the report simply finds no packages.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `dbPlayground.modelFolder` | `<project>-spec/db/model` | Workspace-relative folder for the model: the Markdown description, the full `CREATE` script (or Mongo schema script) and the `.schema.json` file. When the source file lies outside the workspace, the files are saved next to the source. |
| `dbPlayground.migrationFolder` | `<project>-spec/db/migration` | Workspace-relative folder for change scripts from the designer. |

`<project>` is the name of the workspace folder. Keep the model folder inside
`<project>-spec/` when Logic Spec is in use, because packages reference the
schema relative to that tree.

## Language

The interface is in English.

## Links

- [Issues](https://github.com/Beata-Humeniuk/db-playground/issues)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)
- [License](LICENSE) (MIT)
