import Svg, { Circle, Path } from 'react-native-svg';

import { colors } from '../theme';

type P = { color?: string; size?: number };

export function HomeIcon({ color = colors.muted, size = 22 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round">
      <Path d="M4 10.5 12 4l8 6.5V20h-5.5v-5.5h-5V20H4z" />
    </Svg>
  );
}

export function SearchIcon({ color = colors.muted, size = 22 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round">
      <Circle cx={10.5} cy={10.5} r={6} />
      <Path d="m15 15 5 5" />
    </Svg>
  );
}

export function BookIcon({ color = colors.muted, size = 22 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round">
      <Path d="M5 4.5h11.5a2 2 0 0 1 2 2V20H7a2 2 0 0 1-2-2z" />
      <Path d="M5 16a2 2 0 0 1 2-2h11.5" />
    </Svg>
  );
}

export function PersonIcon({ color = colors.muted, size = 22 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round">
      <Circle cx={12} cy={8.5} r={3.5} />
      <Path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
    </Svg>
  );
}

export function PlusIcon({ color = colors.onAccent, size = 22 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round">
      <Path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function ChevronIcon({ color = colors.muted, size = 16, down }: P & { down?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <Path d={down ? 'm6 9 6 6 6-6' : 'm9 6 6 6-6 6'} />
    </Svg>
  );
}

export function CheckIcon({ color = colors.card, size = 14 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="m5 12.5 4.5 4.5L19 7.5" />
    </Svg>
  );
}

export function SearchFieldIcon() {
  return <SearchIcon size={18} />;
}

export function CameraIcon({ color = colors.onAccent, size = 22 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round">
      <Path d="M4 8h3.5L9 5.5h6L16.5 8H20v11H4z" />
      <Circle cx={12} cy={13} r={3.5} />
    </Svg>
  );
}
