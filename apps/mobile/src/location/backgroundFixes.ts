// Muestras de ubicación que llegan por la task de segundo plano (tour/backgroundLocation.ts, PRD 07).
// El RealLocationProvider las reemite: mapa, Ahora y el tour ven lo mismo con la app en primer o segundo plano.
import type { LocationFix } from '@build101/shared';

import { Emitter } from './emitter';

export const backgroundFixes = new Emitter<LocationFix>();
