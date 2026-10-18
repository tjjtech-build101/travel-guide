// Galería de Ahora v2 (solo __DEV__): todas las piezas en todos sus estados, con datos fijos.
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { GalleryA } from '../../../features/now/v2/ui/gallery/GalleryA';
import { GalleryB } from '../../../features/now/v2/ui/gallery/GalleryB';
import { Chip } from '../../../features/plan/components/Controls';
import { colors, space } from '../../../ui/theme';

export default function NowGallery() {
  const [tab, setTab] = useState<'a' | 'b'>('b');
  if (!__DEV__) return <Redirect href="/" />;
  return (
    <View style={styles.flex}>
      <View style={styles.tabs}>
        <Chip label="Protagonistas y dock" selected={tab === 'b'} onPress={() => setTab('b')} />
        <Chip label="Piezas chicas" selected={tab === 'a'} onPress={() => setTab('a')} />
      </View>
      {tab === 'a' ? <GalleryA /> : <GalleryB />}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  tabs: { flexDirection: 'row', gap: space.sm, padding: space.md },
});
