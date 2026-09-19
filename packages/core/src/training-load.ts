import type { FitnessState } from "./types.ts";

const DAY_MS = 24 * 3600 * 1000;

/** Constantes de temps des moyennes exponentielles, en jours. */
export const CTL_DAYS = 42;
export const ATL_DAYS = 7;

export function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Serie quotidienne de forme (CTL), fatigue (ATL) et fraicheur (TSB) calculee a
 * partir des charges de chaque seance. Les jours sans entrainement sont pris en
 * compte avec une charge nulle : c'est ce qui fait redescendre la fatigue et
 * remonter la fraicheur pendant l'affutage.
 */
export function fitnessSeries(
  loads: Array<{ date: string; load: number }>,
  options: { from?: string; to?: string; seedCtl?: number; seedAtl?: number } = {},
): FitnessState[] {
  if (loads.length === 0 && !options.from) return [];

  const byDay = new Map<string, number>();
  for (const { date, load } of loads) {
    byDay.set(date, (byDay.get(date) ?? 0) + load);
  }

  const dates = [...byDay.keys()].sort();
  const start = options.from ?? dates[0]!;
  const end = options.to ?? toIsoDate(Date.now());

  const ctlAlpha = 1 - Math.exp(-1 / CTL_DAYS);
  const atlAlpha = 1 - Math.exp(-1 / ATL_DAYS);

  let ctl = options.seedCtl ?? 0;
  let atl = options.seedAtl ?? 0;
  const out: FitnessState[] = [];

  for (let t = Date.parse(start); t <= Date.parse(end); t += DAY_MS) {
    const date = toIsoDate(t);
    const load = byDay.get(date) ?? 0;
    ctl += (load - ctl) * ctlAlpha;
    atl += (load - atl) * atlAlpha;
    out.push({
      date,
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      tsb: Math.round((ctl - atl) * 10) / 10,
    });
  }
  return out;
}

export type FormVerdict =
  | "frais"
  | "optimal"
  | "productif"
  | "surcharge"
  | "repos";

/**
 * Lecture de l'etat de forme du jour. Les seuils suivent la pratique courante :
 * au-dela de +25 de fraicheur l'athlete se desentraine, en dessous de -30 le
 * risque de blessure devient significatif.
 */
export function readForm(state: FitnessState | undefined): {
  verdict: FormVerdict;
  message: string;
} {
  if (!state) {
    return {
      verdict: "repos",
      message:
        "Pas encore assez de seances pour estimer ta forme. Enregistre quelques sorties pour demarrer.",
    };
  }
  const { tsb, ctl } = state;
  if (tsb > 25 && ctl < 20) {
    return {
      verdict: "repos",
      message:
        "Ta charge de fond est basse : reprends progressivement, deux a trois sorties faciles cette semaine.",
    };
  }
  if (tsb > 20) {
    return {
      verdict: "frais",
      message:
        "Tu es tres frais. C'est le moment d'une seance de qualite ou d'une course.",
    };
  }
  if (tsb >= -10) {
    return {
      verdict: "optimal",
      message:
        "Equilibre charge/recuperation ideal. Tu peux enchainer une seance intense.",
    };
  }
  if (tsb >= -30) {
    return {
      verdict: "productif",
      message:
        "Tu es en phase de surcharge productive. Garde une sortie facile entre deux seances dures.",
    };
  }
  return {
    verdict: "surcharge",
    message:
      "Fatigue accumulee elevee. Prevois 2 a 3 jours faciles avant la prochaine seance intense.",
  };
}

/**
 * Ratio charge aigue / charge chronique. En dehors de la fenetre 0,8-1,3 le
 * risque de blessure augmente nettement d'apres les travaux de Gabbett.
 */
export function acwr(state: FitnessState | undefined): number | undefined {
  if (!state || state.ctl <= 0) return undefined;
  return Math.round((state.atl / state.ctl) * 100) / 100;
}

/** Charge totale par semaine ISO, pour le graphe de progression. */
export function weeklyLoads(
  loads: Array<{ date: string; load: number }>,
): Array<{ week: string; load: number }> {
  const byWeek = new Map<string, number>();
  for (const { date, load } of loads) {
    const week = isoWeekKey(new Date(date + "T00:00:00Z"));
    byWeek.set(week, (byWeek.get(week) ?? 0) + load);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, load]) => ({ week, load: Math.round(load) }));
}

export function isoWeekKey(date: Date): string {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  // Jeudi de la semaine courante : definit l'annee ISO.
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${d.getUTCFullYear()}-S${String(week).padStart(2, "0")}`;
}
