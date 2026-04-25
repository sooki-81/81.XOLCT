import { copyFileSync, readdirSync, mkdirSync } from 'fs';
import { join } from 'path';

const msiDir = join('src-tauri', 'target', 'release', 'bundle', 'msi');

const files = readdirSync(msiDir).filter(f => f.endsWith('.msi'));
for (const file of files) {
  copyFileSync(join(msiDir, file), file);
  console.log(`Copied: ${file} → ./`);
}
