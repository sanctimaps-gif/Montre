import type { TrackPoint } from "@montre/core";

/**
 * Trace de la sortie, dessinee en SVG a partir des coordonnees GPS.
 *
 * Aucun fond de carte n'est charge : cela evite de dependre d'un fournisseur
 * de tuiles, de faire fuiter les positions de l'athlete vers un tiers, et cela
 * fonctionne hors ligne. La forme du parcours suffit a le reconnaitre.
 */
export function TrackMap({
  points,
  height = 240,
  color = "#fc5200",
}: {
  points: TrackPoint[];
  height?: number;
  color?: string;
}) {
  const located = points.filter(
    (p): p is TrackPoint & { lat: number; lon: number } => p.lat != null && p.lon != null,
  );

  if (located.length < 2) {
    return (
      <div className="vide" style={{ padding: 24 }}>
        Cette seance ne contient pas de trace GPS.
      </div>
    );
  }

  const lats = located.map((p) => p.lat);
  const lons = located.map((p) => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);

  // A nos latitudes, un degre de longitude est plus court qu'un degre de
  // latitude : sans cette correction, les parcours paraissent etires.
  const latCenter = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const lonScale = Math.cos(latCenter);

  const spanLat = Math.max(maxLat - minLat, 1e-6);
  const spanLon = Math.max((maxLon - minLon) * lonScale, 1e-6);

  const padding = 14;
  const width = 800;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const scale = Math.min(innerWidth / spanLon, innerHeight / spanLat);

  // Centrage du trace dans la zone de dessin.
  const offsetX = padding + (innerWidth - spanLon * scale) / 2;
  const offsetY = padding + (innerHeight - spanLat * scale) / 2;

  const project = (p: { lat: number; lon: number }): [number, number] => [
    offsetX + (p.lon - minLon) * lonScale * scale,
    // L'axe vertical du SVG est inverse par rapport a la latitude.
    offsetY + (maxLat - p.lat) * scale,
  ];

  const path = located.map(project).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`);
  const [startX, startY] = project(located[0]!);
  const [endX, endY] = project(located[located.length - 1]!);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: "100%", height: "auto", display: "block" }}
      role="img"
      aria-label="Trace du parcours"
    >
      <polyline
        points={path.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.9"
      />
      <circle cx={startX} cy={startY} r="6" fill="#35c47d" stroke="#0b1016" strokeWidth="2">
        <title>Depart</title>
      </circle>
      <circle cx={endX} cy={endY} r="6" fill="#e5484d" stroke="#0b1016" strokeWidth="2">
        <title>Arrivee</title>
      </circle>
    </svg>
  );
}
