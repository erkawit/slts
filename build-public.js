const fs = require('fs');
const path = require('path');

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (let entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// Copy index.html
fs.copyFileSync(path.join(__dirname, 'index.html'), path.join(publicDir, 'index.html'));

// Copy folders
['css', 'js', 'img'].forEach(folder => {
  const src = path.join(__dirname, folder);
  const dest = path.join(publicDir, folder);
  if (fs.existsSync(src)) {
    copyDir(src, dest);
  }
});

console.log('Successfully synced web assets into public/ directory!');
