/*
 * Number-to-CSS formatters for the overlay views.
 *
 * Every number those views write into a `style` goes through one of these three, which
 * round to below anything visible: a thousandth of a percent is a hundredth of a pixel,
 * 1e-5 radians is six ten-thousandths of a degree, and a thousandth of an opacity step is
 * under one 255th.
 *
 * The point is only to keep full-precision floats out of the DOM — each of these is
 * called once per rendered frame per element, and a raw `atan2` result or a raw
 * `life / HIT_MARK_SECONDS` is regularly seventeen significant digits. It is **not** a
 * correctness fix, in case the rounding suggests one: CSS numbers accept exponent
 * notation, checked in a browser rather than assumed (`rotate(2.4e-17rad)` parses and
 * reads back intact), so the unrounded values were never invalid.
 *
 * Shared rather than private to each view because `percent` was already written out
 * identically in two of them and this cycle needed a third copy. They are also the only
 * part of the overlay layer the node test environment can reach, the views themselves
 * having no DOM to build against, so moving them here is what gave them tests.
 */

export function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(3)}%`
}

export function radians(angle: number): string {
  return `${angle.toFixed(5)}rad`
}

export function alpha(value: number): string {
  return value.toFixed(3)
}
