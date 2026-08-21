// 대화 보관 — 브라우저 localStorage.
//
// ── 왜 서버가 아니라 브라우저인가 ────────────────────────────────────
// 대화 본문은 개인적이고 덩치가 크다. 중앙에 있어야 의미가 생기는 것은
// "누가 얼마나 썼는가"(비용)뿐이고, 그건 서버가 CloudWatch 에 한 줄씩 따로 남긴다.
// 본문까지 서버로 가져가면 테이블·IAM·조회 API·삭제 권한이 한꺼번에 생기는데,
// 그 대가로 지금 얻는 것은 기기 간 동기화 하나뿐이다.
//
// ⚠ **그래서 이 저장소는 기기마다 따로다.** 폰과 PC의 대화가 이어지지 않는다.
//   브라우저 데이터를 지우면 함께 사라진다. 이것이 이 선택의 값이다.
//
// ⚠ **직원이 늘어 그게 문제가 되면 DynamoDB 로 승격한다.** 그때 아래 함수들의
//   이름과 반환 모양을 그대로 두고 안쪽만 fetch 로 바꾸면 app.js 는 한 줄도
//   안 고쳐도 된다. **그러라고 저장소를 app.js 밖으로 뺐다.**
//   (승격할 때 함께 볼 것: 서버는 이미 Access 신원을 알고 있다 — src/identity.js)

(function () {
  const KEY = "techdesk.v1";

  // localStorage 는 브라우저마다 5MB 안팎이다. 한계에 닿으면 저장이 **예외로**
  // 실패하는데, 그게 답변이 끝나는 순간이라 화면이 죽는다. 넉넉히 아래에서 끊고
  // 예외도 따로 잡는다.
  const MAX_CHATS = 50;
  const MAX_BYTES = 3_000_000;

  let db = { v: 1, chats: [] };

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.v === 1 && Array.isArray(parsed.chats)) db = parsed;
      }
    } catch {
      // 깨졌으면 그냥 버린다. **지난 대화 기록 때문에 사이트가 안 뜨면 안 된다.**
    }
    return db;
  }

  // 최신순으로 정렬해 두고, 안 들어가면 **오래된 것부터** 버려 가며 다시 시도한다.
  function save() {
    db.chats.sort((a, b) => b.updated - a.updated);
    for (;;) {
      try {
        const s = JSON.stringify(db);
        if (s.length <= MAX_BYTES && db.chats.length <= MAX_CHATS) {
          localStorage.setItem(KEY, s);
          return true;
        }
      } catch {
        // QuotaExceededError — 시크릿 모드처럼 저장 자체가 막힌 경우도 여기로 온다.
      }
      if (!db.chats.length) return false;   // 더 버릴 게 없으면 포기한다 (화면은 계속 쓴다)
      db.chats.pop();
    }
  }

  function uid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // 제목은 첫 질문에서 딴다. 사용자가 따로 붙이게 하면 아무도 안 붙인다.
  function titleOf(s) {
    const t = s.trim().replace(/\s+/g, " ");
    return t.length > 40 ? t.slice(0, 40) + "…" : t;
  }

  function list() { return db.chats.slice(); }
  function get(id) { return db.chats.find((c) => c.id === id) || null; }
  function latestFor(cat) { return db.chats.find((c) => c.cat === cat) || null; }

  function create(cat) {
    const now = Date.now();
    const chat = { id: uid(), cat, title: "새 대화", created: now, updated: now, msgs: [] };
    db.chats.unshift(chat);
    save();
    return chat;
  }

  function addMsg(id, role, content, usage) {
    const c = get(id);
    if (!c) return null;
    c.msgs.push(usage ? { role, content, usage } : { role, content });
    if (role === "user" && c.msgs.filter((m) => m.role === "user").length === 1) {
      c.title = titleOf(content);
    }
    c.updated = Date.now();
    save();
    return c;
  }

  function remove(id) {
    db.chats = db.chats.filter((c) => c.id !== id);
    save();
  }

  function clear() {
    db.chats = [];
    save();
  }

  // 사용량 합계. 비용은 **하나라도 모르면 전체를 null 로 둔다** — 일부만 더한
  // 금액을 보여주면 실제보다 싸 보인다.
  function sum(msgs) {
    const t = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 };
    let priced = true;
    let any = false;
    for (const m of msgs) {
      const u = m.usage;
      if (!u) continue;
      any = true;
      t.input += u.input || 0;
      t.output += u.output || 0;
      t.cacheRead += u.cacheRead || 0;
      t.cacheWrite += u.cacheWrite || 0;
      if (typeof u.costUsd === "number") t.costUsd += u.costUsd;
      else priced = false;
    }
    if (!priced || !any) t.costUsd = null;
    return t;
  }

  function totals(chat) { return sum(chat.msgs); }
  function allTotals() { return sum(db.chats.flatMap((c) => c.msgs)); }

  window.Store = { load, list, get, latestFor, create, addMsg, remove, clear, totals, allTotals };
})();
