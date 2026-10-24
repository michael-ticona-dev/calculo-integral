/* ════════════════════════════════════════════════════════════════
   DEATH STAR — El volumen del Imperio
   Escena Three.js (r147, build clásico), cálculos de volumen y
   diagramas SVG. Unidades: km del modelo (ficticios).

   Convención: el grupo `station` se escala por R, de modo que toda
   la geometría de la estación se construye en coordenadas unitarias
   (R = 1). El eje x es el eje de integración del método de discos.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const fatalBox = document.getElementById('fatal');
  const fatal = (msg) => { fatalBox.hidden = false; fatalBox.textContent = msg; };
  window.addEventListener('error', (e) => fatal('Error: ' + e.message + (e.filename ? '\n' + e.filename.split('/').pop() + ':' + e.lineno : '')));
  if (!window.THREE || !THREE.OrbitControls) {
    fatal('No se pudo cargar Three.js (vendor/three.min.js ni la CDN). Los cálculos siguen disponibles, pero la escena 3D no.');
  }

  /* ───────────────────────── utilidades ───────────────────────── */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const PI = Math.PI;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const nf = (v, d = 1) => v.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
  const nfa = (v) => (Math.abs(v) >= 1000 ? nf(v, 0) : Math.abs(v) >= 10 ? nf(v, 1) : nf(v, 2));
  const pct = (v) => (v < 1e-4 ? v.toExponential(2).replace('.', ',') + ' %' : nf(v, v < 0.1 ? 4 : 3) + ' %');

  /* ───────────────────────── estado ───────────────────────── */
  const P = {
    R: 90, t: 13.5, cut: 0.2,   // 2.ª Estrella de la Muerte: R de referencia 90 km (D = 180 km; rango aprox. 80–100 km)
    a: 19.5, h: 33, b: 3.75,
    x: 0.35, N: 24, build: 1,
    module: 'reactor', isolate: false,
    mode: 'A', rotate: true,
  };
  const rIn = () => P.R - P.t;

  /* ───────────────────────── modelo matemático ───────────────────────── */
  const Vsphere = (R) => (4 / 3) * PI * R * R * R;
  function riemann(R, N) { // regla del punto medio
    const dx = (2 * R) / N; let s = 0;
    for (let i = 0; i < N; i++) { const x = -R + (i + 0.5) * dx; s += PI * (R * R - x * x) * dx; }
    return s;
  }
  // Perfil del reactor: ρ(y) = a(1 − |y|/h), hueco axial de radio b
  const rho = (y, a = P.a, h = P.h) => (Math.abs(y) <= h ? a * (1 - Math.abs(y) / h) : 0);
  const reactorY1 = (a = P.a, h = P.h, b = P.b) => h * (1 - b / a);
  const Vreactor = (a = P.a, h = P.h, b = P.b) => 2 * PI * h * (a * a / 3 - b * b + (2 * b * b * b) / (3 * a));
  function VreactorSimpson(n = 600) {
    const f = (y) => PI * Math.max(rho(y) ** 2 - P.b * P.b, 0);
    const lo = -P.h, hi = P.h, dh = (hi - lo) / n; let s = f(lo) + f(hi);
    for (let i = 1; i < n; i++) s += f(lo + i * dh) * (i % 2 ? 4 : 2);
    return (s * dh) / 3;
  }

  // Relieve del casco (coordenadas unitarias). La esfera ideal es rad = 1.
  const DEG = PI / 180;
  const DISH_LAT = 30 * DEG;
  const DISH = { x: Math.cos(DISH_LAT), y: Math.sin(DISH_LAT), z: 0 };
  const DISH_ANG = 0.27;      // semiapertura angular del superláser (rad)
  const DISH_DEPTH = 0.062;   // profundidad del cuenco (fracción de R)
  const TRENCH_W = 0.018;     // semiancho angular de la trinchera
  const TRENCH_D = 0.011;     // profundidad de la trinchera
  const dishDepth = (q) => DISH_DEPTH * (1 - q * q);
  function hullR(nx, ny, nz) {
    let rad = 1;
    const lat = Math.abs(Math.asin(clamp(ny, -1, 1)));
    rad -= TRENCH_D * (1 - smoothstep(TRENCH_W - 0.0012, TRENCH_W + 0.0012, lat));
    const c = nx * DISH.x + ny * DISH.y + nz * DISH.z;
    if (c > Math.cos(DISH_ANG * 1.2)) {
      const q = Math.acos(clamp(c, -1, 1)) / DISH_ANG;
      if (q < 1) rad = 1 - dishDepth(q);
      rad += 0.0045 * Math.exp(-(((q - 1.03) / 0.035) ** 2));
    }
    return rad;
  }

  // Disposición de los módulos interiores (unidades de R; rn = r/R)
  function layout() {
    const R = P.R, rn = rIn() / R, an = P.a / R, hn = P.h / R, bn = P.b / R;
    const D = new THREE.Vector3(DISH.x, DISH.y, DISH.z);
    const torusR0 = an * 1.55 + 0.05 * rn, torusTube = 0.04 * rn;
    const coreC = D.clone().multiplyScalar(0.6 * rn), coreRad = 0.1 * rn;
    const towerC = new THREE.Vector3(-0.45 * rn, -0.5 * rn, 0);
    const levels = [ // [radio, altura] en unidades de rn
      [0.085, 0.06], [0.12, 0.008], [0.07, 0.05], [0.12, 0.008], [0.085, 0.06], [0.12, 0.008], [0.07, 0.05], [0.12, 0.008], [0.06, 0.05],
    ].map(([r, hh]) => [r * rn, hh * rn]);
    return { R, rn, an, hn, bn, D, torusR0, torusTube, coreC, coreRad, towerC, levels };
  }
  function moduleVolumes() {
    const L = layout(), R = P.R;
    return {
      reactor: Vreactor(),
      core: (4 / 3) * PI * (L.coreRad * R) ** 3,
      torus: 2 * PI * PI * (L.torusR0 * R) * (L.torusTube * R) ** 2,
      tower: L.levels.reduce((s, [r, hh]) => s + PI * (r * R) ** 2 * (hh * R), 0),
    };
  }

  /* ───────────────────────── restricciones de parámetros ───────────────────────── */
  const inp = {
    R: $('#in-R'), t: $('#in-t'), cut: $('#in-cut'), a: $('#in-a'), h: $('#in-h'), b: $('#in-b'),
    x: $('#in-x'), N: $('#in-N'), build: $('#in-build'),
  };
  function constrain() {
    // t mínimo: el cuenco del superláser (profundidad 0,062R) debe quedar dentro del casco
    const tMin = Math.ceil(0.07 * P.R * 2) / 2, tMax = Math.floor(0.6 * P.R * 2) / 2;
    inp.t.min = tMin; inp.t.max = tMax; P.t = clamp(P.t, tMin, tMax);
    const r = rIn();
    const aMax = Math.max(1, Math.floor(0.38 * r * 2) / 2), hMax = Math.max(1, Math.floor(0.75 * r * 2) / 2);
    inp.a.min = 1; inp.a.max = aMax; P.a = clamp(P.a, 1, aMax);
    inp.h.min = 1; inp.h.max = hMax; P.h = clamp(P.h, 1, hMax);
    const bMax = Math.floor(0.8 * P.a * 4) / 4;
    inp.b.max = bMax; P.b = clamp(P.b, 0, bMax);
    for (const k of ['R', 't', 'a', 'h', 'b']) inp[k].value = P[k];
  }

  /* ───────────────────────── valores en el póster ───────────────────────── */
  function setAll(cls, text) { $$('.' + cls).forEach((el) => { el.textContent = text; }); }
  let cache = {};
  function updateNumbers() {
    const R = P.R, r = rIn(), t = P.t;
    const Vext = Vsphere(R), Vcav = Vsphere(r), Vmat = Vext - Vcav;
    const VN = riemann(R, P.N), err = Math.abs(VN - Vext), errRel = (err / Vext) * 100;
    const Vre = Vreactor(), VreNum = VreactorSimpson();
    cache = { Vext, Vcav, Vmat, VN, err, errRel, Vre };
    setAll('v-R', nf(R, 1)); setAll('v-D', nf(2 * R, 0)); setAll('v-r', nf(r, 1)); setAll('v-t', nf(t, 1));
    setAll('v-Vext', nf(Vext, 1)); setAll('v-Vcav', nf(Vcav, 1)); setAll('v-Vmat', nf(Vmat, 1));
    setAll('v-frac', nf((Vmat / Vext) * 100, 2) + ' % del volumen exterior');
    setAll('v-Vthin', nf(4 * PI * R * R * t, 0) + ' km³');
    setAll('v-Vre', nf(Vre, 1)); setAll('v-Vre-num', nf(VreNum, 1) + ' km³');
    setAll('v-a', nf(P.a, 1)); setAll('v-h', nf(P.h, 1)); setAll('v-b', nf(P.b, 2));
    setAll('v-N', String(P.N)); setAll('v-VN', nf(VN, 1));
    setAll('v-errabs', nf(err, 1)); setAll('v-errpct', pct(errRel));
    setAll('v-errth', pct(100 / (2 * P.N * P.N)));
    $('#o-R').textContent = nf(R, 0) + ' km';
    $('#o-t').textContent = nf(t, 1) + ' km  (r = ' + nf(r, 1) + ')';
    $('#o-cut').textContent = nf(P.cut * R, 1) + ' km';
    $('#o-a').textContent = nf(P.a, 1) + ' km';
    $('#o-h').textContent = nf(P.h, 1) + ' km';
    $('#o-b').textContent = nf(P.b, 2) + ' km';
    $('#o-x').textContent = nf(P.x * R, 1) + ' km';
    $('#o-N').textContent = String(P.N);
    $('#o-build').textContent = Math.round(P.build * P.N) + ' / ' + P.N;
    updateHeroFormula();
  }

  /* ───────────────────────── fórmulas del hero por modo ───────────────────────── */
  const MODE_INFO = {
    A: ['MODO A', 'EXTERIOR', 'Casco completo: paneles, trinchera ecuatorial y superláser. La esfera ideal de radio R es la aproximación matemática del casco.'],
    B: ['MODO B', 'CORTE TRANSVERSAL', 'Plano móvil x = d. La sección muestra el casco de espesor t (rayado), la cavidad de radio r y los módulos interiores.'],
    C: ['MODO C', 'INTERIOR', 'Cámara central conceptual (interpretación original, no planos oficiales). Seleccione una figura y arrastre para orbitarla.'],
    D: ['MODO D', 'MÉTODO DE DISCOS', 'Cada disco en x tiene radio r(x) = √(R² − x²) y área A(x) = π(R² − x²). Sumar A(x)·Δx aproxima el volumen.'],
  };
  const MATH = {
    sphere: '<math><mi>V</mi><mo>=</mo><mfrac><mn>4</mn><mn>3</mn></mfrac><mi>π</mi><msup><mi>R</mi><mn>3</mn></msup></math>',
    shell: '<math><msub><mi>V</mi><mtext>mat</mtext></msub><mo>=</mo><mfrac><mn>4</mn><mn>3</mn></mfrac><mi>π</mi><mo>(</mo><msup><mi>R</mi><mn>3</mn></msup><mo>−</mo><msup><mi>r</mi><mn>3</mn></msup><mo>)</mo></math>',
    reactor: '<math><msub><mi>V</mi><mtext>r</mtext></msub><mo>=</mo><mn>2</mn><mi>π</mi><mi>h</mi><mrow><mo>(</mo><mfrac><msup><mi>a</mi><mn>2</mn></msup><mn>3</mn></mfrac><mo>−</mo><msup><mi>b</mi><mn>2</mn></msup><mo>+</mo><mfrac><mrow><mn>2</mn><msup><mi>b</mi><mn>3</mn></msup></mrow><mrow><mn>3</mn><mi>a</mi></mrow></mfrac><mo>)</mo></mrow></math>',
    core: '<math><msub><mi>V</mi><mtext>e</mtext></msub><mo>=</mo><mfrac><mn>4</mn><mn>3</mn></mfrac><mi>π</mi><msubsup><mi>ρ</mi><mtext>e</mtext><mn>3</mn></msubsup></math>',
    torus: '<math><msub><mi>V</mi><mtext>t</mtext></msub><mo>=</mo><mo>(</mo><mn>2</mn><mi>π</mi><msub><mi>R</mi><mn>0</mn></msub><mo>)</mo><mo>·</mo><mo>(</mo><mi>π</mi><msup><mi>ρ</mi><mn>2</mn></msup><mo>)</mo><mo>=</mo><mn>2</mn><msup><mi>π</mi><mn>2</mn></msup><msub><mi>R</mi><mn>0</mn></msub><msup><mi>ρ</mi><mn>2</mn></msup></math>',
    tower: '<math><msub><mi>V</mi><mtext>T</mtext></msub><mo>=</mo><munder><mo>∑</mo><mi>k</mi></munder><mi>π</mi><msubsup><mi>r</mi><mi>k</mi><mn>2</mn></msubsup><msub><mi>h</mi><mi>k</mi></msub></math>',
    riemann: '<math><msub><mi>V</mi><mi>N</mi></msub><mo>=</mo><munderover><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>N</mi></munderover><mi>π</mi><mo>(</mo><msup><mi>R</mi><mn>2</mn></msup><mo>−</mo><msup><mrow><mo>(</mo><msubsup><mi>x</mi><mi>i</mi><mo>*</mo></msubsup><mo>)</mo></mrow><mn>2</mn></msup><mo>)</mo><mi>Δ</mi><mi>x</mi><mspace width="0.4em"></mspace><mo>→</mo><mspace width="0.4em"></mspace><msubsup><mo>∫</mo><mrow><mo>−</mo><mi>R</mi></mrow><mi>R</mi></msubsup><mi>A</mi><mo>(</mo><mi>x</mi><mo>)</mo><mi>d</mi><mi>x</mi></math>',
  };
  const MODULE_NAMES = { reactor: 'Reactor doble cono', core: 'Esfera de energía', torus: 'Anillo toroidal', tower: 'Torre cilíndrica' };
  function updateHeroFormula() {
    const el = $('#hero-formula'); if (!el || !cache.Vext) return;
    const m = P.mode; let k, f, v;
    if (m === 'A') { k = 'VOLUMEN DE LA ESFERA MACIZA (NO DEL MATERIAL)'; f = MATH.sphere; v = '= ' + nf(cache.Vext, 1) + ' km³   (R = ' + nf(P.R, 1) + ' km)'; }
    else if (m === 'B') { k = 'VOLUMEN DEL MATERIAL · CASCO'; f = MATH.shell; v = '= ' + nf(cache.Vmat, 1) + ' km³   (t = ' + nf(P.t, 1) + ' km)'; }
    else if (m === 'C') {
      const vols = moduleVolumes(), L = layout();
      k = 'FIGURA INTERIOR · ' + MODULE_NAMES[P.module].toUpperCase(); f = MATH[P.module];
      const det = {
        reactor: 'a = ' + nf(P.a, 1) + ', h = ' + nf(P.h, 1) + ', b = ' + nf(P.b, 2) + ' km',
        core: 'ρₑ = ' + nf(L.coreRad * P.R, 2) + ' km',
        torus: 'R₀ = ' + nf(L.torusR0 * P.R, 2) + ', ρ = ' + nf(L.torusTube * P.R, 2) + ' km (Pappus)',
        tower: L.levels.length + ' cilindros apilados',
      }[P.module];
      v = '= ' + nf(vols[P.module], 1) + ' km³   (' + det + ')';
    } else {
      k = 'SUMA DE RIEMANN · PUNTO MEDIO'; f = MATH.riemann;
      v = 'N = ' + P.N + ':  ' + nf(cache.VN, 1) + ' km³  vs  V = ' + nf(cache.Vext, 1) + ' km³  ·  error ' + pct(cache.errRel);
    }
    el.innerHTML = '<div class="k">' + k + '</div>' + f + '<div class="val">' + v + '</div>';
  }

  /* ═════════════════════════ DIAGRAMAS SVG ═════════════════════════ */
  const C = { cyan: '#7fd3ff', amber: '#ffb23f', green: '#7dff9c', ink: '#dce4ee', muted: '#74849a', line: 'rgba(128,168,210,.35)' };
  const f1 = (v) => v.toFixed(1);

  function svgDiscs() {
    const svg = $('#svg-discs'); if (!svg) return;
    const cx = 150, cy = 106, s = 94, N = P.N, dx = 2 / N, shown = Math.round(P.build * N);
    let out = '';
    for (let g = -1; g <= 1.0001; g += 0.25) out += `<line x1="${f1(cx + g * s)}" y1="6" x2="${f1(cx + g * s)}" y2="206" stroke="${C.line}" stroke-width=".5" stroke-dasharray="2 3"/>`;
    for (let i = 0; i < N; i++) {
      const xm = -1 + (i + 0.5) * dx, rr = Math.sqrt(1 - xm * xm), on = i < shown;
      out += `<rect x="${f1(cx + (-1 + i * dx) * s)}" y="${f1(cy - rr * s)}" width="${f1(dx * s)}" height="${f1(2 * rr * s)}" fill="${C.amber}" fill-opacity="${on ? 0.26 : 0.04}" stroke="${C.amber}" stroke-opacity="${N > 70 ? 0 : on ? 0.75 : 0.25}" stroke-width=".5"/>`;
    }
    out += `<circle cx="${cx}" cy="${cy}" r="${s}" fill="none" stroke="${C.cyan}" stroke-width="1.2"/>`;
    out += `<line x1="8" y1="${cy}" x2="288" y2="${cy}" stroke="${C.ink}" stroke-width=".7"/><path d="M290 ${cy} l-7 -3 v6z" fill="${C.ink}"/>`;
    out += `<text x="284" y="${cy - 6}" fill="${C.ink}" font-size="10" class="t-math">x</text>`;
    [[-1, '−R'], [0, '0'], [1, 'R']].forEach(([g, t]) => { out += `<line x1="${cx + g * s}" y1="${cy - 3}" x2="${cx + g * s}" y2="${cy + 3}" stroke="${C.ink}"/><text x="${cx + g * s + (g === -1 ? -16 : 3)}" y="${cy + 12}" fill="${C.ink}" font-size="9">${t}</text>`; });
    const X = P.x, rX = Math.sqrt(Math.max(0, 1 - X * X)), px = cx + X * s;
    out += `<ellipse cx="${f1(px)}" cy="${cy}" rx="${f1(Math.max(1.5, 0.2 * rX * s))}" ry="${f1(rX * s)}" fill="${C.amber}" fill-opacity=".35" stroke="${C.amber}" stroke-width="1.4"/>`;
    out += `<line x1="${f1(px)}" y1="${cy}" x2="${f1(px)}" y2="${f1(cy - rX * s)}" stroke="#fff" stroke-width="1.3"/><circle cx="${f1(px)}" cy="${f1(cy - rX * s)}" r="2.2" fill="#fff"/>`;
    out += `<text x="${f1(px + (X > 0.6 ? -26 : 5))}" y="${f1(cy - rX * s * 0.55)}" fill="#fff" font-size="10" class="t-math">r(x)</text>`;
    out += `<text x="4" y="14" fill="${C.cyan}" font-size="9.5" class="t-math">y = √(R² − x²)</text>`;
    const xs = X * P.R, A = PI * (P.R * P.R - xs * xs);
    out += `<text x="4" y="222" fill="${C.amber}" font-size="9">x = ${nf(xs, 1)} km · r(x) = ${nf(Math.sqrt(Math.max(0, P.R * P.R - xs * xs)), 2)} km</text>`;
    out += `<text x="4" y="234" fill="${C.amber}" font-size="9">A(x) = ${nfa(A)} km² · Δx = ${nf(2 * P.R / N, 2)} km</text>`;
    svg.innerHTML = out;
  }

  function hatchDefs(id, color) {
    return `<defs><pattern id="${id}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#2a1b06"/><rect width="2.2" height="6" fill="${color}" fill-opacity=".85"/></pattern></defs>`;
  }

  function svgShell() {
    const svg = $('#svg-shell'); if (!svg || !window.THREE) return;
    const cx = 150, cy = 150, s = 118, L = layout(), rn = L.rn;
    const X = (u) => f1(cx + u * s), Y = (v) => f1(cy - v * s);
    let out = hatchDefs('hatchS', C.amber);
    // contorno real del casco en el plano z = 0 (contiene el superláser y la trinchera)
    let d = '';
    const M = 1440;
    for (let i = 0; i <= M; i++) {
      const th = (i / M) * 2 * PI, nx = Math.cos(th), ny = Math.sin(th), rr = hullR(nx, ny, 0);
      d += (i ? 'L' : 'M') + X(nx * rr) + ' ' + Y(ny * rr);
    }
    d += 'Z';
    const inner = `M${X(rn)} ${Y(0)} A${f1(rn * s)} ${f1(rn * s)} 0 1 0 ${X(-rn)} ${Y(0)} A${f1(rn * s)} ${f1(rn * s)} 0 1 0 ${X(rn)} ${Y(0)}Z`;
    out += `<path d="${d} ${inner}" fill="url(#hatchS)" fill-rule="evenodd" stroke="${C.ink}" stroke-width=".9"/>`;
    out += `<circle cx="${cx}" cy="${cy}" r="${f1(rn * s)}" fill="#0b1c27" stroke="${C.cyan}" stroke-width="1"/>`;
    out += `<circle cx="${cx}" cy="${cy}" r="${s}" fill="none" stroke="${C.cyan}" stroke-width=".6" stroke-dasharray="3 3" opacity=".7"/>`;
    // módulos interiores seccionados por z = 0
    const an = L.an, hn = L.hn, bn = L.bn, y1 = hn * (1 - bn / an);
    out += `<path d="M${X(bn)} ${Y(-y1)} L${X(an)} ${Y(0)} L${X(bn)} ${Y(y1)}Z M${X(-bn)} ${Y(-y1)} L${X(-an)} ${Y(0)} L${X(-bn)} ${Y(y1)}Z" fill="${C.green}" fill-opacity=".35" stroke="${C.green}" stroke-width=".9"/>`;
    [-1, 1].forEach((sg) => { out += `<circle cx="${X(sg * L.torusR0)}" cy="${Y(0)}" r="${f1(L.torusTube * s)}" fill="${C.green}" fill-opacity=".25" stroke="${C.green}" stroke-width=".8"/>`; });
    out += `<circle cx="${X(L.coreC.x)}" cy="${Y(L.coreC.y)}" r="${f1(L.coreRad * s)}" fill="${C.green}" fill-opacity=".55"/>`;
    let ty = L.towerC.y - L.levels.reduce((q, l) => q + l[1], 0) / 2;
    L.levels.forEach(([lr, lh]) => { out += `<rect x="${X(L.towerC.x - lr)}" y="${Y(ty + lh)}" width="${f1(2 * lr * s)}" height="${f1(lh * s)}" fill="${C.green}" fill-opacity=".25" stroke="${C.green}" stroke-width=".5"/>`; ty += lh; });
    out += `<line x1="${cx}" y1="${Y(-1.12)}" x2="${cx}" y2="${Y(1.12)}" stroke="${C.muted}" stroke-dasharray="6 2 1 2" stroke-width=".6"/>`;
    // cotas
    const aR = -38 * DEG, aRi = 200 * DEG;
    out += `<line x1="${cx}" y1="${cy}" x2="${X(Math.cos(aR))}" y2="${Y(Math.sin(aR))}" stroke="#fff" stroke-width="1"/><circle cx="${X(Math.cos(aR))}" cy="${Y(Math.sin(aR))}" r="2" fill="#fff"/>`;
    out += `<text x="${X(0.55 * Math.cos(aR) + 0.03)}" y="${Y(0.55 * Math.sin(aR) - 0.07)}" fill="#fff" font-size="12" class="t-math">R</text>`;
    out += `<line x1="${cx}" y1="${cy}" x2="${X(rn * Math.cos(aRi))}" y2="${Y(rn * Math.sin(aRi))}" stroke="${C.cyan}" stroke-width="1"/>`;
    out += `<text x="${X(0.5 * rn * Math.cos(aRi) - 0.02)}" y="${Y(0.5 * rn * Math.sin(aRi) + 0.05)}" fill="${C.cyan}" font-size="12" class="t-math">r</text>`;
    const at = 112 * DEG, ux = Math.cos(at), uy = Math.sin(at);
    out += `<line x1="${X(rn * ux)}" y1="${Y(rn * uy)}" x2="${X(ux)}" y2="${Y(uy)}" stroke="${C.amber}" stroke-width="1.6"/>`;
    out += `<text x="${X(1.04 * ux - 0.1)}" y="${Y(1.04 * uy + 0.04)}" fill="${C.amber}" font-size="11">t = ${nf(P.t, 1)} km</text>`;
    out += `<text x="${X(DISH.x * 0.62)}" y="${Y(DISH.y * 1.22 + 0.06)}" fill="${C.green}" font-size="9">superláser ↘</text>`;
    // plano de corte del modo B
    const dc = P.cut;
    out += `<line x1="${X(dc)}" y1="${Y(1.2)}" x2="${X(dc)}" y2="${Y(-1.2)}" stroke="${C.amber}" stroke-dasharray="4 3" stroke-width=".9"/>`;
    out += `<text x="${X(dc) * 1 + 4}" y="${Y(-1.18)}" fill="${C.amber}" font-size="9">x = d</text>`;
    out += `<text x="4" y="296" fill="${C.muted}" font-size="8.5">Sección z = 0 · contorno real del casco</text>`;
    svg.innerHTML = out;
  }

  function svgReactor() {
    const svg = $('#svg-reactor'); if (!svg) return;
    const cx = 120, cy = 124, a = P.a, h = P.h, b = P.b, y1 = reactorY1();
    const k = Math.min(92 / a, 100 / h);
    const X = (u) => f1(cx + u * k), Y = (v) => f1(cy - v * k);
    let out = hatchDefs('hatchR', C.amber);
    // región generadora (x ≥ 0): entre x = b y x = ρ(y), |y| ≤ y1 — misma función que el sólido 3D
    let d = `M${X(b)} ${Y(-y1)}`;
    const n = 40;
    for (let i = 0; i <= n; i++) { const y = -y1 + (2 * y1 * i) / n; d += `L${X(rho(y))} ${Y(y)}`; }
    d += `L${X(b)} ${Y(y1)}Z`;
    let dm = `M${X(-b)} ${Y(-y1)}`;
    for (let i = 0; i <= n; i++) { const y = -y1 + (2 * y1 * i) / n; dm += `L${X(-rho(y))} ${Y(y)}`; }
    dm += `L${X(-b)} ${Y(y1)}Z`;
    out += `<path d="${dm}" fill="none" stroke="${C.green}" stroke-width=".8" stroke-dasharray="3 2" opacity=".7"/>`;
    out += `<path d="${d}" fill="url(#hatchR)" stroke="${C.amber}" stroke-width="1.3"/>`;
    // cono completo (línea fina) hasta el vértice teórico
    out += `<path d="M${X(0)} ${Y(-h)} L${X(a)} ${Y(0)} L${X(0)} ${Y(h)}" fill="none" stroke="${C.amber}" stroke-width=".5" stroke-dasharray="1 2"/>`;
    // eje de revolución
    out += `<line x1="${cx}" y1="${Y(h + 14 / k)}" x2="${cx}" y2="${Y(-h - 14 / k)}" stroke="${C.cyan}" stroke-width=".9" stroke-dasharray="7 3 1 3"/>`;
    out += `<path d="M${cx} ${Y(h + 14 / k)} l-3 6 h6z" fill="${C.cyan}"/><text x="${cx + 5}" y="${f1(+Y(h + 14 / k) + 8)}" fill="${C.cyan}" font-size="10">eje y</text>`;
    // arandela representativa
    const ys = 0.42 * y1, ro = rho(ys), dy = Math.max(2.2, 0.035 * y1 * k);
    out += `<rect x="${X(b)}" y="${f1(+Y(ys) - dy / 2)}" width="${f1((ro - b) * k)}" height="${f1(dy)}" fill="#fff" fill-opacity=".85"/>`;
    out += `<rect x="${X(-ro)}" y="${f1(+Y(ys) - dy / 2)}" width="${f1((ro - b) * k)}" height="${f1(dy)}" fill="#fff" fill-opacity=".35"/>`;
    out += `<text x="${f1(+X(ro) + 5)}" y="${f1(+Y(ys) + 3)}" fill="#fff" font-size="9">arandela: ρ(y), b</text>`;
    // cotas
    out += `<line x1="${cx}" y1="${Y(0)}" x2="${X(a)}" y2="${Y(0)}" stroke="#fff" stroke-width=".8"/><text x="${f1(+X(a / 2) - 3)}" y="${f1(+Y(0) + 11)}" fill="#fff" font-size="11" class="t-math">a</text>`;
    const xr = Math.max(a, 0) * k + cx + 14;
    out += `<line x1="${f1(xr)}" y1="${Y(0)}" x2="${f1(xr)}" y2="${Y(h)}" stroke="${C.ink}" stroke-width=".7"/><line x1="${f1(xr - 3)}" y1="${Y(h)}" x2="${f1(xr + 3)}" y2="${Y(h)}" stroke="${C.ink}"/><text x="${f1(xr + 4)}" y="${Y(h / 2)}" fill="${C.ink}" font-size="11" class="t-math">h</text>`;
    out += `<line x1="${X(-b - 2 / k)}" y1="${Y(y1)}" x2="${X(a + 10 / k)}" y2="${Y(y1)}" stroke="${C.amber}" stroke-width=".5" stroke-dasharray="2 2"/><text x="4" y="${f1(+Y(y1) + 3)}" fill="${C.amber}" font-size="9">y = y₁</text>`;
    out += `<line x1="${X(-b - 2 / k)}" y1="${Y(-y1)}" x2="${X(a + 10 / k)}" y2="${Y(-y1)}" stroke="${C.amber}" stroke-width=".5" stroke-dasharray="2 2"/><text x="4" y="${f1(+Y(-y1) + 3)}" fill="${C.amber}" font-size="9">y = −y₁</text>`;
    if (b > 0) out += `<text x="${f1(+X(b) + 2)}" y="${f1(+Y(-y1) + 12)}" fill="${C.cyan}" font-size="10" class="t-math">b</text>`;
    out += `<text x="4" y="254" fill="${C.muted}" font-size="8.5">Perfil (rayado) y su simétrico (verde)</text>`;
    svg.innerHTML = out;
  }
  function updateSVGs() { svgDiscs(); svgShell(); svgReactor(); }

  /* ═════════════════════════ ESCENA 3D ═════════════════════════ */
  if (!window.THREE || !THREE.OrbitControls) {
    constrain(); updateNumbers(); updateSVGs();
    return;
  }

  const hero = $('#hero');
  const canvas = $('#scene');
  const labelLayer = $('#labels');
  const poster = $('#poster');

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  } catch (e) {
    fatal('WebGL no está disponible en este navegador: ' + e.message);
    constrain(); updateNumbers(); updateSVGs();
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x010205);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 40000);
  const controls = new THREE.OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.9;
  controls.panSpeed = 0.6;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.45;

  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const DISHV = V3(DISH.x, DISH.y, DISH.z);

  /* ─────────── texturas procedurales ─────────── */
  const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  function tex(c, srgb = true, repeat = false) {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.encoding = THREE.sRGBEncoding;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  function makeHullTextures() {
    const W = 2048, H = 1024, R_ = rng(7);
    const col = mkCanvas(W, H), bmp = mkCanvas(W, H), emi = mkCanvas(W, H);
    const gc = col.getContext('2d'), gb = bmp.getContext('2d'), ge = emi.getContext('2d');
    gc.fillStyle = '#878b91'; gc.fillRect(0, 0, W, H);
    gb.fillStyle = '#7a7a7a'; gb.fillRect(0, 0, W, H);
    ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
    const latOf = (y) => (0.5 - y / H) * PI;
    let y = 0;
    while (y < H) {
      const rowH = 5 + Math.floor(R_() * 13);
      const c = Math.max(Math.cos(latOf(y + rowH / 2)), 0.05);
      let x = -R_() * 30 / c;
      while (x < W) {
        const pw = Math.max(3, (9 + R_() * 36) / c);
        const s = (110 + R_() * 46) | 0;
        gc.fillStyle = `rgb(${s},${s + 1},${s + 4})`; gc.fillRect(x, y, pw, rowH);
        const hb = (100 + R_() * 70) | 0;
        gb.fillStyle = `rgb(${hb},${hb},${hb})`; gb.fillRect(x, y, pw, rowH);
        if (R_() < 0.5) {
          const n = 1 + ((R_() * 3) | 0);
          for (let k = 0; k < n; k++) {
            const gw = 1.5 + R_() * pw * 0.45, gh = 1 + R_() * rowH * 0.5;
            const gx = x + R_() * (pw - gw), gy = y + R_() * (rowH - gh), dd = R_() < 0.5 ? -26 : 22;
            gc.fillStyle = `rgb(${s + dd},${s + dd},${s + dd + 3})`; gc.fillRect(gx, gy, gw, gh);
            gb.fillStyle = dd < 0 ? '#3c3c3c' : '#c8c8c8'; gb.fillRect(gx, gy, gw, gh);
          }
        }
        gc.fillStyle = 'rgba(28,30,34,.55)'; gc.fillRect(x, y, 1, rowH);
        gb.fillStyle = '#2a2a2a'; gb.fillRect(x, y, 1, rowH);
        x += pw;
      }
      gc.fillStyle = 'rgba(28,30,34,.6)'; gc.fillRect(0, y, W, 1);
      gb.fillStyle = '#2a2a2a'; gb.fillRect(0, y, W, 1);
      y += rowH;
    }
    // sectores principales (cada 15°)
    gc.fillStyle = 'rgba(18,20,24,.65)'; gb.fillStyle = '#101010';
    for (let k = 0; k < 24; k++) { const xx = (W * k) / 24; gc.fillRect(xx - 1, 0, 2, H); gb.fillRect(xx - 1, 0, 3, H); }
    for (let k = -5; k <= 5; k++) { if (!k) continue; const yy = H / 2 - (k * 15 * DEG / PI) * H; gc.fillRect(0, yy - 1, W, 2); gb.fillRect(0, yy - 1, W, 3); }
    // trinchera ecuatorial
    const tw = (TRENCH_W / PI) * H;
    gc.fillStyle = '#34383e'; gc.fillRect(0, H / 2 - tw, W, 2 * tw);
    gc.fillStyle = 'rgba(200,205,212,.5)'; gc.fillRect(0, H / 2 - tw - 1, W, 1); gc.fillRect(0, H / 2 + tw, W, 1);
    // luces (emisivo): agrupadas en "distritos" y a lo largo de la trinchera
    const centers = []; for (let i = 0; i < 70; i++) centers.push([R_() * W, H * (0.12 + 0.76 * R_())]);
    for (let i = 0; i < 5200; i++) {
      let lx, ly;
      const m = R_();
      if (m < 0.35) { lx = R_() * W; ly = H / 2 + (R_() - 0.5) * 2 * tw * 0.9; }
      else if (m < 0.75) { const c = centers[(R_() * centers.length) | 0]; lx = c[0] + (R_() - 0.5) * 70; ly = c[1] + (R_() - 0.5) * 26; }
      else { lx = R_() * W; ly = H * (0.06 + 0.88 * R_()); }
      const a = 0.35 + R_() * 0.65, w = R_() < 0.8 ? 1 : 2;
      ge.fillStyle = R_() < 0.85 ? `rgba(255,222,170,${a})` : `rgba(160,220,255,${a})`;
      ge.fillRect(lx, ly, w, 1);
    }
    return { map: tex(col), bump: tex(bmp, false), emissive: tex(emi) };
  }

  function makeWallTexture() {
    const W = 1024, H = 512, R_ = rng(21);
    const c = mkCanvas(W, H), g = c.getContext('2d');
    const e = mkCanvas(W, H), ge = e.getContext('2d');
    g.fillStyle = '#1a2129'; g.fillRect(0, 0, W, H);
    ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 16) for (let x = 0; x < W; x += 32) {
      const s = (24 + R_() * 18) | 0; g.fillStyle = `rgb(${s},${s + 6},${s + 12})`; g.fillRect(x + 1, y + 1, 30, 14);
      if (R_() < 0.06) { ge.fillStyle = 'rgba(120,210,255,.55)'; ge.fillRect(x + 4, y + 6, 22, 3); }
      if (R_() < 0.03) { ge.fillStyle = 'rgba(255,190,110,.6)'; ge.fillRect(x + 8, y + 4, 4, 8); }
    }
    ge.fillStyle = 'rgba(127,211,255,.35)';
    for (let x = 0; x < W; x += 64) ge.fillRect(x, 0, 1, H);
    for (let y = 0; y < H; y += 32) ge.fillRect(0, y, W, 1);
    return { map: tex(c, true, true), emissive: tex(e, true, true) };
  }

  function makeHatchTexture() {
    const c = mkCanvas(256, 256), g = c.getContext('2d');
    g.fillStyle = '#3a2508'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#ffb23f'; g.lineWidth = 7;
    for (let i = -256; i < 512; i += 32) { g.beginPath(); g.moveTo(i, 256); g.lineTo(i + 256, 0); g.stroke(); }
    return tex(c, true, true);
  }
  function makeGlowTexture(inner, outer) {
    const c = mkCanvas(128, 128), g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, inner); gr.addColorStop(0.25, outer); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return tex(c);
  }
  function makeStripeTexture() {
    const c = mkCanvas(512, 32), g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, 512, 32);
    for (let x = 0; x < 512; x += 16) { g.fillStyle = x % 64 ? 'rgba(127,211,255,.55)' : 'rgba(125,255,156,.9)'; g.fillRect(x, 13, 9, 6); }
    return tex(c, true, true);
  }
  function makeNebulaTexture() {
    const W = 1024, H = 512, R_ = rng(3), c = mkCanvas(W, H), g = c.getContext('2d');
    g.fillStyle = '#010205'; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    const cols = ['rgba(70,50,140,', 'rgba(30,90,130,', 'rgba(130,50,70,', 'rgba(40,60,120,'];
    for (let i = 0; i < 46; i++) {
      const x = R_() * W, y = H * (0.25 + 0.5 * R_()), r = 40 + R_() * 190;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const cc = cols[(R_() * cols.length) | 0];
      gr.addColorStop(0, cc + (0.05 + R_() * 0.08) + ')'); gr.addColorStop(1, cc + '0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    return tex(c);
  }

  /* ─────────── fondo: nebulosa y estrellas ─────────── */
  const nebulaTex = makeNebulaTexture();
  const nebula = new THREE.Mesh(new THREE.SphereGeometry(20000, 48, 24), new THREE.MeshBasicMaterial({ map: nebulaTex, side: THREE.BackSide, depthWrite: false }));
  nebula.rotation.set(0.4, 0.2, -0.3);
  scene.add(nebula);
  (function stars() {
    const R_ = rng(11);
    for (const [count, size, bright] of [[7000, 1.3, 0.75], [700, 2.4, 1]]) {
      const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const u = R_() * 2 - 1, th = R_() * 2 * PI, s = Math.sqrt(1 - u * u), rr = 9000 + R_() * 6000;
        pos.set([s * Math.cos(th) * rr, u * rr, s * Math.sin(th) * rr], i * 3);
        const k = bright * (0.45 + R_() * 0.55), tint = R_();
        col.set(tint < 0.15 ? [k * 0.75, k * 0.85, k] : tint > 0.92 ? [k, k * 0.85, k * 0.7] : [k, k, k], i * 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, depthWrite: false })));
    }
  })();

  /* ─────────── luces ─────────── */
  const SUN_DIR = V3(-0.85, 0.45, 0.75).normalize();
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0x5f7dff, 0.35);
  fill.position.copy(SUN_DIR).multiplyScalar(-1).add(V3(0, -0.3, 0));
  scene.add(fill);
  const hemi = new THREE.HemisphereLight(0x8d9bb8, 0x0a0a12, 0.28);
  scene.add(hemi);
  const lightTarget = { sun: 2.7, hemi: 0.28, fill: 0.35 };

  // mapa de entorno para reflejos metálicos (generado, sin imágenes remotas)
  (function env() {
    const pm = new THREE.PMREMGenerator(renderer);
    const es = new THREE.Scene();
    es.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.MeshBasicMaterial({ map: nebulaTex, side: THREE.BackSide })));
    const s = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 8), new THREE.MeshBasicMaterial({ color: 0xfff4e0 }));
    s.position.copy(SUN_DIR).multiplyScalar(40); es.add(s);
    const s2 = new THREE.Mesh(new THREE.SphereGeometry(14, 16, 8), new THREE.MeshBasicMaterial({ color: 0x223355 }));
    s2.position.set(0, -40, 0); es.add(s2);
    scene.environment = pm.fromScene(es, 0.03).texture;
    pm.dispose();
  })();

  /* ─────────── planos de corte ─────────── */
  const cutPlane = new THREE.Plane(V3(-1, 0, 0), 1e9);   // conserva x ≤ d
  const discPlane = new THREE.Plane(V3(-1, 0, 0), 0);    // volumen acumulado x ≤ x₀
  const CLIP = [cutPlane];

  /* ─────────── estación ─────────── */
  const station = new THREE.Group();
  scene.add(station);

  // casco
  function buildHullGeometry() {
    const W = 360, lats = [];
    const base = 220;
    for (let i = 0; i <= base; i++) lats.push(-PI / 2 + (PI * i) / base);
    for (let v = -0.05; v <= 0.0501; v += 0.0025) lats.push(v);
    for (const s of [-1, 1]) for (const o of [-0.0015, -0.0008, 0, 0.0008, 0.0015]) lats.push(s * (TRENCH_W + o));
    lats.sort((p, q) => p - q);
    const L = lats.filter((v, i) => i === 0 || v - lats[i - 1] > 1e-5);
    const nV = L.length * (W + 1);
    const pos = new Float32Array(nV * 3), uv = new Float32Array(nV * 2), col = new Float32Array(nV * 3);
    let p = 0;
    for (let k = 0; k < L.length; k++) {
      const lat = L[k], cl = Math.cos(lat), sl = Math.sin(lat);
      for (let j = 0; j <= W; j++) {
        const lon = (2 * PI * j) / W;
        const nx = cl * Math.cos(lon), ny = sl, nz = -cl * Math.sin(lon);
        const rad = hullR(nx, ny, nz);
        pos[p * 3] = nx * rad; pos[p * 3 + 1] = ny * rad; pos[p * 3 + 2] = nz * rad;
        uv[p * 2] = j / W; uv[p * 2 + 1] = (lat + PI / 2) / PI;
        // tono por vértice: cuenco del superláser y trinchera más oscuros
        let shade = 1;
        const c = nx * DISH.x + ny * DISH.y + nz * DISH.z, q = Math.acos(clamp(c, -1, 1)) / DISH_ANG;
        if (q < 1) shade = 0.6 + 0.07 * Math.cos(q * 46) - 0.12 * (1 - q);
        else if (q < 1.12) shade = 0.85;
        if (Math.abs(lat) < TRENCH_W) shade *= 0.8;
        col[p * 3] = col[p * 3 + 1] = col[p * 3 + 2] = shade;
        p++;
      }
    }
    const idx = [];
    for (let k = 0; k < L.length - 1; k++) for (let j = 0; j < W; j++) {
      const a = k * (W + 1) + j, b = a + 1, c = a + W + 1, d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // orientación: las normales deben apuntar hacia fuera
    const pa = V3().fromArray(pos, idx[3 * 3000] * 3), pb = V3().fromArray(pos, idx[3 * 3000 + 1] * 3), pc = V3().fromArray(pos, idx[3 * 3000 + 2] * 3);
    const nrm = pb.clone().sub(pa).cross(pc.clone().sub(pa));
    if (nrm.dot(pa) < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  const hullTex = makeHullTextures();
  const hullMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: hullTex.map, bumpMap: hullTex.bump, bumpScale: 0.3,
    emissive: 0xffffff, emissiveMap: hullTex.emissive, emissiveIntensity: 1.25,
    metalness: 0.55, roughness: 0.52, envMapIntensity: 0.55, vertexColors: true,
    clippingPlanes: CLIP, clipShadows: true,
  });
  const hull = new THREE.Mesh(buildHullGeometry(), hullMat);
  hull.castShadow = true; hull.receiveShadow = true;
  const hullGroup = new THREE.Group();
  hullGroup.add(hull);
  station.add(hullGroup);

  // módulos superficiales (geometría real, instanciada)
  const greebleMat = new THREE.MeshStandardMaterial({ color: 0xb4b8be, metalness: 0.45, roughness: 0.65, envMapIntensity: 0.25, clippingPlanes: CLIP, clipShadows: true });
  (function greebles() {
    const R_ = rng(99), count = 2600 + 420;
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), greebleMat, count);
    im.castShadow = true; im.receiveShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = V3(), p = V3(), colr = new THREE.Color();
    const Y = V3(0, 1, 0), east = V3(), north = V3(), basis = new THREE.Matrix4();
    const clusters = []; for (let i = 0; i < 48; i++) { const u = R_() * 2 - 1, th = R_() * 2 * PI, ss = Math.sqrt(1 - u * u); clusters.push(V3(ss * Math.cos(th), u * 0.9, ss * Math.sin(th)).normalize()); }
    let i = 0;
    while (i < count) {
      const n = V3();
      const trench = i >= 2600;
      if (trench) {
        const lon = R_() * 2 * PI, lat = (R_() - 0.5) * 2 * TRENCH_W * 0.75;
        n.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
      } else if (R_() < 0.55) {
        const c = clusters[(R_() * clusters.length) | 0];
        n.set(c.x + (R_() - 0.5) * 0.22, c.y + (R_() - 0.5) * 0.22, c.z + (R_() - 0.5) * 0.22).normalize();
      } else {
        const u = R_() * 2 - 1, th = R_() * 2 * PI, ss = Math.sqrt(1 - u * u);
        n.set(ss * Math.cos(th), u, ss * Math.sin(th));
      }
      const lat = Math.asin(n.y);
      if (!trench && (Math.abs(lat) < TRENCH_W * 2.2 || Math.abs(lat) > 1.45)) continue;
      if (n.dot(DISHV) > Math.cos(DISH_ANG * 1.22)) continue;
      const rad = hullR(n.x, n.y, n.z);
      const big = R_();
      let w = 0.004 + R_() * 0.012, d = 0.004 + R_() * 0.012, hh = 0.0012 + big * big * big * 0.009;
      if (trench) { w = 0.004 + R_() * 0.01; d = 0.003 + R_() * 0.006; hh = 0.002 + R_() * 0.007; }
      if (!trench && big > 0.993) { w = d = 0.003; hh = 0.012; } // torres
      east.crossVectors(Y, n).normalize(); north.crossVectors(n, east);
      basis.makeBasis(east, n, north); q.setFromRotationMatrix(basis);
      p.copy(n).multiplyScalar(rad + hh / 2 - 0.0006);
      s.set(w, hh, d);
      m.compose(p, q, s); im.setMatrixAt(i, m);
      const g = 0.38 + R_() * 0.3; colr.setRGB(g, g, g * 1.03); im.setColorAt(i, colr);
      i++;
    }
    hullGroup.add(im);
  })();

  // superláser: anillos concéntricos, emisores y lente central
  const dishGroup = new THREE.Group();
  hullGroup.add(dishGroup);
  const dishGlowMats = [];
  (function superlaser() {
    const Z = V3(0, 0, 1), qD = new THREE.Quaternion().setFromUnitVectors(Z, DISHV);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x5c6168, metalness: 0.6, roughness: 0.5, envMapIntensity: 0.3, clippingPlanes: CLIP });
    const pointOnBowl = (q) => { const ang = q * DISH_ANG, rad = 1 - dishDepth(q); return { c: Math.cos(ang) * rad, s: Math.sin(ang) * rad }; };
    for (const [q, tube] of [[0.2, 0.0024], [0.4, 0.0026], [0.6, 0.003], [0.8, 0.003], [0.94, 0.0035], [1.03, 0.0045]]) {
      const pt = q > 1 ? { c: Math.cos(q * DISH_ANG) * 1.004, s: Math.sin(q * DISH_ANG) * 1.004 } : pointOnBowl(q);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(pt.s, tube, 8, 160), ringMat);
      ring.quaternion.copy(qD); ring.position.copy(DISHV).multiplyScalar(pt.c);
      ring.castShadow = true; dishGroup.add(ring);
    }
    // radios estructurales del cuenco
    const spokeMat = ringMat;
    for (let k = 0; k < 16; k++) {
      const pts = [];
      for (let i = 0; i <= 24; i++) { const q = 0.12 + (0.9 * i) / 24, pt = pointOnBowl(q); const phi = (k / 16) * 2 * PI; pts.push(V3(Math.cos(phi) * pt.s, Math.sin(phi) * pt.s, pt.c + 0.0012)); }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.0012, 4), spokeMat);
      tube.quaternion.copy(qD); dishGroup.add(tube);
    }
    // lente central
    const bottom = 1 - DISH_DEPTH;
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.036, 0.012, 48), ringMat);
    lens.quaternion.setFromUnitVectors(V3(0, 1, 0), DISHV); lens.position.copy(DISHV).multiplyScalar(bottom + 0.005);
    dishGroup.add(lens);
    const lensGlowMat = new THREE.MeshBasicMaterial({ color: 0x7dff9c, clippingPlanes: CLIP });
    dishGlowMats.push(lensGlowMat);
    const lensGlow = new THREE.Mesh(new THREE.CircleGeometry(0.022, 48), lensGlowMat);
    lensGlow.quaternion.copy(qD); lensGlow.position.copy(DISHV).multiplyScalar(bottom + 0.0115);
    dishGroup.add(lensGlow);
    // ocho emisores tributarios orientados al foco
    const focus = DISHV.clone().multiplyScalar(1.1);
    const emMat = new THREE.MeshStandardMaterial({ color: 0x5d636b, metalness: 0.7, roughness: 0.35, clippingPlanes: CLIP });
    const tipMat = new THREE.MeshBasicMaterial({ color: 0x9dffb4, clippingPlanes: CLIP });
    dishGlowMats.push(tipMat);
    for (let k = 0; k < 8; k++) {
      const phi = (k / 8) * 2 * PI + PI / 8, pt = pointOnBowl(0.6);
      const local = V3(Math.cos(phi) * pt.s, Math.sin(phi) * pt.s, pt.c).applyQuaternion(qD);
      const dir = focus.clone().sub(local).normalize();
      const em = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.009, 0.026, 12), emMat);
      em.quaternion.setFromUnitVectors(V3(0, 1, 0), dir); em.position.copy(local).addScaledVector(dir, 0.013);
      em.castShadow = true; dishGroup.add(em);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 12, 8), tipMat);
      tip.position.copy(local).addScaledVector(dir, 0.027); dishGroup.add(tip);
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture('rgba(190,255,205,.9)', 'rgba(80,255,130,.25)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glow.position.copy(DISHV).multiplyScalar(bottom + 0.03); glow.scale.setScalar(0.12);
    glow.userData.pulse = true; dishGroup.add(glow);
    dishGroup.userData.glow = glow;
  })();

  /* ─────────── anotaciones (ejes, anillos, cotas) ─────────── */
  const anno = new THREE.Group();
  station.add(anno);
  const lineMat = (color, opacity = 1, dashed = false, depthTest = true) => (dashed
    ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.04, gapSize: 0.025, depthTest })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest }));
  function mkLine(points, mat, loop = false) {
    const g = new THREE.BufferGeometry().setFromPoints(points);
    const l = loop ? new THREE.LineLoop(g, mat) : new THREE.Line(g, mat);
    if (mat.isLineDashedMaterial) l.computeLineDistances();
    return l;
  }
  const circlePts = (r, n = 192, plane = 'xz', off = 0) => {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * 2 * PI, a = Math.cos(t) * r, b = Math.sin(t) * r;
      pts.push(plane === 'xz' ? V3(a, off, b) : plane === 'xy' ? V3(a, b, off) : V3(off, a, b));
    }
    return pts;
  };
  (function annotations() {
    const ax = [[V3(-1.55, 0, 0), V3(1.55, 0, 0), 0xffb23f], [V3(0, -1.45, 0), V3(0, 1.45, 0), 0x7fd3ff], [V3(0, 0, -1.45), V3(0, 0, 1.45), 0x7fd3ff]];
    for (const [a, b, c] of ax) anno.add(mkLine([a, b], lineMat(c, 0.7, true)));
    anno.add(mkLine(circlePts(1.28, 256, 'xz'), lineMat(0x7fd3ff, 0.32), true));
    anno.add(mkLine(circlePts(1.28, 256, 'xy'), lineMat(0x7fd3ff, 0.22, true), true));
    const ticks = [];
    for (let k = 0; k < 72; k++) { const t = (k / 72) * 2 * PI, l = k % 9 === 0 ? 0.06 : k % 3 === 0 ? 0.035 : 0.018; ticks.push(V3(Math.cos(t) * 1.28, 0, Math.sin(t) * 1.28), V3(Math.cos(t) * (1.28 + l), 0, Math.sin(t) * (1.28 + l))); }
    anno.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ticks), lineMat(0x7fd3ff, 0.5)));
    const rDir = V3(-0.42, 0.55, 0.72).normalize();
    const rl = mkLine([V3(0, 0, 0), rDir.clone()], lineMat(0xffffff, 0.95, false, false));
    rl.renderOrder = 10; anno.add(rl);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
    dot.position.copy(rDir); dot.renderOrder = 10; anno.add(dot);
    const c0 = dot.clone(); c0.position.set(0, 0, 0); anno.add(c0);
    anno.userData.rDir = rDir;
  })();

  /* ─────────── corte transversal: sección del casco ─────────── */
  const cutGroup = new THREE.Group();
  station.add(cutGroup);
  const hatchTex = makeHatchTexture();
  const capMat = new THREE.MeshStandardMaterial({ map: hatchTex, emissive: 0xffb23f, emissiveMap: hatchTex, emissiveIntensity: 0.35, metalness: 0.2, roughness: 0.7, side: THREE.DoubleSide });
  const cap = new THREE.Mesh(new THREE.RingGeometry(0.5, 1, 160, 1), capMat);
  cap.rotation.y = PI / 2;
  cutGroup.add(cap);
  const capOuter = mkLine(circlePts(1, 192, 'yz'), lineMat(0xffb23f, 1), true);
  const capInner = mkLine(circlePts(1, 192, 'yz'), lineMat(0x7fd3ff, 1), true);
  const planeFrame = mkLine([V3(0, -1.3, -1.3), V3(0, 1.3, -1.3), V3(0, 1.3, 1.3), V3(0, -1.3, 1.3)], lineMat(0xffb23f, 0.55, true), true);
  const planeFill = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({ color: 0xffb23f, transparent: true, opacity: 0.035, side: THREE.DoubleSide, depthWrite: false }));
  planeFill.rotation.y = PI / 2;
  const secRadius = mkLine([V3(0, 0, 0), V3(0, 1, 0)], lineMat(0xffffff, 0.95, false, false));
  secRadius.renderOrder = 10;
  cutGroup.add(capOuter, capInner, planeFrame, planeFill, secRadius);
  let cutValue = 1.05; // posición actual (animada) del plano en unidades de R
  function updateCap() {
    const d = cutValue, rn = rIn() / P.R;
    const ro = Math.sqrt(Math.max(0, 1 - d * d)), ri = Math.abs(d) < rn ? Math.sqrt(rn * rn - d * d) : 0;
    cap.geometry.dispose();
    cap.geometry = new THREE.RingGeometry(Math.max(ri, 0), Math.max(ro, 1e-4), 160, 1);
    cap.visible = ro > 1e-3;
    cap.position.x = d;
    hatchTex.repeat.set(ro * 7, ro * 7);
    capOuter.scale.setScalar(ro || 1e-4); capOuter.position.x = d;
    capInner.scale.setScalar(ri || 1e-4); capInner.position.x = d; capInner.visible = ri > 0;
    planeFrame.position.x = d; planeFill.position.x = d;
    secRadius.position.x = d; secRadius.scale.y = ro || 1e-4;
    cutPlane.constant = P.mode === 'B' || cutAnim ? d * P.R : 1e9;
  }

  /* ─────────── interior ─────────── */
  const interior = new THREE.Group();
  station.add(interior);
  const wallTex = makeWallTexture();
  wallTex.map.repeat.set(6, 3); wallTex.emissive.repeat.set(6, 3);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex.map, emissive: 0xffffff, emissiveMap: wallTex.emissive, emissiveIntensity: 0.9, metalness: 0.4, roughness: 0.7, side: THREE.BackSide, clippingPlanes: CLIP, transparent: true, opacity: 1 });
  const wallGroup = new THREE.Group();
  interior.add(wallGroup);
  const wall = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 72), wallMat);
  wall.receiveShadow = true;
  wallGroup.add(wall);
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x3a4652, emissive: 0x7fd3ff, emissiveIntensity: 0.55, metalness: 0.6, roughness: 0.4, clippingPlanes: CLIP });
  for (const latd of [-60, -40, -20, 0, 20, 40, 60]) {
    const L = latd * DEG, ring = new THREE.Mesh(new THREE.TorusGeometry(Math.cos(L) * 0.985, latd ? 0.0035 : 0.007, 6, 192), deckMat);
    ring.rotation.x = PI / 2; ring.position.y = Math.sin(L) * 0.985; wallGroup.add(ring);
  }
  for (let k = 0; k < 12; k++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(0.985, 0.003, 4, 96, PI), deckMat);
    rib.rotation.set(0, (k / 12) * PI, PI / 2); wallGroup.add(rib);
  }

  const modulesGroup = new THREE.Group();
  interior.add(modulesGroup);
  const reactorLight = new THREE.PointLight(0xbfe8ff, 1.3, 0, 2);
  const coreLight = new THREE.PointLight(0x7dff9c, 0.9, 0, 2);
  const keyLight = new THREE.PointLight(0xffd9b0, 0.7, 0, 2);
  interior.add(reactorLight, coreLight, keyLight);
  const MOD = {};      // módulos actuales
  const glowTex = makeGlowTexture('rgba(220,255,230,1)', 'rgba(80,255,140,.35)');
  const stripeTex = makeStripeTexture();
  const beamMats = [];

  const matReactor = new THREE.MeshStandardMaterial({ color: 0xa4afbd, metalness: 0.85, roughness: 0.32, envMapIntensity: 0.9, side: THREE.DoubleSide, clippingPlanes: CLIP });
  const matBore = new THREE.MeshStandardMaterial({ color: 0x0b2733, emissive: 0x7fd3ff, emissiveIntensity: 1.4, side: THREE.DoubleSide, clippingPlanes: CLIP });
  const matBand = new THREE.MeshBasicMaterial({ color: 0x9fe2ff, clippingPlanes: CLIP });

  // Sólido de revolución generado por el perfil ρ(y); válido para cualquier unidad
  function buildReactor(a, h, b, opts = {}) {
    const g = new THREE.Group();
    const y1 = h * (1 - b / a), prof = (y) => a * (1 - Math.abs(y) / h), n = 24, segs = opts.segs || 128;
    const lower = [], upper = [];
    for (let k = 0; k <= n; k++) { const y = -y1 + (y1 * k) / n; lower.push(new THREE.Vector2(prof(y), y)); }
    for (let k = 0; k <= n; k++) { const y = (y1 * k) / n; upper.push(new THREE.Vector2(prof(y), y)); }
    for (const pts of [lower, upper]) { const m = new THREE.Mesh(new THREE.LatheGeometry(pts, segs), opts.body || matReactor); m.castShadow = true; m.receiveShadow = true; g.add(m); }
    if (b > 0) g.add(new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(b, y1), new THREE.Vector2(b, -y1)], segs), opts.bore || matBore));
    // anillos sobre la superficie (posiciones de arandelas)
    for (let k = -5; k <= 5; k++) {
      const y = (y1 * k) / 6, rr = prof(y);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(rr * 1.003, k ? a * 0.006 : a * 0.018, 6, segs), opts.band || matBand);
      ring.rotation.x = PI / 2; ring.position.y = y; g.add(ring);
    }
    // perfil generador (mismos puntos que el SVG y la integral) y eje de revolución
    const pp = [];
    for (let k = 0; k <= 2 * n; k++) { const y = -y1 + (y1 * k) / n; pp.push(V3(prof(y) * 1.006, y, 0)); }
    pp.push(V3(b, y1, 0), V3(b, -y1, 0), pp[0].clone());
    const profile = mkLine(pp, new THREE.LineBasicMaterial({ color: 0xffb23f, depthTest: false, transparent: true }));
    profile.renderOrder = 12;
    const axis = mkLine([V3(0, -1.4 * h, 0), V3(0, 1.4 * h, 0)], new THREE.LineDashedMaterial({ color: 0x7fd3ff, dashSize: h * 0.08, gapSize: h * 0.05, depthTest: false, transparent: true }));
    axis.renderOrder = 12;
    g.add(profile, axis);
    return { group: g, profile, axis, y1 };
  }

  function disposeTree(o) {
    o.traverse((c) => { if (c.geometry) c.geometry.dispose(); });
  }

  function buildInterior() {
    disposeTree(modulesGroup);
    modulesGroup.clear();
    for (const k in MOD) delete MOD[k];
    beamMats.length = 0;
    const L = layout();
    wallGroup.scale.setScalar(L.rn);

    // 1 · reactor doble cono
    const re = buildReactor(L.an, L.hn, L.bn);
    modulesGroup.add(re.group);
    MOD.reactor = { group: re.group, center: V3(0, 0, 0), size: Math.max(L.an, L.hn), extra: [re.profile, re.axis] };

    // 2 · anillo toroidal con radios de unión
    const tg = new THREE.Group();
    const torMat = new THREE.MeshStandardMaterial({ color: 0x7d8792, metalness: 0.8, roughness: 0.35, emissive: 0xffffff, emissiveMap: stripeTex, emissiveIntensity: 1, clippingPlanes: CLIP });
    stripeTex.repeat.set(24, 1);
    const tor = new THREE.Mesh(new THREE.TorusGeometry(L.torusR0, L.torusTube, 32, 220), torMat);
    tor.rotation.x = PI / 2; tor.castShadow = tor.receiveShadow = true; tg.add(tor);
    const spokeMat = new THREE.MeshStandardMaterial({ color: 0x5f6873, metalness: 0.7, roughness: 0.4, clippingPlanes: CLIP });
    for (let k = 0; k < 6; k++) {
      const phi = (k / 6) * 2 * PI + PI / 6, len = L.torusR0 - L.an * 0.75;
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(L.torusTube * 0.18, L.torusTube * 0.18, len, 8), spokeMat);
      sp.rotation.z = PI / 2; sp.rotation.y = phi;
      const mid = L.an * 0.75 + len / 2; sp.position.set(Math.cos(phi) * mid, 0, -Math.sin(phi) * mid); tg.add(sp);
    }
    modulesGroup.add(tg);
    MOD.torus = { group: tg, center: V3(0, 0, 0), size: L.torusR0 + L.torusTube };

    // 3 · esfera de energía (en el eje del superláser)
    const cg = new THREE.Group();
    cg.position.copy(L.coreC);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0x8dffad, clippingPlanes: CLIP });
    cg.add(new THREE.Mesh(new THREE.SphereGeometry(L.coreRad, 48, 32), coreMat));
    const cage = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(L.coreRad * 1.35, 1)), new THREE.LineBasicMaterial({ color: 0x7dff9c, transparent: true, opacity: 0.8, clippingPlanes: CLIP }));
    cage.userData.spin = true; cg.add(cage);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sp.scale.setScalar(L.coreRad * 6); sp.userData.pulse = true; cg.add(sp);
    modulesGroup.add(cg);
    MOD.core = { group: cg, center: L.coreC.clone(), size: L.coreRad * 1.4 };
    coreLight.position.copy(L.coreC);
    reactorLight.position.set(0.35 * L.rn, 0.45 * L.rn, 0.6 * L.rn);
    keyLight.position.set(-0.5 * L.rn, -0.2 * L.rn, 0.55 * L.rn);

    // haz: reactor → esfera → superláser
    const beamMat = new THREE.MeshBasicMaterial({ color: 0x7dff9c, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, clippingPlanes: CLIP });
    beamMats.push(beamMat);
    const top = V3(0, re.y1 + 0.003, 0), dishBottom = DISHV.clone().multiplyScalar(1 - DISH_DEPTH);
    for (const [p0, p1, rr] of [[top, L.coreC, 0.004], [L.coreC, dishBottom, 0.006]]) {
      const len = p0.distanceTo(p1);
      const bm = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, len, 12, 1, true), beamMat);
      bm.position.copy(p0).add(p1).multiplyScalar(0.5);
      bm.quaternion.setFromUnitVectors(V3(0, 1, 0), p1.clone().sub(p0).normalize());
      cg.parent.add(bm); bm.userData.beam = true;
    }

    // 4 · torre cilíndrica de varios niveles
    const wg = new THREE.Group();
    wg.position.copy(L.towerC);
    const total = L.levels.reduce((s, l) => s + l[1], 0);
    let y = -total / 2;
    const lvMat = new THREE.MeshStandardMaterial({ color: 0x8a949f, metalness: 0.75, roughness: 0.38, clippingPlanes: CLIP });
    const winMat = new THREE.MeshStandardMaterial({ color: 0x111820, emissive: 0xffffff, emissiveMap: stripeTex, emissiveIntensity: 1.1, clippingPlanes: CLIP });
    for (const [lr, lh] of L.levels) {
      const plat = lh < 0.02 * L.rn;
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(lr, lr, lh, 64), lvMat);
      cyl.position.y = y + lh / 2; cyl.castShadow = cyl.receiveShadow = true; wg.add(cyl);
      if (!plat) {
        const win = new THREE.Mesh(new THREE.CylinderGeometry(lr * 1.004, lr * 1.004, lh * 0.22, 64, 1, true), winMat);
        win.position.y = y + lh / 2; wg.add(win);
      }
      y += lh;
    }
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.004 * L.rn, 0.006 * L.rn, 0.09 * L.rn, 8), lvMat);
    ant.position.y = y + 0.045 * L.rn; wg.add(ant);
    modulesGroup.add(wg);
    MOD.tower = { group: wg, center: L.towerC.clone(), size: total * 0.7 };

    applyModuleVisibility();
  }

  function applyModuleVisibility() {
    const inC = P.mode === 'C';
    for (const k in MOD) {
      const m = MOD[k];
      m.group.visible = !(inC && P.isolate && k !== P.module);
      if (m.extra) m.extra.forEach((e) => { e.visible = inC && P.module === 'reactor'; });
    }
    modulesGroup.children.forEach((c) => { if (c.userData.beam) c.visible = !(inC && P.isolate); });
    wallMat.opacity = inC && P.isolate ? 0.35 : 1;
    wallMat.depthWrite = !(inC && P.isolate);
  }

  /* ─────────── método de discos ─────────── */
  const discGroup = new THREE.Group();
  station.add(discGroup);
  const ghost = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), new THREE.MeshStandardMaterial({ color: 0x7fd3ff, transparent: true, opacity: 0.07, depthWrite: false, metalness: 0, roughness: 1 }));
  discGroup.add(ghost);
  const wire = new THREE.Group();
  for (let k = 0; k < 12; k++) { const l = mkLine(circlePts(1, 128, 'xy'), lineMat(0x7fd3ff, 0.18), true); l.rotation.x = (k / 12) * PI; wire.add(l); }
  for (let k = -5; k <= 5; k++) { const x = k / 6, rr = Math.sqrt(1 - x * x); const l = mkLine(circlePts(rr, 128, 'yz', x), lineMat(0x7fd3ff, 0.18), true); wire.add(l); }
  discGroup.add(wire);
  const accumMat = new THREE.MeshStandardMaterial({ color: 0xffb23f, emissive: 0x6a3a00, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: [discPlane] });
  const accum = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), accumMat);
  discGroup.add(accum);
  const discGeo = new THREE.CylinderGeometry(1, 1, 1, 96).rotateZ(PI / 2);
  const curDisc = new THREE.Mesh(discGeo, new THREE.MeshStandardMaterial({ color: 0xffc766, emissive: 0xff9a1a, emissiveIntensity: 0.65, metalness: 0.2, roughness: 0.5 }));
  const curRing = mkLine(circlePts(1, 160, 'yz'), lineMat(0xffffff, 1, false, false), true);
  curRing.renderOrder = 11;
  const curRadius = mkLine([V3(0, 0, 0), V3(0, 1, 0)], lineMat(0xffffff, 1, false, false));
  curRadius.renderOrder = 11;
  discGroup.add(curDisc, curRing, curRadius);
  const MAXN = 200;
  const riemannMesh = new THREE.InstancedMesh(discGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.3, roughness: 0.45, transparent: true, opacity: 0.9 }), MAXN);
  discGroup.add(riemannMesh);
  const xAxisD = mkLine([V3(-1.5, 0, 0), V3(1.5, 0, 0)], lineMat(0xffb23f, 0.9));
  const tk = []; for (const x of [-1, -0.5, 0, 0.5, 1]) tk.push(V3(x, -0.04, 0), V3(x, 0.04, 0));
  discGroup.add(xAxisD, new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(tk), lineMat(0xffb23f, 0.9)));
  function updateDiscs() {
    const N = P.N, dx = 2 / N, m = new THREE.Matrix4(), c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const xm = -1 + (i + 0.5) * dx, rr = Math.sqrt(1 - xm * xm);
      m.makeScale(dx * 0.94, rr, rr).setPosition(xm, 0, 0);
      riemannMesh.setMatrixAt(i, m);
      c.setHSL(0.09 + 0.06 * (i / N), 0.9, 0.42 + 0.18 * (1 - Math.abs(xm))); riemannMesh.setColorAt(i, c);
    }
    riemannMesh.count = Math.round(P.build * N);
    riemannMesh.instanceMatrix.needsUpdate = true;
    if (riemannMesh.instanceColor) riemannMesh.instanceColor.needsUpdate = true;
    const x = P.x, rr = Math.sqrt(Math.max(0, 1 - x * x));
    curDisc.position.x = x; curDisc.scale.set(Math.max(dx, 0.006), rr * 1.004 + 1e-4, rr * 1.004 + 1e-4);
    curRing.position.x = x; curRing.scale.setScalar(rr * 1.006 + 1e-4);
    curRadius.position.x = x; curRadius.scale.y = rr + 1e-4;
    discPlane.constant = x * P.R;
  }

  /* ─────────── etiquetas HTML proyectadas ─────────── */
  const labels = [];
  function addLabel(cls, getPos, modes, opts = {}) {
    const el = document.createElement('div');
    el.className = 'lbl ' + cls;
    labelLayer.appendChild(el);
    const L = { el, getPos, modes, surface: opts.surface, text: opts.text, show: opts.show };
    labels.push(L);
    return L;
  }
  const RkM = (u) => nf(u * P.R, 1);
  addLabel('axis', () => V3(1.62, 0, 0), 'ABD', { text: () => 'x' });
  addLabel('axis', () => V3(0, 1.52, 0), 'AB', { text: () => 'y' });
  addLabel('axis', () => V3(0, 0, 1.52), 'AB', { text: () => 'z' });
  addLabel('white', () => anno.userData.rDir.clone().multiplyScalar(0.55), 'A', { text: () => 'R = ' + nf(P.R, 1) + ' km' });
  addLabel('green', () => DISHV.clone().multiplyScalar(1.0), 'A', { surface: true, text: () => 'Superláser · depresión ' + nf(DISH_DEPTH * P.R, 1) + ' km' });
  addLabel('', () => V3(Math.cos(0.9), 0, -Math.sin(0.9)), 'A', { surface: true, text: () => 'Trinchera ecuatorial' });
  addLabel('', () => V3(-0.35, 0.82, 0.45).normalize(), 'A', { surface: true, text: () => 'Paneles y módulos (no forman parte de la esfera ideal)' });
  addLabel('amber', () => V3(cutValue, 1.3, 1.3), 'B', { text: () => 'Plano x = d = ' + RkM(P.cut) + ' km' });
  addLabel('white', () => V3(cutValue, Math.sqrt(Math.max(0, 1 - cutValue * cutValue)) * 0.55, 0), 'B', { text: () => '√(R² − d²) = ' + nf(Math.sqrt(Math.max(0, P.R * P.R - (P.cut * P.R) ** 2)), 1) + ' km' });
  addLabel('amber', () => { const rn = rIn() / P.R, d = cutValue, ro = Math.sqrt(Math.max(0, 1 - d * d)), ri = Math.abs(d) < rn ? Math.sqrt(rn * rn - d * d) : 0; return V3(d, -(ro + ri) / 2, 0); }, 'B', { text: () => 'Casco · t = ' + nf(P.t, 1) + ' km' });
  addLabel('', () => V3(cutValue, 0, -0.3 * rIn() / P.R), 'B', { text: () => 'Cavidad · r = ' + nf(rIn(), 1) + ' km', show: () => Math.abs(P.cut) < rIn() / P.R });
  addLabel('green', () => (MOD.reactor ? V3(0, -(MOD.reactor.size) * 0.2, 0) : V3()), 'C', { text: () => 'Reactor · V = ' + nf(moduleVolumes().reactor, 1) + ' km³', show: () => !P.isolate || P.module === 'reactor' });
  addLabel('green', () => (MOD.core ? MOD.core.center.clone().add(V3(0, layout().coreRad * 1.6, 0)) : V3()), 'C', { text: () => 'Esfera de energía · V = ' + nf(moduleVolumes().core, 1) + ' km³', show: () => !P.isolate || P.module === 'core' });
  addLabel('', () => { const L = layout(); return V3(-L.torusR0 * 0.7, 0, L.torusR0 * 0.7); }, 'C', { text: () => 'Anillo toroidal · V = ' + nf(moduleVolumes().torus, 1) + ' km³', show: () => !P.isolate || P.module === 'torus' });
  addLabel('', () => (MOD.tower ? MOD.tower.center.clone().add(V3(0.1 * rIn() / P.R, 0, 0)) : V3()), 'C', { text: () => 'Torre · V = ' + nf(moduleVolumes().tower, 1) + ' km³', show: () => !P.isolate || P.module === 'tower' });
  addLabel('amber', () => V3(0, P.h / P.R * 1.4, 0), 'C', { text: () => 'Eje de revolución', show: () => P.module === 'reactor' });
  addLabel('amber', () => V3(P.a / P.R * 1.02, 0, 0), 'C', { text: () => 'ρ(y) perfil generador', show: () => P.module === 'reactor' });
  addLabel('axis', () => V3(-1, -0.1, 0), 'D', { text: () => '−R' });
  addLabel('axis', () => V3(0, -0.1, 0), 'D', { text: () => '0' });
  addLabel('axis', () => V3(1, -0.1, 0), 'D', { text: () => 'R' });
  addLabel('amber', () => V3(P.x, Math.sqrt(Math.max(0, 1 - P.x * P.x)) * 0.5, 0), 'D', { text: () => { const xs = P.x * P.R, r2 = Math.max(0, P.R * P.R - xs * xs); return 'x = ' + nf(xs, 1) + ' km · r(x) = ' + nf(Math.sqrt(r2), 2) + ' km · A(x) = π r² = ' + nfa(PI * r2) + ' km²'; } });
  addLabel('white', () => V3(Math.max(-0.9, P.x - 0.45), -0.75, 0.4), 'D', { text: () => { const R = P.R, x = P.x * R, v = PI * (R * R * (x + R) - (x ** 3 + R ** 3) / 3); return 'Volumen acumulado de −R a x = ' + nf(v, 0) + ' km³'; } });

  const _v = V3(), _n = V3(), _c = V3();
  function updateLabels() {
    station.updateMatrixWorld();
    for (const L of labels) {
      let vis = L.modes.includes(P.mode) && !fly;
      if (vis && L.show) vis = L.show();
      if (vis) {
        _v.copy(L.getPos()).applyMatrix4(station.matrixWorld);
        if (L.surface) { _n.copy(_v).normalize(); _c.copy(camera.position).sub(_v); if (_n.dot(_c) < 0) vis = false; }
        _v.project(camera);
        if (_v.z > 1 || Math.abs(_v.x) > 1.05 || Math.abs(_v.y) > 1.05) vis = false;
      }
      L.el.classList.toggle('hidden', !vis);
      if (!vis) continue;
      const txt = L.text();
      if (L._t !== txt) { L.el.textContent = txt; L._t = txt; }
      L.el.style.left = ((_v.x * 0.5 + 0.5) * 100).toFixed(2) + '%';
      L.el.style.top = ((-_v.y * 0.5 + 0.5) * 100).toFixed(2) + '%';
    }
  }

  /* ─────────── cámara: vistas y vuelos ─────────── */
  const VIEW = {
    A: () => ({ pos: V3(2.35, 1.05, 2.15).normalize().multiplyScalar(3.4 * P.R), target: V3(0, 0, 0) }),
    B: () => ({ pos: V3(2.7, 0.95, 1.55).normalize().multiplyScalar(3.1 * P.R), target: V3(P.cut * P.R * 0.3, 0, 0) }),
    D: () => ({ pos: V3(0.9, 0.95, 2.6).normalize().multiplyScalar(3.3 * P.R), target: V3(0, 0, 0) }),
    dish: () => { const side = V3(0, 0, 1); return { pos: DISHV.clone().multiplyScalar(1.85).addScaledVector(side, 0.45).add(V3(0, 0.25, 0)).multiplyScalar(P.R), target: DISHV.clone().multiplyScalar(0.96 * P.R) }; },
    module: (k) => {
      const L = layout(), m = MOD[k], R = P.R, c = m.center.clone();
      let off;
      if (k === 'reactor') off = V3(0.35, 0.28, 1).normalize().multiplyScalar(Math.min(m.size * 2.3, 0.84 * L.rn));
      else if (k === 'core') off = V3(-0.25, 0.18, 1).normalize().multiplyScalar(m.size * 4.2);
      else if (k === 'torus') off = V3(0.15, 0.62, 0.75).normalize().multiplyScalar(Math.min(m.size * 1.9, 0.84 * L.rn));
      else off = V3(0.55, 0.2, 0.75).normalize().multiplyScalar(m.size * 4);
      const pos = c.clone().add(off);
      if (pos.length() > 0.86 * L.rn) pos.setLength(0.86 * L.rn);
      return { pos: pos.multiplyScalar(R), target: c.multiplyScalar(R) };
    },
  };

  let fly = null;
  function flyTo(pos, target, dur = 1600, via = [], onDone) {
    const pts = [camera.position.clone(), ...via, pos.clone()];
    fly = {
      t0: performance.now(), dur, onDone,
      curve: pts.length > 2 ? new THREE.CatmullRomCurve3(pts, false, 'centripetal') : null,
      p0: pts[0], p1: pos.clone(), tg0: controls.target.clone(), tg1: target.clone(),
    };
    controls.enabled = false;
  }
  function stepFly(now) {
    if (!fly) return;
    const t = clamp((now - fly.t0) / fly.dur, 0, 1), e = ease(t);
    if (fly.curve) camera.position.copy(fly.curve.getPoint(e)); else camera.position.lerpVectors(fly.p0, fly.p1, e);
    controls.target.lerpVectors(fly.tg0, fly.tg1, e);
    camera.lookAt(controls.target);
    if (t >= 1) { const f = fly; fly = null; controls.enabled = true; controls.update(); if (f.onDone) f.onDone(); }
  }
  const camInside = () => camera.position.length() < rIn() * 0.995;
  const exitVia = () => [DISHV.clone().multiplyScalar(0.55 * rIn()), DISHV.clone().multiplyScalar(1.25 * P.R)];

  function cameraGuard() {
    const R = P.R, p = camera.position, len = p.length();
    if (P.mode === 'C') {
      const lim = 0.93 * rIn();
      if (len > lim) p.setLength(lim);
    } else if (P.mode === 'B') {
      const dx = cutValue * R;
      // el lado conservado (x ≤ d) es sólido: no se puede atravesar ni el casco ni la cara de corte
      if (len < 1.03 * R && p.x < dx + 0.02 * R) {
        if (p.x > dx - 0.3 * R) p.x = dx + 0.02 * R; else p.setLength(1.03 * R);
      }
    } else if (len < 1.035 * R) p.setLength(1.035 * R);
  }
  function setDistanceLimits() {
    const R = P.R;
    if (P.mode === 'C') { controls.minDistance = 0.02 * R; controls.maxDistance = 1.8 * rIn(); }
    else { controls.minDistance = 0.04 * R; controls.maxDistance = 8 * R; }
  }

  /* ─────────── modos ─────────── */
  let cutAnim = null, fovTarget = 36;
  function setMode(m, opt = {}) {
    const prev = P.mode;
    if (m === prev && !opt.force) return;
    P.mode = m;
    $$('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    const [tag, title, desc] = MODE_INFO[m];
    $('#mode-tag').textContent = tag; $('#mode-title').textContent = title; $('#mode-desc').textContent = desc;
    hullGroup.visible = m !== 'D';
    interior.visible = m === 'B' || m === 'C';
    cutGroup.visible = m === 'B';
    discGroup.visible = m === 'D';
    anno.visible = m === 'A' || m === 'B';
    anno.children.forEach((c, i) => { if (i > 2) c.visible = m === 'A'; });
    Object.assign(lightTarget, m === 'C' ? { sun: 0, hemi: 0.22, fill: 0 } : m === 'D' ? { sun: 1.8, hemi: 0.5, fill: 0.4 } : { sun: 2.7, hemi: 0.28, fill: 0.35 });
    fovTarget = m === 'C' ? 60 : 36;
    applyModuleVisibility();
    // plano de corte
    if (m === 'B') cutAnim = { from: 1.02, to: P.cut, t0: performance.now(), dur: 1400 };
    else { cutAnim = null; cutValue = 1.05; }
    updateCap();
    setDistanceLimits();
    updateHeroFormula();
    const inside = camInside();
    const autoRot = (v) => () => { controls.autoRotate = P.rotate && v; };
    if (m === 'C') {
      const v = VIEW.module(P.module);
      if (inside) flyTo(v.pos, v.target, 1400, [], autoRot(false));
      else {
        const far = camera.position.length() > 1.6 * P.R;
        const via = [];
        if (far) via.push(DISHV.clone().multiplyScalar(1.7 * P.R));
        via.push(DISHV.clone().multiplyScalar(1.12 * P.R), DISHV.clone().multiplyScalar(0.92 * P.R), DISHV.clone().multiplyScalar(0.55 * rIn()));
        flyTo(v.pos, v.target, 3600, via, autoRot(false));
      }
      controls.autoRotate = false;
    } else {
      const v = VIEW[m]();
      flyTo(v.pos, v.target, inside ? 3000 : 1700, inside ? exitVia() : [], autoRot(true));
      controls.autoRotate = false;
    }
  }

  function focusModule(k) {
    P.module = k;
    $$('#modules button').forEach((b) => b.classList.toggle('on', b.dataset.module === k));
    if (P.mode !== 'C') { setMode('C'); return; }
    applyModuleVisibility();
    updateHeroFormula();
    const v = VIEW.module(k);
    flyTo(v.pos, v.target, 1300);
  }

  /* ─────────── escala y parámetros ─────────── */
  let builtR = P.R;
  function applyR() {
    const R = P.R, k = R / builtR;
    station.scale.setScalar(R);
    if (k !== 1) {
      camera.position.multiplyScalar(k); controls.target.multiplyScalar(k);
      if (fly) { fly.p0.multiplyScalar(k); fly.p1.multiplyScalar(k); fly.tg0.multiplyScalar(k); fly.tg1.multiplyScalar(k); fly.curve && fly.curve.points.forEach((p) => p.multiplyScalar(k)); }
    }
    builtR = R;
    sun.position.copy(SUN_DIR).multiplyScalar(3 * R);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -1.15 * R; sc.right = sc.top = 1.15 * R; sc.near = 1.2 * R; sc.far = 5 * R; sc.updateProjectionMatrix();
    sun.shadow.normalBias = 0.0015 * R;
    hullMat.bumpScale = 0.005 * R;
    reactorLight.distance = 0; coreLight.distance = 0;
    camera.near = Math.max(0.02, 0.002 * R); camera.updateProjectionMatrix();
    setDistanceLimits();
  }

  let interiorKey = '';
  function refresh() {
    constrain();
    applyR();
    const key = [P.R, P.t, P.a, P.h, P.b].join('|');
    if (key !== interiorKey) { buildInterior(); interiorKey = key; }
    updateCap();
    updateDiscs();
    updateNumbers();
    updateSVGs();
    updateMini();
  }

  /* ─────────── mini vista 3D del reactor (tarjeta 03) ─────────── */
  const miniCanvas = $('#reactor-canvas');
  const mini = { renderer: null };
  try {
    mini.renderer = new THREE.WebGLRenderer({ canvas: miniCanvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    mini.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    mini.renderer.outputEncoding = THREE.sRGBEncoding;
    mini.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    mini.scene = new THREE.Scene();
    mini.scene.environment = scene.environment;
    mini.camera = new THREE.PerspectiveCamera(30, 240 / 260, 0.01, 100);
    mini.camera.position.set(0, 0.9, 4.6); mini.camera.lookAt(0, 0, 0);
    const dl = new THREE.DirectionalLight(0xffffff, 2.2); dl.position.set(-2, 3, 4);
    mini.scene.add(dl, new THREE.HemisphereLight(0x9fb4d0, 0x101018, 0.6));
    mini.holder = new THREE.Group(); mini.scene.add(mini.holder);
    mini.mats = {
      body: new THREE.MeshStandardMaterial({ color: 0xa4afbd, metalness: 0.85, roughness: 0.3, side: THREE.DoubleSide }),
      bore: new THREE.MeshStandardMaterial({ color: 0x0b2733, emissive: 0x7fd3ff, emissiveIntensity: 1.4, side: THREE.DoubleSide }),
      band: new THREE.MeshBasicMaterial({ color: 0x9fe2ff }),
    };
  } catch (e) { mini.renderer = null; }
  function updateMini() {
    if (!mini.renderer) return;
    disposeTree(mini.holder); mini.holder.clear();
    const s = 1 / Math.max(P.a, P.h);
    const r = buildReactor(P.a * s, P.h * s, P.b * s, { segs: 96, ...mini.mats });
    mini.holder.add(r.group);
  }
  function sizeMini() {
    if (!mini.renderer) return;
    const w = miniCanvas.clientWidth, h = miniCanvas.clientHeight;
    if (w && h) { mini.renderer.setSize(w, h, false); mini.camera.aspect = w / h; mini.camera.updateProjectionMatrix(); }
  }

  /* ─────────── tamaño y escala gráfica ─────────── */
  function resize() {
    const w = hero.clientWidth, h = hero.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    sizeMini();
  }
  new ResizeObserver(resize).observe(hero);
  window.addEventListener('resize', resize);

  const scaleBar = $('#scalebar'), scaleI = scaleBar.querySelector('i'), scaleS = scaleBar.querySelector('span');
  function updateScaleBar() {
    const h = hero.clientHeight, pw = poster.clientWidth; if (!h || !pw) return;
    const dist = camera.position.distanceTo(controls.target);
    const kmPerPx = (2 * dist * Math.tan((camera.fov * DEG) / 2)) / h;
    const want = pw * 0.09 * kmPerPx, p10 = Math.pow(10, Math.floor(Math.log10(want)));
    const nice = [1, 2, 5, 10].map((m) => m * p10).reduce((best, v) => (Math.abs(v - want) < Math.abs(best - want) ? v : best));
    scaleI.style.width = ((nice / kmPerPx / pw) * 100).toFixed(2) + 'cqw';
    scaleS.textContent = (nice >= 1 ? nf(nice, 0) : nf(nice, 2)) + ' km';
  }

  /* ─────────── bucle de animación ─────────── */
  let buildAnim = null, frame = 0;
  const clock = new THREE.Clock();
  function animate(now) {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1), t = clock.elapsedTime;
    frame++;
    // luces suaves entre modos
    sun.intensity += (lightTarget.sun - sun.intensity) * 0.06;
    hemi.intensity += (lightTarget.hemi - hemi.intensity) * 0.06;
    fill.intensity += (lightTarget.fill - fill.intensity) * 0.06;
    if (Math.abs(camera.fov - fovTarget) > 0.01) { camera.fov += (fovTarget - camera.fov) * 0.06; camera.updateProjectionMatrix(); }
    // plano de corte animado
    if (cutAnim) {
      const k = clamp((now - cutAnim.t0) / cutAnim.dur, 0, 1);
      cutValue = cutAnim.from + (cutAnim.to - cutAnim.from) * ease(k);
      if (k >= 1) { cutAnim = null; cutValue = P.cut; }
      updateCap();
    }
    // construcción progresiva de los discos
    if (buildAnim) {
      const k = clamp((now - buildAnim.t0) / buildAnim.dur, 0, 1);
      P.build = k; inp.build.value = k;
      updateDiscs(); svgDiscs(); $('#o-build').textContent = Math.round(P.build * P.N) + ' / ' + P.N;
      if (k >= 1) { buildAnim = null; $('#btn-build').disabled = false; }
    }
    // pulsos
    const pulse = 0.75 + 0.25 * Math.sin(t * 3.1);
    const g = dishGroup.userData.glow; g.material.opacity = 0.55 + 0.4 * pulse;
    beamMats.forEach((m) => { m.opacity = 0.32 + 0.28 * Math.sin(t * 5.3); });
    modulesGroup.traverse((o) => { if (o.userData.spin) { o.rotation.y += dt * 0.4; o.rotation.x += dt * 0.15; } if (o.userData.pulse) o.material.opacity = 0.6 + 0.4 * pulse; });
    if (MOD.torus) MOD.torus.group.rotation.y += dt * 0.08;

    if (fly) stepFly(now); else { controls.update(); cameraGuard(); }
    // dentro de la cavidad el casco exterior no es visible: se oculta (evita verlo a través de la pared en vista aislada)
    hullGroup.visible = P.mode !== 'D' && !(P.mode === 'C' && camInside());
    renderer.render(scene, camera);
    updateLabels();
    if (frame % 6 === 0) updateScaleBar();
    if (mini.renderer && (frame % 2 === 0)) { mini.holder.rotation.y += 0.012; mini.renderer.render(mini.scene, mini.camera); }
  }

  /* ─────────── interfaz ─────────── */
  const bindRange = (key, fn) => inp[key].addEventListener('input', () => { P[key] = parseFloat(inp[key].value); fn(); });
  bindRange('R', refresh);
  bindRange('t', refresh);
  bindRange('a', refresh);
  bindRange('h', refresh);
  bindRange('b', refresh);
  bindRange('cut', () => { if (P.mode === 'B' && !cutAnim) cutValue = P.cut; updateCap(); updateNumbers(); svgShell(); });
  bindRange('x', () => { updateDiscs(); svgDiscs(); updateNumbers(); if (P.mode !== 'D') setMode('D'); });
  bindRange('N', () => { P.N = Math.round(P.N); updateDiscs(); updateNumbers(); svgDiscs(); });
  bindRange('build', () => { buildAnim = null; $('#btn-build').disabled = false; updateDiscs(); svgDiscs(); updateNumbers(); });
  inp.cut.addEventListener('pointerdown', () => { if (P.mode !== 'B') setMode('B'); });
  for (const k of ['N', 'build']) inp[k].addEventListener('pointerdown', () => { if (P.mode !== 'D') setMode('D'); });
  for (const k of ['a', 'h', 'b']) inp[k].addEventListener('change', () => { if (P.mode === 'C' && P.module === 'reactor') focusModule('reactor'); });

  $$('#modes button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $$('#modules button').forEach((b) => b.addEventListener('click', () => focusModule(b.dataset.module)));
  $('#in-isolate').addEventListener('change', (e) => { P.isolate = e.target.checked; if (P.mode !== 'C') setMode('C'); else applyModuleVisibility(); });

  function dolly(f) {
    const off = camera.position.clone().sub(controls.target);
    const len = clamp(off.length() * f, controls.minDistance, controls.maxDistance);
    flyTo(controls.target.clone().add(off.setLength(len)), controls.target.clone(), 380);
  }
  $('#btn-zoom-in').addEventListener('click', () => dolly(0.75));
  $('#btn-zoom-out').addEventListener('click', () => dolly(1.33));
  $('#btn-reset').addEventListener('click', () => {
    P.rotate = true; $('#btn-rotate').classList.add('on'); $('#btn-rotate').textContent = '❚❚';
    if (P.mode !== 'A') setMode('A'); else { const v = VIEW.A(); flyTo(v.pos, v.target, 1500, [], () => { controls.autoRotate = true; }); }
  });
  $('#btn-rotate').addEventListener('click', (e) => {
    P.rotate = !P.rotate; controls.autoRotate = P.rotate && P.mode !== 'C';
    e.currentTarget.classList.toggle('on', P.rotate); e.currentTarget.textContent = P.rotate ? '❚❚' : '▶';
  });
  $('#btn-dish').addEventListener('click', () => {
    const go = () => { const v = VIEW.dish(); controls.autoRotate = false; flyTo(v.pos, v.target, 2200); };
    if (P.mode !== 'A') { setMode('A'); fly.onDone = go; } else go();
  });
  $('#btn-enter').addEventListener('click', () => setMode('C', { force: P.mode !== 'C' }));
  $('#btn-build').addEventListener('click', (e) => {
    if (P.mode !== 'D') setMode('D');
    P.build = 0; buildAnim = { t0: performance.now() + 600, dur: 1800 + P.N * 22 };
    e.currentTarget.disabled = true;
  });
  $('#btn-print').addEventListener('click', () => {
    const doPrint = () => setTimeout(() => window.print(), 250);
    if (P.mode !== 'A') { setMode('A'); fly.onDone = () => { controls.autoRotate = P.rotate; doPrint(); }; } else doPrint();
  });

  // impresión: re-render a mayor resolución para el A3
  let printPR = null;
  window.addEventListener('beforeprint', () => {
    printPR = renderer.getPixelRatio();
    renderer.setPixelRatio(2.5); resize();
    stepFly(performance.now() + 1e5);
    renderer.render(scene, camera); updateLabels();
    if (mini.renderer) { mini.renderer.setPixelRatio(2.5); sizeMini(); mini.renderer.render(mini.scene, mini.camera); }
  });
  window.addEventListener('afterprint', () => {
    if (printPR) { renderer.setPixelRatio(printPR); if (mini.renderer) mini.renderer.setPixelRatio(printPR); resize(); }
  });

  /* ─────────── arranque ─────────── */
  const v0 = VIEW.A();
  camera.position.copy(v0.pos); controls.target.copy(v0.target);
  station.scale.setScalar(P.R);
  refresh();
  setMode('A', { force: true });
  fly = null; controls.enabled = true;
  camera.position.copy(v0.pos); controls.update();
  controls.autoRotate = P.rotate;
  resize();
  requestAnimationFrame(animate);

  // gancho de depuración/pruebas
  window.__DS = { P, setMode, focusModule, refresh, camera, controls, cache: () => cache, Vreactor, VreactorSimpson, riemann, Vsphere, renderer };
})();
