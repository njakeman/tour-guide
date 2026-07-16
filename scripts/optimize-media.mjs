#!/usr/bin/env node
/**
 * Build-time image optimisation — generates a .webp sibling for every raster
 * image under public/tours/ (capped at 1600px wide, quality 80).
 *
 * Runs as part of `npm run build` (before vite build), so the content plugin
 * sees the siblings on disk and emits <picture> markup pointing at them.
 * In dev, or when a sibling is missing, the plugin falls back to a plain
 * <img> for the original — nothing depends on this script having run.
 *
 * Originals are kept: they are the <picture> fallback source. Generated
 * .webp files are gitignored (public/tours/**\/*.webp) — CI regenerates them
 * on every deploy, keyed off mtimes locally.
 */
import { readdirSync, statSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import sharp from 'sharp'

const ROOT = 'public/tours'
const RASTER_EXTS = new Set(['.png', '.jpg', '.jpeg'])
const MAX_WIDTH = 1600
const QUALITY = 80

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(p)
    else yield p
  }
}

if (!existsSync(ROOT)) {
  console.log(`[media] ${ROOT} not found — nothing to optimise`)
  process.exit(0)
}

let generated = 0
let upToDate = 0
for (const file of walk(ROOT)) {
  if (!RASTER_EXTS.has(extname(file).toLowerCase())) continue
  const out = file.replace(/\.[^.]+$/, '.webp')
  if (existsSync(out) && statSync(out).mtimeMs >= statSync(file).mtimeMs) {
    upToDate++
    continue
  }
  await sharp(file)
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toFile(out)
  generated++
}
console.log(`[media] webp variants: ${generated} generated, ${upToDate} up to date`)
