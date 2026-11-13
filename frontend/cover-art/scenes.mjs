// Scene recipes use the same visual vocabulary but deliberately different arrangements.
// Recipes use a shared stage (floor at source y=455). The final daylight stage
// lifts and enlarges them to y=100..405; recognition stays at x=680..1050, y=150..370.
export function renderScene(id, d) {
  const {
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
  } = d;
  const outdoor = /scene-(plant-(?!control)|site-(gate|loading|rail|marine)|safety-(work|confined|forklift)|emergency-(muster|spill|safety)|health-heat|environment|people-(team|career)|learning-mentoring)/.test(id);
  const coast = /wetland|marine-terminal/.test(id);
  const kind = coast ? 'coast' : outdoor ? 'yard' : 'room';
  const backdrop = background(kind, 405, id);
  let art = '';
  // Ground contact unifies foreground objects without a floating-icon presentation.
  art += groundShadow(805, 458, 250);
  switch (id) {
    case 'scene-plant-skyline':
      art += building(550, 330, 145, 110) + column(711, 171, 269, 67) +
        column(835, 204, 236, 64) + flare(991, 187, 253) + tank(903, 358, 142, 74) +
        pipe('M642 425V367H918V422', p.warm, 20);
      art += line('M548 448H1055', p.light, 8);
      break;
    case 'scene-plant-tank-farm':
      art += skyline(220, 270) + tank(580, 245, 175, 150, true) + tank(770, 285, 142, 124, true) +
        sphereTank(949, 288, 43) + sphereTank(1032, 331, 35) + pipe('M580 425H918V388H1030', p.warm, 18);
      break;
    case 'scene-plant-pipe-rack':
      {
        art += building(350, 320, 210, 110);
        // Converging frames and pipe runs form a corridor, rather than a flat fence.
        art += rep(4, i => {
          const x = 995 - i * 133,
            y = 270 - i * 27,
            h = 160 + i * 9;
          return line(`M${x - 66} ${y + h}V${y}h130v${h}`, p.shade, 10) + line(`M${x - 66} ${y + 22}h130`, p.light, 7);
        });
        art += pipe('M555 177L1040 276', p.light, 16) + pipe('M555 204L1040 301', p.warm, 20) +
          pipe('M555 231L1040 326', p.cool, 20);
        art += path('M568 373L1045 418V432L568 388Z', p.mid) + line('M570 344L1040 391M570 366V332M705 390V360M855 413V389M1040 432V383', p.pale, 5) +
          valve(709, 207) + valve(940, 281);
        break;
      }
    case 'scene-plant-process-unit':
      art += skyline(190, 290) + column(610, 185, 240, 66) + column(765, 155, 270, 58) +
        column(920, 232, 192, 50) + pipe('M680 395H735V298H767M823 372H910V295', p.warm);
      art += rect(743, 385, 164, 42, p.warm, 21) + ellipse(743, 406, 21, 21, p.pale) +
        rep(6, i => line(`M${768 + i * 21} 389v34`, p.shade, 5)) + rect(760, 430, 14, 20, p.mid) +
        rect(866, 430, 14, 20, p.mid) + gauge(881, 365);
      break;
    case 'scene-plant-cooling-towers':
      art += building(885, 336, 175, 95) + building(430, 365, 130, 65);
      art += rep(2, i => {
        const x = 606 + i * 157;
        return path(`M${x} 409Q${x + 36} 300 ${x + 16} 238H${x + 110}Q${x + 90} 300 ${x + 128} 409Z`, p.light) +
          path(`M${x + 86} 238h24Q${x + 90} 300 ${x + 128} 409h-38Q${x + 65} 302 ${x + 86} 238`, p.cool) +
          path(`M${x + 12} 359h99l10 35H${x + 3}Z`, p.warm) +
          ellipse(x + 63, 238, 47, 13, p.pale) + ellipse(x + 63, 238, 34, 7, p.dark) +
          rep(6, j => rect(x + 10 + j * 19, 393, 9, 26, p.dark, 0)) + path(`M${x + 40} 215C${x + 9} 193 ${x + 45} 173 ${x + 19} 147Q${x + 69} 125 ${x + 83} 156T${x + 83} 214Z`, p.mid);
      });
      art += pipe('M588 439H1040', p.light, 16) + valve(981, 407);
      break;
    case 'scene-plant-control-room':
      art += rep(3, i => screen(567 + i * 161, 171, 149, 101)) +
        rep(3, i => screen(574 + i * 156, 286, 143, 75));
      art += path('M550 379L578 352H1030L1060 379V442H550Z', p.mid) +
        rect(550, 379, 510, 17, p.light) + rep(7, i => rect(570 + i * 67, 407, 46, 12, i % 2 ? p.warm : p.pale));
      art += person(863, 448, {seated: true, s: 1.3, arms: 'reach'}) + chair(811, 365);
      break;
    case 'scene-site-gatehouse':
      art += rep(12, i => line(`M${550 + i * 43} 318v127`, p.mid, 5)) +
        line('M550 334H1060M550 397H1060', p.mid, 5) + building(678, 223, 247, 219);
      art += rect(703, 255, 153, 90, p.cool) + line('M779 255V345', p.pale, 7) +
        rect(868, 350, 41, 92, p.warm, 0) + rect(948, 333, 30, 111, p.dark) +
        rect(554, 319, 414, 20, p.pale) + rep(9, i =>
        path(`M${565 + i * 43} 319h22l-13 20h-22Z`, p.warm));
      break;
    case 'scene-site-warehouse':
      art += path('M550 455L727 285H901L1070 455Z', p.mid) + shelf(554, 174, 192, 258) + shelf(861, 174, 192, 258) +
        rep(3, i => rect(554, 219 + i * 75, 192, 14, p.cool) + rect(861, 219 + i * 75, 192, 14, p.warm));
      art += line('M753 435L789 324M846 435L811 324', p.pale, 5) + pallet(756, 404, 98) +
        bags(761, 379, 3) + rect(785, 300, 57, 25, p.shade);
      break;
    case 'scene-site-loading-dock':
      art += rect(540, 166, 525, 248, p.mid) + rect(540, 166, 525, 31, p.warm) + rep(3, i => rect(562 +
        i * 166, 206, 145, 194, p.dark) + rep(7, j => line(`M${571 + i * 166} ${218 + j * 24}h126`, p.shade, 5)));
      art += rect(535, 409, 540, 23, p.light) + truck(670, 300) + pallet(553, 409, 100) +
        bags(559, 383, 3) + cone(1017, 447);
      break;
    case 'scene-site-rail-yard':
      art += tank(610, 240, 80, 121) + tank(720, 236, 80, 125) + pipe('M650 250V230H838V334');
      art += rep(2, i => {
        const x = 565 + i * 252;
        return path(`M${x} 316h231v64l-31 38H${x + 30}l-30 -38Z`, p.light) + rect(x, 339, 231, 24, p.warm, 0) +
          path(`M${x + 161} 316h70v64l-31 38h-39Z`, p.cool) + rect(x + 8, 305, 213, 12, p.pale) +
          rep(5, j => line(`M${x + 25 + j * 43} 328v48`, p.mid, 5)) + wheel(x +
          44, 425, 18) + wheel(x + 188, 425, 18) + line(`M${x + 92} 419h44`, p.dark, 8);
      });
      art += rep(20, i => rect(545 + i * 26, 441, 20, 19, p.warm, 0)) +
        line('M540 443H1060M540 457H1060', p.dark, 7);
      break;
    case 'scene-site-marine-terminal':
      art += skyline(250, 230) + rect(555, 320, 510, 20, p.shade) + rep(6, i => rect(578 +
        i * 86, 340, 12, 81, p.mid));
      art += path('M568 346H1057L1009 418H622Z', p.light) + path('M595 382H1034L1009 418H622Z', p.warm) +
        rect(610, 283, 81, 63, p.pale) + rect(629, 257, 47, 26, p.light) + rep(3, i => rect(619 +
        i * 23, 295, 14, 17, p.dark));
      art += rep(4, i => tank(720 + i * 69, 317, 54, 29)) + line('M978 316V230L892 215L850 278', p.dark, 18) +
        line('M978 316V230L892 215L850 278', p.light, 10) + circle(892, 215, 13, p.accent) +
        rep(3, i => rect(720 + i * 115, 299, 12, 23, p.dark) + rect(713 + i * 115, 298, 26, 8, p.dark)) +
        line('M580 438H727M865 436H1015', p.pale, 5);
      break;
    case 'scene-site-workshop':
      art += rect(575, 166, 328, 131, p.light) + rect(575, 166, 328, 32, p.warm) + rep(6, i => {
        const x = 600 + i * 48;
        return line(`M${x} 193v67`, p.pale, 8) + path(`M${x - 14} 183v20l14 10l14 -10v-20l-8 12h-12Z`, p.light);
      });
      art += desk(565, 360, 440) + box(583, 377, 92, 63) + rect(724, 304, 157, 57, p.cool, 20) +
        ellipse(724, 333, 25, 28, p.pale) + circle(724, 333, 13, p.dark) + rep(5, i => line(`M${761 + i * 22} 312v42`, p.shade, 5)) +
        rect(759, 355, 110, 14, p.shade) + pipe('M881 331H924V304') + gauge(948, 313) +
        rect(952, 178, 104, 111, p.warm) + rep(2, i => box(962, 193 + i * 48, 78, 35));
      break;
    case 'scene-safety-ppe':
      art += rect(552, 176, 493, 241, p.light) + line('M574 207H1021', p.mid, 8) +
        bench(553, 427, 491);
      // A vest and hard hat lead; glasses and one pair of boots remain secondary.
      art += path('M874 222L840 241L848 318L875 302V410H1003V302L1029 318L1037 241L1003 222L970 252H908Z', p.warm) +
        line('M894 246V402M985 246V402M866 343H1012', p.pale, 11) +
        hat(736, 288, 141) + rect(659, 296, 153, 12, p.pale) +
        line('M681 341H813', p.dark, 8) + rect(678, 335, 56, 39, p.cool) +
        rect(754, 335, 56, 39, p.cool) + line('M734 348H754', p.dark, 7) +
        path('M577 426v-67h33v44h25v23ZM636 426v-67h33v44h25v23Z', p.dark);
      break;
    case 'scene-safety-work-at-height':
      art += tank(699, 164, 186, 256) + line('M569 432V191H945V432M569 281H945M569 367H945M569 432L689 281L569 191M945 432L825 281L945 191', p.shade, 8) +
        rect(559, 387, 397, 12, p.light) + ladder(600, 241, 204);
      art += person(828, 386, {
        hat: true,
        s: .85
      }) + line('M813 288L847 328M841 288L813 329M810 336H852', p.dark, 6) +
        line('M830 324Q914 307 900 198', p.accent, 6) + circle(900, 198, 10, p.pale);
      break;
    case 'scene-safety-lockout':
      art += box(558, 190, 136, 251, p.light) + rect(574, 216, 103, 81, p.warm) +
        line('M628 233L599 275', p.dark, 13) + pipe('M698 365H1055', p.light, 36) +
        valve(824, 268, 68) + line('M864 313L914 327', p.dark, 11);
      // One large lock and blank hanging tag, readable through both overlays.
      art += group(923, 331, lock(0, 0), 1.65) +
        line('M953 331L995 328', p.warm, 8) + path('M989 324l29 -15l33 15v85h-62Z', p.warm) +
        circle(1019, 328, 7, p.pale) + rect(1000, 351, 40, 43, p.pale);
      break;
    case 'scene-safety-confined-space':
      art += tank(572, 234, 204, 185) + circle(682, 338, 61, p.shade) +
        circle(682, 338, 46, p.dark) + circle(752, 331, 43, p.light) + rep(6, i => {
        const a = i * Math.PI / 3;
        return circle(682 + 53 * Math.cos(a), 338 + 53 * Math.sin(a), 5, p.pale);
      });
      art += line('M785 431L879 180L971 431M879 180L881 432', p.warm, 13) +
        line('M879 200V341', p.accent, 6) + circle(879, 209, 14, p.shade) +
        line('M879 338q-20 18 0 27', p.pale, 6) + box(801, 376, 49, 65, p.dark) +
        rect(811, 387, 28, 22, p.accent) + cone(989, 438) + line('M941 381H1050M948 381v65M1042 381v65', p.accent, 7);
      break;
    case 'scene-safety-forklift':
      art += building(480, 210, 230, 180) + rep(5, i => path(`M${571 + i * 98} 428h45l-32 28h-45Z`, p.pale)) +
        group(661, 315, forklift(0, 0), 1.4) + pallet(854, 359, 116) + bags(866, 333, 3) + person(1014, 412, {
        hat: true,
        s: .75
      }) + line('M970 427H1061', p.accent, 7);
      break;
    case 'scene-safety-electrical':
      art += rep(3, i => box(568 + i * 158, 177, 143, 250, i === 1 ? p.cool : p.light) + rect(586 +
        i * 158, 198, 106, 55, i === 1 ? p.dark : p.warm) + rep(3, j => rect(594 + i * 158 + j * 31, 212, 20, 26, p.light)) +
        rect(683 + i * 158, 298, 8, 41, p.dark) + rep(4, j => line(`M${587 + i * 158} ${369 + j * 11}h73`, p.mid, 5)));
      art += path('M775 276L809 337H741Z', p.warm) + path('M772 290L763 311H777L769 328L790 305H777L784 290Z', p.pale) +
        path('M608 440H1003L1042 467H569Z', p.shade);
      break;
    case 'scene-emergency-fire-truck':
      art += rect(553, 168, 495, 278, p.mid) + rect(576, 188, 447, 256, p.shade) +
        rep(8, i => line(`M588 ${205 + i * 28}H1011`, p.light, 6));
      art += group(606, 259, truck(0, 0, {fire: true}), 1.5) + line('M555 459H1057', p.pale, 6);
      break;
    case 'scene-emergency-fire-equipment':
      art += circle(814, 275, 80, p.light) +
        circle(814, 275, 64, p.dark) + circle(814, 275, 48, p.cool) + circle(814, 275, 31, p.dark) +
        circle(814, 275, 15, p.accent) + line('M873 288V387H927', p.dark, 12) +
        rect(924, 376, 17, 37, p.dark);
      art += rect(603, 275, 62, 141, p.warm, 22) + rect(619, 252, 29, 24, p.light) +
        line('M621 252h51v66', p.dark, 9) + line('M642 266Q689 265 684 364', p.pale, 7) +
        rect(603, 312, 62, 58, p.pale) + rect(949, 205, 70, 77, p.warm) +
        rect(963, 220, 42, 42, p.pale) + circle(984, 241, 10, p.accent);
      break;
    case 'scene-emergency-muster-point':
      art += rect(887, 198, 145, 120, p.cool) + rect(892, 203, 135, 110, p.pale) +
        rect(952, 318, 13, 129, p.dark) + circle(959, 244, 13, p.dark) +
        path('M941 263h36v27h-36Z', p.dark) +
        line('M908 219l19 18m-19 -18h17m-17 0v17M1010 219l-19 18m19 -18h-17m17 0v17M908 296l19 -16M1010 296l-19 -16', p.cool, 6);
      art += line('M574 447V183', p.light, 8) + path('M579 187L694 213V238L579 222Z', p.warm) +
        path('M599 191l28 6v32l-28 -4ZM648 202l28 6v28l-28 -4Z', p.pale) +
        person(667, 444, {s: 1.08, hat: true, arms: 'talk'}) +
        person(770, 450, {s: 1.16, hat: true}) + person(867, 450, {s: .94, hat: true});
      break;
    case 'scene-emergency-safety-shower':
      art += pipe('M1004 416V215H871V179M1060 398V294H965', p.mid, 18) +
        pipe('M654 435V254Q654 237 680 237H756', p.cool, 22) + path('M724 243h65l18 28H706Z', p.dark) + path('M728 247h57l15 20h-87Z', p.pale) +
        line('M800 255v91h-25', p.accent, 5);
      art += rep(4, i => line(`M${732 + i * 16} 282v65`, p.light, 5)) +
        rect(632, 430, 70, 15, p.light) + pipe('M876 433V349', p.light, 12) +
        path('M824 335h106q-10 41 -53 41t-53 -41', p.pale) +
        line('M824 335q10 41 53 41t53 -41', p.dark, 5) + line('M853 335v-19M899 335v-19', p.light, 7) +
        path('M842 307q12 -25 23 0M887 307q12 -25 23 0', p.accent) + rect(832, 229, 94, 64, p.warm) +
        cross(879, 261, .7);
      break;
    case 'scene-emergency-first-aid':
      art += box(571, 174, 142, 213) + cross(642, 252) + line('M642 282v93', p.shade, 5) +
        rect(662, 308, 10, 28, p.dark) + rect(736, 341, 290, 48, p.light, 14) + rect(736, 341, 290, 20, p.cool, 8) +
        rect(733, 315, 80, 34, p.pale, 12) + rect(752, 389, 12, 54, p.shade) +
        rect(995, 389, 12, 54, p.shade) + rect(892, 177, 137, 114, p.warm) +
        rect(909, 192, 102, 81, p.pale) + path('M960 253L933 228Q924 208 944 208L960 218L977 208Q997 208 989 228Z', p.accent) +
        line('M958 214l-10 17h18l-11 14', p.pale, 5);
      break;
    case 'scene-emergency-spill-response':
      art += building(400, 255, 180, 160) + pallet(614, 411, 298) + rect(614, 385, 298, 28, p.warm) +
        rep(3, i => tank(628 + i * 91, 279, 78, 104) + line(`M${636 + i * 91} 315h62M${636 + i * 91} 353h62`, p.mid, 6));
      art += line('M587 352Q548 402 592 441H949Q991 428 957 382', p.pale, 16) +
        cone(1004, 434) + cone(568, 414) + box(929, 285, 74, 70, p.mid) + line('M943 300h46M943 314h46', p.light, 5);
      break;
    case 'scene-health-handwashing':
      art += rect(569, 170, 477, 139, p.light) + rect(580, 181, 455, 117, p.light) +
        line('M730 183v112M889 183v112', p.light, 6);
      art += rep(3, i => {
        const x = 578 + i * 157;
        return rect(x, 338, 145, 83, i === 1 ? p.warm : p.cool) + ellipse(x + 72, 339, 65, 22, p.pale) +
          ellipse(x + 72, 339, 43, 12, p.dark) + pipe(`M${x + 72} 325v-27q0 -14 22 -14`, p.light, 8) +
          line(`M${x + 94} 297v34`, p.accent, 5) + rect(x + 10, 256, 33, 55, p.pale) +
          rect(x + 15, 302, 23, 11, p.shade);
      });
      art += line('M573 431H1043', p.light, 6);
      break;
    case 'scene-health-break-room':
      art += window(563, 166, 200, 128) + rect(555, 335, 288, 91, p.mid) +
        rect(550, 325, 300, 16, p.light) + rect(576, 355, 75, 58, p.cool) +
        rect(669, 355, 75, 58, p.warm) + rect(771, 355, 53, 58, p.shade) +
        box(942, 285, 84, 142) + rect(955, 236, 59, 53, p.mid, 17) + rect(968, 224, 32, 12, p.light) +
        rect(953, 308, 62, 49, p.dark) + rect(977, 318, 14, 10, p.accent);
      art += desk(712, 365, 173) + chair(667, 313) + chair(893, 328) +
        rect(792, 324, 19, 31, p.pale) + plant(1037, 426);
      break;
    case 'scene-health-locker-room':
      art += rep(4, i => box(566 + i * 116, 174, 106, 235, i % 2 ? p.cool : p.light) + rep(3, j => line(`M${587 + i * 116} ${197 + j * 13}h64`, p.mid, 5)) +
        rect(644 + i * 116, 285, 9, 31, p.dark));
      art += path('M933 242l-33 18l17 44l20 -10v69h69v-69l21 10l16 -44l-33 -18l-25 15h-27Z', p.pale) +
        line('M970 258v99', p.shade, 5) + line('M942 239l31 -20l29 20', p.light, 5) +
        bench(604, 404, 289) + rect(604, 404, 289, 15, p.warm) + rect(653, 386, 89, 18, p.pale) + rect(663, 374, 69, 12, p.shade);
      break;
    case 'scene-health-health-check':
      art += rect(563, 181, 126, 152, p.pale) + rep(5, i => rect(584 +
        i * 3, 203 + i * 23, 78 - i * 8, 8, p.mid)) + desk(695, 378, 337) +
        rect(573, 432, 111, 20, p.warm) + line('M626 432V340', p.dark, 12) +
        rect(586, 308, 80, 42, p.cool) + rect(601, 319, 50, 17, p.pale);
      // Enlarged cuff, tube and monitor make this an occupational health station.
      art += ellipse(806, 337, 68, 34, p.cool) + ellipse(806, 320, 68, 34, p.cool) +
        ellipse(806, 320, 43, 19, p.dark) + line('M859 342Q888 399 944 352', p.dark, 9) +
        box(912, 268, 119, 89, p.light) + rect(912, 268, 119, 21, p.warm) + rect(926, 281, 88, 48, p.pale) +
        line('M935 309h15l10 -17l12 28l12 -17h18', p.cool, 6) + circle(986, 342, 8, p.dark);
      break;
    case 'scene-health-ergonomics':
      art += window(569, 167, 200, 127) + desk(764, 344, 261) + rect(881, 311, 126, 19, p.shade) +
        monitor(878, 216, 129, 75) + chair(676, 321) + person(745, 438, {
        s: 1,
        seated: true,
        arms: 'reach'
      }) + rect(802, 325, 53, 10, p.pale) + line('M770 445H832', p.light, 10) + plant(1035, 425);
      break;
    case 'scene-health-heat-and-hearing':
      art += circle(1002, 194, 31, p.warm) + rep(8, i => {
        const a = i * Math.PI / 4;
        return line(`M${1002 + 43 * Math.cos(a)} ${194 + 43 * Math.sin(a)}l${12 * Math.cos(a)} ${12 * Math.sin(a)}`, p.warm, 5);
      });
      art += path('M548 232L620 169H872L923 232Z', p.light) +
        rect(574, 232, 12, 213, p.mid) + rect(905, 232, 12, 213, p.mid) +
        bench(622, 400, 280) + box(953, 315, 81, 126, p.cool) +
        rect(962, 251, 62, 65, p.warm, 18) + rect(976, 239, 33, 12, p.pale) +
        rect(968, 332, 50, 44, p.dark) + rect(981, 341, 20, 12, p.warm);
      art += line('M663 341v-46a48 48 0 0 1 96 0v46', p.dark, 15) +
        rect(650, 323, 29, 63, p.warm, 12) + rect(744, 323, 29, 63, p.warm, 12) +
        path('M796 341Q839 307 881 341L864 390H812Z', p.pale) + circle(838, 358, 22, p.cool) +
        line('M796 341q-24 -30 -23 15M881 341q24 -30 23 15', p.dark, 6);
      break;
    case 'scene-environment-wetland':
      art += group(270, 266, skyline(0, 0), .65) +
        path('M546 416Q654 344 805 394T1060 361V455H546Z', p.mid) +
        path('M615 440Q714 371 829 413T1059 397V455H615Z', p.light);
      art += rep(6, i => {
        const x = 574 + i * 32, y = 438 - i % 3 * 9;
        return line(`M${x} ${y}v-102m0 57l-19 -30m19 15l19 -34`, p.cool, 7) +
          rect(x - 6, y - 119, 12, 40, p.warm);
      });
      art += ellipse(872, 335, 55, 27, p.pale) + ellipse(860, 331, 37, 17, p.cool) + path('M826 326l-42 -10l34 40Z', p.pale) +
        line('M909 329L922 264Q926 245 942 249L958 252', p.dark, 18) +
        line('M909 329L922 264Q926 245 942 249L958 252', p.pale, 11) +
        path('M953 246l38 11l-38 3Z', p.warm) + line('M857 360v66M883 360v60', p.dark, 7) +
        line('M799 241q24 -26 48 0q24 -26 48 0', p.dark, 7);
      break;
    case 'scene-environment-water-treatment':
      art += building(552, 194, 161, 100) + pipe('M612 331V302H1001V359', p.warm, 14);
      art += rep(2, i => {
        const x = 718 + i * 196, y = 342 + i * 44;
        return rect(x - 133, y, 266, 30, p.shade, 0) + ellipse(x, y + 30, 133, 55, p.shade) +
          ellipse(x, y, 133, 55, p.pale) + ellipse(x, y, 105, 34, p.cool) +
          line(`M${x - 123} ${y}h246`, p.pale, 12) +
          line(`M${x - 123} ${y - 24}h246M${x - 123} ${y - 24}v24M${x + 123} ${y - 24}v24M${x} ${y - 24}v24`, p.dark, 5) +
          circle(x, y, 17, p.warm);
      });
      break;
    case 'scene-environment-air-monitoring':
      art += skyline(190, 265) + box(583, 293, 186, 140, p.light) + rect(583, 293, 186, 26, p.cool) + path('M571 293l106 -34l104 34Z', p.pale) +
        rect(610, 322, 73, 77, p.warm) + rect(701, 327, 38, 27, p.dark) + line('M625 292v-60M716 288v-44', p.light, 9) +
        rep(4, i => rect(609, 228 + i * 10, 32, 6, p.pale));
      art += line('M876 431V250M876 270H966M876 303H819', p.dark, 10) +
        line('M876 311L825 429M876 311L934 429', p.dark, 6) + circle(876, 250, 10, p.accent) +
        circle(831, 250, 20, p.cool) + circle(915, 250, 20, p.warm) + line('M839 250H907', p.light, 6) +
        path('M951 257h36l-18 24Z', p.accent) + box(849, 296, 53, 64, p.cool) + gauge(876, 322, 17);
      break;
    case 'scene-environment-solar':
      art += rect(882, 236, 160, 97, p.warm) + rep(4, i => line(`M${902 + i * 37} 258v59`, p.light, 8) +
        rep(3, j => rect(891 + i * 37, 253 + j * 16, 22, 6, p.shade))) + line('M889 327H1040', p.light, 8);
      art += rep(2, i => rep(3, j => {
        const x = 562 + j * 153 + i * 27,
          y = 320 + i * 74;
        return line(`M${x + 30} ${y + 38}v35M${x + 119} ${y + 38}v35`, p.shade, 6) +
          path(`M${x + 15} ${y - 17}h133l-22 62H${x - 7}Z`, p.light) + path(`M${x + 22} ${y - 10}h116l-17 48H${x + 5}Z`, p.dark) + path(`M${x + 22} ${y - 10}h116l-7 19H${x + 15}Z`, p.cool) +
          line(`M${x + 18} ${y + 6}h116M${x + 12} ${y + 22}h116M${x + 60} ${y - 8}l-17 46M${x + 100} ${y - 8}l-17 46`, p.shade, 5);
      }));
      art += rect(1014, 370, 37, 58, p.shade) + circle(1032, 385, 6, p.accent);
      break;
    case 'scene-environment-recycling':
      art += box(889, 221, 155, 189, p.shade) + rect(907, 241, 119, 93, p.dark) +
        rect(916, 256, 101, 20, p.light) + rect(916, 285, 101, 36, p.mid) +
        boxes(916, 355, 30, 3) + rect(999, 337, 20, 10, p.accent);
      art += rep(3, i => {
        const x = 565 + i * 103;
        return box(x, 288, 88, 135, i === 1 ? p.warm : p.cool) + rect(x - 5, 277, 98, 15, p.pale) +
          rect(x + 18, 300, 52, 12, p.dark) + wheel(x + 20, 427, 10) + wheel(x +
          69, 427, 10) + line(`M${x + 30} 365l12 -10l13 10m-13 -10v26m-16 13l-5 -14l15 2m-15 -2l23 13m18 -9l-6 14l-10 -10m10 10v-27`, p.pale, 5);
      });
      break;
    case 'scene-environment-green-belt':
      art += rep(12, i => line(`M${553 + i * 45} 313v112`, p.mid, 5)) +
        line('M550 326H1060M550 368H1060', p.mid, 6) + skyline(190, 255) + tree(600, 425, .85) +
        tree(741, 425, 1.1) + tree(1002, 425, 1.05);
      art += ellipse(877, 428, 48, 13, p.shade) + tree(874, 426, .75) + person(814, 436, {
        hat: true,
        s: .8,
        arms: 'reach'
      }) + line('M934 339l-23 86', p.pale, 7) + path('M900 407l28 7l-5 30q-27 12 -30 -7Z', p.light) +
        rect(931, 337, 20, 8, p.accent);
      break;
    case 'scene-lab-bench':
      art += box(822, 167, 226, 194, p.cool) + rect(841, 193, 187, 139, p.dark) +
        rect(852, 201, 165, 23, p.light) + line('M852 241H1017', p.mid, 7) +
        desk(565, 359, 482) + box(588, 377, 125, 63) + box(899, 377, 125, 63);
      art += rep(3, i => {
        const x = 610 + i * 76;
        return path(`M${x} 289h24v30l23 34h-70l23 -34Z`, p.pale) + path(`M${x - 9} 334h42l12 17h-66Z`, i === 1 ? p.warm : p.cool) +
          rect(x - 4, 284, 32, 7, p.light);
      });
      art += rect(886, 281, 45, 71, p.pale) + rect(891, 308, 35, 38, p.warm) +
        rect(962, 298, 35, 54, p.light) + line('M967 314h17M967 331h17', p.shade, 5);
      break;
    case 'scene-lab-microscope':
      art += window(568, 169, 190, 119) + desk(566, 375, 481) + path('M713 356h142l25 18H688Z', p.light) +
        path('M815 353Q916 302 818 250l-26 28q67 35 18 57Z', p.cool) + line('M773 276l42 -42', p.cool, 29) +
        line('M799 243l33 23', p.dark, 13) + rect(751, 300, 105, 13, p.pale) +
        rect(764, 313, 12, 42, p.mid) + circle(831, 317, 17, p.accent) + ellipse(777, 332, 23, 9, p.pale);
      art += box(918, 345, 107, 20, p.mid) + rep(4, i => rect(927 + i * 24, 302, 16, 43, p.pale, 5) +
        rect(927 + i * 24, 298, 16, 8, p.shade)) + rect(589, 343, 111, 16, p.shade) +
        rep(3, i => rect(599 + i * 31, 326, 22, 16, p.light));
      break;
    case 'scene-lab-inspection':
      art += desk(560, 391, 479) + box(937, 327, 101, 57, p.light) +
        ellipse(985, 322, 58, 13, p.cool) + rect(955, 345, 65, 25, p.dark);
      art += path('M570 330h160l-24 52H551Z', p.mid) + rep(15, i =>
        ellipse(579 + i % 5 * 27, 340 + Math.floor(i / 5) * 13, 9, 5, p.pale));
      art += line('M732 321H930M764 283v94h38M908 283v94h-38', p.dark, 14) +
        line('M732 321H930', p.light, 8) + rect(877, 304, 52, 37, p.cool) +
        rect(884, 309, 37, 20, p.pale) + line('M821 283h104', p.warm, 9);
      break;
    case 'scene-lab-testing-machine':
      art += box(619, 400, 260, 37, p.shade) + rect(645, 181, 20, 220, p.cool) +
        rect(837, 181, 20, 220, p.cool) + rect(631, 176, 239, 28, p.pale) +
        rect(657, 250, 190, 22, p.warm) + rect(657, 348, 190, 22, p.shade) +
        rect(737, 272, 30, 23, p.dark) + rect(737, 326, 30, 22, p.dark) + path('M743 294h18l-5 11v10l5 11h-18l5 -11v-10Z', p.accent) +
        line('M912 428V287', p.shade, 12) + screen(886, 233, 150, 94) + rect(908, 343, 104, 61, p.light) +
        rep(3, i => circle(931 + i * 28, 367, 7, p.dark));
      break;
    case 'scene-lab-documents':
      art += shelf(566, 170, 205, 250, 'books') + shelf(818, 170, 211, 250, 'books') +
        desk(693, 378, 331) + group(726, 239, clipboard(0, 0, 126, 139)) + rep(3, i => tick(741, 273 +
        i * 28, .65));
      art += rect(926, 354, 66, 17, p.dark) + path('M938 354v-17q-11 -8 -11 -21a22 22 0 0 1 44 0q0 13 -11 21v17Z', p.shade) +
        rect(924, 369, 72, 9, p.accent);
      break;
    case 'scene-lab-control-chart':
      art += screen(567, 166, 216, 135) + screen(800, 166, 238, 135) +
        line('M816 230H1020M816 260H1020', p.shade, 5) + desk(605, 371, 376) +
        chair(571, 333) + chair(983, 333) + rect(716, 340, 102, 20, p.pale) +
        line('M731 347h65', p.mid, 5) + rect(846, 338, 54, 25, p.shade) + plant(1040, 431);
      break;
    case 'scene-office-open-office':
      art += window(574, 167, 188, 132) + window(810, 167, 213, 132) +
        desk(563, 354, 205) + monitor(608, 261, 118, 74) + desk(831, 382, 195) +
        monitor(864, 283, 129, 75) + chair(569, 342) + chair(819, 365) + plant(795, 432) +
        rect(681, 337, 53, 8, p.pale);
      break;
    case 'scene-office-meeting-room':
      art += screen(690, 164, 253, 143) + rect(568, 173, 72, 124, p.mid) +
        plant(1028, 422) + rep(3, i => chair(629 + i * 117, 310));
      art += path('M642 344H963L1012 398H594Z', p.pale) + rect(594, 398, 418, 13, p.light) +
        line('M628 411v39M979 411v39', p.shade, 9) + chair(660, 366) + chair(824, 366) +
        rect(762, 360, 80, 17, p.shade) + rect(901, 360, 15, 23, p.light);
      break;
    case 'scene-office-reception':
      art += window(571, 168, 212, 169) + rect(826, 198, 176, 76, p.mid) +
        line('M848 221h131M848 247h79', p.shade, 8) + box(726, 303, 291, 130, p.light) + rect(726, 303, 271, 71, p.cool) + rect(726, 374, 271, 16, p.warm) +
        path('M713 303l32 -21h276v21Z', p.pale) + monitor(848, 242, 95, 61, 'blank') +
        rect(562, 363, 157, 54, p.shade, 12) + rect(550, 345, 28, 74, p.light) +
        rect(703, 345, 28, 74, p.light) + rect(576, 415, 10, 20, p.light) +
        rect(691, 415, 10, 20, p.light) + plant(1035, 429);
      break;
    case 'scene-office-desk-window':
      art += rect(579, 154, 465, 183, p.mid) + rect(589, 164, 445, 161, p.pale) +
        group(601, 173, rect(0, 122, 418, 30, p.far) + rect(21, 75, 42, 77, p.cool) +
        rect(119, 38, 24, 114, p.cool) + rect(180, 64, 35, 88, p.warm) + rect(278, 20, 12, 132, p.mid) +
        tank(318, 111, 86, 33) +
        line('M110 78h45M110 58v20M155 58v20M170 103h55M170 83v20M225 83v20', p.dark, 5) +
        line('M258 144L284 22L310 144', p.mid, 5) + rect(116, 77, 30, 22, p.cool)) +
        line('M806 164v161', p.light, 8);
      art += desk(637, 368, 346) + monitor(755, 267, 144, 85) + chair(619, 337) +
        plant(1019, 431) + rect(924, 330, 22, 28, p.pale);
      break;
    case 'scene-office-archive':
      art += rep(2, i => rep(3, j => box(571 + i * 122, 178 + j * 78, 110, 70, i ? p.cool : p.light) +
        rect(599 + i * 122, 198 + j * 78, 54, 20, p.pale) + rect(609 + i * 122, 204 +
        j * 78, 34, 7, p.mid)));
      art += shelf(846, 170, 198, 221) + desk(846, 370, 192) + rect(879, 286, 133, 77, p.light) +
        rect(894, 270, 101, 34, p.pale) + rect(889, 312, 110, 25, p.dark) +
        path('M908 326h76l18 31h-112Z', p.pale) + rect(981, 294, 13, 9, p.accent) +
        pallet(832, 425, 98) + boxes(839, 386, 39, 2);
      break;
    case 'scene-office-video-call':
      art += desk(559, 399, 475) + laptop(676, 201, 314) + rep(2, i => rep(3, j => {
        const x = 691 + j * 96, y = 214 + i * 40;
        return rect(x, y, 87, 35, (i + j) % 2 ? p.warm : p.dark) + circle(x + 44, y + 10, 8, p.pale) +
          path(`M${x + 26} ${y + 33}q0 -21 18 -21t18 21Z`, p.light);
      }));
      art += line('M591 362v-39a31 31 0 0 1 62 0v39', p.dark, 11) +
        rect(580, 344, 22, 40, p.cool) + rect(641, 344, 22, 40, p.cool) +
        line('M652 378q0 12 -29 12', p.dark, 6) +
        rect(951, 349, 45, 47, p.warm) + line('M996 357h18v24h-18', p.warm, 7) +
        ellipse(974, 349, 22, 7, p.dark);
      break;
    case 'scene-people-interview':
      art += window(604, 170, 218, 135) + plant(1028, 426) + chair(565, 326) + chair(956, 326) + person(652, 441, {
        seated: true,
        arms: 'talk',
        s: 1
      }) + `<g transform="translate(1904 0) scale(-1 1)">${person(950, 441, {
        seated: true,
        arms: 'talk',
        s: 1
      })}</g>`;
      art += desk(728, 361, 165) + rect(768, 335, 69, 13, p.pale);
      break;
    case 'scene-people-onboarding':
      art += desk(558, 397, 476) + box(565, 307, 132, 90, p.light) + rect(565, 307, 132, 22, p.cool) +
        path('M565 307l24 -24h118l-10 24Z', p.pale) + line('M620 307v80', p.pale, 11) + hat(979, 346, 95);
      art += line('M757 182Q698 235 806 296Q914 235 855 182', p.warm, 10) +
        rect(750, 286, 115, 125, p.pale) + rect(792, 277, 30, 20, p.dark) +
        circle(807, 323, 20, p.cool) + path('M777 370v-10q30 -38 60 0v10Z', p.cool) +
        rect(773, 382, 68, 10, p.mid);
      break;
    case 'scene-people-team':
      art += skyline(200, 260) + building(800, 285, 230, 133) + person(611, 419, {
        hat: true,
        s: .95,
        arms: 'talk'
      }) + person(987, 420, {
        hat: true,
        s: .95,
        arms: 'reach'
      }) + person(713, 431, {
        hat: true,
        s: 1.12,
        arms: 'talk'
      }) + person(913, 433, {
        hat: true,
        s: 1.12,
        arms: 'talk'
      }) + person(814, 450, {
        hat: true,
        s: 1.22,
        arms: 'reach'
      });
      break;
    case 'scene-people-handshake':
      art += window(581, 170, 232, 142) + plant(1017, 425) + person(725, 441, {
        s: 1.3,
        arms: 'none'
      }) + person(901, 441, {
        s: 1.3,
        arms: 'none'
      }) + line('M696 296L681 351M931 296L947 351', p.warm, 18) + line('M755 296L787 333L815 322M872 296L841 333L815 322', p.warm, 18) +
        circle(815, 322, 11, p.pale) + bench(573, 404, 92);
      break;
    case 'scene-people-career-path':
      art += path('M554 443v-44h130v-47h130v-47h130v-47h102v185Z', p.light) +
        path('M554 443v-13h130v-47h130v-47h130v-47h102v154Z', p.shade) +
        rect(684, 383, 130, 47, p.cool, 0) + rect(814, 336, 130, 47, p.warm, 0) +
        line('M569 400h102M699 353h102M829 306h102M959 259h74', p.pale, 5);
      art += person(701, 398, {s: 1, arms: 'talk', climb: true}) +
        line('M995 258V241', p.dark, 8) + circle(995, 241, 16, p.cool) +
        circle(995, 241, 7, p.pale); // Destination marker, never a flag.
      break;
    case 'scene-people-recognition':
      art += rect(559, 188, 159, 178, p.warm) + rect(570, 199, 137, 156, p.pale) +
        line('M588 225h100M588 246h100M606 269h64', p.mid, 7) +
        circle(639, 318, 20, p.cool) + bench(556, 423, 490);
      art += path('M787 220h140v74q0 68 -70 68t-70 -68Z', p.light) + rect(787, 245, 140, 52, p.warm, 0) +
        path('M884 220h43v74q0 63 -43 68Z', p.light) +
        line('M787 239h-39v41q0 51 65 51M927 239h39v41q0 51 -65 51', p.warm, 13) +
        rect(844, 359, 26, 42, p.warm) + rect(805, 401, 104, 20, p.dark) +
        path('M972 319h19l19 39l19 -39h19l-27 67h-22Z', p.cool) +
        circle(1010, 388, 25, p.warm) + circle(1010, 388, 14, p.pale);
      break;
    case 'scene-tech-laptop-shield':
      art += window(571, 174, 172, 123) + desk(566, 384, 473) + laptop(695, 221, 257) +
        path('M823 237l47 15v29q-4 35 -47 53q-43 -18 -47 -53v-29Z', p.mid) +
        group(823, 268, lock(0, 0), .8) + plant(1013, 430) + rect(599, 351, 54, 23, p.shade);
      break;
    case 'scene-tech-server-room':
      art += line('M557 174H1049M576 174v-19h455v19', p.shade, 12) + rep(3, i => {
        const x = 567 + i * 162;
        return box(x, 196, 145, 237, p.light) + rep(6, j => rect(x +
          13, 211 + j * 33, 113, 25, j % 2 === 0 ? p.cool : p.dark) + rect(x + 24, 219 + j * 33, 65, 8, j % 2 ? p.warm : p.pale) +
          circle(x + 108, 223 + j * 33, 5, j % 3 === 0 ? p.warm : p.pale));
      });
      art += line('M594 440H1024', p.light, 6);
      break;
    case 'scene-tech-phishing':
      art += desk(568, 399, 466) + laptop(724, 315, 268) +
        line('M965 168v63q0 44 -38 44q-28 0 -28 -27v-16', p.warm, 13) +
        path('M886 241l13 -27l13 27Z', p.warm);
      art += rect(677, 215, 222, 137, p.light) + rect(677, 287, 222, 45, p.cool) + path('M677 215l111 79l111 -79Z', p.pale) +
        line('M677 352l81 -66M899 352l-81 -66', p.light, 7) +
        rect(765, 371, 181, 42, p.dark);
      break;
    case 'scene-tech-badge-access':
      art += rect(590, 165, 212, 282, p.shade) + rect(604, 178, 184, 269, p.mid) +
        rect(625, 199, 141, 111, p.cool) + rect(755, 329, 10, 38, p.pale) +
        rect(821, 273, 51, 75, p.dark) + rect(830, 281, 33, 28, p.accent) +
        person(948, 442, {
        s: 1.25,
        arms: 'none'
      }) + line('M977 303L996 353', p.warm, 17) + line('M920 303L882 323L856 310', p.warm, 17) +
        rect(837, 296, 33, 43, p.pale) + rect(844, 305, 18, 12, p.shade);
      break;
    case 'scene-tech-dashboard':
      art += rep(2, i => rep(3, j => screen(567 + j * 159, 166 + i * 94, 146, 82))) +
        desk(625, 378, 365) + monitor(739, 300, 146, 76, 'blank') + rect(753, 314, 118, 48, p.mid) +
        chart(756, 312, 110, 49) + chair(640, 349) + plant(1031, 430);
      break;
    case 'scene-tech-phone-approval':
      art += window(574, 166, 184, 118) + desk(568, 385, 470) + laptop(583, 270, 230) +
        group(698, 302, lock(0, 0), .9) + rect(878, 177, 136, 211, p.warm, 16) +
        rect(888, 188, 116, 181, p.pale, 8) + rect(888, 328, 116, 41, p.cool, 0) + rect(920, 191, 50, 9, p.shade) +
        circle(946, 379, 6, p.shade) + tick(917, 274, 1.45) + rect(844, 368, 16, 17, p.shade);
      break;
    case 'scene-learning-classroom':
      // A broad teaching wall, coloured seats in perspective and a full-height
      // presenter make the default cover read immediately as a place for learning.
      art += rect(570, 163, 484, 211, p.light) + screen(703, 177, 264, 156, 'blank') +
        line('M726 303V201M726 303H945', p.dark, 5) +
        rect(747, 259, 36, 44, p.cool) + rect(802, 233, 36, 70, p.warm) +
        rect(857, 211, 36, 92, p.cool) +
        path('M552 384L610 352H1056V384Z', p.mid) + rect(552, 384, 504, 18, p.light) +
        person(1011, 380, {s: .85, arms: 'none'}) +
        line('M991 282L963 300L938 278M1031 282L1041 323', p.warm, 13) +
        line('M938 278L916 248', p.dark, 5);
      art += rep(2, i => rep(3, j => {
        const x = 594 + j * 121 + i * 20, y = 335 + i * 68;
        return circle(x + 28, y - 13, 19, p.pale) +
          path(`M${x + 9} ${y - 17}a19 19 0 0 1 38 0Z`, p.dark) +
          rect(x, y + 7, 57, 46, j % 2 ? p.cool : p.warm, 10) +
          rect(x - 6, y + 29, 70, 35, i ? p.cool : p.dark, 8) +
          line(`M${x + 5} ${y + 64}v15M${x + 53} ${y + 64}v15`, p.light, 6);
      }));
      break;
    case 'scene-learning-e-learning':
      art += window(570, 170, 199, 129) + desk(756, 356, 269) + monitor(864, 233, 147, 101, 'play') +
        person(706, 443, {
        seated: true,
        arms: 'reach',
        s: 1.1
      }) + chair(649, 338) + rect(810, 335, 44, 10, p.pale) + plant(1034, 432);
      break;
    case 'scene-learning-hands-on':
      art += rect(718, 184, 197, 223, p.light) + rect(718, 184, 197, 61, p.cool) + pipe('M744 380V307H884V379', p.light, 15) +
        valve(813, 282, 27) + gauge(751, 259, 23) + gauge(876, 259, 23) + rect(712, 403, 211, 15, p.shade) +
        person(617, 438, {
        hat: true,
        s: 1.08,
        arms: 'reach'
      }) + person(999, 438, {
        hat: true,
        s: 1.08,
        arms: 'none'
      }) + line('M974 314L940 288M1025 314L1040 363', p.light, 14) + rect(770, 351, 92, 42, p.shade);
      break;
    case 'scene-learning-library':
      art += shelf(568, 166, 204, 253, 'books') + shelf(835, 166, 204, 253, 'books') +
        desk(668, 373, 286) + bench(600, 405, 86) + path('M715 344q31 -18 62 0q31 -18 62 0v23q-31 -14 -62 0q-31 -14 -62 0Z', p.pale) +
        line('M777 345v18', p.mid, 5) + rect(866, 336, 24, 38, p.light, 12) +
        ellipse(878, 336, 12, 7, p.pale) + rect(863, 350, 30, 9, p.accent);
      break;
    case 'scene-learning-assessment':
      art += circle(947, 280, 54, p.light) + circle(947, 280, 44, p.pale) +
        line('M947 249v31l23 14', p.dark, 7) + rep(4, i => {
        const a = i * Math.PI / 2;
        return circle(947 + 35 * Math.cos(a), 280 + 35 * Math.sin(a), 4, p.shade);
      });
      art += desk(571, 393, 473) + clipboard(642, 211, 157, 177) + rep(3, i => tick(659, 243 +
        i * 30, .7)) + line('M844 371l38 -120', p.accent, 18) + path('M836 393l4 -26l11 4Z', p.pale) +
        rect(923, 355, 62, 23, p.shade) + chair(589, 367);
      break;
    case 'scene-learning-mentoring':
      art += skyline(270, 260) + tank(916, 289, 132, 124) + column(1001, 192, 174, 33) + person(691, 441, {
        hat: true,
        s: 1.28,
        arms: 'reach'
      }) + person(875, 441, {
        hat: true,
        s: 1.28,
        arms: 'none'
      }) + line('M906 298L922 353', p.warm, 17) + line('M840 300L798 339L772 325', p.warm, 17) +
        path('M747 298h87l-8 61h-87Z', p.dark) + path('M755 307h69l-5 42h-69Z', p.pale) +
        line('M766 324h42M764 338h28', p.accent, 5);
      break;
    default:
      throw new Error(`No drawing for ${id}`);
  }
  // Essential artwork ends above the caption. Foreground marks can be cropped.
  return backdrop + `<g data-layer="subject" transform="translate(0 -95) scale(1 1.1)">${art}</g>` +
    `<g data-layer="foreground">${foreground(kind, id)}</g>`;
}
