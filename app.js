(() => {
  const AWAKE = ["08:00", "23:00"];

  const state = {
    youTz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    them: null,
  };

  const els = {
    cityQ: document.getElementById("city-q"),
    suggest: document.getElementById("suggest"),
    youPicked: document.getElementById("you-picked"),
    themPicked: document.getElementById("them-picked"),
    result: document.getElementById("result"),
    meta: document.getElementById("meta"),
    youHead: document.getElementById("you-head"),
    themHead: document.getElementById("them-head"),
    youBar: document.getElementById("you-bar"),
    themBar: document.getElementById("them-bar"),
    chart: document.getElementById("chart"),
    now: document.getElementById("now"),
    nowYou: document.getElementById("now-you"),
    nowThem: document.getElementById("now-them"),
    youTicks: document.getElementById("you-ticks"),
    themTicks: document.getElementById("them-ticks"),
    status: document.getElementById("status"),
  };

  let suggestTimer = null;
  let suggestSeq = 0;

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function todayISOInTZ(timeZone) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
        .formatToParts(new Date())
        .filter((p) => p.type !== "literal")
        .map((p) => [p.type, p.value])
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function ymdInZone(date, timeZone) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
        .formatToParts(date)
        .filter((p) => p.type !== "literal")
        .map((p) => [p.type, p.value])
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function hmInZone(date, timeZone) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
        .formatToParts(date)
        .filter((p) => p.type !== "literal")
        .map((p) => [p.type, p.value])
    );
    let h = parts.hour;
    if (h === "24") h = "00";
    return `${h}:${parts.minute}`;
  }

  function addDaysYmd(ymd, n) {
    const [y, m, d] = ymd.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  }

  function eachYmd(startYmd, endYmd) {
    const out = [];
    let cur = startYmd;
    while (cur <= endYmd) {
      out.push(cur);
      cur = addDaysYmd(cur, 1);
    }
    return out;
  }

  function zonedTimeToUtc(dateStr, timeStr, timeZone) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const [hh, mm] = timeStr.split(":").map(Number);
    const utcGuess = Date.UTC(y, m - 1, d, hh, mm, 0);
    let t = utcGuess;
    for (let i = 0; i < 3; i++) {
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-US", {
          timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        })
          .formatToParts(new Date(t))
          .filter((p) => p.type !== "literal")
          .map((p) => [p.type, p.value])
      );
      let hour = Number(parts.hour);
      if (hour === 24) hour = 0;
      const asUTC = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        hour,
        Number(parts.minute),
        Number(parts.second)
      );
      const wanted = Date.UTC(y, m - 1, d, hh, mm, 0);
      t = t + (wanted - asUTC);
    }
    return new Date(t);
  }

  function placeLabel(p) {
    const region = p.admin1 && p.admin1 !== p.name ? p.admin1 : "";
    return [p.name, region, p.country].filter(Boolean).join(", ");
  }

  function awakeRanges(timeZone, winStart, winEnd) {
    const ranges = [];
    const startYmd = addDaysYmd(ymdInZone(winStart, timeZone), -1);
    const endYmd = addDaysYmd(ymdInZone(new Date(winEnd.getTime() - 1), timeZone), 1);
    for (const ymd of eachYmd(startYmd, endYmd)) {
      const a = zonedTimeToUtc(ymd, AWAKE[0], timeZone).getTime();
      const b = zonedTimeToUtc(ymd, AWAKE[1], timeZone).getTime();
      const s = Math.max(a, winStart.getTime());
      const e = Math.min(b, winEnd.getTime());
      if (e > s) ranges.push([s, e]);
    }
    return ranges;
  }

  function intersect(a, b) {
    const out = [];
    for (const [as, ae] of a) {
      for (const [bs, be] of b) {
        const s = Math.max(as, bs);
        const e = Math.min(ae, be);
        if (e > s) out.push([s, e]);
      }
    }
    out.sort((x, y) => x[0] - y[0]);
    return out;
  }

  function covers(ranges, t) {
    return ranges.some(([s, e]) => t >= s && t < e);
  }

  function buildSegments(winStart, winEnd, awake) {
    const events = [winStart, winEnd];
    for (const [a, b] of awake) {
      if (a > winStart && a < winEnd) events.push(a);
      if (b > winStart && b < winEnd) events.push(b);
    }
    events.sort((a, b) => a - b);
    const segs = [];
    for (let i = 0; i < events.length - 1; i++) {
      const a = events[i];
      const b = events[i + 1];
      if (b <= a) continue;
      const mid = (a + b) / 2;
      segs.push({ start: a, end: b, awake: covers(awake, mid) });
    }
    return segs;
  }

  function renderBar(barEl, segs, winStart, winEnd) {
    barEl.innerHTML = "";
    const total = winEnd - winStart;
    for (const s of segs) {
      const div = document.createElement("div");
      div.className = "seg " + (s.awake ? "awake" : "asleep");
      div.style.width = ((s.end - s.start) / total) * 100 + "%";
      barEl.appendChild(div);
    }
  }

  function renderNow(winStart, winEnd, themTz) {
    const now = Date.now();
    if (now < winStart || now > winEnd) {
      els.now.hidden = true;
      return;
    }
    const pct = ((now - winStart) / (winEnd - winStart)) * 100;
    els.now.hidden = false;
    els.now.style.left = pct + "%";
    els.now.classList.toggle("flip", pct > 72);
    els.nowYou.textContent = hmInZone(new Date(now), state.youTz);
    els.nowThem.textContent = hmInZone(new Date(now), themTz);
    const chart = els.chart.getBoundingClientRect();
    const youTop = els.youBar.getBoundingClientRect().top - chart.top;
    const themTop = els.themBar.getBoundingClientRect().top - chart.top;
    els.nowYou.style.top = youTop + "px";
    els.nowThem.style.top = themTop + "px";
  }

  function renderTicks(tickEl, winStart, winEnd, timeZone) {
    tickEl.innerHTML = "";
    const n = 5;
    for (let i = 0; i < n; i++) {
      const t = new Date(winStart + ((winEnd - winStart) * i) / (n - 1));
      const span = document.createElement("span");
      span.textContent = hmInZone(t, timeZone);
      tickEl.appendChild(span);
    }
  }

  function fmtRanges(ranges, timeZone) {
    return ranges
      .map(([a, b]) => `${hmInZone(new Date(a), timeZone)}–${hmInZone(new Date(b), timeZone)}`)
      .join(", ");
  }

  function render() {
    const them = state.them;
    if (!them) {
      els.result.hidden = true;
      return;
    }

    const today = todayISOInTZ(state.youTz);
    const winStart = zonedTimeToUtc(today, "00:00", state.youTz).getTime();
    const winEnd = zonedTimeToUtc(addDaysYmd(today, 1), "00:00", state.youTz).getTime();

    const youAwake = awakeRanges(state.youTz, new Date(winStart), new Date(winEnd));
    const themAwake = awakeRanges(them.timezone, new Date(winStart), new Date(winEnd));
    const both = intersect(youAwake, themAwake);

    els.youHead.textContent = "you  " + state.youTz;
    els.themHead.textContent = them.name;
    els.result.hidden = false;
    renderBar(els.youBar, buildSegments(winStart, winEnd, youAwake), winStart, winEnd);
    renderBar(els.themBar, buildSegments(winStart, winEnd, themAwake), winStart, winEnd);
    renderNow(winStart, winEnd, them.timezone);
    renderTicks(els.youTicks, winStart, winEnd, state.youTz);
    renderTicks(els.themTicks, winStart, winEnd, them.timezone);

    els.meta.textContent = both.length
      ? `both awake ${fmtRanges(both, state.youTz)} your time · ${fmtRanges(both, them.timezone)} there`
      : "no shared awake hours today";

    els.status.textContent = "";
  }

  function setThem(place) {
    state.them = place;
    if (!place) {
      els.themPicked.textContent = "—";
      els.themPicked.classList.remove("ok");
      els.result.hidden = true;
      return;
    }
    els.cityQ.value = place.name;
    els.themPicked.textContent = `${placeLabel(place)}\n${place.timezone}`;
    els.themPicked.classList.add("ok");
    render();
  }

  async function searchCities(query) {
    const url =
      "https://geocoding-api.open-meteo.com/v1/search?" +
      new URLSearchParams({
        name: query,
        count: "8",
        language: "en",
        format: "json",
      });
    const res = await fetch(url);
    if (!res.ok) throw new Error("city lookup failed");
    const data = await res.json();
    return (data.results || [])
      .filter((r) => r.timezone && r.name)
      .sort((a, b) => (b.population || 0) - (a.population || 0));
  }

  function showSuggest(hits) {
    els.suggest.innerHTML = "";
    if (!hits.length) {
      els.suggest.hidden = true;
      return;
    }
    for (const place of hits) {
      const li = document.createElement("li");
      li.innerHTML = `${escapeHtml(place.name)} <span>${escapeHtml(place.admin1 || place.country || "")}</span>`;
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        els.suggest.hidden = true;
        setThem(place);
      });
      els.suggest.appendChild(li);
    }
    els.suggest.hidden = false;
  }

  function wire() {
    els.cityQ.addEventListener("input", () => {
      clearTimeout(suggestTimer);
      const q = els.cityQ.value.trim();
      if (q.length < 2) {
        els.suggest.hidden = true;
        return;
      }
      const seq = ++suggestSeq;
      suggestTimer = setTimeout(async () => {
        try {
          const hits = await searchCities(q);
          if (seq !== suggestSeq) return;
          showSuggest(hits);
        } catch (err) {
          if (seq !== suggestSeq) return;
          els.status.textContent = err.message || String(err);
          els.status.classList.add("err");
        }
      }, 160);
    });

    els.cityQ.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const first = els.suggest.querySelector("li");
        if (first && !els.suggest.hidden) {
          e.preventDefault();
          first.dispatchEvent(new Event("mousedown"));
        }
      }
      if (e.key === "Escape") els.suggest.hidden = true;
    });

    els.cityQ.addEventListener("blur", () => {
      setTimeout(() => {
        els.suggest.hidden = true;
      }, 150);
    });
  }

  async function init() {
    els.youPicked.textContent = `${state.youTz}\n${AWAKE[0]}–${AWAKE[1]}`;
    wire();
    setInterval(() => {
      if (state.them) render();
    }, 30000);
    els.status.textContent = "loading Austin…";
    const hits = await searchCities("Austin");
    const austin =
      hits.find((r) => r.country_code === "US" && r.name === "Austin") || hits[0];
    if (!austin) throw new Error("could not find Austin");
    setThem(austin);
  }

  init().catch((err) => {
    els.status.textContent = err.message || String(err);
    els.status.classList.add("err");
  });
})();
