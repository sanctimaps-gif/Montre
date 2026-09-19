import type { ReactNode } from "react";

/**
 * Graphiques en SVG, sans bibliotheque externe. Les besoins sont simples
 * (courbes de forme, profil cardiaque, barres hebdomadaires) et une
 * implementation directe evite 200 Ko de dependances pour quelques polylignes.
 */

export interface Series {
  label: string;
  color: string;
  values: Array<number | null>;
  /** Remplissage sous la courbe. */
  fill?: boolean;
  dashed?: boolean;
}

interface LineChartProps {
  series: Series[];
  labels?: string[];
  height?: number;
  /** Formatage des valeurs de l'axe vertical. */
  formatValue?: (value: number) => string;
  /** Ligne horizontale de reference, par exemple le zero de la fraicheur. */
  baseline?: number;
}

export function LineChart({
  series,
  labels,
  height = 180,
  formatValue = (v) => String(Math.round(v)),
  baseline,
}: LineChartProps) {
  const width = 800;
  const padding = { top: 12, right: 12, bottom: 22, left: 40 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  if (all.length === 0) {
    return <p className="vide">Pas encore assez de donnees pour tracer cette courbe.</p>;
  }

  let min = Math.min(...all, baseline ?? Infinity);
  let max = Math.max(...all, baseline ?? -Infinity);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  // Marge de 8 % pour que les courbes ne touchent pas les bords.
  const margin = (max - min) * 0.08;
  min -= margin;
  max += margin;

  const count = Math.max(...series.map((s) => s.values.length));
  const x = (i: number) => padding.left + (count <= 1 ? 0 : (i / (count - 1)) * innerWidth);
  const y = (value: number) =>
    padding.top + innerHeight - ((value - min) / (max - min)) * innerHeight;

  const ticks = [min, (min + max) / 2, max];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: "100%", height: "auto", display: "block" }}
      role="img"
      aria-label={series.map((s) => s.label).join(", ")}
    >
      {ticks.map((tick, i) => (
        <g key={i}>
          <line
            x1={padding.left}
            x2={width - padding.right}
            y1={y(tick)}
            y2={y(tick)}
            stroke="#263141"
            strokeWidth="1"
          />
          <text x={4} y={y(tick) + 4} fill="#9aa7b8" fontSize="11">
            {formatValue(tick)}
          </text>
        </g>
      ))}

      {baseline != null && (
        <line
          x1={padding.left}
          x2={width - padding.right}
          y1={y(baseline)}
          y2={y(baseline)}
          stroke="#9aa7b8"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
      )}

      {series.map((s) => {
        const points = s.values
          .map((value, i) => (value == null ? null : `${x(i)},${y(value)}`))
          .filter((p): p is string => p != null);
        if (points.length === 0) return null;

        return (
          <g key={s.label}>
            {s.fill && (
              <polygon
                points={`${padding.left},${padding.top + innerHeight} ${points.join(" ")} ${
                  x(s.values.length - 1)
                },${padding.top + innerHeight}`}
                fill={s.color}
                opacity="0.12"
              />
            )}
            <polyline
              points={points.join(" ")}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={s.dashed ? "5 4" : undefined}
            />
          </g>
        );
      })}

      {labels && labels.length > 0 && (
        <>
          <text x={padding.left} y={height - 5} fill="#9aa7b8" fontSize="11">
            {labels[0]}
          </text>
          <text
            x={width - padding.right}
            y={height - 5}
            fill="#9aa7b8"
            fontSize="11"
            textAnchor="end"
          >
            {labels[labels.length - 1]}
          </text>
        </>
      )}
    </svg>
  );
}

interface BarChartProps {
  values: Array<{ label: string; value: number }>;
  color?: string;
  height?: number;
  formatValue?: (value: number) => string;
}

export function BarChart({
  values,
  color = "#fc5200",
  height = 160,
  formatValue = (v) => String(Math.round(v)),
}: BarChartProps) {
  if (values.length === 0) {
    return <p className="vide">Aucune donnee sur la periode.</p>;
  }

  const width = 800;
  const padding = { top: 10, right: 8, bottom: 24, left: 40 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const max = Math.max(...values.map((v) => v.value), 1);
  const slot = innerWidth / values.length;
  // Plafond de largeur : sans lui, une seule semaine de donnees produirait une
  // barre large de tout le graphique.
  const barWidth = Math.min(48, Math.max(3, slot * 0.6));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: "100%", height: "auto", display: "block" }}
      role="img"
    >
      <line
        x1={padding.left}
        x2={width - padding.right}
        y1={padding.top + innerHeight}
        y2={padding.top + innerHeight}
        stroke="#263141"
      />
      <text x={4} y={padding.top + 10} fill="#9aa7b8" fontSize="11">
        {formatValue(max)}
      </text>

      {values.map((entry, i) => {
        const barHeight = (entry.value / max) * innerHeight;
        const x = padding.left + i * slot + (slot - barWidth) / 2;
        return (
          <g key={entry.label}>
            <rect
              x={x}
              y={padding.top + innerHeight - barHeight}
              width={barWidth}
              height={Math.max(1, barHeight)}
              rx="3"
              fill={color}
              opacity={0.55 + 0.45 * (entry.value / max)}
            >
              <title>{`${entry.label} : ${formatValue(entry.value)}`}</title>
            </rect>
          </g>
        );
      })}

      <text x={padding.left} y={height - 6} fill="#9aa7b8" fontSize="11">
        {values[0]?.label}
      </text>
      <text
        x={width - padding.right}
        y={height - 6}
        fill="#9aa7b8"
        fontSize="11"
        textAnchor="end"
      >
        {values[values.length - 1]?.label}
      </text>
    </svg>
  );
}

export function Legende({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 16,
        flexWrap: "wrap",
        fontSize: 12.5,
        color: "var(--texte-doux)",
        marginTop: 8,
      }}
    >
      {children}
    </div>
  );
}

export function PuceLegende({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          width: 10,
          height: 3,
          borderRadius: 2,
          background: color,
          display: "inline-block",
        }}
      />
      {children}
    </span>
  );
}
