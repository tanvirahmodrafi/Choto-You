/**
 * The artwork for "Pip", an ORIGINAL placeholder companion character.
 *
 * Everything is drawn from signed-distance functions and supersampled for
 * anti-aliasing, so the character is procedural rather than a copied asset.
 * Shared by the sprite-frame generator and the app-icon generator.
 */

export const FRAME_SIZE = 96; // logical frame size, square
const SS = 3; // supersampling factor

// --- palettes (original) --------------------------------------------------
// The shapes are shared; a variant is purely a recolour. Keeping them here
// rather than in the generator means the icon generator gets them too.
export const PALETTES = {
  pip: {
    name: 'Pip',
    OUTLINE: [31, 62, 72, 255],
    BODY: [107, 214, 199, 255],
    BODY_SHADE: [72, 173, 161, 255],
    VISOR: [26, 39, 51, 255],
    EYE: [164, 243, 233, 255],
    LIMB: [46, 139, 132, 255],
    BULB_ON: [255, 200, 87, 255],
    BULB_OFF: [176, 136, 62, 255],
  },
  mochi: {
    name: 'Mochi',
    OUTLINE: [74, 40, 56, 255],
    BODY: [247, 176, 193, 255],
    BODY_SHADE: [222, 134, 158, 255],
    VISOR: [48, 26, 38, 255],
    EYE: [255, 226, 234, 255],
    LIMB: [198, 112, 138, 255],
    BULB_ON: [255, 233, 150, 255],
    BULB_OFF: [182, 156, 96, 255],
  },
  nimbus: {
    name: 'Nimbus',
    OUTLINE: [38, 39, 74, 255],
    BODY: [150, 162, 240, 255],
    BODY_SHADE: [108, 120, 206, 255],
    VISOR: [23, 24, 46, 255],
    EYE: [214, 224, 255, 255],
    LIMB: [96, 106, 186, 255],
    BULB_ON: [137, 232, 209, 255],
    BULB_OFF: [92, 158, 143, 255],
  },
  ember: {
    name: 'Ember',
    OUTLINE: [66, 35, 28, 255],
    BODY: [245, 160, 110, 255],
    BODY_SHADE: [214, 120, 72, 255],
    VISOR: [40, 22, 18, 255],
    EYE: [255, 222, 196, 255],
    LIMB: [192, 104, 62, 255],
    BULB_ON: [255, 238, 170, 255],
    BULB_OFF: [178, 162, 112, 255],
  },
};

/**
 * The palette the next `pose()` call will use.
 *
 * Module-level rather than a `pose()` argument so the generators, which call
 * `pose()` through `ANIMATIONS`, do not each have to thread it through.
 */
let active = PALETTES.pip;

export function usePalette(id) {
  const palette = PALETTES[id];
  if (!palette) throw new Error(`Unknown palette "${id}"`);
  active = palette;
  return palette;
}

export function paletteIds() {
  return Object.keys(PALETTES);
}

// --- signed distance helpers ---------------------------------------------
const circle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r;

const roundedBox = (cx, cy, hw, hh, r) => (x, y) => {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};

const capsule = (ax, ay, bx, by, r) => (x, y) => {
  const pax = x - ax;
  const pay = y - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const denom = bax * bax + bay * bay;
  const h = denom === 0 ? 0 : Math.min(1, Math.max(0, (pax * bax + pay * bay) / denom));
  return Math.hypot(pax - bax * h, pay - bay * h) - r;
};

/** Grows a shape outward, used to draw the outline behind a fill. */
const grow = (sdf, amount) => (x, y) => sdf(x, y) - amount;

// --- renderer -------------------------------------------------------------
/**
 * Paints layers back-to-front. For each subsample the last layer whose
 * distance is negative wins; averaging the subsamples yields the AA edges.
 */
export function render(layers, size = FRAME_SIZE) {
  const out = Buffer.alloc(size * size * 4);
  const scale = size / FRAME_SIZE;
  const subs = SS * SS;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          // Sample in the character's own 96x96 space so one SDF set serves any size.
          const x = (px + (sx + 0.5) / SS) / scale;
          const y = (py + (sy + 0.5) / SS) / scale;
          let hit = null;
          for (const layer of layers) {
            if (layer.sdf(x, y) < 0) hit = layer.color;
          }
          if (hit) {
            r += hit[0];
            g += hit[1];
            b += hit[2];
            a += hit[3];
          }
        }
      }
      const i = (py * size + px) * 4;
      if (a > 0) {
        // Average only over the covered subsamples so edge colour stays true
        // while alpha carries the partial coverage.
        const covered = a / 255;
        out[i] = Math.round(r / covered);
        out[i + 1] = Math.round(g / covered);
        out[i + 2] = Math.round(b / covered);
        out[i + 3] = Math.round(a / subs);
      }
    }
  }
  return out;
}

// --- character construction ----------------------------------------------
/**
 * @param {object} pose
 * @param {number} pose.bob      vertical body offset in px (negative = up)
 * @param {number} pose.lean     horizontal body offset in px
 * @param {number} pose.legFront offset of the near leg
 * @param {number} pose.legBack  offset of the far leg
 * @param {number} pose.bulb     0..1 antenna glow
 * @param {number} pose.eyeOpen  0..1 eyelid openness
 * @param {number} pose.armDrop  how far the arms hang down
 * @param {number} pose.armWave raises the near arm only, for waving
 */
export function pose({ bob = 0, lean = 0, legFront = 0, legBack = 0, bulb = 1, eyeOpen = 1, armDrop = 0, armWave = 0 }) {
  const cx = FRAME_SIZE / 2 + lean;
  const groundY = 82;
  const bodyCy = 52 + bob;

  const footL = capsule(cx - 11 + legBack, groundY + bob * 0.3, cx - 7 + legBack, groundY + bob * 0.3, 5);
  const footR = capsule(cx + 7 + legFront, groundY + bob * 0.3, cx + 11 + legFront, groundY + bob * 0.3, 5);

  const legL = capsule(cx - 9, bodyCy + 16, cx - 9 + legBack, groundY - 2 + bob * 0.3, 3.5);
  const legR = capsule(cx + 9, bodyCy + 16, cx + 9 + legFront, groundY - 2 + bob * 0.3, 3.5);

  const body = roundedBox(cx, bodyCy, 19, 21, 14);
  const bodyShade = roundedBox(cx + 7, bodyCy + 4, 12, 16, 11);

  const armL = capsule(cx - 19, bodyCy - 2, cx - 23, bodyCy + 8 + armDrop, 4);
  const armR = capsule(cx + 19, bodyCy - 2, cx + 23 + armWave * 0.4, bodyCy + 8 + armDrop - armWave, 4);

  const visor = roundedBox(cx, bodyCy - 4, 13, 9, 6.5);
  const eyeH = 3.2 * eyeOpen + 0.6;
  const eyeL = roundedBox(cx - 5.5, bodyCy - 4, 2.6, eyeH, 2.4);
  const eyeR = roundedBox(cx + 5.5, bodyCy - 4, 2.6, eyeH, 2.4);

  const stalk = capsule(cx, bodyCy - 21, cx + 1, bodyCy - 30, 1.6);
  const bulbShape = circle(cx + 1, bodyCy - 33, 3.4 + bulb * 0.8);
  const bulbColor = [
    Math.round(active.BULB_OFF[0] + (active.BULB_ON[0] - active.BULB_OFF[0]) * bulb),
    Math.round(active.BULB_OFF[1] + (active.BULB_ON[1] - active.BULB_OFF[1]) * bulb),
    Math.round(active.BULB_OFF[2] + (active.BULB_ON[2] - active.BULB_OFF[2]) * bulb),
    255,
  ];

  // Order matters: each outline is the same shape grown by ~2px, drawn first.
  return [
    { sdf: grow(legL, 2), color: active.OUTLINE },
    { sdf: grow(legR, 2), color: active.OUTLINE },
    { sdf: legL, color: active.LIMB },
    { sdf: legR, color: active.LIMB },
    { sdf: grow(footL, 2), color: active.OUTLINE },
    { sdf: grow(footR, 2), color: active.OUTLINE },
    { sdf: footL, color: active.LIMB },
    { sdf: footR, color: active.LIMB },
    { sdf: grow(armL, 2), color: active.OUTLINE },
    { sdf: grow(armR, 2), color: active.OUTLINE },
    { sdf: armL, color: active.LIMB },
    { sdf: armR, color: active.LIMB },
    { sdf: grow(stalk, 2), color: active.OUTLINE },
    { sdf: stalk, color: active.LIMB },
    { sdf: grow(bulbShape, 2), color: active.OUTLINE },
    { sdf: bulbShape, color: bulbColor },
    { sdf: grow(body, 2), color: active.OUTLINE },
    { sdf: body, color: active.BODY },
    { sdf: (x, y) => Math.max(bodyShade(x, y), body(x, y)), color: active.BODY_SHADE },
    { sdf: grow(visor, 2), color: active.OUTLINE },
    { sdf: visor, color: active.VISOR },
    { sdf: eyeL, color: active.EYE },
    { sdf: eyeR, color: active.EYE },
  ];
}

const TAU = Math.PI * 2;

/** @type {Record<string, { frames: number, pose: (t: number, i: number) => object }>} */
export const ANIMATIONS = {
  idle: {
    frames: 8,
    // Gentle breathing bob, with a blink on a single frame.
    pose: (t, i) => ({
      bob: Math.sin(t * TAU) * 1.6,
      bulb: 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * TAU)),
      eyeOpen: i === 5 ? 0.1 : 1,
      armDrop: Math.sin(t * TAU) * 0.8,
    }),
  },
  // Asleep: slumped, eyes shut, antenna dimmed, breathing slowly.
  sleep: {
    frames: 8,
    pose: (t) => ({
      bob: 3 + Math.sin(t * TAU) * 1.2,
      bulb: 0.15 + 0.1 * (0.5 + 0.5 * Math.sin(t * TAU)),
      eyeOpen: 0.06,
      armDrop: 3,
      legFront: 2,
      legBack: -2,
    }),
  },
  // Waking up: eyes blink open and the antenna comes back to life.
  wake: {
    frames: 5,
    loop: false,
    pose: (t, i) => ({
      bob: [3, 2, 0, -1, 0][i] ?? 0,
      bulb: [0.2, 0.4, 0.7, 1, 1][i] ?? 1,
      eyeOpen: [0.06, 0.3, 0.9, 1.3, 1][i] ?? 1,
      armDrop: [3, 2, 0, -2, 0][i] ?? 0,
    }),
  },
  // Greeting that opens a reminder: one arm up, waving.
  wave: {
    frames: 6,
    pose: (t) => ({
      bob: -1,
      bulb: 1,
      eyeOpen: 0.8,
      armDrop: -1,
      armWave: 14 + Math.sin(t * TAU) * 5,
    }),
  },
  // Tips back to drink, eyes shut.
  drink: {
    frames: 6,
    loop: false,
    pose: (t, i) => ({
      bob: [0, -2, -3, -3, -2, 0][i] ?? 0,
      lean: [0, -1, -2, -2, -1, 0][i] ?? 0,
      bulb: 1,
      eyeOpen: i >= 1 && i <= 4 ? 0.2 : 1,
      armDrop: -6,
      armWave: [0, 8, 14, 14, 8, 0][i] ?? 0,
    }),
  },
  // Reaction to a click: a quick, bouncy hop with the eyes squeezed shut.
  happy: {
    frames: 6,
    loop: false,
    pose: (t) => ({
      bob: -Math.abs(Math.sin(t * Math.PI)) * 9,
      bulb: 1,
      eyeOpen: 0.25,
      armDrop: -Math.abs(Math.sin(t * Math.PI)) * 6,
    }),
  },
  // Reaction to a double click: stretch up tall, eyes wide.
  surprised: {
    frames: 6,
    loop: false,
    pose: (t, i) => ({
      bob: i === 0 ? 2 : -6,
      bulb: 1,
      eyeOpen: i === 0 ? 0.3 : 1.6,
      armDrop: i === 0 ? 2 : -9,
    }),
  },
  // Held by the cursor: arms up, legs hanging, swaying gently.
  dragged: {
    frames: 6,
    pose: (t) => ({
      bob: 1,
      lean: Math.sin(t * TAU) * 2.5,
      legFront: Math.sin(t * TAU) * 3,
      legBack: Math.sin(t * TAU + 0.6) * 3,
      bulb: 1,
      eyeOpen: 1.2,
      armDrop: -10,
    }),
  },
  // Crouch, then push off: the anticipation frames are what make a jump read
  // as deliberate rather than as a teleport.
  jump: {
    frames: 4,
    loop: false,
    pose: (t) => ({
      bob: [3, -1, -7, -11][Math.round(t * 4)] ?? -11,
      legFront: -2,
      legBack: -2,
      bulb: 1,
      armDrop: [2, -2, -6, -8][Math.round(t * 4)] ?? -8,
      eyeOpen: 1,
    }),
  },
  fall: {
    frames: 2,
    pose: (t) => ({
      bob: -10 + Math.sin(t * TAU) * 1.5,
      legFront: 2,
      legBack: -2,
      bulb: 1,
      armDrop: -7,
      eyeOpen: 1,
    }),
  },
  land: {
    frames: 4,
    loop: false,
    // Squash on impact, then recover to standing.
    pose: (t) => ({
      bob: [6, 4, 1, 0][Math.round(t * 4)] ?? 0,
      legFront: 3,
      legBack: -3,
      bulb: 1,
      armDrop: [4, 3, 1, 0][Math.round(t * 4)] ?? 0,
      eyeOpen: 0.4,
    }),
  },
  walk: {
    frames: 8,
    // Legs swing in opposition; the body bobs at twice the stride frequency.
    pose: (t) => ({
      bob: -Math.abs(Math.sin(t * TAU)) * 2.2,
      lean: 1.5,
      legFront: Math.sin(t * TAU) * 7,
      legBack: Math.sin(t * TAU + Math.PI) * 7,
      bulb: 1,
      armDrop: -Math.sin(t * TAU) * 2,
    }),
  },
};

