// Shared prop contract for every hand-drawn icon in this folder. Keeping it
// in one place avoids repeating the same shape ten times and makes future
// additions (e.g. a stroke-width knob) a one-file edit.
export interface IconProps {
  size?: number;
  color?: string;
}
