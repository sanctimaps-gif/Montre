#!/usr/bin/env node
/**
 * Genere les icones de l'application installee.
 *
 * Les icones sont dessinees ici plutot que stockees en binaire : le dessin
 * reste lisible et modifiable, et le depot ne porte pas d'images opaques que
 * personne ne saurait regenerer. L'encodeur PNG tient en quelques lignes
 * puisque zlib est fourni par Node.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "apps/web/public");

const FOND = [0x0b, 0x10, 0x16];
const ORANGE = [0xfc, 0x52, 0x00];
const CLAIR = [0xe9, 0xee, 0xf5];

/** Table de CRC32, utilisee par le format PNG pour chaque bloc. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Encode une image RGBA en PNG. */
function encodePng(width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 8 bits par canal
  header[9] = 6; // RGBA
  // Les octets 10 a 12 (compression, filtre, entrelacement) restent a zero.

  // Chaque ligne est precedee de son octet de filtre, ici toujours "aucun".
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const start = y * (width * 4 + 1);
    raw[start] = 0;
    pixels.copy(raw, start + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Dessine l'icone : un cadran de montre, aiguilles a 10 h 10. Le rendu est
 * calcule en quadruple resolution puis reduit, ce qui lisse les bords sans
 * avoir a implementer d'anticrenelage.
 */
function drawIcon(size, { padding = 0, rounded = true } = {}) {
  const scale = 4;
  const big = size * scale;
  const samples = new Float32Array(big * big * 4);

  const center = big / 2;
  const inset = padding * scale;
  const radius = (big - inset * 2) / 2;
  const ringWidth = radius * 0.13;
  const ringRadius = radius * 0.72;
  const cornerRadius = rounded ? big * 0.22 : 0;

  const put = (x, y, color, alpha = 1) => {
    const index = (y * big + x) * 4;
    for (let c = 0; c < 3; c++) {
      samples[index + c] = samples[index + c] * (1 - alpha) + color[c] * alpha;
    }
    samples[index + 3] = Math.max(samples[index + 3], alpha * 255);
  };

  for (let y = 0; y < big; y++) {
    for (let x = 0; x < big; x++) {
      // Fond : carre aux angles arrondis.
      const dxCorner = Math.max(cornerRadius - x, x - (big - cornerRadius), 0);
      const dyCorner = Math.max(cornerRadius - y, y - (big - cornerRadius), 0);
      if (Math.hypot(dxCorner, dyCorner) <= cornerRadius) {
        put(x, y, FOND, 1);
      }

      const dx = x - center;
      const dy = y - center;
      const distance = Math.hypot(dx, dy);

      // Anneau du cadran.
      if (Math.abs(distance - ringRadius) <= ringWidth / 2) {
        put(x, y, ORANGE, 1);
      }
    }
  }

  // Aiguilles : une grande vers midi, une petite vers deux heures.
  const hand = (angle, length, thickness, color) => {
    const dirX = Math.sin(angle);
    const dirY = -Math.cos(angle);
    const steps = Math.ceil(length * 2);
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * length;
      const px = center + dirX * t;
      const py = center + dirY * t;
      const half = Math.ceil(thickness / 2);
      for (let oy = -half; oy <= half; oy++) {
        for (let ox = -half; ox <= half; ox++) {
          if (Math.hypot(ox, oy) > thickness / 2) continue;
          const x = Math.round(px + ox);
          const y = Math.round(py + oy);
          if (x >= 0 && y >= 0 && x < big && y < big) put(x, y, color, 1);
        }
      }
    }
  };

  hand(0, ringRadius * 0.62, ringWidth * 0.55, CLAIR);
  hand(Math.PI / 3, ringRadius * 0.44, ringWidth * 0.55, ORANGE);

  // Reduction : moyenne des blocs de scale x scale.
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const index = ((y * scale + sy) * big + x * scale + sx) * 4;
          r += samples[index];
          g += samples[index + 1];
          b += samples[index + 2];
          a += samples[index + 3];
        }
      }
      const count = scale * scale;
      const out = (y * size + x) * 4;
      pixels[out] = Math.round(r / count);
      pixels[out + 1] = Math.round(g / count);
      pixels[out + 2] = Math.round(b / count);
      pixels[out + 3] = Math.round(a / count);
    }
  }

  return encodePng(size, size, pixels);
}

mkdirSync(outDir, { recursive: true });

const icons = [
  { name: "icone-192.png", size: 192, options: {} },
  { name: "icone-512.png", size: 512, options: {} },
  // Icone masquable : le systeme peut la rogner, d'ou la marge de securite.
  { name: "icone-maskable-512.png", size: 512, options: { padding: 64, rounded: false } },
  // iOS applique lui-meme les angles arrondis : le fond doit etre plein.
  { name: "apple-touch-icon.png", size: 180, options: { rounded: false } },
];

for (const icon of icons) {
  const png = drawIcon(icon.size, icon.options);
  writeFileSync(resolve(outDir, icon.name), png);
  console.log(`${icon.name.padEnd(28)} ${String(png.length).padStart(7)} octets`);
}
