import importlib.util
from pathlib import Path

spec=importlib.util.spec_from_file_location('preflight',Path(__file__).with_name('historical-integrity-preflight.py'))
module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)

def test_sql_is_read_only_and_bounded():
    query=module.sql('fixture_db','123','fixture',7)
    assert 'BEGIN READ ONLY' in query
    assert "statement_timeout = '30s'" in query
    assert 'ids[1:7]' in query
    assert 'phone' not in query.lower()
    assert 'message_text' not in query.lower()

def test_identity_literals_reject_newlines():
    try: module.lit('bad\nvalue')
    except ValueError: pass
    else: raise AssertionError('newline was accepted')
