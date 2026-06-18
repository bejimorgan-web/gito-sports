const fs = require('fs');
const path = require('path');
const roots = ['apps/backend/src', 'packages/shared/src'];
const exts = ['.ts', '.tsx', '.js', '.jsx'];
function resolveImport(file, rel) {
  const base = path.dirname(file);
  const target = path.resolve(base, rel);
  for (const ext of exts) {
    const candidate = target + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    for (const ext of exts) {
      const candidate = path.join(target, 'index' + ext);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
  }
  return null;
}
function toPosix(p) {
  return p.split(path.sep).join('/');
}
for (const root of roots) {
  const rootPath = path.resolve(root);
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile() && p.endsWith('.ts')) files.push(p);
    }
  }
  walk(rootPath);
  for (const file of files) {
    let content = fs.readFileSync(file, 'utf8');
    const updated = content.replace(/(["'])(\.{1,2}\/[^"']*?)\1/g, (match, quote, rel) => {
      if (/\.(?:ts|tsx|js|jsx|json)$/.test(rel)) return match;
      const resolved = resolveImport(file, rel);
      if (!resolved) return match;
      let relPath = toPosix(path.relative(path.dirname(file), resolved));
      if (!relPath.startsWith('.')) relPath = './' + relPath;
      relPath = relPath.replace(/\.(ts|tsx)$/, '.js');
      return quote + relPath + quote;
    });
    if (updated !== content) {
      fs.writeFileSync(file, updated, 'utf8');
      console.log('Updated', file);
    }
  }
}
