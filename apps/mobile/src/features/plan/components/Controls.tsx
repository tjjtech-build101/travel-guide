// Controles chicos del Plan: chip, segmentado, campo de texto con label y hora HH:MM.
import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { colors, font, MIN_TOUCH, radius, space } from '../../../ui/theme';

export function Chip({
  label,
  selected,
  onPress,
  color,
  icon,
  style,
  accessibilityLabel,
  disabled,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  color?: string;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  disabled?: boolean;
}) {
  const tint = color ?? colors.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      accessibilityLabel={accessibilityLabel ?? label}
      hitSlop={4}
      style={({ pressed }) => [
        styles.chip,
        selected ? { backgroundColor: tint, borderColor: tint } : { borderColor: color ?? colors.border },
        pressed && { opacity: 0.75 },
        disabled && { opacity: 0.4 },
        style,
      ]}
    >
      {icon}
      <Text style={[styles.chipText, selected ? styles.chipTextOn : color ? { color } : null]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.seg} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[styles.segItem, on && styles.segItemOn]}
          >
            <Text style={[styles.segText, on && styles.segTextOn]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function FieldLabel({ children, hint }: { children: string; hint?: string }) {
  return (
    <View style={styles.labelRow}>
      <Text style={styles.label}>{children}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Field({
  label,
  error,
  hint,
  style,
  ...props
}: TextInputProps & { label?: string; error?: string | null; hint?: string }) {
  return (
    <View style={styles.field}>
      {label ? <FieldLabel hint={hint}>{label}</FieldLabel> : null}
      <TextInput
        placeholderTextColor={colors.masked}
        style={[styles.input, error ? styles.inputError : null, style]}
        accessibilityLabel={label}
        {...props}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

/** "930" → "09:30", "1745" → "17:45". Devuelve null si no es una hora válida. */
export function normalizeTime(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  let h: number;
  let m: number;
  const colon = /^(\d{1,2})[:.h](\d{2})$/.exec(t);
  if (colon) {
    h = Number(colon[1]);
    m = Number(colon[2]);
  } else if (/^\d{1,4}$/.test(t)) {
    if (t.length <= 2) {
      h = Number(t);
      m = 0;
    } else {
      h = Number(t.slice(0, t.length - 2));
      m = Number(t.slice(-2));
    }
  } else return null;
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function TimeField({
  label,
  value,
  onChange,
  error,
  placeholder = 'HH:MM',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  placeholder?: string;
}) {
  return (
    <Field
      label={label}
      value={value}
      onChangeText={(t) => onChange(t.replace(/[^\d:]/g, '').slice(0, 5))}
      onEndEditing={() => {
        const n = normalizeTime(value);
        if (n) onChange(n);
      }}
      placeholder={placeholder}
      keyboardType="numbers-and-punctuation"
      maxLength={5}
      error={error}
      style={styles.timeInput}
    />
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    backgroundColor: colors.surface,
  },
  chipText: { fontSize: font.small, fontWeight: '600', color: colors.text },
  chipTextOn: { color: '#fff' },
  seg: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: 3,
    flex: 1,
  },
  segItem: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  segItemOn: {
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segText: { fontSize: font.small, fontWeight: '600', color: colors.textMuted },
  segTextOn: { color: colors.text },
  field: { gap: space.xs },
  labelRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  label: { fontSize: font.small, fontWeight: '700', color: colors.text },
  hint: { fontSize: font.tiny, color: colors.textMuted },
  input: {
    minHeight: MIN_TOUCH,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: font.body,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  inputError: { borderColor: colors.danger },
  error: { fontSize: font.tiny, color: colors.danger },
  timeInput: { fontVariant: ['tabular-nums'] },
});
