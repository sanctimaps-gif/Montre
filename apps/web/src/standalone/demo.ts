import type { Sport, TrackPoint } from "@montre/core";

/**
 * Seances de demonstration du mode autonome.
 *
 * Elles sont generees, pas enregistrees par un vrai athlete : le titre le dit
 * explicitement, pour qu'aucune donnee affichee ne soit prise pour une mesure
 * reelle. Elles servent a voir immediatement a quoi ressemblent la courbe de
 * forme, l'analyse de seance et les graphiques.
 */

export interface DemoSession {
  sport: Sport;
  title: string;
  startTime: number;
  points: TrackPoint[];
}

const DAY = 24 * 3600 * 1000;

/** Point de depart des traces : le parc de la Tete d'Or, a Lyon. */
const ORIGIN = { lat: 45.7797, lon: 4.8523 };

interface Profile {
  /** Duree de la seance, en minutes. */
  minutes: number;
  /** Vitesse de croisiere, en m/s. */
  speed: number;
  /** Frequence cardiaque de base, en bpm. */
  hr: number;
  /** Derive cardiaque sur la duree, en bpm. */
  drift: number;
  /** Alternance effort/recuperation, pour les seances de fractionne. */
  intervals?: { effort: number; recovery: number; fast: number; slow: number };
  /** Amplitude du relief, en metres. */
  relief: number;
}

/**
 * Construit une trace seconde par seconde. Le trace suit une boucle pour que
 * la carte ressemble a un vrai parcours plutot qu'a une ligne droite.
 */
function buildPoints(startTime: number, profile: Profile): TrackPoint[] {
  const total = profile.minutes * 60;
  const points: TrackPoint[] = [];
  let lat = ORIGIN.lat;
  let lon = ORIGIN.lon;
  let distance = 0;

  for (let i = 0; i < total; i++) {
    let speed = profile.speed;
    let hr = profile.hr + (profile.drift * i) / total;

    if (profile.intervals) {
      const { effort, recovery, fast, slow } = profile.intervals;
      const cycle = effort + recovery;
      // Les repetitions commencent apres dix minutes d'echauffement.
      const inWorkout = i > 600 && i < total - 480;
      const running = inWorkout && i % cycle < effort;
      speed = inWorkout ? (running ? fast : slow) : profile.speed;
      hr += running ? 22 : inWorkout ? -6 : -4;
    }

    // Variation naturelle de l'allure et du cardio d'une seconde a l'autre.
    speed *= 1 + 0.03 * Math.sin(i / 37);
    hr += 2 * Math.sin(i / 53);

    // Boucle fermee : le cap tourne regulierement tout au long de la sortie.
    const heading = (i / total) * 2 * Math.PI + 0.6 * Math.sin(i / 400);
    lat += (speed * Math.cos(heading)) / 111_320;
    lon += (speed * Math.sin(heading)) / (111_320 * Math.cos((lat * Math.PI) / 180));
    distance += speed;

    points.push({
      t: startTime + i * 1000,
      lat,
      lon,
      alt: 170 + profile.relief * Math.sin(i / 420) + 1.5 * Math.sin(i / 25),
      distance,
      speed,
      hr: Math.round(hr),
      cadence: Math.round(78 + speed * 3 + 2 * Math.sin(i / 31)),
    });
  }

  return points;
}

/**
 * Cinq semaines d'entrainement coherentes : endurance, fractionne, seuil et
 * sortie longue, avec une progression de volume et une semaine plus legere.
 */
export function demoSessions(now = Date.now()): DemoSession[] {
  const midMorning = (daysAgo: number, hour: number) => {
    const day = new Date(now - daysAgo * DAY);
    day.setHours(hour, 0, 0, 0);
    return day.getTime();
  };

  const plan: Array<{ daysAgo: number; hour: number; title: string; profile: Profile }> = [
    { daysAgo: 33, hour: 18, title: "Endurance du soir", profile: { minutes: 42, speed: 3.05, hr: 136, drift: 8, relief: 12 } },
    { daysAgo: 31, hour: 19, title: "Fractionne 10 x 400 m", profile: { minutes: 48, speed: 3.0, hr: 140, drift: 6, relief: 8, intervals: { effort: 95, recovery: 95, fast: 4.6, slow: 2.6 } } },
    { daysAgo: 28, hour: 9, title: "Sortie longue du dimanche", profile: { minutes: 78, speed: 3.15, hr: 139, drift: 14, relief: 35 } },
    { daysAgo: 26, hour: 18, title: "Footing de recuperation", profile: { minutes: 32, speed: 2.8, hr: 126, drift: 5, relief: 8 } },
    { daysAgo: 24, hour: 19, title: "Seuil 2 x 12 min", profile: { minutes: 52, speed: 3.1, hr: 142, drift: 7, relief: 10, intervals: { effort: 720, recovery: 240, fast: 4.15, slow: 2.9 } } },
    { daysAgo: 21, hour: 9, title: "Sortie longue en nature", profile: { minutes: 86, speed: 3.1, hr: 141, drift: 16, relief: 55 } },
    { daysAgo: 18, hour: 18, title: "Endurance fondamentale", profile: { minutes: 45, speed: 3.05, hr: 135, drift: 8, relief: 12 } },
    { daysAgo: 16, hour: 19, title: "Cotes 8 x 45 s", profile: { minutes: 44, speed: 2.95, hr: 141, drift: 8, relief: 42, intervals: { effort: 45, recovery: 105, fast: 4.4, slow: 2.4 } } },
    { daysAgo: 14, hour: 9, title: "Sortie longue, semaine allegee", profile: { minutes: 62, speed: 3.2, hr: 138, drift: 11, relief: 28 } },
    { daysAgo: 10, hour: 18, title: "Endurance au bord du fleuve", profile: { minutes: 50, speed: 3.15, hr: 137, drift: 9, relief: 10 } },
    { daysAgo: 8, hour: 19, title: "Fractionne 6 x 1000 m", profile: { minutes: 56, speed: 3.05, hr: 141, drift: 7, relief: 9, intervals: { effort: 230, recovery: 120, fast: 4.4, slow: 2.7 } } },
    { daysAgo: 7, hour: 9, title: "Sortie longue avant affutage", profile: { minutes: 95, speed: 3.15, hr: 142, drift: 18, relief: 48 } },
    { daysAgo: 4, hour: 18, title: "Footing tranquille", profile: { minutes: 36, speed: 2.9, hr: 129, drift: 6, relief: 8 } },
    { daysAgo: 2, hour: 19, title: "Seuil 20 min", profile: { minutes: 46, speed: 3.1, hr: 140, drift: 8, relief: 10, intervals: { effort: 1200, recovery: 300, fast: 4.2, slow: 2.9 } } },
  ];

  return plan.map((entry) => {
    const startTime = midMorning(entry.daysAgo, entry.hour);
    return {
      sport: entry.profile.relief > 40 ? "trail" : "course",
      title: `${entry.title} (demonstration)`,
      startTime,
      points: buildPoints(startTime, entry.profile),
    };
  });
}
