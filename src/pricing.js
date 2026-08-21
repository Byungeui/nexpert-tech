// 토큰 사용량 → 비용.
//
// ── 요율을 지어내지 않는 이유 ────────────────────────────────────────
// ⚠ **모르는 요율은 비워 둔다.** 값이 없으면 이 파일은 금액 대신 `null` 을 돌려주고,
//   화면은 토큰 수만 보여준다. **틀린 금액은 없는 금액보다 나쁘다** — 여기 나오는
//   숫자를 보고 대표가 "이 정도면 쓸 만한가"를 판단하기 때문이다.
//
// 넣을 값: AWS Bedrock 요금 페이지에서 **이 모델·이 리전(us-west-2)** 의
//   100만 토큰당 USD 단가. https://aws.amazon.com/bedrock/pricing/
//   ⚠ 캐시 쓰기·읽기는 입력과 **요율이 다르다.** 넷 다 확인해서 넣는다.
//
// 참고(자릿수 확인용): Anthropic 1차 API 정가는 Opus 4.6 이 100만 토큰당
//   입력 $5 / 출력 $25 다. **이건 Bedrock 값이 아니다.** Bedrock 은 파트너 가격이라
//   다를 수 있으므로 그대로 옮겨 적지 말고, 넣은 값이 이 자릿수에서 크게 벗어나면
//   단위를 잘못 본 것으로 의심한다.
//
// ⚠ `thinking: adaptive` 를 쓰므로 **화면에 안 보이는 사고 토큰도 출력으로 과금된다.**
//   `output_tokens` 에 이미 포함돼 있어 따로 더할 필요는 없지만, 답변 길이에 비해
//   출력 토큰이 많아 보이는 이유가 이것이다.

// 100만 토큰당 USD. 모르면 null 로 둔다.
const RATES = {
  "us.anthropic.claude-opus-4-6-v1": {
    input: null,
    output: null,
    cacheWrite: null,
    cacheRead: null,
  },
};

// 태스크 정의에서 바로 바꾸고 싶을 때 쓴다 — 코드 수정 없이 새 revision 만으로 켜진다.
// 환경변수가 있으면 위 표보다 우선한다.
const ENV = {
  input: num(process.env.PRICE_INPUT_PER_1M),
  output: num(process.env.PRICE_OUTPUT_PER_1M),
  cacheWrite: num(process.env.PRICE_CACHE_WRITE_PER_1M),
  cacheRead: num(process.env.PRICE_CACHE_READ_PER_1M),
};

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function ratesFor(model) {
  const base = RATES[model] || {};
  return {
    input: ENV.input ?? base.input ?? null,
    output: ENV.output ?? base.output ?? null,
    cacheWrite: ENV.cacheWrite ?? base.cacheWrite ?? null,
    cacheRead: ENV.cacheRead ?? base.cacheRead ?? null,
  };
}

// 사용량 → USD. **실제로 쓴 항목의 요율이 하나라도 없으면 null 이다.**
// 안 쓴 항목(캐시 미사용 등)은 요율을 몰라도 상관없다 — 0 을 곱할 뿐이므로.
function costUsd(model, usage) {
  if (!usage) return null;
  const r = ratesFor(model);
  const parts = [
    [usage.input_tokens || 0, r.input],
    [usage.output_tokens || 0, r.output],
    [usage.cache_creation_input_tokens || 0, r.cacheWrite],
    [usage.cache_read_input_tokens || 0, r.cacheRead],
  ];

  let sum = 0;
  for (const [tokens, rate] of parts) {
    if (!tokens) continue;
    if (rate == null) return null;   // 쓴 만큼의 값을 모르면 금액을 만들어내지 않는다
    sum += (tokens * rate) / 1_000_000;
  }
  return sum;
}

module.exports = { costUsd, ratesFor };
