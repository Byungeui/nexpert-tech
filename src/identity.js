// 누가 물었는가 — Cloudflare Access 가 앞단에서 이미 인증한 신원을 꺼내 쓴다.
//
// 로그인 화면을 만들 필요가 없다. `tech.nexperts.co.kr` 은 Access 뒤에 있고,
// Access 는 통과시킨 요청에 서명된 JWT(`Cf-Access-Jwt-Assertion`)를 붙여 준다.
// 그 안의 `email` 클레임이 곧 사용자 ID다. **저장소도 세션도 필요 없다.**
//
// ── 서명을 검증하지 않는 이유와, 그게 언제 끝나는지 ──────────────────
// ⚠ 지금 이 값은 **사용량 로그의 이름표로만** 쓰인다. 이 값으로 무언가를 허용하거나
//   막지 않는다. 그리고 ALB 보안 그룹이 관리형 접두사 목록 `cloudflare-ipv4` 로
//   잠겨 있어 인터넷에서 헤더를 지어내 넣을 수 없다.
//   (사무실 IP /32 하나가 예외로 열려 있다 — 거기서는 위조가 가능하다.)
//
// ⚠ **이 값으로 무언가를 허용/차단하기 시작하는 순간 검증이 필수다.**
//   1인당 사용량 상한, 남의 대화 조회 같은 것을 붙일 때는
//   `https://<팀>.cloudflareaccess.com/cdn-cgi/access/certs` 의 공개키로
//   서명·만료·audience 를 확인해야 한다. 검증 없이 권한을 걸면 사무실 안에서는
//   **헤더 한 줄로 남의 이름을 쓸 수 있다.**

function userOf(req) {
  const jwt = req.headers["cf-access-jwt-assertion"];
  if (typeof jwt === "string" && jwt) {
    const email = claim(jwt, "email");
    if (email) return email;
  }
  // Access 애플리케이션 설정에 따라 이 헤더로만 오는 경우가 있다.
  const h = req.headers["cf-access-authenticated-user-email"];
  if (typeof h === "string" && h) return h;

  // 로컬 개발이거나 Access 를 지나지 않은 요청. 집계에서 바로 눈에 띄어야 하므로
  // 빈 문자열이 아니라 이름을 준다.
  return "anonymous";
}

// JWT 는 `헤더.페이로드.서명` 이다. 가운데를 base64url 로 풀어 클레임을 읽는다.
// 깨진 값이 와도 던지지 않는다 — 이름표 하나 때문에 답변이 실패하면 안 된다.
function claim(jwt, key) {
  try {
    const part = jwt.split(".")[1];
    if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const v = JSON.parse(json)[key];
    return typeof v === "string" && v ? v : null;
  } catch {
    return null;
  }
}

module.exports = { userOf };
