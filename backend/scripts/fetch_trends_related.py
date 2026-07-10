#!/usr/bin/env python3
"""
Correlatos Google Trends (top + rising related queries) para seeds do negócio.
geo=BR — mesmo dado da tela Explorar (Consultas mais frequentes / em alta).

Implementação:
  1) pytrends (quando o Google não rate-limita)
  2) fallback HTTP nativo (mesmos endpoints /api/explore + relatedsearches)
  3) backend Node ainda tem fallback RSS se este script falhar

Desenhado para 1× por dia (cache no backend). JSON em stdout.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from urllib.parse import quote

DEFAULT_SEEDS = [
    "drone",
    "drone enterprise",
    "drones",
    "drone inspeção",
    "drone topografia",
    "dji enterprise",
]

SEED_DELAY_SEC = 2.5
RETRY_429_SLEEP = 8.0
# Em 429 o Google costuma bloquear a sessão inteira — 1 retry curto e segue (fallback RSS no Node).
MAX_SEED_ATTEMPTS = 2

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)


def _patch_urllib3_retry_compat():
    try:
        from urllib3.util import retry as retry_mod
        Retry = retry_mod.Retry
        if getattr(Retry, "_aerion_patched", False):
            return
        orig_init = Retry.__init__

        def patched_init(self, *args, **kwargs):
            if "method_whitelist" in kwargs:
                if "allowed_methods" not in kwargs:
                    kwargs["allowed_methods"] = kwargs.pop("method_whitelist")
                else:
                    kwargs.pop("method_whitelist", None)
            return orig_init(self, *args, **kwargs)

        Retry.__init__ = patched_init  # type: ignore[method-assign]
        Retry._aerion_patched = True  # type: ignore[attr-defined]
    except Exception:
        pass


_patch_urllib3_retry_compat()


def parse_args():
    p = argparse.ArgumentParser(description="Google Trends related queries")
    p.add_argument("--seeds", default="")
    p.add_argument("--geo", default="BR")
    p.add_argument("--timeframe", default="today 1-m")
    p.add_argument("--hl", default="pt-BR")
    p.add_argument("--max-per-seed", type=int, default=8)
    p.add_argument("--delay", type=float, default=SEED_DELAY_SEC)
    return p.parse_args()


def seed_list(raw: str) -> list[str]:
    if not raw or not raw.strip():
        return list(DEFAULT_SEEDS)
    out, seen = [], set()
    for part in raw.split(","):
        s = part.strip()
        if not s:
            continue
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
    return out or list(DEFAULT_SEEDS)


def safe_int(value):
    try:
        if value is None or (isinstance(value, float) and value != value):
            return None
        return int(float(value))
    except (TypeError, ValueError):
        return None


def item_from_query(query: str, value, kind: str, seed: str) -> dict | None:
    query = str(query or "").strip()
    if not query:
        return None
    change = None
    interest = None
    if kind == "rising":
        if isinstance(value, str):
            change = value
        else:
            n = safe_int(value)
            if n is not None:
                change = f"+{n}%" if n >= 0 else f"{n}%"
    else:
        interest = safe_int(value)
    return {
        "title": query,
        "kind": kind,
        "seed": seed,
        "interest": interest,
        "change": change,
        "traffic": change if kind == "rising" else (str(interest) if interest is not None else None),
        "pubDate": None,
        "picture": None,
        "news": [],
    }


def _is_rate_limit(err: Exception) -> bool:
    msg = str(err).lower()
    return "429" in msg or "rate" in msg or "too many" in msg or "too many requests" in msg


# ── pytrends path ─────────────────────────────────────────────

def fetch_via_pytrends(seed: str, geo: str, timeframe: str, hl: str, max_per_seed: int):
    from pytrends.request import TrendReq

    pt = TrendReq(hl=hl, tz=180, retries=0, backoff_factor=0.1)
    pt.build_payload([seed], cat=0, timeframe=timeframe, geo=geo, gprop="")
    related = pt.related_queries() or {}
    block = related.get(seed) or (related.get(list(related.keys())[0]) if related else None) or {}

    top_items, rising_items = [], []
    top_df, rising_df = block.get("top"), block.get("rising")

    if top_df is not None and getattr(top_df, "empty", True) is False:
        for _, row in top_df.head(max_per_seed).iterrows():
            it = item_from_query(row.get("query"), row.get("value"), "top", seed)
            if it:
                top_items.append(it)

    if rising_df is not None and getattr(rising_df, "empty", True) is False:
        for _, row in rising_df.head(max_per_seed).iterrows():
            it = item_from_query(row.get("query"), row.get("value"), "rising", seed)
            if it:
                rising_items.append(it)

    return top_items, rising_items


# ── native HTTP path (same widgets as UI) ─────────────────────

def _strip_google_json(text: str):
    text = text.lstrip()
    if text.startswith(")]}'"):
        text = text.split("\n", 1)[-1]
    return json.loads(text)


def _make_session(hl: str):
    import requests

    s = requests.Session()
    s.headers.update({
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": f"{hl},pt;q=0.9,en;q=0.8",
        "Referer": "https://trends.google.com/trends/explore",
    })
    # cookies / consent warm-up
    try:
        s.get(
            "https://trends.google.com/trends/explore",
            params={"geo": "BR"},
            timeout=25,
        )
    except Exception:
        pass
    return s


def fetch_via_http(session, seed: str, geo: str, timeframe: str, hl: str, max_per_seed: int):
    explore_req = {
        "comparisonItem": [{"keyword": seed, "geo": geo, "time": timeframe}],
        "category": 0,
        "property": "",
    }
    exp = session.get(
        "https://trends.google.com/trends/api/explore",
        params={
            "hl": hl,
            "tz": "180",
            "req": json.dumps(explore_req, separators=(",", ":")),
        },
        timeout=30,
    )
    if exp.status_code == 429:
        raise RuntimeError("HTTP 429 on explore")
    exp.raise_for_status()
    exp_data = _strip_google_json(exp.text)

    widgets = exp_data.get("widgets") or []
    related_widget = None
    for w in widgets:
        # RELATED_QUERIES widget
        if w.get("id") == "RELATED_QUERIES" or (
            isinstance(w.get("title"), str) and "related" in w.get("title", "").lower()
        ):
            related_widget = w
            break
        # fallback: request has keywordType QUERY + metrics TOP/RISING
        req = w.get("request") or {}
        metrics = req.get("metric") or []
        if req.get("keywordType") == "QUERY" and any(m in ("TOP", "RISING") for m in metrics):
            related_widget = w
            break

    if not related_widget:
        # last resort: any widget with token + request.restriction
        for w in widgets:
            if w.get("token") and (w.get("request") or {}).get("restriction"):
                if "RELATED" in str(w.get("id", "")).upper() or "related" in str(w.get("title", "")).lower():
                    related_widget = w
                    break

    if not related_widget:
        return [], []

    token = related_widget.get("token")
    req = related_widget.get("request")
    if not token or not req:
        return [], []

    rel = session.get(
        "https://trends.google.com/trends/api/widgetdata/relatedsearches",
        params={
            "hl": hl,
            "tz": "180",
            "req": json.dumps(req, separators=(",", ":")),
            "token": token,
        },
        timeout=30,
    )
    if rel.status_code == 429:
        raise RuntimeError("HTTP 429 on relatedsearches")
    rel.raise_for_status()
    rel_data = _strip_google_json(rel.text)

    top_items, rising_items = [], []
    # default structure: default.rankedList[0]=top, [1]=rising
    ranked = ((rel_data.get("default") or {}).get("rankedList")) or []
    for idx, block in enumerate(ranked):
        kind = "top" if idx == 0 else "rising"
        # sometimes keywordType / rankedKeyword
        rows = block.get("rankedKeyword") or []
        for row in rows[:max_per_seed]:
            q = (row.get("query") or (row.get("topic") or {}).get("title") or "")
            val = row.get("value")
            # rising: prefer formattedValue ("Aumento repentino", "Mais 2.100%")
            if kind == "rising":
                fmt = row.get("formattedValue")
                if fmt:
                    val = fmt
            it = item_from_query(q, val, kind, seed)
            if it:
                if kind == "top":
                    top_items.append(it)
                else:
                    rising_items.append(it)

    return top_items, rising_items


def fetch_one_seed(
    seed: str,
    geo: str,
    timeframe: str,
    hl: str,
    max_per_seed: int,
    session=None,
):
    """Tenta HTTP nativo (mais estável); fallback pytrends. Timeframe alternativo se vazio."""
    last_err = None
    # Uma janela principal + no máximo um fallback (evita rajada de 429)
    timeframes = [timeframe]
    if timeframe != "today 3-m":
        timeframes.append("today 3-m")

    if session is None:
        session = _make_session(hl)

    # 1) HTTP nativo (mesmos endpoints da UI)
    for tf in timeframes:
        try:
            top, rising = fetch_via_http(session, seed, geo, tf, hl, max_per_seed)
            if top or rising:
                return top, rising, "http"
        except Exception as e:
            last_err = e
            if _is_rate_limit(e):
                raise
            continue

    # 2) pytrends (só se HTTP não trouxe nada e sem 429)
    try:
        top, rising = fetch_via_pytrends(seed, geo, timeframe, hl, max_per_seed)
        if top or rising:
            return top, rising, "pytrends"
    except Exception as e:
        last_err = e
        if _is_rate_limit(e):
            raise

    if last_err:
        raise last_err
    return [], [], "http"


def fetch_related(seeds, geo, timeframe, hl, max_per_seed, delay):
    by_seed = {}
    flat = []
    errors = []
    methods_used = set()
    session = None
    try:
        session = _make_session(hl)
    except Exception as e:
        errors.append(f"session: {e}")

    rate_limited = False
    for i, seed in enumerate(seeds):
        if rate_limited:
            by_seed[seed] = {"top": [], "rising": [], "error": "skipped after 429"}
            continue
        if i > 0:
            time.sleep(max(1.0, delay))

        last_err = None
        for attempt in range(1, MAX_SEED_ATTEMPTS + 1):
            try:
                top_items, rising_items, method = fetch_one_seed(
                    seed, geo, timeframe, hl, max_per_seed, session
                )
                methods_used.add(method)
                by_seed[seed] = {
                    "top": [t["title"] for t in top_items],
                    "rising": [t["title"] for t in rising_items],
                    "top_detail": top_items,
                    "rising_detail": rising_items,
                    "method": method,
                }
                flat.extend(rising_items)
                flat.extend(top_items)
                last_err = None
                break
            except Exception as e:
                last_err = e
                if _is_rate_limit(e) and attempt < MAX_SEED_ATTEMPTS:
                    time.sleep(RETRY_429_SLEEP * attempt)
                    try:
                        session = _make_session(hl)
                    except Exception:
                        pass
                    continue
                break

        if last_err is not None:
            msg = f"{seed}: {type(last_err).__name__}: {last_err}"
            errors.append(msg)
            by_seed[seed] = {"top": [], "rising": [], "error": str(last_err)}
            if _is_rate_limit(last_err):
                rate_limited = True  # aborta seeds restantes (evita 2+ min de 429)

    seen = set()
    trends = []
    for item in flat:
        key = item["title"].casefold()
        if key in seen:
            continue
        seen.add(key)
        trends.append(item)

    ok = bool(trends)
    error = None
    if not ok:
        error = (
            "; ".join(errors[:6])
            if errors
            else "sem correlatos (volume baixo ou rate limit Google)"
        )
    elif errors:
        error = "; ".join(errors[:6])

    return {
        "ok": ok,
        "error": error,
        "geo": geo,
        "source": "pytrends_related" if "pytrends" in methods_used else "trends_related_http",
        "methods": sorted(methods_used),
        "timeframe": timeframe,
        "seeds": seeds,
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "trends": trends,
        "by_seed": by_seed,
        "partial_errors": errors,
    }


def main():
    args = parse_args()
    seeds = seed_list(args.seeds)
    # Avisa se requests/pytrends faltam
    try:
        import requests  # noqa: F401
    except ImportError:
        json.dump(
            {
                "ok": False,
                "error": "requests não instalado. Rode: python -m pip install requests pytrends pandas",
                "trends": [],
                "seeds": seeds,
            },
            sys.stdout,
            ensure_ascii=False,
        )
        sys.stdout.write("\n")
        sys.exit(2)

    result = fetch_related(
        seeds=seeds,
        geo=args.geo or "BR",
        timeframe=args.timeframe or "today 1-m",
        hl=args.hl or "pt-BR",
        max_per_seed=max(1, min(args.max_per_seed, 25)),
        delay=float(args.delay or SEED_DELAY_SEC),
    )
    json.dump(result, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    sys.exit(0 if result.get("trends") else 2)


if __name__ == "__main__":
    main()
