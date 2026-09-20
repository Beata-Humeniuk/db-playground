# Security Policy

## Supported versions

Security fixes are released for the latest published version of the
extension. Older versions are not patched separately — please update to the
newest release.

## Reporting a vulnerability

Please use
[GitHub private vulnerability reporting](https://github.com/Beata-Humeniuk/db-playground/security/advisories/new)
so the issue is not public before a fix exists. If that is not possible,
open a regular issue **without** the sensitive details and ask for a private
channel.

## What not to post

Database dumps and data exports usually describe internal systems. In any
report — public or private:

- do **not** attach a real dump, export or CSV file, internal table names,
  hostnames or connection strings, or anything under NDA;
- do **not** include credentials, tokens or personal data, even as example
  rows.

A minimal **synthetic** file with made-up tables and rows that reproduces the
problem is all that is needed.

## Scope notes

The extension reads only the file the user points it at, writes only into the
workspace folders described in the README, sends no telemetry and makes no
network requests. Anything contradicting that — a network request, a file
written outside the workspace without the user asking — is a security bug;
please report it.
