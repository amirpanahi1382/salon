#!/usr/bin/env python3
"""Bounded, read-only Phase 8/9 historical-integrity preflight.

Exit 0: checked snapshot is clean.  Exit 2: integrity conflicts.  Exit 1:
identity, privilege, or operational failure.  The script emits only counts and
internal UUIDs; it never selects contact, message, evidence, or credential data.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys

SAFE = re.compile(r"^[A-Za-z_][A-Za-z0-9_-]{0,62}$")
ID = re.compile(r"^\d{1,30}$")

CANONICAL = ("salon-phone-first-empty-pg-20261024T061347Z", "salon-db", "7700113693112733735", "phone-first-empty:20261024T061347Z")

def lit(value: str) -> str:
    if "\x00" in value or "\n" in value or "\r" in value:
        raise ValueError("unsafe input")
    return "'" + value.replace("'", "''") + "'"

def sql(database: str, system_id: str, comment: str, limit: int) -> str:
    return f"""
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
DO $$ DECLARE actual_name text; actual_id text; actual_comment text; BEGIN
  IF to_regprocedure('public.canonical_database_identity()') IS NOT NULL THEN
    SELECT database_name, system_identifier, coalesce(database_comment, '')
      INTO actual_name, actual_id, actual_comment
      FROM public.canonical_database_identity();
  ELSE
    SELECT current_database(), s.system_identifier::text,
      coalesce(shobj_description(d.oid, 'pg_database'), '')
      INTO actual_name, actual_id, actual_comment
      FROM pg_database d CROSS JOIN pg_control_system() s WHERE d.datname = current_database();
  END IF;
  IF actual_name IS DISTINCT FROM {lit(database)} OR actual_id IS DISTINCT FROM {lit(system_id)}
     OR actual_comment IS DISTINCT FROM {lit(comment)} THEN
    RAISE EXCEPTION 'identity mismatch';
  END IF;
END $$;
SELECT 'identity|' || current_database();
SELECT 'constraint|' || conrelid::regclass::text || '|' || conname || '|' || contype::text || '|' || convalidated::text
FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND NOT convalidated
ORDER BY conrelid::regclass::text, conname;
WITH labels(k) AS (VALUES
  ('opportunity_actions.created_by'), ('message_requests.created_by_user_id'),
  ('message_deliveries.created_by'), ('vip_requests.created_by_user_id'),
  ('vip_request_recipients.message_request_id')),
v AS (
  SELECT 'opportunity_actions.created_by' k, a.id child FROM opportunity_actions a LEFT JOIN users u ON u.id=a.created_by WHERE u.id IS NULL OR u.salon_id<>a.salon_id
  UNION ALL SELECT 'message_requests.created_by_user_id', r.id FROM message_requests r LEFT JOIN users u ON u.id=r.created_by_user_id WHERE u.id IS NULL OR u.salon_id<>r.salon_id
  UNION ALL SELECT 'message_deliveries.created_by', d.id FROM message_deliveries d LEFT JOIN users u ON u.id=d.created_by WHERE u.id IS NULL OR u.salon_id<>d.salon_id
  UNION ALL SELECT 'vip_requests.created_by_user_id', v.id FROM vip_requests v LEFT JOIN users u ON u.id=v.created_by_user_id WHERE u.id IS NULL OR u.salon_id<>v.salon_id
  UNION ALL SELECT 'vip_request_recipients.message_request_id', v.id FROM vip_request_recipients v LEFT JOIN message_requests r ON r.id=v.message_request_id WHERE v.message_request_id IS NOT NULL AND (r.id IS NULL OR r.salon_id<>v.salon_id)
), grouped AS (SELECT k, count(*) n, array_agg(child::text ORDER BY child::text) ids FROM v GROUP BY k)
SELECT 'relation|' || labels.k || '|' || coalesce(grouped.n,0) || '|' || coalesce(array_to_string(grouped.ids[1:{limit}], ','),'') FROM labels LEFT JOIN grouped USING(k) ORDER BY labels.k;
WITH it AS (SELECT transaction_id, salon_id, count(*) n, coalesce(sum(total_amount),0) total, count(*) FILTER (WHERE total_amount <> unit_price*quantity) bad_math FROM transaction_items GROUP BY transaction_id,salon_id),
labels(k) AS (VALUES ('missing_items'), ('header_sum_mismatch'), ('item_math_mismatch')),
v AS (
  SELECT t.id, 'missing_items' k FROM transactions t LEFT JOIN it ON it.transaction_id=t.id AND it.salon_id=t.salon_id WHERE coalesce(it.n,0)=0
  UNION ALL SELECT t.id, 'header_sum_mismatch' FROM transactions t JOIN it ON it.transaction_id=t.id AND it.salon_id=t.salon_id WHERE t.amount<>it.total
  UNION ALL SELECT t.id, 'item_math_mismatch' FROM transactions t JOIN it ON it.transaction_id=t.id AND it.salon_id=t.salon_id WHERE it.bad_math>0
),
g AS (SELECT k,count(*) n,array_agg(id::text ORDER BY id::text) ids FROM v GROUP BY k)
SELECT 'financial|' || labels.k || '|' || coalesce(g.n,0) || '|' || coalesce(array_to_string(g.ids[1:{limit}], ','),'') FROM labels LEFT JOIN g USING(k) ORDER BY labels.k;
WITH v AS (SELECT i.id FROM transaction_items i LEFT JOIN transactions t ON t.id=i.transaction_id AND t.salon_id=i.salon_id LEFT JOIN services s ON s.id=i.service_id AND s.salon_id=i.salon_id WHERE t.id IS NULL OR s.id IS NULL)
SELECT 'financial|orphan_item_relation|' || count(*) || '|' || coalesce(string_agg(id::text, ',' ORDER BY id::text), '') FROM (SELECT id FROM v ORDER BY id LIMIT {limit}) x;
ROLLBACK;
"""

def main() -> int:
    p=argparse.ArgumentParser()
    p.add_argument('--container',required=True); p.add_argument('--database',required=True); p.add_argument('--expected-system-identifier',required=True); p.add_argument('--expected-comment',required=True); p.add_argument('--user',default='salon_app'); p.add_argument('--canonical-read-only',action='store_true'); p.add_argument('--sample-limit',type=int,default=20)
    a=p.parse_args()
    if not all(SAFE.fullmatch(x) for x in (a.container,a.database,a.user)) or not ID.fullmatch(a.expected_system_identifier) or not 1<=a.sample_limit<=100:
        print('unsafe or incomplete target identity',file=sys.stderr); return 1
    if (a.container,a.database,a.expected_system_identifier,a.expected_comment)==CANONICAL:
        if not a.canonical_read_only: print('canonical target requires --canonical-read-only',file=sys.stderr); return 1
    elif a.canonical_read_only:
        print('canonical mode requires the exact canonical identity',file=sys.stderr); return 1
    try: statement=sql(a.database,a.expected_system_identifier,a.expected_comment,a.sample_limit)
    except ValueError: print('unsafe target identity',file=sys.stderr); return 1
    r=subprocess.run(['docker','exec','-i',a.container,'psql','-X','-v','ON_ERROR_STOP=1','-U',a.user,'-d',a.database,'-tA','-f','-'],input=statement,text=True,capture_output=True)
    if r.returncode:
        print('preflight operational failure' if 'identity mismatch' not in r.stderr else 'database identity does not match',file=sys.stderr); return 1
    lines=[x for x in r.stdout.splitlines() if x and x not in {'BEGIN','SET','DO','ROLLBACK'}]
    conflicts=[]
    for line in lines:
        if line.startswith(('relation|','financial|')):
            parts=line.split('|',3)
            if len(parts)>2 and parts[2] != '0': conflicts.append(line)
        print(line)
    print('preflight=conflicts' if conflicts else 'preflight=clear')
    return 2 if conflicts else 0

if __name__=='__main__': sys.exit(main())
