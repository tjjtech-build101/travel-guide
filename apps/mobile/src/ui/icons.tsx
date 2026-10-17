// Íconos mínimos con react-native-svg (sin librerías de íconos extra).
import type { ColorValue } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

type IconProps = { color: ColorValue; size?: number };

export function PlanIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Rect x={3} y={4} width={18} height={17} rx={2} />
      <Path d="M3 9h18M8 2v4M16 2v4M7 13h4M7 17h7" />
    </Svg>
  );
}

export function MapIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
      <Circle cx={12} cy={9.5} r={2.5} />
    </Svg>
  );
}

/** Vista Ahora: brújula (lo del scout en la calle). */
export function NowIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx={12} cy={12} r={9} />
      <Path d="M15.5 8.5l-2 5-5 2 2-5z" />
    </Svg>
  );
}

export function CameraIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <Circle cx={12} cy={13} r={3.5} />
    </Svg>
  );
}

export function RouteIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx={6} cy={19} r={2.5} />
      <Circle cx={18} cy={5} r={2.5} />
      <Path d="M8.5 19H16a3.5 3.5 0 0 0 0-7H8a3.5 3.5 0 0 1 0-7h7.5" />
    </Svg>
  );
}

export function FlagIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M5 21V4M5 4h11l-2 4 2 4H5" />
    </Svg>
  );
}

export function GroupIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx={9} cy={8} r={3.5} />
      <Path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" />
      <Circle cx={17} cy={9} r={2.5} />
      <Path d="M16.5 14.6c2.4.2 4.2 1.9 5 4.9" />
    </Svg>
  );
}

export function MoneyIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Rect x={2.5} y={6} width={19} height={12} rx={2} />
      <Circle cx={12} cy={12} r={2.5} />
    </Svg>
  );
}

export function BookIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v16H5.5A1.5 1.5 0 0 0 4 20.5z" />
      <Path d="M4 20.5A1.5 1.5 0 0 0 5.5 22H20" />
    </Svg>
  );
}

export function BackIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M15 5l-7 7 7 7" />
    </Svg>
  );
}

// ---------- llamada con el scout (PRD 05) ----------

export function MicIcon({ color, size = 24, off = false }: IconProps & { off?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Rect x={9} y={2} width={6} height={12} rx={3} />
      <Path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
      {off ? <Path d="M3 3l18 18" /> : null}
    </Svg>
  );
}

export function SpeakerIcon({ color, size = 24, on = true }: IconProps & { on?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 9h4l5-4v14l-5-4H4z" />
      {on ? <Path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /> : <Path d="M17 10l4 4M21 10l-4 4" />}
    </Svg>
  );
}

export function HangUpIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M3 14.5c5-5 13-5 18 0l-2.5 2.5-3.5-1.5v-2.5a10 10 0 0 0-6 0v2.5L5.5 17z" />
    </Svg>
  );
}

export function CaptionsIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Rect x={3} y={5} width={18} height={14} rx={2} />
      <Path d="M7 11h4M13 11h4M7 15h7" />
    </Svg>
  );
}

export function HandIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5A6.5 6.5 0 0 1 4 16l-1-3a1.5 1.5 0 0 1 2.7-1.2L8 15" />
    </Svg>
  );
}

// --- Clima y avisos (Ahora v2) ---

export function SunIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx={12} cy={12} r={4} />
      <Path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </Svg>
  );
}

export function CloudIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M7 18h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.6 1.5A3.3 3.3 0 0 0 7 18z" />
    </Svg>
  );
}

export function RainIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M7 14h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.6 1.5A3.3 3.3 0 0 0 7 14z" />
      <Path d="M8 17.5l-1 2.5M12 17.5l-1 2.5M16 17.5l-1 2.5" />
    </Svg>
  );
}

export function StormIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M7 14h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.6 1.5A3.3 3.3 0 0 0 7 14z" />
      <Path d="M12.5 15.5l-2 3.5h3l-2 3.5" />
    </Svg>
  );
}

export function SnowIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5L12 6l2.5-1.5M9.5 19.5L12 18l2.5 1.5" />
    </Svg>
  );
}

export function FogIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 9h16M3 13h14M6 17h15" />
    </Svg>
  );
}

/** Sin conexión: nube tachada. */
export function OfflineIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M7 18h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.6 1.5A3.3 3.3 0 0 0 7 18z" />
      <Path d="M3 3l18 18" />
    </Svg>
  );
}

/** Propuestas del Scout: chispa. */
export function SparkIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 3l2 5.5 5.5 2-5.5 2L12 18l-2-5.5-5.5-2L10 8.5z" />
    </Svg>
  );
}

export function CloseIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}
