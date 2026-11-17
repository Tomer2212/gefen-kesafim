"""gefen_accounts — "חשבונות במערכת גפן": division codes, the stage mirror and file→account
mapping. Pure functions, no DB."""
from itertools import combinations

import gefen_accounts as ga

LAYERS = ga.LAYERS


def _partitions(items):
    """Every way to split `items` into non-empty groups."""
    if not items:
        yield []
        return
    first, rest = items[0], items[1:]
    for part in _partitions(rest):
        for i in range(len(part)):
            yield part[:i] + [[first] + part[i]] + part[i + 1:]
        yield [[first]] + part


def _valid_account_sets():
    """Every valid set of accounts: any subset of the layers, partitioned into accounts."""
    for n in range(0, len(LAYERS) + 1):
        for subset in combinations(LAYERS, n):
            yield from _partitions(list(subset))


def test_division_type_is_unique_for_every_valid_account_set():
    sets = list(_valid_account_sets())
    assert len(sets) == 15  # 1 (none) + 3 + 2*3 + 5
    for accounts in sets:
        assert ga.validate_covers_list(accounts) is None
        divisions = [ga.division_type_for(c) for c in accounts]
        assert len(divisions) == len(set(divisions)), accounts


def test_division_type_for_each_account_kind():
    assert ga.division_type_for(["elyona"]) == "tikkon"
    assert ga.division_type_for(["chativa"]) == "beinayim"
    assert ga.division_type_for(["yesodi", "chativa"]) == "beinayim"
    assert ga.division_type_for(["yesodi"]) == "yesodi"
    assert ga.division_type_for(["chativa", "elyona"]) == "combined"
    assert ga.division_type_for(["yesodi", "elyona"]) == "combined"
    assert ga.division_type_for(["yesodi", "chativa", "elyona"]) == "combined"


def test_validate_rejects_overlap_empty_and_too_many():
    assert "יסודי" in ga.validate_covers_list([["yesodi"], ["yesodi", "chativa"]])
    assert ga.validate_covers_list([[]]) is not None
    assert ga.validate_covers_list([["yesodi"], ["chativa"], ["elyona"], ["yesodi"]]) is not None


def _accounts(*covers_list):
    return [
        {"id": f"a{i}", "covers": list(c), "division_type": ga.division_type_for(c)}
        for i, c in enumerate(covers_list)
    ]


def test_derive_stage_keeps_six_year_behaviors_for_split_schools():
    assert ga.derive_stage([]) is None
    assert ga.derive_stage(_accounts(["chativa"], ["elyona"])) == "sheshshnati"
    assert ga.derive_stage(_accounts(["yesodi", "chativa"], ["elyona"])) == "sheshshnati"
    assert ga.derive_stage(_accounts(["yesodi"], ["chativa"], ["elyona"])) == "sheshshnati"
    assert ga.derive_stage(_accounts(["yesodi"], ["elyona"])) == "sheshshnati"
    assert ga.derive_stage(_accounts(["yesodi"])) == "yesodi"
    assert ga.derive_stage(_accounts(["elyona"])) == "tikkon"
    assert ga.derive_stage(_accounts(["chativa", "elyona"])) == "other"
    assert ga.derive_stage(_accounts(["yesodi"], ["chativa"])) == "other"


def test_stage_accounts_round_trip_to_the_same_stage():
    for stage, covers_list in ga.STAGE_ACCOUNTS.items():
        assert ga.derive_stage(_accounts(*covers_list)) == stage


def test_file_bucket_resolution():
    six = _accounts(["chativa"], ["elyona"])
    assert ga.resolve_bucket_account(six, "tikkon", None)["id"] == "a1"
    assert ga.resolve_bucket_account(six, "beinayim", None)["id"] == "a0"

    three = _accounts(["yesodi"], ["chativa"], ["elyona"])
    assert ga.resolve_bucket_account(three, "tikkon", None)["id"] == "a2"
    # יסודי vs חט"ב share report codes — only the tab can tell them apart.
    assert ga.resolve_bucket_account(three, "beinayim", None) is None
    assert ga.resolve_bucket_account(three, "beinayim", "a1")["id"] == "a1"
    assert ga.resolve_bucket_account(three, "beinayim", "a0")["id"] == "a0"

    combined = _accounts(["chativa", "elyona"])
    assert ga.resolve_bucket_account(combined, "tikkon", None)["id"] == "a0"
    assert ga.resolve_bucket_account(combined, "beinayim", None)["id"] == "a0"


def test_requested_bucket_and_yesodi_relabel():
    yesodi, chativa, elyona, combined = (_accounts(c)[0] for c in (["yesodi"], ["chativa"], ["elyona"], ["yesodi", "elyona"]))
    assert ga.requested_bucket(elyona) == "tikkon"
    assert ga.requested_bucket(yesodi) == "beinayim"
    assert ga.requested_bucket(chativa) == "beinayim"
    assert ga.requested_bucket(combined) is None
    assert ga.rewrites_to_yesodi(yesodi) and ga.rewrites_to_yesodi(combined)
    assert not ga.rewrites_to_yesodi(chativa) and not ga.rewrites_to_yesodi(elyona)
    assert not ga.rewrites_to_yesodi(_accounts(["yesodi", "chativa"])[0])


def test_legacy_rows_without_covers():
    assert ga.account_covers({"division_type": "tikkon"}) == ["elyona"]
    assert ga.account_label({"division_type": "beinayim"}) == 'חט"ב'
    assert ga.buckets_of({"division_type": "tikkon"}) == {"tikkon"}


def test_covers_from_label_round_trips_every_account_kind():
    for covers in (["yesodi"], ["chativa"], ["elyona"], ["yesodi", "chativa"], ["chativa", "elyona"],
                   ["yesodi", "elyona"], ["yesodi", "chativa", "elyona"]):
        assert ga.covers_from_label(ga.covers_label(covers)) == covers


def test_year_entries_drop_empty_and_derive_division():
    entries = ga._year_entries([{"covers": ["elyona", "chativa"]}, {"covers": []}, None, {"covers": ["yesodi"]}])
    assert entries == [
        {"division_type": "combined", "covers": ["chativa", "elyona"]},
        {"division_type": "yesodi", "covers": ["yesodi"]},
    ]


def test_years_after_and_up_to():
    from academic_years import ACADEMIC_YEARS
    first, last = ACADEMIC_YEARS[0], ACADEMIC_YEARS[-1]
    assert ga.years_after(last) == []
    assert ga.years_after(first) == ACADEMIC_YEARS[1:]
    assert ga._years_up_to(last) == ACADEMIC_YEARS
