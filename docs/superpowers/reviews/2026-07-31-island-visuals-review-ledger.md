# SDD ledger — plan: docs/superpowers/plans/2026-07-31-island-visuals.md
Task 1: minor (deferred): level.test.ts ~161 comment says island reaches -48.6, stale (now -53.96)
Task 1: complete (commits c46a307..a74793b, review clean; level.test worldFloorY fixture -50→-55 adjudicated correct)
Task 2: minor (deferred): island-paint.ts has unused Color import + instance left from setHex refactor
Task 2: complete (commits a74793b..aca7a18, review clean; setHex bypassed deliberately to avoid sRGB color management)
Task 3: minor (deferred): no test pins temple ring/arch exact geometry or non-origin def.position translation; boulder count on temple unasserted
Task 3: complete (commits aca7a18..5401946, review clean)
Task 4: minor (deferred): tree variant uses combined placement index (implicit trees-first ordering); reused Matrix4/Quaternion locals mildly hurt readability
Task 4: complete (commits 5401946..0ff6660, review clean)
Final review: 1 Important (no prop clearance at island centers/respawn points) + 2 minors — fix wave 6d293e8, scoped re-review clean
Final review: parked — trees/pillars render smooth-shaded (colored() copies factory normals, no computeVertexNormals) — ruling: art call, playtest arbitrates
Final review: parked — tree bases can float ~0.4m on max-slope ground — ruling: art call, playtest arbitrates (sink trunk if visible)
Final review: parked — prop disc (0.75r) overlaps waterfall rim insets (0.72-0.88r) — ruling: deterministic per level, playtest arbitrates
Task 5: mechanical gates pass (433 tests, typecheck, build); visual playtest pending with user
