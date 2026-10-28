import hashlib
import importlib.util
import sys
import unittest
import uuid
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("transfer-vip-inventory.py")
spec = importlib.util.spec_from_file_location("transfer_vip_inventory", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
EXPECTED_CONTACT_COUNT = module.EXPECTED_CONTACT_COUNT
EXPECTED_LIST_COUNT = module.EXPECTED_LIST_COUNT
ContactRow = module.ContactRow
Identity = module.Identity
ListRow = module.ListRow
SMALL_LISTS = module.SMALL_LISTS
TransferRejected = module.TransferRejected
build_insert_sql = module.build_insert_sql
build_rerun_sql = module.build_rerun_sql
decide_transfer = module.decide_transfer
manifest_payload = module.manifest_payload
redact = module.redact
ids_md5 = module.ids_md5
list_shape_md5 = module.list_shape_md5
owned_ids_present = module.owned_ids_present
reconcile_problems = module.reconcile_problems
reconcile_snapshot_sql = module.reconcile_snapshot_sql
rollback_decision = module.rollback_decision
validate_lists_and_contacts = module.validate_lists_and_contacts


def inventory():
    lists = []
    contacts = []
    remaining = EXPECTED_CONTACT_COUNT
    names = [f"VIP-{index:02d}-01" for index in range(1, 30)]
    names[10] = "VIP-11-01"
    names[13] = "VIP-14-01"
    admin = str(uuid.uuid4())
    phone_index = 0
    for position, name in enumerate(names):
        if name in SMALL_LISTS:
            count = SMALL_LISTS[name]
        elif position == len(names) - 1:
            count = remaining
        else:
            count = 79
        remaining -= count
        list_id = str(uuid.uuid4())
        lists.append(
            ListRow(
                list_id,
                name,
                "ACTIVE",
                count,
                f"{(position % 14) + 1:02d}",
                "ORIGINAL_TEHRAN",
                admin,
                "",
                "",
                "2026-01-01T00:00:00.000Z",
                "2026-01-02T00:00:00.000Z",
            )
        )
        for sort_order in range(1, count + 1):
            contacts.append(
                ContactRow(
                    str(uuid.uuid4()),
                    list_id,
                    sort_order,
                    None,
                    f"09{phone_index:09d}",
                    "2026-01-01T00:00:00.000Z",
                )
            )
            phone_index += 1
    return lists, contacts


class TransferPureTests(unittest.TestCase):
    def test_validate_keeps_the_small_lists_exact(self) -> None:
        lists, contacts = inventory()
        validate_lists_and_contacts(lists, contacts)
        changed = []
        for row in lists:
            if row.name == "VIP-11-01":
                changed.append(ListRow(**{**row.__dict__, "contact_count": row.contact_count + 1}))
            else:
                changed.append(row)
        with self.assertRaises(TransferRejected):
            validate_lists_and_contacts(changed, contacts)

    def test_manifest_ignores_digits_inside_an_identifier(self) -> None:
        lists, contacts = inventory()
        identifier = "aaaaaaaa-bbbb-4ccc-8ddd-" + "09" + "123456789" + "a"
        contacts[0] = ContactRow(**{**contacts[0].__dict__, "id": identifier})
        payload = manifest_payload(
            manifest_id=str(uuid.uuid4()),
            source=Identity("salon", "1", None),
            source_origin="7683163620851879970",
            destination=Identity("phone_first_product", "2", "rehearsal"),
            admin_id=str(uuid.uuid4()),
            lists=lists,
            contacts=contacts,
            safety={
                "platform_message_stops": 0,
                "platform_message_stop_events": 0,
                "message_global_stop_outcomes": 0,
                "message_deliveries": 0,
            },
            recipient_snapshots=200,
        )
        self.assertEqual(payload["contactCount"], EXPECTED_CONTACT_COUNT)

    def test_manifest_rejects_a_phone_number(self) -> None:
        lists, contacts = inventory()
        leaked = [ListRow(**{**lists[0].__dict__, "name": "09000000000"})]
        leaked.extend(lists[1:])
        with self.assertRaises(TransferRejected):
            manifest_payload(
                manifest_id=str(uuid.uuid4()),
                source=Identity("salon", "1", None),
                source_origin="7683163620851879970",
                destination=Identity("phone_first_product", "2", "rehearsal"),
                admin_id=str(uuid.uuid4()),
                lists=leaked,
                contacts=contacts,
                safety={
                    "platform_message_stops": 0,
                    "platform_message_stop_events": 0,
                    "message_global_stop_outcomes": 0,
                    "message_deliveries": 0,
                },
                recipient_snapshots=200,
            )

    def test_decide_insert_rerun_and_conflict(self) -> None:
        self.assertEqual(
            decide_transfer(
                destination_list_ids=set(),
                destination_contact_ids=set(),
                latest_action=None,
                manifest_list_ids=set(),
                manifest_contact_ids=set(),
                equivalent=False,
            ),
            "insert",
        )
        owned = {"list-1"}
        contacts = {"contact-1"}
        self.assertEqual(
            decide_transfer(
                destination_list_ids=owned,
                destination_contact_ids=contacts,
                latest_action="VIP_INVENTORY_TRANSFER",
                manifest_list_ids=owned,
                manifest_contact_ids=contacts,
                equivalent=True,
            ),
            "rerun",
        )
        with self.assertRaises(TransferRejected):
            decide_transfer(
                destination_list_ids=owned,
                destination_contact_ids=contacts,
                latest_action=None,
                manifest_list_ids=set(),
                manifest_contact_ids=set(),
                equivalent=False,
            )
        with self.assertRaises(TransferRejected):
            decide_transfer(
                destination_list_ids=owned,
                destination_contact_ids=contacts,
                latest_action="VIP_INVENTORY_TRANSFER",
                manifest_list_ids=owned,
                manifest_contact_ids=contacts,
                equivalent=False,
            )

    def test_rollback_refuses_a_business_reference(self) -> None:
        with self.assertRaises(TransferRejected) as caught:
            rollback_decision({"vip_requests": 1}, True, True)
        self.assertEqual(caught.exception.code, 4)
        rollback_decision({}, True, True)

    def test_rollback_keeps_rows_the_transfer_does_not_own(self) -> None:
        owned = {str(uuid.uuid4()) for _ in range(EXPECTED_LIST_COUNT)}
        self.assertTrue(owned_ids_present(set(owned), set(owned), EXPECTED_LIST_COUNT))
        self.assertTrue(owned_ids_present(set(owned) | {str(uuid.uuid4())}, set(owned), EXPECTED_LIST_COUNT))
        self.assertFalse(owned_ids_present(set(list(owned)[:-1]), set(owned), EXPECTED_LIST_COUNT))

    def test_insert_is_one_transaction_and_rerun_does_not_write(self) -> None:
        lists, contacts = inventory()
        admin = str(uuid.uuid4())
        destination = Identity("phone_first_product", "2", "rehearsal")
        manifest = manifest_payload(
            manifest_id=str(uuid.uuid4()),
            source=Identity("salon", "1", None),
            source_origin="7683163620851879970",
            destination=destination,
            admin_id=admin,
            lists=lists,
            contacts=contacts,
            safety={
                "platform_message_stops": 0,
                "platform_message_stop_events": 0,
                "message_global_stop_outcomes": 0,
                "message_deliveries": 0,
            },
            recipient_snapshots=200,
        )
        sql = build_insert_sql(
            destination=destination,
            admin_id=admin,
            lists=lists,
            contacts=contacts,
            manifest=manifest,
            fail_after_contacts=1,
            shape_md5="abc",
        )
        self.assertTrue(sql.strip().startswith("BEGIN;"))
        self.assertIn("forced transfer failure", sql)
        self.assertLess(sql.index("INSERT INTO vip_target_lists"), sql.index("INSERT INTO vip_target_contacts"))
        self.assertLess(sql.index("INSERT INTO vip_target_contacts"), sql.index("forced transfer failure"))
        self.assertLess(sql.index("forced transfer failure"), sql.index("COMMIT;"))
        self.assertNotIn("ON CONFLICT", sql)
        self.assertNotIn("DISABLE TRIGGER", sql.upper())
        self.assertNotIn("LOCK TABLE", sql.upper())
        self.assertIn("'PENDING'::\"VipTargetListStatus\"", sql)
        rerun = build_rerun_sql(destination, admin, 1, "abc")
        self.assertNotIn("INSERT ", rerun.upper())
        self.assertNotIn("UPDATE ", rerun.upper())
        self.assertNotIn("DELETE ", rerun.upper())

    def test_reconcile_accepts_a_match_and_names_corruption(self) -> None:
        lists, contacts = inventory()
        admin = str(uuid.uuid4())
        manifest = manifest_payload(
            manifest_id=str(uuid.uuid4()),
            source=Identity("salon", "1", None),
            source_origin="7683163620851879970",
            destination=Identity("phone_first_product", "2", "rehearsal"),
            admin_id=admin,
            lists=lists,
            contacts=contacts,
            safety={
                "platform_message_stops": 0,
                "platform_message_stop_events": 0,
                "message_global_stop_outcomes": 0,
                "message_deliveries": 0,
            },
            recipient_snapshots=200,
        )
        list_md5 = ids_md5([row.id for row in lists])
        contact_md5 = ids_md5([row.id for row in contacts])
        phone_md5 = hashlib.md5(
            "\n".join(sorted(row.phone_number for row in contacts)).encode("utf-8")
        ).hexdigest()
        ordered = sorted(contacts, key=lambda item: (item.list_id, item.sort_order, item.id))
        tuple_md5 = hashlib.md5(
            "\n".join(
                f"{row.list_id}|{row.id}|{row.sort_order}|{row.phone_number}|"
                for row in ordered
            ).encode("utf-8")
        ).hexdigest()
        shape = list_shape_md5(lists, admin)
        manifest["listIdMd5"] = list_md5
        manifest["phoneMd5"] = phone_md5
        manifest["contactTupleMd5"] = tuple_md5
        fields = [
            "29",
            "2194",
            list_md5,
            contact_md5,
            phone_md5,
            tuple_md5,
            shape,
            "29",
            "0",
            "0",
            "0",
            "0",
            "VIP-11-01=28,VIP-14-01=27",
            "1",
            "0",
            "VIP_INVENTORY_TRANSFER",
            "preserved-a",
            "business-a",
        ]
        kwargs = {
            "manifest": manifest,
            "expected_shape_md5": shape,
            "admin_id": admin,
            "baseline_preserved": "preserved-a",
            "baseline_business_md5": "business-a",
            "expected_list_id_md5": list_md5,
            "expected_phone_md5": phone_md5,
            "expected_tuple_md5": tuple_md5,
        }
        self.assertEqual(reconcile_problems(fields=fields, **kwargs), [])
        counted = list(fields)
        counted[0] = "28"
        self.assertIn("counts", reconcile_problems(fields=counted, **kwargs))
        regional = list(fields)
        regional[6] = "0" * 32
        self.assertIn("list-shape", reconcile_problems(fields=regional, **kwargs))
        changed_contact = list(fields)
        changed_contact[5] = "1" * 32
        self.assertIn("contact-equivalence", reconcile_problems(fields=changed_contact, **kwargs))
        audited = list(fields)
        audited[14] = "1"
        audited[15] = "VIP_INVENTORY_TRANSFER_ROLLBACK"
        found = reconcile_problems(fields=audited, **kwargs)
        self.assertIn("subsequent-rollback", found)
        self.assertIn("transfer-audit", found)
        drifted = dict(kwargs)
        drifted["baseline_preserved"] = "preserved-b"
        self.assertIn("preserved-baseline", reconcile_problems(fields=fields, **drifted))
        module.assert_read_only_sql(reconcile_snapshot_sql(admin))

    def test_hyphenated_database_name_is_accepted_and_replay_is_refused(self) -> None:
        self.assertEqual(module.require_database_name("salon-db", "database"), "salon-db")
        with self.assertRaises(TransferRejected):
            module.require_database_name("salon-db;drop", "database")
        with self.assertRaises(TransferRejected):
            module.refuse_canonical_replay("execute", module.CANONICAL_SYSTEM_IDENTIFIER)
        module.refuse_canonical_replay("dry-run", module.CANONICAL_SYSTEM_IDENTIFIER)

    def test_redact_removes_phones_and_urls(self) -> None:
        cleaned = redact("failed 09123456789 postgresql://salon_app:secret@127.0.0.1/db")
        self.assertNotIn("09123456789", cleaned)
        self.assertNotIn("postgresql://", cleaned)


if __name__ == "__main__":
    unittest.main()
