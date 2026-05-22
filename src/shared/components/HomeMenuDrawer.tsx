import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  colors,
  elevation,
  hitTarget,
  radius,
  spacing,
  typography,
} from '../theme';

export interface HomeMenuDrawerProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Width in dp; default 320. Caller can shrink for very narrow phones. */
  widthDp?: number;
}

const DEFAULT_WIDTH_DP = 320;

/**
 * Slide-in drawer pinned to the right edge. Used by HomeScreen in landscape
 * orientation to collapse all chrome (badges, banners, action buttons) behind
 * a single MENU button so the map can take the full viewport.
 *
 * Implementation: a `Modal` with a transparent backdrop + an inline panel
 * positioned absolutely against the right edge. We use `animationType="slide"`
 * so the OS handles the slide-in animation for us — no Animated value plumbing
 * required and the timing matches the platform's native modal feel.
 *
 * Layout contract:
 * - Backdrop dims 50% black; tapping it closes the drawer.
 * - Panel is full height, width = `widthDp` (default 320 dp).
 * - Top-left and bottom-left corners are rounded (`radius.lg`); the right
 *   edge sits flush against the screen so the rounded corners don't get
 *   clipped weirdly.
 * - Decorative drag-handle pip at the top centre + a 44dp round close X in
 *   the corner. Tapping anywhere on the backdrop, or the X, closes the drawer.
 * - A left border line reinforces the panel separation on Android, where
 *   horizontal shadows don't render predictably with elevation.
 */
export const HomeMenuDrawer: React.FC<HomeMenuDrawerProps> = ({
  visible,
  onClose,
  children,
  widthDp = DEFAULT_WIDTH_DP,
}) => {
  return (
    <Modal
      visible={visible}
      onRequestClose={onClose}
      transparent
      animationType="slide"
      testID="home-menu-drawer"
    >
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Fechar menu"
          testID="home-menu-drawer-backdrop"
        />
        <View style={[styles.panel, { width: widthDp }]}>
          {/* Decorative drag handle pip + close X share the top of the panel */}
          <View style={styles.panelTop}>
            <View
              style={styles.dragHandle}
              testID="home-menu-drawer-handle"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Fechar menu"
              style={({ pressed }) => [
                styles.closeButton,
                pressed ? styles.closeButtonPressed : null,
              ]}
              testID="home-menu-drawer-close"
            >
              <Text style={styles.closeLabel}>X</Text>
            </Pressable>
          </View>
          <View style={styles.body}>{children}</View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  panel: {
    marginLeft: 'auto',
    height: '100%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderBottomLeftRadius: radius.lg,
    borderLeftWidth: 1,
    borderLeftColor: colors.borderSubtle,
    ...elevation.sheet,
  },
  panelTop: {
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    // The handle sits centred while the close X floats on the right; we
    // achieve that with absolute positioning so the handle stays exactly
    // centred regardless of the X button size.
    position: 'relative',
  },
  dragHandle: {
    width: 32,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textMuted,
    alignSelf: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  closeButton: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: hitTarget.min,
    height: hitTarget.min,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  closeButtonPressed: {
    opacity: 0.6,
  },
  closeLabel: {
    color: colors.textPrimary,
    fontSize: typography.sizes.lg,
    fontWeight: '700',
  },
  body: {
    flex: 1,
  },
});
