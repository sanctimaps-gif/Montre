import { ZONE_COLORS } from "../format.ts";
import { duration } from "../format.ts";

const ZONE_NAMES = [
  "Z1 recuperation",
  "Z2 endurance",
  "Z3 tempo",
  "Z4 seuil",
  "Z5 VMA",
];

/** Repartition du temps passe dans chaque zone cardiaque. */
export function ZoneBar({ times }: { times: number[] }) {
  const total = times.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    return (
      <p className="aide">
        Aucune donnee cardiaque sur cette seance. Connecte la montre ou une ceinture pour
        obtenir la repartition par zone.
      </p>
    );
  }

  return (
    <div>
      <div className="zones">
        {times.map((seconds, i) => {
          const share = (seconds / total) * 100;
          if (share <= 0) return null;
          return (
            <span
              key={i}
              style={{ width: `${share}%`, background: ZONE_COLORS[i] }}
              title={`${ZONE_NAMES[i]} : ${duration(seconds)} (${Math.round(share)} %)`}
            >
              {share > 8 ? `Z${i + 1}` : ""}
            </span>
          );
        })}
      </div>
      <table style={{ marginTop: 12 }}>
        <tbody>
          {times.map((seconds, i) =>
            seconds > 0 ? (
              <tr key={i}>
                <td style={{ width: 18 }}>
                  <span
                    className="point"
                    style={{ color: ZONE_COLORS[i], display: "inline-block" }}
                  />
                </td>
                <td>{ZONE_NAMES[i]}</td>
                <td style={{ textAlign: "right" }}>{duration(seconds)}</td>
                <td style={{ textAlign: "right", color: "var(--texte-doux)" }}>
                  {Math.round((seconds / total) * 100)} %
                </td>
              </tr>
            ) : null,
          )}
        </tbody>
      </table>
    </div>
  );
}
