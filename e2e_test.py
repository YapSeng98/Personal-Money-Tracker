#!/usr/bin/env python3
"""
PFMT End-to-End Integration Test
Tests: auth (register/login/logout/re-login), profile, accounts, transactions,
       budgets, goals — full CRUD with cross-user isolation checks.
"""

import requests, json, sys, uuid, time
from datetime import date

BASE     = "https://dev405150.service-now.com/api/x_887486_0/pfmt"
TODAY    = str(date.today())
PASS     = 0
FAIL     = 0
RESULTS  = []

# ─── helpers ─────────────────────────────────────────────────────────────────

def api(path, method="GET", body=None, token=None, expect=None):
    headers = {"Content-Type": "application/json", "X-HTTP-Method": method}
    if token:
        headers["X-PFMT-Token"] = token
    http_verb = "POST" if method == "DELETE" else method
    url = BASE + path
    kwargs = {"headers": headers, "timeout": 30}
    if body:
        if method == "GET":
            kwargs["params"] = body
        else:
            kwargs["json"] = body
    r = getattr(requests, http_verb.lower())(url, **kwargs)
    try:
        data = r.json()
    except Exception:
        return None, r.status_code, r.text
    # Unwrap double-nesting (same logic as the fixed snAPI.call)
    outer = data.get("result", data)
    if isinstance(outer, dict) and "result" in outer:
        payload = outer["result"]
    else:
        payload = outer
    return payload, r.status_code, outer.get("error") if isinstance(outer, dict) else None

def check(name, condition, detail=""):
    global PASS, FAIL
    icon = "✅" if condition else "❌"
    msg  = f"{icon} {name}"
    if not condition and detail:
        msg += f"  →  {detail}"
    print(msg)
    RESULTS.append((condition, name))
    if condition:
        PASS += 1
    else:
        FAIL += 1

def uid():
    return uuid.uuid4().hex[:8]

# ─── test users ──────────────────────────────────────────────────────────────

U1 = f"pfmt_u1_{uid()}"
U2 = f"pfmt_u2_{uid()}"
PW = "Test1234!"

print(f"\n{'═'*60}")
print(f"  PFMT E2E Test  —  {TODAY}")
print(f"  Users: {U1}, {U2}")
print(f"{'═'*60}\n")

# ════════════════════════════════════════════════════════════════
# 1. REGISTRATION
# ════════════════════════════════════════════════════════════════
print("── 1. Registration ──────────────────────────────────────")

p, s, e = api("/auth/register", "POST", {
    "username": U1, "password": PW,
    "display_name": "Test User One", "email": f"{U1}@test.com",
    "currency": "SGD", "language": "en"
})
check("Register U1", s == 201 and p and p.get("token"), f"status={s} err={e}")
TOK1 = p.get("token") if p else None

p2, s2, e2 = api("/auth/register", "POST", {
    "username": U2, "password": PW,
    "display_name": "Test User Two", "email": f"{U2}@test.com"
})
check("Register U2", s2 == 201 and p2 and p2.get("token"), f"status={s2} err={e2}")
TOK2 = p2.get("token") if p2 else None

# Duplicate username
p3, s3, e3 = api("/auth/register", "POST", {"username": U1, "password": PW})
check("Register duplicate → 409", s3 == 409, f"status={s3}")

# Short password
p4, s4, e4 = api("/auth/register", "POST", {"username": f"x_{uid()}", "password": "abc"})
check("Register short password → 400", s4 == 400, f"status={s4}")

if not TOK1 or not TOK2:
    print("\n❌ Cannot continue — registration failed\n")
    sys.exit(1)

# ════════════════════════════════════════════════════════════════
# 2. PROFILE GET/PUT
# ════════════════════════════════════════════════════════════════
print("\n── 2. Profile ───────────────────────────────────────────")

p, s, e = api("/profile", "GET", token=TOK1)
check("GET profile U1", s == 200 and p and p.get("username") == U1, f"status={s} err={e} got={p}")
check("Profile display_name correct", p and p.get("display_name") == "Test User One", str(p))
check("Profile email correct", p and p.get("email") == f"{U1}@test.com", str(p))
check("Profile stats present", p and "stats" in p, str(p))

p, s, e = api("/profile", "PUT", {"display_name": "Updated One", "avatar_color": "#FF5B5B"}, token=TOK1)
check("PUT profile U1", s == 200, f"status={s} err={e}")

p, s, e = api("/profile", "GET", token=TOK1)
check("Profile display_name updated", p and p.get("display_name") == "Updated One", str(p))
check("Profile avatar_color updated", p and p.get("avatar_color") == "#FF5B5B", str(p))

# No token → 401
p, s, e = api("/profile", "GET")
check("Profile without token → 401", s == 401, f"status={s}")

# ════════════════════════════════════════════════════════════════
# 3. ACCOUNTS
# ════════════════════════════════════════════════════════════════
print("\n── 3. Accounts ──────────────────────────────────────────")

p, s, e = api("/accounts", "POST", {"account_name": "Cash", "account_type": "cash", "current_balance": 500}, token=TOK1)
check("Create account Cash (U1)", s == 201 and p and p.get("sys_id"), f"status={s} err={e}")
ACC1_ID = p.get("sys_id") if p else None

p, s, e = api("/accounts", "POST", {"account_name": "DBS Savings", "account_type": "bank", "current_balance": 2000, "institution_name": "DBS"}, token=TOK1)
check("Create account DBS (U1)", s == 201, f"status={s} err={e}")
ACC2_ID = p.get("sys_id") if p else None

# U2 creates own account
p, s, e = api("/accounts", "POST", {"account_name": "Cash", "account_type": "cash", "current_balance": 100}, token=TOK2)
check("Create account Cash (U2)", s == 201, f"status={s} err={e}")
ACC_U2_ID = p.get("sys_id") if p else None

# List
p, s, e = api("/accounts", "GET", token=TOK1)
check("List accounts U1 returns 2", s == 200 and isinstance(p, list) and len(p) == 2, f"status={s} count={len(p) if isinstance(p,list) else '?'}")

# U2 list — should only see own
p, s, e = api("/accounts", "GET", token=TOK2)
check("List accounts U2 isolated (1 account)", s == 200 and isinstance(p, list) and len(p) == 1, f"status={s} count={len(p) if isinstance(p,list) else '?'}")

# PUT account
p, s, e = api("/accounts", "PUT", {"sys_id": ACC1_ID, "current_balance": 750}, token=TOK1)
check("Update account balance (U1)", s == 200, f"status={s} err={e}")

p, s, e = api("/accounts", "GET", token=TOK1)
updated = next((a for a in (p or []) if a.get("sys_id") == ACC1_ID), None)
check("Account balance updated to 750", updated and updated.get("current_balance") == 750, str(updated))

# Cross-user PUT → 404
if ACC_U2_ID:
    p, s, e = api("/accounts", "PUT", {"sys_id": ACC_U2_ID, "current_balance": 9999}, token=TOK1)
    check("Cross-user account PUT → 404", s == 404, f"status={s}")

# Duplicate account name
p, s, e = api("/accounts", "POST", {"account_name": "Cash", "account_type": "cash", "current_balance": 0}, token=TOK1)
check("Duplicate account name → 409", s == 409, f"status={s}")

# account_type round-trip (verifies acount_type field name fix)
p, s, e = api("/accounts", "POST", {"account_name": "My CC", "account_type": "Credit Card", "institution_name": "OCBC", "current_balance": 0}, token=TOK1)
check("Create account with type Credit Card", s == 201, f"status={s} err={e}")
ACC_CC_ID = p.get("sys_id") if p else None
p, s, e = api("/accounts", "GET", token=TOK1)
cc_acc = next((a for a in (p or []) if a.get("sys_id") == ACC_CC_ID), None)
check("account_type stored & returned correctly", cc_acc and cc_acc.get("account_type") == "Credit Card", f"got={cc_acc.get('account_type') if cc_acc else 'None'}")

# ════════════════════════════════════════════════════════════════
# 4. TRANSACTIONS
# ════════════════════════════════════════════════════════════════
print("\n── 4. Transactions ──────────────────────────────────────")

p, s, e = api("/transactions", "POST", {
    "type": "expense", "amount": 12.50, "description": "Lunch",
    "date": TODAY, "account_name": "Cash", "category_name": "Food", "notes": "Chicken rice"
}, token=TOK1)
check("Create transaction (expense)", s == 201 and p and p.get("sys_id"), f"status={s} err={e}")
TXN1_ID = p.get("sys_id") if p else None

p, s, e = api("/transactions", "POST", {
    "type": "income", "amount": 3000, "description": "Salary",
    "date": TODAY, "account_name": "DBS Savings", "category_name": "Income"
}, token=TOK1)
check("Create transaction (income)", s == 201, f"status={s} err={e}")
TXN2_ID = p.get("sys_id") if p else None

# Bad amount
p, s, e = api("/transactions", "POST", {"amount": 0, "description": "bad"}, token=TOK1)
check("Transaction amount=0 → 400", s == 400, f"status={s}")

# No description
p, s, e = api("/transactions", "POST", {"amount": 10}, token=TOK1)
check("Transaction no description → 400", s == 400, f"status={s}")

# List
p, s, e = api("/transactions", "GET", token=TOK1)
check("List transactions U1 returns 2", s == 200 and isinstance(p, list) and len(p) == 2, f"status={s} count={len(p) if isinstance(p,list) else '?'}")

# U2 sees none
p, s, e = api("/transactions", "GET", token=TOK2)
check("List transactions U2 isolated (0)", s == 200 and isinstance(p, list) and len(p) == 0, f"status={s} count={len(p) if isinstance(p,list) else '?'}")

# PUT
p, s, e = api("/transactions", "PUT", {"sys_id": TXN1_ID, "description": "Lunch Updated", "amount": 15.00}, token=TOK1)
check("Update transaction", s == 200, f"status={s} err={e}")

p, s, e = api("/transactions", "GET", token=TOK1)
txn = next((t for t in (p or []) if t.get("sys_id") == TXN1_ID), None)
check("Transaction description updated", txn and txn.get("description") == "Lunch Updated", str(txn))
check("Transaction amount updated to 15", txn and txn.get("amount") == 15.0, str(txn))
# category + account round-trip (verifies category auto-create fix)
check("Transaction category stored & returned", txn and txn.get("category") == "Food", f"got='{txn.get('category') if txn else None}'")
check("Transaction account stored & returned", txn and txn.get("account") == "Cash", f"got='{txn.get('account') if txn else None}'")

# Cross-user PUT → 403/404
p, s, e = api("/transactions", "PUT", {"sys_id": TXN1_ID, "amount": 999}, token=TOK2)
check("Cross-user transaction PUT → 403/404", s in (403, 404), f"status={s}")

# U2 creates a transaction
p, s, e = api("/transactions", "POST", {
    "type": "expense", "amount": 5, "description": "Coffee",
    "date": TODAY, "account_name": "Cash"
}, token=TOK2)
check("U2 create transaction", s == 201, f"status={s} err={e}")
TXN_U2_ID = p.get("sys_id") if p else None

# ════════════════════════════════════════════════════════════════
# 5. BUDGETS
# ════════════════════════════════════════════════════════════════
print("\n── 5. Budgets ───────────────────────────────────────────")

p, s, e = api("/budgets", "POST", {"category_name": "Food", "budget_amount": 400, "alert_threshold": 80}, token=TOK1)
check("Create budget Food (U1)", s == 201 and p and p.get("sys_id"), f"status={s} err={e}")
BDG1_ID = p.get("sys_id") if p else None

p, s, e = api("/budgets", "POST", {"category_name": "Transport", "budget_amount": 150}, token=TOK1)
check("Create budget Transport (U1)", s == 201, f"status={s} err={e}")
BDG2_ID = p.get("sys_id") if p else None

# Duplicate category budget
p, s, e = api("/budgets", "POST", {"category_name": "Food", "budget_amount": 200}, token=TOK1)
check("Duplicate budget → 409", s == 409, f"status={s}")

# List
p, s, e = api("/budgets", "GET", token=TOK1)
check("List budgets U1 returns 2", s == 200 and isinstance(p, list) and len(p) == 2, f"status={s} count={len(p) if isinstance(p,list) else '?'}")

# U2 sees none
p, s, e = api("/budgets", "GET", token=TOK2)
check("List budgets U2 isolated (0)", s == 200 and isinstance(p, list) and len(p) == 0, f"status={s} count={len(p) if isinstance(p,list) else '?'}")

# PUT
p, s, e = api("/budgets", "PUT", {"sys_id": BDG1_ID, "budget_amount": 500, "alert_threshold": 75}, token=TOK1)
check("Update budget Food", s == 200, f"status={s} err={e}")

p, s, e = api("/budgets", "GET", token=TOK1)
b = next((b for b in (p or []) if b.get("sys_id") == BDG1_ID), None)
check("Budget amount updated to 500", b and b.get("budget_amount") == 500, str(b))
check("Budget threshold updated to 75", b and b.get("alert_threshold") == 75, str(b))

# Cross-user PUT → 404
p, s, e = api("/budgets", "PUT", {"sys_id": BDG1_ID, "budget_amount": 9999}, token=TOK2)
check("Cross-user budget PUT → 404", s == 404, f"status={s}")

# ════════════════════════════════════════════════════════════════
# 6. GOALS
# ════════════════════════════════════════════════════════════════
print("\n── 6. Goals ─────────────────────────────────────────────")

p, s, e = api("/goals", "POST", {
    "goal_name": "Emergency Fund", "goal_icon": "🛡️",
    "target_amount": 10000, "current_amount": 2000,
    "monthly_contribution": 500, "target_date": "2026-12-31"
}, token=TOK1)
check("Create goal Emergency Fund (U1)", s == 201 and p and p.get("sys_id"), f"status={s} err={e}")
GOAL1_ID = p.get("sys_id") if p else None

p, s, e = api("/goals", "POST", {
    "goal_name": "Vacation", "goal_icon": "✈️",
    "target_amount": 3000, "current_amount": 500,
    "account_name": "DBS Savings"
}, token=TOK1)
check("Create goal Vacation with account (U1)", s == 201, f"status={s} err={e}")
GOAL2_ID = p.get("sys_id") if p else None

p, s, e = api("/goals", "POST", {
    "goal_name": "New Phone", "target_amount": 1500, "current_amount": 1500
}, token=TOK1)
check("Create goal already achieved (U1)", s == 201, f"status={s} err={e}")
GOAL3_ID = p.get("sys_id") if p else None

# Validate all 3 got distinct sys_ids
check("3 goals have distinct sys_ids", len({GOAL1_ID, GOAL2_ID, GOAL3_ID}) == 3,
      f"ids: {GOAL1_ID}, {GOAL2_ID}, {GOAL3_ID}")

# Missing required fields
p, s, e = api("/goals", "POST", {"goal_name": "No amount"}, token=TOK1)
check("Goal missing target_amount → 400", s == 400, f"status={s}")

# List
p, s, e = api("/goals", "GET", token=TOK1)
check("List goals U1 returns 3", s == 200 and isinstance(p, list) and len(p) == 3,
      f"status={s} count={len(p) if isinstance(p, list) else '?'}")

# Status check
goals = {g["sys_id"]: g for g in (p or [])}
g3 = goals.get(GOAL3_ID)
check("Achieved goal has status=achieved", g3 and g3.get("goal_status") == "achieved", str(g3))
g1 = goals.get(GOAL1_ID)
check("In-progress goal has status=in_progress", g1 and g1.get("goal_status") == "in_progress", str(g1))
check("Goal progress_pct correct", g1 and abs(g1.get("progress_pct", 0) - 20.0) < 0.1, str(g1))

# U2 sees none
p, s, e = api("/goals", "GET", token=TOK2)
check("List goals U2 isolated (0)", s == 200 and isinstance(p, list) and len(p) == 0, f"status={s}")

# PUT
p, s, e = api("/goals", "PUT", {"sys_id": GOAL1_ID, "current_amount": 5000, "goal_name": "Emergency Fund Updated"}, token=TOK1)
check("Update goal Emergency Fund", s == 200, f"status={s} err={e}")

p, s, e = api("/goals", "GET", token=TOK1)
goals = {g["sys_id"]: g for g in (p or [])}
g = goals.get(GOAL1_ID)
check("Goal current_amount updated to 5000", g and g.get("current_amount") == 5000, str(g))
check("Goal name updated", g and g.get("goal_name") == "Emergency Fund Updated", str(g))
check("Goal progress_pct updated to 50%", g and abs(g.get("progress_pct", 0) - 50.0) < 0.1, str(g))

# Cross-user PUT → 404
p, s, e = api("/goals", "PUT", {"sys_id": GOAL1_ID, "current_amount": 99999}, token=TOK2)
check("Cross-user goal PUT → 404", s == 404, f"status={s}")

# ════════════════════════════════════════════════════════════════
# 6b. GOAL ICON ROUND-TRIP  (BMP + supplementary-plane emoji)
#     Verifies safeIconWrite/safeIconRead in REST_GoalsAPI.js
# ════════════════════════════════════════════════════════════════
print("\n── 6b. Goal icon round-trip ─────────────────────────────")

ICON_GOALS = []   # sys_ids to clean up

def icon_roundtrip(emoji, label, token):
    """POST a goal with `emoji`, GET it back, return the stored icon string."""
    p2, s2, e2 = api("/goals", "POST", {
        "goal_name": f"IconTest {label}", "goal_icon": emoji,
        "target_amount": 100, "current_amount": 0
    }, token=token)
    if s2 != 201 or not p2 or not p2.get("sys_id"):
        check(f"Icon POST {label} ({emoji})", False, f"status={s2} err={e2}")
        return None, None
    sid = p2["sys_id"]
    ICON_GOALS.append(sid)
    # GET back
    p3, s3, _ = api("/goals", "GET", token=token)
    goals_map = {g["sys_id"]: g for g in (p3 or [])}
    g3 = goals_map.get(sid)
    returned = g3.get("goal_icon", "") if g3 else ""
    check(f"Icon POST {label} → 201", s2 == 201, f"status={s2}")
    return sid, returned

# BMP emoji: ✈️ U+2708 — should always have worked
_, ret = icon_roundtrip("✈️", "BMP-plane", TOK1)
check("BMP emoji ✈️ round-trip exact", ret == "✈️", f"got: {repr(ret)}")

# Supplementary-plane emoji — previously broken, fixed by percent-encoding
_, ret = icon_roundtrip("🏠", "SUP-house", TOK1)
check("Supp emoji 🏠 round-trip exact", ret == "🏠", f"got: {repr(ret)}")

_, ret = icon_roundtrip("🎯", "SUP-target", TOK1)
check("Supp emoji 🎯 round-trip exact", ret == "🎯", f"got: {repr(ret)}")

_, ret = icon_roundtrip("🚗", "SUP-car", TOK1)
check("Supp emoji 🚗 round-trip exact", ret == "🚗", f"got: {repr(ret)}")

_, ret = icon_roundtrip("💍", "SUP-ring", TOK1)
check("Supp emoji 💍 round-trip exact", ret == "💍", f"got: {repr(ret)}")

_, ret = icon_roundtrip("🎓", "SUP-grad", TOK1)
check("Supp emoji 🎓 round-trip exact", ret == "🎓", f"got: {repr(ret)}")

# Icon update via PUT (BMP → supplementary → BMP)
if ICON_GOALS:
    icon_sid = ICON_GOALS[0]   # the ✈️ goal
    p4, s4, e4 = api("/goals", "PUT", {"sys_id": icon_sid, "goal_icon": "🏠"}, token=TOK1)
    check("PUT icon BMP→supp (✈️→🏠)", s4 == 200, f"status={s4} err={e4}")
    p5, _, _ = api("/goals", "GET", token=TOK1)
    gm = {g["sys_id"]: g for g in (p5 or [])}
    g5 = gm.get(icon_sid)
    check("Icon after PUT is 🏠", g5 and g5.get("goal_icon") == "🏠",
          f"got: {repr(g5.get('goal_icon','') if g5 else 'None')}")

    p6, s6, e6 = api("/goals", "PUT", {"sys_id": icon_sid, "goal_icon": "✈️"}, token=TOK1)
    check("PUT icon supp→BMP (🏠→✈️)", s6 == 200, f"status={s6} err={e6}")
    p7, _, _ = api("/goals", "GET", token=TOK1)
    gm2 = {g["sys_id"]: g for g in (p7 or [])}
    g7 = gm2.get(icon_sid)
    check("Icon after PUT back to ✈️", g7 and g7.get("goal_icon") == "✈️",
          f"got: {repr(g7.get('goal_icon','') if g7 else 'None')}")

# ════════════════════════════════════════════════════════════════
# 7. DELETE all entities
# ════════════════════════════════════════════════════════════════
print("\n── 7. Delete ────────────────────────────────────────────")

# Cross-user delete → 403/404
p, s, e = api("/transactions", "DELETE", {"sys_id": TXN1_ID}, token=TOK2)
check("Cross-user txn DELETE → 403/404", s in (403, 404), f"status={s}")

p, s, e = api("/transactions", "DELETE", {"sys_id": TXN1_ID}, token=TOK1)
check("Delete transaction TXN1", s == 200, f"status={s} err={e}")

p, s, e = api("/transactions", "DELETE", {"sys_id": TXN2_ID}, token=TOK1)
check("Delete transaction TXN2", s == 200, f"status={s} err={e}")

p, s, e = api("/transactions", "GET", token=TOK1)
check("U1 transactions empty after delete", s == 200 and isinstance(p, list) and len(p) == 0,
      f"count={len(p) if isinstance(p,list) else '?'}")

# Goals (main)
p, s, e = api("/goals", "DELETE", {"sys_id": GOAL1_ID}, token=TOK1)
check("Delete goal 1", s == 200, f"status={s} err={e}")
p, s, e = api("/goals", "DELETE", {"sys_id": GOAL2_ID}, token=TOK1)
check("Delete goal 2", s == 200, f"status={s} err={e}")
p, s, e = api("/goals", "DELETE", {"sys_id": GOAL3_ID}, token=TOK1)
check("Delete goal 3", s == 200, f"status={s} err={e}")

# Goals (icon round-trip cleanup)
for _sid in ICON_GOALS:
    api("/goals", "DELETE", {"sys_id": _sid}, token=TOK1)

p, s, e = api("/goals", "GET", token=TOK1)
check("U1 goals empty after delete", s == 200 and isinstance(p, list) and len(p) == 0,
      f"count={len(p) if isinstance(p,list) else '?'}")

# Budgets
p, s, e = api("/budgets", "DELETE", {"sys_id": BDG1_ID}, token=TOK1)
check("Delete budget Food", s == 200, f"status={s} err={e}")
p, s, e = api("/budgets", "DELETE", {"sys_id": BDG2_ID}, token=TOK1)
check("Delete budget Transport", s == 200, f"status={s} err={e}")

p, s, e = api("/budgets", "GET", token=TOK1)
check("U1 budgets empty after delete", s == 200 and isinstance(p, list) and len(p) == 0,
      f"count={len(p) if isinstance(p,list) else '?'}")

# Accounts (delete all)
p, s, e = api("/accounts", "DELETE", {"sys_id": ACC1_ID}, token=TOK1)
check("Delete account Cash (U1)", s == 200, f"status={s} err={e}")
p, s, e = api("/accounts", "DELETE", {"sys_id": ACC2_ID}, token=TOK1)
check("Delete account DBS (U1)", s == 200, f"status={s} err={e}")
if ACC_CC_ID:
    api("/accounts", "DELETE", {"sys_id": ACC_CC_ID}, token=TOK1)

p, s, e = api("/accounts", "GET", token=TOK1)
check("U1 accounts empty after delete", s == 200 and isinstance(p, list) and len(p) == 0,
      f"count={len(p) if isinstance(p,list) else '?'}")

# U2 cleanup
if TXN_U2_ID:
    api("/transactions", "DELETE", {"sys_id": TXN_U2_ID}, token=TOK2)
if ACC_U2_ID:
    api("/accounts", "DELETE", {"sys_id": ACC_U2_ID}, token=TOK2)

# ════════════════════════════════════════════════════════════════
# 8. LOGOUT + RE-LOGIN
# ════════════════════════════════════════════════════════════════
print("\n── 8. Logout & Re-login ─────────────────────────────────")

p, s, e = api("/auth/logout", "POST", token=TOK1)
check("Logout U1", s == 200, f"status={s} err={e}")

# Token should be invalid now
p, s, e = api("/profile", "GET", token=TOK1)
check("Stale token rejected after logout → 401", s == 401, f"status={s}")

# Re-login
p, s, e = api("/auth/login", "POST", {"username": U1, "password": PW})
check("Re-login U1", s == 200 and p and p.get("token"), f"status={s} err={e}")
TOK1_NEW = p.get("token") if p else None

p, s, e = api("/profile", "GET", token=TOK1_NEW)
check("New token works after re-login", s == 200 and p and p.get("username") == U1, f"status={s}")

# Wrong password
p, s, e = api("/auth/login", "POST", {"username": U1, "password": "wrongpass"})
check("Login wrong password → 401", s == 401, f"status={s}")

# Unknown user
p, s, e = api("/auth/login", "POST", {"username": f"nouser_{uid()}", "password": PW})
check("Login unknown user → 401", s == 401, f"status={s}")

# Logout U2
api("/auth/logout", "POST", token=TOK2)
if TOK1_NEW:
    api("/auth/logout", "POST", token=TOK1_NEW)

# ════════════════════════════════════════════════════════════════
# SUMMARY
# ════════════════════════════════════════════════════════════════
print(f"\n{'═'*60}")
total = PASS + FAIL
print(f"  RESULT: {PASS}/{total} passed {'✅' if FAIL == 0 else '❌'}")
if FAIL:
    print(f"\n  FAILED tests:")
    for ok, name in RESULTS:
        if not ok:
            print(f"    ❌ {name}")
print(f"{'═'*60}\n")
sys.exit(0 if FAIL == 0 else 1)
