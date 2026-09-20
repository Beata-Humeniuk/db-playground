'use strict';

const SIMPLE_IDENT = /^[A-Za-z_][A-Za-z0-9_$]*$/;

function quoted(open, close, escapeWith) {
  return (name) => {
    const n = String(name);
    if (SIMPLE_IDENT.test(n)) return n;
    return open + n.split(close).join(escapeWith) + close;
  };
}

const DIALECTS = {
  postgres: {
    label: 'PostgreSQL',
    kind: 'sql',
    quote: quoted('"', '"', '""'),
    limitStyle: 'limit',
    defaultTypes: {
      integer: 'integer', number: 'numeric(12,2)', boolean: 'boolean',
      date: 'date', datetime: 'timestamptz', string: 'text',
      objectId: 'text', uuid: 'uuid', binary: 'bytea', timestamp: 'timestamptz',
      object: 'jsonb', array: 'jsonb', null: 'text', empty: 'text', regex: 'text',
    },
  },
  mysql: {
    label: 'MySQL/MariaDB',
    kind: 'sql',
    quote: quoted('`', '`', '``'),
    limitStyle: 'limit',
    defaultTypes: {
      integer: 'int', number: 'decimal(12,2)', boolean: 'tinyint(1)',
      date: 'date', datetime: 'datetime', string: 'varchar(255)',
      objectId: 'char(24)', uuid: 'char(36)', binary: 'blob', timestamp: 'timestamp',
      object: 'json', array: 'json', null: 'varchar(255)', empty: 'varchar(255)', regex: 'varchar(255)',
    },
  },
  oracle: {
    label: 'Oracle',
    kind: 'sql',
    quote: quoted('"', '"', '""'),
    limitStyle: 'fetch',
    defaultTypes: {
      integer: 'NUMBER(10)', number: 'NUMBER(12,2)', boolean: 'NUMBER(1)',
      date: 'DATE', datetime: 'TIMESTAMP', string: 'VARCHAR2(255)',
      objectId: 'CHAR(24)', uuid: 'CHAR(36)', binary: 'BLOB', timestamp: 'TIMESTAMP',
      object: 'CLOB', array: 'CLOB', null: 'VARCHAR2(255)', empty: 'VARCHAR2(255)', regex: 'VARCHAR2(255)',
    },
  },
  mssql: {
    label: 'SQL Server',
    kind: 'sql',
    quote: quoted('[', ']', ']]'),
    limitStyle: 'top',
    defaultTypes: {
      integer: 'int', number: 'decimal(12,2)', boolean: 'bit',
      date: 'date', datetime: 'datetime2', string: 'nvarchar(255)',
      objectId: 'char(24)', uuid: 'uniqueidentifier', binary: 'varbinary(max)', timestamp: 'datetime2',
      object: 'nvarchar(max)', array: 'nvarchar(max)', null: 'nvarchar(255)', empty: 'nvarchar(255)', regex: 'nvarchar(255)',
    },
  },
  mongo: {
    label: 'MongoDB',
    kind: 'mongo',
    quote: (name) => String(name),
    limitStyle: 'limit',
    defaultTypes: {
      integer: 'int', number: 'double', boolean: 'bool',
      date: 'date', datetime: 'date', string: 'string',
      objectId: 'objectId', uuid: 'binData', binary: 'binData', timestamp: 'timestamp',
      object: 'object', array: 'array', null: 'null', empty: 'null', regex: 'regex',
    },
  },
};

const DIALECT_ORDER = ['postgres', 'mysql', 'oracle', 'mssql', 'mongo'];

module.exports = { DIALECTS, DIALECT_ORDER };
