// Imágenes del Scout (PNG generados con `pnpm scout:build` desde scripts/scout-avatar/).
// Provisorio hasta conectar el avatar con la voz: <ScoutImage pose="wave" /> muestra una pose fija
// y <ScoutImage talking /> alterna las bocas de la pose tranquila para que parezca que habla.
import { SCOUT } from '@build101/shared';
import { useEffect, useState } from 'react';
import { Image, type ImageSourcePropType, type ImageStyle, type StyleProp } from 'react-native';

export type ScoutPose = 'idle' | 'wave' | 'pointLeft' | 'pointRight' | 'thumbs' | 'compass' | 'map' | 'think';

export const SCOUT_POSES: Record<ScoutPose, ImageSourcePropType> = {
  idle: require('../../assets/scout/poses/scout-idle.png'),
  wave: require('../../assets/scout/poses/scout-wave.png'),
  pointLeft: require('../../assets/scout/poses/scout-point-left.png'),
  pointRight: require('../../assets/scout/poses/scout-point-right.png'),
  thumbs: require('../../assets/scout/poses/scout-thumbs.png'),
  compass: require('../../assets/scout/poses/scout-compass.png'),
  map: require('../../assets/scout/poses/scout-map.png'),
  think: require('../../assets/scout/poses/scout-think.png'),
};

/** Solo la cabeza, para avatares redondos. */
export const SCOUT_HEAD: ImageSourcePropType = require('../../assets/scout/head/scout-head.png');

const TALK = {
  rest: require('../../assets/scout/talk/scout-talk-rest.png'),
  m: require('../../assets/scout/talk/scout-talk-m.png'),
  e: require('../../assets/scout/talk/scout-talk-e.png'),
  a: require('../../assets/scout/talk/scout-talk-a.png'),
  o: require('../../assets/scout/talk/scout-talk-o.png'),
} satisfies Record<string, ImageSourcePropType>;
const TALK_ORDER = [TALK.a, TALK.e, TALK.o, TALK.m, TALK.e, TALK.a, TALK.rest, TALK.o, TALK.e];

// Proporción de las imágenes de cuerpo entero (195×240).
const RATIO = 195 / 240;

type Props = {
  pose?: ScoutPose;
  /** Alterna las bocas (pose tranquila). Ignora `pose` mientras está en true. */
  talking?: boolean;
  /** Alto en pt; el ancho sale de la proporción. */
  height?: number;
  style?: StyleProp<ImageStyle>;
};

export function ScoutImage({ pose = 'idle', talking = false, height = 240, style }: Props) {
  const mouth = useTalkFrame(talking);
  const source = talking ? mouth : SCOUT_POSES[pose];
  return (
    <Image
      source={source}
      style={[{ height, width: height * RATIO }, style]}
      resizeMode="contain"
      fadeDuration={0}
      accessibilityRole="image"
      accessibilityLabel={SCOUT.name}
    />
  );
}

function useTalkFrame(talking: boolean) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!talking) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setI(Math.floor(Math.random() * TALK_ORDER.length));
      timer = setTimeout(tick, 90 + Math.random() * 60);
    };
    tick();
    return () => clearTimeout(timer);
  }, [talking]);
  return talking ? TALK_ORDER[i] : TALK.rest;
}
