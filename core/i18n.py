from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Final

from fastapi import Request

DEFAULT_LANGUAGE: Final[str] = "en"
SUPPORTED_LANGUAGES: Final[set[str]] = {"en", "fr"}
REQUEST_LOCALE_STATE_KEY: Final[str] = "locale"

_LANGUAGE_TOKEN_RE = re.compile(r"^\s*([A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})?)")

_FR_EXACT_TRANSLATIONS: Final[dict[str, str]] = {
    "Success": "Succes",
    "Created": "Cree",
    "Deleted": "Supprime",
    "Validation error": "Erreur de validation",
    "Internal Server Error": "Erreur interne du serveur",
    "Too Many Requests": "Trop de requetes",
    "Request failed": "Echec de la requete",
    "Invalid token": "Jeton invalide",
    "Token role mismatch": "Role du jeton non conforme",
    "Insufficient permissions": "Permissions insuffisantes",
    "No permissions assigned": "Aucune permission attribuee",
    "Admin not found": "Administrateur introuvable",
    "Customer not found": "Client introuvable",
    "Cleaner not found": "Prestataire introuvable",
    "Admin account is not active": "Le compte administrateur n'est pas actif",
    "Customer account is not active": "Le compte client n'est pas actif",
    "Cleaner account is not active": "Le compte prestataire n'est pas actif",
    "Invalid email or password": "Email ou mot de passe invalide",
    "Login successful": "Connexion reussie",
    "Tokens refreshed successfully": "Jetons actualises avec succes",
    "Password reset request accepted": "Demande de reinitialisation du mot de passe acceptee",
    "Account deletion request accepted": "Demande de suppression de compte acceptee",
    "Account deactivation request accepted": "Demande de desactivation de compte acceptee",
    "Other sessions revoked successfully": "Autres sessions revoquees avec succes",
    "All sessions revoked successfully": "Toutes les sessions revoquees avec succes",
    "Current session logged out successfully": "Session actuelle deconnectee avec succes",
    "Session revoked successfully": "Session revoquee avec succes",
    "Notification marked as read": "Notification marquee comme lue",
    "All notifications marked as read": "Toutes les notifications marquees comme lues",
    "Unsupported locale. Use 'en' or 'fr'.": "Langue non prise en charge. Utilisez 'en' ou 'fr'.",
}

_FR_SUFFIX_TRANSLATIONS: Final[dict[str, str]] = {
    " fetched successfully": " recupere avec succes",
    " updated successfully": " mis a jour avec succes",
    " created successfully": " cree avec succes",
    " deleted successfully": " supprime avec succes",
}


@dataclass(frozen=True)
class LocaleResolutionError(ValueError):
    message: str


def _normalize_lang_token(token: str) -> str | None:
    normalized = token.strip().lower().replace("_", "-")
    if not normalized:
        return None
    primary = normalized.split("-", 1)[0]
    if primary in SUPPORTED_LANGUAGES:
        return primary
    return None


def parse_accept_language(raw_header: str | None) -> str | None:
    if raw_header is None:
        return None
    value = raw_header.strip()
    if not value:
        return None

    candidates: list[str] = []
    for item in value.split(","):
        match = _LANGUAGE_TOKEN_RE.match(item)
        if not match:
            continue
        token = match.group(1)
        candidates.append(token)
        normalized = _normalize_lang_token(token)
        if normalized is not None:
            return normalized

    if candidates:
        raise LocaleResolutionError("Unsupported locale. Use 'en' or 'fr'.")
    raise LocaleResolutionError("Unsupported locale. Use 'en' or 'fr'.")


def normalize_supported_language(value: str | None, *, default_to_english: bool = True) -> str:
    if value is None:
        return DEFAULT_LANGUAGE if default_to_english else ""
    normalized = _normalize_lang_token(value)
    if normalized is None:
        if default_to_english:
            return DEFAULT_LANGUAGE
        raise LocaleResolutionError("Unsupported locale. Use 'en' or 'fr'.")
    return normalized


def set_request_locale(request: Request, language: str | None) -> str:
    resolved = normalize_supported_language(language, default_to_english=True)
    setattr(request.state, REQUEST_LOCALE_STATE_KEY, resolved)
    return resolved


def get_request_locale(request: Request | None) -> str:
    if request is None:
        return DEFAULT_LANGUAGE
    locale = getattr(request.state, REQUEST_LOCALE_STATE_KEY, None)
    return normalize_supported_language(locale, default_to_english=True)


def translate_message(message: str, language: str) -> str:
    if language != "fr":
        return message

    exact = _FR_EXACT_TRANSLATIONS.get(message)
    if exact:
        return exact

    lowered = message.lower()
    for source_suffix, target_suffix in _FR_SUFFIX_TRANSLATIONS.items():
        if lowered.endswith(source_suffix):
            prefix = message[: len(message) - len(source_suffix)]
            return f"{prefix}{target_suffix}"

    return message

