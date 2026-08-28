import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Circle,
  CircleMarker,
  GeoJSON,
  MapContainer,
  Popup,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import type { LatLngExpression, Map as LeafletMap } from 'leaflet'
import {
  Activity,
  ChevronDown,
  Clock3,
  History,
  Layers3,
  LocateFixed,
  Map as MapIcon,
  MapPin,
  MapPinned,
  Navigation,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Route,
  Search,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import 'leaflet/dist/leaflet.css'
import './App.css'

type Zone = {
  id: string
  name: string
  lat: number
  lng: number
  radius?: number
  color?: string
  geometry?: BoundaryGeometry
  source?: 'gba' | 'osm'
  sourceLabel?: string
}

type BoundaryGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }

type TrackPoint = {
  lat: number
  lng: number
  accuracy: number
  timestamp: number
}

type Project = {
  id: string
  name: string
  zones: Zone[]
  track: TrackPoint[]
  createdAt: number
  updatedAt: number
}

type SearchResult = {
  place_id: string
  display_name: string
  lat: string
  lon: string
  type: string
}

type WardFeature = {
  type: 'Feature'
  properties: {
    ward_id: string
    ward_name: string
    corporation: string
    assembly: string
    source: string
  }
  geometry: BoundaryGeometry
}

type WardFeatureCollection = {
  type: 'FeatureCollection'
  features: WardFeature[]
}

type Tab = 'map' | 'areas' | 'history'

const BENGALURU: LatLngExpression = [12.917, 77.61]
const STORAGE_KEY = 'coverly-projects-v3'
const ACTIVE_PROJECT_KEY = 'coverly-active-project-v3'
const PREVIOUS_STORAGE_KEY = 'coverly-projects-v2'
const PREVIOUS_ACTIVE_PROJECT_KEY = 'coverly-active-project-v2'
const LEGACY_STORAGE_KEY = 'coverly-projects-v1'
const LEGACY_ACTIVE_PROJECT_KEY = 'coverly-active-project-v1'
const OFFICIAL_STARTER_KEY = 'coverly-gba-official-starter-v1'
const EARTH_RADIUS = 6378137
const AREA_COLORS = [
  '#2563eb',
  '#f97316',
  '#16a34a',
  '#ec4899',
  '#14b8a6',
  '#ca8a04',
  '#ef4444',
  '#0891b2',
]

const uid = () => crypto.randomUUID()

const newProject = (): Project => {
  const now = Date.now()
  return {
    id: uid(),
    name: 'My search area',
    zones: [],
    track: [],
    createdAt: now,
    updatedAt: now,
  }
}

function loadProjects(): Project[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as Project[]
      if (Array.isArray(parsed) && parsed.length) return parsed
    }
    const previousStored =
      localStorage.getItem(PREVIOUS_STORAGE_KEY) ||
      localStorage.getItem(LEGACY_STORAGE_KEY)
    if (previousStored) {
      const previousProjects = JSON.parse(previousStored) as Project[]
      if (Array.isArray(previousProjects) && previousProjects.length) {
        const migrated = previousProjects.map((project) => ({
          ...project,
          zones: project.zones.filter(
            (zone) => zone.source === 'gba' || zone.source === 'osm',
          ),
          updatedAt: Date.now(),
        }))
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
        return migrated
      }
    }
  } catch {
    // Start clean if old local data is invalid.
  }
  return [newProject()]
}

async function findPlaces(term: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    q: term,
    limit: '6',
    lat: '12.917',
    lon: '77.610',
  })
  const response = await fetch(`https://photon.komoot.io/api/?${params}`, { signal })
  if (!response.ok) throw new Error('Search unavailable')

  const data = (await response.json()) as {
    features: Array<{
      properties: Record<string, string | number | undefined>
      geometry: { coordinates: [number, number] }
    }>
  }

  return data.features.map((feature) => {
    const place = feature.properties
    const name =
      String(place.name || '').trim() ||
      [place.housenumber, place.street].filter(Boolean).join(' ') ||
      'Unnamed place'
    const context = [
      place.street,
      place.district,
      place.city,
      place.county,
      place.state,
      place.country,
    ]
      .filter((part, index, parts) => part && part !== name && parts.indexOf(part) === index)
      .join(', ')

    return {
      place_id: `${place.osm_type}-${place.osm_id}-${feature.geometry.coordinates.join('-')}`,
      display_name: context ? `${name}, ${context}` : name,
      lat: String(feature.geometry.coordinates[1]),
      lon: String(feature.geometry.coordinates[0]),
      type: String(place.type || place.osm_value || 'place'),
    }
  })
}

let wardDataPromise: Promise<WardFeatureCollection> | null = null

function loadOfficialWards() {
  if (!wardDataPromise) {
    wardDataPromise = fetch(`${import.meta.env.BASE_URL}data/gba-wards.geojson`).then(
      async (response) => {
        if (!response.ok) throw new Error('Official boundary data unavailable')
        return (await response.json()) as WardFeatureCollection
      },
    )
  }
  return wardDataPromise
}

function wardAtPoint(
  collection: WardFeatureCollection,
  lat: number,
  lng: number,
) {
  return collection.features.find((feature) =>
    pointInGeometry(lng, lat, feature.geometry),
  )
}

const BENGALURU_TARGETS = [
  { name: 'Jayadeva Hospital', lat: 12.916731, lng: 77.5999663 },
  { name: 'BTM Layout', lat: 12.9140008, lng: 77.6102821 },
  { name: 'Silk Board Junction', lat: 12.9158171, lng: 77.6240368 },
  { name: 'Bommanahalli', lat: 12.9089453, lng: 77.6239038 },
]

function officialStarterZones(collection: WardFeatureCollection) {
  const selected = new Set<string>()
  return BENGALURU_TARGETS.flatMap((target, index) => {
    const ward = wardAtPoint(collection, target.lat, target.lng)
    if (!ward || selected.has(ward.properties.ward_id)) return []
    selected.add(ward.properties.ward_id)
    return [{
      id: uid(),
      name: `${target.name} · ${ward.properties.ward_name}`,
      lat: target.lat,
      lng: target.lng,
      geometry: ward.geometry,
      color: AREA_COLORS[index % AREA_COLORS.length],
      source: 'gba' as const,
      sourceLabel: `Official GBA Ward ${ward.properties.ward_id}`,
    }]
  })
}

async function findBoundary(result: SearchResult): Promise<BoundaryGeometry | null> {
  const params = new URLSearchParams({
    q: result.display_name,
    format: 'geojson',
    polygon_geojson: '1',
    polygon_threshold: '0.0003',
    limit: '5',
  })
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`)
  if (!response.ok) throw new Error('Boundary lookup unavailable')
  const data = (await response.json()) as {
    features: Array<{ geometry: BoundaryGeometry | { type: string } }>
  }
  const match = data.features.find(
    (feature) => feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon',
  )
  return (match?.geometry as BoundaryGeometry | undefined) ?? null
}

function geometryPolygons(geometry: BoundaryGeometry) {
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
}

function geometryRings(geometry: BoundaryGeometry) {
  return geometryPolygons(geometry).map((polygon) => polygon[0])
}

function pointInRing(lng: number, lat: number, ring: number[][]) {
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [currentLng, currentLat] = ring[index]
    const [previousLng, previousLat] = ring[previous]
    const crosses =
      currentLat > lat !== previousLat > lat &&
      lng <
        ((previousLng - currentLng) * (lat - currentLat)) /
          (previousLat - currentLat || Number.EPSILON) +
          currentLng
    if (crosses) inside = !inside
  }
  return inside
}

function pointInGeometry(lng: number, lat: number, geometry: BoundaryGeometry) {
  return geometryPolygons(geometry).some(
    ([outer, ...holes]) =>
      pointInRing(lng, lat, outer) &&
      !holes.some((hole) => pointInRing(lng, lat, hole)),
  )
}

function ringsCross(first: number[][], second: number[][]) {
  const direction = (a: number[], b: number[], c: number[]) =>
    (c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])

  for (let firstIndex = 1; firstIndex < first.length; firstIndex += 1) {
    for (let secondIndex = 1; secondIndex < second.length; secondIndex += 1) {
      const a = first[firstIndex - 1]
      const b = first[firstIndex]
      const c = second[secondIndex - 1]
      const d = second[secondIndex]
      if (
        direction(a, b, c) * direction(a, b, d) < 0 &&
        direction(c, d, a) * direction(c, d, b) < 0
      ) {
        return true
      }
    }
  }
  return false
}

function geometriesOverlap(first: BoundaryGeometry, second: BoundaryGeometry) {
  return (
    geometryRings(first).some((ring) =>
      ring.slice(0, -1).some(([lng, lat]) => pointInGeometry(lng, lat, second)),
    ) ||
    geometryRings(second).some((ring) =>
      ring.slice(0, -1).some(([lng, lat]) => pointInGeometry(lng, lat, first)),
    ) ||
    geometryRings(first).some((firstRing) =>
      geometryRings(second).some((secondRing) => ringsCross(firstRing, secondRing)),
    )
  )
}

function distanceMeters(a: Pick<TrackPoint, 'lat' | 'lng'>, b: Pick<TrackPoint, 'lat' | 'lng'>) {
  const toRad = Math.PI / 180
  const dLat = (b.lat - a.lat) * toRad
  const dLng = (b.lng - a.lng) * toRad
  const lat1 = a.lat * toRad
  const lat2 = b.lat * toRad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(h))
}

function toMercator(lat: number, lng: number) {
  const limitedLat = Math.max(-85, Math.min(85, lat))
  return {
    x: EARTH_RADIUS * lng * (Math.PI / 180),
    y:
      EARTH_RADIUS *
      Math.log(Math.tan(Math.PI / 4 + (limitedLat * Math.PI) / 360)),
  }
}

function fromMercator(x: number, y: number) {
  return {
    lng: (x / EARTH_RADIUS) * (180 / Math.PI),
    lat:
      (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) *
      (180 / Math.PI),
  }
}

function formatDistance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`
}

function formatDuration(ms: number) {
  const minutes = Math.floor(ms / 60000)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function getZoneColor(zone: Zone, index: number) {
  return zone.color ?? AREA_COLORS[index % AREA_COLORS.length]
}

function smoothGpsSamples(samples: TrackPoint[]): TrackPoint {
  const totalWeight = samples.reduce(
    (sum, point) => sum + 1 / Math.max(25, point.accuracy ** 2),
    0,
  )
  const latest = samples[samples.length - 1]
  return {
    lat:
      samples.reduce(
        (sum, point) => sum + point.lat / Math.max(25, point.accuracy ** 2),
        0,
      ) / totalWeight,
    lng:
      samples.reduce(
        (sum, point) => sum + point.lng / Math.max(25, point.accuracy ** 2),
        0,
      ) / totalWeight,
    accuracy: latest.accuracy,
    timestamp: latest.timestamp,
  }
}

function MapInteractionHandler({ onManualMove }: { onManualMove: () => void }) {
  useMapEvents({
    dragstart() {
      onManualMove()
    },
  })
  return null
}

function MapController({
  focus,
  mapRef,
}: {
  focus: { lat: number; lng: number; zoom?: number } | null
  mapRef: React.MutableRefObject<LeafletMap | null>
}) {
  const map = useMap()
  useEffect(() => {
    mapRef.current = map
  }, [map, mapRef])
  useEffect(() => {
    if (focus) map.flyTo([focus.lat, focus.lng], focus.zoom ?? 15, { duration: 0.8 })
  }, [focus, map])
  return null
}

function TrackpadPan({ onManualMove }: { onManualMove: () => void }) {
  const map = useMap()

  useEffect(() => {
    const container = map.getContainer()
    const handleWheel = (event: WheelEvent) => {
      const isHorizontalGesture =
        event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) * 0.7
      const horizontalDelta = event.shiftKey ? event.deltaY : event.deltaX

      event.preventDefault()
      event.stopImmediatePropagation()

      if (isHorizontalGesture && Math.abs(horizontalDelta) > 0.5) {
        onManualMove()
        map.panBy([horizontalDelta, 0], { animate: false })
        return
      }

      const pointer = map.mouseEventToContainerPoint(event)
      const limitedDelta = Math.sign(event.deltaY) * Math.min(Math.abs(event.deltaY), 20)
      const targetZoom = Math.max(
        map.getMinZoom(),
        Math.min(map.getMaxZoom(), map.getZoom() - limitedDelta * 0.11),
      )
      map.setZoomAround(pointer, targetZoom)
    }

    container.addEventListener('wheel', handleWheel, { passive: false, capture: true })
    return () => container.removeEventListener('wheel', handleWheel, { capture: true })
  }, [map, onManualMove])

  return null
}

function App() {
  const [projects, setProjects] = useState<Project[]>(loadProjects)
  const [activeId, setActiveId] = useState(() => {
    const savedId =
      localStorage.getItem(ACTIVE_PROJECT_KEY) ||
      localStorage.getItem(PREVIOUS_ACTIVE_PROJECT_KEY) ||
      localStorage.getItem(LEGACY_ACTIVE_PROJECT_KEY)
    return projects.some((project) => project.id === savedId) ? savedId! : projects[0].id
  })
  const [tab, setTab] = useState<Tab>('map')
  const [isTracking, setIsTracking] = useState(false)
  const [followUser, setFollowUser] = useState(true)
  const [livePoint, setLivePoint] = useState<TrackPoint | null>(null)
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null)
  const [liveSpeed, setLiveSpeed] = useState<number | null>(null)
  const [isResolvingBoundary, setIsResolvingBoundary] = useState(false)
  const [officialWards, setOfficialWards] = useState<WardFeatureCollection | null>(null)
  const [officialBoundaryError, setOfficialBoundaryError] = useState(false)
  const [visibleZoneIds, setVisibleZoneIds] = useState<Set<string>>(() => new Set())
  const [isTerritoryMode, setIsTerritoryMode] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [gpsError, setGpsError] = useState('')
  const [focus, setFocus] = useState<{ lat: number; lng: number; zoom?: number } | null>(
    null,
  )
  const [showProjectMenu, setShowProjectMenu] = useState(false)
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const mapRef = useRef<LeafletMap | null>(null)
  const watchId = useRef<number | null>(null)
  const gpsSamples = useRef<TrackPoint[]>([])
  const followUserRef = useRef(true)
  const pullStart = useRef<{ x: number; y: number } | null>(null)
  const pullDistanceRef = useRef(0)

  const activeProject = projects.find((project) => project.id === activeId) ?? projects[0]

  const updateProject = (update: (project: Project) => Project) => {
    setProjects((current) =>
      current.map((project) =>
        project.id === activeId
          ? { ...update(project), updatedAt: Date.now() }
          : project,
      ),
    )
  }

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects))
    } catch {
      console.error('Coverly could not save because browser storage is full.')
    }
  }, [projects])

  useEffect(() => {
    localStorage.setItem(ACTIVE_PROJECT_KEY, activeId)
  }, [activeId])

  useEffect(() => {
    loadOfficialWards()
      .then((collection) => {
        setOfficialWards(collection)
        if (localStorage.getItem(OFFICIAL_STARTER_KEY)) return
        setProjects((current) => {
          if (current.some((project) => project.zones.length > 0)) return current
          const zones = officialStarterZones(collection)
          if (!zones.length) return current
          localStorage.setItem(OFFICIAL_STARTER_KEY, 'loaded')
          return current.map((project) =>
            project.id === activeId
              ? { ...project, name: 'Bengaluru house search', zones, updatedAt: Date.now() }
              : project,
          )
        })
      })
      .catch(() => setOfficialBoundaryError(true))
  }, [activeId])

  useEffect(() => {
    followUserRef.current = followUser
  }, [followUser])

  useEffect(() => {
    navigator.storage?.persist?.().catch(() => {
      // Browser storage still works when durable-storage permission is unavailable.
    })
  }, [])

  useEffect(() => {
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current)
    }
  }, [])

  useEffect(() => {
    if (!isTracking || !navigator.wakeLock) return
    let released = false
    let lock: WakeLockSentinel | null = null
    const acquire = async () => {
      if (released || document.visibilityState !== 'visible') return
      try {
        lock = await navigator.wakeLock.request('screen')
      } catch {
        // Tracking still works while the browser keeps the page active.
      }
    }
    const restore = () => {
      if (document.visibilityState === 'visible') void acquire()
    }
    void acquire()
    document.addEventListener('visibilitychange', restore)
    return () => {
      released = true
      document.removeEventListener('visibilitychange', restore)
      void lock?.release()
    }
  }, [isTracking])

  useEffect(() => {
    const beginPull = (event: TouchEvent) => {
      if (event.touches.length !== 1 || event.touches[0].clientY > 120) return
      const target = event.target as HTMLElement
      if (target.closest('input, button, .side-panel, .project-menu')) return
      pullStart.current = {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY,
      }
    }

    const updatePull = (event: TouchEvent) => {
      if (!pullStart.current || event.touches.length !== 1) return
      const verticalDistance = event.touches[0].clientY - pullStart.current.y
      const horizontalDistance = Math.abs(event.touches[0].clientX - pullStart.current.x)
      if (verticalDistance <= 6 || verticalDistance < horizontalDistance) return

      event.preventDefault()
      const distance = Math.min(100, verticalDistance * 0.55)
      pullDistanceRef.current = distance
      setPullDistance(distance)
    }

    const finishPull = () => {
      if (!pullStart.current) return
      pullStart.current = null
      if (pullDistanceRef.current >= 70) {
        setIsRefreshing(true)
        setPullDistance(82)
        window.setTimeout(() => window.location.reload(), 250)
      } else {
        pullDistanceRef.current = 0
        setPullDistance(0)
      }
    }

    document.addEventListener('touchstart', beginPull, { passive: true, capture: true })
    document.addEventListener('touchmove', updatePull, { passive: false, capture: true })
    document.addEventListener('touchend', finishPull, { capture: true })
    document.addEventListener('touchcancel', finishPull, { capture: true })
    return () => {
      document.removeEventListener('touchstart', beginPull, { capture: true })
      document.removeEventListener('touchmove', updatePull, { capture: true })
      document.removeEventListener('touchend', finishPull, { capture: true })
      document.removeEventListener('touchcancel', finishPull, { capture: true })
    }
  }, [])

  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) return

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setIsSearching(true)
      setSearchError('')
      try {
        setResults(await findPlaces(term, controller.signal))
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setSearchError('Suggestions are temporarily unavailable.')
        }
      } finally {
        if (!controller.signal.aborted) setIsSearching(false)
      }
    }, 350)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  const routeDistance = useMemo(
    () =>
      activeProject.track.reduce(
        (total, point, index, track) =>
          index === 0 ? 0 : total + distanceMeters(track[index - 1], point),
        0,
      ),
    [activeProject.track],
  )

  const sessionDuration = useMemo(() => {
    if (activeProject.track.length < 2) return 0
    return (
      activeProject.track[activeProject.track.length - 1].timestamp -
      activeProject.track[0].timestamp
    )
  }, [activeProject.track])

  const coverage = useMemo(() => {
    if (!activeProject.zones.length) {
      return { covered: 0, total: 0, cellSize: 150 }
    }

    const zoneBounds = activeProject.zones.map((zone) => {
      if (zone.geometry) {
        const projected = geometryRings(zone.geometry)
          .flat()
          .map(([lng, lat]) => toMercator(lat, lng))
        return {
          minX: Math.min(...projected.map((point) => point.x)),
          maxX: Math.max(...projected.map((point) => point.x)),
          minY: Math.min(...projected.map((point) => point.y)),
          maxY: Math.max(...projected.map((point) => point.y)),
        }
      }
      const center = toMercator(zone.lat, zone.lng)
      const radius = (zone.radius ?? 500) / Math.cos((zone.lat * Math.PI) / 180)
      return {
        minX: center.x - radius,
        maxX: center.x + radius,
        minY: center.y - radius,
        maxY: center.y + radius,
      }
    })
    const estimatedArea = zoneBounds.reduce(
      (sum, bounds) => sum + (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY),
      0,
    )
    const cellSize = Math.max(60, Math.min(250, Math.sqrt(estimatedArea / 2600)))
    const cells = new Set<string>()

    activeProject.zones.forEach((zone, zoneIndex) => {
      const bounds = zoneBounds[zoneIndex]
      const minX = Math.floor(bounds.minX / cellSize)
      const maxX = Math.floor(bounds.maxX / cellSize)
      const minY = Math.floor(bounds.minY / cellSize)
      const maxY = Math.floor(bounds.maxY / cellSize)
      const center = toMercator(zone.lat, zone.lng)
      const projectedRadius =
        (zone.radius ?? 500) / Math.cos((zone.lat * Math.PI) / 180)

      for (let ix = minX; ix <= maxX; ix += 1) {
        for (let iy = minY; iy <= maxY; iy += 1) {
          const x = (ix + 0.5) * cellSize
          const y = (iy + 0.5) * cellSize
          const cellCenter = fromMercator(x, y)
          const isInside = zone.geometry
            ? pointInGeometry(cellCenter.lng, cellCenter.lat, zone.geometry)
            : Math.hypot(x - center.x, y - center.y) <= projectedRadius
          if (isInside) {
            const id = `${ix}:${iy}`
            if (!cells.has(id)) cells.add(id)
          }
        }
      }
    })

    const visited = new Set<string>()
    activeProject.track.forEach((point, index, track) => {
      const start = toMercator(point.lat, point.lng)
      const previous = index > 0 ? toMercator(track[index - 1].lat, track[index - 1].lng) : start
      const segmentLength = Math.hypot(start.x - previous.x, start.y - previous.y)
      const steps = Math.max(1, Math.ceil(segmentLength / (cellSize * 0.4)))
      for (let step = 0; step <= steps; step += 1) {
        const progress = step / steps
        const x = previous.x + (start.x - previous.x) * progress
        const y = previous.y + (start.y - previous.y) * progress
        const ix = Math.floor(x / cellSize)
        const iy = Math.floor(y / cellSize)
        for (let dx = -1; dx <= 1; dx += 1) {
          for (let dy = -1; dy <= 1; dy += 1) {
            if (Math.hypot(dx, dy) <= 1) visited.add(`${ix + dx}:${iy + dy}`)
          }
        }
      }
    })

    const covered = Array.from(cells.keys()).filter((id) => visited.has(id)).length
    return {
      covered,
      total: cells.size,
      cellSize,
    }
  }, [activeProject.track, activeProject.zones])

  const coveragePercent =
    coverage.total > 0 ? Math.round((coverage.covered / coverage.total) * 100) : 0

  const toggleZoneVisibility = (zoneId: string, forceVisible?: boolean) => {
    setVisibleZoneIds((current) => {
      const next = new Set(current)
      const shouldShow = forceVisible ?? !next.has(zoneId)
      if (shouldShow) next.add(zoneId)
      else next.delete(zoneId)
      return next
    })
  }

  const addOfficialWard = (
    ward: WardFeature,
    lat: number,
    lng: number,
    selectedPlace = ward.properties.ward_name,
  ) => {
    const sourceLabel = `Official GBA Ward ${ward.properties.ward_id}`
    const existing = activeProject.zones.find((zone) => zone.sourceLabel === sourceLabel)
    if (existing) {
      setFocus({ lat: existing.lat, lng: existing.lng, zoom: 14 })
      toggleZoneVisibility(existing.id)
      return
    }
    const zoneId = uid()
    updateProject((project) => ({
      ...project,
      zones: [
        ...project.zones,
        {
          id: zoneId,
          name:
            selectedPlace === ward.properties.ward_name
              ? ward.properties.ward_name
              : `${selectedPlace} · ${ward.properties.ward_name}`,
          lat,
          lng,
          geometry: ward.geometry,
          color: AREA_COLORS[project.zones.length % AREA_COLORS.length],
          source: 'gba',
          sourceLabel,
        },
      ],
    }))
    toggleZoneVisibility(zoneId, true)
    setFocus({ lat, lng, zoom: 14 })
    setQuery('')
    setResults([])
  }

  const addBoundaryZone = async (result: SearchResult) => {
    setIsResolvingBoundary(true)
    setSearchError('')
    try {
      const lat = Number(result.lat)
      const lng = Number(result.lon)
      const wards = officialWards ?? (await loadOfficialWards())
      if (!officialWards) setOfficialWards(wards)
      const officialWard = wardAtPoint(wards, lat, lng)
      if (officialWard) {
        addOfficialWard(
          officialWard,
          lat,
          lng,
          result.display_name.split(',')[0],
        )
        return
      }
      const geometry = await findBoundary(result)
      if (!geometry) {
        setSearchError('No verified territory boundary is available for this place.')
        return
      }
      if (
        activeProject.zones.some(
          (zone) => zone.geometry && geometriesOverlap(zone.geometry, geometry),
        )
      ) {
        setSearchError('This boundary overlaps an existing area. Choose a separate layout.')
        return
      }
      const zoneId = uid()
      updateProject((project) => ({
        ...project,
        zones: [
          ...project.zones,
          {
            id: zoneId,
            name: result.display_name.split(',')[0],
            lat,
            lng,
            geometry,
            color: AREA_COLORS[project.zones.length % AREA_COLORS.length],
            source: 'osm',
            sourceLabel: 'OpenStreetMap mapped boundary',
          },
        ],
      }))
      toggleZoneVisibility(zoneId, true)
      setFocus({ lat, lng, zoom: 14 })
      setQuery('')
      setResults([])
    } catch {
      setSearchError('Verified boundary data is temporarily unavailable.')
    } finally {
      setIsResolvingBoundary(false)
    }
  }

  const searchPlaces = async (event: React.FormEvent) => {
    event.preventDefault()
    if (query.trim().length < 2) return
    setIsSearching(true)
    setSearchError('')
    try {
      setResults(await findPlaces(query.trim()))
    } catch {
      setSearchError('Place search is temporarily unavailable.')
    } finally {
      setIsSearching(false)
    }
  }

  const locateMe = () => {
    if (!navigator.geolocation) {
      setGpsError('GPS is not supported by this browser.')
      return
    }
    setGpsError('')
    navigator.geolocation.getCurrentPosition(
      ({ coords, timestamp }) => {
        const point = {
          lat: coords.latitude,
          lng: coords.longitude,
          accuracy: coords.accuracy,
          timestamp,
        }
        setLivePoint(point)
        setGpsAccuracy(coords.accuracy)
        setLiveSpeed(coords.speed)
        setFollowUser(true)
        setFocus({ lat: coords.latitude, lng: coords.longitude, zoom: 16 })
      },
      (error) => setGpsError(error.message || 'Could not get your location.'),
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  const stopTracking = () => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current)
      watchId.current = null
    }
    setIsTracking(false)
    gpsSamples.current = []
  }

  const resetRoute = () => {
    if (!activeProject.track.length) return
    if (!window.confirm('Reset the recorded route and start fresh?')) return
    stopTracking()
    updateProject((project) => ({ ...project, track: [] }))
    setLivePoint(null)
    setGpsAccuracy(null)
    setLiveSpeed(null)
  }

  const startTracking = () => {
    if (!navigator.geolocation) {
      setGpsError('GPS is not supported by this browser.')
      return
    }
    setGpsError('')
    setIsTracking(true)
    setFollowUser(true)
    setIsTerritoryMode(false)
    setVisibleZoneIds(new Set())
    setGpsAccuracy(null)
    gpsSamples.current = []
    watchId.current = navigator.geolocation.watchPosition(
      ({ coords, timestamp }) => {
        const rawPoint: TrackPoint = {
          lat: coords.latitude,
          lng: coords.longitude,
          accuracy: coords.accuracy,
          timestamp,
        }
        setLivePoint(rawPoint)
        setGpsAccuracy(coords.accuracy)
        setLiveSpeed(coords.speed)

        if (coords.accuracy > 60) return

        if (followUserRef.current && mapRef.current) {
          mapRef.current.setView(
            [coords.latitude, coords.longitude],
            Math.max(mapRef.current.getZoom(), 16),
            { animate: true },
          )
        }

        gpsSamples.current = [...gpsSamples.current.slice(-3), rawPoint]
        const nextPoint = smoothGpsSamples(gpsSamples.current)
        setProjects((current) =>
          current.map((project) => {
            if (project.id !== activeId) return project
            const previous = project.track[project.track.length - 1]
            if (
              previous &&
              distanceMeters(previous, nextPoint) < 2 &&
              timestamp - previous.timestamp < 4000
            ) {
              return project
            }
            return {
              ...project,
              track: [...project.track, nextPoint],
              updatedAt: Date.now(),
            }
          }),
        )
      },
      (error) => {
        setGpsError(error.message || 'GPS tracking stopped.')
        stopTracking()
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
    )
  }

  const changeActiveProject = (projectId: string) => {
    setActiveId(projectId)
    setVisibleZoneIds(new Set())
    setIsTerritoryMode(false)
  }

  const createProject = () => {
    stopTracking()
    const project = newProject()
    setProjects((current) => [...current, project])
    changeActiveProject(project.id)
    setShowProjectMenu(false)
    setTab('areas')
  }

  const deleteProject = (id: string) => {
    if (projects.length === 1) {
      const fresh = newProject()
      setProjects([fresh])
      changeActiveProject(fresh.id)
      return
    }
    const remaining = projects.filter((project) => project.id !== id)
    setProjects(remaining)
    if (activeId === id) changeActiveProject(remaining[0].id)
  }

  const trackPositions: LatLngExpression[] = activeProject.track.map((point) => [
    point.lat,
    point.lng,
  ])
  const currentPoint = livePoint ?? activeProject.track[activeProject.track.length - 1]
  const gpsQuality =
    gpsAccuracy === null
      ? 'Acquiring GPS'
      : gpsAccuracy <= 15
        ? 'High accuracy'
        : gpsAccuracy <= 35
          ? 'Good accuracy'
          : gpsAccuracy <= 60
            ? 'Fair accuracy'
            : 'Weak GPS — waiting'

  return (
    <main className="app-shell">
      <div
        className={`pull-refresh-indicator ${isRefreshing ? 'refreshing' : ''}`}
        style={{ transform: `translate(-50%, ${pullDistance - 58}px)` }}
        aria-hidden="true"
      >
        <RefreshCw size={17} />
        <span>
          {isRefreshing
            ? 'Refreshing…'
            : pullDistance >= 70
              ? 'Release to refresh'
              : 'Pull to refresh'}
        </span>
      </div>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Navigation size={19} fill="currentColor" /></div>
          <span>Coverly</span>
        </div>
        <div className="project-switcher">
          <button
            type="button"
            className="project-button"
            onClick={() => setShowProjectMenu((open) => !open)}
          >
            <span>
              <small>Current project</small>
              {activeProject.name}
            </span>
            <ChevronDown size={17} />
          </button>
          {showProjectMenu && (
            <div className="project-menu">
              {projects.map((project) => (
                <div
                  className={`project-option ${project.id === activeId ? 'active' : ''}`}
                  key={project.id}
                >
                  <button
                    type="button"
                    onClick={() => {
                      stopTracking()
                      changeActiveProject(project.id)
                      setShowProjectMenu(false)
                    }}
                  >
                    <MapPin size={16} />
                    <span>{project.name}<small>{project.zones.length} areas</small></span>
                  </button>
                  <button
                    type="button"
                    className="icon-button subtle"
                    aria-label={`Delete ${project.name}`}
                    onClick={() => deleteProject(project.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              <button type="button" className="new-project" onClick={createProject}>
                <MapPinned size={16} /> New project
              </button>
            </div>
          )}
        </div>
        <div className={`live-badge ${isTracking ? 'active' : ''}`}>
          <span />
          {isTracking ? 'GPS live' : 'GPS paused'}
        </div>
      </header>

      <section className="workspace">
        <aside className={`side-panel ${tab === 'map' ? 'map-overview-panel' : ''}`}>
          <nav className="panel-tabs">
            <button className={tab === 'map' ? 'active' : ''} onClick={() => setTab('map')}>
              <MapIcon size={18} /> Map
            </button>
            <button className={tab === 'areas' ? 'active' : ''} onClick={() => setTab('areas')}>
              <Layers3 size={18} /> Areas
            </button>
            <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
              <History size={18} /> History
            </button>
          </nav>

          <div className="panel-content">
            {tab === 'map' && (
              <>
                <div className="panel-heading">
                  <div><span className="eyebrow">Live overview</span><h1>Coverage map</h1></div>
                  <button className="icon-button" onClick={() => locateMe()} aria-label="Locate me">
                    <LocateFixed size={19} />
                  </button>
                </div>

                <div className="coverage-card">
                  <div className="coverage-ring" style={{ '--progress': `${coveragePercent * 3.6}deg` } as React.CSSProperties}>
                    <span>{coveragePercent}%<small>covered</small></span>
                  </div>
                  <div>
                    <strong>{coverage.covered} of {coverage.total}</strong>
                    <span>map zones visited</span>
                    <small>Grid adjusts to about {Math.round(coverage.cellSize)} m</small>
                  </div>
                </div>

                <div className="stats-grid">
                  <div><Route size={18} /><strong>{formatDistance(routeDistance)}</strong><span>Distance</span></div>
                  <div><Clock3 size={18} /><strong>{formatDuration(sessionDuration)}</strong><span>Duration</span></div>
                  <div><MapPin size={18} /><strong>{activeProject.zones.length}</strong><span>Areas</span></div>
                </div>

                <div className="legend">
                  <h3>Map legend</h3>
                  <div><span className="legend-line route" /> Tracked path</div>
                  <div><span className="legend-boundary" /> Optional territory</div>
                </div>
              </>
            )}

            {tab === 'areas' && (
              <>
                <div className="panel-heading">
                  <div><span className="eyebrow">Search plan</span><h1>Your areas</h1></div>
                  <span className="count-pill">{activeProject.zones.length}</span>
                </div>

                <label className="field-label" htmlFor="project-name">Project name</label>
                <input
                  id="project-name"
                  className="text-input"
                  value={activeProject.name}
                  onChange={(event) =>
                    updateProject((project) => ({ ...project, name: event.target.value }))
                  }
                />

                <section className="area-builder">
                  <div className="builder-title">
                    <span><MapPinned size={18} /></span>
                    <div><strong>Choose a territory</strong><small>Official ward or verified mapped boundary</small></div>
                  </div>

                  <form className="search-form" onSubmit={searchPlaces}>
                    <Search size={18} />
                    <input
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value)
                        if (event.target.value.trim().length < 2) setResults([])
                      }}
                      placeholder="Search any place..."
                      aria-label="Search any place"
                      autoComplete="off"
                    />
                    {query && (
                      <button type="button" onClick={() => { setQuery(''); setResults([]) }} aria-label="Clear search">
                        <X size={16} />
                      </button>
                    )}
                  </form>
                  {isSearching && <p className="hint">Searching OpenStreetMap…</p>}
                  {searchError && <p className="message error">{searchError}</p>}
                  {results.length > 0 && (
                    <div className="search-results">
                      {results.map((result) => (
                        <button
                          type="button"
                          key={result.place_id}
                          onClick={() => addBoundaryZone(result)}
                        >
                          <MapPin size={17} />
                          <span>{result.display_name.split(',')[0]}<small>{result.display_name}</small></span>
                        </button>
                      ))}
                    </div>
                  )}
                  {isResolvingBoundary && <p className="hint">Loading locality boundary…</p>}
                  {!officialBoundaryError && officialWards && (
                    <p className="boundary-source-note">Official 2025 GBA ward demarcation loaded</p>
                  )}
                  {officialBoundaryError && (
                    <p className="message error">Official Bengaluru boundaries could not be loaded.</p>
                  )}

                  <div className="add-actions">
                    <button type="button" className="secondary-button" onClick={() => locateMe()}>
                      <LocateFixed size={17} /> My location
                    </button>
                  </div>
                </section>

                {activeProject.zones.length === 0 ? (
                  <div className="empty-state">
                    <MapPinned size={29} />
                    <strong>Choose your first territory</strong>
                    <span>Search a place to select its verified irregular boundary.</span>
                  </div>
                ) : (
                  <div className="zone-list">
                    {activeProject.zones.map((zone, index) => (
                      <article
                        className="zone-card"
                        key={zone.id}
                        style={{ '--zone-color': getZoneColor(zone, index) } as React.CSSProperties}
                      >
                        <div className="zone-main">
                          <span className="zone-number">{index + 1}</span>
                          <span>
                            <input
                              className="zone-name-input"
                              value={zone.name}
                              aria-label={`Name for area ${index + 1}`}
                              onChange={(event) =>
                                updateProject((project) => ({
                                  ...project,
                                  zones: project.zones.map((item) =>
                                    item.id === zone.id ? { ...item, name: event.target.value } : item,
                                  ),
                                }))
                              }
                            />
                            <button
                              type="button"
                              className="zone-coordinates"
                              onClick={() => setFocus({ lat: zone.lat, lng: zone.lng, zoom: 14 })}
                            >
                              View point · {zone.lat.toFixed(4)}, {zone.lng.toFixed(4)}
                            </button>
                          </span>
                        </div>
                        <button
                          type="button"
                          className="icon-button subtle"
                          onClick={() =>
                            updateProject((project) => ({
                              ...project,
                              zones: project.zones.filter((item) => item.id !== zone.id),
                            }))
                          }
                          aria-label={`Delete ${zone.name}`}
                        >
                          <Trash2 size={16} />
                        </button>
                        <div className="zone-boundary-summary">
                          <span className="boundary-status" />
                          <strong>{zone.sourceLabel ?? 'Verified mapped boundary'}</strong>
                          <small>{zone.geometry ? `${geometryRings(zone.geometry).flat().length - 1} boundary points` : 'Boundary unavailable'}</small>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </>
            )}

            {tab === 'history' && (
              <>
                <div className="panel-heading">
                  <div><span className="eyebrow">Saved locally</span><h1>Route history</h1></div>
                  <History size={21} />
                </div>
                <div className="history-summary">
                  <div className="history-icon"><Activity size={24} /></div>
                  <div>
                    <strong>{activeProject.track.length.toLocaleString()}</strong>
                    <span>GPS points recorded</span>
                  </div>
                </div>
                <div className="history-list">
                  <div><span>Route distance</span><strong>{formatDistance(routeDistance)}</strong></div>
                  <div><span>Tracking duration</span><strong>{formatDuration(sessionDuration)}</strong></div>
                  <div><span>Started</span><strong>{activeProject.track.length ? new Date(activeProject.track[0].timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Not started'}</strong></div>
                  <div><span>Last update</span><strong>{new Date(activeProject.updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</strong></div>
                </div>
                {activeProject.track.length > 0 && (
                  <button
                    type="button"
                    className="danger-button"
                    onClick={resetRoute}
                  >
                    <Trash2 size={17} /> Clear route history
                  </button>
                )}
                <p className="privacy-note">Your locations stay in this browser. Nothing is uploaded to a server.</p>
              </>
            )}
          </div>
        </aside>

        <div className="map-wrap">
          <MapContainer
            center={BENGALURU}
            zoom={13}
            zoomControl={false}
            zoomSnap={0.01}
            zoomDelta={0.5}
            scrollWheelZoom={false}
            touchZoom
            dragging
            preferCanvas
            className="map"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              maxZoom={19}
              className="base-map-tiles"
            />
            <MapController focus={focus} mapRef={mapRef} />
            <TrackpadPan onManualMove={() => setFollowUser(false)} />
            <MapInteractionHandler onManualMove={() => setFollowUser(false)} />
            {isTerritoryMode && officialWards && (
              <GeoJSON
                key="gba-wards-2025"
                data={officialWards}
                style={{
                  color: '#64748b',
                  weight: 0.8,
                  fillColor: '#f8fafc',
                  fillOpacity: 0.018,
                }}
                onEachFeature={(feature, layer) => {
                  const ward = feature as WardFeature
                  layer.bindTooltip(
                    `Ward ${ward.properties.ward_id} · ${ward.properties.ward_name}`,
                    { sticky: true, direction: 'top' },
                  )
                  layer.on('click', (event) =>
                    addOfficialWard(
                      ward,
                      event.latlng.lat,
                      event.latlng.lng,
                    ),
                  )
                }}
              />
            )}
            {activeProject.zones.map((zone, index) => (
              visibleZoneIds.has(zone.id) &&
              zone.geometry && (
                <GeoJSON
                  key={zone.id}
                  data={zone.geometry}
                  style={{
                    color: getZoneColor(zone, index),
                    weight: 2,
                    fillColor: getZoneColor(zone, index),
                    fillOpacity: 0.055,
                  }}
                  eventHandlers={{ click: () => toggleZoneVisibility(zone.id) }}
                />
              )
            ))}
            {activeProject.zones.map((zone, index) => (
              visibleZoneIds.has(zone.id) && (
              <CircleMarker
                key={`${zone.id}-point`}
                center={[zone.lat, zone.lng]}
                radius={10}
                pathOptions={{ color: '#fff', weight: 3, fillColor: getZoneColor(zone, index), fillOpacity: 1 }}
              >
                <Tooltip
                  permanent
                  direction="top"
                  offset={[0, -10]}
                  className="area-label-tooltip"
                >
                  <div
                    className="area-label-content"
                    style={{ '--area-color': getZoneColor(zone, index) } as React.CSSProperties}
                  >
                    <span>{index + 1}</span>
                    <div>
                      <strong>{zone.name}</strong>
                      <small>{zone.sourceLabel ?? 'Verified boundary'}</small>
                    </div>
                  </div>
                </Tooltip>
                <Popup className="place-popup" minWidth={210}>
                  <div className="popup-place">
                    <span className="popup-number" style={{ background: getZoneColor(zone, index) }}>{index + 1}</span>
                    <div>
                      <strong>{zone.name}</strong>
                      <span>{zone.sourceLabel ?? 'Verified mapped boundary'}</span>
                      <small>{zone.lat.toFixed(5)}, {zone.lng.toFixed(5)}</small>
                    </div>
                  </div>
                </Popup>
              </CircleMarker>
              )
            ))}
            {trackPositions.length > 1 && (
              <>
                <Polyline positions={trackPositions} pathOptions={{ color: '#17b88a', weight: 13, opacity: 0.2, lineCap: 'round', lineJoin: 'round' }} />
                <Polyline positions={trackPositions} pathOptions={{ color: '#078765', weight: 4, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }} />
              </>
            )}
            {currentPoint && (
              <>
                <Circle
                  center={[currentPoint.lat, currentPoint.lng]}
                  radius={Math.min(200, Math.max(8, currentPoint.accuracy))}
                  pathOptions={{ color: '#2385f5', weight: 1, fillColor: '#2385f5', fillOpacity: 0.1 }}
                />
                <CircleMarker
                  center={[currentPoint.lat, currentPoint.lng]}
                  radius={8}
                  pathOptions={{ color: '#fff', weight: 3, fillColor: '#2385f5', fillOpacity: 1 }}
                />
              </>
            )}
          </MapContainer>

          <form className="map-search" onSubmit={searchPlaces}>
            <Search size={19} />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                if (event.target.value.trim().length < 2) setResults([])
              }}
              placeholder="Search a place"
              autoComplete="off"
            />
          </form>
          {tab === 'map' && query.trim().length >= 2 && (
            <div className="map-suggestions">
              {isSearching && results.length === 0 && (
                <div className="suggestion-status">Finding nearby places…</div>
              )}
              {results.map((result) => (
                <button
                  type="button"
                  key={result.place_id}
                  onClick={() => addBoundaryZone(result)}
                >
                  <span className="suggestion-icon"><MapPin size={16} /></span>
                  <span>
                    <strong>{result.display_name.split(',')[0]}</strong>
                    <small>{result.display_name.split(',').slice(1).join(',').trim()}</small>
                  </span>
                </button>
              ))}
              {searchError && <div className="suggestion-status error">{searchError}</div>}
            </div>
          )}

          {!isTracking && activeProject.zones.length > 0 && (
            <div className="area-map-key" aria-label="Search area color key">
              {activeProject.zones.map((zone, index) => (
                <button
                  type="button"
                  key={zone.id}
                  className={visibleZoneIds.has(zone.id) ? 'active' : ''}
                  onClick={() => {
                    toggleZoneVisibility(zone.id)
                    setFocus({ lat: zone.lat, lng: zone.lng, zoom: 13 })
                  }}
                >
                  <i style={{ background: getZoneColor(zone, index) }} />
                  <span>
                    <strong>{index + 1}. {zone.name}</strong>
                    <small>{visibleZoneIds.has(zone.id) ? 'Tap to hide' : 'Tap to show'}</small>
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="mobile-map-stats">
            <span><strong>{coveragePercent}%</strong> covered</span>
            <span><strong>{formatDistance(routeDistance)}</strong> travelled</span>
            <span><strong>{gpsAccuracy ? `±${Math.round(gpsAccuracy)} m` : '—'}</strong> GPS</span>
          </div>

          {gpsError && <div className="map-message"><X size={16} /><span>{gpsError}</span><button onClick={() => setGpsError('')}>Dismiss</button></div>}

          <div className="map-actions">
            {!isTracking && (
              <button
                type="button"
                className={`add-area-button ${isTerritoryMode ? 'active' : ''}`}
                onClick={() => {
                  setIsTerritoryMode((current) => !current)
                  setTab('map')
                }}
              >
                <MapPinned size={18} /> {isTerritoryMode ? 'Done' : 'Choose territory'}
              </button>
            )}
            {activeProject.track.length > 0 && (
              <button
                type="button"
                className="reset-route-button"
                onClick={resetRoute}
                aria-label="Reset recorded route"
                title="Reset route"
              >
                <RotateCcw size={18} />
              </button>
            )}
            <button
              type="button"
              className={`locate-button ${followUser ? 'active' : ''}`}
              onClick={() => {
                setFollowUser(true)
                if (currentPoint) {
                  setFocus({ lat: currentPoint.lat, lng: currentPoint.lng, zoom: 17 })
                } else {
                  locateMe()
                }
              }}
              aria-label="Follow my location"
            >
              <LocateFixed size={19} />
            </button>
          </div>
          <div className="pan-hint">Two-finger swipe to move · Pinch or scroll to zoom</div>

          <div className="tracking-bar">
            <div className="gps-readout">
              <span className={`tracking-dot ${isTracking ? 'active' : ''}`} />
              <span>
                <strong>{isTracking ? gpsQuality : 'Ready to navigate'}</strong>
                <small>
                  {isTracking
                    ? gpsAccuracy && gpsAccuracy > 60
                      ? 'Move outdoors and enable Precise Location'
                      : 'Following your position · route saves automatically'
                    : 'Enable precise GPS, then start tracking'}
                </small>
              </span>
            </div>
            {isTracking && (
              <div className="live-metrics">
                <span><strong>{gpsAccuracy ? `±${Math.round(gpsAccuracy)} m` : '—'}</strong><small>Accuracy</small></span>
                <span><strong>{liveSpeed === null ? '—' : Math.round(liveSpeed * 3.6)}</strong><small>km/h</small></span>
              </div>
            )}
            <button
              type="button"
              className={isTracking ? 'stop-button' : 'start-button'}
              onClick={isTracking ? stopTracking : startTracking}
            >
              {isTracking ? <><Pause size={18} fill="currentColor" /> Pause</> : <><Play size={18} fill="currentColor" /> Start tracking</>}
            </button>
          </div>
        </div>
      </section>

      <nav className="mobile-nav">
        <button className={tab === 'map' ? 'active' : ''} onClick={() => setTab('map')}><MapIcon size={20} />Map</button>
        <button className={tab === 'areas' ? 'active' : ''} onClick={() => setTab('areas')}><Layers3 size={20} />Areas</button>
        <button
          className={`mobile-track ${isTracking ? 'active' : ''}`}
          onClick={isTracking ? stopTracking : startTracking}
        >
          {isTracking ? <Square size={19} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
        </button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><History size={20} />History</button>
        <button onClick={() => locateMe()}><LocateFixed size={20} />Locate</button>
      </nav>
    </main>
  )
}

export default App
