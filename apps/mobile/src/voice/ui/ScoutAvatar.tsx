// Avatar del scout (provisorio hasta que se defina el personaje): inicial sobre verde, anillos que laten al hablar.
import { SCOUT } from '@build101/shared';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

export const SCOUT_COLOR = '#2F7D4A';

export function ScoutAvatar({ size = 64, pulse = null }: { size?: number; pulse?: 'user' | 'assistant' | 'connecting' | null }) {
  const t = useSharedValue(0);
  useEffect(() => {
    if (pulse) t.value = withRepeat(withTiming(1, { duration: pulse === 'connecting' ? 1200 : 900 }), -1, false);
    else {
      cancelAnimation(t);
      t.value = 0;
    }
  }, [pulse, t]);
  const ring = useAnimatedStyle(() => ({
    opacity: pulse ? 0.55 * (1 - t.value) : 0,
    transform: [{ scale: 1 + t.value * 0.45 }],
  }));
  const ringColor = pulse === 'user' ? '#1F6FEB' : SCOUT_COLOR;
  return (
    <View style={{ width: size, height: size }} accessibilityLabel={SCOUT.name}>
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: size / 2, backgroundColor: ringColor }, ring]} />
      <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}>
        <Text style={[styles.initial, { fontSize: size * 0.42 }]}>{SCOUT.name.slice(0, 1).toUpperCase()}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { backgroundColor: SCOUT_COLOR, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#fff' },
  initial: { color: '#fff', fontWeight: '800' },
});
