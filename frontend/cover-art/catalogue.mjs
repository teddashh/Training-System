import fs from 'node:fs';
// English strings are stable translation keys. Keywords intentionally cover three languages.
// Add scenes here in picker order, then add a recipe with the same theme/name in scenes.mjs.
const themes = [
  [
    "plant", "Plant operations", "廠區運作", "Operaciones industriales",
    [
      ["skyline","Plant skyline","石化廠景","Panorama industrial","petrochemical,plant,石化,廠區,petroquímica,planta"],
      ["tank-farm","Tank farm","儲槽區","Parque de tanques","tank,storage,儲槽,儲存,tanque,almacenamiento"],
      ["pipe-rack","Pipe rack","管架走廊","Rack de tuberías","pipe,piping,管線,管架,tubería"],
      ["process-unit","Process unit","製程設備","Unidad de proceso","distillation,process,蒸餾,製程,destilación,proceso"],
      ["cooling-towers","Cooling towers","冷卻水塔","Torres de enfriamiento","cooling,冷卻,enfriamiento"],
      ["control-room","Control room","控制室","Sala de control","control room,operator,控制室,操作員,sala de control,operador"],
    ],
  ],
  [
    "site", "Site logistics", "廠務物流", "Logística industrial",
    [
      ["gatehouse","Site entrance","廠區入口","Entrada de planta","gate,entrance,門禁,入口,entrada,portería"],
      ["warehouse","Warehouse aisle","倉庫走道","Pasillo de almacén","warehouse,倉儲,倉庫,almacén"],
      ["loading-dock","Loading dock","裝卸月台","Muelle de carga","loading,freight,裝卸,貨運,muelle de carga,flete"],
      ["rail-yard","Rail yard","鐵路貨場","Patio ferroviario","rail,hopper,鐵路,鐵道,ferrocarril,tolva"],
      ["marine-terminal","Marine terminal","港口碼頭","Terminal marítima","marine,ship,港口,船舶,marítima,buque"],
      ["workshop","Maintenance workshop","維修工坊","Taller de mantenimiento","maintenance,workshop,維修,保養,mantenimiento,taller"],
    ],
  ],
  [
    "safety", "Workplace safety", "職場安全", "Seguridad laboral",
    [
      ["ppe","Protective equipment","防護裝備","Equipo de protección","ppe,protective,防護,護具,protección"],
      ["work-at-height","Work at height","高處作業","Trabajo en altura","height,scaffold,高處,鷹架,altura,andamio"],
      ["lockout","Energy isolation","能源隔離","Aislamiento de energía","lockout,isolation,上鎖,隔離,bloqueo,aislamiento"],
      ["confined-space","Confined space","局限空間","Espacio confinado","confined,局限,侷限,confinado"],
      ["forklift","Forklift crossing","堆高機通道","Cruce de montacargas","forklift,pallet,堆高機,棧板,montacargas,palé"],
      ["electrical","Electrical room","電氣室","Sala eléctrica","electrical,switchgear,電氣,配電,eléctrica,eléctrico"],
    ],
  ],
  [
    "emergency", "Emergency response", "緊急應變", "Respuesta a emergencias",
    [
      ["fire-truck","Fire engine","消防車輛","Camión de bomberos","fire truck,fire engine,消防車,bomberos"],
      ["fire-equipment","Fire equipment","消防設備","Equipo contra incendios","fire,extinguisher,消防,滅火,incendio,extintor"],
      ["muster-point","Assembly point","集合地點","Punto de reunión","muster,evacuation,集合,疏散,evacuación"],
      ["safety-shower","Safety shower","緊急沖淋","Ducha de seguridad","shower,eyewash,沖淋,洗眼,ducha,lavaojos"],
      ["first-aid","First aid","急救照護","Primeros auxilios","first aid,defibrillator,急救,去顫,auxilios,desfibrilador"],
      ["spill-response","Spill response","洩漏應變","Respuesta a derrames","spill,containment,洩漏,圍堵,derrame,contención"],
    ],
  ],
  [
    "health", "Health and hygiene", "健康衛生", "Salud e higiene",
    [
      ["handwashing","Hand washing","清潔雙手","Lavado de manos","handwash,hygiene,洗手,衛生,manos,higiene"],
      ["break-room","Break room","員工休息室","Sala de descanso","break,canteen,休息,餐廳,descanso,comedor"],
      ["locker-room","Locker room","員工更衣室","Vestuario del personal","locker,clothes,更衣,工作服,vestuario,ropa"],
      ["health-check","Health check","職業健檢","Revisión médica","health,medical,健檢,健康,salud,médica"],
      ["ergonomics","Ergonomic workstation","人體工學","Puesto ergonómico","ergonomic,人體工學,ergonomía,ergonómico"],
      ["heat-and-hearing","Heat and hearing","防暑與聽力","Calor y audición","heat,hearing,respirator,防暑,聽力,呼吸,calor,audición,respirador"],
    ],
  ],
  [
    "environment", "Environmental care", "環境保護", "Cuidado ambiental",
    [
      ["wetland","Coastal wetland","海岸濕地","Humedal costero","wetland,biodiversity,濕地,生態,humedal,biodiversidad"],
      ["water-treatment","Water treatment","水處理設施","Tratamiento de agua","water treatment,wastewater,水處理,廢水,agua,residual"],
      ["air-monitoring","Air monitoring","空氣監測","Monitoreo del aire","air,emission,空氣,排放,aire,emisión"],
      ["solar","Solar field","太陽能場","Campo solar","solar,energy,太陽能,能源,energía"],
      ["recycling","Recycling yard","資源回收","Patio de reciclaje","recycling,waste,回收,廢棄,reciclaje,residuos"],
      ["green-belt","Green belt","廠區綠帶","Cinturón verde","tree,planting,植樹,綠帶,árbol,reforestación"],
    ],
  ],
  [
    "lab", "Laboratory quality", "實驗室品管", "Calidad del laboratorio",
    [
      ["bench","Laboratory bench","實驗工作台","Mesa de laboratorio","laboratory,chemical,實驗,化學,laboratorio,química"],
      ["microscope","Sample microscopy","樣本顯微觀察","Microscopía de muestras","microscope,sample,顯微鏡,樣本,microscopio,muestra"],
      ["inspection","Quality inspection","品質檢驗","Inspección de calidad","inspection,pellet,檢驗,粒料,inspección,gránulo"],
      ["testing-machine","Tensile testing","拉伸測試","Ensayo de tracción","tensile,testing,拉伸,測試,tracción,ensayo"],
      ["documents","Quality records","品質文件","Registros de calidad","document,record,文件,紀錄,documento,registro"],
      ["control-chart","Quality review","品質審查","Revisión de calidad","quality,chart,品質,管制圖,calidad,gráfico"],
    ],
  ],
  [
    "office", "Office spaces", "辦公空間", "Espacios de oficina",
    [
      ["open-office","Open office","開放辦公室","Oficina abierta","office,辦公,oficina"],
      ["meeting-room","Meeting room","會議空間","Sala de reuniones","meeting,會議,reunión,reuniones"],
      ["reception","Reception lobby","接待大廳","Vestíbulo de recepción","reception,visitor,接待,訪客,recepción,visitante"],
      ["desk-window","Window desk","窗邊工作桌","Escritorio junto ventana","desk,工作桌,escritorio"],
      ["archive","Records room","檔案室","Sala de archivos","archive,filing,檔案,歸檔,archivo"],
      ["video-call","Video call","視訊通話","Videollamada de equipo","video,teams,視訊,videollamada"],
    ],
  ],
  [
    "people", "People and HR", "人員與人資", "Personas y RRHH",
    [
      ["interview","Job interview","工作面試","Entrevista laboral","interview,面試,entrevista"],
      ["onboarding","Welcome desk","新人報到","Mesa de bienvenida","onboarding,new hire,新人,報到,incorporación,bienvenida"],
      ["team","Site team","廠區團隊","Equipo de planta","team,crew,團隊,班組,equipo"],
      ["handshake","Working together","攜手合作","Trabajo conjunto","respect,cooperation,尊重,合作,respeto,colaboración"],
      ["career-path","Career steps","職涯階梯","Pasos profesionales","career,development,職涯,發展,carrera,desarrollo"],
      ["recognition","Staff recognition","員工表揚","Reconocimiento del personal","recognition,award,表揚,獎勵,reconocimiento,premio"],
    ],
  ],
  [
    "tech", "Technology security", "資訊安全", "Seguridad tecnológica",
    [
      ["laptop-shield","Secure laptop","安全筆電","Portátil seguro","security,cyber,資安,資訊安全,ciberseguridad"],
      ["server-room","Server room","伺服器機房","Sala de servidores","server,network,伺服器,網路,servidor,redes"],
      ["phishing","Phishing awareness","網路釣魚","Prevención del phishing","phishing,釣魚,suplantación"],
      ["badge-access","Badge access","識別證門禁","Acceso con credencial","badge,access,識別證,存取,credencial,acceso"],
      ["dashboard","Operations dashboard","營運儀表板","Panel de operaciones","dashboard,data,儀表板,數據,panel,datos"],
      ["phone-approval","Mobile approval","行動核准","Aprobación móvil","approval,authentication,核准,驗證,aprobación,autenticación"],
    ],
  ],
  [
    "learning", "Learning spaces", "學習空間", "Espacios de aprendizaje",
    [
      ["classroom","Training classroom","教育訓練室","Aula de formación","classroom,training,教室,訓練,aula,formación"],
      ["e-learning","Online learning","線上學習","Aprendizaje en línea","e-learning,online,線上,數位學習,en línea"],
      ["hands-on","Practical training","實作訓練","Formación práctica","hands-on,practical,實作,操作訓練,práctica"],
      ["library","Reading room","閱讀空間","Sala de lectura","library,reading,圖書,閱讀,biblioteca,lectura"],
      ["assessment","Learning assessment","學習評量","Evaluación del aprendizaje","assessment,exam,評量,考試,evaluación,examen"],
      ["mentoring","Site mentoring","現場指導","Mentoría en planta","mentor,coaching,指導,輔導,mentoría,tutoría"],
    ],
  ],
];
export const scenes = themes.flatMap(([theme, category,,, rows]) => rows.map(([name, title,,, keywords]) => ({
  id: `scene-${theme}-${name}`,
  title,
  category,
  keywords: keywords.split(',')
})));
export const translations = Object.fromEntries(themes.flatMap(([, en, zh, es, rows]) => [[en, {
  'en': en,
  'zh-TW': zh,
  es
}], ...rows.map(([, en, zh, es]) => [en, {
  'en': en,
  'zh-TW': zh,
  es
}])]));
export function legacyCatalogue() {
  const styles = ['Orbit', 'Layers', 'Ripples', 'Grid', 'Ribbons', 'Horizon', 'Facets', 'Petals', 'Contours', 'Mosaic'];
  return fs.readFileSync(new URL('../../shared/brand/cover-topics.txt', import.meta.url), 'utf8').trim().split('\n').flatMap((line, g) => line.split('|').slice(1).map((item, n) => ({
    id: item.split(':')[0].toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    title: `${styles[g]} ${String(n + 1).padStart(2, '0')}`,
    category: 'Patterns'
  })));
}
export function writeCatalogue() {
  fs.writeFileSync(new URL('../../shared/brand/covers.json', import.meta.url), JSON.stringify([...scenes, ...legacyCatalogue()], null, 2) +
    '\n');
}
