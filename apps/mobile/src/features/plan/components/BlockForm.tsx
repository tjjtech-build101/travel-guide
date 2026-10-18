// Formulario de bloque (crear y editar). Campos según tipo (tabla "Datos" del PRD 02).
import {
  BLOCK_STATUS,
  BLOCK_TYPES,
  TRANSFER_MODES,
  type BlockFieldsInput,
  type BlockStatus,
  type BlockType,
  type TimeFlex,
  type TransferMode,
} from '@build101/shared';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from 'react-native';

import { callTool } from '../../../lib/api';
import { errorLine } from '../../../lib/errors';
import { formatDay } from '../../../lib/format';
import { Avatar } from '../../../ui/Avatar';
import { Text } from '../../../ui/Text';
import { colors, font, radius, space } from '../../../ui/theme';
import { STATUS_LABEL, TIME_FLEX_LABEL, TRANSFER_MODE_LABEL, TYPE_LABEL } from '../labels';
import { hhmm, toMin, type PlanBlock, type PlanLeg, type PlanMember } from '../selectors';
import { Chip, Field, FieldLabel, normalizeTime, TimeField } from './Controls';
import { TypeIcon } from './TypeIcon';

export type TimeMode = 'fixed' | Exclude<TimeFlex, 'fixed'>;

export type BlockFormState = {
  type: BlockType;
  title: string;
  legId: string;
  dayId: string | null;
  timeMode: TimeMode;
  start: string;
  end: string;
  duration: string;
  placeName: string;
  place?: { google_place_id?: string; lat?: number; lng?: number };
  participants: string[];
  isPrivate: boolean;
  status: BlockStatus;
  cost: string;
  currency: string;
  bookingUrl: string;
  notes: string;
  transferFrom: string;
  transferTo: string;
  transferMode: TransferMode;
  transferDuration: string;
};

const CURRENCIES = ['USD', 'UYU', 'ARS', 'EUR', 'BRL'];
const FLEX_MODES: TimeMode[] = ['fixed', 'morning', 'afternoon', 'evening', 'any'];

/** Campos que muestra cada tipo. */
const SHOW: Record<BlockType, { place: boolean; participants: boolean; status: boolean; cost: boolean; booking: boolean; notes: boolean; flex: boolean; transfer: boolean; duration: boolean; end: boolean }> = {
  activity: { place: true, participants: true, status: true, cost: true, booking: true, notes: true, flex: true, transfer: false, duration: true, end: true },
  tour: { place: true, participants: true, status: true, cost: true, booking: true, notes: true, flex: true, transfer: false, duration: true, end: true },
  meal: { place: true, participants: true, status: true, cost: true, booking: true, notes: true, flex: true, transfer: false, duration: true, end: true },
  transfer: { place: false, participants: true, status: true, cost: true, booking: true, notes: false, flex: false, transfer: true, duration: false, end: false },
  lodging: { place: true, participants: true, status: true, cost: true, booking: true, notes: true, flex: false, transfer: false, duration: false, end: false },
  free: { place: false, participants: true, status: false, cost: false, booking: false, notes: false, flex: true, transfer: false, duration: false, end: true },
  meetup: { place: true, participants: true, status: false, cost: false, booking: false, notes: true, flex: false, transfer: false, duration: false, end: true },
};

export function defaultTimeMode(type: BlockType): TimeMode {
  if (type === 'meal') return 'evening';
  if (type === 'free') return 'afternoon';
  return 'fixed';
}

export function emptyForm(p: { type: BlockType; leg: PlanLeg; dayId: string | null }): BlockFormState {
  return {
    type: p.type,
    title: p.type === 'free' ? 'Libre' : '',
    legId: p.leg.id,
    dayId: p.dayId,
    timeMode: p.dayId || defaultTimeMode(p.type) !== 'fixed' ? defaultTimeMode(p.type) : 'any',
    start: '',
    end: '',
    duration: '',
    placeName: '',
    participants: [...p.leg.member_ids],
    isPrivate: false,
    status: p.dayId ? 'confirmed' : 'idea',
    cost: '',
    currency: 'USD',
    bookingUrl: '',
    notes: '',
    transferFrom: '',
    transferTo: '',
    transferMode: 'bus',
    transferDuration: '',
  };
}

export function formFromBlock(b: PlanBlock): BlockFormState {
  return {
    type: b.type,
    title: b.title,
    legId: b.leg_id,
    dayId: b.day_id,
    timeMode: b.start_time ? 'fixed' : b.time_flex === 'fixed' ? 'any' : b.time_flex,
    start: hhmm(b.start_time),
    end: hhmm(b.end_time),
    duration: b.duration_min ? String(b.duration_min) : '',
    placeName: b.place_name ?? '',
    place: b.google_place_id || b.lat != null ? { google_place_id: b.google_place_id ?? undefined, lat: b.lat ?? undefined, lng: b.lng ?? undefined } : undefined,
    participants: [...b.participant_ids],
    isPrivate: b.is_private,
    status: b.status,
    cost: b.cost_estimate != null ? String(b.cost_estimate) : '',
    currency: b.cost_currency ?? 'USD',
    bookingUrl: b.booking_url ?? '',
    notes: b.notes ?? '',
    transferFrom: b.transfer?.from ?? '',
    transferTo: b.transfer?.to ?? '',
    transferMode: b.transfer?.mode ?? 'bus',
    transferDuration: b.transfer?.duration_min ? String(b.transfer.duration_min) : '',
  };
}

export type FormErrors = Partial<Record<'title' | 'start' | 'end' | 'duration' | 'cost' | 'bookingUrl' | 'participants' | 'form', string>>;

const posInt = (s: string) => {
  const n = Number(s.trim());
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Valida y arma los campos de la herramienta. */
export function formToFields(s: BlockFormState, me: string): { fields?: BlockFieldsInput; errors: FormErrors } {
  const errors: FormErrors = {};
  const show = SHOW[s.type];
  const title = s.title.trim() || (s.type === 'free' ? 'Libre' : '');
  if (!title) errors.title = 'Ponele un nombre';

  const start = s.start.trim() ? normalizeTime(s.start) : null;
  const end = s.end.trim() ? normalizeTime(s.end) : null;
  const fixed = s.timeMode === 'fixed' || !show.flex;
  if (s.start.trim() && !start) errors.start = 'Hora inválida (ej. 16:00)';
  if (s.end.trim() && !end) errors.end = 'Hora inválida';
  if (fixed && s.type === 'meetup' && !start && s.dayId) errors.start = 'Un encuentro necesita hora';
  if (start && end && (toMin(end) ?? 0) <= (toMin(start) ?? 0)) errors.end = 'Tiene que ser después del inicio';
  const duration = s.duration.trim() ? posInt(s.duration) : undefined;
  if (duration === null) errors.duration = 'Minutos (número)';
  const cost = s.cost.trim() ? Number(s.cost.replace(',', '.')) : undefined;
  if (cost !== undefined && !(cost >= 0)) errors.cost = 'Número';
  const url = s.bookingUrl.trim();
  if (url && !/^https?:\/\/\S+\.\S+/.test(url)) errors.bookingUrl = 'Tiene que empezar con https://';
  if (!s.participants.length) errors.participants = 'Elegí al menos una persona';
  if (Object.keys(errors).length) return { errors };

  const fields: BlockFieldsInput = { type: s.type, title };
  if (fixed) {
    if (start) {
      fields.start_time = start;
      fields.time_flex = 'fixed';
      if (end && show.end) fields.end_time = end;
    } else {
      fields.time_flex = 'any';
    }
  } else {
    fields.time_flex = s.timeMode as TimeFlex;
  }
  if (duration && show.duration) fields.duration_min = duration;
  if (show.place && s.placeName.trim()) {
    fields.place_name = s.placeName.trim();
    if (s.place?.google_place_id) fields.google_place_id = s.place.google_place_id;
    if (s.place?.lat != null && s.place?.lng != null) {
      fields.lat = s.place.lat;
      fields.lng = s.place.lng;
    }
  }
  fields.participant_ids = s.participants;
  const solo = s.participants.length === 1 && s.participants[0] === me;
  fields.is_private = solo && s.isPrivate;
  if (show.status) fields.status = s.status;
  else fields.status = s.dayId ? 'confirmed' : 'idea';
  if (show.cost && cost !== undefined) {
    fields.cost_estimate = cost;
    fields.cost_currency = s.currency;
  }
  if (show.booking && url) fields.booking_url = url;
  if (show.notes && s.notes.trim()) fields.notes = s.notes.trim();
  if (show.transfer) {
    const td = posInt(s.transferDuration);
    fields.transfer = {
      mode: s.transferMode,
      ...(s.transferFrom.trim() ? { from: s.transferFrom.trim() } : {}),
      ...(s.transferTo.trim() ? { to: s.transferTo.trim() } : {}),
      ...(td ? { duration_min: td } : {}),
    };
    if (td) fields.duration_min = td;
  }
  return { fields, errors };
}

/** Patch mínimo para update_block (solo lo que cambió). La API no acepta null: no se puede "borrar" un valor. */
export function diffPatch(b: PlanBlock, f: BlockFieldsInput): Partial<BlockFieldsInput> {
  const patch: Partial<BlockFieldsInput> = {};
  const set = <K extends keyof BlockFieldsInput>(k: K, v: BlockFieldsInput[K] | undefined, prev: unknown) => {
    if (v === undefined) return;
    if (JSON.stringify(v) !== JSON.stringify(prev)) patch[k] = v;
  };
  set('title', f.title, b.title);
  set('type', f.type, b.type);
  set('start_time', f.start_time, hhmm(b.start_time) || undefined);
  set('end_time', f.end_time, hhmm(b.end_time) || undefined);
  set('time_flex', f.time_flex, b.time_flex);
  set('duration_min', f.duration_min, b.duration_min ?? undefined);
  set('place_name', f.place_name ?? (b.place_name ? '' : undefined), b.place_name ?? undefined);
  set('google_place_id', f.google_place_id, b.google_place_id ?? undefined);
  set('lat', f.lat, b.lat ?? undefined);
  set('lng', f.lng, b.lng ?? undefined);
  set('is_private', f.is_private, b.is_private);
  set('status', f.status, b.status);
  set('cost_estimate', f.cost_estimate, b.cost_estimate != null ? Number(b.cost_estimate) : undefined);
  set('cost_currency', f.cost_estimate !== undefined ? f.cost_currency : undefined, b.cost_currency ?? undefined);
  set('booking_url', f.booking_url, b.booking_url ?? undefined);
  set('notes', f.notes ?? (b.notes ? '' : undefined), b.notes ?? undefined);
  set('transfer', f.transfer, b.transfer ?? undefined);
  const before = [...b.participant_ids].sort().join();
  const after = [...(f.participant_ids ?? [])].sort().join();
  if (f.participant_ids && before !== after) patch.participant_ids = f.participant_ids;
  return patch;
}

// ───────────────────────── UI

type Props = {
  state: BlockFormState;
  onChange: (s: BlockFormState) => void;
  errors: FormErrors;
  legs: PlanLeg[];
  members: PlanMember[];
  me: string;
  mode: 'create' | 'edit';
  /** Solo en edición: el bloque original (para limitar cambios que la API no soporta). */
  original?: PlanBlock;
  canEditLeg: (legId: string) => boolean;
};

export function BlockForm({ state: s, onChange, errors, legs, members, me, mode, original, canEditLeg }: Props) {
  const set = (patch: Partial<BlockFormState>) => onChange({ ...s, ...patch });
  const show = SHOW[s.type];
  const leg = legs.find((l) => l.id === s.legId) ?? legs[0];
  const editableLegs = legs.filter((l) => canEditLeg(l.id));
  const travelers = members.filter((m) => m.role !== 'follower');
  const solo = s.participants.length === 1 && s.participants[0] === me;
  const lockedTime = mode === 'edit' && !!original?.start_time;

  return (
    <View style={styles.form}>
      {mode === 'create' ? (
        <View>
          <FieldLabel>Tipo</FieldLabel>
          <View style={styles.wrap}>
            {BLOCK_TYPES.map((t) => (
              <Chip
                key={t}
                label={TYPE_LABEL[t]}
                selected={s.type === t}
                icon={<TypeIcon type={t} size={16} color={s.type === t ? '#fff' : colors.textMuted} />}
                onPress={() =>
                  set({
                    type: t,
                    timeMode: s.start ? 'fixed' : defaultTimeMode(t),
                    title: t === 'free' && !s.title ? 'Libre' : s.title === 'Libre' && t !== 'free' ? '' : s.title,
                    participants: t === 'meetup' && leg ? [...leg.member_ids] : s.participants,
                  })
                }
              />
            ))}
          </View>
        </View>
      ) : null}

      <Field
        label="Nombre"
        value={s.title}
        onChangeText={(title) => set({ title })}
        placeholder={PLACEHOLDER[s.type]}
        autoFocus={mode === 'create'}
        returnKeyType="done"
        error={errors.title}
        maxLength={200}
      />

      {mode === 'create' && editableLegs.length > 1 ? (
        <View>
          <FieldLabel>Tramo</FieldLabel>
          <View style={styles.wrap}>
            {editableLegs.map((l) => (
              <Chip
                key={l.id}
                label={`${l.city} · ${Number(l.start_date.slice(8))}/${Number(l.start_date.slice(5, 7))}`}
                selected={l.id === s.legId}
                onPress={() =>
                  set({
                    legId: l.id,
                    dayId: s.dayId ? (l.days[0]?.id ?? null) : null,
                    participants: [...l.member_ids],
                  })
                }
              />
            ))}
          </View>
        </View>
      ) : null}

      {mode === 'create' && leg ? (
        <View>
          <FieldLabel>Día</FieldLabel>
          <View style={styles.wrap}>
            {leg.days.map((d) => (
              <Chip
                key={d.id}
                label={cap(formatDay(d.date))}
                selected={s.dayId === d.id}
                onPress={() => set({ dayId: d.id, status: s.status === 'idea' ? 'confirmed' : s.status })}
              />
            ))}
            <Chip label="Sin día (idea)" selected={s.dayId === null} onPress={() => set({ dayId: null, status: 'idea' })} />
          </View>
        </View>
      ) : null}

      <View>
        <FieldLabel hint={s.type === 'lodging' ? 'Check-in' : undefined}>Horario</FieldLabel>
        {show.flex ? (
          <View style={[styles.wrap, { marginBottom: space.sm }]}>
            {FLEX_MODES.map((m) => (
              <Chip
                key={m}
                label={m === 'fixed' ? 'Hora' : TIME_FLEX_LABEL[m]}
                selected={s.timeMode === m}
                disabled={lockedTime && m !== 'fixed'}
                onPress={() => set({ timeMode: m })}
              />
            ))}
          </View>
        ) : null}
        {s.timeMode === 'fixed' || !show.flex ? (
          <View style={styles.row}>
            <View style={styles.col}>
              <TimeField label={s.type === 'lodging' ? 'Check-in' : 'Empieza'} value={s.start} onChange={(start) => set({ start })} error={errors.start} />
            </View>
            {show.end ? (
              <View style={styles.col}>
                <TimeField label="Termina" value={s.end} onChange={(end) => set({ end })} error={errors.end} />
              </View>
            ) : null}
            {show.duration ? (
              <View style={styles.col}>
                <Field
                  label="Minutos"
                  value={s.duration}
                  onChangeText={(duration) => set({ duration: duration.replace(/\D/g, '') })}
                  keyboardType="number-pad"
                  placeholder="90"
                  error={errors.duration}
                />
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      {show.transfer ? (
        <View style={{ gap: space.md }}>
          <View>
            <FieldLabel>Cómo</FieldLabel>
            <View style={styles.wrap}>
              {TRANSFER_MODES.map((m) => (
                <Chip key={m} label={TRANSFER_MODE_LABEL[m]} selected={s.transferMode === m} onPress={() => set({ transferMode: m })} />
              ))}
            </View>
          </View>
          <View style={styles.row}>
            <View style={styles.col}>
              <Field label="Desde" value={s.transferFrom} onChangeText={(transferFrom) => set({ transferFrom })} placeholder="Montevideo" />
            </View>
            <View style={styles.col}>
              <Field label="Hasta" value={s.transferTo} onChangeText={(transferTo) => set({ transferTo })} placeholder="Colonia" />
            </View>
          </View>
          <Field
            label="Duración (min)"
            value={s.transferDuration}
            onChangeText={(v) => set({ transferDuration: v.replace(/\D/g, '') })}
            keyboardType="number-pad"
            placeholder="165"
          />
        </View>
      ) : null}

      {show.place ? <PlaceField state={s} onChange={onChange} leg={leg} /> : null}

      {show.participants ? (
        <View>
          <FieldLabel hint={solo ? 'Solo vos' : `${s.participants.length} personas`}>Quiénes van</FieldLabel>
          <View style={styles.wrap}>
            {travelers.map((m) => {
              const on = s.participants.includes(m.id);
              return (
                <Chip
                  key={m.id}
                  label={m.id === me ? 'Yo' : (m.display_name ?? 'Alguien')}
                  selected={on}
                  icon={<Avatar person={m} size={20} />}
                  onPress={() => {
                    const participants = on ? s.participants.filter((x) => x !== m.id) : [...s.participants, m.id];
                    const stillSolo = participants.length === 1 && participants[0] === me;
                    set({ participants, isPrivate: stillSolo ? s.isPrivate : false });
                  }}
                />
              );
            })}
          </View>
          {errors.participants ? <Text style={styles.error}>{errors.participants}</Text> : null}
          {solo ? (
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchLabel}>Privado</Text>
                <Text style={styles.switchHint}>Los demás lo ven como “Ocupado”.</Text>
              </View>
              <Switch value={s.isPrivate} onValueChange={(isPrivate) => set({ isPrivate })} accessibilityLabel="Privado" />
            </View>
          ) : null}
        </View>
      ) : null}

      {show.status ? (
        <View>
          <FieldLabel>Estado</FieldLabel>
          <View style={styles.wrap}>
            {BLOCK_STATUS.map((st) => (
              <Chip key={st} label={STATUS_LABEL[st]} selected={s.status === st} onPress={() => set({ status: st })} />
            ))}
          </View>
        </View>
      ) : null}

      {show.cost ? (
        <View>
          <View style={styles.row}>
            <View style={styles.col}>
              <Field
                label="Costo estimado"
                value={s.cost}
                onChangeText={(cost) => set({ cost: cost.replace(/[^\d.,]/g, '') })}
                keyboardType="decimal-pad"
                placeholder="0"
                error={errors.cost}
              />
            </View>
          </View>
          <View style={[styles.wrap, { marginTop: space.sm }]}>
            {CURRENCIES.map((c) => (
              <Chip key={c} label={c} selected={s.currency === c} onPress={() => set({ currency: c })} />
            ))}
          </View>
        </View>
      ) : null}

      {show.booking ? (
        <Field
          label="Link de reserva"
          value={s.bookingUrl}
          onChangeText={(bookingUrl) => set({ bookingUrl })}
          placeholder="https://"
          autoCapitalize="none"
          keyboardType="url"
          error={errors.bookingUrl}
        />
      ) : null}

      {show.notes ? (
        <Field
          label="Notas"
          hint={s.type === 'lodging' ? 'Noches, código, etc.' : undefined}
          value={s.notes}
          onChangeText={(notes) => set({ notes })}
          placeholder="Algo para acordarse"
          multiline
          style={{ minHeight: 80, textAlignVertical: 'top' }}
        />
      ) : null}

      {errors.form ? <Text style={styles.formError}>{errors.form}</Text> : null}
    </View>
  );
}

const PLACEHOLDER: Record<BlockType, string> = {
  activity: 'Ej. Museo Torres García',
  meal: 'Ej. Almuerzo en el Mercado',
  tour: 'Ej. Tour Ciudad Vieja',
  transfer: 'Ej. Bus a Colonia',
  lodging: 'Ej. Hotel en Ciudad Vieja',
  free: 'Libre',
  meetup: 'Ej. Encuentro en Plaza Matriz',
};

export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

type PlaceResult = { google_place_id?: string; place_id?: string; id?: string; name: string; address?: string; formatted_address?: string; lat?: number; lng?: number };

/** Lugar: texto libre + buscador con search_places (si Google no está configurado, queda el texto). */
function PlaceField({ state: s, onChange, leg }: { state: BlockFormState; onChange: (s: BlockFormState) => void; leg?: PlanLeg }) {
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    const query = s.placeName.trim() || s.title.trim();
    if (!query) return;
    setLoading(true);
    setError(null);
    const res = await callTool<'search_places', unknown>('search_places', {
      query: leg ? `${query}, ${leg.city}` : query,
      ...(leg?.lat != null && leg?.lng != null ? { near: { lat: leg.lat, lng: leg.lng } } : {}),
      radius_m: 20000,
      max_results: 5,
    });
    setLoading(false);
    if (!res.ok) {
      setResults(null);
      // La causa real (sin conexión, Google sin configurar…) + que el nombre escrito queda igual.
      setError(`${errorLine(res.error, { doing: 'buscar lugares' })} Queda el nombre que escribiste.`);
      return;
    }
    const data = res.data as { places?: PlaceResult[] } | PlaceResult[];
    const list = Array.isArray(data) ? data : (data.places ?? []);
    setResults(list);
    if (!list.length) setError('No encontramos nada con ese nombre.');
  };

  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.placeRow}>
        <View style={{ flex: 1 }}>
          <Field
            label="Lugar"
            value={s.placeName}
            onChangeText={(placeName) => onChange({ ...s, placeName, place: undefined })}
            placeholder="Nombre del lugar"
            returnKeyType="search"
            onSubmitEditing={search}
          />
        </View>
        <Pressable onPress={search} style={styles.searchBtn} accessibilityRole="button" accessibilityLabel="Buscar lugar">
          {loading ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.searchText}>Buscar</Text>}
        </Pressable>
      </View>
      {s.place?.google_place_id ? <Text style={styles.placeOk}>Lugar de Google Maps ✓</Text> : null}
      {error ? <Text style={styles.switchHint}>{error}</Text> : null}
      {results?.length ? (
        <View style={styles.results}>
          {results.map((r, i) => {
            const id = r.google_place_id ?? r.place_id ?? r.id;
            return (
              <Pressable
                key={id ?? i}
                style={styles.result}
                accessibilityRole="button"
                onPress={() => {
                  onChange({ ...s, placeName: r.name, place: { google_place_id: id, lat: r.lat, lng: r.lng } });
                  setResults(null);
                }}
              >
                <Text style={styles.resultName}>{r.name}</Text>
                {r.address || r.formatted_address ? (
                  <Text style={styles.switchHint} numberOfLines={1}>
                    {r.address ?? r.formatted_address}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: space.lg },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  row: { flexDirection: 'row', gap: space.sm },
  col: { flex: 1 },
  error: { fontSize: font.tiny, color: colors.danger, marginTop: space.xs },
  formError: { fontSize: font.small, color: colors.danger, fontWeight: '600' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.md },
  switchLabel: { fontSize: font.body, fontWeight: '600', color: colors.text },
  switchHint: { fontSize: font.tiny, color: colors.textMuted },
  placeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  searchBtn: {
    minHeight: 48,
    paddingHorizontal: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  searchText: { color: colors.primary, fontWeight: '700', fontSize: font.small },
  placeOk: { fontSize: font.tiny, color: colors.success, fontWeight: '600' },
  results: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  result: { paddingHorizontal: space.md, paddingVertical: space.sm + 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, minHeight: 48, justifyContent: 'center' },
  resultName: { fontSize: font.small, fontWeight: '600', color: colors.text },
});
