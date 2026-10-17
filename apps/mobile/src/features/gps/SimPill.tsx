// Badge "SIM" + mini controles flotantes del simulador (PRD 09). Solo aparece con la ubicación simulada.
// Arrastrable; toque largo la achica a solo "SIM" (para grabar pantalla limpia) y un toque la vuelve a abrir.
import { SIM_SPEEDS } from '@build101/shared';
import { useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSimulator } from '../../location/LocationContext';
import { Text } from '../../ui/Text';
import { formatClock } from './format';

export function SimPill() {
  const { sim, state, enabled, start, active } = useSimulator();
  const insets = useSafeAreaInsets();
  const [collapsed, setCollapsed] = useState(false);
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) + Math.abs(g.dy) > 6,
      onPanResponderGrant: () => {
        pan.extractOffset();
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: () => pan.flattenOffset(),
    }),
  ).current;

  if (!enabled) return null;

  const nextSpeed = () => {
    const i = SIM_SPEEDS.indexOf(state.speed);
    sim.setSpeed(SIM_SPEEDS[(i + 1) % SIM_SPEEDS.length]);
  };

  return (
    <Animated.View
      {...responder.panHandlers}
      style={[styles.wrap, { top: insets.top + 52, transform: pan.getTranslateTransform() }]}
      pointerEvents="box-none"
    >
      <View style={styles.pill}>
        <Pressable
          onPress={() => setCollapsed((c) => !c)}
          onLongPress={() => setCollapsed(true)}
          accessibilityRole="button"
          accessibilityLabel={collapsed ? 'Mostrar controles del simulador' : 'Ubicación simulada activa'}
          hitSlop={6}
        >
          <Text style={styles.badge}>SIM</Text>
        </Pressable>
        {!collapsed && state.trackLabel ? (
          <>
            <Pressable
              onPress={async () => {
                if (state.playing) sim.pause();
                else {
                  if (!active) await start('simulated');
                  sim.play();
                }
              }}
              onLongPress={() => setCollapsed(true)}
              accessibilityRole="button"
              accessibilityLabel={state.playing ? 'Pausar simulador' : 'Reproducir simulador'}
              hitSlop={6}
              style={styles.btn}
            >
              <Text style={styles.btnText}>{state.playing ? '❚❚' : '▶'}</Text>
            </Pressable>
            <Pressable
              onPress={nextSpeed}
              onLongPress={() => setCollapsed(true)}
              accessibilityRole="button"
              accessibilityLabel={`Velocidad ${state.speed}x, tocá para cambiar`}
              hitSlop={6}
              style={styles.btn}
            >
              <Text style={styles.btnText}>{state.speed}x</Text>
            </Pressable>
            <Text style={styles.time}>{formatClock(state.t)}</Text>
          </>
        ) : null}
        {!collapsed && !state.trackLabel ? <Text style={styles.time}>sin track</Text> : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', right: 10, zIndex: 1000, elevation: 1000 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(27,27,26,0.88)',
  },
  badge: {
    color: '#1B1B1A',
    backgroundColor: '#FACC15',
    fontWeight: '800',
    fontSize: 12,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  btn: { minWidth: 30, height: 28, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  time: { color: '#FFFFFF', fontFamily: 'Menlo', fontSize: 12, marginRight: 4 },
});
