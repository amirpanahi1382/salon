#!/usr/bin/env python3
"""Transfer one historical VIP inventory into a phone-first destination.

The write identity is salon_app. Source inspection and destination preflight
use a separate read-only session because salon_app cannot read the migration
ledger. Expected identities are arguments. They are never copied from the
connection being judged.

The script does not print phone numbers, message bodies, passwords, or
connection URLs.

The 2026-10-27 transfer imported into phone_first_product. That logical
database was later renamed to salon-db on the same cluster. Execute and
rollback refuse the canonical system identifier so the historical import
cannot be replayed there. Audit rows keep the original destination name.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import uuid
from dataclasses import dataclass

PHONE_RE = re.compile(r"^09[0-9]{9}$")
PHONE_SEARCH_RE = re.compile(r"(?<![0-9A-Fa-f])09[0-9]{9}(?![0-9A-Fa-f])")
UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)
TIMESTAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
REGION_RE = re.compile(r"^(0[1-9]|1[0-4])$")
SYSID_RE = re.compile(r"^\d{1,30}$")
IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
DATABASE_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_-]{0,62}$")

ORIGIN_SYSTEM_IDENTIFIER = "7683163620851879970"
CANONICAL_SYSTEM_IDENTIFIER = "7700113693112733735"
# Name recorded by the completed transfer. The live database is salon-db.
CANONICAL_DATABASE = "phone_first_product"
RENAMED_CANONICAL_DATABASE = "salon-db"
CANONICAL_COMMENT = "phone-first-empty:20261024T061347Z"
CANONICAL_CONTAINER = "salon-phone-first-empty-pg-20261024T061347Z"
HISTORICAL_CONTAINER = "salon-platform-postgres-1"
HISTORICAL_DATABASE = "salon"
SOURCE_MIGRATION_HEAD = "20261015190000_activation_receipts"
SOURCE_MIGRATION_COUNT = 41
DESTINATION_MIGRATION_HEAD = "20261017150000_phone_first_identity"
DESTINATION_MIGRATION_COUNT = 42
EXPECTED_LIST_COUNT = 29
EXPECTED_CONTACT_COUNT = 2194
EXPECTED_LIST_ID_MD5 = "0c64dcf9be0b92049406c13af43d0ece"
EXPECTED_PHONE_MD5 = "b2724bfc710ad59aae6466bd0384079e"
EXPECTED_CONTACT_TUPLE_MD5 = "d20c43aee3a8c17f0e00498df616bd5f"
SMALL_LISTS = {"VIP-11-01": 28, "VIP-14-01": 27}
LIST_COLUMNS = (
    "id",
    "name",
    "status",
    "contact_count",
    "created_by_admin_id",
    "reserved_by_salon_id",
    "reserved_at",
    "created_at",
    "updated_at",
    "region_code",
    "catalog_membership",
)
CONTACT_COLUMNS = (
    "id",
    "list_id",
    "sort_order",
    "display_name",
    "phone_number",
    "created_at",
)
SAFETY_TABLES = (
    "platform_message_stops",
    "platform_message_stop_events",
    "message_global_stop_outcomes",
    "message_deliveries",
)
PRESERVED_TABLES = (
    "salons",
    "users",
    "platform_admins",
    "agreement_versions",
    "agreement_presentations",
    "agreement_acceptances",
    "activation_receipts",
    "customers",
    "services",
    "visits",
    "transactions",
    "message_requests",
    "message_deliveries",
    "outbox_events",
    "vip_requests",
    "vip_request_recipients",
    "vip_salon_entitlements",
    "platform_message_stops",
    "platform_message_stop_events",
    "message_global_stop_outcomes",
)
TRANSFER_ACTION = "VIP_INVENTORY_TRANSFER"
ROLLBACK_ACTION = "VIP_INVENTORY_TRANSFER_ROLLBACK"
CONTACT_BATCH = 400
ADVISORY_LOCK = "SELECT pg_advisory_xact_lock(8742, 3)"


class TransferRejected(SystemExit):
    def __init__(self, message: str, code: int = 1) -> None:
        super().__init__(code)
        self.message = message


@dataclass(frozen=True)
class Identity:
    database: str
    system_identifier: str
    comment: str | None


@dataclass(frozen=True)
class ListRow:
    id: str
    name: str
    status: str
    contact_count: int
    region_code: str
    catalog_membership: str
    created_by_admin_id: str
    reserved_by_salon_id: str
    reserved_at: str
    created_at: str
    updated_at: str


@dataclass(frozen=True)
class ContactRow:
    id: str
    list_id: str
    sort_order: int
    display_name: str | None
    phone_number: str
    created_at: str


def redact(text: str) -> str:
    redacted = PHONE_SEARCH_RE.sub("[redacted-phone]", text)
    redacted = re.sub(r"postgres(?:ql)?://\S+", "[redacted-url]", redacted, flags=re.IGNORECASE)
    redacted = re.sub(r"(?i)(password\s*=\s*)\S+", r"\1[redacted]", redacted)
    return redacted


def sql_literal(value: str) -> str:
    if "\x00" in value:
        raise TransferRejected("refusing an unsafe SQL literal")
    return "'" + value.replace("'", "''") + "'"


def dollar_quote(value: str) -> str:
    tag = "vipmanifest"
    while f"${tag}$" in value:
        tag += "x"
    return f"${tag}${value}${tag}$"


def require_uuid(value: str, label: str) -> str:
    lowered = value.strip().lower()
    if not UUID_RE.fullmatch(lowered):
        raise TransferRejected(f"{label} is not a uuid")
    return lowered


def require_identifier(value: str, label: str) -> str:
    if not IDENTIFIER_RE.fullmatch(value):
        raise TransferRejected(f"refusing {label}")
    return value


def require_database_name(value: str, label: str) -> str:
    if not DATABASE_RE.fullmatch(value) or "--" in value:
        raise TransferRejected(f"refusing {label}")
    return value


def require_sysid(value: str) -> str:
    if not SYSID_RE.fullmatch(value):
        raise TransferRejected("refusing system identifier")
    return value


def assert_no_phone_text(value: str, label: str) -> None:
    if PHONE_SEARCH_RE.search(value):
        raise TransferRejected(f"{label} contains a phone number")


def validate_lists_and_contacts(lists: list[ListRow], contacts: list[ContactRow]) -> None:
    if len(lists) != EXPECTED_LIST_COUNT or len(contacts) != EXPECTED_CONTACT_COUNT:
        raise TransferRejected("source inventory count does not match the historical inventory")
    by_list: dict[str, list[ContactRow]] = {row.id: [] for row in lists}
    seen_contacts: set[str] = set()
    seen_phones: set[str] = set()
    for contact in contacts:
        if contact.id in seen_contacts:
            raise TransferRejected("duplicate contact id")
        seen_contacts.add(contact.id)
        if contact.list_id not in by_list:
            raise TransferRejected("contact points at an unknown list")
        if contact.sort_order < 1:
            raise TransferRejected("contact sort order is not positive")
        if not PHONE_RE.fullmatch(contact.phone_number):
            raise TransferRejected("a contact failed the phone constraint")
        if contact.phone_number in seen_phones:
            raise TransferRejected("a phone appears on more than one contact")
        seen_phones.add(contact.phone_number)
        if contact.display_name is not None and "\x00" in contact.display_name:
            raise TransferRejected("a display name is unsafe")
        if not TIMESTAMP_RE.fullmatch(contact.created_at):
            raise TransferRejected("a contact timestamp is unsafe")
        by_list[contact.list_id].append(contact)
    sizes: dict[str, int] = {}
    for row in lists:
        if not row.name or "\x00" in row.name:
            raise TransferRejected("a list name is unsafe")
        assert_no_phone_text(row.name, "list name")
        if row.status not in {"PENDING", "ACTIVE", "INACTIVE", "IN_USE"}:
            raise TransferRejected("a list status is not a known status")
        if not REGION_RE.fullmatch(row.region_code):
            raise TransferRejected("a list region is not canonical")
        if row.catalog_membership != "ORIGINAL_TEHRAN":
            raise TransferRejected("a list is outside the original Tehran catalog")
        if not TIMESTAMP_RE.fullmatch(row.created_at) or not TIMESTAMP_RE.fullmatch(row.updated_at):
            raise TransferRejected("a list timestamp is unsafe")
        if row.reserved_at and not TIMESTAMP_RE.fullmatch(row.reserved_at):
            raise TransferRejected("a reservation timestamp is unsafe")
        if row.reserved_by_salon_id and not UUID_RE.fullmatch(row.reserved_by_salon_id):
            raise TransferRejected("a reservation salon id is unsafe")
        owned = by_list[row.id]
        if len(owned) != row.contact_count or not 1 <= row.contact_count <= 100:
            raise TransferRejected("a list contact count does not match its contacts")
        orders = [item.sort_order for item in owned]
        if len(set(orders)) != len(orders):
            raise TransferRejected("a list repeats a sort order")
        sizes[row.name] = row.contact_count
    for name, expected in SMALL_LISTS.items():
        if sizes.get(name) != expected:
            raise TransferRejected("the 27-contact or 28-contact list is missing or enlarged")
    if sum(1 for size in sizes.values() if size == 27) != 1:
        raise TransferRejected("the 27-contact list is not unique")
    if sum(1 for size in sizes.values() if size == 28) != 1:
        raise TransferRejected("the 28-contact list is not unique")


def manifest_payload(
    *,
    manifest_id: str,
    source: Identity,
    source_origin: str,
    destination: Identity,
    admin_id: str,
    lists: list[ListRow],
    contacts: list[ContactRow],
    safety: dict[str, int],
    recipient_snapshots: int,
) -> dict[str, object]:
    contacts_by_list: dict[str, list[str]] = {row.id: [] for row in lists}
    for contact in sorted(contacts, key=lambda item: (item.list_id, item.sort_order, item.id)):
        contacts_by_list[contact.list_id].append(contact.id)
    payload: dict[str, object] = {
        "manifestVersion": 1,
        "manifestId": manifest_id,
        "sourceDatabase": source.database,
        "sourceSystemIdentifier": source.system_identifier,
        "sourceOriginSystemIdentifier": source_origin,
        "sourceComment": source.comment,
        "destinationDatabase": destination.database,
        "destinationSystemIdentifier": destination.system_identifier,
        "destinationComment": destination.comment,
        "destinationAdminId": admin_id,
        "listCount": len(lists),
        "contactCount": len(contacts),
        "listIdMd5": EXPECTED_LIST_ID_MD5,
        "phoneMd5": EXPECTED_PHONE_MD5,
        "contactTupleMd5": EXPECTED_CONTACT_TUPLE_MD5,
        "reservationFieldsCleared": ["reserved_by_salon_id", "reserved_at"],
        "reservationExpiryField": None,
        "lists": [
            {
                "id": row.id,
                "name": row.name,
                "regionCode": row.region_code,
                "catalogMembership": row.catalog_membership,
                "contactCount": row.contact_count,
                "originalStatus": row.status,
                "originalCreatedByAdminId": row.created_by_admin_id,
                "originalReservedBySalonId": row.reserved_by_salon_id or None,
                "originalReservedAt": row.reserved_at or None,
                "contactIds": contacts_by_list[row.id],
            }
            for row in sorted(lists, key=lambda item: item.id)
        ],
        "safety": {
            "platformMessageStops": safety["platform_message_stops"],
            "platformMessageStopEvents": safety["platform_message_stop_events"],
            "messageGlobalStopOutcomes": safety["message_global_stop_outcomes"],
            "messageDeliveries": safety["message_deliveries"],
            "recipientSnapshotsNotCopied": recipient_snapshots,
            "deliveriesDoNotProveNoSend": True,
        },
        "notCopied": [
            "salons",
            "users",
            "vip_requests",
            "vip_request_recipients",
            "vip_salon_entitlements",
            "transactions",
            "message_requests",
            "message_deliveries",
            "outbox_events",
        ],
    }
    encoded = json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    assert_no_phone_text(encoded, "provenance manifest")
    return payload


def decide_transfer(
    *,
    destination_list_ids: set[str],
    destination_contact_ids: set[str],
    latest_action: str | None,
    manifest_list_ids: set[str],
    manifest_contact_ids: set[str],
    equivalent: bool,
) -> str:
    empty = not destination_list_ids and not destination_contact_ids
    if latest_action is None:
        if not empty:
            raise TransferRejected("destination already has VIP rows and no transfer manifest")
        return "insert"
    if latest_action == TRANSFER_ACTION:
        if equivalent and destination_list_ids == manifest_list_ids and destination_contact_ids == manifest_contact_ids:
            return "rerun"
        raise TransferRejected("existing VIP rows do not match this transfer")
    if latest_action == ROLLBACK_ACTION:
        if destination_list_ids & manifest_list_ids or destination_contact_ids & manifest_contact_ids:
            raise TransferRejected("rolled-back transfer ids are still present")
        if not empty:
            raise TransferRejected("destination has VIP rows that this transfer does not own")
        return "insert"
    raise TransferRejected("unrecognized transfer audit")


def owned_ids_present(destination_ids: set[str], manifest_ids: set[str], expected: int) -> bool:
    """True when every manifest id is still present. Extra rows do not count as ownership."""
    return len(manifest_ids) == expected and manifest_ids <= destination_ids


def rollback_decision(reference_counts: dict[str, int], owned_lists_present: bool, owned_contacts_present: bool) -> None:
    unexpected = {name: count for name, count in reference_counts.items() if count}
    if unexpected:
        names = ", ".join(sorted(unexpected))
        raise TransferRejected(f"VIP_TRANSFER_ROLLBACK_REFUSED {names}", code=4)
    if not owned_lists_present or not owned_contacts_present:
        raise TransferRejected("transfer-owned rows are not all present")


def psql(container: str, role: str, database: str, sql: str, read_only: bool) -> str:
    require_identifier(role, "role")
    require_database_name(database, "database")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", container):
        raise TransferRejected("refusing container name")
    if read_only:
        body = sql.strip()
        if not body.endswith(";"):
            body += ";"
        sql = "BEGIN READ ONLY;\nSET LOCAL TIME ZONE 'UTC';\n" + body + "\nCOMMIT;\n"
    result = subprocess.run(
        [
            "docker",
            "exec",
            "-i",
            container,
            "psql",
            "-U",
            role,
            "-d",
            database,
            "-X",
            "-q",
            "-A",
            "-t",
            "-v",
            "ON_ERROR_STOP=1",
        ],
        input=sql,
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        safe = redact(result.stderr + "\n" + result.stdout).strip()
        message = "database command failed"
        if "destination identity mismatch" in safe:
            message = "destination identity mismatch"
        elif "source identity mismatch" in safe:
            message = "source identity mismatch"
        elif "forced transfer failure" in safe:
            message = "forced transfer failure"
        elif "VIP_TRANSFER_ROLLBACK_REFUSED" in safe:
            message = "VIP_TRANSFER_ROLLBACK_REFUSED"
        else:
            reported = [
                line[:300]
                for line in safe.splitlines()
                if line.startswith("ERROR:") or line.startswith("SQLSTATE")
            ]
            if reported:
                message = reported[-1]
            elif safe:
                message = safe.splitlines()[-1][:300]
        raise TransferRejected(message)
    return result.stdout


def at_query(container: str, role: str, database: str, sql: str, read_only: bool = True) -> list[list[str]]:
    output = psql(container, role, database, sql, read_only=read_only)
    rows: list[list[str]] = []
    for line in output.splitlines():
        if line.strip():
            rows.append(line.split("|"))
    return rows


def copy_query(container: str, role: str, database: str, select_sql: str) -> list[list[str]]:
    sql = "COPY (\n" + select_sql + "\n) TO STDOUT WITH (FORMAT csv)"
    output = psql(container, role, database, sql, read_only=True)
    return list(csv.reader(io.StringIO(output)))


def read_identity(container: str, database: str) -> Identity:
    rows = at_query(
        container,
        "salon",
        database,
        """
        SELECT current_database(),
               (SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
               coalesce(pg_catalog.shobj_description(
                 (SELECT d.oid FROM pg_catalog.pg_database AS d WHERE d.datname = current_database()),
                 'pg_database'
               ), '')
        """,
    )
    if len(rows) != 1 or len(rows[0]) != 3:
        raise TransferRejected("identity could not be read")
    comment = rows[0][2] if rows[0][2] else None
    return Identity(rows[0][0], rows[0][1], comment)


def assert_connection_identity(live: Identity, expected: Identity, label: str) -> None:
    if (
        live.database != expected.database
        or live.system_identifier != expected.system_identifier
        or live.comment != expected.comment
    ):
        raise TransferRejected(f"{label} identity mismatch", code=2)


def migration_head(container: str, database: str) -> tuple[str, int, int]:
    rows = at_query(
        container,
        "salon",
        database,
        """
        SELECT coalesce((
                 SELECT migration_name FROM _prisma_migrations
                 WHERE finished_at IS NOT NULL
                 ORDER BY finished_at DESC, migration_name DESC
                 LIMIT 1
               ), ''),
               (count(*) FILTER (WHERE finished_at IS NOT NULL))::text,
               (count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL))::text
        FROM _prisma_migrations
        """,
    )
    if len(rows) != 1:
        raise TransferRejected("migration ledger could not be read")
    return rows[0][0], int(rows[0][1]), int(rows[0][2])


def column_names(container: str, database: str, table: str) -> tuple[str, ...]:
    require_identifier(table, "table")
    rows = at_query(
        container,
        "salon",
        database,
        f"""
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = '{table}'
        ORDER BY ordinal_position
        """,
    )
    return tuple(row[0] for row in rows)


def safety_counts(container: str, database: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for table in SAFETY_TABLES:
        rows = at_query(container, "salon", database, f"SELECT count(*)::text FROM {table}")
        counts[table] = int(rows[0][0])
    return counts


def scalar(container: str, role: str, database: str, sql: str) -> str:
    rows = at_query(container, role, database, sql)
    if len(rows) != 1 or len(rows[0]) != 1:
        raise TransferRejected("expected one scalar result")
    return rows[0][0]


def load_lists(container: str, database: str) -> list[ListRow]:
    raw = copy_query(
        container,
        "salon",
        database,
        """
        SELECT id::text, name, status::text, contact_count::text,
               coalesce(region_code, ''), coalesce(catalog_membership::text, ''),
               created_by_admin_id::text, coalesce(reserved_by_salon_id::text, ''),
               coalesce(to_char(reserved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), ''),
               to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
               to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        FROM vip_target_lists
        ORDER BY id::text
        """,
    )
    return [
        ListRow(
            require_uuid(row[0], "list id"),
            row[1],
            row[2],
            int(row[3]),
            row[4],
            row[5],
            require_uuid(row[6], "creator"),
            row[7].lower(),
            row[8],
            row[9],
            row[10],
        )
        for row in raw
    ]


def load_contacts(container: str, database: str) -> list[ContactRow]:
    raw = copy_query(
        container,
        "salon",
        database,
        """
        SELECT id::text, list_id::text, sort_order::text,
               coalesce(display_name, ''),
               phone_number,
               to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        FROM vip_target_contacts
        ORDER BY list_id::text, sort_order, id::text
        """,
    )
    contacts: list[ContactRow] = []
    for row in raw:
        display = row[3] if row[3] else None
        contacts.append(
            ContactRow(
                require_uuid(row[0], "contact id"),
                require_uuid(row[1], "contact list"),
                int(row[2]),
                display,
                row[4],
                row[5],
            )
        )
    return contacts


def fingerprint(container: str, role: str, database: str, kind: str) -> str:
    if kind == "list-id":
        sql = "SELECT md5(coalesce(string_agg(id::text, E'\\n' ORDER BY id::text), '')) FROM vip_target_lists"
    elif kind == "phone":
        sql = "SELECT md5(coalesce(string_agg(phone_number, E'\\n' ORDER BY phone_number), '')) FROM vip_target_contacts"
    elif kind == "tuple":
        sql = """
        SELECT md5(coalesce(string_agg(
          list_id::text || '|' || id::text || '|' || sort_order::text || '|' ||
          phone_number || '|' || coalesce(display_name, ''),
          E'\\n' ORDER BY list_id::text, sort_order, id::text
        ), ''))
        FROM vip_target_contacts
        """
    else:
        raise TransferRejected("unknown fingerprint")
    return scalar(container, role, database, sql)


def preserved_fingerprint_sql() -> str:
    parts = [
        f"(SELECT '{table}:' || count(*)::text FROM {table})"
        for table in PRESERVED_TABLES
    ]
    parts.append(
        "(SELECT 'audits:' || count(*)::text FROM audit_logs "
        "WHERE action NOT IN ('VIP_INVENTORY_TRANSFER', 'VIP_INVENTORY_TRANSFER_ROLLBACK'))"
    )
    parts.append(
        "(SELECT 'auditfp:' || md5(coalesce(string_agg(id::text || ':' || action || ':' || result, ',' "
        "ORDER BY id::text), '')) FROM audit_logs "
        "WHERE action NOT IN ('VIP_INVENTORY_TRANSFER', 'VIP_INVENTORY_TRANSFER_ROLLBACK'))"
    )
    return "SELECT " + " || ',' || ".join(parts)


def preserved_fingerprint(container: str, role: str, database: str) -> str:
    return scalar(container, role, database, preserved_fingerprint_sql())


def business_md5_sql() -> str:
    """Hash account, agreement, receipt, and pre-transfer audit identity. No phones or ciphertext."""
    return """
    SELECT md5(concat_ws(E'\\n',
      (SELECT coalesce(string_agg(id::text || ':' || access_state::text || ':' || status::text, E'\\n' ORDER BY id::text), '') FROM salons),
      (SELECT coalesce(string_agg(id::text || ':' || role::text || ':' || salon_id::text || ':' || status::text, E'\\n' ORDER BY id::text), '') FROM users),
      (SELECT coalesce(string_agg(id::text || ':' || status::text, E'\\n' ORDER BY id::text), '') FROM platform_admins),
      (SELECT coalesce(string_agg(id::text || ':' || version_key || ':' || template_digest, E'\\n' ORDER BY id::text), '') FROM agreement_versions),
      (SELECT coalesce(string_agg(id::text || ':' || salon_id::text || ':' || version_id::text || ':' || rendered_digest || ':' || evidence_key_id, E'\\n' ORDER BY id::text), '') FROM agreement_presentations),
      (SELECT coalesce(string_agg(id::text || ':' || salon_id::text || ':' || version_id::text || ':' || presentation_id::text || ':' || template_digest || ':' || rendered_digest || ':' || snapshot_digest || ':' || evidence_key_id, E'\\n' ORDER BY id::text), '') FROM agreement_acceptances),
      (SELECT coalesce(string_agg(id::text || ':' || salon_id::text || ':' || phase::text || ':' || object_key || ':' || sha256 || ':' || byte_size::text, E'\\n' ORDER BY id::text), '') FROM activation_receipts),
      (SELECT coalesce(string_agg(id::text || ':' || action || ':' || result, E'\\n' ORDER BY id::text), '') FROM audit_logs WHERE action NOT IN ('VIP_INVENTORY_TRANSFER', 'VIP_INVENTORY_TRANSFER_ROLLBACK'))
    ))
    """


def ids_md5(ids: set[str] | list[str]) -> str:
    return hashlib.md5("\n".join(sorted(ids)).encode("utf-8")).hexdigest()


def assert_read_only_sql(sql: str) -> None:
    upper = sql.upper()
    for token in ("INSERT ", "UPDATE ", "DELETE ", "TRUNCATE ", "ALTER ", "DROP ", "CREATE ", "GRANT ", "REVOKE ", "COPY "):
        if token in upper:
            raise TransferRejected("reconcile statement would change data")


def psql_read_only(container: str, role: str, database: str, body: str) -> str:
    assert_read_only_sql(body)
    wrapped = (
        "BEGIN READ ONLY;\n"
        "SET LOCAL TIME ZONE 'UTC';\n"
        "SET LOCAL default_transaction_read_only = on;\n"
        + body.strip()
        + "\nCOMMIT;\n"
    )
    return psql(container, role, database, wrapped, read_only=False)


def reconcile_snapshot_sql(admin_id: str) -> str:
    regions = ",".join(f"'{index:02d}'" for index in range(1, 15))
    shape = """
    md5(coalesce(string_agg(
      id::text || '|' || name || '|' || status::text || '|' || contact_count::text || '|' ||
      coalesce(region_code, '') || '|' || coalesce(catalog_membership::text, '') || '|' ||
      created_by_admin_id::text || '|' || coalesce(reserved_by_salon_id::text, '') || '|' ||
      coalesce(to_char(reserved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '') || '|' ||
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || '|' ||
      to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      E'\\n' ORDER BY id::text), ''))
    FROM vip_target_lists
    """
    fields = [
        "(SELECT count(*)::text FROM vip_target_lists)",
        "(SELECT count(*)::text FROM vip_target_contacts)",
        "(SELECT md5(coalesce(string_agg(id::text, E'\\n' ORDER BY id::text), '')) FROM vip_target_lists)",
        "(SELECT md5(coalesce(string_agg(id::text, E'\\n' ORDER BY id::text), '')) FROM vip_target_contacts)",
        "(SELECT md5(coalesce(string_agg(phone_number, E'\\n' ORDER BY phone_number), '')) FROM vip_target_contacts)",
        """(SELECT md5(coalesce(string_agg(
            list_id::text || '|' || id::text || '|' || sort_order::text || '|' ||
            phone_number || '|' || coalesce(display_name, ''),
            E'\\n' ORDER BY list_id::text, sort_order, id::text), '')) FROM vip_target_contacts)""",
        f"(SELECT {shape})",
        f"""(SELECT count(*)::text FROM vip_target_lists
            WHERE status = 'PENDING' AND reserved_by_salon_id IS NULL AND reserved_at IS NULL
              AND created_by_admin_id = {sql_literal(admin_id)}::uuid)""",
        f"""(SELECT count(*)::text FROM vip_target_lists
            WHERE status = 'ACTIVE' AND reserved_by_salon_id IS NULL
              AND catalog_membership = 'ORIGINAL_TEHRAN'
              AND region_code IN ({regions}))""",
        """(SELECT count(*)::text FROM vip_target_lists l
            WHERE l.contact_count <> (SELECT count(*) FROM vip_target_contacts c WHERE c.list_id = l.id))""",
        """(SELECT count(*)::text FROM vip_target_contacts c
            WHERE NOT EXISTS (SELECT 1 FROM vip_target_lists l WHERE l.id = c.list_id))""",
        f"""(SELECT count(*)::text FROM vip_target_lists
            WHERE region_code IS NULL OR region_code NOT IN ({regions})
               OR catalog_membership IS DISTINCT FROM 'ORIGINAL_TEHRAN')""",
        """(SELECT coalesce(string_agg(name || '=' || contact_count::text, ',' ORDER BY name), '')
            FROM vip_target_lists WHERE name IN ('VIP-11-01', 'VIP-14-01'))""",
        f"(SELECT count(*)::text FROM audit_logs WHERE action = '{TRANSFER_ACTION}' AND result = 'SUCCESS')",
        f"""(SELECT count(*)::text FROM audit_logs rb
            WHERE rb.action = '{ROLLBACK_ACTION}'
              AND EXISTS (
                SELECT 1 FROM audit_logs ok
                WHERE ok.action = '{TRANSFER_ACTION}' AND ok.result = 'SUCCESS'
                  AND (rb.created_at, rb.id) > (ok.created_at, ok.id)
              ))""",
        f"""(SELECT coalesce((SELECT action FROM audit_logs
            WHERE action IN ('{TRANSFER_ACTION}', '{ROLLBACK_ACTION}')
            ORDER BY created_at DESC, id DESC LIMIT 1), ''))""",
        f"({preserved_fingerprint_sql()})",
        f"({business_md5_sql()})",
    ]
    joined = " || chr(31) || ".join(fields)
    manifest = f"""
    SELECT coalesce((
      SELECT metadata::text FROM audit_logs
      WHERE action = '{TRANSFER_ACTION}' AND result = 'SUCCESS'
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    ), '')
    """
    return f"SELECT {joined};\n{manifest};"


def reconcile_problems(
    *,
    fields: list[str],
    manifest: dict[str, object] | None,
    expected_shape_md5: str,
    admin_id: str,
    baseline_preserved: str,
    baseline_business_md5: str,
    expected_list_id_md5: str = EXPECTED_LIST_ID_MD5,
    expected_phone_md5: str = EXPECTED_PHONE_MD5,
    expected_tuple_md5: str = EXPECTED_CONTACT_TUPLE_MD5,
) -> list[str]:
    problems: list[str] = []
    if len(fields) != 18:
        return ["snapshot"]
    (
        list_count,
        contact_count,
        list_id_md5,
        contact_id_md5,
        phone_md5,
        tuple_md5,
        shape_md5,
        pending_count,
        requestable_count,
        per_list_mismatches,
        orphan_contacts,
        bad_region_or_catalog,
        small_lists,
        success_count,
        rollback_after_success,
        latest_action,
        preserved,
        business_md5,
    ) = fields
    if list_count != str(EXPECTED_LIST_COUNT) or contact_count != str(EXPECTED_CONTACT_COUNT):
        problems.append("counts")
    if list_id_md5 != expected_list_id_md5:
        problems.append("list-ids")
    if phone_md5 != expected_phone_md5 or tuple_md5 != expected_tuple_md5:
        problems.append("contact-equivalence")
    if shape_md5 != expected_shape_md5:
        problems.append("list-shape")
    if pending_count != str(EXPECTED_LIST_COUNT):
        problems.append("pending-unreserved")
    if requestable_count != "0":
        problems.append("requestable")
    if per_list_mismatches != "0":
        problems.append("per-list-counts")
    if orphan_contacts != "0":
        problems.append("contact-relationships")
    if bad_region_or_catalog != "0":
        problems.append("region-or-catalog")
    if small_lists != "VIP-11-01=28,VIP-14-01=27":
        problems.append("small-lists")
    if success_count != "1" or latest_action != TRANSFER_ACTION:
        problems.append("transfer-audit")
    if rollback_after_success != "0":
        problems.append("subsequent-rollback")
    if manifest is None:
        problems.append("manifest")
    else:
        list_rows = manifest.get("lists")
        if not isinstance(list_rows, list):
            problems.append("manifest")
        else:
            manifest_list_ids = [str(row["id"]) for row in list_rows]
            manifest_contact_ids = [str(item) for row in list_rows for item in row["contactIds"]]
            if ids_md5(manifest_list_ids) != list_id_md5 or len(manifest_list_ids) != EXPECTED_LIST_COUNT:
                problems.append("manifest-list-ids")
            if ids_md5(manifest_contact_ids) != contact_id_md5 or len(manifest_contact_ids) != EXPECTED_CONTACT_COUNT:
                problems.append("manifest-contact-ids")
            if manifest.get("destinationAdminId") != admin_id:
                problems.append("creator-mapping")
            if (
                manifest.get("listIdMd5") != expected_list_id_md5
                or manifest.get("phoneMd5") != expected_phone_md5
                or manifest.get("contactTupleMd5") != expected_tuple_md5
            ):
                problems.append("manifest-fingerprints")
            for row in list_rows:
                if len(row["contactIds"]) != row["contactCount"]:
                    problems.append("manifest-contact-counts")
                    break
    if preserved != baseline_preserved:
        problems.append("preserved-baseline")
    if business_md5 != baseline_business_md5:
        problems.append("business-baseline")
    return problems


def baseline_payload(destination: Identity, preserved: str, business_md5: str) -> dict[str, object]:
    payload: dict[str, object] = {
        "version": 1,
        "database": destination.database,
        "systemIdentifier": destination.system_identifier,
        "comment": destination.comment,
        "preserved": preserved,
        "businessMd5": business_md5,
    }
    encoded = json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    assert_no_phone_text(encoded, "baseline")
    return payload


def write_baseline_file(path: str, payload: dict[str, object]) -> None:
    if os.path.lexists(path):
        raise TransferRejected("baseline file already exists")
    encoded = json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":")) + "\n"
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        os.write(descriptor, encoded.encode("utf-8"))
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    os.chmod(path, 0o600)
    if (os.stat(path).st_mode & 0o777) != 0o600:
        raise TransferRejected("baseline file is not protected")


def read_baseline_file(path: str, destination: Identity) -> dict[str, object]:
    if os.path.islink(path) or not os.path.isfile(path):
        raise TransferRejected("baseline file must be a regular file")
    info = os.stat(path)
    if info.st_uid != os.getuid() or (info.st_mode & 0o777) != 0o600:
        raise TransferRejected("baseline file is not protected")
    with open(path, encoding="utf-8") as handle:
        raw = handle.read()
    assert_no_phone_text(raw, "baseline")
    payload = json.loads(raw)
    if (
        payload.get("version") != 1
        or payload.get("database") != destination.database
        or payload.get("systemIdentifier") != destination.system_identifier
        or payload.get("comment") != destination.comment
        or not isinstance(payload.get("preserved"), str)
        or not isinstance(payload.get("businessMd5"), str)
    ):
        raise TransferRejected("baseline identity mismatch")
    return payload


def capture_baseline(container: str, database: str) -> tuple[str, str]:
    output = psql_read_only(
        container,
        "salon_app",
        database,
        f"SELECT ({preserved_fingerprint_sql()}) || chr(31) || ({business_md5_sql()});",
    ).strip()
    preserved, business_md5 = output.split(chr(31))
    assert_no_phone_text(preserved + business_md5, "baseline")
    return preserved, business_md5


def latest_manifest(container: str, database: str) -> tuple[str | None, dict[str, object] | None]:
    output = psql(
        container,
        "salon_app",
        database,
        f"""
        SELECT action || chr(31) || metadata::text
        FROM audit_logs
        WHERE action IN ('{TRANSFER_ACTION}', '{ROLLBACK_ACTION}')
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        """,
        read_only=True,
    ).strip()
    if not output:
        return None, None
    action, raw = output.split(chr(31), 1)
    assert_no_phone_text(raw, "stored manifest")
    payload = json.loads(raw)
    return action, payload


def owned_ids(payload: dict[str, object] | None) -> tuple[set[str], set[str]]:
    if payload is None:
        return set(), set()
    list_rows = payload.get("lists")
    if isinstance(list_rows, list):
        list_ids = {str(row["id"]) for row in list_rows}
        contact_ids = {str(item) for row in list_rows for item in row["contactIds"]}
        return list_ids, contact_ids
    return set(str(item) for item in payload.get("listIds", [])), set(
        str(item) for item in payload.get("contactIds", [])
    )


def identity_sql(destination: Identity, admin_id: str) -> str:
    comment_sql = "NULL" if destination.comment is None else sql_literal(destination.comment)
    return f"""
DO $$
DECLARE
  got_name text;
  got_id text;
  got_comment text;
BEGIN
  IF current_user IS DISTINCT FROM 'salon_app' THEN
    RAISE EXCEPTION 'transfer role rejected';
  END IF;
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'transfer role rejected';
  END IF;
  SELECT database_name, system_identifier, database_comment
    INTO got_name, got_id, got_comment
  FROM canonical_database_identity();
  IF got_name IS DISTINCT FROM {sql_literal(destination.database)}
     OR got_id IS DISTINCT FROM {sql_literal(destination.system_identifier)}
     OR got_comment IS DISTINCT FROM {comment_sql} THEN
    RAISE EXCEPTION 'destination identity mismatch';
  END IF;
  IF (SELECT count(*) FROM platform_admins WHERE id = {sql_literal(admin_id)}::uuid AND status = 'ACTIVE') <> 1 THEN
    RAISE EXCEPTION 'destination admin rejected';
  END IF;
END $$;
"""


def list_shape_md5(lists: list[ListRow], admin_id: str) -> str:
    lines = [
        "|".join(
            [
                row.id,
                row.name,
                "PENDING",
                str(row.contact_count),
                row.region_code,
                row.catalog_membership,
                admin_id,
                "",
                "",
                row.created_at,
                row.updated_at,
            ]
        )
        for row in sorted(lists, key=lambda item: item.id)
    ]
    return hashlib.md5("\n".join(lines).encode("utf-8")).hexdigest()


def verification_sql(admin_id: str, shape_md5: str) -> str:
    small = "\n".join(
        f"""
  IF (SELECT count(*) FROM vip_target_lists WHERE name = {sql_literal(name)}) <> 1
     OR (SELECT contact_count FROM vip_target_lists WHERE name = {sql_literal(name)}) <> {count}
     OR (SELECT count(*) FROM vip_target_contacts c
         JOIN vip_target_lists l ON l.id = c.list_id
         WHERE l.name = {sql_literal(name)}) <> {count} THEN
    RAISE EXCEPTION 'small list changed';
  END IF;"""
        for name, count in SMALL_LISTS.items()
    )
    return f"""
DO $$
DECLARE
  got text;
BEGIN
  IF (SELECT count(*) FROM vip_target_lists) <> {EXPECTED_LIST_COUNT}
     OR (SELECT count(*) FROM vip_target_contacts) <> {EXPECTED_CONTACT_COUNT} THEN
    RAISE EXCEPTION 'transferred counts mismatch';
  END IF;
  IF (SELECT count(*) FROM vip_target_lists
      WHERE status <> 'PENDING' OR reserved_by_salon_id IS NOT NULL OR reserved_at IS NOT NULL
         OR created_by_admin_id <> {sql_literal(admin_id)}::uuid) <> 0 THEN
    RAISE EXCEPTION 'transformed list invariants failed';
  END IF;
  IF (SELECT count(*) FROM vip_target_lists
      WHERE status = 'ACTIVE' AND reserved_by_salon_id IS NULL
        AND catalog_membership = 'ORIGINAL_TEHRAN'
        AND region_code IN ('01','02','03','04','05','06','07','08','09','10','11','12','13','14')) <> 0 THEN
    RAISE EXCEPTION 'a transferred list is requestable';
  END IF;
  IF (SELECT count(*) FROM vip_target_lists l
      WHERE l.contact_count <> (SELECT count(*) FROM vip_target_contacts c WHERE c.list_id = l.id)) <> 0 THEN
    RAISE EXCEPTION 'contact count does not match contacts';
  END IF;
  SELECT md5(coalesce(string_agg(id::text, E'\\n' ORDER BY id::text), '')) INTO got FROM vip_target_lists;
  IF got IS DISTINCT FROM {sql_literal(EXPECTED_LIST_ID_MD5)} THEN
    RAISE EXCEPTION 'list fingerprint mismatch';
  END IF;
  SELECT md5(coalesce(string_agg(phone_number, E'\\n' ORDER BY phone_number), '')) INTO got FROM vip_target_contacts;
  IF got IS DISTINCT FROM {sql_literal(EXPECTED_PHONE_MD5)} THEN
    RAISE EXCEPTION 'phone fingerprint mismatch';
  END IF;
  SELECT md5(coalesce(string_agg(
    list_id::text || '|' || id::text || '|' || sort_order::text || '|' ||
    phone_number || '|' || coalesce(display_name, ''),
    E'\\n' ORDER BY list_id::text, sort_order, id::text), '')) INTO got FROM vip_target_contacts;
  IF got IS DISTINCT FROM {sql_literal(EXPECTED_CONTACT_TUPLE_MD5)} THEN
    RAISE EXCEPTION 'contact tuple fingerprint mismatch';
  END IF;
  SELECT md5(coalesce(string_agg(
    id::text || '|' || name || '|' || status::text || '|' || contact_count::text || '|' ||
    coalesce(region_code, '') || '|' || coalesce(catalog_membership::text, '') || '|' ||
    created_by_admin_id::text || '|' || coalesce(reserved_by_salon_id::text, '') || '|' ||
    coalesce(to_char(reserved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '') || '|' ||
    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || '|' ||
    to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    E'\\n' ORDER BY id::text), '')) INTO got FROM vip_target_lists;
  IF got IS DISTINCT FROM {sql_literal(shape_md5)} THEN
    RAISE EXCEPTION 'list shape mismatch';
  END IF;
  {small}
END $$;
"""


def baseline_sql() -> str:
    columns = ",\n  ".join(
        f"(SELECT count(*) FROM {table}) AS {table}" for table in PRESERVED_TABLES
    )
    columns += ",\n  (SELECT count(*) FROM audit_logs) AS audit_logs"
    return f"CREATE TEMP TABLE stage3_transfer_baseline ON COMMIT DROP AS\nSELECT\n  {columns};\n"


def baseline_check_sql(audit_delta: int) -> str:
    checks = "\n".join(
        f"""
  IF (SELECT {table} FROM stage3_transfer_baseline) <> (SELECT count(*) FROM {table}) THEN
    RAISE EXCEPTION 'preserved table changed';
  END IF;"""
        for table in PRESERVED_TABLES
    )
    return f"""
DO $$
BEGIN
  {checks}
  IF (SELECT count(*) FROM audit_logs) <> (SELECT audit_logs FROM stage3_transfer_baseline) + {audit_delta} THEN
    RAISE EXCEPTION 'audit set changed unexpectedly';
  END IF;
END $$;
"""


def list_values(row: ListRow, admin_id: str) -> str:
    catalog = (
        "'ORIGINAL_TEHRAN'::\"VipCatalogMembership\""
        if row.catalog_membership == "ORIGINAL_TEHRAN"
        else "NULL"
    )
    return "(" + ", ".join(
        [
            f"{sql_literal(row.id)}::uuid",
            sql_literal(row.name),
            "'PENDING'::\"VipTargetListStatus\"",
            str(row.contact_count),
            sql_literal(row.region_code),
            catalog,
            f"{sql_literal(admin_id)}::uuid",
            "NULL",
            "NULL",
            f"{sql_literal(row.created_at)}::timestamptz",
            f"{sql_literal(row.updated_at)}::timestamptz",
        ]
    ) + ")"


def contact_values(row: ContactRow) -> str:
    display = "NULL" if row.display_name is None else sql_literal(row.display_name)
    return "(" + ", ".join(
        [
            f"{sql_literal(row.id)}::uuid",
            f"{sql_literal(row.list_id)}::uuid",
            str(row.sort_order),
            display,
            sql_literal(row.phone_number),
            f"{sql_literal(row.created_at)}::timestamptz",
        ]
    ) + ")"


def build_insert_sql(
    *,
    destination: Identity,
    admin_id: str,
    lists: list[ListRow],
    contacts: list[ContactRow],
    manifest: dict[str, object],
    fail_after_contacts: int | None,
    shape_md5: str,
) -> str:
    encoded = json.dumps(manifest, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    assert_no_phone_text(encoded, "provenance manifest")
    manifest_id = str(manifest["manifestId"])
    statements = [
        "BEGIN;",
        "SET LOCAL TIME ZONE 'UTC';",
        ADVISORY_LOCK + ";",
        identity_sql(destination, admin_id),
        """
DO $$
BEGIN
  IF (SELECT count(*) FROM vip_target_lists) <> 0
     OR (SELECT count(*) FROM vip_target_contacts) <> 0 THEN
    RAISE EXCEPTION 'destination vip inventory is not empty';
  END IF;
END $$;
""",
        baseline_sql(),
        "INSERT INTO vip_target_lists "
        "(id, name, status, contact_count, region_code, catalog_membership, "
        "created_by_admin_id, reserved_by_salon_id, reserved_at, created_at, updated_at) VALUES\n"
        + ",\n".join(list_values(row, admin_id) for row in lists)
        + ";",
    ]
    ordered = sorted(contacts, key=lambda item: (item.list_id, item.sort_order, item.id))
    limit = len(ordered) if fail_after_contacts is None else fail_after_contacts
    if fail_after_contacts is not None and not 0 < fail_after_contacts < len(ordered):
        raise TransferRejected("fail-after must stop inside the contact set")
    inserted = 0
    while inserted < limit:
        batch = ordered[inserted:min(limit, inserted + CONTACT_BATCH)]
        statements.append(
            "INSERT INTO vip_target_contacts "
            "(id, list_id, sort_order, display_name, phone_number, created_at) VALUES\n"
            + ",\n".join(contact_values(row) for row in batch)
            + ";"
        )
        inserted += len(batch)
    if fail_after_contacts is not None:
        statements.append("DO $$ BEGIN RAISE EXCEPTION 'forced transfer failure'; END $$;")
    else:
        statements.append(baseline_check_sql(0))
        statements.append(verification_sql(admin_id, shape_md5))
        statements.append(
            "INSERT INTO audit_logs "
            "(id, tenant_id, actor_id, action, resource, resource_id, result, metadata, created_at) "
            f"VALUES (gen_random_uuid(), NULL, {sql_literal(admin_id)}::uuid, "
            f"{sql_literal(TRANSFER_ACTION)}, 'vip_inventory', {sql_literal(manifest_id)}, 'SUCCESS', "
            f"{dollar_quote(encoded)}::jsonb, clock_timestamp());"
        )
        statements.append(baseline_check_sql(1))
    statements.append("COMMIT;")
    sql = "\n".join(statements)
    if "ON CONFLICT" in sql or "DISABLE TRIGGER" in sql.upper() or "LOCK TABLE" in sql.upper():
        raise TransferRejected("refusing an unsafe transfer statement")
    return sql


def build_rerun_sql(destination: Identity, admin_id: str, success_audits: int, shape_md5: str) -> str:
    sql = "\n".join(
        [
            "BEGIN;",
            "SET LOCAL TIME ZONE 'UTC';",
            ADVISORY_LOCK + ";",
            identity_sql(destination, admin_id),
            verification_sql(admin_id, shape_md5),
            f"""
DO $$
BEGIN
  IF (SELECT count(*) FROM audit_logs WHERE action = '{TRANSFER_ACTION}' AND result = 'SUCCESS')
     <> {success_audits} THEN
    RAISE EXCEPTION 'transfer audit count changed';
  END IF;
END $$;
""",
            "COMMIT;",
        ]
    )
    upper = sql.upper()
    for forbidden in ("INSERT ", "UPDATE ", "DELETE ", "TRUNCATE ", "ON CONFLICT", "DISABLE TRIGGER", "LOCK TABLE"):
        if forbidden in upper:
            raise TransferRejected("rerun statement would change data")
    return sql


def build_rollback_sql(destination: Identity, admin_id: str, manifest: dict[str, object]) -> str:
    list_ids = [str(row["id"]) for row in manifest["lists"]]  # type: ignore[index]
    contact_ids: list[str] = []
    for row in manifest["lists"]:  # type: ignore[index]
        contact_ids.extend(str(item) for item in row["contactIds"])
    if len(list_ids) != EXPECTED_LIST_COUNT or len(contact_ids) != EXPECTED_CONTACT_COUNT:
        raise TransferRejected("manifest does not own the historical inventory")
    list_array = ", ".join(f"{sql_literal(require_uuid(item, 'manifest list'))}::uuid" for item in list_ids)
    contact_array = ", ".join(
        f"{sql_literal(require_uuid(item, 'manifest contact'))}::uuid" for item in contact_ids
    )
    encoded = json.dumps(
        {
            "manifestVersion": 1,
            "rolledBackManifestId": manifest["manifestId"],
            "listIds": list_ids,
            "contactIds": contact_ids,
            "listCount": len(list_ids),
            "contactCount": len(contact_ids),
        },
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    )
    assert_no_phone_text(encoded, "rollback manifest")
    return f"""
BEGIN;
{ADVISORY_LOCK};
{identity_sql(destination, admin_id)}
DO $$
DECLARE
  list_ids uuid[] := ARRAY[{list_array}];
  contact_ids uuid[] := ARRAY[{contact_array}];
  removed_contacts bigint;
  removed_lists bigint;
BEGIN
  IF (SELECT count(*) FROM vip_requests WHERE list_id = ANY(list_ids)) <> 0
     OR (SELECT count(*) FROM vip_request_recipients WHERE source_contact_id = ANY(contact_ids)) <> 0 THEN
    RAISE EXCEPTION 'VIP_TRANSFER_ROLLBACK_REFUSED';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE contype = 'f'
      AND confrelid IN ('public.vip_target_lists'::regclass, 'public.vip_target_contacts'::regclass)
      AND conrelid NOT IN (
        'public.vip_target_contacts'::regclass,
        'public.vip_requests'::regclass,
        'public.vip_request_recipients'::regclass
      )
  ) THEN
    RAISE EXCEPTION 'unexpected business reference';
  END IF;
  IF (SELECT count(*) FROM vip_target_lists WHERE id = ANY(list_ids)) <> {EXPECTED_LIST_COUNT}
     OR (SELECT count(*) FROM vip_target_contacts WHERE id = ANY(contact_ids)) <> {EXPECTED_CONTACT_COUNT} THEN
    RAISE EXCEPTION 'transfer-owned rows are not all present';
  END IF;
  DELETE FROM vip_target_contacts WHERE id = ANY(contact_ids) AND list_id = ANY(list_ids);
  GET DIAGNOSTICS removed_contacts = ROW_COUNT;
  DELETE FROM vip_target_lists WHERE id = ANY(list_ids);
  GET DIAGNOSTICS removed_lists = ROW_COUNT;
  IF removed_contacts <> {EXPECTED_CONTACT_COUNT} OR removed_lists <> {EXPECTED_LIST_COUNT} THEN
    RAISE EXCEPTION 'rollback removed an unexpected number of rows';
  END IF;
  IF EXISTS (SELECT 1 FROM vip_target_lists WHERE id = ANY(list_ids))
     OR EXISTS (SELECT 1 FROM vip_target_contacts WHERE id = ANY(contact_ids)) THEN
    RAISE EXCEPTION 'transfer-owned rows remain';
  END IF;
END $$;
INSERT INTO audit_logs
  (id, tenant_id, actor_id, action, resource, resource_id, result, metadata, created_at)
VALUES (
  gen_random_uuid(), NULL, {sql_literal(admin_id)}::uuid,
  '{ROLLBACK_ACTION}', 'vip_inventory', {sql_literal(str(manifest["manifestId"]))}, 'SUCCESS',
  {dollar_quote(encoded)}::jsonb, clock_timestamp()
);
COMMIT;
"""


def refuse_canonical_replay(mode: str, system_identifier: str) -> None:
    """The completed transfer stays in history. Do not run it again on this cluster."""
    if mode in {"execute", "rollback"} and system_identifier == CANONICAL_SYSTEM_IDENTIFIER:
        raise TransferRejected("refusing to import or roll back VIP inventory on the canonical cluster")


def refuse_protected_targets(source_container: str, destination_container: str, destination: Identity, allow_canonical: bool) -> None:
    if source_container == destination_container:
        raise TransferRejected("source and destination containers must differ")
    if source_container == HISTORICAL_CONTAINER or destination_container == HISTORICAL_CONTAINER:
        raise TransferRejected("refusing the original historical container")
    if destination.system_identifier == ORIGIN_SYSTEM_IDENTIFIER:
        raise TransferRejected("refusing the original historical system identifier")
    canonical_target = (
        destination.system_identifier == CANONICAL_SYSTEM_IDENTIFIER
        or destination_container == CANONICAL_CONTAINER
        or (
            destination.database in {CANONICAL_DATABASE, RENAMED_CANONICAL_DATABASE}
            and destination.comment == CANONICAL_COMMENT
            and destination.system_identifier == CANONICAL_SYSTEM_IDENTIFIER
        )
    )
    if canonical_target and not allow_canonical:
        raise TransferRejected("refusing the canonical database without an explicit live authorization")
    if destination.database in {"salon", "salon_preview", "salon_opp_integrity_20261024", "salon-db"} and (
        destination.system_identifier == CANONICAL_SYSTEM_IDENTIFIER
        or destination_container == CANONICAL_CONTAINER
    ):
        raise TransferRejected("refusing the renamed canonical database name on the canonical cluster")
    if destination.database in {"salon", "salon_preview", "salon_opp_integrity_20261024"}:
        raise TransferRejected("refusing a protected database name")


def preflight(args: argparse.Namespace, source: Identity, destination: Identity) -> dict[str, object]:
    if column_names(args.source_container, source.database, "vip_target_lists") != LIST_COLUMNS:
        raise TransferRejected("source list columns are not the known set")
    if column_names(args.source_container, source.database, "vip_target_contacts") != CONTACT_COLUMNS:
        raise TransferRejected("source contact columns are not the known set")
    if column_names(args.destination_container, destination.database, "vip_target_lists") != LIST_COLUMNS:
        raise TransferRejected("destination list columns are not the known set")
    if column_names(args.destination_container, destination.database, "vip_target_contacts") != CONTACT_COLUMNS:
        raise TransferRejected("destination contact columns are not the known set")
    source_head, source_finished, source_unfinished = migration_head(args.source_container, source.database)
    dest_head, dest_finished, dest_unfinished = migration_head(args.destination_container, destination.database)
    if (
        source_head != SOURCE_MIGRATION_HEAD
        or source_finished != SOURCE_MIGRATION_COUNT
        or source_unfinished != 0
        or dest_head != DESTINATION_MIGRATION_HEAD
        or dest_finished != DESTINATION_MIGRATION_COUNT
        or dest_unfinished != 0
    ):
        raise TransferRejected("migration ledger is not compatible with this transfer")
    safety = safety_counts(args.source_container, source.database)
    if any(safety.values()):
        summary = " ".join(f"{name}={count}" for name, count in safety.items())
        raise TransferRejected(f"unexpected safety metadata {summary}", code=3)
    snapshots = int(scalar(
        args.source_container, "salon", source.database, "SELECT count(*)::text FROM vip_request_recipients"
    ))
    admin_status = scalar(
        args.destination_container,
        "salon",
        destination.database,
        "SELECT coalesce((SELECT status::text FROM platform_admins "
        f"WHERE id = {sql_literal(args.destination_admin_id)}::uuid), 'missing')",
    )
    if admin_status != "ACTIVE":
        raise TransferRejected("destination admin rejected")
    write_role = at_query(
        args.destination_container,
        "salon",
        destination.database,
        """
        SELECT rolsuper::text, rolcreatedb::text, rolcreaterole::text, rolinherit::text
        FROM pg_roles WHERE rolname = 'salon_app'
        """,
    )
    if write_role != [["false", "false", "false", "false"]]:
        raise TransferRejected("salon_app does not have the expected restricted attributes")
    for kind, expected in (
        ("list-id", EXPECTED_LIST_ID_MD5),
        ("phone", EXPECTED_PHONE_MD5),
        ("tuple", EXPECTED_CONTACT_TUPLE_MD5),
    ):
        if fingerprint(args.source_container, "salon", source.database, kind) != expected:
            raise TransferRejected("source fingerprint does not match the historical inventory")
    return {"safety": safety, "recipientSnapshots": snapshots}


def print_summary(prefix: str, **values: object) -> None:
    body = " ".join(f"{key}={value}" for key, value in values.items())
    line = f"{prefix} {body}".strip()
    assert_no_phone_text(line, "report")
    print(line)


def run(args: argparse.Namespace) -> None:
    source_expected = Identity(
        require_database_name(args.source_database, "source database"),
        require_sysid(args.source_system_identifier),
        None if args.source_comment_null else args.source_comment,
    )
    if not args.source_comment_null and args.source_comment is None:
        raise TransferRejected("source comment was not supplied")
    destination_expected = Identity(
        require_database_name(args.destination_database, "destination database"),
        require_sysid(args.destination_system_identifier),
        args.destination_comment,
    )
    if args.source_origin_system_identifier != ORIGIN_SYSTEM_IDENTIFIER:
        raise TransferRejected("source origin system identifier does not match the historical volume")
    if source_expected.database != HISTORICAL_DATABASE:
        raise TransferRejected("source database must be the historical salon database")
    if source_expected.system_identifier == ORIGIN_SYSTEM_IDENTIFIER:
        raise TransferRejected("source connection must be a clone, not the original volume")
    for label, value in (
        ("list count", args.expected_list_count),
        ("contact count", args.expected_contact_count),
    ):
        expected = EXPECTED_LIST_COUNT if "list" in label else EXPECTED_CONTACT_COUNT
        if value != expected:
            raise TransferRejected(f"{label} argument does not match the historical inventory")
    if args.expected_list_id_md5 != EXPECTED_LIST_ID_MD5 or args.expected_phone_md5 != EXPECTED_PHONE_MD5:
        raise TransferRejected("fingerprint argument does not match the historical inventory")
    admin_id = require_uuid(args.destination_admin_id, "destination admin")
    refuse_canonical_replay(args.mode, destination_expected.system_identifier)
    refuse_protected_targets(
        args.source_container,
        args.destination_container,
        destination_expected,
        args.allow_canonical_destination,
    )
    source_live = read_identity(args.source_container, source_expected.database)
    destination_live = read_identity(args.destination_container, destination_expected.database)
    assert_connection_identity(source_live, source_expected, "source")
    assert_connection_identity(destination_live, destination_expected, "destination")
    if args.mode in {"baseline", "reconcile"} and not args.baseline_file:
        raise TransferRejected("baseline file was not supplied")
    if args.mode == "baseline":
        preserved, business_md5 = capture_baseline(args.destination_container, destination_expected.database)
        payload = baseline_payload(destination_expected, preserved, business_md5)
        write_baseline_file(args.baseline_file, payload)
        print_summary("VIP_TRANSFER_BASELINE_WRITTEN", database=destination_expected.database)
        return
    if args.mode == "reconcile":
        baseline = read_baseline_file(args.baseline_file, destination_expected)
        expected_shape = list_shape_md5(load_lists(args.source_container, source_expected.database), admin_id)
        raw = psql_read_only(
            args.destination_container,
            "salon_app",
            destination_expected.database,
            reconcile_snapshot_sql(admin_id),
        )
        lines = raw.splitlines()
        fields = lines[0].split(chr(31)) if lines else []
        manifest_raw = lines[1] if len(lines) > 1 else ""
        manifest = None
        if manifest_raw:
            assert_no_phone_text(manifest_raw, "stored manifest")
            manifest = json.loads(manifest_raw)
        problems = reconcile_problems(
            fields=fields,
            manifest=manifest,
            expected_shape_md5=expected_shape,
            admin_id=admin_id,
            baseline_preserved=str(baseline["preserved"]),
            baseline_business_md5=str(baseline["businessMd5"]),
        )
        if problems:
            raise TransferRejected("VIP_TRANSFER_RECONCILE_FAILED " + " ".join(problems))
        print_summary(
            "VIP_TRANSFER_RECONCILE_OK",
            lists=EXPECTED_LIST_COUNT,
            contacts=EXPECTED_CONTACT_COUNT,
            requestable=0,
            audits=1,
        )
        return
    inspected = preflight(args, source_expected, destination_expected)
    if args.mode == "dry-run":
        print_summary(
            "VIP_TRANSFER_DRY_RUN",
            lists=EXPECTED_LIST_COUNT,
            contacts=EXPECTED_CONTACT_COUNT,
            stops=0,
            deliveries=0,
            recipientSnapshots=inspected["recipientSnapshots"],
            deliveriesDoNotProveNoSend=True,
        )
        return
    lists = load_lists(args.source_container, source_expected.database)
    contacts = load_contacts(args.source_container, source_expected.database)
    validate_lists_and_contacts(lists, contacts)
    action, payload = latest_manifest(args.destination_container, destination_expected.database)
    destination_list_ids = {
        require_uuid(row[0], "destination list")
        for row in at_query(
            args.destination_container,
            "salon_app",
            destination_expected.database,
            "SELECT id::text FROM vip_target_lists",
        )
    }
    destination_contact_ids = {
        require_uuid(row[0], "destination contact")
        for row in at_query(
            args.destination_container,
            "salon_app",
            destination_expected.database,
            "SELECT id::text FROM vip_target_contacts",
        )
    }
    manifest_list_ids, manifest_contact_ids = owned_ids(payload)
    equivalent = False
    if action == TRANSFER_ACTION:
        equivalent = (
            fingerprint(args.destination_container, "salon_app", destination_expected.database, "tuple")
            == EXPECTED_CONTACT_TUPLE_MD5
            and fingerprint(args.destination_container, "salon_app", destination_expected.database, "list-id")
            == EXPECTED_LIST_ID_MD5
            and scalar(
                args.destination_container,
                "salon_app",
                destination_expected.database,
                "SELECT count(*)::text FROM vip_target_lists WHERE status = 'PENDING' "
                "AND reserved_by_salon_id IS NULL AND reserved_at IS NULL "
                f"AND created_by_admin_id = {sql_literal(admin_id)}::uuid",
            )
            == str(EXPECTED_LIST_COUNT)
        )
    if args.mode == "rollback":
        if action != TRANSFER_ACTION or payload is None:
            raise TransferRejected("no completed transfer manifest to roll back")
        reference_counts = {
            "vip_requests": int(scalar(
                args.destination_container,
                "salon_app",
                destination_expected.database,
                "SELECT count(*)::text FROM vip_requests WHERE list_id IN (SELECT id FROM vip_target_lists)",
            )),
            "vip_request_recipients": int(scalar(
                args.destination_container,
                "salon_app",
                destination_expected.database,
                "SELECT count(*)::text FROM vip_request_recipients "
                "WHERE source_contact_id IN (SELECT id FROM vip_target_contacts)",
            )),
        }
        rollback_decision(
            reference_counts,
            owned_ids_present(destination_list_ids, manifest_list_ids, EXPECTED_LIST_COUNT),
            owned_ids_present(destination_contact_ids, manifest_contact_ids, EXPECTED_CONTACT_COUNT),
        )
        psql(
            args.destination_container,
            "salon_app",
            destination_expected.database,
            build_rollback_sql(destination_expected, admin_id, payload),
            read_only=False,
        )
        print_summary("VIP_TRANSFER_ROLLBACK_OK", lists=EXPECTED_LIST_COUNT, contacts=EXPECTED_CONTACT_COUNT)
        return
    decision = decide_transfer(
        destination_list_ids=destination_list_ids,
        destination_contact_ids=destination_contact_ids,
        latest_action=action,
        manifest_list_ids=manifest_list_ids,
        manifest_contact_ids=manifest_contact_ids,
        equivalent=equivalent,
    )
    if decision == "rerun":
        if args.fail_after_contacts is not None:
            raise TransferRejected("fail-after applies only to a first insert")
        success_audits = int(scalar(
            args.destination_container,
            "salon_app",
            destination_expected.database,
            f"SELECT count(*)::text FROM audit_logs WHERE action = '{TRANSFER_ACTION}' AND result = 'SUCCESS'",
        ))
        psql(
            args.destination_container,
            "salon_app",
            destination_expected.database,
            build_rerun_sql(destination_expected, admin_id, success_audits, list_shape_md5(lists, admin_id)),
            read_only=False,
        )
        print_summary("VIP_TRANSFER_RERUN_UNCHANGED", lists=EXPECTED_LIST_COUNT, contacts=EXPECTED_CONTACT_COUNT, audits=success_audits)
        return
    manifest = manifest_payload(
        manifest_id=str(uuid.uuid4()),
        source=source_expected,
        source_origin=ORIGIN_SYSTEM_IDENTIFIER,
        destination=destination_expected,
        admin_id=admin_id,
        lists=lists,
        contacts=contacts,
        safety=inspected["safety"],  # type: ignore[arg-type]
        recipient_snapshots=int(inspected["recipientSnapshots"]),
    )
    sql = build_insert_sql(
        destination=destination_expected,
        admin_id=admin_id,
        lists=lists,
        contacts=contacts,
        manifest=manifest,
        fail_after_contacts=args.fail_after_contacts,
        shape_md5=list_shape_md5(lists, admin_id),
    )
    psql(args.destination_container, "salon_app", destination_expected.database, sql, read_only=False)
    print_summary(
        "VIP_TRANSFER_OK",
        lists=EXPECTED_LIST_COUNT,
        contacts=EXPECTED_CONTACT_COUNT,
        pending=EXPECTED_LIST_COUNT,
        requestable=0,
    )


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-container", required=True)
    parser.add_argument("--source-database", required=True)
    parser.add_argument("--source-system-identifier", required=True)
    parser.add_argument("--source-origin-system-identifier", required=True)
    parser.add_argument("--source-comment")
    parser.add_argument("--source-comment-null", action="store_true")
    parser.add_argument("--destination-container", required=True)
    parser.add_argument("--destination-database", required=True)
    parser.add_argument("--destination-system-identifier", required=True)
    parser.add_argument("--destination-comment", required=True)
    parser.add_argument("--destination-admin-id", required=True)
    parser.add_argument("--expected-list-count", required=True, type=int)
    parser.add_argument("--expected-contact-count", required=True, type=int)
    parser.add_argument("--expected-list-id-md5", required=True)
    parser.add_argument("--expected-phone-md5", required=True)
    parser.add_argument("--mode", required=True, choices=["dry-run", "execute", "rollback", "reconcile", "baseline"])
    parser.add_argument("--baseline-file")
    parser.add_argument("--fail-after-contacts", type=int)
    parser.add_argument("--allow-canonical-destination", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str]) -> None:
    try:
        run(parse_args(argv))
    except TransferRejected as error:
        print(redact(error.message), file=sys.stderr)
        raise SystemExit(error.code) from None


if __name__ == "__main__":
    main(sys.argv[1:])
