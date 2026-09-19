import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyzeSession,
  generatePlan,
  phaseForWeek,
  recommendToday,
} from "../src/coach.ts";
import { acwr, fitnessSeries, isoWeekKey, readForm, weeklyLoads } from "../src/training-load.ts";
import { estimateLoad, intervals, stepsDuration } from "../src/workouts.ts";
import type { Activity, AthleteProfile } from "../src/types.ts";

const profile: AthleteProfile = {
  userId: "u1",
  maxHr: 190,
  restHr: 50,
  vma: 16,
  weeklySessions: 4,
  level: "intermediaire",
};

test("la charge chronique monte lentement et la fatigue redescend vite", () => {
  const loads = Array.from({ length: 60 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
    load: 60,
  }));
  const series = fitnessSeries(loads, { to: "2026-03-31" });
  const day60 = series.find((s) => s.date === "2026-03-01")!;
  const end = series[series.length - 1]!;

  // Apres deux mois de charge reguliere, la CTL approche la charge quotidienne.
  assert.ok(day60.ctl > 40 && day60.ctl < 60, `CTL : ${day60.ctl}`);
  // Un mois d'arret : la fatigue s'effondre et la fraicheur devient positive.
  assert.ok(end.atl < 1, `ATL apres arret : ${end.atl}`);
  assert.ok(end.tsb > 0);
});

test("la lecture de forme distingue surcharge et fraicheur", () => {
  assert.equal(readForm({ date: "2026-03-01", ctl: 60, atl: 100, tsb: -40 }).verdict, "surcharge");
  assert.equal(readForm({ date: "2026-03-01", ctl: 60, atl: 35, tsb: 25 }).verdict, "frais");
  assert.equal(readForm({ date: "2026-03-01", ctl: 60, atl: 62, tsb: -2 }).verdict, "optimal");
  assert.equal(readForm(undefined).verdict, "repos");
});

test("le ratio charge aigue sur chronique est calcule", () => {
  assert.equal(acwr({ date: "2026-03-01", ctl: 50, atl: 75, tsb: -25 }), 1.5);
  assert.equal(acwr({ date: "2026-03-01", ctl: 0, atl: 0, tsb: 0 }), undefined);
});

test("les charges sont regroupees par semaine ISO", () => {
  const weeks = weeklyLoads([
    { date: "2026-03-09", load: 50 },
    { date: "2026-03-11", load: 70 },
    { date: "2026-03-16", load: 40 },
  ]);
  assert.equal(weeks.length, 2);
  assert.equal(weeks[0]!.load, 120);
  assert.equal(isoWeekKey(new Date("2026-03-09T00:00:00Z")), "2026-S11");
});

test("la duree d'une seance de fractionne tient compte des repetitions", () => {
  const workout = intervals(profile, 10, 30, 30);
  // 15 min d'echauffement + 10 x 60 s + 10 min de retour au calme.
  assert.equal(workout.estimatedDuration, 15 * 60 + 10 * 60 + 10 * 60);
  assert.equal(stepsDuration(workout.steps), workout.estimatedDuration);
  assert.ok(workout.estimatedLoad > estimateLoad([{ label: "x", durationSec: 1500, zone: 2 }]));
});

test("le plan couvre la periode et se termine par la course", () => {
  const plan = generatePlan({
    goal: "10km",
    targetDate: "2026-06-14",
    startDate: "2026-03-16",
    profile,
  });

  assert.ok(plan.sessions.length > 30, `seances generees : ${plan.sessions.length}`);
  assert.equal(plan.sessions[plan.sessions.length - 1]!.date, "2026-06-14");
  assert.equal(plan.sessions[plan.sessions.length - 1]!.kind, "competition");

  // Les dates sont triees et aucune ne depasse l'objectif.
  for (let i = 1; i < plan.sessions.length; i++) {
    assert.ok(plan.sessions[i - 1]!.date <= plan.sessions[i]!.date);
    assert.ok(plan.sessions[i]!.date <= "2026-06-14");
  }

  // Chaque semaine compte le nombre de seances demande au profil.
  const week2 = plan.sessions.filter((s) => s.week === 2);
  assert.equal(week2.length, profile.weeklySessions);

  // La sortie longue de la semaine 2 est plus courte que celle de la semaine 10.
  const longRunOf = (week: number) =>
    plan.sessions.find((s) => s.week === week && s.kind === "sortie_longue");
  assert.ok(longRunOf(2)!.estimatedDuration < longRunOf(10)!.estimatedDuration);
});

test("la periodisation enchaine base, developpement, specifique puis affutage", () => {
  assert.equal(phaseForWeek(1, 12), "base");
  assert.equal(phaseForWeek(6, 12), "developpement");
  assert.equal(phaseForWeek(10, 12), "specifique");
  assert.equal(phaseForWeek(12, 12), "affutage");
});

test("un plan sans date coherente est refuse", () => {
  assert.throws(
    () => generatePlan({ goal: "5km", targetDate: "2026-01-01", startDate: "2026-03-01", profile }),
    /posterieure/,
  );
});

test("le plan ne place jamais deux jours durs consecutifs", () => {
  const hard = new Set(["fractionne", "seuil", "cote", "sortie_longue", "competition"]);
  for (const weeklySessions of [3, 4, 5, 6]) {
    const plan = generatePlan({
      goal: "semi",
      targetDate: "2026-06-14",
      startDate: "2026-03-16",
      profile: { ...profile, weeklySessions },
    });

    const hardDays = plan.sessions
      .filter((s) => hard.has(s.kind))
      .map((s) => Date.parse(s.date + "T00:00:00Z"))
      .sort((a, b) => a - b);

    for (let i = 1; i < hardDays.length; i++) {
      const gapDays = (hardDays[i]! - hardDays[i - 1]!) / 86_400_000;
      assert.ok(
        gapDays !== 1,
        `deux seances dures consecutives avec ${weeklySessions} seances par semaine, le ${new Date(hardDays[i]!).toISOString().slice(0, 10)}`,
      );
    }
  }
});

test("le coach reporte la seance de qualite prevue apres un effort intense la veille", () => {
  const plan = generatePlan({
    goal: "10km",
    targetDate: "2026-06-14",
    startDate: "2026-03-16",
    profile,
  });
  // On vise le premier jour de qualite reellement place par le plan.
  const planned = plan.sessions.find(
    (s) => s.week === 2 && (s.kind === "fractionne" || s.kind === "seuil" || s.kind === "cote"),
  );
  assert.ok(planned, "une seance de qualite est prevue en semaine 2");
  const today = planned.date;
  const veille = new Date(Date.parse(today + "T00:00:00Z") - 6 * 3600 * 1000).toISOString();

  const recommendation = recommendToday({
    profile,
    fitness: { date: today, ctl: 50, atl: 55, tsb: -5 },
    plan,
    recentActivities: [{ startTime: Date.parse(veille), metrics: { trainingLoad: 130 } }],
    today,
  });
  assert.equal(recommendation.workout.kind, "recuperation");
  assert.match(recommendation.warning ?? "", /reportee/);
});

test("hors plan, le coach ne propose pas de fractionne au lendemain d'une seance dure", () => {
  const recommendation = recommendToday({
    profile,
    fitness: { date: "2026-03-17", ctl: 50, atl: 52, tsb: -2 },
    recentActivities: [
      {
        startTime: Date.parse("2026-03-16T18:00:00Z"),
        metrics: { trainingLoad: 130 },
      },
    ],
    today: "2026-03-17",
  });
  assert.equal(recommendation.workout.kind, "recuperation");
  assert.equal(recommendation.warning, undefined);
});

test("le coach impose la recuperation en cas de surcharge", () => {
  const recommendation = recommendToday({
    profile,
    fitness: { date: "2026-03-17", ctl: 50, atl: 95, tsb: -45 },
    recentActivities: [],
    today: "2026-03-17",
  });
  assert.equal(recommendation.workout.kind, "recuperation");
  assert.match(recommendation.warning ?? "", /blessures/);
});

test("l'analyse post-seance signale une derive cardiaque elevee", () => {
  const activity: Activity = {
    id: "a1",
    userId: "u1",
    sport: "course",
    title: "Sortie longue",
    startTime: Date.UTC(2026, 2, 15, 9, 0, 0),
    elapsedTime: 5400,
    movingTime: 5400,
    distance: 15_000,
    elevationGain: 50,
    elevationLoss: 50,
    source: "fit100s",
    points: [],
    laps: [],
    createdAt: Date.now(),
    metrics: {
      trainingLoad: 140,
      avgPace: 360,
      decoupling: 11.2,
      hrZoneTimes: [0, 1200, 3000, 1200, 0],
    },
  };
  const feedback = analyzeSession(activity, profile);
  assert.match(feedback.headline, /15\.00 km/);
  assert.ok(feedback.insights.some((i) => /derive/.test(i)));
  assert.match(feedback.nextStep, /Grosse charge/);
});

test("une seance courte mais intense n'invite pas a enchainer une seance dure", () => {
  const base = {
    id: "a2",
    userId: "u1",
    sport: "course" as const,
    title: "Seuil 30 min",
    startTime: Date.UTC(2026, 2, 15, 18, 0, 0),
    elapsedTime: 1800,
    movingTime: 1800,
    distance: 7700,
    elevationGain: 10,
    elevationLoss: 10,
    source: "fit100s" as const,
    points: [],
    laps: [],
    createdAt: Date.now(),
  };

  // 30 min presque entierement en zone 4 : charge totale faible, intensite forte.
  const intense = analyzeSession(
    { ...base, metrics: { trainingLoad: 50, hrZoneTimes: [0, 100, 100, 1600, 0] } },
    profile,
  );
  assert.match(intense.nextStep, /Seance intense/);

  // Meme charge, mais en endurance : la qualite reste possible le lendemain.
  const easy = analyzeSession(
    { ...base, metrics: { trainingLoad: 50, hrZoneTimes: [200, 1600, 0, 0, 0] } },
    profile,
  );
  assert.match(easy.nextStep, /Charge legere/);
});
