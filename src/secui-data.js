// SECUI BLUEMAX NGF 검증 데이터
//
// ⚠ 이 파일은 원본이 아니라 **사본**이다.
//   정본: nexpert-admin 저장소의 src/product-brief.js
//   벤더 자료가 바뀌면 그쪽을 먼저 고치고 여기로 옮긴다. 반대 방향은 금지.
//
// 왜 사본을 두는가 — Tech 사이트는 Admin과 배포 대상도 저장소도 다르다.
// 패키지로 묶을 만큼 자주 바뀌는 데이터가 아니고(벤더 브로셔 개정 주기),
// 묶으면 배포 두 곳이 서로를 기다리게 된다.
//
// ⚠ verified:false 인 모델(800 ED)은 Datasheet가 없어 브로셔 한 벌로만 확인했다.
//   답변에서 이 사실을 반드시 함께 말해야 한다 — grounding.js 참조.

const BLUEMAX_NGF = {
  vendor: "SECUI",
  line: "BLUEMAX NGF",
  category: "차세대 방화벽(NGFW)",
  tagline: "국내 최초 가상화 · 클라우드 차세대 방화벽",
  summary:
    "유무선 IT 인프라의 모든 위협 요소를 탐지·차단하는 통합보안플랫폼입니다. 가상화(Virtual System) 기능으로 "
    + "장비 한 대에서 여러 개의 방화벽을 나눠 운영할 수 있고, 애플리케이션 인지·디바이스 인지 같은 차세대 방화벽 "
    + "기능과 SD-WAN, DNS·VPN 최신 위협 대응까지 한 대에 담고 있습니다.",
  sources: [
    "SECUI BLUEMAX NGF 브로셔",
    "모델별 Datasheet 13종 (50·60·100·110·200·310·510·1100·1300·1510·2100·5100·20000)",
  ],

  edge: [
    { t: "보안 SD-WAN", d: "차세대 방화벽 위에서 애플리케이션과 회선 품질을 기준으로 트래픽 경로를 잡습니다. ZTP(무설정 배포)와 보안 컴플라이언스 자체 점검을 지원합니다." },
    { t: "제로 트러스트 네트워크", d: "디바이스의 보안 상태·사용자 ID·App 정보를 함께 보고 접근을 허용합니다. 필수 보안 SW 설치 여부와 보안 취약점 업데이트 상태를 점검합니다." },
    { t: "DNS Security", d: "머신러닝을 장비에 얹어 악성 DNS 도메인·비정상 질의를 잡습니다. 내부 감염 PC가 C&C 서버를 찾는 순간이 드러납니다." },
    { t: "SaaS Security", d: "HTTP 헤더를 제어해 같은 SaaS라도 회사 계정만 허용하고 개인 계정 로그인은 막습니다." },
  ],

  features: [
    { t: "App 제어", d: "국내외 애플리케이션을 사전 정의·분석해, 기존 UTM으로는 대응이 어려운 공격에 능동적으로 대처합니다." },
    { t: "사용자 ID", d: "IP가 아닌 사용자 ID로 인식해 어디에서 접속해도 같은 정책이 적용되고, 사용자별 통계를 볼 수 있습니다." },
    { t: "VPN 보안 강화", d: "양자 컴퓨터를 이용한 공격까지 염두에 둔 국제 공인 차세대 암호기술 PQC 알고리즘을 탑재했습니다." },
    { t: "도메인 객체", d: "IP 대신 도메인명을 방화벽 객체로 씁니다. 도메인당 2,048개까지 IP를 실시간·주기적으로 수집합니다." },
    { t: "웹필터", d: "82개 이상 카테고리의 글로벌 DB를 쓰고, 모르는 URL은 클라우드 서버에 분석을 요청해 빠르게 차단합니다." },
    { t: "AI Powered Threat Protection", d: "AI 기반 클라우드 분석으로 Malware·URL·DNS 트래픽을 통합 분석해, 장비 단독으로는 어려운 미지의 위협까지 대응합니다." },
    { t: "SSL Inspection", d: "SSL 세션을 자동 탐지·복호화해 차세대 보안 기능에 적용합니다. H/W 가속기로 기존 제품 대비 성능을 끌어올렸습니다." },
    { t: "Open API", d: "국내외 통합 보안 관리·취약점 진단·정책 분석 시스템과 연동해 보안 운영 자동화(SOAR)를 구성합니다." },
    { t: "파일 유형 제어", d: "문서·압축·이미지·멀티미디어 등 파일 유형별로, 방향별로 제어해 비인가 파일 전송과 내부 정보 유출을 막습니다." },
  ],

  modules: [
    "NGFW", "Virtual System", "AI Powered Threat Protection", "SSL Inspection", "Legacy Firewall",
    "IPS", "Anti DDoS", "IPSec VPN", "SSL VPN", "Anti-Virus & Anti-SPAM", "Web Filter", "DLP",
    "Device 제어", "네트워크", "모니터링", "관리 기능", "SD-WAN",
  ],

  // ports 의 '-' 는 그 속도의 포트가 없다는 뜻. (maxN)은 확장 슬롯을 채웠을 때의 최대치.
  portOrder: ["1GC", "1GF", "10GF", "40GF", "100GF"],
  models: [
    { name: "50",     cpu: "2 Core",  memory: "4GB",      storage: "16GB",      log: "-",           power: "Adapter",   throughput: "1Gbps",   verified: true,
      ports: { "1GC": "4",           "1GF": "-",        "10GF": "-",         "40GF": "-",      "100GF": "-" } },
    { name: "60",     cpu: "3 Core",  memory: "4GB",      storage: "16GB",      log: "-",           power: "Adapter",   throughput: "1.5Gbps", verified: true,
      ports: { "1GC": "4+4(Switch)", "1GF": "-",        "10GF": "-",         "40GF": "-",      "100GF": "-" } },
    { name: "100",    cpu: "2 Core",  memory: "4GB",      storage: "16GB",      log: "-",           power: "Adapter",   throughput: "2Gbps",   verified: true,
      ports: { "1GC": "4+4",         "1GF": "-",        "10GF": "-",         "40GF": "-",      "100GF": "-" } },
    { name: "110",    cpu: "4 Core",  memory: "4GB",      storage: "32GB",      log: "-",           power: "Adapter",   throughput: "3Gbps",   verified: true,
      ports: { "1GC": "4+8(Switch)", "1GF": "-",        "10GF": "-",         "40GF": "-",      "100GF": "-" } },
    { name: "200",    cpu: "4 Core",  memory: "4GB",      storage: "32GB",      log: "-",           power: "Adapter",   throughput: "4Gbps",   verified: true,
      ports: { "1GC": "4+8",         "1GF": "-",        "10GF": "-",         "40GF": "-",      "100GF": "-" } },
    { name: "310",    cpu: "4 Core",  memory: "8GB",      storage: "64GB",      log: "1TB",         power: "Single",    throughput: "8Gbps",   verified: true,
      ports: { "1GC": "8",           "1GF": "-",        "10GF": "-",         "40GF": "-",      "100GF": "-" } },
    { name: "510",    cpu: "8 Core",  memory: "8GB",      storage: "128GB",     log: "1TB",         power: "Single",    throughput: "12Gbps",  verified: true,
      ports: { "1GC": "8",           "1GF": "4",        "10GF": "-",         "40GF": "-",      "100GF": "-" } },
    { name: "800 ED", cpu: "8 Core",  memory: "8GB",      storage: "128GB",     log: "1TB",         power: "Single",    throughput: "14Gbps",  verified: false,
      ports: { "1GC": "8",           "1GF": "4",        "10GF": "-",         "40GF": "-",      "100GF": "-" } },
    { name: "1100",   cpu: "4 Core",  memory: "8GB",      storage: "128GB",     log: "1TB",         power: "Single",    throughput: "16Gbps",  verified: true,
      ports: { "1GC": "8",           "1GF": "4(max8)",  "10GF": "-",         "40GF": "-",      "100GF": "-" } },
    { name: "1300",   cpu: "4 Core",  memory: "8GB",      storage: "256GB",     log: "1TB",         power: "Redundant", throughput: "18Gbps",  verified: true,
      ports: { "1GC": "8",           "1GF": "4(max8)",  "10GF": "(max4)",    "40GF": "-",      "100GF": "-" } },
    { name: "1510",   cpu: "10 Core", memory: "16GB",     storage: "256GB",     log: "1TB",         power: "Redundant", throughput: "40Gbps",  verified: true,
      ports: { "1GC": "8",           "1GF": "4(max8)",  "10GF": "(max4)",    "40GF": "-",      "100GF": "-" } },
    { name: "2100",   cpu: "20 Core", memory: "32/64GB",  storage: "128/256GB", log: "1.92TB/RAID", power: "Redundant", throughput: "80Gbps",  verified: true,
      ports: { "1GC": "8(max40)",    "1GF": "8(max40)", "10GF": "2(max10)",  "40GF": "(max4)", "100GF": "-" } },
    { name: "5100",   cpu: "32 Core", memory: "64/128GB", storage: "128/512GB", log: "1.92TB/RAID", power: "Redundant", throughput: "160Gbps", verified: true,
      ports: { "1GC": "8(max40)",    "1GF": "8(max40)", "10GF": "10(max26)", "40GF": "(max8)", "100GF": "(max2)" } },
    { name: "20000",  cpu: "48 Core", memory: "96/288GB", storage: "128/512GB", log: "1.92TB/RAID", power: "Redundant", throughput: "320Gbps", verified: true,
      ports: { "1GC": "8(max40)",    "1GF": "8(max40)", "10GF": "10(max26)", "40GF": "(max8)", "100GF": "(max4)" } },
  ],
};

// 시스템 프롬프트에 넣을 평문. 사람이 읽는 표가 아니라 모델이 읽는 자료라
// 장식 없이 한 줄에 한 모델씩 적는다.
function asText() {
  const L = [];
  L.push(`## ${BLUEMAX_NGF.vendor} ${BLUEMAX_NGF.line} (${BLUEMAX_NGF.category})`);
  L.push(BLUEMAX_NGF.tagline);
  L.push(BLUEMAX_NGF.summary);
  L.push(`출처: ${BLUEMAX_NGF.sources.join(" / ")}`);

  L.push("\n### 차별화 기능");
  for (const e of BLUEMAX_NGF.edge) L.push(`- ${e.t}: ${e.d}`);

  L.push("\n### 주요 기능");
  for (const f of BLUEMAX_NGF.features) L.push(`- ${f.t}: ${f.d}`);

  L.push(`\n### 탑재 모듈\n${BLUEMAX_NGF.modules.join(", ")}`);

  L.push("\n### 모델별 하드웨어 사양");
  L.push("(포트의 '-'는 해당 속도 포트 없음, (maxN)은 확장 슬롯까지 채운 최대치)");
  for (const m of BLUEMAX_NGF.models) {
    const ports = BLUEMAX_NGF.portOrder
      .filter((k) => m.ports[k] !== "-")
      .map((k) => `${k} ${m.ports[k]}`)
      .join(" / ");
    const flag = m.verified ? "" : "  ※ 교차검증 안 됨(브로셔 단일 출처)";
    L.push(
      `- ${BLUEMAX_NGF.line} ${m.name} | 처리성능 ${m.throughput} | CPU ${m.cpu} | 메모리 ${m.memory} | ` +
      `스토리지 ${m.storage} | 로그 ${m.log} | 전원 ${m.power} | 포트 ${ports}${flag}`
    );
  }
  return L.join("\n");
}

module.exports = { BLUEMAX_NGF, asText };
