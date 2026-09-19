/** Formatage des grandeurs sportives pour l'affichage. */

export function km(meters: number, decimals = 2): string {
  return `${(meters / 1000).toFixed(decimals)} km`;
}

export function duration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

/** Duree en mots courts, pour les descriptions de seance. */
export function durationWords(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${pad(m)}`;
}

export function pace(secondsPerKm: number | null | undefined): string {
  if (secondsPerKm == null || !isFinite(secondsPerKm) || secondsPerKm <= 0) return "--:--";
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.round(secondsPerKm % 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${pad(s)}`;
}

/** Allure ou vitesse selon le sport : les cyclistes raisonnent en km/h. */
export function paceOrSpeed(sport: string, distance: number, seconds: number): string {
  if (distance <= 0 || seconds <= 0) return "--";
  if (sport === "velo") return `${((distance / seconds) * 3.6).toFixed(1)} km/h`;
  return `${pace((seconds / distance) * 1000)}/km`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = [
  "janvier", "fevrier", "mars", "avril", "mai", "juin",
  "juillet", "aout", "septembre", "octobre", "novembre", "decembre",
];

export function dateLong(ms: number): string {
  const d = new Date(ms);
  return `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function dateShort(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return `${JOURS[d.getDay()]?.slice(0, 3)}. ${d.getDate()} ${MOIS[d.getMonth()]?.slice(0, 4)}`;
}

/** Ecart en langage courant : "il y a 2 h", "hier", "il y a 3 jours". */
export function relative(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "a l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  if (days === 1) return "hier";
  if (days < 7) return `il y a ${days} jours`;
  return dateLong(ms).split(",")[0] ?? "";
}

export const SPORT_ICONS: Record<string, string> = {
  course: "🏃",
  trail: "⛰️",
  marche: "🚶",
  velo: "🚲",
  natation: "🏊",
  cardio: "🤸",
  renforcement: "💪",
  autre: "⚡",
};

export const SPORT_LABELS: Record<string, string> = {
  course: "Course a pied",
  trail: "Trail",
  marche: "Marche",
  velo: "Velo",
  natation: "Natation",
  cardio: "Cardio",
  renforcement: "Renforcement",
  autre: "Autre",
};

export const KIND_LABELS: Record<string, string> = {
  endurance: "Endurance",
  recuperation: "Recuperation",
  fractionne: "Fractionne",
  seuil: "Seuil",
  cote: "Cotes",
  sortie_longue: "Sortie longue",
  renforcement: "Renforcement",
  repos: "Repos",
  competition: "Competition",
};

/** Couleur associee a un type de seance, reprise dans les plannings. */
export const KIND_COLORS: Record<string, string> = {
  endurance: "#35c47d",
  recuperation: "#4bb4e6",
  fractionne: "#e5484d",
  seuil: "#fc5200",
  cote: "#f5b301",
  sortie_longue: "#8b5cf6",
  renforcement: "#9aa7b8",
  repos: "#4b5563",
  competition: "#fc5200",
};

/** Couleurs des cinq zones cardiaques, de la plus facile a la plus dure. */
export const ZONE_COLORS = ["#4bb4e6", "#35c47d", "#f5b301", "#fc5200", "#e5484d"];
