// Vercel 빌드 시 환경 변수로 config.js 생성 (Supabase 읽기용)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const url = process.env.SUPABASE_URL || '';
const anon = process.env.SUPABASE_ANON_KEY || '';
const content = `// Auto-generated at build time
window.SUPABASE_URL = ${JSON.stringify(url)};
window.SUPABASE_ANON_KEY = ${JSON.stringify(anon)};
`;
fs.writeFileSync(path.join(root, 'config.js'), content, 'utf8');
console.log('config.js written');
