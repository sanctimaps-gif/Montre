import type { Activity, TrackPoint } from "./types.ts";

/**
 * Serialisation d'une activite en TCX. C'est le format retenu pour televerser
 * vers Strava une seance enregistree en direct par l'application : contrairement
 * au GPX il transporte nativement la distance, la frequence cardiaque, la
 * cadence et les tours.
 */
export function activityToTcx(activity: Activity): string {
  const sport = tcxSport(activity.sport);
  const start = new Date(activity.startTime).toISOString();
  const laps = activity.laps.length > 0 ? activity.laps : [syntheticLap(activity)];

  const lapXml = laps
    .map((lap) => {
      const lapEnd = lap.startTime + lap.duration * 1000;
      const lapPoints = activity.points.filter(
        (p) => p.t >= lap.startTime && p.t <= lapEnd,
      );
      return `      <Lap StartTime="${new Date(lap.startTime).toISOString()}">
        <TotalTimeSeconds>${lap.duration.toFixed(1)}</TotalTimeSeconds>
        <DistanceMeters>${lap.distance.toFixed(1)}</DistanceMeters>
${lap.avgHr ? `        <AverageHeartRateBpm><Value>${Math.round(lap.avgHr)}</Value></AverageHeartRateBpm>\n` : ""}${lap.maxHr ? `        <MaximumHeartRateBpm><Value>${Math.round(lap.maxHr)}</Value></MaximumHeartRateBpm>\n` : ""}        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>
${lapPoints.map(trackpointXml).join("\n")}
        </Track>
      </Lap>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase
  xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
  <Activities>
    <Activity Sport="${sport}">
      <Id>${start}</Id>
${lapXml}
      <Notes>${escapeXml(activity.title)}</Notes>
      <Creator xsi:type="Device_t" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
        <Name>Decathlon Fit 100 S via Montre</Name>
      </Creator>
    </Activity>
  </Activities>
</TrainingCenterDatabase>
`;
}

function trackpointXml(point: TrackPoint): string {
  const parts: string[] = [
    `          <Trackpoint>`,
    `            <Time>${new Date(point.t).toISOString()}</Time>`,
  ];
  if (point.lat != null && point.lon != null) {
    parts.push(
      `            <Position><LatitudeDegrees>${point.lat.toFixed(7)}</LatitudeDegrees><LongitudeDegrees>${point.lon.toFixed(7)}</LongitudeDegrees></Position>`,
    );
  }
  if (point.alt != null) {
    parts.push(`            <AltitudeMeters>${point.alt.toFixed(1)}</AltitudeMeters>`);
  }
  if (point.distance != null) {
    parts.push(`            <DistanceMeters>${point.distance.toFixed(1)}</DistanceMeters>`);
  }
  if (point.hr != null) {
    parts.push(
      `            <HeartRateBpm><Value>${Math.round(point.hr)}</Value></HeartRateBpm>`,
    );
  }
  if (point.cadence != null) {
    parts.push(`            <Cadence>${Math.round(point.cadence)}</Cadence>`);
  }
  if (point.speed != null || point.power != null) {
    const speed = point.speed != null ? `<ns3:Speed>${point.speed.toFixed(3)}</ns3:Speed>` : "";
    const watts = point.power != null ? `<ns3:Watts>${Math.round(point.power)}</ns3:Watts>` : "";
    parts.push(
      `            <Extensions><ns3:TPX>${speed}${watts}</ns3:TPX></Extensions>`,
    );
  }
  parts.push(`          </Trackpoint>`);
  return parts.join("\n");
}

function syntheticLap(activity: Activity) {
  return {
    index: 1,
    startTime: activity.startTime,
    duration: activity.elapsedTime,
    distance: activity.distance,
    avgHr: activity.avgHr,
    maxHr: activity.maxHr,
  };
}

function tcxSport(sport: Activity["sport"]): string {
  switch (sport) {
    case "course":
    case "trail":
    case "marche":
      return "Running";
    case "velo":
      return "Biking";
    default:
      return "Other";
  }
}

/** Serialisation en GPX, pour l'export vers un outil tiers. */
export function activityToGpx(activity: Activity): string {
  const points = activity.points
    .filter((p) => p.lat != null && p.lon != null)
    .map((p) => {
      const extensions =
        p.hr != null || p.cadence != null
          ? `\n        <extensions><gpxtpx:TrackPointExtension>${
              p.hr != null ? `<gpxtpx:hr>${Math.round(p.hr)}</gpxtpx:hr>` : ""
            }${
              p.cadence != null ? `<gpxtpx:cad>${Math.round(p.cadence)}</gpxtpx:cad>` : ""
            }</gpxtpx:TrackPointExtension></extensions>`
          : "";
      return `      <trkpt lat="${p.lat!.toFixed(7)}" lon="${p.lon!.toFixed(7)}">${
        p.alt != null ? `\n        <ele>${p.alt.toFixed(1)}</ele>` : ""
      }\n        <time>${new Date(p.t).toISOString()}</time>${extensions}
      </trkpt>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Montre"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <metadata><time>${new Date(activity.startTime).toISOString()}</time></metadata>
  <trk>
    <name>${escapeXml(activity.title)}</name>
    <type>${activity.sport}</type>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>
`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
