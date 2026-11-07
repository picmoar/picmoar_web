import { readdirSync, statSync, writeFileSync, mkdirSync } from 'fs'
import { join, extname, basename } from 'path'

const CLOUD = 'wxmg5gva'
const BASE  = `https://res.cloudinary.com/${CLOUD}/image/upload`
const IMG   = new Set(['.jpg', '.jpeg', '.JPG', '.JPEG', '.png', '.PNG', '.webp', '.WEBP'])

const url = id => `${BASE}/${id}.jpg`

// ── photos ────────────────────────────────────────────────────────────────────
const photoFolders = readdirSync('./src/photos')
  .filter(n => statSync(`./src/photos/${n}`).isDirectory())
  .sort()

const photos = []
for (const folder of photoFolders) {
  const files = readdirSync(`./src/photos/${folder}`)
  const img = files.find(f => IMG.has(extname(f)))
  if (!img) continue
  const stem = basename(img, extname(img))
  photos.push({ num: folder, src: url(`photos/${folder}/${stem}`) })
}

// ── albums ────────────────────────────────────────────────────────────────────
const albumFolders = readdirSync('./src/albums')
  .filter(n => statSync(`./src/albums/${n}`).isDirectory())
  .sort()

const albums = {}
for (const folder of albumFolders) {
  const files = readdirSync(`./src/albums/${folder}`).filter(f => IMG.has(extname(f))).sort()
  const cover = files.find(f => basename(f, extname(f)).toLowerCase().endsWith('_coverphoto'))
  const rest  = files.filter(f => f !== cover)
  albums[folder] = {
    coverSrc:  cover ? url(`albums/${folder}/${basename(cover, extname(cover))}`) : null,
    // cover first so it appears at the top of the album detail grid
    imageSrcs: [
      ...(cover ? [url(`albums/${folder}/${basename(cover, extname(cover))}`)] : []),
      ...rest.map(f => url(`albums/${folder}/${basename(f, extname(f))}`)),
    ],
  }
}

// ── write ─────────────────────────────────────────────────────────────────────
mkdirSync('./src/data', { recursive: true })
writeFileSync('./src/data/cloudinary_manifest.json', JSON.stringify({ photos, albums }, null, 2))
console.log(`Manifest written: ${photos.length} photos, ${Object.keys(albums).length} albums`)
