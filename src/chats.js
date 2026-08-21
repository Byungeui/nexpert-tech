// 대화 저장 — DynamoDB.
//
// ── 왜 DynamoDB 인가 ─────────────────────────────────────────────────
// EFS+SQLite 도 됐지만 마운트 설정과 파일 잠금이 따라온다. 태스크를 2개로 늘리는
// 날 SQLite 는 조용히 깨진다. DynamoDB 는 붙일 게 IAM 정책 하나뿐이고,
// 이 사용량(하루 수십 건)이면 비용도 사실상 없다.
//
// ── 키 설계 ──────────────────────────────────────────────────────────
//   PK user   = 검증된 이메일          → 남의 대화는 **질의 자체가 닿지 않는다**
//   SK chatId = 대화 ID
//
// 사용자를 파티션 키로 둔 게 이 파일의 보안 설계 전부다. 조회는 늘 `user` 로
// 시작하므로, 코드가 실수해도 다른 사람의 항목이 결과에 섞일 수가 없다.
//
// ⚠ **user 는 반드시 access.requireUser() 가 돌려준 값이어야 한다.**
//   검증되지 않은 이메일을 여기에 넘기면 위 보장이 통째로 사라진다.
//
// ── 자동 삭제 ────────────────────────────────────────────────────────
// 고객사 기술 문의가 서버에 영구히 쌓이지 않도록 TTL 을 건다(기본 90일).
// 마지막으로 손댄 시점 기준이라, 계속 쓰는 대화는 계속 남는다.

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient, QueryCommand, GetCommand, PutCommand,
  DeleteCommand, BatchWriteCommand,
} = require("@aws-sdk/lib-dynamodb");

const TABLE = process.env.CHATS_TABLE || "nexpert-tech-chats";
// ⚠ Bedrock 과 달리 여기는 **ECS 와 같은 리전**이다. 테이블을 서울에 만들었다.
const REGION = process.env.CHATS_REGION || process.env.AWS_REGION || "ap-northeast-2";
const TTL_DAYS = Number(process.env.CHATS_TTL_DAYS || 90);

// 한 항목은 400KB 를 넘을 수 없다. 넘으면 저장이 통째로 실패하므로
// **넘기 전에 오래된 메시지를 버린다.** 대화가 끊기는 것보다 앞부분이 잘리는 게 낫다.
const MAX_ITEM_BYTES = 300_000;
const MAX_MSGS = 200;

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

function ttlOf(updated) {
  return Math.floor(updated / 1000) + TTL_DAYS * 86_400;
}

// 목록에는 본문을 싣지 않는다. 50개 대화의 본문을 매번 받아오면 첫 화면이 느려진다.
async function list(user) {
  const out = await doc.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: "#u = :u",
    ExpressionAttributeNames: { "#u": "user", "#t": "title" },
    ExpressionAttributeValues: { ":u": user },
    ProjectionExpression: "chatId, cat, #t, created, updated, tokens",
  }));
  const items = out.Items || [];
  items.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  return items.map(toClient);
}

async function get(user, chatId) {
  const out = await doc.send(new GetCommand({
    TableName: TABLE,
    Key: { user, chatId },
  }));
  return out.Item ? toClient(out.Item, true) : null;
}

async function put(user, chat) {
  const msgs = trim(Array.isArray(chat.msgs) ? chat.msgs : []);
  const updated = Number(chat.updated) || Date.now();
  await doc.send(new PutCommand({
    TableName: TABLE,
    Item: {
      user,
      chatId: String(chat.id),
      cat: String(chat.cat || ""),
      title: String(chat.title || "새 대화").slice(0, 200),
      created: Number(chat.created) || updated,
      updated,
      tokens: sum(msgs),
      // 본문은 JSON 문자열 한 덩어리로 넣는다. DynamoDB 의 중첩 타입으로 풀어 넣으면
      // 속성 이름이 항목 크기에 반복해서 더해지고, 읽을 때 되돌리는 코드도 늘어난다.
      msgs: JSON.stringify(msgs),
      ttl: ttlOf(updated),
    },
  }));
}

async function remove(user, chatId) {
  await doc.send(new DeleteCommand({ TableName: TABLE, Key: { user, chatId } }));
}

async function clear(user) {
  const out = await doc.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: "#u = :u",
    ExpressionAttributeNames: { "#u": "user" },
    ExpressionAttributeValues: { ":u": user },
    ProjectionExpression: "chatId",
  }));
  const keys = (out.Items || []).map((i) => ({ user, chatId: i.chatId }));
  // BatchWrite 는 한 번에 25개까지다.
  for (let i = 0; i < keys.length; i += 25) {
    await doc.send(new BatchWriteCommand({
      RequestItems: {
        [TABLE]: keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })),
      },
    }));
  }
  return keys.length;
}

// 저장 항목 → 화면이 아는 모양. `user` 는 돌려주지 않는다(화면이 쓸 일이 없다).
function toClient(item, withMsgs = false) {
  const chat = {
    id: item.chatId,
    cat: item.cat,
    title: item.title,
    created: item.created,
    updated: item.updated,
    tokens: item.tokens || null,
  };
  if (withMsgs) {
    try {
      chat.msgs = JSON.parse(item.msgs || "[]");
    } catch {
      chat.msgs = [];   // 깨진 항목 하나 때문에 대화 목록 전체가 안 열리면 안 된다
    }
  }
  return chat;
}

// 개수와 크기 양쪽으로 자른다. 앞(오래된 쪽)부터 버린다.
function trim(msgs) {
  let out = msgs.slice(-MAX_MSGS);
  while (out.length > 2 && JSON.stringify(out).length > MAX_ITEM_BYTES) {
    out = out.slice(2);   // 질문·답변 한 쌍씩 버려야 짝이 어긋나지 않는다
  }
  return out;
}

// 목록 화면이 본문 없이도 사용량을 보여줄 수 있도록 미리 더해 둔다.
function sum(msgs) {
  const t = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const m of msgs) {
    const u = m && m.usage;
    if (!u) continue;
    t.input += u.input || 0;
    t.output += u.output || 0;
    t.cacheRead += u.cacheRead || 0;
    t.cacheWrite += u.cacheWrite || 0;
  }
  return t;
}

module.exports = { list, get, put, remove, clear, TABLE, REGION, TTL_DAYS };
