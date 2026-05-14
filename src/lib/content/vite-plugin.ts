import type { ViteDevServer, Plugin } from 'vite'
import { readdirSync, readFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import matter from 'gray-matter'
import yaml from 'js-yaml'

/**
 * Media item for a tour stop
 */
export type MediaItem = {
  type: 'image' | 'audio' | 'video' | 'model'
  src: string
  caption?: string
}

/**
 * A single tour stop with parsed markdown content
 */
export type TourStop = {
  id: string
  title: string
  lat: number | null
  lng: number | null
  proximity_radius: number
  evidence: string
  interpretation: string
  body: string
  media: MediaItem[]
}

/**
 * A tour route defined by a YAML manifest
 */
export type TourRoute = {
  id: string
  name: string
  description: string
  icon: string
  stops: TourStop[]
}

const CONTENT_DIR = 'content'
const ROUTES_DIR = 'routes'

function loadTourRoute(routeDir: string): TourRoute {
  const tourYamlPath = join(routeDir, 'tour.yaml')

  if (!existsSync(tourYamlPath)) {
    throw new Error(`Missing tour.yaml in ${routeDir}`)
  }

  const tourYaml = yaml.load(readFileSync(tourYamlPath, 'utf-8')) as {
    route_name: string
    description: string
    icon?: string
    stops: string[]
  }

  const stopsDir = join(routeDir, 'stops')
  const stops: TourStop[] = []

    for (const stopId of tourYaml.stops) {
      // Look in route-specific stops dir first, then shared
      let stopPath = join(stopsDir, `${stopId}.md`)
      if (!existsSync(stopPath)) {
        const sharedStopPath = resolve(CONTENT_DIR, 'shared', 'stops', `${stopId}.md`)
        if (existsSync(sharedStopPath)) {
          stopPath = sharedStopPath
        } else {
          // Try with numbered prefix (e.g., 01-, 02-) for convenience
          try {
            const files = readdirSync(stopsDir)
            const numberedMatch = files.find(f => {
              const pattern = new RegExp(`^\\d+-.*${stopId}.*\\.md$`)
              return pattern.test(f)
            })
            if (numberedMatch) {
              stopPath = join(stopsDir, numberedMatch)
            } else {
              throw new Error(
                `Stop '${stopId}' not found in ${stopsDir} or shared/stops. ` +
                `Tried: ${stopId}.md and numbered variants.`
              )
            }
          } catch {
            throw new Error(
              `Stop '${stopId}' not found in ${stopsDir} or shared/stops.`
            )
          }
        }
      }

    const raw = readFileSync(stopPath, 'utf-8')
    const parsed = matter(raw)
    const front = parsed.data as {
      id: string
      title: string
      lat?: number
      lng?: number
      proximity_radius?: number
      media?: MediaItem[]
      evidence?: string
      interpretation?: string
    }

    stops.push({
      id: front.id || stopId,
      title: front.title || 'Untitled Stop',
      lat: front.lat ?? null,
      lng: front.lng ?? null,
      proximity_radius: front.proximity_radius ?? 30,
      evidence: front.evidence || '',
      interpretation: front.interpretation || '',
      body: parsed.content,
      media: front.media || [],
    })
  }

  const routeId = routeDir.split('/').pop() || 'unknown'

  return {
    id: routeId,
    name: tourYaml.route_name,
    description: tourYaml.description,
    icon: tourYaml.icon || '🗺️',
    stops,
  }
}

/**
 * Vite plugin that loads content/routes/* as typed tour data.
 */
export function contentPlugin(): Plugin {
  const virtualModuleId = 'virtual:tour-content'
  const resolvedVirtualModuleId = '\0' + virtualModuleId

  function generateModule(): string {
    const routesPath = resolve(CONTENT_DIR, ROUTES_DIR)
    if (!existsSync(routesPath)) {
      return `export const routes = []; export const allStops = [];`
    }

    const routes: TourRoute[] = []
    const routeDirs = readdirSync(routesPath, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => join(routesPath, dirent.name))

    for (const routeDir of routeDirs) {
      try {
        routes.push(loadTourRoute(routeDir))
      } catch (err) {
        console.warn(`[content] Failed to load route ${routeDir}:`, err)
      }
    }

    const allStops = routes.flatMap((r) => r.stops)

    // Serialize to a valid JS module
    const routesJson = JSON.stringify(routes)
    const stopsJson = JSON.stringify(allStops)

    return `export const routes = ${routesJson};
export const allStops = ${stopsJson};
export default { routes, allStops };`
  }

  return {
    name: 'tour-content',
    resolveId(id) {
      if (id === virtualModuleId) {
        return resolvedVirtualModuleId
      }
    },
    load(id) {
      if (id === resolvedVirtualModuleId) {
        return generateModule()
      }
    },
    handleHotUpdate({ file, server }) {
      // HMR: invalidate virtual module when content files change
      if (file.includes(CONTENT_DIR)) {
        const moduleNode = server.moduleGraph.getModuleById(resolvedVirtualModuleId)
        if (moduleNode) {
          server.moduleGraph.invalidateModule(moduleNode)
          return [moduleNode]
        }
      }
    },
  }
}
