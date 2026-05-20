import fs from 'fs';
import path from 'path';

const snippetsDir = path.join('src', 'lib', 'client', 'wasm', 'snippets');
if (fs.existsSync(snippetsDir)) {
  const dirs = fs.readdirSync(snippetsDir);
  for (const dir of dirs) {
    if (dir.includes('wasm-bindgen-rayon')) {
      const srcDir = path.join(snippetsDir, dir, 'src');
      if (fs.existsSync(srcDir)) {
        const files = fs.readdirSync(srcDir);
        for (const file of files) {
          if (file.endsWith('.js')) {
            const filePath = path.join(srcDir, file);
            let code = fs.readFileSync(filePath, 'utf8');
            code = code.replace(/['"]\.\.\/\.\.\/\.\.(?:\/)?['"]/g, "'../../../surfer_wasm.js'");
            fs.writeFileSync(filePath, code);
            console.log(`[Patch] Fixed Rayon worker import in ${filePath}`);
          }
        }
      }
    }
  }
}
