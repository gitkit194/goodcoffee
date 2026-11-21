import { useLanguage } from '../i18n';
// Aroma wheel from the design: tap a category or one of its sub-aromas to pick it.
import { useWindowDimensions } from 'react-native';
import Svg, { G, Path, Text as SvgText } from 'react-native-svg';

import { AROMA_CATEGORIES, aromaName, normalizeAromaKey } from '../lib/coffee';
import { colors, fonts } from '../theme';

const C = 170;
const RI = 78;
const RO = 166;
const U = 360 / 17;

const pt = (r: number, a: number): [number, number] => {
  const t = (a * Math.PI) / 180;
  return [C + r * Math.sin(t), C - r * Math.cos(t)];
};
const f = (n: number) => n.toFixed(2);

function sector(r0: number, r1: number, a0: number, a1: number): string {
  const p1 = pt(r1, a0);
  const p2 = pt(r1, a1);
  const big = a1 - a0 > 180 ? 1 : 0;
  if (r0 === 0) return `M${C} ${C} L${f(p1[0])} ${f(p1[1])} A${r1} ${r1} 0 ${big} 1 ${f(p2[0])} ${f(p2[1])} Z`;
  const p3 = pt(r0, a1);
  const p4 = pt(r0, a0);
  return `M${f(p1[0])} ${f(p1[1])} A${r1} ${r1} 0 ${big} 1 ${f(p2[0])} ${f(p2[1])} L${f(p3[0])} ${f(p3[1])} A${r0} ${r0} 0 ${big} 0 ${f(p4[0])} ${f(p4[1])} Z`;
}

type Seg = { key: string; d: string; fill: string; label: string; x: number; y: number; rot: number; ink: string; size: number; weight: string };

function label(r: number, a0: number, a1: number) {
  const m = (((a0 + a1) / 2) % 360 + 360) % 360;
  const p = pt(r, m);
  return { x: p[0], y: p[1], rot: m <= 180 ? m - 90 : m + 90 };
}

export function AromaWheel({ selected, onToggle }: { selected: string[]; onToggle: (key: string) => void }) {
  useLanguage();
  const picked = selected.map(normalizeAromaKey);
  const { width } = useWindowDimensions();
  const size = Math.min(340, width - 48);
  const segs: Seg[] = [];
  let a = -2 * U;
  for (const c of AROMA_CATEGORIES) {
    const units = c.subs.length || 2;
    const a0 = a;
    const a1 = a + units * U;
    const on = picked.includes(c.key);
    if (c.subs.length) {
      segs.push({ key: c.key, d: sector(0, RI, a0, a1), fill: on ? colors.accent : c.inner, label: aromaName(c.key), ...label(44, a0, a1), ink: on ? colors.card : colors.wheelInk, size: 12, weight: fonts.uiMedium });
      c.subs.forEach((s, i) => {
        const k = c.key + ':' + s;
        const son = picked.includes(k);
        const s0 = a0 + i * U;
        segs.push({ key: k, d: sector(RI + 3, RO, s0, s0 + U), fill: son ? colors.accent : c.sub, label: aromaName(k), ...label(123, s0, s0 + U), ink: son ? colors.card : colors.wheelInk, size: 9, weight: fonts.ui });
      });
    } else {
      segs.push({ key: c.key, d: sector(0, RO, a0, a1), fill: on ? colors.accent : c.inner, label: aromaName(c.key), ...label(108, a0, a1), ink: on ? colors.card : colors.wheelInk, size: 12, weight: fonts.uiMedium });
    }
    a = a1;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 340 340">
      {segs.map((s) => (
        // No accessibilityRole here: on web it turns the group into a <button>, which SVG can't render.
        <G key={s.key} onPress={() => onToggle(s.key)}>
          <Path d={s.d} fill={s.fill} stroke={colors.bg} strokeWidth={2} />
          <SvgText x={s.x} y={s.y + s.size * 0.35} fontSize={s.size} fontFamily={s.weight} fill={s.ink} textAnchor="middle" transform={`rotate(${f(s.rot)}, ${f(s.x)}, ${f(s.y)})`}>
            {s.label}
          </SvgText>
        </G>
      ))}
    </Svg>
  );
}
