#!/usr/bin/env python3
"""
PFMT Seed Script — 10 realistic test users with multi-currency data.

Currency coverage:
  - Single-currency users (SGD / MYR / AUD) for the simple, uncluttered UI path
  - Multi-currency users (SG-MY commuters, USD earners) to exercise per-currency
    grouping, isolated budget spend, and per-currency dashboard stats

Run:  python3 seed_test_users.py
All users share the password below.
"""

import requests, uuid, sys
from datetime import date, timedelta

BASE = "https://dev405150.service-now.com/api/x_887486_0/pfmt"
PW   = "Test1234!"

def api(path, method="GET", body=None, token=None):
    headers = {"Content-Type": "application/json", "X-HTTP-Method": method}
    if token: headers["X-PFMT-Token"] = token
    http_verb = "POST" if method == "DELETE" else method
    kwargs = {"headers": headers, "timeout": 30}
    if body:
        if method == "GET": kwargs["params"] = body
        else: kwargs["json"] = body
    r = getattr(requests, http_verb.lower())(BASE + path, **kwargs)
    try:
        outer = r.json().get("result", {})
        return (outer["result"] if isinstance(outer, dict) and "result" in outer else outer), r.status_code
    except:
        return None, r.status_code

def dt(days_ago=0):
    return str(date.today() - timedelta(days=days_ago))

# ─── 10 user profiles ────────────────────────────────────────────────────────
# Every account / transaction / budget / goal carries an explicit currency.

USERS = [
    {
        # SGD primary + MYR (weekend JB trips — very common for Singapore users)
        "username": f"alice_{uuid.uuid4().hex[:6]}",
        "display_name": "Alice Tan", "email": "alice@pfmt.test",
        "currency": "SGD", "language": "en", "monthly_income_target": 5000,
        "accounts": [
            {"account_name": "POSB Savings", "account_type": "bank",        "current_balance": 8200, "institution_name": "DBS",  "currency": "SGD"},
            {"account_name": "Cash Wallet",  "account_type": "cash",        "current_balance": 320,                              "currency": "SGD"},
            {"account_name": "OCBC Credit",  "account_type": "Credit Card", "current_balance": -450, "institution_name": "OCBC", "currency": "SGD"},
            {"account_name": "TnG eWallet",  "account_type": "cash",        "current_balance": 180,  "institution_name": "TnG",  "currency": "MYR"},
        ],
        "transactions": [
            {"type":"income",  "amount":5000,  "description":"Monthly Salary",     "category_name":"Salary",       "account_name":"POSB Savings", "date":dt(1),  "currency":"SGD"},
            {"type":"expense", "amount":85,    "description":"Weekly groceries",   "category_name":"Groceries",    "account_name":"Cash Wallet",  "date":dt(2),  "currency":"SGD"},
            {"type":"expense", "amount":42.50, "description":"Grab rides",         "category_name":"Transport",    "account_name":"OCBC Credit",  "date":dt(3),  "currency":"SGD"},
            {"type":"expense", "amount":12.80, "description":"Chicken rice lunch", "category_name":"Food & Drink", "account_name":"Cash Wallet",  "date":dt(4),  "currency":"SGD"},
            {"type":"expense", "amount":120,   "description":"Electricity bill",   "category_name":"Bills",        "account_name":"POSB Savings", "date":dt(5),  "currency":"SGD"},
            {"type":"expense", "amount":35,    "description":"Netflix + Spotify",  "category_name":"Entertainment","account_name":"OCBC Credit",  "date":dt(6),  "currency":"SGD"},
            {"type":"expense", "amount":9.90,  "description":"Kopitiam breakfast", "category_name":"Food & Drink", "account_name":"Cash Wallet",  "date":dt(8),  "currency":"SGD"},
            {"type":"income",  "amount":800,   "description":"Freelance design",   "category_name":"Freelance",    "account_name":"POSB Savings", "date":dt(10), "currency":"SGD"},
            {"type":"expense", "amount":55,    "description":"GP visit",           "category_name":"Health",       "account_name":"OCBC Credit",  "date":dt(12), "currency":"SGD"},
            # MYR — JB weekend
            {"type":"expense", "amount":180,   "description":"JB grocery run",     "category_name":"Groceries",    "account_name":"TnG eWallet",  "date":dt(7),  "currency":"MYR"},
            {"type":"expense", "amount":65,    "description":"JB seafood dinner",  "category_name":"Food & Drink", "account_name":"TnG eWallet",  "date":dt(7),  "currency":"MYR"},
            {"type":"expense", "amount":90,    "description":"Petrol + toll JB",   "category_name":"Transport",    "account_name":"TnG eWallet",  "date":dt(14), "currency":"MYR"},
        ],
        "budgets": [
            {"category_name":"Food & Drink",  "budget_amount":400, "alert_threshold":80, "currency":"SGD"},
            {"category_name":"Groceries",     "budget_amount":300, "alert_threshold":75, "currency":"SGD"},
            {"category_name":"Transport",     "budget_amount":150, "alert_threshold":80, "currency":"SGD"},
            {"category_name":"Entertainment", "budget_amount":100, "alert_threshold":90, "currency":"SGD"},
            # same categories, different currency — exercises per-currency isolation
            {"category_name":"Food & Drink",  "budget_amount":200, "alert_threshold":80, "currency":"MYR"},
            {"category_name":"Groceries",     "budget_amount":250, "alert_threshold":75, "currency":"MYR"},
        ],
        "goals": [
            {"goal_name":"Emergency Fund", "goal_icon":"🛡️", "target_amount":15000, "current_amount":8200, "monthly_contribution":500, "target_date":dt(-365), "currency":"SGD", "remarks":"6 months of expenses"},
            {"goal_name":"Japan Trip",     "goal_icon":"✈️", "target_amount":4500,  "current_amount":1200, "monthly_contribution":300, "target_date":dt(-270), "currency":"SGD", "remarks":"Osaka + Kyoto 10 days"},
            {"goal_name":"New MacBook",    "goal_icon":"🖥️", "target_amount":2800,  "current_amount":800,  "monthly_contribution":200, "target_date":dt(-180), "currency":"SGD", "remarks":"M3 Pro model"},
        ],
    },
    {
        # SGD primary + USD (stock investing / overseas subscriptions)
        "username": f"ben_{uuid.uuid4().hex[:6]}",
        "display_name": "Ben Lim", "email": "ben@pfmt.test",
        "currency": "SGD", "language": "en", "monthly_income_target": 7500,
        "accounts": [
            {"account_name": "UOB One",        "account_type": "bank",        "current_balance": 22000, "institution_name": "UOB",      "currency": "SGD"},
            {"account_name": "Maybank Savings","account_type": "bank",        "current_balance": 5500,  "institution_name": "Maybank",  "currency": "SGD"},
            {"account_name": "Cash",           "account_type": "cash",        "current_balance": 180,                                   "currency": "SGD"},
            {"account_name": "Citibank CC",    "account_type": "Credit Card", "current_balance": -1200, "institution_name": "Citibank", "currency": "SGD"},
            {"account_name": "IBKR Brokerage", "account_type": "Other",       "current_balance": 12000, "institution_name": "IBKR",     "currency": "USD"},
        ],
        "transactions": [
            {"type":"income",  "amount":7500, "description":"Salary",          "category_name":"Salary",       "account_name":"UOB One",     "date":dt(1),  "currency":"SGD"},
            {"type":"expense", "amount":1800, "description":"Rent",            "category_name":"Bills",        "account_name":"UOB One",     "date":dt(2),  "currency":"SGD"},
            {"type":"expense", "amount":250,  "description":"Supermarket run", "category_name":"Groceries",    "account_name":"Citibank CC", "date":dt(3),  "currency":"SGD"},
            {"type":"expense", "amount":6.50, "description":"Coffee",          "category_name":"Food & Drink", "account_name":"Cash",        "date":dt(4),  "currency":"SGD"},
            {"type":"expense", "amount":88,   "description":"Gym membership",  "category_name":"Health",       "account_name":"Citibank CC", "date":dt(5),  "currency":"SGD"},
            {"type":"expense", "amount":45,   "description":"Petrol",          "category_name":"Transport",    "account_name":"Citibank CC", "date":dt(6),  "currency":"SGD"},
            {"type":"expense", "amount":320,  "description":"Car insurance",   "category_name":"Bills",        "account_name":"UOB One",     "date":dt(8),  "currency":"SGD"},
            {"type":"income",  "amount":1500, "description":"Bonus payout",    "category_name":"Salary",       "account_name":"UOB One",     "date":dt(10), "currency":"SGD"},
            {"type":"expense", "amount":135,  "description":"Team dinner",     "category_name":"Food & Drink", "account_name":"Citibank CC", "date":dt(12), "currency":"SGD"},
            {"type":"expense", "amount":580,  "description":"Flight tickets",  "category_name":"Travel",       "account_name":"Citibank CC", "date":dt(15), "currency":"SGD"},
            # USD
            {"type":"income",  "amount":420,  "description":"US dividend",     "category_name":"Investment",   "account_name":"IBKR Brokerage", "date":dt(9),  "currency":"USD"},
            {"type":"expense", "amount":20,   "description":"ChatGPT Plus",    "category_name":"Bills",        "account_name":"IBKR Brokerage", "date":dt(11), "currency":"USD"},
            {"type":"expense", "amount":199,  "description":"Online course",   "category_name":"Education",    "account_name":"IBKR Brokerage", "date":dt(20), "currency":"USD"},
        ],
        "budgets": [
            {"category_name":"Food & Drink", "budget_amount":600,  "alert_threshold":80, "currency":"SGD"},
            {"category_name":"Groceries",    "budget_amount":400,  "alert_threshold":75, "currency":"SGD"},
            {"category_name":"Transport",    "budget_amount":200,  "alert_threshold":80, "currency":"SGD"},
            {"category_name":"Bills",        "budget_amount":2200, "alert_threshold":95, "currency":"SGD"},
            {"category_name":"Travel",       "budget_amount":1000, "alert_threshold":90, "currency":"SGD"},
            {"category_name":"Bills",        "budget_amount":50,   "alert_threshold":80, "currency":"USD"},
            {"category_name":"Education",    "budget_amount":150,  "alert_threshold":80, "currency":"USD"},  # 199 spent → OVER
        ],
        "goals": [
            {"goal_name":"House Down Payment","goal_icon":"🏠","target_amount":120000,"current_amount":22000,"monthly_contribution":2000,"target_date":dt(-1825),"currency":"SGD","remarks":"BTO application 2028"},
            {"goal_name":"Wedding Fund",      "goal_icon":"💍","target_amount":30000, "current_amount":8500, "monthly_contribution":1000,"target_date":dt(-545), "currency":"SGD","remarks":"Solemnisation + dinner"},
            {"goal_name":"US Stock Portfolio","goal_icon":"📈","target_amount":50000, "current_amount":12000,"monthly_contribution":800, "target_date":dt(-1095),"currency":"USD","remarks":"S&P500 index DCA"},
        ],
    },
    {
        # MYR primary + SGD (lives in JB, works in Singapore — classic cross-border)
        "username": f"chloe_{uuid.uuid4().hex[:6]}",
        "display_name": "Chloe Ng", "email": "chloe@pfmt.test",
        "currency": "MYR", "language": "en", "monthly_income_target": 6000,
        "accounts": [
            {"account_name": "Maybank Current","account_type": "bank",        "current_balance": 12000, "institution_name": "Maybank", "currency": "MYR"},
            {"account_name": "Touch N Go",     "account_type": "cash",        "current_balance": 150,                                  "currency": "MYR"},
            {"account_name": "CIMB Credit",    "account_type": "Credit Card", "current_balance": -800,  "institution_name": "CIMB",    "currency": "MYR"},
            {"account_name": "DBS Multiplier", "account_type": "bank",        "current_balance": 6500,  "institution_name": "DBS",     "currency": "SGD"},
        ],
        "transactions": [
            {"type":"expense", "amount":1200, "description":"Rental",          "category_name":"Bills",        "account_name":"Maybank Current","date":dt(2),  "currency":"MYR"},
            {"type":"expense", "amount":180,  "description":"Tesco groceries", "category_name":"Groceries",    "account_name":"CIMB Credit",    "date":dt(3),  "currency":"MYR"},
            {"type":"expense", "amount":35,   "description":"Grab Food",       "category_name":"Food & Drink", "account_name":"Touch N Go",     "date":dt(5),  "currency":"MYR"},
            {"type":"expense", "amount":110,  "description":"Petronas petrol", "category_name":"Transport",    "account_name":"Touch N Go",     "date":dt(7),  "currency":"MYR"},
            {"type":"expense", "amount":45,   "description":"Cinema date",     "category_name":"Entertainment","account_name":"CIMB Credit",    "date":dt(9),  "currency":"MYR"},
            {"type":"income",  "amount":1200, "description":"Tutoring income", "category_name":"Freelance",    "account_name":"Maybank Current","date":dt(11), "currency":"MYR"},
            {"type":"expense", "amount":88,   "description":"Shopee haul",     "category_name":"Shopping",     "account_name":"CIMB Credit",    "date":dt(13), "currency":"MYR"},
            {"type":"expense", "amount":22,   "description":"Mamak dinner",    "category_name":"Food & Drink", "account_name":"Touch N Go",     "date":dt(15), "currency":"MYR"},
            # SGD — salary earned in Singapore, daily commute spend
            {"type":"income",  "amount":4200, "description":"SG salary",       "category_name":"Salary",       "account_name":"DBS Multiplier", "date":dt(1),  "currency":"SGD"},
            {"type":"expense", "amount":128,  "description":"Causeway bus pass","category_name":"Transport",   "account_name":"DBS Multiplier", "date":dt(4),  "currency":"SGD"},
            {"type":"expense", "amount":9.50, "description":"Lunch at office", "category_name":"Food & Drink", "account_name":"DBS Multiplier", "date":dt(6),  "currency":"SGD"},
            {"type":"expense", "amount":11,   "description":"Kopi + kaya toast","category_name":"Food & Drink","account_name":"DBS Multiplier", "date":dt(12), "currency":"SGD"},
        ],
        "budgets": [
            {"category_name":"Food & Drink",  "budget_amount":500,  "alert_threshold":80, "currency":"MYR"},
            {"category_name":"Groceries",     "budget_amount":400,  "alert_threshold":75, "currency":"MYR"},
            {"category_name":"Transport",     "budget_amount":300,  "alert_threshold":80, "currency":"MYR"},
            {"category_name":"Entertainment", "budget_amount":150,  "alert_threshold":85, "currency":"MYR"},
            {"category_name":"Bills",         "budget_amount":1300, "alert_threshold":95, "currency":"MYR"},
            {"category_name":"Food & Drink",  "budget_amount":150,  "alert_threshold":80, "currency":"SGD"},
            {"category_name":"Transport",     "budget_amount":120,  "alert_threshold":80, "currency":"SGD"},  # 128 spent → OVER
        ],
        "goals": [
            {"goal_name":"Car Down Payment", "goal_icon":"🚗","target_amount":15000,"current_amount":5000,"monthly_contribution":800,"target_date":dt(-540),"currency":"MYR","remarks":"Proton X50 target"},
            {"goal_name":"Postgrad Studies", "goal_icon":"🎓","target_amount":25000,"current_amount":8000,"monthly_contribution":600,"target_date":dt(-730),"currency":"MYR","remarks":"MBA part-time"},
            {"goal_name":"SG Emergency Fund","goal_icon":"🛡️","target_amount":12000,"current_amount":6500,"monthly_contribution":500,"target_date":dt(-365),"currency":"SGD","remarks":"Kept in SGD for stability"},
        ],
    },
    {
        # Pure AUD — single-currency user (clean UI, no grouping headers)
        "username": f"david_{uuid.uuid4().hex[:6]}",
        "display_name": "David Wong", "email": "david@pfmt.test",
        "currency": "AUD", "language": "en", "monthly_income_target": 9000,
        "accounts": [
            {"account_name": "CommBank Main", "account_type": "bank",        "current_balance": 35000, "institution_name": "CommBank", "currency": "AUD"},
            {"account_name": "ING Saver",     "account_type": "bank",        "current_balance": 18000, "institution_name": "ING",      "currency": "AUD"},
            {"account_name": "ANZ Visa",      "account_type": "Credit Card", "current_balance": -2100, "institution_name": "ANZ",      "currency": "AUD"},
            {"account_name": "Cash",          "account_type": "cash",        "current_balance": 200,                                   "currency": "AUD"},
        ],
        "transactions": [
            {"type":"income",  "amount":9000, "description":"Salary",            "category_name":"Salary",       "account_name":"CommBank Main","date":dt(1),  "currency":"AUD"},
            {"type":"expense", "amount":2200, "description":"Mortgage",          "category_name":"Bills",        "account_name":"CommBank Main","date":dt(2),  "currency":"AUD"},
            {"type":"expense", "amount":180,  "description":"Woolworths",        "category_name":"Groceries",    "account_name":"ANZ Visa",     "date":dt(4),  "currency":"AUD"},
            {"type":"expense", "amount":85,   "description":"Electricity + gas", "category_name":"Bills",        "account_name":"CommBank Main","date":dt(5),  "currency":"AUD"},
            {"type":"expense", "amount":55,   "description":"Uber rides",        "category_name":"Transport",    "account_name":"ANZ Visa",     "date":dt(6),  "currency":"AUD"},
            {"type":"expense", "amount":95,   "description":"Restaurant dinner", "category_name":"Food & Drink", "account_name":"ANZ Visa",     "date":dt(8),  "currency":"AUD"},
            {"type":"income",  "amount":2000, "description":"Rental income",     "category_name":"Investment",   "account_name":"CommBank Main","date":dt(10), "currency":"AUD"},
            {"type":"expense", "amount":120,  "description":"Health insurance",  "category_name":"Health",       "account_name":"CommBank Main","date":dt(12), "currency":"AUD"},
            {"type":"expense", "amount":450,  "description":"Flight Melbourne",  "category_name":"Travel",       "account_name":"ANZ Visa",     "date":dt(14), "currency":"AUD"},
            {"type":"expense", "amount":65,   "description":"Gym & swimming",    "category_name":"Health",       "account_name":"ANZ Visa",     "date":dt(16), "currency":"AUD"},
            {"type":"expense", "amount":280,  "description":"Electronics",       "category_name":"Shopping",     "account_name":"ANZ Visa",     "date":dt(20), "currency":"AUD"},
            {"type":"expense", "amount":35,   "description":"Coffee x10",        "category_name":"Food & Drink", "account_name":"Cash",         "date":dt(22), "currency":"AUD"},
        ],
        "budgets": [
            {"category_name":"Food & Drink", "budget_amount":600,  "alert_threshold":80, "currency":"AUD"},
            {"category_name":"Groceries",    "budget_amount":500,  "alert_threshold":75, "currency":"AUD"},
            {"category_name":"Transport",    "budget_amount":200,  "alert_threshold":80, "currency":"AUD"},
            {"category_name":"Bills",        "budget_amount":2400, "alert_threshold":95, "currency":"AUD"},
            {"category_name":"Health",       "budget_amount":300,  "alert_threshold":85, "currency":"AUD"},
            {"category_name":"Travel",       "budget_amount":1500, "alert_threshold":80, "currency":"AUD"},
            {"category_name":"Shopping",     "budget_amount":400,  "alert_threshold":80, "currency":"AUD"},
        ],
        "goals": [
            {"goal_name":"Investment Portfolio","goal_icon":"📈","target_amount":100000,"current_amount":35000,"monthly_contribution":2000,"target_date":dt(-1095),"currency":"AUD","remarks":"ETF + index funds"},
            {"goal_name":"Europe Holiday",     "goal_icon":"✈️","target_amount":12000, "current_amount":4000, "monthly_contribution":600, "target_date":dt(-365), "currency":"AUD","remarks":"3 weeks UK+France"},
            {"goal_name":"New Car",            "goal_icon":"🚗","target_amount":45000, "current_amount":18000,"monthly_contribution":1500,"target_date":dt(-730), "currency":"AUD","remarks":"Tesla Model 3"},
        ],
    },
    {
        # Pure SGD, Chinese UI — single-currency + i18n coverage
        "username": f"emma_{uuid.uuid4().hex[:6]}",
        "display_name": "Emma Liew", "email": "emma@pfmt.test",
        "currency": "SGD", "language": "zh", "monthly_income_target": 4200,
        "accounts": [
            {"account_name": "CIMB FastSaver", "account_type": "bank",        "current_balance": 6800, "institution_name": "CIMB", "currency": "SGD"},
            {"account_name": "Cash",           "account_type": "cash",        "current_balance": 90,                               "currency": "SGD"},
            {"account_name": "Standard CC",    "account_type": "Credit Card", "current_balance": -350, "institution_name": "Standard Chartered", "currency": "SGD"},
        ],
        "transactions": [
            {"type":"income",  "amount":4200, "description":"月薪",            "category_name":"Salary",       "account_name":"CIMB FastSaver","date":dt(1),  "currency":"SGD"},
            {"type":"expense", "amount":68,   "description":"Sheng Siong",     "category_name":"Groceries",    "account_name":"Cash",          "date":dt(2),  "currency":"SGD"},
            {"type":"expense", "amount":8.50, "description":"Hawker lunch",    "category_name":"Food & Drink", "account_name":"Cash",          "date":dt(3),  "currency":"SGD"},
            {"type":"expense", "amount":22,   "description":"Bus & MRT",       "category_name":"Transport",    "account_name":"CIMB FastSaver","date":dt(4),  "currency":"SGD"},
            {"type":"expense", "amount":88,   "description":"Utility bill",    "category_name":"Bills",        "account_name":"CIMB FastSaver","date":dt(5),  "currency":"SGD"},
            {"type":"expense", "amount":55,   "description":"Zalora order",    "category_name":"Shopping",     "account_name":"Standard CC",   "date":dt(7),  "currency":"SGD"},
            {"type":"income",  "amount":500,  "description":"Red packet (CNY)","category_name":"Other",        "account_name":"Cash",          "date":dt(9),  "currency":"SGD"},
            {"type":"expense", "amount":15,   "description":"Bubble tea",      "category_name":"Food & Drink", "account_name":"Cash",          "date":dt(11), "currency":"SGD"},
            {"type":"expense", "amount":120,  "description":"H&M shopping",    "category_name":"Shopping",     "account_name":"Standard CC",   "date":dt(14), "currency":"SGD"},
            {"type":"expense", "amount":38,   "description":"Movie night",     "category_name":"Entertainment","account_name":"Standard CC",   "date":dt(17), "currency":"SGD"},
        ],
        "budgets": [
            {"category_name":"Food & Drink",  "budget_amount":300, "alert_threshold":80, "currency":"SGD"},
            {"category_name":"Groceries",     "budget_amount":250, "alert_threshold":75, "currency":"SGD"},
            {"category_name":"Transport",     "budget_amount":100, "alert_threshold":80, "currency":"SGD"},
            {"category_name":"Shopping",      "budget_amount":150, "alert_threshold":85, "currency":"SGD"},  # 175 spent → OVER
            {"category_name":"Entertainment", "budget_amount":80,  "alert_threshold":90, "currency":"SGD"},
        ],
        "goals": [
            {"goal_name":"结婚基金",   "goal_icon":"💍","target_amount":20000,"current_amount":3500,"monthly_contribution":500,"target_date":dt(-730),"currency":"SGD","remarks":"婚礼及蜜月旅行"},
            {"goal_name":"Korea Trip", "goal_icon":"✈️","target_amount":3500, "current_amount":700, "monthly_contribution":250,"target_date":dt(-365),"currency":"SGD","remarks":"Seoul & Jeju 7 days"},
            {"goal_name":"新手机",     "goal_icon":"🖥️","target_amount":1500, "current_amount":600, "monthly_contribution":150,"target_date":dt(-180),"currency":"SGD","remarks":"iPhone 16 Pro"},
        ],
    },
    {
        # SGD + MYR — family man with Malaysian relatives
        "username": f"farid_{uuid.uuid4().hex[:6]}",
        "display_name": "Farid Hassan", "email": "farid@pfmt.test",
        "currency": "SGD", "language": "en", "monthly_income_target": 8000,
        "accounts": [
            {"account_name": "DBS Multiplier",  "account_type": "bank",        "current_balance": 45000, "institution_name": "DBS",  "currency": "SGD"},
            {"account_name": "OCBC 360",        "account_type": "bank",        "current_balance": 12000, "institution_name": "OCBC", "currency": "SGD"},
            {"account_name": "Cash",            "account_type": "cash",        "current_balance": 250,                                "currency": "SGD"},
            {"account_name": "DBS Altitude CC", "account_type": "Credit Card", "current_balance": -3200, "institution_name": "DBS",  "currency": "SGD"},
            {"account_name": "CIMB MY",         "account_type": "bank",        "current_balance": 8000,  "institution_name": "CIMB", "currency": "MYR"},
        ],
        "transactions": [
            {"type":"income",  "amount":8000, "description":"Salary",            "category_name":"Salary",       "account_name":"DBS Multiplier", "date":dt(1),  "currency":"SGD"},
            {"type":"expense", "amount":2800, "description":"HDB mortgage",      "category_name":"Bills",        "account_name":"DBS Multiplier", "date":dt(2),  "currency":"SGD"},
            {"type":"expense", "amount":320,  "description":"Family groceries",  "category_name":"Groceries",    "account_name":"DBS Altitude CC","date":dt(3),  "currency":"SGD"},
            {"type":"expense", "amount":95,   "description":"Halal restaurant",  "category_name":"Food & Drink", "account_name":"Cash",           "date":dt(5),  "currency":"SGD"},
            {"type":"expense", "amount":180,  "description":"Esso petrol",       "category_name":"Transport",    "account_name":"DBS Altitude CC","date":dt(6),  "currency":"SGD"},
            {"type":"income",  "amount":2000, "description":"Side business",     "category_name":"Freelance",    "account_name":"OCBC 360",       "date":dt(8),  "currency":"SGD"},
            {"type":"expense", "amount":450,  "description":"Family takaful",    "category_name":"Health",       "account_name":"DBS Multiplier", "date":dt(10), "currency":"SGD"},
            {"type":"expense", "amount":88,   "description":"Kids enrichment",   "category_name":"Education",    "account_name":"DBS Altitude CC","date":dt(12), "currency":"SGD"},
            {"type":"expense", "amount":250,  "description":"Lazada electronics","category_name":"Shopping",     "account_name":"DBS Altitude CC","date":dt(16), "currency":"SGD"},
            # MYR — hometown visits
            {"type":"expense", "amount":600,  "description":"Family support KL", "category_name":"Other",        "account_name":"CIMB MY",        "date":dt(4),  "currency":"MYR"},
            {"type":"expense", "amount":220,  "description":"Raya shopping",     "category_name":"Shopping",     "account_name":"CIMB MY",        "date":dt(11), "currency":"MYR"},
            {"type":"expense", "amount":150,  "description":"KL family dinner",  "category_name":"Food & Drink", "account_name":"CIMB MY",        "date":dt(11), "currency":"MYR"},
        ],
        "budgets": [
            {"category_name":"Food & Drink", "budget_amount":700,  "alert_threshold":80, "currency":"SGD"},
            {"category_name":"Groceries",    "budget_amount":500,  "alert_threshold":75, "currency":"SGD"},
            {"category_name":"Transport",    "budget_amount":350,  "alert_threshold":80, "currency":"SGD"},
            {"category_name":"Bills",        "budget_amount":3000, "alert_threshold":95, "currency":"SGD"},
            {"category_name":"Health",       "budget_amount":500,  "alert_threshold":85, "currency":"SGD"},
            {"category_name":"Food & Drink", "budget_amount":300,  "alert_threshold":80, "currency":"MYR"},
            {"category_name":"Shopping",     "budget_amount":200,  "alert_threshold":80, "currency":"MYR"},  # 220 spent → OVER
        ],
        "goals": [
            {"goal_name":"Kids Education Fund","goal_icon":"🎓","target_amount":80000,"current_amount":15000,"monthly_contribution":1500,"target_date":dt(-3650),"currency":"SGD","remarks":"University fund for 2 kids"},
            {"goal_name":"Umrah Savings",      "goal_icon":"🕌","target_amount":12000,"current_amount":4500, "monthly_contribution":600, "target_date":dt(-540), "currency":"SGD","remarks":"Family of 4"},
            {"goal_name":"KL Property Fund",   "goal_icon":"🏠","target_amount":150000,"current_amount":8000,"monthly_contribution":2000,"target_date":dt(-1825),"currency":"MYR","remarks":"Retirement home in KL"},
        ],
    },
    {
        # Pure SGD, minimal data — the "new user" experience
        "username": f"grace_{uuid.uuid4().hex[:6]}",
        "display_name": "Grace Koh", "email": "grace@pfmt.test",
        "currency": "SGD", "language": "en", "monthly_income_target": 3800,
        "accounts": [
            {"account_name": "POSB eSavings", "account_type": "bank", "current_balance": 4200, "institution_name": "DBS", "currency": "SGD"},
            {"account_name": "Cash",          "account_type": "cash", "current_balance": 60,                              "currency": "SGD"},
        ],
        "transactions": [
            {"type":"income",  "amount":3800, "description":"Salary",             "category_name":"Salary",       "account_name":"POSB eSavings","date":dt(1),  "currency":"SGD"},
            {"type":"expense", "amount":1400, "description":"Room rental",        "category_name":"Bills",        "account_name":"POSB eSavings","date":dt(2),  "currency":"SGD"},
            {"type":"expense", "amount":55,   "description":"Fairprice NTUC",     "category_name":"Groceries",    "account_name":"POSB eSavings","date":dt(4),  "currency":"SGD"},
            {"type":"expense", "amount":7.80, "description":"Hawker breakfast",   "category_name":"Food & Drink", "account_name":"Cash",         "date":dt(5),  "currency":"SGD"},
            {"type":"expense", "amount":45,   "description":"Monthly bus pass",   "category_name":"Transport",    "account_name":"POSB eSavings","date":dt(6),  "currency":"SGD"},
            {"type":"expense", "amount":18,   "description":"Boba & snacks",      "category_name":"Food & Drink", "account_name":"Cash",         "date":dt(8),  "currency":"SGD"},
            {"type":"income",  "amount":300,  "description":"Part-time tutoring", "category_name":"Freelance",    "account_name":"POSB eSavings","date":dt(10), "currency":"SGD"},
            {"type":"expense", "amount":28,   "description":"Uniqlo shirt",       "category_name":"Shopping",     "account_name":"POSB eSavings","date":dt(12), "currency":"SGD"},
            {"type":"expense", "amount":12,   "description":"Grabfood delivery",  "category_name":"Food & Drink", "account_name":"Cash",         "date":dt(15), "currency":"SGD"},
            {"type":"expense", "amount":45,   "description":"Pharmacy",           "category_name":"Health",       "account_name":"POSB eSavings","date":dt(18), "currency":"SGD"},
        ],
        "budgets": [
            {"category_name":"Food & Drink", "budget_amount":200,  "alert_threshold":80, "currency":"SGD"},
            {"category_name":"Groceries",    "budget_amount":150,  "alert_threshold":75, "currency":"SGD"},
            {"category_name":"Transport",    "budget_amount":80,   "alert_threshold":85, "currency":"SGD"},
            {"category_name":"Shopping",     "budget_amount":100,  "alert_threshold":80, "currency":"SGD"},
            {"category_name":"Bills",        "budget_amount":1500, "alert_threshold":95, "currency":"SGD"},
        ],
        "goals": [
            {"goal_name":"First Laptop",     "goal_icon":"🖥️","target_amount":1800,"current_amount":650, "monthly_contribution":200,"target_date":dt(-270),"currency":"SGD","remarks":"For WFH productivity"},
            {"goal_name":"Travel Fund",      "goal_icon":"✈️","target_amount":5000,"current_amount":800, "monthly_contribution":250,"target_date":dt(-540),"currency":"SGD","remarks":"SEA backpacking"},
            {"goal_name":"Emergency Buffer", "goal_icon":"🛡️","target_amount":5000,"current_amount":1200,"monthly_contribution":300,"target_date":dt(-365),"currency":"SGD","remarks":"3 months safety net"},
        ],
    },
    {
        # High net worth, 3 currencies — the heaviest dataset
        "username": f"harry_{uuid.uuid4().hex[:6]}",
        "display_name": "Harry Teo", "email": "harry@pfmt.test",
        "currency": "SGD", "language": "en", "monthly_income_target": 12000,
        "accounts": [
            {"account_name": "UOB Stash",      "account_type": "bank",        "current_balance": 88000, "institution_name": "UOB",  "currency": "SGD"},
            {"account_name": "SCB Bonus Saver","account_type": "bank",        "current_balance": 32000, "institution_name": "Standard Chartered", "currency": "SGD"},
            {"account_name": "Cash",           "account_type": "cash",        "current_balance": 500,                                "currency": "SGD"},
            {"account_name": "Amex Platinum",  "account_type": "Credit Card", "current_balance": -8500, "institution_name": "Amex", "currency": "SGD"},
            {"account_name": "Crypto Wallet",  "account_type": "Other",       "current_balance": 15000,                              "currency": "USD"},
            {"account_name": "Maybank Premier","account_type": "bank",        "current_balance": 60000, "institution_name": "Maybank","currency": "MYR"},
        ],
        "transactions": [
            {"type":"income",  "amount":12000,"description":"Director salary",   "category_name":"Salary",       "account_name":"UOB Stash",      "date":dt(1),  "currency":"SGD"},
            {"type":"expense", "amount":3500, "description":"Condo mortgage",    "category_name":"Bills",        "account_name":"UOB Stash",      "date":dt(2),  "currency":"SGD"},
            {"type":"expense", "amount":480,  "description":"Cold Storage",      "category_name":"Groceries",    "account_name":"Amex Platinum",  "date":dt(3),  "currency":"SGD"},
            {"type":"expense", "amount":350,  "description":"Fine dining",       "category_name":"Food & Drink", "account_name":"Amex Platinum",  "date":dt(5),  "currency":"SGD"},
            {"type":"expense", "amount":850,  "description":"BMW servicing",     "category_name":"Transport",    "account_name":"Amex Platinum",  "date":dt(7),  "currency":"SGD"},
            {"type":"income",  "amount":5000, "description":"Consulting retainer","category_name":"Freelance",   "account_name":"SCB Bonus Saver","date":dt(8),  "currency":"SGD"},
            {"type":"expense", "amount":1200, "description":"Life insurance",    "category_name":"Health",       "account_name":"UOB Stash",      "date":dt(10), "currency":"SGD"},
            {"type":"expense", "amount":680,  "description":"Golf membership",   "category_name":"Entertainment","account_name":"Amex Platinum",  "date":dt(12), "currency":"SGD"},
            {"type":"expense", "amount":2800, "description":"Watch purchase",    "category_name":"Shopping",     "account_name":"Amex Platinum",  "date":dt(18), "currency":"SGD"},
            {"type":"expense", "amount":4500, "description":"Family holiday",    "category_name":"Travel",       "account_name":"Amex Platinum",  "date":dt(22), "currency":"SGD"},
            # USD — crypto / overseas investing
            {"type":"income",  "amount":3500, "description":"Crypto gains",      "category_name":"Investment",   "account_name":"Crypto Wallet",  "date":dt(15), "currency":"USD"},
            {"type":"expense", "amount":800,  "description":"US brokerage fees", "category_name":"Other",        "account_name":"Crypto Wallet",  "date":dt(19), "currency":"USD"},
            # MYR — JB property
            {"type":"income",  "amount":3200, "description":"JB rental income",  "category_name":"Investment",   "account_name":"Maybank Premier","date":dt(3),  "currency":"MYR"},
            {"type":"expense", "amount":900,  "description":"JB property upkeep","category_name":"Bills",        "account_name":"Maybank Premier","date":dt(9),  "currency":"MYR"},
        ],
        "budgets": [
            {"category_name":"Food & Drink",  "budget_amount":1500, "alert_threshold":80, "currency":"SGD"},
            {"category_name":"Groceries",     "budget_amount":800,  "alert_threshold":75, "currency":"SGD"},
            {"category_name":"Transport",     "budget_amount":1000, "alert_threshold":80, "currency":"SGD"},
            {"category_name":"Bills",         "budget_amount":4000, "alert_threshold":95, "currency":"SGD"},
            {"category_name":"Entertainment", "budget_amount":1000, "alert_threshold":80, "currency":"SGD"},
            {"category_name":"Travel",        "budget_amount":5000, "alert_threshold":80, "currency":"SGD"},
            {"category_name":"Shopping",      "budget_amount":3000, "alert_threshold":80, "currency":"SGD"},
            {"category_name":"Other",         "budget_amount":500,  "alert_threshold":80, "currency":"USD"},  # 800 spent → OVER
            {"category_name":"Bills",         "budget_amount":1200, "alert_threshold":90, "currency":"MYR"},
        ],
        "goals": [
            {"goal_name":"Second Property","goal_icon":"🏠","target_amount":300000, "current_amount":88000, "monthly_contribution":5000,"target_date":dt(-1825),"currency":"SGD","remarks":"Investment property"},
            {"goal_name":"Retirement Fund","goal_icon":"🛡️","target_amount":2000000,"current_amount":150000,"monthly_contribution":3000,"target_date":dt(-7300),"currency":"SGD","remarks":"FIRE at 50"},
            {"goal_name":"Crypto Holdings","goal_icon":"📈","target_amount":50000,  "current_amount":15000, "monthly_contribution":1000,"target_date":dt(-1095),"currency":"USD","remarks":"BTC + ETH DCA"},
            {"goal_name":"JB Villa",       "goal_icon":"🏠","target_amount":800000, "current_amount":60000, "monthly_contribution":4000,"target_date":dt(-3650),"currency":"MYR","remarks":"Retirement villa"},
        ],
    },
    {
        # Pure SGD, Chinese UI
        "username": f"iris_{uuid.uuid4().hex[:6]}",
        "display_name": "Iris Chan", "email": "iris@pfmt.test",
        "currency": "SGD", "language": "zh", "monthly_income_target": 5500,
        "accounts": [
            {"account_name": "Maybank Savings","account_type": "bank",        "current_balance": 9500, "institution_name": "Maybank", "currency": "SGD"},
            {"account_name": "GrabPay",        "account_type": "cash",        "current_balance": 180,                                 "currency": "SGD"},
            {"account_name": "Maybank CC",     "account_type": "Credit Card", "current_balance": -720, "institution_name": "Maybank", "currency": "SGD"},
        ],
        "transactions": [
            {"type":"income",  "amount":5500, "description":"工资",       "category_name":"Salary",       "account_name":"Maybank Savings","date":dt(1),  "currency":"SGD"},
            {"type":"expense", "amount":95,   "description":"烹饪材料",    "category_name":"Groceries",    "account_name":"GrabPay",        "date":dt(3),  "currency":"SGD"},
            {"type":"expense", "amount":28,   "description":"麻辣火锅",    "category_name":"Food & Drink", "account_name":"Maybank CC",     "date":dt(5),  "currency":"SGD"},
            {"type":"expense", "amount":55,   "description":"地铁充值",    "category_name":"Transport",    "account_name":"GrabPay",        "date":dt(6),  "currency":"SGD"},
            {"type":"expense", "amount":130,  "description":"手机账单",    "category_name":"Bills",        "account_name":"Maybank Savings","date":dt(7),  "currency":"SGD"},
            {"type":"expense", "amount":75,   "description":"护肤品",      "category_name":"Shopping",     "account_name":"Maybank CC",     "date":dt(9),  "currency":"SGD"},
            {"type":"income",  "amount":800,  "description":"网上销售",    "category_name":"Freelance",    "account_name":"Maybank Savings","date":dt(11), "currency":"SGD"},
            {"type":"expense", "amount":45,   "description":"健身房月费",  "category_name":"Health",       "account_name":"Maybank CC",     "date":dt(13), "currency":"SGD"},
            {"type":"expense", "amount":22,   "description":"奶茶",       "category_name":"Food & Drink", "account_name":"GrabPay",        "date":dt(16), "currency":"SGD"},
            {"type":"expense", "amount":150,  "description":"Taobao购物", "category_name":"Shopping",     "account_name":"Maybank CC",     "date":dt(19), "currency":"SGD"},
            {"type":"expense", "amount":35,   "description":"电影票",     "category_name":"Entertainment","account_name":"Maybank CC",     "date":dt(22), "currency":"SGD"},
        ],
        "budgets": [
            {"category_name":"Food & Drink",  "budget_amount":350, "alert_threshold":80, "currency":"SGD"},
            {"category_name":"Groceries",     "budget_amount":300, "alert_threshold":75, "currency":"SGD"},
            {"category_name":"Transport",     "budget_amount":120, "alert_threshold":80, "currency":"SGD"},
            {"category_name":"Shopping",      "budget_amount":200, "alert_threshold":85, "currency":"SGD"},  # 225 spent → OVER
            {"category_name":"Health",        "budget_amount":100, "alert_threshold":80, "currency":"SGD"},
            {"category_name":"Entertainment", "budget_amount":80,  "alert_threshold":85, "currency":"SGD"},
        ],
        "goals": [
            {"goal_name":"台湾旅行",       "goal_icon":"✈️","target_amount":4000, "current_amount":1500,"monthly_contribution":300,"target_date":dt(-365),"currency":"SGD","remarks":"台北+花莲10天"},
            {"goal_name":"结婚钻戒",       "goal_icon":"💍","target_amount":8000, "current_amount":2200,"monthly_contribution":400,"target_date":dt(-540),"currency":"SGD","remarks":"GIA证书"},
            {"goal_name":"学车基金",       "goal_icon":"🚗","target_amount":3000, "current_amount":800, "monthly_contribution":200,"target_date":dt(-365),"currency":"SGD","remarks":"私人学院"},
            {"goal_name":"Emergency Fund","goal_icon":"🛡️","target_amount":10000,"current_amount":3500,"monthly_contribution":400,"target_date":dt(-540),"currency":"SGD","remarks":"6 months buffer"},
        ],
    },
    {
        # SGD + USD — remote dev paid partly in USD
        "username": f"jake_{uuid.uuid4().hex[:6]}",
        "display_name": "Jake Sim", "email": "jake@pfmt.test",
        "currency": "SGD", "language": "en", "monthly_income_target": 6500,
        "accounts": [
            {"account_name": "OCBC 360",   "account_type": "bank",        "current_balance": 18000, "institution_name": "OCBC", "currency": "SGD"},
            {"account_name": "GXS Bank",   "account_type": "bank",        "current_balance": 3500,  "institution_name": "GXS",  "currency": "SGD"},
            {"account_name": "Cash",       "account_type": "cash",        "current_balance": 120,                               "currency": "SGD"},
            {"account_name": "UOB One CC", "account_type": "Credit Card", "current_balance": -1800, "institution_name": "UOB",  "currency": "SGD"},
            {"account_name": "Wise USD",   "account_type": "Other",       "current_balance": 4500,  "institution_name": "Wise", "currency": "USD"},
        ],
        "transactions": [
            {"type":"income",  "amount":6500, "description":"Software engineer salary","category_name":"Salary",      "account_name":"OCBC 360",   "date":dt(1),  "currency":"SGD"},
            {"type":"expense", "amount":1500, "description":"Rent (Jurong)",     "category_name":"Bills",        "account_name":"OCBC 360",   "date":dt(2),  "currency":"SGD"},
            {"type":"expense", "amount":120,  "description":"Fairprice online",  "category_name":"Groceries",    "account_name":"UOB One CC", "date":dt(4),  "currency":"SGD"},
            {"type":"expense", "amount":14.50,"description":"Cai png lunch",     "category_name":"Food & Drink", "account_name":"Cash",       "date":dt(5),  "currency":"SGD"},
            {"type":"expense", "amount":98,   "description":"Phone bill",        "category_name":"Bills",        "account_name":"OCBC 360",   "date":dt(6),  "currency":"SGD"},
            {"type":"expense", "amount":48,   "description":"Steam games",       "category_name":"Entertainment","account_name":"UOB One CC", "date":dt(10), "currency":"SGD"},
            {"type":"expense", "amount":25,   "description":"Grab to airport",   "category_name":"Transport",    "account_name":"UOB One CC", "date":dt(12), "currency":"SGD"},
            {"type":"expense", "amount":380,  "description":"Mechanical keyboard","category_name":"Shopping",    "account_name":"UOB One CC", "date":dt(14), "currency":"SGD"},
            {"type":"expense", "amount":85,   "description":"Medical checkup",   "category_name":"Health",       "account_name":"OCBC 360",   "date":dt(16), "currency":"SGD"},
            {"type":"expense", "amount":22,   "description":"Kopi + toast",      "category_name":"Food & Drink", "account_name":"Cash",       "date":dt(21), "currency":"SGD"},
            # USD — freelance clients abroad
            {"type":"income",  "amount":1800, "description":"US client project", "category_name":"Freelance",    "account_name":"Wise USD",   "date":dt(8),  "currency":"USD"},
            {"type":"expense", "amount":60,   "description":"AWS hosting",       "category_name":"Bills",        "account_name":"Wise USD",   "date":dt(18), "currency":"USD"},
            {"type":"expense", "amount":45,   "description":"Udemy courses",     "category_name":"Education",    "account_name":"Wise USD",   "date":dt(18), "currency":"USD"},
            {"type":"income",  "amount":300,  "description":"Tech blog AdSense", "category_name":"Investment",   "account_name":"Wise USD",   "date":dt(25), "currency":"USD"},
        ],
        "budgets": [
            {"category_name":"Food & Drink",  "budget_amount":400,  "alert_threshold":80, "currency":"SGD"},
            {"category_name":"Groceries",     "budget_amount":200,  "alert_threshold":75, "currency":"SGD"},
            {"category_name":"Transport",     "budget_amount":100,  "alert_threshold":80, "currency":"SGD"},
            {"category_name":"Bills",         "budget_amount":1700, "alert_threshold":95, "currency":"SGD"},
            {"category_name":"Entertainment", "budget_amount":150,  "alert_threshold":80, "currency":"SGD"},
            {"category_name":"Shopping",      "budget_amount":400,  "alert_threshold":80, "currency":"SGD"},
            {"category_name":"Bills",         "budget_amount":100,  "alert_threshold":80, "currency":"USD"},
            {"category_name":"Education",     "budget_amount":100,  "alert_threshold":80, "currency":"USD"},
        ],
        "goals": [
            {"goal_name":"BTO Down Payment", "goal_icon":"🏠","target_amount":50000,"current_amount":18000,"monthly_contribution":1500,"target_date":dt(-1825),"currency":"SGD","remarks":"Punggol BTO 2029"},
            {"goal_name":"RTX 5090 PC Build","goal_icon":"🖥️","target_amount":5000, "current_amount":1200, "monthly_contribution":300, "target_date":dt(-365), "currency":"SGD","remarks":"Dream gaming rig"},
            {"goal_name":"Japan Trip",       "goal_icon":"✈️","target_amount":5500, "current_amount":2000, "monthly_contribution":400, "target_date":dt(-365), "currency":"SGD","remarks":"Tokyo DisneySea"},
            {"goal_name":"USD Runway",       "goal_icon":"📈","target_amount":20000,"current_amount":4500, "monthly_contribution":600, "target_date":dt(-1095),"currency":"USD","remarks":"6-month freelance buffer"},
        ],
    },
]

# ─── seed ─────────────────────────────────────────────────────────────────────

def main():
    total_ok = total_fail = 0
    created = []

    for u in USERS:
        uname = u["username"]
        print(f"\n{'─'*64}\n  {u['display_name']} ({uname})\n{'─'*64}")

        p, s = api("/auth/register", "POST", {
            "username": uname, "password": PW,
            "display_name": u["display_name"], "email": u["email"],
            "currency": u["currency"], "language": u["language"]
        })
        if s != 201:
            print(f"  ❌ Register failed ({s}) — skipping: {p}")
            total_fail += 1
            continue
        print(f"  ✅ Register ({s})")
        total_ok += 1

        p, s = api("/auth/login", "POST", {"username": uname, "password": PW})
        if isinstance(p, dict) and "result" in p: p = p["result"]
        tok = (p or {}).get("token")
        if not (s == 200 and tok):
            print(f"  ❌ Login failed ({s}) — skipping")
            total_fail += 1
            continue
        print(f"  ✅ Login ({s})")
        total_ok += 1

        api("/profile", "PUT", {"monthly_income_target": u["monthly_income_target"]}, token=tok)

        counts = {"accounts": 0, "transactions": 0, "budgets": 0, "goals": 0}
        for kind, path in [("accounts","/accounts"), ("transactions","/transactions"),
                           ("budgets","/budgets"), ("goals","/goals")]:
            fails = []
            for rec in u[kind]:
                p, s = api(path, "POST", rec, token=tok)
                if s == 201:
                    counts[kind] += 1; total_ok += 1
                else:
                    label = rec.get("account_name") or rec.get("description") or rec.get("category_name") or rec.get("goal_name")
                    cur = rec.get("currency", "")
                    fails.append(f"{label} [{cur}] ({s})")
                    total_fail += 1
            status = "✅" if not fails else "⚠️ "
            print(f"  {status} {kind}: {counts[kind]}/{len(u[kind])}")
            for f in fails: print(f"       ✗ {f}")

        curs = sorted({r.get("currency") for r in u["transactions"]})
        created.append((u["display_name"], uname, "+".join(curs), counts))

    print(f"\n{'═'*64}\n  SEED COMPLETE — {total_ok} ✅   {total_fail} ❌\n{'═'*64}")
    print(f"\n  Password for every user: {PW}\n")
    print(f"  {'User':<14}{'Username':<20}{'Currencies':<12}{'Acc':>4}{'Txn':>5}{'Bud':>5}{'Goal':>5}")
    print(f"  {'-'*64}")
    for name, uname, curs, c in created:
        print(f"  {name:<14}{uname:<20}{curs:<12}{c['accounts']:>4}{c['transactions']:>5}{c['budgets']:>5}{c['goals']:>5}")

if __name__ == "__main__":
    main()
