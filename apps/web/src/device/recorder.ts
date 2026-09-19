import type { LiveSample } from "./fit100s.ts";

/**
 * Enregistreur de seance. Il fusionne trois sources a 1 Hz :
 *   - la position GPS du telephone (Geolocation API)
 *   - la frequence cardiaque et la cadence de la montre (Bluetooth)
 *   - l'horloge, pour tenir le chrono meme sans capteur
 *
 * La trace est sauvegardee dans le stockage local a chaque seconde : si
 * l'ecran se verrouille ou si l'onglet est recharge en pleine sortie, la
 * seance est reprise la ou elle s'est arretee plutot que perdue.
 */

export interface RecordedPoint {
  t: number;
  lat?: number;
  lon?: number;
  alt?: number;
  distance?: number;
  speed?: number;
  hr?: number;
  cadence?: number;
}

export interface RecordedLap {
  index: number;
  startTime: number;
  duration: number;
  distance: number;
  avgHr?: number;
}

export interface RecorderState {
  status: "arret" | "enregistrement" | "pause";
  startedAt: number;
  /** Duree ecoulee hors pauses, en secondes. */
  elapsed: number;
  distance: number;
  points: RecordedPoint[];
  laps: RecordedLap[];
  sport: string;
  /** Derniere position GPS connue, pour le calcul d'incrementation. */
  lastFix?: { lat: number; lon: number; alt?: number; t: number };
}

const STORAGE_KEY = "montre.recorder.v1";
/** Distance d'un tour automatique, en metres. */
const AUTO_LAP_DISTANCE = 1000;
/** Precision GPS au-dela de laquelle un point est ignore, en metres. */
const MAX_ACCURACY = 35;

const EARTH_RADIUS = 6_371_000;

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)));
}

function emptyState(sport = "course"): RecorderState {
  return {
    status: "arret",
    startedAt: 0,
    elapsed: 0,
    distance: 0,
    points: [],
    laps: [],
    sport,
  };
}

export class SessionRecorder {
  private state: RecorderState = emptyState();
  private sample: LiveSample = { timestamp: 0 };
  private watchId: number | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(state: RecorderState) => void>();
  /** Distance parcourue depuis le debut du tour en cours. */
  private lapStartDistance = 0;
  private lapStartTime = 0;
  private lapHrSamples: number[] = [];
  /**
   * Horodatage du dernier point ajoute. Le chrono se calcule a partir de
   * l'horloge et non du nombre de battements : les navigateurs ralentissent ou
   * suspendent les minuteries quand l'onglet passe en arriere-plan ou que
   * l'ecran se verrouille, ce qui ferait perdre des minutes entieres a une
   * sortie enregistree telephone en poche.
   */
  private lastTickAt = 0;

  getState(): RecorderState {
    return this.state;
  }

  subscribe(listener: (state: RecorderState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.state);
  }

  /** Alimente l'enregistreur avec la derniere mesure Bluetooth recue. */
  updateSample(sample: LiveSample): void {
    this.sample = sample;
  }

  /** Reprend une seance interrompue, si le stockage local en contient une. */
  restore(): RecorderState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const saved = JSON.parse(raw) as RecorderState;
      if (!saved.points || saved.points.length === 0) return null;

      // Une seance reprise repart en pause : l'athlete decide de continuer.
      this.state = { ...saved, status: "pause" };
      this.lapStartDistance =
        this.state.laps.reduce((sum, lap) => sum + lap.distance, 0) ?? 0;
      this.lapStartTime =
        this.state.laps.length > 0
          ? this.state.laps[this.state.laps.length - 1]!.startTime +
            this.state.laps[this.state.laps.length - 1]!.duration * 1000
          : this.state.startedAt;
      this.notify();
      return this.state;
    } catch {
      return null;
    }
  }

  async start(sport: string): Promise<void> {
    if (this.state.status === "enregistrement") return;

    if (this.state.status === "arret") {
      this.state = { ...emptyState(sport), status: "enregistrement", startedAt: Date.now() };
      this.lapStartDistance = 0;
      this.lapStartTime = this.state.startedAt;
      this.lapHrSamples = [];
    } else {
      this.state = { ...this.state, status: "enregistrement" };
    }

    await this.startGeolocation();
    this.startTicker();
    this.notify();
  }

  pause(): void {
    if (this.state.status !== "enregistrement") return;
    this.state = { ...this.state, status: "pause" };
    this.stopTicker();
    this.persist();
    this.notify();
  }

  /** Cloture la seance et retourne la trace enregistree. */
  stop(): RecorderState {
    this.stopTicker();
    this.stopGeolocation();
    this.closeLap();

    const finished: RecorderState = { ...this.state, status: "arret" };
    this.state = finished;
    this.persist();
    this.notify();
    return finished;
  }

  /** Efface la seance courante, apres enregistrement ou abandon. */
  reset(): void {
    this.stopTicker();
    this.stopGeolocation();
    this.state = emptyState(this.state.sport);
    this.lapStartDistance = 0;
    this.lapHrSamples = [];
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Stockage indisponible (navigation privee) : sans consequence ici.
    }
    this.notify();
  }

  /** Cloture manuelle d'un tour. */
  closeLap(): void {
    const distance = this.state.distance - this.lapStartDistance;
    if (distance <= 0 && this.state.points.length === 0) return;

    const now = this.state.points[this.state.points.length - 1]?.t ?? Date.now();
    const lap: RecordedLap = {
      index: this.state.laps.length + 1,
      startTime: this.lapStartTime,
      duration: Math.max(0, (now - this.lapStartTime) / 1000),
      distance,
      avgHr:
        this.lapHrSamples.length > 0
          ? Math.round(
              this.lapHrSamples.reduce((a, b) => a + b, 0) / this.lapHrSamples.length,
            )
          : undefined,
    };

    this.state = { ...this.state, laps: [...this.state.laps, lap] };
    this.lapStartDistance = this.state.distance;
    this.lapStartTime = now;
    this.lapHrSamples = [];
  }

  private startTicker(): void {
    if (this.ticker) return;
    this.lastTickAt = Date.now();
    // Un point par seconde, comme la montre elle-meme.
    this.ticker = setInterval(() => this.tick(), 1000);
    // Au retour au premier plan, le chrono se remet a jour immediatement
    // plutot qu'a la prochaine seconde.
    document.addEventListener("visibilitychange", this.handleVisibility);
  }

  private stopTicker(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.lastTickAt = 0;
    document.removeEventListener("visibilitychange", this.handleVisibility);
  }

  private handleVisibility = (): void => {
    if (!document.hidden) this.tick();
  };

  /** Ajoute le point de la seconde ecoulee a partir des sources disponibles. */
  private tick(): void {
    if (this.state.status !== "enregistrement") return;

    const now = Date.now();
    // Duree reellement ecoulee depuis le dernier point, pas une seconde supposee.
    const delta = this.lastTickAt > 0 ? (now - this.lastTickAt) / 1000 : 1;
    this.lastTickAt = now;

    const point: RecordedPoint = {
      t: now,
      lat: this.state.lastFix?.lat,
      lon: this.state.lastFix?.lon,
      alt: this.state.lastFix?.alt,
      distance: this.state.distance,
      // La vitesse de la montre prime sur celle deduite du GPS, plus bruitee.
      speed: this.sample.speed,
      hr: this.sample.hr,
      cadence: this.sample.cadence,
    };

    if (point.hr != null) this.lapHrSamples.push(point.hr);

    this.state = {
      ...this.state,
      elapsed: this.state.elapsed + delta,
      points: [...this.state.points, point],
    };

    // Tour automatique au kilometre.
    if (this.state.distance - this.lapStartDistance >= AUTO_LAP_DISTANCE) {
      this.closeLap();
    }

    this.persist();
    this.notify();
  }

  private async startGeolocation(): Promise<void> {
    if (this.watchId != null) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    this.watchId = navigator.geolocation.watchPosition(
      (position) => this.handlePosition(position),
      () => {
        // Refus ou echec de localisation : le chrono et le cardio continuent.
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10_000 },
    );
  }

  private stopGeolocation(): void {
    if (this.watchId != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(this.watchId);
    }
    this.watchId = null;
  }

  /**
   * Integre une position GPS. Les points imprecis sont ecartes : en ville, un
   * point a 100 m de precision ajoute des dizaines de metres de distance
   * fictive a chaque seconde.
   */
  private handlePosition(position: GeolocationPosition): void {
    if (this.state.status !== "enregistrement") return;
    if (position.coords.accuracy > MAX_ACCURACY) return;

    const fix = {
      lat: position.coords.latitude,
      lon: position.coords.longitude,
      alt: position.coords.altitude ?? undefined,
      t: position.timestamp,
    };

    const previous = this.state.lastFix;
    let distance = this.state.distance;

    if (previous) {
      const step = haversine(previous.lat, previous.lon, fix.lat, fix.lon);
      const dt = (fix.t - previous.t) / 1000;
      // Un deplacement a plus de 12 m/s en course est un saut de GPS.
      const plausible = dt > 0 && step / dt < 12;
      if (plausible && step > 1) distance += step;
    }

    this.state = { ...this.state, lastFix: fix, distance: Math.round(distance) };
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Quota depasse ou stockage refuse : l'enregistrement continue en memoire.
    }
  }
}

/**
 * Enregistreur unique de l'application.
 *
 * Il doit survivre au demontage de l'ecran Seance : on consulte volontiers son
 * plan ou une activite passee en pleine sortie, et l'enregistrement ne doit ni
 * s'arreter ni, pire, se dedoubler au retour. Une instance partagee garantit
 * qu'un seul chronometre alimente une seule trace.
 */
export const sessionRecorder = new SessionRecorder();

/** Allure instantanee lissee sur les dernieres secondes, en s/km. */
export function currentPace(points: RecordedPoint[], window = 30): number | null {
  if (points.length < 2) return null;
  const recent = points.slice(-window);
  const first = recent[0]!;
  const last = recent[recent.length - 1]!;
  const distance = (last.distance ?? 0) - (first.distance ?? 0);
  const duration = (last.t - first.t) / 1000;
  if (distance < 5 || duration <= 0) return null;
  return (duration / distance) * 1000;
}
