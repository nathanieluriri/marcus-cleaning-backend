from __future__ import annotations

import pytest

from core.i18n import LocaleResolutionError, parse_accept_language, translate_message


def test_parse_accept_language_accepts_supported_values():
    assert parse_accept_language("en-US,en;q=0.9") == "en"
    assert parse_accept_language("fr-FR,fr;q=0.8") == "fr"


def test_parse_accept_language_rejects_unsupported_values():
    with pytest.raises(LocaleResolutionError):
        parse_accept_language("es-ES,es;q=0.9")


def test_translate_message_supports_suffix_patterns_for_french():
    assert translate_message("Customer profile fetched successfully", "fr").endswith("recupere avec succes")
    assert translate_message("Cleaner profile updated successfully", "fr").endswith("mis a jour avec succes")
