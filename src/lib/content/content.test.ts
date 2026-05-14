import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
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
      expect(existsSync(yamlPath)).toBe(true)

      const parsed = yaml.load(readFileSync(yamlPath, 'utf-8')) as {
        route_name: string
        stops: string[]
      }
      expect(parsed.route_name).toBeTruthy()
      expect(Array.isArray(parsed.stops)).toBe(true)
      expect(parsed.stops.length).toBeGreaterThan(0)
    }
  })

  it('references stops that exist as markdown files', () => {
    const routes = readdirSync(ROUTES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(ROUTES_DIR, d.name))

    for (const routeDir of routes) {
      const yamlPath = join(routeDir, 'tour.yaml')
      const parsed = yaml.load(readFileSync(yamlPath, 'utf-8')) as {
        stops: string[]
      }

      const stopsDir = join(routeDir, 'stops')
      for (const stopId of parsed.stops) {
        const stopPath = join(stopsDir, `${stopId}.md`)
        const exists = existsSync(stopPath)
        if (!exists) {
          const files = readdirSync(stopsDir)
          const numberedMatch = files.find((f) =>
            f.includes(stopId)
          )
          expect(numberedMatch).toBeTruthy()
        }
      }
    }
  })

  it('parses stop markdown with valid frontmatter', () => {
    const routes = readdirSync(ROUTES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(ROUTES_DIR, d.name))

    for (const routeDir of routes) {
      const stopsDir = join(routeDir, 'stops')
      const files = readdirSync(stopsDir)

      for (const file of files) {
        if (!file.endsWith('.md')) continue

        const raw = readFileSync(join(stopsDir, file), 'utf-8')
        const parsed = matter(raw)

        expect(parsed.data.id).toBeTruthy()
        expect(parsed.data.title).toBeTruthy()
        expect(parsed.data.evidence).toBeTruthy()

        // Optional lat/lng fields
        if (
          parsed.data.lat !== undefined &&
          parsed.data.lat !== null
        ) {
          expect(typeof parsed.data.lat).toBe('number')
          expect(typeof parsed.data.lng).toBe('number')
        }

        // Body content should exist
        expect(parsed.content.trim().length).toBeGreaterThan(0)
      }
    }
  })
})
