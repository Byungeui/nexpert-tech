# NEXPERT TechDesk — 기술 지원 Q&A

보안장비(SECUI)·Azure·AWS 기술 질문에 답하는 사내 사이트. Claude Opus 5를 쓴다.

⚠ **표시 이름만 TechDesk 다. 인프라 이름은 전부 `nexpert-tech` 그대로다** —
도메인 `tech.nexperts.co.kr`, ECR 리포지토리, ECS 클러스터·서비스·태스크 정의,
로그 그룹 `/ecs/nexpert-tech`, ALB·대상 그룹, GitHub 저장소. 도메인을 바꾸면
ACM 인증서·Cloudflare Access 애플리케이션·DNS를 다시 만들어야 하는데,
얻는 것이 화면의 글자 하나뿐이라 하지 않았다.

이 문서는 기능 목록이 아니라 **왜 이렇게 만들었는가**를 적어 둔 것이다.
고치기 전에 읽는다. 모르고 고치면 조용히 깨진다.

---

## 왜 Admin과 분리했는가

NEXPERT Admin(Azure Container Apps)에 붙이지 않고 별도 서비스로 만들었다. 이유는 셋이다.

**① 답변 근거의 규칙이 정반대다.** Admin의 원칙은 "문서에 있는 것만 답하고 없으면 없다고
말한다"이다. 그 규칙을 기술 질문에 적용하면 "OSPF LSA 타입 설명해줘"에 "문서에 없습니다"라고
답한다. 반대로 규칙을 풀면 사내 문서 답변에 추측이 섞인다. **서비스를 나누면 프롬프트로
봉합할 필요가 없다.**

**② 자격증명이 사라진다.** Azure에서 Bedrock을 호출하려면 장기 IAM 액세스 키를 어딘가에
보관해야 한다. AWS 안(ECS)에서 호출하면 **IAM Task Role**로 끝난다 — 코드에도 환경변수에도
키가 없다. `server.js` 머리말 참조.

**③ 장부를 건드리지 않는다.** 실제 경영 수치가 든 앱은 그대로 두고 새 서비스만 만든다.

**그래서 이 사이트에는 사내 문서가 없다.** 매출·견적·계약·지분은 여기 들어오지 않는다.
넣는 순간 Admin의 권한 설계(`perms.js`)를 여기에 복제해야 하고, 분리한 의미가 사라진다.

---

## 카테고리를 나눈 이유 — 보기 좋으라고가 아니다

`src/categories.js`. 화면 위의 탭 셋(**보안장비 · Azure · AWS**)은 **근거의 종류가
다르기 때문에** 나뉘어 있다. 탭을 바꾸면 서버에서 **시스템 프롬프트가 통째로 갈린다.**

| 카테고리 | 근거 | 주된 실패 방식 |
|---|---|---|
| 보안장비 | `secui-data.js` — 우리가 검증해 옮긴 사본 | **없는 걸 지어낸다** |
| Azure | Microsoft Learn 공식 문서 (MCP 조회) | **작년 값을 자신 있게 말한다** |
| AWS | AWS 공식 문서·What's New (MCP 조회) | 〃 |

SECUI는 밖에서 조회할 데가 없어 사본이 전부고, 그래서 "자료에 없으면 없다고 한다"가
규칙이다. 반대로 클라우드는 자료가 밖에 넘치지만 **자주 바뀐다** — SKU 가격, 쿼터,
리전별 제공 여부, 지원 종료 일정은 몇 달 단위로 달라진다. 프롬프트를 아무리 조여도
모델이 기억하는 값은 학습 시점에 멈춰 있으므로, **클라우드 쪽은 조회가 필요하다.**

카테고리는 화면 표시가 아니라 서버의 스위치다. 클라이언트가 보낸 값은 그대로 믿지 않고
`resolve()`가 화이트리스트로 거른다. 목록·예시 질문·안내문의 **정본도 서버**이고 화면은
`/api/categories`로 받아 그린다 — 화면에 하드코딩하면 예시 질문과 답변 규칙이 따로 논다.

카테고리를 바꾸면 **대화 이력도 버린다.** 방화벽 이야기를 하다 Azure 탭으로 옮겼는데
앞의 대화가 따라가면, 갈아 끼운 규칙과 이력이 어긋나 답이 흐려진다.

### MCP — 벤더가 운영하는 원격 문서 서버

| 대상 | 엔드포인트 | 인증 |
|---|---|---|
| Azure | `https://learn.microsoft.com/api/mcp` | 없음 |
| AWS | `https://knowledge-mcp.global.api.aws` | 없음 (레이트리밋 있음) |

둘 다 **원격**이라 우리 컨테이너에 설치할 게 없다. 로컬(stdio) MCP 서버는 여기 못 쓴다 —
모델 쪽에서 직접 붙는 방식이라 공개 HTTPS 주소여야 한다.

Learn 쪽 URL에 `maxTokenBudget`을 걸어 둔 이유는 비용이다. 조회 결과가 통째로 컨텍스트에
들어오면 질문 하나의 토큰이 몇 배가 되고 `limits.js`의 하루 상한이 순식간에 닳는다.

> ⚠ **`MCP_ENABLED`는 기본 꺼짐이다.** 이 접점(`bedrock-runtime`)에서 MCP 커넥터가 도는지
> 아직 확인하지 못했다 — 그동안 모델 호출 자체가 막혀 검증할 수 없었다. 켜둔 채로
> 두면 실패했을 때 **MCP 탓인지 모델 탓인지 구분이 안 된다.** 일반 답변이 나오는 것을
> 먼저 확인하고, 그다음 `MCP_ENABLED=1`로 켜서 따로 검증한다.
>
> MCP 를 쓰는 카테고리만 `beta.messages` 경로로 보낸다. SECUI 까지 beta 로 보내면
> 문제가 생겼을 때 원인이 하나 더 늘어난다.

---

## 화면 폭과 빈 화면 — 2열로 나눠 봤다가 되돌린 기록

**넓은 모니터에서 허전한 것은 폭 문제가 아니었다.**

처음 900px 한 열이 "가운데만 쓴다"는 지적을 받고, 1024px 이상에서 왼쪽에 300px 열을
만들어 카테고리 안내와 예시 질문을 옮겼다. 결과는 더 나빴다. **채팅은 세로로 읽는
화면이라 옆 열이 대화 내내 비어 있고**, 첫 화면(대화 0건)에서는 오른쪽 열이 통째로
비면서 입력창만 오른쪽으로 치우쳐 걸린다. 2560px 화면에서 확인하고 되돌렸다.

진짜 원인은 **빈 화면의 세로 배치**였다. 대화 목록을 위에서부터 채우면 안내 카드 하나만
맨 위에 뜨고 그 아래 800px 넘게 빈다. 그래서 `body:not(.started) .log` 에
`justify-content: flex-end` 를 걸어 **시작 전에는 내용을 입력창 쪽으로 붙인다.**
빈자리는 위에 있어야 한다 — 시선도 손도 입력창 근처에 있기 때문이다.
첫 질문을 보내면 `started` 가 붙어 위에서부터 채우는 보통의 대화 목록으로 바뀐다.

폭은 Admin 과 **같은 1140px** 이다. 두 사이트를 오가며 쓰는 사람에게 본문 폭이
어긋나면 다른 회사의 도구처럼 보인다. 더 넓히기 전에 한 줄이 길어질수록 읽기
나빠진다는 것을 감안할 것 — 1140px 에서 답변 한 줄이 이미 한글 70자 안팎이다.

**⚠ 정적 파일에 `Cache-Control: no-cache` 를 반드시 붙여 둔다** (`server.js` 의
`express.static`). 없으면 브라우저가 `index.html` 은 새로 받고 `app.js` 는 캐시에서
꺼내 쓰는 조합이 생긴다. 실제로 배포 직후 옛 `app.js` 가 새 `index.html` 에 없는
요소를 찾다가 `Cannot set properties of null` 로 **화면 전체가 죽었다.**
`no-cache` 는 캐시 금지가 아니라 매번 재검증이라, 안 바뀌었으면 304 로 끝난다.

**⚠ 마크다운 렌더러(`app.js` 의 `render`)는 매 분기가 최소 한 줄을 소비해야 한다.**
라이브러리를 안 쓰고 직접 그리므로 `while (i < lines.length)` 의 진행은 순전히
각 분기가 `i` 를 늘려 주는 데 달려 있다. **한 분기라도 아무것도 안 먹고 `out.push` 만
하면 그 자리에서 무한 루프**가 되고, 배열이 한계까지 커져 `RangeError: Invalid array
length` 로 화면이 죽는다.

실제로 그렇게 죽었다. 표 분기는 "다음 줄이 구분선(`|---|`)일 때만" 성립하는데,
스트리밍 중에는 `| 항목 | 값 |` 까지만 오고 구분선은 다음 토큰에 온다. 그 한 틱 동안
표 분기는 미루고, 문단 분기는 `|` 로 시작하는 줄을 제외 조건에 두고 있어 역시 안 먹는다.
**답변이 제대로 도착하는 순간에만 터지므로**, 모델 호출이 막혀 있던 동안에는 한 번도
드러나지 않았다 — Bedrock 을 고치고 나서야 처음 보였다.

검증은 눈으로 하지 말고 **답변 전체의 모든 접두사를 한 번씩 그려 본다.** 스트리밍이
실제로 하는 일이 그것이고, 깨지는 건 언제나 중간 상태다. cURL 로 스트림만 확인하면
서버는 멀쩡하고 화면만 죽는 이 버그를 통째로 놓친다.

**⚠ 입력창 placeholder 에 조작법을 넣지 마라.** `질문을 입력하세요 (Enter 전송 ·
Shift+Enter 줄바꿈)` 은 휴대폰에서 한 줄짜리 입력창 안에 두 줄로 접혀 아래가 잘렸다.
조작법은 하단 안내문의 `.keyhint` 로 옮기고 좁은 화면에서는 CSS 로 감춘다 —
**휴대폰 키보드에는 Shift+Enter 가 없으니** 감춰서 잃는 것도 없다.

> 이걸 JS(`matchMedia` 의 `change`, `window.resize`)로 바꿔 끼우려다 실패했다.
> 두 이벤트 모두 뜨지 않는 경우를 확인했고, 그러면 화면을 넓혔다 좁혔을 때 긴 문구가
> 남아 다시 잘린다. **폭에 따라 달라지는 것은 CSS 로 처리한다** — 이벤트에 기대지 않으면
> 틀릴 수가 없다.

**⚠ '대화만 스크롤' 은 `(min-width: 1024px) and (min-height: 700px)` 에서만 켠다.**
답변이 길어져도 입력창이 제자리에 남게 하는 장치인데, 높이 조건을 빼면 낮은 창에서
예시 질문과 입력창이 화면 밖으로 밀리고 **페이지가 스크롤되지 않아 손이 닿지 않는다.**
1280×560 에서 실제로 그렇게 됐다. 그 높이에서는 그냥 페이지를 굴린다.

---

## 답변 근거를 세 갈래로 나눈 이유 (보안장비 카테고리)

보안장비 카테고리 안에서 질문을 다시 세 범주로 나눠 각각 다르게 답한다.

| 범주 | 근거 | 규칙 |
|---|---|---|
| A. SECUI 제품 사양 | `src/secui-data.js` (검증된 자료) | 자료에 있는 것만 |
| B. **타사 제품 모델별 수치** | **없음** | **숫자를 말하지 않는다** |
| C. 기술 개념·프로토콜 | 모델 일반 지식 | 답변 가능, 출처 표시 |

### B가 이 서비스의 가장 큰 위험이다

"BLUEMAX 1300 vs 경쟁사 X 비교해줘"는 유통사에서 가장 자주 나오는 질문이고, 동시에
언어모델이 가장 그럴듯하게 틀리는 자리다. 모델명별 처리량·세션수·포트 구성은 형태가
일정해서, 실제로 본 적 없어도 매끄럽게 만들어진다. 그 숫자가 경쟁 제안서에 들어가면
되돌릴 방법이 없다.

이건 가정이 아니다. Admin 저장소 `src/product-brief.js` 머리말에 같은 일이 기록돼 있다 —
SECUI 브로셔를 옮겨 적을 때 SD-WAN 설명 두 군데가 원문에서 벗어났고 검증에서 잡혔다.
**원본을 옆에 두고 옮길 때도 그랬다.** 원본이 아예 없는 타사 사양은 말할 것도 없다.

그래서 B는 "조심해서 답한다"가 아니라 **"숫자를 말하지 않는다"**로 못 박았다. 대신 비교
항목의 틀을 주고 공식 데이터시트로 보낸다. 덜 편하지만 틀리지 않는다.
**이 서비스가 팔아야 하는 건 답이 아니라 신뢰다.**

### 800 ED는 다르게 취급한다

`secui-data.js`에서 이 모델만 `verified: false`다. Datasheet가 없어 브로셔 한 벌로만
확인했기 때문이다. 이 모델 수치를 인용할 때는 그 사실을 함께 말하도록 프롬프트에 넣었다.

---

## RAG를 쓰지 않는 이유

제품 자료 전체가 시스템 프롬프트에 다 들어간다. 벡터 DB도 검색도 없다.

자료가 컨텍스트 창에 비해 아주 작아서 청킹·검색이 오히려 손해다 — 검색이 틀린 조각을
가져오면 답도 틀린다. 통째로 넣으면 그럴 일이 없다. 그리고 Bedrock Knowledge Bases는
기본값이 OpenSearch Serverless라 **질문이 0건이어도 시간당 과금**이 나간다.

대신 **프롬프트 캐싱**을 건다. `grounding.js`의 `systemBlocks()`가 `cache_control`을
직접 붙인다.

> ⚠ **Bedrock은 자동 프롬프트 캐싱을 지원하지 않는다.** 첫 파티 API의 편의 기능이 여기엔
> 없어서 블록에 직접 달아야 한다. 빼먹으면 매 질문마다 전액 청구된다.
> `/api/status`와 응답의 `cacheRead` 값으로 확인한다.

⚠ 캐시는 **접두 일치**다. `systemBlocks()`가 돌려주는 문자열에 타임스탬프·세션 ID처럼
매번 달라지는 값을 넣으면 캐시가 통째로 깨진다. 넣지 말 것.

⚠ **블록 순서가 곧 비용이다.** `systemBlocks()`는 두 덩어리를 이 순서로 돌려준다 —
`[1] 카테고리와 무관한 공통 규칙` → `[2] 카테고리별 규칙`. 앞이 같으니 세 카테고리가
[1]의 캐시를 공유한다. 순서를 뒤집으면 공유 구간이 0이 되고, 제품 자료를 통째로 안고
있는 SECUI 규칙이 카테고리 수만큼 중복 저장된다.

---

## 사용량 제한 — 크레딧을 지키는 장치

`src/limits.js`. LLM 엔드포인트는 요청 하나의 원가가 일반 웹 요청의 수천 배다.
인증 없이 열 계획이라면 제한은 선택이 아니라 전제 조건이다.

카운터는 **프로세스 메모리**에 있다. 따라서 **태스크를 재시작하면 0으로 돌아가고,
태스크를 2개 이상으로 늘리면 각자 따로 센다.**

⚠ **태스크 수를 늘릴 때 이 파일을 반드시 다시 본다.**
⚠ 진짜 최후의 방어선은 코드가 아니라 **AWS Budgets 알람**이다. 재시작으로 카운터가
초기화돼도 예산 알람은 초기화되지 않는다. 둘 다 있어야 한다.

예산 알람은 계정 전체 월 **USD 100** 기준으로 걸려 있다(실제 80% · 실제 100% · **예측** 100%,
수신 `beseo@nexperts.co.kr`). 예측 알림이 셋 중 가장 쓸모 있다 — 나머지 둘은 이미 쓴 뒤에
알려준다. 다만 결제 데이터가 모이는 데 하루 가까이 걸리므로 **실시간 방어가 아니다.**
앞단은 `limits.js`가 막고, 뒷단을 예산이 받는다.

---

## 대화 보관과 사용량 — 무엇을 어디에 두는가

세 가지를 한꺼번에 "서버에 저장"으로 묶지 않았다. 성질이 다르기 때문이다.

| 무엇 | 성질 | 어디에 | 파일 |
|---|---|---|---|
| 대화 본문 | 개인적이고 덩치가 크다. 남이 볼 이유가 없다 | **브라우저** localStorage | `public/store.js` |
| 답변별 토큰·비용 | 대화에 딸린 숫자 | 서버가 계산 → 대화와 함께 브라우저에 | `src/pricing.js` |
| 사용자별 사용량 | **중앙에 있어야 의미가 있다** — 누가 얼마 썼는지 | 서버 → CloudWatch 로그 | `server.js` |

**중앙에 있어야 하는 것만 중앙에 뒀다.** 대화 본문까지 서버로 가져가면 테이블·IAM·
조회 API·삭제 권한이 한꺼번에 생기는데, 그 대가로 지금 얻는 것은 기기 간 동기화
하나뿐이다.

⚠ **그래서 대화는 기기마다 따로다.** 폰과 PC가 이어지지 않고, 브라우저 데이터를
지우면 함께 사라진다. 이것이 이 선택의 값이다.

⚠ 승격할 때(직원이 늘어 기기 간 동기화나 대화 공유가 필요해지면) **`store.js` 의
함수 이름과 반환 모양을 그대로 두고 안쪽만 `fetch` 로 바꾼다.** 화면 코드는 저장소가
브라우저인지 서버인지 몰라야 하고, 그러라고 `app.js` 밖으로 뺐다. 서버는 이미 사용자가
누군지 알고 있다(`src/identity.js`).

### 누가 물었는가 — 로그인을 만들지 않는다

Cloudflare Access가 앞단에서 이미 인증한다. 통과한 요청에는 서명된 JWT
(`Cf-Access-Jwt-Assertion`)가 붙어 오고, 그 안의 `email` 이 곧 사용자 ID다.
**사용자 표도 세션도 로그인 화면도 만들지 않는다.**

⚠ **지금은 서명을 검증하지 않는다.** 이 값이 사용량 로그의 이름표로만 쓰이고,
ALB 보안 그룹이 `cloudflare-ipv4` 접두사 목록으로 잠겨 있어 인터넷에서 헤더를 지어내
넣을 수 없기 때문이다. **이 값으로 무언가를 허용/차단하기 시작하면 그때는 검증이
필수다** — 1인당 상한이나 남의 대화 조회를 붙일 때. 자세한 조건은 `src/identity.js`.

### 사용량 집계 — 새 인프라 없이

답변이 끝날 때마다 한 줄짜리 JSON을 stdout에 쓴다. 이미 CloudWatch로 보내고 있으므로
**붙이는 인프라가 0이다.** Logs Insights에서 바로 집계된다.

```
filter evt="usage" | stats sum(costUsd) as usd, sum(output) as out by user
```

⚠ **질문·답변 본문은 로그에 남기지 않는다.** 비용 집계에 필요 없고, 남기는 순간
고객사 이야기가 로그에 쌓인다.

⚠ 지금 하루 토큰 상한은 **전체 공용**이다(`limits.js`). 직원이 늘면 한 사람이 하루치를
다 쓸 수 있다. 신원이 이미 들어와 있으므로 1인당 상한으로 바꾸는 것은 어렵지 않지만,
그러려면 위의 **JWT 검증이 먼저**다.

### 비용 — 모르는 요율은 비워 둔다

⚠ **`src/pricing.js` 의 요율은 비어 있다. 추측해서 채우지 마라.** 값이 없으면 화면은
금액 없이 토큰 수만 보여준다. **틀린 금액은 없는 금액보다 나쁘다** — 그 숫자를 보고
"이 정도면 쓸 만한가"를 판단하기 때문이다.

넣을 값은 [AWS Bedrock 요금 페이지](https://aws.amazon.com/bedrock/pricing/)에서
**이 모델·이 리전(us-west-2)** 의 100만 토큰당 USD 단가다. 캐시 쓰기·읽기는 입력과
요율이 다르므로 넷 다 확인한다. 파일을 고치거나 `PRICE_*` 환경변수로 넣는다.

⚠ `thinking: adaptive` 를 쓰므로 **화면에 안 보이는 사고 토큰도 출력으로 과금된다.**
`output_tokens` 에 이미 포함돼 있다 — 답변 길이에 비해 출력이 많아 보이는 이유가 이것이다.

---

## 인증을 앱에 넣지 않고 앞단에 세운 이유

로그인은 **Cloudflare Access**가 처리한다. 이 저장소에는 사용자 표도, 세션도, 로그인
경로도 없다. `tech.nexperts.co.kr`에 붙은 Access 애플리케이션이 **회사 메일
(`@nexperts.co.kr`)로 끝나는 사람만** 통과시키고, 인증 방식은 이메일 6자리 코드다.

Admin의 패스키·OTP 구조를 여기에 복제하지 않은 이유는 위의 "왜 Admin과 분리했는가"와 같다.
**인증을 앱에 넣는 순간 `auth.js`·`perms.js`가 두 벌이 되고, 앞으로 인증을 고칠 때마다
저장소 두 곳을 같이 고쳐야 한다.** 앞단에 두면 그 부담이 아예 생기지 않는다.

처음에는 ALB 보안 그룹을 대표 IP 하나로 잠가 뒀는데, **모바일에서 성립하지 않아서** 버렸다.
LTE는 접속할 때마다 IP가 바뀐다. IP 제한을 걷어낸 자리를 인증이 채운 것이다.

> ⚠ **ALB 보안 그룹은 Cloudflare 대역만 허용해야 한다.** 이것이 인증의 절반이다.
> 인터넷 전체에 열어두면 ALB 주소(`nexpert-tech-alb-….elb.amazonaws.com`)로 직접
> 들어와 **Access를 통째로 건너뛴다.** 관문은 Cloudflare에 있고, 앱은 관문 없이도
> 응답하기 때문이다.
>
> 대역은 관리형 접두사 목록 `cloudflare-ipv4`로 묶어 뒀다. Cloudflare가 대역을 바꾸면
> (`https://www.cloudflare.com/ips-v4`가 정본) 그 목록 한 곳만 고치면 된다.
> DNS 레코드도 **반드시 프록시(주황 구름)** 여야 한다. 회색으로 돌리는 순간 트래픽이
> Cloudflare를 지나지 않아 인증이 사라진다.

세션은 한 달이다. 기기·브라우저마다 한 번씩 로그인하고 그 뒤로는 묻지 않는다. 길게 잡아도
되는 이유는 `Team & Resources → Users`에서 **세션을 취소할 수 있기 때문**이고, 애초에 이
사이트에는 사내 문서가 없어서 Admin과 위험의 크기가 다르다.

---

## 환경변수

| 이름 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `BEDROCK_REGION` | | `us-west-2` | **Bedrock 리전.** ECS는 서울이지만 Bedrock은 여기다. ⚠ 서울로 바꾸지 마라 — 아래 참고 |
| `BEDROCK_MODEL` | | `us.anthropic.claude-opus-4-6-v1` | 교차 리전 추론 프로파일 ID. `us.` 접두사를 빼면 실패한다 |
| `PORT` | | `8080` | |
| `IP_MAX_REQUESTS` | | `10` | IP당 창(window) 내 최대 요청 |
| `IP_WINDOW_MS` | | `60000` | 창 길이 |
| `DAILY_TOKEN_CAP` | | `2000000` | 하루 토큰 상한 (KST 자정 리셋) |
| `MCP_ENABLED` | | `0` (꺼짐) | `1`이면 Azure·AWS 카테고리가 벤더 MCP 서버로 공식 문서를 조회한다 |
| `PRICE_INPUT_PER_1M` | | (없음) | 100만 입력 토큰당 USD. **비어 있으면 금액을 표시하지 않는다** — 지어내지 않기 위해서다 |
| `PRICE_OUTPUT_PER_1M` | | (없음) | 100만 출력 토큰당 USD |
| `PRICE_CACHE_WRITE_PER_1M` | | (없음) | 100만 캐시 **쓰기** 토큰당 USD. 입력과 요율이 다르다 |
| `PRICE_CACHE_READ_PER_1M` | | (없음) | 100만 캐시 **읽기** 토큰당 USD |

⚠ **AWS 자격증명은 환경변수로 넣지 않는다.** IAM Task Role이 자동 해석된다.
키를 넣는 순간 분리의 이점이 사라진다.

⚠ **기본값을 고쳐도 ECS 태스크 정의에 같은 이름이 박혀 있으면 그쪽이 이긴다.**
`deploy.yml`은 이미지를 밀고 `--force-new-deployment`만 하지 **태스크 정의는 건드리지 않는다.**
그래서 코드에서 리전·모델 기본값을 바꾸고 푸시해도, 태스크 정의에 옛 값이 남아 있으면
배포는 성공하는데 동작은 그대로다. 태스크 정의는 수정이 안 되고 새 revision을 등록하는
방식이므로, 현재 정의를 받아 읽기 전용 필드(`taskDefinitionArn`·`revision`·`status`·
`requiresAttributes`·`compatibilities`·`registeredAt`·`registeredBy`)를 떼고 환경변수만
갈아끼워 `register-task-definition` 한 뒤 `update-service --task-definition nexpert-tech:N`
으로 옮긴다. **옛 revision은 남으므로 되돌리기는 서비스를 옛 번호로 다시 가리키면 끝이다.**
확인은 CloudWatch 로그의 부팅 한 줄로 한다 — `listening on 8080 · bedrock=… · model=…`.

---

## 배포

```
git push → GitHub Actions → Docker 빌드 → ECR 푸시 → ECS 서비스 갱신
```

로컬에 Docker도 AWS CLI도 필요 없다. Actions가 OIDC로 IAM 역할을 빌려 쓴다 —
**GitHub에 장기 AWS 키를 저장하지 않는다.**

| 자원 | 값 |
|---|---|
| ECR | `774118824757.dkr.ecr.ap-northeast-2.amazonaws.com/nexpert-tech` |
| ECS 리전 | `ap-northeast-2` (서울) |
| Bedrock 리전 | `us-west-2` (오리건) |
| ECS 클러스터 · 서비스 | 둘 다 `nexpert-tech` (Fargate 0.5 vCPU · 1 GB, 태스크 1개) |
| ALB | `nexpert-tech-alb` — HTTPS 443 → 타깃 그룹 `nexpert-tech-tg`(IP 유형, 8080, `/health`) |
| 인증서 | ACM `tech.nexperts.co.kr` — **서울 리전**에 있어야 ALB에 붙는다 |
| 보안 그룹 | `nexpert-tech-alb-sg`(Cloudflare 대역만) → `nexpert-tech-task-sg`(ALB에서만 8080) |
| 로그 | CloudWatch `/ecs/nexpert-tech` |
| Task Role | `nexpert-tech-task-role` (Bedrock 호출 권한) |
| Task Execution Role | `ecsTaskExecutionRole` (ECR pull · 로그) |

⚠ 클러스터·서비스 이름이 `deploy.yml`의 `ECS_CLUSTER`·`ECS_SERVICE`와 **글자 하나까지
같아야 한다.** 다르면 배포가 "서비스가 아직 없습니다"라며 **성공으로 끝난다** — 실패로
표시되지 않으므로 새 코드가 안 올라간 걸 한참 모른다.

⚠ `ecsTaskExecutionRole`의 신뢰 정책에 걸린 리전 조건이 `ap-northeast-2`인지 확인한다.
다르면 태스크가 **"이미지를 못 받는다"**는 엉뚱한 증상으로 실패한다.

⚠ 태스크에 **퍼블릭 IP 할당을 켜 둔다.** 기본 VPC에는 NAT 게이트웨이가 없어서, 끄면
바깥으로 나갈 길이 없어 ECR에서 이미지를 못 받는다. 증상은 이미지 오류로 나타나지만
원인은 네트워크다. 인바운드는 `nexpert-tech-task-sg`가 ALB로 한정하므로 노출되지 않는다.

**과금은 트래픽이 아니라 시간에 붙는다.** Fargate는 Azure Container Apps와 달리 0으로
축소되지 않는다. 질문이 0건이어도 태스크 1개와 ALB가 상시 과금되어 **월 $40 안팎**이
기본으로 나간다(공시 요금 기준 어림값). 오래 쉬게 할 거면 서비스의 원하는 태스크를 0으로
내린다 — ALB 요금은 그래도 남는다.

---

## 모델 ID — 왜 Opus 5 가 아니라 4.6 인가

**이 계정은 Anthropic 최신 세대만 거절당한다.** 공급자 차단이 아니라 세대 경계다.
2026-08-20 에 `us-west-2` 에서 하나씩 쏴 보고 그은 선이다.

| 모델 | 결과 |
|---|---|
| Opus 5 · Sonnet 5 · Opus 4.8 · Opus 4.7 | `AccessDeniedException` — *is not available for this account* |
| **Opus 4.6 · Sonnet 4.6 · Opus 4.5 · Sonnet 4.5 · Haiku 4.5** | **정상 답변** |
| Claude 3 Haiku · Opus 4.1 | `ResourceNotFoundException` — *marked by provider as **Legacy*** (계정 문제 아님) |

그래서 기본 모델은 **`us.anthropic.claude-opus-4-6-v1`** 이다.
AWS 가 최신 세대를 열어 주면 `BEDROCK_MODEL` 을 `us.anthropic.claude-opus-5` 로
바꾸는 것으로 끝난다 — 코드는 건드릴 필요가 없다.

⚠ **`us.` 접두사를 빼지 마라.** 교차 리전 추론 프로파일 ID 다. 빼면 on-demand 경로를
찾지 못해 실패한다.

⚠ **`BEDROCK_REGION` 을 서울(`ap-northeast-2`)로 바꾸지 마라.** Claude 교차 리전 추론
할당량이 **서울만 0** 이다(us-west-2·us-east-2·eu-central-1·ap-northeast-1 은 30M).
지연시간이 아까워 보여도 여기서는 답이 아예 안 온다.

### `bedrock-mantle` 은 버렸다

예전 `server.js` 는 `AnthropicBedrockMantle` 로 `bedrock-mantle.{리전}.api.aws/anthropic`
에 붙었다. 그 접점은 **us-east-1 에만 존재**하고, 거기 Claude 할당량이 **0 으로 눌려 있어**
어떤 모델도 통과하지 못했다. 지금은 `AnthropicBedrock`(= `bedrock-runtime`)을 쓴다.

바뀐 것: `BEDROCK_PROJECT_ID` 와 `anthropic-workspace-id` 헤더가 **사라졌다.**
`bedrock-runtime` 에는 프로젝트(workspace) 개념이 없다. Messages API 형태는 같아서
스트리밍·시스템 블록·프롬프트 캐싱 코드는 한 줄도 안 바뀌었다.

**IAM 은 바꿀 게 없었다.** `nexpert-tech-task-role` 에 인라인 정책이 둘 붙어 있는데,
그중 `bedrock-invoke` 가 이미 `bedrock:InvokeModel` · `bedrock:InvokeModelWithResponseStream`
을 `Resource: "*"` 로 허용하고 있어 그대로 통과한다.

- `nexpert-tech-mantle-inference` — **이제 죽은 정책이다**(`bedrock-mantle:CreateInference`).
  당장 지워도 되지만 지운다고 뭐가 달라지지는 않는다.
- ⚠ `bedrock-invoke` 의 `Resource: "*"` 는 **좁히는 게 맞다.** 다만 교차 리전 프로파일은
  **프로파일 ARN 과 대상 리전들의 기반 모델 ARN 양쪽 모두**에 권한이 있어야 하고
  (`arn:aws:bedrock:us-west-2:…:inference-profile/us.anthropic.…` +
  `arn:aws:bedrock:{us-east-1,us-east-2,us-west-2}::foundation-model/anthropic.…`),
  한쪽만 주면 조용히 거절된다. 좁힐 때는 반드시 실제 호출로 확인한다.

### 여기까지 오는 데 일주일이 걸렸다 — 헛짚은 것들

원인은 **신규 계정이라 최신 세대 용량을 못 받은 것** 하나였다. AWS 가 할당량 거절
메일에서 *"리전 가용성, **계정 이력**, 사용 패턴"* 이라고 직접 말했다. 그 전까지 지운
가설을 남겨 둔다 — 같은 길을 다시 걷지 않기 위해서다.

| 헛짚은 것 | 어떻게 지워졌나 |
|---|---|
| 우리 코드·IAM·모델 ID·프로젝트 ID | 앱을 빼고 AWS 콘솔에서 쏴도 똑같이 거절 |
| "계정 자체가 막혀 있다" | Grok 4.3 이 정상 답변 |
| "Marketplace 경유 여부가 경계다" | OpenAI GPT-5.6 도 401 인데 AWS 의 비-Marketplace 목록에 있다 |
| "Anthropic 이면 전부 막힌다" | **Opus 4.6 이 답했다** |
| Marketplace 계약 부재 | API 로 계약 생성 성공(`agmt-2ekfpq9wa7zvxhd4m22et0o4`), 그래도 런타임은 거절 |
| 고객 확인·결제 수단·세금 설정 | 콘솔에서 확인 — 추가로 할 것이 없었다 |
| 할당량 증가 요청 | 자동 거절 (케이스 178721018200812) |
| 리전을 바꾸면 될 것 | 5개 리전 전부 같은 계정 단위 거절 |
| `Claude Platform on AWS` 로 우회 | Marketplace 구독 버튼 비활성 — `registration is incomplete or revoked` |

⚠ **`get-foundation-model-availability` 가 전부 `AVAILABLE` 이어도 호출은 실패할 수 있다.**
이 명령은 계약·권한을 볼 뿐 런타임 반영을 보증하지 않는다. Service Quotas 의 값도
마찬가지다 — 0 이 아니라고 쓸 수 있는 게 아니고, 그냥 **AWS 기본값이 보이는 것**일 뿐이다.
**판정은 언제나 실제 호출로 한다.**

⚠ **모델 하나의 실패를 계정 전체의 실패로 일반화하지 마라.** 이 세션에서 그렇게 두 번
결론 냈다가 두 번 틀렸다. 다른 공급자, 그리고 **같은 공급자의 다른 세대**를 각각 쏴 보면
30초에 갈린다.

같은 증상이 밖에도 보고돼 있다 —
[re:Post](https://repost.aws/questions/QU_-WCZSBLQyyYo2VBbkwrqA/amazon-bedrock-http-403-model-is-not-available-for-this-account-when-invoking-claude-fable-5-claude-sonnet-5-claude-opus-4-7-and-claude-opus-4-8),
[claude-code #51183](https://github.com/anthropics/claude-code/issues/51183).

### 이미 확인해서 아닌 것 (다시 돌지 마라)

| 확인한 것 | 결과 |
|---|---|
| 모델 ID / 프로젝트 ID / IAM / 우리 코드 | 전부 정상 — 콘솔 Workbench 도 똑같이 거절당한다 |
| Marketplace 계약 | 생성됨. 오퍼는 하나뿐이라 더 맺을 것도 없다 |
| `get-foundation-model-availability` | 네 항목 모두 `AVAILABLE`/`AUTHORIZED` |
| 고객 확인(Customer Verification) | **"완료할 필요가 없습니다"** — 요구 사항 없음 |
| 결제 수단 | 카드 등록됨 · 세금 설정에 사업자등록번호 입력됨 |
| 구세대 Claude (Opus 4.7 / Sonnet 5) | 같은 403 — 세대 문제가 아니다 |
| Claude Enterprise 상품 | 구독 버튼 정상 활성 — **Marketplace 전체가 막힌 것은 아니다** |

### 경계는 '공급자'다 — 모델을 여섯 개 찔러 보고 알아냈다

| 공급자 | 결과 |
|---|---|
| xAI (Grok 4.3) · Google (Gemma 4) · Alibaba (Qwen3) · DeepSeek (V3.2) | **정상** |
| **OpenAI** (GPT-5.6 Sol) | 401 |
| **Anthropic** (Claude 전 세대) | 403 |

되는 넷은 전부 오픈웨이트 모델이고, 막힌 둘은 **AWS Marketplace 를 통해 팔리는 상업
공급자**다. 계약 메일이 그 증거다 — 판매자 `Anthropic, PBC`, 상품 `prod-if5d653ow7ehg`
(Claude Opus 5, **Amazon Bedrock Edition**).

⚠ **모델 하나가 되는 것을 "계정 정상"의 근거로 삼지 마라.** 이 세션에서 Grok 하나가
답하는 것을 보고 "계정은 정상"이라고 두 번 결론 냈다가 두 번 틀렸다. **공급자를 흩어서
서너 개를 찔러 봐야 경계가 보인다** — Workbench 의 `Select up to 3 models` 로 30초면 된다.

⚠ AWS 문서(`model-access.html`)의 "Marketplace 를 거치지 않는 공급자" 목록에 OpenAI 가
들어 있지만 **그 목록은 최신 상품에 대해 낡았다.** 계약 메일에 찍힌 판매자·상품 ID 가 우선이다.

### 결론 — 계정이 Marketplace 거래를 못 하는 상태다

계약을 API 로 만든 것은 **UI 버튼을 우회한 것뿐**이다. 계약 레코드는 생겼지만 런타임이
사용권을 인정하려면 계정이 Marketplace 거래 가능 상태여야 한다. 그래서
`agreementAvailability: AVAILABLE` 인데 호출은 403 인 모순이 생긴다.

남은 단서는 `AWS account registration is incomplete or revoked` 배너 하나뿐이고,
**계정 화면 어디에도 우리가 채울 항목이 없다.** 콘솔에 노출되지 않는 내부 상태다 —
여기서부터는 AWS 만 풀 수 있다.

오류 문구가 안내하는 곳은 Support 가 아니라 **AWS Sales**(`aws.amazon.com/contact-us/sales-support/`)다.
베이직 플랜은 **기술 케이스를 못 연다** — '계정 및 결제'로 열어야 하고 그건 무료다.

이 사이트는 그것 하나 때문에 답변을 못 한다. 인프라는 전부 서 있다.
**모델 ID를 더 바꿔 보는 것은 시간 낭비다.**

---

## 헬스체크에 외부 의존을 넣지 마라

`/health`는 ALB가 주기적으로 때린다. 실패하면 태스크를 죽이고 재시작한다.
여기에 Bedrock 호출을 넣으면 **Bedrock이 잠깐 흔들렸을 때 멀쩡한 태스크가 재시작 루프에
빠진다.** 지금처럼 `200 ok`만 돌려준다.

---

## 제품 데이터의 정본은 여기가 아니다

`src/secui-data.js`는 **사본**이다. 정본은 `nexpert-admin` 저장소의 `src/product-brief.js`다.
벤더 자료가 바뀌면 그쪽을 먼저 고치고 여기로 옮긴다. 반대 방향은 금지.
