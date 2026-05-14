declare module 'virtual:tour-content' {
  import type { TourRoute, TourStop } from './src/lib/content/vite-plugin'
  export const routes: TourRoute[]
  export const allStops: TourStop[]
}
