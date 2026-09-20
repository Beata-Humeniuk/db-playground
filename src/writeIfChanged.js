const VOLATILE_MARKDOWN = [/^generated:\s/];

function stripVolatile(text, volatile) {
  return String(text)
    .split('\n')
    .filter((line) => !volatile.some((pattern) => pattern.test(line)))
    .join('\n');
}

function sameContent(existing, next, volatile) {
  return stripVolatile(existing, volatile) === stripVolatile(next, volatile);
}

async function writeUnlessUnchanged(vscode, uri, text, volatile) {
  try {
    const existing = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    if (sameContent(existing, text, volatile || VOLATILE_MARKDOWN)) {
      return false;
    }
  } catch (e) {
  }
  await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
  return true;
}

module.exports = { sameContent, writeUnlessUnchanged, VOLATILE_MARKDOWN };
