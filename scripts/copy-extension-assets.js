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

    // Copy package.json (required for all extensions)
    const manifestSrc = path.join(extSrcPath, 'package.json');
    const manifestDest = path.join(extDestPath, 'package.json');
    
    if (fs.existsSync(manifestSrc)) {
        fs.copyFileSync(manifestSrc, manifestDest);
        console.log(`✓ ${ext}/package.json`);
    } else {
        console.error(`✗ ${ext}/package.json missing (required)`);
        return;
    }

    // Optional: Copy static HTML assets if they exist (for legacy iframe-based extensions)
    const optionalAssets = ['widget.html', 'panel.html'];
    let hasStaticAssets = false;
    
    optionalAssets.forEach(asset => {
        const srcAsset = path.join(extSrcPath, asset);
        const destAsset = path.join(extDestPath, asset);
        
        if (fs.existsSync(srcAsset)) {
            fs.copyFileSync(srcAsset, destAsset);
            console.log(`✓ ${ext}/${asset}`);
            hasStaticAssets = true;
        }
    });
    
    if (!hasStaticAssets) {
        console.log(`  ${ext} → React-based (no static HTML)`);
    }
});

// ============================================================================
// Copy Built-in Sequences
// ============================================================================
const seqSrcDir = path.join(__dirname, '../src/sequences/built-in');
const seqDestDir = path.join(__dirname, '../dist-electron/sequences/built-in');

if (fs.existsSync(seqSrcDir)) {
    if (!fs.existsSync(seqDestDir)) {
        fs.mkdirSync(seqDestDir, { recursive: true });
    }

    const seqFiles = fs.readdirSync(seqSrcDir).filter(f => f.endsWith('.json'));
    seqFiles.forEach(f => {
        fs.copyFileSync(path.join(seqSrcDir, f), path.join(seqDestDir, f));
        console.log(`✓ sequences/built-in/${f}`);
    });
    console.log(`Copied ${seqFiles.length} built-in sequences.`);
} else {
    console.log('No built-in sequences directory found.');
}
