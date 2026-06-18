declare module 'virtual:tour-content' {
  import type { TourRoute, TourStop } from './lib/types'
  export const routes: TourRoute[]
  export const allStops: TourStop[]
}
