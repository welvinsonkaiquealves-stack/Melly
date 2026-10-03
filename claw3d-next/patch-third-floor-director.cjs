'use strict';
const fs = require('node:fs');
const path = require('node:path');
if (process.env.SOFIA_THIRD_FLOOR_TELEMETRY !== '1') { console.log('SOFIA_THIRD_FLOOR_DIRECTOR: disabled'); process.exit(0); }
const marker = 'SOFIA_THIRD_FLOOR_DIRECTOR';
const screenFile = 'src/features/office/screens/OfficeScreen.tsx';
const sceneFile = 'src/features/retro-office/RetroOffice3D.tsx';
const modelFile = 'src/features/retro-office/objects/agents.tsx';
let screen = fs.readFileSync(screenFile, 'utf8');
let scene = fs.readFileSync(sceneFile, 'utf8');
let model = fs.readFileSync(modelFile, 'utf8');
function change(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw Error('Non-unique or missing third-floor anchor: ' + anchor.slice(0, 60));
  return source.replace(anchor, replacement);
}
if (!screen.includes('// ' + marker)) {
  screen = change(screen, '      taskBoardEventHandlerRef.current(event);',
    '      // ' + marker + ': local telemetry never enters global floor routing.\n' +
    '      if (thirdFloorDirector.ingest(event)) return;\n      taskBoardEventHandlerRef.current(event);');
  screen = change(screen, '"use client";', '"use client";\nimport { thirdFloorDirector } from "@/features/sofia-ops/ThirdFloorDirector";');
}
if (!scene.includes('// ' + marker)) {
  scene = change(scene, '  const sofiaTargets = useMemo(', '  const legacySofiaTargets = useMemo(');
  scene = change(scene, '  const sofiaAgentNames = useMemo(',
    '  // ' + marker + ': fixed existing QA station; other avatar targets unchanged.\n' +
    '  const thirdFloorStates = useThirdFloorDirector();\n' +
    '  const sofiaTargets = useMemo(() => {\n' +
    '    if (!sofiaCampusMode) return legacySofiaTargets;\n' +
    '    const targets = { ...legacySofiaTargets.targets };\n' +
    '    for (const agent of agents) {\n' +
    '      if (!thirdFloorStates[agent.id] || agent.status === "error" || agent.id.startsWith("remote:")) continue;\n' +
    '      targets[agent.id] = { x: 1390, y: 1710, facing: 0, pose: "stand" };\n' +
    '    }\n' +
    '    return { targets, deskHolds: legacySofiaTargets.deskHolds };\n' +
    '  }, [sofiaCampusMode, legacySofiaTargets, agents, thirdFloorStates]);\n' +
    '  const sofiaAgentNames = useMemo(');
  scene = change(scene, '"use client";', '"use client";\nimport { useThirdFloorDirector } from "@/features/sofia-ops/ThirdFloorDirector";');
}
if (!model.includes('{/* ' + marker)) {
  model = change(model, 'import { Billboard } from "@react-three/drei";',
    'import { Billboard } from "@react-three/drei";\nimport { ThirdFloorStatusIcon } from "@/features/sofia-ops/ThirdFloorStatusIcon";');
  model = change(model, '      <group ref={rightLegRef}',
    '      {/* ' + marker + ': follows the existing avatar. */}\n' +
    '      <ThirdFloorStatusIcon agentId={agentId} agentLookupRef={agentLookupRef} />\n' +
    '      <group ref={rightLegRef}');
}
for (const name of ['ThirdFloorDirector.ts', 'ThirdFloorStatusIcon.tsx']) {
  fs.copyFileSync(path.join(__dirname, name), path.join('src/features/sofia-ops', name));
}
fs.writeFileSync(screenFile, screen);
fs.writeFileSync(sceneFile, scene);
fs.writeFileSync(modelFile, model);
console.log('SOFIA_THIRD_FLOOR_DIRECTOR: deterministic avatar icon source applied');
