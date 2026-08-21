// 대화 보관 — 서버(DynamoDB)가 정본, localStorage 는 사본.
//
// ── 왜 서버로 옮겼는가 ───────────────────────────────────────────────
// 처음에는 브라우저에만 뒀다. 중앙에 있어야 의미가 생기는 건 비용뿐이고 본문은
// 개인적이라고 봤기 때문이다. 그런데 **폰과 PC가 이어지지 않는다**는 것이 실제로
// 걸렸고, iPhone Safari 는 한동안 방문이 없으면 이 저장소를 정리해 버린다 —
// 불편의 문제가 아니라 **기록을 잃는 문제**였다. 그래서 서버로 올렸다.
//
// ── 그런데도 localStorage 를 남긴 이유 ───────────────────────────────
// 서버 쓰기가 실패한 순간에도 방금 받은 답변은 화면에 있다. 사본이 없으면 그게
// 그대로 사라진다. 그래서 **쓸 때는 항상 양쪽에 쓰고**, 서버에 못 올린 대화의 id 를
// `pending` 에 적어 뒀다가 다음 접속 때 올린다.
//
// ⚠ **사본에 있는 걸 전부 올리지는 않는다.** pending 에 적힌 것만 올린다.
//   전부 올리면 A 브라우저에서 지운 대화가 B 브라우저의 낡은 사본에서 되살아난다.
//
// ⚠ 서버가 꺼져 있으면(설정 없음) 예전처럼 브라우저 저장만 쓴다. 기능이 하나 줄 뿐
//   사이트는 그대로 돈다.

(function () {
  const KEY = "techdesk.v1";
  const PENDING = "techdesk.pending.v1";
  const MIGRATED = "techdesk.migrated.v1";

  // 사본이므로 넉넉히 아래에서 끊는다. localStorage 는 5MB 안팎이고, 한계에 닿으면
  // **예외로** 실패한다 — 그게 답변이 끝나는 순간이라 잡지 않으면 화면이 죽는다.
  const MAX_CHATS = 50;
  const MAX_BYTES = 3_000_000;

  let mirror = { v: 1, chats: [] };   // localStorage 사본
  let items = [];                     // 지금 쓰는 목록 (서버 모드면 서버가 준 요약)
  let online = false;                 // 서버 저장이 켜져 있는가
  let degraded = false;               // 켜져 있는데 방금 실패했는가

  // ── localStorage ──────────────────────────────────────────────────
  function loadMirror() {
    try {
      const raw = localStorage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && parsed.v === 1 && Array.isArray(parsed.chats)) mirror = parsed;
    } catch {
      // 깨졌으면 버린다. **지난 대화 기록 때문에 사이트가 안 뜨면 안 된다.**
    }
    return mirror;
  }

  function saveMirror() {
    mirror.chats.sort((a, b) => b.updated - a.updated);
    for (;;) {
      try {
        const s = JSON.stringify(mirror);
        if (s.length <= MAX_BYTES && mirror.chats.length <= MAX_CHATS) {
          localStorage.setItem(KEY, s);
          return true;
        }
      } catch {
        // QuotaExceededError, 시크릿 모드 등
      }
      if (!mirror.chats.length) return false;
      mirror.chats.pop();   // 오래된 것부터 버린다
    }
  }

  function mirrorPut(chat) {
    const i = mirror.chats.findIndex((c) => c.id === chat.id);
    const copy = JSON.parse(JSON.stringify(chat));
    if (i === -1) mirror.chats.unshift(copy); else mirror.chats[i] = copy;
    saveMirror();
  }

  function mirrorDrop(id) {
    mirror.chats = mirror.chats.filter((c) => c.id !== id);
    saveMirror();
  }

  function pending(next) {
    if (next !== undefined) {
      try { localStorage.setItem(PENDING, JSON.stringify(next)); } catch { /* 사본일 뿐이다 */ }
      return next;
    }
    try { return JSON.parse(localStorage.getItem(PENDING) || "[]"); } catch { return []; }
  }

  function markPending(id) {
    const p = pending();
    if (!p.includes(id)) pending(p.concat(id));
  }

  // ── 서버 ──────────────────────────────────────────────────────────
  async function api(method, path, body) {
    const res = await fetch(`/api/chats${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
    return res.json();
  }

  // ── 시작 ──────────────────────────────────────────────────────────
  async function init(serverOn) {
    loadMirror();
    online = !!serverOn;

    if (!online) {
      items = mirror.chats;
      return;
    }

    try {
      items = (await api("GET", "")).chats;
    } catch (e) {
      // 서버가 켜져 있다는데 못 읽었다. 사본으로라도 계속 쓴다.
      console.warn("[store] 서버 목록을 못 받았습니다 —", e.message);
      online = false;
      degraded = true;
      items = mirror.chats;
      return;
    }

    // 처음 한 번: 브라우저에만 있던 대화를 서버로 올릴 대상으로 표시한다.
    if (!localStorage.getItem(MIGRATED)) {
      const known = new Set(items.map((c) => c.id));
      for (const c of mirror.chats) if (!known.has(c.id)) markPending(c.id);
      try { localStorage.setItem(MIGRATED, "1"); } catch { /* 사본일 뿐이다 */ }
    }

    await flush();
  }

  // 서버에 못 올린 것들을 올린다. 실패해도 조용히 다음 기회로 미룬다.
  async function flush() {
    const left = [];
    for (const id of pending()) {
      const chat = mirror.chats.find((c) => c.id === id);
      if (!chat) continue;   // 사본에도 없으면 올릴 게 없다
      try {
        await api("PUT", `/${encodeURIComponent(id)}`, chat);
        if (!items.some((c) => c.id === id)) items.unshift(summary(chat));
      } catch {
        left.push(id);
      }
    }
    pending(left);
    if (left.length) degraded = true;
    items.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  }

  function summary(chat) {
    return {
      id: chat.id, cat: chat.cat, title: chat.title,
      created: chat.created, updated: chat.updated, tokens: sum(chat.msgs || []),
    };
  }

  // ── 목록·조회 ─────────────────────────────────────────────────────
  function list() { return items.slice(); }
  function latestFor(cat) { return items.find((c) => c.cat === cat) || null; }

  // 목록에는 본문이 없다. 열 때 받아온다.
  async function get(id) {
    const found = items.find((c) => c.id === id);
    if (!found) return null;
    if (Array.isArray(found.msgs)) return found;

    if (online) {
      try {
        const { chat } = await api("GET", `/${encodeURIComponent(id)}`);
        Object.assign(found, chat);
        mirrorPut(found);
        return found;
      } catch (e) {
        console.warn("[store] 본문을 못 받았습니다 —", e.message);
        degraded = true;
      }
    }
    const local = mirror.chats.find((c) => c.id === id);
    if (local && Array.isArray(local.msgs)) { Object.assign(found, local); return found; }
    found.msgs = [];
    return found;
  }

  // ── 쓰기 ──────────────────────────────────────────────────────────
  function uid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // 제목은 첫 질문에서 딴다. 사용자가 붙이게 하면 아무도 안 붙인다.
  function titleOf(s) {
    const t = s.trim().replace(/\s+/g, " ");
    return t.length > 40 ? t.slice(0, 40) + "…" : t;
  }

  // 아직 저장하지 않는다. 열어만 보고 안 물으면 빈 대화가 목록에 쌓인다.
  function create(cat) {
    const now = Date.now();
    return { id: uid(), cat, title: "새 대화", created: now, updated: now, msgs: [] };
  }

  async function addMsg(chat, role, content, usage) {
    chat.msgs = chat.msgs || [];
    chat.msgs.push(usage ? { role, content, usage } : { role, content });
    if (role === "user" && chat.msgs.filter((m) => m.role === "user").length === 1) {
      chat.title = titleOf(content);
    }
    chat.updated = Date.now();

    if (!items.some((c) => c.id === chat.id)) items.unshift(chat);
    items.sort((a, b) => (b.updated || 0) - (a.updated || 0));

    // ⚠ 사본 먼저 쓴다. 서버가 실패해도 방금 받은 답변이 남아 있어야 한다.
    mirrorPut(chat);

    if (!online) return true;
    try {
      await api("PUT", `/${encodeURIComponent(chat.id)}`, chat);
      degraded = false;
      return true;
    } catch (e) {
      console.warn("[store] 서버 저장 실패 —", e.message);
      markPending(chat.id);
      degraded = true;
      return false;
    }
  }

  async function remove(id) {
    items = items.filter((c) => c.id !== id);
    mirrorDrop(id);
    pending(pending().filter((p) => p !== id));
    if (!online) return;
    try { await api("DELETE", `/${encodeURIComponent(id)}`); }
    catch (e) { console.warn("[store] 서버 삭제 실패 —", e.message); degraded = true; }
  }

  async function clear() {
    items = [];
    mirror.chats = [];
    saveMirror();
    pending([]);
    if (!online) return;
    try { await api("DELETE", ""); }
    catch (e) { console.warn("[store] 서버 전체 삭제 실패 —", e.message); degraded = true; }
  }

  // ── 사용량 ────────────────────────────────────────────────────────
  // **토큰만 더한다.** 금액은 저장하지 않고 표시할 때 요율로 계산한다(app.js 의 costOf).
  // 요율이 선형이라 "토큰 합계 × 요율"과 "답변별 금액의 합"은 같다.
  function sum(msgs) {
    const t = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    for (const m of msgs || []) {
      const u = m && m.usage;
      if (!u) continue;
      t.input += u.input || 0;
      t.output += u.output || 0;
      t.cacheRead += u.cacheRead || 0;
      t.cacheWrite += u.cacheWrite || 0;
    }
    return t;
  }

  // 본문을 아직 안 받아온 대화는 서버가 미리 더해 준 값을 쓴다.
  function totals(chat) {
    if (Array.isArray(chat.msgs)) return sum(chat.msgs);
    return chat.tokens || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  }

  function allTotals() {
    const t = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    for (const c of items) {
      const s = totals(c);
      t.input += s.input; t.output += s.output;
      t.cacheRead += s.cacheRead; t.cacheWrite += s.cacheWrite;
    }
    return t;
  }

  window.Store = {
    init, list, get, latestFor, create, addMsg, remove, clear, totals, allTotals,
    get online() { return online; },
    get degraded() { return degraded; },
  };
})();
