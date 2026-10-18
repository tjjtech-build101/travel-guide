// Geometría del Scout (chibi de cuerpo entero). Puro datos, sin React: cada nodo es
// [tag, props, ...hijos] con props en camelCase (las de react-native-svg): la app lo dibuja y anima en
// vivo (src/scout/ScoutRig.tsx) y scripts/scout-avatar/build.ts lo pasa a SVG y genera PNG y videos.
// Coordenadas: viewBox "-10 0 260 320". La cabeza se dibuja a escala 1 y se agranda con
// HEAD_T; el cuerpo (piernas, torso, brazos) se achica desde los pies con BODY_T.

export type SvgTag = 'g' | 'path' | 'rect' | 'circle' | 'ellipse' | 'clipPath' | 'defs';
export type SvgProps = Record<string, string | number>;
export type SvgNode = readonly [SvgTag, SvgProps, ...SvgNode[]];
type Pt = readonly [number, number];

export const VIEW = { x: -10, y: 0, w: 260, h: 320 } as const;
export const VIEW_BOX = `${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`;
/** Recorte de solo la cabeza (avatar redondo). */
export const HEAD_VIEW_BOX = '3 8 234 234';

const BODY_SCALE = 0.82;
const FEET_Y = 313;
export const BODY_T = `translate(120 ${FEET_Y}) scale(${BODY_SCALE}) translate(-120 -${FEET_Y})`;
const HEAD_T = 'translate(120 148.5) scale(1.27) translate(-120 -120)';

/** Punto del cuerpo (coordenadas sin achicar) → coordenadas del viewBox. */
export const bodyToView = ([x, y]: Pt): Pt => [120 + (x - 120) * BODY_SCALE, FEET_Y - (FEET_Y - y) * BODY_SCALE];
/** Punto del viewBox → transformOrigin en % para una capa que ocupa todo el viewBox. */
export const viewOrigin = ([x, y]: Pt) => `${((x - VIEW.x) / VIEW.w) * 100}% ${((y - VIEW.y) / VIEW.h) * 100}%`;
/** Cuello: pivote del cabeceo. */
export const NECK: Pt = [120, 210];

// ---------- Paleta (fija, no depende del tema)
export const P = {
  skin: '#F6D3B9', skinShade: '#E2AE8C', blush: '#F29A86', freckle: '#C3825A',
  hair: '#6A4127', hairShade: '#4A2C19',
  hat: '#B98E53', hatShade: '#97703F', hatBand: '#5A3921',
  shirt: '#CFB077', shirtShade: '#B08F55', shorts: '#9E8550',
  sock: '#6E7744', sockTop: '#5A6237', boot: '#5B3A22', bootSole: '#3E2716',
  red: '#D33B2D', redShade: '#A52A20', leather: '#7B4F2C', strap: '#6A4930', brass: '#D6A23C',
  ink: '#2A1E17', mouth: '#702B22', tongue: '#E37468', white: '#FFFFFF',
  paper: '#F4E8CB', paperShade: '#E0CFA6', green: '#4D7A3B', blue: '#3567A0',
} as const;

const line = (d: string, stroke: string, strokeWidth = 3): SvgNode => [
  'path', { d, fill: 'none', stroke, strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round' },
];

// ---------- Piernas (quietas)
export const LEGS: SvgNode = ['g', { transform: BODY_T },
  ['rect', { x: 97, y: 266, width: 14, height: 22, fill: P.skin }],
  ['rect', { x: 129, y: 266, width: 14, height: 22, fill: P.skin }],
  ['rect', { x: 97, y: 272, width: 14, height: 3, fill: P.skinShade }],
  ['rect', { x: 129, y: 272, width: 14, height: 3, fill: P.skinShade }],
  ['rect', { x: 96, y: 284, width: 16, height: 17, rx: 2, fill: P.sock }],
  ['rect', { x: 128, y: 284, width: 16, height: 17, rx: 2, fill: P.sock }],
  ['rect', { x: 96, y: 284, width: 16, height: 4, rx: 1, fill: P.sockTop }],
  ['rect', { x: 128, y: 284, width: 16, height: 4, rx: 1, fill: P.sockTop }],
  ['path', { d: 'M96,286 L100,286 L100,293 L98,291 L96,293 Z', fill: P.red }],
  ['path', { d: 'M144,286 L140,286 L140,293 L142,291 L144,293 Z', fill: P.red }],
  ['path', { d: 'M94,298 L112,298 Q115,304 115,308 Q115,313 109,313 L88,313 Q83,313 84,308 Q86,301 94,298 Z', fill: P.boot }],
  ['path', { d: 'M146,298 L128,298 Q125,304 125,308 Q125,313 131,313 L152,313 Q157,313 156,308 Q154,301 146,298 Z', fill: P.boot }],
  line('M86,311.5 L113,311.5 M127,311.5 L154,311.5', P.bootSole, 2.5),
];

// ---------- Torso (respira)
export const TORSO: SvgNode = ['g', { transform: BODY_T },
  ['rect', { x: 110, y: 180, width: 20, height: 12, fill: P.skinShade }],
  ['path', { d: 'M84,246 L156,246 L160,274 L126,274 L120,258 L114,274 L80,274 Z', fill: P.shorts }],
  ['path', { d: 'M88,198 C88,190 98,186 108,186 L132,186 C142,186 152,190 152,198 L156,248 L84,248 Z', fill: P.shirt }],
  ['path', { d: 'M88,198 C88,192 92,189 96,188 C94,206 93,228 94,248 L84,248 Z', fill: P.shirtShade }],
  ['path', { d: 'M152,198 C152,192 148,189 144,188 C146,206 147,228 146,248 L156,248 Z', fill: P.shirtShade }],
  // tiras de la mochila
  ['path', { d: 'M96,189 L105,188 L107,243 L98,243 Z', fill: P.strap }],
  ['path', { d: 'M144,189 L135,188 L133,243 L142,243 Z', fill: P.strap }],
  ['rect', { x: 97.5, y: 222, width: 10, height: 6, rx: 1.5, fill: 'none', stroke: P.brass, strokeWidth: 1.8 }],
  ['rect', { x: 132.5, y: 222, width: 10, height: 6, rx: 1.5, fill: 'none', stroke: P.brass, strokeWidth: 1.8 }],
  // insignias
  ['circle', { cx: 112, cy: 234, r: 4.2, fill: P.green, stroke: P.brass, strokeWidth: 1.2 }],
  ['path', { d: 'M112,231.4 L112.8,233.3 L114.8,233.4 L113.3,234.6 L113.8,236.6 L112,235.5 L110.2,236.6 L110.7,234.6 L109.2,233.4 L111.2,233.3 Z', fill: P.white }],
  ['rect', { x: 122, y: 230.5, width: 10, height: 7, rx: 0.8, fill: P.white, stroke: P.shirtShade, strokeWidth: 0.8 }],
  line('M125.5,232.3 L131.5,232.3 M125.5,234 L131.5,234 M123,235.8 L131.5,235.8', P.blue, 0.8),
  ['circle', { cx: 123.6, cy: 232.4, r: 1.1, fill: P.brass }],
  // cinturón
  ['rect', { x: 84, y: 242, width: 72, height: 7, fill: P.leather }],
  ['rect', { x: 115, y: 240.5, width: 10, height: 10, rx: 1.5, fill: 'none', stroke: P.brass, strokeWidth: 2 }],
  // pañuelo
  ['path', { d: 'M106,198 L134,198 L120,226 Z', fill: P.red }],
  ['path', { d: 'M120,200 L134,198 L120,226 Z', fill: P.redShade }],
  ['path', { d: 'M98,188 Q120,200 142,188 L144,195 Q120,209 96,195 Z', fill: P.red }],
  ['rect', { x: 113, y: 197, width: 14, height: 9, rx: 4, fill: P.leather }],
];

// ---------- Bocas (visemas)
export type Mouth = 'rest' | 'M' | 'E' | 'A' | 'O' | 'smile' | 'hmm';
const MS: SvgProps = { fill: 'none', stroke: P.mouth, strokeWidth: 3.2, strokeLinecap: 'round' };
const MOUTHS: Record<Mouth, SvgNode[]> = {
  rest: [['path', { d: 'M109,152 Q120,161 131,152', ...MS }]],
  M: [['path', { d: 'M111,156 Q120,158.5 129,156', ...MS }]],
  E: [
    ['path', { d: 'M107,151 Q120,154 133,151 Q129,164 120,164 Q111,164 107,151 Z', fill: P.mouth }],
    ['path', { d: 'M109.5,152.2 Q120,154.6 130.5,152.2 L129.6,155.6 Q120,157.4 110.4,155.6 Z', fill: P.white }],
  ],
  A: [
    ['path', { d: 'M109,150 Q120,148 131,150 Q131,170 120,170 Q109,170 109,150 Z', fill: P.mouth }],
    ['path', { d: 'M112,164 Q120,158 128,164 Q126,170 120,170 Q114,170 112,164 Z', fill: P.tongue }],
    ['path', { d: 'M111,150.5 Q120,149 129,150.5 L128.5,154 Q120,153 111.5,154 Z', fill: P.white }],
  ],
  O: [
    ['ellipse', { cx: 120, cy: 158, rx: 6.5, ry: 8, fill: P.mouth }],
    ['ellipse', { cx: 120, cy: 162.5, rx: 4, ry: 3, fill: P.tongue }],
  ],
  smile: [
    ['path', { d: 'M106,150 Q120,153 134,150 Q132,168 120,168 Q108,168 106,150 Z', fill: P.mouth }],
    ['path', { d: 'M112,162 Q120,157 128,162 Q125,168 120,168 Q115,168 112,162 Z', fill: P.tongue }],
    ['path', { d: 'M108,150.6 Q120,153 132,150.6 L131,154.5 Q120,156.5 109,154.5 Z', fill: P.white }],
  ],
  hmm: [['path', { d: 'M112,157 Q117,154 128,156', ...MS }]],
};
/** Bocas que se alternan mientras habla. */
export const TALK_MOUTHS: Mouth[] = ['A', 'E', 'O', 'M', 'E', 'A', 'rest', 'O', 'E'];

// ---------- Cabeza
type Brows = 'normal' | 'think';
const BROWS: Record<Brows, SvgNode[]> = {
  normal: [line('M85,105 Q96,99 107,104', P.hairShade, 4.4), line('M133,104 Q144,99 155,105', P.hairShade, 4.4)],
  think: [line('M85,107 Q96,104 107,107', P.hairShade, 4.4), line('M133,99 Q144,91 155,97', P.hairShade, 4.4)],
};
const EYE_Y = 123;
const eye = (cx: number, open: number): SvgNode => ['g', { transform: `translate(${cx} ${EYE_Y}) scale(1 ${open}) translate(${-cx} ${-EYE_Y})` },
  ['ellipse', { cx, cy: EYE_Y, rx: 8.6, ry: 11, fill: P.ink }],
  ['circle', { cx: cx - 3, cy: 118.5, r: 3.2, fill: P.white }],
  ['circle', { cx: cx + 3.4, cy: 127.5, r: 1.4, fill: P.white }],
];
const HAPPY_EYES = [line('M87,126 Q96,115 105,126', P.ink, 4), line('M135,126 Q144,115 153,126', P.ink, 4)];
const FACE = 'M63,110 C63,80 88,68 120,68 C152,68 177,80 177,110 C177,144 158,168 120,172 C82,168 63,144 63,110 Z';
const cheek = (cx: number, freckles: Pt[], dx: number, sx: number): SvgNode => [
  'g', { transform: `translate(${dx} 0) translate(${cx} 146) scale(${sx} 1) translate(${-cx} -146)` },
  ['ellipse', { cx, cy: 148, rx: 9, ry: 5, fill: P.blush, opacity: 0.55 }],
  ...freckles.map(([x, y]): SvgNode => ['circle', { cx: x, cy: y, r: 1.4, fill: P.freckle }]),
];

export type Eyes = { happy?: boolean; dx?: number; dy?: number };
export type FaceState = {
  /** Giro de cabeza: -1 (izquierda) … 1 (derecha). */
  look: number;
  /** 1 abiertos, ~0.1 cerrados (parpadeo). */
  eyesOpen: number;
  mouth: Mouth;
  eyes?: Eyes;
  brows?: Brows;
};

// Giro: los rasgos se corren hacia `look`, orejas y patillas al revés, el sombrero apenas;
// los cachetes se mueven menos y el del lado lejano se angosta (recortados con la cara).
export function headNode({ look, eyesOpen, mouth, eyes = {}, brows = 'normal' }: FaceState): SvgNode {
  const eyesNode: SvgNode = eyes.happy
    ? ['g', {}, ...HAPPY_EYES]
    : ['g', { transform: `translate(${eyes.dx ?? 0} ${eyes.dy ?? 0})` }, eye(96, eyesOpen), eye(144, eyesOpen)];
  return ['g', { transform: HEAD_T },
    ['defs', {}, ['clipPath', { id: 'scout-faceclip' }, ['path', { d: FACE }]]],
    ['g', { transform: `translate(${-look * 7} 0)` },
      ['circle', { cx: 63, cy: 124, r: 10, fill: P.skin }],
      ['circle', { cx: 177, cy: 124, r: 10, fill: P.skin }],
      line('M61,119.5 Q57.5,124 61,129', P.skinShade, 2.4),
      line('M179,119.5 Q182.5,124 179,129', P.skinShade, 2.4)],
    ['path', { d: FACE, fill: P.skin }],
    ['g', { clipPath: 'url(#scout-faceclip)' },
      cheek(84, [[79, 143], [85, 146.5], [90.5, 142.5]], look * 8, 1 - Math.max(0, -look) * 0.5),
      cheek(156, [[161, 143], [155, 146.5], [149.5, 142.5]], look * 8, 1 - Math.max(0, look) * 0.5)],
    ['g', { transform: `translate(${-look * 3} 0)` },
      ['path', { d: 'M63,114 C62,100 64,92 68,84 L76,84 C71,96 71,106 71,116 Z', fill: P.hair }],
      ['path', { d: 'M177,114 C178,100 176,92 172,84 L164,84 C169,96 169,106 169,116 Z', fill: P.hair }]],
    ['g', { transform: `translate(${look * 5} 0)` },
      ['path', { d: 'M68,86 C78,95 88,100 98,96 C104,104 114,104 122,98 C130,104 142,104 148,96 C156,100 164,97 172,86 L172,78 L68,78 Z', fill: P.hair }]],
    ['g', { transform: `translate(${look * 11} 0)` },
      line('M119,133 L117.5,140 Q120,142.5 123,140.5', P.skinShade, 2.6),
      ...BROWS[brows],
      eyesNode,
      ['g', { transform: 'translate(120 152) scale(0.9) translate(-120 -155)' }, ...MOUTHS[mouth]]],
    // sombrero
    ['ellipse', { cx: 120, cy: 80, rx: 92, ry: 15, fill: P.hat }],
    ['path', { d: 'M28,80 A92,15 0 0,0 212,80 A92,8 0 0,1 28,80 Z', fill: P.hatShade }],
    ['g', { transform: `translate(${look * 4} 0)` },
      ['path', { d: 'M80,80 C78,58 86,36 102,28 C108,24 114,22 120,18 C126,22 132,24 138,28 C154,36 162,58 160,80 Z', fill: P.hat }],
      ['path', { d: 'M120,19 C116,30 116,40 120,50 C124,40 124,30 120,19 Z', fill: P.hatShade }],
      ['path', { d: 'M98,36 C102,42 104,48 104,56 C98,52 94,46 92,40 Z', fill: P.hatShade }],
      ['path', { d: 'M142,36 C138,42 136,48 136,56 C142,52 146,46 148,40 Z', fill: P.hatShade }],
      ['path', { d: 'M80,66 L160,66 L160.4,79 L79.6,79 Z', fill: P.hatBand }]],
  ];
}

// ---------- Manos y brazos (coordenadas del cuerpo, sin achicar)
type Hand = 'open' | 'fist' | 'point' | 'thumb';
const HS: SvgProps = { fill: P.skin, stroke: P.skinShade, strokeWidth: 1.5, strokeLinejoin: 'round' };
const creases = (d: string): SvgNode => ['path', { d, fill: 'none' }];
const THUMB: SvgNode = ['path', { d: 'M-12,-2 C-12,-8 -6,-9 -3,-6 L-3,4 C-6,6 -12,4 -12,-2 Z' }];
const HANDS: Record<Hand, SvgNode> = {
  open: ['g', HS,
    ['rect', { x: -12, y: -24, width: 6, height: 18, rx: 3 }],
    ['rect', { x: -5.5, y: -29, width: 6, height: 22, rx: 3 }],
    ['rect', { x: 1, y: -28, width: 6, height: 21, rx: 3 }],
    ['rect', { x: 7.5, y: -23, width: 6, height: 17, rx: 3 }],
    ['path', { d: 'M-11,4 C-19,1 -23,-6 -19,-9 C-15,-11 -11,-5 -7,-1 Z' }],
    ['rect', { x: -13, y: -12, width: 27, height: 28, rx: 11 }]],
  fist: ['g', HS,
    ['rect', { x: -12, y: -11, width: 24, height: 22, rx: 9 }],
    creases('M2,-5 L11,-5 M2,0.5 L11,0.5 M2,6 L11,6'), THUMB],
  point: ['g', HS,
    ['rect', { x: -4, y: -34, width: 8, height: 28, rx: 4 }],
    ['rect', { x: -12, y: -11, width: 24, height: 22, rx: 9 }],
    creases('M4,-3 L11,-3 M4,3 L11,3'), THUMB],
  thumb: ['g', HS,
    ['rect', { x: -11, y: -30, width: 9, height: 24, rx: 4.5 }],
    ['rect', { x: -12, y: -10, width: 26, height: 24, rx: 9 }],
    creases('M2,-3 L13,-3 M2,3 L13,3 M2,9 L13,9')],
};
const SHOULDER: Record<'L' | 'R', Pt> = { L: [92, 197], R: [148, 197] };
const limb = (d: string, w: number): SvgNode[] => [
  ['path', { d, fill: 'none', stroke: P.skinShade, strokeWidth: w + 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' }],
  ['path', { d, fill: 'none', stroke: P.skin, strokeWidth: w, strokeLinecap: 'round', strokeLinejoin: 'round' }],
];

/** Brazo: hombro → codo → mano, manga corta hasta el 60%. `fore` es antebrazo + mano (lo que saluda). */
function armParts(side: 'L' | 'R', E: Pt, H: Pt, hand: Hand = 'fist', { rot = 0, flip = false } = {}) {
  const S = SHOULDER[side];
  const mid: Pt = [S[0] + (E[0] - S[0]) * 0.6, S[1] + (E[1] - S[1]) * 0.6];
  const s = flip ? -0.55 : 0.55;
  const fore: SvgNode = ['g', {},
    ...limb(`M${E} L${H}`, 9.5),
    ['g', { transform: `translate(${H}) rotate(${rot}) scale(${s} 0.55)` }, HANDS[hand]]];
  const upper = limb(`M${S} L${E}`, 10);
  const sleeve: SvgNode = ['path', { d: `M${S} L${mid}`, fill: 'none', stroke: P.shirt, strokeWidth: 15, strokeLinecap: 'round' }];
  return { upper, fore, sleeve };
}
const arm = (...args: Parameters<typeof armParts>): SvgNode[] => {
  const { upper, fore, sleeve } = armParts(...args);
  return [...upper, fore, sleeve];
};
const IDLE_L = arm('L', [84, 220], [82, 240]);
const IDLE_R = arm('R', [156, 220], [158, 240], 'fist', { flip: true });

const COMPASS_AT: Pt = [132, 220];
const COMPASS_T = `translate(${COMPASS_AT}) scale(0.75)`;
const COMPASS: SvgNode = ['g', { transform: COMPASS_T },
  ['circle', { cx: 0, cy: -20, r: 3.5, fill: 'none', stroke: P.brass, strokeWidth: 2 }],
  ['circle', { cx: 0, cy: 0, r: 18, fill: P.brass }],
  ['circle', { cx: 0, cy: 0, r: 14, fill: P.paper }],
  line('M0,-12 L0,-9 M12,0 L9,0 M0,12 L0,9 M-12,0 L-9,0', P.ink, 1.5),
];
const NEEDLE: SvgNode = ['g', { transform: BODY_T }, ['g', { transform: COMPASS_T },
  ['path', { d: 'M0,-11 L3.2,0 L-3.2,0 Z', fill: P.red }],
  ['path', { d: 'M0,11 L3.2,0 L-3.2,0 Z', fill: P.ink }],
  ['circle', { cx: 0, cy: 0, r: 2, fill: P.brass }]]];
const MAP: SvgNode = ['g', {},
  ['path', { d: 'M70,222 L104,216 L104,254 L68,258 Z', fill: P.paper }],
  ['path', { d: 'M104,216 L136,222 L136,258 L104,254 Z', fill: P.paperShade }],
  ['path', { d: 'M136,222 L170,216 L172,254 L136,258 Z', fill: P.paper }],
  ['path', { d: 'M76,248 Q92,230 108,240 T146,236 L160,228', fill: 'none', stroke: P.red, strokeWidth: 2, strokeDasharray: '3 3', strokeLinecap: 'round' }],
  line('M157,222 L163,228 M163,222 L157,228', P.red, 2),
  ['circle', { cx: 86, cy: 236, r: 2.4, fill: P.green }],
  ['circle', { cx: 124, cy: 246, r: 2.4, fill: P.green }],
];

// ---------- Poses
export type ScoutPose = 'idle' | 'wave' | 'pointLeft' | 'pointRight' | 'thumbs' | 'compass' | 'map' | 'think';

export type PoseDef = {
  label: string;
  mouth: Mouth;
  eyes?: Eyes;
  brows?: Brows;
  /** Giro de cabeza de la pose (-1…1). */
  look?: number;
  /** Capa de brazos (ya con BODY_T). */
  arms: SvgNode;
  /** Antebrazo que saluda, rota alrededor de `pivot` (viewBox). */
  wave?: { node: SvgNode; pivot: Pt };
  /** Aguja de la brújula, rota alrededor de `pivot` (viewBox). */
  needle?: { node: SvgNode; pivot: Pt };
};

const armsLayer = (...nodes: SvgNode[]): SvgNode => ['g', { transform: BODY_T }, ...nodes];
const WAVE_ELBOW: Pt = [176, 198];
const waveArm = armParts('R', WAVE_ELBOW, [208, 176], 'open');

export const POSES: Record<ScoutPose, PoseDef> = {
  idle: { label: 'Tranquilo', mouth: 'rest', arms: armsLayer(...IDLE_L, ...IDLE_R) },
  wave: {
    label: 'Saludando', mouth: 'smile', eyes: { happy: true }, look: 0.15,
    arms: armsLayer(...IDLE_L, ...waveArm.upper, waveArm.sleeve),
    wave: { node: armsLayer(waveArm.fore), pivot: bodyToView(WAVE_ELBOW) },
  },
  pointLeft: {
    label: 'Señala ←', mouth: 'rest', eyes: { dx: -3 }, look: -1,
    arms: armsLayer(...arm('L', [66, 198], [40, 194], 'point', { rot: -90 }), ...IDLE_R),
  },
  pointRight: {
    label: 'Señala →', mouth: 'rest', eyes: { dx: 3 }, look: 1,
    arms: armsLayer(...IDLE_L, ...arm('R', [174, 198], [200, 194], 'point', { rot: 90, flip: true })),
  },
  thumbs: {
    label: '¡Dale!', mouth: 'smile', eyes: { happy: true }, look: 0.2,
    arms: armsLayer(...IDLE_L, ...arm('R', [172, 222], [180, 200], 'thumb')),
  },
  compass: {
    label: 'Brújula', mouth: 'rest', eyes: { dx: 1, dy: 4 }, look: 0.25,
    arms: armsLayer(...IDLE_L, COMPASS, ...arm('R', [160, 228], [138, 234], 'fist', { flip: true })),
    needle: { node: NEEDLE, pivot: bodyToView(COMPASS_AT) },
  },
  map: {
    label: 'Mapa', mouth: 'rest', eyes: { dy: 4 },
    arms: armsLayer(MAP, ...arm('L', [82, 216], [72, 236]), ...arm('R', [158, 216], [168, 236], 'fist', { flip: true })),
  },
  think: {
    label: 'Pensando', mouth: 'hmm', brows: 'think', eyes: { dx: -2, dy: -3 }, look: -0.35,
    arms: armsLayer(...IDLE_L, ...arm('R', [170, 214], [146, 180], 'fist', { rot: -15, flip: true })),
  },
};
