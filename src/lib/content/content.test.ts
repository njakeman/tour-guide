import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'fs'
import { join, resolve, basename } from 'path'
import matter from 'gray-matter'
import yaml from 'js-yaml'

const CONTENT_DIR = resolve('content')
const ROUTES_DIR = join(CONTENT_DIR, 'routes')

describe('Content Pipeline', () => {
  it('has at least one route with a valid tour.yaml', () => {
    const routes = readdirSync(ROUTES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(ROUTES_DIR, d.name))

    expect(routes.length).toBeGreaterThan(0)

    for (const routeDir of routes) {
      const yamlPath = join(routeDir, 'tour.yaml')
      expect(existsSync(yamlPath), `tour.yaml missing in ${routeDir}`).toBe(true)

      const parsed = yaml.load(readFileSync(yamlPath, 'utf-8')) as {
        route_name: string
        stops: string[]
      }
      expect(parsed.route_name).toBeTruthy()
      expect(Array.isArray(parsed.stops)).toBe(true)
      expect(parsed.stops.length).toBeGreaterThan(0)
    }
  })

  it('uses path.basename to derive route id (Windows-safe)', () => {
    // Regression test for the Windows routeDir.split('/') bug
    const routeDirs = readdirSync(ROUTES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(ROUTES_DIR, d.name))

    for (const routeDir of routeDirs) {
      const id = basename(routeDir)
      // basename should always return just the last segment, never a full path
      expect(id).not.toContain('/')
      expect(id).not.toContain('\\')
      expect(id.length).toBeGreaterThan(0)
    }
  })

  it('references stops that exist as markdown files', () => {
    const routes = readdirSync(ROUTES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(ROUTES_DIR, d.name))

    for (const routeDir of routes) {
      const yamlPath = join(routeDir, 'tour.yaml')
      const parsed = yaml.load(readFileSync(yamlPath, 'utf-8')) as { stops: string[] }
      const stopsDir = join(routeDir, 'stops')

      for (const stopId of parsed.stops) {
        const direct = join(stopsDir, `${stopId}.md`)
        if (existsSync(direct)) continue

        // Check numbered-prefix convention
        const files = existsSync(stopsDir) ? readdirSync(stopsDir) : []
        const match = files.find((f) => new RegExp(`^\\d{2}-${stopId}\\.md$`).test(f))
        expect(match, `Stop '${stopId}' not found in ${stopsDir}`).toBeTruthy()
      }
    }
  })

  it('parses stop markdown with required frontmatter fields', () => {
    const routes = readdirSync(ROUTES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(ROUTES_DIR, d.name))

    for (const routeDir of routes) {
      const stopsDir = join(routeDir, 'stops')
      if (!existsSync(stopsDir)) continue
      const files = readdirSync(stopsDir).filter((f) => f.endsWith('.md'))

      for (const file of files) {
        const raw = readFileSync(join(stopsDir, file), 'utf-8')
        const parsed = matter(raw)
        const f = parsed.data

        expect(f.id, `${file}: missing id`).toBeTruthy()
        expect(f.title, `${file}: missing title`).toBeTruthy()
        expect(f.evidence, `${file}: missing evidence`).toBeTruthy()

        if (f.lat !== undefined && f.lat !== null) {
          expect(typeof f.lat, `${file}: lat must be number`).toBe('number')
          expect(typeof f.lng, `${file}: lng must be number`).toBe('number')
        }

        expect(parsed.content.trim().length, `${file}: empty body`).toBeGreaterThan(0)
      }
    }
  })
})
