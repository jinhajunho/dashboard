// Vercel 빌드 시: public 폴더 생성, config.js 생성, 정적 파일 복사
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');

if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

const url = process.env.SUPABASE_URL || '';
const anon = process.env.SUPABASE_ANON_KEY || '';
const content = `// Auto-generated at build time
window.SUPABASE_URL = ${JSON.stringify(url)};
window.SUPABASE_ANON_KEY = ${JSON.stringify(anon)};
`;
fs.writeFileSync(path.join(publicDir, 'config.js'), content, 'utf8');

['index.html', 'script.js', 'styles.css'].forEach((file) => {
  const src = path.join(root, file);
  const dest = path.join(publicDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  }
});

console.log('config.js written, public/ ready');
