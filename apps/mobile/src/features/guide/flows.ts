// Guía con el Scout: qué dice en cada pantalla la primera vez que entrás. Cada paso puede apuntar a un elemento
// (GuideTarget con ese id) o ir centrado. Pocos pasos por pantalla y siempre se puede saltear.
import { SCOUT } from '@build101/shared';

import type { ScoutPose } from '../../scout/parts';

export type GuideStep = {
  /** id de un GuideTarget (o de un target virtual, como las tabs). Sin target: el Scout al centro. */
  target?: string;
  title?: string;
  text: string;
  /** Pose del Scout. Con target, si no viene, señala hacia el elemento. */
  pose?: ScoutPose;
};

export type GuideFlowId = 'welcome' | 'trip' | 'now' | 'map' | 'menu';

export const GUIDE_FLOWS: Record<GuideFlowId, GuideStep[]> = {
  welcome: [
    {
      title: `¡Hola! Soy ${SCOUT.name}`,
      text: 'Voy a ser tu guía: te armo el viaje, te llevo por la ciudad y te cuento la historia de cada lugar. Te muestro rápido cómo funciona.',
      pose: 'wave',
    },
    { target: 'home.newTrip', text: 'Arrancá acá: contame a dónde querés ir, con tus palabras, y lo armamos juntos.' },
    { target: 'home.hero', text: 'Acá vas a ver tu viaje: cuánto falta o, si ya estás viajando, qué toca ahora.' },
    { target: 'home.profile', text: 'Y acá me contás tus gustos, así te armo tours a tu medida.' },
    { text: 'Cuando quieras, estoy. ¡Vamos!', pose: 'thumbs' },
  ],
  trip: [
    { title: 'Tu viaje', text: 'Esta es la planificación: los días, con todo lo que van a hacer. Te muestro cómo moverte.', pose: 'map' },
    { target: 'plan.legs', text: 'Arriba están los tramos. Tocá una ciudad y salto a sus días.' },
    { target: 'plan.filter', text: 'Filtrá lo tuyo, lo del grupo o todo junto.' },
    { target: 'plan.more', text: 'En ⋯ tenés el grupo, tu perfil y exportar el viaje al calendario.' },
    { target: 'tab.map', text: 'En Mapa ves todo el viaje sobre el mapa.' },
    { target: 'tab.now', text: 'Y en Ahora, lo que toca en este momento. Te aviso cuándo salir para llegar bien.' },
    {
      target: 'voice.button',
      text: 'Y yo estoy acá: tocame y hablamos. Lo del grupo te lo propongo; lo tuyo lo cambio directo. Y todo se puede deshacer.',
    },
  ],
  now: [
    {
      title: 'Ahora',
      text: 'Acá ves lo que toca, cuánto falta y cuándo salir. Si se te hace tarde, te aviso. Tocá algo y hablamos de eso.',
      pose: 'compass',
    },
  ],
  map: [{ title: 'El mapa', text: 'Tocá cualquier punto y te cuento de ese lugar, o te llevo caminando.', pose: 'map' }],
  menu: [
    {
      title: 'El menú de la ciudad',
      text: 'Marcá lo que te copa, lo que no y lo que es sí o sí. Con eso armo los días para todo el grupo.',
      pose: 'thumbs',
    },
  ],
};
