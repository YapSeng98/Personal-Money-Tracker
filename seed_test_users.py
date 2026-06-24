#!/usr/bin/env python3
"""
PFMT Seed Script — 10 realistic test users
Creates accounts, transactions, budgets, and goals for each user.
"""

import requests, json, uuid, sys
from datetime import date, timedelta

BASE = "https://dev405150.service-now.com/api/x_887486_0/pfmt"
PW   = "Test1234!"

def api(path, method="GET", body=None, token=None):
    headers = {"Content-Type": "application/json", "X-HTTP-Method": method}
    if token: headers["X-PFMT-Token"] = token
    http_verb = "POST" if method == "DELETE" else method
    url = BASE + path
    kwargs = {"headers": headers, "timeout": 30}
    if body:
        if method == "GET": kwargs["params"] = body
        else: kwargs["json"] = body
    r = getattr(requests, http_verb.lower())(url, **kwargs)
    try:
        outer = r.json().get("result", {})
        return (outer["result"] if isinstance(outer, dict) and "result" in outer else outer), r.status_code
    except:
        return None, r.status_code

def dt(days_ago=0):
    return str(date.today() - timedelta(days=days_ago))

# ─── 10 user profiles ────────────────────────────────────────────────────────

USERS = [
    {
        "username": f"alice_{uuid.uuid4().hex[:6]}",
        "display_name": "Alice Tan",
        "email": "alice@pfmt.test",
        "currency": "SGD", "language": "en",
        "monthly_income_target": 5000,
        "accounts": [
            {"account_name": "POSB Savings",   "account_type": "bank",        "current_balance": 8200,  "institution_name": "DBS"},
            {"account_name": "Cash Wallet",     "account_type": "cash",        "current_balance": 320},
            {"account_name": "OCBC Credit",     "account_type": "Credit Card", "current_balance": -450,  "institution_name": "OCBC"},
        ],
        "transactions": [
            {"type":"income",  "amount":5000,  "description":"Monthly Salary",    "category_name":"Salary",       "account_name":"POSB Savings",  "date":dt(1)},
            {"type":"expense", "amount":85,    "description":"Weekly groceries",  "category_name":"Groceries",    "account_name":"Cash Wallet",   "date":dt(2)},
            {"type":"expense", "amount":42.50, "description":"Grab rides",        "category_name":"Transport",    "account_name":"OCBC Credit",   "date":dt(3)},
            {"type":"expense", "amount":12.80, "description":"Chicken rice lunch","category_name":"Food & Drink", "account_name":"Cash Wallet",   "date":dt(4)},
            {"type":"expense", "amount":120,   "description":"Electricity bill",  "category_name":"Bills",        "account_name":"POSB Savings",  "date":dt(5)},
            {"type":"expense", "amount":35,    "description":"Netflix + Spotify", "category_name":"Entertainment","account_name":"OCBC Credit",   "date":dt(6)},
            {"type":"expense", "amount":200,   "description":"Weekend shopping",  "category_name":"Shopping",     "account_name":"OCBC Credit",   "date":dt(7)},
            {"type":"expense", "amount":9.90,  "description":"Kopitiam breakfast","category_name":"Food & Drink", "account_name":"Cash Wallet",   "date":dt(8)},
            {"type":"income",  "amount":800,   "description":"Freelance design",  "category_name":"Freelance",    "account_name":"POSB Savings",  "date":dt(10)},
            {"type":"expense", "amount":55,    "description":"GP visit",          "category_name":"Health",       "account_name":"OCBC Credit",   "date":dt(12)},
            {"type":"expense", "amount":18,    "description":"MRT top-up",        "category_name":"Transport",    "account_name":"Cash Wallet",   "date":dt(14)},
            {"type":"expense", "amount":320,   "description":"Dental checkup",    "category_name":"Health",       "account_name":"POSB Savings",  "date":dt(18)},
        ],
        "budgets": [
            {"category_name":"Food & Drink",  "budget_amount":400,  "alert_threshold":80},
            {"category_name":"Groceries",     "budget_amount":300,  "alert_threshold":75},
            {"category_name":"Transport",     "budget_amount":150,  "alert_threshold":80},
            {"category_name":"Entertainment", "budget_amount":100,  "alert_threshold":90},
            {"category_name":"Shopping",      "budget_amount":250,  "alert_threshold":85},
            {"category_name":"Health",        "budget_amount":200,  "alert_threshold":80},
        ],
        "goals": [
            {"goal_name":"Emergency Fund",  "goal_icon":"🛡️", "target_amount":15000, "current_amount":8200,  "monthly_contribution":500,  "target_date":dt(-365), "remarks":"6 months of expenses"},
            {"goal_name":"Japan Trip",      "goal_icon":"✈️", "target_amount":4500,  "current_amount":1200,  "monthly_contribution":300,  "target_date":dt(-270), "remarks":"Osaka + Kyoto 10 days"},
            {"goal_name":"New MacBook",     "goal_icon":"🖥️", "target_amount":2800,  "current_amount":800,   "monthly_contribution":200,  "target_date":dt(-180), "remarks":"M3 Pro model"},
        ],
    },
    {
        "username": f"ben_{uuid.uuid4().hex[:6]}",
        "display_name": "Ben Lim",
        "email": "ben@pfmt.test",
        "currency": "SGD", "language": "en",
        "monthly_income_target": 7500,
        "accounts": [
            {"account_name": "UOB One",         "account_type": "bank",        "current_balance": 22000, "institution_name": "UOB"},
            {"account_name": "Maybank Savings",  "account_type": "bank",        "current_balance": 5500,  "institution_name": "Maybank"},
            {"account_name": "Cash",             "account_type": "cash",        "current_balance": 180},
            {"account_name": "Citibank CC",      "account_type": "Credit Card", "current_balance": -1200, "institution_name": "Citibank"},
        ],
        "transactions": [
            {"type":"income",  "amount":7500,  "description":"Salary",              "category_name":"Salary",       "account_name":"UOB One",        "date":dt(1)},
            {"type":"expense", "amount":1800,  "description":"Rent",                "category_name":"Bills",        "account_name":"UOB One",        "date":dt(2)},
            {"type":"expense", "amount":250,   "description":"Supermarket run",     "category_name":"Groceries",    "account_name":"Citibank CC",    "date":dt(3)},
            {"type":"expense", "amount":6.50,  "description":"Coffee",              "category_name":"Food & Drink", "account_name":"Cash",           "date":dt(4)},
            {"type":"expense", "amount":88,    "description":"Gym membership",      "category_name":"Health",       "account_name":"Citibank CC",    "date":dt(5)},
            {"type":"expense", "amount":45,    "description":"Petrol",              "category_name":"Transport",    "account_name":"Citibank CC",    "date":dt(6)},
            {"type":"expense", "amount":320,   "description":"Car insurance",       "category_name":"Bills",        "account_name":"UOB One",        "date":dt(8)},
            {"type":"income",  "amount":1500,  "description":"Bonus payout",        "category_name":"Salary",       "account_name":"UOB One",        "date":dt(10)},
            {"type":"expense", "amount":135,   "description":"Team dinner",         "category_name":"Food & Drink", "account_name":"Citibank CC",    "date":dt(12)},
            {"type":"expense", "amount":580,   "description":"Flight tickets",      "category_name":"Travel",       "account_name":"Citibank CC",    "date":dt(15)},
            {"type":"expense", "amount":29,    "description":"Parking",             "category_name":"Transport",    "account_name":"Cash",           "date":dt(18)},
            {"type":"expense", "amount":199,   "description":"Online course",       "category_name":"Education",    "account_name":"Citibank CC",    "date":dt(20)},
            {"type":"income",  "amount":500,   "description":"Stock dividend",      "category_name":"Investment",   "account_name":"Maybank Savings", "date":dt(22)},
            {"type":"expense", "amount":75,    "description":"Clothing",            "category_name":"Shopping",     "account_name":"Citibank CC",    "date":dt(25)},
        ],
        "budgets": [
            {"category_name":"Food & Drink",  "budget_amount":600,  "alert_threshold":80},
            {"category_name":"Groceries",     "budget_amount":400,  "alert_threshold":75},
            {"category_name":"Transport",     "budget_amount":200,  "alert_threshold":80},
            {"category_name":"Bills",         "budget_amount":2200, "alert_threshold":95},
            {"category_name":"Health",        "budget_amount":150,  "alert_threshold":85},
            {"category_name":"Education",     "budget_amount":300,  "alert_threshold":80},
            {"category_name":"Travel",        "budget_amount":1000, "alert_threshold":90},
        ],
        "goals": [
            {"goal_name":"House Down Payment", "goal_icon":"🏠", "target_amount":120000,"current_amount":22000, "monthly_contribution":2000, "target_date":dt(-1825),"remarks":"BTO application 2028"},
            {"goal_name":"Wedding Fund",       "goal_icon":"💍", "target_amount":30000, "current_amount":8500,  "monthly_contribution":1000, "target_date":dt(-545), "remarks":"Solemnisation + dinner"},
            {"goal_name":"Europe Trip",        "goal_icon":"✈️", "target_amount":8000,  "current_amount":3200,  "monthly_contribution":500,  "target_date":dt(-365), "remarks":"2-week eurotrip"},
            {"goal_name":"Investment Buffer",  "goal_icon":"📈", "target_amount":20000, "current_amount":5500,  "monthly_contribution":500,  "target_date":dt(-730), "remarks":"War chest for market dip"},
        ],
    },
    {
        "username": f"chloe_{uuid.uuid4().hex[:6]}",
        "display_name": "Chloe Ng",
        "email": "chloe@pfmt.test",
        "currency": "MYR", "language": "en",
        "monthly_income_target": 6000,
        "accounts": [
            {"account_name": "Maybank Current", "account_type": "bank",        "current_balance": 12000, "institution_name": "Maybank"},
            {"account_name": "Touch N Go",       "account_type": "cash",        "current_balance": 150},
            {"account_name": "CIMB Credit",      "account_type": "Credit Card", "current_balance": -800,  "institution_name": "CIMB"},
        ],
        "transactions": [
            {"type":"income",  "amount":6000,  "description":"Salary",             "category_name":"Salary",       "account_name":"Maybank Current","date":dt(1)},
            {"type":"expense", "amount":1200,  "description":"Rental",             "category_name":"Bills",        "account_name":"Maybank Current","date":dt(2)},
            {"type":"expense", "amount":180,   "description":"Tesco groceries",    "category_name":"Groceries",    "account_name":"CIMB Credit",    "date":dt(3)},
            {"type":"expense", "amount":35,    "description":"Grab Food",          "category_name":"Food & Drink", "account_name":"Touch N Go",     "date":dt(5)},
            {"type":"expense", "amount":110,   "description":"Petronas petrol",    "category_name":"Transport",    "account_name":"Touch N Go",     "date":dt(7)},
            {"type":"expense", "amount":45,    "description":"Cinema date",        "category_name":"Entertainment","account_name":"CIMB Credit",    "date":dt(9)},
            {"type":"income",  "amount":1200,  "description":"Tutoring income",    "category_name":"Freelance",    "account_name":"Maybank Current","date":dt(11)},
            {"type":"expense", "amount":88,    "description":"Shopee haul",        "category_name":"Shopping",     "account_name":"CIMB Credit",    "date":dt(13)},
            {"type":"expense", "amount":22,    "description":"Mamak dinner",       "category_name":"Food & Drink", "account_name":"Touch N Go",     "date":dt(15)},
            {"type":"expense", "amount":300,   "description":"Laptop repair",      "category_name":"Health",       "account_name":"Maybank Current","date":dt(18)},
        ],
        "budgets": [
            {"category_name":"Food & Drink",  "budget_amount":500,  "alert_threshold":80},
            {"category_name":"Groceries",     "budget_amount":400,  "alert_threshold":75},
            {"category_name":"Transport",     "budget_amount":300,  "alert_threshold":80},
            {"category_name":"Entertainment", "budget_amount":150,  "alert_threshold":85},
            {"category_name":"Shopping",      "budget_amount":200,  "alert_threshold":80},
            {"category_name":"Bills",         "budget_amount":1300, "alert_threshold":95},
        ],
        "goals": [
            {"goal_name":"Car Down Payment",  "goal_icon":"🚗", "target_amount":15000, "current_amount":5000,  "monthly_contribution":800,  "target_date":dt(-540), "remarks":"Proton X50 target"},
            {"goal_name":"Postgrad Studies",  "goal_icon":"🎓", "target_amount":25000, "current_amount":8000,  "monthly_contribution":600,  "target_date":dt(-730), "remarks":"MBA part-time"},
            {"goal_name":"Bali Vacation",     "goal_icon":"🏖️", "target_amount":3000,  "current_amount":900,   "monthly_contribution":300,  "target_date":dt(-270), "remarks":"5D4N resort trip"},
        ],
    },
    {
        "username": f"david_{uuid.uuid4().hex[:6]}",
        "display_name": "David Wong",
        "email": "david@pfmt.test",
        "currency": "AUD", "language": "en",
        "monthly_income_target": 9000,
        "accounts": [
            {"account_name": "CommBank Main",  "account_type": "bank",        "current_balance": 35000, "institution_name": "CommBank"},
            {"account_name": "ING Saver",      "account_type": "bank",        "current_balance": 18000, "institution_name": "ING"},
            {"account_name": "ANZ Visa",       "account_type": "Credit Card", "current_balance": -2100, "institution_name": "ANZ"},
            {"account_name": "Cash",           "account_type": "cash",        "current_balance": 200},
        ],
        "transactions": [
            {"type":"income",  "amount":9000,  "description":"Salary",              "category_name":"Salary",       "account_name":"CommBank Main", "date":dt(1)},
            {"type":"expense", "amount":2200,  "description":"Mortgage",            "category_name":"Bills",        "account_name":"CommBank Main", "date":dt(2)},
            {"type":"expense", "amount":180,   "description":"Woolworths",          "category_name":"Groceries",    "account_name":"ANZ Visa",      "date":dt(4)},
            {"type":"expense", "amount":85,    "description":"Electricity + gas",   "category_name":"Bills",        "account_name":"CommBank Main", "date":dt(5)},
            {"type":"expense", "amount":55,    "description":"Uber rides",          "category_name":"Transport",    "account_name":"ANZ Visa",      "date":dt(6)},
            {"type":"expense", "amount":95,    "description":"Restaurant dinner",   "category_name":"Food & Drink", "account_name":"ANZ Visa",      "date":dt(8)},
            {"type":"income",  "amount":2000,  "description":"Rental income",       "category_name":"Investment",   "account_name":"CommBank Main", "date":dt(10)},
            {"type":"expense", "amount":120,   "description":"Health insurance",    "category_name":"Health",       "account_name":"CommBank Main", "date":dt(12)},
            {"type":"expense", "amount":450,   "description":"Flight Melbourne",    "category_name":"Travel",       "account_name":"ANZ Visa",      "date":dt(14)},
            {"type":"expense", "amount":65,    "description":"Gym & swimming",      "category_name":"Health",       "account_name":"ANZ Visa",      "date":dt(16)},
            {"type":"expense", "amount":280,   "description":"Electronics",         "category_name":"Shopping",     "account_name":"ANZ Visa",      "date":dt(20)},
            {"type":"expense", "amount":35,    "description":"Coffee x10",          "category_name":"Food & Drink", "account_name":"Cash",          "date":dt(22)},
        ],
        "budgets": [
            {"category_name":"Food & Drink",  "budget_amount":600,  "alert_threshold":80},
            {"category_name":"Groceries",     "budget_amount":500,  "alert_threshold":75},
            {"category_name":"Transport",     "budget_amount":200,  "alert_threshold":80},
            {"category_name":"Bills",         "budget_amount":2400, "alert_threshold":95},
            {"category_name":"Health",        "budget_amount":300,  "alert_threshold":85},
            {"category_name":"Travel",        "budget_amount":1500, "alert_threshold":80},
            {"category_name":"Shopping",      "budget_amount":400,  "alert_threshold":80},
        ],
        "goals": [
            {"goal_name":"Investment Portfolio","goal_icon":"📈","target_amount":100000,"current_amount":35000,"monthly_contribution":2000,"target_date":dt(-1095),"remarks":"ETF + index funds"},
            {"goal_name":"Europe Holiday",     "goal_icon":"✈️","target_amount":12000, "current_amount":4000, "monthly_contribution":600, "target_date":dt(-365), "remarks":"3 weeks UK+France"},
            {"goal_name":"New Car",            "goal_icon":"🚗","target_amount":45000, "current_amount":18000,"monthly_contribution":1500,"target_date":dt(-730), "remarks":"Tesla Model 3"},
        ],
    },
    {
        "username": f"emma_{uuid.uuid4().hex[:6]}",
        "display_name": "Emma Liew",
        "email": "emma@pfmt.test",
        "currency": "SGD", "language": "zh",
        "monthly_income_target": 4200,
        "accounts": [
            {"account_name": "CIMB FastSaver",  "account_type": "bank",        "current_balance": 6800,  "institution_name": "CIMB"},
            {"account_name": "Cash",            "account_type": "cash",        "current_balance": 90},
            {"account_name": "Standard CC",     "account_type": "Credit Card", "current_balance": -350,  "institution_name": "Standard Chartered"},
        ],
        "transactions": [
            {"type":"income",  "amount":4200,  "description":"月薪",             "category_name":"Salary",       "account_name":"CIMB FastSaver", "date":dt(1)},
            {"type":"expense", "amount":68,    "description":"Sheng Siong",      "category_name":"Groceries",    "account_name":"Cash",           "date":dt(2)},
            {"type":"expense", "amount":8.50,  "description":"Hawker lunch",     "category_name":"Food & Drink", "account_name":"Cash",           "date":dt(3)},
            {"type":"expense", "amount":22,    "description":"Bus & MRT",        "category_name":"Transport",    "account_name":"CIMB FastSaver", "date":dt(4)},
            {"type":"expense", "amount":88,    "description":"Utility bill",     "category_name":"Bills",        "account_name":"CIMB FastSaver", "date":dt(5)},
            {"type":"expense", "amount":55,    "description":"Zalora order",     "category_name":"Shopping",     "account_name":"Standard CC",    "date":dt(7)},
            {"type":"income",  "amount":500,   "description":"Red packet (CNY)", "category_name":"Other",        "account_name":"Cash",           "date":dt(9)},
            {"type":"expense", "amount":15,    "description":"Bubble tea",       "category_name":"Food & Drink", "account_name":"Cash",           "date":dt(11)},
            {"type":"expense", "amount":120,   "description":"H&M shopping",     "category_name":"Shopping",     "account_name":"Standard CC",    "date":dt(14)},
            {"type":"expense", "amount":38,    "description":"Movie night",      "category_name":"Entertainment","account_name":"Standard CC",    "date":dt(17)},
        ],
        "budgets": [
            {"category_name":"Food & Drink",  "budget_amount":300,  "alert_threshold":80},
            {"category_name":"Groceries",     "budget_amount":250,  "alert_threshold":75},
            {"category_name":"Transport",     "budget_amount":100,  "alert_threshold":80},
            {"category_name":"Shopping",      "budget_amount":200,  "alert_threshold":85},
            {"category_name":"Entertainment", "budget_amount":80,   "alert_threshold":90},
        ],
        "goals": [
            {"goal_name":"结婚基金",   "goal_icon":"💍","target_amount":20000,"current_amount":3500, "monthly_contribution":500,"target_date":dt(-730),"remarks":"婚礼及蜜月旅行"},
            {"goal_name":"Korea Trip", "goal_icon":"✈️","target_amount":3500, "current_amount":700,  "monthly_contribution":250,"target_date":dt(-365),"remarks":"Seoul & Jeju 7 days"},
            {"goal_name":"新手机",     "goal_icon":"🖥️","target_amount":1500, "current_amount":600,  "monthly_contribution":150,"target_date":dt(-180),"remarks":"iPhone 16 Pro"},
        ],
    },
    {
        "username": f"farid_{uuid.uuid4().hex[:6]}",
        "display_name": "Farid Hassan",
        "email": "farid@pfmt.test",
        "currency": "SGD", "language": "en",
        "monthly_income_target": 8000,
        "accounts": [
            {"account_name": "DBS Multiplier",  "account_type": "bank",        "current_balance": 45000, "institution_name": "DBS"},
            {"account_name": "OCBC 360",         "account_type": "bank",        "current_balance": 12000, "institution_name": "OCBC"},
            {"account_name": "Cash",             "account_type": "cash",        "current_balance": 250},
            {"account_name": "DBS Altitude CC",  "account_type": "Credit Card", "current_balance": -3200, "institution_name": "DBS"},
        ],
        "transactions": [
            {"type":"income",  "amount":8000,  "description":"Salary",             "category_name":"Salary",       "account_name":"DBS Multiplier", "date":dt(1)},
            {"type":"expense", "amount":2800,  "description":"HDB mortgage",       "category_name":"Bills",        "account_name":"DBS Multiplier", "date":dt(2)},
            {"type":"expense", "amount":320,   "description":"Family groceries",   "category_name":"Groceries",    "account_name":"DBS Altitude CC","date":dt(3)},
            {"type":"expense", "amount":95,    "description":"Halal restaurant",   "category_name":"Food & Drink", "account_name":"Cash",           "date":dt(5)},
            {"type":"expense", "amount":180,   "description":"Esso petrol",        "category_name":"Transport",    "account_name":"DBS Altitude CC","date":dt(6)},
            {"type":"income",  "amount":2000,  "description":"Side business",      "category_name":"Freelance",    "account_name":"OCBC 360",       "date":dt(8)},
            {"type":"expense", "amount":450,   "description":"Family takaful",     "category_name":"Health",       "account_name":"DBS Multiplier", "date":dt(10)},
            {"type":"expense", "amount":88,    "description":"Kids enrichment",    "category_name":"Education",    "account_name":"DBS Altitude CC","date":dt(12)},
            {"type":"expense", "amount":65,    "description":"ERP + parking",      "category_name":"Transport",    "account_name":"DBS Altitude CC","date":dt(14)},
            {"type":"expense", "amount":250,   "description":"Lazada electronics", "category_name":"Shopping",     "account_name":"DBS Altitude CC","date":dt(16)},
            {"type":"expense", "amount":38,    "description":"Weekend brunch",     "category_name":"Food & Drink", "account_name":"Cash",           "date":dt(20)},
            {"type":"income",  "amount":1200,  "description":"REITs dividend",     "category_name":"Investment",   "account_name":"OCBC 360",       "date":dt(25)},
        ],
        "budgets": [
            {"category_name":"Food & Drink",  "budget_amount":700,  "alert_threshold":80},
            {"category_name":"Groceries",     "budget_amount":500,  "alert_threshold":75},
            {"category_name":"Transport",     "budget_amount":350,  "alert_threshold":80},
            {"category_name":"Bills",         "budget_amount":3000, "alert_threshold":95},
            {"category_name":"Health",        "budget_amount":500,  "alert_threshold":85},
            {"category_name":"Education",     "budget_amount":200,  "alert_threshold":80},
            {"category_name":"Shopping",      "budget_amount":300,  "alert_threshold":80},
        ],
        "goals": [
            {"goal_name":"Kids Education Fund","goal_icon":"🎓","target_amount":80000,"current_amount":15000,"monthly_contribution":1500,"target_date":dt(-3650),"remarks":"University fund for 2 kids"},
            {"goal_name":"Umrah Savings",      "goal_icon":"🕌","target_amount":12000,"current_amount":4500, "monthly_contribution":600, "target_date":dt(-540), "remarks":"Family of 4"},
            {"goal_name":"Renovation Fund",    "goal_icon":"🏠","target_amount":35000,"current_amount":8000, "monthly_contribution":1000,"target_date":dt(-1095),"remarks":"Full HDB reno 2027"},
            {"goal_name":"Emergency Reserve",  "goal_icon":"🛡️","target_amount":25000,"current_amount":12000,"monthly_contribution":500, "target_date":dt(-365), "remarks":"12 months expenses"},
        ],
    },
    {
        "username": f"grace_{uuid.uuid4().hex[:6]}",
        "display_name": "Grace Koh",
        "email": "grace@pfmt.test",
        "currency": "SGD", "language": "en",
        "monthly_income_target": 3800,
        "accounts": [
            {"account_name": "POSB eSavings",   "account_type": "bank",        "current_balance": 4200,  "institution_name": "DBS"},
            {"account_name": "Cash",             "account_type": "cash",        "current_balance": 60},
        ],
        "transactions": [
            {"type":"income",  "amount":3800,  "description":"Salary",              "category_name":"Salary",       "account_name":"POSB eSavings",  "date":dt(1)},
            {"type":"expense", "amount":1400,  "description":"Room rental",         "category_name":"Bills",        "account_name":"POSB eSavings",  "date":dt(2)},
            {"type":"expense", "amount":55,    "description":"Fairprice NTUC",      "category_name":"Groceries",    "account_name":"POSB eSavings",  "date":dt(4)},
            {"type":"expense", "amount":7.80,  "description":"Hawker breakfast",    "category_name":"Food & Drink", "account_name":"Cash",           "date":dt(5)},
            {"type":"expense", "amount":45,    "description":"Monthly bus pass",    "category_name":"Transport",    "account_name":"POSB eSavings",  "date":dt(6)},
            {"type":"expense", "amount":18,    "description":"Boba & snacks",       "category_name":"Food & Drink", "account_name":"Cash",           "date":dt(8)},
            {"type":"income",  "amount":300,   "description":"Part-time tutoring",  "category_name":"Freelance",    "account_name":"POSB eSavings",  "date":dt(10)},
            {"type":"expense", "amount":28,    "description":"Uniqlo shirt",        "category_name":"Shopping",     "account_name":"POSB eSavings",  "date":dt(12)},
            {"type":"expense", "amount":12,    "description":"Grabfood delivery",   "category_name":"Food & Drink", "account_name":"Cash",           "date":dt(15)},
            {"type":"expense", "amount":45,    "description":"Pharmacy (period pain)","category_name":"Health",     "account_name":"POSB eSavings",  "date":dt(18)},
        ],
        "budgets": [
            {"category_name":"Food & Drink",  "budget_amount":200,  "alert_threshold":80},
            {"category_name":"Groceries",     "budget_amount":150,  "alert_threshold":75},
            {"category_name":"Transport",     "budget_amount":80,   "alert_threshold":85},
            {"category_name":"Shopping",      "budget_amount":100,  "alert_threshold":80},
            {"category_name":"Bills",         "budget_amount":1500, "alert_threshold":95},
        ],
        "goals": [
            {"goal_name":"First Laptop",     "goal_icon":"🖥️","target_amount":1800, "current_amount":650,  "monthly_contribution":200,"target_date":dt(-270),"remarks":"For WFH productivity"},
            {"goal_name":"Travel Fund",      "goal_icon":"✈️","target_amount":5000, "current_amount":800,  "monthly_contribution":250,"target_date":dt(-540),"remarks":"SEA backpacking"},
            {"goal_name":"Emergency Buffer", "goal_icon":"🛡️","target_amount":5000, "current_amount":1200, "monthly_contribution":300,"target_date":dt(-365),"remarks":"3 months safety net"},
        ],
    },
    {
        "username": f"harry_{uuid.uuid4().hex[:6]}",
        "display_name": "Harry Teo",
        "email": "harry@pfmt.test",
        "currency": "SGD", "language": "en",
        "monthly_income_target": 12000,
        "accounts": [
            {"account_name": "UOB Stash",        "account_type": "bank",        "current_balance": 88000, "institution_name": "UOB"},
            {"account_name": "SCB Bonus Saver",   "account_type": "bank",        "current_balance": 32000, "institution_name": "Standard Chartered"},
            {"account_name": "Cash",              "account_type": "cash",        "current_balance": 500},
            {"account_name": "Amex Platinum",     "account_type": "Credit Card", "current_balance": -8500, "institution_name": "Amex"},
            {"account_name": "Crypto Wallet",     "account_type": "Other",       "current_balance": 15000},
        ],
        "transactions": [
            {"type":"income",  "amount":12000, "description":"Director salary",    "category_name":"Salary",       "account_name":"UOB Stash",       "date":dt(1)},
            {"type":"expense", "amount":3500,  "description":"Condo mortgage",     "category_name":"Bills",        "account_name":"UOB Stash",       "date":dt(2)},
            {"type":"expense", "amount":480,   "description":"Cold Storage",       "category_name":"Groceries",    "account_name":"Amex Platinum",   "date":dt(3)},
            {"type":"expense", "amount":350,   "description":"Fine dining",        "category_name":"Food & Drink", "account_name":"Amex Platinum",   "date":dt(5)},
            {"type":"expense", "amount":850,   "description":"BMW servicing",      "category_name":"Transport",    "account_name":"Amex Platinum",   "date":dt(7)},
            {"type":"income",  "amount":5000,  "description":"Consulting retainer","category_name":"Freelance",    "account_name":"SCB Bonus Saver", "date":dt(8)},
            {"type":"expense", "amount":1200,  "description":"Life insurance",     "category_name":"Health",       "account_name":"UOB Stash",       "date":dt(10)},
            {"type":"expense", "amount":680,   "description":"Golf membership",    "category_name":"Entertainment","account_name":"Amex Platinum",   "date":dt(12)},
            {"type":"income",  "amount":3500,  "description":"Dividend income",    "category_name":"Investment",   "account_name":"UOB Stash",       "date":dt(15)},
            {"type":"expense", "amount":2800,  "description":"Watch purchase",     "category_name":"Shopping",     "account_name":"Amex Platinum",   "date":dt(18)},
            {"type":"expense", "amount":4500,  "description":"Family holiday",     "category_name":"Travel",       "account_name":"Amex Platinum",   "date":dt(22)},
            {"type":"expense", "amount":220,   "description":"Kids school fees",   "category_name":"Education",    "account_name":"UOB Stash",       "date":dt(25)},
        ],
        "budgets": [
            {"category_name":"Food & Drink",  "budget_amount":1500, "alert_threshold":80},
            {"category_name":"Groceries",     "budget_amount":800,  "alert_threshold":75},
            {"category_name":"Transport",     "budget_amount":1000, "alert_threshold":80},
            {"category_name":"Bills",         "budget_amount":4000, "alert_threshold":95},
            {"category_name":"Entertainment", "budget_amount":1000, "alert_threshold":80},
            {"category_name":"Travel",        "budget_amount":5000, "alert_threshold":80},
            {"category_name":"Shopping",      "budget_amount":3000, "alert_threshold":80},
            {"category_name":"Health",        "budget_amount":1500, "alert_threshold":85},
        ],
        "goals": [
            {"goal_name":"Second Property",  "goal_icon":"🏠","target_amount":300000,"current_amount":88000,"monthly_contribution":5000,"target_date":dt(-1825),"remarks":"Investment property"},
            {"goal_name":"Retirement Fund",  "goal_icon":"🛡️","target_amount":2000000,"current_amount":150000,"monthly_contribution":3000,"target_date":dt(-7300),"remarks":"FIRE at 50"},
            {"goal_name":"Kids Uni Fund",    "goal_icon":"🎓","target_amount":200000,"current_amount":45000,"monthly_contribution":2000,"target_date":dt(-5475),"remarks":"Overseas degree x2"},
            {"goal_name":"Yacht Fund",       "goal_icon":"🚢","target_amount":500000,"current_amount":32000,"monthly_contribution":3000,"target_date":dt(-3650),"remarks":"Benetti 50ft"},
        ],
    },
    {
        "username": f"iris_{uuid.uuid4().hex[:6]}",
        "display_name": "Iris Chan",
        "email": "iris@pfmt.test",
        "currency": "SGD", "language": "zh",
        "monthly_income_target": 5500,
        "accounts": [
            {"account_name": "Maybank Savings",  "account_type": "bank",        "current_balance": 9500,  "institution_name": "Maybank"},
            {"account_name": "GrabPay",          "account_type": "cash",        "current_balance": 180},
            {"account_name": "Maybank CC",       "account_type": "Credit Card", "current_balance": -720,  "institution_name": "Maybank"},
        ],
        "transactions": [
            {"type":"income",  "amount":5500,  "description":"工资",              "category_name":"Salary",       "account_name":"Maybank Savings", "date":dt(1)},
            {"type":"expense", "amount":95,    "description":"烹饪材料",           "category_name":"Groceries",    "account_name":"GrabPay",         "date":dt(3)},
            {"type":"expense", "amount":28,    "description":"麻辣火锅",           "category_name":"Food & Drink", "account_name":"Maybank CC",      "date":dt(5)},
            {"type":"expense", "amount":55,    "description":"地铁充值",           "category_name":"Transport",    "account_name":"GrabPay",         "date":dt(6)},
            {"type":"expense", "amount":130,   "description":"手机账单",           "category_name":"Bills",        "account_name":"Maybank Savings", "date":dt(7)},
            {"type":"expense", "amount":75,    "description":"护肤品",             "category_name":"Shopping",     "account_name":"Maybank CC",      "date":dt(9)},
            {"type":"income",  "amount":800,   "description":"网上销售",           "category_name":"Freelance",    "account_name":"Maybank Savings", "date":dt(11)},
            {"type":"expense", "amount":45,    "description":"健身房月费",         "category_name":"Health",       "account_name":"Maybank CC",      "date":dt(13)},
            {"type":"expense", "amount":22,    "description":"奶茶",               "category_name":"Food & Drink", "account_name":"GrabPay",         "date":dt(16)},
            {"type":"expense", "amount":150,   "description":"Taobao购物",        "category_name":"Shopping",     "account_name":"Maybank CC",      "date":dt(19)},
            {"type":"expense", "amount":35,    "description":"电影票",             "category_name":"Entertainment","account_name":"Maybank CC",      "date":dt(22)},
        ],
        "budgets": [
            {"category_name":"Food & Drink",  "budget_amount":350,  "alert_threshold":80},
            {"category_name":"Groceries",     "budget_amount":300,  "alert_threshold":75},
            {"category_name":"Transport",     "budget_amount":120,  "alert_threshold":80},
            {"category_name":"Shopping",      "budget_amount":300,  "alert_threshold":85},
            {"category_name":"Health",        "budget_amount":100,  "alert_threshold":80},
            {"category_name":"Entertainment", "budget_amount":80,   "alert_threshold":85},
        ],
        "goals": [
            {"goal_name":"台湾旅行",         "goal_icon":"✈️","target_amount":4000, "current_amount":1500, "monthly_contribution":300,"target_date":dt(-365),"remarks":"台北+花莲10天"},
            {"goal_name":"结婚钻戒",         "goal_icon":"💍","target_amount":8000, "current_amount":2200, "monthly_contribution":400,"target_date":dt(-540),"remarks":"GIA证书"},
            {"goal_name":"学车基金",         "goal_icon":"🚗","target_amount":3000, "current_amount":800,  "monthly_contribution":200,"target_date":dt(-365),"remarks":"私人学院"},
            {"goal_name":"Emergency Fund",   "goal_icon":"🛡️","target_amount":10000,"current_amount":3500, "monthly_contribution":400,"target_date":dt(-540),"remarks":"6 months buffer"},
        ],
    },
    {
        "username": f"jake_{uuid.uuid4().hex[:6]}",
        "display_name": "Jake Sim",
        "email": "jake@pfmt.test",
        "currency": "SGD", "language": "en",
        "monthly_income_target": 6500,
        "accounts": [
            {"account_name": "OCBC 360",      "account_type": "bank",        "current_balance": 18000, "institution_name": "OCBC"},
            {"account_name": "GXS Bank",      "account_type": "bank",        "current_balance": 3500,  "institution_name": "GXS"},
            {"account_name": "Cash",          "account_type": "cash",        "current_balance": 120},
            {"account_name": "UOB One CC",    "account_type": "Credit Card", "current_balance": -1800, "institution_name": "UOB"},
        ],
        "transactions": [
            {"type":"income",  "amount":6500,  "description":"Software engineer salary","category_name":"Salary",      "account_name":"OCBC 360",    "date":dt(1)},
            {"type":"expense", "amount":1500,  "description":"Rent (Jurong)",      "category_name":"Bills",        "account_name":"OCBC 360",    "date":dt(2)},
            {"type":"expense", "amount":120,   "description":"Fairprice online",   "category_name":"Groceries",    "account_name":"UOB One CC",  "date":dt(4)},
            {"type":"expense", "amount":14.50, "description":"Cai png lunch",      "category_name":"Food & Drink", "account_name":"Cash",        "date":dt(5)},
            {"type":"expense", "amount":98,    "description":"Phone bill (Singtel)","category_name":"Bills",        "account_name":"OCBC 360",    "date":dt(6)},
            {"type":"income",  "amount":1500,  "description":"Freelance dev work",  "category_name":"Freelance",    "account_name":"GXS Bank",    "date":dt(8)},
            {"type":"expense", "amount":48,    "description":"Steam games",         "category_name":"Entertainment","account_name":"UOB One CC",  "date":dt(10)},
            {"type":"expense", "amount":25,    "description":"Grab to airport",     "category_name":"Transport",    "account_name":"UOB One CC",  "date":dt(12)},
            {"type":"expense", "amount":380,   "description":"Mechanical keyboard", "category_name":"Shopping",     "account_name":"UOB One CC",  "date":dt(14)},
            {"type":"expense", "amount":85,    "description":"Medical checkup",     "category_name":"Health",       "account_name":"OCBC 360",    "date":dt(16)},
            {"type":"expense", "amount":60,    "description":"Udemy courses",       "category_name":"Education",    "account_name":"UOB One CC",  "date":dt(18)},
            {"type":"expense", "amount":22,    "description":"Kopi + toast",        "category_name":"Food & Drink", "account_name":"Cash",        "date":dt(21)},
            {"type":"income",  "amount":800,   "description":"Tech blog AdSense",   "category_name":"Investment",   "account_name":"GXS Bank",    "date":dt(25)},
            {"type":"expense", "amount":150,   "description":"Nike running shoes",  "category_name":"Shopping",     "account_name":"UOB One CC",  "date":dt(28)},
        ],
        "budgets": [
            {"category_name":"Food & Drink",  "budget_amount":400,  "alert_threshold":80},
            {"category_name":"Groceries",     "budget_amount":200,  "alert_threshold":75},
            {"category_name":"Transport",     "budget_amount":100,  "alert_threshold":80},
            {"category_name":"Bills",         "budget_amount":1700, "alert_threshold":95},
            {"category_name":"Entertainment", "budget_amount":150,  "alert_threshold":80},
            {"category_name":"Shopping",      "budget_amount":400,  "alert_threshold":80},
            {"category_name":"Education",     "budget_amount":100,  "alert_threshold":80},
        ],
        "goals": [
            {"goal_name":"BTO Down Payment",  "goal_icon":"🏠","target_amount":50000,"current_amount":18000,"monthly_contribution":1500,"target_date":dt(-1825),"remarks":"Punggol BTO 2029"},
            {"goal_name":"RTX 5090 PC Build", "goal_icon":"🖥️","target_amount":5000, "current_amount":1200, "monthly_contribution":300, "target_date":dt(-365), "remarks":"Dream gaming rig"},
            {"goal_name":"Japan Trip",        "goal_icon":"✈️","target_amount":5500, "current_amount":2000, "monthly_contribution":400, "target_date":dt(-365), "remarks":"Tokyo DisneySea"},
            {"goal_name":"Stock Portfolio",   "goal_icon":"📈","target_amount":30000,"current_amount":3500, "monthly_contribution":800, "target_date":dt(-1095),"remarks":"REITs + US ETFs"},
        ],
    },
]

# ─── seed ─────────────────────────────────────────────────────────────────────

total_ok = 0
total_fail = 0

for u in USERS:
    uname = u["username"]
    print(f"\n{'─'*60}")
    print(f"  Seeding: {u['display_name']} ({uname})")
    print(f"{'─'*60}")

    # Register
    p, s = api("/auth/register", "POST", {
        "username": uname, "password": PW,
        "display_name": u["display_name"], "email": u["email"],
        "currency": u["currency"], "language": u["language"]
    })
    ok = s == 201
    print(f"  {'✅' if ok else '❌'} Register  ({s})")
    if not ok:
        print(f"     Skipping — registration failed: {p}")
        total_fail += 1
        continue
    total_ok += 1

    # Login
    p, s = api("/auth/login", "POST", {"username": uname, "password": PW})
    if isinstance(p, dict) and "result" in p: p = p["result"]
    tok = (p or {}).get("token")
    ok = s == 200 and tok
    print(f"  {'✅' if ok else '❌'} Login  ({s})")
    if not ok:
        total_fail += 1
        continue
    total_ok += 1

    # Update monthly income target
    api("/profile", "PUT", {"monthly_income_target": u["monthly_income_target"]}, token=tok)

    # Accounts
    acc_ids = {}
    for acc in u["accounts"]:
        p, s = api("/accounts", "POST", acc, token=tok)
        ok = s == 201
        print(f"  {'✅' if ok else '❌'} Account: {acc['account_name']}  ({s})")
        total_ok += ok; total_fail += (not ok)

    # Transactions
    for txn in u["transactions"]:
        p, s = api("/transactions", "POST", txn, token=tok)
        ok = s == 201
        print(f"  {'✅' if ok else '❌'} Txn: {txn['description'][:30]}  ({s})")
        total_ok += ok; total_fail += (not ok)

    # Budgets
    for bdg in u["budgets"]:
        p, s = api("/budgets", "POST", bdg, token=tok)
        ok = s == 201
        print(f"  {'✅' if ok else '❌'} Budget: {bdg['category_name']}  ({s})")
        total_ok += ok; total_fail += (not ok)

    # Goals
    for goal in u["goals"]:
        p, s = api("/goals", "POST", goal, token=tok)
        ok = s == 201
        print(f"  {'✅' if ok else '❌'} Goal: {goal['goal_name']}  ({s})")
        total_ok += ok; total_fail += (not ok)

print(f"\n{'═'*60}")
print(f"  SEED COMPLETE — {total_ok} ✅  {total_fail} ❌")
print(f"{'═'*60}\n")
