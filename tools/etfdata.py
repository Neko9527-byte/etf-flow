# -*- coding: utf-8 -*-
"""数据集读写与合并的公共逻辑。

数据结构：
{
  "meta": {...},
  "dates": ["YYYY-MM-DD", ...],           # 升序、唯一
  "categories": [
     {"id": "1_宽基市场", "name": "1.宽基市场", "color": "#D16F3F",
      "series": [{"name": "A股大盘", "color": "#...", "values": [float, ...]}]}
  ]
}
values 与 dates 等长，缺失用 0.0。
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "etf_flow.json"


def find_array(text: str) -> str:
    start = text.index("var CHARTS")
    start = text.index("[", start)
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    raise ValueError("CHARTS 数组不完整")


def parse_page(text: str) -> dict:
    """解析原站页面，返回 {dates, categories}（不含 meta）。"""
    charts = json.loads(find_array(text))
    sections = []
    for m in re.finditer(
        r'<section class="cat[^"]*" id="([^"]+)"><h2 style="border-left-color:(#[0-9A-Fa-f]{6})">([^<]+)</h2>',
        text,
    ):
        sections.append({"id": m.group(1), "color": m.group(2), "name": m.group(3).strip()})
    if not sections:
        raise ValueError("未找到分类区块，页面结构可能已变化")

    by_cat = {}
    for cfg in charts:
        cid, cidx = cfg["id"].rsplit("_c", 1)
        by_cat.setdefault(cid, {})[cidx] = cfg

    dates = None
    cats = []
    for sec in sections:
        base = by_cat.get(sec["id"], {}).get("1")
        if not base:
            continue
        if dates is None:
            dates = base["dates"]
        series = []
        for s in base["series"]:
            vals = [float(v) if v is not None else 0.0 for v in s["values"]]
            if len(vals) != len(dates):
                raise ValueError(f"{sec['id']}/{s['name']} 长度不一致")
            series.append({"name": s["name"], "color": s["color"], "values": vals})
        cats.append({"id": sec["id"], "name": sec["name"], "color": sec["color"], "series": series})

    if not dates or not cats:
        raise ValueError("页面中没有有效数据")
    return {"dates": dates, "categories": cats}


def load() -> dict:
    return json.loads(DATA_FILE.read_text(encoding="utf-8"))


def save(data: dict) -> None:
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )


def to_dataset(parsed: dict, meta: dict | None = None) -> dict:
    dates = parsed["dates"]
    meta = dict(meta or {})
    meta.update(
        {
            "title": meta.get("title", "ETF 细分行业资金流向"),
            "unit": "亿份",
            "source": "交易所公开接口（原站：B站生炸瓜）",
            "first_date": dates[0],
            "last_date": dates[-1],
            "days": len(dates),
        }
    )
    return {"meta": meta, "dates": dates, "categories": parsed["categories"]}


def merge(old: dict, new: dict) -> tuple[dict, list[str]]:
    """把新抓取的页面合并进旧数据集，返回 (数据集, 变化日志)。

    - 日期取并集并升序：保留原站滚动窗口之外更早的历史。
    - 同一日期以新抓取为准（原站可能修订历史值）。
    - 新页面中消失的细分行业/大类会被移除（通常是改名或合并）。
    """
    logs = []
    old_dates = old["dates"]
    new_dates = new["dates"]
    dates = sorted(set(old_dates) | set(new_dates))
    old_set, new_set = set(old_dates), set(new_dates)

    old_cats = {c["id"]: c for c in old["categories"]}
    new_cats = {c["id"]: c for c in new["categories"]}

    for cid in old_cats.keys() - new_cats.keys():
        logs.append(f"移除大类：{cid}")
    for cid in new_cats.keys() - old_cats.keys():
        logs.append(f"新增大类：{cid}")

    cats = []
    for cid, nc in new_cats.items():
        oc = old_cats.get(cid)
        old_series = {s["name"]: s for s in (oc["series"] if oc else [])}
        new_series = {s["name"]: s for s in nc["series"]}

        for name in old_series.keys() - new_series.keys():
            logs.append(f"移除细分行业：{cid}/{name}")
        for name in new_series.keys() - old_series.keys():
            logs.append(f"新增细分行业：{cid}/{name}")

        series = []
        for s in nc["series"]:
            nmap = {d: v for d, v in zip(new_dates, s["values"])}
            omap = {}
            if s["name"] in old_series:
                omap = {d: v for d, v in zip(old_dates, old_series[s["name"]]["values"])}
            values = []
            for d in dates:
                if d in new_set:
                    values.append(nmap.get(d, 0.0))
                else:
                    values.append(omap.get(d, 0.0))
            series.append({"name": s["name"], "color": s["color"], "values": values})
        cats.append({"id": nc["id"], "name": nc["name"], "color": nc["color"], "series": series})

    data = {
        "meta": dict(old.get("meta", {})),
        "dates": dates,
        "categories": cats,
    }
    data["meta"].update(
        {"first_date": dates[0], "last_date": dates[-1], "days": len(dates)}
    )
    return data, logs
