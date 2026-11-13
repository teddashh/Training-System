// Original, code-drawn primitives. Coordinates are in the 1200 × 600 artwork space.
// All objects use a light left face, darker right face, 6-unit strokes and 6-unit corners.
// Scene recipes arrange these primitives; no external assets or drawing dependencies.
// Six-scene rhythm: daylight blue/green lead; warm sand appears once per theme.
export const families = ['#083957', '#003636', '#542247', '#A97D4E', '#083957', '#003636'];
export const accents = ['#52BEC7', '#A91264', '#3B9D8E', '#A97D4E'];
export function mix(hex, amount) {
  const target = amount < 0 ? 0 : 255;
  return '#' + hex.slice(1).match(/../g).map(v => Math.round(parseInt(v, 16) * (1 - Math.abs(amount)) +
    target * Math.abs(amount)).toString(16).padStart(2, '0')).join('');
}
export const composition = {
  floor: 405,
  subject: [540, 100, 1060, 400],
  recognition: [680, 150, 1050, 370],
  card: [131, 0, 1069, 600],
  strip: [0, 150, 1200, 450]
};
export function scenePalette(base, accent) {
  const cool = accent === '#A91264' || accent === '#3B9D8E' ? '#3B9D8E' : '#52BEC7';
  const warm = accent === '#A91264' || accent === '#A97D4E' ? '#A97D4E' : '#A91264';
  return {
    base, accent: cool, cool, warm,
    far: mix(base, .60), mid: mix(base, .44), shade: mix(base, .64),
    light: mix(base, .80), pale: mix(base, .93),
    dark: base === '#A97D4E' ? '#321A0F' : mix(base, -.24),
    skyTop: mix(base, .12), skyUpper: mix(base, .30),
    skyLower: mix(base, .50), horizon: mix(base, .67),
    glow: mix(base, .86), white: '#ffffff'
  };
}
export function drawing(base, accent) {
  const p = scenePalette(base, accent);
  const rep = (n, fn) => Array.from({
    length: n
  }, (_, i) => fn(i)).join('');
  const rect = (x, y, w, h, c = p.light, r = 6) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${c}"/>`;
  const path = (d, c = p.light) => `<path d="${d}" fill="${c}"/>`;
  const line = (d, c = p.pale, w = 6) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const circle = (x, y, r, c = p.light) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`;
  const ellipse = (x, y, rx, ry, c = p.light) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${c}"/>`;
  const group = (x, y, content, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})">${content}</g>`;
  const box = (x, y, w, h, c = p.light) => rect(x, y, w, h, c) + path(`M${x + w - 18} ${y}h18v${h}h-18Z`, p.shade) +
    line(`M${x + 8} ${y + 8}h${w - 34}`, p.pale, 5);
  const groundShadow = (x, y, w = 160) => ellipse(x, y, w, 12, p.dark);
  // Daylight is four flat bands, never an SVG gradient. The quiet left-hand
  // architecture varies by room use; all essential equipment is in the recipes.
  function background(kind = 'room', floor = composition.floor, id = '') {
    let art = rect(0, 0, 1200, 600, p.skyTop, 0) +
      rect(0, 120, 1200, 105, p.skyUpper, 0) +
      rect(0, 225, 1200, 90, p.skyLower, 0) +
      rect(0, 315, 1200, floor - 315, p.horizon, 0);
    if (kind === 'room') {
      art += rect(610, 106, 448, 260, p.glow, 6);
      if (/archive|documents|library|warehouse|workshop/.test(id)) {
        art += rect(205, 186, 258, 190, p.mid) + rep(3, i =>
          rep(5, j => rect(220 + j * 46, 199 + i * 55, 34, 40, j % 2 ? p.far : p.shade)) +
          rect(205, 241 + i * 55, 258, 8, p.skyUpper));
      } else if (/meeting|control-chart|classroom|assessment/.test(id)) {
        art += circle(391, 235, 37, p.light) + circle(391, 235, 30, p.far) +
          line('M391 212V235L408 246', p.mid, 5) + rep(3, i =>
          line(`M${180 + i * 117} 0v125`, p.mid, 5) +
          path(`M${158 + i * 117} 125h44l18 24h-80Z`, p.light));
      } else if (/locker|ppe|electrical|server|badge|first-aid/.test(id)) {
        art += rect(260, 166, 176, 234, p.mid) + rect(271, 176, 154, 224, p.shade) +
          rect(289, 201, 118, 79, p.far) + rect(394, 308, 8, 30, p.light);
      } else if (/reception|onboarding|interview|handshake|mentoring/.test(id)) {
        art += rect(161, 209, 300, 11, p.mid) + rect(190, 173, 48, 36, p.shade) +
          rect(253, 179, 72, 30, p.light) + rect(350, 160, 64, 49, p.far) +
          rect(218, 330, 211, 48, p.mid) + line('M235 378v24M411 378v24', p.shade, 8);
      } else {
        art += rect(168, 160, 294, 179, p.mid) + rect(179, 171, 272, 157, p.light) +
          path('M179 289h49v-36h42v51h44v-67h37v52h100v39H179Z', p.far) +
          line('M315 171V328M179 214H451', p.mid, 6);
        if (/ergonomics|open-office|health-check/.test(id)) art += rep(3, i =>
          line(`M179 ${178 + i * 12}H451`, p.shade, 5));
      }
    } else {
      art += circle(850, 207, 137, p.glow);
      if (kind === 'coast') {
        art += path('M0 326Q190 277 420 319T1200 307V405H0Z', p.far) +
          path('M0 361Q290 330 590 359T1200 343V405H0Z', p.light) +
          line('M70 374H350M185 390H470', p.far, 6);
      } else if (/environment|heat|muster|career/.test(id)) {
        art += path('M0 365Q190 271 397 328T745 322T1200 340V405H0Z', p.far) +
          rep(4, i => rect(130 + i * 92, 319, 8, 86, p.mid) +
          ellipse(134 + i * 92, 311, 27, 47, p.shade));
      } else if (/gate|rail|loading|forklift/.test(id)) {
        art += rect(90, 309, 386, 94, p.far) + path('M65 309l105 -45h200l130 45Z', p.shade) +
          rep(4, i => rect(120 + i * 86, 333, 52, 70, p.horizon)) +
          line('M130 264V210H447V288M170 210L315 130L447 210', p.far, 8);
      } else {
        art += line('M95 395V277H466V395M95 310H466M170 277V395M380 277V395', p.far, 9) +
          rep(3, i => rect(230 + i * 70, 198 + i * 18, 22, 199 - i * 18, p.far)) +
          circle(143, 324, 43, p.shade) + line('M115 350V403M170 350V403', p.far, 7);
      }
    }
    art += rect(0, floor, 1200, 600 - floor, p.dark, 0) + line(`M0 ${floor}H1200`, p.light, 6);
    art += path(`M0 570L670 ${floor + 20}H1030L510 600H0Z`, p.base);
    return `<g data-layer="background">${art}</g>`;
  }
  function foreground(kind, id) {
    const shadow = path('M688 415H1055L929 473H580Z', p.base);
    if (kind === 'coast') return shadow + line('M720 469H927M858 500H1048', p.mid, 6);
    if (kind === 'yard') return shadow + rect(964, 439, 95, 12, p.shade) +
      rect(982, 425, 14, 29, p.mid) + rect(1031, 425, 14, 29, p.mid);
    return shadow + line('M743 455H1042M891 419L1030 497', p.mid, 5);
  }
  const window = (x, y, w = 170, h = 120) => rect(x, y, w, h, p.mid) +
    rect(x + 8, y + 8, w - 16, h - 16, p.pale) + line(`M${x + w / 2} ${y + 8}v${h - 16}M${x + 8} ${y + h / 2}h${w - 16}`, p.mid);
  function skyline(x = 160, y = 305, s = 1) {
    return group(x, y, rect(0, 70, 380, 50, p.far) + rep(5, i => rect(20 +
      i * 70, 50 - i % 3 * 24, 24, 70 + i % 3 * 24, p.far)) + rect(320, 0, 12, 120, p.far) +
      ellipse(140, 85, 60, 20, p.far), s);
  }
  function tank(x, y, w = 120, h = 115, stairs = false) {
    let art = rect(x, y + 16, w, h - 16, p.light, 0) + ellipse(x + w / 2, y +
      h, w / 2, 16, p.light) + rect(x + w * .65, y + 16, w * .35, h - 16, p.shade, 0) +
      ellipse(x + w / 2, y + 16, w / 2, 16, p.pale);
    art += rect(x, y + h * .36, w, h * .37, p.cool, 0);
    art += line(`M${x + 8} ${y + h - 20}Q${x + w / 2} ${y + h - 6} ${x + w - 8} ${y + h - 20}`, p.shade, 5);
    if (stairs) {
      art += line(`M${x + 12} ${y + 28}Q${x + w - 5} ${y + 38} ${x + w - 12} ${y + 70}Q${x + 12} ${y + 88} ${x + 12} ${y + h}`, p.dark, 5);
      art += rep(7, i => line(`M${x + 15 + i * 12} ${y + 33 + i * 4}v12`, p.dark, 5));
      art += line(`M${x + 10} ${y + 5}Q${x + w / 2} ${y - 14} ${x + w - 10} ${y + 5}`, p.pale, 5);
    }
    return art;
  }
  function sphereTank(x, y, r = 40) {
    return line(`M${x - r + 12} ${y + 20}l-8 68M${x + r - 12} ${y + 20}l8 68M${x} ${y + 30}v58`, p.light, 8) +
      circle(x, y, r, p.shade) + path(`M${x} ${y - r}A${r} ${r} 0 0 0 ${x} ${y + r}Q${x - r / 2} ${y} ${x} ${y - r}`, p.pale) +
      line(`M${x - r + 6} ${y + 10}Q${x} ${y + 24} ${x + r - 6} ${y + 10}`, p.mid, 5) +
      rect(x - 8, y - r - 12, 16, 12, p.light);
  }
  function ladder(x, y, h = 140) {
    return line(`M${x} ${y}v${h}M${x + 24} ${y}v${h}`, p.pale, 5) + rep(Math.floor(h / 18), i => line(`M${x} ${y + 10 + i * 18}h24`, p.pale, 5));
  }
  function column(x, y, h = 210, w = 52) {
    return rect(x, y, w, h, p.light, w / 2) + rect(x + w - 18, y + 20, 18, h - 20, p.shade) +
      ellipse(x + w / 2, y + 20, w / 2, 20, p.pale) + rect(x, y + h * .34, w, h * .40, p.cool, 0) + rep(3, i => rect(x - 12, y +
      55 + i * 50, w + 24, 9, p.mid, 0) + line(`M${x - 12} ${y + 55 + i * 50}v-18h${w + 24}v18`, p.pale, 5)) +
      ladder(x + w + 10, y + 35, h - 35) + rect(x - 12, y + h, w + 34, 14, p.shade);
  }
  const flare = (x, y, h = 240) => rect(x, y + 30, 14, h - 30, p.shade, 0) +
    line(`M${x - 25} ${y + h}L${x + 7} ${y + 40}l32 ${h - 40}`, p.mid, 5) +
    path(`M${x + 7} ${y + 36}C${x - 24} ${y + 12} ${x + 16} ${y + 16} ${x + 8} ${y - 10}C${x + 42} ${y + 10} ${x + 25} ${y + 26} ${x + 7} ${y + 36}`, p.warm);
  function pipe(d, c = p.light, w = 14) {
    return line(d, p.dark, w + 6) + line(d, c, w) + line(d, p.pale, 5);
  }
  const valve = (x, y, r = 22) => line(`M${x} ${y}v36`, p.shade, 8) +
    circle(x, y, r, p.accent) + circle(x, y, r - 12, p.base) + line(`M${x - r + 4} ${y}h${r * 2 - 8}M${x} ${y - r + 4}v${r * 2 - 8}`, p.accent, 5);
  const gauge = (x, y, r = 20) => circle(x, y, r, p.dark) + circle(x, y, r - 5, p.pale) +
    line(`M${x} ${y}l8 -9`, p.base, 5);
  function building(x, y, w = 220, h = 130) {
    return box(x, y, w, h, p.mid) + path(`M${x - 12} ${y}l${w / 2 + 12} -28L${x + w + 12} ${y}Z`, p.light) +
      rep(3, i => rect(x + 16 + i * (w - 32) / 3, y + 28, (w - 60) / 3, 32, p.dark)) +
      rect(x + w - 64, y + h - 75, 40, 75, p.warm, 0);
  }
  function tree(x, y, s = 1) {
    return group(x, y, line('M0 0V-100', p.dark, 10) + ellipse(-15, -100, 32, 44, p.cool) +
      ellipse(20, -122, 35, 45, p.light) + line('M0 -50L22 -95M0 -70L-18 -99', p.dark, 5), s);
  }
  function plant(x, y) {
    return path(`M${x - 24} ${y - 42}h48l-8 42h-32Z`, p.warm) + line(`M${x} ${y - 42}v-80`, p.light, 6) +
      ellipse(x - 17, y - 90, 14, 30, p.cool) + ellipse(x + 18, y - 110, 16, 32, p.cool);
  }
  function hat(x, y, w = 50) {
    return path(`M${x - w / 2} ${y}a${w / 2} ${w / 2} 0 0 1 ${w} 0Z`, p.accent) +
      rect(x - w / 2 - 6, y, w + 12, 8, p.accent) + line(`M${x} ${y - 20}v17`, p.pale, 5);
  }
  // A faceless figure with explicit arms; plant workers get a helmet and reflective vest.
  function person(x, y, {
    s = 1,
    hat: helmet = false,
    seated = false,
    arms = 'down',
    coat = false,
    climb = false
  } = {}) {
    let art = seated ? line('M-12 -57V-34H34V0M12 -57V-46H49V0', p.dark, 17) : climb ? line('M-12 -65L-18 0M14 -65L44 -65V-43', p.dark, 18) : line('M-12 -65L-18 0M14 -65L24 0', p.dark, 18);
    art += path('M-25 -124Q0 -137 25 -124L30 -60H-28Z', p.light);
    art += path('M-17 -127Q0 -136 17 -127L20 -60H-20Z', coat ? p.pale : p.warm);
    
    art += circle(0, -154, 21, p.pale);
    art += arms === 'none' ? '' : arms === 'reach' ? line('M-20 -115L-40 -88L-6 -81M21 -115L40 -94L70 -103', p.warm, 14) : arms === 'talk' ? line('M-20 -115L-30 -83M20 -114L45 -85L64 -110', p.warm, 14) : line('M-23 -112L-34 -67M24 -112L38 -69', p.warm, 14);
    if (!helmet) art += path('M-21 -154a21 21 0 0 1 42 0l-12 -10h-18Z', p.cool);
    if (helmet) art += hat(0, -169, 45) + line('M-17 -119L-14 -76M17 -119L20 -76M-20 -88H23', p.pale, 10);
    art += line(seated ? 'M30 0h17M46 0h17' : climb ? 'M-22 0h17M40 -43h17' : 'M-22 0h17M19 0h17', p.dark, 9);
    return group(x, y, art, s);
  }
  const desk = (x, y, w = 240) => path(`M${x} ${y}l28 -24h${w}l-28 24Z`, p.pale) +
    rect(x, y, w, 14, p.warm, 0) + rect(x + 14, y + 14, 12, 64, p.shade, 0) +
    rect(x + w - 24, y + 14, 12, 64, p.shade, 0);
  const bench = (x, y, w = 220) => rect(x, y, w, 15, p.light) + rect(x +
    18, y + 15, 12, 40, p.shade) + rect(x + w - 30, y + 15, 12, 40, p.shade);
  function chart(x, y, w = 100, h = 65) {
    return line(`M${x + 10} ${y + 10}v${h - 20}h${w - 20}`, p.mid, 5) +
      line(`M${x + 19} ${y + h - 23}l${w * .2} -17l${w * .2} 8l${w * .25} -${h * .45}`, p.warm, 6);
  }
  function screen(x, y, w = 145, h = 95, content = 'chart') {
    let art = rect(x, y, w, h, p.dark) + rect(x + 8, y + 8, w - 16, h - 16, p.pale) +
      rect(x + 8, y + 8, (w - 16) * .26, h - 16, p.cool, 0);
    if (content === 'chart') art += chart(x + 8, y + 8, w - 16, h - 16);
    if (content === 'play') art += path(`M${x + w * .4} ${y + h * .27}l${w * .27} ${h * .23}l-${w * .27} ${h * .23}Z`, p.warm);
    return art;
  }
  const monitor = (x, y, w = 130, h = 85, content = 'chart') => rect(x +
    w / 2 - 7, y + h, 14, 20, p.shade) + rect(x + w / 2 - 30, y + h + 18, 60, 8, p.light) +
    screen(x, y, w, h, content);
  const laptop = (x, y, w = 165, content = 'blank') => screen(x, y, w, 105, content) +
    path(`M${x} ${y + 105}h${w}l24 22H${x - 24}Z`, p.light) + rect(x + w / 2 - 20, y +
    110, 40, 8, p.shade);
  function chair(x, y) {
    return rect(x, y, 52, 65, p.warm, 12) + line(`M${x + 26} ${y + 65}v65m0 -8l-34 12m34 -12l34 12`, p.light, 7) +
      rect(x - 6, y + 67, 70, 12, p.cool);
  }
  function pallet(x, y, w = 100) {
    return rect(x, y, w, 10, p.shade, 0) + rep(3, i => rect(x + 8 + i * (w - 24) / 3, y +
      10, 12, 12, p.light, 0)) + line(`M${x} ${y + 22}h${w}`, p.shade, 6);
  }
  function bags(x, y, n = 3) {
    return rep(n, i => rect(x + i % 2 * 5, y - i * 25, 88, 24, p.light, 10) +
      line(`M${x + 12} ${y + 8 - i * 25}h60`, i % 2 ? p.warm : p.cool, 10));
  }
  function boxes(x, y, w = 45, n = 3) {
    return rep(n, i => box(x + i * (w + 6), y, w, 40, i % 2 ? p.cool : p.warm) + rect(x + i * (w + 6) + w / 2 - 5, y + 2, 10, 17, p.shade));
  }
  function shelf(x, y, w = 200, h = 230, contents = 'boxes') {
    return rect(x, y, 10, h, p.shade, 0) + rect(x + w - 10, y, 10, h, p.shade, 0) + rep(3, i => {
      const yy = y + 45 + i * 75;
      let stock = contents === 'books' ? rep(7, j => rect(x + 18 + j * 23, yy - 35, 16, 35, j % 3 === 0 ? p.warm : j % 3 === 1 ? p.cool : p.light, 2) +
        line(`M${x + 22 + j * 23} ${yy - 22}h8`, p.pale, 5)) : boxes(x + 18, yy - 40, 42, 3);
      return stock + rect(x, yy, w, 10, p.mid, 0);
    });
  }
  function wheel(x, y, r = 24) {
    return circle(x, y, r, p.dark) + circle(x, y, r - 8, p.shade) + circle(x, y, 6, p.pale);
  }
  function truck(x, y, {
    fire = false
  } = {}) {
    const color = fire ? p.warm : p.cool;
    return rect(x, y, 198, 105, color) + path(`M${x + 198} ${y + 28}h61l33 44v33h-94Z`, p.cool) +
      path(`M${x + 210} ${y + 37}h37l21 30h-58Z`, p.dark) + wheel(x + 48, y +
      108) + wheel(x + 240, y + 108) + rect(x + 282, y + 81, 12, 12, p.pale) +
      line(`M${x + 207} ${y + 78}v20`, p.light, 5) + (fire ? ladder(x + 20, y +
      20, 65) + rect(x + 80, y + 20, 92, 65, p.light) + line(`M${x + 90} ${y + 36}h72M${x + 90} ${y + 52}h72M${x + 90} ${y + 68}h72`, p.shade, 5) +
      rect(x + 215, y + 15, 32, 10, p.accent) : '');
  }
  function forklift(x, y) {
    return path(`M${x} ${y}h100v60H${x - 20}v-36Z`, p.accent) + rect(x +
      18, y - 75, 10, 80, p.light) + rect(x + 90, y - 75, 10, 140, p.light) +
      rect(x + 5, y - 82, 110, 10, p.light) + rect(x + 115, y - 100, 12, 165, p.shade) +
      line(`M${x + 127} ${y + 54}h76`, p.pale, 8) + rect(x + 38, y - 22, 38, 25, p.dark) +
      line(`M${x + 65} ${y - 20}l14 -25`, p.dark, 6) + wheel(x + 8, y + 65) +
      wheel(x + 90, y + 65, 18);
  }
  const cone = (x, y) => path(`M${x} ${y}l16 -50l16 50Z`, p.accent) +
    path(`M${x + 8} ${y - 24}h16l3 10H${x + 5}Z`, p.pale) + rect(x - 7, y, 46, 8, p.dark);
  const cross = (x, y, s = 1, c = p.accent) => group(x, y, path('M-9 -27H9V-9H27V9H9V27H-9V9H-27V-9H-9Z', c), s);
  const lock = (x, y) => line(`M${x - 14} ${y}v-16a14 14 0 0 1 28 0v16`, p.dark, 7) +
    rect(x - 24, y, 48, 38, p.accent) + circle(x, y + 15, 6, p.pale);
  const clipboard = (x, y, w = 110, h = 145) => box(x, y, w, h, p.light) +
    rect(x + 8, y + 10, w - 16, h - 18, p.pale) + rect(x + w / 2 - 22, y - 6, 44, 18, p.shade) +
    rep(3, i => rect(x + 18, y + 32 + i * 30, 13, 13, p.shade, 0) + line(`M${x + 40} ${y + 39 + i * 30}h${w - 58}`, p.mid, 5));
  const tick = (x, y, s = 1) => group(x, y, line('M0 12L13 25L42 -10', p.accent, 9), s);
  return {
    p,
    rep,
    rect,
    path,
    line,
    circle,
    ellipse,
    group,
    box,
    groundShadow,
    background,
    foreground,
    window,
    skyline,
    tank,
    sphereTank,
    ladder,
    column,
    flare,
    pipe,
    valve,
    gauge,
    building,
    tree,
    plant,
    hat,
    person,
    desk,
    bench,
    chart,
    screen,
    monitor,
    laptop,
    chair,
    pallet,
    bags,
    boxes,
    shelf,
    wheel,
    truck,
    forklift,
    cone,
    cross,
    lock,
    clipboard,
    tick
  };
}
