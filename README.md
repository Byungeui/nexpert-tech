# NEXPERT Tech — 보안장비 기술 Q&A

방화벽·IPS·네트워크 보안 기술 질문에 답하는 사이트. Amazon Bedrock의 Claude Opus 5를 쓴다.

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

## 답변 근거를 세 갈래로 나눈 이유

`src/grounding.js`가 이 서비스의 핵심이다. 질문을 세 범주로 나눠 각각 다르게 답한다.

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
| `BEDROCK_PROJECT_ID` | ✅ | — | 콘솔의 `anthropic-workspace-id` (`proj_…`). 없으면 부팅 실패 |
| `BEDROCK_REGION` | | `us-east-1` | **Bedrock 리전.** ECS는 서울이지만 Bedrock은 여기다 |
| `BEDROCK_MODEL` | | `anthropic.claude-opus-5` | Bedrock 모델 ID는 `anthropic.` 접두사가 붙는다 |
| `PORT` | | `8080` | |
| `IP_MAX_REQUESTS` | | `10` | IP당 창(window) 내 최대 요청 |
| `IP_WINDOW_MS` | | `60000` | 창 길이 |
| `DAILY_TOKEN_CAP` | | `2000000` | 하루 토큰 상한 (KST 자정 리셋) |

⚠ **AWS 자격증명은 환경변수로 넣지 않는다.** IAM Task Role이 자동 해석된다.
키를 넣는 순간 분리의 이점이 사라진다.

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
| Bedrock 리전 | `us-east-1` |
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

## 모델 ID — `bedrock-mantle`과 `bedrock-runtime`은 다른 서비스다

`server.js`가 쓰는 `AnthropicBedrockMantle`은 `bedrock-mantle.{리전}.api.aws/anthropic`에
붙는다. Bedrock 콘솔이 보여주는 모델 카탈로그·추론 프로파일은 **`bedrock-runtime` 쪽**이라
서로 다른 접점이다. **콘솔에서 본 ID를 그대로 여기 넣으면 안 된다** — 실제로 넣어 봤고
`global.anthropic.claude-opus-5`는 404였다.

에러 종류로 구분이 된다. 추측하지 말고 이걸 본다.

| 응답 | 뜻 |
|---|---|
| **404** `not_found_error` — *does not exist* | 이 접점이 **모르는 이름**이다 (예: 접두사 없는 `claude-opus-5`) |
| **403** `permission_error` — *is not available for this account* | 이름은 **알아듣고** 계정에 권한이 없다 |

즉 `anthropic.` 접두사가 붙은 형태가 이 접점이 아는 이름이다.

⚠ IAM 액션도 `bedrock:InvokeModel*`이 아니라 **`bedrock-mantle:CreateInference`** 다.
리소스는 프로젝트 ARN(`arn:aws:bedrock-mantle:us-east-1:…:project/proj_…`)으로 좁혀 둔다.
`"Resource": "*"`로 열지 않는다.

### 2026-08 현재 — 계정 자체가 막혀 있다

Anthropic 모델 호출이 전부 403이다. **모델이나 IAM 문제가 아니다.** AWS Marketplace가
`AWS account registration is incomplete or revoked`를 표시하고, **루트 계정으로 연
Bedrock Playground에서도 같은 에러**가 난다. 결제 수단·연락처·세금 등록을 채워도 남아
있어서 AWS Support 케이스(계정 및 결제)를 열어 둔 상태다.

이 사이트는 그것 하나 때문에 답변을 못 한다. 인프라는 전부 서 있다.
**모델 ID를 더 바꿔 보는 것은 시간 낭비다** — 계정이 열리면 `anthropic.claude-opus-5`로
그냥 될 가능성이 높다.

---

## 헬스체크에 외부 의존을 넣지 마라

`/health`는 ALB가 주기적으로 때린다. 실패하면 태스크를 죽이고 재시작한다.
여기에 Bedrock 호출을 넣으면 **Bedrock이 잠깐 흔들렸을 때 멀쩡한 태스크가 재시작 루프에
빠진다.** 지금처럼 `200 ok`만 돌려준다.

---

## 제품 데이터의 정본은 여기가 아니다

`src/secui-data.js`는 **사본**이다. 정본은 `nexpert-admin` 저장소의 `src/product-brief.js`다.
벤더 자료가 바뀌면 그쪽을 먼저 고치고 여기로 옮긴다. 반대 방향은 금지.
