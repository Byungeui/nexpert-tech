// Cloudflare Access 신원 — 이름표(label)와 신원 확인(requireUser)은 다른 일이다.
//
// ── 왜 둘로 나누는가 ─────────────────────────────────────────────────
// 대화를 서버에 두기 전까지 이 값은 **사용량 로그의 이름표**일 뿐이었다. 틀려도
// 집계가 조금 어긋날 뿐이라 서명을 안 봤다.
//
// 대화가 서버에 있는 지금은 다르다. 서버가 "이 사람의 대화를 돌려줘"를 판단하므로,
// **검증하지 않으면 헤더 한 줄로 남의 대화를 열 수 있다.** 그래서:
//
//   label(req)        → 검증 안 함. 로그 이름표 전용. 실패해도 답변은 계속된다
//   requireUser(req)  → 서명·만료·audience 확인. 대화 API 는 반드시 이걸 쓴다
//
// ⚠ **대화 API 에서 label() 을 쓰지 마라.** 그 순간 인증이 사라진다.
//
// ── 설정이 없으면 열지 않고 닫는다 ───────────────────────────────────
// CF_ACCESS_TEAM·CF_ACCESS_AUD 가 없으면 requireUser 는 항상 거절한다. 대화 저장
// 기능이 꺼질 뿐 사이트는 그대로 돈다(화면이 브라우저 저장으로 돌아간다).
// **설정을 빠뜨렸을 때 무인증으로 열리는 것보다, 기능이 꺼지는 편이 안전하다.**

const { createRemoteJWKSet, jwtVerify } = require("jose");

// 예: nexpert  → https://nexpert.cloudflareaccess.com
const TEAM = (process.env.CF_ACCESS_TEAM || "").trim();
// Access 애플리케이션의 Application Audience (AUD) Tag.
const AUD = (process.env.CF_ACCESS_AUD || "").trim();

// 로컬 개발용. **CF_ACCESS_AUD 가 설정돼 있으면 무시된다** — 운영에서 실수로
// 켜지지 않게 하는 장치다. 운영 태스크 정의에는 절대 넣지 않는다.
const DEV_USER = (process.env.DEV_USER || "").trim();

const enabled = Boolean(TEAM && AUD);
const issuer = enabled ? `https://${TEAM}.cloudflareaccess.com` : null;

// 공개키는 원격에서 가져와 캐시된다. 매 요청마다 네트워크를 타지 않는다.
const jwks = enabled
  ? createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`))
  : null;

// ── 이름표 (검증하지 않음) ───────────────────────────────────────────
// 로그에만 쓴다. 검증된 값과 구분되도록 접두사를 붙인다 — 나중에 집계를 볼 때
// "이건 확인된 신원인가"를 헷갈리지 않기 위해서다.
function label(req) {
  const email = peek(req.headers["cf-access-jwt-assertion"]);
  if (email) return email;
  const h = req.headers["cf-access-authenticated-user-email"];
  if (typeof h === "string" && h) return h;
  return "anonymous";
}

// ── 신원 확인 (서명·만료·audience) ───────────────────────────────────
// 성공하면 이메일, 실패하면 던진다. 대화 API 는 이 값으로만 데이터를 찾는다.
async function requireUser(req) {
  if (!enabled) {
    if (DEV_USER) return DEV_USER;                 // 로컬 개발
    throw Object.assign(new Error("대화 저장이 설정되지 않았습니다."), { status: 503 });
  }

  const token = req.headers["cf-access-jwt-assertion"];
  if (typeof token !== "string" || !token) {
    throw Object.assign(new Error("인증 정보가 없습니다."), { status: 401 });
  }

  let payload;
  try {
    // ⚠ 알고리즘을 여기서 못박는다. 토큰 헤더의 alg 를 그대로 믿으면
    //   alg:none · HS256 혼동 같은 고전적인 우회가 열린다.
    ({ payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: AUD,
      algorithms: ["RS256"],
    }));
  } catch {
    throw Object.assign(new Error("인증에 실패했습니다."), { status: 401 });
  }

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email) {
    throw Object.assign(new Error("인증 정보에 이메일이 없습니다."), { status: 401 });
  }
  return email;
}

// JWT 는 `헤더.페이로드.서명` 이다. **서명을 보지 않고** 가운데만 들여다본다.
// 이름표 전용이므로 이 함수의 결과를 권한 판단에 쓰지 않는다.
function peek(token) {
  if (typeof token !== "string" || !token) return null;
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const v = JSON.parse(json).email;
    return typeof v === "string" && v ? v : null;
  } catch {
    return null;
  }
}

// 시작할 때 어느 모드인지 한 줄 남긴다. 조용히 꺼져 있으면 원인 찾기가 어렵다.
function mode() {
  if (enabled) return `Access 검증 (${issuer})`;
  if (DEV_USER) return `개발 모드 — 검증 없음, 사용자=${DEV_USER}`;
  return "대화 저장 꺼짐 (CF_ACCESS_TEAM·CF_ACCESS_AUD 없음)";
}

module.exports = { label, requireUser, enabled: enabled || Boolean(DEV_USER), mode };
