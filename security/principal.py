from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class AuthPrincipal(BaseModel):
    user_id: str
    role: Literal['cleaner', 'customer', 'admin']
    access_token_id: str
    jwt_token: str
    token_created_at: int | None = None
    allow_expired: bool = False

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


    @property
    def is_cleaner(self) -> bool:
        return self.role == "cleaner"

    @property
    def is_customer(self) -> bool:
        return self.role == "customer"
