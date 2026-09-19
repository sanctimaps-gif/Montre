import type { AthleteProfile, Workout, WorkoutStep } from "./types.ts";
import { trainingPaces } from "./metrics.ts";

/**
 * Catalogue de seances. Chaque fabrique produit une seance complete, avec ses
 * blocs et ses allures cibles calculees depuis la VMA de l'athlete. Sans VMA
 * connue, les allures sont omises et seules les zones cardiaques guident
 * l'effort.
 */

function paces(profile: AthleteProfile): Record<string, number> | null {
  return profile.vma ? trainingPaces(profile.vma) : null;
}

function warmup(profile: AthleteProfile, minutes = 15): WorkoutStep {
  const p = paces(profile);
  return {
    label: "Echauffement",
    durationSec: minutes * 60,
    zone: 2,
    targetPace: p?.["endurance"],
  };
}

function cooldown(profile: AthleteProfile, minutes = 10): WorkoutStep {
  const p = paces(profile);
  return {
    label: "Retour au calme",
    durationSec: minutes * 60,
    zone: 1,
    targetPace: p?.["recuperation"],
  };
}

/** Duree totale d'une liste de blocs, repetitions comprises. */
export function stepsDuration(steps: WorkoutStep[]): number {
  let total = 0;
  for (const step of steps) {
    const own = step.durationSec ?? estimateStepDuration(step);
    const children = step.children ? stepsDuration(step.children) : 0;
    total += (own + children) * (step.repeat ?? 1);
  }
  return total;
}

/** Duree approximative d'un bloc defini en distance, a l'allure cible. */
function estimateStepDuration(step: WorkoutStep): number {
  if (step.distanceM && step.targetPace) {
    return (step.distanceM / 1000) * step.targetPace;
  }
  if (step.distanceM) return (step.distanceM / 1000) * 300;
  return 0;
}

/**
 * Charge estimee d'une seance : somme des durees ponderees par l'intensite de
 * la zone visee, sur la meme echelle que `trainingLoad`.
 */
export function estimateLoad(steps: WorkoutStep[]): number {
  const weights = [0.2, 0.45, 0.7, 1.0, 1.35];
  let load = 0;
  const walk = (list: WorkoutStep[], multiplier: number) => {
    for (const step of list) {
      const repeat = step.repeat ?? 1;
      const duration = step.durationSec ?? estimateStepDuration(step);
      load += (duration / 3600) * weights[(step.zone ?? 2) - 1]! * 100 * multiplier * repeat;
      if (step.children) walk(step.children, multiplier * repeat);
    }
  };
  walk(steps, 1);
  return Math.round(load);
}

function build(
  id: string,
  kind: Workout["kind"],
  title: string,
  description: string,
  steps: WorkoutStep[],
): Workout {
  return {
    id,
    kind,
    title,
    description,
    steps,
    estimatedDuration: stepsDuration(steps),
    estimatedLoad: estimateLoad(steps),
  };
}

export function enduranceRun(profile: AthleteProfile, minutes: number): Workout {
  const p = paces(profile);
  return build(
    `endurance-${minutes}`,
    "endurance",
    `Endurance fondamentale ${minutes} min`,
    "Allure de conversation : tu dois pouvoir parler en courant. C'est la seance qui construit ton moteur aerobie, elle doit rester facile.",
    [
      {
        label: "Course continue en aisance respiratoire",
        durationSec: minutes * 60,
        zone: 2,
        targetPace: p?.["endurance"],
      },
    ],
  );
}

export function recoveryRun(profile: AthleteProfile, minutes: number): Workout {
  const p = paces(profile);
  return build(
    `recup-${minutes}`,
    "recuperation",
    `Footing de recuperation ${minutes} min`,
    "Tres lent, volontairement. L'objectif est de faire circuler le sang sans ajouter de fatigue.",
    [
      {
        label: "Footing tres facile",
        durationSec: minutes * 60,
        zone: 1,
        targetPace: p?.["recuperation"],
      },
    ],
  );
}

export function longRun(profile: AthleteProfile, minutes: number): Workout {
  const p = paces(profile);
  return build(
    `longue-${minutes}`,
    "sortie_longue",
    `Sortie longue ${minutes} min`,
    "La sortie cle de la semaine : elle habitue le corps a durer. Pars plus lentement que prevu et finis un peu plus vite si tu te sens bien.",
    [
      {
        label: "Premiere partie en endurance",
        durationSec: Math.round(minutes * 0.7) * 60,
        zone: 2,
        targetPace: p?.["endurance"],
      },
      {
        label: "Fin de sortie un peu plus soutenue",
        durationSec: Math.round(minutes * 0.3) * 60,
        zone: 3,
        targetPace: p?.["marathon"],
      },
    ],
  );
}

/** Fractionne court type 30/30 ou 400 m, developpe la VMA. */
export function intervals(
  profile: AthleteProfile,
  reps: number,
  effortSec: number,
  recoverySec: number,
): Workout {
  const p = paces(profile);
  const steps: WorkoutStep[] = [
    warmup(profile),
    {
      label: `${reps} x ${effortSec} s`,
      repeat: reps,
      children: [
        {
          label: "Effort a VMA",
          durationSec: effortSec,
          zone: 5,
          targetPace: p?.["vma"],
        },
        {
          label: "Recuperation active",
          durationSec: recoverySec,
          zone: 2,
          targetPace: p?.["recuperation"],
        },
      ],
    },
    cooldown(profile),
  ];
  return build(
    `fractionne-${reps}x${effortSec}`,
    "fractionne",
    `Fractionne ${reps} x ${effortSec}/${recoverySec}`,
    "Seance de VMA : chaque repetition se court vite mais reguliere. Si tu ralentis sur les dernieres, la seance etait trop longue.",
    steps,
  );
}

/** Fractionne long (1000 m et plus), developpe l'endurance a haute intensite. */
export function longIntervals(
  profile: AthleteProfile,
  reps: number,
  distanceM: number,
  recoverySec: number,
): Workout {
  const p = paces(profile);
  const steps: WorkoutStep[] = [
    warmup(profile),
    {
      label: `${reps} x ${distanceM} m`,
      repeat: reps,
      children: [
        {
          label: `${distanceM} m a allure 10 km`,
          distanceM,
          zone: 4,
          targetPace: p?.["10km"],
        },
        {
          label: "Recuperation trottinee",
          durationSec: recoverySec,
          zone: 2,
          targetPace: p?.["recuperation"],
        },
      ],
    },
    cooldown(profile),
  ];
  return build(
    `fractionne-long-${reps}x${distanceM}`,
    "fractionne",
    `${reps} x ${distanceM} m`,
    "Fractionne long : l'allure doit rester tenable jusqu'a la derniere repetition. Regularite avant tout.",
    steps,
  );
}

/** Seance au seuil : seuil continu ou par blocs selon la duree. */
export function tempoRun(profile: AthleteProfile, tempoMinutes: number): Workout {
  const p = paces(profile);
  const steps: WorkoutStep[] = [
    warmup(profile),
    {
      label: `${tempoMinutes} min au seuil`,
      durationSec: tempoMinutes * 60,
      zone: 4,
      targetPace: p?.["seuil"],
    },
    cooldown(profile),
  ];
  return build(
    `seuil-${tempoMinutes}`,
    "seuil",
    `Seuil ${tempoMinutes} min`,
    "Allure soutenue mais controlee, celle que tu pourrais tenir environ une heure en course. Effort confortablement difficile.",
    steps,
  );
}

export function hillRepeats(profile: AthleteProfile, reps: number): Workout {
  const steps: WorkoutStep[] = [
    warmup(profile),
    {
      label: `${reps} x cote de 45 s`,
      repeat: reps,
      children: [
        { label: "Montee en puissance", durationSec: 45, zone: 5 },
        { label: "Descente en recuperation", durationSec: 105, zone: 1 },
      ],
    },
    cooldown(profile),
  ];
  return build(
    `cotes-${reps}`,
    "cote",
    `${reps} cotes`,
    "Le renforcement du coureur : cherche une pente reguliere de 5 a 8 %. Buste droit, foulee courte et active.",
    steps,
  );
}

export function strengthSession(): Workout {
  const steps: WorkoutStep[] = [
    { label: "Mobilite et activation", durationSec: 300, zone: 1 },
    {
      label: "3 tours de circuit",
      repeat: 3,
      children: [
        { label: "Gainage ventral 45 s", durationSec: 45, zone: 3 },
        { label: "Fentes alternees 45 s", durationSec: 45, zone: 3 },
        { label: "Gainage lateral 30 s par cote", durationSec: 60, zone: 3 },
        { label: "Montees de genoux 30 s", durationSec: 30, zone: 4 },
        { label: "Recuperation", durationSec: 60, zone: 1 },
      ],
    },
    { label: "Etirements", durationSec: 300, zone: 1 },
  ];
  return build(
    "renfo",
    "renforcement",
    "Renforcement du coureur",
    "Vingt-cinq minutes qui previennent la majorite des blessures de course a pied. A faire chez soi, sans materiel.",
    steps,
  );
}

export function restDay(): Workout {
  return {
    id: "repos",
    kind: "repos",
    title: "Repos",
    description:
      "Journee sans course. La progression se construit pendant la recuperation, pas seulement a l'entrainement.",
    estimatedDuration: 0,
    estimatedLoad: 0,
    steps: [],
  };
}

export function raceDay(goalLabel: string): Workout {
  return {
    id: `course-${goalLabel}`,
    kind: "competition",
    title: `Jour J : ${goalLabel}`,
    description:
      "Echauffement court, depart prudent sur les deux premiers kilometres, puis installe ton allure cible.",
    estimatedDuration: 0,
    estimatedLoad: 0,
    steps: [],
  };
}
