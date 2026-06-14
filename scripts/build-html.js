// Monta o index.html a partir de index.src.html, expandindo marcadores
//   <!-- @include views/arquivo.html -->
// pelo conteúdo verbatim do arquivo referenciado (em public/).
// O index.html gerado é o arquivo SERVIDO (Express static / Vercel).
// Fluxo: edite views/*.html (ou index.src.html) → rode este script → commit.
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');
const src = fs.readFileSync(path.join(PUB, 'index.src.html'), 'utf8');

let count = 0;
const out = src.replace(
  /^[^\S\r\n]*<!-- @include (\S+) -->[^\S\r\n]*\r?\n/gm,
  (_m, file) => { count++; return fs.readFileSync(path.join(PUB, file), 'utf8'); },
);

fs.writeFileSync(path.join(PUB, 'index.html'), out);
console.log(`index.html gerado — ${count} include(s) expandido(s)`);
