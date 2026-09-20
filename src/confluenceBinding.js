const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

function confluenceBinding(markdown) {
  const block = String(markdown).match(FRONTMATTER);
  if (!block) return [];
  const lines = block[1].split(/\r?\n/);
  const start = lines.findIndex((line) => /^confluence:\s*$/.test(line));
  if (start < 0) return [];
  const kept = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    if (!/^\s+\S/.test(lines[i])) break;
    kept.push(lines[i]);
  }
  return kept.length > 1 ? kept : [];
}

function withConfluenceBinding(markdown, binding) {
  if (!binding || binding.length === 0 || !FRONTMATTER.test(markdown)) return markdown;
  return markdown.replace(/^---\r?\n/, '---\n' + binding.join('\n') + '\n');
}

async function keepConfluenceBinding(vscode, uri, markdown) {
  let existing = '';
  try {
    existing = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
  } catch (e) {
    return markdown;
  }
  return withConfluenceBinding(markdown, confluenceBinding(existing));
}

module.exports = { confluenceBinding, withConfluenceBinding, keepConfluenceBinding };
