// 토큰 사용량 → 비용.
//
// ── 모르는 요율은 비워 둔다 ──────────────────────────────────────────
// ⚠ **추측한 요율을 넣지 마라.** 값이 없으면 이 파일은 금액 대신 `null` 을 돌려주고,
//   화면은 토큰 수만 보여준다. **틀린 금액은 없는 금액보다 나쁘다** — 여기 나오는
//   숫자를 보고 "이 정도면 쓸 만한가"를 판단하기 때문이다.
//   모델을 바꾸면 아래 표에 그 모델 항목을 **확인해서** 추가한다. 없는 모델은
//   자동으로 금액 없이 토큰만 나오지, 옆 모델 값을 빌려 쓰지 않는다.
//
// ⚠ 캐시 쓰기·읽기는 입력과 **요율이 다르다.** 넷 다 확인해서 넣는다.
//   (캐시 쓰기가 입력보다 비싸다 — 첫 질문이 이어지는 질문보다 비싼 이유다.)
//
// ⚠ `thinking: adaptive` 를 쓰므로 **화면에 안 보이는 사고 토큰도 출력으로 과금된다.**
//   `output_tokens` 에 이미 포함돼 있어 따로 더할 필요는 없지만, 답변 길이에 비해
//   출력 토큰이 많아 보이는 이유가 이것이다.

// 100만 토큰당 USD. 모르면 null 로 둔다.
//
// 아래 값의 출처 (2026-08-21 확인):
//   · Bedrock 모델별 가격 계산기 — 모델 ID `us.anthropic.claude-opus-4-6-v1` 기준
//     https://custom.typingmind.com/tools/estimate-llm-usage-costs/amazon-bedrock/us-anthropic-claude-opus-4-6-v1
//   · 캐시 배수(쓰기 1.25배 · 읽기 0.1배)는 Bedrock 공통 규칙이며 위 값과 일치한다.
//   두 출처가 같고 Anthropic 1차 API 정가($5/$25)와도 같아 **`us.` 프로파일에는
//   리전 할증이 없다**고 판단했다. (일부 자료가 말하는 "리전 엔드포인트 10% 할증"은
//   이 모델·이 프로파일에는 적용되지 않았다.)
//
// ⚠ **이 값은 참고용 추정이다. 정본은 AWS 청구서다.** 월말에 Cost Explorer 의
//   Bedrock 비용과 앱이 보여준 합계를 한 번 대조해 보고, 어긋나면 여기를 고친다.
//   요율은 예고 없이 바뀔 수 있다.
const RATES = {
  "us.anthropic.claude-opus-4-6-v1": {
    input: 5.0,
    output: 25.0,
    cacheWrite: 6.25,
    cacheRead: 0.5,
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
