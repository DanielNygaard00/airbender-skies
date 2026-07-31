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
  }

  // No glider clip exists in stock packs. Holding a single airborne frame reads
  // as a deliberate pose, where looping a jump reads as the wrong clip stuck on.
  const fall = plan.get('fall')
  if (!plan.has('glide') && fall) {
    plan.set('glide', { source: fall.source, freeze: true })
  }

  return plan
}
