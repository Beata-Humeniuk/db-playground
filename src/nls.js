'use strict';

const EN = {
  'designer.title': 'Schema: {source}',

  'error.unsupportedFileType': 'Unsupported file type. Supported: .sql, .csv, .tsv, .json, .ndjson, .jsonl',
  'error.unsupportedFileTypeInline': 'unsupported file type (supported: .sql, .csv, .tsv, .json, .ndjson, .jsonl)',
  'error.describeFailed': 'Could not describe the schema: {error}',
  'error.designerFailed': 'Could not open the designer: {error}',
  'error.stateCorrupted': 'the design file is corrupted: {error}',
  'error.stateNoSchema': 'the design file holds no schema',
  'error.noCreateTable': 'no CREATE TABLE statements found in the file',
  'error.noColumns': 'no columns found in the file',
  'error.jsonTooBig': 'the JSON file is too large (512 MB limit)',
  'error.jsonEmptyFile': 'the file is empty',
  'error.jsonNotArray': 'expected a JSON array',
  'error.jsonUnparsable': 'the file could not be parsed as JSON or NDJSON',
  'progress.readingFile': 'Reading {file}…',
  'info.stateLoaded': 'Loaded a saved design: {file}. Delete this file to start over.',
  'info.describeReady': 'Schema description ready ({summary}). Save as {path}?',
  'info.saved': 'Saved: {path}',
  'warn.fileExists': 'File {path} already exists. Overwrite?',
  'action.save': 'Save',
  'action.overwrite': 'Overwrite',
  'dialog.describeLabel': 'Describe schema',
  'dialog.dataSources': 'Data sources',
  'status.copied': 'Copied to clipboard',

  'script.error': '-- script generation error: {error}',
  'script.noNamedTables': '-- no named tables',
  'script.noChanges': '-- no changes against the loaded schema',
  'script.notApplied': 'not applied',
  'query.pickTable': "-- pick the query's table",
  'query.error': '-- query generation error: {error}',

  'plural.table': ['table', 'tables'],
  'plural.field': ['field', 'fields'],
  'plural.column': ['column', 'columns'],
  'plural.change': ['change', 'changes'],
  'plural.reference': ['reference', 'references'],

  'op.eq': 'equals',
  'op.ne': 'differs from',
  'op.gt': 'is greater than',
  'op.ge': 'is at least',
  'op.lt': 'is less than',
  'op.le': 'is at most',
  'op.like': 'matches a pattern',
  'op.in': 'is one of',
  'op.isNull': 'is empty',
  'op.isNotNull': 'is not empty',

  'ui.dialect': 'Database',
  'ui.tabSchema': 'Schema',
  'ui.queries': 'Queries',
  'ui.tables': 'Tables',
  'ui.addTable': 'Add table',
  'ui.changeScript': 'Change script',
  'ui.modeDiff': 'changes only',
  'ui.modeFull': 'full CREATE',
  'ui.openAsFile': 'Open as file',
  'ui.copy': 'Copy',
  'ui.properties': 'Properties',
  'ui.addQuery': 'New query',
  'ui.query': 'Query',
  'ui.unnamed': 'unnamed',

  'status.saving': 'Saving…',
  'status.saveError': 'Save error: {error}',
  'status.savedAt': 'Saved {time}',

  'shape.tree': 'Tree',
  'shape.list': 'List',
  'shape.diagram': 'Diagram',

  'shape.object': 'object',
  'shape.listKind': 'list',
  'shape.listOfLists': 'list of lists',
  'shape.listOfObjects': 'list of objects',
  'shape.listOfListsOfObjects': 'list of lists of objects',
  'tree.expandCollapse': 'Expand / collapse',
  'tree.fieldsInside': 'fields inside',
  'action.expandAll': 'Expand all',
  'action.collapseAll': 'Collapse all',

  'diagram.document': 'document',
  'diagram.collection': 'collection',
  'diagram.table': 'table',
  'diagram.legendNesting': '1 - embedded object, n - list of objects',
  'diagram.legendFk': 'The line runs from the referenced table to the one holding the foreign key',
  'diagram.empty': 'Nothing to draw - the schema is empty.',
  'zoom.out': 'Zoom out',
  'zoom.in': 'Zoom in',
  'zoom.fit': 'Fit',
  'zoom.fitTitle': 'Fit the whole diagram in the window',

  'list.collections': 'Collections',
  'list.noCollections': 'No collections',
  'list.noTables': 'No tables',
  'list.noQueries': 'No queries',

  'badge.pkTip': 'primary key',
  'badge.fkTip': 'foreign key',
  'badge.requiredMongo': 'required',
  'badge.requiredSql': 'required (NOT NULL)',
  'badge.newMongo': 'new',
  'badge.newSql': 'new',
  'badge.newIndex': 'new',
  'badge.newTip': 'new element — will go into the change script',
  'badge.uniqueTip': 'unique',

  'empty.pickCollection': 'Pick a collection from the list or add a new one (+)',
  'empty.pickTable': 'Pick a table from the list or add a new one (+)',
  'title.editHint': 'Click to edit the name and description',
  'sec.fields': 'Fields',
  'sec.columns': 'Columns',
  'sec.indexes': 'Indexes',
  'action.addField': '+ Add field',
  'action.addColumn': '+ Add column',
  'action.addIndex': '+ Add index',

  'props.nothingSelected': 'Nothing selected',
  'props.collection': 'Collection',
  'props.table': 'Table',
  'props.field': 'Field',
  'props.column': 'Column',
  'props.index': 'Index',
  'props.query': 'Query',
  'props.joinedData': 'Joined data',

  'field.name': 'Name',
  'field.description': 'Description',
  'field.type': 'Type',
  'field.default': 'Default',
  'field.fk': 'References (FK)',
  'field.columns': 'Columns',
  'field.queryName': 'Query name',
  'field.lookingFor': 'What are you looking for',

  'ph.collectionName': 'collection_name',
  'ph.tableName': 'table_name',
  'ph.fieldName': 'field_name',
  'ph.columnName': 'column_name',
  'ph.indexName': 'index_name',
  'ph.none': 'none',
  'ph.columnsCsv': 'comma-separated columns',
  'ph.queryName': 'query name',
  'ph.valuesCsv': 'comma-separated values',
  'ph.value': 'value',

  'check.requiredMongo': 'required',
  'check.requiredSql': 'required',
  'check.primaryKey': 'primary key',
  'check.unique': 'unique',

  'opt.none': 'none',
  'opt.column': 'column',
  'opt.table': 'table',
  'opt.pick': 'pick…',
  'opt.noSort': 'no sorting',

  'action.deleteCollection': 'Delete collection',
  'action.deleteTable': 'Delete table',
  'action.deleteField': 'Delete field',
  'action.deleteColumn': 'Delete column',
  'action.deleteIndex': 'Delete index',
  'action.deleteQuery': 'Delete query',

  'empty.addQuery': 'Add a query (+) — pick what you are looking for and the query writes itself',
  'hint.queryFlow': 'Pick, add columns, done — the query below writes itself.',

  'sec.joins': 'Join related data',
  'hint.joinSuggestion': 'click a suggestion — the relation is already known from the schema',
  'join.matchedOnly': 'matches only',
  'join.alsoUnmatched': 'also without a match',
  'join.matchedBy': '— matched by ',
  'join.byFk': 'Join via foreign key',
  'action.removeJoin': 'Remove joined data',
  'action.removeJoinRow': 'Remove join',
  'action.otherJoin': '+ other join',
  'join.what': 'What you are joining',
  'join.unmatchedRows': 'Rows without a match',
  'join.skipThem': 'skip them',
  'join.showEmpty': 'show with an empty match',
  'join.match': 'Match',
  'join.fromSchemaNote': 'Taken from the schema — change only if you know why.',

  'sec.output': 'What to show in the result',
  'hint.nonePicked': 'nothing ticked = everything',
  'sec.where': 'Show only those where',
  'action.removeCondition': 'Remove condition',
  'action.addCondition': '+ Add condition',
  'sec.orderLimit': 'Order and row count',
  'order.first': 'First',
  'order.asc': 'ascending',
  'order.desc': 'descending',
  'order.showAtMost': 'show at most',
  'order.rows': 'rows',

  'ui.sendToStep': 'To flow step',
  'error.needLogicSpec': 'Sending a query to a flow step requires the Logic Spec extension.',
  'error.noQuerySql': 'Pick a query with a table first — there is no SQL to send.',
  'error.noTreeSchema': 'No stored schema in the tree ({path}) — save one first with "Describe schema" or a designer script.',
  'error.compareFailed': 'Schema comparison failed: {error}',
  'info.schemaUpToDate': 'No schema changes against the tree version.',
  'compare.goneTable': 'Table "{from}" is gone in the new version — is one of the new tables the same table?',
  'compare.goneColumn': 'Column "{table}.{from}" is gone in the new version — is one of the new columns the same column?',
  'compare.sameAs': 'Yes — this is "{to}" (similarity {score}%)',
  'compare.different': 'No — removed and added independently',
  'compare.saveAsk': 'Save the new schema version to {path}?',
  'impact.substituteAsk': 'Replace {count} {references} to renamed tables/columns in flow steps? Every replacement will be listed in a report.',
  'action.substitute': 'Replace references',
  'info.substituted': 'References replaced in: {packages}. Details in the report.',
};

const TRANSLATIONS = {};

function baseLanguage(tag) {
  return String(tag || 'en').toLowerCase().split(/[-_]/)[0];
}

const PLURAL_RULES = {
  en: (n) => (n === 1 ? 0 : 1),
};

function forLanguage(tag) {
  const lang = baseLanguage(tag);
  const table = TRANSLATIONS[lang] || {};
  const rule = PLURAL_RULES[lang] || PLURAL_RULES.en;

  const lookup = (key) => {
    const value = table[key];
    if (typeof value === 'string' && value !== '') return value;
    if (Array.isArray(value) && value.length) return value;
    return EN[key];
  };

  const t = (key, params) => {
    const text = lookup(key);
    if (typeof text !== 'string') return key;
    return text.replace(/\{(\w+)\}/g, (whole, name) =>
      params && name in params ? String(params[name]) : whole);
  };

  const plural = (key, n) => {
    const forms = lookup(key);
    if (!Array.isArray(forms) || !forms.length) return typeof forms === 'string' ? forms : key;
    return forms[Math.min(rule(n), forms.length - 1)];
  };

  const stringsTable = () => {
    const out = {};
    for (const key of Object.keys(EN)) {
      const value = lookup(key);
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  };
  const formsTable = () => {
    const out = {};
    for (const key of Object.keys(EN)) {
      const value = lookup(key);
      if (Array.isArray(value)) out[key] = value;
    }
    return out;
  };

  return { lang: PLURAL_RULES[lang] ? lang : 'en', t, plural, stringsTable, formsTable };
}

module.exports = { forLanguage, baseLanguage, EN, TRANSLATIONS };
