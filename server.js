// 넥스퍼트시스템즈 보안장비 기술 Q&A — 서버
//
// ── 배포 형태 ────────────────────────────────────────────────────────
//   ALB(443) → ECS Fargate 태스크(8080) → Bedrock(us-east-1)
//
// ⚠ **자격증명을 코드에도 환경변수에도 두지 않는다.** ECS 태스크에 붙인
//   IAM Task Role 을 AWS SDK 가 컨테이너 자격증명 체인으로 자동 해석한다.
//   AnthropicBedrockMantle 에 키 인자를 넘기는 순간 그 이점이 사라지므로 넘기지 않는다.

const express = require("express");
const path = require("path");
const { AnthropicBedrockMantle } = require("@anthropic-ai/bedrock-sdk");
const { systemBlocks } = require("./src/grounding");
const limits = require("./src/limits");

const PORT = Number(process.env.PORT || 8080);
// ECS 는 서울(ap-northeast-2)에서 돌지만 Bedrock 은 us-east-1 이다.
// AWS_REGION 을 그대로 쓰면 서울로 요청이 가서 실패하므로 따로 받는다.
const BEDROCK_REGION = process.env.BEDROCK_REGION || "us-east-1";
const PROJECT_ID = process.env.BEDROCK_PROJECT_ID;
const MODEL = process.env.BEDROCK_MODEL || "anthropic.claude-opus-5";
const MAX_TOKENS = Number(process.env.MAX_TOKENS || 4096);
const MAX_HISTORY = 10;

if (!PROJECT_ID) {
  console.error("[fatal] BEDROCK_PROJECT_ID 가 없습니다 (콘솔의 anthropic-workspace-id).");
  process.exit(1);
}

const client = new AnthropicBedrockMantle({
  awsRegion: BEDROCK_REGION,
  defaultHeaders: { "anthropic-workspace-id": PROJECT_ID },
});

const app = express();
// ALB 뒤에 있다. 켜지 않으면 모든 요청의 IP 가 ALB 사설 IP 로 보여
// 레이트리밋이 전체 사용자에게 하나로 걸린다.
app.set("trust proxy", true);
app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.join(__dirname, "public")));

// ── 헬스체크 ────────────────────────────────────────────────────────
// ALB 가 이 경로를 주기적으로 때린다. 실패하면 태스크를 죽이고 재시작하므로
// **Bedrock 호출이나 외부 의존을 절대 넣지 않는다.** Bedrock 이 잠깐 흔들렸다고
// 멀쩡한 태스크가 재시작 루프에 빠지면 안 된다.
app.get("/health", (_req, res) => res.status(200).send("ok"));

// 운영 확인용. 사용량이 얼마나 찼는지 본다.
app.get("/api/status", (_req, res) => res.json(limits.status()));

app.post("/api/chat", async (req, res) => {
  const question = req.body?.question;
  const reason = limits.check(req, question);
  if (reason) return res.status(429).json({ error: reason });

  // 대화 이력은 클라이언트가 보낸다. 그대로 믿으면 토큰 폭탄이 되므로
  // 길이와 개수를 서버에서 자른다.
  const history = Array.isArray(req.body?.history) ? req.body.history : [];
  const messages = history
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  messages.push({ role: "user", content: question });

  // SSE. 답변이 길어 한 번에 못 기다리므로 토큰을 흘려보낸다.
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: "adaptive" },
      system: systemBlocks(),
      messages,
    });

    // 원시 이벤트를 직접 훑는다. text_delta 만 화면으로 보내면
    // 사고 과정(thinking_delta)은 자연히 걸러진다.
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        send("delta", event.delta.text);
      }
    }

    const final = await stream.finalMessage();
    limits.record(final.usage);
    send("done", {
      cacheRead: final.usage?.cache_read_input_tokens ?? 0,
      cacheWrite: final.usage?.cache_creation_input_tokens ?? 0,
      input: final.usage?.input_tokens ?? 0,
      output: final.usage?.output_tokens ?? 0,
    });
  } catch (e) {
    // 원인은 서버 로그에만 남긴다. 사용자에게 AWS 에러 원문을 보이면
    // 계정 번호나 역할 이름 같은 게 노출될 수 있다.
    console.error("[bedrock]", e?.name, e?.status, e?.message);
    send("error", "답변 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.");
  } finally {
    res.end();
  }
});

const server = app.listen(PORT, () => {
  console.log(`nexpert-tech listening on ${PORT} · bedrock=${BEDROCK_REGION} · model=${MODEL}`);
});

// ECS 는 배포 교체 때 SIGTERM 을 보내고 기본 30초 뒤 SIGKILL 한다.
// 그 사이 진행 중인 응답을 마치고 내려간다.
process.on("SIGTERM", () => {
  console.log("SIGTERM — 종료합니다");
  server.close(() => process.exit(0));
});
