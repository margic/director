#!/usr/bin/env node
/**
 * Generate Electron app icons from a source PNG.
 * Replaces electron-icon-builder (which pulls in phantomjs/svg2png).
 *
 * Produces:
 *   build/icons/<size>x<size>.png   (16–1024)
 *   build/icons/icon.ico            (Windows)
 *   build/icons/icon.icns           (macOS)
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// png-to-ico is ESM — use dynamic import
const loadPngToIco = () => import('png-to-ico').then(m => m.default);

const INPUT = path.resolve(__dirname, '..', 'assets', 'images', 'icon-logo.png');
const OUTPUT_DIR = path.resolve(__dirname, '..', 'build', 'icons');

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
// ICO format supports up to 256×256
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

async function main() {
  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Generate PNGs at all sizes
  const pngBuffers = {};
  for (const size of SIZES) {
    const outPath = path.join(OUTPUT_DIR, `${size}x${size}.png`);
    const buf = await sharp(INPUT)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    fs.writeFileSync(outPath, buf);
    pngBuffers[size] = buf;
    console.log(`  ✓ ${size}x${size}.png`);
  }

  // Generate ICO (Windows) — default export accepts array of file paths
  const pngToIco = await loadPngToIco();
  const icoInputPaths = ICO_SIZES.map(s => path.join(OUTPUT_DIR, `${s}x${s}.png`));
  const icoBuf = await pngToIco(icoInputPaths);
  const icoPath = path.join(OUTPUT_DIR, 'icon.ico');
  fs.writeFileSync(icoPath, icoBuf);
  console.log('  ✓ icon.ico');

  // Generate ICNS (macOS) — write a minimal ICNS container
  // ICNS uses 'ic07' (128px), 'ic08' (256px), 'ic09' (512px), 'ic10' (1024px) PNG entries
  const icnsEntries = [
    { osType: 'ic07', size: 128 },
    { osType: 'ic08', size: 256 },
    { osType: 'ic09', size: 512 },
    { osType: 'ic10', size: 1024 },
  ];

  let totalSize = 8; // 'icns' magic + 4-byte file length
  const entryBuffers = [];
  for (const entry of icnsEntries) {
    const pngData = pngBuffers[entry.size];
    const entryLen = 8 + pngData.length; // 4-byte type + 4-byte length + data
    totalSize += entryLen;

    const buf = Buffer.alloc(entryLen);
    buf.write(entry.osType, 0, 4, 'ascii');
    buf.writeUInt32BE(entryLen, 4);
    pngData.copy(buf, 8);
    entryBuffers.push(buf);
  }

  const icnsHeader = Buffer.alloc(8);
  icnsHeader.write('icns', 0, 4, 'ascii');
  icnsHeader.writeUInt32BE(totalSize, 4);

  const icnsPath = path.join(OUTPUT_DIR, 'icon.icns');
  fs.writeFileSync(icnsPath, Buffer.concat([icnsHeader, ...entryBuffers]));
  console.log('  ✓ icon.icns');

  console.log(`\nGenerated ${SIZES.length} PNGs + ICO + ICNS in ${OUTPUT_DIR}`);
}

main().catch(err => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
