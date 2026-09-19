/**
 * Types du domaine, partages entre le serveur, le web et les parseurs.
 *
 * Toutes les unites sont SI sauf mention contraire :
 *  - distance en metres
 *  - duree en secondes
 *  - vitesse en m/s
 *  - allure en secondes par kilometre
 *  - altitude en metres
 */

export type Sport =
  | "course"
  | "trail"
  | "marche"
  | "velo"
  | "natation"
  | "cardio"
  | "renforcement"
  | "autre";

/** Un point enregistre par la montre (1 Hz en general sur la Fit 100 S). */
export interface TrackPoint {
  /** Horodatage absolu du point (ms epoch). */
  t: number;
  lat?: number;
  lon?: number;
  /** Altitude barometrique ou GPS, en metres. */
  alt?: number;
  /** Distance cumulee depuis le debut, en metres. */
  distance?: number;
  /** Vitesse instantanee en m/s. */
  speed?: number;
  /** Frequence cardiaque en battements par minute. */
  hr?: number;
  /** Cadence en pas/min (course) ou tours/min (velo). */
  cadence?: number;
  /** Puissance en watts, si le capteur la fournit. */
  power?: number;
  /** Temperature en degres Celsius. */
  temperature?: number;
}

export interface Lap {
  index: number;
  startTime: number;
  duration: number;
  distance: number;
  avgHr?: number;
  maxHr?: number;
  avgSpeed?: number;
  /** Denivele positif du tour, en metres. */
  elevationGain?: number;
}

/** Une activite normalisee, quelle que soit sa source (montre, Strava, import). */
export interface Activity {
  id: string;
  userId: string;
  sport: Sport;
  title: string;
  description?: string;
  /** Debut de l'activite (ms epoch). */
  startTime: number;
  /** Duree totale montre en marche, en secondes. */
  elapsedTime: number;
  /** Duree en mouvement (pauses retirees), en secondes. */
  movingTime: number;
  distance: number;
  elevationGain: number;
  elevationLoss: number;
  avgHr?: number;
  maxHr?: number;
  avgCadence?: number;
  avgPower?: number;
  calories?: number;
  /** Provenance de l'activite. */
  source: ActivitySource;
  /** Identifiant chez la source, pour la deduplication. */
  sourceId?: string;
  points: TrackPoint[];
  laps: Lap[];
  /** Metriques derivees calculees a l'enregistrement. */
  metrics?: ActivityMetrics;
  createdAt: number;
}

export type ActivitySource =
  | "fit100s" // enregistree en direct via Bluetooth
  | "import" // fichier FIT/GPX/TCX depose par l'utilisateur
  | "strava"
  | "decathlon" // Decathlon Coach
  | "manuelle";

export interface ActivityMetrics {
  /** Charge d'entrainement de la seance (unites arbitraires, echelle TSS). */
  trainingLoad: number;
  /** TRIMP d'Edwards, base sur le temps passe par zone cardiaque. */
  trimp?: number;
  /** Temps passe dans chacune des 5 zones cardiaques, en secondes. */
  hrZoneTimes?: number[];
  /** Allure moyenne en s/km (course/marche) ou vitesse moyenne en km/h (velo). */
  avgPace?: number;
  /** Allure corrigee du denivele, en s/km. */
  gradeAdjustedPace?: number;
  /** Indice de derive cardiaque : ratio FC/allure deuxieme moitie vs premiere. */
  decoupling?: number;
  /** Vitesse ascensionnelle moyenne en m/h (trail). */
  vam?: number;
  /** Meilleurs temps sur les distances classiques, en secondes. */
  bests?: Record<string, number>;
}

/** Profil physiologique servant de base au coaching. */
export interface AthleteProfile {
  userId: string;
  birthDate?: string; // ISO yyyy-mm-dd
  weightKg?: number;
  /** FC maximale mesuree. A defaut, elle est estimee depuis l'age. */
  maxHr?: number;
  /** FC de repos, mesuree au reveil. */
  restHr?: number;
  /** Vitesse maximale aerobie en km/h. */
  vma?: number;
  /** Nombre de seances par semaine que l'athlete peut tenir. */
  weeklySessions: number;
  /** Niveau declare, sert a calibrer les plans. */
  level: "debutant" | "intermediaire" | "confirme";
}

export type HrZone = 1 | 2 | 3 | 4 | 5;

export interface HrZones {
  /** Bornes basses de chaque zone, en bpm. */
  bounds: [number, number, number, number, number];
  max: number;
}

export type WorkoutKind =
  | "endurance"
  | "recuperation"
  | "fractionne"
  | "seuil"
  | "cote"
  | "sortie_longue"
  | "renforcement"
  | "repos"
  | "competition";

/** Un bloc d'une seance : echauffement, repetition, recuperation... */
export interface WorkoutStep {
  label: string;
  /** Duree cible en secondes, ou distance cible en metres. L'un des deux. */
  durationSec?: number;
  distanceM?: number;
  /** Zone cardiaque visee. */
  zone?: HrZone;
  /** Allure cible en s/km, calculee depuis la VMA de l'athlete. */
  targetPace?: number;
  /** Nombre de repetitions du bloc (avec le bloc suivant comme recuperation). */
  repeat?: number;
  children?: WorkoutStep[];
}

export interface Workout {
  id: string;
  kind: WorkoutKind;
  title: string;
  description: string;
  /** Duree totale estimee, en secondes. */
  estimatedDuration: number;
  /** Charge d'entrainement estimee de la seance. */
  estimatedLoad: number;
  steps: WorkoutStep[];
}

export interface PlannedSession extends Workout {
  /** Date prevue, ISO yyyy-mm-dd. */
  date: string;
  /** Semaine du plan, 1-indexee. */
  week: number;
  /** Activite qui a valide la seance, si elle a ete realisee. */
  completedActivityId?: string;
}

export type PlanGoal = "5km" | "10km" | "semi" | "marathon" | "forme" | "trail";

export interface TrainingPlan {
  id: string;
  userId: string;
  goal: PlanGoal;
  /** Date de l'objectif, ISO yyyy-mm-dd. */
  targetDate: string;
  /** Temps vise sur la distance, en secondes. Optionnel. */
  targetTime?: number;
  createdAt: number;
  sessions: PlannedSession[];
}

/** Etat de forme calcule a partir de l'historique de charge. */
export interface FitnessState {
  date: string;
  /** Charge chronique (forme de fond), moyenne exponentielle sur 42 jours. */
  ctl: number;
  /** Charge aigue (fatigue), moyenne exponentielle sur 7 jours. */
  atl: number;
  /** Fraicheur = ctl - atl. */
  tsb: number;
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: number;
}
