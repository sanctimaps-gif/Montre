import type {
  Activity,
  AthleteProfile,
  FitnessState,
  PlanGoal,
  PlannedSession,
  TrainingPlan,
  Workout,
} from "./types.ts";
import { formatPace, trainingPaces } from "./metrics.ts";
import { acwr, readForm } from "./training-load.ts";
import {
  enduranceRun,
  hillRepeats,
  intervals,
  longIntervals,
  longRun,
  raceDay,
  recoveryRun,
  restDay,
  strengthSession,
  tempoRun,
} from "./workouts.ts";

const DAY_MS = 24 * 3600 * 1000;

/** Volume de reference de la sortie longue en fin de preparation, en minutes. */
const LONG_RUN_PEAK: Record<PlanGoal, number> = {
  "5km": 60,
  "10km": 75,
  semi: 100,
  marathon: 150,
  trail: 180,
  forme: 60,
};

const GOAL_LABEL: Record<PlanGoal, string> = {
  "5km": "5 km",
  "10km": "10 km",
  semi: "semi-marathon",
  marathon: "marathon",
  trail: "trail",
  forme: "objectif forme",
};

/** Phase d'entrainement d'une semaine donnee du plan. */
export type Phase = "base" | "developpement" | "specifique" | "affutage";

export function phaseForWeek(week: number, totalWeeks: number): Phase {
  const remaining = totalWeeks - week;
  if (remaining <= 1) return "affutage";
  if (week <= Math.max(2, Math.round(totalWeeks * 0.3))) return "base";
  if (week <= Math.round(totalWeeks * 0.7)) return "developpement";
  return "specifique";
}

/**
 * Coefficient de volume de la semaine. La progression est croissante avec une
 * semaine de recuperation toutes les quatre semaines, puis un affutage
 * marque sur la derniere semaine.
 */
export function weekVolumeFactor(week: number, totalWeeks: number): number {
  if (week === totalWeeks) return 0.5;
  if (week === totalWeeks - 1) return 0.7;
  if (week % 4 === 0) return 0.75;
  const progression = 0.7 + 0.3 * (week / Math.max(1, totalWeeks - 2));
  return Math.min(1, progression);
}

export interface GeneratePlanOptions {
  goal: PlanGoal;
  /** Date de l'objectif, ISO yyyy-mm-dd. */
  targetDate: string;
  profile: AthleteProfile;
  /** Debut du plan. Par defaut aujourd'hui. */
  startDate?: string;
  targetTime?: number;
  /** Jours de la semaine disponibles, 0 = dimanche. Par defaut lun/mer/ven/dim. */
  availableDays?: number[];
}

/**
 * Genere un plan periodise jusqu'a la date d'objectif. Le nombre de seances
 * hebdomadaires vient du profil, leur nature depend de la phase, et le volume
 * suit une progression avec semaines de recuperation.
 */
export function generatePlan(options: GeneratePlanOptions): TrainingPlan {
  const { goal, targetDate, profile } = options;
  const start = options.startDate ?? new Date().toISOString().slice(0, 10);
  const startMs = Date.parse(start + "T00:00:00Z");
  const targetMs = Date.parse(targetDate + "T00:00:00Z");
  if (!isFinite(startMs) || !isFinite(targetMs)) {
    throw new Error("Dates de plan invalides");
  }
  if (targetMs <= startMs) {
    throw new Error("La date d'objectif doit etre posterieure au debut du plan");
  }

  const totalWeeks = Math.max(
    2,
    Math.min(24, Math.ceil((targetMs - startMs) / (7 * DAY_MS))),
  );
  const sessionsPerWeek = Math.max(2, Math.min(6, profile.weeklySessions));
  const days = options.availableDays ?? defaultDays(sessionsPerWeek);
  const sessions: PlannedSession[] = [];

  for (let week = 1; week <= totalWeeks; week++) {
    const phase = phaseForWeek(week, totalWeeks);
    const factor = weekVolumeFactor(week, totalWeeks);
    const weekWorkouts = buildWeek(goal, phase, factor, profile, sessionsPerWeek);

    weekWorkouts.forEach((workout, index) => {
      const dayOfWeek = days[index % days.length]!;
      const date = dateForWeekDay(startMs, week, dayOfWeek);
      if (Date.parse(date + "T00:00:00Z") > targetMs) return;
      sessions.push({ ...workout, date, week });
    });
  }

  // Le jour de l'objectif remplace toute seance deja posee a cette date.
  const raceIndex = sessions.findIndex((s) => s.date === targetDate);
  const race: PlannedSession = {
    ...raceDay(GOAL_LABEL[goal]),
    date: targetDate,
    week: totalWeeks,
  };
  if (raceIndex >= 0) sessions[raceIndex] = race;
  else if (goal !== "forme") sessions.push(race);

  sessions.sort((a, b) => a.date.localeCompare(b.date));

  return {
    id: `plan-${Date.now().toString(36)}`,
    userId: profile.userId,
    goal,
    targetDate,
    targetTime: options.targetTime,
    createdAt: Date.now(),
    sessions,
  };
}

/**
 * Repartition par defaut des jours d'entrainement, en ordre chronologique et
 * sortie longue le dimanche.
 *
 * Deux contraintes dictent ces dispositions : le lendemain de la sortie longue
 * n'est jamais un jour de qualite, et il reste toujours au moins un jour de
 * repos entre la derniere seance de la semaine et la sortie longue suivante.
 */
function defaultDays(sessionsPerWeek: number): number[] {
  const layouts: Record<number, number[]> = {
    2: [2, 0], // mardi, dimanche
    3: [2, 4, 0], // mardi, jeudi, dimanche
    4: [1, 2, 4, 0], // lundi, mardi, jeudi, dimanche
    5: [1, 2, 4, 5, 0], // lundi, mardi, jeudi, vendredi, dimanche
    6: [1, 2, 3, 4, 5, 0],
  };
  return layouts[sessionsPerWeek] ?? [2, 4, 0];
}

function dateForWeekDay(startMs: number, week: number, dayOfWeek: number): string {
  const weekStart = startMs + (week - 1) * 7 * DAY_MS;
  const startDay = new Date(weekStart).getUTCDay();
  // 0 (dimanche) est place en fin de semaine plutot qu'au debut.
  const normalized = dayOfWeek === 0 ? 7 : dayOfWeek;
  const normalizedStart = startDay === 0 ? 7 : startDay;
  const offset = (normalized - normalizedStart + 7) % 7;
  return new Date(weekStart + offset * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Compose la semaine type, dans l'ordre chronologique des jours retenus.
 *
 * La derniere seance est la sortie longue. La premiere, qui suit la sortie
 * longue de la semaine precedente, est toujours facile : enchainer une seance
 * de qualite le lendemain d'une sortie longue est la maniere la plus sure de
 * se blesser. Les seances de qualite occupent les jours intermediaires, repartis
 * aussi regulierement que possible.
 */
function buildWeek(
  goal: PlanGoal,
  phase: Phase,
  factor: number,
  profile: AthleteProfile,
  sessionsPerWeek: number,
): Workout[] {
  const easyMinutes = Math.round(
    (profile.level === "debutant" ? 35 : profile.level === "intermediaire" ? 45 : 55) *
      factor,
  );
  const longMinutes = Math.round(LONG_RUN_PEAK[goal] * factor);
  const qualityCount = phase === "base" ? 1 : phase === "affutage" ? 1 : 2;
  const quality = qualityWorkouts(goal, phase, factor, profile);

  const easyRun = () =>
    phase === "affutage"
      ? recoveryRun(profile, Math.round(easyMinutes * 0.7))
      : enduranceRun(profile, easyMinutes);

  const week: Workout[] = new Array(sessionsPerWeek);
  week[sessionsPerWeek - 1] =
    goal === "forme" ? enduranceRun(profile, longMinutes) : longRun(profile, longMinutes);

  if (sessionsPerWeek >= 2) week[0] = recoveryRun(profile, Math.round(easyMinutes * 0.8));

  // Jours intermediaires : ni le lendemain de la sortie longue, ni la sortie longue.
  const middle: number[] = [];
  for (let i = 1; i < sessionsPerWeek - 1; i++) middle.push(i);

  const slots = spreadSlots(middle, Math.min(qualityCount, middle.length));
  slots.forEach((slot, index) => {
    if (quality.length > 0) week[slot] = quality[index % quality.length]!;
  });

  for (let i = 0; i < sessionsPerWeek; i++) {
    if (week[i]) continue;
    // Le renforcement remplace une sortie facile quand le volume le permet.
    week[i] = profile.weeklySessions >= 5 ? strengthSession() : easyRun();
  }

  return week;
}

/** Choisit `count` positions reparties aussi regulierement que possible. */
function spreadSlots(available: number[], count: number): number[] {
  if (count <= 0 || available.length === 0) return [];
  if (count >= available.length) return available.slice();
  if (count === 1) return [available[0]!];
  return Array.from({ length: count }, (_, i) =>
    available[Math.round((i * (available.length - 1)) / (count - 1))]!,
  );
}

function qualityWorkouts(
  goal: PlanGoal,
  phase: Phase,
  factor: number,
  profile: AthleteProfile,
): Workout[] {
  const reps = (base: number) => Math.max(4, Math.round(base * factor));

  switch (phase) {
    case "base":
      return [hillRepeats(profile, reps(8)), enduranceRun(profile, 45)];
    case "developpement":
      return goal === "5km" || goal === "10km"
        ? [intervals(profile, reps(10), 30, 30), longIntervals(profile, reps(5), 1000, 90)]
        : [longIntervals(profile, reps(5), 1000, 90), tempoRun(profile, Math.round(20 * factor))];
    case "specifique":
      return goal === "marathon" || goal === "semi"
        ? [tempoRun(profile, Math.round(30 * factor)), longIntervals(profile, reps(4), 2000, 120)]
        : [intervals(profile, reps(12), 30, 30), tempoRun(profile, Math.round(20 * factor))];
    case "affutage":
      return [intervals(profile, 6, 30, 30)];
  }
}

export interface Recommendation {
  workout: Workout;
  reason: string;
  /** Avertissement eventuel sur la charge ou la recuperation. */
  warning?: string;
}

/**
 * Seance du jour recommandee. Elle part du plan quand il existe, puis
 * l'ajuste selon l'etat de forme reel : une fatigue elevee degrade une seance
 * intense en footing, une fraicheur excessive autorise a durcir.
 */
export function recommendToday(args: {
  profile: AthleteProfile;
  fitness?: FitnessState;
  plan?: TrainingPlan;
  recentActivities: Array<Pick<Activity, "startTime" | "metrics">>;
  today?: string;
}): Recommendation {
  const today = args.today ?? new Date().toISOString().slice(0, 10);
  const form = readForm(args.fitness);
  const ratio = acwr(args.fitness);
  const planned = args.plan?.sessions.find((s) => s.date === today);

  const daysSinceLast = daysSinceLastActivity(args.recentActivities, today);
  const hardRecently = trainedHardYesterday(args.recentActivities, today);

  // Priorite absolue : eviter d'empiler deux seances dures consecutives. La
  // regle s'applique aussi hors plan, sinon le mode adaptatif proposerait du
  // fractionne au lendemain d'une seance intense.
  if (hardRecently && (!planned || isHard(planned))) {
    return {
      workout: recoveryRun(args.profile, 30),
      reason:
        "Ta derniere seance etait intense : 24 h de recuperation valent mieux qu'une seance de qualite ratee.",
      warning: planned ? "Seance du plan reportee a demain." : undefined,
    };
  }

  if (form.verdict === "surcharge") {
    return {
      workout: planned && planned.kind === "repos" ? restDay() : recoveryRun(args.profile, 30),
      reason: form.message,
      warning:
        ratio && ratio > 1.4
          ? `Ta charge de la semaine represente ${Math.round(ratio * 100)} % de ta charge habituelle : c'est la zone ou les blessures arrivent.`
          : undefined,
    };
  }

  if (planned) {
    const upgraded =
      form.verdict === "frais" && planned.kind === "endurance"
        ? tempoRun(args.profile, 20)
        : planned;
    return {
      workout: upgraded,
      reason:
        upgraded === planned
          ? `Seance prevue en semaine ${planned.week} de ton plan. ${form.message}`
          : "Tu es tres frais et la seance prevue etait facile : on en profite pour placer du seuil.",
    };
  }

  // Sans plan : recommandation adaptative simple.
  if (daysSinceLast != null && daysSinceLast >= 4) {
    return {
      workout: enduranceRun(args.profile, 40),
      reason:
        "Quelques jours sans courir : une sortie en endurance pour relancer la machine sans brusquer.",
    };
  }
  if (form.verdict === "frais" || form.verdict === "optimal") {
    return {
      workout: intervals(args.profile, 10, 30, 30),
      reason: form.message,
    };
  }
  return {
    workout: enduranceRun(args.profile, 45),
    reason: form.message,
  };
}

function isHard(workout: Workout): boolean {
  return (
    workout.kind === "fractionne" ||
    workout.kind === "seuil" ||
    workout.kind === "cote" ||
    workout.kind === "competition"
  );
}

function daysSinceLastActivity(
  activities: Array<Pick<Activity, "startTime">>,
  today: string,
): number | null {
  if (activities.length === 0) return null;
  const last = Math.max(...activities.map((a) => a.startTime));
  return Math.floor((Date.parse(today + "T00:00:00Z") - last) / DAY_MS);
}

function trainedHardYesterday(
  activities: Array<Pick<Activity, "startTime" | "metrics">>,
  today: string,
): boolean {
  const todayMs = Date.parse(today + "T00:00:00Z");
  return activities.some(
    (a) =>
      todayMs - a.startTime <= DAY_MS &&
      todayMs - a.startTime >= 0 &&
      (a.metrics?.trainingLoad ?? 0) >= 80,
  );
}

export interface SessionFeedback {
  /** Phrase d'accroche affichee en haut de l'analyse. */
  headline: string;
  /** Points d'analyse detaillee. */
  insights: string[];
  /** Conseil pour la suite. */
  nextStep: string;
}

/**
 * Analyse post-seance facon coach : ce qui s'est bien passe, ce qui merite
 * attention, et quoi faire ensuite. Tout est deduit des metriques calculees.
 */
export function analyzeSession(
  activity: Activity,
  profile: AthleteProfile,
  planned?: PlannedSession,
): SessionFeedback {
  const insights: string[] = [];
  const m = activity.metrics;
  const km = activity.distance / 1000;

  let headline =
    km >= 1
      ? `${km.toFixed(2)} km en ${Math.round(activity.movingTime / 60)} min`
      : `${Math.round(activity.movingTime / 60)} min d'effort`;

  if (m?.avgPace) {
    headline += ` a ${formatPace(m.avgPace)}/km`;
  }

  if (m?.hrZoneTimes) {
    const total = m.hrZoneTimes.reduce((a, b) => a + b, 0);
    if (total > 0) {
      const easyShare = ((m.hrZoneTimes[0]! + m.hrZoneTimes[1]!) / total) * 100;
      if (easyShare >= 75) {
        insights.push(
          `${Math.round(easyShare)} % du temps en zone facile : exactement ce qu'il faut pour une sortie d'endurance.`,
        );
      } else if (easyShare < 40) {
        insights.push(
          `Seulement ${Math.round(easyShare)} % du temps en zone facile. Si ce n'etait pas une seance de qualite, tu cours tes footings trop vite.`,
        );
      }
    }
  }

  if (m?.decoupling != null) {
    if (m.decoupling > 8) {
      insights.push(
        `Ta frequence cardiaque a derive de ${m.decoupling.toFixed(1)} % sur la seconde moitie : allure trop ambitieuse, chaleur, ou endurance de base a construire.`,
      );
    } else if (m.decoupling < 3) {
      insights.push(
        `Derive cardiaque de seulement ${m.decoupling.toFixed(1)} % : ton endurance aerobie est solide sur cette duree.`,
      );
    }
  }

  if (m?.gradeAdjustedPace && m.avgPace && m.gradeAdjustedPace < m.avgPace - 10) {
    insights.push(
      `Corrigee du denivele, ton allure vaut ${formatPace(m.gradeAdjustedPace)}/km : le terrain explique une bonne partie de l'ecart.`,
    );
  }

  if (activity.elevationGain > 300) {
    insights.push(
      `${activity.elevationGain} m de denivele positif${m?.vam ? `, soit ${m.vam} m/h de vitesse ascensionnelle` : ""}.`,
    );
  }

  if (m?.bests && profile.vma) {
    const vmaPaces = trainingPaces(profile.vma);
    const best5k = m.bests["5km"];
    if (best5k && best5k / 5 < vmaPaces["5km"]!) {
      insights.push(
        `Tu as tenu ${formatPace(best5k / 5)}/km sur ton meilleur 5 km de la seance, plus vite que ton allure 5 km theorique : ta VMA a probablement progresse.`,
      );
    }
  }

  if (planned) {
    const ratio = planned.estimatedDuration
      ? activity.movingTime / planned.estimatedDuration
      : 1;
    if (ratio < 0.7) {
      insights.push(
        "Seance ecourtee par rapport au plan. Ce n'est pas grave ponctuellement, mais note pourquoi si cela se repete.",
      );
    } else if (ratio > 1.3) {
      insights.push(
        "Seance nettement plus longue que prevu : attention a ne pas transformer chaque sortie facile en effort.",
      );
    } else {
      insights.push("Seance realisee conformement au plan.");
    }
  }

  if (insights.length === 0) {
    insights.push(
      "Seance enregistree. Ajoute une ceinture cardio ou renseigne ta VMA pour une analyse plus fine.",
    );
  }

  const load = m?.trainingLoad ?? 0;
  const nextStep = advice(load, intenseShare(m?.hrZoneTimes));

  return { headline, insights, nextStep };
}

/** Part du temps passe en zone 4 ou 5, entre 0 et 1. */
function intenseShare(zoneTimes: number[] | undefined): number {
  if (!zoneTimes) return 0;
  const total = zoneTimes.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  return (zoneTimes[3]! + zoneTimes[4]!) / total;
}

/**
 * Conseil pour le lendemain. La charge totale ne suffit pas : une seance courte
 * mais tres intense fatigue le systeme nerveux sans accumuler beaucoup de
 * charge, et merite quand meme une journee facile derriere.
 */
function advice(load: number, intense: number): string {
  if (load >= 120) {
    return "Grosse charge : prevois une journee facile ou un repos complet demain.";
  }
  if (intense >= 0.25) {
    return "Seance intense : laisse 24 a 48 h avant la prochaine sortie dure, une journee facile fera progresser davantage.";
  }
  if (load >= 60) {
    return "Charge moderee : une sortie en endurance demain reste tout a fait possible.";
  }
  return "Charge legere : tu peux enchainer avec une seance de qualite demain si tu te sens bien.";
}
