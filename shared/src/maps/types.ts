import type { Vec3 } from '../math.ts';

export type Mat =
  | 'ground'
  | 'concrete'
  | 'charcoal'
  | 'metal'
  | 'crate'
  | 'container'
  | 'lime'
  | 'glass'
  | 'wood'
  | 'clip'
  | 'carpet'
  | 'desk'
  | 'white'
  | 'brick'
  | 'tile'
  | 'plant'
  | 'screen'
  | 'sofa'
  | 'eitri' // official Eitri icon banner
  | 'logo'; // Calindra Strike logo banner

export interface Box {
  min: Vec3;
  max: Vec3;
  mat: Mat;
  solid: boolean; // blocks movement
  shootThrough: boolean; // bullets pass (glass, foliage)
  visible: boolean;
}

export interface MapTheme {
  skyTop: string;
  skyHorizon: string;
  skyBottom: string;
  fog: string;
  fogNear: number;
  fogFar: number;
  sun: string;
  sunIntensity: number;
  sunDir: Vec3; // direction the light travels FROM (normalized-ish)
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
}

export interface MapLight {
  x: number;
  y: number;
  z: number;
  color: string;
}

export interface MapDef {
  id: string;
  name: string;
  subtitle: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  dropArea: { minX: number; maxX: number; minZ: number; maxZ: number };
  dropHeight: number;
  airdropPoints: { x: number; z: number }[];
  boxes: Box[];
  lights: MapLight[];
  theme: MapTheme;
}
