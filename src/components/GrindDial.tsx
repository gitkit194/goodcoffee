import { t, useLanguage } from '../i18n';
// Grinder dial: drag it round like a real burr ring, or use − / +. The value sits at the pointer at the bottom.
import { useRef } from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';

import { short } from '../lib/format';
import { colors, fonts } from '../theme';
import { Eyebrow, RoundButton, T } from './ui';

const MAX = 100;
const DEG = 360 / MAX;

type Props = {
  value: number;
  onChange: (v: number) => void;
  onDragging?: (on: boolean) => void;
  size?: number;
};

function clamp(v: number) {
  return Math.min(MAX - 1, Math.max(0, v));
}

export function GrindDial({ value, onChange, onDragging, size = 216 }: Props) {
  useLanguage();
  const center = useRef({ x: 0, y: 0 });
  const start = useRef({ angle: 0, value: 0 });
  const angleAt = (x: number, y: number) => (Math.atan2(y - center.current.y, x - center.current.x) * 180) / Math.PI;

  const c = 120;
  const rotation = 180 - value * DEG;
  const ticks = [];
  for (let i = 0; i < MAX; i += 2) {
    const long = i % 10 === 0;
    const a = (i * DEG * Math.PI) / 180;
    const r0 = long ? 98 : 103;
    ticks.push(
      <Line
        key={i}
        x1={c + r0 * Math.sin(a)}
        y1={c - r0 * Math.cos(a)}
        x2={c + 110 * Math.sin(a)}
        y2={c - 110 * Math.cos(a)}
        stroke={colors.text}
        strokeWidth={long ? 1.6 : 0.9}
      />,
    );
  }
  const labels = [];
  for (let i = 0; i < MAX; i += 10) {
    const a = (i * DEG * Math.PI) / 180;
    const x = c + 84 * Math.sin(a);
    const y = c - 84 * Math.cos(a);
    labels.push(
      <SvgText key={i} x={x} y={y + 4} fontSize={12} fill={colors.text} textAnchor="middle" fontFamily={fonts.ui} transform={`rotate(${i * DEG}, ${x}, ${y})`}>
        {String(i)}
      </SvgText>,
    );
  }

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
      <RoundButton label="−" onPress={() => onChange(clamp(value - 1))} a11y={t("Finer grind")} size={36} />
      <View
        style={{ width: size, height: size + 10 }}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={t("Grind")}
        accessibilityValue={{ min: 0, max: MAX - 1, now: value }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => onChange(clamp(value + (e.nativeEvent.actionName === 'increment' ? 1 : -1)))}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => {
          const { pageX, pageY, locationX, locationY } = e.nativeEvent;
          // Centre from this touch: page position minus position inside the dial plus half the size.
          center.current = { x: pageX - locationX + size / 2, y: pageY - locationY + size / 2 };
          start.current = { angle: angleAt(pageX, pageY), value };
          onDragging?.(true);
        }}
        onResponderMove={(e) => {
          const { pageX, pageY } = e.nativeEvent;
          let delta = angleAt(pageX, pageY) - start.current.angle;
          if (delta > 180) delta -= 360;
          if (delta < -180) delta += 360;
          const next = clamp(Math.round(start.current.value - delta / DEG));
          if (next !== value) onChange(next);
          // Re-anchor so that crossing ±180° keeps working on long drags.
          if (Math.abs(delta) > 90) start.current = { angle: angleAt(pageX, pageY), value: next };
        }}
        onResponderRelease={() => onDragging?.(false)}
        onResponderTerminate={() => onDragging?.(false)}
      >
        <Svg width={size} height={size + 10} viewBox="0 0 240 251" pointerEvents="none">
          <Circle cx={c} cy={c} r={118} fill={colors.card} stroke={colors.line} strokeWidth={1.5} />
          <G transform={`rotate(${rotation}, ${c}, ${c})`}>
            {ticks}
            {labels}
          </G>
          <Circle cx={c} cy={c} r={58} fill={colors.neutral} />
          <Path d="M120 236 l-8 13 h16 z" fill={colors.accent} />
        </Svg>
        {/* The value sits in the dial's hub, so the dial and its reading take one block. */}
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <T style={{ fontFamily: fonts.serif, fontSize: 38, lineHeight: 40, fontVariant: ['lining-nums'] }}>{short(value)}</T>
          <Eyebrow style={{ fontSize: 9 }}>{t("Grind")}</Eyebrow>
        </View>
      </View>
      <RoundButton label="+" onPress={() => onChange(clamp(value + 1))} a11y={t("Coarser grind")} size={36} />
    </View>
  );
}
