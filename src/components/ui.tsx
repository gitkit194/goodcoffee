import { t, useLanguage } from '../i18n';
// Shared building blocks in the V2 look: warm paper background, Cormorant titles, Inter text.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Dimensions,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollViewInstance,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { colors, fonts, space } from '../theme';

export function T({ style, ...props }: TextProps & { style?: StyleProp<TextStyle> }) {
  return <Text {...props} style={[styles.text, style]} />;
}

type ScreenProps = {
  children: ReactNode;
  /** Pinned below the scrolling content, e.g. the main action. */
  footer?: ReactNode;
  scroll?: boolean;
  scrollEnabled?: boolean;
  gap?: number;
  scrollRef?: React.RefObject<ScrollViewInstance | null>;
};

/** Space kept between the focused field and the top of the keyboard. */
const KEYBOARD_GAP = 32;

export function Screen({ children, footer, scroll = true, scrollEnabled = true, gap = 16, scrollRef }: ScreenProps) {
  const ownRef = useRef<ScrollViewInstance>(null);
  const ref = scrollRef ?? ownRef;
  const scrollY = useRef(0);
  const [keyboard, setKeyboard] = useState(0);

  // iOS: while the keyboard is up, hide the footer, leave room to scroll and lift the focused field above it.
  useEffect(() => {
    if (Platform.OS !== 'ios' || !scroll) return;
    const show = Keyboard.addListener('keyboardWillShow', (e) => {
      const height = e.endCoordinates.height;
      setKeyboard(height);
      const input = TextInput.State.currentlyFocusedInput();
      if (!input) return;
      // Wait one frame so the extra bottom space exists before scrolling into it.
      requestAnimationFrame(() => {
        input.measureInWindow((_x, y, _w, h) => {
          const visibleBottom = Dimensions.get('window').height - height - KEYBOARD_GAP;
          const overlap = y + h - visibleBottom;
          if (overlap > 0) ref.current?.scrollTo({ y: scrollY.current + overlap, animated: true });
        });
      });
    });
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboard(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [scroll, ref]);

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      {scroll ? (
        <ScrollView
          ref={ref}
          scrollEnabled={scrollEnabled}
          keyboardShouldPersistTaps="handled"
          // Scrolling (or on iOS dragging the keyboard down) closes the keyboard.
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          onScroll={(e) => {
            scrollY.current = e.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
          contentContainerStyle={[styles.content, { gap }, keyboard ? { paddingBottom: keyboard + KEYBOARD_GAP } : null]}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, { gap, flex: 1 }]}>{children}</View>
      )}
      {footer && !keyboard ? <SafeAreaView edges={['bottom']} style={styles.footer}>{footer}</SafeAreaView> : null}
    </SafeAreaView>
  );
}

export function Brand({ right }: { right?: ReactNode }) {
  return (
    <View style={styles.brandRow}>
      <T style={styles.brand}>GoodCoffee</T>
      {right}
    </View>
  );
}

type HeaderAction = { label: string; onPress: () => void };

/** Navigation row under the brand: back action, centred title, optional right action or step count. */
export function NavHeader({ left, title, right, steps }: { left?: HeaderAction; title: string; right?: HeaderAction | string; steps?: boolean[] }) {
  return (
    <View style={{ gap: 12 }}>
      <View style={styles.navRow}>
        <View style={styles.navSide}>
          {left ? (
            <Pressable onPress={left.onPress} hitSlop={8} accessibilityRole="button">
              <T style={styles.navLink}>{left.label}</T>
            </Pressable>
          ) : null}
        </View>
        <T style={styles.navTitle}>{title}</T>
        <View style={[styles.navSide, { alignItems: 'flex-end' }]}>
          {typeof right === 'string' ? (
            <T style={styles.navStep}>{right}</T>
          ) : right ? (
            <Pressable onPress={right.onPress} hitSlop={8} accessibilityRole="button">
              <T style={styles.navLink}>{right.label}</T>
            </Pressable>
          ) : null}
        </View>
      </View>
      {steps ? (
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {steps.map((on, i) => (
            <View key={i} style={[styles.stepBar, { backgroundColor: on ? colors.accent : colors.line }]} />
          ))}
        </View>
      ) : (
        <View style={styles.hairline} />
      )}
    </View>
  );
}

export function Eyebrow({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <T style={[styles.eyebrow, style]}>{children}</T>;
}

export function Title({ children, size = 38 }: { children: ReactNode; size?: number }) {
  return <T style={[styles.title, { fontSize: size, lineHeight: size * 1.04 }]}>{children}</T>;
}

export function Card({ children, style, onPress, selected }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; selected?: boolean }) {
  const body = [styles.card, selected && { borderColor: colors.accent, borderWidth: 1.5 }, style];
  if (!onPress) return <View style={body}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [body, pressed && { opacity: 0.85 }]} accessibilityRole="button">
      {children}
    </Pressable>
  );
}

export function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.primary, disabled && styles.primaryDisabled, pressed && !disabled && { opacity: 0.88 }]}
    >
      <T style={[styles.primaryLabel, disabled && { color: colors.muted }]}>{label}</T>
    </Pressable>
  );
}

export function TextButton({ label, onPress, underline, style }: { label: string; onPress: () => void; underline?: boolean; style?: StyleProp<TextStyle> }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button">
      <T style={[styles.textButton, underline && { textDecorationLine: 'underline' }, style]}>{label}</T>
    </Pressable>
  );
}

export function DashedButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.dashed, pressed && { opacity: 0.8 }]}>
      <T style={styles.dashedLabel}>＋  {label}</T>
    </Pressable>
  );
}

export function Pill({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={[styles.pill, active && { backgroundColor: colors.accent, borderColor: colors.accent }]}
    >
      <T style={[styles.pillLabel, active && { color: colors.card }]}>{label}</T>
    </Pressable>
  );
}

export function Chip({ label, active, onRemove }: { label: string; active?: boolean; onRemove?: () => void }) {
  useLanguage();
  return (
    <View style={[styles.chip, active && { backgroundColor: colors.accent }]}>
      <T style={[styles.chipLabel, active && { color: colors.card }]}>{label}</T>
      {onRemove ? (
        <Pressable onPress={onRemove} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("Remove {label}", { label })}>
          <T style={[styles.chipLabel, { color: active ? colors.card : colors.muted }]}>×</T>
        </Pressable>
      ) : null}
    </View>
  );
}

const BEAN_TONES = ['#D8C5A9', '#C9AE8E', '#B89878', '#A8876A'];

export function BeanIcon({ id, size = 40 }: { id: string; size?: number }) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const tone = BEAN_TONES[h % BEAN_TONES.length];
  const s = size * 0.5;
  return (
    <View style={{ width: size, height: size, borderRadius: 6, backgroundColor: tone, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={s} height={s} viewBox="0 0 24 24">
        <Path d="M12 3c4.4 0 7 3.6 7 8.6S15.8 21 11.4 21 5 17.5 5 12.4 7.6 3 12 3z" stroke={colors.text} strokeWidth={1.3} fill="none" />
        <Path d="M13.5 4c-2.6 3-2.6 6.6-.6 9.2s1.4 5.6-1.2 7.6" stroke={colors.text} strokeWidth={1.3} fill="none" strokeLinecap="round" />
      </Svg>
    </View>
  );
}

export function Stars({ value, size = 13 }: { value: number | null | undefined; size?: number }) {
  if (!value) return null;
  return <T style={{ fontSize: size, fontFamily: fonts.uiMedium, color: colors.text }}>★ {value}</T>;
}

export function StarPicker({ value, onChange, disabled }: { value: number; onChange: (n: number) => void; disabled?: boolean }) {
  useLanguage();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const on = n <= value;
        return (
          <Pressable
            key={n}
            onPress={() => onChange(n)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={t("starCount", { count: n })}
            accessibilityState={{ selected: n === value, disabled: !!disabled }}
            style={[styles.starTile, { backgroundColor: on ? colors.neutral : 'transparent' }]}
          >
            <Svg width={26} height={26} viewBox="0 0 24 24">
              <Path
                d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z"
                fill={on ? colors.accent : 'none'}
                stroke={colors.accent}
                strokeWidth={1.4}
                strokeLinejoin="round"
              />
            </Svg>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Stepper({ label, value, onMinus, onPlus, compact }: { label: string; value: string; onMinus: () => void; onPlus: () => void; compact?: boolean }) {
  useLanguage();
  return (
    <View style={[styles.stepper, compact && { paddingVertical: 6, gap: 3 }]}>
      <Eyebrow style={{ textAlign: 'center' }}>{label}</Eyebrow>
      <T style={[styles.stepperValue, compact && { fontSize: 23, lineHeight: 26 }]}>{value}</T>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <RoundButton label="−" onPress={onMinus} a11y={t("Decrease {label}", { label })} size={compact ? 28 : 32} />
        <RoundButton label="+" onPress={onPlus} a11y={t("Increase {label}", { label })} size={compact ? 28 : 32} />
      </View>
    </View>
  );
}

export function RoundButton({ label, onPress, a11y, size = 32 }: { label: string; onPress: () => void; a11y: string; size?: number }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      hitSlop={6}
      style={({ pressed }) => [
        { width: size, height: size, borderRadius: size / 2, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
        pressed && { backgroundColor: colors.neutral },
      ]}
    >
      <T style={{ fontSize: 18, lineHeight: 20, color: colors.text }}>{label}</T>
    </Pressable>
  );
}

type SliderProps = {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  onDragging?: (on: boolean) => void;
  label: string;
  /** Draw the middle third as the target zone (extraction). */
  zones?: boolean;
  /** Show the value but ignore touches (e.g. after the entry was saved). */
  disabled?: boolean;
};

export function Slider({ value, min = 0, max = 10, step = 1, onChange, onDragging, label, zones, disabled }: SliderProps) {
  const [width, setWidth] = useState(0);
  const start = useRef({ x: 0, pageX: 0 });

  const setFromX = (x: number) => {
    const w = width || 1;
    const raw = min + (Math.min(Math.max(x, 0), w) / w) * (max - min);
    const next = Math.round(raw / step) * step;
    if (next !== value) onChange(next);
  };

  const pct = (value - min) / (max - min);
  return (
    <View
      style={{ height: 44, justifyContent: 'center' }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min, max, now: value }}
      accessibilityState={{ disabled: !!disabled }}
      accessibilityActions={disabled ? [] : [{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => !disabled && onChange(Math.min(max, Math.max(min, value + (e.nativeEvent.actionName === 'increment' ? step : -step))))}
      onStartShouldSetResponder={() => !disabled}
      onMoveShouldSetResponder={() => !disabled}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => {
        start.current = { x: e.nativeEvent.locationX, pageX: e.nativeEvent.pageX };
        onDragging?.(true);
        setFromX(start.current.x);
      }}
      onResponderMove={(e) => setFromX(start.current.x + e.nativeEvent.pageX - start.current.pageX)}
      onResponderRelease={() => onDragging?.(false)}
      onResponderTerminate={() => onDragging?.(false)}
    >
      <View pointerEvents="none" style={styles.sliderTrack}>
        {zones ? (
          <>
            <View style={{ flex: 3.5, backgroundColor: colors.field }} />
            <View style={{ flex: 3, backgroundColor: colors.kraft }} />
            <View style={{ flex: 3.5, backgroundColor: colors.field }} />
          </>
        ) : (
          <View style={{ width: pct * width, backgroundColor: colors.accent }} />
        )}
      </View>
      <View pointerEvents="none" style={[styles.sliderThumb, { left: pct * width - 14 }]} />
    </View>
  );
}

/** Read-only level bar (0–10). */
export function LevelBar({ value }: { value: number }) {
  return (
    <View style={[styles.sliderTrack, { height: 6, borderRadius: 3 }]}>
      <View style={{ width: `${value * 10}%`, backgroundColor: colors.accent }} />
    </View>
  );
}

export function Field({ label, optional, style, ...props }: TextInputProps & { label?: string; optional?: boolean }) {
  useLanguage();
  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <T style={styles.fieldLabel}>{label}</T>
          {optional ? <Eyebrow>{t("optional")}</Eyebrow> : null}
        </View>
      ) : null}
      <TextInput placeholderTextColor={colors.muted} {...props} style={[styles.field, style]} />
    </View>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Eyebrow>{children}</Eyebrow>
      {right}
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>{children}</View>;
}

export const styles = StyleSheet.create({
  text: { fontFamily: fonts.ui, color: colors.text, fontSize: 14 },
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.gutter, paddingTop: 12, paddingBottom: 24 },
  footer: { paddingHorizontal: space.gutter, paddingTop: 10, paddingBottom: 12, backgroundColor: colors.bg, gap: 10 },
  brandRow: { height: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { fontFamily: fonts.brand, fontSize: 23 },
  navRow: { minHeight: 43, flexDirection: 'row', alignItems: 'center' },
  navSide: { flex: 1 },
  navLink: { fontSize: 13, color: colors.muted },
  navTitle: { fontSize: 13, fontFamily: fonts.uiMedium },
  navStep: { fontSize: 12, color: colors.accent },
  stepBar: { flex: 1, height: 2, borderRadius: 1 },
  hairline: { height: 1, backgroundColor: colors.line },
  eyebrow: { fontSize: 10, fontFamily: fonts.uiMedium, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.muted },
  title: { fontFamily: fonts.serifMedium, letterSpacing: -1 },
  card: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 16 },
  primary: { height: 54, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  primaryDisabled: { backgroundColor: colors.neutral },
  primaryLabel: { color: colors.onAccent, fontFamily: fonts.uiMedium, fontSize: 14 },
  textButton: { fontSize: 13, color: colors.accent, fontFamily: fonts.uiMedium },
  dashed: { height: 52, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.kraft, alignItems: 'center', justifyContent: 'center' },
  dashedLabel: { fontSize: 13, fontFamily: fonts.uiMedium, color: colors.text },
  pill: { height: 36, paddingHorizontal: 18, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, justifyContent: 'center' },
  pillLabel: { fontSize: 13, color: colors.text },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 28, borderRadius: 14, backgroundColor: colors.field },
  chipLabel: { fontSize: 12, color: colors.text },
  starTile: { width: 52, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  stepper: { flex: 1, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.line, paddingVertical: 10, alignItems: 'center', gap: 6 },
  stepperValue: { fontFamily: fonts.serif, fontSize: 27, lineHeight: 30, fontVariant: ['lining-nums'] },
  sliderTrack: { height: 8, borderRadius: 4, backgroundColor: colors.line, overflow: 'hidden', flexDirection: 'row' },
  sliderThumb: { position: 'absolute', top: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: colors.accent, borderWidth: 3, borderColor: colors.thumbRing },
  fieldLabel: { fontSize: 14, fontFamily: fonts.uiMedium },
  field: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, paddingHorizontal: 14, fontFamily: fonts.ui, fontSize: 14, color: colors.text },
});
