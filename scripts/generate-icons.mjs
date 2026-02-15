import sharp from 'sharp'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(__dirname, '..', 'public')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#2481cc"/>
      <stop offset="100%" style="stop-color:#1a6bb5"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="96" fill="url(#bg)"/>
  <!-- Cart body -->
  <g transform="translate(256,240)" fill="none" stroke="white" stroke-width="24" stroke-linecap="round" stroke-linejoin="round">
    <path d="M-120,-60 L-90,-60 L-50,60 L110,60"/>
    <path d="M-50,60 L-70,-10 L100,-10 L110,60" fill="white" fill-opacity="0.15"/>
    <circle cx="-30" cy="100" r="20" fill="white"/>
    <circle cx="80" cy="100" r="20" fill="white"/>
  </g>
  <!-- Star -->
  <g transform="translate(340,130)">
    <polygon points="0,-35 8,-12 32,-12 13,3 20,26 0,13 -20,26 -13,3 -32,-12 -8,-12" fill="#FFD43B"/>
  </g>
</svg>`

const sizes = [192, 512]

for (const size of sizes) {
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(resolve(publicDir, `icon-${size}x${size}.png`))
  console.log(`Generated icon-${size}x${size}.png`)
}

// Also generate apple-touch-icon
await sharp(Buffer.from(svg))
  .resize(180, 180)
  .png()
  .toFile(resolve(publicDir, 'apple-touch-icon.png'))
console.log('Generated apple-touch-icon.png')
