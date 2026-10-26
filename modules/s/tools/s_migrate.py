#!/usr/bin/env python
# ==================================================================
#  s_migrate.py — 学习网站题库迁移 (2026-10-24 用户要求: 全 JSON/XML 无 SQL)
# ------------------------------------------------------------------
#  源: s/题库/*.json (仓库自带, manifest.json 融合清单)
#  产出(全部文件, 零数据库):
#    s/data/banks/<subject>.json    归一化题库(每科一个文件, 按 kp 分组索引)
#    s/data/banks/<subject>.xml     XML 镜像(双格式, 用户要求 xml+json)
#    s/data/manifest.json           总索引(科目/年级/题量/知识点分布)
#  归一化字段: id subject grade type kp stem say opts ans explain audio src
# ==================================================================
import json
import os
import sys
import html as htmlmod
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # s/ 目录
SRC = os.path.join(ROOT, "题库")
OUT = os.path.join(ROOT, "data", "banks")

SUBJECT_CN = {"math": "数学", "chinese": "语文", "english": "英语",
              "pinyin": "拼音", "problems": "应用题"}


def norm_item(subject, grade, src, i, q):
    """各科异构字段 → 统一结构"""
    stem = q.get("html") or q.get("q") or ""
    say = q.get("say") or q.get("speak") or q.get("speakAns") or ""
    opts = q.get("opts")
    ans = q.get("ans")
    explain = q.get("teach") or q.get("eq") or q.get("explain") or ""
    kp = q.get("kp") or q.get("tag") or "综合"
    it = {
        "id": "%s.g%d.%s.%03d" % (subject, grade, src.split(".")[0][:6], i + 1),
        "subject": subject, "grade": grade,
        "type": q.get("type", "choice"), "kp": kp,
        "stem": stem, "say": say,
        "ans": ans, "explain": explain,
        "src": src,
    }
    if opts is not None:
        it["opts"] = opts
    if q.get("speak"):
        it["speak"] = q["speak"]
    if q.get("eq"):
        it["eq"] = q["eq"]
    return it


def to_xml(items, subject):
    L = ['<?xml version="1.0" encoding="UTF-8"?>',
         '<bank subject="%s" count="%d">' % (subject, len(items))]
    for it in items:
        L.append('  <item id="%s" grade="%d" type="%s" kp="%s">' % (
            it["id"], it["grade"], it["type"], htmlmod.escape(str(it["kp"]))))
        L.append("    <stem>%s</stem>" % htmlmod.escape(str(it["stem"])))
        if "opts" in it:
            L.append('    <opts>%s</opts>' % htmlmod.escape(
                json.dumps(it["opts"], ensure_ascii=False)))
        L.append("    <ans>%s</ans>" % htmlmod.escape(str(it["ans"])))
        L.append("    <explain>%s</explain>" % htmlmod.escape(str(it["explain"])))
        L.append("  </item>")
    L.append("</bank>")
    return "\n".join(L)


def main():
    os.makedirs(OUT, exist_ok=True)
    man = json.load(open(os.path.join(SRC, "manifest.json"), encoding="utf-8"))
    banks = {}          # subject -> [items]
    for b in man["banks"]:
        f = os.path.join(SRC, b["file"])
        if not os.path.isfile(f):
            print("缺文件:", b["file"]); continue
        d = json.load(open(f, encoding="utf-8"))
        subj = b["type"]
        grade = int(d.get("grade") or 1)
        qs = d.get("questions") or d.get("items") or []
        for i, q in enumerate(qs):
            banks.setdefault(subj, []).append(norm_item(subj, grade, b["file"], i, q))
        print("%-10s %-22s %3d 题" % (subj, b["file"], len(qs)))

    # ---- 写归一化 JSON + XML ----
    total = 0
    for subj, items in banks.items():
        doc = {"subject": subj, "name": SUBJECT_CN.get(subj, subj),
               "count": len(items), "items": items}
        p = os.path.join(OUT, "%s.json" % subj)
        json.dump(doc, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        open(os.path.join(OUT, "%s.xml" % subj), "w", encoding="utf-8").write(to_xml(items, subj))
        total += len(items)
        print("→ %s.json (%d 题) + %s.xml" % (subj, len(items), subj))

    # ---- manifest 总索引 ----
    idx = {"total": total, "subjects": {}, "kp_top": {}}
    for subj, items in banks.items():
        kps = Counter(str(i["kp"]) for i in items)
        grades = Counter(i["grade"] for i in items)
        idx["subjects"][subj] = {
            "name": SUBJECT_CN.get(subj, subj), "count": len(items),
            "grades": dict(sorted(grades.items())),
            "json": "banks/%s.json" % subj, "xml": "banks/%s.xml" % subj,
        }
        idx["kp_top"][subj] = kps.most_common(12)
    json.dump(idx, open(os.path.join(ROOT, "data", "manifest.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print("\n总计 %d 题 → s/data/{banks/*.json|xml, manifest.json}" % total)


if __name__ == "__main__":
    main()
