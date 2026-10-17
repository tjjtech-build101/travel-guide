// Íconos por tipo de bloque + algunos de UI del Plan (react-native-svg, mismo estilo que ui/icons).
import type { ColorValue } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

type P = { color: ColorValue; size?: number };

const base = (size: number, color: ColorValue) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: color,
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export function TypeIcon({ type, color, size = 20 }: P & { type: string }) {
  const s = base(size, color);
  switch (type) {
    case 'meal':
      return (
        <Svg {...s}>
          <Path d="M7 3v8M4.5 3v5a2.5 2.5 0 0 0 5 0V3M7 11v10M17 21V3c-2.2 1.2-3.5 3.6-3.5 7v3H17" />
        </Svg>
      );
    case 'tour':
      return (
        <Svg {...s}>
          <Path d="M5 21V4M5 4h11l-2 4 2 4H5" />
        </Svg>
      );
    case 'transfer':
      return (
        <Svg {...s}>
          <Rect x={4} y={3} width={16} height={14} rx={3} />
          <Path d="M4 11h16M8 21l1.5-4M16 21l-1.5-4" />
          <Circle cx={8} cy={14} r={0.6} />
          <Circle cx={16} cy={14} r={0.6} />
        </Svg>
      );
    case 'lodging':
      return (
        <Svg {...s}>
          <Path d="M3 19V6M3 13h18v6M21 13a3 3 0 0 0-3-3h-7v3" />
          <Circle cx={7} cy={10} r={1.6} />
        </Svg>
      );
    case 'free':
      return (
        <Svg {...s}>
          <Circle cx={12} cy={12} r={4} />
          <Path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </Svg>
      );
    case 'meetup':
      return (
        <Svg {...s}>
          <Circle cx={8} cy={8} r={3} />
          <Circle cx={16} cy={8} r={3} />
          <Path d="M2.5 19c.7-3 2.8-4.5 5.5-4.5 1.6 0 3 .5 4 1.6 1-1.1 2.4-1.6 4-1.6 2.7 0 4.8 1.5 5.5 4.5" />
        </Svg>
      );
    default:
      // activity
      return (
        <Svg {...s}>
          <Path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z" />
        </Svg>
      );
  }
}

export function LockIcon({ color, size = 14 }: P) {
  return (
    <Svg {...base(size, color)} strokeWidth={2.4}>
      <Rect x={5} y={11} width={14} height={10} rx={2} />
      <Path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </Svg>
  );
}

export function PlusIcon({ color, size = 24 }: P) {
  return (
    <Svg {...base(size, color)} strokeWidth={2.6}>
      <Path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function DotsIcon({ color, size = 22 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color as string}>
      <Circle cx={5} cy={12} r={2} />
      <Circle cx={12} cy={12} r={2} />
      <Circle cx={19} cy={12} r={2} />
    </Svg>
  );
}

export function ChevronIcon({ color, size = 18, open }: P & { open?: boolean }) {
  return (
    <Svg {...base(size, color)} strokeWidth={2.4}>
      <Path d={open ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6'} />
    </Svg>
  );
}

export function SparkIcon({ color, size = 18 }: P) {
  return (
    <Svg {...base(size, color)}>
      <Path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />
    </Svg>
  );
}

export function AlertIcon({ color, size = 13 }: P) {
  return (
    <Svg {...base(size, color)} strokeWidth={2.6}>
      <Circle cx={12} cy={12} r={9} />
      <Path d="M12 7v6M12 16.5v.5" />
    </Svg>
  );
}
