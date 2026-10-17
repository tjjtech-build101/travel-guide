// Menú de acciones nativo: ActionSheet en iOS, Alert en Android.
import { ActionSheetIOS, Alert, Platform } from 'react-native';

export type MenuOption = { label: string; onPress: () => void; destructive?: boolean };

export function showMenu(title: string | undefined, options: MenuOption[]) {
  if (Platform.OS === 'ios') {
    const labels = [...options.map((o) => o.label), 'Cancelar'];
    const destructiveIdx = options.findIndex((o) => o.destructive);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        options: labels,
        cancelButtonIndex: labels.length - 1,
        destructiveButtonIndex: destructiveIdx >= 0 ? destructiveIdx : undefined,
      },
      (i) => {
        if (i < options.length) options[i].onPress();
      },
    );
    return;
  }
  Alert.alert(title ?? '', undefined, [
    ...options.map((o) => ({ text: o.label, onPress: o.onPress, style: o.destructive ? ('destructive' as const) : ('default' as const) })),
    { text: 'Cancelar', style: 'cancel' as const },
  ]);
}

export function confirm(title: string, message: string, confirmLabel: string, onConfirm: () => void) {
  Alert.alert(title, message, [
    { text: 'Cancelar', style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}
