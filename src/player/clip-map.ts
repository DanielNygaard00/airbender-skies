import type { AnimationName } from './avatar-anim'

/** Which of the model's clips plays for a state, and whether it holds one frame. */
export type ClipPlan = { source: string; freeze: boolean }

/**
 * Exporters prefix each clip with the armature that owns it, so a Quaternius
 * model arrives with "Human Armature|Idle". Only the final segment names the
 * action, so matching has to look there.
 */
function keyOf(clipName: string): string {
  const segments = clipName.split('|')
  return segments[segments.length - 1]!.trim().toLowerCase()
}

/**
 * Names a model might use for each state, best first. Stock packs rarely use the
 * words this game does, and almost never ship a glider pose.
 */
const ALIASES: Record<AnimationName, readonly string[]> = {
  idle: ['idle'],
  walk: ['walk', 'walking'],
  run: ['run', 'running', 'jog', 'sprint'],
  fall: ['fall', 'falling', 'jump'],
  glide: ['glide', 'gliding', 'fly', 'flying'],
}

/**
 * Clips that do not depict the state but can be held as a pose for it. Consulted
 * only when nothing in `ALIASES` matched, and always frozen.
 *
 * The shipped pack contains no airborne clip whatsoever — no fall, no jump, not
 * even a landing — so `fall` had nothing at all to resolve to, and an unresolved
 * state does not degrade gracefully: `setAnimation` returns early on a missing
 * clip and leaves whichever action was already running, so stepping off a ledge
 * left the character running on air the whole way down.
 *
 * `Roll` is the borrow because it is the only ground move that leaves the ground:
 * frozen at its tuck the knees come to 52 and 45 degrees with the hands drawn in,
 * which reads as bracing in mid-air. Frozen and never looped, for the reason the
 * glide is: a roll played as a loop reads as tumbling over and over, which is a
 * different and much worse lie than holding one plausible frame.
 */
const BORROWED: Partial<Record<AnimationName, readonly string[]>> = {
  fall: ['roll'],
}

export function planClips(clipNames: string[]): Map<AnimationName, ClipPlan> {
  const byKey = new Map<string, string>()
  for (const name of clipNames) {
    // First occurrence wins, so a duplicated key resolves the same way every run.
    const key = keyOf(name)
    if (!byKey.has(key)) byKey.set(key, name)
  }

  const plan = new Map<AnimationName, ClipPlan>()
  for (const state of Object.keys(ALIASES) as AnimationName[]) {
    for (const alias of ALIASES[state]) {
      const source = byKey.get(alias)
      if (source) {
        plan.set(state, { source, freeze: false })
        break
      }
    }
    // Only once the real names are exhausted, so a pack that does ship a fall clip
    // never ends up holding a frozen roll instead of playing it.
    if (plan.has(state)) continue
    for (const alias of BORROWED[state] ?? []) {
      const source = byKey.get(alias)
      if (source) {
        plan.set(state, { source, freeze: true })
        break
      }
    }
  }

  // No glider clip exists in stock packs. Holding a single airborne frame reads
  // as a deliberate pose, where looping a jump reads as the wrong clip stuck on.
  const fall = plan.get('fall')
  if (!plan.has('glide') && fall) {
    plan.set('glide', { source: fall.source, freeze: true })
  }

  return plan
}
