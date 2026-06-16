function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t*t, t3 = t2*t;
  return 0.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t2+(-p0+3*p1-3*p2+p3)*t3);
}

function buildSpline(ctrl, samplesPerSeg) {
  const pts = [], n = ctrl.length;
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i-1+n)%n], p1 = ctrl[i], p2 = ctrl[(i+1)%n], p3 = ctrl[(i+2)%n];
    for (let j = 0; j < samplesPerSeg; j++) {
      const t = j / samplesPerSeg;
      pts.push({ x: catmullRom(p0.x,p1.x,p2.x,p3.x,t), y: catmullRom(p0.y,p1.y,p2.y,p3.y,t) });
    }
  }
  return pts;
}

const TRACK_DEFS = [
  {
    name: 'Bahrain Grand Prix',
    flag: '🇧🇭', lap: 'Sakhir Circuit',
    width: 68,
    ctrl: [
      {x:200,y:480},{x:460,y:480},{x:700,y:475},
      {x:820,y:400},{x:840,y:280},{x:790,y:170},
      {x:720,y:110},{x:570,y:90},{x:390,y:90},
      {x:220,y:112},{x:140,y:212},{x:130,y:370},
      {x:165,y:455}
    ]
  },
  {
    name: 'Monaco Grand Prix',
    flag: '🇲🇨', lap: 'Circuit de Monaco',
    width: 56,
    ctrl: [
      {x:290,y:510},{x:520,y:510},{x:665,y:460},
      {x:705,y:365},{x:665,y:272},{x:598,y:212},
      {x:628,y:148},{x:568,y:90},{x:440,y:80},
      {x:308,y:94},{x:208,y:152},{x:160,y:262},
      {x:178,y:390},{x:210,y:468}
    ]
  },
  {
    name: 'British Grand Prix',
    flag: '🇬🇧', lap: 'Silverstone Circuit',
    width: 72,
    ctrl: [
      {x:200,y:490},{x:540,y:490},{x:750,y:458},
      {x:838,y:365},{x:818,y:242},{x:722,y:152},
      {x:558,y:100},{x:382,y:100},{x:222,y:138},
      {x:142,y:258},{x:132,y:398},{x:168,y:468}
    ]
  }
];

// Build all tracks (smooth waypoints)
const TRACKS = TRACK_DEFS.map(def => {
  const waypoints = buildSpline(def.ctrl, 18);
  const n = waypoints.length;
  // Checkpoint indices evenly spaced (skip 0 = start)
  const CP_COUNT = 8;
  const checkpoints = [];
  for (let i = 1; i <= CP_COUNT; i++) {
    checkpoints.push(Math.floor(i * n / (CP_COUNT + 1)));
  }
  return { ...def, waypoints, numWP: n, checkpoints };
});
