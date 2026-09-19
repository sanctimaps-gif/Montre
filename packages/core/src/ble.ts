/**
 * Decodage des trames Bluetooth standards emises par les montres et ceintures
 * de sport, telles que definies par le Bluetooth SIG.
 *
 * Ces fonctions sont pures : elles prennent la trame brute et rendent des
 * valeurs. C'est ce qui permet de les tester sans montre ni navigateur, alors
 * qu'elles portent la responsabilite la plus critique de la connexion — une
 * erreur de decalage d'un octet et la frequence cardiaque affichee est fausse.
 */

/** Mesure instantanee, agregee depuis les differents profils Bluetooth. */
export interface LiveSample {
  timestamp: number;
  /** Frequence cardiaque en battements par minute. */
  hr?: number;
  /** Intervalles RR en millisecondes, utiles pour la variabilite cardiaque. */
  rrIntervals?: number[];
  /** Energie depensee cumulee, en kilojoules, quand la montre la transmet. */
  energyKj?: number;
  /** Vrai si la montre signale un mauvais contact du capteur. */
  poorSensorContact?: boolean;
  /** Vitesse instantanee en m/s, issue du profil course. */
  speed?: number;
  /** Cadence en pas par minute. */
  cadence?: number;
  /** Longueur de foulee en metres. */
  strideLength?: number;
  /** Distance cumulee mesuree par la montre, en metres. */
  totalDistance?: number;
  /** Vrai en course, faux en marche, selon le drapeau de la trame. */
  running?: boolean;
  /** Niveau de batterie en pourcentage. */
  battery?: number;
}

/**
 * Caracteristique Heart Rate Measurement (0x2A37).
 *
 * Octet de drapeaux :
 *   bit 0    format de la FC : 0 = uint8, 1 = uint16
 *   bit 1    contact du capteur detecte
 *   bit 2    detection du contact prise en charge
 *   bit 3    depense energetique presente
 *   bit 4    intervalles RR presents
 */
export function parseHeartRateMeasurement(value: DataView): Partial<LiveSample> {
  if (value.byteLength < 2) return {};

  const flags = value.getUint8(0);
  const is16Bit = (flags & 0x01) !== 0;
  const contactSupported = (flags & 0x04) !== 0;
  const contactDetected = (flags & 0x02) !== 0;
  const hasEnergy = (flags & 0x08) !== 0;
  const hasRr = (flags & 0x10) !== 0;

  let offset = 1;
  const hr = is16Bit ? value.getUint16(offset, true) : value.getUint8(offset);
  offset += is16Bit ? 2 : 1;

  let energyKj: number | undefined;
  if (hasEnergy && offset + 2 <= value.byteLength) {
    energyKj = value.getUint16(offset, true);
    offset += 2;
  }

  const rrIntervals: number[] = [];
  if (hasRr) {
    while (offset + 2 <= value.byteLength) {
      // Les intervalles RR sont exprimes en 1/1024 de seconde.
      rrIntervals.push(Math.round((value.getUint16(offset, true) / 1024) * 1000));
      offset += 2;
    }
  }

  return {
    hr,
    energyKj,
    rrIntervals: rrIntervals.length > 0 ? rrIntervals : undefined,
    // Le contact n'a de sens que si la montre declare le prendre en charge.
    poorSensorContact: contactSupported ? !contactDetected : undefined,
  };
}

/**
 * Caracteristique RSC Measurement (0x2A53).
 *
 * Octet de drapeaux :
 *   bit 0 longueur de foulee presente
 *   bit 1 distance totale presente
 *   bit 2 course (1) ou marche (0)
 */
export function parseRscMeasurement(value: DataView): Partial<LiveSample> {
  if (value.byteLength < 4) return {};

  const flags = value.getUint8(0);
  const hasStride = (flags & 0x01) !== 0;
  const hasDistance = (flags & 0x02) !== 0;
  const running = (flags & 0x04) !== 0;

  // Vitesse en unites de 1/256 m/s, cadence en pas par minute.
  const speed = value.getUint16(1, true) / 256;
  const cadence = value.getUint8(3);
  let offset = 4;

  let strideLength: number | undefined;
  if (hasStride && offset + 2 <= value.byteLength) {
    strideLength = value.getUint16(offset, true) / 100;
    offset += 2;
  }

  let totalDistance: number | undefined;
  if (hasDistance && offset + 4 <= value.byteLength) {
    // Distance totale en decimetres.
    totalDistance = value.getUint32(offset, true) / 10;
  }

  return { speed, cadence, strideLength, totalDistance, running };
}

/** Caracteristique Battery Level (0x2A19) : un octet, de 0 a 100. */
export function parseBatteryLevel(value: DataView): Partial<LiveSample> {
  if (value.byteLength < 1) return {};
  const battery = value.getUint8(0);
  return battery <= 100 ? { battery } : {};
}
