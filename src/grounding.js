// 시스템 프롬프트 조립 — 캐시 경계를 어디에 둘지가 이 파일의 전부다.
//
// ── 왜 두 덩어리인가 ────────────────────────────────────────────────
//
// 프롬프트 캐시는 **접두 일치**다. 앞에서부터 바이트가 같은 구간까지만 재사용된다.
// 그래서 순서가 곧 비용이다.
//
//   [1] COMMON        — 카테고리와 무관하게 늘 같다  → 세 카테고리가 이 캐시를 공유한다
//   [2] 카테고리 규칙 — 카테고리마다 다르다          → 카테고리별로 따로 쌓인다
//
// 만약 순서를 뒤집어 카테고리 규칙을 앞에 두면, 공통 부분이 카테고리 수만큼 중복
// 저장되고 공유되는 구간이 0이 된다. SECUI 규칙은 제품 자료 전체를 안고 있어서
// 덩치가 크므로, 이 순서 하나가 매달 요금에서 눈에 띈다.
//
// ⚠ **두 블록 어디에도 매번 달라지는 값을 넣지 마라.** 타임스탬프·세션 ID·사용자
//   이메일을 한 글자라도 섞으면 그 지점부터 캐시가 통째로 깨진다. 질문마다 달라지는
//   것은 messages 로 보낸다. 시스템 블록은 **모든 사용자에게 바이트 단위로 같아야** 한다.
//
// ⚠ Bedrock 계열 접점은 자동 프롬프트 캐싱을 지원하지 않는다. cache_control 을
//   직접 달아야 하고, 빼먹으면 매 질문마다 전액 청구된다. 응답의 cacheRead 로 확인한다.

const { COMMON, resolve } = require("./categories");

function systemBlocks(categoryKey) {
  const category = resolve(categoryKey);
  return [
    { type: "text", text: COMMON, cache_control: { type: "ephemeral" } },
    { type: "text", text: category.rules, cache_control: { type: "ephemeral" } },
  ];
}

module.exports = { systemBlocks };
