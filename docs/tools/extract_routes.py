"""Regenerate docs/assets/js/routes.js — the data behind the manual's API reference.

Reads every blueprint in server/api/*.py with the standard library's `ast`
(nothing is imported, so no dependencies and no side effects) and records, per
route: method, path, handler name, the docstring's first paragraph (or the
comment block above the decorator), the query params read through
`request.args.get(...)`, and the JSON body keys a POST/PUT/DELETE handler reads.

    python docs/tools/extract_routes.py
"""

import ast
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "assets" / "js" / "routes.js"
BODY_NAMES = ("body", "data", "payload", "j", "req", "js")

# flask-sock routes are registered outside the blueprints (server/editor/sockets.py)
SOCKETS = [
    {"m": "WS", "p": "/api/editor/pty", "f": "terminal.handle", "bp": "editor",
     "d": "Integrated PTY terminal for the Composing Room (needs the editor extra: flask-sock)."},
    {"m": "WS", "p": "/api/editor/lsp", "f": "lsp.handle", "bp": "editor",
     "d": "LSP bridge: stdio JSON-RPC ⇄ plain-JSON WebSocket frames (needs the editor extra)."},
]


def blueprints(tree):
    found = {}
    for node in ast.walk(tree):
        if (isinstance(node, ast.Assign) and isinstance(node.value, ast.Call)
                and getattr(node.value.func, "id", None) == "Blueprint"):
            prefix = next((kw.value.value for kw in node.value.keywords
                           if kw.arg == "url_prefix"), "")
            found[node.targets[0].id] = prefix
    return found


def describe(node, lines):
    doc = ast.get_docstring(node) or ""
    if doc:
        return " ".join(doc.strip().split("\n\n")[0].split())
    i = min(d.lineno for d in node.decorator_list) - 2
    comment = []
    while i >= 0 and lines[i].strip().startswith("#"):
        comment.insert(0, lines[i].strip().lstrip("#").strip())
        i -= 1
    return " ".join(comment)


def params(node):
    query, body = set(), set()
    for n in ast.walk(node):
        if (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                and n.func.attr in ("get", "getlist") and n.args
                and isinstance(n.args[0], ast.Constant) and isinstance(n.args[0].value, str)):
            owner = ast.unparse(n.func.value)
            if owner == "request.args":
                query.add(n.args[0].value)
            elif owner in BODY_NAMES:
                body.add(n.args[0].value)
        if (isinstance(n, ast.Subscript) and ast.unparse(n.value) in BODY_NAMES
                and isinstance(n.slice, ast.Constant) and isinstance(n.slice.value, str)):
            body.add(n.slice.value)
        if isinstance(n, (ast.DictComp, ast.ListComp, ast.GeneratorExp, ast.SetComp)):
            for gen in n.generators:
                guarded = any(
                    isinstance(c, ast.Compare)
                    and any(ast.unparse(x) in BODY_NAMES for x in c.comparators)
                    for c in gen.ifs)
                if guarded and isinstance(gen.iter, (ast.Tuple, ast.List)):
                    body.update(e.value for e in gen.iter.elts if isinstance(e, ast.Constant))
    return sorted(query), sorted(body)


def extract():
    routes = []
    for path in sorted((ROOT / "server" / "api").glob("*.py")):
        src = path.read_text()
        lines = src.split("\n")
        tree = ast.parse(src)
        bps = blueprints(tree)
        for node in tree.body:
            if not isinstance(node, ast.FunctionDef):
                continue
            decs = [d for d in node.decorator_list
                    if isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute)
                    and isinstance(d.func.value, ast.Name) and d.func.value.id in bps]
            if not decs:
                continue
            text = describe(node, lines)
            query, body = params(node)
            for d in decs:
                kind = d.func.attr
                rule = d.args[0].value if d.args else ""
                methods = ["GET"] if kind == "route" else [kind.upper()]
                for kw in d.keywords:
                    if kw.arg == "methods":
                        methods = [e.value for e in kw.value.elts]
                for m in methods:
                    r = {"m": m, "p": bps[d.func.value.id] + rule, "f": node.name, "bp": path.stem}
                    if text:
                        r["d"] = text
                    if query:
                        r["q"] = query
                    if body and m != "GET":
                        r["b"] = body
                    routes.append(r)
    return routes + SOCKETS


def main():
    routes = extract()
    body = json.dumps(routes, ensure_ascii=False, separators=(",", ":")).replace("},{", "},\n{")
    OUT.write_text(
        "/* Every HTTP route the Flask app registers, extracted from server/api/*.py\n"
        "   (method, path, handler, docstring or leading comment, query params read via\n"
        "   request.args, JSON body keys). Regenerate with docs/tools/extract_routes.py\n"
        "   when the API changes. */\n"
        "window.TUBCAL_ROUTES = " + body + ";\n"
    )
    print(f"wrote {len(routes)} routes to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
