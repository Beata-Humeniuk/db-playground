# DB Playground

VS Code extension that turns a data source into a readable Markdown
description of its database schema — and lets you edit that schema in a
designer that generates only the required changes (ALTER statements or a
mongosh script) and click-assemble SELECT queries. Everything runs locally —
nothing leaves the machine.

Supported inputs:

| Input | What is extracted |
|---|---|
| `.sql` — a dump from `pg_dump`, `mysqldump` or generic DDL | Tables, columns (type, NOT NULL, defaults, comments), primary/foreign keys, unique constraints, indexes, `COMMENT ON` texts, row counts from `COPY` blocks, relations + Mermaid ER diagram |
| `.csv` / `.tsv` | Columns with inferred types (integer, number, boolean, date, datetime, text), fill rate, uniqueness, example values; delimiter auto-detection (`,` `;` tab `\|`) |
| `.json` / `.ndjson` / `.jsonl` — e.g. a `mongoexport` collection dump | The document shape: every subdocument and list as its own object (`address`, `items[]`), the fields inside it with types (including Mongo Extended JSON: `$oid`, `$date`, `$numberLong`, …), presence percentages and example values, plus a Mermaid diagram of what nests in what |

Large files are handled: SQL dumps and CSV files are streamed chunk by
chunk, and `INSERT`/`COPY` payloads in dumps are skipped without being
buffered, so multi-hundred-MB dumps stay cheap to scan.

## Usage

Right-click a `.sql`, `.csv`, `.tsv`, `.json`, `.ndjson` or `.jsonl` file in
the explorer or editor and pick **Describe a database schema** (also available
from the command palette as `DB Playground: Describe a database schema`).

### Schema designer: change scripts and queries

**Schema designer (changes and queries)** (same context menus) opens the
loaded schema in an editor panel — a three-column layout: the table/query
list on the left, the selected element in the middle with a live code
preview below, and a properties panel on the right where the selected
table, column, index or join is edited (destructive actions live there
too). Rows added since the source was loaded carry a `new` badge:

- **Database picker** — PostgreSQL, MySQL/MariaDB, Oracle, SQL Server or
  MongoDB. Detected automatically from the source (backticks/`ENGINE=` →
  MySQL, `COPY`/dollar quoting → PostgreSQL, JSON → MongoDB) and changeable
  at any time; generated syntax follows the choice.
- **Schema view** — edit tables, columns (name, type, required, PK,
  default, description), indexes and foreign-key relations. The fields are
  shown in one of three ways, switched in the section header:
  - **Tree** — for a collection whose documents nest, the tree the paths
    came from: each subdocument one collapsed row (`originalOrder`, `26 fields`)
    that opens into its own fields, named as they are inside it rather than
    as `originalOrder.product.promotion.code`. A list of scalars is one row
    (`tags[]`, `list: string`), a list of subdocuments opens like an object.
  - **List** — the flat list of every path, which is what the change script
    is written in terms of. Offered for every source; the only view a table
    without nesting needs.
  - **Diagram** — the same thing drawn: one box per subdocument (or per table
    for a SQL schema), joined by what nests in what (or by the foreign keys,
    labelled with the FK column). Zoom with the buttons or `Ctrl`+wheel, pan
    by dragging, `Fit` fits the whole drawing; clicking a box selects it
    for the properties panel.

  The bottom panel live-previews the migration script containing **only the
  changes** against the schema as loaded (renames become `RENAME`, not
  drop+add). For MongoDB the script is a mongosh script (`$rename`, `$set`,
  `$unset`, `createIndex`…). A `full CREATE` mode emits the whole schema
  instead — handy when the source was a CSV/JSON profile and the database
  does not exist yet.
- **Queries view** — click-assemble SELECT queries: base table, joins
  (prefilled from foreign keys), result columns, WHERE conditions, ordering
  and a row limit. The preview renders dialect-correct SQL (`LIMIT`,
  `FETCH FIRST`, `TOP`) or a MongoDB `find()` call. Copy it or open it as a
  file.

The designer state (dialect, baseline, edited schema, queries) is saved
automatically to `<source>.db-playground.json` beside the source file, so work
survives closing the panel; opening the designer on the source again picks
it up.

The generated Markdown opens as an untitled preview; a notification then
offers to save it into the model folder (default `<project>-spec/db/model/`, see
the `dbPlayground.modelFolder` setting) as `<source>-schema.md`. The machine
schema (`<source>.schema.json`) is saved alongside it — see the bridge section below.

The output starts with YAML frontmatter per the shared docs contract
(`type: db-playground-schema`, `generator`, `generated`, `source`, `sourceFormat`,
`dialect`, `tables`, `managed: true`) so downstream tooling can pick it up, followed by a
summary, one section per table/collection and — for SQL sources — a relations
table with a Mermaid ER diagram.

A collection whose documents nest is not written out as one flat list of
dotted paths. It gets a `Document structure` section — a Mermaid ER diagram
of its subdocuments and the lists between them — followed by one table per
subdocument, each keyed by the field names as they appear inside it, with the
full path in the heading.

## The schema → flow bridge (issue #146)

Beside the md description and the model script, the extension writes the
**machine layer of the schema**: `db/model/<base>.schema.json` — tables,
columns and types as JSON. Logic Spec packages point at it (`dbSchema` in
`api.json`) to derive output-model fields with real types and to check
`INSERT`/`UPDATE` column lists.

The bridge file lives in the model folder (`<project>-spec/db/model/` by
default). Logic Spec looks for schemas in the default place, so keep
`dbPlayground.modelFolder` inside `<project>-spec/` when the bridge is in
use; the reference stored in a package is then relative to the spec tree.

- **To flow step** (queries tab, visible only with Logic Spec
  installed) sends the composed SELECT into a database step of a chosen
  `api/` package — an empty SQL field fills in, existing SQL gets a
  proposal, never a silent swap (DECISIONS §28).
- Saving a **migration script** also refreshes the schema JSON and opens a
  **schema impact report** (🔴 will break / 🟡 to review / ℹ️ new) crossing
  the changes with every package that references this schema. Renames made
  in the designer carry identity, so — after an explicit approval — the
  renamed table/column references in step SQL and model fields are
  substituted, each substitution listed in its own report.
- **DB Playground: Compare schema with the tree version** does the same for
  a fresh dump: vanished tables/columns get identity **questions** with
  scored candidates (never a guess), the impact report opens before
  anything is written, and the new schema JSON lands in the tree only on
  approval.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `dbPlayground.modelFolder` | `<project>-spec/db/model` | Workspace-relative folder for the model: the Markdown description, the full CREATE script (or Mongo schema script) and the `.schema.json` bridge file. Part of the generated `<project>-spec/` tree by default, never the hand-written `docs/`. When the source file lies outside the workspace, the files are saved next to the source. |
| `dbPlayground.migrationFolder` | `<project>-spec/db/migration` | Workspace-relative folder for change scripts from the designer, ready to hand to a developer. |

## Installation

Install the `.vsix` via **Extensions → … → Install from VSIX…**
or `code --install-extension db-playground-<version>.vsix`.
