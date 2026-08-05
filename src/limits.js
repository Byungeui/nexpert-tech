// 사용량 제한 — 크레딧을 지키는 장치
//
// ── 왜 필요한가 ──────────────────────────────────────────────────────
// LLM 엔드포인트는 요청 하나의 원가가 일반 웹 요청의 수천 배다. 누가 발견해서
// 스크립트로 돌리면 며칠 만에 크레딧이 사라진다. 인증 없이 열 계획이라면
// 제한은 선택이 아니라 전제 조건이다.
//
// ── 이 구현의 한계를 먼저 밝힌다 ─────────────────────────────────────
// 카운터를 **프로세스 메모리**에 둔다. 따라서:
//   · 태스크를 재시작하면 카운터가 0으로 돌아간다
//   · 태스크를 2개 이상으로 늘리면 각자 따로 센다 (= 상한이 배로 늘어난다)
//
// 그래도 메모리로 가는 이유: DynamoDB나 ElastiCache를 붙이면 이 서비스에
// 상태 저장소가 하나 더 생기고, 그 자체가 비용·장애 지점이 된다. 태스크 1개로
// 운영하는 동안은 메모리로 충분하다.
//
// ⚠ **태스크 수를 2개 이상으로 늘릴 때 이 파일을 반드시 다시 본다.**
// ⚠ 진짜 최후의 방어선은 코드가 아니라 **AWS Budgets 알람**이다. 재시작으로
//    카운터가 초기화돼도 예산 알람은 초기화되지 않는다. 둘 다 있어야 한다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 환경변수로 조절한다 — 운영하면서 실제 사용량을 보고 조이거나 푼다.
const IP_WINDOW_MS = Number(process.env.IP_WINDOW_MS || 60_000);
const IP_MAX_REQUESTS = Number(process.env.IP_MAX_REQUESTS || 10);
const DAILY_TOKEN_CAP = Number(process.env.DAILY_TOKEN_CAP || 2_000_000);
const MAX_QUESTION_CHARS = Number(process.env.MAX_QUESTION_CHARS || 2000);

const ipHits = new Map();       // ip -> number[] (요청 시각들)
let tokensToday = 0;
let tokenDay = kstDay();

// 사용량 집계는 한국 시간 자정에 끊는다. UTC 자정이면 한국 기준 오전 9시에
// 리셋돼서, 오전에 상한을 채우고 오후 내내 막히는 이상한 하루가 된다.
function kstDay() {
  return Math.floor((Date.now() + KST_OFFSET_MS) / 86_400_000);
}

function rollDay() {
  const d = kstDay();
  if (d !== tokenDay) {
    tokenDay = d;
    tokensToday = 0;
  }
}

// ALB 뒤에 있으므로 req.ip 는 ALB의 사설 IP다. X-Forwarded-For 의 **첫 번째**가
// 실제 클라이언트다. server.js 에서 trust proxy 를 켜야 express 가 이걸 해석한다.
function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length) return xff.split(",")[0].trim();
  return req.ip || "unknown";
}

// 반환: null 이면 통과, 문자열이면 거절 사유
function check(req, question) {
  rollDay();

  if (typeof question !== "string" || !question.trim()) {
    return "질문이 비어 있습니다.";
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return `질문이 너무 깁니다. ${MAX_QUESTION_CHARS}자 이내로 줄여 주세요.`;
  }
  if (tokensToday >= DAILY_TOKEN_CAP) {
    return "오늘 사용량 한도에 도달했습니다. 내일 다시 이용해 주세요.";
  }

  const ip = clientIp(req);
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < IP_WINDOW_MS);
  if (hits.length >= IP_MAX_REQUESTS) {
    return "요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.";
  }
  hits.push(now);
  ipHits.set(ip, hits);

  // 오래된 IP 항목을 걷어낸다. 안 하면 메모리가 계속 늘어난다.
  if (ipHits.size > 5000) {
    for (const [k, v] of ipHits) {
      if (!v.length || now - v[v.length - 1] > IP_WINDOW_MS) ipHits.delete(k);
    }
  }
  return null;
}

// 응답이 끝난 뒤 실제 사용량을 기록한다. 캐시 읽기 토큰도 과금되므로 함께 센다.
function record(usage) {
  if (!usage) return;
  rollDay();
  tokensToday +=
    (usage.input_tokens || 0) +
    (usage.output_tokens || 0) +
    (usage.cache_creation_input_tokens || 0) +
    (usage.cache_read_input_tokens || 0);
}

function status() {
  rollDay();
  return { tokensToday, cap: DAILY_TOKEN_CAP, trackedIps: ipHits.size };
}

module.exports = { check, record, status, clientIp };
