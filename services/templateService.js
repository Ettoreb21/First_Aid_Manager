// services/templateService.js
// Gestione template email con Handlebars: caricamento, cache e rendering.

const fs = require('fs');
const path = require('path');
const handlebars = require('handlebars');

const cache = new Map();

function resolveTemplate(templateNameOrPath) {
  // Se è un percorso, lo rispettiamo; altrimenti assumiamo templates/<name>.html
  if (templateNameOrPath.includes('/') || templateNameOrPath.includes('\\')) {
    return path.resolve(templateNameOrPath);
  }
  const base = path.resolve(__dirname, '..', 'templates');
  return path.join(base, `${templateNameOrPath}.html`);
}

function compileTemplate(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  return handlebars.compile(source);
}

function getTemplate(templateNameOrPath) {
  const fullPath = resolveTemplate(templateNameOrPath);
  const key = `tpl:${fullPath}`;
  const stat = fs.statSync(fullPath);
  const mtime = stat.mtimeMs;

  const cached = cache.get(key);
  if (cached && cached.mtime === mtime) {
    return cached.tpl;
  }

  const tpl = compileTemplate(fullPath);
  cache.set(key, { tpl, mtime });
  return tpl;
}

function render(templateNameOrPath, data) {
  const tpl = getTemplate(templateNameOrPath);
  return tpl(data || {});
}

module.exports = {
  render,
  getTemplate,
  resolveTemplate,
};