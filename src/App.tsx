import { useEffect, useMemo, useRef, useState } from 'react'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation'
import {
  Circle,
  CircleMarker,
  GeoJSON,
  MapContainer,
  Marker,
  Popup,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import { divIcon, type LatLngExpression, type Map as LeafletMap } from 'leaflet'
import {
  Activity,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Flag,
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

const NativeBackgroundGeolocation =
  registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation')

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
  roadLat?: number
  roadLng?: number
}

type JourneyMarker = {
  id: string
  lat: number
  lng: number
  label: string
  createdAt: number
}

type Project = {
  id: string
  name: string
  zones: Zone[]
  track: TrackPoint[]
  markers: JourneyMarker[]
  shareCode?: string
  shareExpiresAt?: number
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
    color_index: number
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
const TERRITORY_COLORS = ['#3b82f6', '#f97316', '#22c55e', '#8b5cf6', '#f43f5e']
const ROUTE_SHARE_API = 'https://coverly-route-share.panasateja123.workers.dev'
const ROAD_ROUTER_API = 'https://router.project-osrm.org'
const ROAD_SNAP_MIN_SPEED = 2
const ROAD_SNAP_MAX_DISTANCE = 35
const ROAD_SNAP_INTERVAL = 2200
const IMPORTANT_PLACE_ICON = divIcon({
  className: 'important-place-marker',
  html: `
    <svg viewBox="0 0 32 38" aria-hidden="true">
      <path d="M8 34V4" fill="none" stroke="#8a5b08" stroke-width="3" stroke-linecap="round"/>
      <path d="M10 5h16l-4 6 4 6H10z" fill="#f59e0b" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="8" cy="34" r="3" fill="#8a5b08" stroke="#fff" stroke-width="1.5"/>
    </svg>
  `,
  iconSize: [32, 38],
  iconAnchor: [8, 34],
  popupAnchor: [6, -30],
  tooltipAnchor: [8, -30],
})

const uid = () => crypto.randomUUID()

const newProject = (): Project => {
  const now = Date.now()
  return {
    id: uid(),
    name: 'My search area',
    zones: [],
    track: [],
    markers: [],
    createdAt: now,
    updatedAt: now,
  }
}

function loadProjects(): Project[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as Project[]
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.map((project) => ({
          ...project,
          markers: Array.isArray(project.markers) ? project.markers : [],
        }))
      }
    }
    const previousStored =
      localStorage.getItem(PREVIOUS_STORAGE_KEY) ||
      localStorage.getItem(LEGACY_STORAGE_KEY)
    if (previousStored) {
      const previousProjects = JSON.parse(previousStored) as Project[]
      if (Array.isArray(previousProjects) && previousProjects.length) {
        const migrated = previousProjects.map((project) => ({
          ...project,
          markers: Array.isArray(project.markers) ? project.markers : [],
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
  return BENGALURU_TARGETS.flatMap((target) => {
    const ward = wardAtPoint(collection, target.lat, target.lng)
    if (!ward || selected.has(ward.properties.ward_id)) return []
    selected.add(ward.properties.ward_id)
    return [{
      id: uid(),
      name: `${target.name} · ${ward.properties.ward_name}`,
      lat: target.lat,
      lng: target.lng,
      geometry: ward.geometry,
      color: TERRITORY_COLORS[ward.properties.color_index % TERRITORY_COLORS.length],
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

function trackDistance(track: TrackPoint[]) {
  return track.reduce(
    (total, point, index) =>
      index === 0 ? 0 : total + distanceMeters(track[index - 1], point),
    0,
  )
}

type RoadLocation = { lat: number; lng: number; distance: number }

async function nearestRoad(
  point: Pick<TrackPoint, 'lat' | 'lng'>,
  signal?: AbortSignal,
): Promise<RoadLocation | null> {
  const response = await fetch(
    `${ROAD_ROUTER_API}/nearest/v1/driving/${point.lng.toFixed(6)},${point.lat.toFixed(6)}?number=1`,
    { signal },
  )
  if (!response.ok) return null
  const result = await response.json() as {
    code?: string
    waypoints?: Array<{ location?: [number, number]; distance?: number }>
  }
  const match = result.waypoints?.[0]
  if (
    result.code !== 'Ok' ||
    !match?.location ||
    typeof match.distance !== 'number'
  ) {
    return null
  }
  return {
    lat: match.location[1],
    lng: match.location[0],
    distance: match.distance,
  }
}

function inferredTrackSpeed(track: TrackPoint[], index: number) {
  const previous = track[index - 1]
  const next = track[index + 1]
  const first = previous ?? track[index]
  const last = next ?? track[index]
  const elapsedSeconds = (last.timestamp - first.timestamp) / 1000
  return elapsedSeconds > 0 ? distanceMeters(first, last) / elapsedSeconds : 0
}

async function matchRoadChunk(points: TrackPoint[]) {
  const coordinates = points
    .map((point) => `${point.lng.toFixed(6)},${point.lat.toFixed(6)}`)
    .join(';')
  const radiuses = points
    .map((point) => String(Math.round(Math.min(35, Math.max(8, point.accuracy)))))
    .join(';')
  const response = await fetch(
    `${ROAD_ROUTER_API}/match/v1/driving/${coordinates}?overview=false&gaps=split&tidy=true&radiuses=${radiuses}`,
  )
  if (!response.ok) return points.map(() => null)
  const result = await response.json() as {
    code?: string
    tracepoints?: Array<{ location?: [number, number] } | null>
  }
  if (result.code !== 'Ok' || !Array.isArray(result.tracepoints)) {
    return points.map(() => null)
  }
  return points.map((_, index) => {
    const match = result.tracepoints?.[index]
    return match?.location
      ? { lat: match.location[1], lng: match.location[0] }
      : null
  })
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
  const [roadSnappedPoint, setRoadSnappedPoint] = useState<RoadLocation | null>(null)
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
  const [routeCodeInput, setRouteCodeInput] = useState('')
  const [shareMessage, setShareMessage] = useState('')
  const [isSharingRoute, setIsSharingRoute] = useState(false)
  const [isImportingRoute, setIsImportingRoute] = useState(false)
  const [focus, setFocus] = useState<{ lat: number; lng: number; zoom?: number } | null>(
    null,
  )
  const [showProjectMenu, setShowProjectMenu] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isUpdatingApp, setIsUpdatingApp] = useState(false)
  const [isAligningRoute, setIsAligningRoute] = useState(false)
  const [roadAlignMessage, setRoadAlignMessage] = useState('')
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const mapRef = useRef<LeafletMap | null>(null)
  const idleWatchId = useRef<number | null>(null)
  const isTrackingRef = useRef(false)
  const recordGpsPointRef = useRef<
    ((rawPoint: TrackPoint, speed: number | null) => void) | null
  >(null)
  const nativeWatchId = useRef<string | null>(null)
  const lastZoneToggle = useRef<{ id: string; at: number } | null>(null)
  const routeShareRef = useRef<HTMLElement | null>(null)
  const gpsSamples = useRef<TrackPoint[]>([])
  const followUserRef = useRef(true)
  const pullStart = useRef<{ x: number; y: number } | null>(null)
  const pullDistanceRef = useRef(0)
  const lastRawPointRef = useRef<TrackPoint | null>(null)
  const lastRoadSnapAt = useRef(0)
  const roadSnapAbort = useRef<AbortController | null>(null)

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
        const colorsBySource = new Map(
          collection.features.map((ward) => [
            `Official GBA Ward ${ward.properties.ward_id}`,
            TERRITORY_COLORS[ward.properties.color_index % TERRITORY_COLORS.length],
          ]),
        )
        setProjects((current) =>
          current.map((project) => {
            let changed = false
            const zones = project.zones.map((zone) => {
              const color = zone.sourceLabel
                ? colorsBySource.get(zone.sourceLabel)
                : undefined
              if (!color || color === zone.color) return zone
              changed = true
              return { ...zone, color }
            })
            return changed ? { ...project, zones } : project
          }),
        )
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
    isTrackingRef.current = isTracking
  }, [isTracking])

  useEffect(() => {
    const timer = window.setTimeout(() => mapRef.current?.invalidateSize(), 260)
    return () => window.clearTimeout(timer)
  }, [isSidebarCollapsed])

  useEffect(() => {
    if (Capacitor.isNativePlatform() || !navigator.geolocation) return

    idleWatchId.current = navigator.geolocation.watchPosition(
      ({ coords, timestamp }) => {
        setGpsError('')
        const point: TrackPoint = {
          lat: coords.latitude,
          lng: coords.longitude,
          accuracy: coords.accuracy,
          timestamp,
        }
        if (isTrackingRef.current) {
          recordGpsPointRef.current?.(point, coords.speed)
          return
        }
        lastRawPointRef.current = point
        setRoadSnappedPoint(null)
        setLivePoint(point)
        setGpsAccuracy(coords.accuracy)
        setLiveSpeed(coords.speed)
        if (coords.accuracy <= 60 && followUserRef.current && mapRef.current) {
          mapRef.current.setView(
            [point.lat, point.lng],
            Math.max(mapRef.current.getZoom(), 16),
            { animate: true },
          )
        }
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setGpsError('Allow precise location to show your live position.')
          isTrackingRef.current = false
          setIsTracking(false)
        } else if (isTrackingRef.current) {
          setGpsError(error.message || 'Waiting for the next GPS update.')
        }
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 30000 },
    )

    return () => {
      if (idleWatchId.current !== null) {
        navigator.geolocation.clearWatch(idleWatchId.current)
        idleWatchId.current = null
      }
    }
  }, [])

  useEffect(() => {
    navigator.storage?.persist?.().catch(() => {
      // Browser storage still works when durable-storage permission is unavailable.
    })
  }, [])

  useEffect(() => {
    return () => {
      if (nativeWatchId.current !== null) {
        void NativeBackgroundGeolocation.removeWatcher({ id: nativeWatchId.current })
      }
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
    () => trackDistance(activeProject.track),
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

  const toggleZoneVisibility = (
    zoneId: string,
    forceVisible?: boolean,
    eventTimeStamp?: number,
  ) => {
    if (forceVisible === undefined && eventTimeStamp !== undefined) {
      if (
        lastZoneToggle.current?.id === zoneId &&
        eventTimeStamp - lastZoneToggle.current.at < 350
      ) {
        return
      }
      lastZoneToggle.current = { id: zoneId, at: eventTimeStamp }
    }
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
      // Territory-map clicks select a boundary. Forcing it visible prevents a
      // double-click from immediately toggling the same boundary off again.
      toggleZoneVisibility(existing.id, true)
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
          color:
            TERRITORY_COLORS[ward.properties.color_index % TERRITORY_COLORS.length],
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

  const updateApp = async () => {
    if (isTracking || isUpdatingApp) return
    setIsUpdatingApp(true)
    setGpsError('')
    try {
      const response = await fetch(window.location.href, { cache: 'no-store' })
      if (!response.ok) throw new Error('The hosted app is unavailable.')
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations()
        await Promise.all(registrations.map((registration) => registration.update()))
      }
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(
          keys
            .filter((key) => key.startsWith('coverly-shell-'))
            .map((key) => caches.delete(key)),
        )
      }
      window.location.reload()
    } catch {
      setIsUpdatingApp(false)
      setGpsError('Could not update. Check your internet connection and try again.')
    }
  }

  const recordGpsPoint = (rawPoint: TrackPoint, speed: number | null) => {
    const previousRaw = lastRawPointRef.current
    const elapsedSeconds = previousRaw
      ? (rawPoint.timestamp - previousRaw.timestamp) / 1000
      : 0
    const measuredSpeed =
      speed ??
      (previousRaw && elapsedSeconds > 0
        ? distanceMeters(previousRaw, rawPoint) / elapsedSeconds
        : 0)
    lastRawPointRef.current = rawPoint
    setLivePoint(rawPoint)
    setGpsAccuracy(rawPoint.accuracy)
    setLiveSpeed(measuredSpeed)

    const shouldSnapToRoad =
      measuredSpeed >= ROAD_SNAP_MIN_SPEED && rawPoint.accuracy <= 35
    if (!shouldSnapToRoad) {
      roadSnapAbort.current?.abort()
      setRoadSnappedPoint(null)
    } else if (rawPoint.timestamp - lastRoadSnapAt.current >= ROAD_SNAP_INTERVAL) {
      lastRoadSnapAt.current = rawPoint.timestamp
      roadSnapAbort.current?.abort()
      const controller = new AbortController()
      const projectId = activeId
      roadSnapAbort.current = controller
      void nearestRoad(rawPoint, controller.signal)
        .then((match) => {
          if (
            !isTrackingRef.current ||
            !match ||
            match.distance > ROAD_SNAP_MAX_DISTANCE
          ) {
            setRoadSnappedPoint(null)
            return
          }
          setRoadSnappedPoint(match)
          setProjects((current) =>
            current.map((project) =>
              project.id === projectId
                ? {
                    ...project,
                    track: project.track.map((point) =>
                      point.timestamp === rawPoint.timestamp
                        ? { ...point, roadLat: match.lat, roadLng: match.lng }
                        : point,
                    ),
                  }
                : project,
            ),
          )
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === 'AbortError') return
          setRoadSnappedPoint(null)
        })
    }

    if (rawPoint.accuracy > 60) return

    if (followUserRef.current && mapRef.current) {
      mapRef.current.setView(
        [rawPoint.lat, rawPoint.lng],
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
          rawPoint.timestamp - previous.timestamp < 4000
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
  }
  useEffect(() => {
    recordGpsPointRef.current = recordGpsPoint
  })

  const stopTracking = () => {
    isTrackingRef.current = false
    roadSnapAbort.current?.abort()
    roadSnapAbort.current = null
    setRoadSnappedPoint(null)
    if (nativeWatchId.current !== null) {
      void NativeBackgroundGeolocation.removeWatcher({ id: nativeWatchId.current })
      nativeWatchId.current = null
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

  const alignExistingRoute = async () => {
    if (isAligningRoute || activeProject.track.length < 2) return
    const projectId = activeId
    const source = activeProject.track
    const aligned = source.map((point) => ({ ...point }))
    let alignedCount = 0
    setIsAligningRoute(true)
    setRoadAlignMessage('Matching moving sections to nearby roads…')
    try {
      for (let start = 0; start < source.length; start += 10) {
        const chunk = source.slice(start, start + 10)
        if (chunk.length < 2) continue
        const matches = await matchRoadChunk(chunk)
        matches.forEach((match, localIndex) => {
          if (!match) return
          const index = start + localIndex
          const point = source[index]
          const snapDistance = distanceMeters(point, match)
          if (
            inferredTrackSpeed(source, index) < ROAD_SNAP_MIN_SPEED ||
            point.accuracy > 35 ||
            snapDistance > ROAD_SNAP_MAX_DISTANCE
          ) {
            return
          }
          aligned[index] = {
            ...aligned[index],
            roadLat: match.lat,
            roadLng: match.lng,
          }
          alignedCount += 1
        })
      }
      setProjects((current) =>
        current.map((project) =>
          project.id === projectId
            ? { ...project, track: aligned, updatedAt: Date.now() }
            : project,
        ),
      )
      setRoadAlignMessage(
        alignedCount
          ? `${alignedCount} moving points aligned. Original GPS is preserved.`
          : 'No safe nearby road matches were found. Original GPS is unchanged.',
      )
    } catch {
      setRoadAlignMessage('Road alignment is unavailable. Original GPS is unchanged.')
    } finally {
      setIsAligningRoute(false)
    }
  }

  const showRawGpsRoute = () => {
    updateProject((project) => ({
      ...project,
      track: project.track.map(({ lat, lng, accuracy, timestamp }) => ({
        lat,
        lng,
        accuracy,
        timestamp,
      })),
    }))
    setRoadAlignMessage('Showing the original GPS route.')
  }

  const markCurrentPlace = () => {
    const point = livePoint ?? activeProject.track[activeProject.track.length - 1]
    if (!point) {
      setGpsError('Start tracking or locate yourself before marking a place.')
      return
    }
    const ward = officialWards
      ? wardAtPoint(officialWards, point.lat, point.lng)
      : undefined
    const markerNumber = activeProject.markers.length + 1
    updateProject((project) => ({
      ...project,
      markers: [
        ...project.markers,
        {
          id: uid(),
          lat: point.lat,
          lng: point.lng,
          label: ward
            ? `Important place · ${ward.properties.ward_name}`
            : `Important place ${markerNumber}`,
          createdAt: Date.now(),
        },
      ],
    }))
    setFocus({ lat: point.lat, lng: point.lng, zoom: 17 })
  }

  const shareRouteHistory = async () => {
    if (!activeProject.track.length) {
      setShareMessage('Record at least one GPS point before creating a code.')
      return
    }
    setIsSharingRoute(true)
    setShareMessage('')
    try {
      const response = await fetch(`${ROUTE_SHARE_API}/routes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: 1,
          project: {
            name: activeProject.name,
            zones: activeProject.zones,
            track: activeProject.track,
            markers: activeProject.markers,
            createdAt: activeProject.createdAt,
            updatedAt: activeProject.updatedAt,
          },
        }),
      })
      const result = await response.json() as {
        code?: string
        expiresAt?: number
        error?: string
      }
      if (!response.ok || !result.code || !result.expiresAt) {
        throw new Error(result.error || 'Could not create a route code.')
      }
      updateProject((project) => ({
        ...project,
        shareCode: result.code,
        shareExpiresAt: result.expiresAt,
      }))
      setShareMessage('Code ready. It contains a seven-day snapshot of this route.')
    } catch (error) {
      setShareMessage(
        error instanceof Error ? error.message : 'Could not create a route code.',
      )
    } finally {
      setIsSharingRoute(false)
    }
  }

  const importRouteHistory = async () => {
    const code = routeCodeInput.replace(/\D/g, '').slice(0, 6)
    if (code.length !== 6) {
      setShareMessage('Enter the complete six-digit route code.')
      return
    }
    setIsImportingRoute(true)
    setShareMessage('')
    try {
      const response = await fetch(`${ROUTE_SHARE_API}/routes/${code}`)
      const result = await response.json() as {
        payload?: { version?: number; project?: Partial<Project> }
        expiresAt?: number
        error?: string
      }
      const shared = result.payload?.project
      if (
        !response.ok ||
        result.payload?.version !== 1 ||
        !shared ||
        !Array.isArray(shared.track) ||
        !Array.isArray(shared.zones)
      ) {
        throw new Error(result.error || 'This route code is invalid or expired.')
      }

      const track = shared.track.filter(
        (point): point is TrackPoint =>
          typeof point?.lat === 'number' &&
          Number.isFinite(point.lat) &&
          typeof point.lng === 'number' &&
          Number.isFinite(point.lng) &&
          typeof point.accuracy === 'number' &&
          typeof point.timestamp === 'number',
      )
      if (!track.length) throw new Error('The shared route contains no GPS points.')
      const imported: Project = {
        id: uid(),
        name: `${String(shared.name || 'Shared route')} · Continued`,
        zones: shared.zones as Zone[],
        track,
        markers: Array.isArray(shared.markers)
          ? shared.markers as JourneyMarker[]
          : [],
        shareCode: code,
        shareExpiresAt: result.expiresAt,
        createdAt:
          typeof shared.createdAt === 'number'
            ? shared.createdAt
            : track[0].timestamp,
        updatedAt:
          typeof shared.updatedAt === 'number'
            ? shared.updatedAt
            : track[track.length - 1].timestamp,
      }
      const lastPoint = track[track.length - 1]
      setProjects((current) => [...current, imported])
      changeActiveProject(imported.id)
      setLivePoint(lastPoint)
      setFocus({ lat: lastPoint.lat, lng: lastPoint.lng, zoom: 16 })
      setRouteCodeInput('')
      setShareMessage('Route restored. Press Continue this route to extend it.')
      setTab('history')
    } catch (error) {
      setShareMessage(
        error instanceof Error ? error.message : 'Could not restore this route.',
      )
    } finally {
      setIsImportingRoute(false)
    }
  }

  const startTracking = async () => {
    const isNative = Capacitor.isNativePlatform()
    if (!isNative && !navigator.geolocation) {
      setGpsError('GPS is not supported by this browser.')
      return
    }
    setGpsError('')
    isTrackingRef.current = true
    setIsTracking(true)
    setFollowUser(true)
    setIsTerritoryMode(false)
    setGpsAccuracy(null)
    gpsSamples.current = []

    if (isNative) {
      try {
        if (Capacitor.getPlatform() === 'android') {
          const notificationPermission = await LocalNotifications.checkPermissions()
          if (notificationPermission.display !== 'granted') {
            const requested = await LocalNotifications.requestPermissions()
            if (requested.display !== 'granted') {
              throw new Error('Notification permission is required for background tracking.')
            }
          }
        }
        nativeWatchId.current = await NativeBackgroundGeolocation.addWatcher(
          {
            backgroundTitle: 'Coverly is tracking your route',
            backgroundMessage: 'Background GPS is active. Tap to return to the map.',
            requestPermissions: true,
            stale: false,
            distanceFilter: 2,
          },
          (location, error) => {
            if (error) {
              isTrackingRef.current = false
              setGpsError(
                error.code === 'NOT_AUTHORIZED'
                  ? 'Allow precise location in Android settings to track your route.'
                  : error.message || 'Background GPS tracking stopped.',
              )
              setIsTracking(false)
              return
            }
            if (!location) return
            recordGpsPoint(
              {
                lat: location.latitude,
                lng: location.longitude,
                accuracy: location.accuracy,
                timestamp: location.time ?? Date.now(),
              },
              location.speed,
            )
          },
        )
      } catch (error) {
        isTrackingRef.current = false
        setIsTracking(false)
        setGpsError(
          error instanceof Error ? error.message : 'Could not start Android background GPS.',
        )
      }
      return
    }

    if (livePoint) recordGpsPoint(livePoint, liveSpeed)
  }

  const changeActiveProject = (projectId: string) => {
    setActiveId(projectId)
    setVisibleZoneIds(new Set())
    setIsTerritoryMode(false)
    setRoadAlignMessage('')
    setRoadSnappedPoint(null)
  }

  const createProject = () => {
    stopTracking()
    const project = newProject()
    setProjects((current) => [...current, project])
    changeActiveProject(project.id)
    setShowProjectMenu(false)
    setTab('areas')
  }

  const selectHistory = (projectId: string) => {
    if (projectId === activeId) return
    stopTracking()
    const project = projects.find((item) => item.id === projectId)
    changeActiveProject(projectId)
    setShareMessage('')
    setRouteCodeInput('')
    const lastPoint = project
      ? project.track[project.track.length - 1]
      : undefined
    if (lastPoint) setFocus({ lat: lastPoint.lat, lng: lastPoint.lng, zoom: 14 })
  }

  const startNewHistory = () => {
    stopTracking()
    const fresh = newProject()
    const project: Project = {
      ...fresh,
      name: `History ${projects.length + 1} · ${new Date(fresh.createdAt).toLocaleDateString([], {
        day: 'numeric',
        month: 'short',
      })}`,
      zones: activeProject.zones.map((zone) => ({ ...zone })),
    }
    setProjects((current) => [...current, project])
    changeActiveProject(project.id)
    setShareMessage('')
    setRouteCodeInput('')
    setTab('map')
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
    point.roadLat ?? point.lat,
    point.roadLng ?? point.lng,
  ])
  const hasRoadAlignment = activeProject.track.some(
    (point) => point.roadLat !== undefined && point.roadLng !== undefined,
  )
  const currentPoint = livePoint ?? activeProject.track[activeProject.track.length - 1]
  const displayedCurrentPoint =
    isTracking && currentPoint && roadSnappedPoint
      ? {
          ...currentPoint,
          lat: roadSnappedPoint.lat,
          lng: roadSnappedPoint.lng,
        }
      : currentPoint
  const currentWard = useMemo(
    () =>
      isTracking && livePoint && livePoint.accuracy <= 60 && officialWards
        ? wardAtPoint(officialWards, livePoint.lat, livePoint.lng)
        : undefined,
    [isTracking, livePoint, officialWards],
  )
  const currentWardColor = currentWard
    ? TERRITORY_COLORS[currentWard.properties.color_index % TERRITORY_COLORS.length]
    : '#0f766e'
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
        <div className="topbar-actions">
          <button
            type="button"
            className="app-update-button"
            disabled={isUpdatingApp || isTracking}
            onClick={() => void updateApp()}
            title={isTracking ? 'Pause tracking before updating' : 'Update app'}
            aria-label={isTracking ? 'Pause tracking before updating' : 'Update app'}
          >
            <RefreshCw size={15} className={isUpdatingApp ? 'spinning' : ''} />
            <span>{isUpdatingApp ? 'Updating…' : 'Update'}</span>
          </button>
          <div className={`live-badge ${isTracking || (livePoint && livePoint.accuracy <= 60) ? 'active' : ''}`}>
            <span />
            {isTracking ? 'Route recording' : livePoint ? 'Location live' : 'GPS ready'}
          </div>
        </div>
      </header>

      <section className={`workspace ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        {tab !== 'map' && (
          <button
            type="button"
            className="panel-dismiss-layer"
            onClick={() => setTab('map')}
            aria-label="Close open panel"
          />
        )}
        <aside className={`side-panel ${tab === 'map' ? 'map-overview-panel' : ''}`}>
          <button
            type="button"
            className="sidebar-toggle sidebar-close"
            onClick={() => setIsSidebarCollapsed(true)}
            aria-label="Close sidebar"
            title="Close sidebar"
          >
            <ChevronLeft size={18} />
          </button>
          <nav className="panel-tabs">
            <button className={tab === 'map' ? 'active' : ''} onClick={() => setTab('map')}>
              <MapIcon size={18} /> Map
            </button>
            <button className={tab === 'areas' ? 'active' : ''} onClick={() => setTab(tab === 'areas' ? 'map' : 'areas')}>
              <Layers3 size={18} /> Areas
            </button>
            <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab(tab === 'history' ? 'map' : 'history')}>
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
                <section className="history-switcher">
                  <div className="history-switcher-title">
                    <strong>Choose journey</strong>
                    <span>{projects.length} saved</span>
                  </div>
                  <select
                    value={activeId}
                    onChange={(event) => selectHistory(event.target.value)}
                    aria-label="Choose saved journey history"
                  >
                    {projects.map((project, index) => (
                      <option value={project.id} key={project.id}>
                        History {index + 1} · {formatDistance(trackDistance(project.track))} · {project.markers.length} flags
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={startNewHistory}>
                    <Route size={16} />
                    {activeProject.track.length
                      ? 'End current & start new history'
                      : 'Start new history'}
                  </button>
                  <small>Each journey keeps its own path, flags and sharing code.</small>
                </section>
                <div className="history-summary">
                  <div className="history-icon"><Activity size={24} /></div>
                  <div>
                    <strong>{activeProject.track.length.toLocaleString()}</strong>
                    <span>GPS points recorded</span>
                  </div>
                </div>
                {activeProject.track.length > 0 && (
                  <div className="history-quick-actions">
                    <button
                      type="button"
                      className="continue-route-button"
                      onClick={() => {
                        setTab('map')
                        if (!isTracking) void startTracking()
                      }}
                    >
                      <Play size={17} fill="currentColor" />
                      {isTracking ? 'Return to tracking' : 'Continue this route'}
                    </button>
                    <button
                      type="button"
                      className="share-route-jump"
                      onClick={() =>
                        routeShareRef.current?.scrollIntoView({
                          behavior: 'smooth',
                          block: 'start',
                        })
                      }
                    >
                      <Route size={16} /> 6-digit share
                    </button>
                  </div>
                )}
                {activeProject.track.length > 1 && (
                  <section className="road-align-card">
                    <div>
                      <strong>Road-aligned display</strong>
                      <small>Moving sections only · original GPS stays saved</small>
                    </div>
                    <button
                      type="button"
                      disabled={isAligningRoute}
                      onClick={() =>
                        hasRoadAlignment
                          ? showRawGpsRoute()
                          : void alignExistingRoute()
                      }
                    >
                      <RefreshCw
                        size={15}
                        className={isAligningRoute ? 'spinning' : ''}
                      />
                      {isAligningRoute
                        ? 'Aligning…'
                        : hasRoadAlignment
                          ? 'Show raw GPS route'
                          : 'Align road sections'}
                    </button>
                    {roadAlignMessage && <p>{roadAlignMessage}</p>}
                  </section>
                )}
                <div className="history-list">
                  <div><span>Route distance</span><strong>{formatDistance(routeDistance)}</strong></div>
                  <div><span>Tracking duration</span><strong>{formatDuration(sessionDuration)}</strong></div>
                  <div><span>Important places</span><strong>{activeProject.markers.length}</strong></div>
                  <div><span>Started</span><strong>{activeProject.track.length ? new Date(activeProject.track[0].timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Not started'}</strong></div>
                  <div><span>Last update</span><strong>{new Date(activeProject.updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</strong></div>
                </div>
                {activeProject.markers.length > 0 && (
                  <section className="marker-history">
                    <div className="marker-history-title">
                      <span><Flag size={16} /></span>
                      <strong>Marked places</strong>
                    </div>
                    {activeProject.markers.map((marker, index) => (
                      <div className="marker-history-item" key={marker.id}>
                        <span>{index + 1}</span>
                        <input
                          value={marker.label}
                          aria-label={`Name for marked place ${index + 1}`}
                          onChange={(event) =>
                            updateProject((project) => ({
                              ...project,
                              markers: project.markers.map((item) =>
                                item.id === marker.id
                                  ? { ...item, label: event.target.value }
                                  : item,
                              ),
                            }))
                          }
                        />
                        <button
                          type="button"
                          className="marker-locate-button"
                          aria-label={`Show marked place ${index + 1}`}
                          onClick={() => {
                            setTab('map')
                            setFocus({ lat: marker.lat, lng: marker.lng, zoom: 17 })
                          }}
                        >
                          <LocateFixed size={15} />
                        </button>
                        <button
                          type="button"
                          className="marker-unmark-button"
                          aria-label={`Unmark place ${index + 1}`}
                          onClick={() =>
                            updateProject((project) => ({
                              ...project,
                              markers: project.markers.filter(
                                (item) => item.id !== marker.id,
                              ),
                            }))
                          }
                        >
                          <Trash2 size={14} /> Unmark
                        </button>
                      </div>
                    ))}
                  </section>
                )}
                <section className="route-share-card" ref={routeShareRef}>
                  <div className="route-share-title">
                    <span><Route size={17} /></span>
                    <div>
                      <strong>Continue on another device</strong>
                      <small>Transfer this route with a six-digit code</small>
                    </div>
                  </div>
                  {activeProject.shareCode && activeProject.shareExpiresAt && (
                    <div className="active-route-code">
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(activeProject.shareCode!)
                          setShareMessage('Route code copied.')
                        }}
                        aria-label="Copy route code"
                      >
                        {activeProject.shareCode}
                      </button>
                      <small>
                        Expires {new Date(activeProject.shareExpiresAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                      </small>
                    </div>
                  )}
                  <button
                    type="button"
                    className="create-route-code"
                    disabled={isSharingRoute || activeProject.track.length === 0}
                    onClick={() => void shareRouteHistory()}
                  >
                    <RefreshCw size={15} className={isSharingRoute ? 'spinning' : ''} />
                    {isSharingRoute ? 'Creating code…' : 'Create new route code'}
                  </button>
                  <form
                    className="route-code-form"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void importRouteHistory()
                    }}
                  >
                    <input
                      value={routeCodeInput}
                      onChange={(event) =>
                        setRouteCodeInput(
                          event.target.value.replace(/\D/g, '').slice(0, 6),
                        )
                      }
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      placeholder="Enter 6-digit code"
                      aria-label="Six-digit route code"
                    />
                    <button
                      type="submit"
                      disabled={isImportingRoute || routeCodeInput.length !== 6}
                    >
                      {isImportingRoute ? 'Opening…' : 'Open route'}
                    </button>
                  </form>
                  {shareMessage && <p className="route-share-message">{shareMessage}</p>}
                  <small className="route-share-warning">
                    Anyone with the code can open this location history for seven days.
                  </small>
                </section>
                {activeProject.track.length > 0 && (
                  <button
                    type="button"
                    className="danger-button"
                    onClick={resetRoute}
                  >
                    <Trash2 size={17} /> Clear route history
                  </button>
                )}
                <p className="privacy-note">Locations remain on this device unless you create a temporary route code.</p>
              </>
            )}
          </div>
        </aside>
        {isSidebarCollapsed && (
          <button
            type="button"
            className="sidebar-toggle sidebar-open"
            onClick={() => setIsSidebarCollapsed(false)}
            aria-label="Open sidebar"
            title="Open sidebar"
          >
            <ChevronRight size={18} />
          </button>
        )}

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
            {!isTracking && officialWards && (
              <GeoJSON
                key={`gba-wards-2025-${isTerritoryMode ? 'selecting' : 'visible'}`}
                data={officialWards}
                style={() => {
                  return {
                    color: isTerritoryMode ? '#64748b' : '#94a3b8',
                    weight: isTerritoryMode ? 1.15 : 0.8,
                    fillColor: '#f8fafc',
                    fillOpacity: isTerritoryMode ? 0.035 : 0.018,
                  }
                }}
                onEachFeature={(feature, layer) => {
                  const ward = feature as WardFeature
                  layer.bindTooltip(
                    `Ward ${ward.properties.ward_id} · ${ward.properties.ward_name}`,
                    { sticky: true, direction: 'top' },
                  )
                  if (isTerritoryMode) {
                    layer.on('click', (event) =>
                      addOfficialWard(
                        ward,
                        event.latlng.lat,
                        event.latlng.lng,
                      ),
                    )
                  }
                }}
              />
            )}
            {isTracking && currentWard && (
              <GeoJSON
                key={`live-ward-${currentWard.properties.ward_id}`}
                data={currentWard.geometry}
                interactive={false}
                style={{
                  color: currentWardColor,
                  weight: 4,
                  fillColor: currentWardColor,
                  fillOpacity: 0.24,
                }}
              />
            )}
            {activeProject.zones.map((zone, index) => (
              !isTracking &&
              visibleZoneIds.has(zone.id) &&
              zone.geometry && (
                <GeoJSON
                  key={zone.id}
                  data={zone.geometry}
                  style={{
                    color: getZoneColor(zone, index),
                    weight: 4,
                    fillColor: getZoneColor(zone, index),
                    fillOpacity: 0.32,
                  }}
                  eventHandlers={{
                    click: (event) =>
                      toggleZoneVisibility(
                        zone.id,
                        undefined,
                        event.originalEvent.timeStamp,
                      ),
                  }}
                />
              )
            ))}
            {activeProject.zones.map((zone, index) => (
              !isTracking && visibleZoneIds.has(zone.id) && (
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
            {activeProject.markers.map((marker, index) => (
              <Marker
                key={marker.id}
                position={[marker.lat, marker.lng]}
                icon={IMPORTANT_PLACE_ICON}
              >
                <Tooltip direction="top" offset={[0, -8]}>
                  {marker.label}
                </Tooltip>
                <Popup className="place-popup" minWidth={210}>
                  <div className="marker-popup">
                    <span><Flag size={16} fill="currentColor" /></span>
                    <div>
                      <strong>{marker.label}</strong>
                      <small>Marked {new Date(marker.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</small>
                    </div>
                    <button
                      type="button"
                      aria-label={`Delete marker ${index + 1}`}
                      title="Unmark this place"
                      onClick={() =>
                        updateProject((project) => ({
                          ...project,
                          markers: project.markers.filter((item) => item.id !== marker.id),
                        }))
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </Popup>
              </Marker>
            ))}
            {currentPoint && (
              <>
                <Circle
                  center={[currentPoint.lat, currentPoint.lng]}
                  radius={Math.min(200, Math.max(8, currentPoint.accuracy))}
                  pathOptions={{ color: '#2385f5', weight: 1, fillColor: '#2385f5', fillOpacity: 0.1 }}
                />
                <CircleMarker
                  center={[
                    displayedCurrentPoint?.lat ?? currentPoint.lat,
                    displayedCurrentPoint?.lng ?? currentPoint.lng,
                  ]}
                  radius={roadSnappedPoint && isTracking ? 6 : 5}
                  pathOptions={{
                    color: '#fff',
                    weight: 2,
                    fillColor: roadSnappedPoint && isTracking ? '#16a34a' : '#2385f5',
                    fillOpacity: 1,
                  }}
                >
                  <Tooltip direction="top" offset={[0, -7]}>
                    {roadSnappedPoint && isTracking
                      ? `Road aligned · ${Math.round(roadSnappedPoint.distance)} m from raw GPS`
                      : 'Raw GPS position'}
                  </Tooltip>
                </CircleMarker>
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
                  onClick={(event) => {
                    toggleZoneVisibility(zone.id, undefined, event.timeStamp)
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

          {isTracking && currentWard && (
            <div className="live-territory-chip">
              <MapPinned size={16} />
              <span>
                <small>Current territory</small>
                <strong>Ward {currentWard.properties.ward_id} · {currentWard.properties.ward_name}</strong>
              </span>
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
            {isTracking && currentPoint && (
              <button
                type="button"
                className="mark-place-button"
                onClick={markCurrentPlace}
                aria-label="Mark this important place"
                title="Mark important place"
              >
                <Flag size={18} fill="currentColor" /> Mark place
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
                <strong>
                  {isTracking
                    ? gpsQuality
                    : livePoint
                      ? 'Live location ready'
                      : 'Ready to navigate'}
                </strong>
                <small>
                  {isTracking
                    ? gpsAccuracy && gpsAccuracy > 60
                      ? 'Move outdoors and enable Precise Location'
                      : 'Following your position · route saves automatically'
                    : livePoint
                      ? 'Position updates live · Start tracking to save the route'
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
        <button className={tab === 'areas' ? 'active' : ''} onClick={() => setTab(tab === 'areas' ? 'map' : 'areas')}><Layers3 size={20} />Areas</button>
        <button
          className={`mobile-track ${isTracking ? 'active' : ''}`}
          onClick={() => {
            setTab('map')
            if (isTracking) stopTracking()
            else void startTracking()
          }}
        >
          {isTracking ? <Square size={19} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
        </button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab(tab === 'history' ? 'map' : 'history')}><History size={20} />History</button>
        <button onClick={() => { setTab('map'); locateMe() }}><LocateFixed size={20} />Locate</button>
      </nav>
    </main>
  )
}

export default App
