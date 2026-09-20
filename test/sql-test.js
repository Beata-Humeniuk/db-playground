'use strict';

const { parseSqlText, SqlScanner } = require('../src/sqlSchema');

const assert = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exit(1); } };

const PG_DUMP = `
-- PostgreSQL database dump
SET statement_timeout = 0;
SET client_encoding = 'UTF8';

CREATE TABLE public.users (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    status text DEFAULT 'active'::text
);

CREATE TABLE public.orders (
    id bigint NOT NULL,
    user_id integer NOT NULL,
    amount numeric(10,2)
);

CREATE FUNCTION public.noop() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- a semicolon inside a dollar-quoted body: ; and a fake CREATE TABLE x (y int);
END;
$$;

COPY public.users (id, email, created_at, status) FROM stdin;
1\tala@example.com\t2024-01-01\tactive
2\tola; with a backslash \\t in the data\t2024-01-02\tblocked
3\tela@example.com\t2024-01-03\tactive
\\.

INSERT INTO public.audit VALUES (1, 'text with a semicolon; and a -- pseudo comment /* x */');

ALTER TABLE ONLY public.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.orders ADD CONSTRAINT orders_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id);
ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);

CREATE INDEX idx_orders_user ON public.orders USING btree (user_id);
CREATE UNIQUE INDEX idx_users_email ON public.users USING btree (email);

COMMENT ON TABLE public.users IS 'Shop customers';
COMMENT ON COLUMN public.users.email IS 'E-mail address | unique';
`;

const pg = parseSqlText(PG_DUMP);
assert(pg.tables.length === 2, 'pg: expected 2 tables, got ' + pg.tables.length);
const users = pg.tables.find((t) => t.name === 'users');
const orders = pg.tables.find((t) => t.name === 'orders');
assert(users && orders, 'pg: users and orders tables exist');
assert(users.columns.length === 4, 'pg: users has 4 columns, got ' + users.columns.length);
const email = users.columns.find((c) => c.name === 'email');
assert(email.type === 'character varying(255)', 'pg: email type, got ' + email.type);
assert(email.nullable === false, 'pg: email NOT NULL');
assert(email.unique === true, 'pg: email unique via unique index');
assert(email.comment === 'E-mail address | unique', 'pg: email comment');
const id = users.columns.find((c) => c.name === 'id');
assert(id.primaryKey === true, 'pg: users.id is PK (via ALTER TABLE)');
assert(/nextval/.test(id.default || ''), 'pg: users.id default from ALTER, got ' + id.default);
const createdAt = users.columns.find((c) => c.name === 'created_at');
assert(createdAt.type === 'timestamp with time zone', 'pg: created_at type, got ' + createdAt.type);
assert(createdAt.nullable === true, 'pg: created_at nullable');
assert(users.comment === 'Shop customers', 'pg: table comment');
assert(users.rowCount === 3, 'pg: COPY rows counted, got ' + users.rowCount);
assert(pg.relations.length === 1, 'pg: one relation, got ' + pg.relations.length);
assert(pg.relations[0].fromTable === 'orders' && pg.relations[0].toTable === 'users', 'pg: relation orders->users');
const userIdCol = orders.columns.find((c) => c.name === 'user_id');
assert(userIdCol.references && userIdCol.references.table === 'users' && userIdCol.references.column === 'id', 'pg: FK marked on column');
assert(orders.indexes.some((i) => i.name === 'idx_orders_user'), 'pg: index registered');
assert(pg.dialect === 'postgres', 'pg: dialect detected, got ' + pg.dialect);
assert(!pg.tableIndex.has('audit'), 'pg: INSERT did not create a table');
assert(!pg.tableIndex.has('x'), 'pg: dollar-quoted body was not parsed as DDL');

const MYSQL_DUMP = `
-- MySQL dump
CREATE TABLE \`roles\` (
  \`id\` int NOT NULL AUTO_INCREMENT,
  \`name\` varchar(50) NOT NULL,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB;

CREATE TABLE \`users\` (
  \`id\` int unsigned NOT NULL AUTO_INCREMENT,
  \`name\` varchar(100) NOT NULL COMMENT 'User name',
  \`role_id\` int DEFAULT NULL,
  \`balance\` decimal(12,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_name\` (\`name\`),
  KEY \`idx_role\` (\`role_id\`),
  CONSTRAINT \`fk_role\` FOREIGN KEY (\`role_id\`) REFERENCES \`roles\` (\`id\`)
) ENGINE=InnoDB COMMENT='System users';

INSERT INTO \`users\` VALUES (1,'a;b',NULL,'1.00'),(2,'c\\'d; INSERT INTO fake (x) VALUES (1)',3,'2.50');
`;

const my = parseSqlText(MYSQL_DUMP);
assert(my.tables.length === 2, 'mysql: expected 2 tables, got ' + my.tables.length);
const musers = my.tables.find((t) => t.name === 'users');
assert(musers.comment === 'System users', 'mysql: table comment, got ' + musers.comment);
const mid = musers.columns.find((c) => c.name === 'id');
assert(mid.autoIncrement === true, 'mysql: id auto_increment');
assert(mid.primaryKey === true, 'mysql: id PK');
assert(mid.type === 'int unsigned', 'mysql: id type, got ' + mid.type);
const mname = musers.columns.find((c) => c.name === 'name');
assert(mname.comment === 'User name', 'mysql: column comment');
assert(mname.unique === true, 'mysql: unique key marked on column');
const mrole = musers.columns.find((c) => c.name === 'role_id');
assert(mrole.nullable === true, 'mysql: role_id nullable');
assert(mrole.references && mrole.references.table === 'roles', 'mysql: FK from CONSTRAINT');
const mbalance = musers.columns.find((c) => c.name === 'balance');
assert(mbalance.default === "'0.00'", 'mysql: balance default, got ' + mbalance.default);
assert(musers.indexes.some((i) => i.name === 'idx_role' && !i.unique), 'mysql: KEY index registered');
assert(my.dialect === 'mysql', 'mysql: dialect detected, got ' + my.dialect);
assert(!my.tableIndex.has('fake'), 'mysql: semicolon inside INSERT string did not leak a statement');

const chunked = new SqlScanner();
for (let i = 0; i < PG_DUMP.length; i += 7) chunked.push(PG_DUMP.slice(i, i + 7));
const chunkedModel = chunked.end();
assert(chunkedModel.tables.length === pg.tables.length, 'chunked: same table count');
assert(chunkedModel.relations.length === pg.relations.length, 'chunked: same relation count');
assert(chunkedModel.tables.find((t) => t.name === 'users').rowCount === 3, 'chunked: same COPY row count');

console.log('sql-test OK');
