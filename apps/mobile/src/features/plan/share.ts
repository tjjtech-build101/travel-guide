// Exportar a calendario (.ics con expo-file-system + expo-sharing) y compartir día (Share de RN).
import type { DayRow, LegRow } from '@build101/shared';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';

import { buildIcs } from './ics';
import { buildDayShareText, type PlanBlock } from './selectors';
import { showToast } from './store';

function slug(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'viaje'
  );
}

export async function exportIcs(name: string, blocks: PlanBlock[], days: Pick<DayRow, 'id' | 'date'>[]): Promise<void> {
  try {
    const text = buildIcs(blocks, days, name);
    const file = new File(Paths.cache, `${slug(name)}.ics`);
    if (file.exists) file.delete();
    file.create();
    await file.write(text);
    if (!(await Sharing.isAvailableAsync())) {
      showToast({ tone: 'error', title: 'No puedo compartir archivos acá', text: 'Este dispositivo no tiene cómo compartir el calendario.' }, 6000);
      return;
    }
    await Sharing.shareAsync(file.uri, { mimeType: 'text/calendar', UTI: 'public.calendar-event', dialogTitle: name });
  } catch (e) {
    if (__DEV__) console.warn('[plan] exportIcs', e);
    // Falla local (disco o la hoja de compartir), no del servidor.
    showToast({ tone: 'error', title: 'No pude armar el calendario', text: 'No se pudo guardar el archivo .ics en el celu. Probá de nuevo.' }, 6000);
  }
}

export async function shareDay(leg: Pick<LegRow, 'city'>, day: Pick<DayRow, 'date'>, blocks: PlanBlock[]): Promise<void> {
  try {
    await Share.share({ message: buildDayShareText(leg, day, blocks) });
  } catch (e) {
    if (__DEV__) console.warn('[plan] shareDay', e);
    showToast({ tone: 'error', title: 'No pude compartir el día', text: 'No se abrió la hoja de compartir del celu. Probá de nuevo.' }, 6000);
  }
}
