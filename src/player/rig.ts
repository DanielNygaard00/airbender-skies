/**
 * The bones the code and the tests measure the character by, named by role rather than by the
 * string the exporter happened to write.
 *
 * This exists because the names moved. The previous model was a Mixamo-style rig and its
 * landmarks were spelled `LeftUpLeg`, `LeftLeg`, `LeftFoot`, `LeftHand`, `LeftShoulder`; the
 * character pack in `public/models/character.glb` spells the same joints `UpperLeg.L`,
 * `LowerLeg.L`, `Foot.L`, `Fist.L`, `Shoulder.L`. Both spellings were hard-coded across two
 * test files, so swapping the model failed seven tests in two places with the same edit needed
 * in each — the drift this table is here to prevent when the next model arrives.
 *
 * **The dots are not a typo, and neither is their absence.** three.js sanitises node names when
 * it builds the scene graph, because `.` is its property-path separator in animation bindings:
 * `UpperLeg.L` in the glTF becomes `UpperLegL` on the `Object3D`. So these are the names
 * `getObjectByName` answers to, not the names in the file, and looking up the file's spelling
 * returns undefined. Anything reading the glTF JSON directly wants the dotted form instead.
 *
 * There is no toe entry. The Mixamo rig had `LeftToeBase` and `LeftToe_End` and a test measured
 * the feet by them; this rig stops at the ankle — 32 joints, no toes — so that measurement is
 * taken at `FootL`/`FootR` now.
 */
export const BONES = {
  hips: 'Hips',
  head: 'Head',
  shoulderL: 'ShoulderL',
  handL: 'FistL',
  upperLegL: 'UpperLegL',
  lowerLegL: 'LowerLegL',
  footL: 'FootL',
  upperLegR: 'UpperLegR',
  lowerLegR: 'LowerLegR',
  footR: 'FootR',
} as const
