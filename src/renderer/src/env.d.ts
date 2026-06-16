/// <reference types="vite/client" />
import type { RecapAPI } from '../../preload/index.js'

declare global {
  interface Window {
    recap: RecapAPI
  }
}
