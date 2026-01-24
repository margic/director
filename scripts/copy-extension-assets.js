const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../src/extensions');
const destDir = path.join(__dirname, '../dist-electron/extensions');

if (!fs.existsSync(srcDir)) {
    console.log('No extensions directory found.');
    process.exit(0);
}

// Ensure dest dir exists
if (!fs.existsSync(destDir)) {
    console.log('Destination directory does not exist, creating...');
    fs.mkdirSync(destDir, { recursive: true });
}

const extensions = fs.readdirSync(srcDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

console.log(`Found ${extensions.length} extensions to process.`);

extensions.forEach(ext => {
    const extSrcPath = path.join(srcDir, ext);
    const extDestPath = path.join(destDir, ext);
    
    // Create extension dest folder
    if (!fs.existsSync(extDestPath)) {
        fs.mkdirSync(extDestPath, { recursive: true });
    }

    // List of files to copy
    const assets = ['package.json'];

    assets.forEach(asset => {
        const srcAsset = path.join(extSrcPath, asset);
        const destAsset = path.join(extDestPath, asset);
        
        if (fs.existsSync(srcAsset)) {
            fs.copyFileSync(srcAsset, destAsset);
            console.log(`Copied ${ext}/${asset}`);
        } else {
            console.warn(`Warning: ${ext}/${asset} missing`);
        }
    });
});
