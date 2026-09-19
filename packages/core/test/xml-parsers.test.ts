import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGpx } from "../src/parsers/gpx.ts";
import { parseTcx } from "../src/parsers/tcx.ts";
import { parseActivityFile } from "../src/parsers/index.ts";

const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="Decathlon Coach" version="1.1"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <trk>
    <name>Sortie du dimanche</name>
    <type>running</type>
    <trkseg>
      <trkpt lat="48.8566" lon="2.3522">
        <ele>35.0</ele>
        <time>2026-03-14T09:00:00Z</time>
        <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>138</gpxtpx:hr><gpxtpx:cad>85</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions>
      </trkpt>
      <trkpt lat="48.8576" lon="2.3532">
        <ele>38.0</ele>
        <time>2026-03-14T09:00:30Z</time>
        <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>145</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`;

const TCX = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Running">
      <Id>2026-03-14T09:00:00Z</Id>
      <Lap StartTime="2026-03-14T09:00:00Z">
        <TotalTimeSeconds>600.0</TotalTimeSeconds>
        <DistanceMeters>2000.0</DistanceMeters>
        <Calories>150</Calories>
        <AverageHeartRateBpm><Value>142</Value></AverageHeartRateBpm>
        <MaximumHeartRateBpm><Value>158</Value></MaximumHeartRateBpm>
        <Track>
          <Trackpoint>
            <Time>2026-03-14T09:00:00Z</Time>
            <Position><LatitudeDegrees>48.8566</LatitudeDegrees><LongitudeDegrees>2.3522</LongitudeDegrees></Position>
            <AltitudeMeters>35.0</AltitudeMeters>
            <DistanceMeters>0.0</DistanceMeters>
            <HeartRateBpm><Value>138</Value></HeartRateBpm>
            <Cadence>85</Cadence>
          </Trackpoint>
          <Trackpoint>
            <Time>2026-03-14T09:05:00Z</Time>
            <Position><LatitudeDegrees>48.8666</LatitudeDegrees><LongitudeDegrees>2.3622</LongitudeDegrees></Position>
            <AltitudeMeters>45.0</AltitudeMeters>
            <DistanceMeters>1000.0</DistanceMeters>
            <HeartRateBpm><Value>150</Value></HeartRateBpm>
            <Cadence>88</Cadence>
          </Trackpoint>
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;

test("decode un GPX avec extensions cardio", () => {
  const activity = parseGpx(GPX);
  assert.equal(activity.sport, "course");
  assert.equal(activity.title, "Sortie du dimanche");
  assert.equal(activity.points.length, 2);
  assert.equal(activity.points[0]!.hr, 138);
  assert.equal(activity.points[0]!.cadence, 85);
  assert.equal(activity.points[1]!.alt, 38);
  assert.equal(activity.startTime, Date.parse("2026-03-14T09:00:00Z"));
});

test("decode un TCX avec ses tours", () => {
  const activity = parseTcx(TCX);
  assert.equal(activity.sport, "course");
  assert.equal(activity.laps.length, 1);
  assert.equal(activity.laps[0]!.distance, 2000);
  assert.equal(activity.laps[0]!.avgHr, 142);
  assert.equal(activity.maxHr, 158);
  assert.equal(activity.calories, 150);
  assert.equal(activity.points.length, 2);
  assert.equal(activity.points[1]!.distance, 1000);
});

test("detecte automatiquement le format XML", () => {
  const encoder = new TextEncoder();
  assert.equal(parseActivityFile(encoder.encode(GPX)).format, "gpx");
  assert.equal(parseActivityFile(encoder.encode(TCX)).format, "tcx");
});

test("signale clairement un format inconnu", () => {
  assert.throws(
    () => parseActivityFile(new TextEncoder().encode("donnees quelconques")),
    /Format non reconnu/,
  );
});
