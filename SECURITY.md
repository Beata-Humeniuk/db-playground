# Security Policy

Security fixes are provided for the latest published version.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/Beata-Humeniuk/db-playground/security/advisories/new).
If unavailable, open an issue without sensitive details and ask for a private
contact method. Include steps to reproduce the problem and, if needed, a small
sample with made-up data. Do not include real dumps, credentials or personal
data.

## Data handling

DB Playground processes files locally, sends no telemetry and makes no network
requests. It does not connect to databases or execute generated scripts.

Descriptions may include sample values from CSV and JSON files. The designer
saves its state beside the source; export locations depend on the open
workspace and [folder settings](README.md#saving-files).
