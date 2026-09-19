import type { Workout, WorkoutStep } from "@montre/core";
import { KIND_COLORS, KIND_LABELS, ZONE_COLORS, durationWords, pace } from "../format.ts";

/** Affichage detaille d'une seance : blocs, repetitions, zones et allures. */
export function WorkoutSteps({ steps }: { steps: WorkoutStep[] }) {
  if (steps.length === 0) return null;
  return (
    <div>
      {steps.map((step, i) => (
        <StepRow key={i} step={step} />
      ))}
    </div>
  );
}

function StepRow({ step }: { step: WorkoutStep }) {
  const color = step.zone ? ZONE_COLORS[step.zone - 1]! : "#9aa7b8";

  const detail: string[] = [];
  if (step.durationSec) detail.push(durationWords(step.durationSec));
  if (step.distanceM) detail.push(`${step.distanceM} m`);
  if (step.targetPace) detail.push(`${pace(step.targetPace)}/km`);

  return (
    <>
      <div className="etape">
        <span className="barre" style={{ background: color }} />
        <div>
          <div style={{ fontWeight: 600 }}>
            {step.repeat && step.repeat > 1 ? `${step.repeat} x ` : ""}
            {step.label}
          </div>
          {step.zone && (
            <div style={{ fontSize: 12, color: "var(--texte-doux)" }}>Zone {step.zone}</div>
          )}
        </div>
        {detail.length > 0 && <div className="detail">{detail.join(" · ")}</div>}
      </div>
      {step.children && step.children.length > 0 && (
        <div className="sous-etapes">
          {step.children.map((child, i) => (
            <StepRow key={i} step={child} />
          ))}
        </div>
      )}
    </>
  );
}

/** Carte resumant une seance : type, duree, charge et description. */
export function WorkoutCard({
  workout,
  children,
}: {
  workout: Workout;
  children?: React.ReactNode;
}) {
  return (
    <div className="carte accent">
      <div className="entete" style={{ marginBottom: 10 }}>
        <div>
          <span
            className="etiquette"
            style={{ color: KIND_COLORS[workout.kind], borderColor: KIND_COLORS[workout.kind] }}
          >
            {KIND_LABELS[workout.kind] ?? workout.kind}
          </span>
          <h2 style={{ marginTop: 10 }}>{workout.title}</h2>
        </div>
        {workout.estimatedDuration > 0 && (
          <div style={{ textAlign: "right" }}>
            <div className="stat">
              <div className="valeur">{durationWords(workout.estimatedDuration)}</div>
              <div className="libelle">charge {workout.estimatedLoad}</div>
            </div>
          </div>
        )}
      </div>
      <p className="sous-titre" style={{ marginBottom: 16 }}>
        {workout.description}
      </p>
      <WorkoutSteps steps={workout.steps} />
      {children}
    </div>
  );
}
